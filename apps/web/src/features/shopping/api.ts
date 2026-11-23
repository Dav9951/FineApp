import type {
  ClearCheckedResult,
  CreateShoppingItemRequest,
  CreateShoppingItemResult,
  CreateShoppingListRequest,
  RestoreClearedResult,
  ShoppingItemDto,
  ShoppingItemsDto,
  ShoppingListDto,
  ShoppingProductDto,
  UpdateShoppingItemRequest,
  UpdateShoppingListRequest,
  UpdateShoppingProductRequest,
  UpsertShoppingProductRequest,
} from '@fineapp/shared';

import { apiRequest } from '../../lib/api-client.js';

/**
 * Wywołania API list zakupów
 * ([04 §14b](../../../../../plans/04-api-spec.md#14b-listy-zakupów--apiv1shopping-lists-shopping-items-shopping-products-shopping-imports)).
 *
 * Funkcje są cienkie: ścieżka, metoda, ciało. Stan, cache, kolejka offline i unieważnianie
 * mieszkają w `hooks/use-shopping.ts` i `offline.ts`.
 *
 * Odpytywanie pozycji co 15 s nie potrzebuje własnej obsługi `ETag`: serwer odpowiada
 * `Cache-Control: private, no-cache` z `ETag`, więc przeglądarka sama dokleja
 * `If-None-Match`, a `304` zamienia na zapamiętaną odpowiedź.
 */

/**
 * Listy bieżące albo archiwum.
 *
 * @param accessToken - Token dostępu.
 * @param archived - Archiwum zamiast list bieżących.
 * @returns Listy.
 */
export function fetchShoppingLists(
  accessToken: string,
  archived = false,
): Promise<ShoppingListDto[]> {
  return apiRequest<ShoppingListDto[]>('/shopping-lists', {
    accessToken,
    query: archived ? { archived: 'true' } : undefined,
  });
}

/**
 * Zakłada listę.
 *
 * @param accessToken - Token dostępu.
 * @param body - Nazwa.
 * @returns Lista.
 */
export function createShoppingList(
  accessToken: string,
  body: CreateShoppingListRequest,
): Promise<ShoppingListDto> {
  return apiRequest<ShoppingListDto>('/shopping-lists', { method: 'POST', accessToken, body });
}

/**
 * Zmienia nazwę, domyślność albo archiwum listy.
 *
 * @param accessToken - Token dostępu.
 * @param listId - Lista.
 * @param body - Zmiany.
 * @returns Lista.
 */
export function updateShoppingList(
  accessToken: string,
  listId: string,
  body: UpdateShoppingListRequest,
): Promise<ShoppingListDto> {
  return apiRequest<ShoppingListDto>(`/shopping-lists/${listId}`, {
    method: 'PATCH',
    accessToken,
    body,
  });
}

/**
 * Usuwa listę.
 *
 * @param accessToken - Token dostępu.
 * @param listId - Lista.
 * @returns Obietnica spełniona po usunięciu.
 */
export async function deleteShoppingList(accessToken: string, listId: string): Promise<void> {
  await apiRequest<undefined>(`/shopping-lists/${listId}`, { method: 'DELETE', accessToken });
}

/**
 * Kopia listy z pozycjami do kupienia.
 *
 * @param accessToken - Token dostępu.
 * @param listId - Lista źródłowa.
 * @param name - Nazwa kopii.
 * @returns Nowa lista.
 */
export function duplicateShoppingList(
  accessToken: string,
  listId: string,
  name: string,
): Promise<ShoppingListDto> {
  return apiRequest<ShoppingListDto>(`/shopping-lists/${listId}/duplicate`, {
    method: 'POST',
    accessToken,
    body: { name },
  });
}

/**
 * Lista z pozycjami.
 *
 * @param accessToken - Token dostępu.
 * @param listId - Lista.
 * @returns Lista i pozycje w kolejności ekranu.
 */
export function fetchShoppingItems(accessToken: string, listId: string): Promise<ShoppingItemsDto> {
  return apiRequest<ShoppingItemsDto>(`/shopping-lists/${listId}/items`, { accessToken });
}

/**
 * Dopisuje pozycję (albo scala z istniejącą).
 *
 * @param accessToken - Token dostępu.
 * @param listId - Lista.
 * @param body - Pozycja z identyfikatorem od klienta.
 * @returns Pozycja i czy się scaliła.
 */
