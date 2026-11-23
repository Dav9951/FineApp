import type {
  CreateShoppingListRequest,
  ShoppingItemsDto,
  ShoppingListDto,
  ShoppingProductDto,
  UpdateShoppingListRequest,
  UpdateShoppingProductRequest,
  UpsertShoppingProductRequest,
} from '@fineapp/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { qk } from '../../../lib/query-keys.js';
import { useAuth } from '../../auth/auth-context.js';
import { requireToken, useAccessToken } from '../../auth/use-token.js';
import * as shoppingApi from '../api.js';
import {
  applyOps,
  enqueue,
  flushOutbox,
  pendingOps,
  readSnapshot,
  writeSnapshot,
  type FlushResult,
  type OutboxOp,
} from '../offline.js';
import { initialsOf } from '../shopping-view.js';

/**
 * Stan serwerowy list zakupów — TanStack Query
 * ([02 §10](../../../../../../plans/02-architecture.md#10-frontend--wzorce), ADR-096).
 *
 * Pozycje są wyjątkiem od „dane zawsze z sieci": migawka listy leży na urządzeniu,
 * a zmiany pozycji idą przez kolejkę z `offline.ts` — także wtedy, gdy sieć jest, bo
 * jedna droga zapisu to jedna kolejność zmian. Listy, słownik i „Wyczyść kupione —
 * Cofnij" działają tylko z siecią.
 */

/** Pozycje odpytywane co tyle, gdy ekran jest widoczny (06 §3.15). */
export const SHOPPING_POLL_MS = 15_000;

/**
 * Listy bieżące albo archiwum. Pierwsze wywołanie zakłada „Spożywcze" (07 §14.6).
 *
 * @param archived - Archiwum zamiast list bieżących.
 * @returns Wynik zapytania.
 */
export function useShoppingLists(archived = false): UseQueryResult<ShoppingListDto[]> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.shoppingLists(archived),
    queryFn: () => shoppingApi.fetchShoppingLists(requireToken(accessToken), archived),
    enabled: accessToken !== null,
  });
}

/**
 * Inicjały zalogowanej osoby — do kupionych pozycji odhaczonych offline.
 *
 * @returns Inicjały albo `null`.
 */
function useOwnInitials(): string | null {
  const { user } = useAuth();
  return user === null ? null : initialsOf(user.displayName);
}

/**
 * Pozycje listy: migawka z urządzenia od razu, potem dane z serwera z nałożonymi
 * zmianami z kolejki. Odpytywane co 15 s, gdy karta jest widoczna; po powrocie sieci
 * kolejka wysyła się sama.
 *
 * @param listId - Lista.
 * @returns Wynik zapytania.
 */
export function useShoppingItems(listId: string): UseQueryResult<ShoppingItemsDto> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  const initials = useOwnInitials();

  useEffect(() => {
    if (accessToken === null) return undefined;
    const sync = (): void => {
      void flushOutbox(accessToken).then(() =>
        client.invalidateQueries({ queryKey: qk.shopping() }),
      );
    };
    sync();
    window.addEventListener('online', sync);
    return () => {
      window.removeEventListener('online', sync);
    };
  }, [accessToken, client]);

  const snapshot = readSnapshot(listId);
  return useQuery({
    queryKey: qk.shoppingItems(listId),
    queryFn: async () => {
      const data = await shoppingApi.fetchShoppingItems(requireToken(accessToken), listId);
      writeSnapshot(data);
      return applyOps(data, pendingOps(listId), initials);
    },
    enabled: accessToken !== null,
    refetchInterval: SHOPPING_POLL_MS,
    // Pokazujemy migawkę od razu, ale jako nieświeżą — zapytanie i tak idzie do serwera.
    ...(snapshot === undefined
      ? {}
      : {
          initialData: () => applyOps(snapshot, pendingOps(listId), initials),
          initialDataUpdatedAt: 0,
        }),
  });
}

/**
 * Unieważnia wszystko, co zależy od pozycji list.
 *
 * @param client - Klient zapytań.
 * @returns Obietnica spełniona po unieważnieniu.
 */
function invalidateShopping(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: qk.shopping() });
}

/** Zmiana pozycji bez pola listy — listę dokłada hook. */
export type ItemChange =
  | Omit<Extract<OutboxOp, { kind: 'add' }>, 'listId'>
  | Omit<Extract<OutboxOp, { kind: 'update' }>, 'listId'>
  | Omit<Extract<OutboxOp, { kind: 'delete' }>, 'listId'>
  | Omit<Extract<OutboxOp, { kind: 'clear' }>, 'listId'>;

/**
 * Zapis zmian pozycji jednej listy przez kolejkę (ADR-096): zmiana od razu na ekranie,
 * do serwera po kolei, przy braku sieci — po jej powrocie.
 *
 * @param listId - Lista.
 * @returns Funkcja zapisu; obietnica daje wynik wysłania kolejki.
 */
