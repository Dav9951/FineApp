import {
  allocationEffects,
  type AllocationClass,
  type AllocationOverride,
  type MonthCategoriesDto,
  type MonthSummaryDto,
  type MonthsAvailableDto,
} from '@fineapp/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertAccount,
  insertCategory,
  insertIncomeSource,
  insertLiability,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';
import { households } from '../../db/schema/households.js';
import { sumMonthTotals } from './months.repository.js';

/**
 * Testy tras ekranu miesiąca — zadania `F3-1` i `F3-2`
 * ([04 §14](../../../../../../plans/04-api-spec.md#14-miesiąc--apiv1months),
 * [07 §12](../../../../../../plans/07-domain-rules.md#12-ekran-miesiąca)).
 */

/** 23 września 2026, 12:00 w Warszawie. */
const NOW = new Date('2026-09-23T10:00:00.000Z');
const BASE = '/api/v1/months';

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
 * Buduje aplikację z jednym gospodarstwem.
 *
 * @param now - Chwila zegara aplikacji.
 * @returns Aplikacja i gospodarstwo.
 */
async function setup(now: Date = NOW): Promise<Setup> {
  const app = await buildTestApp({}, mutableClock(now));
  harness = app;
  const home = await householdFixture(app.db, testConfig(), now);
  return { app, home };
}

/**
 * Wykonuje `GET` i zwraca dane z koperty, sprawdzając `200`.
 *
 * @param s - Aplikacja.
 * @param url - Ścieżka względem `/months`.
 * @param home - Gospodarstwo.
 * @returns Pole `data` odpowiedzi.
 */
