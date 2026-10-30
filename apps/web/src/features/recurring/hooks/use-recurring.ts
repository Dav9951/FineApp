import type {
  CreateRecurringRuleInput,
  PostOccurrenceRequest,
  RecurringOccurrenceDto,
  RecurringRuleDetailDto,
  RecurringRuleDto,
  SaveAsRecurringInput,
  UpdateRecurringRuleRequest,
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
import * as recurringApi from '../api.js';

/**
 * Stan serwerowy reguł cyklicznych — TanStack Query
 * ([02 §10](../../../../../../plans/02-architecture.md#10-frontend--wzorce)).
 */

/**
 * Unieważnia wszystko, co zależy od reguł.
 *
 * - `qk.recurring()` — reguły i wystąpienia (edycja terminarza i kwoty zmienia czekające
 *   wystąpienia, 07 §6.4);
 * - `qk.months()` — dashboard generuje wystąpienia i pokaże je w „Do zrobienia" (`F4-7`).
 *
 * Transakcji reguła nie rusza — księgowanie ma własne mutacje.
 *
 * @param client - Klient zapytań.
 * @returns Obietnica spełniona po unieważnieniu.
 */
async function invalidateRecurring(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.recurring() }),
    client.invalidateQueries({ queryKey: qk.months() }),
  ]);
}

/**
 * Lista reguł.
 *
 * @returns Wynik zapytania.
 */
export function useRecurringRules(): UseQueryResult<RecurringRuleDto[]> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.recurringRules(),
    queryFn: () => recurringApi.fetchRules(requireToken(accessToken)),
    enabled: accessToken !== null,
  });
}

/**
 * Reguła z najbliższymi terminami.
 *
 * @param ruleId - Identyfikator reguły albo `undefined` (nowa — zapytanie wyłączone).
 * @returns Wynik zapytania.
 */
export function useRecurringRule(
  ruleId: string | undefined,
): UseQueryResult<RecurringRuleDetailDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.recurringRule(ruleId ?? ''),
    queryFn: () => recurringApi.fetchRule(requireToken(accessToken), ruleId ?? ''),
    enabled: accessToken !== null && ruleId !== undefined,
  });
}

/**
 * Zakłada regułę. Unieważnia: `qk.recurring()`, `qk.months()`.
 *
 * @returns Mutacja.
 */
export function useCreateRule(): UseMutationResult<
  RecurringRuleDto,
  Error,
  CreateRecurringRuleInput
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => recurringApi.createRule(requireToken(accessToken), body),
    onSuccess: () => invalidateRecurring(client),
  });
}

/** Zmiana reguły: identyfikator i zmieniane pola. */
export interface UpdateRuleVariables {
  readonly ruleId: string;
  readonly body: UpdateRecurringRuleRequest;
}

/**
 * Zmienia regułę. Unieważnia: `qk.recurring()`, `qk.months()`.
 *
 * @returns Mutacja.
 */
export function useUpdateRule(): UseMutationResult<RecurringRuleDto, Error, UpdateRuleVariables> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, body }) =>
      recurringApi.updateRule(requireToken(accessToken), ruleId, body),
    onSuccess: () => invalidateRecurring(client),
  });
}

/** Wstrzymanie albo wznowienie reguły. */
export interface SetRuleActiveVariables {
  readonly ruleId: string;
  readonly active: boolean;
}

/**
 * Wstrzymuje albo wznawia regułę. Unieważnia: `qk.recurring()`, `qk.months()`.
 *
 * Przełącznik na liście zmienia się od razu (optymistycznie) — przy dwóch osobach
 * i jednym serwerze konflikt jest rzadki, a czekanie na odpowiedź przy każdym dotknięciu
 * przełącznika byłoby odczuwalne. Błąd przywraca poprzedni stan.
 *
 * @returns Mutacja.
 */
export function useSetRuleActive(): UseMutationResult<
  RecurringRuleDto,
  Error,
  SetRuleActiveVariables,
  { previous: RecurringRuleDto[] | undefined }
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, active }) =>
      recurringApi.setRuleActive(requireToken(accessToken), ruleId, active),
    onMutate: async ({ ruleId, active }) => {
      await client.cancelQueries({ queryKey: qk.recurringRules() });
      const previous = client.getQueryData<RecurringRuleDto[]>(qk.recurringRules());
      client.setQueryData<RecurringRuleDto[]>(qk.recurringRules(), (rules) =>
        rules?.map((rule) => (rule.id === ruleId ? { ...rule, isActive: active } : rule)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      client.setQueryData(qk.recurringRules(), context?.previous);
    },
    onSettled: () => invalidateRecurring(client),
  });
}

/**
 * Usuwa regułę. Unieważnia: `qk.recurring()`, `qk.months()`.
 *
 * @returns Mutacja przyjmująca identyfikator reguły.
 */
