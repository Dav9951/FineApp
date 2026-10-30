import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Pierścień i pasek postępu
 * ([15 §4.7](../../../../../plans/15-design-system.md#47-progressring-i-progressbar)).
 *
 * **Ścieżka pierścienia nie może używać `--muted`.** Wobec `--card` daje to około 1,2:1,
 * więc przy wykonaniu ujemnym, gdy nic jej nie wypełnia, pierścień po prostu znika
 * i nie widać, do czego odnosi się liczba w środku. `--muted-foreground` z alfą `.45`
 * daje 2,0–2,5:1 w obu motywach.
 *
 * **Wartość ujemna** (ADR-011) to najtrudniejszy przypadek w tej aplikacji: łuk biegnie
 * w lewo, rysowany jako **ślad kropek**, a nie ciągła linia — ciągła czytałaby się jak
 * postęp w drugą stronę.
 */

/** Pula, której dotyczy postęp; niesie kolor. */
export type ProgressPool = 'savings' | 'investment' | 'debt';

/** Kolory puli jako zmienne CSS. */
const POOL_STROKE: Record<ProgressPool, string> = {
  savings: 'hsl(var(--savings))',
  investment: 'hsl(var(--investment))',
  debt: 'hsl(var(--debt))',
};

/** Klasy tekstu dla puli. */
const POOL_TEXT: Record<ProgressPool, string> = {
  savings: 'text-savings',
  investment: 'text-investment',
  debt: 'text-debt',
};

/** Maksymalna długość łuku ujemnego jako ułamek obwodu. */
const NEGATIVE_ARC_LIMIT = 0.4;

/** Wymiary pierścienia z `15 §4.7`. */
const RING_SIZE = 96;
const RING_STROKE = 9;

/** Minus typograficzny (U+2212) — w kroju tabelarycznym ma szerokość cyfry. */
const MINUS = '−';

/**
 * Buduje ścieżkę łuku zaczynającego się na godzinie dwunastej.
 *
 * Łuk jest rysowany poleceniem `A`, a nie przesunięciem `stroke-dashoffset`, bo tylko
 * tutaj kierunek jest **jawny**: flaga `sweep` mówi wprost, czy łuk biegnie w prawo,
 * czy w lewo. Przy `dashoffset` kierunek wychodzi z transformacji i przy wartości
 * ujemnej (ADR-011) łatwo go odwrócić przypadkiem.
 *
 * @param ratio - Ułamek obwodu (0–1).
 * @param clockwise - Czy łuk biegnie zgodnie z ruchem wskazówek.
 * @returns Atrybut `d` ścieżki.
 */
function arcPath(ratio: number, clockwise: boolean): string {
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const center = RING_SIZE / 2;
  const angle = Math.min(Math.max(ratio, 0), 1) * 2 * Math.PI;
  const direction = clockwise ? 1 : -1;
  const endX = center + direction * radius * Math.sin(angle);
  const endY = center - radius * Math.cos(angle);
  const largeArc = angle > Math.PI ? 1 : 0;
  const sweep = clockwise ? 1 : 0;

  return [
    `M ${String(center)} ${String(center - radius)}`,
    `A ${String(radius)} ${String(radius)} 0 ${String(largeArc)} ${String(sweep)}`,
    `${String(endX)} ${String(endY)}`,
  ].join(' ');
}

/** Właściwości pierścienia. */
export interface ProgressRingProps {
  /** Wykonanie w punktach bazowych; `10000` = 100%. Może być ujemne (ADR-011). */
  valueBps: number;
  pool: ProgressPool;
  /** Czy cel jest zrealizowany — decyduje o kształcie znacznika, nie tylko kolorze. */
  achieved?: boolean;
  /** Treść pod wartością procentową, zwykle kwota. */
  caption?: ReactNode;
  className?: string;
}

/**
 * Pierścień wykonania celu procentowego.
 *
 * @param props - Właściwości komponentu.
 * @param props.valueBps - Wykonanie w punktach bazowych.
 * @param props.pool - Pula niosąca kolor.
 * @param props.achieved - Czy cel osiągnięty.
 * @param props.caption - Podpis pod wartością.
 * @param props.className - Dodatkowe klasy.
 * @returns Element pierścienia.
 */
export function ProgressRing({
  valueBps,
  pool,
  achieved = false,
  caption,
  className,
}: ProgressRingProps): ReactNode {
  const center = RING_SIZE / 2;
  const radius = (RING_SIZE - RING_STROKE) / 2;

  const negative = valueBps < 0;
  const percent = Math.round(Math.abs(valueBps) / 100);
  const percentText = `${negative ? MINUS : ''}${String(percent)}%`;

  // Ubytek ponad 40% obwodu nie niesie już informacji, a zaczyna wyglądać jak postęp
  // w drugą stronę — dlatego długość łuku ujemnego jest ograniczona.
  const fillRatio = negative
    ? Math.min(Math.abs(valueBps) / 10_000, NEGATIVE_ARC_LIMIT)
    : Math.min(valueBps / 10_000, 1);
  const overflowRatio = Math.min(Math.max(valueBps - 10_000, 0) / 10_000, 1);

  return (
    <div className={cn('inline-flex flex-col items-center gap-1', className)}>
      <svg
        aria-label={`Wykonanie ${percentText}${achieved ? ', cel osiągnięty' : ''}`}
        height={RING_SIZE}
        role="img"
        viewBox={`0 0 ${String(RING_SIZE)} ${String(RING_SIZE)}`}
        width={RING_SIZE}
      >
        {/* Ścieżka: --muted-foreground z alfą .45, NIGDY --muted (kontrast 1,2:1). */}
        <circle
          cx={center}
          cy={center}
          fill="none"
          r={radius}
          stroke="hsl(var(--muted-foreground) / .45)"
          strokeWidth={RING_STROKE}
        />

        {fillRatio >= 1 ? (
          <circle
            cx={center}
            cy={center}
            fill="none"
            r={radius}
            stroke={POOL_STROKE[pool]}
            strokeWidth={RING_STROKE}
          />
        ) : (
          <path
            d={arcPath(fillRatio, !negative)}
            data-testid="ring-fill"
            fill="none"
            stroke={negative ? 'hsl(var(--expense))' : POOL_STROKE[pool]}
            strokeLinecap="round"
            // Ujemne: ślad kropek zamiast ciągłej linii — ciągła czytałaby się jak postęp.
            strokeDasharray={negative ? `1 ${String(RING_STROKE * 1.6)}` : undefined}
            strokeWidth={RING_STROKE}
          />
        )}

        {/* Przekroczenie 100%: cieńszy łuk --success na wierzchu. */}
        {overflowRatio > 0 ? (
          <path
            d={arcPath(overflowRatio, true)}
            data-testid="ring-overflow"
            fill="none"
            stroke="hsl(var(--success))"
            strokeLinecap="round"
            strokeWidth={RING_STROKE / 2}
          />
        ) : null}

        {/* W punkcie zero pełna kropka — widać, skąd ubytek się zaczyna. */}
        {negative ? (
          <circle
            cx={center}
            cy={RING_STROKE / 2}
            data-testid="ring-zero-dot"
            fill="hsl(var(--expense))"
            r={RING_STROKE / 2}
          />
        ) : null}
      </svg>

      <span
        className={cn(
          'font-numeric text-lg font-semibold tabular-nums',
          negative ? 'text-expense' : POOL_TEXT[pool],
        )}
      >
        {percentText}
      </span>
      {caption ? <span className="text-caption text-muted-foreground">{caption}</span> : null}
      {/* Kształt, nie tylko kolor (15 §2.4). */}
      <span aria-hidden="true" className={cn('text-caption', POOL_TEXT[pool])}>
        {achieved ? '●' : '○'}
      </span>
    </div>
  );
}

/** Właściwości paska postępu. */
export interface ProgressBarProps {
  /** Wykonanie w punktach bazowych. */
  valueBps: number;
  pool: ProgressPool;
  /** Znacznik celu jako ułamek szerokości (0–1). */
  targetRatio?: number;
  /** Etykieta pod paskiem, np. ostrzeżenie o tempie. */
  note?: ReactNode;
  /** Nazwa paska dla czytnika ekranu; pominięta — z puli („Realizacja: oszczędności"). */
  label?: string;
  className?: string;
}

/** Domyślna nazwa paska — `role="progressbar"` bez nazwy to błąd WCAG 4.1.2 (axe, `F8-4`). */
const POOL_LABEL: Record<ProgressPool, string> = {
  savings: 'Realizacja: oszczędności',
  investment: 'Realizacja: inwestycje',
  debt: 'Realizacja: spłata długu',
};

/**
 * Pasek postępu.
 *
 * Kolor niesie **pulę, nie ocenę**: poniżej tempa zmienia się etykieta pod paskiem,
 * a nie kolor samego paska.
 *
 * @param props - Właściwości komponentu.
 * @param props.valueBps - Wykonanie w punktach bazowych.
 * @param props.pool - Pula niosąca kolor.
 * @param props.targetRatio - Pozycja znacznika celu.
 * @param props.note - Etykieta pod paskiem.
 * @param props.label - Nazwa dla czytnika ekranu.
 * @param props.className - Dodatkowe klasy.
 * @returns Element paska.
 */
export function ProgressBar({
  valueBps,
  pool,
  targetRatio,
  note,
  label,
  className,
}: ProgressBarProps): ReactNode {
  const ratio = Math.max(0, Math.min(valueBps / 10_000, 1));
  const achieved = valueBps >= 10_000;

  return (
    <div className={cn('w-full', className)}>
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label ?? POOL_LABEL[pool]}
        // `aria-valuenow` musi mieścić się w zakresie; prawdziwą wartość — także ponad
        // 100% i ujemną (ADR-011) — niesie `aria-valuetext`.
        aria-valuenow={Math.max(0, Math.min(Math.round(valueBps / 100), 100))}
        aria-valuetext={`${valueBps < 0 ? MINUS : ''}${String(Math.round(Math.abs(valueBps) / 100))}%`}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${String(ratio * 100)}%`,
            backgroundColor: achieved ? 'hsl(var(--success))' : POOL_STROKE[pool],
          }}
        />
        {targetRatio !== undefined ? (
          <span
            aria-hidden="true"
            className="absolute top-0 h-full w-px bg-foreground"
            style={{ left: `${String(Math.min(Math.max(targetRatio, 0), 1) * 100)}%` }}
          />
        ) : null}
      </div>
      {note ? <p className="mt-1 text-caption text-warning">{note}</p> : null}
    </div>
  );
}
