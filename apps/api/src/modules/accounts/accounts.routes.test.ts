import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  CSRF_HEADER,
  householdFixture,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock, type MutableClock } from '../../core/clock.js';

/**
 * Testy tras kont — zadanie `F2-1`
 * ([04 §5](../../../../../../plans/04-api-spec.md#5-konta--apiv1accounts)).
 *
 * Trasy idą przez prawdziwą bazę `:memory:` z migracjami, więc te same testy pilnują
 * reguł serwisu (klasa z typu, kolejność, I-10) i zakresu gospodarstwa.
 */

/** Konto w kształcie odpowiedzi. */
interface AccountBody {
  id: string;
  name: string;
  type: string;
  allocationClass: string;
  openingBalanceMinor: number;
  institution: string | null;
  color: string | null;
  includeInNetWorth: boolean;
  sortOrder: number;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Kształt odpowiedzi błędu. */
interface ErrorBody {
  error: { code: string; message: string; details?: { path: string }[] };
}

const START = new Date('2026-09-23T10:00:00.000Z');
const BASE = '/api/v1/accounts';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Aplikacja z jednym gospodarstwem i zegarem sterowanym przez test. */
interface Setup {
  app: TestApp;
  clock: MutableClock;
  home: HouseholdFixture;
}

/**
 * Buduje aplikację z jednym gospodarstwem.
 *
 * @returns Aplikacja, zegar i gospodarstwo z nagłówkami.
 */
async function setup(): Promise<Setup> {
  const clock = mutableClock(START);
  const app = await buildTestApp({}, clock);
  harness = app;
  const home = await householdFixture(app.db, testConfig(), START);
  return { app, clock, home };
}

/**
 * Wysyła żądanie w imieniu gospodarstwa.
 *
 * @param s - Aplikacja i gospodarstwo.
 * @param method - Metoda HTTP.
 * @param url - Ścieżka względem `/api/v1/accounts`.
 * @param payload - Ciało żądania.
 * @param home - Gospodarstwo, w imieniu którego idzie żądanie.
 * @returns Odpowiedź Fastify.
 */
function call(
  s: Setup,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  home: HouseholdFixture = s.home,
): Promise<LightMyRequestResponse> {
  return s.app.app.inject({
    method,
    url: `${BASE}${url}`,
    headers: home.headers,
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

/**
 * Zakłada konto i zwraca je z odpowiedzi.
 *
 * @param s - Aplikacja i gospodarstwo.
 * @param body - Pola nadpisujące minimalne konto.
 * @returns Założone konto.
 */
async function create(s: Setup, body: Record<string, unknown> = {}): Promise<AccountBody> {
  const response = await call(s, 'POST', '', {
    name: 'ROR',
    type: 'checking',
    openingBalanceOn: '2026-09-01',
    ...body,
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: AccountBody }>().data;
}

/**
 * Zwraca listę kont.
 *
 * @param s - Aplikacja i gospodarstwo.
 * @param query - Ciąg zapytania.
 * @returns Konta w kolejności odpowiedzi.
 */
async function list(s: Setup, query = ''): Promise<AccountBody[]> {
  const response = await call(s, 'GET', query);
  expect(response.statusCode).toBe(200);
  return response.json<{ data: AccountBody[] }>().data;
}

describe('uwierzytelnienie', () => {
  it('każda trasa bez tokenu daje 401', async () => {
    const s = await setup();
    const id = '01J9ZQK8WQ0000000000000000';
    const routes: ['GET' | 'POST' | 'PATCH' | 'DELETE', string][] = [
      ['GET', ''],
      ['POST', ''],
      ['PATCH', '/order'],
      ['GET', `/${id}`],
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

describe('POST /accounts', () => {
  it('zakłada konto, zwraca 201 z nagłówkiem Location i klasą z typu', async () => {
    const s = await setup();
    const response = await call(s, 'POST', '', {
      name: 'Konto mieszkaniowe',
      type: 'savings',
      openingBalanceMinor: 1_250_000,
      openingBalanceOn: '2026-09-01',
      institution: 'mBank',
    });

    expect(response.statusCode).toBe(201);
    const account = response.json<{ data: AccountBody }>().data;
    expect(response.headers.location).toBe(`${BASE}/${account.id}`);
    expect(account).toMatchObject({
      name: 'Konto mieszkaniowe',
      type: 'savings',
      allocationClass: 'savings',
      openingBalanceMinor: 1_250_000,
      institution: 'mBank',
      color: null,
      includeInNetWorth: true,
      isArchived: false,
      createdAt: START.getTime(),
    });
    // Pole spoza kontraktu nie wychodzi na zewnątrz.
    expect(account).not.toHaveProperty('householdId');
  });

  it('respektuje nadpisaną klasę alokacji', async () => {
    const s = await setup();
    const account = await create(s, {
      name: 'Poduszka',
      type: 'checking',
      allocationClass: 'savings',
    });
    expect(account.allocationClass).toBe('savings');
  });

  it('dopisuje kolejne konta na koniec listy', async () => {
    const s = await setup();
    const first = await create(s, { name: 'A' });
    const second = await create(s, { name: 'B' });
    expect([first.sortOrder, second.sortOrder]).toEqual([0, 1]);
  });

  it('ignoruje householdId przysłane w ciele', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    await create(s, { householdId: other.householdId });

    expect(await list(s)).toHaveLength(1);
    expect(await list({ ...s, home: other })).toHaveLength(0);
  });

  it('odrzuca błędne dane z 400 i ścieżkami pól', async () => {
    const s = await setup();
    const response = await call(s, 'POST', '', {
      name: '',
      type: 'wallet',
      openingBalanceMinor: 1.5,
      openingBalanceOn: '2026-02-30',
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<ErrorBody>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.map((detail) => detail.path)).toEqual(
      expect.arrayContaining(['name', 'type', 'openingBalanceMinor', 'openingBalanceOn']),
    );
  });
});

describe('GET /accounts', () => {
  it('domyślnie pomija zarchiwizowane, na życzenie je dołącza', async () => {
    const s = await setup();
    await create(s, { name: 'Aktywne' });
    const archived = await create(s, { name: 'Stare' });
    await call(s, 'POST', `/${archived.id}/archive`);

    expect((await list(s)).map((a) => a.name)).toEqual(['Aktywne']);
    expect((await list(s, '?includeArchived=false')).map((a) => a.name)).toEqual(['Aktywne']);
    expect((await list(s, '?includeArchived=true')).map((a) => a.name)).toEqual([
      'Aktywne',
      'Stare',
    ]);
  });

  it('odrzuca nieznaną wartość includeArchived', async () => {
    const s = await setup();
    expect((await call(s, 'GET', '?includeArchived=yes')).statusCode).toBe(400);
  });
});

describe('GET /accounts/:id', () => {
  it('zwraca konto', async () => {
    const s = await setup();
    const account = await create(s);
    const response = await call(s, 'GET', `/${account.id}`);
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: AccountBody }>().data.id).toBe(account.id);
  });

  it('konto innego gospodarstwa daje 404, nie 403', async () => {
    const s = await setup();
    const account = await create(s);
    const other = await householdFixture(s.app.db, testConfig(), START);

    const response = await call(s, 'GET', `/${account.id}`, undefined, other);
    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.message).toBe('Nie znaleziono konta.');
  });

  it('niepoprawny identyfikator daje 400', async () => {
    const s = await setup();
    expect((await call(s, 'GET', '/nie-ulid')).statusCode).toBe(400);
  });
});

describe('PATCH /accounts/:id', () => {
  it('zmienia wyłącznie przysłane pola i odświeża updatedAt', async () => {
    const s = await setup();
    const account = await create(s, { institution: 'mBank', openingBalanceMinor: 500 });
    s.clock.advance(60_000);

    const response = await call(s, 'PATCH', `/${account.id}`, { name: 'ROR wspólny' });
    expect(response.statusCode).toBe(200);
    const updated = response.json<{ data: AccountBody }>().data;
    expect(updated).toMatchObject({
      name: 'ROR wspólny',
      institution: 'mBank',
      openingBalanceMinor: 500,
      includeInNetWorth: true,
      updatedAt: START.getTime() + 60_000,
    });
  });

  it('zmienia wszystkie pola naraz', async () => {
    const s = await setup();
    const account = await create(s);
    const response = await call(s, 'PATCH', `/${account.id}`, {
      name: 'IKE',
      type: 'investment',
      openingBalanceMinor: 1_800_000,
      openingBalanceOn: '2026-01-01',
      institution: 'XTB',
      color: '#0ea5e9',
      icon: 'chart',
      includeInNetWorth: false,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: AccountBody }>().data).toMatchObject({
      name: 'IKE',
      type: 'investment',
      allocationClass: 'investment',
      openingBalanceMinor: 1_800_000,
      institution: 'XTB',
      color: '#0ea5e9',
      includeInNetWorth: false,
    });
  });

  it('null czyści pole opcjonalne', async () => {
    const s = await setup();
    const account = await create(s, { institution: 'mBank', color: '#22c55e' });
    const updated = (await call(s, 'PATCH', `/${account.id}`, { institution: null })).json<{
      data: AccountBody;
    }>().data;
    expect(updated.institution).toBeNull();
    expect(updated.color).toBe('#22c55e');
  });

  it('puste PATCH niczego nie zmienia, łącznie z updatedAt', async () => {
    const s = await setup();
    const account = await create(s);
    s.clock.advance(60_000);
    const response = await call(s, 'PATCH', `/${account.id}`, {});
    expect(response.json<{ data: AccountBody }>().data.updatedAt).toBe(account.updatedAt);
  });

  it('zmiana typu przelicza klasę, która nie była nadpisana', async () => {
    const s = await setup();
    const account = await create(s, { type: 'checking' });
    const updated = (await call(s, 'PATCH', `/${account.id}`, { type: 'investment' })).json<{
      data: AccountBody;
    }>().data;
    expect(updated.allocationClass).toBe('investment');
  });

  it('zmiana typu nie cofa nadpisanej klasy', async () => {
    const s = await setup();
    const account = await create(s, { type: 'checking', allocationClass: 'savings' });
    const updated = (await call(s, 'PATCH', `/${account.id}`, { type: 'cash' })).json<{
      data: AccountBody;
    }>().data;
    expect(updated.allocationClass).toBe('savings');
  });

  it('jawna klasa w tym samym żądaniu wygrywa z przeliczeniem', async () => {
    const s = await setup();
    const account = await create(s, { type: 'checking' });
    const updated = (
      await call(s, 'PATCH', `/${account.id}`, { type: 'savings', allocationClass: 'spending' })
    ).json<{ data: AccountBody }>().data;
    expect(updated.allocationClass).toBe('spending');
  });

  it('konto innego gospodarstwa daje 404 i pozostaje nietknięte', async () => {
    const s = await setup();
    const account = await create(s);
    const other = await householdFixture(s.app.db, testConfig(), START);

    const response = await call(s, 'PATCH', `/${account.id}`, { name: 'Przejęte' }, other);
    expect(response.statusCode).toBe(404);
    expect((await list(s))[0]?.name).toBe('ROR');
  });
});

describe('archiwizacja', () => {
  it('archive i unarchive przełączają flagę i są idempotentne', async () => {
    const s = await setup();
    const account = await create(s);

    const archived = await call(s, 'POST', `/${account.id}/archive`);
    expect(archived.json<{ data: AccountBody }>().data.isArchived).toBe(true);
    s.clock.advance(1_000);
    const again = (await call(s, 'POST', `/${account.id}/archive`)).json<{ data: AccountBody }>();
    // Ponowna archiwizacja nie jest zmianą.
    expect(again.data.updatedAt).toBe(START.getTime());

    const restored = await call(s, 'POST', `/${account.id}/unarchive`);
    expect(restored.json<{ data: AccountBody }>().data.isArchived).toBe(false);
  });

  it('konto innego gospodarstwa daje 404', async () => {
    const s = await setup();
    const account = await create(s);
    const other = await householdFixture(s.app.db, testConfig(), START);
    expect((await call(s, 'POST', `/${account.id}/archive`, undefined, other)).statusCode).toBe(
      404,
    );
  });
});

describe('DELETE /accounts/:id', () => {
  it('usuwa konto bez historii — 204', async () => {
    const s = await setup();
    const account = await create(s);

    const response = await call(s, 'DELETE', `/${account.id}`);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect((await call(s, 'GET', `/${account.id}`)).statusCode).toBe(404);
  });

  it('konto z transakcją daje 409 i podpowiada archiwizację (I-10)', async () => {
    const s = await setup();
    const account = await create(s);
    insertTransaction(s.app.db, s.home, { accountId: account.id });

    const response = await call(s, 'DELETE', `/${account.id}`);
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('CONFLICT');
    expect(response.json<ErrorBody>().error.message).toContain('zarchiwizować');
  });

  it('konto docelowe przelewu też ma historię', async () => {
    const s = await setup();
    const from = await create(s, { name: 'ROR' });
    const to = await create(s, { name: 'Oszczędności', type: 'savings' });
    insertTransaction(s.app.db, s.home, {
      type: 'transfer',
      accountId: from.id,
      counterAccountId: to.id,
      sourceAllocationClass: 'spending',
      targetAllocationClass: 'savings',
    });

    expect((await call(s, 'DELETE', `/${to.id}`)).statusCode).toBe(409);
  });

  it('transakcja miękko usunięta nadal blokuje usunięcie konta', async () => {
    // Przez 30 dni można ją przywrócić (07 §10) — przywrócona transakcja bez konta
    // rozbiłaby salda.
    const s = await setup();
    const account = await create(s);
    insertTransaction(s.app.db, s.home, { accountId: account.id, deletedAt: START.getTime() });

    expect((await call(s, 'DELETE', `/${account.id}`)).statusCode).toBe(409);
  });

  it('konto innego gospodarstwa daje 404 i nie znika', async () => {
    const s = await setup();
    const account = await create(s);
    const other = await householdFixture(s.app.db, testConfig(), START);

    expect((await call(s, 'DELETE', `/${account.id}`, undefined, other)).statusCode).toBe(404);
    expect(await list(s)).toHaveLength(1);
  });
});

describe('PATCH /accounts/order', () => {
  it('ustawia kolejność według listy', async () => {
    const s = await setup();
    const a = await create(s, { name: 'A' });
    const b = await create(s, { name: 'B' });
    const c = await create(s, { name: 'C' });

    const response = await call(s, 'PATCH', '/order', { ids: [c.id, a.id, b.id] });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: AccountBody[] }>().data.map((x) => x.name)).toEqual([
      'C',
      'A',
      'B',
    ]);
    expect((await list(s)).map((x) => x.sortOrder)).toEqual([0, 1, 2]);
  });

  it('konta spoza listy trafiają za wymienione, w dotychczasowej kolejności', async () => {
    const s = await setup();
    const a = await create(s, { name: 'A' });
    await create(s, { name: 'B' });
    const c = await create(s, { name: 'C' });
    const d = await create(s, { name: 'D' });
    await call(s, 'POST', `/${c.id}/archive`);

    // Ekran pokazuje tylko aktywne; użytkownik przeciąga D na górę.
    await call(s, 'PATCH', '/order', { ids: [d.id, a.id] });

    const all = await list(s, '?includeArchived=true');
    expect(all.map((x) => x.name)).toEqual(['D', 'A', 'B', 'C']);
    expect(all.map((x) => x.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it('nie rusza updatedAt kont, które zostały na miejscu', async () => {
    const s = await setup();
    const a = await create(s, { name: 'A' });
    const b = await create(s, { name: 'B' });
    const c = await create(s, { name: 'C' });
    s.clock.advance(60_000);

    await call(s, 'PATCH', '/order', { ids: [b.id, a.id, c.id] });
    const byName = new Map((await list(s)).map((x) => [x.name, x.updatedAt]));
    expect(byName.get('C')).toBe(START.getTime());
    expect(byName.get('A')).toBe(START.getTime() + 60_000);
  });

  it('konto innego gospodarstwa na liście daje 404 i nic nie zmienia', async () => {
    const s = await setup();
    const a = await create(s, { name: 'A' });
    const b = await create(s, { name: 'B' });
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = await create({ ...s, home: other }, { name: 'Obce' });

    const response = await call(s, 'PATCH', '/order', { ids: [b.id, foreign.id, a.id] });
    expect(response.statusCode).toBe(404);
    expect((await list(s)).map((x) => x.name)).toEqual(['A', 'B']);
  });

  it('powtórzony identyfikator daje 400', async () => {
    const s = await setup();
    const a = await create(s);
    expect((await call(s, 'PATCH', '/order', { ids: [a.id, a.id] })).statusCode).toBe(400);
  });
});
