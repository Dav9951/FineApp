import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AiLogEntryDto, AiUsageDto } from '@fineapp/shared';
import type { LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  extractedItem,
  fakeExtractor,
  multipart,
  receiptPhoto,
  type FakeExtractor,
} from '../../../test/documents-fixtures.js';
import { householdFixture, type HouseholdFixture } from '../../../test/factories.js';
import { ExtractionError } from '../../ai/document-extractor.js';
import { mutableClock, type MutableClock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import { newId } from '../../core/id.js';
import { createDocumentJobs, type DocumentJobs } from './documents.jobs.js';
import { insertDocumentLog } from './documents.repository.js';
import { LOG_RETENTION_MS, ratesFor } from './documents.service.js';

/**
 * Dziennik odczytu (ADR-086) i przełącznik modelu (ADR-085): `GET /documents/log`,
 * `PATCH /settings/ai-model`. Atrapa ekstraktora zamiast usługi AI.
 */

const START = new Date('2026-11-15T10:00:00.000Z');

let harness: TestApp | undefined;
let uploadDir: string | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  if (uploadDir !== undefined) rmSync(uploadDir, { recursive: true, force: true });
  uploadDir = undefined;
});

/** Środowisko testu. */
interface Setup {
  app: TestApp;
  clock: MutableClock;
  home: HouseholdFixture;
  extractor: FakeExtractor;
  jobs: DocumentJobs;
}

/**
 * Aplikacja z włączonym OCR i atrapą ekstraktora.
 *
 * @param uploads - Nadpisania sekcji `uploads`.
 * @returns Środowisko testu.
 */
async function setup(uploads: Partial<Config['uploads']> = {}): Promise<Setup> {
  const dir = mkdtempSync(join(tmpdir(), 'fineapp-log-'));
  uploadDir = dir;
  const clock = mutableClock(START);
  const extractor = fakeExtractor();
  const jobs = createDocumentJobs();
  const base = testConfig();
  const app = await buildTestApp(
    {
      ai: { ...base.ai, enabled: true, apiKey: 'test' },
      uploads: { dir, maxBytes: 10_485_760, ...uploads },
    },
    clock,
    { extractor, documentJobs: jobs },
  );
  harness = app;
  const home = await householdFixture(app.db, testConfig(), START);
  return { app, clock, home, extractor, jobs };
}

/**
 * Wrzuca zdjęcie i czeka na analizę.
 *
 * @param s - Środowisko testu.
 * @param bytes - Zawartość pliku.
 * @returns Odpowiedź wrzucenia.
 */
async function upload(s: Setup, bytes: Buffer): Promise<LightMyRequestResponse> {
  const body = multipart(
    { kind: 'receipt' },
    { filename: 'dlugi-paragon.jpg', contentType: 'image/jpeg', bytes },
  );
  const response = await s.app.app.inject({
    method: 'POST',
    url: '/api/v1/documents',
    headers: { ...s.home.headers, ...body.headers },
    payload: body.payload,
  });
  await s.jobs.idle();
  return response;
}

/**
 * Czyta dziennik.
 *
 * @param s - Środowisko testu.
 * @param query - Parametry zapytania.
 * @returns Wpisy od najnowszych.
 */
