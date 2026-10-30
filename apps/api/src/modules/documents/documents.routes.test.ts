import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  extractedItem,
  fakeExtractor,
  multipart,
  receiptPhoto,
  tinyPdf,
  type FakeExtractor,
} from '../../../test/documents-fixtures.js';
import {
  householdFixture,
  insertAccount,
  insertCategory,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { ExtractionError } from '../../ai/document-extractor.js';
import { mutableClock, type MutableClock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import { categories } from '../../db/schema/categories.js';
import { documents } from '../../db/schema/documents.js';
import { transactions } from '../../db/schema/transactions.js';
import { createDocumentJobs, type DocumentJobs } from './documents.jobs.js';
import { failInterruptedDocuments, STALE_PROCESSING_MS } from './documents.service.js';

/**
 * Trasy dokumentów (`F7-1`…`F7-7`, 04 §13, 08). Atrapa ekstraktora zamiast usługi AI,
 * pliki w katalogu tymczasowym.
 */

const START = new Date('2026-09-23T10:00:00.000Z');
const KEY = '3f0c7c1e-6a8e-4b8a-9d1e-0c2b5f1a7e44';

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
  ror: string;
  groceries: string;
  salary: string;
  extractor: FakeExtractor;
  jobs: DocumentJobs;
  dir: string;
}

/**
 * Buduje aplikację z włączonym OCR, atrapą ekstraktora, kontem i kategoriami.
 *
 * @param ai - Nadpisania sekcji `ai` konfiguracji.
 * @param uploads - Nadpisania sekcji `uploads`.
 * @returns Środowisko testu.
 */
async function setup(
  ai: Partial<Config['ai']> = {},
  uploads: Partial<Config['uploads']> = {},
): Promise<Setup> {
  const dir = mkdtempSync(join(tmpdir(), 'fineapp-docs-'));
  uploadDir = dir;
  const clock = mutableClock(START);
  const extractor = fakeExtractor();
  const jobs = createDocumentJobs();
  const base = testConfig();
  const app = await buildTestApp(
    {
      ai: { ...base.ai, enabled: true, apiKey: 'test', ...ai },
      uploads: { dir, maxBytes: 10_485_760, ...uploads },
    },
    clock,
    { extractor, documentJobs: jobs },
  );
  harness = app;
  const home = await householdFixture(app.db, testConfig(), START);
  const groceries = insertCategory(app.db, home, { name: 'Zakupy spożywcze', aiHints: 'Lidl' });
  const salary = insertCategory(app.db, home, { name: 'Pensja', kind: 'income' });
  return {
    app,
    clock,
    home,
    ror: insertAccount(app.db, home),
    groceries,
    salary,
    extractor,
    jobs,
    dir,
  };
}

/**
 * Wrzuca plik.
 *
 * @param s - Środowisko testu.
 * @param bytes - Zawartość.
 * @param fields - Pola formularza.
 * @param home - Gospodarstwo.
 * @returns Odpowiedź.
 */
async function upload(
  s: Setup,
  bytes: Buffer,
  fields: Record<string, string> = {},
  home: HouseholdFixture = s.home,
): Promise<LightMyRequestResponse> {
  const body = multipart(fields, { filename: 'paragon.jpg', contentType: 'image/jpeg', bytes });
  return s.app.app.inject({
    method: 'POST',
    url: '/api/v1/documents',
    headers: { ...home.headers, ...body.headers },
    payload: body.payload,
  });
}

/**
 * Wrzuca plik, czeka na analizę i zwraca dokument.
 *
 * @param s - Środowisko testu.
 * @param bytes - Zawartość.
 * @param fields - Pola formularza.
 * @returns Dokument z odpowiedzi `GET /documents/:id`.
 */
async function uploadAndParse(
  s: Setup,
  bytes: Buffer,
  fields: Record<string, string> = {},
): Promise<DocumentBody> {
  const response = await upload(s, bytes, fields);
  expect(response.statusCode).toBe(202);
  await s.jobs.idle();
  return getDoc(s, response.json<{ data: { id: string } }>().data.id);
}

/** Kształt dokumentu w testach. */
interface DocumentBody {
  id: string;
  status: string;
  kind: string;
  summary: Record<string, unknown> | null;
  suggestedAccountId: string | null;
  items: {
    id: string;
    description: string;
    amountMinor: number;
    direction: string;
    reviewStatus: string;
    suggestedCategoryId: string | null;
    suggestedCategoryName: string | null;
    duplicateOfTransactionId: string | null;
    transactionId: string | null;
  }[];
  newCategoryProposals: { name: string; kind: string; itemIds: string[] }[];
  errorCode: string | null;
  errorMessage: string | null;
  ai: { model: string; costMinor: number } | null;
}

/**
 * Pobiera dokument.
 *
 * @param s - Środowisko testu.
 * @param id - Identyfikator.
 * @returns Dokument.
 */
async function getDoc(s: Setup, id: string): Promise<DocumentBody> {
  const response = await s.app.app.inject({
    method: 'GET',
    url: `/api/v1/documents/${id}`,
    headers: s.home.headers,
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ data: DocumentBody }>().data;
}

/**
 * Programuje odczyt paragonu Lidla: mleko, proszek, baterie (propozycja), rabat.
 *
 * @param s - Środowisko testu.
 */
function scriptLidl(s: Setup): void {
  s.extractor.push({
    header: { merchant: 'Lidl', bookedOn: '2026-09-18', totalMinor: 3347, confidence: 0.94 },
    items: [
      extractedItem({ description: 'Mleko', amountMinor: 698, categoryId: s.groceries }),
      extractedItem({ description: 'Proszek', amountMinor: 2499, categoryId: s.groceries }),
      extractedItem({
        description: 'Baterie AA',
        amountMinor: 450,
        suggestedCategoryName: 'Elektronika',
        confidence: 0.4,
      }),
      extractedItem({ description: 'Rabat', amountMinor: 300, direction: 'inflow' }),
    ],
  });
}

describe('POST /documents', () => {
  it('202 → analiza w tle → parsed z pozycjami, propozycją i kosztem', async () => {
    const s = await setup();
    scriptLidl(s);
    const response = await upload(s, await receiptPhoto(), { accountId: s.ror });

    expect(response.statusCode).toBe(202);
    const accepted = response.json<{ data: { id: string; status: string; pollAfterMs: number } }>();
    expect(accepted.data).toMatchObject({ status: 'processing', pollAfterMs: 1500 });
    expect(response.headers.location).toBe(`/api/v1/documents/${accepted.data.id}`);

    await s.jobs.idle();
    const doc = await getDoc(s, accepted.data.id);
    expect(doc).toMatchObject({
      status: 'parsed',
      kind: 'receipt',
      suggestedAccountId: s.ror,
      summary: { merchant: 'Lidl', totalMinor: 3347, detectedMonthKey: '2026-09' },
      ai: { model: 'fake-model', costMinor: 4 },
      newCategoryProposals: [{ name: 'Elektronika', kind: 'expense' }],
    });
    expect(doc.items.map((item) => item.description)).toEqual([
      'Mleko',
      'Proszek',
      'Baterie AA',
      'Rabat',
    ]);

    // Kontekst: paragon widzi wydatkowe kategorie z podpowiedziami, bez przychodowych.
    const call = s.extractor.calls[0];
    expect(call?.kind).toBe('receipt');
    expect(call?.categories).toEqual([
      { id: s.groceries, path: 'Zakupy spożywcze', kind: 'expense', hints: 'Lidl' },
    ]);
    expect(call?.parts[0]?.kind).toBe('image');
  });

  it('zapisany plik i miniatura nie mają EXIF-u; nazwa od klienta nie jest ścieżką', async () => {
    const s = await setup();
    const response = await upload(s, await receiptPhoto());
    await s.jobs.idle();
    const id = response.json<{ data: { id: string } }>().data.id;
    const [year] = readdirSync(s.dir);
    expect(year).toBe('2026');
    expect(readdirSync(join(s.dir, '2026', '09')).sort()).toEqual([`${id}.jpg`, `${id}.thumb.jpg`]);

    for (const variant of ['original', 'thumb']) {
      const file = await s.app.app.inject({
        method: 'GET',
        url: `/api/v1/documents/${id}/file?variant=${variant}`,
        headers: s.home.headers,
      });
      expect(file.statusCode).toBe(200);
      expect(file.headers['content-type']).toBe('image/jpeg');
      expect(file.headers['content-disposition']).toMatch(/^inline/u);
      expect((await sharp(file.rawPayload).metadata()).exif).toBeUndefined();
    }
  });

  it('401 bez tokenu; 403 bez nagłówka CSRF', async () => {
    const s = await setup();
    const body = multipart(
      {},
      { filename: 'a.jpg', contentType: 'image/jpeg', bytes: await receiptPhoto() },
    );
    const noToken = await s.app.app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...body.headers, 'x-requested-with': 'fineapp' },
      payload: body.payload,
    });
    expect(noToken.statusCode).toBe(401);
    const noCsrf = await s.app.app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { authorization: s.home.headers.authorization ?? '', ...body.headers },
      payload: body.payload,
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('415 po zawartości (skrypt udający JPG), 413 za duży, 400 bez pliku i z złym rodzajem', async () => {
    const s = await setup({}, { maxBytes: 2000 });
    const fake = await upload(s, Buffer.from('<script>alert(1)</script>'));
    expect(fake.statusCode).toBe(415);
    expect(fake.json()).toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA_TYPE' } });

    const big = await upload(s, Buffer.concat([await receiptPhoto(), Buffer.alloc(4000)]));
    expect(big.statusCode).toBe(413);
    expect(big.json()).toMatchObject({ error: { code: 'FILE_TOO_LARGE' } });

    const body = multipart({ kind: 'receipt' }, null);
    const noFile = await s.app.app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...s.home.headers, ...body.headers },
      payload: body.payload,
    });
    expect(noFile.statusCode).toBe(400);

    const badKind = await upload(s, await receiptPhoto(), { kind: 'other' });
    expect(badKind.statusCode).toBe(400);
    expect(badKind.json()).toMatchObject({ error: { details: [{ path: 'kind' }] } });
  });

  it('409 przy ponownym wrzuceniu tego samego pliku — z identyfikatorem istniejącego', async () => {
    const s = await setup();
    const photo = await receiptPhoto();
    const first = await upload(s, photo);
    await s.jobs.idle();
    const again = await upload(s, photo);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      error: {
        message: 'Ten dokument już jest w systemie.',
        details: [
          { path: 'existingDocumentId', message: first.json<{ data: { id: string } }>().data.id },
        ],
      },
    });
  });

  it('konto z innego gospodarstwa → 404; PDF > 5 stron → 422; PDF do 5 stron idzie w całości', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = await upload(s, await receiptPhoto(), {
      accountId: insertAccount(s.app.db, other),
    });
    expect(foreign.statusCode).toBe(404);

    const body = (pdf: Buffer) =>
      multipart(
        { kind: 'bank_statement' },
        { filename: 'wyciag.pdf', contentType: 'application/pdf', bytes: pdf },
      );
    const tooLong = body(tinyPdf(6));
    const rejected = await s.app.app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...s.home.headers, ...tooLong.headers },
      payload: tooLong.payload,
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({
      error: { message: 'Wyciąg ma więcej niż 5 stron. Podziel plik.' },
    });

    const ok = body(tinyPdf(2));
    const accepted = await s.app.app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...s.home.headers, ...ok.headers },
      payload: ok.payload,
    });
    expect(accepted.statusCode).toBe(202);
    await s.jobs.idle();
    expect(s.extractor.calls[0]).toMatchObject({
      kind: 'bank_statement',
      parts: [{ kind: 'pdf' }],
    });
    // Wyciąg widzi też kategorie przychodu.
    expect(s.extractor.calls[0]?.categories.map((category) => category.id)).toContain(s.salary);

    const file = await s.app.app.inject({
      method: 'GET',
      url: `/api/v1/documents/${accepted.json<{ data: { id: string } }>().data.id}/file`,
      headers: s.home.headers,
    });
    expect(file.headers['content-disposition']).toMatch(/^attachment/u);
    const thumb = await s.app.app.inject({
      method: 'GET',
      url: `/api/v1/documents/${accepted.json<{ data: { id: string } }>().data.id}/file?variant=thumb`,
      headers: s.home.headers,
    });
    expect(thumb.statusCode).toBe(404);
  });

  it('AI wyłączone → 502 z komunikatem, bez zapisu', async () => {
    const s = await setup();
    await harness?.close();
    const app = await buildTestApp({ uploads: { dir: s.dir, maxBytes: 10_485_760 } }, s.clock);
    harness = app;
    const home = await householdFixture(app.db, testConfig(), START);
    const body = multipart(
      {},
      { filename: 'a.jpg', contentType: 'image/jpeg', bytes: await receiptPhoto() },
    );
    const response = await app.app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...home.headers, ...body.headers },
      payload: body.payload,
    });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { message: 'Odczyt dokumentów jest wyłączony. Dodaj wydatek ręcznie.' },
    });
    expect(app.db.db.select().from(documents).all()).toHaveLength(0);
  });
});

