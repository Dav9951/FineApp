import { todayInTimezone, type AccountDto } from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '../../../../test/render-screen.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import * as accountsApi from '../api.js';
import AccountsScreen from './accounts-screen.js';

/**
 * Testy ekranu kont — cztery stany i formularz nowego konta
 * ([06 §3.7](../../../../../../plans/06-ui-views.md#37-konta--accounts), 15 §2.8).
 */

/**
 * Konto w kształcie z kontraktu.
 *
 * @param id - Identyfikator.
 * @param overrides - Nadpisane pola.
 * @returns Konto.
 */
function account(id: string, overrides: Partial<AccountDto> = {}): AccountDto {
  return {
    id,
    name: id,
    type: 'checking',
    allocationClass: 'spending',
    currency: 'PLN',
    openingBalanceMinor: 0,
    openingBalanceOn: '2026-09-01',
    institution: null,
    color: null,
    icon: null,
    includeInNetWorth: true,
    sortOrder: 0,
    isArchived: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const ROR = '01JB0000000000000000000001';
const HOME = '01JB0000000000000000000002';
const OLD = '01JB0000000000000000000003';
const CARD = '01JB0000000000000000000004';

/** Salda: ROR, konto mieszkaniowe, zarchiwizowana karta z długiem. */
const BALANCES: accountsApi.AccountBalances = {
  accounts: [
    {
      accountId: ROR,
      name: 'ROR mBank',
      type: 'checking',
      allocationClass: 'spending',
      color: null,
      icon: null,
      isArchived: false,
      balanceMinor: 843_210,
      balanceAtMonthStartMinor: 512_000,
      changeInMonthMinor: 331_210,
    },
    {
      accountId: HOME,
      name: 'Konto mieszkaniowe',
      type: 'savings',
      allocationClass: 'savings',
      color: null,
      icon: null,
      isArchived: false,
      balanceMinor: 4_200_000,
      balanceAtMonthStartMinor: 4_200_000,
      changeInMonthMinor: 0,
    },
    {
      accountId: CARD,
      name: 'Stara karta',
      type: 'other',
      allocationClass: 'spending',
      color: null,
      icon: null,
      isArchived: true,
      balanceMinor: -12_799,
      balanceAtMonthStartMinor: -12_799,
      changeInMonthMinor: 0,
    },
  ],
  meta: {
    asOf: '2026-09-23',
    totalsByClass: { spending: 830_411, savings: 4_200_000, investment: 0 },
    netWorthMinor: 5_030_411,
    liabilitiesRemainingMinor: 0,
  },
};

/** Lista z archiwum. */
const LIST: AccountDto[] = [
  account(ROR, { name: 'ROR mBank', institution: 'mBank' }),
  account(HOME, { name: 'Konto mieszkaniowe', type: 'savings', allocationClass: 'savings' }),
  account(CARD, { name: 'Stara karta', type: 'other', isArchived: true }),
  account(OLD, {
    name: 'Zamknięta lokata',
    type: 'savings',
    allocationClass: 'savings',
    isArchived: true,
  }),
];

/**
 * Renderuje ekran kont z atrapami API.
 *
 * @param balances - Odpowiedź sald.
 * @param list - Odpowiedź listy kont.
 * @returns Router.
 */
function renderAccounts(
  balances: accountsApi.AccountBalances = BALANCES,
  list: AccountDto[] = LIST,
): ReturnType<typeof renderScreen>['router'] {
  vi.spyOn(accountsApi, 'fetchBalances').mockResolvedValue(balances);
  vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue(list);
  return renderScreen('/accounts', [
    { path: '/accounts', element: <AccountsScreen /> },
    { path: '/accounts/:id', element: <p>szczegóły</p> },
  ]).router;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AccountsScreen — treść', () => {
  it('pokazuje majątek netto i grupy po puli z sumami z serwera', async () => {
    renderAccounts();

    // Szkielet ma ten sam nagłówek — czekamy na kwotę, nie na nagłówek.
    await screen.findByText('ROR mBank');
    const netSection = screen.getByRole('heading', { name: 'Majątek netto' }).closest('section');
    expect(netSection).not.toBeNull();
    expect(within(netSection as HTMLElement).getByText('50 304,11 zł')).toBeInTheDocument();

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Majątek netto', 'Na bieżące wydatki', 'Oszczędności', 'Archiwum']);

    const spending = screen.getByRole('heading', { name: 'Na bieżące wydatki' }).closest('section');
    expect(within(spending as HTMLElement).getByText('8 304,11 zł')).toBeInTheDocument();
  });

  it('wiersz: nazwa, instytucja i ruch w miesiącu ze znakiem', async () => {
    renderAccounts();
    const row = (await screen.findByText('ROR mBank')).closest('button');
    expect(row).not.toBeNull();
    const scope = within(row as HTMLElement);
    expect(scope.getByText('mBank')).toBeInTheDocument();
    expect(scope.getByText('+3 312,10 zł')).toBeInTheDocument();
    expect(scope.getByText('8 432,10 zł')).toBeInTheDocument();
  });

  it('konto z archiwum z długiem zostaje w grupie z plakietką; z zerem trafia do „Archiwum"', async () => {
    renderAccounts();
    const card = (await screen.findByText('Stara karta')).closest('button');
    expect(within(card as HTMLElement).getByText('w archiwum')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('−127,99 zł')).toBeInTheDocument();

    const archive = screen.getByRole('heading', { name: 'Archiwum' }).closest('section');
    const archiveScope = within(archive as HTMLElement);
    expect(archiveScope.getByText('Zamknięta lokata')).toBeInTheDocument();
    expect(archiveScope.queryByText('Stara karta')).not.toBeInTheDocument();
  });

  it('dotknięcie wiersza otwiera szczegóły konta', async () => {
    const user = userEvent.setup();
    const router = renderAccounts();
    await user.click(await screen.findByText('Konto mieszkaniowe'));
    expect(router.state.location.pathname).toBe(`/accounts/${HOME}`);
  });
});

describe('AccountsScreen — pozostałe stany', () => {
  it('ładowanie: szkielet, nie spinner', async () => {
    vi.spyOn(accountsApi, 'fetchBalances').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(accountsApi, 'fetchAccounts').mockReturnValue(new Promise(() => undefined));
    renderScreen('/accounts', [{ path: '/accounts', element: <AccountsScreen /> }]);
    expect(await screen.findByLabelText('Wczytywanie kont')).toHaveAttribute('aria-busy', 'true');
  });

  it('pusto: jedna akcja, która otwiera formularz', async () => {
    const user = userEvent.setup();
    renderAccounts(
      {
        accounts: [],
        meta: {
          ...BALANCES.meta,
          netWorthMinor: 0,
          totalsByClass: { spending: 0, savings: 0, investment: 0 },
        },
      },
      [],
    );
    expect(await screen.findByText('Nie masz jeszcze kont')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Majątek netto' })).not.toBeInTheDocument();
    // Dwa wejścia do tego samego formularza: plus w nagłówku i akcja stanu pustego.
    const [, emptyStateAction] = screen.getAllByRole('button', { name: 'Dodaj konto' });
    await user.click(emptyStateAction as HTMLElement);
    expect(await screen.findByRole('dialog', { name: 'Nowe konto' })).toBeInTheDocument();
  });

  it('błąd: bez starych kwot, z ponowieniem', async () => {
    const user = userEvent.setup();
    const fetchBalances = vi
      .spyOn(accountsApi, 'fetchBalances')
      .mockRejectedValueOnce(new ApiRequestError('INTERNAL_ERROR', 'Wystąpił błąd.', 500, 'req-1'))
      .mockResolvedValue(BALANCES);
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue(LIST);
    renderScreen('/accounts', [{ path: '/accounts', element: <AccountsScreen /> }]);

    expect(await screen.findByText('Nie udało się wczytać kont')).toBeInTheDocument();
    expect(screen.queryByText('ROR mBank')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Szczegóły techniczne' }));
    expect(screen.getByText(/INTERNAL_ERROR · HTTP 500 · żądanie req-1/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('ROR mBank')).toBeInTheDocument();
    expect(fetchBalances).toHaveBeenCalledTimes(2);
  });
});

describe('AccountsScreen — nowe konto', () => {
  it('składa żądanie z formularza: rodzaj, saldo z przecinkiem, dzisiejsza data', async () => {
    const user = userEvent.setup();
    const create = vi
      .spyOn(accountsApi, 'createAccount')
      .mockResolvedValue(account('01JB0000000000000000000009'));
    renderAccounts();

    await user.click(await screen.findByRole('button', { name: 'Dodaj konto' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nowe konto' });
    const form = within(dialog);
    await user.type(form.getByRole('textbox', { name: 'Nazwa' }), 'Lokata');
    await user.click(form.getByRole('radio', { name: 'Oszczędnościowe' }));
    await user.type(form.getByRole('textbox', { name: 'Saldo początkowe (zł)' }), '1 250,50');
    await user.click(form.getByRole('button', { name: 'Dodaj konto' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith('token-testowy', {
        name: 'Lokata',
        type: 'savings',
        openingBalanceMinor: 125_050,
        openingBalanceOn: todayInTimezone('Europe/Warsaw', new Date()),
        institution: null,
        includeInNetWorth: true,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('pusta nazwa: błąd pod polem i żadnego żądania', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(accountsApi, 'createAccount');
    renderAccounts();

    await user.click(await screen.findByRole('button', { name: 'Dodaj konto' }));
    const form = within(await screen.findByRole('dialog', { name: 'Nowe konto' }));
    await user.click(form.getByRole('button', { name: 'Dodaj konto' }));

    expect(form.getByRole('textbox', { name: 'Nazwa' })).toHaveAccessibleDescription(
      'Nazwa jest wymagana',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('zaawansowane: podgląd puli podąża za rodzajem, dopóki nie wybrano jej ręcznie', async () => {
    const user = userEvent.setup();
    renderAccounts();
    await user.click(await screen.findByRole('button', { name: 'Dodaj konto' }));
    const form = within(await screen.findByRole('dialog', { name: 'Nowe konto' }));

    await user.click(form.getByRole('button', { name: 'Zaawansowane' }));
    const pool = form.getByRole('group', { name: 'Pula' });
    expect(within(pool).getByRole('radio', { name: 'Wydatki' })).toBeChecked();

    const kind = form.getByRole('group', { name: 'Rodzaj' });
    await user.click(within(kind).getByRole('radio', { name: 'Oszczędnościowe' }));
    expect(within(pool).getByRole('radio', { name: 'Oszczędności' })).toBeChecked();

    await user.click(within(pool).getByRole('radio', { name: 'Inwestycje' }));
    expect(within(pool).getByRole('radio', { name: 'Inwestycje' })).toBeChecked();
    // Ręcznie wybrana pula nie idzie już za rodzajem.
    await user.click(within(kind).getByRole('radio', { name: 'Gotówka' }));
    expect(within(pool).getByRole('radio', { name: 'Inwestycje' })).toBeChecked();
  });

  it('błąd serwera trafia pod formularz, arkusz zostaje otwarty', async () => {
    const user = userEvent.setup();
    vi.spyOn(accountsApi, 'createAccount').mockRejectedValue(
      new ApiRequestError('VALIDATION_ERROR', 'Żądanie zawiera nieprawidłowe dane.', 400, 'r', [
        { path: 'openingBalanceMinor', message: 'Kwota poza dopuszczalnym zakresem' },
      ]),
    );
    renderAccounts();
    await user.click(await screen.findByRole('button', { name: 'Dodaj konto' }));
    const form = within(await screen.findByRole('dialog', { name: 'Nowe konto' }));
    await user.type(form.getByRole('textbox', { name: 'Nazwa' }), 'Lokata');
    await user.click(form.getByRole('button', { name: 'Dodaj konto' }));

    expect(await form.findByText('Żądanie zawiera nieprawidłowe dane.')).toBeInTheDocument();
    expect(
      form.getByRole('textbox', { name: 'Saldo początkowe (zł)' }),
    ).toHaveAccessibleDescription('Kwota poza dopuszczalnym zakresem');
  });
});
