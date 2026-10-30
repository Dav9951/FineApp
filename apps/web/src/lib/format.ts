import { formatDateOnly, formatMinor, formatMinorCompact, formatMonth } from '@fineapp/shared';

/**
 * Formatowanie na potrzeby interfejsu.
 *
 * Moduł celowo **nie zawiera własnej arytmetyki** — reeksportuje helpery z
 * `@fineapp/shared`, żeby front i backend formatowały identycznie. Własna kopia
 * `toFixed(2)` w komponencie to najkrótsza droga do dwóch różnych zapisów tej samej
 * kwoty na jednym ekranie.
 *
 * Kwoty w JSX idą wyłącznie przez komponent `<Money>` (`15 §4`), a nie przez
 * bezpośrednie wywołanie `formatMinor`.
 */
export { formatDateOnly, formatMinor, formatMinorCompact, formatMonth };

/**
 * Formatuje datę biznesową skrótowo, do list transakcji.
 *
 * @param dateOnly - Data w formacie `YYYY-MM-DD`.
 * @param locale - Ustawienia regionalne.
 * @returns Data w postaci `18 wrz`.
 */
export function formatDateShort(dateOnly: string, locale = 'pl-PL'): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${dateOnly}T00:00:00Z`));
}

/**
 * Wybiera formę rzeczownika po liczebniku — polska odmiana: 1 transakcja, 2–4 transakcje,
 * 5 transakcji, ale 22 transakcje i 12 transakcji.
 *
 * @param count - Liczba.
 * @param one - Forma dla jedynki („transakcja").
 * @param few - Forma dla 2–4 z wyjątkiem 12–14 („transakcje").
 * @param many - Pozostałe („transakcji").
 * @returns Forma rzeczownika (bez liczby).
 */
export function pluralPl(count: number, one: string, few: string, many: string): string {
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  if (count === 1) return one;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

/**
 * Liczba transakcji z polską odmianą.
 *
 * @param count - Liczba transakcji.
 * @returns Liczba z rzeczownikiem w dobrej formie.
 */
export function transactionCountLabel(count: number): string {
  return `${String(count)} ${pluralPl(count, 'transakcja', 'transakcje', 'transakcji')}`;
}

/** Miesiąc w miejscowniku z przyimkiem: „we wrześniu", „w sierpniu". */
const MONTH_IN: readonly string[] = [
  'w styczniu',
  'w lutym',
  'w marcu',
  'w kwietniu',
  'w maju',
  'w czerwcu',
  'w lipcu',
  'w sierpniu',
  'we wrześniu',
  'w październiku',
  'w listopadzie',
  'w grudniu',
];

/**
 * Miesiąc z przyimkiem w miejscowniku — „Wpłacono we wrześniu".
 *
 * Przyimek jest częścią tabeli, bo „we" przed „wrześniu" to wyjątek, którego nie da się
 * dokleić regułą „w + nazwa".
 *
 * @param monthKey - Klucz miesiąca `YYYY-MM`.
 * @returns Fraza, np. `we wrześniu`.
 */
export function inMonth(monthKey: string): string {
  return MONTH_IN[Number(monthKey.slice(5, 7)) - 1] ?? monthKey;
}
