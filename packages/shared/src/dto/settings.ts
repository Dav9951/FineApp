import { z } from 'zod';

import { HexColorSchema, IdSchema, MonthKeySchema, TimestampSchema } from '../domain/primitives.js';
import { HouseholdDtoSchema, PinSchema } from './auth.js';

/**
 * Kontrakty ustawień — `/api/v1/settings`
 * ([05 §13a](../../../../plans/05-dto-contracts.md#13a-ustawienia--dtosettingsts)).
 *
 * Waluta i język gospodarstwa są tylko do odczytu (ADR-007: jedna waluta w v1), a dzień
 * startu miesiąca przyjmuje wyłącznie `1` (ADR-006) — pole istnieje w kontrakcie, żeby
 * dołożenie innych wartości nie zmieniało kształtu żądania.
 */

/**
 * Czy napis jest nazwą strefy czasowej IANA znaną środowisku.
 *
 * Sprawdzamy konstruktorem `Intl.DateTimeFormat`, a nie listą: lista z
 * `Intl.supportedValuesOf` różni się między przeglądarką a Node (aliasy w rodzaju
 * `Europe/Kiev` ↔ `Europe/Kyiv`), a konstruktor przyjmuje oba warianty tam, gdzie
 * obliczenia dat i tak je zrozumieją.
 *
 * @param value - Kandydat na strefę.
 * @returns `true`, gdy strefa jest rozpoznawana.
 */
export function isValidTimeZone(value: string): boolean {
  if (value.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Nazwa strefy czasowej IANA, np. `Europe/Warsaw`. */
export const TimeZoneSchema = z.string().trim().refine(isValidTimeZone, 'Nieznana strefa czasowa');

/** Domownik na liście w ustawieniach — bez adresu IP, PIN-u i sesji. */
export const HouseholdMemberDtoSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  displayName: z.string(),
  avatarColor: HexColorSchema.nullable(),
  /** Czy to zalogowana osoba — tylko ona może zmienić swój profil i PIN. */
  isCurrent: z.boolean(),
  lastLoginAt: TimestampSchema.nullable(),
});
/** Domownik. */
export type HouseholdMemberDto = z.infer<typeof HouseholdMemberDtoSchema>;

/** Ustawienia gospodarstwa razem z domownikami — `GET /settings`. */
export const SettingsDtoSchema = z.object({
  household: HouseholdDtoSchema,
  /** Aktywni domownicy, najpierw zalogowana osoba. */
  users: z.array(HouseholdMemberDtoSchema),
  /** Wersja aplikacji — sekcja „O aplikacji". */
  appVersion: z.string(),
});
/** Ustawienia gospodarstwa. */
export type SettingsDto = z.infer<typeof SettingsDtoSchema>;

/** Najdłuższa nazwa gospodarstwa. */
export const HOUSEHOLD_NAME_MAX = 60;
/** Najdłuższa nazwa wyświetlana domownika. */
export const DISPLAY_NAME_MAX = 40;

/**
 * Zmiana ustawień gospodarstwa — `PATCH /settings/household`.
 *
 * `backPostingLimitMonths` przesuwa granicę zamkniętych miesięcy (07 §1.4): obniżenie
 * zamyka miesiące, podniesienie je otwiera. Zmiana nie przelicza żadnej kwoty, bo
 * `month_key` zależy od dnia startu miesiąca, nie od limitu.
 */
export const UpdateHouseholdRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Nazwa jest wymagana')
      .max(HOUSEHOLD_NAME_MAX, `Nazwa może mieć najwyżej ${String(HOUSEHOLD_NAME_MAX)} znaków`),
    timezone: TimeZoneSchema,
    backPostingLimitMonths: z
      .number()
      .int()
      .min(0, 'Limit nie może być ujemny')
      .max(12, 'Limit może wynosić najwyżej 12 miesięcy'),
    /** W v1 wyłącznie `1` — miesiąc kalendarzowy (ADR-006). */
    monthStartDay: z.literal(1, {
      errorMap: () => ({ message: 'W tej wersji miesiąc zaczyna się zawsze 1. dnia' }),
    }),
    /** Konto proponowane przy wydatkach i skanie; `null` usuwa wybór (ADR-070). */
    defaultExpenseAccountId: IdSchema.nullable(),
  })
  .partial();
/** Zmiana ustawień gospodarstwa po walidacji. */
export type UpdateHouseholdRequest = z.infer<typeof UpdateHouseholdRequestSchema>;

/** Zmiana własnego profilu — `PATCH /settings/profile`. */
export const UpdateProfileRequestSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, 'Nazwa jest wymagana')
      .max(DISPLAY_NAME_MAX, `Nazwa może mieć najwyżej ${String(DISPLAY_NAME_MAX)} znaków`),
    /** `null` = kolor domyślny. */
    avatarColor: HexColorSchema.nullable(),
  })
  .partial();
