import { randomBytes } from 'node:crypto';

import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

import type { Config } from '../../core/config.js';
import { UnauthorizedError } from '../../core/errors.js';
import { sha256Hex } from './auth.hash.js';

/**
 * Tokeny sesji ([09 §3](../../../../../../plans/09-security-auth.md#3-sesje-i-tokeny)).
 *
 * Podział ról jest celowy:
 *
 * - **access** to JWT ważny 15 minut — weryfikacja bez zapytania do bazy jest tania,
 *   a krótka ważność ogranicza szkody z wycieku;
 * - **refresh** jest **nieprzezroczysty** i trzymany w bazie jako hash — musi dać się
 *   unieważnić natychmiast, a JWT tego nie potrafi.
 *
 * Access token świadomie **nie trafia do `localStorage`**: żyje w pamięci aplikacji,
 * co zdejmuje najczęstszy wektor kradzieży przy XSS. Po odświeżeniu strony jest
 * odtwarzany z ciasteczka refresh, więc użytkownik tego nie zauważa.
 */

/** Wystawca tokenu — pole `iss`. */
export const TOKEN_ISSUER = 'fineapp';

/** Odbiorca tokenu — pole `aud`. */
export const TOKEN_AUDIENCE = 'fineapp-web';

/** Algorytm podpisu; HS256, bo sekret jest jeden i lokalny. */
const ALGORITHM = 'HS256';

/** Liczba bajtów losowości tokenu odświeżającego — 256 bitów (09 §3.1). */
const REFRESH_TOKEN_BYTES = 32;

/** Nazwa ciasteczka z tokenem odświeżającym. */
export const REFRESH_COOKIE_NAME = 'fineapp_rt';

/** Ścieżka ciasteczka — zawężona, żeby nie jechało z każdym żądaniem. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** Zawartość access tokenu ([09 §3.2](../../../../../../plans/09-security-auth.md#32-zawartość-access-tokenu)). */
export interface AccessTokenClaims {
  /** Identyfikator użytkownika. */
  sub: string;
  /** Identyfikator gospodarstwa — zakres **wszystkich** zapytań. */
  hid: string;
  /** Identyfikator sesji, do powiązania z `auth_sessions`. */
  sid: string;
}

/**
 * Podpisuje access token.
 *
 * `hid` w tokenie jest podstawą izolacji danych: **`householdId` nigdy nie pochodzi
 * z żądania**. Nawet gdyby klient przysłał je w ciele, jest ignorowane.
 *
 * @param config - Konfiguracja (sekret, czas życia).
 * @param claims - Identyfikatory użytkownika, gospodarstwa i sesji.
 * @param now - Chwila wystawienia.
 * @returns Podpisany token.
 */
export async function signAccessToken(
  config: Config,
  claims: AccessTokenClaims,
  now: Date,
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ hid: claims.hid, sid: claims.sid })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.sub)
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + config.auth.accessTokenTtlSeconds)
    .sign(secretKey(config));
}

/**
 * Sprawdza access token i zwraca jego zawartość.
 *
 * Każdy powód odrzucenia daje **ten sam** błąd `401` z tym samym komunikatem: rozróżnienie
 * „token wygasł" od „token podrobiony" nie pomaga użytkownikowi, a pomaga atakującemu.
 *
 * @param config - Konfiguracja (sekret).
 * @param token - Token z nagłówka `Authorization`.
 * @param now - Chwila weryfikacji.
 * @returns Zawartość tokenu.
 * @throws {UnauthorizedError} Gdy token jest nieważny, wygasł albo ma obcego wystawcę.
 */
export async function verifyAccessToken(
  config: Config,
  token: string,
  now: Date,
): Promise<AccessTokenClaims> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, secretKey(config), {
      algorithms: [ALGORITHM],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      currentDate: now,
    }));
  } catch {
    throw new UnauthorizedError('Sesja wygasła. Zaloguj się ponownie.');
  }

  const { sub, hid, sid } = payload;
  if (typeof sub !== 'string' || typeof hid !== 'string' || typeof sid !== 'string') {
    throw new UnauthorizedError('Sesja wygasła. Zaloguj się ponownie.');
  }
  return { sub, hid, sid };
}

/**
 * Losuje token odświeżający.
 *
 * 256 bitów z CSPRNG, zapisane jako `base64url` — token jedzie w ciasteczku, więc nie
 * może zawierać znaków wymagających kodowania.
 *
 * @returns Token w postaci jawnej oraz jego hash do zapisania w bazie.
 */
export function createRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  return { token, hash: sha256Hex(token) };
}

/**
 * Składa opcje ciasteczka z tokenem odświeżającym.
 *
 * `path` jest zawężony do `/api/v1/auth`, żeby ciasteczko **nie było dołączane do
 * żadnego innego żądania** — to zmniejsza i powierzchnię ataku, i wielkość każdego
 * zapytania. `SameSite=Lax`, nie `Strict`: `Strict` psuje wejście z linku wysłanego
 * komunikatorem, co przy dwóch osobach w domu zdarza się regularnie.
 *
 * @param config - Konfiguracja (bezpieczeństwo ciasteczek, czas życia).
 * @returns Opcje do `reply.setCookie`.
 */
export function refreshCookieOptions(config: Config): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
  domain?: string;
} {
  return {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: config.auth.refreshTokenTtlSeconds,
    ...(config.auth.cookieDomain === '' ? {} : { domain: config.auth.cookieDomain }),
  };
}

/**
 * Buduje klucz podpisu z sekretu konfiguracji.
 *
 * @param config - Konfiguracja aplikacji.
 * @returns Klucz w postaci oczekiwanej przez `jose`.
 */
function secretKey(config: Config): Uint8Array {
  return new TextEncoder().encode(config.auth.jwtSecret);
}
