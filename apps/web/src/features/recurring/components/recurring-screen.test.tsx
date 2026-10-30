import type { AccountDto, RecurringRuleDto } from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '../../../../test/render-screen.js';
import { AppShell } from '../../../components/layout/app-shell.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import * as accountsApi from '../../accounts/api.js';
import * as categoriesApi from '../../categories/api.js';
import * as recurringApi from '../api.js';
import RecurringRoute from './recurring-route.js';
import RecurringScreen from './recurring-screen.js';

/**
 * Testy ekranu pozycji cyklicznych — cztery stany, grupy, przełącznik, formularz
 * ([06 §3.9](../../../../../../plans/06-ui-views.md#39-pozycje-cykliczne--recurring), `F4-5`).
 */

const ROR = '01JB0000000000000000000001';
const SAVINGS = '01JB0000000000000000000002';
const RENT = '01JB0000000000000000000011';
const IKE = '01JB0000000000000000000012';
const SALARY = '01JB0000000000000000000013';
const GYM = '01JB0000000000000000000014';
const POWER = '01JB0000000000000000000015';

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

const ACCOUNTS = [
  account(ROR, { name: 'ROR' }),
  account(SAVINGS, { name: 'IKE', type: 'investment', allocationClass: 'investment' }),
];

/**
 * Reguła w kształcie z kontraktu — domyślnie czynsz 1 850 zł 10. dnia.
 *
 * @param id - Identyfikator.
 * @param overrides - Nadpisane pola.
 * @returns Reguła.
 */
function rule(id: string, overrides: Partial<RecurringRuleDto> = {}): RecurringRuleDto {
  return {
    id,
    name: 'Czynsz',
    flow: 'expense',
    amountMinor: 185_000,
    amountIsEstimate: false,
    currency: 'PLN',
    accountId: ROR,
    counterAccountId: null,
    categoryId: null,
    incomeSourceId: null,
    goalId: null,
    liabilityId: null,
    allocationOverride: null,
    frequency: 'monthly',
    intervalCount: 1,
    dayOfMonth: 10,
    weekday: null,
    monthOfYear: null,
    anchorDate: '2026-09-01',
    startMonth: '2026-09',
    endMonth: null,
    autoPost: false,
    isFixedExpense: true,
    isActive: true,
    notes: null,
    nextDueOn: '2026-10-10',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** Przykład z 06 §3.9. */
const RULES: RecurringRuleDto[] = [
  rule(RENT),
  rule(POWER, { name: 'Prąd', amountMinor: 28_000, amountIsEstimate: true, dayOfMonth: 15 }),
  rule(IKE, {
    name: 'IKE',
    flow: 'transfer',
    amountMinor: 100_000,
    counterAccountId: SAVINGS,
    dayOfMonth: 5,
    autoPost: true,
    isFixedExpense: false,
  }),
  rule(SALARY, {
    name: 'Wynagrodzenie',
    flow: 'income',
    amountMinor: 980_000,
    isFixedExpense: false,
  }),
  rule(GYM, { name: 'Siłownia', amountMinor: 12_000, isActive: false, isFixedExpense: false }),
];

/**
 * Cel przejścia „Utwórz tam zamiast tego" — pokazuje przekazane wartości z góry.
 *
 * @returns Element z JSON-em stanu nawigacji.
 */
function PlannedTarget(): ReactNode {
  return <pre data-testid="planned-state">{JSON.stringify(useLocation().state)}</pre>;
}

/** Ekran w powłoce — powłoka daje `ToastProvider`. */
const SCREEN_ROUTES = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'recurring', element: <RecurringScreen /> },
      { path: 'recurring/:id', element: <RecurringRoute /> },
      { path: 'planned', element: <PlannedTarget /> },
    ],
  },
];

/**
 * Renderuje ekran z atrapami API.
 *
 * @param path - Adres startowy.
 * @param rules - Odpowiedź listy reguł.
 * @returns Router.
 */