export function useDeleteRule(): UseMutationResult<void, Error, string> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ruleId) => recurringApi.deleteRule(requireToken(accessToken), ruleId),
    onSuccess: (_result, ruleId) => {
      client.removeQueries({ queryKey: qk.recurringRule(ruleId) });
      return invalidateRecurring(client);
    },
  });
}

/**
 * Unieważnia wszystko, co zmienia zaksięgowanie albo cofnięcie wystąpienia: to transakcja
 * w księdze, więc to samo co zapis transakcji, plus pozycje cykliczne i zobowiązania
 * (rata z reguły).
 *
 * @param client - Klient zapytań.
 * @param affectedMonths - Miesiące z odpowiedzi serwera.
 * @returns Obietnica spełniona po unieważnieniu.
 */
async function invalidateAfterPosting(
  client: QueryClient,
  affectedMonths: readonly string[],
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.recurring() }),
    client.invalidateQueries({ queryKey: qk.transactions() }),
    client.invalidateQueries({ queryKey: qk.accounts() }),
    client.invalidateQueries({ queryKey: qk.liabilities() }),
    client.invalidateQueries({ queryKey: qk.categoryUsageAll() }),
    client.invalidateQueries({ queryKey: qk.monthsAvailable() }),
    ...affectedMonths.map((month) => client.invalidateQueries({ queryKey: qk.month(month) })),
  ]);
}

/** Wystąpienie do zaksięgowania. */
export interface PostOccurrenceVariables {
  readonly occurrenceId: string;
  readonly body: PostOccurrenceRequest;
  readonly idempotencyKey: string;
}

/**
 * Księguje wystąpienie. Unieważnia: `qk.recurring()`, `qk.transactions()`, `qk.accounts()`,
 * `qk.liabilities()`, `qk.categoryUsageAll()`, `qk.monthsAvailable()` i miesiące
 * z `meta.affectedMonths`.
 *
 * @returns Mutacja.
 */
export function usePostOccurrence(): UseMutationResult<
  recurringApi.PostOccurrenceMutation,
  Error,
  PostOccurrenceVariables
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ occurrenceId, body, idempotencyKey }) =>
      recurringApi.postOccurrence(requireToken(accessToken), occurrenceId, body, idempotencyKey),
    onSuccess: (result) => invalidateAfterPosting(client, result.meta.affectedMonths),
  });
}

/**
 * Cofa zaksięgowanie — „Cofnij" po zaksięgowaniu. Unieważnia to samo co
 * {@link usePostOccurrence}.
 *
 * @returns Mutacja przyjmująca identyfikator wystąpienia.
 */
export function useUnpostOccurrence(): UseMutationResult<
  { data: RecurringOccurrenceDto; meta: { affectedMonths: string[] } },
  Error,
  string
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (occurrenceId) =>
      recurringApi.unpostOccurrence(requireToken(accessToken), occurrenceId),
    onSuccess: (result) => invalidateAfterPosting(client, result.meta.affectedMonths),
  });
}

/** Wystąpienie do pominięcia. */
export interface SkipOccurrenceVariables {
  readonly occurrenceId: string;
  readonly monthKey: string;
}

/**
 * Pomija wystąpienie. Unieważnia: `qk.recurring()` i miesiąc wystąpienia — w księdze nic
 * się nie zmienia.
 *
 * @returns Mutacja.
 */
export function useSkipOccurrence(): UseMutationResult<
  RecurringOccurrenceDto,
  Error,
  SkipOccurrenceVariables
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ occurrenceId }) =>
      recurringApi.skipOccurrence(requireToken(accessToken), occurrenceId, { reason: null }),
    onSuccess: async (_result, { monthKey }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: qk.recurring() }),
        client.invalidateQueries({ queryKey: qk.month(monthKey) }),
        // Zaległe z wcześniejszego miesiąca stoją na dashboardzie bieżącego.
        client.invalidateQueries({ queryKey: qk.months() }),
      ]);
    },
  });
}

/** „Zapisz jako wydatek stały": transakcja źródłowa, terminarz i klucz. */
export interface SaveAsRecurringVariables {
  readonly transactionId: string;
  readonly body: SaveAsRecurringInput;
  readonly idempotencyKey: string;
}

/**
 * Reguła z zapisanej transakcji (`F4-8`, ADR-051). Unieważnia: `qk.recurring()`,
 * `qk.months()` (transakcja opłaca wystąpienie swojego miesiąca), `qk.transactions()`
 * (powiązanie z wystąpieniem) i `qk.liabilities()` (rata dostaje regułę).
 *
 * @returns Mutacja.
 */
export function useSaveAsRecurring(): UseMutationResult<
  RecurringRuleDto,
  Error,
  SaveAsRecurringVariables
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionId, body, idempotencyKey }) =>
      recurringApi.saveAsRecurring(requireToken(accessToken), transactionId, body, idempotencyKey),
    onSuccess: () =>
      Promise.all([
        invalidateRecurring(client),
        client.invalidateQueries({ queryKey: qk.transactions() }),
        client.invalidateQueries({ queryKey: qk.liabilities() }),
      ]),
  });
}
