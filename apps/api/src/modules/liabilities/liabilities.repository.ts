import { and, asc, desc, eq, type SQL } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import {
  liabilities,
  type LiabilityInsert,
  type LiabilityRow,
} from '../../db/schema/liabilities.js';

/**
 * Zapytania modułu `liabilities` — zadanie `F4-4`.
 *
 * `householdId` jest pierwszym argumentem po uchwycie (reguła 4 z `CLAUDE.md`). Sumy rat
 * pochodzą z księgi przez `transactions.ledger.ts`, nie stąd.
 */

/**
 * Sprawdza, czy zobowiązanie istnieje w gospodarstwie.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param liabilityId - Identyfikator zobowiązania.
 * @returns `true`, gdy wiersz istnieje i należy do gospodarstwa.
 */
export function liabilityExists(
  handle: DbHandle,
  householdId: string,
  liabilityId: string,
): boolean {
  return findLiabilityById(handle, householdId, liabilityId) !== undefined;
}

/**
 * Zwraca zobowiązania gospodarstwa: aktywne przed zamkniętymi, potem po nazwie.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param isActive - Filtr aktywności; pominięty — wszystkie.
 * @returns Wiersze.
 */
export function findLiabilities(
  handle: DbHandle,
  householdId: string,
  isActive?: boolean,
): LiabilityRow[] {
  const conditions: SQL[] = [eq(liabilities.householdId, householdId)];
  if (isActive !== undefined) conditions.push(eq(liabilities.isActive, isActive));
  return handle.db
    .select()
    .from(liabilities)
    .where(and(...conditions))
    .orderBy(desc(liabilities.isActive), asc(liabilities.name), asc(liabilities.id))
    .all();
}

/**
 * Znajduje zobowiązanie gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param liabilityId - Identyfikator zobowiązania.
 * @returns Wiersz albo `undefined`, także dla zobowiązania innego gospodarstwa.
 */
export function findLiabilityById(
  handle: DbHandle,
  householdId: string,
  liabilityId: string,
): LiabilityRow | undefined {
  return handle.db
    .select()
    .from(liabilities)
    .where(and(eq(liabilities.householdId, householdId), eq(liabilities.id, liabilityId)))
    .get();
}

/**
 * Zapisuje nowe zobowiązanie.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Kompletny wiersz; reguły sprawdził serwis.
 * @returns Zapisany wiersz.
 */
export function insertLiability(handle: DbHandle, row: LiabilityInsert): LiabilityRow {
  return handle.db.insert(liabilities).values(row).returning().get();
}

/** Pola zobowiązania, które wolno zmienić. Gospodarstwo i znaczniki są niezmienne. */
export type LiabilityPatch = Partial<
  Omit<LiabilityInsert, 'id' | 'householdId' | 'createdAt' | 'updatedAt'>
>;

/**
 * Zmienia pola zobowiązania gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param liabilityId - Identyfikator zobowiązania.
 * @param patch - Zmieniane pola.
 * @param now - Znacznik `updated_at`.
 * @returns Wiersz po zmianie albo `undefined`.
 */
export function patchLiability(
  handle: DbHandle,
  householdId: string,
  liabilityId: string,
  patch: LiabilityPatch,
  now: number,
): LiabilityRow | undefined {
  return handle.db
    .update(liabilities)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(liabilities.householdId, householdId), eq(liabilities.id, liabilityId)))
    .returning()
    .get();
}

/**
 * Usuwa zobowiązanie gospodarstwa.
 *
 * Raty zostają w księdze jako zwykłe wydatki: `transactions.liability_id` ma
 * `ON DELETE SET NULL` (07 §10).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param liabilityId - Identyfikator zobowiązania.
 * @returns `true`, gdy wiersz usunięto.
 */
export function removeLiability(
  handle: DbHandle,
  householdId: string,
  liabilityId: string,
): boolean {
  return (
    handle.db
      .delete(liabilities)
      .where(and(eq(liabilities.householdId, householdId), eq(liabilities.id, liabilityId)))
      .run().changes > 0
  );
}

/**
 * Przepina zobowiązania gospodarstwa z jednej kategorii na drugą — scalanie (07 §9.3).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param fromCategoryId - Kategoria źródłowa.
 * @param toCategoryId - Kategoria docelowa.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba przepiętych zobowiązań.
 */
export function reassignLiabilitiesCategory(
  handle: DbHandle,
  householdId: string,
  fromCategoryId: string,
  toCategoryId: string,
  now: number,
): number {
  return handle.db
    .update(liabilities)
    .set({ categoryId: toCategoryId, updatedAt: now })
    .where(
      and(eq(liabilities.householdId, householdId), eq(liabilities.categoryId, fromCategoryId)),
    )
    .run().changes;
}
