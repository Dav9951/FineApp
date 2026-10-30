import type { DbHandle } from '../../db/client.js';
import { reassignItemsCategory } from './documents.repository.js';

/**
 * Wejście do dokumentów dla **innych modułów** — przepinanie przy scalaniu kategorii
 * (07 §9.3, `Z-13`).
 *
 * Osobny plik z tego samego powodu co `planned-expenses.external.ts` (ADR-035): serwis
 * dokumentów woła serwis kategorii (commit zakłada nowe), więc kategorie nie mogą
 * importować serwisu dokumentów. Ten plik importuje wyłącznie repozytorium.
 */

/**
 * Przepina propozycje kategorii w pozycjach dokumentów na kategorię docelową scalenia.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param fromCategoryId - Kategoria scalana (sprawdzona w gospodarstwie).
 * @param toCategoryId - Kategoria docelowa.
 * @param now - Znacznik `updated_at`.
 */
export function moveDocumentItemsToCategory(
  handle: DbHandle,
  householdId: string,
  fromCategoryId: string,
  toCategoryId: string,
  now: number,
): void {
  reassignItemsCategory(handle, householdId, fromCategoryId, toCategoryId, now);
}