describe('analiza — błędy i koszty', () => {
  it('odrzucony odczyt → failed z kodem; koszt liczy się do limitu', async () => {
    const s = await setup();
    s.extractor.push({
      error: new ExtractionError(
        'AI_SCHEMA_MISMATCH',
        'Nie udało się odczytać dokumentu. Spróbuj ponownie.',
        {
          usage: { inputTokens: 2000, outputTokens: 500 },
          rawResponse: '{"zly":1}',
        },
      ),
    });
    const response = await upload(s, await receiptPhoto());
    await s.jobs.idle();
    const doc = await getDoc(s, response.json<{ data: { id: string } }>().data.id);
    expect(doc).toMatchObject({
      status: 'failed',
      errorCode: 'AI_SCHEMA_MISMATCH',
      errorMessage: 'Nie udało się odczytać dokumentu. Spróbuj ponownie.',
      ai: { costMinor: 4 },
    });
    const row = s.app.db.db.select().from(documents).where(eq(documents.id, doc.id)).get();
    expect(row?.aiRawResponse).toBe('{"zly":1}');

    const usage = await s.app.app.inject({
      method: 'GET',
      url: '/api/v1/settings/ai-usage',
      headers: s.home.headers,
    });
    expect(usage.json()).toMatchObject({
      data: {
        enabled: true,
        monthKey: '2026-09',
        spentMinor: 4,
        budgetMinor: 5000,
        remainingMinor: 4996,
        documentCount: 1,
        inputTokens: 2000,
      },
    });
  });

  it('nieoczekiwany błąd → failed INTERNAL_ERROR, bez kosztu', async () => {
    const s = await setup();
    s.extractor.push({ error: new Error('bum') });
    const response = await upload(s, await receiptPhoto());
    await s.jobs.idle();
    expect(await getDoc(s, response.json<{ data: { id: string } }>().data.id)).toMatchObject({
      status: 'failed',
      errorCode: 'INTERNAL_ERROR',
      ai: null,
    });
  });

  it('wyczerpany limit → 402, dokument zostaje (failed) i da się go przeanalizować po zmianie limitu', async () => {
    const s = await setup({ monthlyBudgetMinor: 4 });
    const first = await upload(s, await receiptPhoto('#fff'));
    expect(first.statusCode).toBe(202);
    await s.jobs.idle();

    const second = await upload(s, await receiptPhoto('#eee'));
    expect(second.statusCode).toBe(402);
    expect(second.json()).toMatchObject({
      error: { code: 'AI_BUDGET_EXCEEDED', details: [{ path: 'documentId' }] },
    });
    const kept =
      second.json<{ error: { details: { message: string }[] } }>().error.details[0]?.message ?? '';
    expect(await getDoc(s, kept)).toMatchObject({
      status: 'failed',
      errorCode: 'AI_BUDGET_EXCEEDED',
    });

    const retry = await s.app.app.inject({
      method: 'POST',
      url: `/api/v1/documents/${kept}/analyze`,
      headers: s.home.headers,
    });
    expect(retry.statusCode).toBe(402);
    expect(s.extractor.calls).toHaveLength(1);
  });

  it('ponowna analiza zastępuje pozycje; 409 podczas analizy; limit 5 na godzinę', async () => {
    const s = await setup();
    scriptLidl(s);
    const response = await upload(s, await receiptPhoto());
    const id = response.json<{ data: { id: string } }>().data.id;
    const during = await s.app.app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/analyze`,
      headers: s.home.headers,
    });
    expect(during.statusCode).toBe(409);
    await s.jobs.idle();

    s.extractor.push({ items: [extractedItem({ description: 'Chleb', amountMinor: 420 })] });
    const again = await s.app.app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/analyze`,
      headers: s.home.headers,
    });
    expect(again.statusCode).toBe(202);
    await s.jobs.idle();
    expect((await getDoc(s, id)).items.map((item) => item.description)).toEqual(['Chleb']);

    const codes: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const next = await s.app.app.inject({
        method: 'POST',
        url: `/api/v1/documents/${id}/analyze`,
        headers: s.home.headers,
      });
      codes.push(next.statusCode);
      await s.jobs.idle();
    }
    // 409 z pierwszej próby też zużyło limit: próby 1–5 przechodzą, 6. i dalsze — 429.
    expect(codes).toEqual([202, 202, 202, 429, 429]);
  });

  it('przerwana analiza (restart) → failed „Przerwano"', async () => {
    const s = await setup();
    const response = await upload(s, await receiptPhoto());
    const id = response.json<{ data: { id: string } }>().data.id;
    await s.jobs.idle();
    s.app.db.db
      .update(documents)
      .set({ status: 'processing', updatedAt: START.getTime() })
      .where(eq(documents.id, id))
      .run();
    // Obraca się tylko to, co w `processing` dłużej niż 10 minut.
    expect(failInterruptedDocuments(s.app.db, s.clock)).toBe(0);
    s.clock.advance(STALE_PROCESSING_MS + 1);
    expect(failInterruptedDocuments(s.app.db, s.clock)).toBe(1);
    expect(await getDoc(s, id)).toMatchObject({
      status: 'failed',
      errorCode: 'INTERRUPTED',
      errorMessage: 'Przerwano — spróbuj ponownie.',
    });
  });
});

