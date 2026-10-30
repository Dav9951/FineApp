import type {
  AllocationStatusDto,
  AllocationTargetDto,
  AllocationTargetMeta,
} from '@fineapp/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertAccount,
  insertIncomeSource,
  insertLiability,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';
import type { TransactionInsert } from '../../db/schema/transactions.js';

/**
 * Testy tras rozkładu docelowego — zadania `F5-3` i `F5-4`
 * ([04 §11](../../../../../../plans/04-api-spec.md#11-rozkład-docelowy--apiv1allocation),
 * [07 §2](../../../../../../plans/07-domain-rules.md#2-alokacje-i-realizacja-celów-procentowych),
 * ADR-011, ADR-053).
 */

/** 20 września 2026, 12:00 w Warszawie — 20 z 30 dni, jak w przykładzie 04 §11. */
const START = new Date('2026-09-20T10:00:00.000Z');

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Środowisko testu. */
interface Setup {
  app: TestApp;
  home: HouseholdFixture;
  ror: string;
  savings: string;
  broker: string;
}

/**
 * Aplikacja z kontem bieżącym, oszczędnościowym i maklerskim oraz wrześniowymi
 * wpływami 11 800 zł.
 *
 * @returns Środowisko testu.
 */
async function setup(): Promise<Setup> {
  const app = await buildTestApp({}, mutableClock(START));
  harness = app;
  const home = await householdFixture(app.db, testConfig(), START);
  const ror = insertAccount(app.db, home, { name: 'ROR' });
  const savings = insertAccount(app.db, home, { type: 'savings', allocationClass: 'savings' });
  const broker = insertAccount(app.db, home, {
    type: 'investment',
    allocationClass: 'investment',
  });
  insertTransaction(app.db, home, {
    type: 'income',
    amountMinor: 1_180_000,
    accountId: ror,
  });
  return { app, home, ror, savings, broker };
}

/**
 * Wysyła żądanie w imieniu gospodarstwa.
 *
 * @param s - Środowisko.
 * @param method - Metoda.
 * @param url - Ścieżka względem `/api/v1`.
 * @param payload - Ciało.
 * @param home - Gospodarstwo.
 * @returns Odpowiedź.
 */
function call(
  s: Setup,
  method: 'GET' | 'PUT',
  url: string,
  payload?: Record<string, unknown>,
  home: HouseholdFixture = s.home,
): Promise<LightMyRequestResponse> {
  return s.app.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: home.headers,
    ...(payload === undefined ? {} : { payload }),
  });
}

/**
 * Ustawia rozkład i oczekuje `200`.
 *
 * @param s - Środowisko.
 * @param body - Ciało `PUT /allocation/target`.
 * @returns Wersja i metadane.
 */
