import type {
  AuthAck,
  ChangePinRequest,
  LoginRequest,
  LoginResponse,
  MeResponse,
  SessionDto,
} from '@fineapp/shared';

import { apiRequest } from '../../lib/api-client.js';

/**
 * Wywołania API uwierzytelniania
 * ([04 §4](../../../../../plans/04-api-spec.md#4-auth--apiv1auth)).
 *
 * Token odświeżający **nie przechodzi przez ten kod**: jedzie w ciasteczku `httpOnly`,
 * którego JavaScript nie widzi. Dlatego `refresh` i `logout` nie mają argumentów —
 * przeglądarka dokłada ciasteczko sama, a `credentials: 'include'` w kliencie pilnuje,
 * żeby doszło.
 */

/**
 * Loguje użytkownika.
 *
 * @param body - Adres e-mail, PIN i opcjonalna etykieta urządzenia.
 * @returns Access token wraz z profilem i gospodarstwem.
 */
export function login(body: LoginRequest): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/login', { method: 'POST', body });
}

/**
 * Odnawia sesję na podstawie ciasteczka.
 *
 * @returns Nowy access token wraz z profilem i gospodarstwem.
 */
export function refresh(): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/refresh', { method: 'POST' });
}

/**
 * Wylogowuje bieżące urządzenie.
 *
 * @returns Obietnica spełniona po wylogowaniu.
 */
export async function logout(): Promise<void> {
  await apiRequest('/auth/logout', { method: 'POST' });
}

/**
 * Czyta profil zalogowanego użytkownika.
 *
 * @param accessToken - Token dostępu.
 * @returns Profil i ustawienia gospodarstwa.
 */
export function me(accessToken: string): Promise<MeResponse> {
  return apiRequest<MeResponse>('/auth/me', { accessToken });
}

/**
 * Czyta listę aktywnych urządzeń.
 *
 * @param accessToken - Token dostępu.
 * @returns Lista urządzeń.
 */
export function sessions(accessToken: string): Promise<SessionDto[]> {
  return apiRequest<SessionDto[]>('/auth/sessions', { accessToken });
}

/**
 * Wylogowuje jedno urządzenie z listy.
 *
 * @param accessToken - Token dostępu.
 * @param sessionId - Identyfikator urządzenia (rodziny sesji).
 * @returns Liczba usuniętych sesji.
 */
export function revokeSession(accessToken: string, sessionId: string): Promise<AuthAck> {
  return apiRequest<AuthAck>(`/auth/sessions/${sessionId}`, { method: 'DELETE', accessToken });
}

/**
 * Wylogowuje wszystkie urządzenia — także to (09 §3.5).
 *
 * @param accessToken - Token dostępu.
 * @returns Liczba usuniętych sesji.
 */
export function logoutAll(accessToken: string): Promise<AuthAck> {
  return apiRequest<AuthAck>('/auth/logout-all', { method: 'POST', accessToken });
}

/**
 * Zmienia PIN; pozostałe urządzenia zostają wylogowane.
 *
 * @param accessToken - Token dostępu.
 * @param body - Obecny i nowy PIN.
 * @returns Liczba wylogowanych urządzeń.
 */
export function changePin(accessToken: string, body: ChangePinRequest): Promise<AuthAck> {
  return apiRequest<AuthAck>('/auth/pin', { method: 'PATCH', accessToken, body });
}