describe('wyciąg — duplikaty (08 §10)', () => {
  it('pozycja zbieżna z wpisem ręcznym ma plakietkę i jest domyślnie odznaczona', async () => {
    const s = await setup();
    const manual = insertTransaction(s.app.db, s.home, {
      accountId: s.ror,
      bookedOn: '2026-09-09',
      amountMinor: 4999,
    });
    s.extractor.push({
      items: [
        extractedItem({ description: 'Netflix', amountMinor: 4999, bookedOn: '2026-09-11' }),
        extractedItem({ description: 'Netflix', amountMinor: 4999, bookedOn: '2026-10-11' }),
        extractedItem({
          description: 'Pensja',
          amountMinor: 850_000,
          direction: 'inflow',
          bookedOn: '2026-09-10',
          categoryId: s.salary,
        }),
      ],
    });
    const body = multipart(
      { kind: 'bank_statement', accountId: s.ror },
      { filename: 'w.pdf', contentType: 'application/pdf', bytes: tinyPdf(1) },
    );
    const response = await s.app.app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...s.home.headers, ...body.headers },
      payload: body.payload,
    });
    await s.jobs.idle();
    const doc = await getDoc(s, response.json<{ data: { id: string } }>().data.id);
    expect(doc.items.map((item) => [item.duplicateOfTransactionId, item.reviewStatus])).toEqual([
      [manual, 'rejected'],
      [null, 'pending'],
      [null, 'pending'],
    ]);
  });
});