async function put(
  s: Setup,
  body: Record<string, unknown>,
): Promise<{ data: AllocationTargetDto; meta: AllocationTargetMeta }> {
  const response = await call(s, 'PUT', '/allocation/target', body);
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

/**
 * Stan rozkładu w miesiącu.
 *
 * @param s - Środowisko.
 * @param month - Miesiąc.
 * @returns Stan.
 */
async function status(s: Setup, month = '2026-09'): Promise<AllocationStatusDto> {
  const response = await call(s, 'GET', `/allocation/status?month=${month}`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ data: AllocationStatusDto }>().data;
}

/**
 * Wstawia przelew z migawkami klas kont.
 *
 * @param s - Środowisko.
 * @param from - Konto źródłowe.
 * @param to - Konto docelowe.
 * @param amountMinor - Kwota.
 * @param overrides - Nadpisane kolumny.
 * @returns Identyfikator.
 */
function transfer(
  s: Setup,
  from: string,
  to: string,
  amountMinor: number,
  overrides: Partial<TransactionInsert> = {},
): string {
  const classOf = (id: string) =>
    id === s.savings ? 'savings' : id === s.broker ? 'investment' : 'spending';
  return insertTransaction(s.app.db, s.home, {
    type: 'transfer',
    amountMinor,
    accountId: from,
    counterAccountId: to,
    sourceAllocationClass: classOf(from),
    targetAllocationClass: classOf(to),
    ...overrides,
  });
}

describe('PUT /allocation/target i wersje', () => {
  it('zapisuje wersję; ponowny zapis tego samego miesiąca ją poprawia', async () => {
    const s = await setup();
    const first = await put(s, {
      effectiveFromMonth: '2026-09',
      savingsPercentBps: 2000,
      investmentPercentBps: 1000,
      note: 'Po podwyżce',
    });
    expect(first.data).toMatchObject({
      effectiveFromMonth: '2026-09',
      savingsPercentBps: 2000,
      investmentPercentBps: 1000,
      debtPercentBps: 0,
      note: 'Po podwyżce',
    });
    expect(first.meta.warning).toBeNull();
    const second = await put(s, {
      effectiveFromMonth: '2026-09',
      savingsPercentBps: 2500,
      investmentPercentBps: 1000,
    });
    expect(second.data.id).toBe(first.data.id);
    const history = await call(s, 'GET', '/allocation/history');
    expect(history.json<{ data: AllocationTargetDto[] }>().data).toHaveLength(1);
  });

  it('suma ponad 100% — zapis z ostrzeżeniem (07 §2.7)', async () => {
    const s = await setup();
    const result = await put(s, {
      effectiveFromMonth: '2026-09',
      savingsPercentBps: 8000,
      investmentPercentBps: 3000,
    });
    expect(result.meta.warning).toBe('ALLOCATION_EXCEEDS_INCOME');
  });

  it('miesiąc zamknięty → 422; udział ponad 100% jednej puli → 400', async () => {
    const s = await setup();
    const closed = await call(s, 'PUT', '/allocation/target', {
      effectiveFromMonth: '2026-07',
      savingsPercentBps: 2000,
      investmentPercentBps: 0,
    });
    expect(closed.statusCode).toBe(422);
    expect(closed.json<{ error: { message: string } }>().error.message).toContain('sierpień 2026');
    const tooMuch = await call(s, 'PUT', '/allocation/target', {
      effectiveFromMonth: '2026-09',
      savingsPercentBps: 10_001,
      investmentPercentBps: 0,
    });
    expect(tooMuch.statusCode).toBe(400);
  });

  it('wersjonowanie: zmiana od października nie przepisuje planu sierpnia i września', async () => {
    const s = await setup();
    await put(s, {
      effectiveFromMonth: '2026-08',
      savingsPercentBps: 2000,
      investmentPercentBps: 1000,
    });
    await put(s, {
      effectiveFromMonth: '2026-10',
      savingsPercentBps: 3000,
      investmentPercentBps: 0,
    });

    const target = async (month: string) =>
      (await call(s, 'GET', `/allocation/target?month=${month}`)).json<{
        data: AllocationTargetDto | null;
      }>().data;
    expect(await target('2026-07')).toBeNull();
    expect((await target('2026-09'))?.effectiveFromMonth).toBe('2026-08');
    expect((await target('2026-12'))?.savingsPercentBps).toBe(3000);
    // Bez parametru — bieżący miesiąc (wrzesień).
    const current = await call(s, 'GET', '/allocation/target');
    expect(current.json<{ data: AllocationTargetDto }>().data.effectiveFromMonth).toBe('2026-08');

    expect((await status(s, '2026-09')).lines[0]?.targetPercentBps).toBe(2000);
    expect((await status(s, '2026-10')).lines[0]?.targetPercentBps).toBe(3000);
    const history = await call(s, 'GET', '/allocation/history');
    expect(
      history.json<{ data: AllocationTargetDto[] }>().data.map((v) => v.effectiveFromMonth),
    ).toEqual(['2026-10', '2026-08']);
  });
});

describe('GET /allocation/status — wykonanie netto (F5-4)', () => {
  it('przykład z 04 §11: 2 000 z 2 360 w oszczędnościach, inwestycje wykonane', async () => {
    const s = await setup();
    await put(s, {
      effectiveFromMonth: '2026-09',
      savingsPercentBps: 2000,
      investmentPercentBps: 1000,
    });
    transfer(s, s.ror, s.savings, 200_000);
    transfer(s, s.ror, s.broker, 118_000);
    const result = await status(s);
    expect(result).toMatchObject({
      month: '2026-09',
      effectiveFromMonth: '2026-09',
      incomeBaseMinor: 1_180_000,
      isPartialMonth: true,
      daysElapsed: 20,
      daysInMonth: 30,
      totals: {
        targetPercentBps: 3000,
        actualPercentBps: 2695,
        targetAmountMinor: 354_000,
        actualAmountMinor: 318_000,
        shortfallMinor: 36_000,
      },
    });
    expect(result.lines.map((line) => [line.kind, line.fulfillmentBps, line.status])).toEqual([
      ['savings', 8475, 'on_track'],
      ['investment', 10_000, 'met'],
    ]);
  });

  it('wypłaty ponad wpłaty: wykonanie ujemne, nieobcięte do zera (ADR-011)', async () => {
    const s = await setup();
    await put(s, {
      effectiveFromMonth: '2026-09',
      savingsPercentBps: 2000,
      investmentPercentBps: 0,
    });
    transfer(s, s.ror, s.savings, 50_000);
    transfer(s, s.savings, s.ror, 200_000);
    const [savings] = (await status(s)).lines;
    expect(savings).toEqual({
      kind: 'savings',
      targetPercentBps: 2000,
      targetAmountMinor: 236_000,
      actualAmountMinor: -150_000,
      actualPercentBps: -1271,
      deltaAmountMinor: -386_000,
      deltaPercentBps: -3271,
      fulfillmentBps: -6356,
      status: 'behind',
    });
    expect((await status(s)).totals.shortfallMinor).toBe(386_000);
  });

  it('przelew oszczędności → inwestycje: minus w jednej puli, plus w drugiej', async () => {
    const s = await setup();
    transfer(s, s.savings, s.broker, 500_000);
    const lines = (await status(s)).lines;
    expect(lines.map((line) => [line.kind, line.actualAmountMinor])).toEqual([
      ['savings', -500_000],
      ['investment', 500_000],
    ]);
    // Bez rozkładu: wypłata przy zerowym planie to i tak `behind`.
    expect(lines.map((line) => line.status)).toEqual(['behind', 'met']);
  });

  it('bez efektu: ta sama klasa (I-7), nadpisanie „none", kosz, status pending', async () => {
    const s = await setup();
    const second = insertAccount(s.app.db, s.home, { type: 'savings', allocationClass: 'savings' });
    transfer(s, s.savings, second, 100_000, { targetAllocationClass: 'savings' });
    transfer(s, s.ror, s.savings, 100_000, { allocationOverride: 'none' });
    transfer(s, s.ror, s.savings, 100_000, { deletedAt: Date.now() });
    transfer(s, s.ror, s.savings, 100_000, { status: 'pending' });
    // Wymuszenie: przelew między kontami bieżącymi liczony jako oszczędności.
    const other = insertAccount(s.app.db, s.home);
    transfer(s, s.ror, other, 7_000, { allocationOverride: 'savings' });
    expect((await status(s)).lines[0]?.actualAmountMinor).toBe(7_000);
  });

  it('zmiana klasy konta nie przelicza wstecz — liczy migawka (I-6)', async () => {
    const s = await setup();
    transfer(s, s.ror, s.savings, 100_000);
    s.app.db.sqlite
      .prepare("UPDATE accounts SET allocation_class = 'spending' WHERE id = ?")
      .run(s.savings);
    expect((await status(s)).lines[0]?.actualAmountMinor).toBe(100_000);
  });

  it('podstawa bez zwrotu podatku; zerowe wpływy → procenty 0 i isPartialMonth', async () => {
    const s = await setup();
    const refund = insertIncomeSource(s.app.db, s.home, {
      kind: 'refund',
      countsTowardAllocation: false,
    });
    insertTransaction(s.app.db, s.home, {
      type: 'income',
      amountMinor: 300_000,
      accountId: s.ror,
      incomeSourceId: refund,
    });
    expect((await status(s)).incomeBaseMinor).toBe(1_180_000);

    await put(s, {
      effectiveFromMonth: '2026-08',
      savingsPercentBps: 2000,
      investmentPercentBps: 0,
    });
    transfer(s, s.ror, s.savings, 40_000, { bookedOn: '2026-08-10', monthKey: '2026-08' });
    const august = await status(s, '2026-08');
    expect(august).toMatchObject({ incomeBaseMinor: 0, isPartialMonth: true, daysElapsed: 31 });
    expect(august.lines[0]).toMatchObject({
      actualAmountMinor: 40_000,
      actualPercentBps: 0,
      targetAmountMinor: 0,
      status: 'met',
    });
  });

  it('spłata długu jako linia, gdy rozkład ją planuje (07 §2.2a)', async () => {
    const s = await setup();
    const loan = insertLiability(s.app.db, s.home);
    insertTransaction(s.app.db, s.home, {
      amountMinor: 185_000,
      accountId: s.ror,
      liabilityId: loan,
    });
    insertTransaction(s.app.db, s.home, {
      amountMinor: 10_000,
      accountId: s.ror,
      liabilityId: loan,
      allocationOverride: 'none',
    });
    await put(s, {
      effectiveFromMonth: '2026-09',
      savingsPercentBps: 0,
      investmentPercentBps: 0,
      debtPercentBps: 1500,
    });
    const debt = (await status(s)).lines[2];
    expect(debt).toMatchObject({
      kind: 'debt_repayment',
      targetAmountMinor: 177_000,
      actualAmountMinor: 185_000,
      status: 'ahead',
    });
  });

  it('miesiąc bez parametru — bieżący; cudze gospodarstwo nie widzi wersji', async () => {
    const s = await setup();
    await put(s, {
      effectiveFromMonth: '2026-09',
      savingsPercentBps: 2000,
      investmentPercentBps: 0,
    });
    const plain = await call(s, 'GET', '/allocation/status');
    expect(plain.json<{ data: AllocationStatusDto }>().data.month).toBe('2026-09');
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = await call(s, 'GET', '/allocation/status', undefined, other);
    expect(foreign.json<{ data: AllocationStatusDto }>().data.effectiveFromMonth).toBeNull();
  });
});

describe('GET /allocation/trend', () => {
  it('domyślnie sześć miesięcy do bieżącego, każdy z wersją, która wtedy obowiązywała', async () => {
    const s = await setup();
    await put(s, {
      effectiveFromMonth: '2026-08',
      savingsPercentBps: 1000,
      investmentPercentBps: 0,
    });
    await put(s, {
      effectiveFromMonth: '2026-09',
      savingsPercentBps: 2000,
      investmentPercentBps: 0,
    });
    const response = await call(s, 'GET', '/allocation/trend');
    const trend = response.json<{ data: AllocationStatusDto[] }>().data;
    expect(trend.map((point) => [point.month, point.lines[0]?.targetPercentBps])).toEqual([
      ['2026-04', 0],
      ['2026-05', 0],
      ['2026-06', 0],
      ['2026-07', 0],
      ['2026-08', 1000],
      ['2026-09', 2000],
    ]);
  });

  it('sam `from` — sześć miesięcy od niego; zakres odwrócony albo za długi → 400', async () => {
    const s = await setup();
    const from = await call(s, 'GET', '/allocation/trend?from=2026-01');
    expect(from.json<{ data: AllocationStatusDto[] }>().data.map((p) => p.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
    expect((await call(s, 'GET', '/allocation/trend?from=2026-09&to=2026-01')).statusCode).toBe(
      400,
    );
    expect((await call(s, 'GET', '/allocation/trend?from=2024-01&to=2026-09')).statusCode).toBe(
      400,
    );
    expect(
      (await call(s, 'GET', '/allocation/trend?to=2026-02')).json<{ data: unknown[] }>().data,
    ).toHaveLength(6);
  });

  it('bez zalogowania → 401', async () => {
    const s = await setup();
    const response = await s.app.app.inject({ method: 'GET', url: '/api/v1/allocation/status' });
    expect(response.statusCode).toBe(401);
  });
});
