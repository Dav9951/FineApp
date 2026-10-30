import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TrendChart, type TrendChartPoint } from './trend-chart.js';

/**
 * Testy wykresu trendu — `F8-5`: odczyt wybranego miesiąca, przerwy, legenda.
 */

const POINTS: TrendChartPoint[] = [
  { key: '2026-08', label: 'sie', title: 'sierpień 2026', actual: 2_200, plan: 3_000 },
  { key: '2026-09', label: 'wrz', title: 'wrzesień 2026', actual: 2_700, plan: 3_000 },
];

/**
 * Procent do testu.
 *
 * @param bps - Punkty bazowe.
 * @returns Napis z procentem.
 */
const pct = (bps: number): string => `${String(bps / 100)}%`;

describe('TrendChart', () => {
  it('startuje od ostatniego miesiąca i ma opis dla czytnika ekranu', () => {
    render(<TrendChart format={pct} formatTick={pct} label="Trend odkładania" points={POINTS} />);
    expect(screen.getByRole('img', { name: 'Trend odkładania' })).toBeInTheDocument();
    expect(screen.getByText('wrzesień 2026')).toBeInTheDocument();
    expect(screen.getByText('27%')).toBeInTheDocument();
  });

  it('dotknięcie kolumny pokazuje jej miesiąc', () => {
    render(<TrendChart format={pct} formatTick={pct} label="Trend" points={POINTS} />);
    fireEvent.click(screen.getByTestId('trend-hit-2026-08'));
    expect(screen.getByText('sierpień 2026')).toBeInTheDocument();
    expect(screen.getByText('22%')).toBeInTheDocument();
  });

  it('brak wpływów i brak planu — kreska i „brak", nie zero', () => {
    render(
      <TrendChart
        format={pct}
        formatTick={pct}
        label="Trend"
        points={[{ key: 'x', label: 'x', title: 'lipiec 2026', actual: null, plan: null }]}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('brak')).toBeInTheDocument();
  });

  it('legenda nazywa obie serie — kolor nie jest jedynym nośnikiem', () => {
    render(<TrendChart format={pct} formatTick={pct} label="Trend" points={POINTS} />);
    const legend = screen.getByRole('figure').querySelector('figcaption');
    expect(legend).toHaveTextContent('wykonanie');
    expect(legend).toHaveTextContent('plan');
  });

  it('bez punktów — nic', () => {
    const { container } = render(
      <TrendChart format={pct} formatTick={pct} label="Trend" points={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
