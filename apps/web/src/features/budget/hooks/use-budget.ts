import type {
  ApplyToSourceResult,
  BudgetDraftDto,
  BudgetDraftListDto,
  BudgetSection,
  CategoryAveragesDto,
  CreateBudgetDraftRequest,
  CreateBudgetGroupRequest,
  CreateBudgetLineRequest,
  MonthKey,
  PromoteBudgetLineRequest,
  PromoteBudgetLineResult,
  UpdateBudgetLayoutRequest,
  UpdateBudgetLineRequest,
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
import * as budgetApi from '../api.js';

/**
 * Stan serwerowy planera budżetu — TanStack Query
 * ([02 §10](../../../../../../plans/02-architecture.md#10-frontend--wzorce)).
 *
 * Każda zmiana szkicu zwraca **cały** szkic (04 §14a), więc mutacje wpisują go wprost
 * do `qk.budgetDraft(month)` zamiast czekać na ponowny odczyt — ocena zależy od
 * wszystkich linii i front jej nie liczy. Lista szkiców (bilans, podpowiedź) jest
 * unieważniana.
 */

/**
 * Wpisuje szkic do pamięci i unieważnia listę oraz podsumowania miesięcy.
 *
 * @param client - Klient zapytań.
 * @param month - Miesiąc szkicu.
 * @param draft - Szkic z odpowiedzi; `null` — szkic usunięty.
 * @returns Obietnica spełniona po unieważnieniu.
 */
async function storeDraft(
  client: QueryClient,
  month: MonthKey,
  draft: BudgetDraftDto | null,
): Promise<void> {
  client.setQueryData(qk.budgetDraft(month), draft);
  // Podsumowanie miesiąca ma sekcję `budget` („Zostaje", podpowiedź „Zaplanuj").
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.budgetList() }),
    client.invalidateQueries({ queryKey: qk.months() }),
  ]);
}

/**
 * Lista szkiców z bilansem i podpowiedzią miesiąca.
 *
 * @returns Wynik zapytania.
 */
export function useBudgetDrafts(): UseQueryResult<BudgetDraftListDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.budgetList(),
    queryFn: () => budgetApi.fetchBudgetDrafts(requireToken(accessToken)),
    enabled: accessToken !== null,
  });
}

/**
 * Szkic miesiąca; `null`, gdy go nie ma.
 *
 * @param month - Miesiąc szkicu.
 * @returns Wynik zapytania.
 */
export function useBudgetDraft(month: MonthKey): UseQueryResult<BudgetDraftDto | null> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.budgetDraft(month),
    queryFn: () => budgetApi.fetchBudgetDraft(requireToken(accessToken), month),
    enabled: accessToken !== null,
  });
}

/**
 * Średnie kategorii wydatków.
 *
 * @param months - Okno: 3, 6 albo 12 miesięcy.
 * @param enabled - Czy pobierać (arkusz otwarty).
 * @returns Wynik zapytania.
 */
export function useCategoryAverages(
  months: number,
  enabled = true,
): UseQueryResult<CategoryAveragesDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.budgetAverages(months),
    queryFn: () => budgetApi.fetchCategoryAverages(requireToken(accessToken), months),
    enabled: accessToken !== null && enabled,
  });
}

/**
 * Zakłada szkic. Wpisuje `qk.budgetDraft(month)`, unieważnia `qk.budgetList()`, `qk.months()`.
 *
 * @param month - Miesiąc szkicu.
 * @returns Mutacja.
 */
export function useCreateBudgetDraft(
  month: MonthKey,
): UseMutationResult<BudgetDraftDto, Error, Partial<CreateBudgetDraftRequest>> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => budgetApi.createBudgetDraft(requireToken(token), month, body),
    onSuccess: (draft) => storeDraft(client, month, draft),
  });
}

/**
 * Usuwa szkic. Wpisuje `null` do `qk.budgetDraft(month)`, unieważnia `qk.budgetList()`, `qk.months()`.
 *
 * @param month - Miesiąc szkicu.
 * @returns Mutacja.
 */
export function useDeleteBudgetDraft(month: MonthKey): UseMutationResult<void, Error, void> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => budgetApi.deleteBudgetDraft(requireToken(token), month),
    onSuccess: () => storeDraft(client, month, null),
  });
}

/**
 * Dociąga brakujące linie ze źródeł. Wpisuje `qk.budgetDraft(month)`, unieważnia
 * `qk.budgetList()`, `qk.months()`.
 *
 * @param month - Miesiąc szkicu.
 * @returns Mutacja.
 */
export function useRefreshBudgetDraft(
  month: MonthKey,
): UseMutationResult<BudgetDraftDto, Error, void> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => budgetApi.refreshBudgetDraft(requireToken(token), month),
    onSuccess: (draft) => storeDraft(client, month, draft),
  });
}

/**
 * Dopisuje linię własną. Wpisuje `qk.budgetDraft(month)`, unieważnia `qk.budgetList()`, `qk.months()`.
 *
 * @param month - Miesiąc szkicu.
 * @returns Mutacja.
 */
export function useCreateBudgetLine(
  month: MonthKey,
): UseMutationResult<BudgetDraftDto, Error, CreateBudgetLineRequest> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => budgetApi.createBudgetLine(requireToken(token), month, body),
    onSuccess: (draft) => storeDraft(client, month, draft),
  });
}

/** Zmiana linii: identyfikator i pola. */
export interface UpdateBudgetLineVariables {
  readonly lineId: string;
  readonly body: UpdateBudgetLineRequest;
}

/**
 * Zmienia linię (także przywrócenie pominiętej). Wpisuje `qk.budgetDraft(month)`,
 * unieważnia `qk.budgetList()`, `qk.months()`.
 *
 * @param month - Miesiąc szkicu.
 * @returns Mutacja.
 */