export function createShoppingItem(
  accessToken: string,
  listId: string,
  body: CreateShoppingItemRequest,
): Promise<CreateShoppingItemResult> {
  return apiRequest<CreateShoppingItemResult>(`/shopping-lists/${listId}/items`, {
    method: 'POST',
    accessToken,
    body,
  });
}

/**
 * Zmienia pozycję.
 *
 * @param accessToken - Token dostępu.
 * @param itemId - Pozycja.
 * @param body - Zmiany.
 * @returns Pozycja.
 */
export function updateShoppingItem(
  accessToken: string,
  itemId: string,
  body: UpdateShoppingItemRequest,
): Promise<ShoppingItemDto> {
  return apiRequest<ShoppingItemDto>(`/shopping-items/${itemId}`, {
    method: 'PATCH',
    accessToken,
    body,
  });
}

/**
 * Usuwa pozycję.
 *
 * @param accessToken - Token dostępu.
 * @param itemId - Pozycja.
 * @returns Obietnica spełniona po usunięciu.
 */
export async function deleteShoppingItem(accessToken: string, itemId: string): Promise<void> {
  await apiRequest<undefined>(`/shopping-items/${itemId}`, { method: 'DELETE', accessToken });
}

/**
 * „Wyczyść kupione".
 *
 * @param accessToken - Token dostępu.
 * @param listId - Lista.
 * @returns Wyczyszczone pozycje.
 */
export function clearCheckedItems(
  accessToken: string,
  listId: string,
): Promise<ClearCheckedResult> {
  return apiRequest<ClearCheckedResult>(`/shopping-lists/${listId}/clear-checked`, {
    method: 'POST',
    accessToken,
  });
}

/**
 * Cofa „Wyczyść kupione".
 *
 * @param accessToken - Token dostępu.
 * @param listId - Lista.
 * @param itemIds - Pozycje.
 * @returns Przywrócone pozycje.
 */
export function restoreClearedItems(
  accessToken: string,
  listId: string,
  itemIds: readonly string[],
): Promise<RestoreClearedResult> {
  return apiRequest<RestoreClearedResult>(`/shopping-lists/${listId}/restore-cleared`, {
    method: 'POST',
    accessToken,
    body: { itemIds },
  });
}

/**
 * Podpowiedzi ze słownika.
 *
 * @param accessToken - Token dostępu.
 * @param prefix - Wpisany początek nazwy.
 * @returns Do 5 produktów.
 */
export function fetchSuggestions(
  accessToken: string,
  prefix: string,
): Promise<ShoppingProductDto[]> {
  return apiRequest<ShoppingProductDto[]>('/shopping-products', {
    accessToken,
    query: { q: prefix, limit: 5 },
  });
}

/**
 * „Często kupowane" dla listy.
 *
 * @param accessToken - Token dostępu.
 * @param listId - Lista.
 * @returns Do 12 produktów.
 */
export function fetchFrequent(accessToken: string, listId: string): Promise<ShoppingProductDto[]> {
  return apiRequest<ShoppingProductDto[]>('/shopping-products/frequent', {
    accessToken,
    query: { listId },
  });
}

/**
 * Produkty „zawsze w domu".
 *
 * @param accessToken - Token dostępu.
 * @returns Produkty.
 */
export function fetchStaples(accessToken: string): Promise<ShoppingProductDto[]> {
  return apiRequest<ShoppingProductDto[]>('/shopping-products', {
    accessToken,
    query: { staple: 'true', limit: 200 },
  });
}

/**
 * Dopisuje produkt do słownika albo zmienia flagę istniejącego.
 *
 * @param accessToken - Token dostępu.
 * @param body - Nazwa, dział, flaga.
 * @returns Produkt.
 */
export function upsertProduct(
  accessToken: string,
  body: UpsertShoppingProductRequest,
): Promise<ShoppingProductDto> {
  return apiRequest<ShoppingProductDto>('/shopping-products', {
    method: 'POST',
    accessToken,
    body,
  });
}

/**
 * Zmienia produkt słownika.
 *
 * @param accessToken - Token dostępu.
 * @param productId - Produkt.
 * @param body - Zmiany.
 * @returns Produkt.
 */
export function updateProduct(
  accessToken: string,
  productId: string,
  body: UpdateShoppingProductRequest,
): Promise<ShoppingProductDto> {
  return apiRequest<ShoppingProductDto>(`/shopping-products/${productId}`, {
    method: 'PATCH',
    accessToken,
    body,
  });
}