export function useItemChange(listId: string): (change: ItemChange) => Promise<FlushResult> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  const initials = useOwnInitials();

  return useCallback(
    async (change: ItemChange): Promise<FlushResult> => {
      const op = { ...change, listId } as OutboxOp;
      enqueue(op);
      client.setQueryData<ShoppingItemsDto>(qk.shoppingItems(listId), (current) =>
        current === undefined ? current : applyOps(current, [op], initials),
      );
      const result = await flushOutbox(requireToken(accessToken));
      if (!result.stoppedOffline) await invalidateShopping(client);
      return result;
    },
    [accessToken, client, initials, listId],
  );
}

/**
 * Cofnięcie „Wyczyść kupione" — tylko z siecią (04 §14b).
 *
 * Unieważnia: `qk.shopping()`.
 *
 * @param listId - Lista.
 * @returns Mutacja.
 */
export function useRestoreCleared(
  listId: string,
): UseMutationResult<unknown, Error, readonly string[]> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: readonly string[]) =>
      shoppingApi.restoreClearedItems(requireToken(accessToken), listId, itemIds),
    onSuccess: () => invalidateShopping(client),
  });
}

/**
 * Nowa lista.
 *
 * Unieważnia: `qk.shopping()`.
 *
 * @returns Mutacja.
 */
export function useCreateShoppingList(): UseMutationResult<
  ShoppingListDto,
  Error,
  CreateShoppingListRequest
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateShoppingListRequest) =>
      shoppingApi.createShoppingList(requireToken(accessToken), body),
    onSuccess: () => invalidateShopping(client),
  });
}

/**
 * Zmiana nazwy, domyślności albo archiwum listy.
 *
 * Unieważnia: `qk.shopping()`.
 *
 * @param listId - Lista.
 * @returns Mutacja.
 */
export function useUpdateShoppingList(
  listId: string,
): UseMutationResult<ShoppingListDto, Error, UpdateShoppingListRequest> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateShoppingListRequest) =>
      shoppingApi.updateShoppingList(requireToken(accessToken), listId, body),
    onSuccess: () => invalidateShopping(client),
  });
}

/**
 * Usunięcie listy.
 *
 * Unieważnia: `qk.shopping()`.
 *
 * @returns Mutacja (argument: identyfikator listy).
 */
export function useDeleteShoppingList(): UseMutationResult<void, Error, string> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (listId: string) =>
      shoppingApi.deleteShoppingList(requireToken(accessToken), listId),
    onSuccess: () => invalidateShopping(client),
  });
}

/**
 * Kopia listy.
 *
 * Unieważnia: `qk.shopping()`.
 *
 * @param listId - Lista źródłowa.
 * @returns Mutacja (argument: nazwa kopii).
 */
export function useDuplicateShoppingList(
  listId: string,
): UseMutationResult<ShoppingListDto, Error, string> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      shoppingApi.duplicateShoppingList(requireToken(accessToken), listId, name),
    onSuccess: () => invalidateShopping(client),
  });
}

/**
 * Podpowiedzi ze słownika dla wpisanego początku nazwy.
 *
 * @param prefix - Znormalizowany początek nazwy; pusty — brak zapytania.
 * @returns Wynik zapytania.
 */
export function useSuggestions(prefix: string): UseQueryResult<ShoppingProductDto[]> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.shoppingSuggestions(prefix),
    queryFn: () => shoppingApi.fetchSuggestions(requireToken(accessToken), prefix),
    enabled: accessToken !== null && prefix !== '',
    staleTime: 30_000,
  });
}

/**
 * „Często kupowane" dla listy.
 *
 * @param listId - Lista.
 * @returns Wynik zapytania.
 */
export function useFrequent(listId: string): UseQueryResult<ShoppingProductDto[]> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.shoppingFrequent(listId),
    queryFn: () => shoppingApi.fetchFrequent(requireToken(accessToken), listId),
    enabled: accessToken !== null,
  });
}

/**
 * Produkty „zawsze w domu".
 *
 * @returns Wynik zapytania.
 */
export function useStaples(): UseQueryResult<ShoppingProductDto[]> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.shoppingStaples(),
    queryFn: () => shoppingApi.fetchStaples(requireToken(accessToken)),
    enabled: accessToken !== null,
  });
}

/**
 * Dopisanie produktu do słownika albo zmiana flagi istniejącego.
 *
 * Unieważnia: `qk.shopping()` — flaga jest widoczna przy pozycjach.
 *
 * @returns Mutacja.
 */
export function useUpsertProduct(): UseMutationResult<
  ShoppingProductDto,
  Error,
  UpsertShoppingProductRequest
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertShoppingProductRequest) =>
      shoppingApi.upsertProduct(requireToken(accessToken), body),
    onSuccess: () => invalidateShopping(client),
  });
}

/**
 * Zmiana produktu słownika.
 *
 * Unieważnia: `qk.shopping()`.
 *
 * @returns Mutacja.
 */
export function useUpdateProduct(): UseMutationResult<
  ShoppingProductDto,
  Error,
  { productId: string; body: UpdateShoppingProductRequest }
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, body }: { productId: string; body: UpdateShoppingProductRequest }) =>
      shoppingApi.updateProduct(requireToken(accessToken), productId, body),
    onSuccess: () => invalidateShopping(client),
  });
}
