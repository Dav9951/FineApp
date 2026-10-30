import { and, asc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import {
  plannedExpenses,
  type PlannedExpenseInsert,
  type PlannedExpenseRow,
} from '../../db/schema/planned-expenses.js';

/**
 * Zapytania modułu `planned-expenses` — zadania `F6-1`…`F6-4`.
 *
 * `householdId` jest pierwszym argumentem po uchwycie (reguła 4 z `CLAUDE.md`). Sumy
 * odkładania pochodzą z księgi przez `transactions.ledger.ts`, nie stąd.
 */

/** Filtry listy. */
export interface PlannedExpenseFilter {
  readonly statuses: readonly PlannedExpenseRow['status'][];
  readonly from?: string;
  readonly to?: string;
  readonly priority?: PlannedExpenseRow['priority'];
}

/**
 * Zwraca wydatki gospodarstwa rosnąco po terminie (miesiąc, dzień, nazwa).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param filter - Statusy, zakres miesięcy terminu, priorytet.
 * @returns Wiersze.
 */
export function findPlannedExpenses(
  handle: DbHandle,
  householdId: string,
  filter: PlannedExpenseFilter,
): PlannedExpenseRow[] {
  const conditions: SQL[] = [
    eq(plannedExpenses.householdId, householdId),
    inArray(plannedExpenses.status, [...filter.statuses]),
  ];
  if (filter.from !== undefined) conditions.push(gte(plannedExpenses.dueMonth, filter.from));
  if (filter.to !== undefined) conditions.push(lte(plannedExpenses.dueMonth, filter.to));
  if (filter.priority !== undefined) conditions.push(eq(plannedExpenses.priority, filter.priority));
  return handle.db
    .select()
    .from(plannedExpenses)
    .where(and(...conditions))
    .orderBy(
      asc(plannedExpenses.dueMonth),
      asc(plannedExpenses.dueOn),
      asc(plannedExpenses.name),
      asc(plannedExpenses.id),
    )
    .all();
}

/**
 * Znajduje wydatek gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param id - Identyfikator wydatku.
 * @returns Wiersz albo `undefined`, także dla wydatku innego gospodarstwa.
 */
export function findPlannedExpenseById(
  handle: DbHandle,
  householdId: string,
  id: string,
): PlannedExpenseRow | undefined {
  return handle.db
    .select()
    .from(plannedExpenses)
    .where(and(eq(plannedExpenses.householdId, householdId), eq(plannedExpenses.id, id)))
    .get();
}

/**
 * Kolejna instancja wydatku powtarzanego co rok — ta, która wskazuje go jako poprzednią.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param previousId - Wydatek poprzedni.
 * @returns Wiersz albo `undefined`.
 */
export function findNextInstance(
  handle: DbHandle,
  householdId: string,
  previousId: string,
): PlannedExpenseRow | undefined {
  return handle.db
    .select()
    .from(plannedExpenses)
    .where(
      and(
        eq(plannedExpenses.householdId, householdId),
        eq(plannedExpenses.previousInstanceId, previousId),
      ),
    )
    .get();
}

/**
 * Zapisuje nowy wydatek.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Kompletny wiersz; reguły sprawdził serwis.
 * @returns Zapisany wiersz.
 */
export function insertPlannedExpense(
  handle: DbHandle,
  row: PlannedExpenseInsert,
): PlannedExpenseRow {
  return handle.db.insert(plannedExpenses).values(row).returning().get();
}

/** Pola wydatku, które wolno zmienić. */
export type PlannedExpensePatch = Partial<
  Omit<PlannedExpenseInsert, 'id' | 'householdId' | 'createdAt' | 'updatedAt'>
>;

/**
 * Zmienia pola wydatku gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param id - Identyfikator wydatku.
 * @param patch - Zmieniane pola.
 * @param now - Znacznik `updated_at`.
 * @returns Wiersz po zmianie albo `undefined`.
 */
export function patchPlannedExpense(
  handle: DbHandle,
  householdId: string,
  id: string,
  patch: PlannedExpensePatch,
  now: number,
): PlannedExpenseRow | undefined {
  return handle.db
    .update(plannedExpenses)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(plannedExpenses.householdId, householdId), eq(plannedExpenses.id, id)))
    .returning()
    .get();
}

/**
 * Usuwa wydatek. Wpłaty na odkładanie i zapłata zostają w księdze, tracąc powiązanie
 * (`transactions.planned_expense_id` ma `ON DELETE SET NULL`, 07 §10).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param id - Identyfikator wydatku.
 * @returns `true`, gdy wiersz usunięto.
 */
export function removePlannedExpense(handle: DbHandle, householdId: string, id: string): boolean {
  return (
    handle.db
      .delete(plannedExpenses)
      .where(and(eq(plannedExpenses.householdId, householdId), eq(plannedExpenses.id, id)))
      .run().changes > 0
  );
}

/**
 * Przepina wydatki z jednej kategorii na drugą — scalanie (07 §9.3, `Z-13`).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param fromCategoryId - Kategoria źródłowa.
 * @param toCategoryId - Kategoria docelowa.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba przepiętych wydatków.
 */
export function reassignPlannedExpensesCategory(
  handle: DbHandle,
  householdId: string,
  fromCategoryId: string,
  toCategoryId: string,
  now: number,
): number {
  return handle.db
    .update(plannedExpenses)
    .set({ categoryId: toCategoryId, updatedAt: now })
    .where(
      and(
        eq(plannedExpenses.householdId, householdId),
        eq(plannedExpenses.categoryId, fromCategoryId),
      ),
    )
    .run().changes;
}
