import { currentMonthKey, isValidMonthKey, type MonthKey } from '@fineapp/shared';
import { useParams } from 'react-router-dom';

/**
 * Miesiąc z adresu — **jedyne** źródło informacji o oglądanym miesiącu.
 *
 * Miesiąc jest w URL, a nie w stanie komponentu, bo dzięki temu przycisk „wstecz"
 * w przeglądarce cofa do poprzednio oglądanego miesiąca, a link da się wysłać drugiej
 * osobie w domu ([06 §2](../../../../plans/06-ui-views.md#2-nawigacja)).
 *
 * @param timezone - Strefa gospodarstwa; używana wyłącznie jako zapas, gdy adres nie
 *   niesie poprawnego miesiąca.
 * @returns Klucz miesiąca `YYYY-MM`.
 */
export function useMonthParam(timezone = 'Europe/Warsaw'): MonthKey {
  const { month } = useParams<{ month: string }>();
  if (month && isValidMonthKey(month)) return month;
  return currentMonthKey(timezone);
}
