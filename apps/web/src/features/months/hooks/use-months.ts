import {
  shiftMonth,
  type MonthCategoriesDto,
  type MonthKey,
  type MonthSummaryDto,
} from '@fineapp/shared';
import type { MonthsAvailableDto } from '@fineapp/shared';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';

import { qk } from '../../../lib/query-keys.js';
import { requireToken, useAccessToken } from '../../auth/use-token.js';
import * as monthsApi from '../api.js';

/**
 * Stan serwerowy ekranu miesiąca — TanStack Query
 * ([02 §10](../../../../../../plans/02-architecture.md#10-frontend--wzorce)).
 *
 * Tylko odczyty: miesiąc nie ma własnych zapisów. Unieważniają go zapisy innych
 * modułów — transakcja (`qk.month(m)` z `affectedMonths`, `qk.monthsAvailable()`),
 * konto i kategoria (`qk.months()`).
 */

/**
 * Podsumowanie miesiąca.
 *
 * @param month - Klucz miesiąca.
 * @returns Wynik zapytania.
 */
export function useMonthSummary(month: MonthKey): UseQueryResult<MonthSummaryDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.month(month),
    queryFn: () => monthsApi.fetchMonthSummary(requireToken(accessToken), month),
    enabled: accessToken !== null,
  });
}

/**
 * Bieżący miesiąc i miesiące z danymi — siatka przełącznika.
 *
 * @param enabled - Czy pobierać; siatka potrzebuje ich dopiero po otwarciu.
 * @returns Wynik zapytania.
 */
export function useAvailableMonths(enabled = true): UseQueryResult<MonthsAvailableDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.monthsAvailable(),
    queryFn: () => monthsApi.fetchAvailableMonths(requireToken(accessToken)),
    enabled: enabled && accessToken !== null,
  });
}

/**
 * Rozbicie wydatków miesiąca po kategoriach.
 *
 * @param month - Klucz miesiąca.
 * @returns Wynik zapytania.
 */
export function useMonthCategories(month: MonthKey): UseQueryResult<MonthCategoriesDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.monthCategories(month),
    queryFn: () => monthsApi.fetchMonthCategories(requireToken(accessToken), month),
    enabled: accessToken !== null,
  });
}

/** Ile czekać na bezczynność tam, gdzie przeglądarka nie zna `requestIdleCallback`. */
const IDLE_FALLBACK_MS = 800;

/**
 * Pobiera w tle podsumowania sąsiednich miesięcy (06 §6, `F3-5`).
 *
 * Po bezczynności, nie od razu: pierwsze żądanie należy do oglądanego miesiąca, a dwa
 * kolejne w tej samej chwili dzieliłyby z nim łącze komórkowe. Dzięki temu strzałka
 * albo gest pokazują sąsiedni miesiąc od razu, bez szkieletu.
 *
 * @param month - Oglądany miesiąc.
 * @param ready - Czy oglądany miesiąc już się wczytał.
 */
export function usePrefetchNeighbourMonths(month: MonthKey, ready: boolean): void {
  const client = useQueryClient();
  const accessToken = useAccessToken();
  useEffect(() => {
    if (!ready || accessToken === null) return;
    const prefetch = (): void => {
      for (const neighbour of [shiftMonth(month, -1), shiftMonth(month, 1)]) {
        void client.prefetchQuery({
          queryKey: qk.month(neighbour),
          queryFn: () => monthsApi.fetchMonthSummary(accessToken, neighbour),
        });
      }
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(prefetch, { timeout: 2_000 });
      return (): void => {
        window.cancelIdleCallback(handle);
      };
    }
    const timer = setTimeout(prefetch, IDLE_FALLBACK_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [client, accessToken, month, ready]);
}
