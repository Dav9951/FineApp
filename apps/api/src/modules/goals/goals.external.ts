import type { DbHandle } from '../../db/client.js';
import { findGoalById, goalExists } from './goals.repository.js';

/**
 * Wejście do celów dla **innych modułów** — sprawdzenie odwołania z transakcji i reguł.
 *
 * Osobny plik z tego samego powodu co `liabilities.external.ts` (ADR-035): serwis celów
 * (`F5-1`) woła serwis transakcji (wpłata na cel, historia wpłat), a ten sprawdza
 * odwołanie do celu — przez serwis byłby to cykl. Ten plik importuje wyłącznie repozytorium.
 */

/**
 * Czy cel należy do gospodarstwa — dla serwisu transakcji (`goalId` z żądania).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param goalId - Identyfikator z żądania.
 * @returns `true`, gdy wolno go wskazać.
 */
export function isGoalInHousehold(handle: DbHandle, householdId: string, goalId: string): boolean {
  return goalExists(handle, householdId, goalId);
}

/**
 * Konto powiązane z celem — dokąd trafia odkładanie na planowany wydatek, gdy zbiera
 * się na cel (07 §6.5, `F6-3`).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param goalId - Identyfikator celu.
 * @returns Konto celu; `null` — cel bez konta; `undefined` — celu nie ma.
 */
export function goalLinkedAccount(
  handle: DbHandle,
  householdId: string,
  goalId: string,
): string | null | undefined {
  const row = findGoalById(handle, householdId, goalId);
  return row === undefined ? undefined : row.linkedAccountId;
}
