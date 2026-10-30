import {
  toBps,
  type CategorySpendingDto,
  type CategorySpendingTreeDto,
  type MonthComparisonDto,
  type MonthKey,
  type MonthTotalsDto,
} from '@fineapp/shared';

import type {
  CategoryExpenseRow,
  ExpenseCategoryRow,
  MonthTotalsRow,
} from './months.repository.js';

/**
 * Czyste reguły ekranu miesiąca — bez bazy i bez zegara
 * ([07 §12](../../../../../../plans/07-domain-rules.md#12-ekran-miesiąca)).
 *
 * Serwis zbiera dane, tutaj powstają z nich liczby. Każda funkcja ma test.
 */

/** Nazwa pozycji dla wydatków bez kategorii (07 §9.2). */
export const UNCATEGORIZED_NAME = 'Bez kategorii';

/** Ile kategorii głównych pokazuje kafel „Na co idą pieniądze". */
export const TOP_CATEGORIES_LIMIT = 5;

/**
 * Składa sumy miesiąca z wyniku zapytania.
 *
 * `net = income − expense − savings − investment`. Spłata zobowiązań **nie** jest
 * odejmowana osobno — rata to wydatek, więc już siedzi w `expense` (07 §2.2a).
 * Oszczędności i inwestycje liczone netto (ADR-011): wypłata z poduszki zwiększa wynik
 * netto, bo te pieniądze wróciły do wydawania.
 *
 * `unallocated = max(0, net)` — kwota, którą da się jeszcze gdzieś skierować. Miesiąc
 * na minusie nie ma czego rozdysponować; minus pokazuje `net` (ADR-039).
 *
 * @param row - Sumy z repozytorium.
 * @returns Sumy w kształcie kontraktu.
 */
export function buildMonthTotals(row: MonthTotalsRow): MonthTotalsDto {
  const netMinor = row.incomeMinor - row.expenseMinor - row.savingsMinor - row.investmentMinor;
  return {
    incomeMinor: row.incomeMinor,
    incomeBaseMinor: row.incomeBaseMinor,
    expenseMinor: row.expenseMinor,
    savingsMinor: row.savingsMinor,
    investmentMinor: row.investmentMinor,
    debtRepaymentMinor: row.debtRepaymentMinor,
    netMinor,
    unallocatedMinor: Math.max(0, netMinor),
  };
}

/**
 * Porównuje miesiąc z poprzednim (06 §1, zasada 4: „liczba zawsze z kontekstem").
 *
 * Zmiana procentowa odnosi się do poprzedniego miesiąca. Gdy tam było zero, procent
 * jest nieokreślony — `toBps` zwraca `0`, a `hasPreviousData` mówi, czy porównanie
 * w ogóle ma sens (pułapka „procent przy zerowej podstawie", 12 §6).
 *
 * @param current - Sumy oglądanego miesiąca.
 * @param previous - Sumy poprzedniego miesiąca.
 * @param previousMonth - Klucz poprzedniego miesiąca.
 * @returns Porównanie w kształcie kontraktu.
 */
export function compareMonths(
  current: MonthTotalsRow,
  previous: MonthTotalsRow,
  previousMonth: MonthKey,
): MonthComparisonDto {
  const incomeDeltaMinor = current.incomeMinor - previous.incomeMinor;
  const expenseDeltaMinor = current.expenseMinor - previous.expenseMinor;
  return {
    previousMonth,
    hasPreviousData: previous.transactionCount > 0,
    incomeDeltaMinor,
    incomeDeltaBps: toBps(incomeDeltaMinor, previous.incomeMinor),
    expenseDeltaMinor,
    expenseDeltaBps: toBps(expenseDeltaMinor, previous.expenseMinor),
  };
}

/** Suma robocza jednej pozycji rozbicia. */
interface Bucket {
  amountMinor: number;
  transactionCount: number;
  previousAmountMinor: number;
}

/**
 * Porządek rozbicia: malejąco po kwocie, potem po kwocie poprzedniej, potem po nazwie.
 *
 * @param a - Pierwsza pozycja.
 * @param b - Druga pozycja.
 * @returns Wynik porównania dla `Array.prototype.sort`.
 */
function byAmountDesc(a: CategorySpendingDto, b: CategorySpendingDto): number {
  return (
    b.amountMinor - a.amountMinor ||
    (b.previousMonthAmountMinor ?? 0) - (a.previousMonthAmountMinor ?? 0) ||
    a.name.localeCompare(b.name, 'pl')
  );
}

