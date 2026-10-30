import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  CSRF_HEADER,
  householdFixture,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';

/**
 * Testy tras źródeł przychodu — zadanie `F2-4`
 * ([04 §12](../../../../../../plans/04-api-spec.md#12-źródła-przychodu--apiv1income-sources)).
 */

/** Źródło w kształcie odpowiedzi. */
interface SourceBody {
  id: string;
  name: string;
  kind: string;
  ownerUserId: string | null;
  countsTowardAllocation: boolean;
  isArchived: boolean;
  sortOrder: number;
}

/** Kształt odpowiedzi błędu. */
interface ErrorBody {
  error: { code: string; message: string };
}

const START = new Date('2026-09-23T10:00:00.000Z');
const BASE = '/api/v1/income-sources';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Aplikacja z gospodarstwem. */
interface Setup {
  app: TestApp;
  home: HouseholdFixture;
}

/**
 * Buduje aplikację z gospodarstwem.
 *
 * @returns Aplikacja i gospodarstwo.
 */
async function setup(): Promise<Setup> {
  const app = await buildTestApp({}, mutableClock(START));
  harness = app;
  return { app, home: await householdFixture(app.db, testConfig(), START) };
}

/**
 * Wysyła żądanie w imieniu gospodarstwa.
 *
 * @param s - Aplikacja.
 * @param method - Metoda HTTP.
 * @param url - Ścieżka względem `/api/v1/income-sources`.
 * @param payload - Ciało.
 * @param home - Gospodarstwo.
 * @returns Odpowiedź.
 */
function call(
  s: Setup,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
  home: HouseholdFixture = s.home,
): Promise<LightMyRequestResponse> {
  return s.app.app.inject({
    method,
    url: `${BASE}${url}`,
    headers: home.headers,
    ...(payload === undefined ? {} : { payload }),
  });
}

/**
 * Zakłada źródło i zwraca je.
 *
 * @param s - Aplikacja.
 * @param body - Pola nadpisujące minimalne źródło.
 * @param home - Gospodarstwo.
 * @returns Źródło.
 */
async function create(
  s: Setup,
  body: Record<string, unknown> = {},
  home: HouseholdFixture = s.home,
): Promise<SourceBody> {
  const response = await call(s, 'POST', '', { name: 'Pensja', kind: 'salary', ...body }, home);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: SourceBody }>().data;
}

/**
 * Zwraca listę źródeł.
 *
 * @param s - Aplikacja.
 * @param query - Ciąg zapytania.
 * @returns Źródła.
 */
async function list(s: Setup, query = ''): Promise<SourceBody[]> {
  return (await call(s, 'GET', query)).json<{ data: SourceBody[] }>().data;
}

