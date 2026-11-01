import { MAX_DELTA_BPS, MonthComparisonDtoSchema } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import type {
  CategoryExpenseRow,
  ExpenseCategoryRow,
  MonthTotalsRow,
} from './months.repository.js';
import {
  buildMonthTotals,
  compareMonths,
  rollUpCategorySpending,
  topCategories,
  UNCATEGORIZED_NAME,
} from './months.rules.js';

/**
 * Testy czystych reguł ekranu miesiąca
 * ([07 §12](../../../../../../plans/07-domain-rules.md#12-ekran-miesiąca)).
 */

/** Sumy zerowe do nadpisywania. */
const ZERO: MonthTotalsRow = {
  transactionCount: 0,
  incomeMinor: 0,
  incomeBaseMinor: 0,
  expenseMinor: 0,
  savingsMinor: 0,
  investmentMinor: 0,
  debtRepaymentMinor: 0,
};

describe('buildMonthTotals', () => {
  it('liczy wynik netto z przykładu 04 §14', () => {
    const totals = buildMonthTotals({
      ...ZERO,
      incomeMinor: 1_180_000,
      incomeBaseMinor: 1_180_000,
      expenseMinor: 642_300,
      savingsMinor: 200_000,
      investmentMinor: 118_000,
      debtRepaymentMinor: 185_000,
    });
    expect(totals.netMinor).toBe(219_700);
    expect(totals.unallocatedMinor).toBe(219_700);
  });

  it('spłata zobowiązań nie jest odejmowana drugi raz — już siedzi w wydatkach', () => {
    const totals = buildMonthTotals({
      ...ZERO,
      incomeMinor: 500_000,
      expenseMinor: 250_000,
      debtRepaymentMinor: 250_000,
    });
    expect(totals.netMinor).toBe(250_000);
  });

  it('wypłata z oszczędności zwiększa wynik netto (ADR-011)', () => {
    const totals = buildMonthTotals({ ...ZERO, expenseMinor: 150_000, savingsMinor: -150_000 });
    expect(totals.savingsMinor).toBe(-150_000);
    expect(totals.netMinor).toBe(0);
  });

  it('miesiąc na minusie: netto ujemne, wolne środki zero', () => {
    const totals = buildMonthTotals({ ...ZERO, incomeMinor: 100, expenseMinor: 350 });
    expect(totals.netMinor).toBe(-250);
    expect(totals.unallocatedMinor).toBe(0);
  });

  it('pusty miesiąc — same zera', () => {
    const totals = buildMonthTotals(ZERO);
    expect(Object.values(totals).every((value) => value === 0)).toBe(true);
  });
});

describe('compareMonths', () => {
  it('liczy różnice i procent względem poprzedniego miesiąca', () => {
    const comparison = compareMonths(
      { ...ZERO, transactionCount: 5, incomeMinor: 1_180_000, expenseMinor: 642_300 },
      { ...ZERO, transactionCount: 5, incomeMinor: 1_180_000, expenseMinor: 683_500 },
      '2026-08',
    );
    expect(comparison).toEqual({
      previousMonth: '2026-08',
      hasPreviousData: true,
      incomeDeltaMinor: 0,
      incomeDeltaBps: 0,
      expenseDeltaMinor: -41_200,
      expenseDeltaBps: -603,
    });
  });

  it('wzrost względem małej podstawy obcięty do +1000% (ADR-084)', () => {
    // 50 zł wpływów w październiku, 6 000 zł w listopadzie: +11 900%.
    const comparison = compareMonths(
      { ...ZERO, transactionCount: 3, incomeMinor: 600_000, expenseMinor: 1_200_000 },
      { ...ZERO, transactionCount: 2, incomeMinor: 5_000, expenseMinor: 10_000 },
      '2026-10',
    );
    expect(comparison.incomeDeltaMinor).toBe(595_000);
    expect(comparison.incomeDeltaBps).toBe(MAX_DELTA_BPS);
    expect(comparison.expenseDeltaBps).toBe(MAX_DELTA_BPS);
    expect(() => MonthComparisonDtoSchema.parse(comparison)).not.toThrow();
  });

  it('dokładnie +1000% przechodzi bez zmian, spadek do −100% też', () => {
    const comparison = compareMonths(
      { ...ZERO, transactionCount: 1, incomeMinor: 110_000 },
      { ...ZERO, transactionCount: 1, incomeMinor: 10_000, expenseMinor: 10_000 },
      '2026-10',
    );
    expect(comparison.incomeDeltaBps).toBe(100_000);
    expect(comparison.expenseDeltaBps).toBe(-10_000);
  });

  it('zerowa podstawa: procent 0 zamiast NaN, flaga braku danych', () => {
    const comparison = compareMonths(
      { ...ZERO, transactionCount: 1, expenseMinor: 5_000 },
      ZERO,
      '2026-08',
    );
    expect(comparison.hasPreviousData).toBe(false);
    expect(comparison.expenseDeltaMinor).toBe(5_000);
    expect(comparison.expenseDeltaBps).toBe(0);
  });

  it('poprzedni miesiąc z samymi przelewami ma dane, choć bez wydatków', () => {
    const comparison = compareMonths(ZERO, { ...ZERO, transactionCount: 1 }, '2026-08');
    expect(comparison.hasPreviousData).toBe(true);
    expect(comparison.expenseDeltaBps).toBe(0);
  });
});

