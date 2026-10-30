import type { MonthCategoriesDto } from '@fineapp/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '../../../../test/render-screen.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import * as monthsApi from '../api.js';
import MonthCategoriesScreen from './month-categories-screen.js';

/**
 * Testy ekranu rozbicia wydatków po kategoriach (`/m/:month/categories`, `F3-2`).
 */

const FOOD = '01JB0000000000000000000011';
const CAFE = '01JB0000000000000000000012';

/** Rozbicie: Jedzenie z Kawiarniami i „Bez kategorii". */
const REPORT: MonthCategoriesDto = {
  month: '2026-09',
  previousMonth: '2026-08',
  expenseMinor: 10_000,
  items: [
    {
      categoryId: FOOD,
      name: 'Jedzenie',
      color: null,
      icon: null,
      amountMinor: 8_000,
      shareBps: 8000,
      transactionCount: 4,
      previousMonthAmountMinor: 4_000,
      children: [
        {
          categoryId: CAFE,
          name: 'Kawiarnie',
          color: null,
          icon: null,
          amountMinor: 1_500,
          shareBps: 1500,
          transactionCount: 1,
          previousMonthAmountMinor: 0,
        },
      ],
    },
    {
      categoryId: null,
      name: 'Bez kategorii',
      color: null,
      icon: null,
      amountMinor: 2_000,
      shareBps: 2000,
      transactionCount: 1,
      previousMonthAmountMinor: 0,
      children: [],
    },
  ],
};

/**
 * Renderuje ekran pod adresem miesiąca.
 *
 * @returns Router.
 */
function renderCategories(): ReturnType<typeof renderScreen>['router'] {
  return renderScreen('/m/2026-09/categories', [
    { path: 'm/:month/categories', element: <MonthCategoriesScreen /> },
    { path: 'm/:month', element: <p>ekran miesiąca</p> },
  ]).router;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Rozbicie po kategoriach', () => {
  it('kategorie z udziałem i porównaniem; podkategorie po rozwinięciu', async () => {
    vi.spyOn(monthsApi, 'fetchMonthCategories').mockResolvedValue(REPORT);
    renderCategories();

    expect(await screen.findByText('Jedzenie')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Bez kategorii')).toBeInTheDocument();
    expect(screen.queryByText('Kawiarnie')).not.toBeInTheDocument();

    const food = screen.getByRole('button', { name: /Jedzenie/ });
    expect(food).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(food);
    expect(food).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Kawiarnie')).toBeInTheDocument();
  });

  it('pusto: nic do rozbicia i powrót do miesiąca', async () => {
    vi.spyOn(monthsApi, 'fetchMonthCategories').mockResolvedValue({ ...REPORT, items: [] });
    renderCategories();
    expect(await screen.findByText('Nie ma czego rozbić')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wróć do miesiąca' })).toHaveAttribute(
      'href',
      '/m/2026-09',
    );
  });

  it('błąd z ponowieniem', async () => {
    vi.spyOn(monthsApi, 'fetchMonthCategories').mockRejectedValue(
      new ApiRequestError('INTERNAL_ERROR', 'Awaria.', 500, 'req-1'),
    );
    renderCategories();
    expect(await screen.findByText('Nie udało się wczytać kategorii')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spróbuj ponownie' })).toBeInTheDocument();
  });
});
