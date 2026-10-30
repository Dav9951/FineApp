import type { AllocationStatusDto, MonthKey, UpsertAllocationTargetInput } from '@fineapp/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { qk } from '../../../lib/query-keys.js';
import { requireToken, useAccessToken } from '../../auth/use-token.js';
import * as allocationApi from '../api.js';

/**
 * Stan serwerowy rozkładu docelowego — TanStack Query
 * ([02 §10](../../../../../../plans/02-architecture.md#10-frontend--wzorce)).
 */

/**
 * Porównanie plan/wykonanie w miesiącu.
 *
 * @param month - Miesiąc.
 * @returns Wynik zapytania.
 */
export function useAllocationStatus(month: MonthKey): UseQueryResult<AllocationStatusDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.allocation(month),
    queryFn: () => allocationApi.fetchAllocationStatus(requireToken(accessToken), month),
    enabled: accessToken !== null,
  });
}

/**
 * Realizacja rozkładu w sześciu miesiącach do wskazanego.
 *
 * @param to - Ostatni miesiąc.
 * @returns Wynik zapytania.
 */
export function useAllocationTrend(to: MonthKey): UseQueryResult<AllocationStatusDto[]> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.allocationTrend(to),
    queryFn: () => allocationApi.fetchAllocationTrend(requireToken(accessToken), to),
    enabled: accessToken !== null,
  });
}

/**
 * Ustawia rozkład. Unieważnia: `qk.allocationAll()` i `qk.months()` (kafel „Cele
 * procentowe" na dashboardzie).
 *
 * @returns Mutacja.
 */
export function usePutAllocationTarget(): UseMutationResult<
  allocationApi.AllocationTargetMutation,
  Error,
  UpsertAllocationTargetInput
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => allocationApi.putAllocationTarget(requireToken(accessToken), body),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: qk.allocationAll() }),
        client.invalidateQueries({ queryKey: qk.months() }),
      ]);
    },
  });
}
