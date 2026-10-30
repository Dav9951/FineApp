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
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { qk } from '../../../lib/query-keys.js';
import { requireToken, useAccessToken } from '../../auth/use-token.js';
import * as categoriesApi from '../api.js';

/**
 * Stan serwerowy kategorii — TanStack Query.
 *
 * Każda zmiana kategorii unieważnia `qk.categories()`: drzewa w formularzu transakcji,
 * na ekranie ustawień i statystyki użycia naraz. Scalenie dotyka też transakcji (nazwa
 * kategorii na listach) i miesięcy (rozbicie po kategoriach).
 */

/**
 * Drzewo aktywnych kategorii jednego rodzaju.
 *
 * @param kind - Rodzaj kategorii.
 * @param enabled - Czy zapytanie ma się wykonać (np. tylko przy otwartym wyborze).
 * @returns Wynik zapytania.
 */
export function useCategoryTree(
  kind: CategoryKind,
  enabled = true,
): UseQueryResult<CategoryTreeDto[]> {
  const token = useAccessToken();
  return useQuery({
    queryKey: qk.categoryTree(kind),
    queryFn: () => categoriesApi.fetchCategoryTree(requireToken(token), kind),
    enabled: enabled && token !== null,
    // Kategorie zmieniają się rzadko, a formularz otwiera się często.
    staleTime: 5 * 60_000,
  });
}

/**
 * Drzewo kategorii jednego rodzaju razem z archiwum — ekran ustawień.
 *
 * @param kind - Rodzaj kategorii.
 * @returns Wynik zapytania.
 */
export function useCategoryTreeWithArchive(kind: CategoryKind): UseQueryResult<CategoryTreeDto[]> {
  const token = useAccessToken();
  return useQuery({
    queryKey: qk.categoryTreeWithArchive(kind),
    queryFn: () => categoriesApi.fetchCategoryTree(requireToken(token), kind, true),
    enabled: token !== null,
  });
}

/**
 * Użycie kategorii w miesiącu (ADR-038).
 *
 * @param month - Miesiąc sumy.
 * @returns Wynik zapytania.
 */
export function useCategoryUsage(month: MonthKey): UseQueryResult<CategoryUsageDto[]> {
  const token = useAccessToken();
  return useQuery({
    queryKey: qk.categoryUsage(month),
    queryFn: () => categoriesApi.fetchCategoryUsage(requireToken(token), month),
    enabled: token !== null,
  });
}

/**
 * Zakłada kategorię. Unieważnia `qk.categories()`.
 *
 * @returns Mutacja.
 */
export function useCreateCategory(): UseMutationResult<CategoryDto, Error, CreateCategoryRequest> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => categoriesApi.createCategory(requireToken(token), body),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.categories() }),
  });
}

/** Zmiana kategorii. */
export interface UpdateCategoryVariables {
  readonly categoryId: string;
  readonly body: UpdateCategoryRequest;
}

/**
 * Zmienia kategorię. Unieważnia `qk.categories()`, `qk.transactions()` — nazwa
 * kategorii stoi w każdym wierszu listy transakcji — i `qk.months()`: dashboard pokazuje
 * nazwy kategorii, a zmiana rodzica przestawia sumy w rozbiciu miesiąca.
 *
 * @returns Mutacja.
 */
export function useUpdateCategory(): UseMutationResult<
  CategoryDto,
  Error,
  UpdateCategoryVariables
> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, body }) =>
      categoriesApi.updateCategory(requireToken(token), categoryId, body),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: qk.categories() }),
        client.invalidateQueries({ queryKey: qk.transactions() }),
        client.invalidateQueries({ queryKey: qk.months() }),
      ]),
  });
}

/** Archiwizacja albo przywrócenie. */
export interface SetCategoryArchivedVariables {
  readonly categoryId: string;
  readonly archived: boolean;
}

/**
 * Archiwizuje albo przywraca kategorię. Unieważnia `qk.categories()`.
 *
 * @returns Mutacja.
 */
export function useSetCategoryArchived(): UseMutationResult<
  CategoryDto,
  Error,
  SetCategoryArchivedVariables
> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, archived }) =>
      categoriesApi.setCategoryArchived(requireToken(token), categoryId, archived),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.categories() }),
  });
}

/** Scalenie kategorii. */
export interface MergeCategoryVariables {
  readonly categoryId: string;
  readonly targetCategoryId: string;
}

/**
 * Scala kategorię w inną. Unieważnia `qk.categories()`, `qk.transactions()`
 * i `qk.months()` — przepięte transakcje zmieniają kategorię w listach i raportach.
 *
 * @returns Mutacja.
 */
export function useMergeCategory(): UseMutationResult<
  MergeCategoryResponse,
  Error,
  MergeCategoryVariables
> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, targetCategoryId }) =>
      categoriesApi.mergeCategory(requireToken(token), categoryId, targetCategoryId),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: qk.categories() }),
        client.invalidateQueries({ queryKey: qk.transactions() }),
        client.invalidateQueries({ queryKey: qk.months() }),
      ]),
  });
}

/**
 * Usuwa kategorię. Unieważnia `qk.categories()`.
 *
 * @returns Mutacja.
 */
export function useDeleteCategory(): UseMutationResult<void, Error, string> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (categoryId) => categoriesApi.deleteCategory(requireToken(token), categoryId),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.categories() }),
  });
}
