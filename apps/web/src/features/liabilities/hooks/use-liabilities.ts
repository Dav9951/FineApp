import type {
  CreateLiabilityInput,
  LiabilityDetailDto,
  LiabilityDto,
  LiabilityPaymentRequest,
  RebaseLiabilityRequest,
  ScheduledInstallmentDto,
  UpdateLiabilityRequest,
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
import * as liabilitiesApi from '../api.js';

/**
 * Stan serwerowy zobowiązań — TanStack Query
 * ([02 §10](../../../../../../plans/02-architecture.md#10-frontend--wzorce)).
 */

/**
 * Unieważnia wszystko, co zależy od zobowiązań.
 *
 * - `qk.liabilities()` — lista, szczegóły i harmonogramy;
 * - `qk.accounts()` — majątek netto odejmuje pozostałe zobowiązania (07 §7);
 * - `qk.recurring()` — założenie tworzy regułę raty, zamknięcie i usunięcie ją wstrzymują
 *   (ADR-047).
 *
 * @param client - Klient zapytań.
 * @returns Obietnica spełniona po unieważnieniu.
 */
async function invalidateLiabilities(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.liabilities() }),
    client.invalidateQueries({ queryKey: qk.accounts() }),
    client.invalidateQueries({ queryKey: qk.recurring() }),
  ]);
}

/**
 * Lista zobowiązań ze stanem.
 *
 * @returns Wynik zapytania.
 */
export function useLiabilities(): UseQueryResult<LiabilityDto[]> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.liabilities(),
    queryFn: () => liabilitiesApi.fetchLiabilities(requireToken(accessToken)),
    enabled: accessToken !== null,
  });
}

/**
 * Zobowiązanie z historią rat.
 *
 * @param liabilityId - Identyfikator.
 * @returns Wynik zapytania.
 */
export function useLiability(liabilityId: string): UseQueryResult<LiabilityDetailDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.liability(liabilityId),
    queryFn: () => liabilitiesApi.fetchLiability(requireToken(accessToken), liabilityId),
    enabled: accessToken !== null,
  });
}

/**
 * Prognozowany harmonogram spłaty.
 *
 * @param liabilityId - Identyfikator.
 * @returns Wynik zapytania.
 */
export function useLiabilitySchedule(
  liabilityId: string,
): UseQueryResult<ScheduledInstallmentDto[]> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.liabilitySchedule(liabilityId),
    queryFn: () => liabilitiesApi.fetchSchedule(requireToken(accessToken), liabilityId),
    enabled: accessToken !== null,
  });
}

/**
 * Zakłada zobowiązanie. Unieważnia: `qk.liabilities()`, `qk.accounts()`, `qk.recurring()`.
 *
 * @returns Mutacja.
 */
export function useCreateLiability(): UseMutationResult<LiabilityDto, Error, CreateLiabilityInput> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => liabilitiesApi.createLiability(requireToken(accessToken), body),
    onSuccess: () => invalidateLiabilities(client),
  });
}

/** Zmiana zobowiązania: identyfikator i zmieniane pola. */
export interface UpdateLiabilityVariables {
  readonly liabilityId: string;
  readonly body: UpdateLiabilityRequest;
}

/**
 * Zmienia zobowiązanie. Unieważnia: `qk.liabilities()`, `qk.accounts()`, `qk.recurring()`.
 *
 * @returns Mutacja.
 */
export function useUpdateLiability(): UseMutationResult<
  LiabilityDto,
  Error,
  UpdateLiabilityVariables
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ liabilityId, body }) =>
      liabilitiesApi.updateLiability(requireToken(accessToken), liabilityId, body),
    onSuccess: () => invalidateLiabilities(client),
  });
}

/**
 * Usuwa zobowiązanie. Unieważnia: `qk.liabilities()`, `qk.accounts()`, `qk.recurring()`,
 * `qk.transactions()` (raty tracą powiązanie).
 *
 * @returns Mutacja przyjmująca identyfikator.
 */
export function useDeleteLiability(): UseMutationResult<void, Error, string> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (liabilityId) =>
      liabilitiesApi.deleteLiability(requireToken(accessToken), liabilityId),
    onSuccess: async (_result, liabilityId) => {
      // Szczegóły usuwamy, a nie unieważniamy — odświeżenie zamontowanego ekranu dałoby
      // mignięcie „Nie ma takiego zobowiązania".
      client.removeQueries({ queryKey: qk.liability(liabilityId) });
      await Promise.all([
        invalidateLiabilities(client),
        client.invalidateQueries({ queryKey: qk.transactions() }),
      ]);
    },
  });
}

/** Korekta stanu: identyfikator i dane z wyciągu. */
export interface RebaseLiabilityVariables {
  readonly liabilityId: string;
  readonly body: RebaseLiabilityRequest;
}

/**
 * Korekta stanu z wyciągu. Unieważnia: `qk.liabilities()`, `qk.accounts()`, `qk.recurring()`.
 *
 * @returns Mutacja.
 */
export function useRebaseLiability(): UseMutationResult<
  LiabilityDto,
  Error,
  RebaseLiabilityVariables
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ liabilityId, body }) =>
      liabilitiesApi.rebaseLiability(requireToken(accessToken), liabilityId, body),
    onSuccess: () => invalidateLiabilities(client),
  });
}

/** Rata do zaksięgowania. */
export interface RecordPaymentVariables {
  readonly liabilityId: string;
  readonly body: LiabilityPaymentRequest;
  readonly idempotencyKey: string;
}

/**
 * Księguje ratę. Unieważnia: `qk.liabilities()`, `qk.accounts()`, `qk.recurring()`,
 * `qk.transactions()`, `qk.categoryUsageAll()` i miesiące z `meta.affectedMonths`
 * (rata to wydatek w księdze i `debt_repayment` w miesiącu).
 *
 * @returns Mutacja.
 */
export function useRecordPayment(): UseMutationResult<
  liabilitiesApi.LiabilityPaymentMutation,
  Error,
  RecordPaymentVariables
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ liabilityId, body, idempotencyKey }) =>
      liabilitiesApi.recordPayment(requireToken(accessToken), liabilityId, body, idempotencyKey),
    onSuccess: async (result) => {
      await Promise.all([
        invalidateLiabilities(client),
        client.invalidateQueries({ queryKey: qk.transactions() }),
        client.invalidateQueries({ queryKey: qk.categoryUsageAll() }),
        ...result.meta.affectedMonths.map((month) =>
          client.invalidateQueries({ queryKey: qk.month(month) }),
        ),
      ]);
    },
  });
}
