import type { DbHandle } from '../../db/client.js';
import { liabilityPayments } from '../transactions/transactions.ledger.js';
import {
  findLiabilities,
  findLiabilityById,
  liabilityExists,
  patchLiability,
  reassignLiabilitiesCategory,
} from './liabilities.repository.js';

/**
 * Wejście do zobowiązań dla **innych modułów**: sprawdzenie odwołania z transakcji
 * i reguł, pozostała kwota do majątku netto (07 §7) i przepinanie przy scalaniu kategorii
 * (07 §9.3, `Z-13`).
 *
 * Osobny plik z tego samego powodu co `recurring.external.ts` (ADR-035): serwis zobowiązań
 * woła serwisy transakcji i reguł, a one sprawdzają odwołanie do zobowiązania — przez
 * serwis byłby to cykl. Ten plik importuje wyłącznie repozytorium i księgę transakcji.
 */

/**
 * Czy zobowiązanie należy do gospodarstwa — dla sprawdzenia odwołań transakcji i reguł.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param liabilityId - Identyfikator z żądania.
 * @returns `true`, gdy wolno go wskazać.
 */
export function isLiabilityInHousehold(
  handle: DbHandle,
  householdId: string,
  liabilityId: string,
): boolean {
  return liabilityExists(handle, householdId, liabilityId);
}

/**
 * Suma pozostałych kwot aktywnych zobowiązań na dzień `asOf` — do majątku netto (07 §7).
 *
 * Zobowiązanie wchodzi od swojego punktu odniesienia: kredyt wpisany we wrześniu nie
 * zmienia majątku z sierpnia, bo nie wiadomo, ile wtedy wynosił. Raty liczone do `asOf`
 * włącznie, więc majątek na koniec sierpnia nie widzi wrześniowej raty.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param monthKey - Miesiąc sald.
 * @param asOf - Dzień sald.
 * @returns Suma w groszach, nieujemna.
 */
export function liabilitiesRemainingMinor(
  handle: DbHandle,
  householdId: string,
  monthKey: string,
  asOf: string,
): number {
  const payments = liabilityPayments(handle, householdId, monthKey, asOf);
  return findLiabilities(handle, householdId, true)
    .filter((row) => row.balanceAsOf <= asOf)
    .reduce((sum, row) => {
      const paid = payments.get(row.id)?.paidSinceAsOfMinor ?? 0;
      return sum + Math.max(0, row.openingBalanceMinor - paid);
    }, 0);
}

/**
 * Przepina zobowiązania z kategorii źródłowej na docelową (07 §9.3). Nie otwiera
 * transakcji bazodanowej — granicę scalenia wyznacza serwis kategorii.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param fromCategoryId - Kategoria źródłowa.
 * @param toCategoryId - Kategoria docelowa.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba przepiętych zobowiązań.
 */
export function moveLiabilitiesToCategory(
  handle: DbHandle,
  householdId: string,
  fromCategoryId: string,
  toCategoryId: string,
  now: number,
): number {
  return reassignLiabilitiesCategory(handle, householdId, fromCategoryId, toCategoryId, now);
}

/**
 * Reguła raty zobowiązania — do sprawdzenia, czy rata ma już swoją pozycję cykliczną.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param liabilityId - Identyfikator zobowiązania.
 * @returns Identyfikator reguły, `null` bez reguły, `undefined` — nie ma zobowiązania.
 */
export function liabilityRuleId(
  handle: DbHandle,
  householdId: string,
  liabilityId: string,
): string | null | undefined {
  return findLiabilityById(handle, householdId, liabilityId)?.recurringRuleId;
}

/**
 * Przypina regułę jako regułę raty zobowiązania — rata zapisana „jako wydatek stały"
 * (`F4-8`, ADR-051). Od tej chwili zobowiązanie działa jak założone z regułą (ADR-047):
 * rata jest wystąpieniem, „Do zrobienia" nie pokazuje jej drugi raz, zamknięcie
 * zobowiązania wstrzymuje regułę.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param liabilityId - Identyfikator zobowiązania.
 * @param ruleId - Nowa reguła raty.
 * @param now - Znacznik `updated_at`.
 */
export function adoptLiabilityRule(
  handle: DbHandle,
  householdId: string,
  liabilityId: string,
  ruleId: string,
  now: number,
): void {
  patchLiability(handle, householdId, liabilityId, { recurringRuleId: ruleId }, now);
}
