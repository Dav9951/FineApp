import type { AccountDetailDto } from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '../../../../test/render-screen.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import MoreScreen from '../../more/more-screen.js';
import * as accountsApi from '../api.js';
import AccountDetailScreen from './account-detail-screen.js';

/**
 * Testy szczegółów konta i ekranu „Więcej"
 * ([06 §3.7](../../../../../../plans/06-ui-views.md#37-konta--accounts)).
 */

const ID = '01JB0000000000000000000001';

/** Konto oszczędnościowe z saldem. */
const DETAIL: AccountDetailDto = {
  id: ID,
  name: 'Konto mieszkaniowe',
  type: 'savings',
  allocationClass: 'savings',
  currency: 'PLN',
  openingBalanceMinor: 1_250_000,
  openingBalanceOn: '2026-09-01',
  institution: 'mBank',
  color: null,
  icon: null,
  includeInNetWorth: true,
  sortOrder: 0,
  isArchived: false,
  createdAt: 1,
  updatedAt: 1,
  balanceMinor: 4_200_000,
  balanceAsOf: '2026-09-23',
};

/**
 * Renderuje szczegóły konta.
 *
 * @param detail - Odpowiedź API albo błąd.
 * @returns Router.
 */
function renderDetail(
  detail: AccountDetailDto | Error = DETAIL,
): ReturnType<typeof renderScreen>['router'] {
  const spy = vi.spyOn(accountsApi, 'fetchAccount');
  if (detail instanceof Error) spy.mockRejectedValue(detail);
  else spy.mockResolvedValue(detail);
  return renderScreen(`/accounts/${ID}`, [
    { path: '/accounts', element: <p>lista kont</p> },
    { path: '/accounts/:id', element: <AccountDetailScreen /> },
  ]).router;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AccountDetailScreen', () => {
  it('pokazuje saldo na dzień i dane konta', async () => {
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'Konto mieszkaniowe' })).toBeInTheDocument();
    expect(screen.getByText('42 000,00 zł')).toBeInTheDocument();
    expect(screen.getByText('saldo na 23 września 2026')).toBeInTheDocument();
    expect(screen.getByText('mBank')).toBeInTheDocument();
    expect(screen.getByText('12 500,00 zł')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Konta' })).toHaveAttribute('href', '/accounts');
    // Historia konta to ekran historii miesiąca salda z filtrem konta (ADR-038).
    expect(screen.getByRole('link', { name: 'Historia' })).toHaveAttribute(
      'href',
      `/m/2026-09/transactions?accountId=${ID}`,
    );
  });

  it('archiwizuje i przywraca', async () => {
    const user = userEvent.setup();
    const archive = vi
      .spyOn(accountsApi, 'setAccountArchived')
      .mockResolvedValue({ ...DETAIL, isArchived: true });
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Archiwizuj' }));
    expect(archive).toHaveBeenCalledWith('token-testowy', ID, true);
  });

  it('konto z archiwum: plakietka i przywrócenie', async () => {
    const user = userEvent.setup();
    const archive = vi.spyOn(accountsApi, 'setAccountArchived').mockResolvedValue(DETAIL);
    renderDetail({ ...DETAIL, isArchived: true });
    expect(await screen.findByText('w archiwum')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Przywróć z archiwum' }));
    expect(archive).toHaveBeenCalledWith('token-testowy', ID, false);
  });

  it('usunięcie wymaga potwierdzenia i wraca do listy', async () => {
    const user = userEvent.setup();
    const remove = vi.spyOn(accountsApi, 'deleteAccount').mockResolvedValue(undefined);
    const router = renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Usuń konto' }));
    expect(remove).not.toHaveBeenCalled();
    const confirm = within(screen.getByRole('group', { name: 'Potwierdzenie usunięcia' }));
    await user.click(confirm.getByRole('button', { name: 'Usuń na zawsze' }));

    expect(remove).toHaveBeenCalledWith('token-testowy', ID);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/accounts');
    });
  });

  it('anulowanie potwierdzenia niczego nie usuwa', async () => {
    const user = userEvent.setup();
    const remove = vi.spyOn(accountsApi, 'deleteAccount');
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Usuń konto' }));
    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Usuń konto' })).toBeInTheDocument();
  });

  it('konto z transakcjami: komunikat serwera zamiast usunięcia (I-10)', async () => {
    const user = userEvent.setup();
    const message = 'Konto ma transakcje, więc nie można go usunąć. Możesz je zarchiwizować.';
    vi.spyOn(accountsApi, 'deleteAccount').mockRejectedValue(
      new ApiRequestError('CONFLICT', message, 409, 'r'),
    );
    const router = renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Usuń konto' }));
    await user.click(screen.getByRole('button', { name: 'Usuń na zawsze' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(router.state.location.pathname).toBe(`/accounts/${ID}`);
  });

  it('edycja wysyła tylko zmienione pola', async () => {
    const user = userEvent.setup();
    const update = vi
      .spyOn(accountsApi, 'updateAccount')
      .mockResolvedValue({ ...DETAIL, name: 'Wkład własny' });
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Edytuj' }));
    const form = within(await screen.findByRole('dialog', { name: 'Edytuj konto' }));
    const name = form.getByRole('textbox', { name: 'Nazwa' });
    expect(name).toHaveValue('Konto mieszkaniowe');
    await user.clear(name);
    await user.type(name, 'Wkład własny');
    await user.click(form.getByRole('button', { name: 'Zapisz zmiany' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('token-testowy', ID, { name: 'Wkład własny' });
    });
  });

  it('nieistniejące konto: stan pusty z powrotem, nie awaria', async () => {
    renderDetail(new ApiRequestError('NOT_FOUND', 'Nie znaleziono konta.', 404, 'r'));
    expect(await screen.findByText('Nie ma takiego konta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wróć do kont' })).toBeInTheDocument();
  });

  it('awaria serwera: stan błędu z ponowieniem', async () => {
    renderDetail(new ApiRequestError('INTERNAL_ERROR', 'Błąd', 500, 'r'));
    expect(await screen.findByText('Nie udało się wczytać konta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spróbuj ponownie' })).toBeInTheDocument();
  });
});

describe('MoreScreen', () => {
  it('prowadzi do kont — jedyne wejście na telefonie', async () => {
    const user = userEvent.setup();
    const { router } = renderScreen('/more', [
      { path: '/more', element: <MoreScreen /> },
      { path: '/accounts', element: <p>lista kont</p> },
    ]);
    const nav = within(await screen.findByRole('navigation', { name: 'Planowanie' }));
    await user.click(nav.getByRole('button', { name: 'Konta' }));
    expect(router.state.location.pathname).toBe('/accounts');
  });

  it('profil, Kategorie i Ustawienia, motyw i „Wyloguj" (ADR-082)', async () => {
    renderScreen('/more', [{ path: '/more', element: <MoreScreen /> }]);
    expect(
      await screen.findByRole('link', { name: 'Profil: Adam, gospodarstwo Dom' }),
    ).toHaveAttribute('href', '/settings');
    const settings = within(screen.getByRole('navigation', { name: 'Ustawienia' }));
    expect(settings.getByRole('button', { name: 'Kategorie' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Motyw' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wyloguj' })).toBeInTheDocument();
  });
});
