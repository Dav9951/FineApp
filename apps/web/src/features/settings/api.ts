import type {
  HouseholdDto,
  MonthKey,
  ResetDataRequest,
  ResetDataResult,
  SettingsDto,
  UpdateHouseholdRequest,
  UpdateProfileRequest,
  UserDto,
} from '@fineapp/shared';

import { apiBlob, apiRequest } from '../../lib/api-client.js';

/**
 * Wywołania API ustawień
 * ([04 §15](../../../../../plans/04-api-spec.md#15-ustawienia--apiv1settings)).
 */

/**
 * Czyta ustawienia gospodarstwa z domownikami.
 *
 * @param accessToken - Token dostępu.
 * @returns Ustawienia.
 */
export function fetchSettings(accessToken: string): Promise<SettingsDto> {
  return apiRequest<SettingsDto>('/settings', { accessToken });
}

/**
 * Zmienia ustawienia gospodarstwa.
 *
 * @param accessToken - Token dostępu.
 * @param body - Zmienione pola.
 * @returns Gospodarstwo po zmianie.
 */
export function updateHousehold(
  accessToken: string,
  body: UpdateHouseholdRequest,
): Promise<HouseholdDto> {
  return apiRequest<HouseholdDto>('/settings/household', { method: 'PATCH', accessToken, body });
}

/**
 * Zmienia własny profil.
 *
 * @param accessToken - Token dostępu.
 * @param body - Zmienione pola.
 * @returns Profil po zmianie.
 */
export function updateProfile(accessToken: string, body: UpdateProfileRequest): Promise<UserDto> {
  return apiRequest<UserDto>('/settings/profile', { method: 'PATCH', accessToken, body });
}

/**
 * Pobiera pełny eksport gospodarstwa (JSON) jako plik.
 *
 * @param accessToken - Token dostępu.
 * @returns Treść pliku.
 */
export function fetchExportJson(accessToken: string): Promise<Blob> {
  return apiBlob('/settings/export', { accessToken });
}

/**
 * Pobiera transakcje w CSV — z jednego miesiąca albo wszystkie.
 *
 * @param accessToken - Token dostępu.
 * @param month - Miesiąc; `undefined` — wszystkie.
 * @returns Treść pliku.
 */
export function fetchExportCsv(accessToken: string, month: MonthKey | undefined): Promise<Blob> {
  return apiBlob('/settings/export.csv', { accessToken, query: { month } });
}

/**
 * Usuwa wszystkie dane gospodarstwa (ADR-072) — po potwierdzeniu PIN-em.
 *
 * @param accessToken - Token dostępu.
 * @param body - PIN zalogowanej osoby.
 * @returns Liczby usuniętych wierszy.
 */
export function resetData(accessToken: string, body: ResetDataRequest): Promise<ResetDataResult> {
  return apiRequest<ResetDataResult>('/settings/reset', { method: 'POST', accessToken, body });
}
