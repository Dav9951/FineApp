import type {
  ConvertContributionRequest,
  ConvertContributionResponse,
  CreateGoalInput,
  GoalContributionRequest,
  GoalContributionResultDto,
  GoalDetailDto,
  GoalDto,
  GoalsListMeta,
  MonthKey,
  TransactionMutationMeta,
  UpdateGoalRequest,
} from '@fineapp/shared';

import { apiRequest, apiRequestWithMeta } from '../../lib/api-client.js';

/**
 * Wywołania API celów ([04 §10](../../../../../plans/04-api-spec.md#10-cele--apiv1goals)).
 *
 * Funkcje są cienkie: ścieżka, metoda, ciało. Stan, cache i unieważnianie mieszkają
 * w hookach (`hooks/use-goals.ts`).
 */

/** Lista celów z podsumowaniem planu miesiąca. */
export interface GoalsList {
  readonly data: GoalDto[];
  readonly meta: GoalsListMeta;
}

/**
 * Czyta cele z postępem i planem miesiąca.
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc planu; pominięty — bieżący.
 * @returns Cele i podsumowanie.
 */
export function fetchGoals(accessToken: string, month?: MonthKey): Promise<GoalsList> {
  const query = month === undefined ? '' : `?month=${month}`;
  return apiRequestWithMeta<GoalDto[], GoalsListMeta>(`/goals${query}`, { accessToken });
}

/**
 * Czyta cel z historią wpłat.
 *
 * @param accessToken - Token dostępu.
 * @param goalId - Identyfikator.
 * @returns Szczegóły.
 */
export function fetchGoal(accessToken: string, goalId: string): Promise<GoalDetailDto> {
  return apiRequest<GoalDetailDto>(`/goals/${goalId}`, { accessToken });
}

/**
 * Zakłada cel.
 *
 * @param accessToken - Token dostępu.
 * @param body - Pola celu.
 * @returns Założony cel.
 */
export function createGoal(accessToken: string, body: CreateGoalInput): Promise<GoalDto> {
  return apiRequest<GoalDto>('/goals', { method: 'POST', accessToken, body });
}

/**
 * Zmienia cel — wyłącznie przysłane pola.
 *
 * @param accessToken - Token dostępu.
 * @param goalId - Identyfikator.
 * @param body - Zmieniane pola.
 * @returns Cel po zmianie.
 */
export function updateGoal(
  accessToken: string,
  goalId: string,
  body: UpdateGoalRequest,
): Promise<GoalDto> {
  return apiRequest<GoalDto>(`/goals/${goalId}`, { method: 'PATCH', accessToken, body });
}

/**
 * Usuwa cel; wpłaty zostają w księdze bez powiązania.
 *
 * @param accessToken - Token dostępu.
 * @param goalId - Identyfikator.
 * @returns Obietnica spełniona po usunięciu.
 */
export async function deleteGoal(accessToken: string, goalId: string): Promise<void> {
  await apiRequest<undefined>(`/goals/${goalId}`, { method: 'DELETE', accessToken });
}

/**
 * Oznacza cel jako osiągnięty.
 *
 * @param accessToken - Token dostępu.
 * @param goalId - Identyfikator.
 * @returns Cel po zmianie.
 */
export function completeGoal(accessToken: string, goalId: string): Promise<GoalDto> {
  return apiRequest<GoalDto>(`/goals/${goalId}/complete`, { method: 'POST', accessToken });
}

/** Wynik wpłaty z miesiącami do unieważnienia. */
export interface GoalContributionMutation {
  readonly data: GoalContributionResultDto;
  readonly meta: TransactionMutationMeta;
}

/**
 * Wpłata na cel — przelew z `goalId`. Klucz idempotencji: jeden na otwarcie arkusza
 * wpłaty, więc ponowienie na słabym łączu nie przeleje drugi raz (ADR-037).
 *
 * @param accessToken - Token dostępu.
 * @param goalId - Identyfikator.
 * @param body - Kwota i konta.
 * @param idempotencyKey - Klucz idempotencji.
 * @returns Cel po wpłacie, przelew i miesiące do unieważnienia.
 */
export function contributeToGoal(
  accessToken: string,
  goalId: string,
  body: GoalContributionRequest,
  idempotencyKey: string,
): Promise<GoalContributionMutation> {
  return apiRequestWithMeta<GoalContributionResultDto, TransactionMutationMeta>(
    `/goals/${goalId}/contributions`,
    { method: 'POST', accessToken, body, idempotencyKey },
  );
}

/**
 * Przelicznik % ↔ kwota względem wpływów miesiąca — bez zapisu.
 *
 * @param accessToken - Token dostępu.
 * @param body - Miesiąc i dokładnie jedna strona.
 * @returns Obie strony i podstawa.
 */
export function convertContribution(
  accessToken: string,
  body: ConvertContributionRequest,
): Promise<ConvertContributionResponse> {
  return apiRequest<ConvertContributionResponse>('/goals/convert', {
    method: 'POST',
    accessToken,
    body,
  });
}
