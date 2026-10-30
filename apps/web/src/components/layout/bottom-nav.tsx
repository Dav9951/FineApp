import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import type { NavItem } from './nav-items.js';

/**
 * Dolny pasek zakładek ([06 §2](../../../../../plans/06-ui-views.md#2-nawigacja)).
 *
 * Pięć pozycji, stały, z `safe-area-inset-bottom`. Wysokość bierze się z tokenu
 * `--tabbar-height` (15 §3.4) — od tej samej wartości liczy pozycję FAB, więc liczba
 * zapisana tu drugi raz rozjechałaby się przy pierwszej zmianie.
 *
 * **Ikona nigdy nie stoi sama**: każda zakładka ma podpis
 * ([15 §6](../../../../../plans/15-design-system.md#6-ikonografia)).
 */

/** Właściwości paska zakładek. */
export interface BottomNavProps {
  items: readonly NavItem[];
  className?: string;
}

/**
 * Pasek zakładek widoczny na telefonie.
 *
 * @param props - Właściwości komponentu.
 * @param props.items - Pozycje paska.
 * @param props.className - Dodatkowe klasy.
 * @returns Element paska.
 */
export function BottomNav({ items, className }: BottomNavProps): ReactNode {
  return (
    <nav
      aria-label="Nawigacja główna"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card md:hidden',
        'pb-safe-bottom',
        className,
      )}
    >
      <ul className="flex h-tabbar items-stretch">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li className="flex-1" key={item.to}>
              {/* Dopasowanie liczy `NavLink` (`end` = pozycja bez ścieżek potomnych),
                  on też ustawia `aria-current`. Własne dopasowanie obok tego rozjeżdżało
                  się z jego własnym i `aria-current` lądowało na dwóch pozycjach naraz. */}
              <NavLink
                className={({ isActive }) =>
                  cn(
                    'flex h-full min-h-touch flex-col items-center justify-center gap-0.5',
                    'text-[11px] transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'focus-visible:ring-inset',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )
                }
                end={item.nested !== true}
                to={item.to}
              >
                <Icon aria-hidden="true" className="h-[21px] w-[21px]" strokeWidth={1.5} />
                {item.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
