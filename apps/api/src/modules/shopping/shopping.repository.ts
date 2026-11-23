import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import { households } from '../../db/schema/households.js';
import {
  shoppingImportItems,
  shoppingImports,
  shoppingItems,
  shoppingLists,
  shoppingProducts,
  type ShoppingImportInsert,
  type ShoppingImportItemInsert,
  type ShoppingImportItemRow,
  type ShoppingImportRow,
  type ShoppingItemInsert,
  type ShoppingItemRow,
  type ShoppingListInsert,
  type ShoppingListRow,
  type ShoppingProductInsert,
  type ShoppingProductRow,
} from '../../db/schema/shopping.js';

/**
 * Zapytania modułu `shopping` — listy zakupów (wymaganie #15, Faza 10,
 * [03 §3.23–3.27](../../../../../plans/03-data-model.md#323-shopping_lists)).
 *
 * Każda funkcja przyjmuje `householdId` jako pierwszy argument po uchwycie — także
 * zapytania o pozycje, które mają własną kolumnę gospodarstwa. Repozytorium nie zna HTTP
 * i nie rzuca błędów ze statusem (02 §3).
 */

/** Liczniki pozycji listy (bez wyczyszczonych). */
export interface ListCounts {
  readonly listId: string;
  readonly toBuyCount: number;
  readonly checkedCount: number;
}

/**
 * Znacznik założenia zestawu startowego gospodarstwa (07 §14.6).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Znacznik albo `null`, gdy zestawu jeszcze nie założono.
 */
export function findShoppingInitializedAt(handle: DbHandle, householdId: string): number | null {
  const row = handle.db
    .select({ at: households.shoppingInitializedAt })
    .from(households)
    .where(eq(households.id, householdId))
    .get();
  return row?.at ?? null;
}

/**
 * Zapisuje znacznik założenia zestawu startowego.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param now - Znacznik systemowy.
 */
export function markShoppingInitialized(handle: DbHandle, householdId: string, now: number): void {
  handle.db
    .update(households)
    .set({ shoppingInitializedAt: now })
    .where(eq(households.id, householdId))
    .run();
}

/**
 * Listy gospodarstwa — wszystkie albo tylko z archiwum / spoza niego.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param archived - `true` — archiwum, `false` — bieżące, `undefined` — wszystkie.
 * @returns Wiersze list w kolejności z ekranu.
 */
export function findLists(
  handle: DbHandle,
  householdId: string,
  archived?: boolean,
): ShoppingListRow[] {
  return handle.db
    .select()
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.householdId, householdId),
        archived === undefined
          ? undefined
          : archived
            ? isNotNull(shoppingLists.archivedAt)
            : isNull(shoppingLists.archivedAt),
      ),
    )
    .orderBy(asc(shoppingLists.sortOrder), asc(shoppingLists.createdAt), asc(shoppingLists.id))
    .all();
}

/**
 * Jedna lista gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param listId - Lista.
 * @returns Wiersz albo `undefined`.
 */
export function findList(
  handle: DbHandle,
  householdId: string,
  listId: string,
): ShoppingListRow | undefined {
  return handle.db
    .select()
    .from(shoppingLists)
    .where(and(eq(shoppingLists.householdId, householdId), eq(shoppingLists.id, listId)))
    .get();
}

/**
 * Najwyższa kolejność listy w gospodarstwie — nowa lista trafia na koniec.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Najwyższe `sort_order` albo `-1`, gdy list nie ma.
 */
export function findMaxListOrder(handle: DbHandle, householdId: string): number {
  const row = handle.db
    .select({ value: sql<number | null>`max(${shoppingLists.sortOrder})` })
    .from(shoppingLists)
    .where(eq(shoppingLists.householdId, householdId))
    .get();
  return row?.value ?? -1;
}

/**
 * Wstawia listę.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Wiersz.
 */
export function insertList(handle: DbHandle, row: ShoppingListInsert): void {
  handle.db.insert(shoppingLists).values(row).run();
}

