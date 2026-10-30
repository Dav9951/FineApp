import { z } from 'zod';

import { CurrencySchema, HexColorSchema, IdSchema, TimestampSchema } from '../domain/primitives.js';

/**
 * Kontrakty uwierzytelniania
 * ([05 §4](../../../../plans/05-dto-contracts.md#4-auth--dtoauthdtots)).
 *
 * Schematy powstają **przed** implementacją po obu stronach — dzięki temu backend
 * i front nie mogą rozjechać się w cichy sposób.
 *
 * Zakres długości PIN-u jest tu zapisany na sztywno jako 6–8 cyfr, bo to jest
 * **kontrakt sieciowy**. `PIN_MIN_LENGTH` / `PIN_MAX_LENGTH` mogą go po stronie serwera
 * tylko zawęzić; rozszerzenie wymagałoby zmiany tego pliku, czyli świadomej decyzji,
 * a nie zmiany zmiennej środowiskowej.
 */

/** Adres e-mail w postaci znormalizowanej — przycięty i małymi literami. */
export const EmailSchema = z.string().trim().toLowerCase().email('Nieprawidłowy adres e-mail');

/** PIN w postaci akceptowanej przez API. */
export const PinSchema = z.string().regex(/^\d{6,8}$/, 'PIN musi mieć od 6 do 8 cyfr');

/** Dane logowania: adres e-mail i PIN. */
export const LoginRequestSchema = z.object({
  email: EmailSchema,
  pin: PinSchema,
  deviceLabel: z.string().max(80).optional(),
});

/** Profil zalogowanego użytkownika. */
export const UserDtoSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  displayName: z.string(),
  avatarColor: HexColorSchema.nullable(),
  lastLoginAt: TimestampSchema.nullable(),
});

/** Ustawienia gospodarstwa zwracane po zalogowaniu. */
export const HouseholdDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  baseCurrency: CurrencySchema,
  timezone: z.string(),
  locale: z.string(),
  backPostingLimitMonths: z.number().int().min(0).max(12),
  monthStartDay: z.number().int().min(1).max(28),
  /** Konto proponowane przy wydatkach i skanie; `null` = brak (ADR-070). */
  defaultExpenseAccountId: IdSchema.nullable(),
});

/** Odpowiedź na udane logowanie. */
export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: UserDtoSchema,
  household: HouseholdDtoSchema,
});

/**
 * Odpowiedź na odświeżenie sesji — **ten sam kształt co logowanie**.
 *
 * Access token żyje wyłącznie w pamięci aplikacji, więc po odświeżeniu strony front
 * nie ma ani tokenu, ani profilu ([09 §3.1](../../../../plans/09-security-auth.md#31-podział-ról)).
 * Odświeżenie musi oddać komplet, inaczej aplikacja po `F5` wstawałaby pusta i musiała
 * dopytywać o profil osobnym żądaniem.
 */
export const RefreshResponseSchema = LoginResponseSchema;

/** Zmiana PIN-u wymaga potwierdzenia obecnego. */
export const ChangePinRequestSchema = z.object({
  currentPin: PinSchema,
  newPin: PinSchema,
});

/** Profil zalogowanego użytkownika wraz z gospodarstwem — `GET /auth/me`. */
export const MeResponseSchema = z.object({
  user: UserDtoSchema,
  household: HouseholdDtoSchema,
});

/**
 * Aktywna sesja na liście urządzeń
 * ([09 §3.5](../../../../plans/09-security-auth.md#35-zarządzanie-sesjami)).
 *
 * `sameDevice` zastępuje „przybliżoną lokalizację": z hasha IP nie da się odczytać
 * miejsca — można tylko porównać go z hashem bieżącego żądania. Dla użytkownika liczy
 * się i tak jedno pytanie: *czy to ja teraz, czy ktoś inny*.
 */
export const SessionDtoSchema = z.object({
  id: IdSchema,
  deviceLabel: z.string().nullable(),
  /** Czy to sesja, z której idzie bieżące żądanie. */
  current: z.boolean(),
  /** Czy adres IP zgadza się z adresem bieżącego żądania. */
  sameDevice: z.boolean(),
  lastUsedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
});

/** Potwierdzenie operacji, która nie zwraca danych. */
export const AuthAckSchema = z.object({
  /** Ile sesji zostało unieważnionych albo usuniętych. */
  affected: z.number().int().nonnegative(),
});

/** Dane logowania. */
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
/** Profil zalogowanego użytkownika. */
export type UserDto = z.infer<typeof UserDtoSchema>;
/** Ustawienia gospodarstwa. */
export type HouseholdDto = z.infer<typeof HouseholdDtoSchema>;
/** Odpowiedź na udane logowanie. */
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
/** Odpowiedź na odświeżenie sesji. */
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;
/** Żądanie zmiany PIN-u. */
export type ChangePinRequest = z.infer<typeof ChangePinRequestSchema>;
/** Profil zalogowanego użytkownika wraz z gospodarstwem. */
export type MeResponse = z.infer<typeof MeResponseSchema>;
/** Aktywna sesja na liście urządzeń. */
export type SessionDto = z.infer<typeof SessionDtoSchema>;
/** Potwierdzenie operacji bez danych. */
export type AuthAck = z.infer<typeof AuthAckSchema>;
