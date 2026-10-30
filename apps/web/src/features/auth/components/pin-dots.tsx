import type { ReactNode } from 'react';

import { cn } from '../../../lib/cn.js';

/**
 * Wskaźnik postępu wpisywania PIN-u
 * ([06 §3.13](../../../../../../plans/06-ui-views.md#313-logowanie--login)).
 *
 * Kropki pokazują **ile cyfr wpisano**, nigdy jakie. Liczba kropek odpowiada
 * maksymalnej długości PIN-u, więc nie zdradza, ile cyfr ma konkretne konto.
 */

/** Właściwości wskaźnika. */
export interface PinDotsProps {
  /** Ile cyfr wpisano. */
  filled: number;
  /** Ile kropek pokazać. */
  length: number;
  /** Czy pokazać stan błędu. */
  invalid?: boolean;
  className?: string;
}

/**
 * Rząd kropek.
 *
 * @param props - Właściwości komponentu.
 * @param props.filled - Liczba wpisanych cyfr.
 * @param props.length - Liczba kropek.
 * @param props.invalid - Czy zaznaczyć błąd.
 * @param props.className - Dodatkowe klasy.
 * @returns Element wskaźnika.
 */
export function PinDots({ filled, length, invalid = false, className }: PinDotsProps): ReactNode {
  return (
    <div
      aria-label={`Wpisano ${String(filled)} z ${String(length)} cyfr`}
      className={cn('flex items-center justify-center gap-3', className)}
      role="status"
    >
      {Array.from({ length }, (_, index) => (
        <span
          aria-hidden="true"
          className={cn(
            'h-3 w-3 rounded-full border transition-colors',
            index < filled
              ? invalid
                ? 'border-danger bg-danger'
                : 'border-primary bg-primary'
              : 'border-muted-foreground/45 bg-transparent',
          )}
          key={index}
        />
      ))}
    </div>
  );
}