/**
 * Zmienia pola listy.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param listId - Lista.
 * @param patch - Zmienione kolumny.
 */
export function patchList(
  handle: DbHandle,
  householdId: string,
  listId: string,
  patch: Partial<
    Pick<ShoppingListRow, 'name' | 'isDefault' | 'sortOrder' | 'archivedAt' | 'updatedAt'>
  >,
): void {
  const { updatedAt, ...rest } = patch;
  handle.db
    .update(shoppingLists)
    .set({
      ...rest,
      // Wersja listy (ETag) rośnie ściśle także przy zmianie samej listy (04 §14b).
      ...(updatedAt === undefined
        ? {}
        : { updatedAt: sql`max(${shoppingLists.updatedAt} + 1, ${updatedAt})` }),
    })
    .where(and(eq(shoppingLists.householdId, householdId), eq(shoppingLists.id, listId)))
    .run();
}

/**
 * Oznacza zmianę zawartości listy: `updated_at` rośnie **ściśle**, nawet przy dwóch
 * zmianach w tej samej milisekundzie — na nim stoi `ETag` odpytywania (04 §14b).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param listId - Lista.
 * @param now - Znacznik systemowy.
 */
export function touchList(
  handle: DbHandle,
  householdId: string,
  listId: string,
  now: number,
): void {
  handle.db
    .update(shoppingLists)
    .set({ updatedAt: sql`max(${shoppingLists.updatedAt} + 1, ${now})` })
    .where(and(eq(shoppingLists.householdId, householdId), eq(shoppingLists.id, listId)))
    .run();
}

/**
 * Usuwa listę — pozycje i importy znikają kaskadą (03 §3.25–3.26).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param listId - Lista.
 */
export function removeList(handle: DbHandle, householdId: string, listId: string): void {
  handle.db
    .delete(shoppingLists)
    .where(and(eq(shoppingLists.householdId, householdId), eq(shoppingLists.id, listId)))
    .run();
}

/**
 * Liczniki pozycji do kupienia i kupionych, bez wyczyszczonych.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param listIds - Listy.
 * @returns Liczniki tylko list, które mają pozycje.
 */
export function countItems(
  handle: DbHandle,
  householdId: string,
  listIds: readonly string[],
): ListCounts[] {
  if (listIds.length === 0) return [];
  return handle.db
    .select({
      listId: shoppingItems.listId,
      toBuyCount: sql<number>`sum(case when ${shoppingItems.checkedAt} is null then 1 else 0 end)`,
      checkedCount: sql<number>`sum(case when ${shoppingItems.checkedAt} is null then 0 else 1 end)`,
    })
    .from(shoppingItems)
    .where(
      and(
        eq(shoppingItems.householdId, householdId),
        inArray(shoppingItems.listId, listIds),
        isNull(shoppingItems.clearedAt),
      ),
    )
    .groupBy(shoppingItems.listId)
    .all();
}

/** Ostatnia zmiana pozycji listy: kiedy i kto. */
export interface ListActivity {
  readonly listId: string;
  readonly updatedAt: number;
  readonly updatedBy: string | null;
}

/**
 * Ostatnio zmieniona pozycja każdej listy — „Ania · 12 min temu" (03 §3.23: liczone
 * z pozycji, nie przechowywane). Wyczyszczone też się liczą: czyszczenie to aktywność.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param listIds - Listy.
 * @returns Po jednym wierszu na listę z pozycjami.
 */
export function findListActivity(
  handle: DbHandle,
  householdId: string,
  listIds: readonly string[],
): ListActivity[] {
  if (listIds.length === 0) return [];
  const ranked = handle.db
    .select({
      listId: shoppingItems.listId,
      updatedAt: shoppingItems.updatedAt,
      updatedBy: shoppingItems.updatedBy,
      rank: sql<number>`row_number() over (partition by ${shoppingItems.listId} order by ${shoppingItems.updatedAt} desc, ${shoppingItems.id} desc)`.as(
        'rank',
      ),
    })
    .from(shoppingItems)
    .where(and(eq(shoppingItems.householdId, householdId), inArray(shoppingItems.listId, listIds)))
    .as('ranked');
  return handle.db
    .select({ listId: ranked.listId, updatedAt: ranked.updatedAt, updatedBy: ranked.updatedBy })
    .from(ranked)
    .where(eq(ranked.rank, 1))
    .all();
}

