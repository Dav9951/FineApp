import type {
  CreateIncomeSourceRequest,
  IncomeSourceDto,
  UpdateIncomeSourceRequest,
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
import {
  createIncomeSource,
  deleteIncomeSource,
  fetchIncomeSources,
  fetchIncomeSourcesWithArchive,
  setIncomeSourceArchived,
  updateIncomeSource,
} from '../api.js';

/**
 * Aktywne źródła przychodu.
 *
 * @param enabled - Czy zapytanie ma się wykonać.
 * @returns Wynik zapytania.
 */
export function useIncomeSources(enabled = true): UseQueryResult<IncomeSourceDto[]> {
  const token = useAccessToken();
  return useQuery({
    queryKey: qk.incomeSources(),
    queryFn: () => fetchIncomeSources(requireToken(token)),
    enabled: enabled && token !== null,
  });
}

/**
 * Zakłada źródło przychodu. Unieważnia: `qk.incomeSources()`.
 *
 * Nowe źródło trafia do pamięci podręcznej od razu: formularz wybiera je w chwili
 * dodania i bez tego pokazywałby „…" do czasu, aż lista wróci z serwera.
 *
 * @returns Mutacja.
 */
export function useCreateIncomeSource(): UseMutationResult<
  IncomeSourceDto,
  Error,
  CreateIncomeSourceRequest
> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => createIncomeSource(requireToken(token), body),
    onSuccess: (created) => {
      client.setQueryData<IncomeSourceDto[]>(qk.incomeSources(), (current) =>
        current === undefined ? current : [...current, created],
      );
      return client.invalidateQueries({ queryKey: qk.incomeSources() });
    },
  });
}

/**
 * Źródła razem z archiwum — ekran `/settings/income-sources`.
 *
 * @returns Wynik zapytania.
 */
export function useIncomeSourcesWithArchive(): UseQueryResult<IncomeSourceDto[]> {
  const token = useAccessToken();
  return useQuery({
    queryKey: qk.incomeSourcesWithArchive(),
    queryFn: () => fetchIncomeSourcesWithArchive(requireToken(token)),
    enabled: token !== null,
  });
}

/**
 * Zmiana źródła. Unieważnia: `qk.incomeSources()` (korzeń — obie listy), `qk.months()`
 * i `qk.allocationAll()`, bo `countsTowardAllocation` zmienia podstawę celów procentowych.
 *
 * @returns Mutacja.
 */
export function useUpdateIncomeSource(): UseMutationResult<
  IncomeSourceDto,
  Error,
  { id: string; body: UpdateIncomeSourceRequest }
> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => updateIncomeSource(requireToken(token), id, body),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: qk.incomeSources() }),
        client.invalidateQueries({ queryKey: qk.months() }),
        client.invalidateQueries({ queryKey: qk.allocationAll() }),
      ]);
    },
  });
}

/**
 * Archiwizacja albo przywrócenie źródła. Unieważnia: `qk.incomeSources()`.
 *
 * @returns Mutacja.
 */
export function useSetIncomeSourceArchived(): UseMutationResult<
  IncomeSourceDto,
  Error,
  { id: string; archived: boolean }
> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }) => setIncomeSourceArchived(requireToken(token), id, archived),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.incomeSources() }),
  });
}

/**
 * Usunięcie źródła. Unieważnia: `qk.incomeSources()`.
 *
 * @returns Mutacja.
 */
export function useDeleteIncomeSource(): UseMutationResult<void, Error, string> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id) => deleteIncomeSource(requireToken(token), id),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.incomeSources() }),
  });
}
