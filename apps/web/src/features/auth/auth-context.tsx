import type { HouseholdDto, LoginRequest, UserDto } from '@fineapp/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ApiRequestError } from '../../lib/api-client.js';
import * as authApi from './api.js';

/**
 * Stan zalogowania ([09 §3.1](../../../../../plans/09-security-auth.md#31-podział-ról)).
 *
 * **Access token żyje wyłącznie w pamięci.** Nie ma go ani w `localStorage`, ani
 * w `sessionStorage`: to zdejmuje najczęstszy wektor kradzieży przy XSS. Ceną jest to,
 * że po odświeżeniu strony trzeba go odtworzyć — robi to ciche `POST /auth/refresh`
 * na starcie, z ciasteczkiem `httpOnly`, którego skrypt nie widzi.
 *
 * Token jest też odnawiany **zanim wygaśnie**, a nie dopiero po pierwszym `401`:
 * inaczej co piętnaście minut jedno żądanie użytkownika kończyłoby się niepowodzeniem
 * i trzeba by je ponawiać.
 */

/** Etap, w którym znajduje się sesja. */
export type AuthStatus = 'checking' | 'anonymous' | 'authenticated';

/** Zawartość kontekstu uwierzytelnienia. */
export interface AuthState {
  status: AuthStatus;
  user: UserDto | null;
  household: HouseholdDto | null;
  /** Token dostępu; `null`, dopóki nie ma sesji. */
  accessToken: string | null;
  /** Loguje i ustawia sesję. */
  signIn: (body: LoginRequest) => Promise<void>;
  /** Wylogowuje bieżące urządzenie. */
  signOut: () => Promise<void>;
  /**
   * Podmienia profil albo gospodarstwo po zapisie w ustawieniach — bez tego strefa
   * czasowa i limit wstecz w formularzach zostałyby stare do następnego odświeżenia.
   */
  applyProfile: (changes: { user?: UserDto; household?: HouseholdDto }) => void;
  /** Czyści sesję w przeglądarce bez wołania API — po `logout-all` serwer już ją zamknął. */
  dropSession: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Ile sekund przed wygaśnięciem tokenu odpalić ciche odnowienie.
 *
 * Sześćdziesiąt sekund zapasu wystarcza na wolne łącze i nie powoduje, że odnowienie
 * goni samo siebie przy krótkich czasach życia tokenu używanych w testach.
 */
const REFRESH_MARGIN_SECONDS = 60;

/**
 * Provider sesji.
 *
 * @param props - Właściwości komponentu.
 * @param props.children - Drzewo aplikacji.
 * @returns Drzewo z kontekstem sesji.
 */
export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<UserDto | null>(null);
  const [household, setHousehold] = useState<HouseholdDto | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearSession = useCallback((): void => {
    clearTimeout(timerRef.current);
    setAccessToken(null);
    setUser(null);
    setHousehold(null);
    setStatus('anonymous');
  }, []);

  const applySession = useCallback(
    (session: {
      accessToken: string;
      expiresIn: number;
      user: UserDto;
      household: HouseholdDto;
    }) => {
      setAccessToken(session.accessToken);
      setUser(session.user);
      setHousehold(session.household);
      setStatus('authenticated');

      clearTimeout(timerRef.current);
      const delayMs = Math.max(session.expiresIn - REFRESH_MARGIN_SECONDS, 1) * 1000;
      timerRef.current = setTimeout(() => {
        void authApi
          .refresh()
          .then(applySession)
          // Nieudane odnowienie znaczy, że sesja przepadła — np. wykryto ponowne użycie
          // tokenu i serwer unieważnił wszystko (09 §3.3). Wtedy trzeba się zalogować.
          .catch(clearSession);
      }, delayMs);
    },
    [clearSession],
  );

  useEffect(() => {
    // Ciche odtworzenie sesji po odświeżeniu strony. `401` jest tu **normalną**
    // odpowiedzią, nie awarią: znaczy tylko, że nikt nie jest zalogowany.
    void authApi
      .refresh()
      .then(applySession)
      .catch(() => {
        clearSession();
      });

    return (): void => {
      clearTimeout(timerRef.current);
    };
  }, [applySession, clearSession]);

  const signIn = useCallback(
    async (body: LoginRequest): Promise<void> => {
      applySession(await authApi.login(body));
    },
    [applySession],
  );

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await authApi.logout();
    } catch (error) {
      // Wylogowanie po stronie serwera mogło się nie udać, ale sesja w przeglądarce
      // ma zniknąć tak czy inaczej — inaczej użytkownik zostaje zalogowany wbrew sobie.
      if (!(error instanceof ApiRequestError)) throw error;
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const applyProfile = useCallback(
    (changes: { user?: UserDto; household?: HouseholdDto }): void => {
      if (changes.user !== undefined) setUser(changes.user);
      if (changes.household !== undefined) setHousehold(changes.household);
    },
    [],
  );

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      household,
      accessToken,
      signIn,
      signOut,
      applyProfile,
      dropSession: clearSession,
    }),
    [status, user, household, accessToken, signIn, signOut, applyProfile, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Czyta kontekst sesji.
 *
 * @returns Stan sesji.
 * @throws {Error} Gdy komponent stoi poza {@link AuthProvider}.
 */
export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (value === undefined) {
    throw new Error('useAuth: komponent musi znajdować się wewnątrz <AuthProvider>');
  }
  return value;
}
