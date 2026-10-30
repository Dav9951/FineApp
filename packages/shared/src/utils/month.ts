import type { MonthKey } from '../domain/primitives.js';

/**
 * Arytmetyka miesiąca budżetowego i daty biznesowej.
 *
 * **Data biznesowa nie ma strefy czasowej** ([07 §1.1](../../../../plans/07-domain-rules.md#11-trzy-różne-pojęcia-czasu)).
 * Wydatek z 31 sierpnia należy do sierpnia niezależnie od tego, gdzie stoi serwer.
 * Dlatego cały ten moduł operuje na **napisach** `YYYY-MM-DD` i `YYYY-MM`, a nie na
 * obiektach `Date` — `Date` wciąga strefę czasową i wraz z nią całą klasę błędów
 * „o północy wychodzi poprzedni dzień".
 *
 * Zamiana `Date` → data biznesowa wymaga strefy gospodarstwa i należy do backendu;
 * tutaj jej nie ma celowo.
 */

/** Liczba dni w miesiącach roku zwykłego; luty rozstrzyga {@link isLeapYear}. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Sprawdza, czy rok jest przestępny.
 *
 * @param year - Rok czterocyfrowy.
 * @returns `true` dla roku przestępnego.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Zwraca liczbę dni w miesiącu.
 *
 * @param year - Rok czterocyfrowy.
 * @param month - Miesiąc 1–12.
 * @returns Liczba dni (28–31).
 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return DAYS_IN_MONTH[month - 1] ?? 30;
}

/**
 * Rozbija datę biznesową na części, bez walidacji kalendarzowej.
 *
 * @param dateOnly - Napis `YYYY-MM-DD`.
 * @returns Rok, miesiąc i dzień albo `null`, gdy kształt się nie zgadza.
 */
