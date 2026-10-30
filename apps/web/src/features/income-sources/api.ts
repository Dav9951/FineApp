import type {
  CreateIncomeSourceRequest,
  IncomeSourceDto,
  UpdateIncomeSourceRequest,
} from '@fineapp/shared';

import { apiRequest } from '../../lib/api-client.js';

/**
 * Wywołania API źródeł przychodu
 * ([04 §12](../../../../../plans/04-api-spec.md#12-źródła-przychodu--apiv1income-sources)).
 */

/**
 * Czyta aktywne źródła przychodu.
 *
 * @param accessToken - Token dostępu.
 * @returns Źródła w kolejności wyświetlania.
 */
export function fetchIncomeSources(accessToken: string): Promise<IncomeSourceDto[]> {
  return apiRequest<IncomeSourceDto[]>('/income-sources', { accessToken });
}

/**
 * Zakłada źródło przychodu.
 *
 * @param accessToken - Token dostępu.
 * @param body - Nazwa i rodzaj.
 * @returns Założone źródło.
 */
export function createIncomeSource(
  accessToken: string,
  body: CreateIncomeSourceRequest,
): Promise<IncomeSourceDto> {
  return apiRequest<IncomeSourceDto>('/income-sources', { method: 'POST', accessToken, body });
}

/**
 * Czyta źródła razem z zarchiwizowanymi — ekran ustawień.
 *
 * @param accessToken - Token dostępu.
 * @returns Wszystkie źródła w kolejności wyświetlania.
 */
export function fetchIncomeSourcesWithArchive(accessToken: string): Promise<IncomeSourceDto[]> {
  return apiRequest<IncomeSourceDto[]>('/income-sources', {
    accessToken,
    query: { includeArchived: true },
  });
}

/**
 * Zmienia źródło przychodu.
 *
 * @param accessToken - Token dostępu.
 * @param id - Identyfikator źródła.
 * @param body - Zmienione pola.
 * @returns Źródło po zmianie.
 */
export function updateIncomeSource(
  accessToken: string,
  id: string,
  body: UpdateIncomeSourceRequest,
): Promise<IncomeSourceDto> {
  return apiRequest<IncomeSourceDto>(`/income-sources/${id}`, {
    method: 'PATCH',
    accessToken,
    body,
  });
}

/**
 * Archiwizuje albo przywraca źródło.
 *
 * @param accessToken - Token dostępu.
 * @param id - Identyfikator źródła.
 * @param archived - `true` — do archiwum, `false` — z powrotem.
 * @returns Źródło po zmianie.
 */
export function setIncomeSourceArchived(
  accessToken: string,
  id: string,
  archived: boolean,
): Promise<IncomeSourceDto> {
  return apiRequest<IncomeSourceDto>(
    `/income-sources/${id}/${archived ? 'archive' : 'unarchive'}`,
    { method: 'POST', accessToken },
  );
}

/**
 * Usuwa nieużywane źródło; z przychodami — `409` (I-10).
 *
 * @param accessToken - Token dostępu.
 * @param id - Identyfikator źródła.
 * @returns Obietnica spełniona po usunięciu.
 */
export async function deleteIncomeSource(accessToken: string, id: string): Promise<void> {
  await apiRequest(`/income-sources/${id}`, { method: 'DELETE', accessToken });
}
