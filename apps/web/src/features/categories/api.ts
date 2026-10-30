import type {
  CategoryDto,
  CategoryKind,
  CategoryTreeDto,
  CategoryUsageDto,
  CreateCategoryRequest,
  MergeCategoryResponse,
  MonthKey,
  UpdateCategoryRequest,
} from '@fineapp/shared';

import { apiRequest } from '../../lib/api-client.js';

/**
 * Wywołania API kategorii ([04 §6](../../../../../plans/04-api-spec.md#6-kategorie--apiv1categories)):
 * odczyt dla formularza transakcji (`F2-7`) i zarządzanie z ekranu ustawień (`F2-9`).
 */

/**
 * Czyta drzewo kategorii jednego rodzaju.
 *
 * @param accessToken - Token dostępu.
 * @param kind - Rodzaj kategorii — zgodny z typem transakcji (I-4).
 * @param includeArchived - Czy dołączyć zarchiwizowane (ekran ustawień).
 * @returns Kategorie główne z podkategoriami.
 */
export function fetchCategoryTree(
  accessToken: string,
  kind: CategoryKind,
  includeArchived = false,
): Promise<CategoryTreeDto[]> {
  return apiRequest<CategoryTreeDto[]>('/categories', {
    accessToken,
    query: includeArchived ? { kind, includeArchived: 'true' } : { kind },
  });
}

/**
 * Czyta użycie kategorii: liczbę transakcji i sumę w miesiącu (ADR-038).
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc sumy.
 * @returns Wiersze tylko dla kategorii z transakcjami.
 */
export function fetchCategoryUsage(
  accessToken: string,
  month: MonthKey,
): Promise<CategoryUsageDto[]> {
  return apiRequest<CategoryUsageDto[]>('/categories/usage', { accessToken, query: { month } });
}

/**
 * Zakłada kategorię albo podkategorię.
 *
 * @param accessToken - Token dostępu.
 * @param body - Dane kategorii.
 * @returns Założona kategoria.
 */
export function createCategory(
  accessToken: string,
  body: CreateCategoryRequest,
): Promise<CategoryDto> {
  return apiRequest<CategoryDto>('/categories', { method: 'POST', accessToken, body });
}

/**
 * Zmienia kategorię — wyłącznie przysłane pola.
 *
 * @param accessToken - Token dostępu.
 * @param categoryId - Identyfikator kategorii.
 * @param body - Zmieniane pola.
 * @returns Kategoria po zmianie.
 */
export function updateCategory(
  accessToken: string,
  categoryId: string,
  body: UpdateCategoryRequest,
): Promise<CategoryDto> {
  return apiRequest<CategoryDto>(`/categories/${categoryId}`, {
    method: 'PATCH',
    accessToken,
    body,
  });
}

/**
 * Archiwizuje kategorię albo przywraca ją z archiwum.
 *
 * @param accessToken - Token dostępu.
 * @param categoryId - Identyfikator kategorii.
 * @param archived - `true` archiwizuje, `false` przywraca.
 * @returns Kategoria po zmianie.
 */
export function setCategoryArchived(
  accessToken: string,
  categoryId: string,
  archived: boolean,
): Promise<CategoryDto> {
  return apiRequest<CategoryDto>(
    `/categories/${categoryId}/${archived ? 'archive' : 'unarchive'}`,
    { method: 'POST', accessToken },
  );
}

/**
 * Scala kategorię w inną: przepina transakcje i archiwizuje źródło (07 §9.3).
 *
 * @param accessToken - Token dostępu.
 * @param categoryId - Kategoria źródłowa.
 * @param targetCategoryId - Kategoria docelowa.
 * @returns Kategoria docelowa i liczba przepiętych transakcji.
 */
export function mergeCategory(
  accessToken: string,
  categoryId: string,
  targetCategoryId: string,
): Promise<MergeCategoryResponse> {
  return apiRequest<MergeCategoryResponse>(`/categories/${categoryId}/merge`, {
    method: 'POST',
    accessToken,
    body: { targetCategoryId },
  });
}

/**
 * Usuwa kategorię — tylko własną, bez podkategorii i bez transakcji (I-9, I-10).
 *
 * @param accessToken - Token dostępu.
 * @param categoryId - Identyfikator kategorii.
 * @returns Obietnica spełniona po usunięciu.
 */
export async function deleteCategory(accessToken: string, categoryId: string): Promise<void> {
  await apiRequest<undefined>(`/categories/${categoryId}`, { method: 'DELETE', accessToken });
}
