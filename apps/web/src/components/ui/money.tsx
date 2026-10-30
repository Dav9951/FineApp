import { formatMinor, formatMinorWhole, minorToWordsPl } from '@fineapp/shared';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Kwota — **najważniejszy komponent aplikacji**, bo pojawia się na każdym ekranie
 * ([15 §4.1](../../../../../plans/15-design-system.md#41-money)).
 *
 * Kolor pochodzi **wyłącznie z wariantu**, nigdy z zewnątrz: gdyby dało się go podać
 * propsem, prędzej czy później wydatek gdzieś zaświeciłby na zielono. Z tego samego
 * powodu `className` nie może nadpisać koloru — dokłada się przed klasą wariantu,
 * więc `twMerge` rozstrzyga konflikt na rzecz wariantu.
 */

/** Wariant kwoty — niesie kolor i regułę znaku. */
export type MoneyVariant =
  'neutral' | 'income' | 'expense' | 'savings' | 'investment' | 'debt' | 'compact';

/** Rozmiar kwoty; odpowiada skali stopni pisma z `15 §3.3`. */
export type MoneySize = 'meta' | 'sm' | 'base' | 'lg' | 'amount' | 'hero';

/** Klasy koloru dla wariantów. */
const VARIANT_CLASS: Record<MoneyVariant, string> = {
  neutral: 'text-foreground',
  income: 'text-income',
  expense: 'text-expense',
  savings: 'text-savings',
  investment: 'text-investment',
  debt: 'text-debt',
  compact: 'text-foreground',
};

/** Warianty, przy których kwota dostaje jawny znak. */
const SIGNED_VARIANTS: ReadonlySet<MoneyVariant> = new Set<MoneyVariant>(['income', 'expense']);

/**
 * Przelicza kwotę na wartość **pokazywaną**.
 *
 * Transakcje trzymają kwotę jako wielkość dodatnią, a kierunek niesie typ
 * ([03 §4](../../../../../plans/03-data-model.md)). Wariant `expense` odwraca więc znak:
 * `8990` to na ekranie `−89,90 zł`, a korekta wydatku (`−8990`) to `+89,90 zł`.
 *
 * Wartość wyliczona tu zasila **jednocześnie** tekst i `aria-label` — gdyby znak
 * powstawał osobno przy każdym z nich, czytnik ekranu mógłby odczytać wydatek jako
 * wpływ, a błąd byłby niewidoczny dla osoby patrzącej na ekran.
 *
 * @param amountMinor - Kwota w groszach.
 * @param variant - Wariant kwoty.
 * @returns Kwota ze znakiem takim, jaki widać na ekranie.
 */
function displayMinorOf(amountMinor: number, variant: MoneyVariant): number {
  // Zero jest odbijane jawnie, bo `-0` to w JavaScripcie osobna wartość, a `Intl`
  // formatuje ją jako „−0,00 zł" — czyli wydatek zerowy dostawałby znak wbrew regule
  // „zero nigdy nie dostaje znaku" (15 §4.1).
  if (amountMinor === 0) return 0;
  return variant === 'expense' ? -amountMinor : amountMinor;
}

/** Klasy rozmiaru. */
const SIZE_CLASS: Record<MoneySize, string> = {
  meta: 'text-meta',
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
  amount: 'text-amount',
  hero: 'text-hero',
};

/** Właściwości komponentu kwoty. */
export interface MoneyProps {
  /** Kwota w groszach. */
  amountMinor: number;
  /** Wariant niosący kolor i regułę znaku. */
  variant?: MoneyVariant;
  size?: MoneySize;
  /** `false` ukrywa `zł` — używane, gdy waluta pada raz na parę kwot. */
  unit?: boolean;
  currency?: string;
  locale?: string;
  className?: string;
}

/**
 * Składa tekst kwoty wraz ze znakiem.
 *
 * `formatMinor` sam stawia minus typograficzny przy wartości ujemnej, więc dokładamy
 * tylko plus — i tylko tam, gdzie wariant niesie kierunek. **Zero nigdy nie dostaje
 * znaku**: „+0,00 zł" sugerowałoby wpływ, którego nie było.
 *
 * @param displayMinor - Kwota w groszach, już ze znakiem ekranowym.
 * @param variant - Wariant kwoty.
 * @param unit - Czy pokazać jednostkę.
 * @param currency - Kod waluty.
 * @param locale - Ustawienia regionalne.
 * @returns Tekst gotowy do wyświetlenia.
 */
function formatForDisplay(
  displayMinor: number,
  variant: MoneyVariant,
  unit: boolean,
  currency: string,
  locale: string,
): string {
  // `formatMinorWhole`, NIE `formatMinorCompact`: wariant `compact` z `15 §4.1` pomija
  // grosze („2 360 zł"), a nie skraca rząd wielkości („2,4 tys. zł"). Ta druga postać
  // należy do wykresów i na pierścieniu celu ukryłaby różnicę, którą właśnie ma pokazać.
  const base =
    variant === 'compact'
      ? formatMinorWhole(displayMinor, currency, locale)
      : formatMinor(displayMinor, currency, locale);

  // Jednostkę odcinamy razem ze spacją niełamliwą, która ją poprzedza. Zapis `\u00A0`,
  // a nie sam znak: spacja niełamliwa w kodzie jest nie do odróżnienia od zwykłej.
  const text = unit ? base : base.replace(/\u00A0\S+$/u, '');

  return displayMinor > 0 && SIGNED_VARIANTS.has(variant) ? `+${text}` : text;
}

/**
 * Wyświetla kwotę zgodnie z design systemem.
 *
 * @param props - Właściwości komponentu.
 * @param props.amountMinor - Kwota w groszach.
 * @param props.variant - Wariant niosący kolor i znak.
 * @param props.size - Rozmiar z skali stopni pisma.
 * @param props.unit - Czy pokazać `zł`.
 * @param props.currency - Kod waluty.
 * @param props.locale - Ustawienia regionalne.
 * @param props.className - Dodatkowe klasy; nie nadpisze koloru wariantu.
 * @returns Element kwoty.
 */
export function Money({
  amountMinor,
  variant = 'neutral',
  size = 'base',
  unit = true,
  currency = 'PLN',
  locale = 'pl-PL',
  className,
}: MoneyProps): ReactNode {
  const displayMinor = displayMinorOf(amountMinor, variant);
  const text = formatForDisplay(displayMinor, variant, unit, currency, locale);

  // Wariant `compact` gubi grosze w warstwie wizualnej, ale czytnik ekranu dostaje
  // pełną wartość — nie traci ani grosza (15 §4.1). Odczyt idzie z tej samej wartości
  // co tekst, więc znak na ekranie i w słuchawkach nie może się rozjechać.
  const spoken = minorToWordsPl(displayMinor);

  return (
    <span
      // `className` przed wariantem: twMerge rozstrzyga konflikt koloru na rzecz wariantu.
      className={cn(
        'whitespace-nowrap font-numeric tabular-nums',
        className,
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
      )}
    >
      <span aria-hidden="true">{text}</span>
      {/* Odczyt jako tekst ukryty wizualnie, nie `aria-label`: etykieta na zwykłym `<span>`
          (rola `generic`) jest w ARIA 1.2 zabroniona i czytniki ją pomijają — axe
          w `F8-4` pokazał, że kwoty słowami nigdy nie docierały do użytkownika. */}
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
