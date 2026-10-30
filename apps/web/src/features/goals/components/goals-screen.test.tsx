import { monthKeyOf, todayInTimezone, type AccountDto, type GoalDto } from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { goalFixture, GOAL_ID } from '../../../../test/goal-fixture.js';
import { renderScreen } from '../../../../test/render-screen.js';
import { AppShell } from '../../../components/layout/app-shell.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import * as accountsApi from '../../accounts/api.js';
import * as goalsApi from '../api.js';
import GoalsRoute from './goals-route.js';
import GoalsScreen from './goals-screen.js';

/**
 * Testy ekranu celów i formularza z przelicznikiem
 * ([06 §3.5](../../../../../../plans/06-ui-views.md#35-cele--goals), `F5-5`, `F5-6`).
 */

const MONTH = monthKeyOf(todayInTimezone('Europe/Warsaw'));
const ROR = '01JB0000000000000000000001';
const SAVINGS = '01JB0000000000000000000002';
const CUSHION = '01JG0000000000000000000002';

/**
 * Konto w kształcie z kontraktu.
 *
 * @param id - Identyfikator.
 * @param name - Nazwa.
 * @param allocationClass - Klasa alokacji.
 * @returns Konto.
 */
function account(
  id: string,
  name: string,
  allocationClass: AccountDto['allocationClass'],
): AccountDto {
  return {
    id,
    name,
    type: allocationClass === 'savings' ? 'savings' : 'checking',
    allocationClass,
    currency: 'PLN',
    openingBalanceMinor: 0,
    openingBalanceOn: '2026-01-01',
    includeInNetWorth: true,
    isArchived: false,
    sortOrder: 0,
    color: null,
    icon: null,
    institution: null,
    notes: null,
    createdAt: 1,
    updatedAt: 1,
  } as AccountDto;
}

/** Cele: wkład własny (plan wykonany) i poduszka bez wpłaty w procencie wpływów. */
const GOALS: GoalDto[] = [
  goalFixture(),
  goalFixture({
    id: CUSHION,
    name: 'Poduszka',
    purpose: 'emergency_fund',
    targetAmountMinor: 3_000_000,
    targetDate: null,
    currentAmountMinor: 1_800_000,
    progressBps: 6000,
    remainingMinor: 1_200_000,
    contributionAmountMinor: null,
    contributionPercentBps: 1000,
    contribution: {
      mode: 'percent_of_income',
      plannedAmountMinor: 118_000,
      plannedPercentBps: 1000,
      contributedThisMonthMinor: 0,
      isPlanMetThisMonth: false,
    },
    projection: {
      paceMonthlyMinor: 118_000,
      monthsToTargetAtCurrentPace: 11,
      projectedCompletionMonth: '2027-08',
      requiredMonthlyToHitTargetDateMinor: null,
      isOnTrack: null,
    },
  }),
];

/** Ekran w powłoce — powłoka daje `ToastProvider`. */
const ROUTES = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'goals', element: <GoalsScreen /> },
      { path: 'goals/:id', element: <GoalsRoute /> },
    ],
  },
];

/**
 * Renderuje ekran z atrapami API.
 *
 * @param goals - Cele z API.
 * @param path - Adres startowy.
 * @returns Router.
 */