/**
 * Listy, na których jest pozycja podpięta pod produkt — ich wersję trzeba podbić, gdy
 * zmienia się flaga „zawsze w domu" albo produkt znika (ETag, 04 §14b).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param productId - Produkt.
 * @returns Identyfikatory list.
 */
export function findListIdsWithProduct(
  handle: DbHandle,
  householdId: string,
  productId: string,
): string[] {
  return handle.db
    .selectDistinct({ listId: shoppingItems.listId })
    .from(shoppingItems)
    .where(and(eq(shoppingItems.householdId, householdId), eq(shoppingItems.productId, productId)))
    .all()
    .map((row) => row.listId);
}

/**
 * Ścieżki plików importów listy — do usunięcia z dysku razem z listą (I-31).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param listId - Lista.
 * @returns Wartości kolumny `file_paths`.
 */
export function findImportFilePaths(
  handle: DbHandle,
  householdId: string,
  listId: string,
): string[] {
  return handle.db
    .select({ filePaths: shoppingImports.filePaths })
    .from(shoppingImports)
    .where(and(eq(shoppingImports.householdId, householdId), eq(shoppingImports.listId, listId)))
    .all()
    .map((row) => row.filePaths);
}

/**
 * Importy listy w toku albo do przejrzenia (`processing`, `parsed`).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param listIds - Listy.
 * @returns Wiersze importów, od najstarszego.
 */
export function findPendingImports(
  handle: DbHandle,
  householdId: string,
  listIds: readonly string[],
): {
  id: string;
  listId: string;
  status: 'processing' | 'parsed';
  kind: 'list_photo' | 'recipe';
}[] {
  if (listIds.length === 0) return [];
  return handle.db
    .select({
      id: shoppingImports.id,
      listId: shoppingImports.listId,
      status: shoppingImports.status,
      kind: shoppingImports.kind,
    })
    .from(shoppingImports)
    .where(
      and(
        eq(shoppingImports.householdId, householdId),
        inArray(shoppingImports.listId, listIds),
        inArray(shoppingImports.status, ['processing', 'parsed']),
      ),
    )
    .orderBy(asc(shoppingImports.createdAt), asc(shoppingImports.id))
    .all() as {
    id: string;
    listId: string;
    status: 'processing' | 'parsed';
    kind: 'list_photo' | 'recipe';
  }[];
}

/**
 * Pozycje listy bez wyczyszczonych.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param listId - Lista.
 * @returns Wiersze pozycji.
 */
export function findVisibleItems(
  handle: DbHandle,
  householdId: string,
  listId: string,
): ShoppingItemRow[] {
  return handle.db
    .select()
    .from(shoppingItems)
    .where(
      and(
        eq(shoppingItems.householdId, householdId),
        eq(shoppingItems.listId, listId),
        isNull(shoppingItems.clearedAt),
      ),
    )
    .all();
}

/**
 * Jedna pozycja gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param itemId - Pozycja.
 * @returns Wiersz albo `undefined`.
 */
export function findItem(
  handle: DbHandle,
  householdId: string,
  itemId: string,
): ShoppingItemRow | undefined {
  return handle.db
    .select()
    .from(shoppingItems)
    .where(and(eq(shoppingItems.householdId, householdId), eq(shoppingItems.id, itemId)))
    .get();
}

/**
 * Czy identyfikator pozycji jest zajęty w **dowolnym** gospodarstwie — identyfikator od
 * klienta (ADR-096) nie może nadpisać cudzego wiersza.
 *
 * @param handle - Uchwyt bazy.
 * @param itemId - Identyfikator.
 * @returns `true`, gdy wiersz istnieje.
 */
