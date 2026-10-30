import type {
  AccountDetailDto,
  AccountDto,
  CreateAccountInput,
  UpdateAccountRequest,
} from '@fineapp/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { qk } from '../../../lib/query-keys.js';
import { requireToken, useAccessToken } from '../../auth/use-token.js';
import * as accountsApi from '../api.js';

/**
 * Stan serwerowy kont — TanStack Query
 * ([02 §10](../../../../../../plans/02-architecture.md#10-frontend--wzorce)).
 *
 * Zapytania czekają na token (`enabled`), bo trasy kont stoją za bramą sesji, ale
 * odnowienie tokenu na starcie trwa chwilę. Bez tego pierwsze żądanie szłoby bez
 * nagłówka i kończyło się `401`.
 */

/**
 * Unieważnia wszystko, co pokazuje dane kont.
 *
 * - `qk.accounts()` — listy, salda i szczegóły (wspólny przedrostek);
 * - `qk.months()` — dashboard pokazuje salda kont i majątek netto;
 * - `qk.transactions()` — pozycje list niosą nazwę konta (`accountName`).
 *
 * @param client - Klient zapytań.
 * @returns Obietnica spełniona po unieważnieniu.
 */
async function invalidateAccounts(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.accounts() }),
    client.invalidateQueries({ queryKey: qk.months() }),
    client.invalidateQueries({ queryKey: qk.transactions() }),
  ]);
}

/**
 * Salda kont na dziś i majątek netto.
 *
 * @returns Wynik zapytania.
 */
export function useAccountBalances(): UseQueryResult<accountsApi.AccountBalances> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.accountBalances(),
    queryFn: () => accountsApi.fetchBalances(requireToken(accessToken)),
    enabled: accessToken !== null,
  });
}

/**
 * Lista kont.
 *
 * @param includeArchived - Czy dołączyć zarchiwizowane.
 * @returns Wynik zapytania.
 */
export function useAccountList(includeArchived: boolean): UseQueryResult<AccountDto[]> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.accountList(includeArchived),
    queryFn: () => accountsApi.fetchAccounts(requireToken(accessToken), includeArchived),
    enabled: accessToken !== null,
  });
}

/**
 * Jedno konto z saldem na dziś.
 *
 * @param accountId - Identyfikator konta.
 * @returns Wynik zapytania.
 */
export function useAccount(accountId: string): UseQueryResult<AccountDetailDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.account(accountId),
    queryFn: () => accountsApi.fetchAccount(requireToken(accessToken), accountId),
    enabled: accessToken !== null,
  });
}

/**
 * Zakłada konto. Unieważnia: `qk.accounts()`, `qk.months()`, `qk.transactions()`.
 *
 * @returns Mutacja.
 */
export function useCreateAccount(): UseMutationResult<AccountDto, Error, CreateAccountInput> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => accountsApi.createAccount(requireToken(accessToken), body),
    onSuccess: () => invalidateAccounts(client),
  });
}

/** Zmiana konta: identyfikator i zmieniane pola. */
export interface UpdateAccountVariables {
  readonly accountId: string;
  readonly body: UpdateAccountRequest;
}

/**
 * Zmienia konto. Unieważnia: `qk.accounts()`, `qk.months()`, `qk.transactions()`.
 *
 * @returns Mutacja.
 */
export function useUpdateAccount(): UseMutationResult<AccountDto, Error, UpdateAccountVariables> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, body }) =>
      accountsApi.updateAccount(requireToken(accessToken), accountId, body),
    onSuccess: () => invalidateAccounts(client),
  });
}

/** Archiwizacja albo przywrócenie konta. */
export interface ArchiveAccountVariables {
  readonly accountId: string;
  readonly archived: boolean;
}

/**
 * Archiwizuje albo przywraca konto. Unieważnia: `qk.accounts()`, `qk.months()`,
 * `qk.transactions()`.
 *
 * @returns Mutacja.
 */
export function useSetAccountArchived(): UseMutationResult<
  AccountDto,
  Error,
  ArchiveAccountVariables
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, archived }) =>
      accountsApi.setAccountArchived(requireToken(accessToken), accountId, archived),
    onSuccess: () => invalidateAccounts(client),
  });
}

/**
 * Usuwa konto bez historii. Unieważnia: `qk.accounts()`, `qk.months()`, `qk.transactions()`.
 *
 * @returns Mutacja przyjmująca identyfikator konta.
 */
export function useDeleteAccount(): UseMutationResult<void, Error, string> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (accountId) => accountsApi.deleteAccount(requireToken(accessToken), accountId),
    onSuccess: (_result, accountId) => {
      // Szczegóły usuniętego konta usuwamy, a nie unieważniamy: ekran szczegółów jest
      // jeszcze zamontowany i odświeżenie dałoby mignięcie „Nie znaleziono konta".
      client.removeQueries({ queryKey: qk.account(accountId) });
      return invalidateAccounts(client);
    },
  });
}