function renderGoals(
  goals: GoalDto[] = GOALS,
  path = '/goals',
): ReturnType<typeof renderScreen>['router'] {
  vi.spyOn(goalsApi, 'fetchGoals').mockResolvedValue({
    data: goals,
    meta: {
      month: MONTH,
      incomeBaseMinor: 1_180_000,
      isPartialMonth: true,
      plannedTotalMinor: 318_000,
      contributedTotalMinor: 200_000,
    },
  });
  vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([
    account(ROR, 'ROR', 'spending'),
    account(SAVINGS, 'Konto mieszkaniowe', 'savings'),
  ]);
  return renderScreen(path, ROUTES).router;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GoalsScreen — treść', () => {
  it('„W tym miesiącu" i karty: postęp, plan w obu stronach, stan wpłaty, prognoza', async () => {
    renderGoals();
    const card = within((await screen.findByText('Wkład własny')).closest('li') as HTMLElement);
    expect(card.getByText('35%')).toBeInTheDocument();
    expect(card.getByText(/= 17,0% wpływów/)).toBeInTheDocument();
    expect(card.getByText(/^Wpłacono w/)).toBeInTheDocument();
    expect(card.getByText(/^Przy tym tempie: grudzień 2029/)).toBeInTheDocument();
    expect(card.getByText(/Cel na czerwiec 2028 → potrzeba/)).toBeInTheDocument();
    expect(card.getByText('3 714 zł')).toBeInTheDocument();

    const cushion = within(screen.getByText('Poduszka').closest('li') as HTMLElement);
    expect(cushion.getByText(/Plan: 10,0% wpływów =/)).toBeInTheDocument();
    expect(cushion.getByText(/^Brak wpłaty w/)).toBeInTheDocument();

    const month = screen.getByRole('heading', { name: 'W tym miesiącu' }).closest('section');
    expect(within(month as HTMLElement).getByText('3 180 zł')).toBeInTheDocument();
    expect(within(month as HTMLElement).getByText('2 000 zł')).toBeInTheDocument();
  });

  it('zakładka „Inwestycje" bez celów — pusty stan z akcją', async () => {
    const user = userEvent.setup();
    renderGoals();
    await screen.findByText('Wkład własny');
    await user.click(screen.getByRole('tab', { name: 'Inwestycje' }));
    expect(await screen.findByText('Brak celów inwestycyjnych')).toBeInTheDocument();
  });

  it('pusty stan: akcja otwiera formularz nowego celu', async () => {
    const user = userEvent.setup();
    renderGoals([]);
    await screen.findByText('Brak celów oszczędnościowych');
    const buttons = screen.getAllByRole('button', { name: 'Dodaj cel' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1] as HTMLElement);
    expect(await screen.findByRole('dialog', { name: 'Nowy cel' })).toBeInTheDocument();
  });

  it('„Wpłać": kwota brakująca do planu, konto celu i klucz idempotencji', async () => {
    const user = userEvent.setup();
    const contribute = vi.spyOn(goalsApi, 'contributeToGoal').mockResolvedValue({
      data: { goal: GOALS[1] as GoalDto, transaction: {} as never },
      meta: { affectedMonths: [MONTH] },
    });
    renderGoals([GOALS[0] as GoalDto, { ...(GOALS[1] as GoalDto), linkedAccountId: SAVINGS }]);
    const cushion = within((await screen.findByText('Poduszka')).closest('li') as HTMLElement);
    await user.click(cushion.getByRole('button', { name: 'Wpłać' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Wpłata na „Poduszka”' }));
    expect(await dialog.findByText('Konto mieszkaniowe')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Wpłać' }));
    await waitFor(() => {
      expect(contribute).toHaveBeenCalledWith(
        'token-testowy',
        CUSHION,
        { amountMinor: 118_000, fromAccountId: ROR, toAccountId: SAVINGS },
        expect.any(String),
      );
    });
    expect(await screen.findByText('Wpłacono na „Poduszka”')).toBeInTheDocument();
  });
});

describe('GoalsScreen — pozostałe stany', () => {
  it('ładowanie: szkielet', async () => {
    vi.spyOn(goalsApi, 'fetchGoals').mockReturnValue(new Promise(() => undefined));
    renderScreen('/goals', ROUTES);
    expect(await screen.findByLabelText('Wczytywanie celów')).toHaveAttribute('aria-busy', 'true');
  });

  it('błąd: z ponowieniem', async () => {
    const user = userEvent.setup();
    const fetch = vi
      .spyOn(goalsApi, 'fetchGoals')
      .mockRejectedValueOnce(new ApiRequestError('INTERNAL_ERROR', 'Błąd.', 500, 'req-1'))
      .mockResolvedValue({
        data: GOALS,
        meta: {
          month: MONTH,
          incomeBaseMinor: 0,
          isPartialMonth: true,
          plannedTotalMinor: 0,
          contributedTotalMinor: 0,
        },
      });
    renderScreen('/goals', ROUTES);
    expect(await screen.findByText('Nie udało się wczytać celów')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('Wkład własny')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('wejście z /goals/:id otwiera arkusz tego celu', async () => {
    const router = renderGoals(GOALS, `/goals/${GOAL_ID}`);
    expect(await screen.findByRole('dialog', { name: 'Edytuj cel' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/goals');
  });
});

describe('Formularz celu — przelicznik % ↔ kwota', () => {
  it('kwota przelicza się na procent; zapis w trybie kwoty wysyła tylko kwotę', async () => {
    const user = userEvent.setup();
    const convert = vi.spyOn(goalsApi, 'convertContribution').mockResolvedValue({
      month: MONTH,
      incomeBaseMinor: 1_180_000,
      amountMinor: 200_000,
      percentBps: 1695,
      isPartialMonth: true,
      basedOnIncomeSoFar: true,
    });
    const create = vi.spyOn(goalsApi, 'createGoal').mockResolvedValue(GOALS[0] as GoalDto);
    renderGoals([]);

    await screen.findByText('Brak celów oszczędnościowych');
    const [headerAdd] = screen.getAllByRole('button', { name: 'Dodaj cel' });
    await user.click(headerAdd as HTMLElement);
    const dialog = within(await screen.findByRole('dialog', { name: 'Nowy cel' }));
    await user.type(dialog.getByRole('textbox', { name: 'Nazwa' }), 'Wkład własny');
    await user.type(dialog.getByRole('textbox', { name: 'kwota (zł)' }), '2000');

    await waitFor(() => {
      expect(convert).toHaveBeenCalledWith('token-testowy', { month: MONTH, amountMinor: 200_000 });
    });
    await waitFor(() => {
      expect(dialog.getByRole('textbox', { name: '% wpływów' })).toHaveValue('17');
    });
    expect(dialog.getByText(/Miesiąc trwa/)).toBeInTheDocument();

    await user.click(dialog.getByRole('button', { name: 'Dodaj cel' }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        'token-testowy',
        expect.objectContaining({
          name: 'Wkład własny',
          contributionMode: 'fixed',
          contributionAmountMinor: 200_000,
          contributionPercentBps: null,
        }),
      );
    });
  });

  it('szybki procent i tryb procentowy: zapisuje procent', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'convertContribution').mockResolvedValue({
      month: MONTH,
      incomeBaseMinor: 1_180_000,
      amountMinor: 236_000,
      percentBps: 2000,
      isPartialMonth: true,
      basedOnIncomeSoFar: true,
    });
    const create = vi.spyOn(goalsApi, 'createGoal').mockResolvedValue(GOALS[0] as GoalDto);
    renderGoals([]);

    await screen.findByText('Brak celów oszczędnościowych');
    const [headerAdd] = screen.getAllByRole('button', { name: 'Dodaj cel' });
    await user.click(headerAdd as HTMLElement);
    const dialog = within(await screen.findByRole('dialog', { name: 'Nowy cel' }));
    await user.type(dialog.getByRole('textbox', { name: 'Nazwa' }), 'IKE');
    await user.click(dialog.getByRole('button', { name: '20%' }));
    await waitFor(() => {
      expect(dialog.getByRole('textbox', { name: 'kwota (zł)' })).toHaveValue('2360');
    });
    await user.click(dialog.getByRole('radio', { name: 'Procent wpływów' }));
    await user.click(dialog.getByRole('button', { name: 'Dodaj cel' }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        'token-testowy',
        expect.objectContaining({
          contributionMode: 'percent_of_income',
          contributionAmountMinor: null,
          contributionPercentBps: 2000,
        }),
      );
    });
  });
});
