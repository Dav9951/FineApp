import { useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import {
  separateLabels,
  seriesPath,
  trendScale,
  xOf,
  yOf,
  type TrendDatum,
  type TrendFrame,
} from './trend-geometry.js';

/**
 * Wykres liniowy „wykonanie vs plan" w kolejnych miesiącach (`F8-5`, 06 §3.6).
 *
 * Rysowany ręcznie w SVG, bez biblioteki: sześć punktów i dwie linie to kilkadziesiąt
 * linii kodu, a `recharts` dołożyłby ~100 kB do ekranu (budżet z 06 §6).
 *
 * Zasady z 15 §2 i skilla dataviz:
 * - kolory wyłącznie z tokenów `--chart-actual` / `--chart-plan`, zwalidowanych
 *   osobno dla obu motywów; podpisy w kolorach tekstu, nie serii;
 * - plan różni się od wykonania także **kreską** i brakiem znaczników — kolor nigdy
 *   nie jest jedynym nośnikiem;
 * - legenda zawsze, podpisy końców linii przy ostatnich punktach;
 * - dotknięcie kolumny miesiąca pokazuje jego wartości w wierszu nad wykresem (na
 *   telefonie „najechanie" nie istnieje), a pełne liczby są w tabeli pod wykresem.
 */

/** Punkt wykresu z etykietami. */
export interface TrendChartPoint extends TrendDatum {
  /** Stabilny klucz, np. klucz miesiąca. */
  readonly key: string;
  /** Krótka etykieta osi X („wrz"). */
  readonly label: string;
  /** Pełna nazwa do odczytu („wrzesień 2026"). */
  readonly title: string;
}

/** Właściwości wykresu. */
export interface TrendChartProps {
  points: readonly TrendChartPoint[];
  /** Formatowanie wartości w punktach bazowych, np. „27,0%". */
  format: (bps: number) => string;
  /** Formatowanie podziałki osi — krótsze niż wartości, np. „30%". */
  formatTick: (bps: number) => string;
  /** Opis wykresu dla czytnika ekranu. */
  label: string;
  className?: string;
}

const FRAME: TrendFrame = { width: 340, height: 176, left: 34, right: 64, top: 12, bottom: 24 };

/** Najmniejszy odstęp pionowy podpisów końców linii. */
const LABEL_GAP = 14;

/**
 * Wiersz odczytu wybranego miesiąca.
 *
 * @param props - Właściwości komponentu.
 * @param props.point - Wybrany punkt.
 * @param props.format - Formatowanie wartości.
 * @returns Element wiersza.
 */
function Readout({
  point,
  format,
}: {
  point: TrendChartPoint;
  format: (bps: number) => string;
}): ReactNode {
  return (
    <p aria-live="polite" className="text-sm">
      <span className="font-medium">{point.title}</span>
      <span className="text-muted-foreground">
        {' · wykonanie '}
        <span className="font-numeric tabular-nums text-foreground">
          {point.actual === null ? '—' : format(point.actual)}
        </span>
        {' · plan '}
        <span className="font-numeric tabular-nums text-foreground">
          {point.plan === null ? 'brak' : format(point.plan)}
        </span>
      </span>
    </p>
  );
}

/**
 * Wykres trendu.
 *
 * @param props - Właściwości komponentu.
 * @param props.points - Punkty od najstarszego.
 * @param props.format - Formatowanie wartości.
 * @param props.formatTick - Formatowanie podziałki osi.
 * @param props.label - Opis dla czytnika ekranu.
 * @param props.className - Dodatkowe klasy.
 * @returns Element wykresu albo nic przy braku punktów.
 */
export function TrendChart({
  points,
  format,
  formatTick,
  label,
  className,
}: TrendChartProps): ReactNode {
  const [active, setActive] = useState(points.length - 1);
  const selected = points[Math.min(active, points.length - 1)];
  if (selected === undefined) return null;

  const scale = trendScale(points);
  const count = points.length;
  const column = (FRAME.width - FRAME.left - FRAME.right) / count;
  const actualPath = seriesPath(
    points.map((p) => p.actual),
    scale,
    FRAME,
  );
  const planPath = seriesPath(
    points.map((p) => p.plan),
    scale,
    FRAME,
  );

  // Podpisy końców: przy ostatnim punkcie każdej serii, rozsunięte, gdy się nakładają.
  const lastActual = points.findLastIndex((p) => p.actual !== null);
  const lastPlan = points.findLastIndex((p) => p.plan !== null);
  const actualY = lastActual < 0 ? null : yOf(points[lastActual]?.actual ?? 0, scale, FRAME);
  const planY = lastPlan < 0 ? null : yOf(points[lastPlan]?.plan ?? 0, scale, FRAME);
  const [actualLabelY, planLabelY] =
    actualY !== null && planY !== null
      ? separateLabels(actualY, planY, LABEL_GAP)
      : [actualY, planY];
  const labelX = FRAME.width - FRAME.right + 6;

  return (
    <figure className={cn('flex max-w-[480px] flex-col gap-2', className)}>
      <Readout format={format} point={selected} />
      <svg
        aria-label={label}
        className="h-auto w-full touch-manipulation select-none"
        role="img"
        viewBox={`0 0 ${String(FRAME.width)} ${String(FRAME.height)}`}
      >
        {scale.ticks.map((tick) => {
          const y = yOf(tick, scale, FRAME);
          return (
            <g key={tick}>
              <line
                className={tick === 0 ? 'stroke-muted-foreground' : 'stroke-border'}
                strokeWidth={tick === 0 ? 1 : 0.75}
                x1={FRAME.left}
                x2={FRAME.width - FRAME.right}
                y1={y}
                y2={y}
              />
              <text
                className="fill-muted-foreground font-numeric text-[10px] tabular-nums"
                dominantBaseline="middle"
                textAnchor="end"
                x={FRAME.left - 6}
                y={y}
              >
                {formatTick(tick)}
              </text>
            </g>
          );
        })}

        {points.map((point, index) => (
          <text
            className={cn(
              'text-[10px]',
              index === active ? 'fill-foreground font-semibold' : 'fill-muted-foreground',
            )}
            key={point.key}
            textAnchor="middle"
            x={xOf(index, count, FRAME)}
            y={FRAME.height - 6}
          >
            {point.label}
          </text>
        ))}

        <line
          className="stroke-border"
          strokeWidth={1}
          x1={xOf(active, count, FRAME)}
          x2={xOf(active, count, FRAME)}
          y1={FRAME.top}
          y2={FRAME.height - FRAME.bottom}
        />

        {planPath === '' ? null : (
          <path
            className="fill-none stroke-chart-plan"
            d={planPath}
            strokeDasharray="4 4"
            strokeLinecap="round"
            strokeWidth={1.5}
          />
        )}
        {actualPath === '' ? null : (
          <path
            className="fill-none stroke-chart-actual"
            d={actualPath}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        )}
        {points.map((point, index) =>
          point.actual === null ? null : (
            <circle
              className="fill-chart-actual stroke-card"
              cx={xOf(index, count, FRAME)}
              cy={yOf(point.actual, scale, FRAME)}
              key={point.key}
              r={index === active ? 5 : 4}
              strokeWidth={2}
            />
          ),
        )}

        {actualLabelY === null ? null : (
          <text
            className="fill-foreground text-[10px]"
            dominantBaseline="middle"
            x={labelX}
            y={actualLabelY}
          >
            wykonanie
          </text>
        )}
        {planLabelY === null ? null : (
          <text
            className="fill-muted-foreground text-[10px]"
            dominantBaseline="middle"
            x={labelX}
            y={planLabelY}
          >
            plan
          </text>
        )}

        {/* Cele dotyku: cała wysokość kolumny miesiąca, szersze niż sam punkt. */}
        {points.map((point, index) => (
          <rect
            aria-hidden="true"
            className="cursor-pointer fill-transparent"
            data-testid={`trend-hit-${point.key}`}
            height={FRAME.height}
            key={point.key}
            onClick={() => {
              setActive(index);
            }}
            onPointerEnter={() => {
              setActive(index);
            }}
            width={column}
            x={FRAME.left + column * index}
            y={0}
          />
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg aria-hidden="true" className="h-2 w-5" viewBox="0 0 20 8">
            <line className="stroke-chart-actual" strokeWidth={2} x1={0} x2={20} y1={4} y2={4} />
            <circle className="fill-chart-actual" cx={10} cy={4} r={3} />
          </svg>
          wykonanie
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg aria-hidden="true" className="h-2 w-5" viewBox="0 0 20 8">
            <line
              className="stroke-chart-plan"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              x1={0}
              x2={20}
              y1={4}
              y2={4}
            />
          </svg>
          plan
        </span>
      </figcaption>
    </figure>
  );
}
