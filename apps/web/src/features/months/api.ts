import type {
  MonthCategoriesDto,
  MonthKey,
  MonthSummaryDto,
  MonthsAvailableDto,
} from '@fineapp/shared';

import { apiRequest } from '../../lib/api-client.js';

/**
 * Wywołania API ekranu miesiąca ([04 §14](../../../../../plans/04-api-spec.md#14-miesiąc--apiv1months)).
 *
 * Cienkie funkcje: ścieżka i token. Cache i wstępne pobieranie są w `hooks/use-months.ts`.
 */

/**
 * Czyta podsumowanie miesiąca — cały dashboard jednym żądaniem.
 *
 * @param accessToken - Token dostępu.
 * @param month - Klucz miesiąca.
 * @returns Podsumowanie.
 */
export function fetchMonthSummary(accessToken: string, month: MonthKey): Promise<MonthSummaryDto> {
  return apiRequest<MonthSummaryDto>(`/months/${month}/summary`, { accessToken });
}

/**
 * Czyta bieżący miesiąc i miesiące z danymi — do siatki przełącznika.
 *
 * @param accessToken - Token dostępu.
 * @returns Miesiące z danymi.
 */
export function fetchAvailableMonths(accessToken: string): Promise<MonthsAvailableDto> {
  return apiRequest<MonthsAvailableDto>('/months/available', { accessToken });
}

/**
 * Czyta rozbicie wydatków miesiąca po kategoriach.
 *
 * @param accessToken - Token dostępu.
 * @param month - Klucz miesiąca.
 * @returns Kategorie główne z podkategoriami.
 */
export function fetchMonthCategories(
  accessToken: string,
  month: MonthKey,
): Promise<MonthCategoriesDto> {
  return apiRequest<MonthCategoriesDto>(`/months/${month}/categories`, { accessToken });
}
