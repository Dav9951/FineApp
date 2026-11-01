import { z } from 'zod';

import { isValidDateOnly } from '../utils/month.js';

/**
 * Prymitywy domenowe — najmniejsze cegiełki kontraktu.
 *
 * Każdy schemat jest jednocześnie walidacją na serwerze, typem TypeScript po obu
 * stronach i walidacją formularza na froncie
 * ([05 §1](../../../../plans/05-dto-contracts.md)). Komunikaty są po polsku, bo trafiają
 * wprost pod pole formularza.
 */

/** Identyfikator zasobu — 26-znakowy ULID (Crockford base32, sortowalny czasowo). */
export const IdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Nieprawidłowy identyfikator');
/** Identyfikator zasobu. Dozwolone wartości ustala schemat powyżej. */
export type Id = z.infer<typeof IdSchema>;

/** Górny limit kwoty: miliard złotych w groszach. */
export const MAX_AMOUNT_MINOR = 100_000_000_000;

/**
 * Kwota w groszach.
 *
 * Zawsze liczba całkowita. Wartość ujemna jest dopuszczalna tylko tam, gdzie jawnie
 * opisuje różnicę (`deltaAmountMinor`, wykonanie alokacji liczone netto — ADR-011) —
 * nigdy jako kwota transakcji.
 */
export const AmountMinorSchema = z
  .number()
  .int('Kwota musi być liczbą całkowitą groszy')
  .min(-MAX_AMOUNT_MINOR, 'Kwota poza dopuszczalnym zakresem')
  .max(MAX_AMOUNT_MINOR, 'Kwota poza dopuszczalnym zakresem');
/** Kwota w groszach. Dozwolone wartości ustala schemat powyżej. */
export type AmountMinor = z.infer<typeof AmountMinorSchema>;

/** Kwota dodatnia (transakcje, wpłaty, raty). */
export const PositiveAmountMinorSchema = AmountMinorSchema.positive(
  'Kwota musi być większa od zera',
);

/** Kwota nieujemna (salda docelowe, progi). */
export const NonNegativeAmountMinorSchema = AmountMinorSchema.min(0, 'Kwota nie może być ujemna');

/**
 * Udział w punktach bazowych: 1% = 100 bps, 100% = 10 000 bps.
 *
 * Zakres nieujemny dotyczy **planu** (rozkład docelowy, udział celu). Wykonanie liczone
 * netto może być ujemne i celowo nie używa tego schematu (ADR-011).
 */
export const BpsSchema = z
  .number()
  .int('Udział musi być liczbą całkowitą punktów bazowych')
  .min(0, 'Udział nie może być ujemny')
  .max(100_000, 'Udział nie może przekraczać 1000%');
/** Udział w punktach bazowych. Dozwolone wartości ustala schemat powyżej. */
export type Bps = z.infer<typeof BpsSchema>;

/**
 * Sufit zmiany miesiąc do miesiąca: +1000%.
 *
 * Wzrost względem małej podstawy nie ma górnej granicy (50 zł → 6 000 zł to +11 900%),
 * a schemat niżej ją ma. Porównanie obcina wynik do tej wartości, UI pokazuje „>1000%"
 * (07 §12.3, ADR-084).
 */
export const MAX_DELTA_BPS = 100_000;

/** Udział, który może być ujemny — wykonanie liczone netto (ADR-011). */
export const SignedBpsSchema = z
  .number()
  .int('Udział musi być liczbą całkowitą punktów bazowych')
  .min(-MAX_DELTA_BPS)
  .max(MAX_DELTA_BPS);

/**
 * Data biznesowa w formacie `YYYY-MM-DD`.
 *
 * Sprawdzenie jest **kalendarzowe**, nie składniowe: `Date.parse` przepuszcza
 * `2026-02-31` i `2026-09-31`, przewijając je na kolejny miesiąc, więc transakcja
 * z nieistniejącą datą trafiłaby do bazy i rozjechała granice miesiąca.
 */
export const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Oczekiwano formatu RRRR-MM-DD')
  .refine(isValidDateOnly, 'Nieistniejąca data');
/** Data biznesowa. Dozwolone wartości ustala schemat powyżej. */
export type DateOnly = z.infer<typeof DateOnlySchema>;

/** Klucz miesiąca w formacie `YYYY-MM`. */
export const MonthKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Oczekiwano formatu RRRR-MM');
/** Klucz miesiąca budżetowego. Dozwolone wartości ustala schemat powyżej. */
export type MonthKey = z.infer<typeof MonthKeySchema>;

/** Znacznik czasu — epoch w milisekundach UTC. */
export const TimestampSchema = z.number().int().nonnegative();
/** Znacznik systemowy. Dozwolone wartości ustala schemat powyżej. */
export type Timestamp = z.infer<typeof TimestampSchema>;

/** Kod waluty ISO 4217. W v1 zawsze `PLN` (ADR-007). */
export const CurrencySchema = z.string().length(3).default('PLN');

/** Kolor w zapisie HEX, np. `#22c55e`. */
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Oczekiwano koloru w zapisie #rrggbb');

/** Dzień rozpoczęcia miesiąca budżetowego (1–28; w v1 wyłącznie 1 — ADR-006). */
export const MonthStartDaySchema = z.number().int().min(1).max(28).default(1);
