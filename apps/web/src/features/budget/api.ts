import type {
  ApplyToSourceResult,
  BudgetDraftDto,
  BudgetDraftListDto,
  CategoryAveragesDto,
  BudgetSection,
  CreateBudgetDraftRequest,
  CreateBudgetGroupRequest,
  CreateBudgetLineRequest,
  MonthKey,
  PromoteBudgetLineRequest,
  PromoteBudgetLineResult,
  UpdateBudgetLayoutRequest,
  UpdateBudgetLineRequest,
} from '@fineapp/shared';

import { ApiRequestError, apiRequest } from '../../lib/api-client.js';

/**
 * Wywołania API planera budżetu
 * ([04 §14a](../../../../../plans/04-api-spec.md#14a-planer-budżetu--apiv1budget-drafts)).
 *
 * Funkcje są cienkie: ścieżka, metoda, ciało. Stan, cache i unieważnianie mieszkają
 * w hookach (`hooks/use-budget.ts`). Każda zmiana zwraca cały szkic.
 */

/**
 * Czyta listę szkiców z podpowiedzią miesiąca.
 *
 * @param accessToken - Token dostępu.
 * @returns Lista szkiców.
 */
export function fetchBudgetDrafts(accessToken: string): Promise<BudgetDraftListDto> {
  return apiRequest<BudgetDraftListDto>('/budget-drafts', { accessToken });
}

/**
 * Czyta szkic miesiąca. Brak szkicu (`404`) to stan ekranu, nie błąd — stąd `null`.
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @returns Szkic albo `null`, gdy go nie ma.
 */
