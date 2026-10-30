import type { TransactionDayTotal, TransactionListItemDto, TransactionType } from '@fineapp/shared';

/**
 * Czyste reguły ekranu historii — grupowanie po dniach, tytuł i podpis wiersza
 * ([06 §3.2](../../../../../plans/06-ui-views.md#32-historia-transakcji--mmonthtransactions)).
 */

/** Grupa jednego dnia. */
export interface DayGroup {
  readonly bookedOn: string;
  /** Wpływy minus wydatki dnia; przelewy nie wchodzą (ADR-003). */
  readonly netMinor: number;
  readonly items: readonly TransactionListItemDto[];
}

/**
 * Grupuje wczytane transakcje po dniu księgowania, w kolejności listy.
 *
 * Suma dnia pochodzi z podsumowania serwera (ADR-038), bo dzień rozcięty granicą strony
 * pokazywałby sumę połowy transakcji. Sumowanie wczytanych wierszy zostaje wyłącznie
 * jako zapas, gdy podsumowania brak — np. dzień dopisany po jego pobraniu.
 *
 * @param items - Wczytane transakcje, od najnowszej.
 * @param days - Sumy dni z podsumowania.
 * @returns Grupy dni w kolejności pierwszego wystąpienia.
 */
export function groupByDay(
  items: readonly TransactionListItemDto[],
  days: readonly TransactionDayTotal[] = [],
): DayGroup[] {
  const totals = new Map(days.map((day) => [day.bookedOn, day.incomeMinor - day.expenseMinor]));
  const groups = new Map<string, TransactionListItemDto[]>();
  for (const item of items) {
    const group = groups.get(item.bookedOn);
    if (group) group.push(item);
    else groups.set(item.bookedOn, [item]);
  }
  return [...groups].map(([bookedOn, dayItems]) => ({
    bookedOn,
    netMinor: totals.get(bookedOn) ?? loadedNetMinor(dayItems),
    items: dayItems,
  }));
}

/**
 * Wpływy minus wydatki wczytanych, zaksięgowanych i nieusuniętych transakcji.
 *
 * @param items - Transakcje jednego dnia.
 * @returns Suma netto w groszach.
 */
function loadedNetMinor(items: readonly TransactionListItemDto[]): number {
  let net = 0;
  for (const item of items) {
    if (item.status !== 'posted' || item.deletedAt !== null) continue;
    if (item.type === 'income') net += item.amountMinor;
    if (item.type === 'expense') net -= item.amountMinor;
  }
  return net;
}

/**
 * Nagłówek grupy dnia: „czwartek, 18 września".
 *
 * Strefa UTC, bo data biznesowa to napis bez godziny — w strefie przeglądarki na zachód
 * od Greenwich północ UTC to jeszcze poprzedni dzień.
 *
 * @param dateOnly - Data `YYYY-MM-DD`.
 * @returns Dzień tygodnia, dzień i miesiąc w dopełniaczu.
 */
export function dayHeading(dateOnly: string): string {
  return new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${dateOnly}T00:00:00Z`));
}

/**
 * Inicjały autora — przy dwóch osobach w domu to istotny kontekst (06 §3.2).
 *
 * @param displayName - Nazwa wyświetlana.
 * @returns Do dwóch wielkich liter; pusty napis dla pustej nazwy.
 */
export function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0] ?? '';
  const letters =
    words.length === 1 ? [...first].slice(0, 1) : [first, words.at(-1) ?? ''].map((w) => [...w][0]);
  return letters.join('').toLocaleUpperCase('pl-PL');
}

/** Nazwa typu, gdy transakcja nie ma nic lepszego do pokazania. */
const TYPE_LABEL: Readonly<Record<TransactionType, string>> = {
  expense: 'Wydatek',
  income: 'Przychód',
  transfer: 'Przelew',
};

/**
 * Tytuł wiersza: to, po czym człowiek rozpoznaje transakcję.
 *
 * Kolejność: sprzedawca („Lidl") → opis → dla przelewu kierunek → kategoria → typ.
 * Kategoria jest dopiero czwarta, bo ląduje w podpisie — tytuł „Jedzenie" przy
 * podpisie „Jedzenie" to ta sama informacja dwa razy.
 *
 * @param item - Transakcja.
 * @returns Tytuł wiersza.
 */
export function transactionTitle(item: TransactionListItemDto): string {
  if (item.merchant) return item.merchant;
  if (item.description) return item.description;
  if (item.type === 'transfer') return transferRoute(item);
  return item.categoryName ?? TYPE_LABEL[item.type];
}

/**
 * Kierunek przelewu: „ROR → Oszczędności".
 *
 * @param item - Przelew.
 * @returns Konto źródłowe i docelowe.
 */
function transferRoute(item: TransactionListItemDto): string {
  return `${item.accountName ?? '?'} → ${item.counterAccountName ?? '?'}`;
}

/**
 * Części podpisu wiersza: kategoria · konto · autor (06 §3.2).
 *
 * Kategoria wypada, gdy już jest tytułem; przelew zamiast konta pokazuje kierunek,
 * o ile ten nie jest tytułem. Pochodzenie (paragon, reguła cykliczna) i kosz niesie
 * komponent jako ikonę i plakietkę — tutaj tylko tekst.
 *
 * @param item - Transakcja.
 * @returns Niepuste części podpisu w kolejności wyświetlania.
 */
export function captionParts(item: TransactionListItemDto): string[] {
  const title = transactionTitle(item);
  const parts: string[] = [];
  if (item.categoryName && item.categoryName !== title) parts.push(item.categoryName);
  if (item.type === 'income' && item.incomeSourceName) parts.push(item.incomeSourceName);
  if (item.type === 'transfer') {
    const route = transferRoute(item);
    if (route !== title) parts.push(route);
  } else if (item.accountName) {
    parts.push(item.accountName);
  }
  const author = initials(item.createdByName);
  if (author) parts.push(author);
  return parts;
}
