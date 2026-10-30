import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock, type MutableClock } from '../../core/clock.js';
import { newId } from '../../core/id.js';
import { signAccessToken } from '../auth/auth.tokens.js';

/**
 * Testy sald przez HTTP i prawdziwą bazę — zadanie `F2-2`
 * ([07 §7](../../../../../../plans/07-domain-rules.md#7-salda-kont)).
 *
 * Arytmetykę sprawdzają testy jednostkowe `accounts.balances.test.ts`. Tutaj pilnujemy
 * tego, czego one nie widzą: **które transakcje zapytanie w ogóle policzy**.
 */

/** Saldo w kształcie odpowiedzi. */
interface BalanceBody {
  accountId: string;
  isArchived: boolean;
  balanceMinor: number;
  balanceAtMonthStartMinor: number;
  changeInMonthMinor: number;
}

/** Odpowiedź `GET /accounts/balances`. */
interface BalancesResponse {
  data: BalanceBody[];
  meta: {
    asOf: string;
    totalsByClass: { spending: number; savings: number; investment: number };
    netWorthMinor: number;
    liabilitiesRemainingMinor: number;
  };
}

/** 23 września, południe w Warszawie. */
const START = new Date('2026-09-23T10:00:00.000Z');

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Aplikacja z jednym gospodarstwem. */
interface Setup {
  app: TestApp;
  clock: MutableClock;
  home: HouseholdFixture;
}

/**
 * Buduje aplikację z jednym gospodarstwem.
 *
 * @param start - Chwila startu zegara; token jest wystawiony na nią.
 * @returns Aplikacja, zegar i gospodarstwo.
 */
async function setup(start: Date = START): Promise<Setup> {
  const clock = mutableClock(start);
  const app = await buildTestApp({}, clock);
  harness = app;
  const home = await householdFixture(app.db, testConfig(), start);
  return { app, clock, home };
}

/**
 * Zakłada konto przez API.
 *
 * @param s - Aplikacja.
 * @param body - Pola nadpisujące minimalne konto.
 * @returns Identyfikator konta.
 */
