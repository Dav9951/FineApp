import type {
  AllocationKind,
  TransactionSort,
  TransactionSource,
  TransactionType,
} from '@fineapp/shared';

import type { TransactionRow } from '../../db/schema/transactions.js';

/**
 * Typy wewnętrzne modułu transakcji — kształty wymieniane między serwisem
 * a repozytorium, niewidoczne w kontrakcie API.
 */

/** Miejsce na liście, od którego zaczyna się kolejna strona (paginacja kursorowa). */
export interface CursorPosition {
  /** Wartość kolumny sortowania ostatniego wiersza poprzedniej strony. */
  readonly value: string | number;
  /** Identyfikator ostatniego wiersza — rozstrzyga remisy wartości sortowania. */
  readonly id: string;
}

/**
 * Filtry listy po normalizacji w serwisie.
 *
 * Puste tablice nie występują: brak filtra to `undefined`. Tekst wyszukiwania jest już
 * sprowadzony przez `foldForSearch`.
 */
export interface TransactionListFilter {
  readonly monthKey?: string;
  readonly from?: string;
  readonly to?: string;
  readonly types?: readonly TransactionType[];
  /** Konto po **dowolnej** stronie: źródłowe albo docelowe przelewu. */
  readonly accountIds?: readonly string[];
  readonly categoryIds?: readonly string[];
  /** Tylko transakcje bez kategorii (`Z-18`). */
  readonly uncategorized?: boolean;
  readonly goalIds?: readonly string[];
  readonly liabilityIds?: readonly string[];
  readonly plannedExpenseIds?: readonly string[];
  readonly incomeSourceIds?: readonly string[];
  readonly allocationKinds?: readonly AllocationKind[];
  readonly sources?: readonly TransactionSource[];
  readonly search?: string;
  readonly minAmountMinor?: number;
  readonly maxAmountMinor?: number;
  readonly includeDeleted: boolean;
  readonly sort: TransactionSort;
  readonly after?: CursorPosition;
  /** Ile wierszy pobrać — serwis prosi o jeden więcej, żeby wiedzieć, czy jest dalej. */
  readonly take: number;
}

/** Wiersz transakcji z nazwami powiązanych bytów — do list i szczegółów. */
export interface TransactionListItemRow extends TransactionRow {
  readonly accountName: string | null;
  readonly counterAccountName: string | null;
  readonly categoryName: string | null;
  readonly categoryIcon: string | null;
  readonly categoryColor: string | null;
  readonly incomeSourceName: string | null;
  readonly goalName: string | null;
  readonly liabilityName: string | null;
  readonly createdByName: string;
}
