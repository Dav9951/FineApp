import { earliestPostableDate, formatDateOnly } from '../utils/month.js';

/**
 * Zamknięte miesiące — transakcje sprzed okna księgowania
 * ([07 §1.4](../../../../plans/07-domain-rules.md#14-zamknięte-miesiące),
 * [ADR-040](../../../../plans/14-decisions-log.md#adr-040)).
 *
 * Okno księgowania (I-8) chroni liczby zamkniętych miesięcy. Pilnowane tylko przy
 * zapisie daty dawało się obejść: zmiana kwoty wydatku z marca albo jego usunięcie
 * przechodziły, więc raport za marzec zmieniał się, choć „marzec jest zamknięty".
 * Reguła mieszka w `shared`, bo tę samą odpowiedź potrzebują serwis (`422`) i formularz
 * (zablokowane pola zamiast błędu po zapisie).
 */

/**
 * Pola, które wolno poprawić w transakcji z zamkniętego miesiąca — same opisy.
 *
 * Literówka w nazwie sklepu nie zmienia żadnej liczby; kwota, data, konto, kategoria,
 * źródło, cel, zobowiązanie i nadpisanie alokacji — każde zmienia jakiś raport.
 */
export const CLOSED_MONTH_EDITABLE_FIELDS = ['description', 'merchant', 'notes'] as const;

/** Pole edytowalne w zamkniętym miesiącu. */
export type ClosedMonthEditableField = (typeof CLOSED_MONTH_EDITABLE_FIELDS)[number];

/** Operacja na transakcji, której dotyczy blokada. */
export type ClosedMonthOperation = 'edit' | 'delete' | 'restore';

/**
 * Czy transakcja z tą datą leży w zamkniętym miesiącu.
 *
 * Granica jest ta sama co dolna granica okna księgowania — to jedna reguła widziana
 * z dwóch stron: czego nie wolno dopisać, tego nie wolno też zmienić ani usunąć.
 *
 * @param bookedOn - Data transakcji.
 * @param today - Dzisiejsza data w strefie gospodarstwa.
 * @param limitMonths - Limit księgowania wstecz z ustawień gospodarstwa.
 * @returns `true`, gdy liczby tej transakcji są zamrożone.
 */
export function isInClosedMonth(bookedOn: string, today: string, limitMonths: number): boolean {
  return bookedOn < earliestPostableDate(today, limitMonths);
}

/** Początek zdania komunikatu dla każdej operacji. */
const OPERATION_PREFIX: Readonly<Record<ClosedMonthOperation, string>> = {
  edit: 'Transakcja należy do zamkniętego miesiąca — można poprawić tylko opis, sprzedawcę i notatki',
  delete: 'Nie można usunąć transakcji z zamkniętego miesiąca',
  restore: 'Nie można przywrócić transakcji do zamkniętego miesiąca',
};

/**
 * Komunikat o blokadzie zamkniętego miesiąca.
 *
 * Wskazuje wyjście, jak komunikat okna księgowania z 07 §1.3: limit jest ustawieniem
 * gospodarstwa, a nie twardą granicą.
 *
 * @param operation - Zablokowana operacja.
 * @param today - Dzisiejsza data w strefie gospodarstwa.
 * @param limitMonths - Limit księgowania wstecz.
 * @returns Zdanie dla użytkownika.
 */
export function closedMonthMessage(
  operation: ClosedMonthOperation,
  today: string,
  limitMonths: number,
): string {
  const earliest = formatDateOnly(earliestPostableDate(today, limitMonths));
  return `${OPERATION_PREFIX[operation]}. Zmiany są możliwe od ${earliest} — zmień limit w ustawieniach.`;
}

/**
 * Wybiera ze zmian te, których w zamkniętym miesiącu robić nie wolno.
 *
 * @param changedFields - Nazwy pól, które edycja faktycznie zmienia.
 * @returns Pola spoza {@link CLOSED_MONTH_EDITABLE_FIELDS}, w kolejności wejścia.
 */
export function frozenFieldChanges(changedFields: readonly string[]): string[] {
  const allowed: readonly string[] = CLOSED_MONTH_EDITABLE_FIELDS;
  return changedFields.filter((field) => !allowed.includes(field));
}