/**
 * Zwija wydatki per kategoria do kategorii głównych i liczy udziały.
 *
 * - Podkategorie doliczane do rodzica — kafel pokazuje „Jedzenie", nie osobno
 *   „Jedzenie › Kawiarnie" i „Jedzenie › Sklep".
 * - Wydatki bez kategorii są osobną pozycją „Bez kategorii" (07 §9.2), nie znikają.
 * - Transakcja z kategorią spoza listy (nie powinna się zdarzyć — I-4) trafia do
 *   „Bez kategorii", żeby suma rozbicia **zawsze** równała się wydatkom miesiąca.
 * - Udział: `toBps(kwota, wydatki miesiąca)`; przy zerowych wydatkach `0`. Udziały
 *   zaokrąglone osobno nie muszą sumować się do 10 000 — to etykiety, nie podział kwoty.
 * - `previousMonthAmountMinor` = `null`, gdy poprzedni miesiąc nie miał żadnego wydatku
 *   — strzałka „↑" przy pierwszym miesiącu używania aplikacji byłaby fałszywa.
 *
 * @param rows - Sumy per kategoria transakcji.
 * @param categories - Kategorie wydatków gospodarstwa (z archiwum).
 * @returns Kategorie główne malejąco po kwocie, każda z podkategoriami.
 */
export function rollUpCategorySpending(
  rows: readonly CategoryExpenseRow[],
  categories: readonly ExpenseCategoryRow[],
): CategorySpendingTreeDto[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const expenseMinor = rows.reduce((sum, row) => sum + row.amountMinor, 0);
  const hasPrevious = rows.some((row) => row.previousAmountMinor > 0);

  const roots = new Map<string | null, Bucket>();
  const children = new Map<string, Map<string, Bucket>>();
  const add = (bucket: Bucket, row: CategoryExpenseRow): void => {
    bucket.amountMinor += row.amountMinor;
    bucket.transactionCount += row.transactionCount;
    bucket.previousAmountMinor += row.previousAmountMinor;
  };
  const bucketOf = <K>(map: Map<K, Bucket>, key: K): Bucket => {
    const existing = map.get(key);
    if (existing) return existing;
    const created = { amountMinor: 0, transactionCount: 0, previousAmountMinor: 0 };
    map.set(key, created);
    return created;
  };

  for (const row of rows) {
    const category = row.categoryId === null ? undefined : byId.get(row.categoryId);
    if (category === undefined) {
      add(bucketOf(roots, null), row);
      continue;
    }
    const rootId =
      category.parentId !== null && byId.has(category.parentId) ? category.parentId : category.id;
    add(bucketOf(roots, rootId), row);
    if (rootId !== category.id) {
      const siblings = children.get(rootId) ?? new Map<string, Bucket>();
      children.set(rootId, siblings);
      add(bucketOf(siblings, category.id), row);
    }
  }

  const toDto = (id: string | null, bucket: Bucket): CategorySpendingDto => {
    const category = id === null ? undefined : byId.get(id);
    return {
      categoryId: id,
      name: category?.name ?? UNCATEGORIZED_NAME,
      color: category?.color ?? null,
      icon: category?.icon ?? null,
      amountMinor: bucket.amountMinor,
      shareBps: toBps(bucket.amountMinor, expenseMinor),
      transactionCount: bucket.transactionCount,
      previousMonthAmountMinor: hasPrevious ? bucket.previousAmountMinor : null,
    };
  };

  return [...roots.entries()]
    .map(([id, bucket]) => ({
      ...toDto(id, bucket),
      children:
        id === null
          ? []
          : [...(children.get(id) ?? new Map<string, Bucket>()).entries()]
              .map(([childId, child]) => toDto(childId, child))
              .sort(byAmountDesc),
    }))
    .sort(byAmountDesc);
}

/**
 * Wybiera kategorie na kafel dashboardu: z wydatkiem w tym miesiącu, najwyżej pięć.
 *
 * @param tree - Pełne rozbicie z {@link rollUpCategorySpending}.
 * @returns Kategorie główne bez podkategorii.
 */
export function topCategories(tree: readonly CategorySpendingTreeDto[]): CategorySpendingDto[] {
  return tree
    .filter((item) => item.amountMinor > 0)
    .slice(0, TOP_CATEGORIES_LIMIT)
    .map((item) => ({
      categoryId: item.categoryId,
      name: item.name,
      color: item.color,
      icon: item.icon,
      amountMinor: item.amountMinor,
      shareBps: item.shareBps,
      transactionCount: item.transactionCount,
      previousMonthAmountMinor: item.previousMonthAmountMinor,
    }));
}
