/**
 * Arytmetyka i formatowanie pieniądza.
 *
 * **Wyłącznie liczby całkowite w groszach** ([07 §8](../../../../plans/07-domain-rules.md#8-pieniądz)).
 * `1234` to `12,34 zł`. Nigdy nie liczymy na wartościach po sformatowaniu i nigdy nie
 * przechowujemy kwot jako liczb zmiennoprzecinkowych.
 */

/** Liczba groszy w złotówce. */
const MINOR_PER_UNIT = 100;

/** Liczba punktów bazowych odpowiadająca 100%. */
const BPS_PER_UNIT = 10_000;

/** Spacja niełamliwa (U+00A0) — separator tysięcy. */
const NBSP = '\u00A0';

/** Minus typograficzny (U+2212). */
const MINUS = '\u2212';

/** Łącznik (U+002D), którego używa `Intl` i którego nie chcemy w kwotach. */
const HYPHEN = '-';

/**
 * Zaokrągla połówki w górę **co do wartości bezwzględnej**.
 *
 * Jedna reguła w całej aplikacji ([07 §8.3](../../../../plans/07-domain-rules.md#83-zaokrąglanie)).
 * Zapewnia symetrię: `+2,5 → +3`, `−2,5 → −3`. Wbudowane `Math.round` daje tu `−2`,
 * przez co kwota i jej przeciwność przestają się znosić — a wykonanie alokacji liczone
 * netto (ADR-011) operuje na wartościach obu znaków.
 *
 * @param value - Wartość do zaokrąglenia.
 * @returns Liczba całkowita.
 */
export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Wylicza udział kwoty w podstawie, w punktach bazowych.
 *
 * @param amountMinor - Kwota.
 * @param baseMinor - Podstawa (np. wpływy miesiąca).
 * @returns Udział w bps; `0`, gdy podstawa jest zerowa lub ujemna.
 */
export function toBps(amountMinor: number, baseMinor: number): number {
  // Procent przy zerowej podstawie to `0` i flaga po stronie wołającego — nigdy
  // `NaN` ani `Infinity` (12 §6). Miesiąc bez wpływów jest normalnym stanem aplikacji.
  if (baseMinor <= 0) return 0;
  return roundHalfAwayFromZero((amountMinor * BPS_PER_UNIT) / baseMinor);
}

/**
 * Wylicza kwotę odpowiadającą udziałowi w podstawie.
 *
 * @param bps - Udział w punktach bazowych.
 * @param baseMinor - Podstawa.
 * @returns Kwota w groszach.
 */
export function fromBps(bps: number, baseMinor: number): number {
  return roundHalfAwayFromZero((bps * baseMinor) / BPS_PER_UNIT);
}

/**
 * Dzieli kwotę na części tak, by ich suma równała się dokładnie kwocie wejściowej.
 *
 * Reszta z dzielenia jest rozdawana po jednym groszu, począwszy od pierwszej części.
 * Naiwne `round(total / n)` dla każdej części potrafi zgubić albo wytworzyć grosze —
 * przy dzieleniu paragonu suma pozycji przestaje wtedy zgadzać się z sumą na paragonie.
 *
 * Dla kwoty ujemnej reszta rozdawana jest w tę samą stronę, więc suma nadal się zgadza.
 *
 * @param totalMinor - Kwota do podziału (liczba całkowita groszy).
 * @param parts - Liczba części (> 0).
 * @returns Tablica kwot sumująca się dokładnie do `totalMinor`.
 * @throws {TypeError} Gdy kwota nie jest całkowita albo liczba części jest nieprawidłowa.
 */
export function splitEvenly(totalMinor: number, parts: number): number[] {
  if (!Number.isInteger(totalMinor)) {
    throw new TypeError(`money: kwota musi być całkowitą liczbą groszy: ${String(totalMinor)}`);
  }
  if (!Number.isInteger(parts) || parts < 1) {
    throw new TypeError(
      `money: liczba części musi być dodatnią liczbą całkowitą: ${String(parts)}`,
    );
  }
  const sign = totalMinor < 0 ? -1 : 1;
  const absolute = Math.abs(totalMinor);
  const base = Math.floor(absolute / parts);
  const remainder = absolute - base * parts;
  return Array.from(
    { length: parts },
    (_unused, index) => sign * (base + (index < remainder ? 1 : 0)),
  );
}

/**
 * Zamienia tekst z pola formularza na grosze.
 *
 * Akceptuje przecinek i kropkę jako separator dziesiętny, spacje (również niełamliwe)
 * jako separator tysięcy oraz opcjonalny sufiks waluty. **Odrzuca wejście z więcej niż
 * dwoma cyframi po separatorze** — cichy zapis `10,999 zł` jako `10,99 zł` byłby gorszy
 * od komunikatu o błędzie.
 *
 * @param input - Tekst wpisany przez użytkownika, np. `"1 234,56 zł"`.
 * @returns Kwota w groszach albo `null`, gdy tekstu nie da się zinterpretować.
 */
