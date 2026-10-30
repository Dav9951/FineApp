import { and, desc, eq, gte, isNull, ne, or, sql } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import { households, type HouseholdRow } from '../../db/schema/households.js';
import {
  authAttempts,
  authSessions,
  users,
  type AuthSessionRow,
  type UserInsert,
  type UserRow,
} from '../../db/schema/users.js';
import type { AttemptRecord } from './auth.attempts.js';

/**
 * Zapytania modułu uwierzytelniania.
 *
 * ## Dlaczego tu nie ma `householdId` jako pierwszego argumentu
 *
 * Reguła 4 z `CLAUDE.md` („`householdId` zawsze z tokenu, pierwszy argument każdej
 * metody repozytorium") dotyczy danych **należących do gospodarstwa**. Ten moduł
 * gospodarstwo dopiero **ustala**: przy logowaniu nie ma jeszcze tokenu, a adres e-mail
 * jest unikalny globalnie. Gdyby wyszukiwanie po adresie wymagało `householdId`,
 * trzeba by go zgadywać z ciała żądania — czyli zrobić dokładnie to, czego reguła
 * zabrania. Metody, które **dostają** `householdId`, mają go na pierwszym miejscu.
 *
 * Repozytorium nie zna HTTP i nie rzuca błędów ze statusem
 * ([02 §3](../../../../../../plans/02-architecture.md#3-warstwy-i-kierunek-zależności)).
 */

/** Dane potrzebne do założenia użytkownika. */
export type NewUser = Omit<UserInsert, 'createdAt' | 'updatedAt'> & {
  createdAt: number;
  updatedAt: number;
};

/**
 * Znajduje użytkownika po znormalizowanym adresie e-mail.
 *
 * Zwraca też konta nieaktywne — o tym, czy wolno się zalogować, decyduje serwis,
 * a nie zapytanie.
 *
 * @param handle - Uchwyt bazy.
 * @param email - Adres znormalizowany do małych liter.
 * @returns Wiersz użytkownika albo `undefined`.
 */
export function findUserByEmail(handle: DbHandle, email: string): UserRow | undefined {
  return handle.db.select().from(users).where(eq(users.email, email)).get();
}

/**
 * Znajduje użytkownika po identyfikatorze.
 *
 * @param handle - Uchwyt bazy.
 * @param userId - Identyfikator użytkownika.
 * @returns Wiersz użytkownika albo `undefined`.
 */
export function findUserById(handle: DbHandle, userId: string): UserRow | undefined {
  return handle.db.select().from(users).where(eq(users.id, userId)).get();
}

/**
 * Liczy aktywnych użytkowników gospodarstwa.
 *
 * Podstawa limitu dwóch kont z [09 §10](../../../../../../plans/09-security-auth.md#10-zakładanie-użytkowników).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Liczba aktywnych użytkowników.
 */
export function countActiveUsers(handle: DbHandle, householdId: string): number {
  const row = handle.db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.householdId, householdId), eq(users.isActive, true)))
    .get();
  return row?.count ?? 0;
}

/**
 * Zapisuje nowego użytkownika.
 *
 * @param handle - Uchwyt bazy.
 * @param user - Komplet danych użytkownika wraz z hashem PIN-u.
 * @returns Zapisany wiersz.
 */
export function insertUser(handle: DbHandle, user: NewUser): UserRow {
  return handle.db.insert(users).values(user).returning().get();
}

/**
 * Znajduje gospodarstwo po identyfikatorze.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Wiersz gospodarstwa albo `undefined`.
 */
export function findHouseholdById(handle: DbHandle, householdId: string): HouseholdRow | undefined {
  return handle.db.select().from(households).where(eq(households.id, householdId)).get();
}

/**
 * Zapisuje znacznik ostatniego logowania.
 *
 * @param handle - Uchwyt bazy.
 * @param userId - Identyfikator użytkownika.
 * @param now - Chwila logowania w milisekundach epoki.
 */
