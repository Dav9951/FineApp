import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Szkielet ładowania ([15 §4.9](../../../../../plans/15-design-system.md#49-stany-ekranu)).
 *
 * **Kształt docelowej treści, nie spinner.** Szkielet ma odtwarzać układ, który zaraz
 * się pojawi, żeby po dojściu danych nic nie przeskoczyło — dlatego zamiast jednego
 * uniwersalnego prostokąta komponent dostaje warianty o wymiarach realnych elementów.
 *
 * Animacja jest wyłączana przez `prefers-reduced-motion` (`motion-reduce:animate-none`),
 * bo pulsowanie siedmiu bloków naraz to dokładnie ten rodzaj ruchu, który ta preferencja
 * ma wyciszać ([15 §2.11](../../../../../plans/15-design-system.md#2-zasady-nienegocjowalne)).
 */

/** Właściwości szkieletu. */
export interface SkeletonProps {
  className?: string;
}

/**
 * Prostokąt zastępujący treść w trakcie ładowania.
 *
 * @param props - Właściwości komponentu.
 * @param props.className - Wymiary i zaokrąglenie konkretnego zastosowania.
 * @returns Element szkieletu.
 */
export function Skeleton({ className }: SkeletonProps): ReactNode {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded bg-muted motion-reduce:animate-none', className)}
    />
  );
}

/** Właściwości szkieletu wiersza listy. */
export interface SkeletonRowProps {
  /** Czy pokazać miejsce na podpis pod nazwą. */
  caption?: boolean;
  className?: string;
}

/**
 * Szkielet wiersza listy — odwzorowuje układ `<ListRow>` co do wysokości.
 *
 * Wysokość bierze się z `min-h-touch`, a nie z sumy wysokości prostokątów: wiersz
 * docelowy ma cel dotykowy 44 px niezależnie od tego, ile danych niesie, więc szkielet
 * musi mieć tyle samo, inaczej lista „usiądzie" po wczytaniu.
 *
 * @param props - Właściwości komponentu.
 * @param props.caption - Czy wiersz docelowy ma podpis.
 * @param props.className - Dodatkowe klasy.
 * @returns Element szkieletu wiersza.
 */
export function SkeletonRow({ caption = true, className }: SkeletonRowProps): ReactNode {
  return (
    <div className={cn('flex min-h-touch items-center gap-3 py-2', className)}>
      <Skeleton className="h-8 w-8 shrink-0 rounded" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-2/5" />
        {caption ? <Skeleton className="h-3 w-1/4" /> : null}
      </div>
      <Skeleton className="h-4 w-20 shrink-0" />
    </div>
  );
}

/** Właściwości listy szkieletów. */
export interface SkeletonListProps {
  /** Liczba wierszy; domyślnie tyle, ile mieści się na 390 × 844 px bez przewijania. */
  rows?: number;
  caption?: boolean;
  className?: string;
}

/**
 * Kilka szkieletów wierszy pod rząd.
 *
 * @param props - Właściwości komponentu.
 * @param props.rows - Liczba wierszy.
 * @param props.caption - Czy wiersze mają podpisy.
 * @param props.className - Dodatkowe klasy.
 * @returns Element listy szkieletów.
 */
export function SkeletonList({
  rows = 5,
  caption = true,
  className,
}: SkeletonListProps): ReactNode {
  return (
    <div className={cn('divide-y divide-border', className)} role="status" aria-label="Ładowanie">
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonRow key={index} caption={caption} />
      ))}
    </div>
  );
}
