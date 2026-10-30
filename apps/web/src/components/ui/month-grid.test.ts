import { describe, expect, it } from 'vitest';

import { monthGrid } from './month-grid.js';

/** Testy siatki miesięcy przełącznika (`F3-5`). */

describe('monthGrid', () => {
  it('dwanaście miesięcy z flagami danych, bieżącego, wybranego i przyszłych', () => {
    const grid = monthGrid(2026, ['2026-07', '2026-09'], '2026-09', '2026-08');
    expect(grid).toHaveLength(12);
    expect(grid[0]).toMatchObject({ month: '2026-01', short: 'sty', label: 'styczeń 2026' });
    expect(grid[6]?.hasData).toBe(true);
    expect(grid[7]).toMatchObject({ hasData: false, isSelected: true });
    expect(grid[8]).toMatchObject({ isCurrent: true, isFuture: false });
    expect(grid[9]?.isFuture).toBe(true);
  });
});