export function touchLastLogin(handle: DbHandle, userId: string, now: number): void {
  handle.db
    .update(users)
    .set({ lastLoginAt: now, updatedAt: now })
    .where(eq(users.id, userId))
    .run();
}

/**
 * Zapisuje próbę logowania.
 *
 * Zapisujemy **każdą** próbę, także dla adresów, które nie istnieją — inaczej sam fakt
 * pojawienia się blokady zdradzałby, które konta są prawdziwe
 * ([03 §3.2](../../../../../../plans/03-data-model.md#32-users)).
 *
 * @param handle - Uchwyt bazy.
 * @param attempt - Zapisywana próba.
 * @param attempt.emailHash - Hash znormalizowanego adresu.
 * @param attempt.ipHash - Hash adresu IP albo `null`.
 * @param attempt.succeeded - Czy próba się powiodła.
 * @param attempt.createdAt - Chwila próby w milisekundach epoki.
 */
export function insertAttempt(
  handle: DbHandle,
  attempt: { emailHash: string; ipHash: string | null; succeeded: boolean; createdAt: number },
): void {
  handle.db.insert(authAttempts).values(attempt).run();
}

/**
 * Czyta próby logowania z okna obserwacji.
 *
 * Jedno zapytanie na oba zakresy (adres i IP), bo bramka i tak potrzebuje obu naraz,
 * a dwa zapytania po tym samym indeksie czasu to dwa razy ten sam skan.
 *
 * @param handle - Uchwyt bazy.
 * @param emailHash - Hash adresu.
 * @param ipHash - Hash adresu IP albo `null`.
 * @param since - Początek okna w milisekundach epoki.
 * @returns Próby z podziałem na zakresy.
 */
export function findRecentAttempts(
  handle: DbHandle,
  emailHash: string,
  ipHash: string | null,
  since: number,
): { email: AttemptRecord[]; ip: AttemptRecord[] } {
  const rows = handle.db
    .select({
      emailHash: authAttempts.emailHash,
      ipHash: authAttempts.ipHash,
      succeeded: authAttempts.succeeded,
      createdAt: authAttempts.createdAt,
    })
    .from(authAttempts)
    .where(
      and(
        gte(authAttempts.createdAt, since),
        ipHash === null
          ? eq(authAttempts.emailHash, emailHash)
          : or(eq(authAttempts.emailHash, emailHash), eq(authAttempts.ipHash, ipHash)),
      ),
    )
    .all();

  return {
    email: rows
      .filter((row) => row.emailHash === emailHash)
      .map((row) => ({ succeeded: row.succeeded, createdAt: row.createdAt })),
    ip:
      ipHash === null
        ? []
        : rows
            .filter((row) => row.ipHash === ipHash)
            .map((row) => ({ succeeded: row.succeeded, createdAt: row.createdAt })),
  };
}

/**
 * Usuwa próby starsze niż podana chwila.
 *
 * Wołane przy starcie aplikacji ([03 §3.4](../../../../../../plans/03-data-model.md#34-auth_attempts)).
 *
 * @param handle - Uchwyt bazy.
 * @param before - Granica w milisekundach epoki.
 * @returns Liczba usuniętych wierszy.
 */
export function deleteAttemptsBefore(handle: DbHandle, before: number): number {
  const result = handle.db
    .delete(authAttempts)
    .where(sql`${authAttempts.createdAt} < ${before}`)
    .run();
  return result.changes;
}

/** Dane nowej sesji. */
export interface NewSession {
  id: string;
  userId: string;
  /** Urządzenie; pierwszy wiersz rodziny ma `familyId` równe własnemu `id`. */
  familyId: string;
  refreshTokenHash: string;
  deviceLabel: string | null;
  userAgent: string | null;
  ipHash: string | null;
  expiresAt: number;
  createdAt: number;
  lastUsedAt: number;
}

/**
 * Zakłada sesję odświeżającą.
 *
 * W bazie ląduje **hash** tokenu; surowy token żyje wyłącznie w ciasteczku, więc wyciek
 * bazy nie daje napastnikowi ważnych sesji ([09 §3.1](../../../../../../plans/09-security-auth.md#31-podział-ról)).
 *
 * @param handle - Uchwyt bazy.
 * @param session - Dane sesji.
 * @returns Zapisany wiersz.
 */
