import { and, asc, eq, sql } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import {
  incomeSources,
  type IncomeSourceInsert,
  type IncomeSourceRow,
} from '../../db/schema/income-sources.js';

/**
 * Zapytania modułu źródeł przychodu.
 *
 * `householdId` jest pierwszym argumentem po uchwycie i trafia do każdego `WHERE`
 * (reguła 4 z `CLAUDE.md`).
 */

/** Pola źródła, które wolno zmienić. */
export type IncomeSourcePatch = Partial<
  Pick<
    IncomeSourceInsert,
    'name' | 'kind' | 'ownerUserId' | 'countsTowardAllocation' | 'isArchived'
  >
>;

/**
 * Zwraca źródła gospodarstwa w kolejności wyświetlania.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param includeArchived - Czy dołączyć zarchiwizowane.
 * @returns Wiersze źródeł.
 */
export function findIncomeSources(
  handle: DbHandle,
  householdId: string,
  includeArchived: boolean,
): IncomeSourceRow[] {
  const scope = includeArchived
    ? eq(incomeSources.householdId, householdId)
    : and(eq(incomeSources.householdId, householdId), eq(incomeSources.isArchived, false));
  return handle.db
    .select()
    .from(incomeSources)
    .where(scope)
    .orderBy(asc(incomeSources.sortOrder), asc(incomeSources.id))
    .all();
}

/**
 * Znajduje źródło gospodarstwa po identyfikatorze.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param incomeSourceId - Identyfikator źródła.
 * @returns Wiersz albo `undefined`, także dla źródła innego gospodarstwa.
 */
export function findIncomeSourceById(
  handle: DbHandle,
  householdId: string,
  incomeSourceId: string,
): IncomeSourceRow | undefined {
  return handle.db
    .select()
    .from(incomeSources)
    .where(and(eq(incomeSources.householdId, householdId), eq(incomeSources.id, incomeSourceId)))
    .get();
}

/**
 * Zwraca najwyższą pozycję na liście źródeł (łącznie z zarchiwizowanymi).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Najwyższe `sort_order` albo `-1`.
 */
export function findMaxSortOrder(handle: DbHandle, householdId: string): number {
  const row = handle.db
    .select({ max: sql<number | null>`max(${incomeSources.sortOrder})` })
    .from(incomeSources)
    .where(eq(incomeSources.householdId, householdId))
    .get();
  return row?.max ?? -1;
}

/**
 * Zapisuje nowe źródło.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Kompletny wiersz.
 * @returns Zapisany wiersz.
 */
export function insertIncomeSource(handle: DbHandle, row: IncomeSourceInsert): IncomeSourceRow {
  return handle.db.insert(incomeSources).values(row).returning().get();
}

/**
 * Zmienia pola źródła gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param incomeSourceId - Identyfikator źródła.
 * @param patch - Zmieniane pola.
 * @param now - Znacznik `updated_at`.
 * @returns Wiersz po zmianie albo `undefined`.
 */
export function patchIncomeSource(
  handle: DbHandle,
  householdId: string,
  incomeSourceId: string,
  patch: IncomeSourcePatch,
  now: number,
): IncomeSourceRow | undefined {
  return handle.db
    .update(incomeSources)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(incomeSources.householdId, householdId), eq(incomeSources.id, incomeSourceId)))
    .returning()
    .get();
}

/**
 * Usuwa źródło gospodarstwa. Sprawdzenie I-10 robi serwis przed wywołaniem.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param incomeSourceId - Identyfikator źródła.
 */
export function removeIncomeSource(
  handle: DbHandle,
  householdId: string,
  incomeSourceId: string,
): void {
  handle.db
    .delete(incomeSources)
    .where(and(eq(incomeSources.householdId, householdId), eq(incomeSources.id, incomeSourceId)))
    .run();
}
