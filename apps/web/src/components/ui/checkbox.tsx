import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Pole wyboru ([15 §4.10](../../../../../plans/15-design-system.md#410-pozostałe)).
 *
 * Sam kwadrat ma 20 × 20 px, ale obszar dotyku daje `<label>` obejmujący **cały
 * wiersz** — inaczej trafienie w 20 px kciukiem na 390 px jest loterią.
 */

/** Właściwości pola wyboru. */
export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Pole wyboru z etykietą.
 *
 * @param props - Właściwości komponentu.
 * @param props.checked - Stan zaznaczenia.
 * @param props.onCheckedChange - Wywoływane przy zmianie.
 * @param props.disabled - Stan wyłączony.
 * @param props.children - Etykieta.
 * @param props.className - Dodatkowe klasy.
 * @returns Element pola wyboru.
 */
export function Checkbox({
  checked,
  onCheckedChange,
  disabled = false,
  children,
  className,
}: CheckboxProps): ReactNode {
  return (
    <label
      className={cn(
        'flex min-h-touch cursor-pointer items-center gap-3 py-2',
        disabled ? 'cursor-not-allowed opacity-50' : '',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-disabled={disabled}
        onChange={(event) => {
          onCheckedChange(event.target.checked);
        }}
        className={cn(
          // `accent-primary`, NIE `text-primary`: natywne pole wyboru ignoruje `color`
          // i maluje zaznaczenie kolorem `accent-color`. Bez tego przeglądarka używa
          // własnego, jaskrawego błękitu — czyli surowego koloru spoza tokenów,
          // czego zabrania `15 §3`.
          'h-5 w-5 shrink-0 rounded border border-border bg-transparent accent-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      />
      <span className="min-w-0 flex-1 text-sm">{children}</span>
    </label>
  );
}
