import {
  DateOnlySchema,
  earliestPostableDate,
  formatDateOnly,
  IdSchema,
  latestPostableDate,
  type TransactionSort,
} from '@fineapp/shared';

import { ValidationError } from '../../core/errors.js';
import type { TransactionRow } from '../../db/schema/transactions.js';
import type { CursorPosition } from './transactions.types.js';

/**
 * Czyste reguły modułu transakcji: okno księgowania (I-8), kursor listy, miesiące do
 * unieważnienia. Bez bazy i bez HTTP — testowane bezpośrednio.
 */

/**
 * Sprawdza, czy data mieści się w oknie księgowania (I-8, 07 §1.3).
 *
 * Dolna granica to **początek** miesiąca sprzed `limitMonths` miesięcy, górna — koniec
 * bieżącego miesiąca. Obie włącznie. Przyszłych transakcji nie księgujemy: od tego są
 * pozycje cykliczne; wpis z wyprzedzeniem w bieżącym miesiącu niczego nie psuje.
 *
 * @param bookedOn - Data transakcji.
 * @param today - Dzisiejsza data w strefie gospodarstwa.
 * @param limitMonths - Limit księgowania wstecz z ustawień gospodarstwa.
 * @param monthStartDay - Dzień rozpoczęcia miesiąca budżetowego.
 * @returns Komunikat dla użytkownika albo `null`, gdy data jest dozwolona.
 */
export function postingWindowViolation(
  bookedOn: string,
  today: string,
  limitMonths: number,
  monthStartDay: number,
): string | null {
  const earliest = earliestPostableDate(today, limitMonths);
  if (bookedOn < earliest) {
    return `Nie można księgować przed ${formatDateOnly(earliest)}. Zmień limit w ustawieniach.`;
  }
  const latest = latestPostableDate(today, monthStartDay);
  if (bookedOn > latest) {
    return `Nie można księgować po ${formatDateOnly(latest)} — przyszłe płatności zaplanuj jako pozycję cykliczną.`;
  }
  return null;
}

/**
 * Zwraca miesiące, których cache front ma unieważnić po zapisie.
 *
 * @param months - Miesiąc przed zmianą i po niej (mogą być równe).
 * @returns Klucze bez powtórzeń, rosnąco.
 */
export function affectedMonths(...months: readonly string[]): string[] {
  return [...new Set(months)].sort();
}

/** Kursor w postaci przed zakodowaniem. */
interface CursorPayload {
  /** Sortowanie, dla którego kursor powstał. */
  readonly s: TransactionSort;
  /** Wartość kolumny sortowania. */
  readonly v: string | number;
  /** Identyfikator ostatniego wiersza. */
  readonly i: string;
}

/**
 * Wartość kolumny sortowania dla wiersza.
 *
 * @param sort - Sortowanie listy.
 * @param row - Ostatni wiersz strony.
 * @returns Data, kwota albo znacznik utworzenia.
 */
function sortValue(
  sort: TransactionSort,
  row: Pick<TransactionRow, 'bookedOn' | 'amountMinor' | 'createdAt'>,
): string | number {
  if (sort.startsWith('bookedOn')) return row.bookedOn;
  if (sort.startsWith('amount')) return row.amountMinor;
  return row.createdAt;
}

/**
 * Koduje kursor następnej strony.
 *
 * Kursor jest **nieprzezroczysty** dla klienta (base64url z JSON-a) i niesie sortowanie,
 * dla którego powstał — kursor z listy po kwocie podany do listy po dacie wskazywałby
 * przypadkowe miejsce, więc zostanie odrzucony zamiast dać cicho złą stronę.
 *
 * @param sort - Sortowanie listy.
 * @param row - Ostatni wiersz bieżącej strony.
 * @returns Kursor do `meta.nextCursor`.
 */
export function encodeCursor(
  sort: TransactionSort,
  row: Pick<TransactionRow, 'id' | 'bookedOn' | 'amountMinor' | 'createdAt'>,
): string {
  const payload: CursorPayload = { s: sort, v: sortValue(sort, row), i: row.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Sprawdza, czy wartość z kursora ma typ zgodny z sortowaniem.
 *
 * @param sort - Sortowanie listy.
 * @param value - Wartość z kursora.
 * @returns `true`, gdy wartość da się porównać z kolumną sortowania.
 */
function isValidSortValue(sort: TransactionSort, value: unknown): boolean {
  if (sort.startsWith('bookedOn')) return DateOnlySchema.safeParse(value).success;
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * Odczytuje kursor z parametru zapytania.
 *
 * @param cursor - Wartość `cursor` z żądania.
 * @param sort - Sortowanie bieżącego żądania.
 * @returns Pozycja, za którą zaczyna się strona.
 * @throws {ValidationError} Gdy kursor jest uszkodzony albo powstał dla innego sortowania.
 */
export function decodeCursor(cursor: string, sort: TransactionSort): CursorPosition {
  const invalid = new ValidationError('Nieprawidłowy kursor listy. Odśwież listę.', [
    { path: 'cursor', message: 'Nieprawidłowy kursor' },
  ]);
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid;
  }
  if (typeof payload !== 'object' || payload === null) throw invalid;
  const { s, v, i } = payload as Record<string, unknown>;
  if (s !== sort || !isValidSortValue(sort, v) || !IdSchema.safeParse(i).success) throw invalid;
  return { value: v as string | number, id: i as string };
}
