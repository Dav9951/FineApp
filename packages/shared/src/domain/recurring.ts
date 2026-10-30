import { clampDayToMonth, monthRange, monthsDiff, shiftMonth } from '../utils/month.js';
import type { Frequency, TransactionType } from './enums.js';
import type { MonthKey } from './primitives.js';
import { transactionShapeIssues, type TransactionIssue } from './transaction.js';

/**
 * Terminy pozycji cyklicznych
 * ([07 §6.1](../../../../plans/07-domain-rules.md#61-wyznaczanie-terminów), `F4-1`).
 *
 * Czyste funkcje w `shared`: API wylicza z nich wystąpienia (`F4-2`) i „najbliższy termin",
 * a formularz reguły pokazuje podgląd najbliższych dat, **zanim** użytkownik zapisze.
 */

/** Pola reguły, z których wynikają terminy. */
export interface RecurringSchedule {
  readonly frequency: Frequency;
  /** Co ile miesięcy — wyłącznie dla `every_n_months`; dla pozostałych `1`. */
  readonly intervalCount: number;
  readonly dayOfMonth: number | null;
  /** 0 = niedziela … 6 = sobota. */
  readonly weekday: number | null;
  readonly monthOfYear: number | null;
  /** Pierwszy termin `biweekly`; dla pozostałych bez znaczenia. */
  readonly anchorDate: string;
  readonly startMonth: MonthKey;
  readonly endMonth: MonthKey | null;
}

/** Milisekundy w dobie. */
const DAY_MS = 86_400_000;

/**
 * Data biznesowa jako liczba dni od epoki — daty bez strefy liczone jako północ UTC,
 * więc zmiana czasu nie daje doby 23- ani 25-godzinnej.
 *
 * @param dateOnly - Data `YYYY-MM-DD`.
 * @returns Numer dnia.
 */
function dayNumber(dateOnly: string): number {
  return Math.round(Date.parse(`${dateOnly}T00:00:00Z`) / DAY_MS);
}

/**
 * Dzień tygodnia daty biznesowej: 0 = niedziela … 6 = sobota.
 *
 * @param dateOnly - Data `YYYY-MM-DD`.
 * @returns Dzień tygodnia.
 */
export function weekdayOf(dateOnly: string): number {
  return new Date(`${dateOnly}T00:00:00Z`).getUTCDay();
}

/**
 * Wszystkie daty miesiąca kalendarzowego.
 *
 * @param month - Klucz miesiąca.
 * @returns Daty od pierwszego do ostatniego dnia.
 */
