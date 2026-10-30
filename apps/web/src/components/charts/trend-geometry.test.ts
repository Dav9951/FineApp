import { describe, expect, it } from 'vitest';

import {
  separateLabels,
  seriesPath,
  trendScale,
  xOf,
  yOf,
  type TrendFrame,
} from './trend-geometry.js';

/**
 * Testy geometrii wykresu trendu — `F8-5`.
 */

const FRAME: TrendFrame = { width: 200, height: 120, left: 20, right: 20, top: 10, bottom: 10 };

describe('trendScale', () => {
  it('oś zaczyna się od zera i obejmuje największą wartość, podziałka 5%', () => {
    const scale = trendScale([
      { actual: 2_700, plan: 3_000 },
      { actual: 1_200, plan: 3_000 },
    ]);
    expect(scale).toMatchObject({ min: 0, max: 3_000, step: 1_000 });
    expect(scale.ticks).toEqual([0, 1_000, 2_000, 3_000]);
  });

  it('ujemne wykonanie schodzi pod zero zamiast się obciąć (ADR-011)', () => {
    const scale = trendScale([{ actual: -800, plan: 2_000 }]);
    expect(scale.min).toBeLessThan(0);
    expect(scale.min).toBeLessThanOrEqual(-800);
    expect(scale.ticks).toContain(0);
  });

  it('bez żadnej wartości i przy samych zerach — sensowna oś, nie dzielenie przez zero', () => {
    for (const data of [[], [{ actual: null, plan: null }], [{ actual: 0, plan: 0 }]]) {
      const scale = trendScale(data);
      expect(scale.max).toBeGreaterThan(scale.min);
      expect(Number.isFinite(yOf(0, scale, FRAME))).toBe(true);
    }
  });

  it('najwyżej pięć linii siatki także przy dużym rozrzucie', () => {
    const scale = trendScale([{ actual: -3_000, plan: 9_000 }]);
    expect(scale.ticks.length).toBeLessThanOrEqual(5);
    expect(scale.min).toBeLessThanOrEqual(-3_000);
    expect(scale.max).toBeGreaterThanOrEqual(9_000);
  });
});

describe('xOf i yOf', () => {
  it('kolumny równe, punkt na środku kolumny', () => {
    expect(xOf(0, 4, FRAME)).toBe(40);
    expect(xOf(3, 4, FRAME)).toBe(160);
  });

  it('większa wartość wyżej; granice osi na brzegach obszaru', () => {
    const scale = { min: 0, max: 1_000, step: 500, ticks: [0, 500, 1_000] };
    expect(yOf(0, scale, FRAME)).toBe(110);
    expect(yOf(1_000, scale, FRAME)).toBe(10);
    expect(yOf(500, scale, FRAME)).toBe(60);
  });
});

describe('seriesPath', () => {
  const scale = { min: 0, max: 1_000, step: 500, ticks: [0, 500, 1_000] };

  it('ciągła seria — jedna ścieżka', () => {
    expect(seriesPath([0, 1_000], scale, FRAME)).toBe('M60.0 110.0L140.0 10.0');
  });

  it('brak wartości przerywa linię; pojedynczy punkt nie tworzy odcinka', () => {
    const path = seriesPath([0, 500, null, 1_000, 0], scale, FRAME);
    expect(path.match(/M/g)).toHaveLength(2);
    expect(seriesPath([500, null, 500], scale, FRAME)).toBe('');
  });
});

describe('separateLabels', () => {
  it('daleko — bez zmian; blisko — rozsunięte symetrycznie w tej samej kolejności', () => {
    expect(separateLabels(10, 50, 14)).toEqual([10, 50]);
    expect(separateLabels(40, 44, 14)).toEqual([35, 49]);
    expect(separateLabels(44, 40, 14)).toEqual([49, 35]);
  });
});
