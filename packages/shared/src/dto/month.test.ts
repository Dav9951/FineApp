import { describe, expect, it } from 'vitest';

import {
  CategorySpendingDtoSchema,
  CategorySpendingTreeDtoSchema,
  MonthCategoriesDtoSchema,
  MonthComparisonDtoSchema,
  MonthParamsSchema,
  MonthSummaryDtoSchema,
  MonthTotalsDtoSchema,
  MonthRecurringSectionDtoSchema,
  MonthsAvailableDtoSchema,
} from './month.js';

/**
 * Testy kontraktów ekranu miesiąca
 * ([05 §13](../../../../plans/05-dto-contracts.md#13-miesiąc--dtomonthdtots)).
 */

const ID = '01J9ZQK8WQ0000000000000000';

/** Sumy z przykładu 04 §14. */
const TOTALS = {
  incomeMinor: 1_180_000,
  incomeBaseMinor: 1_180_000,
  expenseMinor: 642_300,
  savingsMinor: 200_000,
  investmentMinor: 118_000,
  debtRepaymentMinor: 185_000,
  netMinor: 219_700,
  unallocatedMinor: 219_700,
};

/** Kategoria z wydatkami. */
const SPENDING = {
  categoryId: ID,
  name: 'Jedzenie',
  color: null,
  icon: null,
  amountMinor: 187_400,
  shareBps: 2918,
  transactionCount: 23,
  previousMonthAmountMinor: 190_000,
};

const COMPARISON = {
  previousMonth: '2026-08',
  hasPreviousData: true,
  incomeDeltaMinor: 0,
  incomeDeltaBps: 0,
  expenseDeltaMinor: -41_200,
  expenseDeltaBps: -602,
};

describe('MonthParamsSchema', () => {
  it('przyjmuje klucz miesiąca i odrzuca inne napisy', () => {
    expect(MonthParamsSchema.safeParse({ monthKey: '2026-09' }).success).toBe(true);
    expect(MonthParamsSchema.safeParse({ monthKey: '2026-13' }).success).toBe(false);
    expect(MonthParamsSchema.safeParse({ monthKey: 'available' }).success).toBe(false);
  });
});

describe('MonthTotalsDtoSchema', () => {
  it('przyjmuje przykład z 04 §14', () => {
    expect(MonthTotalsDtoSchema.parse(TOTALS)).toEqual(TOTALS);
  });

  it('dopuszcza ujemne oszczędności, inwestycje i wynik netto (ADR-011)', () => {
    const negative = { ...TOTALS, savingsMinor: -150_000, investmentMinor: -1, netMinor: -5 };
    expect(MonthTotalsDtoSchema.safeParse({ ...negative, unallocatedMinor: 0 }).success).toBe(true);
  });

  it('odrzuca ujemne wpływy, wydatki i wolne środki', () => {
    expect(MonthTotalsDtoSchema.safeParse({ ...TOTALS, incomeMinor: -1 }).success).toBe(false);
    expect(MonthTotalsDtoSchema.safeParse({ ...TOTALS, expenseMinor: -1 }).success).toBe(false);
    expect(MonthTotalsDtoSchema.safeParse({ ...TOTALS, unallocatedMinor: -1 }).success).toBe(false);
  });
});

describe('CategorySpendingDtoSchema', () => {
  it('przyjmuje „Bez kategorii" jako `categoryId: null`', () => {
    const parsed = CategorySpendingDtoSchema.parse({
      ...SPENDING,
      categoryId: null,
      name: 'Bez kategorii',
    });
    expect(parsed.categoryId).toBeNull();
  });

  it('przyjmuje brak porównania jako `null`', () => {
    expect(
      CategorySpendingDtoSchema.safeParse({ ...SPENDING, previousMonthAmountMinor: null }).success,
    ).toBe(true);
  });

  it('drzewo niesie podkategorie', () => {
    const tree = CategorySpendingTreeDtoSchema.parse({ ...SPENDING, children: [SPENDING] });
    expect(tree.children).toHaveLength(1);
  });
});

describe('MonthComparisonDtoSchema', () => {
  it('przyjmuje ujemną zmianę w bps', () => {
    expect(MonthComparisonDtoSchema.parse(COMPARISON).expenseDeltaBps).toBe(-602);
  });
});

describe('MonthSummaryDtoSchema', () => {
  it('przyjmuje pusty miesiąc bieżący', () => {
    const parsed = MonthSummaryDtoSchema.parse({
      month: '2026-09',
      range: { from: '2026-09-01', to: '2026-09-30' },
      isCurrent: true,
      isPartial: true,
      isFuture: false,
      daysElapsed: 23,
      daysInMonth: 30,
      canPostBackTo: '2026-08-01',
      canPostUntil: '2026-09-30',
      totals: { ...TOTALS, incomeMinor: 0 },
      accounts: [],
      netWorthMinor: 0,
      topCategories: [SPENDING],
      uncategorizedCount: 0,
      recentTransactions: [],
      comparison: COMPARISON,
      recurring: {
        plannedTotalMinor: 0,
        postedTotalMinor: 0,
        pendingCount: 0,
        overdueCount: 0,
        items: [],
      },
      liabilities: {
        totalRemainingMinor: 0,
        monthlyPaymentTotalMinor: 0,
        paidThisMonthMinor: 0,
        unpaidCount: 0,
        items: [],
      },
      allocation: {
        month: '2026-09',
        effectiveFromMonth: null,
        incomeBaseMinor: 0,
        isPartialMonth: true,
        daysElapsed: 23,
        daysInMonth: 30,
        lines: [],
        totals: {
          targetPercentBps: 0,
          actualPercentBps: 0,
          targetAmountMinor: 0,
          actualAmountMinor: 0,
          shortfallMinor: 0,
        },
      },
      goals: [],
      plannedExpenses: {
        dueThisMonthMinor: 0,
        upcoming6MonthsMinor: 0,
        monthlySetAsideRequiredMinor: 0,
        setAsidePaidThisMonthMinor: 0,
        warningCount: 0,
        warnings: [],
        items: [],
        readyToPay: [],
      },
      budget: {
        month: '2026-09',
        hasDraft: false,
        canCreate: true,
        leftoverMinor: null,
        nextMonth: '2026-10',
        nextMonthHasDraft: false,
        suggestNextMonth: false,
      },
    });
    expect(parsed.daysElapsed).toBe(23);
    expect(parsed.budget.leftoverMinor).toBeNull();
  });
});

describe('MonthsAvailableDtoSchema', () => {
  it('przyjmuje listę miesięcy', () => {
    const parsed = MonthsAvailableDtoSchema.parse({
      currentMonth: '2026-09',
      months: ['2026-08', '2026-09'],
    });
    expect(parsed.months).toEqual(['2026-08', '2026-09']);
  });
});

describe('MonthCategoriesDtoSchema', () => {
  it('przyjmuje rozbicie z drzewem', () => {
    const parsed = MonthCategoriesDtoSchema.parse({
      month: '2026-09',
      previousMonth: '2026-08',
      expenseMinor: 187_400,
      items: [{ ...SPENDING, shareBps: 10_000, children: [] }],
    });
    expect(parsed.items[0]?.shareBps).toBe(10_000);
  });
});

describe('sekcje F4-7', () => {
  it('liczniki nieujemne — ujemny licznik zaległych to błąd kontraktu', () => {
    expect(
      MonthRecurringSectionDtoSchema.safeParse({
        plannedTotalMinor: 0,
        postedTotalMinor: 0,
        pendingCount: 0,
        overdueCount: -1,
        items: [],
      }).success,
    ).toBe(false);
  });
});
