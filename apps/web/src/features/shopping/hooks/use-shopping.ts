import type {
  CommitShoppingImportResult,
  CreateShoppingImportRequest,
  CreateShoppingListRequest,
  ShoppingImportDto,
  ShoppingItemsDto,
  ShoppingListDto,
  ShoppingProductDto,
  UpdateShoppingImportItemRequest,
  UpdateShoppingImportRequest,
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
import { ApiRequestError } from '../../../lib/api-client.js';
import {
  applyOps,
  enqueue,
  flushOutbox,
  forgetList,
  pendingOps,
  readSnapshot,
  undoClear,
  writeSnapshot,
  type OutboxChange,
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
 * @param enabled - Czy pytać (archiwum — dopiero po otwarciu arkusza).
 * @returns Wynik zapytania.
 */
export function useShoppingLists(
  archived = false,
  enabled = true,
): UseQueryResult<ShoppingListDto[]> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.shoppingLists(archived),
    queryFn: () => shoppingApi.fetchShoppingLists(requireToken(accessToken), archived),
    enabled: accessToken !== null && enabled,
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
      let data: ShoppingItemsDto;
      try {
        data = await shoppingApi.fetchShoppingItems(requireToken(accessToken), listId);
      } catch (error) {
        // Lista usunięta na drugim telefonie — migawka i jej zmiany nie mają dokąd trafić.
        if (error instanceof ApiRequestError && error.status === 404) forgetList(listId);
        throw error;
      }
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
  | Omit<Extract<OutboxChange, { kind: 'add' }>, 'listId'>
  | Omit<Extract<OutboxChange, { kind: 'update' }>, 'listId'>
  | Omit<Extract<OutboxChange, { kind: 'delete' }>, 'listId'>
  | Omit<Extract<OutboxChange, { kind: 'clear' }>, 'listId'>
  | Omit<Extract<OutboxChange, { kind: 'reorder' }>, 'listId'>;

/** Los jednej zmiany po próbie wysłania kolejki. */
export interface ChangeOutcome {
  /** Serwer ostatecznie odrzucił **tę** zmianę (nie cudzą z kolejki). */
  readonly rejected: boolean;
  /** Kolejka czeka na sieć — zmiana jeszcze nie doszła. */
  readonly offline: boolean;
}

/**
 * Zapis zmian pozycji jednej listy przez kolejkę (ADR-096): zmiana od razu na ekranie,
 * do serwera po kolei, przy braku sieci — po jej powrocie.
 *
 * @param listId - Lista.
 * @returns Funkcja zapisu; obietnica daje wynik wysłania kolejki.
 */
export function useItemChange(listId: string): (change: ItemChange) => Promise<ChangeOutcome> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  const initials = useOwnInitials();

  return useCallback(
    async (change: ItemChange): Promise<ChangeOutcome> => {
      const op = enqueue({ ...change, listId });
      client.setQueryData<ShoppingItemsDto>(qk.shoppingItems(listId), (current) =>
        current === undefined ? current : applyOps(current, [op], initials),
      );
      const result = await flushOutbox(requireToken(accessToken));
      if (!result.stoppedOffline) await invalidateShopping(client);
      return {
        rejected: result.rejectedOpIds.includes(op.opId),
        offline: result.stoppedOffline,
      };
    },
    [accessToken, client, initials, listId],
  );
}

/**
 * „Cofnij" po „Wyczyść kupione" — przez tę samą kolejkę co czyszczenie, więc nigdy go
 * nie wyprzedzi (ADR-099). Czyszczenie, które jeszcze nie wyszło, po prostu znika.
 *
 * Unieważnia: `qk.shopping()`.
 *
 * @param listId - Lista.
 * @returns Funkcja cofnięcia.
 */
export function useUndoClear(listId: string): (itemIds: readonly string[]) => Promise<void> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useCallback(
    async (itemIds: readonly string[]): Promise<void> => {
      if (undoClear(listId, itemIds) === 'queued') {
        const result = await flushOutbox(requireToken(accessToken));
        if (result.stoppedOffline) return;
      }
      await invalidateShopping(client);
    },
    [accessToken, client, listId],
  );
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

/** Co ile pytamy o wynik odczytu, póki trwa (jak przy dokumentach). */
export const IMPORT_POLL_MS = 2_000;

/**
 * Import z propozycjami — odpytywany co 2 s, póki trwa odczyt.
 *
 * @param id - Import.
 * @returns Wynik zapytania.
 */
export function useShoppingImport(id: string): UseQueryResult<ShoppingImportDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.shoppingImport(id),
    queryFn: () => shoppingApi.fetchImport(requireToken(accessToken), id),
    enabled: accessToken !== null,
    refetchInterval: (query) =>
      query.state.data?.status === 'processing' ? IMPORT_POLL_MS : false,
  });
}