describe('korekty i commit', () => {
  /**
   * Paragon Lidla po analizie.
   *
   * @returns Środowisko i dokument.
   */
  async function parsedLidl(): Promise<{ s: Setup; doc: DocumentBody }> {
    const s = await setup();
    scriptLidl(s);
    return { s, doc: await uploadAndParse(s, await receiptPhoto(), { accountId: s.ror }) };
  }

  /**
   * Wysyła commit.
   *
   * @param s - Środowisko.
   * @param id - Dokument.
   * @param body - Ciało.
   * @param key - Klucz idempotencji; `null` — bez nagłówka.
   * @returns Odpowiedź.
   */
  function commit(
    s: Setup,
    id: string,
    body: Record<string, unknown>,
    key: string | null = KEY,
  ): Promise<LightMyRequestResponse> {
    return s.app.app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/commit`,
      headers: { ...s.home.headers, ...(key === null ? {} : { 'idempotency-key': key }) },
      payload: body,
    });
  }

  it('single: jedna transakcja na sumę netto zaznaczonych, source=ocr z odnośnikiem', async () => {
    const { s, doc } = await parsedLidl();
    const [milk, powder, batteries, discount] = doc.items;
    const response = await commit(s, doc.id, {
      mode: 'single',
      accountId: s.ror,
      bookedOn: '2026-09-18',
      categoryId: s.groceries,
      itemIds: [milk?.id, powder?.id, discount?.id],
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{
      data: {
        document: DocumentBody;
        transactions: {
          id: string;
          amountMinor: number;
          source: string;
          sourceDocumentId: string;
          description: string;
        }[];
      };
      meta: { affectedMonths: string[] };
    }>();
    expect(body.data.transactions).toHaveLength(1);
    expect(body.data.transactions[0]).toMatchObject({
      amountMinor: 698 + 2499 - 300,
      source: 'ocr',
      sourceDocumentId: doc.id,
      description: 'Lidl',
    });
    expect(body.meta.affectedMonths).toEqual(['2026-09']);
    expect(body.data.document.status).toBe('committed');
    const txId = body.data.transactions[0]?.id;
    expect(body.data.document.items.map((item) => [item.reviewStatus, item.transactionId])).toEqual(
      [
        ['accepted', txId],
        ['accepted', txId],
        ['rejected', null],
        ['accepted', txId],
      ],
    );
    expect(batteries).toBeDefined();

    // Powtórka z tym samym kluczem — pierwsza odpowiedź, bez drugiej transakcji.
    const replay = await commit(s, doc.id, {
      mode: 'single',
      accountId: s.ror,
      bookedOn: '2026-09-18',
      categoryId: s.groceries,
      itemIds: [milk?.id, powder?.id, discount?.id],
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(s.app.db.db.select().from(transactions).all()).toHaveLength(1);

    // Inny klucz na zatwierdzonym dokumencie — 409.
    const second = await commit(
      s,
      doc.id,
      { mode: 'split', accountId: s.ror, bookedOn: '2026-09-18', itemIds: [milk?.id] },
      'inny-klucz-123',
    );
    expect(second.statusCode).toBe(409);
  });

  it('split z nową kategorią: propozycja trafia do pozycji, rabat to przychód bez kategorii wydatku', async () => {
    const { s, doc } = await parsedLidl();
    const response = await commit(s, doc.id, {
      mode: 'split',
      accountId: s.ror,
      bookedOn: '2026-09-18',
      itemIds: doc.items.map((item) => item.id),
      createCategories: [{ name: 'Elektronika', kind: 'expense' }],
    });
    expect(response.statusCode).toBe(201);
    const created = s.app.db.db
      .select()
      .from(categories)
      .where(eq(categories.name, 'Elektronika'))
      .get();
    expect(created).toBeDefined();
    const rows = response.json<{
      data: {
        transactions: {
          type: string;
          amountMinor: number;
          categoryId: string | null;
          description: string;
        }[];
      };
    }>().data.transactions;
    expect(rows.map((row) => [row.type, row.amountMinor, row.categoryId, row.description])).toEqual(
      [
        ['expense', 698, s.groceries, 'Mleko'],
        ['expense', 2499, s.groceries, 'Proszek'],
        ['expense', 450, created?.id, 'Baterie AA'],
        ['income', 300, null, 'Rabat'],
      ],
    );
  });

  it('by_category: jedna transakcja na kategorię, rabat bez kategorii w dominującej (ADR-069)', async () => {
    const { s, doc } = await parsedLidl();
    const response = await commit(s, doc.id, {
      mode: 'by_category',
      accountId: s.ror,
      bookedOn: '2026-09-18',
      itemIds: doc.items.map((item) => item.id),
      createCategories: [{ name: 'Elektronika', kind: 'expense' }],
    });
    expect(response.statusCode, response.body).toBe(201);
    const created = s.app.db.db
      .select()
      .from(categories)
      .where(eq(categories.name, 'Elektronika'))
      .get();
    const body = response.json<{
      data: {
        document: DocumentBody;
        transactions: {
          id: string;
          type: string;
          amountMinor: number;
          categoryId: string | null;
          description: string;
          notes: string | null;
          source: string;
          sourceDocumentId: string;
        }[];
      };
    }>().data;
    expect(
      body.transactions.map((row) => [
        row.type,
        row.amountMinor,
        row.categoryId,
        row.description,
        row.notes,
      ]),
    ).toEqual([
      ['expense', 698 + 2499 - 300, s.groceries, 'Lidl', 'Mleko, Proszek, Rabat'],
      ['expense', 450, created?.id, 'Lidl', 'Baterie AA'],
    ]);
    expect(body.transactions.every((row) => row.sourceDocumentId === doc.id)).toBe(true);
    const [food, electronics] = body.transactions.map((row) => row.id);
    expect(body.document.items.map((item) => item.transactionId)).toEqual([
      food,
      food,
      electronics,
      food,
    ]);
  });

  it('by_category: bez przyjętej propozycji pozycja idzie do dominującej; suma ≤ 0 → 422', async () => {
    const { s, doc } = await parsedLidl();
    const ids = doc.items.map((item) => item.id);
    const rejected = await commit(s, doc.id, {
      mode: 'by_category',
      accountId: s.ror,
      bookedOn: '2026-09-18',
      itemIds: [ids[3]],
    });
    expect(rejected.statusCode).toBe(422);

    const response = await commit(
      s,
      doc.id,
      { mode: 'by_category', accountId: s.ror, bookedOn: '2026-09-18', itemIds: ids },
      'klucz-5-abcdef',
    );
    expect(response.statusCode).toBe(201);
    const rows = response.json<{
      data: { transactions: { amountMinor: number; categoryId: string | null }[] };
    }>().data.transactions;
    expect(rows.map((row) => [row.amountMinor, row.categoryId])).toEqual([
      [698 + 2499 + 450 - 300, s.groceries],
    ]);
  });

  it('wszystko albo nic: data poza oknem księgowania wycofuje także nową kategorię', async () => {
    const { s, doc } = await parsedLidl();
    const response = await commit(s, doc.id, {
      mode: 'split',
      accountId: s.ror,
      bookedOn: '2020-01-01',
      itemIds: [doc.items[2]?.id],
      createCategories: [{ name: 'Elektronika', kind: 'expense' }],
    });
    expect(response.statusCode).toBe(422);
    expect(
      s.app.db.db.select().from(categories).where(eq(categories.name, 'Elektronika')).get(),
    ).toBeUndefined();
    expect(s.app.db.db.select().from(transactions).all()).toHaveLength(0);
    expect((await getDoc(s, doc.id)).status).toBe('parsed');
  });

  it('single: nowa kategoria po nazwie; bez niej 422; suma ≤ 0 → 422; obca pozycja → 422; brak klucza → 400', async () => {
    const { s, doc } = await parsedLidl();
    const ids = doc.items.map((item) => item.id);
    const base = { mode: 'single', accountId: s.ror, bookedOn: '2026-09-18' };
    expect(
      (await commit(s, doc.id, { ...base, categoryName: 'Chemia', itemIds: ids })).statusCode,
    ).toBe(422);
    expect(
      (
        await commit(
          s,
          doc.id,
          { ...base, categoryId: s.groceries, itemIds: [ids[3]] },
          'klucz-2-abcdef',
        )
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await commit(
          s,
          doc.id,
          { ...base, categoryId: s.groceries, itemIds: ['01JP7K3M2N8Q4R5S6T7V8W9X0A'] },
          'klucz-3-abcdef',
        )
      ).statusCode,
    ).toBe(422);
    expect(
      (await commit(s, doc.id, { ...base, categoryId: s.groceries, itemIds: ids }, null))
        .statusCode,
    ).toBe(400);

    const ok = await commit(
      s,
      doc.id,
      {
        ...base,
        categoryName: 'Chemia',
        createCategories: [{ name: 'Chemia', kind: 'expense' }],
        itemIds: ids,
      },
      'klucz-4-abcdef',
    );
    expect(ok.statusCode).toBe(201);
  });

  it('PATCH pozycji: kategoria musi pasować do kierunku; wybór kategorii kończy propozycję', async () => {
    const { s, doc } = await parsedLidl();
    const batteries = doc.items[2];
    const patch = (payload: Record<string, unknown>, itemId = batteries?.id) =>
      s.app.app.inject({
        method: 'PATCH',
        url: `/api/v1/documents/${doc.id}/items/${itemId ?? ''}`,
        headers: s.home.headers,
        payload,
      });
    expect((await patch({ suggestedCategoryId: s.salary })).statusCode).toBe(422);
    const ok = await patch({
      suggestedCategoryId: s.groceries,
      amountMinor: 500,
      reviewStatus: 'accepted',
    });
    expect(ok.statusCode).toBe(200);
    const updated = ok.json<{ data: DocumentBody }>().data;
    expect(updated.items[2]).toMatchObject({
      suggestedCategoryId: s.groceries,
      suggestedCategoryName: null,
      amountMinor: 500,
      reviewStatus: 'accepted',
    });
    expect(updated.newCategoryProposals).toEqual([]);
    expect((await patch({ description: 'x' }, '01JP7K3M2N8Q4R5S6T7V8W9X0A')).statusCode).toBe(404);
  });

  it('PATCH nagłówka: sprzedawca, data (miesiąc dokumentu), konto', async () => {
    const { s, doc } = await parsedLidl();
    const response = await s.app.app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${doc.id}`,
      headers: s.home.headers,
      payload: { merchant: 'Lidl Mokotów', bookedOn: '2026-08-31', accountId: null },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: DocumentBody }>().data).toMatchObject({
      summary: { merchant: 'Lidl Mokotów', bookedOn: '2026-08-31', detectedMonthKey: '2026-08' },
      suggestedAccountId: null,
    });
    const list = await s.app.app.inject({
      method: 'GET',
      url: '/api/v1/documents?month=2026-08',
      headers: s.home.headers,
    });
    expect(list.json()).toMatchObject({
      data: [{ id: doc.id, merchant: 'Lidl Mokotów', totalMinor: 3347, itemCount: 4 }],
    });
  });

  it('discard, delete z plikiem, izolacja gospodarstw', async () => {
    const { s, doc } = await parsedLidl();
    const other = await householdFixture(s.app.db, testConfig(), START);
    for (const url of [`/api/v1/documents/${doc.id}`, `/api/v1/documents/${doc.id}/file`]) {
      const response = await s.app.app.inject({ method: 'GET', url, headers: other.headers });
      expect(response.statusCode).toBe(404);
    }

    const discarded = await s.app.app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/discard`,
      headers: s.home.headers,
    });
    expect(discarded.json<{ data: DocumentBody }>().data).toMatchObject({ status: 'discarded' });
    expect(
      discarded
        .json<{ data: DocumentBody }>()
        .data.items.every((item) => item.reviewStatus === 'rejected'),
    ).toBe(true);

    const removed = await s.app.app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${doc.id}`,
      headers: s.home.headers,
    });
    expect(removed.statusCode).toBe(204);
    expect(readdirSync(join(s.dir, '2026', '09'))).toEqual([]);
    const gone = await s.app.app.inject({
      method: 'GET',
      url: `/api/v1/documents/${doc.id}`,
      headers: s.home.headers,
    });
    expect(gone.statusCode).toBe(404);
  });
});
