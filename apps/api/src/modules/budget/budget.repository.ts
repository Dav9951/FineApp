import { and, asc, eq, gte, inArray, max } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import {
  budgetDraftGroups,
  budgetDraftLines,
  budgetDrafts,
  type BudgetDraftGroupInsert,
  type BudgetDraftGroupRow,
  type BudgetDraftInsert,
  type BudgetDraftLineInsert,
  type BudgetDraftLineRow,
  type BudgetDraftRow,
} from '../../db/schema/budget.js';

/**
 * Zapytania modułu `budget` — planer budżetu (wymaganie #14, Faza 9,
 * [03 §3.19–3.20](../../../../../plans/03-data-model.md#319-budget_drafts)).
 *
 * Każda funkcja przyjmuje `householdId` jako pierwszy argument po uchwycie — zakres
 * gospodarstwa jest wymuszany w każdym zapytaniu, także o linie (mają własną kolumnę).
 * Repozytorium nie zna HTTP i nie rzuca błędów ze statusem (02 §3).
 */

/**
 * Szkic gospodarstwa na miesiąc.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param monthKey - Miesiąc szkicu.
 * @returns Wiersz albo `undefined`.
 */
export function findDraftByMonth(
  handle: DbHandle,
  householdId: string,
  monthKey: string,
): BudgetDraftRow | undefined {
  return handle.db
    .select()
    .from(budgetDrafts)
    .where(and(eq(budgetDrafts.householdId, householdId), eq(budgetDrafts.monthKey, monthKey)))
    .get();
}

/**
 * Wszystkie szkice gospodarstwa, rosnąco po miesiącu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Wiersze szkiców.
 */
export function findDrafts(handle: DbHandle, householdId: string): BudgetDraftRow[] {
  return handle.db
    .select()
    .from(budgetDrafts)
    .where(eq(budgetDrafts.householdId, householdId))
    .orderBy(asc(budgetDrafts.monthKey))
    .all();
}

/**
 * Wstawia szkic.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Wiersz do wstawienia.
 */
export function insertDraft(handle: DbHandle, row: BudgetDraftInsert): void {
  handle.db.insert(budgetDrafts).values(row).run();
}

/**
 * Zmienia pola szkicu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param draftId - Szkic.
 * @param patch - Zmienione kolumny.
 */
export function patchDraft(
  handle: DbHandle,
  householdId: string,
  draftId: string,
  patch: Partial<Pick<BudgetDraftRow, 'notes' | 'lastFilledAt' | 'updatedAt'>>,
): void {
  handle.db
    .update(budgetDrafts)
    .set(patch)
    .where(and(eq(budgetDrafts.householdId, householdId), eq(budgetDrafts.id, draftId)))
    .run();
}

/**
 * Usuwa szkic — linie znikają kaskadą (03 §3.20).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param draftId - Szkic.
 */
export function removeDraft(handle: DbHandle, householdId: string, draftId: string): void {
  handle.db
    .delete(budgetDrafts)
    .where(and(eq(budgetDrafts.householdId, householdId), eq(budgetDrafts.id, draftId)))
    .run();
}

/**
 * Linie szkiców — w kolejności dopisania (`sort_order`, potem ULID).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param draftIds - Szkice.
 * @returns Wiersze linii.
 */
export function findLines(
  handle: DbHandle,
  householdId: string,
  draftIds: readonly string[],
): BudgetDraftLineRow[] {
  if (draftIds.length === 0) return [];
  return handle.db
    .select()
    .from(budgetDraftLines)
    .where(
      and(
        eq(budgetDraftLines.householdId, householdId),
        inArray(budgetDraftLines.draftId, [...draftIds]),
      ),
    )
    .orderBy(asc(budgetDraftLines.sortOrder), asc(budgetDraftLines.id))
    .all();
}

/**
 * Jedna linia szkicu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param draftId - Szkic, do którego linia musi należeć.
 * @param lineId - Linia.
 * @returns Wiersz albo `undefined`.
 */
export function findLine(
  handle: DbHandle,
  householdId: string,
  draftId: string,
  lineId: string,
): BudgetDraftLineRow | undefined {
  return handle.db
    .select()
    .from(budgetDraftLines)
    .where(
      and(
        eq(budgetDraftLines.householdId, householdId),
        eq(budgetDraftLines.draftId, draftId),
        eq(budgetDraftLines.id, lineId),
      ),
    )
    .get();
}

/**
 * Największy `sort_order` w szkicu — nowa linia idzie na koniec.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param draftId - Szkic.
 * @returns Największa wartość albo `-1` dla pustego szkicu.
 */
export function findMaxLineOrder(handle: DbHandle, householdId: string, draftId: string): number {
  const row = handle.db
    .select({ value: max(budgetDraftLines.sortOrder) })
    .from(budgetDraftLines)
    .where(
      and(eq(budgetDraftLines.householdId, householdId), eq(budgetDraftLines.draftId, draftId)),
    )
    .get();
  return row?.value ?? -1;
}

/**
 * Wstawia linie; linia źródła, które już ma linię w szkicu (także wykluczoną), jest
 * pomijana — `ON CONFLICT DO NOTHING` na unikalnych indeksach z 03 §3.20.
 *
 * @param handle - Uchwyt bazy.
 * @param rows - Wiersze do wstawienia.
 * @returns Liczba wstawionych linii.
 */
export function insertLines(handle: DbHandle, rows: readonly BudgetDraftLineInsert[]): number {
  let inserted = 0;
  for (const row of rows) {
    inserted += handle.db.insert(budgetDraftLines).values(row).onConflictDoNothing().run().changes;
  }
  return inserted;
}

