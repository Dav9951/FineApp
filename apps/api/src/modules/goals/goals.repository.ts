import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import { goals, type GoalInsert, type GoalRow } from '../../db/schema/goals.js';

/**
 * Zapytania modułu `goals` — sprawdzenie istnienia (od `F2-5`) i CRUD (`F5-1`).
 *
 * `householdId` jest pierwszym argumentem po uchwycie (reguła 4 z `CLAUDE.md`). Wpłaty
 * i salda pochodzą z księgi przez `transactions.ledger.ts` i serwis kont, nie stąd.
 */

/**
 * Sprawdza, czy cel istnieje w gospodarstwie.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param goalId - Identyfikator celu.
 * @returns `true`, gdy wiersz istnieje i należy do gospodarstwa.
 */
export function goalExists(handle: DbHandle, householdId: string, goalId: string): boolean {
  return findGoalById(handle, householdId, goalId) !== undefined;
}

/** Filtry listy celów. */
export interface GoalFilter {
  readonly kind?: 'savings' | 'investment';
  readonly includeArchived: boolean;
}

/**
 * Zwraca cele gospodarstwa w kolejności priorytetu (od najważniejszego), potem założenia.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param filter - Rodzaj i archiwum.
 * @returns Wiersze.
 */
export function findGoals(handle: DbHandle, householdId: string, filter: GoalFilter): GoalRow[] {
  const conditions: SQL[] = [eq(goals.householdId, householdId)];
  if (filter.kind !== undefined) conditions.push(eq(goals.kind, filter.kind));
  if (!filter.includeArchived) conditions.push(ne(goals.status, 'archived'));
  return handle.db
    .select()
    .from(goals)
    .where(and(...conditions))
    .orderBy(asc(goals.priority), asc(goals.createdAt), asc(goals.id))
    .all();
}

/**
 * Znajduje cel gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param goalId - Identyfikator celu.
 * @returns Wiersz albo `undefined`, także dla celu innego gospodarstwa.
 */
export function findGoalById(
  handle: DbHandle,
  householdId: string,
  goalId: string,
): GoalRow | undefined {
  return handle.db
    .select()
    .from(goals)
    .where(and(eq(goals.householdId, householdId), eq(goals.id, goalId)))
    .get();
}

/**
 * Najwyższy priorytet w gospodarstwie — nowy cel trafia na koniec listy.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Najwyższy priorytet albo `−1`, gdy celów nie ma.
 */
export function maxGoalPriority(handle: DbHandle, householdId: string): number {
  const row = handle.db
    .select({ max: sql<number | null>`max(${goals.priority})` })
    .from(goals)
    .where(eq(goals.householdId, householdId))
    .get();
  return row?.max ?? -1;
}

/**
 * Zapisuje nowy cel.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Kompletny wiersz; reguły sprawdził serwis.
 * @returns Zapisany wiersz.
 */
export function insertGoal(handle: DbHandle, row: GoalInsert): GoalRow {
  return handle.db.insert(goals).values(row).returning().get();
}

/** Pola celu, które wolno zmienić. Gospodarstwo i znaczniki są niezmienne. */
export type GoalPatch = Partial<Omit<GoalInsert, 'id' | 'householdId' | 'createdAt' | 'updatedAt'>>;

/**
 * Zmienia pola celu gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param goalId - Identyfikator celu.
 * @param patch - Zmieniane pola.
 * @param now - Znacznik `updated_at`.
 * @returns Wiersz po zmianie albo `undefined`.
 */
export function patchGoal(
  handle: DbHandle,
  householdId: string,
  goalId: string,
  patch: GoalPatch,
  now: number,
): GoalRow | undefined {
  return handle.db
    .update(goals)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(goals.householdId, householdId), eq(goals.id, goalId)))
    .returning()
    .get();
}

/**
 * Oznacza aktywne cele jako osiągnięte (07 §4.3).
 *
 * Warunek `status = 'active'` w samym zapytaniu: dwa równoczesne odczyty nie nadpiszą
 * sobie nawzajem `achieved_at`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param goalIds - Cele, które osiągnęły kwotę docelową.
 * @param now - Chwila osiągnięcia.
 */
export function markGoalsAchieved(
  handle: DbHandle,
  householdId: string,
  goalIds: readonly string[],
  now: number,
): void {
  if (goalIds.length === 0) return;
  handle.db
    .update(goals)
    .set({ status: 'achieved', achievedAt: now, updatedAt: now })
    .where(
      and(
        eq(goals.householdId, householdId),
        inArray(goals.id, [...goalIds]),
        eq(goals.status, 'active'),
      ),
    )
    .run();
}

/**
 * Ustawia priorytety celów w podanej kolejności — pierwszy dostaje `0`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param goalIds - Identyfikatory od najważniejszego.
 * @param now - Znacznik `updated_at`.
 */
export function setGoalPriorities(
  handle: DbHandle,
  householdId: string,
  goalIds: readonly string[],
  now: number,
): void {
  goalIds.forEach((id, priority) => {
    handle.db
      .update(goals)
      .set({ priority, updatedAt: now })
      .where(and(eq(goals.householdId, householdId), eq(goals.id, id)))
      .run();
  });
}

/**
 * Usuwa cel gospodarstwa.
 *
 * Wpłaty zostają w księdze, tracąc powiązanie: `transactions.goal_id` ma
 * `ON DELETE SET NULL` (07 §10) — tak samo reguły cykliczne i planowane wydatki.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param goalId - Identyfikator celu.
 * @returns `true`, gdy wiersz usunięto.
 */
export function removeGoal(handle: DbHandle, householdId: string, goalId: string): boolean {
  return (
    handle.db
      .delete(goals)
      .where(and(eq(goals.householdId, householdId), eq(goals.id, goalId)))
      .run().changes > 0
  );
}
