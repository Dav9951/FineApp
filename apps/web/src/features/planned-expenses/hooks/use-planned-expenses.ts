import type {
  CreatePlannedExpenseInput,
  DeferPlannedExpenseRequest,
  PlannedExpenseDetailDto,
  PlannedExpenseDto,
  PostPlannedExpenseRequest,
  SetAsideContributionRequest,
  UpdatePlannedExpenseRequest,
} from '@fineapp/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { qk } from '../../../lib/query-keys.js';
import { requireToken, useAccessToken } from '../../auth/use-token.js';
import * as plannedApi from '../api.js';

/**
 * Stan serwerowy planowanych wydatków — TanStack Query
 * ([02 §10](../../../../../../plans/02-architecture.md#10-frontend--wzorce)).
 */

/** Horyzont prognozy na ekranie i na dashboardzie (06 §3.10 „Najbliższe 6 miesięcy"). */
export const PLANNED_HORIZON_MONTHS = 6;

/**
 * Unieważnia wszystko, co pokazuje planowane wydatki: listę, prognozę, szczegóły i sekcję
 * „Nadchodzące" we **wszystkich** miesiącach (`qk.months()`) — prognoza liczy się od dziś,
 * więc zmiana jednego wydatku zmienia ją w każdym oglądanym miesiącu.
 *
 * @param client - Klient zapytań.
 * @returns Obietnica spełniona po unieważnieniu.
 */
async function invalidatePlanned(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.plannedExpenses() }),
    client.invalidateQueries({ queryKey: qk.months() }),
  ]);
}

/**
 * Unieważnia po zapisie z transakcją (odkładanie, zapłata): to samo co zapis transakcji
 * w księdze — salda, historia, cele (odkładanie na cel), rozkład — plus planowane wydatki.
 *
 * @param client - Klient zapytań.
 * @returns Obietnica spełniona po unieważnieniu.
 */
async function invalidateAfterLedgerWrite(client: QueryClient): Promise<void> {
  await Promise.all([
    invalidatePlanned(client),
    client.invalidateQueries({ queryKey: qk.transactions() }),
    client.invalidateQueries({ queryKey: qk.accounts() }),
    client.invalidateQueries({ queryKey: qk.goals() }),
    client.invalidateQueries({ queryKey: qk.allocationAll() }),
    client.invalidateQueries({ queryKey: qk.categoryUsageAll() }),
    client.invalidateQueries({ queryKey: qk.monthsAvailable() }),
  ]);
}

/**
 * Aktywne planowane wydatki, po terminie.
 *
 * @returns Wynik zapytania.
 */
export function usePlannedExpenses(): UseQueryResult<PlannedExpenseDto[]> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.plannedExpenseList(),
    queryFn: () => plannedApi.fetchPlannedExpenses(requireToken(accessToken)),
    enabled: accessToken !== null,
  });
}

/**
 * Prognoza: sumy horyzontu, rata łączna, obciążenie miesięcy i ostrzeżenia.
 *
 * @param months - Horyzont.
 * @returns Wynik zapytania.
 */
export function usePlannedUpcoming(
  months = PLANNED_HORIZON_MONTHS,
): UseQueryResult<plannedApi.UpcomingPlannedExpenses> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.plannedUpcoming(months),
    queryFn: () => plannedApi.fetchUpcoming(requireToken(accessToken), months),
    enabled: accessToken !== null,
  });
}

/**
 * Wydatek z historią odkładania.
 *
 * @param id - Identyfikator.
 * @returns Wynik zapytania.
 */
export function usePlannedExpense(id: string): UseQueryResult<PlannedExpenseDetailDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.plannedExpense(id),
    queryFn: () => plannedApi.fetchPlannedExpense(requireToken(accessToken), id),
    enabled: accessToken !== null,
  });
}

/**
 * Zakłada wydatek. Unieważnia: `qk.plannedExpenses()`, `qk.months()`.
 *
 * @returns Mutacja.
 */