/**
 * Zmienia pola linii.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param lineId - Linia.
 * @param patch - Zmienione kolumny.
 */
export function patchLine(
  handle: DbHandle,
  householdId: string,
  lineId: string,
  patch: Partial<Omit<BudgetDraftLineRow, 'id' | 'householdId' | 'draftId' | 'createdAt'>>,
): void {
  handle.db
    .update(budgetDraftLines)
    .set(patch)
    .where(and(eq(budgetDraftLines.householdId, householdId), eq(budgetDraftLines.id, lineId)))
    .run();
}

/**
 * Usuwa linię.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param lineId - Linia.
 */
export function removeLine(handle: DbHandle, householdId: string, lineId: string): void {
  handle.db
    .delete(budgetDraftLines)
    .where(and(eq(budgetDraftLines.householdId, householdId), eq(budgetDraftLines.id, lineId)))
    .run();
}

/**
 * Przepina linie szkiców z jednej kategorii na drugą — scalanie (07 §9.3).
 *
 * Dotyczy także linii szkiców minionych miesięcy: są tylko do odczytu dla użytkownika
 * (I-20), ale wskaźnik na scaloną kategorię i tak by zniknął, a plan kontra wykonanie
 * ma liczyć wykonanie w kategorii, do której trafiły transakcje.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param fromCategoryId - Kategoria źródłowa.
 * @param toCategoryId - Kategoria docelowa.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba przepiętych linii.
 */
export function reassignBudgetLinesCategory(
  handle: DbHandle,
  householdId: string,
  fromCategoryId: string,
  toCategoryId: string,
  now: number,
): number {
  return handle.db
    .update(budgetDraftLines)
    .set({ categoryId: toCategoryId, updatedAt: now })
    .where(
      and(
        eq(budgetDraftLines.householdId, householdId),
        eq(budgetDraftLines.categoryId, fromCategoryId),
      ),
    )
    .run().changes;
}

/**
 * Przepina linie szkiców od miesiąca wzwyż ze starej reguły na nową — podział reguły
 * przy „Zastosuj w regule" (07 §13.7). Kwoty linii bez zmian.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param fromRuleId - Reguła dzielona (kończy się przed `fromMonth`).
 * @param toRuleId - Nowa reguła (od `fromMonth`).
 * @param fromMonth - Pierwszy miesiąc nowej reguły.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba przepiętych linii.
 */
export function relinkRuleLines(
  handle: DbHandle,
  householdId: string,
  fromRuleId: string,
  toRuleId: string,
  fromMonth: string,
  now: number,
): number {
  const draftIds = handle.db
    .select({ id: budgetDrafts.id })
    .from(budgetDrafts)
    .where(and(eq(budgetDrafts.householdId, householdId), gte(budgetDrafts.monthKey, fromMonth)))
    .all()
    .map((row) => row.id);
  if (draftIds.length === 0) return 0;
  return handle.db
    .update(budgetDraftLines)
    .set({ recurringRuleId: toRuleId, updatedAt: now })
    .where(
      and(
        eq(budgetDraftLines.householdId, householdId),
        eq(budgetDraftLines.recurringRuleId, fromRuleId),
        inArray(budgetDraftLines.draftId, draftIds),
      ),
    )
    .run().changes;
}

/**
 * Grupy szkiców (03 §3.21) — w kolejności sekcji ustala serwis; tu po `sort_order`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param draftIds - Szkice.
 * @returns Wiersze grup.
 */
export function findGroups(
  handle: DbHandle,
  householdId: string,
  draftIds: readonly string[],
): BudgetDraftGroupRow[] {
  if (draftIds.length === 0) return [];
  return handle.db
    .select()
    .from(budgetDraftGroups)
    .where(
      and(
        eq(budgetDraftGroups.householdId, householdId),
        inArray(budgetDraftGroups.draftId, [...draftIds]),
      ),
    )
    .orderBy(asc(budgetDraftGroups.sortOrder), asc(budgetDraftGroups.id))
    .all();
}

/**
 * Wstawia grupy.
 *
 * @param handle - Uchwyt bazy.
 * @param rows - Wiersze do wstawienia.
 */
export function insertGroups(handle: DbHandle, rows: readonly BudgetDraftGroupInsert[]): void {
  for (const row of rows) handle.db.insert(budgetDraftGroups).values(row).run();
}

/**
 * Zmienia pola grupy.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param groupId - Grupa.
 * @param patch - Zmienione kolumny.
 */
export function patchGroup(
  handle: DbHandle,
  householdId: string,
  groupId: string,
  patch: Partial<Pick<BudgetDraftGroupRow, 'name' | 'sortOrder' | 'updatedAt'>>,
): void {
  handle.db
    .update(budgetDraftGroups)
    .set(patch)
    .where(and(eq(budgetDraftGroups.householdId, householdId), eq(budgetDraftGroups.id, groupId)))
    .run();
}

/**
 * Usuwa grupę. Linie zostają — klucz obcy `ON DELETE SET NULL` przenosi je do
 * „Bez grupy" (03 §3.20).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param groupId - Grupa.
 */
export function removeGroup(handle: DbHandle, householdId: string, groupId: string): void {
  handle.db
    .delete(budgetDraftGroups)
    .where(and(eq(budgetDraftGroups.householdId, householdId), eq(budgetDraftGroups.id, groupId)))
    .run();
}