describe('rollUpCategorySpending', () => {
  const FOOD = 'food';
  const COFFEE = 'coffee';
  const SHOP = 'shop';
  const HOME = 'home';
  const CATEGORIES: ExpenseCategoryRow[] = [
    {
      id: FOOD,
      parentId: null,
      name: 'Jedzenie',
      color: '#112233',
      icon: 'utensils',
      sortOrder: 0,
    },
    { id: COFFEE, parentId: FOOD, name: 'Kawiarnie', color: null, icon: null, sortOrder: 0 },
    { id: SHOP, parentId: FOOD, name: 'Sklep', color: null, icon: null, sortOrder: 1 },
    { id: HOME, parentId: null, name: 'Mieszkanie', color: null, icon: 'home', sortOrder: 1 },
  ];

  /**
   * Wiersz sumy kategorii.
   *
   * @param categoryId - Kategoria transakcji.
   * @param amountMinor - Kwota w miesiącu.
   * @param previousAmountMinor - Kwota miesiąc wcześniej.
   * @param transactionCount - Liczba transakcji w miesiącu.
   * @returns Wiersz.
   */
  function row(
    categoryId: string | null,
    amountMinor: number,
    previousAmountMinor = 0,
    transactionCount = 1,
  ): CategoryExpenseRow {
    return { categoryId, amountMinor, previousAmountMinor, transactionCount };
  }

  it('zwija podkategorie do rodzica i zachowuje je jako dzieci', () => {
    const tree = rollUpCategorySpending(
      [row(COFFEE, 1_500), row(SHOP, 8_500, 0, 3), row(FOOD, 1_000), row(HOME, 5_000)],
      CATEGORIES,
    );
    expect(tree.map((item) => [item.name, item.amountMinor])).toEqual([
      ['Jedzenie', 11_000],
      ['Mieszkanie', 5_000],
    ]);
    expect(tree[0]).toMatchObject({
      categoryId: FOOD,
      color: '#112233',
      icon: 'utensils',
      transactionCount: 5,
      shareBps: 6875,
    });
    expect(tree[0]?.children.map((child) => [child.name, child.amountMinor])).toEqual([
      ['Sklep', 8_500],
      ['Kawiarnie', 1_500],
    ]);
    expect(tree[1]?.children).toEqual([]);
  });

  it('suma rozbicia zawsze równa się wydatkom — także bez kategorii i z nieznaną', () => {
    const tree = rollUpCategorySpending(
      [row(null, 2_000), row('ghost', 500), row(HOME, 7_500)],
      CATEGORIES,
    );
    expect(tree.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(10_000);
    const none = tree.find((item) => item.categoryId === null);
    expect(none).toMatchObject({
      name: UNCATEGORIZED_NAME,
      amountMinor: 2_500,
      transactionCount: 2,
      shareBps: 2500,
      children: [],
    });
  });

  it('bez wydatków w poprzednim miesiącu porównanie to `null`', () => {
    const tree = rollUpCategorySpending([row(HOME, 5_000)], CATEGORIES);
    expect(tree[0]?.previousMonthAmountMinor).toBeNull();
  });

  it('z wydatkami w poprzednim miesiącu: zero tam, gdzie kategorii nie było', () => {
    const tree = rollUpCategorySpending([row(HOME, 5_000), row(FOOD, 0, 3_000, 0)], CATEGORIES);
    expect(tree.find((item) => item.categoryId === HOME)?.previousMonthAmountMinor).toBe(0);
    // Kategoria tylko z poprzedniego miesiąca zostaje — spadek do zera też jest informacją.
    expect(tree.find((item) => item.categoryId === FOOD)).toMatchObject({
      amountMinor: 0,
      shareBps: 0,
      previousMonthAmountMinor: 3_000,
    });
  });

  it('pusty miesiąc — pusta lista, bez dzielenia przez zero', () => {
    expect(rollUpCategorySpending([], CATEGORIES)).toEqual([]);
  });

  it('remis kwot rozstrzyga kwota poprzednia, potem nazwa', () => {
    const tree = rollUpCategorySpending([row(HOME, 1_000, 0), row(FOOD, 1_000, 500)], CATEGORIES);
    expect(tree.map((item) => item.name)).toEqual(['Jedzenie', 'Mieszkanie']);
  });
});

describe('topCategories', () => {
  it('bierze najwyżej pięć kategorii z wydatkiem w miesiącu, bez dzieci', () => {
    const categories: ExpenseCategoryRow[] = Array.from({ length: 7 }, (_, index) => ({
      id: `c${String(index)}`,
      parentId: null,
      name: `K${String(index)}`,
      color: null,
      icon: null,
      sortOrder: index,
    }));
    const rows: CategoryExpenseRow[] = categories.map((category, index) => ({
      categoryId: category.id,
      amountMinor: index === 0 ? 0 : index * 100,
      previousAmountMinor: 50,
      transactionCount: index === 0 ? 0 : 1,
    }));
    const top = topCategories(rollUpCategorySpending(rows, categories));
    expect(top.map((item) => item.name)).toEqual(['K6', 'K5', 'K4', 'K3', 'K2']);
    expect(top[0]).not.toHaveProperty('children');
  });
});