export function itemIdTaken(handle: DbHandle, itemId: string): boolean {
  return (
    handle.db
      .select({ id: shoppingItems.id })
      .from(shoppingItems)
      .where(eq(shoppingItems.id, itemId))
      .get() !== undefined
  );
}

/**
 * Wstawia pozycje.
 *
 * @param handle - Uchwyt bazy.
 * @param rows - Wiersze.
 */
export function insertItems(handle: DbHandle, rows: readonly ShoppingItemInsert[]): void {
  if (rows.length === 0) return;
  handle.db
    .insert(shoppingItems)
    .values([...rows])
    .run();
}

/**
 * Zmienia pola pozycji.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param itemId - Pozycja.
 * @param patch - Zmienione kolumny.
 */
export function patchItem(
  handle: DbHandle,
  householdId: string,
  itemId: string,
  patch: Partial<Omit<ShoppingItemRow, 'id' | 'householdId' | 'createdAt' | 'createdBy'>>,
): void {
  handle.db
    .update(shoppingItems)
    .set(patch)
    .where(and(eq(shoppingItems.householdId, householdId), eq(shoppingItems.id, itemId)))
    .run();
}

/**
 * Usuwa pozycje.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param itemIds - Pozycje.
 * @returns Liczba usuniętych.
 */
export function removeItems(
  handle: DbHandle,
  householdId: string,
  itemIds: readonly string[],
): number {
  if (itemIds.length === 0) return 0;
  return handle.db
    .delete(shoppingItems)
    .where(and(eq(shoppingItems.householdId, householdId), inArray(shoppingItems.id, itemIds)))
    .run().changes;
}

/**
 * Usuwa fizycznie pozycje wyczyszczone dawniej niż `before` (I-28).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param listId - Lista.
 * @param before - Granica znacznika `cleared_at`.
 * @returns Liczba usuniętych.
 */
export function purgeClearedItems(
  handle: DbHandle,
  householdId: string,
  listId: string,
  before: number,
): number {
  return handle.db
    .delete(shoppingItems)
    .where(
      and(
        eq(shoppingItems.householdId, householdId),
        eq(shoppingItems.listId, listId),
        lt(shoppingItems.clearedAt, before),
      ),
    )
    .run().changes;
}

/**
 * Ustawia `cleared_at` wszystkim kupionym, jeszcze niewyczyszczonym pozycjom listy.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param userId - Kto czyści.
 * @param listId - Lista.
 * @param now - Znacznik systemowy.
 * @returns Identyfikatory wyczyszczonych.
 */
export function clearCheckedItems(
  handle: DbHandle,
  householdId: string,
  userId: string,
  listId: string,
  now: number,
): string[] {
  return handle.db
    .update(shoppingItems)
    .set({ clearedAt: now, updatedBy: userId, updatedAt: now })
    .where(
      and(
        eq(shoppingItems.householdId, householdId),
        eq(shoppingItems.listId, listId),
        isNotNull(shoppingItems.checkedAt),
        isNull(shoppingItems.clearedAt),
      ),
    )
    .returning({ id: shoppingItems.id })
    .all()
    .map((row) => row.id);
}

/**
 * Cofa czyszczenie wskazanych pozycji listy, wyczyszczonych nie dawniej niż `since`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param userId - Kto cofa.
 * @param listId - Lista.
 * @param itemIds - Pozycje.
 * @param since - Najstarszy dopuszczalny `cleared_at`.
 * @param now - Znacznik systemowy.
 * @returns Identyfikatory przywróconych.
 */
export function restoreClearedItems(
  handle: DbHandle,
  householdId: string,
  userId: string,
  listId: string,
  itemIds: readonly string[],
  since: number,
  now: number,
): string[] {
  return handle.db
    .update(shoppingItems)
    .set({ clearedAt: null, updatedBy: userId, updatedAt: now })
    .where(
      and(
        eq(shoppingItems.householdId, householdId),
        eq(shoppingItems.listId, listId),
        inArray(shoppingItems.id, itemIds),
        gte(shoppingItems.clearedAt, since),
      ),
    )
    .returning({ id: shoppingItems.id })
    .all()
    .map((row) => row.id);
}

