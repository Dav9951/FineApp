import type {
  CreateRecurringRuleInput,
  OccurrenceMutationMeta,
  PostOccurrenceRequest,
  PostOccurrenceResultDto,
  RecurringOccurrenceDto,
  RecurringRuleDetailDto,
  RecurringRuleDto,
  SaveAsRecurringInput,
  SkipOccurrenceRequest,
  UpdateRecurringRuleRequest,
} from '@fineapp/shared';

import { apiRequest, apiRequestWithMeta } from '../../lib/api-client.js';

/**
 * Wywołania API reguł cyklicznych
 * ([04 §9](../../../../../plans/04-api-spec.md#9-pozycje-cykliczne--apiv1recurring)).
 *
 * Funkcje są cienkie: ścieżka, metoda, ciało. Stan, cache i unieważnianie mieszkają
 * w hookach (`hooks/use-recurring.ts`).
 */

/**
 * Czyta wszystkie reguły: aktywne przed wstrzymanymi, po nazwie.
 *
 * @param accessToken - Token dostępu.
 * @returns Reguły.
 */
export function fetchRules(accessToken: string): Promise<RecurringRuleDto[]> {
  return apiRequest<RecurringRuleDto[]>('/recurring/rules', { accessToken });
}

/**
 * Czyta regułę z najbliższymi terminami.
 *
 * @param accessToken - Token dostępu.
 * @param ruleId - Identyfikator reguły.
 * @returns Reguła.
 */
export function fetchRule(accessToken: string, ruleId: string): Promise<RecurringRuleDetailDto> {
  return apiRequest<RecurringRuleDetailDto>(`/recurring/rules/${ruleId}`, { accessToken });
}

/**
 * Zakłada regułę.
 *
 * @param accessToken - Token dostępu.
 * @param body - Pola reguły.
 * @returns Założona reguła.
 */
export function createRule(
  accessToken: string,
  body: CreateRecurringRuleInput,
): Promise<RecurringRuleDto> {
  return apiRequest<RecurringRuleDto>('/recurring/rules', { method: 'POST', accessToken, body });
}

/**
 * Zmienia regułę — wyłącznie przysłane pola.
 *
 * @param accessToken - Token dostępu.
 * @param ruleId - Identyfikator reguły.
 * @param body - Zmieniane pola.
 * @returns Reguła po zmianie.
 */
export function updateRule(
  accessToken: string,
  ruleId: string,
  body: UpdateRecurringRuleRequest,
): Promise<RecurringRuleDto> {
  return apiRequest<RecurringRuleDto>(`/recurring/rules/${ruleId}`, {
    method: 'PATCH',
    accessToken,
    body,
  });
}

/**
 * Wstrzymuje albo wznawia regułę.
 *
 * @param accessToken - Token dostępu.
 * @param ruleId - Identyfikator reguły.
 * @param active - `true` wznawia, `false` wstrzymuje.
 * @returns Reguła po zmianie.
 */
export function setRuleActive(
  accessToken: string,
  ruleId: string,
  active: boolean,
): Promise<RecurringRuleDto> {
  return apiRequest<RecurringRuleDto>(`/recurring/rules/${ruleId}/${active ? 'resume' : 'pause'}`, {
    method: 'POST',
    accessToken,
  });
}

/**
 * Usuwa regułę; zaksięgowane transakcje zostają jako zwykłe.
 *
 * @param accessToken - Token dostępu.
 * @param ruleId - Identyfikator reguły.
 * @returns Obietnica spełniona po usunięciu.
 */
export async function deleteRule(accessToken: string, ruleId: string): Promise<void> {
  await apiRequest<undefined>(`/recurring/rules/${ruleId}`, { method: 'DELETE', accessToken });
}

/** Wynik zaksięgowania wystąpienia z miesiącami do unieważnienia. */
export interface PostOccurrenceMutation {
  readonly data: PostOccurrenceResultDto;
  readonly meta: OccurrenceMutationMeta;
}

/**
 * Księguje wystąpienie. Klucz idempotencji chroni przed podwójnym zaksięgowaniem na słabym
 * łączu (ADR-046).
 *
 * @param accessToken - Token dostępu.
 * @param occurrenceId - Identyfikator wystąpienia.
 * @param body - Kwota, data, konto; puste — jak w planie.
 * @param idempotencyKey - Klucz idempotencji.
 * @returns Wystąpienie, transakcja i miesiące do unieważnienia.
 */
export function postOccurrence(
  accessToken: string,
  occurrenceId: string,
  body: PostOccurrenceRequest,
  idempotencyKey: string,
): Promise<PostOccurrenceMutation> {
  return apiRequestWithMeta<PostOccurrenceResultDto, OccurrenceMutationMeta>(
    `/recurring/occurrences/${occurrenceId}/post`,
    { method: 'POST', accessToken, body, idempotencyKey },
  );
}

/**
 * Pomija wystąpienie w tym miesiącu.
 *
 * @param accessToken - Token dostępu.
 * @param occurrenceId - Identyfikator wystąpienia.
 * @param body - Opcjonalny powód.
 * @returns Wystąpienie po zmianie.
 */
export function skipOccurrence(
  accessToken: string,
  occurrenceId: string,
  body: SkipOccurrenceRequest,
): Promise<RecurringOccurrenceDto> {
  return apiRequest<RecurringOccurrenceDto>(`/recurring/occurrences/${occurrenceId}/skip`, {
    method: 'POST',
    accessToken,
    body,
  });
}

/**
 * Cofa zaksięgowanie — transakcja do kosza, wystąpienie znów czeka (07 §6.7).
 *
 * @param accessToken - Token dostępu.
 * @param occurrenceId - Identyfikator wystąpienia.
 * @returns Wystąpienie po zmianie i miesiące do unieważnienia.
 */
export function unpostOccurrence(
  accessToken: string,
  occurrenceId: string,
): Promise<{ data: RecurringOccurrenceDto; meta: OccurrenceMutationMeta }> {
  return apiRequestWithMeta<RecurringOccurrenceDto, OccurrenceMutationMeta>(
    `/recurring/occurrences/${occurrenceId}/unpost`,
    { method: 'POST', accessToken },
  );
}

/**
 * „Zapisz jako wydatek stały" — reguła z zapisanej transakcji (`F4-8`, ADR-051). Klucz
 * idempotencji: ponowienie po zerwanym połączeniu nie zakłada drugiej reguły.
 *
 * @param accessToken - Token dostępu.
 * @param transactionId - Transakcja źródłowa.
 * @param body - Terminarz.
 * @param idempotencyKey - Klucz idempotencji.
 * @returns Nowa reguła.
 */
export function saveAsRecurring(
  accessToken: string,
  transactionId: string,
  body: SaveAsRecurringInput,
  idempotencyKey: string,
): Promise<RecurringRuleDto> {
  return apiRequest<RecurringRuleDto>(`/transactions/${transactionId}/save-as-recurring`, {
    method: 'POST',
    accessToken,
    body,
    idempotencyKey,
  });
}
