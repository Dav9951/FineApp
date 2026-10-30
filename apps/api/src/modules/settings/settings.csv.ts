import type { TransactionType } from '@fineapp/shared';

/**
 * Eksport transakcji do CSV — `GET /settings/export.csv`
 * ([04 §15](../../../../../../plans/04-api-spec.md#15-ustawienia--apiv1settings)).
 *
 * Plik ma się otworzyć **dwuklikiem w polskim Excelu** i od razu dać się sumować, więc:
 *
 * - separator `;` — przy przecinku dziesiętnym Excel w polskich ustawieniach tak dzieli
 *   kolumny; LibreOffice i Arkusze Google pytają albo rozpoznają same;
 * - BOM UTF-8 na początku — bez niego Excel czyta „ż" jako „Ĺź";
 * - kwota ze **znakiem** (wydatek ujemny) i przecinkiem, bez separatora tysięcy
 *   i bez „zł" — wtedy komórka jest liczbą, a nie tekstem;
 * - zwykły łącznik jako minus, nie typograficzny `−` z interfejsu — arkusz nie
 *   rozpoznałby go jako znaku liczby.
 *
 * Pola tekstowe zaczynające się od `=`, `+`, `-`, `@` dostają apostrof na początku:
 * opis z paragonu w rodzaju `=HYPERLINK(...)` byłby inaczej wykonany jako formuła
 * (CSV injection, 09 §8).
 */

/** Transakcja w kształcie potrzebnym do wiersza CSV. */
export interface CsvTransaction {
  id: string;
  type: TransactionType;
  status: string;
  bookedOn: string;
  monthKey: string;
  amountMinor: number;
  currency: string;
  accountId: string | null;
  counterAccountId: string | null;
  categoryId: string | null;
  incomeSourceId: string | null;
  description: string | null;
  merchant: string | null;
  notes: string | null;
  source: string;
}

/** Słowniki nazw dla wierszy CSV. */
export interface CsvNames {
  accounts: ReadonlyMap<string, string>;
  categories: ReadonlyMap<string, { name: string; parentId: string | null }>;
  incomeSources: ReadonlyMap<string, string>;
}

/** Nagłówek pliku — kolejność kolumn. */
export const CSV_HEADER = [
  'Data',
  'Miesiąc',
  'Typ',
  'Kwota',
  'Waluta',
  'Konto',
  'Konto docelowe',
  'Kategoria',
  'Źródło przychodu',
  'Opis',
  'Sprzedawca',
  'Notatki',
  'Status',
  'Pochodzenie',
  'Identyfikator',
] as const;

const TYPE_LABEL: Record<TransactionType, string> = {
  expense: 'Wydatek',
  income: 'Przychód',
  transfer: 'Przelew',
};

const STATUS_LABEL: Readonly<Record<string, string>> = {
  posted: 'zaksięgowana',
  pending: 'oczekująca',
  void: 'anulowana',
};

const SOURCE_LABEL: Readonly<Record<string, string>> = {
  manual: 'ręcznie',
  ocr: 'dokument',
  recurring: 'cykliczna',
  planned: 'planowany wydatek',
  import: 'import',
};

/** Znak kolejności bajtów UTF-8 — Excel bez niego źle czyta polskie znaki. */
export const UTF8_BOM = '﻿';

/**
 * Kwota w groszach jako liczba dla arkusza: `-1234,56`.
 *
 * Działamy na liczbach całkowitych — żadnego `toFixed` na ułamku (reguła 1 z `CLAUDE.md`).
 *
 * @param minor - Kwota w groszach, ze znakiem.
 * @returns Kwota z przecinkiem dziesiętnym, bez separatora tysięcy.
 */
export function csvAmount(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100);
  const cents = abs % 100;
  return `${sign}${String(whole)},${String(cents).padStart(2, '0')}`;
}

/**
 * Kwota ze znakiem z perspektywy gospodarstwa.
 *
 * Wydatek zmniejsza majątek — ujemny; przychód dodatni; przelew nie zmienia majątku,
 * więc zostaje dodatni i opisany dwoma kontami. Dzięki temu suma kolumny bez
 * przelewów to wynik miesiąca.
 *
 * @param type - Typ transakcji.
 * @param amountMinor - Kwota zapisana (zawsze dodatnia).
 * @returns Kwota ze znakiem.
 */
export function signedAmountMinor(type: TransactionType, amountMinor: number): number {
  return type === 'expense' ? -amountMinor : amountMinor;
}

/**
 * Zabezpiecza pole tekstowe przed wykonaniem jako formuła i przed rozbiciem kolumn.
 *
 * @param value - Wartość pola; `null` — pusta komórka.
 * @returns Pole gotowe do wstawienia w wiersz.
 */
export function csvText(value: string | null): string {
  if (value === null || value.length === 0) return '';
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return csvQuote(neutralized);
}

/**
 * Otacza pole cudzysłowem, gdy zawiera separator, cudzysłów albo koniec linii (RFC 4180).
 *
 * @param value - Wartość pola.
 * @returns Pole w cudzysłowie albo bez zmian.
 */
function csvQuote(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Pełna nazwa kategorii: „Jedzenie / Restauracje".
 *
 * @param categoryId - Kategoria transakcji.
 * @param names - Słownik kategorii.
 * @returns Ścieżka albo `null`, gdy brak kategorii.
 */
export function categoryPath(
  categoryId: string | null,
  names: CsvNames['categories'],
): string | null {
  if (categoryId === null) return null;
  const category = names.get(categoryId);
  if (category === undefined) return null;
  const parent = category.parentId === null ? undefined : names.get(category.parentId);
  return parent === undefined ? category.name : `${parent.name} / ${category.name}`;
}

/**
 * Buduje plik CSV z transakcji.
 *
 * @param rows - Transakcje od najstarszej.
 * @param names - Słowniki nazw.
 * @returns Treść pliku z BOM i końcami linii CRLF.
 */
export function buildTransactionsCsv(rows: readonly CsvTransaction[], names: CsvNames): string {
  const lines = [CSV_HEADER.join(';')];
  for (const row of rows) {
    const lookup = (map: ReadonlyMap<string, string>, id: string | null): string | null =>
      id === null ? null : (map.get(id) ?? null);
    lines.push(
      [
        row.bookedOn,
        row.monthKey,
        TYPE_LABEL[row.type],
        csvAmount(signedAmountMinor(row.type, row.amountMinor)),
        row.currency,
        csvText(lookup(names.accounts, row.accountId)),
        csvText(lookup(names.accounts, row.counterAccountId)),
        csvText(categoryPath(row.categoryId, names.categories)),
        csvText(lookup(names.incomeSources, row.incomeSourceId)),
        csvText(row.description),
        csvText(row.merchant),
        csvText(row.notes),
        STATUS_LABEL[row.status] ?? row.status,
        SOURCE_LABEL[row.source] ?? row.source,
        row.id,
      ].join(';'),
    );
  }
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}