function parts(dateOnly: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/**
 * Sprawdza, czy napis jest istniejącą datą biznesową.
 *
 * Sprawdzenie jest kalendarzowe, bo `Date.parse('2026-02-31T00:00:00Z')` **nie** zwraca
 * `NaN` — przewija datę na 3 marca. Transakcja z taką datą przeszłaby walidację
 * i trafiła do bazy jako napis, którego nie ma w kalendarzu.
 *
 * @param dateOnly - Napis do sprawdzenia.
 * @returns `true`, gdy data istnieje.
 */
export function isValidDateOnly(dateOnly: string): boolean {
  const p = parts(dateOnly);
  if (!p) return false;
  if (p.month < 1 || p.month > 12) return false;
  if (p.day < 1 || p.day > daysInMonth(p.year, p.month)) return false;
  return true;
}

/**
 * Sprawdza, czy napis jest poprawnym kluczem miesiąca.
 *
 * @param month - Napis do sprawdzenia.
 * @returns `true` dla formatu `YYYY-MM` z miesiącem 01–12.
 */
export function isValidMonthKey(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

/**
 * Dopisuje wiodące zero do liczby jedno- lub dwucyfrowej.
 *
 * @param value - Liczba 0–99.
 * @returns Napis dwuznakowy.
 */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Przesuwa klucz miesiąca o podaną liczbę miesięcy.
 *
 * @param month - Klucz `YYYY-MM`.
 * @param delta - Liczba miesięcy; ujemna cofa.
 * @returns Przesunięty klucz miesiąca.
 * @throws {TypeError} Gdy klucz jest nieprawidłowy.
 */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  if (!isValidMonthKey(month)) {
    throw new TypeError(`month: nieprawidłowy klucz miesiąca: ${month}`);
  }
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  // Liczymy na indeksie od zera, żeby dzielenie z resztą działało też dla wartości
  // ujemnych bez rozgałęziania na „grudzień poprzedniego roku".
  const total = year * 12 + monthIndex + delta;
  const shiftedYear = Math.floor(total / 12);
  const shiftedMonth = total - shiftedYear * 12 + 1;
  return `${String(shiftedYear).padStart(4, '0')}-${pad2(shiftedMonth)}`;
}

/**
 * Wyznacza klucz miesiąca budżetowego dla daty biznesowej.
 *
 * Przy `monthStartDay = 26` data 2026-09-28 należy do miesiąca `2026-09`
 * (okres 26.09 – 25.10), a data 2026-09-20 do miesiąca `2026-08` — miesiąc budżetowy
 * nazywa się od miesiąca, w którym się **zaczyna**.
 *
 * W v1 używany jest wyłącznie `monthStartDay = 1` (ADR-006); parametr istnieje,
 * bo kolumna w bazie też istnieje.
 *
 * @param dateOnly - Data biznesowa `YYYY-MM-DD`.
 * @param monthStartDay - Dzień rozpoczęcia miesiąca budżetowego (1–28).
 * @returns Klucz miesiąca `YYYY-MM`.
 * @throws {TypeError} Gdy data jest nieprawidłowa.
 */
export function monthKeyOf(dateOnly: string, monthStartDay = 1): MonthKey {
  if (!isValidDateOnly(dateOnly)) {
    throw new TypeError(`month: nieprawidłowa data biznesowa: ${dateOnly}`);
  }
  const calendarMonth = dateOnly.slice(0, 7);
  if (monthStartDay === 1) return calendarMonth;
  const day = Number(dateOnly.slice(8, 10));
  return day >= monthStartDay ? calendarMonth : shiftMonth(calendarMonth, -1);
}

/**
 * Zwraca zakres dat obejmowany przez miesiąc budżetowy.
 *
 * Oba krańce są **włącznie**. Przy `monthStartDay = 1` jest to zwykły miesiąc
 * kalendarzowy; przy większym — okres od dnia `D` do dnia `D − 1` kolejnego miesiąca,
 * przycięty do długości tego miesiąca (31 stycznia nie ma odpowiednika w lutym).
 *
 * @param month - Klucz miesiąca `YYYY-MM`.
 * @param monthStartDay - Dzień rozpoczęcia miesiąca budżetowego (1–28).
 * @returns Daty `from` i `to` w formacie `YYYY-MM-DD`.
 * @throws {TypeError} Gdy klucz miesiąca jest nieprawidłowy.
 */
export function monthRange(month: MonthKey, monthStartDay = 1): { from: string; to: string } {
  if (!isValidMonthKey(month)) {
    throw new TypeError(`month: nieprawidłowy klucz miesiąca: ${month}`);
  }
  if (monthStartDay === 1) {
    const year = Number(month.slice(0, 4));
    const monthNumber = Number(month.slice(5, 7));
    return { from: `${month}-01`, to: `${month}-${pad2(daysInMonth(year, monthNumber))}` };
  }

  const next = shiftMonth(month, 1);
  const nextYear = Number(next.slice(0, 4));
  const nextMonth = Number(next.slice(5, 7));
  const lastDay = Math.min(monthStartDay - 1, daysInMonth(nextYear, nextMonth));
  return { from: `${month}-${pad2(monthStartDay)}`, to: `${next}-${pad2(lastDay)}` };
}

/**
 * Zwraca listę kluczy miesięcy z zakresu, włącznie z krańcami.
 *
 * @param from - Klucz miesiąca początkowego.
 * @param to - Klucz miesiąca końcowego.
 * @returns Lista kluczy rosnąco; pusta, gdy `from` jest późniejszy niż `to`.
 * @throws {TypeError} Gdy któryś klucz jest nieprawidłowy.
 */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  if (!isValidMonthKey(from) || !isValidMonthKey(to)) {
    throw new TypeError(`month: nieprawidłowy zakres: ${from}..${to}`);
  }
  const result: MonthKey[] = [];
  let current = from;
  while (current <= to) {
    result.push(current);
    current = shiftMonth(current, 1);
  }
  return result;
}

/**
 * Zwraca liczbę miesięcy od `from` do `to`.
 *
 * @param from - Klucz miesiąca początkowego.
 * @param to - Klucz miesiąca końcowego.
 * @returns Różnica w miesiącach; ujemna, gdy `to` jest wcześniejszy.
 * @throws {TypeError} Gdy któryś klucz jest nieprawidłowy.
 */
export function monthsDiff(from: MonthKey, to: MonthKey): number {
  if (!isValidMonthKey(from) || !isValidMonthKey(to)) {
    throw new TypeError(`month: nieprawidłowy zakres: ${from}..${to}`);
  }
  const fromTotal = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7));
  const toTotal = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  return toTotal - fromTotal;
}