export function useCreatePlannedExpense(): UseMutationResult<
  PlannedExpenseDto,
  Error,
  CreatePlannedExpenseInput
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => plannedApi.createPlannedExpense(requireToken(accessToken), body),
    onSuccess: () => invalidatePlanned(client),
  });
}

/** Zmiana wydatku: identyfikator i zmieniane pola. */
export interface UpdatePlannedVariables {
  readonly id: string;
  readonly body: UpdatePlannedExpenseRequest;
}

/**
 * Zmienia wydatek. Unieważnia: `qk.plannedExpenses()`, `qk.months()`.
 *
 * @returns Mutacja.
 */
export function useUpdatePlannedExpense(): UseMutationResult<
  PlannedExpenseDto,
  Error,
  UpdatePlannedVariables
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      plannedApi.updatePlannedExpense(requireToken(accessToken), id, body),
    onSuccess: () => invalidatePlanned(client),
  });
}

/**
 * Usuwa wydatek. Unieważnia: `qk.plannedExpenses()`, `qk.months()`, `qk.transactions()`
 * (przelewy odkładania tracą powiązanie).
 *
 * @returns Mutacja przyjmująca identyfikator.
 */
export function useDeletePlannedExpense(): UseMutationResult<void, Error, string> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id) => plannedApi.deletePlannedExpense(requireToken(accessToken), id),
    onSuccess: async (_result, id) => {
      client.removeQueries({ queryKey: qk.plannedExpense(id) });
      await Promise.all([
        invalidatePlanned(client),
        client.invalidateQueries({ queryKey: qk.transactions() }),
      ]);
    },
  });
}

/** Przesunięcie terminu. */
export interface DeferPlannedVariables {
  readonly id: string;
  readonly body: DeferPlannedExpenseRequest;
}

/**
 * Przesuwa termin. Unieważnia: `qk.plannedExpenses()`, `qk.months()`.
 *
 * @returns Mutacja.
 */
export function useDeferPlannedExpense(): UseMutationResult<
  PlannedExpenseDto,
  Error,
  DeferPlannedVariables
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      plannedApi.deferPlannedExpense(requireToken(accessToken), id, body),
    onSuccess: () => invalidatePlanned(client),
  });
}

/**
 * Odwołuje wydatek. Unieważnia: `qk.plannedExpenses()`, `qk.months()`.
 *
 * @returns Mutacja przyjmująca identyfikator.
 */
export function useCancelPlannedExpense(): UseMutationResult<PlannedExpenseDto, Error, string> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id) => plannedApi.cancelPlannedExpense(requireToken(accessToken), id),
    onSuccess: () => invalidatePlanned(client),
  });
}

/** Wpłata na odkładanie. */
export interface SetAsideVariables {
  readonly id: string;
  readonly body: SetAsideContributionRequest;
  readonly idempotencyKey: string;
}

/**
 * „Odłóż teraz". Unieważnia: planowane wydatki, wszystkie miesiące, transakcje, konta,
 * cele, rozkład, użycie kategorii, dostępne miesiące — to przelew w księdze.
 *
 * @returns Mutacja.
 */
export function useSetAside(): UseMutationResult<
  plannedApi.SetAsideMutation,
  Error,
  SetAsideVariables
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body, idempotencyKey }) =>
      plannedApi.setAside(requireToken(accessToken), id, body, idempotencyKey),
    onSuccess: () => invalidateAfterLedgerWrite(client),
  });
}

/** Zapłata wydatku. */
export interface PostPlannedVariables {
  readonly id: string;
  readonly body: PostPlannedExpenseRequest;
  readonly idempotencyKey: string;
}

/**
 * „Zapłacone". Unieważnia to samo co „Odłóż teraz" — zapłata to wydatek w księdze.
 *
 * @returns Mutacja.
 */
export function usePostPlannedExpense(): UseMutationResult<
  plannedApi.PostPlannedMutation,
  Error,
  PostPlannedVariables
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body, idempotencyKey }) =>
      plannedApi.postPlannedExpense(requireToken(accessToken), id, body, idempotencyKey),
    onSuccess: () => invalidateAfterLedgerWrite(client),
  });
}
