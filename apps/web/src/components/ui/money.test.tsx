import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Money } from './money.js';

/**
 * Testy kwoty — reguły z [15 §4.1](../../../../../plans/15-design-system.md#41-money).
 *
 * To jest komponent, którego błąd kosztuje najwięcej: kwota z błędnym znakiem albo
 * kolorem zmienia sens ekranu, a nie tylko jego wygląd.
 */

/**
 * Odczyt kwoty dla czytnika ekranu — tekst ukryty wizualnie obok widocznej kwoty.
 *
 * @param visible - Element z widoczną kwotą.
 * @returns Tekst odczytu.
 */
function spokenOf(visible: HTMLElement): string | null | undefined {
  return visible.parentElement?.querySelector('.sr-only')?.textContent;
}

describe('Money', () => {
  it('wpływ dostaje plus, wydatek minus typograficzny', () => {
    render(
      <>
        <Money amountMinor={185_000} variant="income" />
        <Money amountMinor={185_000} variant="expense" />
      </>,
    );

    expect(screen.getByText('+1 850,00 zł')).toBeInTheDocument();
    expect(screen.getByText('−1 850,00 zł')).toBeInTheDocument();
  });

  it('odczyt dla czytnika ekranu niesie ten sam znak co ekran', () => {
    // Regresja: znak dokładany osobno do tekstu sprawiał, że wydatek czytał się
    // jak wpływ — błąd niewidoczny dla osoby patrzącej na ekran.
    render(<Money amountMinor={185_000} variant="expense" />);

    expect(spokenOf(screen.getByText('−1 850,00 zł'))).toBe(
      'minus tysiąc osiemset pięćdziesiąt złotych zero groszy',
    );
  });

  it('odczyt nie siedzi w `aria-label` na elemencie bez roli (axe: aria-prohibited-attr)', () => {
    render(<Money amountMinor={500} />);
    const visible = screen.getByText('5,00 zł');
    expect(visible).toHaveAttribute('aria-hidden', 'true');
    expect(visible.parentElement).not.toHaveAttribute('aria-label');
    expect(spokenOf(visible)).toBe('pięć złotych zero groszy');
  });

  it('korekta wydatku czyta się jako wpływ', () => {
    render(<Money amountMinor={-8990} variant="expense" />);

    expect(screen.getByText('+89,90 zł')).toBeInTheDocument();
  });

  it('zero nigdy nie dostaje znaku', () => {
    render(
      <>
        <Money amountMinor={0} variant="income" />
        <Money amountMinor={0} variant="expense" />
      </>,
    );

    expect(screen.getAllByText('0,00 zł')).toHaveLength(2);
  });

  it('kwota ujemna w wariancie neutralnym zachowuje minus', () => {
    render(<Money amountMinor={-12_799} />);

    expect(spokenOf(screen.getByText('−127,99 zł'))).toBe(
      'minus sto dwadzieścia siedem złotych dziewięćdziesiąt dziewięć groszy',
    );
  });

  it('wariant compact gubi grosze na ekranie, ale nie w odczycie', () => {
    render(<Money amountMinor={236_040} variant="compact" />);

    expect(spokenOf(screen.getByText('2 360 zł'))).toBe(
      'dwa tysiące trzysta sześćdziesiąt złotych czterdzieści groszy',
    );
  });

  it('wariant compact zaokrągla, a nie ucina', () => {
    render(<Money amountMinor={99_999} variant="compact" />);

    expect(screen.getByText('1 000 zł')).toBeInTheDocument();
  });

  it('unit=false zdejmuje jednostkę razem ze spacją niełamliwą', () => {
    render(<Money amountMinor={200_000} unit={false} variant="compact" />);

    expect(screen.getByText('2 000')).toBeInTheDocument();
  });

  it('kolor pochodzi z wariantu i nie da się go nadpisać z zewnątrz', () => {
    render(<Money amountMinor={1000} className="text-income" variant="expense" />);

    const element = screen.getByText('−10,00 zł').parentElement;
    expect(element).toHaveClass('text-expense');
    expect(element).not.toHaveClass('text-income');
  });

  it('rozmiar przeżywa obok koloru wariantu', () => {
    // Regresja: `twMerge` bez własnych stopni pisma brał `text-hero` za kolor
    // i wycinał go przy `text-expense` — kwota w nagłówku schodziła do 16 px.
    render(<Money amountMinor={185_000} size="hero" variant="expense" />);

    const element = screen.getByText('−1 850,00 zł').parentElement;
    expect(element).toHaveClass('text-hero', 'text-expense');
  });

  it('kwota ma cyfry tabelaryczne i nigdy się nie zawija', () => {
    render(<Money amountMinor={121_572_790} />);

    expect(screen.getByText('1 215 727,90 zł').parentElement).toHaveClass(
      'tabular-nums',
      'whitespace-nowrap',
      'font-numeric',
    );
  });
});
