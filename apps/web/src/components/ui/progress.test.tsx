import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressBar, ProgressRing } from './progress.js';

/**
 * Testy pierścienia i paska
 * ([15 §4.7](../../../../../plans/15-design-system.md#47-progressring-i-progressbar)).
 *
 * Najważniejszy przypadek to **wykonanie ujemne** (ADR-011): alokacje liczone netto
 * mogą zejść poniżej zera i pierścień musi to pokazać, a nie obciąć do zera.
 */

describe('ProgressRing', () => {
  it('ścieżka nie używa --muted — przy wykonaniu ujemnym pierścień by zniknął', () => {
    const { container } = render(<ProgressRing pool="savings" valueBps={-1800} />);

    const track = container.querySelector('circle');
    expect(track).toHaveAttribute('stroke', 'hsl(var(--muted-foreground) / .45)');
  });

  it('wartość ujemna zachowuje znak w liczbie i w odczycie', () => {
    render(<ProgressRing pool="debt" valueBps={-1800} />);

    expect(screen.getByText('−18%')).toHaveClass('text-expense');
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Wykonanie −18%');
  });

  it('wartość ujemna rysuje ślad kropek w kolorze wydatku, nie ciągłą linię', () => {
    render(<ProgressRing pool="savings" valueBps={-1800} />);

    const fill = screen.getByTestId('ring-fill');
    expect(fill).toHaveAttribute('stroke', 'hsl(var(--expense))');
    expect(fill).toHaveAttribute('stroke-dasharray');
    expect(fill).toHaveAttribute('stroke-linecap', 'round');
  });

  it('wartość ujemna stawia pełną kropkę w punkcie zero', () => {
    render(<ProgressRing pool="savings" valueBps={-1800} />);

    expect(screen.getByTestId('ring-zero-dot')).toBeInTheDocument();
  });

  it('łuk ujemny biegnie w lewo, dodatni w prawo', () => {
    const { container: left } = render(<ProgressRing pool="savings" valueBps={-2500} />);
    const { container: right } = render(<ProgressRing pool="savings" valueBps={2500} />);

    // Flaga `sweep` polecenia A: 0 to w lewo, 1 to w prawo.
    expect(left.querySelector('path')?.getAttribute('d')).toContain(' 0 0 ');
    expect(right.querySelector('path')?.getAttribute('d')).toContain(' 0 1 ');
  });

  it('łuk ujemny nie przekracza 40% obwodu', () => {
    const { container: deep } = render(<ProgressRing pool="savings" valueBps={-9000} />);
    const { container: capped } = render(<ProgressRing pool="savings" valueBps={-4000} />);

    // −90% i −40% rysują ten sam łuk: dalej i tak nic to nie wnosi.
    expect(deep.querySelector('path')?.getAttribute('d')).toBe(
      capped.querySelector('path')?.getAttribute('d'),
    );
  });

  it('przekroczenie 100% dokłada cieńszy łuk w kolorze sukcesu', () => {
    render(<ProgressRing pool="investment" valueBps={11_400} />);

    const overflow = screen.getByTestId('ring-overflow');
    expect(overflow).toHaveAttribute('stroke', 'hsl(var(--success))');
    expect(Number(overflow.getAttribute('stroke-width'))).toBeLessThan(9);
  });

  it('znacznik celu ma inny kształt, nie tylko inny kolor', () => {
    const { container: open } = render(<ProgressRing pool="savings" valueBps={5000} />);
    const { container: done } = render(<ProgressRing achieved pool="savings" valueBps={10_000} />);

    expect(open.textContent).toContain('○');
    expect(done.textContent).toContain('●');
  });
});

describe('ProgressBar', () => {
  it('podaje wykonanie czytnikowi ekranu', () => {
    render(<ProgressBar pool="savings" valueBps={5400} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '54');
  });

  it('ma nazwę — z puli albo podaną (axe: aria-progressbar-name)', () => {
    render(
      <>
        <ProgressBar pool="investment" valueBps={100} />
        <ProgressBar label="Realizacja planu — wrzesień" pool="savings" valueBps={100} />
      </>,
    );
    expect(screen.getByRole('progressbar', { name: 'Realizacja: inwestycje' })).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Realizacja planu — wrzesień' }),
    ).toBeInTheDocument();
  });

  it('wartość poza 0–100% — `valuenow` w zakresie, prawda w `valuetext`', () => {
    render(
      <>
        <ProgressBar label="ponad" pool="savings" valueBps={15_000} />
        <ProgressBar label="ujemne" pool="savings" valueBps={-2_500} />
      </>,
    );
    const over = screen.getByRole('progressbar', { name: 'ponad' });
    expect(over).toHaveAttribute('aria-valuenow', '100');
    expect(over).toHaveAttribute('aria-valuetext', '150%');
    const negative = screen.getByRole('progressbar', { name: 'ujemne' });
    expect(negative).toHaveAttribute('aria-valuenow', '0');
    expect(negative).toHaveAttribute('aria-valuetext', '−25%');
  });

  it('kolor niesie pulę, nie ocenę — ostrzeżenie idzie w etykiecie', () => {
    render(<ProgressBar note="Poniżej tempa" pool="investment" valueBps={3200} />);

    expect(screen.getByText('Poniżej tempa')).toHaveClass('text-warning');
  });

  it('nie wychodzi poza pasek przy wykonaniu ponad 100%', () => {
    render(<ProgressBar pool="debt" valueBps={15_000} />);

    const fill = screen.getByRole('progressbar').firstElementChild;
    expect(fill).toHaveStyle({ width: '100%' });
  });
});