export async function fetchBudgetDraft(
  accessToken: string,
  month: MonthKey,
): Promise<BudgetDraftDto | null> {
  try {
    return await apiRequest<BudgetDraftDto>(`/budget-drafts/${month}`, { accessToken });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Czyta średnie kategorii wydatków.
 *
 * @param accessToken - Token dostępu.
 * @param months - Okno: 3, 6 albo 12 miesięcy.
 * @returns Średnie.
 */
export function fetchCategoryAverages(
  accessToken: string,
  months: number,
): Promise<CategoryAveragesDto> {
  return apiRequest<CategoryAveragesDto>(`/budget-drafts/averages?months=${String(months)}`, {
    accessToken,
  });
}

/**
 * Zakłada szkic.
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @param body - Co wciągnąć.
 * @returns Szkic.
 */
export function createBudgetDraft(
  accessToken: string,
  month: MonthKey,
  body: Partial<CreateBudgetDraftRequest>,
): Promise<BudgetDraftDto> {
  return apiRequest<BudgetDraftDto>(`/budget-drafts/${month}`, {
    method: 'POST',
    accessToken,
    body,
  });
}

/**
 * Usuwa szkic z liniami.
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @returns Obietnica spełniona po usunięciu.
 */
export async function deleteBudgetDraft(accessToken: string, month: MonthKey): Promise<void> {
  await apiRequest<undefined>(`/budget-drafts/${month}`, { method: 'DELETE', accessToken });
}

/**
 * Dociąga brakujące linie ze źródeł.
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @returns Szkic.
 */
export function refreshBudgetDraft(accessToken: string, month: MonthKey): Promise<BudgetDraftDto> {
  return apiRequest<BudgetDraftDto>(`/budget-drafts/${month}/refresh`, {
    method: 'POST',
    accessToken,
  });
}

/**
 * Dopisuje linię własną.
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @param body - Pola linii.
 * @returns Szkic.
 */
export function createBudgetLine(
  accessToken: string,
  month: MonthKey,
  body: CreateBudgetLineRequest,
): Promise<BudgetDraftDto> {
  return apiRequest<BudgetDraftDto>(`/budget-drafts/${month}/lines`, {
    method: 'POST',
    accessToken,
    body,
  });
}

/**
 * Zmienia linię (także `isExcluded`).
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @param lineId - Linia.
 * @param body - Zmienione pola.
 * @returns Szkic.
 */
export function updateBudgetLine(
  accessToken: string,
  month: MonthKey,
  lineId: string,
  body: UpdateBudgetLineRequest,
): Promise<BudgetDraftDto> {
  return apiRequest<BudgetDraftDto>(`/budget-drafts/${month}/lines/${lineId}`, {
    method: 'PATCH',
    accessToken,
    body,
  });
}

/**
 * Usuwa linię własną albo pomija powiązaną.
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @param lineId - Linia.
 * @returns Szkic.
 */
export function deleteBudgetLine(
  accessToken: string,
  month: MonthKey,
  lineId: string,
): Promise<BudgetDraftDto> {
  return apiRequest<BudgetDraftDto>(`/budget-drafts/${month}/lines/${lineId}`, {
    method: 'DELETE',
    accessToken,
  });
}

/**
 * „Przyjmij" bieżącą kwotę źródła.
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @param lineId - Linia.
 * @returns Szkic.
 */
export function acceptBudgetLineSource(
  accessToken: string,
  month: MonthKey,
  lineId: string,
): Promise<BudgetDraftDto> {
  return apiRequest<BudgetDraftDto>(`/budget-drafts/${month}/lines/${lineId}/accept-source`, {
    method: 'POST',
    accessToken,
  });
}

/**
 * „Zostaw jako własną" — linia osierocona staje się linią własną.
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @param lineId - Linia.
 * @returns Szkic.
 */
export function detachBudgetLine(
  accessToken: string,
  month: MonthKey,
  lineId: string,
): Promise<BudgetDraftDto> {
  return apiRequest<BudgetDraftDto>(`/budget-drafts/${month}/lines/${lineId}/detach`, {
    method: 'POST',
    accessToken,
  });
}

/**
 * Zamienia linię własną w regułę cykliczną albo planowany wydatek (07 §13.6).
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @param lineId - Linia.
 * @param body - Cel zamiany i jego pola.
 * @param idempotencyKey - Klucz jednego otwarcia arkusza — powtórka nie zakłada drugiej reguły.
 * @returns Szkic, utworzony byt i miesiąc, do którego przeszła linia.
 */
export function promoteBudgetLine(
  accessToken: string,
  month: MonthKey,
  lineId: string,
  body: PromoteBudgetLineRequest,
  idempotencyKey: string,
): Promise<PromoteBudgetLineResult> {
  return apiRequest<PromoteBudgetLineResult>(`/budget-drafts/${month}/lines/${lineId}/promote`, {
    method: 'POST',
    accessToken,
    body,
    idempotencyKey,
  });
}

/**
 * Zapisuje kwotę linii w źródle (07 §13.7).
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @param lineId - Linia.
 * @param idempotencyKey - Klucz jednego otwarcia arkusza — powtórka nie dzieli reguły dwa razy.
 * @returns Szkic i skutek w źródle.
 */
export function applyBudgetLineToSource(
  accessToken: string,
  month: MonthKey,
  lineId: string,
  idempotencyKey: string,
): Promise<ApplyToSourceResult> {
  return apiRequest<ApplyToSourceResult>(
    `/budget-drafts/${month}/lines/${lineId}/apply-to-source`,
    { method: 'POST', accessToken, idempotencyKey },
  );
}

/**
 * Zakłada grupę w sekcji — `POST /budget-drafts/:month/groups` (ADR-081).
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @param body - Sekcja, nazwa, opcjonalnie linie i miejsce.
 * @returns Szkic z nową grupą.
 */
export function createBudgetGroup(
  accessToken: string,
  month: MonthKey,
  body: Partial<CreateBudgetGroupRequest> & Pick<CreateBudgetGroupRequest, 'section' | 'name'>,
): Promise<BudgetDraftDto> {
  return apiRequest<BudgetDraftDto>(`/budget-drafts/${month}/groups`, {
    method: 'POST',
    accessToken,
    body,
  });
}

/**
 * Zmienia nazwę grupy — `PATCH /budget-drafts/:month/groups/:groupId`.
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @param groupId - Grupa.
 * @param name - Nowa nazwa.
 * @returns Szkic po zmianie.
 */
export function renameBudgetGroup(
  accessToken: string,
  month: MonthKey,
  groupId: string,
  name: string,
): Promise<BudgetDraftDto> {
  return apiRequest<BudgetDraftDto>(`/budget-drafts/${month}/groups/${groupId}`, {
    method: 'PATCH',
    accessToken,
    body: { name },
  });
}

/**
 * Usuwa grupę; jej linie przechodzą do „Bez grupy" — `DELETE …/groups/:groupId`.
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @param groupId - Grupa.
 * @returns Szkic po zmianie.
 */
export function deleteBudgetGroup(
  accessToken: string,
  month: MonthKey,
  groupId: string,
): Promise<BudgetDraftDto> {
  return apiRequest<BudgetDraftDto>(`/budget-drafts/${month}/groups/${groupId}`, {
    method: 'DELETE',
    accessToken,
  });
}

/**
 * Szybki start: grupy według pochodzenia — `POST …/groups/by-origin` (07 §13.10).
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @param section - Sekcja.
 * @returns Szkic z grupami.
 */
export function groupBudgetByOrigin(
  accessToken: string,
  month: MonthKey,
  section: BudgetSection,
): Promise<BudgetDraftDto> {
  return apiRequest<BudgetDraftDto>(`/budget-drafts/${month}/groups/by-origin`, {
    method: 'POST',
    accessToken,
    body: { section },
  });
}

/**
 * Zapisuje układ jednej sekcji — `PATCH /budget-drafts/:month/layout` (07 §13.10).
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc szkicu.
 * @param body - Grupy z liniami i linie bez grupy.
 * @returns Szkic w nowym układzie.
 */
export function updateBudgetLayout(
  accessToken: string,
  month: MonthKey,
  body: UpdateBudgetLayoutRequest,
): Promise<BudgetDraftDto> {
  return apiRequest<BudgetDraftDto>(`/budget-drafts/${month}/layout`, {
    method: 'PATCH',
    accessToken,
    body,
  });
}