export function insertSession(handle: DbHandle, session: NewSession): AuthSessionRow {
  return handle.db.insert(authSessions).values(session).returning().get();
}

/**
 * Znajduje wiersz sesji po hashu tokenu odświeżającego.
 *
 * Zwraca też wiersze **zużyte** (`revokedAt` ustawione) — to na nich opiera się wykrycie
 * ponownego użycia ([09 §3.3](../../../../../../plans/09-security-auth.md#33-rotacja-refresh-tokenów)).
 *
 * @param handle - Uchwyt bazy.
 * @param refreshTokenHash - Hash tokenu z ciasteczka.
 * @returns Wiersz sesji albo `undefined`.
 */
export function findSessionByTokenHash(
  handle: DbHandle,
  refreshTokenHash: string,
): AuthSessionRow | undefined {
  return handle.db
    .select()
    .from(authSessions)
    .where(eq(authSessions.refreshTokenHash, refreshTokenHash))
    .get();
}

/**
 * Sprawdza, czy rodzina ma nadal żywy wiersz.
 *
 * Podstawa odróżnienia **wyścigu dwóch kart** od kradzieży: przy wyścigu zwycięzca
 * zdążył już założyć nowy wiersz, więc rodzina żyje. Przy kradzieży wykrytej po czasie
 * żywego wiersza zwykle nie ma albo jest on i tak unieważniany.
 *
 * @param handle - Uchwyt bazy.
 * @param familyId - Identyfikator rodziny.
 * @param now - Chwila bieżąca w milisekundach epoki.
 * @returns `true`, gdy rodzina ma wiersz nieunieważniony i nieprzeterminowany.
 */
export function hasLiveSessionInFamily(handle: DbHandle, familyId: string, now: number): boolean {
  return (
    handle.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.familyId, familyId),
          isNull(authSessions.revokedAt),
          sql`${authSessions.expiresAt} > ${now}`,
        ),
      )
      .get() !== undefined
  );
}

/**
 * Unieważnia pojedynczy wiersz sesji.
 *
 * @param handle - Uchwyt bazy.
 * @param sessionId - Identyfikator wiersza.
 * @param now - Chwila unieważnienia.
 */
export function revokeSession(handle: DbHandle, sessionId: string, now: number): void {
  handle.db
    .update(authSessions)
    .set({ revokedAt: now })
    .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)))
    .run();
}

/**
 * Unieważnia **wszystkie** żywe sesje użytkownika.
 *
 * Wołane przy wykryciu ponownego użycia tokenu: skoro dwa urządzenia posłużyły się tym
 * samym tokenem, jedno z nich jest napastnikiem, a nie wiadomo które — więc wylogowujemy
 * oba ([09 §3.3](../../../../../../plans/09-security-auth.md#33-rotacja-refresh-tokenów)).
 *
 * @param handle - Uchwyt bazy.
 * @param userId - Identyfikator użytkownika.
 * @param now - Chwila unieważnienia.
 * @returns Liczba unieważnionych wierszy.
 */
export function revokeAllSessionsForUser(handle: DbHandle, userId: string, now: number): number {
  return handle.db
    .update(authSessions)
    .set({ revokedAt: now })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
    .run().changes;
}

/**
 * Usuwa całą rodzinę wierszy jednego urządzenia.
 *
 * Wylogowanie **usuwa**, a nie unieważnia: gdyby unieważniało, karta zostawiona otwarta
 * w tle wysłałaby po wylogowaniu swój stary token, zostałaby wzięta za kradzież
 * i wylogowała użytkownika z **pozostałych** urządzeń
 * ([03 §3.3](../../../../../../plans/03-data-model.md#33-auth_sessions)).
 *
 * @param handle - Uchwyt bazy.
 * @param familyId - Identyfikator rodziny.
 * @returns Liczba usuniętych wierszy.
 */
