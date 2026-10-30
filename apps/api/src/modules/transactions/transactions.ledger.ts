import type { DbHandle } from '../../db/client.js';
import {
  countTransactionsFromIncomeSource,
  countTransactionsInCategory,
  findCategoryIdsUsedSince,
  findFirstTransactionMonth,
  findDuplicateCandidates,
  findGoalTransfers,
  findMonthLedger,
  reassignTransactionsCategory,
  setTransactionOccurrence,
  sumAccountFlows,
  sumAccountNetByMonth,
  sumAllocationByMonth,
  sumCategorySpendByMonth,
  sumCategoryUsage,
  sumLiabilityPayments,
  sumPlannedSetAside,
  type AccountFlowRow,
  type AccountMonthNetRow,
  type AllocationMonthRow,
  type CategoryMonthSpendRow,
  type CategoryUsageRow,
  type DuplicateCandidateRow,
  type GoalTransferRow,
  type LiabilityPaymentRow,
  type MonthLedgerRow,
  type PlannedSetAsideRow,
} from './transactions.repository.js';

/**
 * Odczyty i zapisy księgi dla **innych modułów** — publiczne wejście do danych transakcji
 * (02 §3, reguła 4: moduł sięga po cudze dane przez serwis, nie przez repozytorium).
 *
 * Oddzielone od `transactions.service.ts` (CRUD, `F2-5`), bo serwis transakcji sam woła
 * serwisy kont, kategorii i źródeł, a te wołają tutaj. W jednym pliku byłby to cykl
 * importów między serwisami (ADR-035). Ten plik importuje wyłącznie repozytorium.
 */

/** Ruch netto na koncie w dwóch przekrojach czasu. */
export type AccountFlow = AccountFlowRow;

/**
 * Zwraca ruch netto na kontach gospodarstwa: przed miesiącem i do dnia `asOf`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param monthStart - Pierwszy dzień miesiąca (granica wyłącznie).
 * @param asOf - Dzień salda (granica włącznie).
 * @returns Mapa identyfikator konta → ruch; brak wpisu znaczy brak ruchu.
 */
export function accountFlows(
  handle: DbHandle,
  householdId: string,
  monthStart: string,
  asOf: string,
): ReadonlyMap<string, AccountFlow> {
  return new Map(
    sumAccountFlows(handle, householdId, monthStart, asOf).map((row) => [row.accountId, row]),
  );
}

/**
 * Czy kategoria ma jakąkolwiek transakcję, także miękko usuniętą (I-10, ADR-033).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param categoryId - Identyfikator kategorii.
 * @returns `true`, gdy kategorii nie wolno usunąć.
 */
export function categoryHasTransactions(
  handle: DbHandle,
  householdId: string,
  categoryId: string,
): boolean {
  return countTransactionsInCategory(handle, householdId, categoryId) > 0;
}

/**
 * Przepina transakcje kategorii źródłowej na docelową (07 §9.3).
 *
 * Nie otwiera transakcji bazodanowej — scalenie jest jedną operacją, której granicę
 * wyznacza serwis kategorii.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param fromCategoryId - Kategoria źródłowa.
 * @param toCategoryId - Kategoria docelowa.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba przepiętych transakcji.
 */
export function moveTransactionsToCategory(
  handle: DbHandle,
  householdId: string,
  fromCategoryId: string,
  toCategoryId: string,
  now: number,
): number {
  return reassignTransactionsCategory(handle, householdId, fromCategoryId, toCategoryId, now);
}

/**
 * Czy źródło przychodu ma jakąkolwiek transakcję, także miękko usuniętą (I-10, ADR-033).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param incomeSourceId - Identyfikator źródła.
 * @returns `true`, gdy źródła nie wolno usunąć.
 */
export function incomeSourceHasTransactions(
  handle: DbHandle,
  householdId: string,
  incomeSourceId: string,
): boolean {
  return countTransactionsFromIncomeSource(handle, householdId, incomeSourceId) > 0;
}