async function get<T>(s: Setup, url: string, home: HouseholdFixture = s.home): Promise<T> {
  const response = await s.app.app.inject({
    method: 'GET',
    url: `${BASE}${url}`,
    headers: home.headers,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ data: T }>().data;
}

describe('dostęp', () => {
  it('każda trasa wymaga zalogowania', async () => {
    const s = await setup();
    for (const url of ['/available', '/2026-09/summary', '/2026-09/categories']) {
      const response = await s.app.app.inject({ method: 'GET', url: `${BASE}${url}` });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('zły klucz miesiąca → 400', async () => {
    const s = await setup();
    for (const url of ['/2026-13/summary', '/2026-9/summary', '/wrzesien/categories']) {
      const response = await s.app.app.inject({
        method: 'GET',
        url: `${BASE}${url}`,
        headers: s.home.headers,
      });
      expect(response.statusCode, url).toBe(400);
    }
  });
});

describe('GET /months/:monthKey/summary — ramy czasu', () => {
  it('pusty miesiąc bieżący: zera, okno księgowania, upływ dni', async () => {
    const s = await setup();
    const summary = await get<MonthSummaryDto>(s, '/2026-09/summary');
    expect(summary).toMatchObject({
      month: '2026-09',
      range: { from: '2026-09-01', to: '2026-09-30' },
      isCurrent: true,
      isPartial: true,
      isFuture: false,
      daysElapsed: 23,
      daysInMonth: 30,
      canPostBackTo: '2026-08-01',
      canPostUntil: '2026-09-30',
      accounts: [],
      netWorthMinor: 0,
      topCategories: [],
      uncategorizedCount: 0,
      recentTransactions: [],
      comparison: {
        previousMonth: '2026-08',
        hasPreviousData: false,
        incomeDeltaBps: 0,
        expenseDeltaBps: 0,
      },
    });
    expect(Object.values(summary.totals).every((value) => value === 0)).toBe(true);
  });

  it('„dziś" w strefie gospodarstwa: 30 września 23:30 UTC to już październik', async () => {
    const s = await setup(new Date('2026-09-30T23:30:00.000Z'));
    const summary = await get<MonthSummaryDto>(s, '/2026-10/summary');
    expect(summary).toMatchObject({ isCurrent: true, daysElapsed: 1, canPostBackTo: '2026-09-01' });
    expect((await get<MonthSummaryDto>(s, '/2026-09/summary')).isCurrent).toBe(false);
  });

  it('miesiąc przyszły to podgląd, nie błąd', async () => {
    const s = await setup();
    const summary = await get<MonthSummaryDto>(s, '/2027-01/summary');
    expect(summary).toMatchObject({ isFuture: true, isPartial: false, daysElapsed: 0 });
  });

  it('okno księgowania bierze limit z ustawień gospodarstwa', async () => {
    const s = await setup();
    s.app.db.db
      .update(households)
      .set({ backPostingLimitMonths: 3 })
      .where(eq(households.id, s.home.householdId))
      .run();
    expect((await get<MonthSummaryDto>(s, '/2026-09/summary')).canPostBackTo).toBe('2026-06-01');
  });
});

describe('GET /months/:monthKey/summary — sumy', () => {
  it('liczy strumienie, podstawę procentu, spłatę długu i wynik netto', async () => {
    const s = await setup();
    const db = s.app.db;
    const ror = insertAccount(db, s.home, { openingBalanceMinor: 100_000 });
    const savings = insertAccount(db, s.home, {
      name: 'Oszczędności',
      type: 'savings',
      allocationClass: 'savings',
    });
    const salary = insertIncomeSource(db, s.home);
    const refund = insertIncomeSource(db, s.home, {
      name: 'Zwrot podatku',
      kind: 'refund',
      countsTowardAllocation: false,
    });
    const mortgage = insertLiability(db, s.home);
    const food = insertCategory(db, s.home, { name: 'Jedzenie' });

    insertTransaction(db, s.home, {
      type: 'income',
      accountId: ror,
      incomeSourceId: salary,
      amountMinor: 980_000,
    });
    insertTransaction(db, s.home, {
      type: 'income',
      accountId: ror,
      incomeSourceId: refund,
      amountMinor: 50_000,
    });
    // Przychód bez źródła liczy się do podstawy (07 §2.3).
    insertTransaction(db, s.home, { type: 'income', accountId: ror, amountMinor: 20_000 });
    insertTransaction(db, s.home, { accountId: ror, categoryId: food, amountMinor: 12_799 });
    insertTransaction(db, s.home, { accountId: ror, liabilityId: mortgage, amountMinor: 250_000 });
    insertTransaction(db, s.home, {
      type: 'transfer',
      accountId: ror,
      counterAccountId: savings,
      sourceAllocationClass: 'spending',
      targetAllocationClass: 'savings',
      amountMinor: 200_000,
    });
    insertTransaction(db, s.home, {
      type: 'transfer',
      accountId: savings,
      counterAccountId: ror,
      sourceAllocationClass: 'savings',
      targetAllocationClass: 'spending',
      amountMinor: 50_000,
    });

    const { totals } = await get<MonthSummaryDto>(s, '/2026-09/summary');
    expect(totals).toEqual({
      incomeMinor: 1_050_000,
      incomeBaseMinor: 1_000_000,
      expenseMinor: 262_799,
      savingsMinor: 150_000,
      investmentMinor: 0,
      debtRepaymentMinor: 250_000,
      netMinor: 637_201,
      unallocatedMinor: 637_201,
    });
  });

  it('pomija kosz, `pending`, `void` i inne miesiące', async () => {
    const s = await setup();
    const db = s.app.db;
    insertTransaction(db, s.home, { amountMinor: 1_000 });
    insertTransaction(db, s.home, { amountMinor: 2_000, deletedAt: NOW.getTime() });
    insertTransaction(db, s.home, { amountMinor: 4_000, status: 'pending' });
    insertTransaction(db, s.home, { amountMinor: 8_000, status: 'void' });
    insertTransaction(db, s.home, {
      amountMinor: 16_000,
      bookedOn: '2026-08-31',
      monthKey: '2026-08',
    });

    const summary = await get<MonthSummaryDto>(s, '/2026-09/summary');
    expect(summary.totals.expenseMinor).toBe(1_000);
    // Ostatnie transakcje pokazują też `pending` i `void` — ale nie kosz.
    expect(summary.recentTransactions).toHaveLength(3);
  });

  it('wypłata z oszczędności daje wykonanie ujemne — nie obcięte do zera (ADR-011)', async () => {
    const s = await setup();
    insertTransaction(s.app.db, s.home, {
      type: 'transfer',
      sourceAllocationClass: 'savings',
      targetAllocationClass: 'spending',
      amountMinor: 70_000,
    });
    const { totals } = await get<MonthSummaryDto>(s, '/2026-09/summary');
    expect(totals.savingsMinor).toBe(-70_000);
    expect(totals.netMinor).toBe(70_000);
  });

  it('rata wyłączona z alokacji (`none`) jest wydatkiem, ale nie spłatą długu', async () => {
    const s = await setup();
    const mortgage = insertLiability(s.app.db, s.home);
    insertTransaction(s.app.db, s.home, {
      liabilityId: mortgage,
      allocationOverride: 'none',
      amountMinor: 5_000,
    });
    const { totals } = await get<MonthSummaryDto>(s, '/2026-09/summary');
    expect(totals.expenseMinor).toBe(5_000);
    expect(totals.debtRepaymentMinor).toBe(0);
  });

  it('SQL daje te same sumy pul co `allocationEffects` — każda kombinacja klas i nadpisań', async () => {
    const s = await setup();
    const classes: AllocationClass[] = ['spending', 'savings', 'investment'];
    const overrides: (AllocationOverride | null)[] = [null, 'none', 'savings', 'investment'];
    let expectedSavings = 0;
    let expectedInvestment = 0;
    let amount = 100;
    for (const source of classes) {
      for (const target of classes) {
        for (const override of overrides) {
          amount += 1;
          insertTransaction(s.app.db, s.home, {
            type: 'transfer',
            sourceAllocationClass: source,
            targetAllocationClass: target,
            allocationOverride: override,
            amountMinor: amount,
          });
          for (const effect of allocationEffects({
            type: 'transfer',
            amountMinor: amount,
            sourceAllocationClass: source,
            targetAllocationClass: target,
            allocationOverride: override,
            liabilityId: null,
          })) {
            if (effect.kind === 'savings') expectedSavings += effect.amountMinor;
            if (effect.kind === 'investment') expectedInvestment += effect.amountMinor;
          }
        }
      }
    }
    const totals = sumMonthTotals(s.app.db, s.home.householdId, '2026-09');
    expect(totals.savingsMinor).toBe(expectedSavings);
    expect(totals.investmentMinor).toBe(expectedInvestment);
  });

  it('porównanie z poprzednim miesiącem', async () => {
    const s = await setup();
    insertTransaction(s.app.db, s.home, { amountMinor: 50_000 });
    insertTransaction(s.app.db, s.home, {
      amountMinor: 40_000,
      bookedOn: '2026-08-15',
      monthKey: '2026-08',
    });
    const { comparison } = await get<MonthSummaryDto>(s, '/2026-09/summary');
    expect(comparison).toEqual({
      previousMonth: '2026-08',
      hasPreviousData: true,
      incomeDeltaMinor: 0,
      incomeDeltaBps: 0,
      expenseDeltaMinor: 10_000,
      expenseDeltaBps: 2500,
    });
  });
});

describe('GET /months/:monthKey/summary — sekcje', () => {
  it('salda na koniec miesiąca, jak `/accounts/balances?month=`', async () => {
    const s = await setup();
    const ror = insertAccount(s.app.db, s.home, { openingBalanceMinor: 100_000 });
    insertTransaction(s.app.db, s.home, { accountId: ror, amountMinor: 1_000 });
    insertTransaction(s.app.db, s.home, {
      accountId: ror,
      amountMinor: 5_000,
      bookedOn: '2026-10-01',
      monthKey: '2026-10',
    });

    const summary = await get<MonthSummaryDto>(s, '/2026-09/summary');
    const balances = await s.app.app.inject({
      method: 'GET',
      url: '/api/v1/accounts/balances?month=2026-09',
      headers: s.home.headers,
    });
    const expected = balances.json<{ data: unknown[]; meta: { netWorthMinor: number } }>();
    expect(summary.accounts).toEqual(expected.data);
    expect(summary.netWorthMinor).toBe(expected.meta.netWorthMinor);
    expect(summary.accounts[0]).toMatchObject({ balanceMinor: 99_000, changeInMonthMinor: -1_000 });
  });

  it('kategorie: zwinięte do głównych, „Bez kategorii" i licznik do uzupełnienia', async () => {
    const s = await setup();
    const food = insertCategory(s.app.db, s.home, { name: 'Jedzenie' });
    const coffee = insertCategory(s.app.db, s.home, { name: 'Kawiarnie', parentId: food });
    insertTransaction(s.app.db, s.home, { categoryId: coffee, amountMinor: 3_000 });
    insertTransaction(s.app.db, s.home, { categoryId: food, amountMinor: 3_000 });
    insertTransaction(s.app.db, s.home, { categoryId: null, amountMinor: 2_000 });
    insertTransaction(s.app.db, s.home, { categoryId: null, amountMinor: 2_000 });

    const summary = await get<MonthSummaryDto>(s, '/2026-09/summary');
    expect(
      summary.topCategories.map((item) => [item.name, item.amountMinor, item.shareBps]),
    ).toEqual([
      ['Jedzenie', 6_000, 6000],
      ['Bez kategorii', 4_000, 4000],
    ]);
    expect(summary.uncategorizedCount).toBe(2);
  });

  it('ostatnie: dziesięć najnowszych, od najpóźniejszej daty', async () => {
    const s = await setup();
    for (let day = 1; day <= 12; day += 1) {
      insertTransaction(s.app.db, s.home, {
        bookedOn: `2026-09-${String(day).padStart(2, '0')}`,
        description: `Dzień ${String(day)}`,
      });
    }
    const { recentTransactions } = await get<MonthSummaryDto>(s, '/2026-09/summary');
    expect(recentTransactions).toHaveLength(10);
    expect(recentTransactions[0]?.bookedOn).toBe('2026-09-12');
    expect(recentTransactions[9]?.bookedOn).toBe('2026-09-03');
    expect(recentTransactions[0]?.createdByName).toBe('Test');
  });

  it('nie widzi danych innego gospodarstwa', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), NOW);
    insertAccount(s.app.db, other);
    insertTransaction(s.app.db, other, { amountMinor: 9_999 });
    const summary = await get<MonthSummaryDto>(s, '/2026-09/summary');
    expect(summary.totals.expenseMinor).toBe(0);
    expect(summary.accounts).toEqual([]);
    expect(summary.recentTransactions).toEqual([]);
    expect(summary.topCategories).toEqual([]);
  });
});

describe('GET /months/available', () => {
  it('miesiące z transakcjami rosnąco, bez kosza, i bieżący miesiąc', async () => {
    const s = await setup();
    insertTransaction(s.app.db, s.home, { bookedOn: '2026-09-01', monthKey: '2026-09' });
    insertTransaction(s.app.db, s.home, { bookedOn: '2026-07-01', monthKey: '2026-07' });
    insertTransaction(s.app.db, s.home, { bookedOn: '2026-07-02', monthKey: '2026-07' });
    insertTransaction(s.app.db, s.home, {
      bookedOn: '2026-06-01',
      monthKey: '2026-06',
      deletedAt: NOW.getTime(),
    });
    insertTransaction(s.app.db, s.home, {
      bookedOn: '2026-05-01',
      monthKey: '2026-05',
      status: 'pending',
    });
    const other = await householdFixture(s.app.db, testConfig(), NOW);
    insertTransaction(s.app.db, other, { bookedOn: '2026-01-01', monthKey: '2026-01' });

    expect(await get<MonthsAvailableDto>(s, '/available')).toEqual({
      currentMonth: '2026-09',
      months: ['2026-05', '2026-07', '2026-09'],
    });
  });
});

describe('GET /months/:monthKey/categories', () => {
  it('drzewo z podkategoriami, porównanie i suma równa wydatkom', async () => {
    const s = await setup();
    const food = insertCategory(s.app.db, s.home, { name: 'Jedzenie' });
    const coffee = insertCategory(s.app.db, s.home, { name: 'Kawiarnie', parentId: food });
    const home = insertCategory(s.app.db, s.home, { name: 'Mieszkanie', isArchived: true });
    insertTransaction(s.app.db, s.home, { categoryId: coffee, amountMinor: 1_500 });
    insertTransaction(s.app.db, s.home, { categoryId: food, amountMinor: 2_500 });
    // Kategoria z archiwum nie znika z raportu (07 §10).
    insertTransaction(s.app.db, s.home, { categoryId: home, amountMinor: 6_000 });
    insertTransaction(s.app.db, s.home, {
      categoryId: coffee,
      amountMinor: 1_000,
      bookedOn: '2026-08-03',
      monthKey: '2026-08',
    });
    // Przychód nie jest wydatkiem.
    insertTransaction(s.app.db, s.home, { type: 'income', amountMinor: 99_000 });

    const report = await get<MonthCategoriesDto>(s, '/2026-09/categories');
    expect(report.month).toBe('2026-09');
    expect(report.previousMonth).toBe('2026-08');
    expect(report.expenseMinor).toBe(10_000);
    expect(report.items.map((item) => [item.name, item.amountMinor, item.shareBps])).toEqual([
      ['Mieszkanie', 6_000, 6000],
      ['Jedzenie', 4_000, 4000],
    ]);
    expect(report.items[1]).toMatchObject({ previousMonthAmountMinor: 1_000, transactionCount: 2 });
    expect(report.items[1]?.children).toEqual([
      expect.objectContaining({
        name: 'Kawiarnie',
        amountMinor: 1_500,
        previousMonthAmountMinor: 1_000,
      }),
    ]);
  });

  it('pusty miesiąc', async () => {
    const s = await setup();
    expect(await get<MonthCategoriesDto>(s, '/2026-09/categories')).toEqual({
      month: '2026-09',
      previousMonth: '2026-08',
      expenseMinor: 0,
      items: [],
    });
  });
});