export function deleteSessionFamily(handle: DbHandle, familyId: string): number {
  return handle.db.delete(authSessions).where(eq(authSessions.familyId, familyId)).run().changes;
}

/**
 * Usuwa wiersze sesji, które już do niczego nie służą.
 *
 * Rotacja dokłada wiersz przy każdym odświeżeniu, więc tabela rośnie szybciej niż liczba
 * urządzeń. Kasujemy wiersze wygasłe oraz unieważnione dawniej niż `revokedBefore` —
 * te drugie z opóźnieniem, bo to na nich opiera się wykrycie ponownego użycia i usunięcie
 * ich od razu zabrałoby całą pamięć o kradzieży.
 *
 * @param handle - Uchwyt bazy.
 * @param now - Chwila bieżąca w milisekundach epoki.
 * @param revokedBefore - Granica dla wierszy unieważnionych.
 * @returns Liczba usuniętych wierszy.
 */
export function deleteDeadSessions(handle: DbHandle, now: number, revokedBefore: number): number {
  return handle.db
    .delete(authSessions)
    .where(
      or(
        sql`${authSessions.expiresAt} < ${now}`,
        sql`${authSessions.revokedAt} IS NOT NULL AND ${authSessions.revokedAt} < ${revokedBefore}`,
      ),
    )
    .run().changes;
}

/**
 * Zapisuje nowy hash PIN-u.
 *
 * @param handle - Uchwyt bazy.
 * @param userId - Identyfikator użytkownika.
 * @param pinHash - Nowy hash.
 * @param now - Znacznik czasu.
 */
export function updatePinHash(
  handle: DbHandle,
  userId: string,
  pinHash: string,
  now: number,
): void {
  handle.db
    .update(users)
    .set({ pinHash, pinUpdatedAt: now, updatedAt: now })
    .where(eq(users.id, userId))
    .run();
}

/** Żywa sesja wraz z chwilą, od której urządzenie jest zalogowane. */
export interface LiveSessionRow extends AuthSessionRow {
  /** Najstarszy `created_at` w rodzinie — czyli moment zalogowania urządzenia. */
  familyCreatedAt: number;
}

/**
 * Czyta żywe sesje użytkownika — po jednej na urządzenie.
 *
 * Rodzina ma w danej chwili najwyżej jeden wiersz bez `revoked_at`, więc filtr daje
 * dokładnie jedno urządzenie na wiersz. `created_at` tego wiersza to jednak moment
 * **ostatniej rotacji**, a nie zalogowania — dlatego podzapytanie dokłada najstarszy
 * `created_at` z całej rodziny.
 *
 * @param handle - Uchwyt bazy.
 * @param userId - Identyfikator użytkownika.
 * @param now - Chwila bieżąca w milisekundach epoki.
 * @returns Żywe sesje, od najnowszego użycia.
 */
export function findLiveSessions(handle: DbHandle, userId: string, now: number): LiveSessionRow[] {
  return handle.db
    .select({
      id: authSessions.id,
      userId: authSessions.userId,
      familyId: authSessions.familyId,
      refreshTokenHash: authSessions.refreshTokenHash,
      deviceLabel: authSessions.deviceLabel,
      userAgent: authSessions.userAgent,
      ipHash: authSessions.ipHash,
      expiresAt: authSessions.expiresAt,
      revokedAt: authSessions.revokedAt,
      lastUsedAt: authSessions.lastUsedAt,
      createdAt: authSessions.createdAt,
      familyCreatedAt: sql<number>`(
        SELECT MIN(f.created_at) FROM auth_sessions f WHERE f.family_id = ${authSessions.familyId}
      )`,
    })
    .from(authSessions)
    .where(
      and(
        eq(authSessions.userId, userId),
        isNull(authSessions.revokedAt),
        sql`${authSessions.expiresAt} > ${now}`,
      ),
    )
    .orderBy(desc(authSessions.lastUsedAt))
    .all();
}

