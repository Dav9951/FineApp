/**
 * Odczyt kwoty słowami po polsku — na potrzeby `aria-label` komponentu `<Money>`
 * ([15 §4.1](../../../../plans/15-design-system.md#41-money)).
 *
 * Czytnik ekranu dostaje „minus sto dwadzieścia siedem złotych dziewięćdziesiąt
 * dziewięć groszy", a nie „minus sto dwadzieścia siedem przecinek dziewięćdziesiąt
 * dziewięć zet ł". Przy aplikacji, w której kwota jest na każdym ekranie, to różnica
 * między użytecznością a szumem.
 *
 * Moduł jest izomorficzny i czysty — zero zależności, pełne pokrycie testami.
 */

/** Jedności; formy żeńskie dla 1 i 2, bo odnoszą się do „złotówki" i „groszówki". */
const UNITS = [
  '',
  'jeden',
  'dwa',
  'trzy',
  'cztery',
  'pięć',
  'sześć',
  'siedem',
  'osiem',
  'dziewięć',
];

/** Liczebniki nastu. */
const TEENS = [
  'dziesięć',
  'jedenaście',
  'dwanaście',
  'trzynaście',
  'czternaście',
  'piętnaście',
  'szesnaście',
  'siedemnaście',
  'osiemnaście',
  'dziewiętnaście',
];

/** Dziesiątki. */
const TENS = [
  '',
  '',
  'dwadzieścia',
  'trzydzieści',
  'czterdzieści',
  'pięćdziesiąt',
  'sześćdziesiąt',
  'siedemdziesiąt',
  'osiemdziesiąt',
  'dziewięćdziesiąt',
];

/** Setki. */
const HUNDREDS = [
  '',
  'sto',
  'dwieście',
  'trzysta',
  'czterysta',
  'pięćset',
  'sześćset',
  'siedemset',
  'osiemset',
  'dziewięćset',
];

/** Formy rzeczowników wielkich liczb: [pojedyncza, mnoga „2–4", mnoga „5+"]. */
const SCALES: readonly (readonly [string, string, string])[] = [
  ['', '', ''],
  ['tysiąc', 'tysiące', 'tysięcy'],
  ['milion', 'miliony', 'milionów'],
  ['miliard', 'miliardy', 'miliardów'],
];

/**
 * Wybiera formę rzeczownika po liczebniku.
 *
 * Polska odmiana ma trzy przypadki: 1 → forma pojedyncza, 2–4 → mnoga bliska,
 * reszta → mnoga daleka. Wyjątkiem są liczby 12–14, które mimo końcówki 2–4 biorą
 * formę daleką („dwanaście złotych", nie „dwanaście złote”).
 *
 * @param count - Liczba, po której stoi rzeczownik.
 * @param forms - Trzy formy: pojedyncza, mnoga 2–4, mnoga 5+.
 * @returns Forma dopasowana do liczby.
 */
export function pluralPl(count: number, forms: readonly [string, string, string]): string {
  const absolute = Math.abs(count);
  if (absolute === 1) return forms[0];
  const last = absolute % 10;
  const lastTwo = absolute % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return forms[1];
  return forms[2];
}

/**
 * Zapisuje słowami liczbę z zakresu 0–999.
 *
 * @param value - Liczba 0–999.
 * @returns Zapis słowny; pusty napis dla zera.
 */
function threeDigitsToWords(value: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;

  if (hundreds > 0) parts.push(HUNDREDS[hundreds] as string);
  if (rest >= 10 && rest < 20) {
    parts.push(TEENS[rest - 10] as string);
  } else {
    const tens = Math.floor(rest / 10);
    const units = rest % 10;
    if (tens > 0) parts.push(TENS[tens] as string);
    if (units > 0) parts.push(UNITS[units] as string);
  }
  return parts.join(' ');
}

/**
 * Zapisuje słowami nieujemną liczbę całkowitą.
 *
 * @param value - Liczba nieujemna, nie większa niż 999 999 999 999.
 * @returns Zapis słowny; `zero` dla zera.
 * @throws {RangeError} Gdy liczba jest ujemna, niecałkowita albo poza zakresem.
 */
export function integerToWordsPl(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`money-words: oczekiwano nieujemnej liczby całkowitej: ${String(value)}`);
  }
  if (value === 0) return 'zero';

  const groups: number[] = [];
  let rest = value;
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  if (groups.length > SCALES.length) {
    throw new RangeError(`money-words: liczba poza obsługiwanym zakresem: ${String(value)}`);
  }

  const parts: string[] = [];
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index] as number;
    if (group === 0) continue;
    // „tysiąc", nie „jeden tysiąc" — liczebnik 1 przy skali jest domyślny.
    const spoken = index > 0 && group === 1 ? '' : threeDigitsToWords(group);
    const scale =
      index > 0 ? pluralPl(group, SCALES[index] as readonly [string, string, string]) : '';
    parts.push([spoken, scale].filter(Boolean).join(' '));
  }
  return parts.join(' ');
}

/**
 * Zapisuje kwotę w groszach słowami, z poprawną odmianą złotych i groszy.
 *
 * @param minor - Kwota w groszach; może być ujemna.
 * @returns Pełny odczyt, np. `minus sto dwadzieścia siedem złotych dziewięćdziesiąt dziewięć groszy`.
 * @throws {RangeError} Gdy kwota nie jest liczbą całkowitą.
 */
export function minorToWordsPl(minor: number): string {
  if (!Number.isInteger(minor)) {
    throw new RangeError(`money-words: kwota musi być całkowitą liczbą groszy: ${String(minor)}`);
  }

  const absolute = Math.abs(minor);
  const zloty = Math.floor(absolute / 100);
  const grosz = absolute % 100;

  const parts: string[] = [];
  if (minor < 0) parts.push('minus');
  parts.push(integerToWordsPl(zloty), pluralPl(zloty, ['złoty', 'złote', 'złotych']));
  // Grosze wymieniamy zawsze — „sto złotych" i „sto złotych zero groszy" to w kontekście
  // finansowym różnica między „około" a „dokładnie".
  parts.push(integerToWordsPl(grosz), pluralPl(grosz, ['grosz', 'grosze', 'groszy']));

  return parts.join(' ');
}
