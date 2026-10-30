import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Sekcje i kafle ([15 §4.5](../../../../../plans/15-design-system.md#45-card--section)).
 *
 * **To jest miejsce, w którym kierunek „Papier" najbardziej odbiega od typowej
 * aplikacji.** Sekcja dashboardu nie ma tła ani cienia — rozdziela ją włosowa linia
 * i odstęp 24 px. Odstęp jest **minimalny, nie estetyczny**: przy 12 px linie zlewają
 * się w kreskowanie i siedem sekcji czyta się jak jedna tabela.
 */

/** Właściwości sekcji. */
export interface SectionProps {
  /** Etykieta nagłówka; wersaliki, 12 px. */
  title?: string;
  /** Akcja po prawej stronie nagłówka. */
  action?: ReactNode;
  /** `plain` — bez tła, z górną linią. `raised` — kafel z tłem i obramowaniem. */
  variant?: 'plain' | 'raised';
  /** Pierwsza sekcja na ekranie nie ma górnej linii. */
  first?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Sekcja treści.
 *
 * @param props - Właściwości komponentu.
 * @param props.title - Etykieta nagłówka.
 * @param props.action - Akcja po prawej stronie nagłówka.
 * @param props.variant - Wariant wizualny.
 * @param props.first - Czy to pierwsza sekcja na ekranie.
 * @param props.children - Treść sekcji.
 * @param props.className - Dodatkowe klasy.
 * @returns Element sekcji.
 */
export function Section({
  title,
  action,
  variant = 'plain',
  first = false,
  children,
  className,
}: SectionProps): ReactNode {
  return (
    <section
      className={cn(
        variant === 'plain'
          ? cn('pt-6', first ? '' : 'mt-6 border-t border-border')
          : 'rounded-lg border border-border bg-card p-4',
        className,
      )}
    >
      {title || action ? (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title ? (
            <h2 className="text-caption font-medium uppercase tracking-[.1em] text-muted-foreground">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Właściwości kafla. */
export interface CardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Kafel z tłem — arkusze, modale, kafle kont, układ desktopowy.
 *
 * @param props - Właściwości komponentu.
 * @param props.children - Treść kafla.
 * @param props.className - Dodatkowe klasy.
 * @returns Element kafla.
 */
export function Card({ children, className }: CardProps): ReactNode {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>{children}</div>
  );
}
