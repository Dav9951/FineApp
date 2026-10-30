import type { DbHandle } from '../../db/client.js';
import { reassignBudgetLinesCategory } from './budget.repository.js';

/**
 * Wejście do planera budżetu dla **innych modułów**: przepinanie linii przy scalaniu
 * kategorii (07 §9.3, ADR-079).
 *
 * Osobny plik z tego samego powodu co `planned-expenses.external.ts` (ADR-035): serwis
 * budżetu będzie wołał serwisy kategorii i źródeł (`F9-4`), więc wejście przez serwis
 * dawałoby cykl. Ten plik importuje wyłącznie repozytorium.
 */

/**
 * Przepina linie szkiców budżetu przy scalaniu kategorii (07 §9.3).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param fromCategoryId - Kategoria źródłowa.
 * @param toCategoryId - Kategoria docelowa.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba przepiętych linii.
 */
export function moveBudgetLinesToCategory(
  handle: DbHandle,
  householdId: string,
  fromCategoryId: string,
  toCategoryId: string,
  now: number,
): number {
  return reassignBudgetLinesCategory(handle, householdId, fromCategoryId, toCategoryId, now);
}
