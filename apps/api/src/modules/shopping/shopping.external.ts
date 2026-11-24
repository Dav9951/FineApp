import type { DbHandle } from '../../db/client.js';
import { sumShoppingAiUsage } from './shopping.repository.js';

/**
 * Wejście do list zakupów dla **innych modułów** — zużycie AI w Ustawieniach (ADR-107).
 *
 * Osobny plik z tego samego powodu co `documents.external.ts` (02 §4): moduł `shopping`
 * woła dokumenty (wspólny licznik kosztów), więc dokumenty nie importują jego serwisu.
 * Ten plik importuje wyłącznie repozytorium.
 */

/**
 * Odczyty list i przepisów w zakresie czasu — liczba i tokeny.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param from - Początek (epoch ms, włącznie).
 * @param to - Koniec (epoch ms, wyłącznie).
 * @returns Liczba odczytów i tokeny.
 */
export function shoppingAiUsage(
  handle: DbHandle,
  householdId: string,
  from: number,
  to: number,
): { count: number; inputTokens: number; outputTokens: number } {
  return sumShoppingAiUsage(handle, householdId, from, to);
}
