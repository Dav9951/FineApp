import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Wiersz ustawienia ([15 §4.10](../../../../../plans/15-design-system.md#410-pozostałe)).
 *
 * Etykieta po lewej, wartość po prawej, `›` gdy dotknięcie otwiera arkusz.
 * Wysokość dotykowa nigdy nie schodzi poniżej 44 px, także gdy wiersz jest tylko
 * do odczytu — lista o nierównych wysokościach czyta się gorzej niż równa.
 */

/** Właściwości wiersza ustawienia. */
export interface FieldProps {
  label: string;
  /** Wartość po prawej stronie. */
  value?: ReactNode;
  /** Akcja otwierająca arkusz; obecność zamienia wiersz w przycisk. */
  onOpen?: () => void;
  /** Podpis pod etykietą — wyjaśnienie, nie powtórzenie. */
  hint?: string;
  className?: string;
}

/**
 * Wiersz ustawienia.
 *
 * @param props - Właściwości komponentu.
 * @param props.label - Etykieta po lewej.
 * @param props.value - Wartość po prawej.
 * @param props.onOpen - Akcja otwierająca arkusz.
 * @param props.hint - Podpis wyjaśniający.
 * @param props.className - Dodatkowe klasy.
 * @returns Element wiersza.
 */
export function Field({ label, value, onOpen, hint, className }: FieldProps): ReactNode {
  const content = (
    <>
      <span className="flex min-w-0 flex-col items-start">
        <span className="text-sm text-muted-foreground">{label}</span>
        {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm font-medium">
        {value}
        {onOpen ? (
          <span aria-hidden="true" className="text-muted-foreground">
            ›
          </span>
        ) : null}
      </span>
    </>
  );

  const shared = cn(
    'border-t border-border flex min-h-touch w-full items-center justify-between gap-3 py-2',
    className,
  );

  if (!onOpen) {
    return <div className={shared}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        shared,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-muted',
      )}
    >
      {content}
    </button>
  );
}