function renderRecurring(
  path = '/recurring',
  rules: RecurringRuleDto[] = RULES,
): ReturnType<typeof renderScreen>['router'] {
  vi.spyOn(recurringApi, 'fetchRules').mockResolvedValue(rules);
  vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue(ACCOUNTS);
  vi.spyOn(categoriesApi, 'fetchCategoryTree').mockResolvedValue([]);
  return renderScreen(path, SCREEN_ROUTES).router;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecurringScreen — treść', () => {
  it('podsumowanie miesięczne i grupy w kolejności z sumami', async () => {
    renderRecurring();
    await screen.findByText('Czynsz');

    const summary = screen.getByRole('heading', { name: 'Miesięcznie' }).closest('section');
    const scope = within(summary as HTMLElement);
    expect(scope.getByText('−2 130,00 zł')).toBeInTheDocument();
    expect(scope.getByText('+9 800,00 zł')).toBeInTheDocument();
    expect(scope.getByText('1 000,00 zł')).toBeInTheDocument();

    const main = summary?.closest('main');
    const headings = within(main as HTMLElement)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual([
      'Miesięcznie',
      'Wydatki stałe',
      'Odkładanie',
      'Wpływy',
      'Wstrzymane',
    ]);

    const fixed = screen.getByRole('heading', { name: 'Wydatki stałe' }).closest('section');
    expect(within(fixed as HTMLElement).getByText('2 130,00 zł')).toBeInTheDocument();
  });

  it('wiersz: terminarz, auto-księgowanie, plakietka „szac."', async () => {
    renderRecurring();
    const ike = (await screen.findByText('IKE')).closest('button');
    expect(within(ike as HTMLElement).getByText('5. dnia · auto-księgowanie')).toBeInTheDocument();
    const power = screen.getByText('Prąd').closest('button');
    expect(within(power as HTMLElement).getByText('szac.')).toBeInTheDocument();
  });

  it('przełącznik wstrzymuje od razu i woła API', async () => {
    const user = userEvent.setup();
    const pause = vi
      .spyOn(recurringApi, 'setRuleActive')
      .mockResolvedValue(rule(RENT, { isActive: false }));
    renderRecurring();
    // Po zapisie lista z serwera ma już regułę wstrzymaną.
    vi.mocked(recurringApi.fetchRules)
      .mockResolvedValueOnce(RULES)
      .mockResolvedValue(
        RULES.map((item) => (item.id === RENT ? { ...item, isActive: false } : item)),
      );

    await user.click(await screen.findByRole('switch', { name: 'Wstrzymaj „Czynsz"' }));
    // Wiersz przechodzi do „Wstrzymane" z wyłączonym przełącznikiem.
    const paused = screen.getByRole('heading', { name: 'Wstrzymane' }).closest('section');
    expect(
      within(paused as HTMLElement).getByRole('switch', { name: 'Wznów „Czynsz"' }),
    ).toHaveAttribute('aria-checked', 'false');
    await waitFor(() => {
      expect(pause).toHaveBeenCalledWith('token-testowy', RENT, false);
    });
    expect(await screen.findByText('Wstrzymano „Czynsz"')).toBeInTheDocument();
  });

  it('błąd przełącznika przywraca poprzedni stan', async () => {
    const user = userEvent.setup();
    vi.spyOn(recurringApi, 'setRuleActive').mockRejectedValue(
      new ApiRequestError('NOT_FOUND', 'Nie znaleziono pozycji cyklicznej.', 404, 'req-1'),
    );
    renderRecurring();
    const toggle = await screen.findByRole('switch', { name: 'Wstrzymaj „Czynsz"' });
    await user.click(toggle);
    expect(await screen.findByText('Nie znaleziono pozycji cyklicznej.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Wstrzymaj „Czynsz"' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('RecurringScreen — pozostałe stany', () => {
  it('ładowanie: szkielet', async () => {
    vi.spyOn(recurringApi, 'fetchRules').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue(ACCOUNTS);
    renderScreen('/recurring', SCREEN_ROUTES);
    expect(await screen.findByLabelText('Wczytywanie pozycji cyklicznych')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('pusto: jedna akcja otwiera formularz', async () => {
    const user = userEvent.setup();
    renderRecurring('/recurring', []);
    expect(await screen.findByText('Nie masz jeszcze pozycji cyklicznych')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dodaj pozycję' }));
    expect(
      await screen.findByRole('dialog', { name: 'Nowa pozycja cykliczna' }),
    ).toBeInTheDocument();
  });

  it('błąd: bez starych danych, z ponowieniem', async () => {
    const user = userEvent.setup();
    const fetchRules = vi
      .spyOn(recurringApi, 'fetchRules')
      .mockRejectedValueOnce(new ApiRequestError('INTERNAL_ERROR', 'Wystąpił błąd.', 500, 'req-1'))
      .mockResolvedValue(RULES);
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue(ACCOUNTS);
    renderScreen('/recurring', SCREEN_ROUTES);

    expect(
      await screen.findByText('Nie udało się wczytać pozycji cyklicznych'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('Czynsz')).toBeInTheDocument();
    expect(fetchRules).toHaveBeenCalledTimes(2);
  });
});

describe('RecurringScreen — formularz', () => {
  it('nowa pozycja: ciało z formularza i podgląd terminów', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(recurringApi, 'createRule').mockResolvedValue(rule(RENT));
    renderRecurring();

    await user.click(await screen.findByRole('button', { name: 'Dodaj pozycję cykliczną' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Nowa pozycja cykliczna' }));
    await user.type(dialog.getByRole('textbox', { name: 'Nazwa' }), 'Internet');
    await user.type(dialog.getByRole('textbox', { name: 'Kwota' }), '89');
    const day = dialog.getByRole('textbox', { name: 'Dzień miesiąca' });
    await user.clear(day);
    await user.type(day, '20');
    expect(dialog.getByText(/^Najbliższe terminy: /)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        'token-testowy',
        expect.objectContaining({
          name: 'Internet',
          flow: 'expense',
          amountMinor: 8_900,
          accountId: ROR,
          frequency: 'monthly',
          dayOfMonth: 20,
          isFixedExpense: true,
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('pusta nazwa i kwota: błędy pod polami, żadnego żądania', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(recurringApi, 'createRule');
    renderRecurring();
    await user.click(await screen.findByRole('button', { name: 'Dodaj pozycję cykliczną' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Nowa pozycja cykliczna' }));
    await user.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    expect(await dialog.findByText('Nazwa jest wymagana')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('edycja: dotknięcie wiersza, zmiana dnia — wysyła tylko zmianę', async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(recurringApi, 'updateRule').mockResolvedValue(rule(RENT));
    renderRecurring();
    await user.click(await screen.findByText('Czynsz'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edytuj pozycję' }));
    const day = dialog.getByRole('textbox', { name: 'Dzień miesiąca' });
    await user.clear(day);
    await user.type(day, '12');
    await user.click(dialog.getByRole('button', { name: 'Zapisz zmiany' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('token-testowy', RENT, { dayOfMonth: 12 });
    });
  });

  it('usunięcie wymaga potwierdzenia', async () => {
    const user = userEvent.setup();
    const remove = vi.spyOn(recurringApi, 'deleteRule').mockResolvedValue(undefined);
    renderRecurring();
    await user.click(await screen.findByText('Czynsz'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edytuj pozycję' }));
    await user.click(dialog.getByRole('button', { name: 'Usuń pozycję' }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(dialog.getByRole('button', { name: 'Usuń' }));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith('token-testowy', RENT);
    });
  });

  it('wejście z /recurring/:id otwiera arkusz tej reguły', async () => {
    const router = renderRecurring(`/recurring/${SALARY}`);
    const dialog = await screen.findByRole('dialog', { name: 'Edytuj pozycję' });
    expect(within(dialog).getByRole('textbox', { name: 'Nazwa' })).toHaveValue('Wynagrodzenie');
    expect(router.state.location.pathname).toBe('/recurring');
  });
});

describe('RecurringScreen — podpowiedź planowanych wydatków (F6-9)', () => {
  it('roczny wydatek: podpowiedź i przejście z tym, co już wpisano', async () => {
    const user = userEvent.setup();
    const router = renderRecurring();
    await user.click(await screen.findByRole('button', { name: 'Dodaj pozycję cykliczną' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Nowa pozycja cykliczna' }));
    expect(dialog.queryByText(/lepiej sprawdzą się Planowane wydatki/u)).not.toBeInTheDocument();
    await user.type(dialog.getByRole('textbox', { name: 'Nazwa' }), 'OC');
    await user.type(dialog.getByRole('textbox', { name: 'Kwota' }), '2400');
    await user.click(dialog.getByRole('radio', { name: 'Co roku' }));
    expect(dialog.getByText(/lepiej sprawdzą się Planowane wydatki/u)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Utwórz tam zamiast tego' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/planned');
    });
    const state = JSON.parse(screen.getByTestId('planned-state').textContent ?? '{}') as {
      preset: { name: string; amountMinor: number; dueMonth: string };
    };
    expect(state.preset).toMatchObject({ name: 'OC', amountMinor: 240_000 });
    expect(state.preset.dueMonth).toMatch(/^\d{4}-\d{2}$/u);
  });
});
