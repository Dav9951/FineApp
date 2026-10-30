import {
  formatDateOnly,
  isValidMonthKey,
  shiftMonth,
  type CategorySpendingDto,
  type MonthKey,
  type MonthSummaryDto,
} from '@fineapp/shared';

import { inMonth, pluralPl } from '../../lib/format.js';

/**
 * Czyste reguły ekranu miesiąca ([06 §3.1](../../../../../plans/06-ui-views.md#31-miesiąc-dashboard--mmonth)):
 * etykiety porównań, upływ miesiąca, banery, gest. Bez Reacta — testowane
 * bezpośrednio.
 */

/**
 * Nazwa miesiąca w dopełniaczu: „do sierpnia", „od 1 października".
 *
 * `Intl` daje dopełniacz tylko razem z dniem („1 sierpnia"), więc dzień jest odcinany.
 *
 * @param month - Klucz miesiąca.
 * @returns Nazwa w dopełniaczu, np. `sierpnia`.
 */
export function monthGenitive(month: MonthKey): string {
  return formatDateOnly(`${month}-01`)
    .replace(/^1\s+/u, '')
    .replace(/\s+\d{4}$/u, '');
}

/**
 * Procent z punktów bazowych, bez miejsc po przecinku: `602` → `6%`.
 *
 * Na dashboardzie liczy się kierunek i rząd wielkości; „6,02%" to szum (07 §3).
 *
 * @param bps - Punkty bazowe, dodatnie albo ujemne.
 * @returns Wartość bezwzględna jako tekst z `%`.
 */
export function percentLabel(bps: number): string {
  return `${String(Math.round(Math.abs(bps) / 100))}%`;
}

/**
 * Etykieta zmiany względem poprzedniego miesiąca: „↓ 6% do sierpnia".
 *
 * Kierunek niesie strzałka **i** słowo w etykiecie dostępności, nie kolor (15 §2.4).
 * Bez danych z poprzedniego miesiąca — `null`: strzałka „↑ 0%" w pierwszym miesiącu
 * używania aplikacji byłaby fałszywa (07 §12.3). Przy zerowej podstawie (wydatki
 * sierpnia = 0) procent nie istnieje — zostaje sama strzałka.
 *
 * @param deltaMinor - Różnica kwot.
 * @param deltaBps - Różnica w punktach bazowych (0 przy zerowej podstawie).
 * @param hasPreviousData - Czy poprzedni miesiąc ma dane.
 * @param previousMonth - Poprzedni miesiąc.
 * @returns Tekst i etykieta dostępności albo `null`.
 */
export function deltaLabel(
  deltaMinor: number,
  deltaBps: number,
  hasPreviousData: boolean,
  previousMonth: MonthKey,
): { text: string; label: string } | null {
  if (!hasPreviousData) return null;
  const to = `do ${monthGenitive(previousMonth)}`;
  const inPrevious = inMonth(previousMonth);
  if (deltaMinor === 0) return { text: `→ ${to}`, label: `tyle samo co ${inPrevious}` };
  const arrow = deltaMinor > 0 ? '↑' : '↓';
  const word = deltaMinor > 0 ? 'więcej' : 'mniej';
  const percent = deltaBps === 0 ? null : percentLabel(deltaBps);
  return {
    text: percent === null ? `${arrow} ${to}` : `${arrow} ${percent} ${to}`,
    label:
      percent === null ? `${word} niż ${inPrevious}` : `o ${percent} ${word} niż ${inPrevious}`,
  };
}

/** Trend kategorii względem poprzedniego miesiąca. */
export interface CategoryTrend {
  /** Strzałka z krojów (15 §6): `↑`, `↓`, `→`. */
  readonly arrow: '↑' | '↓' | '→';
  /** Etykieta dostępności. */
  readonly label: string;
}

/**
 * Trend kategorii: więcej, mniej albo tyle samo co miesiąc wcześniej.
 *
 * Różnica poniżej 5% to „tyle samo" — zakupy spożywcze nigdy nie wychodzą co do grosza,
 * a strzałka przy 1 zł różnicy sugerowałaby zmianę, której nie było.
 *
 * @param item - Kategoria z kwotą poprzednią.
 * @returns Trend albo `null`, gdy poprzedni miesiąc nie ma wydatków.
 */
export function categoryTrend(item: CategorySpendingDto): CategoryTrend | null {
  const previous = item.previousMonthAmountMinor;
  if (previous === null) return null;
  const delta = item.amountMinor - previous;
  if (Math.abs(delta) * 20 < Math.max(previous, item.amountMinor)) {
    return { arrow: '→', label: 'tyle co miesiąc wcześniej' };
  }
  return delta > 0
    ? { arrow: '↑', label: 'więcej niż miesiąc wcześniej' }
    : { arrow: '↓', label: 'mniej niż miesiąc wcześniej' };
}

