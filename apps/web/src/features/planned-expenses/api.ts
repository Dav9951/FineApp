import type {
  CreatePlannedExpenseInput,
  DeferPlannedExpenseRequest,
  PlannedExpenseDetailDto,
  PlannedExpenseDto,
  PostPlannedExpenseRequest,
  PostPlannedExpenseResultDto,
  SetAsideContributionRequest,
  SetAsideResultDto,
  TransactionMutationMeta,
  UpcomingExpensesMeta,
  UpdatePlannedExpenseRequest,
} from '@fineapp/shared';

import { apiRequest, apiRequestWithMeta } from '../../lib/api-client.js';

/**
 * Wywołania API planowanych wydatków
 * ([04 §9a](../../../../../plans/04-api-spec.md#9a-planowane-wydatki--apiv1planned-expenses)).
 *
 * Funkcje są cienkie: ścieżka, metoda, ciało. Stan, cache i unieważnianie mieszkają
 * w hookach (`hooks/use-planned-expenses.ts`).
 */

/**
 * Czyta aktywne planowane wydatki (`planned`, `funding`, `ready`, `deferred`) — po terminie.
 *
 * @param accessToken - Token dostępu.
 * @returns Wydatki.
 */
export function fetchPlannedExpenses(accessToken: string): Promise<PlannedExpenseDto[]> {
  return apiRequest<PlannedExpenseDto[]>('/planned-expenses', { accessToken });
}

/** Wydatki w horyzoncie z prognozą. */
export interface UpcomingPlannedExpenses {
  readonly data: PlannedExpenseDto[];
  readonly meta: UpcomingExpensesMeta;
}

/**
 * Czyta prognozę: wydatki w horyzoncie, sumy, obciążenie miesięcy i ostrzeżenia.
 *
 * @param accessToken - Token dostępu.
 * @param months - Horyzont w miesiącach.
 * @returns Wydatki i prognoza.
 */
export function fetchUpcoming(
  accessToken: string,
  months: number,
): Promise<UpcomingPlannedExpenses> {
  return apiRequestWithMeta<PlannedExpenseDto[], UpcomingExpensesMeta>(
    `/planned-expenses/upcoming?months=${String(months)}`,
    { accessToken },
  );
}

/**
 * Czyta wydatek z historią odkładania.
 *
 * @param accessToken - Token dostępu.
 * @param id - Identyfikator.
 * @returns Szczegóły.
 */
export function fetchPlannedExpense(
  accessToken: string,
  id: string,
): Promise<PlannedExpenseDetailDto> {
  return apiRequest<PlannedExpenseDetailDto>(`/planned-expenses/${id}`, { accessToken });
}

/**
 * Zakłada wydatek.
 *
 * @param accessToken - Token dostępu.
 * @param body - Pola wydatku.
 * @returns Założony wydatek.
 */
export function createPlannedExpense(
  accessToken: string,
  body: CreatePlannedExpenseInput,
): Promise<PlannedExpenseDto> {
  return apiRequest<PlannedExpenseDto>('/planned-expenses', { method: 'POST', accessToken, body });
}

/**
 * Zmienia wydatek — wyłącznie przysłane pola.
 *
 * @param accessToken - Token dostępu.
 * @param id - Identyfikator.
 * @param body - Zmieniane pola.
 * @returns Wydatek po zmianie.
 */
export function updatePlannedExpense(
  accessToken: string,
  id: string,
  body: UpdatePlannedExpenseRequest,
): Promise<PlannedExpenseDto> {
  return apiRequest<PlannedExpenseDto>(`/planned-expenses/${id}`, {
    method: 'PATCH',
    accessToken,
    body,
  });
}

/**
 * Usuwa wydatek; przelewy odkładania zostają w księdze bez powiązania.
 *
 * @param accessToken - Token dostępu.
 * @param id - Identyfikator.
 * @returns Obietnica spełniona po usunięciu.
 */
export async function deletePlannedExpense(accessToken: string, id: string): Promise<void> {
  await apiRequest<undefined>(`/planned-expenses/${id}`, { method: 'DELETE', accessToken });
}

/**
 * Przesuwa termin.
 *
 * @param accessToken - Token dostępu.
 * @param id - Identyfikator.
 * @param body - Nowy miesiąc i opcjonalnie dzień.
 * @returns Wydatek po zmianie.
 */
export function deferPlannedExpense(
  accessToken: string,
  id: string,
  body: DeferPlannedExpenseRequest,
): Promise<PlannedExpenseDto> {
  return apiRequest<PlannedExpenseDto>(`/planned-expenses/${id}/defer`, {
    method: 'POST',
    accessToken,
    body,
  });
}

/**
 * Odwołuje wydatek — zostaje w historii jako odwołany.
 *
 * @param accessToken - Token dostępu.
 * @param id - Identyfikator.
 * @returns Wydatek po zmianie.
 */
export function cancelPlannedExpense(accessToken: string, id: string): Promise<PlannedExpenseDto> {
  return apiRequest<PlannedExpenseDto>(`/planned-expenses/${id}/cancel`, {
    method: 'POST',
    accessToken,
  });
}

/** Wynik wpłaty na odkładanie z miesiącami do unieważnienia. */
export interface SetAsideMutation {
  readonly data: SetAsideResultDto;
  readonly meta: TransactionMutationMeta;
}

/**
 * „Odłóż teraz" — przelew oznaczony wydatkiem. Klucz idempotencji: jeden na dotknięcie
 * albo otwarcie arkusza, więc ponowienie na słabym łączu nie odłoży drugi raz (ADR-037).
 *
 * @param accessToken - Token dostępu.
 * @param id - Identyfikator.
 * @param body - Kwota i konto; puste — rata wyliczona z konta płatności.
 * @param idempotencyKey - Klucz idempotencji.
 * @returns Wydatek po wpłacie, przelew i miesiące do unieważnienia.
 */
export function setAside(
  accessToken: string,
  id: string,
  body: SetAsideContributionRequest,
  idempotencyKey: string,
): Promise<SetAsideMutation> {
  return apiRequestWithMeta<SetAsideResultDto, TransactionMutationMeta>(
    `/planned-expenses/${id}/set-aside`,
    { method: 'POST', accessToken, body, idempotencyKey },
  );
}

/** Wynik zapłaty z miesiącami do unieważnienia. */
export interface PostPlannedMutation {
  readonly data: PostPlannedExpenseResultDto;
  readonly meta: TransactionMutationMeta;
}

/**
 * „Zapłacone" — wydatek w księdze z rzeczywistą kwotą; przy powtarzaniu co rok serwer
 * zakłada wpis na kolejny rok.
 *
 * @param accessToken - Token dostępu.
 * @param id - Identyfikator.
 * @param body - Kwota, data, konto; puste — jak w planie.
 * @param idempotencyKey - Klucz idempotencji.
 * @returns Wydatek, transakcja, kolejna instancja i miesiące do unieważnienia.
 */
export function postPlannedExpense(
  accessToken: string,
  id: string,
  body: PostPlannedExpenseRequest,
  idempotencyKey: string,
): Promise<PostPlannedMutation> {
  return apiRequestWithMeta<PostPlannedExpenseResultDto, TransactionMutationMeta>(
    `/planned-expenses/${id}/post`,
    { method: 'POST', accessToken, body, idempotencyKey },
  );
}
