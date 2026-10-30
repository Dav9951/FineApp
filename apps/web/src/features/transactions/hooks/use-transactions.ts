import type {
  CreateTransactionInput,
  MonthKey,
  TransactionListItemDto,
  UpdateTransactionRequest,
} from '@fineapp/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { qk } from '../../../lib/query-keys.js';
import { requireToken, useAccessToken } from '../../auth/use-token.js';
import * as transactionsApi from '../api.js';

/**
 * Stan serwerowy transakcji — TanStack Query.
 */

/**
 * Unieważnia wszystko, co pokazuje skutki zapisu transakcji.
 *
 * - `qk.transactions()` — listy i szczegóły;
 * - `qk.accounts()` — salda i majątek netto;
 * - `qk.month(m)` dla każdego miesiąca z `meta.affectedMonths` — przy księgowaniu wstecz
 *   i przeniesieniu daty to nie jest miesiąc oglądany (04 §7);
 * - `qk.monthsAvailable()` — pierwsza transakcja w nowym miesiącu dokłada go do listy;
 * - `qk.categoryUsageAll()` — liczniki i sumy na ekranie kategorii (ADR-038);
 * - `qk.recurring()` — usunięcie i przywrócenie transakcji z zaksięgowania cofa albo
 *   odtwarza zaksięgowanie wystąpienia (07 §6.7, ADR-042);
 * - `qk.liabilities()` — rata (wydatek z `liabilityId`) zmienia stan zobowiązania (07 §5.1);
 * - `qk.goals()`, `qk.allocationAll()` — przelew zmienia postęp celu i wykonanie rozkładu,
 *   przychód — podstawę procentu (`F5-5`);
 * - `qk.plannedExpenses()` — przelew odkładania i zapłata zmieniają stan planowanego
 *   wydatku, a usunięcie i przywrócenie cofa albo odtwarza zapłatę (07 §6.7, `F6-3`).
 *
 * @param client - Klient zapytań.
 * @param affectedMonths - Miesiące z odpowiedzi serwera.
 * @returns Obietnica spełniona po unieważnieniu.
 */
export async function invalidateAfterWrite(
  client: QueryClient,
  affectedMonths: readonly string[],
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.transactions() }),
    client.invalidateQueries({ queryKey: qk.accounts() }),
    client.invalidateQueries({ queryKey: qk.monthsAvailable() }),
    client.invalidateQueries({ queryKey: qk.categoryUsageAll() }),
    client.invalidateQueries({ queryKey: qk.recurring() }),
    client.invalidateQueries({ queryKey: qk.liabilities() }),
    // Przelew liczy się do celu i do rozkładu (07 §2.4, §4.1), przychód — do podstawy.
    client.invalidateQueries({ queryKey: qk.goals() }),
    client.invalidateQueries({ queryKey: qk.allocationAll() }),
    client.invalidateQueries({ queryKey: qk.plannedExpenses() }),
    ...affectedMonths.map((month) => client.invalidateQueries({ queryKey: qk.month(month) })),
  ]);
}

/**
 * Transakcja z nazwami powiązanych bytów.
 *
 * @param transactionId - Identyfikator transakcji albo `undefined` (nowa).
 * @returns Wynik zapytania; wyłączone bez identyfikatora.
 */
export function useTransaction(
  transactionId: string | undefined,
): UseQueryResult<TransactionListItemDto> {
  const token = useAccessToken();
  return useQuery({
    queryKey: qk.transaction(transactionId ?? ''),
    queryFn: () => transactionsApi.fetchTransaction(requireToken(token), transactionId ?? ''),
    enabled: token !== null && transactionId !== undefined,
  });
}

/** Nowa transakcja wraz z kluczem idempotencji formularza. */
export interface CreateTransactionVariables {
  readonly body: CreateTransactionInput;
  readonly idempotencyKey: string;
}

/**
 * Zapisuje nową transakcję. Unieważnia: `qk.transactions()`, `qk.accounts()`,
 * `qk.monthsAvailable()`, `qk.month(m)` dla `meta.affectedMonths`.
 *
 * @returns Mutacja.
 */
export function useCreateTransaction(): UseMutationResult<
  transactionsApi.TransactionMutation,
  Error,
  CreateTransactionVariables
> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }) =>
      transactionsApi.createTransaction(requireToken(token), body, idempotencyKey),
    onSuccess: (result) => invalidateAfterWrite(client, result.meta.affectedMonths),
  });
}

/** Zmiana transakcji. */
export interface UpdateTransactionVariables {
  readonly transactionId: string;
  readonly body: UpdateTransactionRequest;
}

/**
 * Zmienia transakcję. Unieważnia to samo co {@link useCreateTransaction}.
 *
 * @returns Mutacja.
 */
export function useUpdateTransaction(): UseMutationResult<
  transactionsApi.TransactionMutation,
  Error,
  UpdateTransactionVariables
> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionId, body }) =>
      transactionsApi.updateTransaction(requireToken(token), transactionId, body),
    onSuccess: (result) => invalidateAfterWrite(client, result.meta.affectedMonths),
  });
}

/**
 * Lista transakcji z doczytywaniem kolejnych stron (06 §3.2 — przewijanie nieskończone).
 *
 * Kluczem jest całe zapytanie, więc zmiana filtra to osobny wpis pamięci podręcznej,
 * a powrót do poprzedniego filtra pokazuje listę od razu.
 *
 * @param query - Parametry zapytania z `historyQuery` — miesiąc i filtry.
 * @returns Wynik zapytania; strony w `data.pages`.
 */
export function useTransactionPages(
  query: Readonly<Record<string, string | number | readonly string[]>>,
): UseInfiniteQueryResult<InfiniteData<transactionsApi.TransactionPage>> {
  const token = useAccessToken();
  return useInfiniteQuery({
    queryKey: qk.transactionList(query),
    queryFn: ({ pageParam }) =>
      transactionsApi.fetchTransactionPage(requireToken(token), query, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    enabled: token !== null,
  });
}

/** Transakcja do usunięcia — z miesiącem, którego podsumowanie trzeba odświeżyć. */
export interface DeleteTransactionVariables {
  readonly transactionId: string;
  readonly monthKey: MonthKey;
}

/**
 * Przenosi transakcję do kosza. Unieważnia to samo co {@link useCreateTransaction};
 * `DELETE` odpowiada `204` bez `affectedMonths`, więc miesiąc podaje wołający.
 *
 * @returns Mutacja.
 */
export function useDeleteTransaction(): UseMutationResult<void, Error, DeleteTransactionVariables> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionId }) =>
      transactionsApi.deleteTransaction(requireToken(token), transactionId),
    onSuccess: (_result, { monthKey }) => invalidateAfterWrite(client, [monthKey]),
  });
}

/**
 * Przywraca transakcję z kosza — akcja „Cofnij" po usunięciu. Unieważnia to samo co
 * {@link useCreateTransaction}.
 *
 * @returns Mutacja.
 */
export function useRestoreTransaction(): UseMutationResult<
  transactionsApi.TransactionMutation,
  Error,
  string
> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (transactionId) =>
      transactionsApi.restoreTransaction(requireToken(token), transactionId),
    onSuccess: (result) => invalidateAfterWrite(client, result.meta.affectedMonths),
  });
}