/**
 * Usuwa rodziny sesji użytkownika poza wskazaną.
 *
 * Usuwa, a nie unieważnia — z tego samego powodu co wylogowanie
 * ([03 §3.3](../../../../../../plans/03-data-model.md#33-auth_sessions)): wiersz
 * unieważniony jest sygnałem kradzieży, a świadome wyproszenie innych urządzeń
 * kradzieżą nie jest.
 *
 * @param handle - Uchwyt bazy.
 * @param userId - Identyfikator użytkownika.
 * @param keepFamilyId - Rodzina, która ma zostać; `undefined` usuwa wszystkie.
 * @returns Liczba usuniętych wierszy.
 */
export function deleteOtherFamilies(
  handle: DbHandle,
  userId: string,
  keepFamilyId?: string,
): number {
  return handle.db
    .delete(authSessions)
    .where(
      keepFamilyId === undefined
        ? eq(authSessions.userId, userId)
        : and(eq(authSessions.userId, userId), ne(authSessions.familyId, keepFamilyId)),
    )
    .run().changes;
}

/**
 * Sprawdza, czy rodzina należy do użytkownika i jest żywa.
 *
 * @param handle - Uchwyt bazy.
 * @param userId - Identyfikator użytkownika.
 * @param familyId - Identyfikator rodziny.
 * @param now - Chwila bieżąca w milisekundach epoki.
 * @returns `true`, gdy rodzina istnieje, żyje i należy do tego użytkownika.
 */
export function isLiveFamilyOfUser(
  handle: DbHandle,
  userId: string,
  familyId: string,
  now: number,
): boolean {
  return (
    handle.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, userId),
          eq(authSessions.familyId, familyId),
          isNull(authSessions.revokedAt),
          sql`${authSessions.expiresAt} > ${now}`,
        ),
      )
      .get() !== undefined
  );
}

/** Pola gospodarstwa, które wolno zmienić z ustawień. */
export interface HouseholdChanges {
  name?: string;
  timezone?: string;
  backPostingLimitMonths?: number;
  monthStartDay?: number;
  defaultExpenseAccountId?: string | null;
}

/**
 * Zapisuje zmiany ustawień gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param changes - Pola do zmiany; puste — tylko `updated_at`.
 * @param now - Znacznik czasu.
 */
export function updateHousehold(
  handle: DbHandle,
  householdId: string,
  changes: HouseholdChanges,
  now: number,
): void {
  handle.db
    .update(households)
    .set({ ...changes, updatedAt: now })
    .where(eq(households.id, householdId))
    .run();
}

/** Pola profilu, które domownik zmienia sam. */
export interface ProfileChanges {
  displayName?: string;
  avatarColor?: string | null;
}

/**
 * Zapisuje zmiany profilu — tylko w obrębie gospodarstwa z tokenu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Użytkownik z tokenu.
 * @param changes - Pola do zmiany.
 * @param now - Znacznik czasu.
 */
export function updateUserProfile(
  handle: DbHandle,
  householdId: string,
  userId: string,
  changes: ProfileChanges,
  now: number,
): void {
  handle.db
    .update(users)
    .set({ ...changes, updatedAt: now })
    .where(and(eq(users.id, userId), eq(users.householdId, householdId)))
    .run();
}

/**
 * Czyta aktywnych domowników w kolejności założenia kont.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Wiersze aktywnych użytkowników.
 */
export function findActiveUsers(handle: DbHandle, householdId: string): UserRow[] {
  return handle.db
    .select()
    .from(users)
    .where(and(eq(users.householdId, householdId), eq(users.isActive, true)))
    .orderBy(users.createdAt, users.id)
    .all();
}

/**
 * Czyta wszystkich użytkowników gospodarstwa, także wyłączonych — do eksportu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Wiersze użytkowników.
 */
export function findAllUsers(handle: DbHandle, householdId: string): UserRow[] {
  return handle.db
    .select()
    .from(users)
    .where(eq(users.householdId, householdId))
    .orderBy(users.createdAt, users.id)
    .all();
}
