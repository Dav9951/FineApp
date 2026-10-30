import { formatMonth, shiftMonth, type MonthKey } from '@fineapp/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { cn } from '../../lib/cn.js';
import { IconButton } from './button.js';

/**
 * Przełącznik miesiąca `‹ nazwa ›` ([15 §4.10](../../../../../plans/15-design-system.md#410-pozostałe)).
 *
 * Strzałki to **odnośniki**, nie przyciski: miesiąc jest w adresie (06 §2), więc
 * przejście do sąsiedniego miesiąca jest nawigacją — działa „wstecz" przeglądarki,
 * otwieranie w nowej karcie i podgląd adresu.
 *
 * Od `F3-5` dotknięcie nazwy otwiera siatkę 12 miesięcy (`<MonthGridSheet>`), o ile
 * ekran poda `onOpenPicker` — samą siatkę składa ekran, bo potrzebuje listy miesięcy
 * z danymi, a prymityw nie pobiera danych. Gest w bok i wstępne pobieranie sąsiadów
 * należą do ekranu miesiąca.
 */

/** Właściwości przełącznika. */
export interface MonthSwitcherProps {
  /** Oglądany miesiąc. */
  month: MonthKey;
  /** Adres ekranu dla danego miesiąca — np. z zachowaniem filtrów. */
  hrefFor: (month: MonthKey) => string;
  /** Poziom nagłówka nazwy miesiąca; ekran ma jeden `h1`. */
  as?: 'h1' | 'h2';
  /** Otwarcie siatki miesięcy; brak — nazwa jest samym tekstem. */
  onOpenPicker?: () => void;
  /** Przygaszony i nieaktywny — w trakcie wczytywania przełączanie nie ma sensu (15 §4.9). */
  dimmed?: boolean;
}

/**
 * Przełącznik miesiąca ze strzałkami 44 × 44 px.
 *
 * @param props - Właściwości komponentu.
 * @param props.month - Oglądany miesiąc.
 * @param props.hrefFor - Adres dla miesiąca.
 * @param props.as - Poziom nagłówka.
 * @param props.onOpenPicker - Otwarcie siatki miesięcy.
 * @param props.dimmed - Stan przygaszony.
 * @returns Element przełącznika.
 */
export function MonthSwitcher({
  month,
  hrefFor,
  as: Heading = 'h1',
  onOpenPicker,
  dimmed = false,
}: MonthSwitcherProps): ReactNode {
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const name = formatMonth(month);
  return (
    <div
      aria-busy={dimmed || undefined}
      className={cn(
        'flex min-w-0 items-center gap-1',
        dimmed ? 'pointer-events-none opacity-40' : '',
      )}
    >
      <IconButton
        asChild
        className="border-0"
        label={`Poprzedni miesiąc: ${formatMonth(previous)}`}
      >
        <Link to={hrefFor(previous)}>
          <ChevronLeft aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </Link>
      </IconButton>
      <Heading className="min-w-0 truncate whitespace-nowrap text-center text-base font-semibold sm:text-lg">
        {onOpenPicker ? (
          <button
            aria-haspopup="dialog"
            aria-label={`${name} — wybierz miesiąc`}
            className="min-h-touch max-w-full truncate rounded-md px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
            disabled={dimmed}
            onClick={onOpenPicker}
            type="button"
          >
            {name}
          </button>
        ) : (
          name
        )}
      </Heading>
      <IconButton asChild className="border-0" label={`Następny miesiąc: ${formatMonth(next)}`}>
        <Link to={hrefFor(next)}>
          <ChevronRight aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </Link>
      </IconButton>
    </div>
  );
}