async function createAccount(s: Setup, body: Record<string, unknown> = {}): Promise<string> {
  const response = await s.app.app.inject({
    method: 'POST',
    url: '/api/v1/accounts',
    headers: s.home.headers,
    payload: { name: 'ROR', type: 'checking', openingBalanceOn: '2026-01-01', ...body },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

/**
 * Pobiera salda.
 *
 * @param s - Aplikacja.
 * @param query - Ciąg zapytania.
 * @param home - Gospodarstwo.
 * @returns Odpowiedź sald.
 */
async function balances(s: Setup, query = '', home = s.home): Promise<BalancesResponse> {
  const response = await s.app.app.inject({
    method: 'GET',
    url: `/api/v1/accounts/balances${query}`,
    headers: home.headers,
  });
  expect(response.statusCode).toBe(200);
  return response.json<BalancesResponse>();
}

/**
 * Saldo jednego konta z odpowiedzi.
 *
 * @param body - Odpowiedź sald.
 * @param accountId - Identyfikator konta.
 * @returns Saldo konta.
 */
function row(body: BalancesResponse, accountId: string): BalanceBody | undefined {
  return body.data.find((entry) => entry.accountId === accountId);
}

describe('GET /accounts/balances — które transakcje się liczą', () => {
  it('przychód dodaje, wydatek odejmuje', async () => {
    const s = await setup();
    const ror = await createAccount(s, { openingBalanceMinor: 100_000 });
    insertTransaction(s.app.db, s.home, { type: 'income', accountId: ror, amountMinor: 50_000 });
    insertTransaction(s.app.db, s.home, { type: 'expense', accountId: ror, amountMinor: 12_799 });

    expect(row(await balances(s, '?month=2026-09'), ror)?.balanceMinor).toBe(137_201);
  });

  it('przelew zdejmuje ze źródła i dodaje do celu', async () => {
    const s = await setup();
    const ror = await createAccount(s, { openingBalanceMinor: 100_000 });
    const savings = await createAccount(s, { name: 'Oszczędności', type: 'savings' });
    insertTransaction(s.app.db, s.home, {
      type: 'transfer',
      accountId: ror,
      counterAccountId: savings,
      amountMinor: 30_000,
      sourceAllocationClass: 'spending',
      targetAllocationClass: 'savings',
    });

    const body = await balances(s, '?month=2026-09');
    expect(row(body, ror)?.balanceMinor).toBe(70_000);
    expect(row(body, savings)?.balanceMinor).toBe(30_000);
    expect(body.meta.totalsByClass).toEqual({ spending: 70_000, savings: 30_000, investment: 0 });
    // Przelew nie zmienia majątku — pieniądze tylko zmieniły miejsce.
    expect(body.meta.netWorthMinor).toBe(100_000);
  });

  it('przelew między kontami tej samej klasy nie rusza sumy klasy', async () => {
    const s = await setup();
    const ror = await createAccount(s, { openingBalanceMinor: 100_000 });
    const cash = await createAccount(s, { name: 'Gotówka', type: 'cash' });
    insertTransaction(s.app.db, s.home, {
      type: 'transfer',
      accountId: ror,
      counterAccountId: cash,
      amountMinor: 20_000,
      sourceAllocationClass: 'spending',
      targetAllocationClass: 'spending',
    });

    const body = await balances(s, '?month=2026-09');
    expect(row(body, cash)?.balanceMinor).toBe(20_000);
    expect(body.meta.totalsByClass.spending).toBe(100_000);
  });

  it('pomija pending, void i miękko usunięte', async () => {
    const s = await setup();
    const ror = await createAccount(s, { openingBalanceMinor: 100_000 });
    insertTransaction(s.app.db, s.home, { accountId: ror, status: 'pending' });
    insertTransaction(s.app.db, s.home, { accountId: ror, status: 'void' });
    insertTransaction(s.app.db, s.home, { accountId: ror, deletedAt: START.getTime() });

    expect(row(await balances(s, '?month=2026-09'), ror)?.balanceMinor).toBe(100_000);
  });

  it('pomija transakcje sprzed daty salda początkowego', async () => {
    // Saldo początkowe z 1 września już zawiera sierpniowe wydatki.
    const s = await setup();
    const ror = await createAccount(s, {
      openingBalanceMinor: 100_000,
      openingBalanceOn: '2026-09-01',
    });
    insertTransaction(s.app.db, s.home, {
      accountId: ror,
      bookedOn: '2026-08-31',
      monthKey: '2026-08',
      amountMinor: 5_000,
    });
    insertTransaction(s.app.db, s.home, {
      accountId: ror,
      bookedOn: '2026-09-01',
      amountMinor: 1_000,
    });

    expect(row(await balances(s, '?month=2026-09'), ror)?.balanceMinor).toBe(99_000);
  });

  it('pomija transakcje innego gospodarstwa', async () => {
    const s = await setup();
    const ror = await createAccount(s, { openingBalanceMinor: 100_000 });
    const other = await householdFixture(s.app.db, testConfig(), START);
    insertTransaction(s.app.db, other, { accountId: ror, amountMinor: 1_000 });

    expect(row(await balances(s, '?month=2026-09'), ror)?.balanceMinor).toBe(100_000);
    expect((await balances(s, '?month=2026-09', other)).data).toEqual([]);
  });
});

describe('GET /accounts/balances — granice okresu', () => {
  it('pierwszy dzień miesiąca jest ruchem w miesiącu, ostatni dzień poprzedniego — nie', async () => {
    const s = await setup();
    const ror = await createAccount(s, { openingBalanceMinor: 100_000 });
    insertTransaction(s.app.db, s.home, {
      accountId: ror,
      bookedOn: '2026-08-31',
      monthKey: '2026-08',
      amountMinor: 3_000,
    });
    insertTransaction(s.app.db, s.home, {
      accountId: ror,
      bookedOn: '2026-09-01',
      amountMinor: 1_000,
    });
    insertTransaction(s.app.db, s.home, {
      accountId: ror,
      bookedOn: '2026-09-30',
      amountMinor: 500,
    });

    expect(row(await balances(s, '?month=2026-09'), ror)).toMatchObject({
      balanceAtMonthStartMinor: 97_000,
      balanceMinor: 95_500,
      changeInMonthMinor: -1_500,
    });
  });

  it('asOf liczy do tego dnia włącznie', async () => {
    const s = await setup();
    const ror = await createAccount(s, { openingBalanceMinor: 100_000 });
    insertTransaction(s.app.db, s.home, {
      accountId: ror,
      bookedOn: '2026-09-15',
      amountMinor: 1_000,
    });
    insertTransaction(s.app.db, s.home, {
      accountId: ror,
      bookedOn: '2026-09-16',
      amountMinor: 2_000,
    });

    const body = await balances(s, '?asOf=2026-09-15');
    expect(body.meta.asOf).toBe('2026-09-15');
    expect(row(body, ror)?.balanceMinor).toBe(99_000);
  });

  it('bez parametrów liczy na dziś w strefie gospodarstwa, nie serwera', async () => {
    // 22:30 UTC 30 września to już 00:30 1 października w Warszawie.
    const s = await setup(new Date('2026-09-30T22:30:00.000Z'));
    await createAccount(s);
    expect((await balances(s)).meta.asOf).toBe('2026-10-01');
  });

  it('miesiąc sprzed archiwizacji nadal widzi zarchiwizowane konto z saldem', async () => {
    const s = await setup();
    const old = await createAccount(s, { openingBalanceMinor: 40_000 });
    insertTransaction(s.app.db, s.home, {
      accountId: old,
      bookedOn: '2026-10-05',
      monthKey: '2026-10',
      amountMinor: 40_000,
    });
    await s.app.app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${old}/archive`,
      headers: s.home.headers,
    });

    // We wrześniu konto miało 400 zł — archiwizacja w październiku tego nie zmienia.
    const september = await balances(s, '?month=2026-09');
    expect(row(september, old)).toMatchObject({ isArchived: true, balanceMinor: 40_000 });
    expect(september.meta.netWorthMinor).toBe(40_000);
    // W listopadzie konto jest puste od początku miesiąca — znika z listy.
    expect(row(await balances(s, '?month=2026-11'), old)).toBeUndefined();
  });

  it('zobowiązania do F4-4 wynoszą zero', async () => {
    const s = await setup();
    expect((await balances(s)).meta.liabilitiesRemainingMinor).toBe(0);
  });

  it('token gospodarstwa, którego nie ma w bazie, daje 401, a nie 500', async () => {
    // Baza postawiona od nowa pod starym, wciąż ważnym tokenem.
    const s = await setup();
    const token = await signAccessToken(
      testConfig(),
      { sub: newId(), hid: newId(), sid: newId() },
      START,
    );
    const response = await s.app.app.inject({
      method: 'GET',
      url: '/api/v1/accounts/balances',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('asOf i month naraz dają 400', async () => {
    const s = await setup();
    const response = await s.app.app.inject({
      method: 'GET',
      url: '/api/v1/accounts/balances?asOf=2026-09-15&month=2026-09',
      headers: s.home.headers,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /accounts/:id — saldo', () => {
  it('zwraca saldo na dziś gospodarstwa', async () => {
    const s = await setup();
    const ror = await createAccount(s, { openingBalanceMinor: 100_000 });
    insertTransaction(s.app.db, s.home, {
      accountId: ror,
      bookedOn: '2026-09-20',
      amountMinor: 2_500,
    });

    const response = await s.app.app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${ror}`,
      headers: s.home.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ data: { balanceMinor: number; balanceAsOf: string } }>().data,
    ).toMatchObject({
      balanceMinor: 97_500,
      balanceAsOf: '2026-09-23',
    });
  });
});
