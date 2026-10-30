import {
  checkPin,
  EmailSchema,
  type ExportDto,
  type HouseholdDto,
  type HouseholdMemberDto,
  type LoginResponse,
  type MeResponse,
  type SessionDto,
  type UpdateHouseholdRequest,
  type UpdateProfileRequest,
  type UserDto,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import {
  ConflictError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '../../core/errors.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import { attemptRules, checkLoginAllowed, longestWindowSeconds } from './auth.attempts.js';
import { hashWithSalt } from './auth.hash.js';
import {
  toExportUser,
  toHouseholdDto,
  toMemberDto,
  toSessionDto,
  toUserDto,
} from './auth.mapper.js';
import { dummyPinHash, generatePin, hashPin, verifyPin } from './auth.pin.js';
import {
  countActiveUsers,
  deleteAttemptsBefore,
  deleteDeadSessions,
  deleteOtherFamilies,
  deleteSessionFamily,
  findActiveUsers,
  findAllUsers,
  findHouseholdById,
  findRecentAttempts,
  findSessionByTokenHash,
  findUserByEmail,
  findUserById,
  insertAttempt,
  insertSession,
  insertUser,
  isLiveFamilyOfUser,
  findLiveSessions,
  hasLiveSessionInFamily,
  revokeAllSessionsForUser,
  revokeSession,
  touchLastLogin,
  updateHousehold,
  updatePinHash,
  updateUserProfile,
} from './auth.repository.js';
import { sha256Hex } from './auth.hash.js';
import { createRefreshToken, signAccessToken } from './auth.tokens.js';

/**
 * Reguły uwierzytelniania.
 *
 * Serwis nie zwraca wierszy bazy — wyłącznie DTO
 * ([02 §3](../../../../../../plans/02-architecture.md#3-warstwy-i-kierunek-zależności)).
 */

/**
 * Maksymalna liczba aktywnych użytkowników gospodarstwa.
 *
 * To **nie jest** ograniczenie techniczne, tylko jawna decyzja produktowa
 * ([09 §10](../../../../../../plans/09-security-auth.md#10-zakładanie-użytkowników)) —
 * zapisana tutaj i wymuszana w serwisie, żeby nikt jej przypadkiem nie obszedł,
 * dopisując wiersz prosto do bazy przez skrypt.
 */
export const MAX_ACTIVE_USERS = 2;

/**
 * Kolory awatarów.
 *
 * Celowo **spoza palety semantycznej** z `15 §3.2`: awatar w kolorze `--income`
 * czytałby się jak wpływ, a stoi obok kwot. Dwie wartości, bo i użytkowników jest dwóch;
 * trzeci awatar nie ma prawa powstać (patrz {@link MAX_ACTIVE_USERS}).
 */
export const AVATAR_COLORS = ['#6b7fa8', '#a8836b'] as const;

/** Dane wejściowe zakładania użytkownika. */
export interface CreateUserInput {
  /** Adres e-mail; zostanie znormalizowany. */
  email: string;
  /** Nazwa widoczna w interfejsie. */
  displayName: string;
  /** Identyfikator gospodarstwa. */
  householdId: string;
  /** PIN podany ręcznie; brak oznacza wylosowanie. */
  pin?: string;
  /** Kolor awatara; brak oznacza wybór kolejnego z palety. */
  avatarColor?: string;
}

/** Wynik zakładania użytkownika. */
export interface CreateUserResult {
  /** Profil publiczny — bez hasha PIN-u. */
  user: UserDto;
  /**
   * PIN w postaci jawnej.
   *
   * Zwracany **tylko po to, żeby skrypt wypisał go raz na ekran**. Nie wolno go
   * zalogować ani zapisać — w bazie jest wyłącznie hash.
   */
  pin: string;
  /** Czy PIN został wylosowany, czy podany przez zakładającego. */
  pinGenerated: boolean;
}

/**
 * Zakłada użytkownika.
 *
 * Kolejność sprawdzeń jest celowa: najpierw to, co wynika z danych wejściowych
 * (adres, nazwa, PIN), potem dopiero zapytania do bazy. Dzięki temu literówka
 * w adresie nie kosztuje dwóch zapytań, a **haszowanie — najdroższa operacja
 * w całym przepływie — dzieje się na końcu**, gdy wiadomo już, że wiersz powstanie.
 *
 * @param handle - Uchwyt bazy.
 * @param config - Konfiguracja aplikacji (długości PIN-u).
 * @param clock - Źródło czasu.
 * @param input - Dane użytkownika.
 * @returns Profil oraz PIN w postaci jawnej.
 * @throws {ValidationError} Gdy adres, nazwa albo PIN nie spełniają reguł.
 * @throws {ConflictError} Gdy adres jest zajęty albo gospodarstwo ma już komplet osób.
 */
export async function createUser(
  handle: DbHandle,
  config: Config,
  clock: Clock,
  input: CreateUserInput,
): Promise<CreateUserResult> {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();
  if (displayName.length === 0) {
    throw new ValidationError('Nazwa użytkownika nie może być pusta.');
  }

  const { pinMinLength, pinMaxLength } = config.auth;
  const pinGenerated = input.pin === undefined;
  const pin = input.pin ?? generatePin(pinMinLength, pinMinLength, pinMaxLength);

  const check = checkPin(pin, pinMinLength, pinMaxLength);
  if (!check.ok) {
    throw new ValidationError(check.message, [{ path: 'pin', message: check.message }]);
  }

  if (findUserByEmail(handle, email)) {
    throw new ConflictError(`Użytkownik o adresie ${email} już istnieje.`);
  }

  const activeCount = countActiveUsers(handle, input.householdId);
  if (activeCount >= MAX_ACTIVE_USERS) {
    throw new ConflictError(
      `Gospodarstwo ma już ${String(MAX_ACTIVE_USERS)} aktywnych użytkowników — ` +
        'to jest świadomy limit produktowy (09 §10), nie ograniczenie techniczne.',
    );
  }

  // Kolumny czasu trzymają milisekundy epoki (`timestampColumn`), a `Clock` zwraca
  // `Date` — konwersja jest tutaj, a nie w repozytorium, bo to serwis zna jednostkę.
  const now = clock.now().getTime();
  const row = insertUser(handle, {
    id: newId(),
    householdId: input.householdId,
    email,
    displayName,
    pinHash: await hashPin(pin),
    pinUpdatedAt: now,
    avatarColor: input.avatarColor ?? AVATAR_COLORS[activeCount % AVATAR_COLORS.length],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return { user: toUserDto(row), pin, pinGenerated };
}

/**
 * Normalizuje adres e-mail albo odrzuca go z komunikatem po polsku.
 *
 * Normalizacja jest po stronie serwisu, a nie tylko schematu trasy, bo ten sam kod
 * woła skrypt CLI — a tam nie przechodzi żaden schemat żądania.
 *
 * @param email - Adres w postaci podanej przez użytkownika.
 * @returns Adres przycięty i małymi literami.
 * @throws {ValidationError} Gdy adres jest nieprawidłowy.
 */
export function normalizeEmail(email: string): string {
  const parsed = EmailSchema.safeParse(email);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Nieprawidłowy adres e-mail';
    throw new ValidationError(message, [{ path: 'email', message }]);
  }
  return parsed.data;
}

/** Dane wejściowe logowania. */
export interface LoginInput {
  email: string;
  pin: string;
  /** Etykieta urządzenia, np. „iPhone — Safari". */
  deviceLabel?: string;
  /** Adres IP klienta; zostanie zahashowany przed zapisem. */
  ip?: string;
  userAgent?: string;
}

/** Wynik logowania wraz z tokenem odświeżającym do ustawienia w ciasteczku. */
export interface LoginResult {
  /** Ciało odpowiedzi zgodne z `LoginResponseSchema`. */
  response: LoginResponse;
  /** Token odświeżający w postaci jawnej — trafia **wyłącznie** do ciasteczka. */
  refreshToken: string;
}

/** Komunikat zwracany przy każdej nieudanej próbie logowania. */
const LOGIN_FAILED_MESSAGE = 'Nieprawidłowy e-mail lub PIN.';

/**
 * Loguje użytkownika ([09 §2.4](../../../../../../plans/09-security-auth.md#24-przepływ-logowania)).
 *
 * ## Dlaczego każda ścieżka porażki kosztuje tyle samo
 *
 * Gdy użytkownika nie ma, i tak wykonujemy porównanie z **hashem-atrapą**. Bez tego
 * odpowiedź dla nieistniejącego adresu wracałaby natychmiast, a dla istniejącego po
 * ~150 ms — czyli z samego czasu odpowiedzi dałoby się wyliczyć, które konta istnieją.
 * Z tego samego powodu komunikat i status są identyczne niezależnie od przyczyny.
 *
 * Próba jest zapisywana **zawsze**, także dla adresów, które nie istnieją — inaczej
 * blokada pojawiałaby się tylko dla kont prawdziwych i sama byłaby wyrocznią.
 *
 * @param handle - Uchwyt bazy.
 * @param config - Konfiguracja aplikacji.
 * @param clock - Źródło czasu.
 * @param input - Dane logowania wraz z kontekstem żądania.
 * @returns Odpowiedź logowania i token odświeżający.
 * @throws {ValidationError} Gdy adres jest nieprawidłowy.
 * @throws {RateLimitError} Gdy przekroczono limit prób.
 * @throws {UnauthorizedError} Gdy dane logowania się nie zgadzają.
 */
export async function login(
  handle: DbHandle,
  config: Config,
  clock: Clock,
  input: LoginInput,
): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const now = clock.now();
  const nowMs = now.getTime();

  const emailHash = hashWithSalt(email, config.auth.ipHashSalt);
  const ipHash = input.ip === undefined ? null : hashWithSalt(input.ip, config.auth.ipHashSalt);

  const rules = attemptRules(config);
  const since = nowMs - longestWindowSeconds(rules) * 1000;
  const recent = findRecentAttempts(handle, emailHash, ipHash, since);

  const gate = checkLoginAllowed(rules, recent.email, recent.ip, nowMs);
  if (!gate.allowed) {
    // Zablokowanej próby NIE zapisujemy: liczyłaby się do własnego limitu i blokada
    // przedłużałaby się w nieskończoność przy samym odświeżaniu strony.
    throw new RateLimitError(
      `Zbyt wiele prób logowania. Spróbuj ponownie za ${formatWait(gate.retryAfterSeconds)}.`,
      gate.retryAfterSeconds,
    );
  }

  const user = findUserByEmail(handle, email);
  const pinHash = user?.pinHash ?? (await dummyPinHash());
  const pinMatches = await verifyPin(pinHash, input.pin);
  const succeeded = pinMatches && user !== undefined && user.isActive;

  insertAttempt(handle, { emailHash, ipHash, succeeded, createdAt: nowMs });

  if (!succeeded || user === undefined) {
    throw new UnauthorizedError(LOGIN_FAILED_MESSAGE);
  }

  const household = findHouseholdById(handle, user.householdId);
  if (household === undefined) {
    // Wiersz użytkownika bez gospodarstwa nie powinien powstać (klucz obcy), ale gdyby
    // powstał, nie wolno go traktować jak błędnego PIN-u — to awaria, nie pomyłka.
    throw new UnauthorizedError(LOGIN_FAILED_MESSAGE);
  }

  const { token: refreshToken, hash: refreshTokenHash } = createRefreshToken();
  // Pierwszy wiersz rodziny jest jej korzeniem: `familyId === id` (03 §3.3).
  const sessionId = newId();
  insertSession(handle, {
    id: sessionId,
    userId: user.id,
    familyId: sessionId,
    refreshTokenHash,
    deviceLabel: input.deviceLabel ?? null,
    userAgent: input.userAgent ?? null,
    ipHash,
    expiresAt: nowMs + config.auth.refreshTokenTtlSeconds * 1000,
    createdAt: nowMs,
    lastUsedAt: nowMs,
  });

  touchLastLogin(handle, user.id, nowMs);

  const accessToken = await signAccessToken(
    config,
    { sub: user.id, hid: user.householdId, sid: sessionId },
    now,
  );

  return {
    response: {
      accessToken,
      expiresIn: config.auth.accessTokenTtlSeconds,
      // `lastLoginAt` w odpowiedzi to logowanie POPRZEDNIE — bieżące użytkownik ma
      // przed oczami, a poprzednie jest jedyną informacją, z której pozna cudze wejście.
      user: toUserDto(user),
      household: toHouseholdDto(household),
    },
    refreshToken,
  };
}

/**
 * Zamienia sekundy na tekst po polsku.
 *
 * Komunikat trafia wprost na ekran, a „spróbuj za 847 sekund" jest bezużyteczne.
 *
 * @param seconds - Liczba sekund oczekiwania.
 * @returns Tekst w rodzaju `15 minut`.
 */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${String(minutes)} ${pluralPl(minutes, ['minutę', 'minuty', 'minut'])}`;
  const hours = Math.ceil(minutes / 60);
  return `${String(hours)} ${pluralPl(hours, ['godzinę', 'godziny', 'godzin'])}`;
}

/**
 * Wybiera formę liczby mnogiej po polsku.
 *
 * @param count - Liczba.
 * @param forms - Formy: pojedyncza, mnoga, dopełniaczowa.
 * @returns Właściwa forma.
 */
function pluralPl(count: number, forms: readonly [string, string, string]): string {
  const ones = count % 10;
  const tens = count % 100;
  if (count === 1) return forms[0];
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return forms[1];
  return forms[2];
}

/** Ile dni historii prób logowania zostaje w bazie ([03 §3.4](../../../../../../plans/03-data-model.md#34-auth_attempts)). */
export const ATTEMPT_RETENTION_DAYS = 30;

/**
 * Usuwa historię prób logowania starszą niż {@link ATTEMPT_RETENTION_DAYS}.
 *
 * Wołane przy starcie aplikacji. Tabela rośnie o wiersz na każdą próbę — także
 * nieudaną i także dla adresów, które nie istnieją — więc przy ataku potrafi urosnąć
 * szybciej niż cała reszta bazy razem wzięta. Starsze wiersze nie mogą już na nic
 * wpłynąć: najdłuższe okno reguł to doba.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @returns Liczba usuniętych wierszy.
 */
export function pruneLoginAttempts(handle: DbHandle, clock: Clock): number {
  const before = clock.now().getTime() - ATTEMPT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return deleteAttemptsBefore(handle, before);
}

/** Dane wejściowe odświeżenia sesji. */
export interface RefreshInput {
  /** Token odświeżający z ciasteczka. */
  refreshToken: string;
  ip?: string;
  userAgent?: string;
}

/** Komunikat zwracany przy każdym odrzuceniu tokenu odświeżającego. */
const REFRESH_FAILED_MESSAGE = 'Sesja wygasła. Zaloguj się ponownie.';

/**
 * Ile sekund po rotacji zużyty token jest jeszcze traktowany jako wyścig, nie kradzież
 * ([09 §3.3](../../../../../../plans/09-security-auth.md#33-rotacja-refresh-tokenów)).
 *
 * Każde wejście na stronę odtwarza sesję jednym `POST /auth/refresh`, więc dwie karty
 * otwarte naraz wysyłają dwa żądania z tym samym ciasteczkiem. Bez tego okna zwykłe
 * „otwórz w nowej karcie" wylogowywałoby ze wszystkich urządzeń.
 */
export const REFRESH_REUSE_GRACE_SECONDS = 10;

/**
 * Wymienia token odświeżający na nowy wraz z nowym access tokenem
 * ([09 §3.3](../../../../../../plans/09-security-auth.md#33-rotacja-refresh-tokenów)).
 *
 * ## Rotacja i wykrycie ponownego użycia
 *
 * Każde odświeżenie **zużywa** token: stary wiersz dostaje `revoked_at`, a obok powstaje
 * nowy z tym samym `family_id`. Token zużyty zostaje w bazie właśnie po to, żeby dało
 * się rozpoznać jego ponowne użycie.
 *
 * Gdy ktoś przychodzi z tokenem już zużytym, znaczy to, że **tym samym tokenem
 * posłużyły się dwa urządzenia** — jedno z nich jest napastnikiem, a nie wiadomo które.
 * Dlatego unieważniamy **wszystkie** sesje użytkownika i zapisujemy zdarzenie: lepiej
 * wylogować właściciela, niż zostawić złodzieja zalogowanym.
 *
 * Nowy token dziedziczy `expires_at` rodziny, a nie dostaje nowych trzydziestu dni:
 * inaczej skradziona sesja odświeżana w kółko żyłaby wiecznie.
 *
 * @param handle - Uchwyt bazy.
 * @param config - Konfiguracja aplikacji.
 * @param clock - Źródło czasu.
 * @param input - Token z ciasteczka i kontekst żądania.
 * @param log - Wywoływane przy wykryciu ponownego użycia.
 * @returns Nowa odpowiedź logowania i nowy token odświeżający.
 * @throws {UnauthorizedError} Gdy token jest nieznany, wygasły albo zużyty.
 */
export async function refreshSession(
  handle: DbHandle,
  config: Config,
  clock: Clock,
  input: RefreshInput,
  log?: (event: { familyId: string; userId: string; revoked: number }) => void,
): Promise<LoginResult> {
  const now = clock.now();
  const nowMs = now.getTime();
  const presented = findSessionByTokenHash(handle, sha256Hex(input.refreshToken));

  if (presented === undefined) {
    throw new UnauthorizedError(REFRESH_FAILED_MESSAGE);
  }

  if (presented.revokedAt !== null) {
    const raced =
      nowMs - presented.revokedAt <= REFRESH_REUSE_GRACE_SECONDS * 1000 &&
      hasLiveSessionInFamily(handle, presented.familyId, nowMs);

    if (!raced) {
      // Ponowne użycie zużytego tokenu — sygnał kradzieży ciasteczka.
      const revoked = revokeAllSessionsForUser(handle, presented.userId, nowMs);
      log?.({ familyId: presented.familyId, userId: presented.userId, revoked });
      throw new UnauthorizedError(REFRESH_FAILED_MESSAGE);
    }

    // Wyścig dwóch kart otwartych naraz, nie kradzież. Spóźniona karta dostaje
    // **sam access token** — bez rotacji i bez nowego ciasteczka, bo zwycięzca wyścigu
    // zdążył już podmienić to wspólne dla całej przeglądarki.
    return issueForRace(handle, config, presented, now);
  }

  if (presented.expiresAt <= nowMs) {
    throw new UnauthorizedError(REFRESH_FAILED_MESSAGE);
  }

  const user = findUserById(handle, presented.userId);
  const household = user === undefined ? undefined : findHouseholdById(handle, user.householdId);
  if (user === undefined || household === undefined || !user.isActive) {
    // Konto wyłączone po zalogowaniu nie może dalej odświeżać sesji.
    revokeAllSessionsForUser(handle, presented.userId, nowMs);
    throw new UnauthorizedError(REFRESH_FAILED_MESSAGE);
  }

  revokeSession(handle, presented.id, nowMs);

  const { token: refreshToken, hash: refreshTokenHash } = createRefreshToken();
  insertSession(handle, {
    id: newId(),
    userId: user.id,
    familyId: presented.familyId,
    refreshTokenHash,
    deviceLabel: presented.deviceLabel,
    userAgent: input.userAgent ?? presented.userAgent,
    ipHash:
      input.ip === undefined ? presented.ipHash : hashWithSalt(input.ip, config.auth.ipHashSalt),
    // Rodzina zachowuje swój termin ważności — patrz opis wyżej.
    expiresAt: presented.expiresAt,
    createdAt: nowMs,
    lastUsedAt: nowMs,
  });

  const accessToken = await signAccessToken(
    config,
    // `sid` to identyfikator rodziny, nie wiersza: dzięki temu nie zmienia się
    // przy każdym odświeżeniu (03 §3.3).
    { sub: user.id, hid: user.householdId, sid: presented.familyId },
    now,
  );

  return {
    response: {
      accessToken,
      expiresIn: config.auth.accessTokenTtlSeconds,
      user: toUserDto(user),
      household: toHouseholdDto(household),
    },
    refreshToken,
  };
}

/**
 * Wylogowuje urządzenie, usuwając całą rodzinę jego tokenów.
 *
 * Nie rzuca przy nieznanym tokenie: wylogowanie ma być **idempotentne**, a odmowa
 * w odpowiedzi na „chcę wyjść" nie ma sensownej obsługi po stronie klienta.
 *
 * @param handle - Uchwyt bazy.
 * @param refreshToken - Token z ciasteczka; brak oznacza, że nie ma czego usuwać.
 * @returns Liczba usuniętych wierszy.
 */
export function logout(handle: DbHandle, refreshToken: string | undefined): number {
  if (refreshToken === undefined || refreshToken === '') return 0;
  const session = findSessionByTokenHash(handle, sha256Hex(refreshToken));
  if (session === undefined) return 0;
  return deleteSessionFamily(handle, session.familyId);
}

/** Po ilu dniach od unieważnienia wiersz sesji przestaje być potrzebny. */
export const REVOKED_SESSION_RETENTION_DAYS = 7;

/**
 * Usuwa wiersze sesji, które już do niczego nie służą.
 *
 * Wiersze unieważnione znikają **z opóźnieniem**: to na nich opiera się wykrycie
 * ponownego użycia, więc skasowanie ich od razu po rotacji zabrałoby całą pamięć
 * o kradzieży. Tydzień z okładką wystarcza — skradzione ciasteczko jest wykorzystywane
 * w godzinach, nie w miesiącach.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @returns Liczba usuniętych wierszy.
 */
export function pruneDeadSessions(handle: DbHandle, clock: Clock): number {
  const nowMs = clock.now().getTime();
  const revokedBefore = nowMs - REVOKED_SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return deleteDeadSessions(handle, nowMs, revokedBefore);
}

/**
 * Czy użytkownik należy do gospodarstwa.
 *
 * Dla innych modułów, które przyjmują identyfikator osoby w ciele żądania (np. właściciel
 * źródła przychodu) — tabela `users` należy do tego modułu (02 §3, reguła 4). Użytkownik
 * wyłączony też się liczy: jego pensja pozostaje jego pensją w historii.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Identyfikator osoby z żądania.
 * @returns `true`, gdy osoba istnieje i należy do gospodarstwa.
 */
export function isHouseholdMember(handle: DbHandle, householdId: string, userId: string): boolean {
  return findUserById(handle, userId)?.householdId === householdId;
}

/**
 * Zwraca ustawienia gospodarstwa: strefę czasową, dzień startu miesiąca, limity.
 *
 * Inne moduły potrzebują ich do wyznaczenia „dziś" i granic miesiąca (07 §1), a tabela
 * `households` należy do tego modułu — więc sięgają tu, przez serwis, a nie do
 * repozytorium (02 §3, reguła 4).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Ustawienia gospodarstwa.
 * @throws {UnauthorizedError} Gdy gospodarstwa z tokenu nie ma w bazie.
 */
export function getHousehold(handle: DbHandle, householdId: string): HouseholdDto {
  const household = findHouseholdById(handle, householdId);
  // Token jest podpisany, więc brak gospodarstwa znaczy bazę postawioną od nowa pod
  // starym tokenem — to wygasła sesja, a nie „nie znaleziono zasobu".
  if (household === undefined) throw new UnauthorizedError('Sesja wygasła. Zaloguj się ponownie.');
  return toHouseholdDto(household);
}

/**
 * Zwraca profil zalogowanego użytkownika wraz z gospodarstwem.
 *
 * `householdId` **nie jest** argumentem: bierze się z wiersza użytkownika, a ten
 * odnajdujemy po `userId` z tokenu. Gdyby przychodził z zewnątrz, trasa pozwalałaby
 * zajrzeć do cudzego gospodarstwa przez podmianę parametru.
 *
 * @param handle - Uchwyt bazy.
 * @param userId - Identyfikator użytkownika z tokenu.
 * @returns Profil i ustawienia gospodarstwa.
 * @throws {UnauthorizedError} Gdy użytkownika już nie ma albo jest wyłączony.
 */
export function me(handle: DbHandle, userId: string): MeResponse {
  const user = findUserById(handle, userId);
  const household = user === undefined ? undefined : findHouseholdById(handle, user.householdId);
  if (user === undefined || household === undefined || !user.isActive) {
    throw new UnauthorizedError('Sesja wygasła. Zaloguj się ponownie.');
  }
  return { user: toUserDto(user), household: toHouseholdDto(household) };
}

/**
 * Wypisuje aktywne urządzenia użytkownika
 * ([09 §3.5](../../../../../../plans/09-security-auth.md#35-zarządzanie-sesjami)).
 *
 * @param handle - Uchwyt bazy.
 * @param config - Konfiguracja (sól do hasha IP).
 * @param clock - Źródło czasu.
 * @param context - Kontekst bieżącego żądania.
 * @param context.userId - Identyfikator użytkownika z tokenu.
 * @param context.sessionId - Rodzina, z której idzie żądanie.
 * @param context.ip - Adres IP bieżącego żądania.
 * @returns Lista urządzeń, od ostatnio używanego.
 */
export function listSessions(
  handle: DbHandle,
  config: Config,
  clock: Clock,
  context: { userId: string; sessionId: string; ip?: string },
): SessionDto[] {
  const currentIpHash =
    context.ip === undefined ? null : hashWithSalt(context.ip, config.auth.ipHashSalt);
  return findLiveSessions(handle, context.userId, clock.now().getTime()).map((row) =>
    toSessionDto(row, context.sessionId, currentIpHash),
  );
}

/**
 * Unieważnia wskazane urządzenie.
 *
 * Rodzina spoza gospodarstwa wołającego daje `404`, nie `403` — nie potwierdzamy
 * istnienia cudzych sesji ([09 §4](../../../../../../plans/09-security-auth.md#4-autoryzacja)).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param userId - Identyfikator użytkownika z tokenu.
 * @param familyId - Identyfikator urządzenia z listy.
 * @returns Liczba usuniętych wierszy.
 * @throws {NotFoundError} Gdy urządzenia nie ma albo należy do kogoś innego.
 */
export function revokeSessionFamily(
  handle: DbHandle,
  clock: Clock,
  userId: string,
  familyId: string,
): number {
  if (!isLiveFamilyOfUser(handle, userId, familyId, clock.now().getTime())) {
    throw new NotFoundError('Nie znaleziono takiej sesji.');
  }
  return deleteSessionFamily(handle, familyId);
}

/**
 * Wylogowuje ze wszystkich urządzeń poza bieżącym.
 *
 * @param handle - Uchwyt bazy.
 * @param userId - Identyfikator użytkownika z tokenu.
 * @param keepFamilyId - Rodzina, która ma zostać; `undefined` wylogowuje wszędzie.
 * @returns Liczba usuniętych wierszy.
 */
export function logoutOthers(handle: DbHandle, userId: string, keepFamilyId?: string): number {
  return deleteOtherFamilies(handle, userId, keepFamilyId);
}

/**
 * Zmienia PIN.
 *
 * Wymaga podania obecnego PIN-u: samo posiadanie ważnego access tokenu nie wystarcza,
 * bo token mógł zostać wykradziony, a zmiana PIN-u odcina prawowitego właściciela.
 *
 * Po zmianie **unieważniane są wszystkie sesje poza bieżącą**
 * ([09 §3.5](../../../../../../plans/09-security-auth.md#35-zarządzanie-sesjami)):
 * jeśli PIN był zmieniany dlatego, że ktoś obcy się zalogował, to właśnie ten ruch
 * go wyprasza.
 *
 * @param handle - Uchwyt bazy.
 * @param config - Konfiguracja aplikacji.
 * @param clock - Źródło czasu.
 * @param context - Kontekst żądania.
 * @param context.userId - Identyfikator użytkownika z tokenu.
 * @param context.sessionId - Rodzina, z której idzie żądanie.
 * @param input - Obecny i nowy PIN.
 * @param input.currentPin - PIN obecny.
 * @param input.newPin - PIN nowy.
 * @returns Liczba wylogowanych urządzeń.
 * @throws {UnauthorizedError} Gdy obecny PIN się nie zgadza.
 * @throws {ValidationError} Gdy nowy PIN łamie reguły z `09 §2.3`.
 */
export async function changePin(
  handle: DbHandle,
  config: Config,
  clock: Clock,
  context: { userId: string; sessionId: string },
  input: { currentPin: string; newPin: string },
): Promise<number> {
  const user = findUserById(handle, context.userId);
  if (user === undefined || !user.isActive) {
    throw new UnauthorizedError('Sesja wygasła. Zaloguj się ponownie.');
  }

  if (!(await verifyPin(user.pinHash, input.currentPin))) {
    throw new UnauthorizedError('Obecny PIN się nie zgadza.');
  }

  const { pinMinLength, pinMaxLength } = config.auth;
  const check = checkPin(input.newPin, pinMinLength, pinMaxLength);
  if (!check.ok) {
    throw new ValidationError(check.message, [{ path: 'newPin', message: check.message }]);
  }

  if (input.newPin === input.currentPin) {
    const message = 'Nowy PIN musi różnić się od obecnego.';
    throw new ValidationError(message, [{ path: 'newPin', message }]);
  }

  updatePinHash(handle, user.id, await hashPin(input.newPin), clock.now().getTime());
  return deleteOtherFamilies(handle, user.id, context.sessionId);
}

/**
 * Potwierdza tożsamość PIN-em przed operacją nieodwracalną (usunięcie danych, ADR-072).
 *
 * Ta sama zasada co przy zmianie PIN-u: ważny token nie wystarcza, bo mógł zostać
 * wykradziony, a skutków nie da się cofnąć.
 *
 * @param handle - Uchwyt bazy.
 * @param userId - Użytkownik z tokenu.
 * @param pin - PIN podany w żądaniu.
 * @throws {UnauthorizedError} Gdy konta nie ma, jest wyłączone albo PIN się nie zgadza.
 */
export async function confirmPin(handle: DbHandle, userId: string, pin: string): Promise<void> {
  const user = findUserById(handle, userId);
  if (user === undefined || !user.isActive) {
    throw new UnauthorizedError('Sesja wygasła. Zaloguj się ponownie.');
  }
  if (!(await verifyPin(user.pinHash, pin))) {
    throw new UnauthorizedError('PIN się nie zgadza.');
  }
}

/**
 * Wydaje sam access token spóźnionej karcie, bez rotacji.
 *
 * Wywoływane wyłącznie w oknie tolerancji z {@link REFRESH_REUSE_GRACE_SECONDS}.
 * Ciasteczka **nie ruszamy**: jest wspólne dla całej przeglądarki i zwycięzca wyścigu
 * zdążył już zapisać w nim swój token. Gdyby spóźniona karta też rotowała, rodzina
 * miałaby dwa żywe wiersze i urządzenie pojawiłoby się dwa razy na liście sesji.
 *
 * @param handle - Uchwyt bazy.
 * @param config - Konfiguracja aplikacji.
 * @param presented - Wiersz zużytego tokenu.
 * @param presented.userId - Właściciel sesji.
 * @param presented.familyId - Rodzina, czyli urządzenie.
 * @param now - Chwila bieżąca.
 * @returns Odpowiedź logowania; `refreshToken` jest pusty, bo nie ustawiamy ciasteczka.
 * @throws {UnauthorizedError} Gdy konto zniknęło albo zostało wyłączone.
 */
async function issueForRace(
  handle: DbHandle,
  config: Config,
  presented: { userId: string; familyId: string },
  now: Date,
): Promise<LoginResult> {
  const user = findUserById(handle, presented.userId);
  const household = user === undefined ? undefined : findHouseholdById(handle, user.householdId);
  if (user === undefined || household === undefined || !user.isActive) {
    throw new UnauthorizedError(REFRESH_FAILED_MESSAGE);
  }

  const accessToken = await signAccessToken(
    config,
    { sub: user.id, hid: user.householdId, sid: presented.familyId },
    now,
  );

  return {
    response: {
      accessToken,
      expiresIn: config.auth.accessTokenTtlSeconds,
      user: toUserDto(user),
      household: toHouseholdDto(household),
    },
    // Pusty napis znaczy „nie ustawiaj ciasteczka" — patrz obsługa trasy.
    refreshToken: '',
  };
}

/**
 * Zmienia ustawienia gospodarstwa — `PATCH /settings/household`.
 *
 * Tabela `households` należy do tego modułu, więc zapis idzie tędy, a moduł ustawień
 * woła tę funkcję (02 §3, reguła 4). Zmiana limitu wstecz niczego nie przelicza:
 * przesuwa tylko granicę zamkniętych miesięcy, liczoną przy każdym zapisie (07 §1.4).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Zwalidowane zmiany.
 * @returns Ustawienia po zmianie.
 * @throws {UnauthorizedError} Gdy gospodarstwa z tokenu nie ma w bazie.
 */
export function updateHouseholdSettings(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  input: UpdateHouseholdRequest,
): HouseholdDto {
  getHousehold(handle, householdId);
  updateHousehold(handle, householdId, input, clock.now().getTime());
  return getHousehold(handle, householdId);
}

/**
 * Zmienia profil zalogowanej osoby — `PATCH /settings/profile`.
 *
 * Tylko własny: identyfikator bierze się z tokenu, więc drugi domownik nie może
 * przemianować pierwszego.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param context - Kontekst z tokenu.
 * @param context.householdId - Gospodarstwo z tokenu.
 * @param context.userId - Użytkownik z tokenu.
 * @param input - Zwalidowane zmiany.
 * @returns Profil po zmianie.
 * @throws {UnauthorizedError} Gdy użytkownika już nie ma albo jest wyłączony.
 */
export function updateProfile(
  handle: DbHandle,
  clock: Clock,
  context: { householdId: string; userId: string },
  input: UpdateProfileRequest,
): UserDto {
  me(handle, context.userId);
  updateUserProfile(handle, context.householdId, context.userId, input, clock.now().getTime());
  return me(handle, context.userId).user;
}

/**
 * Wypisuje aktywnych domowników — zalogowana osoba pierwsza.
 *
 * Zamyka też lukę `Z-15`: formularz źródła przychodu potrzebuje listy osób, a `/auth/me`
 * zwraca tylko zalogowaną.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param currentUserId - Użytkownik z tokenu.
 * @returns Domownicy.
 */
export function listMembers(
  handle: DbHandle,
  householdId: string,
  currentUserId: string,
): HouseholdMemberDto[] {
  const members = findActiveUsers(handle, householdId).map((row) =>
    toMemberDto(row, currentUserId),
  );
  return [...members.filter((m) => m.isCurrent), ...members.filter((m) => !m.isCurrent)];
}

/**
 * Wypisuje użytkowników do pliku eksportu — także wyłączonych, bez hashy PIN-ów.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Użytkownicy w kształcie eksportu.
 */
export function listExportUsers(handle: DbHandle, householdId: string): ExportDto['users'] {
  return findAllUsers(handle, householdId).map(toExportUser);
}