/**
 * Najwcześniejsza data, na którą wolno zaksięgować transakcję (07 §1.3).
 *
 * Liczona jako **początek miesiąca** sprzed `limitMonths` miesięcy — przy limicie 1
 * przez cały wrzesień wolno księgować od 1 sierpnia, a nie „30 dni wstecz". Tak ludzie
 * myślą o domykaniu poprzedniego miesiąca.
 *
 * @param today - Dzisiejsza data biznesowa `YYYY-MM-DD`.
 * @param limitMonths - Limit z ustawień gospodarstwa (0 = tylko bieżący miesiąc).
 * @returns Najwcześniejsza dozwolona data `YYYY-MM-DD`.
 * @throws {TypeError} Gdy data jest nieprawidłowa albo limit ujemny.
 */
export function earliestPostableDate(today: string, limitMonths: number): string {
  if (!isValidDateOnly(today)) {
    throw new TypeError(`month: nieprawidłowa data biznesowa: ${today}`);
  }
  if (!Number.isInteger(limitMonths) || limitMonths < 0) {
    throw new TypeError(`month: limit miesięcy musi być nieujemną liczbą całkowitą`);
  }
  return `${shiftMonth(today.slice(0, 7), -limitMonths)}-01`;
}

/**
 * Najpóźniejsza data, na którą wolno zaksięgować transakcję (07 §1.3, I-8).
 *
 * Koniec **bieżącego** miesiąca budżetowego, a nie „dziś": wydatek z jutrzejszą datą,
 * wpisany z wyprzedzeniem w tym samym miesiącu, niczego nie psuje. Dalej w przyszłość
 * nie wolno — od tego są pozycje cykliczne.
 *
 * @param today - Dzisiejsza data biznesowa `YYYY-MM-DD`.
 * @param monthStartDay - Dzień rozpoczęcia miesiąca budżetowego (1–28).
 * @returns Ostatni dzień bieżącego miesiąca budżetowego `YYYY-MM-DD`.
 * @throws {TypeError} Gdy data jest nieprawidłowa.
 */
export function latestPostableDate(today: string, monthStartDay = 1): string {
  return monthRange(monthKeyOf(today, monthStartDay), monthStartDay).to;
}

/**
 * Przycina dzień miesiąca do długości wskazanego miesiąca.
 *
 * Reguła cykliczna „31. dnia miesiąca" w lutym oznacza 28 albo 29 — bez przycięcia
 * powstałby termin, którego nie ma w kalendarzu ([07 §6.1](../../../../plans/07-domain-rules.md)).
 *
 * @param month - Klucz miesiąca `YYYY-MM`.
 * @param dayOfMonth - Żądany dzień 1–31.
 * @returns Data `YYYY-MM-DD` z dniem przyciętym do ostatniego dnia miesiąca.
 * @throws {TypeError} Gdy klucz miesiąca lub dzień są nieprawidłowe.
 */
export function clampDayToMonth(month: MonthKey, dayOfMonth: number): string {
  if (!isValidMonthKey(month)) {
    throw new TypeError(`month: nieprawidłowy klucz miesiąca: ${month}`);
  }
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new TypeError(`month: dzień miesiąca poza zakresem 1–31: ${String(dayOfMonth)}`);
  }
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  return `${month}-${pad2(Math.min(dayOfMonth, daysInMonth(year, monthNumber)))}`;
}

/**
 * Formatuje klucz miesiąca po polsku, np. `wrzesień 2026`.
 *
 * Formatowanie idzie przez `Intl` w strefie UTC — data jest tu wyłącznie nośnikiem
 * roku i miesiąca, a strefa lokalna mogłaby przesunąć ją o jeden dzień wstecz
 * i pokazać poprzedni miesiąc.
 *
 * @param month - Klucz miesiąca `YYYY-MM`.
 * @param locale - Ustawienia regionalne.
 * @returns Nazwa miesiąca z rokiem.
 * @throws {TypeError} Gdy klucz miesiąca jest nieprawidłowy.
 */
