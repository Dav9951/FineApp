import { and, desc, eq } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import {
  allocationTargets,
  type AllocationTargetInsert,
  type AllocationTargetRow,
} from '../../db/schema/allocation-targets.js';

/**
 * Zapytania modułu `allocation` — wersje rozkładu docelowego (`F5-3`).
 *
 * `householdId` jest pierwszym argumentem po uchwycie (reguła 4 z `CLAUDE.md`). Sumy
 * wykonania pochodzą z księgi przez `transactions.ledger.ts`, nie stąd.
 */

/**
 * Zwraca wszystkie wersje rozkładu gospodarstwa, od najnowszej.
 *
 * Wersji jest kilka na rok — wybór obowiązującej w danym miesiącu robi serwis na tej
 * liście, więc trend dwunastu miesięcy to jedno zapytanie.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Wiersze malejąco po `effective_from_month`.
 */
export function findAllocationTargets(
  handle: DbHandle,
  householdId: string,
): AllocationTargetRow[] {
  return handle.db
    .select()
    .from(allocationTargets)
    .where(eq(allocationTargets.householdId, householdId))
    .orderBy(desc(allocationTargets.effectiveFromMonth))
    .all();
}

/**
 * Znajduje wersję rozkładu obowiązującą od wskazanego miesiąca.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param effectiveFromMonth - Miesiąc początku wersji.
 * @returns Wiersz albo `undefined`.
 */
export function findAllocationTargetFrom(
  handle: DbHandle,
  householdId: string,
  effectiveFromMonth: string,
): AllocationTargetRow | undefined {
  return handle.db
    .select()
    .from(allocationTargets)
    .where(
      and(
        eq(allocationTargets.householdId, householdId),
        eq(allocationTargets.effectiveFromMonth, effectiveFromMonth),
      ),
    )
    .get();
}

/**
 * Zapisuje nową wersję rozkładu.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Kompletny wiersz.
 * @returns Zapisany wiersz.
 */
export function insertAllocationTarget(
  handle: DbHandle,
  row: AllocationTargetInsert,
): AllocationTargetRow {
  return handle.db.insert(allocationTargets).values(row).returning().get();
}

/** Pola wersji rozkładu, które wolno zmienić. */
export type AllocationTargetPatch = Pick<
  AllocationTargetInsert,
  'savingsPercentBps' | 'investmentPercentBps' | 'debtPercentBps' | 'note'
>;

/**
 * Zmienia udziały wersji rozkładu — ponowny zapis tego samego miesiąca.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param id - Identyfikator wersji.
 * @param patch - Nowe udziały i notatka.
 * @param now - Znacznik `updated_at`.
 * @returns Wiersz po zmianie albo `undefined`.
 */
export function patchAllocationTarget(
  handle: DbHandle,
  householdId: string,
  id: string,
  patch: AllocationTargetPatch,
  now: number,
): AllocationTargetRow | undefined {
  return handle.db
    .update(allocationTargets)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(allocationTargets.householdId, householdId), eq(allocationTargets.id, id)))
    .returning()
    .get();
}
