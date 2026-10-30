import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Plakietka ([15 §4.10](../../../../../plans/15-design-system.md#410-pozostałe)).
 *
 * Liczniki używają `tabular-nums`, żeby plakietka nie zmieniała szerokości przy zmianie
 * cyfry — inaczej sąsiadujące elementy drgają przy każdym odświeżeniu.
 */

/** Ton plakietki; niesie znaczenie, nie tylko kolor. */
export type BadgeTone = 'warning' | 'success' | 'danger' | 'neutral';

/** Klasy tonów. */
const TONE_CLASS: Record<BadgeTone, string> = {
  warning: 'bg-warning/20 text-warning',
  success: 'bg-success/20 text-success',
  danger: 'bg-danger/20 text-danger',
  neutral: 'bg-muted text-muted-foreground',
};

/** Właściwości plakietki. */
export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

/**
 * Plakietka z licznikiem albo krótką etykietą.
 *
 * @param props - Właściwości komponentu.
 * @param props.tone - Ton niosący znaczenie.
 * @param props.children - Treść plakietki.
 * @param props.className - Dodatkowe klasy.
 * @returns Element plakietki.
 */
export function Badge({ tone = 'warning', children, className }: BadgeProps): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 text-[11px] font-bold tabular-nums',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
