import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { MonthSwitcher } from './month-switcher.js';

/** Testy przełącznika miesiąca — odnośniki do sąsiednich miesięcy przez granicę roku. */

describe('MonthSwitcher', () => {
  it('nazwa miesiąca w nagłówku, strzałki jako odnośniki z opisem', () => {
    render(
      <MemoryRouter>
        <MonthSwitcher hrefFor={(month) => `/m/${month}?x=1`} month="2026-01" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('styczeń 2026');
    expect(screen.getByRole('link', { name: 'Poprzedni miesiąc: grudzień 2025' })).toHaveAttribute(
      'href',
      '/m/2025-12?x=1',
    );
    expect(screen.getByRole('link', { name: 'Następny miesiąc: luty 2026' })).toHaveAttribute(
      'href',
      '/m/2026-02?x=1',
    );
  });
});