/** Użycie jednej kategorii: liczba transakcji i suma w miesiącu. */
export type CategoryUsage = CategoryUsageRow;

/**
 * Zwraca użycie kategorii gospodarstwa — do ekranu ustawień kategorii (06 §3.11, ADR-038).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param monthKey - Miesiąc sumy.
 * @returns Wiersze wyłącznie dla kategorii z transakcjami.
 */
export function categoryUsage(
  handle: DbHandle,
  householdId: string,
  monthKey: string,
): readonly CategoryUsage[] {
  return sumCategoryUsage(handle, householdId, monthKey);
}

/** Płatności na jedno zobowiązanie. */
export type LiabilityPayments = LiabilityPaymentRow;

/**
 * Zwraca raty zobowiązań gospodarstwa — do stanu zobowiązań i majątku netto (07 §5.1, §7).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param monthKey - Miesiąc „zapłacono w tym miesiącu".
 * @param asOf - Ostatni dzień liczonych rat; dla stanu na dziś — cały zapis.
 * @returns Mapa identyfikator zobowiązania → płatności; brak wpisu znaczy brak rat.
 */
export function liabilityPayments(
  handle: DbHandle,
  householdId: string,
  monthKey: string,
  asOf: string,
): ReadonlyMap<string, LiabilityPayments> {
  return new Map(
    sumLiabilityPayments(handle, householdId, monthKey, asOf).map((row) => [row.liabilityId, row]),
  );
}

/**
 * Wiąże transakcję z wystąpieniem reguły, które ona opłaca — „Zapisz jako wydatek stały"
 * (`F4-8`, ADR-051). Od tej chwili działa I-12: usunięcie transakcji cofa zaksięgowanie,
 * zmiana kwoty przechodzi na wystąpienie.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param transactionId - Transakcja źródłowa reguły.
 * @param occurrenceId - Wystąpienie zaksięgowane tą transakcją.
 * @param now - Znacznik `updated_at`.
 * @returns `true`, gdy powiązanie zapisano; `false` — transakcja w koszu albo już powiązana.
 */
export function linkTransactionToOccurrence(
  handle: DbHandle,
  householdId: string,
  transactionId: string,
  occurrenceId: string,
  now: number,
): boolean {
  return setTransactionOccurrence(handle, householdId, transactionId, occurrenceId, now);
}

/** Sumy pul jednego miesiąca. */
export type AllocationMonthSums = AllocationMonthRow;

/**
 * Sumy pul miesiąc po miesiącu — rozkład docelowy, trend i przelicznik celów
 * (07 §2.3, §2.4). Miesiące bez transakcji dostają zera, więc wynik ma wpis dla
 * każdego miesiąca zakresu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param fromMonth - Pierwszy miesiąc (włącznie).
 * @param toMonth - Ostatni miesiąc (włącznie).
 * @returns Mapa miesiąc → sumy; brak wpisu znaczy zera.
 */
export function allocationSumsByMonth(
  handle: DbHandle,
  householdId: string,
  fromMonth: string,
  toMonth: string,
): ReadonlyMap<string, AllocationMonthSums> {
  return new Map(
    sumAllocationByMonth(handle, householdId, fromMonth, toMonth).map((row) => [row.monthKey, row]),
  );
}

/** Przelew oznaczony celem. */
export type GoalTransfer = GoalTransferRow;

/**
 * Zaksięgowane przelewy oznaczone celami gospodarstwa (07 §4.1).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Przelewy z `goalId`, poza koszem.
 */
export function goalTransfers(handle: DbHandle, householdId: string): readonly GoalTransfer[] {
  return findGoalTransfers(handle, householdId);
}

/** Ruch netto na koncie w miesiącu. */
export type AccountMonthNet = AccountMonthNetRow;

/**
 * Ruch netto na kontach miesiąc po miesiącu — tempo celów śledzonych saldem (07 §4.2).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param accountIds - Konta.
 * @param fromMonth - Pierwszy miesiąc (włącznie).
 * @param toMonth - Ostatni miesiąc (włącznie).
 * @returns Wiersze konto–miesiąc z ruchem.
 */