async function readLog(s: Setup, query = ''): Promise<AiLogEntryDto[]> {
  const response = await s.app.app.inject({
    method: 'GET',
    url: `/api/v1/documents/log${query}`,
    headers: s.home.headers,
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ data: AiLogEntryDto[] }>().data;
}

describe('GET /documents/log', () => {
  it('udany odczyt: start → przygotowanie → wynik, z czasem i tokenami', async () => {
    const s = await setup();
    s.extractor.push({ items: [extractedItem({ amountMinor: 1299 })] });
    const response = await upload(s, await receiptPhoto());
    const id = response.json<{ data: { id: string } }>().data.id;

    const log = await readLog(s, `?documentId=${id}`);
    expect(log.map((entry) => entry.event)).toEqual(['parsed', 'prepared', 'started']);
    expect(log.every((entry) => entry.documentName === 'dlugi-paragon.jpg')).toBe(true);
    expect(log[0]).toMatchObject({
      level: 'info',
      message: 'Odczytano pozycji: 1.',
      details: { itemCount: 1, durationMs: 1200, stopReason: 'end_turn', requestId: 'req_test' },
    });
    expect(log[2]?.details).toMatchObject({ model: 'claude-sonnet-5', kind: 'receipt' });
  });

  it('nieudany odczyt zostawia przyczynę: kod, status HTTP, czas', async () => {
    const s = await setup();
    s.extractor.push({
      error: new ExtractionError('AI_UNAVAILABLE', 'Nie udało się odczytać dokumentu.', {
        rawResponse: 'status: brak',
        diagnostics: {
          durationMs: 360_000,
          httpStatus: null,
          errorType: 'APIConnectionTimeoutError',
          apiMessage: 'Request timed out.',
        },
      }),
    });
    await upload(s, await receiptPhoto());

    const [failed] = await readLog(s);
    expect(failed).toMatchObject({
      level: 'error',
      event: 'failed',
      details: {
        errorCode: 'AI_UNAVAILABLE',
        errorType: 'APIConnectionTimeoutError',
        durationMs: 360_000,
      },
    });
    expect(failed?.message).toContain('przekroczony czas');
  });

  it('błąd poza ekstraktorem też trafia do dziennika (INTERNAL_ERROR)', async () => {
    const s = await setup();
    s.extractor.push({ error: new TypeError('coś pękło') });
    await upload(s, await receiptPhoto());
    const [failed] = await readLog(s);
    expect(failed?.details).toMatchObject({
      errorCode: 'INTERNAL_ERROR',
      errorType: 'TypeError',
      apiMessage: 'coś pękło',
    });
  });

  it('bardzo długi paragon: ostrzeżenie o wąskim obrazie po skalowaniu', async () => {
    const s = await setup();
    s.extractor.push({ items: [extractedItem()] });
    const tall = await sharp({
      create: { width: 600, height: 6000, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    await upload(s, tall);
    const prepared = (await readLog(s)).find((entry) => entry.event === 'prepared');
    expect(prepared).toMatchObject({
      level: 'warn',
      details: { sourceWidth: 600, sourceHeight: 6000, width: 157, height: 1568 },
    });
  });

  it('plik za duży → wpis upload_rejected z nazwą i limitem', async () => {
    const s = await setup({ maxBytes: 100 });
    const response = await upload(s, await receiptPhoto());
    expect(response.statusCode).toBe(413);
    const [rejected] = await readLog(s);
    expect(rejected).toMatchObject({
      documentId: null,
      level: 'warn',
      event: 'upload_rejected',
      details: { maxBytes: 100 },
    });
    expect(rejected?.message).toContain('dlugi-paragon.jpg');
  });

  it('wpisy starsze niż 90 dni znikają przy kolejnym zapisie', async () => {
    const s = await setup();
    insertDocumentLog(
      s.app.db,
      s.home.householdId,
      {
        id: newId(),
        level: 'info',
        event: 'started',
        message: 'stary wpis',
        createdAt: START.getTime() - LOG_RETENTION_MS - 1,
      },
      0,
    );
    expect(await readLog(s)).toHaveLength(1);
    s.extractor.push({ items: [extractedItem()] });
    await upload(s, await receiptPhoto());
    const log = await readLog(s);
    expect(log.map((entry) => entry.message)).not.toContain('stary wpis');
    expect(log).toHaveLength(3);
  });

  it('wymaga logowania i nie pokazuje cudzego dziennika', async () => {
    const s = await setup();
    s.extractor.push({ items: [extractedItem()] });
    await upload(s, await receiptPhoto());
    const anonymous = await s.app.app.inject({ method: 'GET', url: '/api/v1/documents/log' });
    expect(anonymous.statusCode).toBe(401);
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = await s.app.app.inject({
      method: 'GET',
      url: '/api/v1/documents/log',
      headers: other.headers,
    });
    expect(foreign.json<{ data: unknown[] }>().data).toEqual([]);
  });
});

describe('PATCH /settings/ai-model', () => {
  it('przełącza model: kolejny odczyt idzie nowym modelem i jego stawkami', async () => {
    const s = await setup();
    const changed = await s.app.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings/ai-model',
      headers: s.home.headers,
      payload: { model: 'claude-haiku-5-5' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json<{ data: AiUsageDto }>().data.model).toBe('claude-haiku-5-5');

    s.extractor.push({ items: [extractedItem()] });
    await upload(s, await receiptPhoto());
    expect(s.extractor.calls[0]?.model).toBe('claude-haiku-5-5');
    // 2000 × 40 + 500 × 200 = 180 000 → 0,18 gr → w górę do 1 gr.
    const [parsed] = await readLog(s);
    expect(parsed?.details.costMinor).toBe(1);
  });

  it('odrzuca model spoza katalogu i wymaga logowania', async () => {
    const s = await setup();
    const invalid = await s.app.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings/ai-model',
      headers: s.home.headers,
      payload: { model: 'gpt-zly' },
    });
    expect(invalid.statusCode).toBe(400);
    const anonymous = await s.app.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings/ai-model',
      headers: { 'x-requested-with': 'fineapp' },
      payload: { model: 'claude-haiku-5-5' },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('ratesFor', () => {
  it('model z katalogu ma własne stawki; spoza katalogu — stawki z konfiguracji', () => {
    const config = testConfig().ai;
    expect(ratesFor('claude-haiku-5-5', config)).toMatchObject({
      inputCostMinorPerMTok: 40,
      outputCostMinorPerMTok: 200,
    });
    expect(ratesFor('claude-opus-5-5', config)).toMatchObject({
      inputCostMinorPerMTok: 800,
      outputCostMinorPerMTok: 4000,
    });
  });
});
