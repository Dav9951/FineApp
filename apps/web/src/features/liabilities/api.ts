import type {
  CreateLiabilityInput,
  LiabilityDetailDto,
  LiabilityDto,
  LiabilityPaymentRequest,
  LiabilityPaymentResultDto,
  RebaseLiabilityRequest,
  ScheduledInstallmentDto,
  TransactionMutationMeta,
  UpdateLiabilityRequest,
} from '@fineapp/shared';

import { apiRequest, apiRequestWithMeta } from '../../lib/api-client.js';

/**
 * Wywołania API zobowiązań
 * ([04 §8](../../../../../plans/04-api-spec.md#8-zobowiązania--apiv1liabilities)).
 *
 * Funkcje są cienkie: ścieżka, metoda, ciało. Stan, cache i unieważnianie mieszkają
 * w hookach (`hooks/use-liabilities.ts`).
 */

/**
 * Czyta zobowiązania ze stanem: aktywne przed zamkniętymi, po nazwie.
 *
 * @param accessToken - Token dostępu.
 * @returns Zobowiązania.
 */
export function fetchLiabilities(accessToken: string): Promise<LiabilityDto[]> {
  return apiRequest<LiabilityDto[]>('/liabilities', { accessToken });
}

/**
 * Czyta zobowiązanie z historią rat.
 *
 * @param accessToken - Token dostępu.
 * @param liabilityId - Identyfikator.
 * @returns Szczegóły.
 */
export function fetchLiability(
  accessToken: string,
  liabilityId: string,
): Promise<LiabilityDetailDto> {
  return apiRequest<LiabilityDetailDto>(`/liabilities/${liabilityId}`, { accessToken });
}

/**
 * Czyta prognozowany harmonogram spłaty.
 *
 * @param accessToken - Token dostępu.
 * @param liabilityId - Identyfikator.
 * @returns Raty rosnąco.
 */
export function fetchSchedule(
  accessToken: string,
  liabilityId: string,
): Promise<ScheduledInstallmentDto[]> {
  return apiRequest<ScheduledInstallmentDto[]>(`/liabilities/${liabilityId}/schedule`, {
    accessToken,
  });
}

/**
 * Zakłada zobowiązanie (opcjonalnie z regułą cykliczną na ratę).
 *
 * @param accessToken - Token dostępu.
 * @param body - Pola zobowiązania.
 * @returns Założone zobowiązanie.
 */
export function createLiability(
  accessToken: string,
  body: CreateLiabilityInput,
): Promise<LiabilityDto> {
  return apiRequest<LiabilityDto>('/liabilities', { method: 'POST', accessToken, body });
}

/**
 * Zmienia zobowiązanie — wyłącznie przysłane pola.
 *
 * @param accessToken - Token dostępu.
 * @param liabilityId - Identyfikator.
 * @param body - Zmieniane pola.
 * @returns Zobowiązanie po zmianie.
 */
export function updateLiability(
  accessToken: string,
  liabilityId: string,
  body: UpdateLiabilityRequest,
): Promise<LiabilityDto> {
  return apiRequest<LiabilityDto>(`/liabilities/${liabilityId}`, {
    method: 'PATCH',
    accessToken,
    body,
  });
}

/**
 * Usuwa zobowiązanie; raty zostają jako zwykłe wydatki.
 *
 * @param accessToken - Token dostępu.
 * @param liabilityId - Identyfikator.
 * @returns Obietnica spełniona po usunięciu.
 */
export async function deleteLiability(accessToken: string, liabilityId: string): Promise<void> {
  await apiRequest<undefined>(`/liabilities/${liabilityId}`, { method: 'DELETE', accessToken });
}

/**
 * Korekta stanu z wyciągu — nowy punkt odniesienia.
 *
 * @param accessToken - Token dostępu.
 * @param liabilityId - Identyfikator.
 * @param body - Kwota z wyciągu i jej dzień.
 * @returns Zobowiązanie po korekcie.
 */
export function rebaseLiability(
  accessToken: string,
  liabilityId: string,
  body: RebaseLiabilityRequest,
): Promise<LiabilityDto> {
  return apiRequest<LiabilityDto>(`/liabilities/${liabilityId}/rebase`, {
    method: 'POST',
    accessToken,
    body,
  });
}

/** Wynik zaksięgowania raty z miesiącami do unieważnienia. */
export interface LiabilityPaymentMutation {
  readonly data: LiabilityPaymentResultDto;
  readonly meta: TransactionMutationMeta;
}

/**
 * Księguje ratę. Klucz idempotencji chroni przed drugą ratą przy ponowieniu na słabym
 * łączu (ADR-046) — jeden na dotknięcie „Zaksięguj".
 *
 * @param accessToken - Token dostępu.
 * @param liabilityId - Identyfikator.
 * @param body - Kwota, data, konto; puste — rata z warunków, dziś.
 * @param idempotencyKey - Klucz idempotencji.
 * @returns Zobowiązanie po racie, transakcja i miesiące do unieważnienia.
 */
export function recordPayment(
  accessToken: string,
  liabilityId: string,
  body: LiabilityPaymentRequest,
  idempotencyKey: string,
): Promise<LiabilityPaymentMutation> {
  return apiRequestWithMeta<LiabilityPaymentResultDto, TransactionMutationMeta>(
    `/liabilities/${liabilityId}/payments`,
    { method: 'POST', accessToken, body, idempotencyKey },
  );
}
