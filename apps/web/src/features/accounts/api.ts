import type {
  AccountBalanceDto,
  AccountDetailDto,
  AccountDto,
  BalancesMeta,
  CreateAccountInput,
  UpdateAccountRequest,
} from '@fineapp/shared';

import { apiRequest, apiRequestWithMeta } from '../../lib/api-client.js';

/**
 * Wywołania API kont ([04 §5](../../../../../plans/04-api-spec.md#5-konta--apiv1accounts)).
 *
 * Funkcje są cienkie: ścieżka, metoda, ciało. Stan, cache i unieważnianie mieszkają
 * w hookach (`hooks/use-accounts.ts`), bo tylko one wiedzą, co jeszcze trzeba odświeżyć.
 */

/** Salda kont wraz z podsumowaniem majątku. */
export interface AccountBalances {
  readonly accounts: AccountBalanceDto[];
  readonly meta: BalancesMeta;
}

/**
 * Czyta salda kont na dziś (w strefie gospodarstwa) i majątek netto.
 *
 * @param accessToken - Token dostępu.
 * @returns Salda w kolejności kont i podsumowanie.
 */
export async function fetchBalances(accessToken: string): Promise<AccountBalances> {
  const { data, meta } = await apiRequestWithMeta<AccountBalanceDto[], BalancesMeta>(
    '/accounts/balances',
    { accessToken },
  );
  return { accounts: data, meta };
}

/**
 * Czyta listę kont.
 *
 * @param accessToken - Token dostępu.
 * @param includeArchived - Czy dołączyć zarchiwizowane.
 * @returns Konta w kolejności wyświetlania.
 */
export function fetchAccounts(
  accessToken: string,
  includeArchived: boolean,
): Promise<AccountDto[]> {
  return apiRequest<AccountDto[]>('/accounts', {
    accessToken,
    query: { includeArchived },
  });
}

/**
 * Czyta jedno konto z saldem na dziś.
 *
 * @param accessToken - Token dostępu.
 * @param accountId - Identyfikator konta.
 * @returns Konto z saldem.
 */
export function fetchAccount(accessToken: string, accountId: string): Promise<AccountDetailDto> {
  return apiRequest<AccountDetailDto>(`/accounts/${accountId}`, { accessToken });
}

/**
 * Zakłada konto.
 *
 * @param accessToken - Token dostępu.
 * @param body - Dane konta.
 * @returns Założone konto.
 */
export function createAccount(accessToken: string, body: CreateAccountInput): Promise<AccountDto> {
  return apiRequest<AccountDto>('/accounts', { method: 'POST', accessToken, body });
}

/**
 * Zmienia konto — wyłącznie przysłane pola.
 *
 * @param accessToken - Token dostępu.
 * @param accountId - Identyfikator konta.
 * @param body - Zmieniane pola.
 * @returns Konto po zmianie.
 */
export function updateAccount(
  accessToken: string,
  accountId: string,
  body: UpdateAccountRequest,
): Promise<AccountDto> {
  return apiRequest<AccountDto>(`/accounts/${accountId}`, { method: 'PATCH', accessToken, body });
}

/**
 * Archiwizuje konto albo przywraca je z archiwum.
 *
 * @param accessToken - Token dostępu.
 * @param accountId - Identyfikator konta.
 * @param archived - `true` archiwizuje, `false` przywraca.
 * @returns Konto po zmianie.
 */
export function setAccountArchived(
  accessToken: string,
  accountId: string,
  archived: boolean,
): Promise<AccountDto> {
  return apiRequest<AccountDto>(`/accounts/${accountId}/${archived ? 'archive' : 'unarchive'}`, {
    method: 'POST',
    accessToken,
  });
}

/**
 * Usuwa konto bez historii. Konto z transakcjami daje `409` (I-10).
 *
 * @param accessToken - Token dostępu.
 * @param accountId - Identyfikator konta.
 * @returns Obietnica spełniona po usunięciu.
 */
export async function deleteAccount(accessToken: string, accountId: string): Promise<void> {
  await apiRequest<undefined>(`/accounts/${accountId}`, { method: 'DELETE', accessToken });
}
