import type {
  CreateTransactionInput,
  TransactionDto,
  TransactionListItemDto,
  TransactionListMeta,
  TransactionMutationMeta,
  UpdateTransactionRequest,
} from '@fineapp/shared';

import { apiRequest, apiRequestWithMeta } from '../../lib/api-client.js';

/**
 * Wywołania API transakcji ([04 §7](../../../../../plans/04-api-spec.md#7-transakcje--apiv1transactions)).
 */

/** Wynik zapisu: transakcja i miesiące do unieważnienia. */
export interface TransactionMutation {
  readonly data: TransactionDto;
  readonly meta: TransactionMutationMeta;
}

/**
 * Zapisuje nową transakcję.
 *
 * Klucz idempotencji powstaje raz na formularz, a nie raz na żądanie: ponowienie
 * po zerwanym połączeniu musi nieść **ten sam** klucz, inaczej serwer uzna je za
 * nową operację i zapisze wydatek drugi raz (ADR-037).
 *
 * @param accessToken - Token dostępu.
 * @param body - Pola transakcji.
 * @param idempotencyKey - Klucz idempotencji formularza.
 * @returns Transakcja i miesiące do unieważnienia.
 */
export function createTransaction(
  accessToken: string,
  body: CreateTransactionInput,
  idempotencyKey: string,
): Promise<TransactionMutation> {
  return apiRequestWithMeta<TransactionDto, TransactionMutationMeta>('/transactions', {
    method: 'POST',
    accessToken,
    body,
    idempotencyKey,
  });
}

/**
 * Zmienia transakcję — wyłącznie przysłane pola.
 *
 * @param accessToken - Token dostępu.
 * @param transactionId - Identyfikator transakcji.
 * @param body - Zmieniane pola.
 * @returns Transakcja po zmianie i miesiące do unieważnienia.
 */
export function updateTransaction(
  accessToken: string,
  transactionId: string,
  body: UpdateTransactionRequest,
): Promise<TransactionMutation> {
  return apiRequestWithMeta<TransactionDto, TransactionMutationMeta>(
    `/transactions/${transactionId}`,
    { method: 'PATCH', accessToken, body },
  );
}

/**
 * Czyta transakcję z nazwami powiązanych bytów.
 *
 * @param accessToken - Token dostępu.
 * @param transactionId - Identyfikator transakcji.
 * @returns Transakcja.
 */
export function fetchTransaction(
  accessToken: string,
  transactionId: string,
): Promise<TransactionListItemDto> {
  return apiRequest<TransactionListItemDto>(`/transactions/${transactionId}`, { accessToken });
}

/** Strona listy transakcji z metadanymi paginacji i — na pierwszej — podsumowaniem. */
export interface TransactionPage {
  readonly data: TransactionListItemDto[];
  readonly meta: TransactionListMeta;
}

/**
 * Czyta stronę listy transakcji.
 *
 * @param accessToken - Token dostępu.
 * @param query - Filtry (04 §7); tablica daje parametr powtórzony.
 * @param cursor - Kursor z `meta.nextCursor` poprzedniej strony; brak = pierwsza strona.
 * @returns Strona listy.
 */
export function fetchTransactionPage(
  accessToken: string,
  query: Readonly<Record<string, string | number | readonly string[]>>,
  cursor?: string,
): Promise<TransactionPage> {
  return apiRequestWithMeta<TransactionListItemDto[], TransactionListMeta>('/transactions', {
    accessToken,
    query: { ...query, cursor },
  });
}

/**
 * Przenosi transakcję do kosza (miękkie usunięcie, `204`).
 *
 * @param accessToken - Token dostępu.
 * @param transactionId - Identyfikator transakcji.
 * @returns Obietnica spełniona po usunięciu.
 */
export async function deleteTransaction(accessToken: string, transactionId: string): Promise<void> {
  await apiRequest<undefined>(`/transactions/${transactionId}`, {
    method: 'DELETE',
    accessToken,
  });
}

/**
 * Przywraca transakcję z kosza.
 *
 * @param accessToken - Token dostępu.
 * @param transactionId - Identyfikator transakcji.
 * @returns Transakcja po przywróceniu i miesiące do unieważnienia.
 */
export function restoreTransaction(
  accessToken: string,
  transactionId: string,
): Promise<TransactionMutation> {
  return apiRequestWithMeta<TransactionDto, TransactionMutationMeta>(
    `/transactions/${transactionId}/restore`,
    { method: 'POST', accessToken },
  );
}
