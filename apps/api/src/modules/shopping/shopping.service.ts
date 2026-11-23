import {
  CLEARED_RESTORE_WINDOW_MS,
  findMergeTarget,
  FREQUENT_LIMIT,
  FREQUENT_WINDOW_MS,
  mergeNotes,
  mergeQuantities,
  nextDefaultList,
  normalizeShoppingName,
  sortShoppingItems,
  STARTER_LIST_NAME,
  STARTER_STAPLES,
  suggestShoppingSection,
  tidyShoppingName,
  type ClearCheckedResult,
  type CreateShoppingItemRequest,
  type CreateShoppingListRequest,
  type ReorderShoppingItemsRequest,
  type ShoppingItemDto,
  type ShoppingItemsDto,
  type ShoppingListDto,
  type ShoppingProductDto,
  type ShoppingProductsQuery,
  type ShoppingSection,
  type UpdateShoppingItemRequest,
  type UpdateShoppingListRequest,
  type UpdateShoppingProductRequest,
  type UpsertShoppingProductRequest,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import { ConflictError, NotFoundError } from '../../core/errors.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import type {
  ShoppingItemRow,
  ShoppingListRow,
  ShoppingProductRow,
} from '../../db/schema/shopping.js';
import { listExportUsers } from '../auth/auth.service.js';
import { parseImportFilePaths } from './shopping.files.js';
import {
  initialsOf,
  toShoppingItemDto,
  toShoppingListDto,
  toShoppingProductDto,
  type ItemMappingContext,
} from './shopping.mapper.js';
import {
  clearCheckedItems,
  countItems,
  findItem,
  findList,
  findLists,
  findMaxItemOrder,
  findMaxListOrder,
  findPendingImports,
  findProduct,
  findProductByName,
  findProductsByIds,
  findImportFilePaths,
  findListActivity,
  findListIdsWithProduct,
  findRecentlyUsedProducts,
  findShoppingInitializedAt,
  findVisibleItems,
  insertItems,
  insertList,
  insertProduct,
  itemIdTaken,
  markShoppingInitialized,
  patchItem,
  patchList,
  patchProduct,
  purgeClearedItems,
  removeItems,
  removeList,
  removeProduct,
  restoreClearedItems,
  searchProducts,
  touchList,
} from './shopping.repository.js';

/**
 * Serwis list zakupów — wymaganie #15, Faza 10
 * ([07 §14](../../../../../../plans/07-domain-rules.md#14-listy-zakupów), ADR-093…097).
 *
 * Reguły są w `shared/domain/shopping.ts`; tutaj niezmienniki zapisu (I-26…I-29),
 * transakcje bazy i składanie DTO. Lista nie zna kwot i nie dotyka księgi.
 */

const LIST_NOT_FOUND = 'Nie znaleziono listy zakupów.';
const ITEM_NOT_FOUND = 'Nie znaleziono pozycji listy.';
const PRODUCT_NOT_FOUND = 'Nie znaleziono produktu.';
const ARCHIVED_MESSAGE = 'Lista jest w archiwum. Przywróć ją, żeby coś zmienić.';
const CLEARED_MESSAGE = 'Ta pozycja została już wyczyszczona z listy.';

/** Wynik dopisania — trasa wybiera z niego kod odpowiedzi (04 §14b). */
export interface CreateItemOutcome {
  readonly item: ShoppingItemDto;
  /** `created` → 201, `merged` i `repeated` (ponowienie z tym samym `id`) → 200. */
  readonly kind: 'created' | 'merged' | 'repeated';
}

/** Wynik dopisania produktu — `201` dla nowego, `200` dla istniejącego. */
export interface UpsertProductOutcome {
  readonly product: ShoppingProductDto;
  readonly created: boolean;
}

/**
 * Zakłada zestaw startowy przy pierwszym wejściu w Zakupy (07 §14.6, 03 §5a): listę
 * „Spożywcze" (domyślną, gdy gospodarstwo nie ma żadnej) i produkty „zawsze w domu".
 * Idempotentne — znacznik w `households` decyduje, czy już było.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Użytkownik z tokenu.
 */
