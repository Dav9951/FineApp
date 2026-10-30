import type {
  AuthAck,
  ChangePinRequest,
  HouseholdDto,
  ResetDataRequest,
  ResetDataResult,
  SessionDto,
  SettingsDto,
  UpdateHouseholdRequest,
  UpdateProfileRequest,
  UserDto,
} from '@fineapp/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { qk } from '../../../lib/query-keys.js';
import * as authApi from '../../auth/api.js';
import { useAuth } from '../../auth/auth-context.js';
import { requireToken, useAccessToken } from '../../auth/use-token.js';
import { fetchSettings, resetData, updateHousehold, updateProfile } from '../api.js';

/**
 * Ustawienia gospodarstwa z domownikami.
 *
 * @returns Wynik zapytania.
 */
export function useSettings(): UseQueryResult<SettingsDto> {
  const token = useAccessToken();
  return useQuery({
    queryKey: qk.settings(),
    queryFn: () => fetchSettings(requireToken(token)),
    enabled: token !== null,
  });
}

/**
 * Zmiana ustawień gospodarstwa. Unieważnia: **wszystko**.
 *
 * Strefa czasowa przesuwa „dziś", a limit wstecz — granicę zamkniętych miesięcy; jedno
 * i drugie widać na dashboardzie, w historii i w każdym formularzu. Precyzyjna lista
 * kluczy zestarzałaby się przy pierwszym nowym ekranie, a zmiana ustawień zdarza się
 * raz na kwartał.
 *
 * @returns Mutacja.
 */
export function useUpdateHousehold(): UseMutationResult<
  HouseholdDto,
  Error,
  UpdateHouseholdRequest
> {
  const token = useAccessToken();
  const client = useQueryClient();
  const { applyProfile } = useAuth();
  return useMutation({
    mutationFn: (body) => updateHousehold(requireToken(token), body),
    onSuccess: (household) => {
      applyProfile({ household });
      client.setQueryData<SettingsDto>(qk.settings(), (current) =>
        current === undefined ? current : { ...current, household },
      );
      return client.invalidateQueries();
    },
  });
}

/**
 * Zmiana własnego profilu. Unieważnia: `qk.settings()`, `qk.transactions()` (inicjały
 * autora w historii).
 *
 * @returns Mutacja.
 */
export function useUpdateProfile(): UseMutationResult<UserDto, Error, UpdateProfileRequest> {
  const token = useAccessToken();
  const client = useQueryClient();
  const { applyProfile } = useAuth();
  return useMutation({
    mutationFn: (body) => updateProfile(requireToken(token), body),
    onSuccess: async (user) => {
      applyProfile({ user });
      await Promise.all([
        client.invalidateQueries({ queryKey: qk.settings() }),
        client.invalidateQueries({ queryKey: qk.transactions() }),
      ]);
    },
  });
}

/**
 * Aktywne urządzenia zalogowanej osoby.
 *
 * @param enabled - Czy zapytanie ma się wykonać (arkusz otwarty).
 * @returns Wynik zapytania.
 */
export function useSessions(enabled: boolean): UseQueryResult<SessionDto[]> {
  const token = useAccessToken();
  return useQuery({
    queryKey: qk.sessions(),
    queryFn: () => authApi.sessions(requireToken(token)),
    enabled: enabled && token !== null,
  });
}

/**
 * Wylogowanie jednego urządzenia. Unieważnia: `qk.sessions()`.
 *
 * @returns Mutacja.
 */
export function useRevokeSession(): UseMutationResult<AuthAck, Error, string> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sessionId) => authApi.revokeSession(requireToken(token), sessionId),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.sessions() }),
  });
}

/**
 * Wylogowanie wszystkich urządzeń, także tego. Po sukcesie sesja w przeglądarce znika,
 * a strażnik tras przenosi na `/login`.
 *
 * @returns Mutacja.
 */
export function useLogoutAll(): UseMutationResult<AuthAck, Error, void> {
  const token = useAccessToken();
  const client = useQueryClient();
  const { dropSession } = useAuth();
  return useMutation({
    mutationFn: () => authApi.logoutAll(requireToken(token)),
    onSuccess: () => {
      dropSession();
      client.clear();
    },
  });
}

/**
 * Zmiana PIN-u. Unieważnia: `qk.sessions()` — pozostałe urządzenia zostały wylogowane.
 *
 * @returns Mutacja.
 */
export function useChangePin(): UseMutationResult<AuthAck, Error, ChangePinRequest> {
  const token = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => authApi.changePin(requireToken(token), body),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.sessions() }),
  });
}

/**
 * Usunięcie wszystkich danych (ADR-072). Unieważnia: **wszystko**.
 *
 * `resetQueries`, nie `invalidateQueries`: unieważnienie zostawia stare dane na ekranie
 * do czasu odpowiedzi, a po usunięciu przez chwilę widać by było konta, których już nie
 * ma. Wyjątkiem są same ustawienia (gospodarstwo i domownicy zostają) — ich reset
 * pokazałby szkielet i zgubił potwierdzenie na ekranie ustawień, więc tylko się
 * odświeżają. Domyślne konto wydatków serwer wyczyścił — kontekst sesji dostaje to
 * samo, żeby formularze nie proponowały usuniętego konta.
 *
 * @returns Mutacja.
 */
export function useResetData(): UseMutationResult<ResetDataResult, Error, ResetDataRequest> {
  const token = useAccessToken();
  const client = useQueryClient();
  const { household, applyProfile } = useAuth();
  return useMutation({
    mutationFn: (body) => resetData(requireToken(token), body),
    onSuccess: () => {
      if (household !== null) {
        applyProfile({ household: { ...household, defaultExpenseAccountId: null } });
      }
      const isSettings = (queryKey: readonly unknown[]): boolean =>
        queryKey[0] === qk.settings()[0];
      return Promise.all([
        client.resetQueries({ predicate: (query) => !isSettings(query.queryKey) }),
        client.invalidateQueries({ predicate: (query) => isSettings(query.queryKey) }),
      ]);
    },
  });
}
