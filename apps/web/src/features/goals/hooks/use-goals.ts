import type {
  ConvertContributionRequest,
  ConvertContributionResponse,
  CreateGoalInput,
  GoalContributionRequest,
  GoalDetailDto,
  GoalDto,
  MonthKey,
  UpdateGoalRequest,
} from '@fineapp/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { qk } from '../../../lib/query-keys.js';
import { requireToken, useAccessToken } from '../../auth/use-token.js';
import * as goalsApi from '../api.js';

/**
 * Stan serwerowy celów — TanStack Query
 * ([02 §10](../../../../../../plans/02-architecture.md#10-frontend--wzorce)).
 */

/**
 * Unieważnia wszystko, co pokazuje cele: listy i szczegóły, a także kafel celów
 * na dashboardzie (`qk.months()` — sekcja `goals` podsumowania miesiąca, `F5-8`).
 *
 * @param client - Klient zapytań.
 * @returns Obietnica spełniona po unieważnieniu.
 */
async function invalidateGoals(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.goals() }),
    client.invalidateQueries({ queryKey: qk.months() }),
  ]);
}

/**
 * Cele z postępem i planem miesiąca.
 *
 * @param month - Miesiąc planu.
 * @param enabled - Czy pytać (formularz przelewu pyta tylko przy przelewie).
 * @returns Wynik zapytania: cele i podsumowanie planu.
 */
export function useGoals(month: MonthKey, enabled = true): UseQueryResult<goalsApi.GoalsList> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.goalList(month),
    queryFn: () => goalsApi.fetchGoals(requireToken(accessToken), month),
    enabled: enabled && accessToken !== null,
  });
}

/**
 * Cel z historią wpłat.
 *
 * @param goalId - Identyfikator.
 * @returns Wynik zapytania.
 */
export function useGoal(goalId: string): UseQueryResult<GoalDetailDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.goal(goalId),
    queryFn: () => goalsApi.fetchGoal(requireToken(accessToken), goalId),
    enabled: accessToken !== null,
  });
}

/**
 * Zakłada cel. Unieważnia: `qk.goals()`, `qk.months()`.
 *
 * @returns Mutacja.
 */
export function useCreateGoal(): UseMutationResult<GoalDto, Error, CreateGoalInput> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => goalsApi.createGoal(requireToken(accessToken), body),
    onSuccess: () => invalidateGoals(client),
  });
}

/** Zmiana celu: identyfikator i zmieniane pola. */
export interface UpdateGoalVariables {
  readonly goalId: string;
  readonly body: UpdateGoalRequest;
}

/**
 * Zmienia cel. Unieważnia: `qk.goals()`, `qk.months()`.
 *
 * @returns Mutacja.
 */
export function useUpdateGoal(): UseMutationResult<GoalDto, Error, UpdateGoalVariables> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, body }) => goalsApi.updateGoal(requireToken(accessToken), goalId, body),
    onSuccess: () => invalidateGoals(client),
  });
}

/**
 * Usuwa cel. Unieważnia: `qk.goals()`, `qk.months()`, `qk.transactions()` (wpłaty tracą
 * powiązanie z celem).
 *
 * @returns Mutacja przyjmująca identyfikator.
 */
export function useDeleteGoal(): UseMutationResult<void, Error, string> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (goalId) => goalsApi.deleteGoal(requireToken(accessToken), goalId),
    onSuccess: async (_result, goalId) => {
      client.removeQueries({ queryKey: qk.goal(goalId) });
      await Promise.all([
        invalidateGoals(client),
        client.invalidateQueries({ queryKey: qk.transactions() }),
      ]);
    },
  });
}

/**
 * Oznacza cel jako osiągnięty. Unieważnia: `qk.goals()`, `qk.months()`.
 *
 * @returns Mutacja przyjmująca identyfikator.
 */
export function useCompleteGoal(): UseMutationResult<GoalDto, Error, string> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (goalId) => goalsApi.completeGoal(requireToken(accessToken), goalId),
    onSuccess: () => invalidateGoals(client),
  });
}

/** Wpłata na cel. */
export interface ContributeVariables {
  readonly goalId: string;
  readonly body: GoalContributionRequest;
  readonly idempotencyKey: string;
}

/**
 * Wpłaca na cel. Unieważnia: `qk.goals()`, `qk.months()`, `qk.transactions()`,
 * `qk.accounts()`, `qk.allocationAll()`, `qk.monthsAvailable()` — wpłata to przelew
 * w księdze, ze skutkami dla sald i rozkładu.
 *
 * @returns Mutacja.
 */
export function useContribute(): UseMutationResult<
  goalsApi.GoalContributionMutation,
  Error,
  ContributeVariables
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, body, idempotencyKey }) =>
      goalsApi.contributeToGoal(requireToken(accessToken), goalId, body, idempotencyKey),
    onSuccess: async () => {
      await Promise.all([
        invalidateGoals(client),
        client.invalidateQueries({ queryKey: qk.transactions() }),
        client.invalidateQueries({ queryKey: qk.accounts() }),
        client.invalidateQueries({ queryKey: qk.allocationAll() }),
        client.invalidateQueries({ queryKey: qk.monthsAvailable() }),
      ]);
    },
  });
}

/**
 * Przelicznik % ↔ kwota — zapytanie, nie mutacja: bez zapisu, a te same wejścia dają
 * ten sam wynik, więc pamięć podręczna oszczędza żądania przy przełączaniu pól.
 * Poprzedni wynik zostaje na ekranie, póki nie dojdzie nowy — liczba nie miga.
 *
 * @param request - Miesiąc i jedna strona; `null` — nic do przeliczenia.
 * @returns Wynik zapytania.
 */
export function useConvertContribution(
  request: ConvertContributionRequest | null,
): UseQueryResult<ConvertContributionResponse> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: [...qk.goals(), 'convert', request],
    queryFn: () =>
      goalsApi.convertContribution(
        requireToken(accessToken),
        request ?? { month: '2000-01', amountMinor: 1 },
      ),
    enabled: accessToken !== null && request !== null,
    placeholderData: keepPreviousData,
  });
}
