import { monthKeyOf } from './month.js';

import type { MonthKey } from '../domain/primitives.js';

/**
 * Zamiana znacznika systemowego na **datę biznesową** w podanej strefie.
 *
 * To jest jedyne miejsce w projekcie, w którym `Date` spotyka się z datą biznesową
 * ([07 §1.1](../../../../plans/07-domain-rules.md#11-trzy-różne-pojęcia-czasu)).
 * Reszta `utils/month.ts` operuje na napisach i strefy nie zna.
 *
 * Moduł jest **izomorficzny**: `Intl.DateTimeFormat` z opcją `timeZone` działa tak samo
 * w Node 22 i w przeglądarce, więc backend i front liczą „dzisiaj" identycznie. Gdyby
 * każda strona miała własną implementację, rozjechałyby się dokładnie o północy — czyli
 * wtedy, gdy różnica jest najbardziej widoczna i najtrudniejsza do odtworzenia.
 */

/**
 * Zwraca datę biznesową dla chwili w podanej strefie.
 *
 * **Nie wolno tu użyć** `new Date().toISOString().slice(0, 10)`: dla Warszawy dałoby to
 * poprzedni dzień między 00:00 a 02:00 czasu lokalnego latem. Wydatek wpisany o 00:30
 * trafiłby do wczoraj, a w nocy z ostatniego dnia miesiąca — do poprzedniego miesiąca.
 *
 * Nieznaną strefę odrzuca samo `Intl` — rzuca wtedy `RangeError`, więc nie ma tu
 * własnego sprawdzenia. Wynik `en-CA` z jawnymi opcjami numerycznymi jest zawsze
 * postaci `YYYY-MM-DD`, a obrona przed czymś, czego nie da się wywołać, byłaby martwym
 * kodem udającym bezpieczeństwo.
 *
 * @param timezone - Strefa gospodarstwa, np. `Europe/Warsaw`.
 * @param now - Chwila odniesienia; domyślnie bieżąca.
 * @returns Data w formacie `YYYY-MM-DD`.
 * @throws {RangeError} Gdy strefa jest nieznana (rzuca `Intl`).
 */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  // `en-CA` formatuje datę jako `YYYY-MM-DD`, więc nie trzeba składać jej z części
  // ani zgadywać kolejności pól w innych lokalizacjach.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Zwraca klucz miesiąca budżetowego dla chwili w podanej strefie.
 *
 * @param timezone - Strefa gospodarstwa.
 * @param now - Chwila odniesienia; domyślnie bieżąca.
 * @param monthStartDay - Dzień rozpoczęcia miesiąca budżetowego (1–28).
 * @returns Klucz miesiąca `YYYY-MM`.
 */
export function currentMonthKey(
  timezone: string,
  now: Date = new Date(),
  monthStartDay = 1,
): MonthKey {
  return monthKeyOf(todayInTimezone(timezone, now), monthStartDay);
}