export function formatMonth(month: MonthKey, locale = 'pl-PL'): string {
  if (!isValidMonthKey(month)) {
    throw new TypeError(`month: nieprawidłowy klucz miesiąca: ${month}`);
  }
  const date = new Date(`${month}-01T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Formatuje datę biznesową po polsku, np. `1 sierpnia 2026`.
 *
 * Do komunikatów („Nie można księgować przed 1 sierpnia 2026"). Jak w
 * {@link formatMonth} — w strefie UTC, bo data nie ma strefy, a lokalna mogłaby
 * przesunąć ją o dzień.
 *
 * @param dateOnly - Data biznesowa `YYYY-MM-DD`.
 * @param locale - Ustawienia regionalne.
 * @returns Dzień, nazwa miesiąca w dopełniaczu i rok.
 * @throws {TypeError} Gdy data jest nieprawidłowa.
 */
export function formatDateOnly(dateOnly: string, locale = 'pl-PL'): string {
  if (!isValidDateOnly(dateOnly)) {
    throw new TypeError(`month: nieprawidłowa data biznesowa: ${dateOnly}`);
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateOnly}T00:00:00Z`));
}

/** Położenie miesiąca względem dzisiejszego dnia (07 §12.2). */
export interface MonthTiming {
  readonly range: { readonly from: string; readonly to: string };
  readonly isCurrent: boolean;
  readonly isPartial: boolean;
  readonly isFuture: boolean;
  readonly daysElapsed: number;
  readonly daysInMonth: number;
}

/** Milisekundy w dobie — daty biznesowe liczone jako północ UTC nie znają zmiany czasu. */
const DAY_MS = 86_400_000;

/**
 * Liczba dni od `from` do `to` włącznie.
 *
 * Obie daty zamienione na północ UTC: to daty biznesowe bez strefy (07 §1.1), więc
 * zmiana czasu z letniego na zimowy nie może dać doby 23- ani 25-godzinnej.
 *
 * @param from - Data początkowa `YYYY-MM-DD`.
 * @param to - Data końcowa `YYYY-MM-DD`.
 * @returns Liczba dni łącznie z oboma krańcami.
 */
function daysInclusive(from: string, to: string): number {
  return daysBetween(from, to) + 1;
}

/**
 * Wyznacza, gdzie leży miesiąc względem dzisiejszego dnia gospodarstwa (07 §12.2).
 *
 * `daysElapsed` liczy **dzisiejszy dzień jako miniony**: 1 września rano pasek pokazuje
 * „1 z 30 dni", nie „0 z 30" — dzień, w którym się już wydaje, jest dniem miesiąca.
 * Ta sama liczba to `progress` statusu linii rozkładu (07 §2.5): przeszłe — pełne,
 * przyszłe — zero. Mieszka w `shared` od `F5-3`: potrzebują jej ekran miesiąca i moduł
 * rozkładu, a żaden z nich nie powinien importować drugiego.
 *
 * @param month - Oglądany miesiąc.
 * @param today - Dzisiejsza data biznesowa gospodarstwa.
 * @param monthStartDay - Dzień rozpoczęcia miesiąca budżetowego.
 * @returns Zakres, flagi i upływ dni.
 */
export function monthTiming(month: MonthKey, today: string, monthStartDay = 1): MonthTiming {
  const range = monthRange(month, monthStartDay);
  const daysInMonth = daysInclusive(range.from, range.to);
  const current = monthKeyOf(today, monthStartDay);
  const isCurrent = month === current;
  const isFuture = month > current;
  let daysElapsed = daysInMonth;
  if (isFuture) daysElapsed = 0;
  else if (isCurrent) daysElapsed = daysInclusive(range.from, today);
  return { range, isCurrent, isPartial: isCurrent, isFuture, daysElapsed, daysInMonth };
}

/**
 * Przesuwa datę o podaną liczbę dni.
 *
 * Liczone w UTC na samej dacie kalendarzowej: bez strefy nie ma zmiany czasu, więc
 * „+1 dzień" nigdy nie daje tej samej daty ani nie przeskakuje dwóch.
 *
 * @param dateOnly - Data `YYYY-MM-DD`.
 * @param days - Liczba dni (ujemna cofa).
 * @returns Nowa data `YYYY-MM-DD`.
 */
export function addDays(dateOnly: string, days: number): string {
  // To nie jest „dziś" z zegara (reguła 3 z CLAUDE.md), tylko arytmetyka na dacie
  // kalendarzowej w UTC — `toISOString` oddaje tu dokładnie tę samą datę.
  return new Date(Date.parse(`${dateOnly}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Liczba dni od `from` do `to` (ujemna, gdy `to` jest wcześniej).
 *
 * @param from - Data `YYYY-MM-DD`.
 * @param to - Data `YYYY-MM-DD`.
 * @returns Różnica w dniach.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}