/** Nowy import: zdjęcia albo przepis z linku / tekstu. */
export type NewImport =
  | {
      readonly source: 'images';
      readonly input: Parameters<typeof shoppingApi.createImageImport>[1];
    }
  | { readonly source: 'text'; readonly input: CreateShoppingImportRequest };

/**
 * Wysłanie importu.
 *
 * Unieważnia: `qk.shopping()` — karta listy pokazuje odczyt w toku.
 *
 * @returns Mutacja.
 */
export function useCreateImport(): UseMutationResult<ShoppingImportDto, Error, NewImport> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: NewImport) =>
      request.source === 'images'
        ? shoppingApi.createImageImport(requireToken(accessToken), request.input)
        : shoppingApi.createTextImport(requireToken(accessToken), request.input),
    onSuccess: async (created) => {
      client.setQueryData(qk.shoppingImport(created.id), created);
      await invalidateShopping(client);
    },
  });
}

/** Zmiana importu w przeglądzie. */
export type ImportChange =
  | { readonly kind: 'import'; readonly body: UpdateShoppingImportRequest }
  | {
      readonly kind: 'item';
      readonly itemId: string;
      readonly body: UpdateShoppingImportItemRequest;
    };

/**
 * Zmiany w przeglądzie: mnożnik, lista, propozycje — każda od razu na serwerze, żeby
 * odświeżenie i druga osoba widziały ten sam stan (06 §3.15).
 *
 * Unieważnia: nic — odpowiedź to cały import, wpisany do `qk.shoppingImport(id)`.
 *
 * @param id - Import.
 * @returns Mutacja.
 */
export function useImportChange(
  id: string,
): UseMutationResult<ShoppingImportDto, Error, ImportChange> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: ImportChange) =>
      change.kind === 'import'
        ? shoppingApi.updateImport(requireToken(accessToken), id, change.body)
        : shoppingApi.updateImportItem(requireToken(accessToken), id, change.itemId, change.body),
    onSuccess: (updated) => {
      client.setQueryData(qk.shoppingImport(id), updated);
    },
  });
}

/**
 * Zatwierdzenie, odrzucenie, ponowienie importu.
 *
 * Unieważnia: `qk.shopping()`.
 *
 * @param id - Import.
 * @returns Trzy mutacje.
 */
export function useImportActions(id: string): {
  commit: UseMutationResult<CommitShoppingImportResult, Error, string>;
  discard: UseMutationResult<void, Error, void>;
  retry: UseMutationResult<ShoppingImportDto, Error, void>;
} {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  const refresh = (): Promise<void> => invalidateShopping(client);
  return {
    commit: useMutation({
      mutationFn: (idempotencyKey: string) =>
        shoppingApi.commitImport(requireToken(accessToken), id, idempotencyKey),
      onSuccess: refresh,
    }),
    discard: useMutation({
      mutationFn: () => shoppingApi.discardImport(requireToken(accessToken), id),
      onSuccess: refresh,
    }),
    retry: useMutation({
      mutationFn: () => shoppingApi.retryImport(requireToken(accessToken), id),
      onSuccess: async (updated) => {
        client.setQueryData(qk.shoppingImport(id), updated);
        await refresh();
      },
    }),
  };
}
