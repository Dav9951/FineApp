import type {
  AllocationStatusDto,
  AllocationTargetDto,
  AllocationTargetMeta,
  MonthKey,
  UpsertAllocationTargetInput,
} from '@fineapp/shared';

import { apiRequest, apiRequestWithMeta } from '../../lib/api-client.js';

/**
 * Wywołania API rozkładu docelowego
 * ([04 §11](../../../../../plans/04-api-spec.md#11-rozkład-docelowy--apiv1allocation)).
 */

/**
 * Czyta porównanie plan/wykonanie w miesiącu.
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc.
 * @returns Stan rozkładu.
 */
export function fetchAllocationStatus(
  accessToken: string,
  month: MonthKey,
): Promise<AllocationStatusDto> {
  return apiRequest<AllocationStatusDto>(`/allocation/status?month=${month}`, { accessToken });
}

/**
 * Czyta realizację miesiąc po miesiącu — domyślnie sześć miesięcy do bieżącego.
 *
 * @param accessToken - Token dostępu.
 * @param to - Ostatni miesiąc zakresu.
 * @returns Stany miesięcy rosnąco.
 */
export function fetchAllocationTrend(
  accessToken: string,
  to: MonthKey,
): Promise<AllocationStatusDto[]> {
  return apiRequest<AllocationStatusDto[]>(`/allocation/trend?to=${to}`, { accessToken });
}

/** Wynik zapisu rozkładu z ostrzeżeniem. */
export interface AllocationTargetMutation {
  readonly data: AllocationTargetDto;
  readonly meta: AllocationTargetMeta;
}

/**
 * Ustawia rozkład od wskazanego miesiąca.
 *
 * @param accessToken - Token dostępu.
 * @param body - Miesiąc początku i udziały.
 * @returns Zapisana wersja i ostrzeżenie.
 */
export function putAllocationTarget(
  accessToken: string,
  body: UpsertAllocationTargetInput,
): Promise<AllocationTargetMutation> {
  return apiRequestWithMeta<AllocationTargetDto, AllocationTargetMeta>('/allocation/target', {
    method: 'PUT',
    accessToken,
    body,
  });
}