export function accountNetByMonth(
  handle: DbHandle,
  householdId: string,
  accountIds: readonly string[],
  fromMonth: string,
  toMonth: string,
): readonly AccountMonthNet[] {
  return sumAccountNetByMonth(handle, householdId, accountIds, fromMonth, toMonth);
}

/** Wpłaty na odkładanie jednego wydatku. */
export type PlannedSetAside = PlannedSetAsideRow;

/**
 * Wpłaty na odkładanie planowanych wydatków gospodarstwa (07 §6.5).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param monthKey - Miesiąc „wpłacono w tym miesiącu".
 * @returns Mapa wydatek → wpłaty; brak wpisu znaczy brak wpłat.
 */
export function plannedSetAside(
  handle: DbHandle,
  householdId: string,
  monthKey: string,
): ReadonlyMap<string, PlannedSetAside> {
  return new Map(
    sumPlannedSetAside(handle, householdId, monthKey).map((row) => [row.plannedExpenseId, row]),
  );
}

/** Transakcja-kandydat na duplikat pozycji dokumentu. */
export type DuplicateCandidate = DuplicateCandidateRow;

/**
 * Kandydaci na duplikat pozycji wyciągu (08 §10, `F7-5`).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param from - Pierwszy dzień zakresu.
 * @param to - Ostatni dzień zakresu.
 * @param amounts - Kwoty pozycji.
 * @returns Zaksięgowane transakcje spoza kosza o tych kwotach.
 */
export function duplicateCandidates(
  handle: DbHandle,
  householdId: string,
  from: string,
  to: string,
  amounts: readonly number[],
): readonly DuplicateCandidate[] {
  return findDuplicateCandidates(handle, householdId, from, to, amounts);
}

/**
 * Kategorie użyte od podanego dnia — przy ponad 120 kategoriach kontekst AI zostawia
 * używane w ostatnich 6 miesiącach i systemowe (08 §4, `F7-4`).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param from - Pierwszy dzień.
 * @returns Zbiór identyfikatorów kategorii.
 */
export function categoriesUsedSince(
  handle: DbHandle,
  householdId: string,
  from: string,
): ReadonlySet<string> {
  return new Set(findCategoryIdsUsedSince(handle, householdId, from));
}

/** Wydatek zmienny kategorii w miesiącu. */
export type CategoryMonthSpend = CategoryMonthSpendRow;

/**
 * Zwraca wydatki zmienne po kategorii i miesiącu — do średniej planera (07 §13.3).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param fromMonth - Pierwszy miesiąc okna (włącznie).
 * @param toMonth - Ostatni miesiąc okna (włącznie).
 * @returns Wiersze dla par kategoria–miesiąc z wydatkiem.
 */
export function categorySpendByMonth(
  handle: DbHandle,
  householdId: string,
  fromMonth: string,
  toMonth: string,
): readonly CategoryMonthSpend[] {
  return sumCategorySpendByMonth(handle, householdId, fromMonth, toMonth);
}

/**
 * Zwraca miesiąc pierwszej transakcji gospodarstwa — początek historii (07 §13.3).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Klucz miesiąca albo `null` bez transakcji.
 */
export function firstTransactionMonth(handle: DbHandle, householdId: string): string | null {
  return findFirstTransactionMonth(handle, householdId);
}

/** Zaksięgowana transakcja miesiąca z regułą wystąpienia. */
export type MonthLedgerEntry = MonthLedgerRow;

/**
 * Zaksięgowane transakcje miesiąca — plan kontra wykonanie w szkicu (07 §13.8).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param monthKey - Miesiąc szkicu.
 * @returns Transakcje `posted` spoza kosza.
 */
export function monthLedger(
  handle: DbHandle,
  householdId: string,
  monthKey: string,
): readonly MonthLedgerEntry[] {
  return findMonthLedger(handle, householdId, monthKey);
}