/**
 * Produkt gospodarstwa po kluczu nazwy (07 §14.1).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param normalizedName - Klucz nazwy.
 * @returns Wiersz albo `undefined`.
 */
export function findProductByName(
  handle: DbHandle,
  householdId: string,
  normalizedName: string,
): ShoppingProductRow | undefined {
  return handle.db
    .select()
    .from(shoppingProducts)
    .where(
      and(
        eq(shoppingProducts.householdId, householdId),
        eq(shoppingProducts.normalizedName, normalizedName),
      ),
    )
    .get();
}

/**
 * Produkt gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param productId - Produkt.
 * @returns Wiersz albo `undefined`.
 */
export function findProduct(
  handle: DbHandle,
  householdId: string,
  productId: string,
): ShoppingProductRow | undefined {
  return handle.db
    .select()
    .from(shoppingProducts)
    .where(and(eq(shoppingProducts.householdId, householdId), eq(shoppingProducts.id, productId)))
    .get();
}

/**
 * Produkty o wskazanych identyfikatorach — do flagi „zawsze w domu" przy pozycjach.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param productIds - Produkty.
 * @returns Wiersze produktów.
 */
export function findProductsByIds(
  handle: DbHandle,
  householdId: string,
  productIds: readonly string[],
): ShoppingProductRow[] {
  if (productIds.length === 0) return [];
  return handle.db
    .select()
    .from(shoppingProducts)
    .where(
      and(eq(shoppingProducts.householdId, householdId), inArray(shoppingProducts.id, productIds)),
    )
    .all();
}

/** Filtr wyszukiwania w słowniku. */
export interface ProductSearch {
  /** Znormalizowany prefiks słowa; `''` — bez filtra. */
  readonly prefix: string;
  readonly staple: boolean | undefined;
  readonly limit: number;
}

/**
 * Wyszukuje produkty: prefiks dowolnego słowa znormalizowanej nazwy, najczęściej używane
 * najpierw (07 §14.5).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param search - Prefiks, flaga i limit.
 * @returns Wiersze produktów.
 */
export function searchProducts(
  handle: DbHandle,
  householdId: string,
  search: ProductSearch,
): ShoppingProductRow[] {
  // Prefiks jest już znormalizowany; znaki LIKE wyłączamy, żeby „%" nie był dzikim znakiem.
  const escaped = search.prefix.replace(/[\\%_]/g, (char) => `\\${char}`);
  return handle.db
    .select()
    .from(shoppingProducts)
    .where(
      and(
        eq(shoppingProducts.householdId, householdId),
        search.staple === undefined ? undefined : eq(shoppingProducts.isStaple, search.staple),
        search.prefix === ''
          ? undefined
          : or(
              sql`${shoppingProducts.normalizedName} LIKE ${`${escaped}%`} ESCAPE '\\'`,
              sql`${shoppingProducts.normalizedName} LIKE ${`% ${escaped}%`} ESCAPE '\\'`,
            ),
      ),
    )
    .orderBy(desc(shoppingProducts.useCount), asc(shoppingProducts.normalizedName))
    .limit(search.limit)
    .all();
}

/**
 * Produkty używane od `since`, najczęściej używane najpierw — kandydaci na „często
 * kupowane" (07 §14.5).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param since - Najstarszy dopuszczalny `last_used_at`.
 * @returns Wiersze produktów.
 */
export function findRecentlyUsedProducts(
  handle: DbHandle,
  householdId: string,
  since: number,
): ShoppingProductRow[] {
  return handle.db
    .select()
    .from(shoppingProducts)
    .where(
      and(eq(shoppingProducts.householdId, householdId), gte(shoppingProducts.lastUsedAt, since)),
    )
    .orderBy(desc(shoppingProducts.useCount), desc(shoppingProducts.lastUsedAt))
    .all();
}