export function ensureShoppingSetup(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
): void {
  if (findShoppingInitializedAt(handle, householdId) !== null) return;
  handle.sqlite.transaction(() => {
    if (findShoppingInitializedAt(handle, householdId) !== null) return;
    const now = clock.now().getTime();
    if (findLists(handle, householdId).length === 0) {
      insertList(handle, {
        id: newId(),
        householdId,
        name: STARTER_LIST_NAME,
        isDefault: true,
        sortOrder: 0,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const staple of STARTER_STAPLES) {
      const normalizedName = normalizeShoppingName(staple.name);
      const existing = findProductByName(handle, householdId, normalizedName);
      if (existing) {
        patchProduct(handle, householdId, existing.id, { isStaple: true, updatedAt: now });
      } else {
        insertProduct(handle, {
          id: newId(),
          householdId,
          name: staple.name,
          normalizedName,
          section: staple.section,
          isStaple: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    markShoppingInitialized(handle, householdId, now);
  })();
}

/**
 * Listy z licznikami, ostatnią zmianą i importami do przejrzenia.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param lists - Wiersze list.
 * @returns DTO list w tej samej kolejności.
 */
function toListDtos(
  handle: DbHandle,
  householdId: string,
  lists: readonly ShoppingListRow[],
): ShoppingListDto[] {
  const ids = lists.map((list) => list.id);
  const counts = new Map(countItems(handle, householdId, ids).map((row) => [row.listId, row]));
  const names = new Map(
    listExportUsers(handle, householdId).map((user) => [user.id, user.displayName]),
  );
  const activity = new Map(
    findListActivity(handle, householdId, ids).map((row) => [row.listId, row]),
  );
  const pending = new Map<string, ShoppingListDto['pendingImports'][number][]>();
  for (const row of findPendingImports(handle, householdId, ids)) {
    pending.set(row.listId, [
      ...(pending.get(row.listId) ?? []),
      { id: row.id, status: row.status, kind: row.kind },
    ]);
  }
  return lists.map((list) =>
    toShoppingListDto(list, {
      toBuyCount: Number(counts.get(list.id)?.toBuyCount ?? 0),
      checkedCount: Number(counts.get(list.id)?.checkedCount ?? 0),
      lastActivityAt: activity.get(list.id)?.updatedAt ?? null,
      lastActivityBy: names.get(activity.get(list.id)?.updatedBy ?? '') ?? null,
      pendingImports: pending.get(list.id) ?? [],
    }),
  );
}

/**
 * Listy gospodarstwa — przy pierwszym wejściu zakłada zestaw startowy (04 §14b).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Użytkownik z tokenu.
 * @param archived - `true` — archiwum, w przeciwnym razie listy bieżące.
 * @returns Listy.
 */
export function listShoppingLists(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  archived: boolean,
): ShoppingListDto[] {
  ensureShoppingSetup(handle, clock, householdId, userId);
  return toListDtos(handle, householdId, findLists(handle, householdId, archived));
}

/**
 * Lista gospodarstwa albo 404.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param listId - Lista.
 * @returns Wiersz listy.
 * @throws {NotFoundError} Gdy listy nie ma w gospodarstwie.
 */
function requireList(handle: DbHandle, householdId: string, listId: string): ShoppingListRow {
  const list = findList(handle, householdId, listId);
  if (!list) throw new NotFoundError(LIST_NOT_FOUND);
  return list;
}

/**
 * Lista, którą wolno zmieniać — istnieje i nie jest w archiwum.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param listId - Lista.
 * @returns Wiersz listy.
 * @throws {NotFoundError} Gdy listy nie ma.
 * @throws {ConflictError} Gdy lista jest w archiwum.
 */
export function requireEditableList(
  handle: DbHandle,
  householdId: string,
  listId: string,
): ShoppingListRow {
  const list = requireList(handle, householdId, listId);
  if (list.archivedAt !== null) throw new ConflictError(ARCHIVED_MESSAGE);
  return list;
}

/**
 * Jedna lista w kształcie kontraktu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param listId - Lista.
 * @returns DTO listy.
 */
function listDto(handle: DbHandle, householdId: string, listId: string): ShoppingListDto {
  const [dto] = toListDtos(handle, householdId, [requireList(handle, householdId, listId)]);
  return dto as ShoppingListDto;
}

/**
 * Przenosi flagę domyślnej na następną listę, gdy żadna niezarchiwizowana jej nie ma
 * (I-26). Woła się po archiwizacji, przywróceniu i usunięciu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param now - Znacznik systemowy.
 */
function repairDefaultList(handle: DbHandle, householdId: string, now: number): void {
  const lists = findLists(handle, householdId);
  if (lists.some((list) => list.isDefault && list.archivedAt === null)) return;
  for (const list of lists.filter((row) => row.isDefault)) {
    patchList(handle, householdId, list.id, { isDefault: false, updatedAt: now });
  }
  const next = nextDefaultList(lists);
  if (next) patchList(handle, householdId, next.id, { isDefault: true, updatedAt: now });
}

/**
 * Zakłada listę — na końcu kolejności; pierwsza zostaje domyślną (I-26).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Użytkownik z tokenu.
 * @param request - Nazwa.
 * @returns Nowa lista.
 */
export function createShoppingList(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  request: CreateShoppingListRequest,
): ShoppingListDto {
  const id = newId();
  handle.sqlite.transaction(() => {
    const now = clock.now().getTime();
    insertList(handle, {
      id,
      householdId,
      name: request.name,
      isDefault: false,
      sortOrder: findMaxListOrder(handle, householdId) + 1,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    repairDefaultList(handle, householdId, now);
  })();
  return listDto(handle, householdId, id);
}

/**
 * Zmienia nazwę, ustawia domyślną albo archiwizuje / przywraca listę.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param listId - Lista.
 * @param request - Zmiany.
 * @returns Lista po zmianie.
 * @throws {ConflictError} Gdy domyślną ma zostać lista z archiwum.
 */
export function updateShoppingList(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  listId: string,
  request: UpdateShoppingListRequest,
): ShoppingListDto {
  handle.sqlite.transaction(() => {
    const list = requireList(handle, householdId, listId);
    const now = clock.now().getTime();
    const archivedAt =
      request.archived === undefined
        ? list.archivedAt
        : request.archived
          ? (list.archivedAt ?? now)
          : null;
    if (request.isDefault && archivedAt !== null) {
      throw new ConflictError('Lista z archiwum nie może być domyślna.');
    }
    if (request.isDefault) {
      for (const other of findLists(handle, householdId).filter((row) => row.isDefault)) {
        patchList(handle, householdId, other.id, { isDefault: false, updatedAt: now });
      }
    }
    patchList(handle, householdId, listId, {
      name: request.name ?? list.name,
      archivedAt,
      isDefault: request.isDefault ?? (archivedAt === null && list.isDefault),
      updatedAt: Math.max(now, list.updatedAt + 1),
    });
    repairDefaultList(handle, householdId, now);
  })();
  return listDto(handle, householdId, listId);
}

/**
 * Ustawia kolejność list (`PATCH /shopping-lists/order`). Listy spoza żądania zachowują
 * swoją pozycję za podanymi.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param listIds - Listy w nowej kolejności.
 * @returns Listy bieżące po zmianie.
 * @throws {NotFoundError} Gdy któraś lista nie należy do gospodarstwa.
 */
export function reorderShoppingLists(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  listIds: readonly string[],
): ShoppingListDto[] {
  handle.sqlite.transaction(() => {
    const lists = findLists(handle, householdId);
    const known = new Set(lists.map((list) => list.id));
    if (listIds.some((id) => !known.has(id))) throw new NotFoundError(LIST_NOT_FOUND);
    const unique = [...new Set(listIds)];
    const rest = lists.filter((list) => !unique.includes(list.id)).map((list) => list.id);
    const now = clock.now().getTime();
    [...unique, ...rest].forEach((id, index) => {
      patchList(handle, householdId, id, { sortOrder: index, updatedAt: now });
    });
  })();
  return toListDtos(handle, householdId, findLists(handle, householdId, false));
}

/**
 * Usuwa listę z pozycjami i importami; flaga domyślnej przechodzi dalej (I-26).
 *
 * Pliki importów usuwa wołający **po** zatwierdzeniu transakcji (I-31) — jak przy
 * resecie danych: plik bez wiersza to mniejsze zło niż wiersz bez pliku.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param listId - Lista.
 * @returns Ścieżki plików importów (względem `UPLOAD_DIR`) do usunięcia z dysku.
 */
export function deleteShoppingList(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  listId: string,
): string[] {
  return handle.sqlite.transaction((): string[] => {
    requireList(handle, householdId, listId);
    // Kaskada usuwa wiersze importów, a tylko one znają pliki — zbieramy ścieżki przed nią.
    const files = findImportFilePaths(handle, householdId, listId).flatMap(parseImportFilePaths);
    removeList(handle, householdId, listId);
    repairDefaultList(handle, householdId, clock.now().getTime());
    return files;
  })();
}

/**
 * Kopia listy: pozycje do kupienia i kupione (niewyczyszczone) jako *do kupienia*, ze
 * scalaniem powtórzeń (I-29) — „Decathlon" jako szablon następnego wyjazdu (17 §3.3).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Użytkownik z tokenu.
 * @param listId - Lista źródłowa.
 * @param name - Nazwa kopii.
 * @returns Nowa lista.
 */
export function duplicateShoppingList(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  listId: string,
  name: string,
): ShoppingListDto {
  const id = newId();
  handle.sqlite.transaction(() => {
    requireList(handle, householdId, listId);
    const now = clock.now().getTime();
    insertList(handle, {
      id,
      householdId,
      name,
      isDefault: false,
      sortOrder: findMaxListOrder(handle, householdId) + 1,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    const copies: ShoppingItemRow[] = [];
    const source = [...findVisibleItems(handle, householdId, listId)].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
    );
    for (const item of source) {
      const target = findMergeTarget(
        copies.map((copy) => ({ ...copy, checked: false })),
        item.normalizedName,
        item.unit,
      );
      if (target) {
        const merged = mergeQuantities(target, item);
        const index = copies.findIndex((copy) => copy.id === target.id);
        copies[index] = {
          ...(copies[index] as ShoppingItemRow),
          quantityMilli: merged.quantityMilli,
          unit: merged.unit,
          note: mergeNotes(target.note, item.note),
        };
        continue;
      }
      copies.push({
        ...item,
        id: newId(),
        listId: id,
        sortOrder: copies.length,
        source: 'manual',
        importId: null,
        checkedAt: null,
        checkedBy: null,
        clearedAt: null,
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    }
    insertItems(handle, copies);
    repairDefaultList(handle, householdId, now);
  })();
  return listDto(handle, householdId, id);
}

/**
 * Kontekst mapowania pozycji: inicjały domowników i produkty „zawsze w domu".
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param items - Pozycje do pokazania.
 * @returns Słowniki dla mappera.
 */
function itemContext(
  handle: DbHandle,
  householdId: string,
  items: readonly ShoppingItemRow[],
): ItemMappingContext {
  const productIds = [
    ...new Set(items.flatMap((item) => (item.productId === null ? [] : [item.productId]))),
  ];
  return {
    initials: new Map(
      listExportUsers(handle, householdId).map((user) => [user.id, initialsOf(user.displayName)]),
    ),
    stapleProductIds: new Set(
      findProductsByIds(handle, householdId, productIds)
        .filter((product) => product.isStaple)
        .map((product) => product.id),
    ),
  };
}

/**
 * Jedna pozycja w kształcie kontraktu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param itemId - Pozycja.
 * @returns DTO pozycji.
 */
function itemDto(handle: DbHandle, householdId: string, itemId: string): ShoppingItemDto {
  const row = findItem(handle, householdId, itemId) as ShoppingItemRow;
  return toShoppingItemDto(row, itemContext(handle, householdId, [row]));
}

/**
 * Wersja listy do `ETag` odpytywania — rośnie przy każdej zmianie pozycji (04 §14b).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param listId - Lista.
 * @returns Znacznik zmiany listy.
 * @throws {NotFoundError} Gdy listy nie ma.
 */
export function shoppingListVersion(handle: DbHandle, householdId: string, listId: string): number {
  return requireList(handle, householdId, listId).updatedAt;
}

/**
 * Pozycje listy bez wyczyszczonych, w kolejności ekranu (07 §14.6).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param listId - Lista.
 * @returns Lista i jej pozycje.
 */
export function getShoppingItems(
  handle: DbHandle,
  householdId: string,
  listId: string,
): ShoppingItemsDto {
  const list = listDto(handle, householdId, listId);
  const rows = sortShoppingItems(findVisibleItems(handle, householdId, listId));
  const context = itemContext(handle, householdId, rows);
  return { list, items: rows.map((row) => toShoppingItemDto(row, context)) };
}

/**
 * Podpina pozycję pod produkt słownika i liczy użycie (07 §14.5): brak produktu →
 * nowy z działem pozycji; jest → `use_count + 1`, a jawnie podany dział nadpisuje
 * zapamiętany.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param name - Nazwa pozycji.
 * @param normalizedName - Klucz nazwy.
 * @param section - Dział pozycji.
 * @param explicitSection - Czy dział podano wprost (wtedy trafia do słownika).
 * @param now - Znacznik systemowy.
 * @returns Identyfikator produktu.
 */
function recordProductUse(
  handle: DbHandle,
  householdId: string,
  name: string,
  normalizedName: string,
  section: ShoppingSection,
  explicitSection: boolean,
  now: number,
): string {
  const product = findProductByName(handle, householdId, normalizedName);
  if (product) {
    patchProduct(handle, householdId, product.id, {
      useCount: product.useCount + 1,
      lastUsedAt: now,
      section: explicitSection ? section : product.section,
      updatedAt: now,
    });
    return product.id;
  }
  const id = newId();
  insertProduct(handle, {
    id,
    householdId,
    name,
    normalizedName,
    section,
    isStaple: false,
    useCount: 1,
    lastUsedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/**
 * Dopisuje pozycję albo scala ją z istniejącą do kupienia (07 §14.3, I-29).
 *
 * Identyfikator od klienta (ADR-096): już istniejący w tym gospodarstwie to ponowienie
 * z kolejki offline — oddajemy tę pozycję bez zmian; zajęty gdzie indziej — `409`.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Użytkownik z tokenu.
 * @param listId - Lista.
 * @param request - Pozycja.
 * @returns Pozycja i rodzaj wyniku.
 * @throws {ConflictError} Gdy lista jest w archiwum albo identyfikator jest zajęty.
 */
export function createShoppingItem(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  listId: string,
  request: CreateShoppingItemRequest,
): CreateItemOutcome {
  let outcome: { id: string; kind: CreateItemOutcome['kind'] } = { id: '', kind: 'created' };
  handle.sqlite.transaction(() => {
    if (request.id !== undefined) {
      const existing = findItem(handle, householdId, request.id);
      if (existing) {
        outcome = { id: existing.id, kind: 'repeated' };
        return;
      }
      if (itemIdTaken(handle, request.id)) {
        throw new ConflictError('Ten identyfikator pozycji jest już zajęty.');
      }
    }
    requireEditableList(handle, householdId, listId);
    const now = clock.now().getTime();
    const added = addItemToList(handle, householdId, userId, listId, {
      id: request.id,
      name: request.name,
      quantityMilli: request.quantityMilli ?? null,
      unit: request.unit ?? null,
      note: request.note ?? null,
      section: request.section,
      source: 'manual',
      importId: null,
      now,
    });
    outcome = { id: added.id, kind: added.merged ? 'merged' : 'created' };
    touchList(handle, householdId, listId, now);
  })();
  return { item: itemDto(handle, householdId, outcome.id), kind: outcome.kind };
}

/** Pozycja do dopisania — ręcznie albo z zatwierdzonego importu. */
export interface NewItemInput {
  /** Identyfikator od klienta (dopisanie offline); `undefined` — nowy z serwera. */
  readonly id: string | undefined;
  readonly name: string;
  readonly quantityMilli: number | null;
  readonly unit: ShoppingItemDto['unit'];
  readonly note: string | null;
  /** Dział podany wprost — trafia też do słownika; `undefined` — podpowiedź (07 §14.5). */
  readonly section: ShoppingSection | undefined;
  readonly source: ShoppingItemDto['source'];
  readonly importId: string | null;
  readonly now: number;
}

/**
 * Dopisuje pozycję do listy albo scala ją z istniejącą do kupienia (07 §14.3, I-29) —
 * wspólne dla dopisania ręcznego i zatwierdzenia importu (I-30). Bez transakcji
 * i bez podbijania wersji listy: to robi wołający.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Kto dopisuje.
 * @param listId - Lista (sprawdzona przez wołającego).
 * @param input - Pozycja.
 * @returns Identyfikator pozycji i czy się scaliła.
 */
export function addItemToList(
  handle: DbHandle,
  householdId: string,
  userId: string,
  listId: string,
  input: NewItemInput,
): { id: string; merged: boolean } {
  const { now } = input;
  const name = tidyShoppingName(input.name);
  const normalizedName = normalizeShoppingName(name);
  const product = findProductByName(handle, householdId, normalizedName);
  const section = input.section ?? suggestShoppingSection(normalizedName, product?.section ?? null);
  const quantity = { quantityMilli: input.quantityMilli, unit: input.unit };
  const productId = recordProductUse(
    handle,
    householdId,
    name,
    normalizedName,
    section,
    input.section !== undefined,
    now,
  );
  const target = findMergeTarget(
    findVisibleItems(handle, householdId, listId).map((row) => ({
      ...row,
      checked: row.checkedAt !== null,
    })),
    normalizedName,
    quantity.unit,
  );
  if (target) {
    const merged = mergeQuantities(target, quantity);
    patchItem(handle, householdId, target.id, {
      quantityMilli: merged.quantityMilli,
      unit: merged.unit,
      note: mergeNotes(target.note, input.note),
      productId,
      updatedBy: userId,
      updatedAt: now,
    });
    return { id: target.id, merged: true };
  }
  const id = input.id ?? newId();
  insertItems(handle, [
    {
      id,
      householdId,
      listId,
      productId,
      name,
      normalizedName,
      quantityMilli: quantity.quantityMilli,
      unit: quantity.unit,
      note: input.note,
      section,
      sortOrder: findMaxItemOrder(handle, householdId, listId) + 1,
      source: input.source,
      importId: input.importId,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { id, merged: false };
}

/**
 * Wchłania w pozycję inne pozycje *do kupienia* z tym samym kluczem na jej liście —
 * po odznaczeniu, przemianowaniu, zmianie jednostki albo przeniesieniu, żeby I-29
 * trzymało. Zostaje pozycja zmieniana, więc klient nie traci identyfikatora; dział
 * przechodzi z pozycji wchłoniętej.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Kto zmienia.
 * @param item - Pozycja po zmianie (do kupienia).
 * @param now - Znacznik systemowy.
 */
function absorbDuplicates(
  handle: DbHandle,
  householdId: string,
  userId: string,
  item: ShoppingItemRow,
  now: number,
): void {
  let current = item;
  for (;;) {
    const others = findVisibleItems(handle, householdId, current.listId)
      .filter((row) => row.id !== current.id)
      .map((row) => ({ ...row, checked: row.checkedAt !== null }));
    const duplicate = findMergeTarget(others, current.normalizedName, current.unit);
    if (!duplicate) return;
    const merged = mergeQuantities(current, duplicate);
    const note = mergeNotes(current.note, duplicate.note);
    removeItems(handle, householdId, [duplicate.id]);
    // Dział z pozycji, która już była na liście (07 §14.3) — przeniesione „Mleko" z „Inne"
    // ląduje w nabiale, gdzie stało mleko tej listy.
    patchItem(handle, householdId, current.id, {
      quantityMilli: merged.quantityMilli,
      unit: merged.unit,
      note,
      section: duplicate.section,
      updatedBy: userId,
      updatedAt: now,
    });
    current = {
      ...current,
      quantityMilli: merged.quantityMilli,
      unit: merged.unit,
      note,
      section: duplicate.section,
    };
  }
}

/**
 * Zmienia pozycję: nazwę, ilość, notatkę, dział, stan „kupione", listę (04 §14b).
 *
 * Odhaczenie jest idempotentne — ponowienie z kolejki offline niczego nie zmienia
 * (07 §14.7). Pozycja do kupienia po zmianie wchłania duplikaty (I-29).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Użytkownik z tokenu.
 * @param itemId - Pozycja.
 * @param request - Zmiany.
 * @returns Pozycja po zmianie.
 * @throws {NotFoundError} Gdy pozycji albo listy docelowej nie ma.
 * @throws {ConflictError} Gdy pozycja jest wyczyszczona albo lista w archiwum.
 */
export function updateShoppingItem(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  itemId: string,
  request: UpdateShoppingItemRequest,
): ShoppingItemDto {
  handle.sqlite.transaction(() => {
    const item = findItem(handle, householdId, itemId);
    if (!item) throw new NotFoundError(ITEM_NOT_FOUND);
    if (item.clearedAt !== null) throw new ConflictError(CLEARED_MESSAGE);
    requireEditableList(handle, householdId, item.listId);
    const targetListId = request.listId ?? item.listId;
    if (targetListId !== item.listId) requireEditableList(handle, householdId, targetListId);

    const now = clock.now().getTime();
    const next: ShoppingItemRow = { ...item };
    if (request.name !== undefined) {
      next.name = tidyShoppingName(request.name);
      next.normalizedName = normalizeShoppingName(next.name);
    }
    if (request.quantityMilli === null || request.unit === null) {
      // `null` w jednym z pól czyści oba (I-27, 05 §13c).
      next.quantityMilli = null;
      next.unit = null;
    } else if (request.quantityMilli !== undefined && request.unit !== undefined) {
      next.quantityMilli = request.quantityMilli;
      next.unit = request.unit;
    }
    if (request.note !== undefined) next.note = request.note;
    if (request.section !== undefined) next.section = request.section;
    if (request.checked === true && item.checkedAt === null) {
      next.checkedAt = now;
      next.checkedBy = userId;
    }
    if (request.checked === false && item.checkedAt !== null) {
      next.checkedAt = null;
      next.checkedBy = null;
    }
    next.listId = targetListId;
    // Przeniesiona na inną listę ląduje na jej końcu (ADR-104).
    if (targetListId !== item.listId) {
      next.sortOrder = findMaxItemOrder(handle, householdId, targetListId) + 1;
    }

    const changed = (Object.keys(next) as (keyof ShoppingItemRow)[]).some(
      (key) => next[key] !== item[key],
    );
    if (!changed) return;

    if (next.normalizedName !== item.normalizedName || request.section !== undefined) {
      const product = findProductByName(handle, householdId, next.normalizedName);
      if (product) {
        next.productId = product.id;
        if (request.section !== undefined) {
          patchProduct(handle, householdId, product.id, { section: next.section, updatedAt: now });
        }
      } else {
        next.productId = recordProductUse(
          handle,
          householdId,
          next.name,
          next.normalizedName,
          next.section,
          true,
          now,
        );
      }
    }

    next.updatedAt = now;
    patchItem(handle, householdId, itemId, {
      listId: next.listId,
      productId: next.productId,
      name: next.name,
      normalizedName: next.normalizedName,
      quantityMilli: next.quantityMilli,
      unit: next.unit,
      note: next.note,
      section: next.section,
      sortOrder: next.sortOrder,
      checkedAt: next.checkedAt,
      checkedBy: next.checkedBy,
      updatedBy: userId,
      updatedAt: now,
    });
    if (next.checkedAt === null) absorbDuplicates(handle, householdId, userId, next, now);
    touchList(handle, householdId, item.listId, now);
    if (targetListId !== item.listId) touchList(handle, householdId, targetListId, now);
  })();
  return itemDto(handle, householdId, itemId);
}

/**
 * Usuwa pozycję. Nieistniejąca to nie błąd — ponowienie z kolejki offline (04 §14b).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param itemId - Pozycja.
 * @throws {ConflictError} Gdy lista jest w archiwum.
 */
export function deleteShoppingItem(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  itemId: string,
): void {
  handle.sqlite.transaction(() => {
    const item = findItem(handle, householdId, itemId);
    if (!item) return;
    requireEditableList(handle, householdId, item.listId);
    removeItems(handle, householdId, [itemId]);
    touchList(handle, householdId, item.listId, clock.now().getTime());
  })();
}

/**
 * Kolejność pozycji *do kupienia* po przeciągnięciu (07 §14.6, ADR-104). Wymienione
 * dostają `sortOrder` 0…n−1, pozostałe do kupienia idą za nimi w dotychczasowej
 * kolejności. `move` zmienia dział upuszczonej pozycji i produktu w słowniku — jak jawna
 * zmiana działu. Nieznane, kupione i wyczyszczone identyfikatory są pomijane: powtórka
 * z kolejki offline po cudzej zmianie nie może skończyć się błędem.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Kto przestawia.
 * @param listId - Lista.
 * @param request - Kolejność i ewentualna zmiana działu.
 * @throws {NotFoundError} Gdy listy nie ma.
 * @throws {ConflictError} Gdy lista jest w archiwum.
 */
export function reorderShoppingItems(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  listId: string,
  request: ReorderShoppingItemsRequest,
): void {
  handle.sqlite.transaction(() => {
    requireEditableList(handle, householdId, listId);
    const now = clock.now().getTime();
    const toBuy = sortShoppingItems(
      findVisibleItems(handle, householdId, listId).filter((item) => item.checkedAt === null),
      { bySection: false },
    );
    const byId = new Map(toBuy.map((item) => [item.id, item]));
    const listed = [...new Set(request.itemIds)].filter((id) => byId.has(id));
    const rest = toBuy.filter((item) => !listed.includes(item.id)).map((item) => item.id);
    let changed = false;
    [...listed, ...rest].forEach((id, index) => {
      const item = byId.get(id) as ShoppingItemRow;
      const section =
        request.move?.itemId === id && request.move.section !== item.section
          ? request.move.section
          : item.section;
      if (item.sortOrder === index && section === item.section) return;
      changed = true;
      patchItem(handle, householdId, id, {
        sortOrder: index,
        section,
        updatedBy: userId,
        updatedAt: now,
      });
      if (section !== item.section) {
        const product = findProductByName(handle, householdId, item.normalizedName);
        if (product) {
          patchProduct(handle, householdId, product.id, { section, updatedAt: now });
        }
      }
    });
    if (changed) touchList(handle, householdId, listId, now);
  })();
}

/**
 * „Wyczyść kupione" (07 §14.7): najpierw fizycznie usuwa pozycje wyczyszczone dawniej
 * niż 24 h, potem oznacza kupione jako wyczyszczone (do „Cofnij").
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Kto czyści.
 * @param listId - Lista.
 * @returns Wyczyszczone pozycje i czy coś zostało do kupienia.
 */
export function clearCheckedShoppingItems(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  listId: string,
): ClearCheckedResult {
  return handle.sqlite.transaction((): ClearCheckedResult => {
    requireEditableList(handle, householdId, listId);
    const now = clock.now().getTime();
    purgeClearedItems(handle, householdId, listId, now - CLEARED_RESTORE_WINDOW_MS);
    const clearedIds = clearCheckedItems(handle, householdId, userId, listId, now);
    if (clearedIds.length > 0) touchList(handle, householdId, listId, now);
    const listEmpty = !findVisibleItems(handle, householdId, listId).some(
      (item) => item.checkedAt === null,
    );
    return { clearedIds, listEmpty };
  })();
}

/**
 * Cofa „Wyczyść kupione" — pozycje wracają jako kupione. Starsze niż 24 h i już usunięte
 * są pomijane (I-28).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Kto cofa.
 * @param listId - Lista.
 * @param itemIds - Pozycje.
 * @returns Przywrócone pozycje.
 */
export function restoreClearedShoppingItems(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  listId: string,
  itemIds: readonly string[],
): string[] {
  return handle.sqlite.transaction((): string[] => {
    requireEditableList(handle, householdId, listId);
    const now = clock.now().getTime();
    const restored = restoreClearedItems(
      handle,
      householdId,
      userId,
      listId,
      itemIds,
      now - CLEARED_RESTORE_WINDOW_MS,
      now,
    );
    if (restored.length > 0) touchList(handle, householdId, listId, now);
    return restored;
  })();
}

/**
 * Podbija wersję list z pozycjami produktu — flaga „zawsze w domu" jest w ich treści,
 * więc odpytywanie z `ETag` musi zobaczyć zmianę (04 §14b).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param productId - Produkt.
 * @param now - Znacznik systemowy.
 */
function touchListsWithProduct(
  handle: DbHandle,
  householdId: string,
  productId: string,
  now: number,
): void {
  for (const listId of findListIdsWithProduct(handle, householdId, productId)) {
    touchList(handle, householdId, listId, now);
  }
}

/**
 * Podpowiedzi ze słownika i produkty „zawsze w domu" (`GET /shopping-products`).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Prefiks, flaga, limit.
 * @returns Produkty.
 */
export function listShoppingProducts(
  handle: DbHandle,
  householdId: string,
  query: ShoppingProductsQuery,
): ShoppingProductDto[] {
  return searchProducts(handle, householdId, {
    prefix: normalizeShoppingName(query.q ?? ''),
    staple: query.staple,
    limit: query.limit,
  }).map(toShoppingProductDto);
}

/**
 * „Często kupowane" dla listy (07 §14.5): z ostatnich 90 dni, bez produktów, które są na
 * tej liście do kupienia.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param listId - Lista.
 * @returns Do 12 produktów.
 */
export function frequentShoppingProducts(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  listId: string,
): ShoppingProductDto[] {
  requireList(handle, householdId, listId);
  const onList = new Set(
    findVisibleItems(handle, householdId, listId)
      .filter((item) => item.checkedAt === null)
      .map((item) => item.normalizedName),
  );
  return findRecentlyUsedProducts(handle, householdId, clock.now().getTime() - FREQUENT_WINDOW_MS)
    .filter((product) => !onList.has(product.normalizedName))
    .slice(0, FREQUENT_LIMIT)
    .map(toShoppingProductDto);
}

/**
 * Dopisuje produkt do słownika albo zmienia flagę istniejącego (ekran *Zawsze w domu*,
 * „Zawsze mam" w przeglądzie importu).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param request - Nazwa, dział, flaga.
 * @returns Produkt i czy powstał.
 */
export function upsertShoppingProduct(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  request: UpsertShoppingProductRequest,
): UpsertProductOutcome {
  return handle.sqlite.transaction((): UpsertProductOutcome => {
    const now = clock.now().getTime();
    const name = tidyShoppingName(request.name);
    const normalizedName = normalizeShoppingName(name);
    const existing = findProductByName(handle, householdId, normalizedName);
    if (existing) {
      patchProduct(handle, householdId, existing.id, {
        isStaple: request.isStaple,
        section: request.section ?? existing.section,
        updatedAt: now,
      });
      touchListsWithProduct(handle, householdId, existing.id, now);
      return {
        product: toShoppingProductDto(
          findProduct(handle, householdId, existing.id) as ShoppingProductRow,
        ),
        created: false,
      };
    }
    const id = newId();
    insertProduct(handle, {
      id,
      householdId,
      name,
      normalizedName,
      section: request.section ?? suggestShoppingSection(normalizedName, null),
      isStaple: request.isStaple,
      createdAt: now,
      updatedAt: now,
    });
    return {
      product: toShoppingProductDto(findProduct(handle, householdId, id) as ShoppingProductRow),
      created: true,
    };
  })();
}

/**
 * Zmienia produkt słownika.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param productId - Produkt.
 * @param request - Zmiany.
 * @returns Produkt po zmianie.
 * @throws {NotFoundError} Gdy produktu nie ma.
 * @throws {ConflictError} Gdy nowa nazwa jest zajęta przez inny produkt.
 */
export function updateShoppingProduct(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  productId: string,
  request: UpdateShoppingProductRequest,
): ShoppingProductDto {
  return handle.sqlite.transaction((): ShoppingProductDto => {
    const product = findProduct(handle, householdId, productId);
    if (!product) throw new NotFoundError(PRODUCT_NOT_FOUND);
    const name = request.name === undefined ? product.name : tidyShoppingName(request.name);
    const normalizedName = normalizeShoppingName(name);
    const clash = findProductByName(handle, householdId, normalizedName);
    if (clash && clash.id !== productId) {
      throw new ConflictError('Produkt o tej nazwie już jest w słowniku.');
    }
    const now = clock.now().getTime();
    patchProduct(handle, householdId, productId, {
      name,
      normalizedName,
      section: request.section ?? product.section,
      isStaple: request.isStaple ?? product.isStaple,
      updatedAt: now,
    });
    touchListsWithProduct(handle, householdId, productId, now);
    return toShoppingProductDto(findProduct(handle, householdId, productId) as ShoppingProductRow);
  })();
}

/**
 * Usuwa produkt ze słownika — pozycje zostają na listach bez powiązania.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param productId - Produkt.
 */
export function deleteShoppingProduct(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  productId: string,
): void {
  handle.sqlite.transaction(() => {
    touchListsWithProduct(handle, householdId, productId, clock.now().getTime());
    removeProduct(handle, householdId, productId);
  })();
}