describe('uwierzytelnienie', () => {
  it('każda trasa bez tokenu daje 401', async () => {
    const s = await setup();
    const id = '01J9ZQK8WQ0000000000000000';
    const routes: ['GET' | 'POST' | 'PATCH' | 'DELETE', string][] = [
      ['GET', ''],
      ['POST', ''],
      ['PATCH', `/${id}`],
      ['POST', `/${id}/archive`],
      ['POST', `/${id}/unarchive`],
      ['DELETE', `/${id}`],
    ];
    for (const [method, url] of routes) {
      const response = await s.app.app.inject({
        method,
        url: `${BASE}${url}`,
        headers: CSRF_HEADER,
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('POST /income-sources', () => {
  it('zakłada źródło na końcu listy, z Location i właścicielem', async () => {
    const s = await setup();
    await create(s, { name: 'Premia', kind: 'salary' });
    const response = await call(s, 'POST', '', {
      name: 'Działalność',
      kind: 'business',
      ownerUserId: s.home.userId,
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ data: SourceBody }>().data;
    expect(response.headers.location).toBe(`${BASE}/${body.id}`);
    expect(body).toMatchObject({
      ownerUserId: s.home.userId,
      countsTowardAllocation: true,
      sortOrder: 1,
    });
  });

  it('zwrot podatku domyślnie nie wchodzi do podstawy; jawna wartość wygrywa', async () => {
    const s = await setup();
    expect((await create(s, { name: 'Zwrot PIT', kind: 'refund' })).countsTowardAllocation).toBe(
      false,
    );
    expect(
      (await create(s, { name: 'Zwrot VAT', kind: 'refund', countsTowardAllocation: true }))
        .countsTowardAllocation,
    ).toBe(true);
    expect(
      (await create(s, { name: 'Sprzedaż', kind: 'sale', countsTowardAllocation: false }))
        .countsTowardAllocation,
    ).toBe(false);
  });

  it('właściciel z innego gospodarstwa — 404', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const response = await call(s, 'POST', '', {
      name: 'Cudza pensja',
      kind: 'salary',
      ownerUserId: other.userId,
    });
    expect(response.statusCode).toBe(404);
  });

  it('nazwa zajęta bez względu na wielkość liter — 409; w archiwum z podpowiedzią', async () => {
    const s = await setup();
    const old = await create(s, { name: 'Wynajem', kind: 'rental' });
    expect((await call(s, 'POST', '', { name: 'wynajem', kind: 'rental' })).statusCode).toBe(409);

    await call(s, 'POST', `/${old.id}/archive`);
    const response = await call(s, 'POST', '', { name: 'WYNAJEM', kind: 'rental' });
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.message).toContain('przywróć');
  });

  it('ta sama nazwa w innym gospodarstwie jest dozwolona', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    await create(s);
    await create(s, {}, other);
    expect(await list(s)).toHaveLength(1);
  });
});

describe('PATCH /income-sources/:id', () => {
  it('zmienia przysłane pola; zmiana rodzaju nie rusza flagi podstawy', async () => {
    const s = await setup();
    const source = await create(s);
    const response = await call(s, 'PATCH', `/${source.id}`, {
      name: 'Zwrot',
      kind: 'refund',
      ownerUserId: s.home.userId,
    });
    expect(response.json<{ data: SourceBody }>().data).toMatchObject({
      name: 'Zwrot',
      kind: 'refund',
      ownerUserId: s.home.userId,
      countsTowardAllocation: true,
    });
  });

  it('flaga podstawy i właściciel null', async () => {
    const s = await setup();
    const source = await create(s, { ownerUserId: s.home.userId });
    const updated = (
      await call(s, 'PATCH', `/${source.id}`, { countsTowardAllocation: false, ownerUserId: null })
    ).json<{ data: SourceBody }>().data;
    expect(updated).toMatchObject({ countsTowardAllocation: false, ownerUserId: null });
  });

  it('puste PATCH i zmiana wielkości liter własnej nazwy działają', async () => {
    const s = await setup();
    const source = await create(s, { name: 'pensja' });
    expect((await call(s, 'PATCH', `/${source.id}`, {})).statusCode).toBe(200);
    expect(
      (await call(s, 'PATCH', `/${source.id}`, { name: 'Pensja' })).json<{ data: SourceBody }>()
        .data.name,
    ).toBe('Pensja');
  });

  it('nazwa zajęta przez inne źródło — 409; obcy właściciel — 404', async () => {
    const s = await setup();
    await create(s, { name: 'Premia' });
    const source = await create(s);
    expect((await call(s, 'PATCH', `/${source.id}`, { name: 'premia' })).statusCode).toBe(409);
    const other = await householdFixture(s.app.db, testConfig(), START);
    expect(
      (await call(s, 'PATCH', `/${source.id}`, { ownerUserId: other.userId })).statusCode,
    ).toBe(404);
  });

  it('źródło innego gospodarstwa — 404', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = await create(s, {}, other);
    expect((await call(s, 'PATCH', `/${foreign.id}`, { name: 'X' })).statusCode).toBe(404);
  });
});

describe('archiwizacja', () => {
  it('ukrywa z listy domyślnej, jest idempotentna i odwracalna', async () => {
    const s = await setup();
    const source = await create(s);
    await call(s, 'POST', `/${source.id}/archive`);
    const again = await call(s, 'POST', `/${source.id}/archive`);
    expect(again.json<{ data: SourceBody }>().data.isArchived).toBe(true);
    expect(await list(s)).toEqual([]);
    expect(await list(s, '?includeArchived=true')).toHaveLength(1);

    await call(s, 'POST', `/${source.id}/unarchive`);
    expect(await list(s)).toHaveLength(1);
  });

  it('źródło innego gospodarstwa — 404', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = await create(s, {}, other);
    expect((await call(s, 'POST', `/${foreign.id}/archive`)).statusCode).toBe(404);
  });
});

describe('DELETE /income-sources/:id', () => {
  it('usuwa źródło bez przychodów — 204', async () => {
    const s = await setup();
    const source = await create(s);
    expect((await call(s, 'DELETE', `/${source.id}`)).statusCode).toBe(204);
    expect(await list(s, '?includeArchived=true')).toEqual([]);
  });

  it('źródło z przychodem, także w koszu — 409 (I-10)', async () => {
    const s = await setup();
    const used = await create(s, { name: 'Używane' });
    insertTransaction(s.app.db, s.home, { type: 'income', incomeSourceId: used.id });
    const response = await call(s, 'DELETE', `/${used.id}`);
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.message).toContain('zarchiwizować');

    const binned = await create(s, { name: 'W koszu' });
    insertTransaction(s.app.db, s.home, {
      type: 'income',
      incomeSourceId: binned.id,
      deletedAt: START.getTime(),
    });
    expect((await call(s, 'DELETE', `/${binned.id}`)).statusCode).toBe(409);
  });

  it('źródło innego gospodarstwa — 404', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = await create(s, {}, other);
    expect((await call(s, 'DELETE', `/${foreign.id}`)).statusCode).toBe(404);
  });
});
