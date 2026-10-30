import {
  earliestPostableDate,
  latestPostableDate,
  monthKeyOf,
  monthTiming,
  shiftMonth,
  todayInTimezone,
  type MonthCategoriesDto,
  type MonthKey,
  type MonthSummaryDto,
  type MonthsAvailableDto,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import type { DbHandle } from '../../db/client.js';
import { getAccountBalances } from '../accounts/accounts.service.js';
import { allocationSectionForMonth } from '../allocation/allocation.service.js';
import { getHousehold } from '../auth/auth.service.js';
import { budgetSectionForMonth } from '../budget/budget.service.js';
import { goalsForMonth } from '../goals/goals.service.js';
import { plannedExpensesSectionForMonth } from '../planned-expenses/planned-expenses.service.js';
import { liabilitiesSectionForMonth } from '../liabilities/liabilities.service.js';
import { recurringSectionForMonth } from '../recurring/recurring.service.js';
import { listTransactions } from '../transactions/transactions.service.js';
import {
  findExpenseCategories,
  findMonthsWithTransactions,
  sumCategoryExpenses,
  sumMonthTotals,
} from './months.repository.js';
import {
  buildMonthTotals,
  compareMonths,
  rollUpCategorySpending,
  topCategories,
} from './months.rules.js';

/**
 * Ekran miesiąca — zadania `F3-1` i `F3-2`
 * ([04 §14](../../../../../../plans/04-api-spec.md#14-miesiąc--apiv1months)).
 *
 * Sumy i rozbicie kategorii liczy własne repozytorium (wyjątek z 02 §3). Salda kont
 * i ostatnie transakcje biorą się z serwisów właścicieli: to te same liczby, które
 * pokazują ekrany kont i historii, więc muszą pochodzić z tego samego kodu — dwa
 * wyliczenia salda prędzej czy później by się rozjechały.
 *
 * Sekcje Faz 4–6 i 9 dochodzą razem ze swoimi modułami (ADR-039, ADR-079).
 */

/** Ile ostatnich transakcji pokazuje dashboard (06 §3.1). */
const RECENT_LIMIT = 10;

/**
 * Zwraca podsumowanie miesiąca — cały dashboard w jednej odpowiedzi.
 *
 * Miesiąc przyszły nie jest błędem: to podgląd planu (06 §3.1), z zerowymi sumami
 * i saldami na koniec tamtego miesiąca.
 *
 * Odczyt miesiąca bieżącego albo wcześniejszego generuje brakujące wystąpienia cykliczne
 * i auto-księguje należne (07 §6.2) — przed sumami, żeby je obejmowały. Sekcje
 * `recurring` i `liabilities` od `F4-7` (ADR-050), `allocation` i `goals` od `F5-8`
 * (ADR-054) — po generowaniu, więc auto-zaksięgowana wpłata na cel już się liczy. Podgląd przyszłości niczego nie zapisuje.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu — „dziś" gospodarstwa wyznacza bieżący miesiąc i okno.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Osoba z tokenu — autor transakcji z auto-księgowania (07 §6.2).
 * @param month - Oglądany miesiąc.
 * @returns Podsumowanie miesiąca.
 */
export function getMonthSummary(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  month: MonthKey,
): MonthSummaryDto {
  const household = getHousehold(handle, householdId);
  const today = todayInTimezone(household.timezone, clock.now());
  const timing = monthTiming(month, today, household.monthStartDay);
  // Najpierw pozycje cykliczne: generowanie i auto-księgowanie muszą się zdarzyć przed
  // sumami, żeby miesiąc od razu obejmował auto-zaksięgowane (ADR-046).
  const recurring = recurringSectionForMonth(handle, clock, householdId, userId, month);
  const previousMonth = shiftMonth(month, -1);

  const current = sumMonthTotals(handle, householdId, month);
  const previous = sumMonthTotals(handle, householdId, previousMonth);
  const categoryRows = sumCategoryExpenses(handle, householdId, month, previousMonth);
  const tree = rollUpCategorySpending(categoryRows, findExpenseCategories(handle, householdId));
  const balances = getAccountBalances(handle, clock, householdId, { month });
  const recent = listTransactions(handle, householdId, {
    month,
    limit: RECENT_LIMIT,
    sort: 'bookedOn:desc',
    uncategorized: false,
    includeDeleted: false,
  });

  return {
    month,
    range: timing.range,
    isCurrent: timing.isCurrent,
    isPartial: timing.isPartial,
    isFuture: timing.isFuture,
    daysElapsed: timing.daysElapsed,
    daysInMonth: timing.daysInMonth,
    canPostBackTo: earliestPostableDate(today, household.backPostingLimitMonths),
    canPostUntil: latestPostableDate(today, household.monthStartDay),
    totals: buildMonthTotals(current),
    accounts: balances.data,
    netWorthMinor: balances.meta.netWorthMinor,
    topCategories: topCategories(tree),
    uncategorizedCount: categoryRows.find((row) => row.categoryId === null)?.transactionCount ?? 0,
    recentTransactions: recent.data,
    comparison: compareMonths(current, previous, previousMonth),
    recurring,
    liabilities: liabilitiesSectionForMonth(handle, clock, householdId, month),
    allocation: allocationSectionForMonth(handle, clock, householdId, month),
    goals: goalsForMonth(handle, clock, householdId, month),
    plannedExpenses: plannedExpensesSectionForMonth(handle, clock, householdId, month),
    budget: budgetSectionForMonth(handle, clock, householdId, month),
  };
}

/**
 * Zwraca miesiące z danymi i bieżący miesiąc — do nawigatora (06 §3.1).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Bieżący miesiąc i miesiące z transakcjami rosnąco.
 */
export function getAvailableMonths(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
): MonthsAvailableDto {
  const household = getHousehold(handle, householdId);
  const today = todayInTimezone(household.timezone, clock.now());
  return {
    currentMonth: monthKeyOf(today, household.monthStartDay),
    months: findMonthsWithTransactions(handle, householdId),
  };
}

/**
 * Zwraca rozbicie wydatków miesiąca po kategoriach z porównaniem do poprzedniego.
 *
 * Zastępuje zapowiadane `GET /categories/spending` — to ten sam raport (ADR-039, `Z-14`).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Oglądany miesiąc.
 * @returns Kategorie główne z podkategoriami, malejąco po kwocie.
 */
export function getMonthCategories(
  handle: DbHandle,
  householdId: string,
  month: MonthKey,
): MonthCategoriesDto {
  const previousMonth = shiftMonth(month, -1);
  const rows = sumCategoryExpenses(handle, householdId, month, previousMonth);
  return {
    month,
    previousMonth,
    expenseMinor: rows.reduce((sum, row) => sum + row.amountMinor, 0),
    items: rollUpCategorySpending(rows, findExpenseCategories(handle, householdId)),
  };
}