function datesOf(month: MonthKey): string[] {
  const { to } = monthRange(month);
  const last = Number(to.slice(8, 10));
  return Array.from(
    { length: last },
    (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
  );
}

/**
 * Wylicza daty wystąpień reguły w miesiącu (07 §6.1).
 *
 * | `frequency` | Terminy w miesiącu `M` |
 * |---|---|
 * | `monthly` | `dayOfMonth` przycięty do długości `M` |
 * | `every_n_months` | jak `monthly`, gdy od `startMonth` minęła wielokrotność `intervalCount` |
 * | `quarterly` | jak `every_n_months` z odstępem 3 |
 * | `yearly` | jak `monthly`, tylko w miesiącu `monthOfYear` |
 * | `weekly` | każdy `weekday` w `M` |
 * | `biweekly` | co 14 dni od `anchorDate` (włącznie), daty wpadające w `M` |
 *
 * **Przycinanie, nie przenoszenie**: „31." w kwietniu to 30 kwietnia, w lutym 28 albo 29.
 * Czynsz płatny „ostatniego dnia" ma wypaść w swoim miesiącu, nie 1 maja.
 * Poza `[startMonth, endMonth]` — lista pusta. Wstrzymanie reguły (`isActive`) nie zmienia
 * terminów; decyduje o nim generowanie (`F4-2`).
 *
 * @param rule - Terminarz reguły.
 * @param month - Miesiąc.
 * @returns Daty `YYYY-MM-DD` rosnąco; pusta, gdy w `M` nie ma terminu.
 */
export function occurrenceDatesForMonth(rule: RecurringSchedule, month: MonthKey): string[] {
  if (month < rule.startMonth || (rule.endMonth !== null && month > rule.endMonth)) return [];
  const monthNumber = Number(month.slice(5, 7));
  const monthlyOn = (): string[] =>
    rule.dayOfMonth === null ? [] : [clampDayToMonth(month, rule.dayOfMonth)];
  const everyN = (n: number): string[] =>
    monthsDiff(rule.startMonth, month) % n === 0 ? monthlyOn() : [];

  switch (rule.frequency) {
    case 'monthly':
      return monthlyOn();
    case 'every_n_months':
      return everyN(Math.max(1, rule.intervalCount));
    case 'quarterly':
      return everyN(3);
    case 'yearly':
      return rule.monthOfYear === monthNumber ? monthlyOn() : [];
    case 'weekly':
      return datesOf(month).filter((date) => weekdayOf(date) === rule.weekday);
    case 'biweekly': {
      const anchor = dayNumber(rule.anchorDate);
      return datesOf(month).filter((date) => {
        const offset = dayNumber(date) - anchor;
        return offset >= 0 && offset % 14 === 0;
      });
    }
  }
}

/**
 * Najdalej ile miesięcy naprzód szukamy **jednego** terminu — najrzadsza reguła („co 24
 * miesiące", limit `intervalCount`) ma go w ciągu 24. Przy `count` terminach horyzont
 * rośnie `count` razy: sześć terminów reguły rocznej to sześć lat, nie dwa (`F4-9`).
 */
const LOOKAHEAD_MONTHS = 24;

/**
 * Najbliższe terminy reguły od podanej daty (włącznie).
 *
 * @param rule - Terminarz reguły.
 * @param from - Data, od której szukamy.
 * @param count - Ile terminów zwrócić.
 * @returns Do `count` dat rosnąco; mniej, gdy reguła się kończy.
 */
export function upcomingDueDates(rule: RecurringSchedule, from: string, count: number): string[] {
  const result: string[] = [];
  let month = from.slice(0, 7) < rule.startMonth ? rule.startMonth : from.slice(0, 7);
  const horizon = LOOKAHEAD_MONTHS * Math.max(1, count);
  for (let step = 0; step < horizon && result.length < count; step += 1) {
    if (rule.endMonth !== null && month > rule.endMonth) break;
    for (const date of occurrenceDatesForMonth(rule, month)) {
      if (date >= from && result.length < count) result.push(date);
    }
    month = shiftMonth(month, 1);
  }
  return result;
}

/**
 * Domyślny `anchorDate`, gdy formularz go nie podał.
 *
 * Dla `biweekly` — pierwszy `weekday` od początku `startMonth`: „co drugi piątek od
 * października" zaczyna się w pierwszy piątek października. Dla pozostałych kolumna jest
 * bez znaczenia (03 §3.11 wymaga wartości), więc pierwszy dzień `startMonth`.
 *
 * @param rule - Częstotliwość, dzień tygodnia i miesiąc startu.
 * @returns Data `YYYY-MM-DD`.
 */
export function defaultAnchorDate(
  rule: Pick<RecurringSchedule, 'frequency' | 'weekday' | 'startMonth'>,
): string {
  const first = `${rule.startMonth}-01`;
  if (rule.frequency !== 'biweekly' || rule.weekday === null) return first;
  return datesOf(rule.startMonth).find((date) => weekdayOf(date) === rule.weekday) ?? first;
}

/** Pola terminarza, które mają sens dla danej częstotliwości. */
const USES: Readonly<
  Record<Frequency, { dayOfMonth: boolean; weekday: boolean; monthOfYear: boolean }>
> = {
  monthly: { dayOfMonth: true, weekday: false, monthOfYear: false },
  every_n_months: { dayOfMonth: true, weekday: false, monthOfYear: false },
  quarterly: { dayOfMonth: true, weekday: false, monthOfYear: false },
  yearly: { dayOfMonth: true, weekday: false, monthOfYear: true },
  weekly: { dayOfMonth: false, weekday: true, monthOfYear: false },
  biweekly: { dayOfMonth: false, weekday: true, monthOfYear: false },
};

/**
 * Sprowadza terminarz do pól, które dla danej częstotliwości coś znaczą.
 *
 * Formularz przy zmianie częstotliwości może zostawić stary dzień miesiąca obok nowego
 * dnia tygodnia. Zapisany nie zmieniłby terminów, ale mylił każdego, kto czyta regułę —
 * więc nieużywane pola są czyszczone, a `intervalCount` poza `every_n_months` to `1`.
 *
 * @param rule - Terminarz z żądania.
 * @returns Terminarz z wyzerowanymi polami bez znaczenia.
 */
export function normalizeSchedule<T extends RecurringSchedule>(rule: T): T {
  const uses = USES[rule.frequency];
  return {
    ...rule,
    intervalCount: rule.frequency === 'every_n_months' ? rule.intervalCount : 1,
    dayOfMonth: uses.dayOfMonth ? rule.dayOfMonth : null,
    weekday: uses.weekday ? rule.weekday : null,
    monthOfYear: uses.monthOfYear ? rule.monthOfYear : null,
  };
}

/**
 * Sprawdza terminarz: wymagane pola częstotliwości, zakres miesięcy, kotwicę `biweekly`.
 *
 * @param rule - Terminarz (przy `PATCH` — po scaleniu z bieżącym stanem).
 * @returns Lista problemów; pusta, gdy terminarz jest poprawny.
 */
export function recurringScheduleIssues(rule: RecurringSchedule): TransactionIssue[] {
  const issues: TransactionIssue[] = [];
  const uses = USES[rule.frequency];
  if (uses.dayOfMonth && rule.dayOfMonth === null) {
    issues.push({ path: 'dayOfMonth', message: 'Podaj dzień miesiąca' });
  }
  if (uses.weekday && rule.weekday === null) {
    issues.push({ path: 'weekday', message: 'Podaj dzień tygodnia' });
  }
  if (uses.monthOfYear && rule.monthOfYear === null) {
    issues.push({ path: 'monthOfYear', message: 'Podaj miesiąc' });
  }
  if (rule.frequency === 'every_n_months' && rule.intervalCount < 2) {
    issues.push({
      path: 'intervalCount',
      message: 'Co ile miesięcy — co najmniej 2 (co miesiąc to „co miesiąc")',
    });
  }
  if (rule.endMonth !== null && rule.endMonth < rule.startMonth) {
    issues.push({
      path: 'endMonth',
      message: 'Miesiąc końca nie może być wcześniejszy niż miesiąc startu',
    });
  }
  if (
    rule.frequency === 'biweekly' &&
    rule.weekday !== null &&
    weekdayOf(rule.anchorDate) !== rule.weekday
  ) {
    issues.push({
      path: 'anchorDate',
      message: 'Pierwszy termin musi wypadać w wybrany dzień tygodnia',
    });
  }
  if (rule.frequency === 'biweekly' && rule.anchorDate.slice(0, 7) < rule.startMonth) {
    issues.push({
      path: 'anchorDate',
      message: 'Pierwszy termin nie może być wcześniejszy niż miesiąc startu',
    });
  }
  return issues;
}

/** Reguła w całości — terminarz i pola transakcji, którą tworzy. */
export interface RecurringRuleShape extends RecurringSchedule {
  readonly flow: TransactionType;
  readonly accountId: string | null;
  readonly counterAccountId: string | null;
  readonly incomeSourceId: string | null;
  readonly liabilityId: string | null;
  readonly allocationOverride: 'none' | 'savings' | 'investment' | null;
}

/**
 * Wszystkie reguły kształtu reguły cyklicznej.
 *
 * Transakcja, którą reguła utworzy, musi spełniać te same niezmienniki co wpisana ręcznie
 * (I-2, I-3, I-7a) — inaczej błąd wyszedłby dopiero przy księgowaniu, miesiące po zapisie
 * reguły. Dlatego te same `transactionShapeIssues`, plus terminarz.
 *
 * @param rule - Reguła (przy `PATCH` — po scaleniu).
 * @returns Lista problemów; pusta, gdy reguła jest poprawna.
 */
export function recurringRuleShapeIssues(rule: RecurringRuleShape): TransactionIssue[] {
  return [
    ...transactionShapeIssues({
      type: rule.flow,
      accountId: rule.accountId,
      counterAccountId: rule.counterAccountId,
      incomeSourceId: rule.incomeSourceId,
      liabilityId: rule.liabilityId,
      allocationOverride: rule.allocationOverride,
    }),
    ...recurringScheduleIssues(rule),
  ];
}

/**
 * Termin reguły opłacony transakcją, z której reguła powstała — „Zapisz jako wydatek
 * stały" (`F4-8`, ADR-051): termin miesiąca transakcji najbliższy jej dacie, przy remisie
 * wcześniejszy. Czynsz zapłacony 8. przy regule „10. dnia" opłaca termin 10., a nie
 * zostawia go do zapłacenia drugi raz.
 *
 * @param rule - Terminarz reguły.
 * @param month - Miesiąc transakcji.
 * @param bookedOn - Data transakcji.
 * @returns Data terminu albo `undefined`, gdy w tym miesiącu reguła nie ma terminu.
 */
export function sourcePaymentDueOn(
  rule: RecurringSchedule,
  month: MonthKey,
  bookedOn: string,
): string | undefined {
  const paid = dayNumber(bookedOn);
  const distance = (date: string): number => Math.abs(dayNumber(date) - paid);
  return [...occurrenceDatesForMonth(rule, month)].sort(
    (a, b) => distance(a) - distance(b) || a.localeCompare(b),
  )[0];
}

/**
 * Kolejne terminy reguły po transakcji źródłowej — podgląd w formularzu, zanim reguła
 * powstanie. Terminy miesiąca transakcji do opłaconego włącznie odpadają: opłacony jest
 * nią samą, wcześniejsze serwer zapisuje jako pominięte.
 *
 * @param rule - Terminarz reguły.
 * @param month - Miesiąc transakcji.
 * @param bookedOn - Data transakcji.
 * @param count - Ile terminów zwrócić.
 * @returns Do `count` dat rosnąco.
 */
export function dueDatesAfterSource(
  rule: RecurringSchedule,
  month: MonthKey,
  bookedOn: string,
  count: number,
): string[] {
  const paidOn = sourcePaymentDueOn(rule, month, bookedOn);
  const from = paidOn === undefined ? `${month}-01` : paidOn;
  return upcomingDueDates(rule, from, count + 1)
    .filter((date) => paidOn === undefined || date > paidOn)
    .slice(0, count);
}
