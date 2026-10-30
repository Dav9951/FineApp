import type { DbHandle } from '../../db/client.js';
import {
  findPlannedExpenseById,
  patchPlannedExpense,
  reassignPlannedExpensesCategory,
} from './planned-expenses.repository.js';

/**
 * Wejście do planowanych wydatków dla **innych modułów**: skutki usunięcia, przywrócenia
 * i zmiany kwoty transakcji zapłaty (07 §6.7, I-18) oraz przepinanie przy scalaniu
 * kategorii (07 §9.3, `Z-13`).
 *
 * Osobny plik z tego samego powodu co `recurring.external.ts` (ADR-035): serwis wydatków
 * woła serwis transakcji, a ten przy usuwaniu cofa zaksięgowanie — przez serwis byłby to
 * cykl. Ten plik importuje wyłącznie repozytorium.
 */

/**
 * Cofa zaksięgowanie wydatku, gdy jego transakcja zapłaty trafia do kosza (07 §6.7).
 *
 * Status wraca do `planned`, a odczyt wyliczy właściwy (`funding` / `ready`) z odłożonej
 * kwoty i terminu. Instancja na kolejny rok zostaje — to osobny wydatek.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param plannedExpenseId - Wydatek wskazywany przez transakcję.
 * @param transactionId - Usuwana transakcja.
 * @param now - Znacznik `updated_at`.
 * @returns `true`, gdy zaksięgowanie cofnięto.
 */
export function unpostPlannedOfTransaction(
  handle: DbHandle,
  householdId: string,
  plannedExpenseId: string,
  transactionId: string,
  now: number,
): boolean {
  const row = findPlannedExpenseById(handle, householdId, plannedExpenseId);
  if (row?.status !== 'posted' || row.transactionId !== transactionId) return false;
  patchPlannedExpense(
    handle,
    householdId,
    plannedExpenseId,
    { status: 'planned', transactionId: null, postedAmountMinor: null, postedAt: null },
    now,
  );
  return true;
}

/**
 * Wiąże przywróconą z kosza transakcję zapłaty z wydatkiem — o ile nie zapłacono go
 * w międzyczasie inaczej i nie odwołano (07 §6.7).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param plannedExpenseId - Wydatek wskazywany przez transakcję.
 * @param transaction - Przywracana transakcja.
 * @param transaction.id - Identyfikator.
 * @param transaction.amountMinor - Kwota.
 * @param now - Znacznik `updated_at` i `posted_at`.
 * @returns `true`, gdy wydatek znów jest zaksięgowany tą transakcją.
 */
export function relinkPlannedOfTransaction(
  handle: DbHandle,
  householdId: string,
  plannedExpenseId: string,
  transaction: { readonly id: string; readonly amountMinor: number },
  now: number,
): boolean {
  const row = findPlannedExpenseById(handle, householdId, plannedExpenseId);
  if (row === undefined || row.status === 'posted' || row.status === 'cancelled') return false;
  patchPlannedExpense(
    handle,
    householdId,
    plannedExpenseId,
    {
      status: 'posted',
      transactionId: transaction.id,
      postedAmountMinor: transaction.amountMinor,
      postedAt: now,
    },
    now,
  );
  return true;
}

/**
 * Przenosi zmianę kwoty transakcji zapłaty na wydatek — `posted_amount_minor` to kopia.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param plannedExpenseId - Wydatek wskazywany przez transakcję.
 * @param transactionId - Zmieniona transakcja.
 * @param amountMinor - Nowa kwota.
 * @param now - Znacznik `updated_at`.
 */
export function syncPlannedPostedAmount(
  handle: DbHandle,
  householdId: string,
  plannedExpenseId: string,
  transactionId: string,
  amountMinor: number,
  now: number,
): void {
  const row = findPlannedExpenseById(handle, householdId, plannedExpenseId);
  if (row?.status !== 'posted' || row.transactionId !== transactionId) return;
  patchPlannedExpense(
    handle,
    householdId,
    plannedExpenseId,
    { postedAmountMinor: amountMinor },
    now,
  );
}

/**
 * Przepina planowane wydatki przy scalaniu kategorii (07 §9.3, `Z-13`).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param fromCategoryId - Kategoria źródłowa.
 * @param toCategoryId - Kategoria docelowa.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba przepiętych wydatków.
 */
export function movePlannedExpensesToCategory(
  handle: DbHandle,
  householdId: string,
  fromCategoryId: string,
  toCategoryId: string,
  now: number,
): number {
  return reassignPlannedExpensesCategory(handle, householdId, fromCategoryId, toCategoryId, now);
}