/** Upływ trwającego miesiąca do paska pod podsumowaniem. */
export interface MonthProgress {
  readonly valueBps: number;
  /** „20 z 30 dni". */
  readonly elapsed: string;
  /** „do 1 października zostało 10 dni". */
  readonly remaining: string;
}

/**
 * Upływ miesiąca — tylko dla bieżącego; zamknięty i przyszły paska nie mają.
 *
 * @param summary - Podsumowanie miesiąca.
 * @returns Pasek i podpisy albo `null`.
 */
export function monthProgress(
  summary: Pick<MonthSummaryDto, 'isCurrent' | 'daysElapsed' | 'daysInMonth' | 'month'>,
): MonthProgress | null {
  if (!summary.isCurrent) return null;
  const left = summary.daysInMonth - summary.daysElapsed;
  const next = formatDateOnly(`${shiftMonth(summary.month, 1)}-01`).replace(/\s+\d{4}$/u, '');
  return {
    valueBps: Math.round((summary.daysElapsed / summary.daysInMonth) * 10_000),
    elapsed: `${String(summary.daysElapsed)} z ${String(summary.daysInMonth)} dni`,
    remaining:
      left === 0
        ? 'ostatni dzień miesiąca'
        : `do ${next} ${pluralPl(left, 'został', 'zostały', 'zostało')} ${String(left)} ${pluralPl(left, 'dzień', 'dni', 'dni')}`,
  };
}

/** Status miesiąca względem okna księgowania — baner nad treścią. */
export type MonthNotice =
  { readonly kind: 'future' } | { readonly kind: 'closed'; readonly from: string } | null;

/**
 * Czy nad treścią potrzebny jest baner: podgląd przyszłości albo zamknięty miesiąc.
 *
 * @param summary - Podsumowanie miesiąca.
 * @returns Rodzaj banera albo `null`.
 */
export function monthNotice(
  summary: Pick<MonthSummaryDto, 'isFuture' | 'range' | 'canPostBackTo'>,
): MonthNotice {
  if (summary.isFuture) return { kind: 'future' };
  if (summary.range.to < summary.canPostBackTo) {
    return { kind: 'closed', from: formatDateOnly(summary.canPostBackTo) };
  }
  return null;
}

/**
 * Liczba wydatków bez kategorii z odmianą: „1 wydatek", „3 wydatki", „5 wydatków".
 *
 * @param count - Liczba.
 * @returns Tekst.
 */
export function uncategorizedLabel(count: number): string {
  return `${String(count)} ${pluralPl(count, 'wydatek', 'wydatki', 'wydatków')} bez kategorii`;
}

/**
 * Czy pokazać kroki startowe zamiast dashboardu (06 §3.1, stan pusty).
 *
 * Tylko przy pierwszym uruchomieniu: brak kont **i** brak jakiejkolwiek transakcji.
 * Pusty miesiąc u kogoś, kto już używa aplikacji, to zwykły dashboard z zerami —
 * kroki „Dodaj konta" wyglądałyby wtedy jak utrata danych.
 *
 * @param summary - Podsumowanie miesiąca.
 * @returns `true`, gdy ekran ma być instrukcją startu.
 */
export function isFirstRun(
  summary: Pick<MonthSummaryDto, 'accounts' | 'recentTransactions'>,
): boolean {
  return summary.accounts.length === 0 && summary.recentTransactions.length === 0;
}

/** Najmniejsze przesunięcie palca, które jest gestem, a nie drgnięciem. */
export const SWIPE_MIN_PX = 60;

/**
 * Rozpoznaje gest zmiany miesiąca (06 §3.1): wyraźnie poziomy ruch dłuższy niż próg.
 *
 * „Wyraźnie poziomy" — co najmniej dwa razy dłuższy w poziomie niż w pionie; inaczej
 * zwykłe przewijanie ekranu po skosie przełączałoby miesiąc.
 * Palec w lewo pokazuje **następny** miesiąc — jak przewracanie kartki.
 *
 * @param dx - Przesunięcie poziome (dodatnie w prawo).
 * @param dy - Przesunięcie pionowe.
 * @returns Kierunek zmiany albo `null`.
 */
export function swipeDirection(dx: number, dy: number): 'previous' | 'next' | null {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 2) return null;
  return dx < 0 ? 'next' : 'previous';
}

/**
 * Adres dashboardu miesiąca.
 *
 * @param month - Klucz miesiąca.
 * @returns Ścieżka.
 */
export function monthHref(month: MonthKey): string {
  return `/m/${isValidMonthKey(month) ? month : ''}`;
}
