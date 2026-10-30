import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Wiersz listy ([15 §4.8](../../../../../plans/15-design-system.md#48-listrow)) —
 * najczęściej powtarzany układ w aplikacji.
 *
 * ```
 * [ikona 32] [nazwa 14/500        ] [kwota 16/600]
 *            [podpis 12 --muted-fg ]
 * ```
 *
 * **Zmierzony budżet na 390 px:** po odjęciu marginesów, ikony i odstępu zostaje
 * 313 px. Przy kwocie 88 px nazwa dostaje 214 px — najdłuższa nazwa kategorii
 * domyślnej („Oprogramowanie i narzędzia") potrzebuje 172 px, więc się mieści.
 * Dlatego **kwota nigdy się nie skraca; skraca się nazwa obok niej**.
 */

/** Właściwości wiersza listy. */
export interface ListRowProps {
  /** Ikona 32 × 32 px po lewej. */
  icon?: ReactNode;
  /** Nazwa — 14 px / 500. */
  name: ReactNode;
  /** Podpis: data · konto · autor · źródło. */
  caption?: ReactNode;
  /** Kwota po prawej; zwykle `<Money>`. */
  amount?: ReactNode;
  /** Dotknięcie wiersza; obecność zamienia wiersz w przycisk. */
  onClick?: () => void;
  /** Nazwy kategorii zawijają się zamiast urywać. */
  wrapName?: boolean;
  /** Podpis zawija się zamiast urywać — gdy jego koniec niesie informację (np. „kwota szacunkowa"). */
  wrapCaption?: boolean;
  /** Pierwszy wiersz grupy nie ma górnej linii. */
  first?: boolean;
  className?: string;
}

/**
 * Wiersz transakcji albo pozycji.
 *
 * @param props - Właściwości komponentu.
 * @param props.icon - Ikona po lewej.
 * @param props.name - Nazwa pozycji.
 * @param props.caption - Podpis pod nazwą.
 * @param props.amount - Kwota po prawej.
 * @param props.onClick - Akcja po dotknięciu.
 * @param props.wrapName - Czy nazwa ma się zawijać.
 * @param props.wrapCaption - Czy podpis ma się zawijać.
 * @param props.first - Czy to pierwszy wiersz grupy.
 * @param props.className - Dodatkowe klasy.
 * @returns Element wiersza.
 */
export function ListRow({
  icon,
  name,
  caption,
  amount,
  onClick,
  wrapName = false,
  wrapCaption = false,
  first = false,
  className,
}: ListRowProps): ReactNode {
  const content = (
    <>
      {icon ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col items-start text-left">
        <span className={cn('text-sm font-medium', wrapName ? 'break-words' : 'w-full truncate')}>
          {name}
        </span>
        {caption ? (
          <span
            className={cn(
              'w-full text-left text-caption text-muted-foreground',
              wrapCaption ? 'break-words' : 'truncate',
            )}
          >
            {caption}
          </span>
        ) : null}
      </span>
      {amount ? <span className="shrink-0">{amount}</span> : null}
    </>
  );

  const shared = cn(
    'flex min-h-touch w-full items-center gap-3 py-2',
    first ? '' : 'border-t border-border',
    className,
  );

  if (!onClick) return <div className={shared}>{content}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
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