/** Zmiana profilu po walidacji. */
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

/** Identyfikator formatu pliku eksportu — pozwala rozpoznać plik przy przyszłym imporcie. */
export const EXPORT_FORMAT = 'fineapp-export';
/** Wersja formatu eksportu; rośnie przy zmianie kształtu pliku, nie schematu bazy. */
export const EXPORT_VERSION = 1;

/**
 * Tabele w eksporcie JSON, w kolejności zależności kluczy obcych.
 *
 * Kolejność ma znaczenie dla przyszłego importu: wiersze wstawiane w tej kolejności nie
 * naruszają żadnego klucza obcego poza cyklicznymi (transakcja ↔ wystąpienie), które
 * import i tak musi odroczyć.
 */
export const EXPORT_TABLES = [
  'accounts',
  'categories',
  'incomeSources',
  'goals',
  'liabilities',
  'allocationTargets',
  'recurringRules',
  'recurringOccurrences',
  'plannedExpenses',
  'documents',
  'documentItems',
  'budgetDrafts',
  'budgetDraftGroups',
  'budgetDraftLines',
  'transactions',
] as const;
/** Nazwa tabeli w eksporcie. */
export type ExportTable = (typeof EXPORT_TABLES)[number];

/** Wiersz tabeli w eksporcie — pola w `camelCase`, kwoty w groszach, czas w ms. */
export const ExportRecordSchema = z.record(z.string(), z.unknown());

/**
 * Pełny eksport gospodarstwa — `GET /settings/export`.
 *
 * To **kopia użytkownika**, nie kopia zapasowa serwera: nie ma w niej sesji, prób
 * logowania, kluczy idempotencji, hashy PIN-ów ani plików zdjęć. Transakcje z kosza są
 * pominięte, bo po 30 dniach i tak znikają (07 §10).
 */
export const ExportDtoSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: TimestampSchema,
  appVersion: z.string(),
  household: HouseholdDtoSchema,
  users: z.array(
    z.object({
      id: IdSchema,
      email: z.string().email(),
      displayName: z.string(),
      avatarColor: HexColorSchema.nullable(),
      isActive: z.boolean(),
      createdAt: TimestampSchema,
    }),
  ),
  tables: z.object(
    Object.fromEntries(EXPORT_TABLES.map((table) => [table, z.array(ExportRecordSchema)])) as {
      [K in ExportTable]: z.ZodArray<typeof ExportRecordSchema>;
    },
  ),
});
/** Pełny eksport gospodarstwa. */
export type ExportDto = z.infer<typeof ExportDtoSchema>;

/** `?month=RRRR-MM` — pominięty: wszystkie transakcje. */
export const ExportCsvQuerySchema = z.object({
  month: MonthKeySchema.optional(),
});
/** Parametry eksportu CSV po walidacji. */
export type ExportCsvQuery = z.infer<typeof ExportCsvQuerySchema>;

/**
 * Nazwa pliku eksportu.
 *
 * @param kind - `json` albo `csv`.
 * @param stamp - Data eksportu `RRRR-MM-DD` albo klucz miesiąca przy CSV jednego miesiąca.
 * @returns Nazwa pliku, np. `fineapp-2026-09.csv`.
 */
export function exportFileName(kind: 'json' | 'csv', stamp: string): string {
  return `fineapp-${stamp}.${kind}`;
}

/**
 * Usunięcie wszystkich danych gospodarstwa — `POST /settings/reset`
 * ([ADR-072](../../../../plans/14-decisions-log.md#adr-072)).
 *
 * Wymaga PIN-u zalogowanej osoby z tego samego powodu co zmiana PIN-u: sam token mógł
 * zostać wykradziony, a operacja jest nieodwracalna.
 */
export const ResetDataRequestSchema = z.object({
  pin: PinSchema,
});
/** Żądanie usunięcia danych po walidacji. */
export type ResetDataRequest = z.infer<typeof ResetDataRequestSchema>;

/**
 * Wynik usunięcia danych — liczba usuniętych wierszy w każdej tabeli eksportu.
 *
 * Te same nazwy co w `EXPORT_TABLES`: usuwane jest dokładnie to, co trafia do eksportu
 * (plus kosz), poza kategoriami systemowymi, które zostają.
 */
export const ResetDataResultSchema = z.object({
  deleted: z.object(
    Object.fromEntries(EXPORT_TABLES.map((table) => [table, z.number().int().nonnegative()])) as {
      [K in ExportTable]: z.ZodNumber;
    },
  ),
});
/** Wynik usunięcia danych. */
export type ResetDataResult = z.infer<typeof ResetDataResultSchema>;