export function useUpdateBudgetLine(
  month: MonthKey,
): UseMutationResult<BudgetDraftDto, Error, UpdateBudgetLineVariables> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, body }) =>
      budgetApi.updateBudgetLine(requireToken(token), month, lineId, body),
    onSuccess: (draft) => storeDraft(client, month, draft),
  });
}

/** Akcja na linii bez ciała. */
export type BudgetLineAction = 'delete' | 'accept-source' | 'detach';

/**
 * Akcja na linii: usunięcie / pominięcie, „Przyjmij", „Zostaw jako własną". Wpisuje
 * `qk.budgetDraft(month)`, unieważnia `qk.budgetList()`, `qk.months()`.
 *
 * @param month - Miesiąc szkicu.
 * @returns Mutacja.
 */
export function useBudgetLineAction(
  month: MonthKey,
): UseMutationResult<BudgetDraftDto, Error, { lineId: string; action: BudgetLineAction }> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, action }) => {
      const accessToken = requireToken(token);
      if (action === 'delete') return budgetApi.deleteBudgetLine(accessToken, month, lineId);
      if (action === 'accept-source') {
        return budgetApi.acceptBudgetLineSource(accessToken, month, lineId);
      }
      return budgetApi.detachBudgetLine(accessToken, month, lineId);
    },
    onSuccess: (draft) => storeDraft(client, month, draft),
  });
}

/**
 * Po zamianie albo zapisie w źródle zmieniły się byty innych modułów — reguły, planowane
 * wydatki, cele — i wszystko, co z nich liczone (miesiące, inne szkice).
 *
 * @param client - Klient zapytań.
 * @returns Obietnica spełniona po unieważnieniu.
 */
async function invalidateSources(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.budget() }),
    client.invalidateQueries({ queryKey: qk.recurring() }),
    client.invalidateQueries({ queryKey: qk.plannedExpenses() }),
    client.invalidateQueries({ queryKey: qk.goals() }),
    client.invalidateQueries({ queryKey: qk.months() }),
  ]);
}

/** Zamiana linii: identyfikator, pola i klucz idempotencji. */
export interface PromoteBudgetLineVariables {
  readonly lineId: string;
  readonly body: PromoteBudgetLineRequest;
  readonly idempotencyKey: string;
}

/**
 * Zamienia linię w regułę albo planowany wydatek. Wpisuje `qk.budgetDraft(month)`,
 * unieważnia `qk.budget()`, `qk.recurring()`, `qk.plannedExpenses()`, `qk.goals()`,
 * `qk.months()`.
 *
 * @param month - Miesiąc szkicu.
 * @returns Mutacja.
 */
export function usePromoteBudgetLine(
  month: MonthKey,
): UseMutationResult<PromoteBudgetLineResult, Error, PromoteBudgetLineVariables> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, body, idempotencyKey }) =>
      budgetApi.promoteBudgetLine(requireToken(token), month, lineId, body, idempotencyKey),
    onSuccess: async (result) => {
      client.setQueryData(qk.budgetDraft(month), result.draft);
      await invalidateSources(client);
    },
  });
}

/**
 * Zapisuje kwotę linii w źródle. Wpisuje `qk.budgetDraft(month)`, unieważnia to samo co
 * {@link usePromoteBudgetLine}.
 *
 * @param month - Miesiąc szkicu.
 * @returns Mutacja.
 */
export function useApplyBudgetLineToSource(
  month: MonthKey,
): UseMutationResult<ApplyToSourceResult, Error, { lineId: string; idempotencyKey: string }> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, idempotencyKey }) =>
      budgetApi.applyBudgetLineToSource(requireToken(token), month, lineId, idempotencyKey),
    onSuccess: async (result) => {
      client.setQueryData(qk.budgetDraft(month), result.draft);
      await invalidateSources(client);
    },
  });
}

/** Zmiana grupy szkicu (ADR-081) — każda zwraca cały szkic. */
export type BudgetGroupChange =
  | {
      readonly kind: 'create';
      readonly body: Partial<CreateBudgetGroupRequest> &
        Pick<CreateBudgetGroupRequest, 'section' | 'name'>;
    }
  | { readonly kind: 'rename'; readonly groupId: string; readonly name: string }
  | { readonly kind: 'delete'; readonly groupId: string }
  | { readonly kind: 'by-origin'; readonly section: BudgetSection }
  | { readonly kind: 'layout'; readonly body: UpdateBudgetLayoutRequest };

/**
 * Zmiany grup i układu: nowa grupa, nazwa, usunięcie, szybki start, kolejność. Wpisuje
 * `qk.budgetDraft(month)`; listy szkiców nie unieważnia — układ nie zmienia sum.
 *
 * @param month - Miesiąc szkicu.
 * @returns Mutacja.
 */
export function useBudgetGroupChange(
  month: MonthKey,
): UseMutationResult<BudgetDraftDto, Error, BudgetGroupChange> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change) => {
      const accessToken = requireToken(token);
      switch (change.kind) {
        case 'create':
          return budgetApi.createBudgetGroup(accessToken, month, change.body);
        case 'rename':
          return budgetApi.renameBudgetGroup(accessToken, month, change.groupId, change.name);
        case 'delete':
          return budgetApi.deleteBudgetGroup(accessToken, month, change.groupId);
        case 'by-origin':
          return budgetApi.groupBudgetByOrigin(accessToken, month, change.section);
        case 'layout':
          return budgetApi.updateBudgetLayout(accessToken, month, change.body);
      }
    },
    onSuccess: (draft) => {
      client.setQueryData(qk.budgetDraft(month), draft);
    },
  });
}
