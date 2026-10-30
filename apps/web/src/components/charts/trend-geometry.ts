/**
 * Geometria wykresu trendu — czyste funkcje, bez Reacta
 * ([06 §3.6](../../../../../plans/06-ui-views.md#36-rozkład-docelowy--allocation), `F8-5`).
 *
 * Wartości są w punktach bazowych (reguła 2 z `CLAUDE.md`); skala liczy się na liczbach
 * całkowitych, a do pikseli przechodzi dopiero na końcu. Wykonanie **może być ujemne**
 * (ADR-011) — oś schodzi wtedy poniżej zera, zamiast obcinać punkt do linii bazowej.
 */

/** Jeden miesiąc na wykresie; `null` — brak wartości (bez wpływów, bez planu). */
export interface TrendDatum {
  readonly actual: number | null;
  readonly plan: number | null;
}

/** Zakres osi Y i podziałka w punktach bazowych. */
export interface TrendScale {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly ticks: readonly number[];
}

/** Dopuszczalne podziałki: 5%, 10%, 20%, 25%, 50%, 100%. */
const STEPS = [500, 1000, 2000, 2500, 5000, 10_000] as const;
/** Najwięcej linii siatki — więcej na 180 px wysokości to już szum. */
const MAX_TICKS = 5;

/**
 * Dobiera zakres osi i podziałkę, tak żeby oś zawierała zero i wszystkie wartości.
 *
 * @param data - Punkty wykresu.
 * @returns Skala; bez żadnej wartości — 0–10%.
 */
export function trendScale(data: readonly TrendDatum[]): TrendScale {
  const values = data.flatMap((d) => [d.actual, d.plan]).filter((v): v is number => v !== null);
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const span = high - low;
  const step = STEPS.find((s) => Math.ceil(span / s) + 1 <= MAX_TICKS) ?? 10_000;
  const min = Math.floor(low / step) * step;
  let max = Math.ceil(high / step) * step;
  if (max === min) max = min + step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max; tick += step) ticks.push(tick);
  return { min, max, step, ticks };
}

/** Obszar rysowania w pikselach układu `viewBox`. */
export interface TrendFrame {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Środek kolumny miesiąca na osi X.
 *
 * @param index - Numer miesiąca.
 * @param count - Liczba miesięcy.
 * @param frame - Obszar rysowania.
 * @returns Współrzędna X.
 */
export function xOf(index: number, count: number, frame: TrendFrame): number {
  const inner = frame.width - frame.left - frame.right;
  return frame.left + (inner / count) * (index + 0.5);
}

/**
 * Wartość na współrzędną Y.
 *
 * @param value - Wartość w punktach bazowych.
 * @param scale - Skala osi.
 * @param frame - Obszar rysowania.
 * @returns Współrzędna Y (rośnie w dół).
 */
export function yOf(value: number, scale: TrendScale, frame: TrendFrame): number {
  const inner = frame.height - frame.top - frame.bottom;
  return frame.top + inner * (1 - (value - scale.min) / (scale.max - scale.min));
}

/**
 * Ścieżka SVG serii z przerwami tam, gdzie brakuje wartości.
 *
 * Przerwa jest uczciwsza niż łączenie sąsiadów: miesiąc bez wpływów nie ma procentu,
 * a linia przeciągnięta przez niego sugerowałaby wartość pośrednią.
 *
 * @param values - Wartości serii; `null` przerywa linię.
 * @param scale - Skala osi.
 * @param frame - Obszar rysowania.
 * @returns Atrybut `d`; pusty napis, gdy nie ma odcinka z co najmniej dwoma punktami.
 */
export function seriesPath(
  values: readonly (number | null)[],
  scale: TrendScale,
  frame: TrendFrame,
): string {
  const parts: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length >= 2) parts.push(`M${run.join('L')}`);
    run = [];
  };
  values.forEach((value, index) => {
    if (value === null) {
      flush();
      return;
    }
    const x = xOf(index, values.length, frame).toFixed(1);
    const y = yOf(value, scale, frame).toFixed(1);
    run.push(`${x} ${y}`);
  });
  flush();
  return parts.join('');
}

/**
 * Rozsuwa podpisy końców linii, gdy leżą bliżej niż `gap` pikseli.
 *
 * @param a - Y pierwszego podpisu.
 * @param b - Y drugiego podpisu.
 * @param gap - Najmniejszy odstęp.
 * @returns Nowe położenia w tej samej kolejności.
 */
export function separateLabels(a: number, b: number, gap: number): [number, number] {
  if (Math.abs(a - b) >= gap) return [a, b];
  const middle = (a + b) / 2;
  const half = gap / 2;
  return a <= b ? [middle - half, middle + half] : [middle + half, middle - half];
}