/**
 * Wstawia produkt.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Wiersz.
 */
export function insertProduct(handle: DbHandle, row: ShoppingProductInsert): void {
  handle.db.insert(shoppingProducts).values(row).run();
}

/**
 * Zmienia pola produktu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param productId - Produkt.
 * @param patch - Zmienione kolumny.
 */
export function patchProduct(
  handle: DbHandle,
  householdId: string,
  productId: string,
  patch: Partial<Omit<ShoppingProductRow, 'id' | 'householdId' | 'createdAt'>>,
): void {
  handle.db
    .update(shoppingProducts)
    .set(patch)
    .where(and(eq(shoppingProducts.householdId, householdId), eq(shoppingProducts.id, productId)))
    .run();
}

/**
 * Usuwa produkt — pozycje tracą `product_id` przez `ON DELETE SET NULL`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param productId - Produkt.
 */
export function removeProduct(handle: DbHandle, householdId: string, productId: string): void {
  handle.db
    .delete(shoppingProducts)
    .where(and(eq(shoppingProducts.householdId, householdId), eq(shoppingProducts.id, productId)))
    .run();
}

/**
 * Importy zakończone (`committed`, `discarded`, `failed`) dawniej niż `before`, które
 * wciąż mają pliki na dysku — do sprzątania przy starcie (I-31).
 *
 * **Bez `householdId`**, świadomie: to zadanie konserwacyjne procesu, jak czyszczenie
 * prób logowania, a nie operacja domownika.
 *
 * @param handle - Uchwyt bazy.
 * @param before - Granica znacznika `updated_at`.
 * @returns Identyfikatory i ścieżki plików.
 */
export function findStaleImportFiles(
  handle: DbHandle,
  before: number,
): { id: string; householdId: string; filePaths: string }[] {
  return handle.db
    .select({
      id: shoppingImports.id,
      householdId: shoppingImports.householdId,
      filePaths: shoppingImports.filePaths,
    })
    .from(shoppingImports)
    .where(
      and(
        inArray(shoppingImports.status, ['committed', 'discarded', 'failed']),
        lt(shoppingImports.updatedAt, before),
        sql`${shoppingImports.filePaths} <> '[]'`,
      ),
    )
    .all();
}

/**
 * Zapisuje, że import nie ma już plików na dysku.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param importId - Import.
 */
export function clearImportFiles(handle: DbHandle, householdId: string, importId: string): void {
  handle.db
    .update(shoppingImports)
    .set({ filePaths: '[]' })
    .where(and(eq(shoppingImports.householdId, householdId), eq(shoppingImports.id, importId)))
    .run();
}

/**
 * Wstawia import.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Wiersz.
 */
export function insertImport(handle: DbHandle, row: ShoppingImportInsert): void {
  handle.db.insert(shoppingImports).values(row).run();
}

/**
 * Import gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param importId - Import.
 * @returns Wiersz albo `undefined`.
 */
export function findImport(
  handle: DbHandle,
  householdId: string,
  importId: string,
): ShoppingImportRow | undefined {
  return handle.db
    .select()
    .from(shoppingImports)
    .where(and(eq(shoppingImports.householdId, householdId), eq(shoppingImports.id, importId)))
    .get();
}

/**
 * Zmienia import, ale tylko w jednym z dozwolonych stanów — atomowo, więc dwa równoległe
 * zatwierdzenia albo analiza i odrzucenie nie nadpiszą się nawzajem.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param importId - Import.
 * @param from - Stany, z których wolno przejść.
 * @param patch - Zmienione kolumny.
 * @returns Wiersz po zmianie albo `undefined`, gdy stan się nie zgadzał.
 */
