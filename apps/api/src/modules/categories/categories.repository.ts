import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import { categories, type CategoryInsert, type CategoryRow } from '../../db/schema/categories.js';

/**
 * Zapytania modułu kategorii.
 *
 * `householdId` jest pierwszym argumentem po uchwycie i trafia do każdego `WHERE`
 * (reguła 4 z `CLAUDE.md`). Repozytorium nie zna HTTP; o granicy transakcji decyduje
 * serwis (02 §6).
 */

/** Pola kategorii, które wolno zmienić. */
export type CategoryPatch = Partial<
  Pick<
    CategoryInsert,
    'name' | 'parentId' | 'icon' | 'color' | 'aiHints' | 'isArchived' | 'sortOrder'
  >
>;

/** Kategoria rodzica albo poziom główny. */
type ParentScope = string | null;

/**
 * Zwraca kategorie gospodarstwa w kolejności wyświetlania.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param filter - Rodzaj (opcjonalnie) i czy dołączyć zarchiwizowane.
 * @param filter.kind - Rodzaj kategorii; brak = wszystkie.
 * @param filter.includeArchived - Czy dołączyć zarchiwizowane.
 * @returns Wiersze kategorii, posortowane po `sort_order`, a przy remisie po id.
 */
export function findCategories(
  handle: DbHandle,
  householdId: string,
  filter: { kind?: CategoryRow['kind'] | undefined; includeArchived: boolean },
): CategoryRow[] {
  const conditions = [eq(categories.householdId, householdId)];
  if (filter.kind !== undefined) conditions.push(eq(categories.kind, filter.kind));
  if (!filter.includeArchived) conditions.push(eq(categories.isArchived, false));
  return handle.db
    .select()
    .from(categories)
    .where(and(...conditions))
    .orderBy(asc(categories.sortOrder), asc(categories.id))
    .all();
}

/**
 * Znajduje kategorię gospodarstwa po identyfikatorze.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param categoryId - Identyfikator kategorii.
 * @returns Wiersz albo `undefined`, także dla kategorii innego gospodarstwa.
 */
export function findCategoryById(
  handle: DbHandle,
  householdId: string,
  categoryId: string,
): CategoryRow | undefined {
  return handle.db
    .select()
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.id, categoryId)))
    .get();
}

/**
 * Zwraca rodzeństwo: kategorie tego samego rodzaju pod tym samym rodzicem.
 *
 * Łącznie z zarchiwizowanymi — nazwa zarchiwizowanej kategorii też jest zajęta, bo
 * przywrócenie jej obok nowej o tej samej nazwie dałoby dwie nieodróżnialne pozycje.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param kind - Rodzaj kategorii.
 * @param parentId - Rodzic albo `null` dla poziomu głównego.
 * @returns Wiersze rodzeństwa.
 */
export function findSiblings(
  handle: DbHandle,
  householdId: string,
  kind: CategoryRow['kind'],
  parentId: ParentScope,
): CategoryRow[] {
  return handle.db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.householdId, householdId),
        eq(categories.kind, kind),
        parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId),
      ),
    )
    .all();
}

/**
 * Zwraca podkategorie kategorii.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param parentId - Identyfikator rodzica.
 * @returns Wiersze dzieci, łącznie z zarchiwizowanymi.
 */
export function findChildren(
  handle: DbHandle,
  householdId: string,
  parentId: string,
): CategoryRow[] {
  return handle.db
    .select()
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.parentId, parentId)))
    .all();
}

/**
 * Sprawdza, czy slug jest zajęty w obrębie rodzaju.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param kind - Rodzaj kategorii.
 * @param slug - Kandydat na slug.
 * @returns `true`, gdy `uq_categories_slug` odrzuciłby taki wiersz.
 */
export function slugTaken(
  handle: DbHandle,
  householdId: string,
  kind: CategoryRow['kind'],
  slug: string,
): boolean {
  const row = handle.db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.householdId, householdId),
        eq(categories.kind, kind),
        eq(categories.slug, slug),
      ),
    )
    .get();
  return row !== undefined;
}

/**
 * Zapisuje nową kategorię.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Kompletny wiersz.
 * @returns Zapisany wiersz.
 */
export function insertCategory(handle: DbHandle, row: CategoryInsert): CategoryRow {
  return handle.db.insert(categories).values(row).returning().get();
}

/**
 * Zmienia pola kategorii gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param categoryId - Identyfikator kategorii.
 * @param patch - Zmieniane pola.
 * @param now - Znacznik `updated_at`.
 * @returns Wiersz po zmianie albo `undefined`, gdy kategorii nie ma w gospodarstwie.
 */
export function patchCategory(
  handle: DbHandle,
  householdId: string,
  categoryId: string,
  patch: CategoryPatch,
  now: number,
): CategoryRow | undefined {
  return handle.db
    .update(categories)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(categories.householdId, householdId), eq(categories.id, categoryId)))
    .returning()
    .get();
}

/**
 * Ustawia flagę archiwizacji wielu kategorii naraz.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param categoryIds - Identyfikatory kategorii.
 * @param archived - Nowa wartość flagi.
 * @param now - Znacznik `updated_at`.
 */
export function setArchived(
  handle: DbHandle,
  householdId: string,
  categoryIds: readonly string[],
  archived: boolean,
  now: number,
): void {
  if (categoryIds.length === 0) return;
  handle.db
    .update(categories)
    .set({ isArchived: archived, updatedAt: now })
    .where(and(eq(categories.householdId, householdId), inArray(categories.id, [...categoryIds])))
    .run();
}

/**
 * Usuwa kategorię gospodarstwa.
 *
 * Sprawdzenia (I-9, I-10, dzieci) robi serwis **przed** wywołaniem — tutaj żadna
 * reguła nie jest pilnowana przez bazę, bo wszystkie referencje do kategorii mają
 * `ON DELETE SET NULL`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param categoryId - Identyfikator kategorii.
 * @returns `true`, gdy wiersz został usunięty.
 */
export function removeCategory(handle: DbHandle, householdId: string, categoryId: string): boolean {
  return (
    handle.db
      .delete(categories)
      .where(and(eq(categories.householdId, householdId), eq(categories.id, categoryId)))
      .run().changes > 0
  );
}

/**
 * Zwraca najwyższą pozycję wśród rodzeństwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param kind - Rodzaj kategorii.
 * @param parentId - Rodzic albo `null` dla poziomu głównego.
 * @returns Najwyższe `sort_order` albo `-1`, gdy rodzeństwa nie ma.
 */
export function findMaxSiblingSortOrder(
  handle: DbHandle,
  householdId: string,
  kind: CategoryRow['kind'],
  parentId: ParentScope,
): number {
  const row = handle.db
    .select({ max: sql<number | null>`max(${categories.sortOrder})` })
    .from(categories)
    .where(
      and(
        eq(categories.householdId, householdId),
        eq(categories.kind, kind),
        parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId),
      ),
    )
    .get();
  return row?.max ?? -1;
}