export function parseAmountToMinor(input: string): number | null {
  if (typeof input !== 'string') return null;

  const normalized = input
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(/(zł|PLN)$/iu, '')
    .replace(new RegExp(`^[${MINUS}${HYPHEN}]`, 'u'), HYPHEN)
    .replace(',', '.');

  if (normalized.length === 0) return null;

  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;

  const [, sign, whole, fraction = ''] = match;
  const grosze = Number(whole) * MINOR_PER_UNIT + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(grosze)) return null;
  return sign === HYPHEN ? -grosze : grosze;
}

/**
 * Buduje formatter walutowy o własnościach wymaganych przez `07 §8.5`.
 *
 * `Intl` samo z siebie nie grupuje kwot czterocyfrowych (`1234,56 zł` zamiast
 * `1 234,56 zł`), więc grupowanie jest wymuszone.
 *
 * @param currency - Kod waluty ISO 4217.
 * @param locale - Ustawienia regionalne.
 * @returns Formatter `Intl.NumberFormat`.
 */
function currencyFormatter(currency: string, locale: string): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    useGrouping: 'always',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formatuje kwotę w groszach jako tekst w walucie.
 *
 * Znak minus to `−` (U+2212), nie łącznik: w kroju o cyfrach tabelarycznych ma
 * szerokość cyfry, więc kolumna kwot się nie rozjeżdża ([07 §8.5](../../../../plans/07-domain-rules.md#85-formatowanie)).
 *
 * @param minor - Kwota w groszach.
 * @param currency - Kod waluty ISO 4217.
 * @param locale - Ustawienia regionalne.
 * @returns Sformatowana kwota, np. `1 234,56 zł`.
 */
export function formatMinor(minor: number, currency = 'PLN', locale = 'pl-PL'): string {
  const formatted = currencyFormatter(currency, locale).format(minor / MINOR_PER_UNIT);
  return formatted.replace(HYPHEN, MINUS);
}

/**
 * Formatuje kwotę skrótowo — **wyłącznie na wykresach**, gdzie brakuje miejsca.
 *
 * Nigdy na listach ani w podsumowaniach: `12,3 tys. zł` zamiast `12 345,67 zł` ukrywa
 * grosze, a w budżecie domowym to one się liczą.
 *
 * @param minor - Kwota w groszach.
 * @param currency - Kod waluty ISO 4217.
 * @param locale - Ustawienia regionalne.
 * @returns Skrócona kwota, np. `12,3 tys. zł`.
 */
export function formatMinorCompact(minor: number, currency = 'PLN', locale = 'pl-PL'): string {
  const symbol = currency === 'PLN' ? 'zł' : currency;
  const formatted = new Intl.NumberFormat(locale, {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(minor / MINOR_PER_UNIT);
  return `${formatted.replace(HYPHEN, MINUS)}${NBSP}${symbol}`;
}

/**
 * Formatuje kwotę **bez groszy** — do zestawień, w których liczy się porównanie.
 *
 * To nie jest to samo co `formatMinorCompact`: tamta skraca rząd wielkości na wykresie
 * (`12,3 tys. zł`), ta zostawia pełną liczbę i ucina tylko końcówkę groszową
 * (`2 360 zł`). Używa jej wariant `compact` komponentu `<Money>` przy pierścieniach
 * celów i paskach postępu ([15 §4.1](../../../../plans/15-design-system.md#41-money)),
 * gdzie „2 000 / 2 360 zł" czyta się jednym rzutem oka, a „2 000,00 / 2 360,00 zł"
 * już nie.
 *
 * Kwota jest **zaokrąglana, nie ucinana**: przy ucinaniu `999,99 zł` pokazałoby się
 * jako `999 zł`, czyli mniej, niż jest naprawdę. Pełna wartość i tak zostaje
 * w `aria-label`, więc czytnik ekranu nie traci ani grosza.
 *
 * @param minor - Kwota w groszach.
 * @param currency - Kod waluty ISO 4217.
 * @param locale - Ustawienia regionalne.
 * @returns Kwota bez części groszowej, np. `2 360 zł`.
 */
export function formatMinorWhole(minor: number, currency = 'PLN', locale = 'pl-PL'): string {
  const units = roundHalfAwayFromZero(minor / MINOR_PER_UNIT);
  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    useGrouping: 'always',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(units);
  return formatted.replace(HYPHEN, MINUS);
}

/**
 * Sumuje kwoty w groszach.
 *
 * Istnieje po to, żeby w kodzie domenowym nie pojawiał się `reduce` z jawnym zerem —
 * a przy okazji pilnuje, że sumujemy liczby całkowite.
 *
 * @param amounts - Kwoty w groszach.
 * @returns Suma w groszach.
 * @throws {TypeError} Gdy któraś kwota nie jest liczbą całkowitą.
 */
export function sumMinor(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) {
    if (!Number.isInteger(amount)) {
      throw new TypeError(`money: kwota musi być całkowitą liczbą groszy: ${String(amount)}`);
    }
    total += amount;
  }
  return total;
}