export function transitionImport(
  handle: DbHandle,
  householdId: string,
  importId: string,
  from: readonly ShoppingImportRow['status'][],
  patch: Partial<Omit<ShoppingImportRow, 'id' | 'householdId' | 'createdAt' | 'createdBy'>>,
): ShoppingImportRow | undefined {
  return handle.db
    .update(shoppingImports)
    .set(patch)
    .where(
      and(
        eq(shoppingImports.householdId, householdId),
        eq(shoppingImports.id, importId),
        inArray(shoppingImports.status, [...from]),
      ),
    )
    .returning()
    .get();
}

/**
 * Propozycje importu w kolejności odczytu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param importId - Import.
 * @returns Wiersze propozycji.
 */
export function findImportItems(
  handle: DbHandle,
  householdId: string,
  importId: string,
): ShoppingImportItemRow[] {
  return handle.db
    .select()
    .from(shoppingImportItems)
    .where(
      and(
        eq(shoppingImportItems.householdId, householdId),
        eq(shoppingImportItems.importId, importId),
      ),
    )
    .orderBy(asc(shoppingImportItems.sortOrder))
    .all();
}

/**
 * Zastępuje propozycje importu (ponowny odczyt).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param importId - Import.
 * @param rows - Nowe propozycje.
 */
export function replaceImportItems(
  handle: DbHandle,
  householdId: string,
  importId: string,
  rows: readonly ShoppingImportItemInsert[],
): void {
  handle.db
    .delete(shoppingImportItems)
    .where(
      and(
        eq(shoppingImportItems.householdId, householdId),
        eq(shoppingImportItems.importId, importId),
      ),
    )
    .run();
  if (rows.length > 0)
    handle.db
      .insert(shoppingImportItems)
      .values([...rows])
      .run();
}

/**
 * Zmienia propozycję importu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param itemId - Propozycja.
 * @param patch - Zmienione kolumny.
 */
export function patchImportItem(
  handle: DbHandle,
  householdId: string,
  itemId: string,
  patch: Partial<Omit<ShoppingImportItemRow, 'id' | 'householdId' | 'importId' | 'createdAt'>>,
): void {
  handle.db
    .update(shoppingImportItems)
    .set(patch)
    .where(
      and(eq(shoppingImportItems.householdId, householdId), eq(shoppingImportItems.id, itemId)),
    )
    .run();
}

/**
 * Produkty „zawsze w domu" — nazwy do kontekstu modelu (08 §17.3).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Wiersze produktów.
 */
export function findStapleProducts(handle: DbHandle, householdId: string): ShoppingProductRow[] {
  return handle.db
    .select()
    .from(shoppingProducts)
    .where(and(eq(shoppingProducts.householdId, householdId), eq(shoppingProducts.isStaple, true)))
    .orderBy(asc(shoppingProducts.normalizedName))
    .all();
}

/**
 * Produkty o wskazanych kluczach nazw — do „Już mam" w przeglądzie przepisu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param normalizedNames - Klucze nazw.
 * @returns Wiersze produktów.
 */
export function findProductsByNames(
  handle: DbHandle,
  householdId: string,
  normalizedNames: readonly string[],
): ShoppingProductRow[] {
  if (normalizedNames.length === 0) return [];
  return handle.db
    .select()
    .from(shoppingProducts)
    .where(
      and(
        eq(shoppingProducts.householdId, householdId),
        inArray(shoppingProducts.normalizedName, [...normalizedNames]),
      ),
    )
    .all();
}

/**
 * Oznacza importy w `processing` starsze niż `before` jako przerwane — przy starcie
 * procesu (08 §17.1). **Bez `householdId`**: zadanie konserwacyjne.
 *
 * @param handle - Uchwyt bazy.
 * @param before - Granica `updated_at`.
 * @param now - Znacznik systemowy.
 * @returns Liczba oznaczonych.
 */
export function failStaleImports(handle: DbHandle, before: number, now: number): number {
  return handle.db
    .update(shoppingImports)
    .set({ status: 'failed', errorCode: 'INTERRUPTED', updatedAt: now })
    .where(and(eq(shoppingImports.status, 'processing'), lt(shoppingImports.updatedAt, before)))
    .run().changes;
}
