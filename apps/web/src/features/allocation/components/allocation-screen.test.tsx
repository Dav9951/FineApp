import { formatMonth, monthKeyOf, shiftMonth, todayInTimezone } from '@fineapp/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { allocationFixture } from '../../../../test/goal-fixture.js';
import { renderScreen } from '../../../../test/render-screen.js';
import { AppShell } from '../../../components/layout/app-shell.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import * as accountsApi from '../../accounts/api.js';
import * as allocationApi from '../api.js';
import AllocationScreen from './allocation-screen.js';

/**
 * Testy ekranu rozkładu docelowego
 * ([06 §3.6](../../../../../../plans/06-ui-views.md#36-rozkład-docelowy--allocation), `F5-7`).
 */

const MONTH = monthKeyOf(todayInTimezone('Europe/Warsaw'));
const STATUS = allocationFixture({ month: MONTH, effectiveFromMonth: MONTH });

/** Ekran w powłoce — powłoka daje toast i arkusz transakcji. */
const ROUTES = [
  {
    path: '/',
    element: <AppShell />,
    children: [{ path: 'allocation', element: <AllocationScreen /> }],
  },
];

/**
 * Renderuje ekran z atrapami API.
 *
 * @param status - Stan bieżącego miesiąca.
 */
function renderAllocation(status = STATUS): void {
  vi.spyOn(allocationApi, 'fetchAllocationStatus').mockResolvedValue(status);
  vi.spyOn(allocationApi, 'fetchAllocationTrend').mockResolvedValue([
    allocationFixture({ month: shiftMonth(MONTH, -1), incomeBaseMinor: 0 }),
    status,
  ]);
  vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([]);
  renderScreen('/allocation', ROUTES);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AllocationScreen', () => {
  it('założenia z kwotami i „Na życie zostaje"; wykonanie; trend', async () => {
    renderAllocation();
    // Szkielet też ma nagłówek „Założenia" — czekamy na treść.
    await screen.findByRole('slider', { name: 'Oszczędności' });
    const targets = screen.getByRole('heading', { name: 'Założenia' }).closest('section');
    const scope = within(targets as HTMLElement);
    expect(scope.getByRole('slider', { name: 'Oszczędności' })).toHaveValue('2000');
    expect(scope.getByText('2 360 zł')).toBeInTheDocument();
    expect(scope.getByText('Na życie zostaje')).toBeInTheDocument();
    expect(scope.getByText('70,0%')).toBeInTheDocument();
    expect(scope.getByText('8 260 zł')).toBeInTheDocument();
    expect(scope.getByRole('button', { name: 'Zapisz' })).toBeDisabled();

    expect(screen.getByText('Do domknięcia planu brakuje', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('plan wykonany')).toBeInTheDocument();
    const trend = (await screen.findByRole('heading', { name: 'Trend' })).closest('section');
    expect(within(trend as HTMLElement).getByText('— z 30,0%')).toBeInTheDocument();
    expect(within(trend as HTMLElement).getByText('27,0% z 30,0%')).toBeInTheDocument();
  });

  it('zmiana suwaka i zapis od następnego miesiąca; ostrzeżenie ponad 100%', async () => {
    const user = userEvent.setup();
    const put = vi.spyOn(allocationApi, 'putAllocationTarget').mockResolvedValue({
      data: {} as never,
      meta: { warning: 'ALLOCATION_EXCEEDS_INCOME' },
    });
    renderAllocation();
    const slider = await screen.findByRole('slider', { name: 'Oszczędności' });
    fireEvent.change(slider, { target: { value: '9500' } });
    expect(screen.getByText(/Plan przekracza wpływy/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: formatMonth(shiftMonth(MONTH, 1)) }));
    await user.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('token-testowy', {
        effectiveFromMonth: shiftMonth(MONTH, 1),
        savingsPercentBps: 9500,
        investmentPercentBps: 1000,
        debtPercentBps: 0,
      });
    });
    expect(await screen.findByText('Zapisano — plan przekracza wpływy')).toBeInTheDocument();
  });

  it('„Przelej teraz" otwiera przelew z brakującą kwotą', async () => {
    const user = userEvent.setup();
    renderAllocation();
    await user.click(await screen.findByRole('button', { name: 'Przelej teraz' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nowy przelew' });
    expect(within(dialog).getByRole('textbox', { name: 'Kwota' })).toHaveTextContent('360');
  });

  it('bez rozkładu — zachęta; „Zapisz" aktywne od razu', async () => {
    renderAllocation(allocationFixture({ month: MONTH, effectiveFromMonth: null }));
    expect(await screen.findByText(/Ustal, jaki procent wpływów/)).toBeInTheDocument();
    expect(screen.getByText('nie ustawiono')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zapisz' })).toBeEnabled();
  });

  it('ładowanie i błąd z ponowieniem', async () => {
    const user = userEvent.setup();
    vi.spyOn(allocationApi, 'fetchAllocationTrend').mockResolvedValue([]);
    const fetch = vi
      .spyOn(allocationApi, 'fetchAllocationStatus')
      .mockRejectedValueOnce(new ApiRequestError('INTERNAL_ERROR', 'Błąd.', 500, 'req-1'))
      .mockResolvedValue(STATUS);
    renderScreen('/allocation', ROUTES);
    expect(await screen.findByText('Nie udało się wczytać rozkładu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('heading', { name: 'Założenia' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('szkielet w trakcie wczytywania', async () => {
    vi.spyOn(allocationApi, 'fetchAllocationStatus').mockReturnValue(new Promise(() => undefined));
    renderScreen('/allocation', ROUTES);
    expect(await screen.findByLabelText('Wczytywanie rozkładu')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });
});
