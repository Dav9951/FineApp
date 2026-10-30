import type { MonthKey } from '@fineapp/shared';

/**
 * Siatka 12 miesięcy przełącznika ([06 §3.1](../../../../../plans/06-ui-views.md#31-miesiąc-dashboard--mmonth),
 * `F3-5`) — czysta logika bez Reacta, testowana osobno.
 */

/** Komórka siatki miesięcy. */
export interface MonthCell {
  readonly month: MonthKey;
  /** Skrót nazwy, np. `wrz`. */
  readonly short: string;
  /** Pełna nazwa do etykiety dostępności. */
  readonly label: string;
  readonly hasData: boolean;
  readonly isCurrent: boolean;
  readonly isSelected: boolean;
  readonly isFuture: boolean;
}

/** Skróty nazw miesięcy — `Intl` daje „wrz" z kropką albo bez, zależnie od silnika. */
const SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

/** Pełne nazwy w mianowniku. */
const FULL = [
  'styczeń',
  'luty',
  'marzec',
  'kwiecień',
  'maj',
  'czerwiec',
  'lipiec',
  'sierpień',
  'wrzesień',
  'październik',
  'listopad',
  'grudzień',
];

/**
 * Siatka 12 miesięcy jednego roku (06 §3.1, `F3-5`).
 *
 * Miesiące bez danych są wyszarzone, ale klikalne; przyszłe też — to podgląd planu.
 *
 * @param year - Rok siatki.
 * @param available - Miesiące z danymi.
 * @param currentMonth - Bieżący miesiąc.
 * @param selected - Oglądany miesiąc.
 * @returns Dwanaście komórek od stycznia.
 */
export function monthGrid(
  year: number,
  available: readonly MonthKey[],
  currentMonth: MonthKey,
  selected: MonthKey,
): MonthCell[] {
  const withData = new Set(available);
  return SHORT.map((short, index) => {
    const month = `${String(year).padStart(4, '0')}-${String(index + 1).padStart(2, '0')}`;
    return {
      month,
      short,
      label: `${FULL[index] ?? short} ${String(year)}`,
      hasData: withData.has(month),
      isCurrent: month === currentMonth,
      isSelected: month === selected,
      isFuture: month > currentMonth,
    };
  });
}

/**
 * Rok klucza miesiąca.
 *
 * @param month - Klucz miesiąca.
 * @returns Rok jako liczba.
 */
export function yearOf(month: MonthKey): number {
  return Number(month.slice(0, 4));
}
