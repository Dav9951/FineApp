import type { MonthKey } from '@fineapp/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { IconButton } from './button.js';
import { monthGrid, yearOf } from './month-grid.js';
import { Sheet } from './sheet.js';

/**
 * Siatka 12 miesięcy × wybór roku ([06 §3.1](../../../../../plans/06-ui-views.md#31-miesiąc-dashboard--mmonth),
 * `F3-5`) — otwierana dotknięciem nazwy miesiąca w `<MonthSwitcher>`.
 *
 * Miesiące bez danych są wyszarzone, ale klikalne; bieżący ma kropkę pod nazwą
 * (kształt, nie tylko kolor — 15 §2.4), oglądany — ramkę.
 *
 * **Wybór to przycisk, nie odnośnik.** Arkusz trzyma wpis historii (przycisk „wstecz"
 * go zamyka), a zamknięcie zdejmuje ten wpis asynchronicznie. Przejście pod nowy adres
 * w tej samej chwili zostałoby tym cofnięciem odwołane — więc najpierw zamknięcie,
 * a nawigacja dopiero po `popstate` (ta sama pułapka co w ADR-037 i ADR-038).
 */

/** Właściwości siatki. */
export interface MonthGridSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Oglądany miesiąc. */
  month: MonthKey;
  /** Bieżący miesiąc gospodarstwa. */
  currentMonth: MonthKey;
  /** Miesiące z danymi; `undefined` — jeszcze nie wiadomo (wszystkie bez wyszarzenia). */
  available: readonly MonthKey[] | undefined;
  /** Przejście do wybranego miesiąca. */
  onPick: (month: MonthKey) => void;
}

/**
 * Arkusz z siatką miesięcy.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana otwarcia.
 * @param props.month - Oglądany miesiąc.
 * @param props.currentMonth - Bieżący miesiąc.
 * @param props.available - Miesiące z danymi.
 * @param props.onPick - Wybór miesiąca.
 * @returns Element arkusza.
 */
export function MonthGridSheet({
  open,
  onOpenChange,
  month,
  currentMonth,
  available,
  onPick,
}: MonthGridSheetProps): ReactNode {
  const [year, setYear] = useState(() => yearOf(month));
  const cells = monthGrid(year, available ?? [], currentMonth, month);

  const pick = (picked: MonthKey): void => {
    if (picked !== month) {
      window.addEventListener(
        'popstate',
        () => {
          onPick(picked);
        },
        { once: true },
      );
    }
    onOpenChange(false);
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open} title="Wybierz miesiąc">
      <div className="flex items-center justify-between">
        <IconButton
          className="border-0"
          label={`Rok ${String(year - 1)}`}
          onClick={() => {
            setYear(year - 1);
          }}
        >
          <ChevronLeft aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </IconButton>
        <h3 aria-live="polite" className="font-numeric text-lg font-semibold tabular-nums">
          {year}
        </h3>
        <IconButton
          className="border-0"
          label={`Rok ${String(year + 1)}`}
          onClick={() => {
            setYear(year + 1);
          }}
        >
          <ChevronRight aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </IconButton>
      </div>
      <ul className="mt-3 grid grid-cols-4 gap-2 pb-2">
        {cells.map((cell) => (
          <li key={cell.month}>
            <button
              aria-current={cell.isSelected ? 'date' : undefined}
              aria-label={`${cell.label}${cell.hasData ? '' : ', bez danych'}${cell.isCurrent ? ', bieżący' : ''}`}
              className={cn(
                'flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-md border text-sm font-medium',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-muted',
                cell.isSelected ? 'border-2 border-primary' : 'border-border',
                available !== undefined && !cell.hasData ? 'text-muted-foreground' : '',
              )}
              onClick={() => {
                pick(cell.month);
              }}
              type="button"
            >
              {cell.short}
              <span
                aria-hidden="true"
                className={cn(
                  'h-1 w-1 rounded-full',
                  cell.isCurrent ? 'bg-primary' : 'bg-transparent',
                )}
              />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
