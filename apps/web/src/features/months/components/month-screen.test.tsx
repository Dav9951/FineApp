import type {
  AccountDto,
  AllocationStatusDto,
  MonthSummaryDto,
  RecurringOccurrenceDto,
  TransactionListItemDto,
} from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { goalFixture } from '../../../../test/goal-fixture.js';
import { plannedFixture, plannedSectionFixture } from '../../../../test/planned-fixture.js';
import { renderScreen } from '../../../../test/render-screen.js';
import { AppShell } from '../../../components/layout/app-shell.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import * as accountsApi from '../../accounts/api.js';
import * as goalsApi from '../../goals/api.js';
import * as plannedApi from '../../planned-expenses/api.js';
import * as recurringApi from '../../recurring/api.js';
import * as transactionsApi from '../../transactions/api.js';
import * as monthsApi from '../api.js';
import MonthScreen from './month-screen.js';

/**
 * Testy ekranu miesiąca — cztery stany, sekcje, przełącznik z siatką
 * ([06 §3.1](../../../../../../plans/06-ui-views.md#31-miesiąc-dashboard--mmonth), 15 §2.8).
 */

const ROR = '01JB0000000000000000000001';
const HOME = '01JB0000000000000000000002';
const FOOD = '01JB0000000000000000000011';
const TX = '01JB0000000000000000000031';

/**
 * Transakcja z nazwami.
 *
 * @param overrides - Nadpisane pola.
 * @returns Pozycja listy.
 */
function transaction(overrides: Partial<TransactionListItemDto> = {}): TransactionListItemDto {
  return {
    id: TX,
    type: 'expense',
    status: 'posted',
    bookedOn: '2026-09-18',
    monthKey: '2026-09',
    amountMinor: 12_799,
    currency: 'PLN',
    accountId: ROR,
    counterAccountId: null,
    categoryId: FOOD,
    incomeSourceId: null,
    liabilityId: null,
    goalId: null,
    sourceAllocationClass: null,
    targetAllocationClass: null,
    allocationOverride: null,
    allocationEffects: [],
    description: null,
    merchant: 'Lidl',
    notes: null,
    source: 'manual',
    sourceDocumentId: null,
    recurringOccurrenceId: null,
    plannedExpenseId: null,
    createdBy: '01J9ZQK8WQ0000000000000000',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    accountName: 'ROR',
    counterAccountName: null,
    categoryName: 'Jedzenie',
    categoryIcon: null,
    categoryColor: null,
    incomeSourceName: null,
    goalName: null,
    liabilityName: null,
    createdByName: 'Adam Kowalski',
    ...overrides,
  };
}

/**
 * Stan rozkładu września: bez rozkładu (`null`) albo z przykładu 04 §11 — 2 000 z 2 360
 * w oszczędnościach, inwestycje wykonane.
 *
 * @param effectiveFromMonth - Miesiąc wersji rozkładu; `null` — rozkładu nie ma.
 * @returns Stan rozkładu.
 */
function allocation(effectiveFromMonth: string | null): AllocationStatusDto {
  const planned = effectiveFromMonth !== null;
  return {
    month: '2026-09',
    effectiveFromMonth,
    incomeBaseMinor: 1_180_000,
    isPartialMonth: true,
    daysElapsed: 20,
    daysInMonth: 30,
    lines: [
      {
        kind: 'savings',
        targetPercentBps: planned ? 2000 : 0,
        targetAmountMinor: planned ? 236_000 : 0,
        actualAmountMinor: 200_000,
        actualPercentBps: 1695,
        deltaAmountMinor: planned ? -36_000 : 200_000,
        deltaPercentBps: planned ? -305 : 1695,
        fulfillmentBps: planned ? 8475 : 0,
        status: planned ? 'on_track' : 'met',
      },
      {
        kind: 'investment',
        targetPercentBps: planned ? 1000 : 0,
        targetAmountMinor: planned ? 118_000 : 0,
        actualAmountMinor: planned ? 118_000 : 0,
        actualPercentBps: planned ? 1000 : 0,
        deltaAmountMinor: 0,
        deltaPercentBps: 0,
        fulfillmentBps: planned ? 10_000 : 0,
        status: 'met',
      },
    ],
    totals: {
      targetPercentBps: planned ? 3000 : 0,
      actualPercentBps: planned ? 2695 : 1695,
      targetAmountMinor: planned ? 354_000 : 0,
      actualAmountMinor: planned ? 318_000 : 200_000,
      shortfallMinor: planned ? 36_000 : 0,
    },
  };
}

/**
 * Podsumowanie września z danymi z 06 §3.1.
 *
 * @param overrides - Nadpisane pola.
 * @returns Podsumowanie.
 */
function summary(overrides: Partial<MonthSummaryDto> = {}): MonthSummaryDto {
  return {
    month: '2026-09',
    range: { from: '2026-09-01', to: '2026-09-30' },
    isCurrent: true,
    isPartial: true,
    isFuture: false,
    daysElapsed: 20,
    daysInMonth: 30,
    canPostBackTo: '2026-08-01',
    canPostUntil: '2026-09-30',
    totals: {
      incomeMinor: 1_180_000,
      incomeBaseMinor: 1_180_000,
      expenseMinor: 642_300,
      savingsMinor: 200_000,
      investmentMinor: 0,
      debtRepaymentMinor: 0,
      netMinor: 337_700,
      unallocatedMinor: 337_700,
    },
    accounts: [
      {
        accountId: ROR,
        name: 'ROR',
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
        balanceAtMonthStartMinor: 4_000_000,
        changeInMonthMinor: 200_000,
      },
    ],
    netWorthMinor: 5_043_210,
    topCategories: [
      {
        categoryId: FOOD,
        name: 'Jedzenie',
        color: null,
        icon: null,
        amountMinor: 187_400,
        shareBps: 2918,
        transactionCount: 23,
        previousMonthAmountMinor: 250_000,
      },
    ],
    uncategorizedCount: 3,
    recentTransactions: [transaction()],
    comparison: {
      previousMonth: '2026-08',
      hasPreviousData: true,
      incomeDeltaMinor: 0,
      incomeDeltaBps: 0,
      expenseDeltaMinor: -41_200,
      expenseDeltaBps: -603,
    },
    recurring: {
      plannedTotalMinor: 0,
      postedTotalMinor: 0,
      pendingCount: 0,
      overdueCount: 0,
      items: [],
    },
    liabilities: {
      totalRemainingMinor: 0,
      monthlyPaymentTotalMinor: 0,
      paidThisMonthMinor: 0,
      unpaidCount: 0,
      items: [],
    },
    allocation: allocation(null),
    goals: [],
    plannedExpenses: {
      dueThisMonthMinor: 0,
      upcoming6MonthsMinor: 0,
      monthlySetAsideRequiredMinor: 0,
      setAsidePaidThisMonthMinor: 0,
      warningCount: 0,
      warnings: [],
      items: [],
      readyToPay: [],
    },
    budget: {
      month: '2026-09',
      hasDraft: false,
      canCreate: true,
      leftoverMinor: null,
      nextMonth: '2026-10',
      nextMonthHasDraft: false,
      suggestNextMonth: false,
    },
    ...overrides,
  };
}

/**
 * Renderuje ekran miesiąca w powłoce (arkusz transakcji żyje w powłoce).
 *
 * @param path - Adres startowy.
 * @returns Router.
 */
function renderMonth(path = '/m/2026-09'): ReturnType<typeof renderScreen>['router'] {
  return renderScreen(path, [
    {
      path: '/',
      element: <AppShell />,
      children: [
        { path: 'm/:month', element: <MonthScreen /> },
        { path: 'm/:month/transactions', element: <p>ekran historii</p> },
        { path: 'm/:month/categories', element: <p>ekran kategorii</p> },
        { path: 'accounts', element: <p>ekran kont</p> },
        { path: 'accounts/:id', element: <p>szczegóły konta</p> },
        { path: 'budget/:month', element: <p>ekran planu</p> },
      ],
    },
  ]).router;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Ekran miesiąca — treść', () => {
  it('konta, podsumowanie z porównaniem, kategorie, ostatnie', async () => {
    const fetch = vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(summary());
    renderMonth();

    // Szkielet też ma nagłówek „Konta" — czekamy na treść.
    expect(await screen.findByText('majątek netto')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('token-testowy', '2026-09');
    expect(screen.getByRole('link', { name: /Konto mieszkaniowe/ })).toHaveAttribute(
      'href',
      `/accounts/${HOME}`,
    );
    // Taśma kont jest pozycjonowana: tekst `sr-only` w kaflach przewiniętych za ekran
    // nie może poszerzać strony (inaczej FAB wyjeżdża za prawą krawędź, ADR-074).
    expect(screen.getByRole('link', { name: /Konto mieszkaniowe/ }).closest('ul')).toHaveClass(
      'relative',
      'overflow-x-auto',
    );

    // Porównanie niesie strzałka i słowo dla czytnika ekranu, nie kolor.
    expect(screen.getByText('↓ 6% do sierpnia')).toBeInTheDocument();
    expect(screen.getByText('o 6% mniej niż w sierpniu')).toBeInTheDocument();
    expect(screen.getByText('Na oszczędności')).toBeInTheDocument();
    expect(screen.getByText('Zostaje')).toBeInTheDocument();
    expect(screen.getByText('20 z 30 dni')).toBeInTheDocument();
    expect(screen.getByText('do 1 października zostało 10 dni')).toBeInTheDocument();

    expect(screen.getByText('29%')).toBeInTheDocument();
    expect(screen.getByText('mniej niż miesiąc wcześniej')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /3 wydatki bez kategorii/ })).toHaveAttribute(
      'href',
      '/m/2026-09/transactions?type=expense&uncategorized=true',
    );
    expect(screen.getByRole('link', { name: 'szczegóły' })).toHaveAttribute(
      'href',
      '/m/2026-09/categories',
    );

    expect(screen.getByText('Lidl')).toBeInTheDocument();
    expect(screen.getByText('18 wrz · Jedzenie · ROR · AK')).toBeInTheDocument();
  });

  it('dotknięcie ostatniej transakcji otwiera arkusz edycji', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(summary());
    const fetchTx = vi.spyOn(transactionsApi, 'fetchTransaction').mockResolvedValue(transaction());
    renderMonth();

    await userEvent.click(await screen.findByRole('button', { name: /Lidl/ }));
    expect(await screen.findByRole('dialog', { name: 'Edytuj transakcję' })).toBeInTheDocument();
    expect(fetchTx).toHaveBeenCalledWith('token-testowy', TX);
  });

  it('miesiąc na minusie i wypłata z oszczędności', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({
        totals: {
          incomeMinor: 100_000,
          incomeBaseMinor: 100_000,
          expenseMinor: 300_000,
          savingsMinor: -50_000,
          investmentMinor: 0,
          debtRepaymentMinor: 0,
          netMinor: -150_000,
          unallocatedMinor: 0,
        },
      }),
    );
    renderMonth();
    expect(await screen.findByText('Na minusie')).toBeInTheDocument();
    expect(screen.getByText('Z oszczędności')).toBeInTheDocument();
  });

  it('pusty miesiąc u kogoś, kto ma konta: zera i „Dodaj wydatek", bez kroków startowych', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({ topCategories: [], uncategorizedCount: 0, recentTransactions: [] }),
    );
    renderMonth();
    expect(await screen.findByText('W tym miesiącu nie ma jeszcze wydatków.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dodaj wydatek' })).toBeInTheDocument();
    expect(screen.queryByText('Zacznijmy od kont')).not.toBeInTheDocument();
  });

  it('miesiąc zamknięty i przyszły mają baner, a zamknięty nie proponuje dodania', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({
        month: '2026-06',
        range: { from: '2026-06-01', to: '2026-06-30' },
        isCurrent: false,
        isPartial: false,
        recentTransactions: [],
      }),
    );
    renderMonth('/m/2026-06');
    expect(await screen.findByRole('note')).toHaveTextContent('Miesiąc zamknięty');
    expect(screen.queryByText('20 z 30 dni')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dodaj wydatek' })).not.toBeInTheDocument();
  });
});

describe('Ekran miesiąca — stany', () => {
  it('ładowanie: szkielet i przygaszony przełącznik', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockReturnValue(new Promise(() => undefined));
    renderMonth();
    expect(await screen.findByLabelText('Wczytywanie miesiąca')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: /wybierz miesiąc/ })).toBeDisabled();
  });

  it('błąd: komunikat i ponowienie', async () => {
    const fetch = vi
      .spyOn(monthsApi, 'fetchMonthSummary')
      .mockRejectedValueOnce(new ApiRequestError('INTERNAL_ERROR', 'Awaria.', 500, 'req-1'))
      .mockResolvedValue(summary());
    renderMonth();
    expect(await screen.findByText('Nie udało się wczytać miesiąca')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('majątek netto')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('pierwsze uruchomienie: kroki startowe z jedną akcją', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({
        accounts: [],
        recentTransactions: [],
        topCategories: [],
        uncategorizedCount: 0,
        comparison: {
          previousMonth: '2026-08',
          hasPreviousData: false,
          incomeDeltaMinor: 0,
          incomeDeltaBps: 0,
          expenseDeltaMinor: 0,
          expenseDeltaBps: 0,
        },
      }),
    );
    renderMonth();
    expect(await screen.findByText('Zacznijmy od kont')).toBeInTheDocument();
    const steps = screen.getByText('Dodaj konta').closest('ol');
    expect(steps).not.toBeNull();
    expect(within(steps as HTMLElement).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Dodaj konto' })).toHaveAttribute('href', '/accounts');
  });
});

describe('Przełącznik miesiąca (F3-5)', () => {
  it('strzałki prowadzą do sąsiednich miesięcy', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(summary());
    renderMonth();
    expect(
      await screen.findByRole('link', { name: 'Poprzedni miesiąc: sierpień 2026' }),
    ).toHaveAttribute('href', '/m/2026-08');
  });

  it('siatka: miesiące bez danych opisane, wybór przenosi do miesiąca', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(summary());
    const available = vi
      .spyOn(monthsApi, 'fetchAvailableMonths')
      .mockResolvedValue({ currentMonth: '2026-09', months: ['2026-07', '2026-09'] });
    const router = renderMonth();

    await userEvent.click(await screen.findByRole('button', { name: /wybierz miesiąc/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Wybierz miesiąc' });
    expect(available).toHaveBeenCalled();
    expect(
      await within(dialog).findByRole('button', { name: 'sierpień 2026, bez danych' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'wrzesień 2026, bieżący' })).toHaveAttribute(
      'aria-current',
      'date',
    );

    await userEvent.click(within(dialog).getByRole('button', { name: 'lipiec 2026' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/m/2026-07');
    });
  });

  it('po wczytaniu pobiera w tle sąsiednie miesiące', async () => {
    const fetch = vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(summary());
    renderMonth();
    await waitFor(
      () => {
        expect(fetch).toHaveBeenCalledWith('token-testowy', '2026-08');
        expect(fetch).toHaveBeenCalledWith('token-testowy', '2026-10');
      },
      { timeout: 3_000 },
    );
  });
});

/**
 * Wystąpienie do sekcji „Do zrobienia" — domyślnie czynsz z 10 września, zaległy.
 *
 * @param overrides - Nadpisane pola.
 * @returns Wystąpienie.
 */
function occurrence(overrides: Partial<RecurringOccurrenceDto> = {}): RecurringOccurrenceDto {
  return {
    id: '01JK0000000000000000000001',
    ruleId: '01JL0000000000000000000001',
    ruleName: 'Czynsz',
    flow: 'expense',
    dueOn: '2026-09-10',
    monthKey: '2026-09',
    plannedAmountMinor: 185_000,
    status: 'planned',
    postedAmountMinor: null,
    transactionId: null,
    categoryId: null,
    categoryName: null,
    allocationEffects: [],
    isFixedExpense: true,
    isOverdue: true,
    amountIsEstimate: false,
    ...overrides,
  };
}

/**
 * Podsumowanie z sekcją pozycji cyklicznych.
 *
 * @param items - Do zrobienia.
 * @param totals - Plan i wykonanie.
 * @param totals.planned - Plan miesiąca.
 * @param totals.posted - Zaksięgowane.
 * @returns Podsumowanie.
 */
function withTodo(
  items: RecurringOccurrenceDto[],
  totals: { planned: number; posted: number } = { planned: 213_000, posted: 0 },
): MonthSummaryDto {
  return summary({
    recurring: {
      plannedTotalMinor: totals.planned,
      postedTotalMinor: totals.posted,
      pendingCount: items.length,
      overdueCount: items.filter((item) => item.isOverdue).length,
      items,
    },
  });
}

describe('Ekran miesiąca — „Do zrobienia" (F4-7)', () => {
  it('bez pozycji cyklicznych sekcji nie ma', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(summary());
    renderMonth();
    await screen.findByText('majątek netto');
    expect(screen.queryByRole('heading', { name: /Do zrobienia/ })).not.toBeInTheDocument();
  });

  it('wiersze: zaległe z poprzedniego miesiąca na górze, plan i wykonanie', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      withTodo([
        occurrence({
          id: '01JK0000000000000000000002',
          dueOn: '2026-08-10',
          monthKey: '2026-08',
        }),
        occurrence({
          ruleName: 'Prąd',
          plannedAmountMinor: 28_000,
          dueOn: '2026-09-25',
          isOverdue: false,
          amountIsEstimate: true,
        }),
      ]),
    );
    renderMonth();
    const section = (
      await screen.findByRole('heading', { name: 'Do zrobienia w tym miesiącu' })
    ).closest('section');
    const scope = within(section as HTMLElement);
    expect(scope.getByText('10 sie · zaległe za sierpień 2026')).toBeInTheDocument();
    expect(scope.getByText('25 wrz · kwota szacunkowa')).toBeInTheDocument();
    expect(scope.getByText('−1 850,00 zł')).toBeInTheDocument();
    expect(scope.getByText(/z\s+planu/)).toBeInTheDocument();
  });

  it('„Zaksięguj" jednym dotknięciem z kluczem, „Cofnij" cofa zaksięgowanie', async () => {
    const user = userEvent.setup();
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(withTodo([occurrence()]));
    const post = vi.spyOn(recurringApi, 'postOccurrence').mockResolvedValue({
      data: { occurrence: occurrence({ status: 'posted' }), transaction: {} as never },
      meta: { affectedMonths: ['2026-09'] },
    });
    const unpost = vi.spyOn(recurringApi, 'unpostOccurrence').mockResolvedValue({
      data: occurrence(),
      meta: { affectedMonths: ['2026-09'] },
    });
    renderMonth();
    const section = (
      await screen.findByRole('heading', { name: 'Do zrobienia w tym miesiącu' })
    ).closest('section');
    await user.click(within(section as HTMLElement).getByRole('button', { name: 'Zaksięguj' }));
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        'token-testowy',
        '01JK0000000000000000000001',
        {},
        expect.any(String),
      );
    });
    await user.click(await screen.findByRole('button', { name: 'Cofnij' }));
    await waitFor(() => {
      expect(unpost).toHaveBeenCalledWith('token-testowy', '01JK0000000000000000000001');
    });
  });

  it('kwota szacunkowa: arkusz z kwotą do potwierdzenia', async () => {
    const user = userEvent.setup();
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      withTodo([
        occurrence({ ruleName: 'Prąd', plannedAmountMinor: 28_000, amountIsEstimate: true }),
      ]),
    );
    const post = vi.spyOn(recurringApi, 'postOccurrence').mockResolvedValue({
      data: { occurrence: occurrence(), transaction: {} as never },
      meta: { affectedMonths: ['2026-09'] },
    });
    renderMonth();
    const section = (
      await screen.findByRole('heading', { name: 'Do zrobienia w tym miesiącu' })
    ).closest('section');
    await user.click(within(section as HTMLElement).getByRole('button', { name: 'Zaksięguj' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Zaksięguj „Prąd"' }));
    expect(post).not.toHaveBeenCalled();
    // Pole z klawiaturą kwoty: „280" z planu kasujemy cofaniem, potem wpisujemy rachunek.
    await user.click(dialog.getByRole('textbox', { name: 'Kwota z rachunku' }));
    await user.keyboard('{Backspace}{Backspace}{Backspace}312');
    await user.click(dialog.getByRole('button', { name: 'Zaksięguj' }));
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        'token-testowy',
        '01JK0000000000000000000001',
        { amountMinor: 31_200 },
        expect.any(String),
      );
    });
  });

  it('„Pomiń" woła API z miesiącem wystąpienia', async () => {
    const user = userEvent.setup();
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(withTodo([occurrence()]));
    const skip = vi
      .spyOn(recurringApi, 'skipOccurrence')
      .mockResolvedValue(occurrence({ status: 'skipped' }));
    renderMonth();
    const section = (
      await screen.findByRole('heading', { name: 'Do zrobienia w tym miesiącu' })
    ).closest('section');
    await user.click(within(section as HTMLElement).getByRole('button', { name: 'Pomiń' }));
    await waitFor(() => {
      expect(skip).toHaveBeenCalledWith('token-testowy', '01JK0000000000000000000001', {
        reason: null,
      });
    });
    expect(await screen.findByText('Pominięto „Czynsz" w tym miesiącu')).toBeInTheDocument();
  });

  it('wszystko zrobione — potwierdzenie zamiast listy', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      withTodo([], { planned: 185_000, posted: 185_000 }),
    );
    renderMonth();
    expect(await screen.findByText('Wszystko na ten miesiąc zrobione.')).toBeInTheDocument();
  });

  it('miesiąc przyszły: „Zaplanowane", bez przycisków', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({
        month: '2026-11',
        isCurrent: false,
        isPartial: false,
        isFuture: true,
        recurring: {
          plannedTotalMinor: 185_000,
          postedTotalMinor: 0,
          pendingCount: 1,
          overdueCount: 0,
          items: [
            occurrence({ id: null, dueOn: '2026-11-10', monthKey: '2026-11', isOverdue: false }),
          ],
        },
      }),
    );
    renderMonth('/m/2026-11');
    const section = (await screen.findByRole('heading', { name: /^Zaplanowane/ })).closest(
      'section',
    );
    expect(
      within(section as HTMLElement).queryByRole('button', { name: 'Zaksięguj' }),
    ).not.toBeInTheDocument();
  });
});

describe('Ekran miesiąca — cele procentowe i cele (F5-8)', () => {
  it('bez rozkładu: zachęta z odnośnikiem „ustaw", bez pierścieni', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(summary());
    renderMonth();
    const tile = (await screen.findByRole('heading', { name: 'Cele procentowe' })).closest(
      'section',
    );
    const scope = within(tile as HTMLElement);
    expect(scope.getByText(/Ustal, jaki procent wpływów/)).toBeInTheDocument();
    expect(scope.getByRole('link', { name: 'ustaw' })).toHaveAttribute('href', '/allocation');
    expect(scope.queryByRole('img')).not.toBeInTheDocument();
  });

  it('pierścienie, udział we wpływach i „Uzupełnij" z brakującą kwotą w przelewie', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({ allocation: allocation('2026-09') }),
    );
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([]);
    vi.spyOn(goalsApi, 'fetchGoals').mockResolvedValue({
      data: [],
      meta: {
        month: '2026-09',
        incomeBaseMinor: 0,
        isPartialMonth: true,
        plannedTotalMinor: 0,
        contributedTotalMinor: 0,
      },
    });
    renderMonth();
    const tile = (await screen.findByRole('heading', { name: 'Cele procentowe' })).closest(
      'section',
    );
    const scope = within(tile as HTMLElement);
    expect(scope.getByRole('img', { name: 'Wykonanie 85%' })).toBeInTheDocument();
    expect(scope.getByRole('img', { name: 'Wykonanie 100%, cel osiągnięty' })).toBeInTheDocument();
    expect(scope.getByText('17,0% z 20,0% wpływów')).toBeInTheDocument();
    expect(scope.getByText('360,00 zł')).toBeInTheDocument();

    await userEvent.click(scope.getByRole('button', { name: 'Uzupełnij' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nowy przelew' });
    expect(within(dialog).getByRole('textbox', { name: 'Kwota' })).toHaveTextContent('360');
  });

  it('miesiąc przyszły: niedobór bez przycisku; wypłata z puli — zdanie, nie liczba', async () => {
    const base = allocation('2026-09');
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({
        isCurrent: false,
        isFuture: true,
        allocation: {
          ...base,
          lines: base.lines.map((line) =>
            line.kind === 'savings' ? { ...line, actualAmountMinor: -1_000 } : line,
          ),
        },
      }),
    );
    renderMonth();
    const tile = (await screen.findByRole('heading', { name: 'Cele procentowe' })).closest(
      'section',
    );
    const scope = within(tile as HTMLElement);
    expect(scope.getByText('Z oszczędności wypłacono więcej, niż wpłacono.')).toBeInTheDocument();
    expect(scope.queryByRole('button', { name: 'Uzupełnij' })).not.toBeInTheDocument();
  });

  it('cele: postęp i stan wpłaty; bez celów sekcji nie ma', async () => {
    const goal = goalFixture();
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({
        goals: [
          goal,
          goalFixture({
            id: '01JG0000000000000000000002',
            name: 'Poduszka',
            contribution: { ...goal.contribution, contributedThisMonthMinor: 0 },
          }),
        ],
      }),
    );
    renderMonth();
    const section = (await screen.findByRole('heading', { name: 'Cele' })).closest('section');
    const scope = within(section as HTMLElement);
    expect(scope.getByText('Wkład własny')).toBeInTheDocument();
    expect(scope.getByText('wpłacono we wrześniu')).toBeInTheDocument();
    expect(scope.getByText('brak wpłaty')).toBeInTheDocument();
    expect(scope.getByRole('link', { name: 'wszystkie' })).toHaveAttribute('href', '/goals');
  });

  it('bez celów — brak sekcji „Cele"', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(summary());
    renderMonth();
    await screen.findByText('majątek netto');
    expect(screen.queryByRole('heading', { name: 'Cele' })).not.toBeInTheDocument();
  });
});

describe('Ekran miesiąca — „Nadchodzące" i „Zapłacone" (F6-8)', () => {
  const OC = plannedFixture();
  const SERVICE = plannedFixture({
    id: '01JP0000000000000000000003',
    name: 'Przegląd',
    estimatedAmountMinor: 80_000,
    dueMonth: '2026-11',
    dueOn: null,
    monthsUntilDue: 2,
    repeatsYearly: false,
    setAside: {
      ...OC.setAside,
      accumulatedMinor: 80_000,
      remainingMinor: 0,
      coverageBps: 10_000,
      monthlyRequiredMinor: 0,
    },
  });
  const WARNING = {
    month: '2027-03',
    code: 'INSUFFICIENT_PROJECTED_BALANCE' as const,
    plannedExpenseId: null,
    message: 'Marzec 2027: na planowane wydatki zabraknie 500,00 zł.',
    gapMinor: 50_000,
  };

  it('między „Do zrobienia" a „Na co idą pieniądze": pokrycie, rata, „Odłóż" i ostrzeżenie', async () => {
    const user = userEvent.setup();
    const setAside = vi.spyOn(plannedApi, 'setAside').mockResolvedValue({
      data: { plannedExpense: OC, transaction: {} as never },
      meta: { affectedMonths: ['2026-09'] },
    });
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([
      {
        id: ROR,
        name: 'ROR',
        type: 'checking',
        allocationClass: 'spending',
        isArchived: false,
      } as AccountDto,
    ]);
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({
        plannedExpenses: plannedSectionFixture({
          items: [SERVICE, OC],
          warnings: [WARNING],
          warningCount: 1,
        }),
      }),
    );
    renderMonth();
    const heading = await screen.findByRole('heading', { name: 'Nadchodzące' });
    const headings = screen.getAllByRole('heading').map((item) => item.textContent);
    expect(headings.indexOf('Nadchodzące')).toBeLessThan(headings.indexOf('Na co idą pieniądze'));
    const scope = within(heading.closest('section') as HTMLElement);
    expect(scope.getByText('za 2 mies.')).toBeInTheDocument();
    expect(scope.getByText('odłożone 100%')).toBeInTheDocument();
    expect(scope.getByText(/^odłożone 33% · odkładaj/u)).toBeInTheDocument();
    expect(scope.getByText(WARNING.message)).toBeInTheDocument();
    expect(scope.getByRole('link', { name: 'wszystkie' })).toHaveAttribute('href', '/planned');

    await user.click(scope.getByRole('button', { name: /^Odłóż/u }));
    const dialog = within(await screen.findByRole('dialog', { name: /^Odłóż na/u }));
    await user.click(dialog.getByRole('button', { name: 'Odłóż' }));
    await waitFor(() => {
      expect(setAside).toHaveBeenCalledWith(
        'token-testowy',
        OC.id,
        { amountMinor: 22_858, fromAccountId: ROR },
        expect.any(String),
      );
    });
  });

  it('miesiąc przyszły — bez „Odłóż"; bez wydatków — bez sekcji', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValueOnce(
      summary({
        month: '2026-11',
        isCurrent: false,
        isFuture: true,
        plannedExpenses: plannedSectionFixture({ items: [OC] }),
      }),
    );
    renderMonth('/m/2026-11');
    const heading = await screen.findByRole('heading', { name: 'Nadchodzące' });
    expect(
      within(heading.closest('section') as HTMLElement).queryByRole('button', { name: /^Odłóż/u }),
    ).not.toBeInTheDocument();
  });

  it('bez planowanych wydatków — brak sekcji', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(summary());
    renderMonth();
    await screen.findByText('majątek netto');
    expect(screen.queryByRole('heading', { name: 'Nadchodzące' })).not.toBeInTheDocument();
  });

  it('„Do zrobienia": wydatek w miesiącu terminu z „Zapłacone" i kwotą do skorygowania', async () => {
    const user = userEvent.setup();
    const due = plannedFixture({
      name: 'Wymiana okien',
      dueMonth: '2026-09',
      dueOn: null,
      monthsUntilDue: 0,
      status: 'ready',
      estimatedAmountMinor: 50_000,
      repeatsYearly: false,
    });
    const post = vi.spyOn(plannedApi, 'postPlannedExpense').mockResolvedValue({
      data: { plannedExpense: due, transaction: {} as never, nextInstance: null },
      meta: { affectedMonths: ['2026-09'] },
    });
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([]);
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({
        plannedExpenses: plannedSectionFixture({ items: [due], readyToPay: [due] }),
      }),
    );
    renderMonth();
    const todo = (
      await screen.findByRole('heading', { name: 'Do zrobienia w tym miesiącu' })
    ).closest('section') as HTMLElement;
    expect(within(todo).getByText('planowany wydatek · kwota szacunkowa')).toBeInTheDocument();
    await user.click(within(todo).getByRole('button', { name: 'Zapłacone' }));
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Zapłacone: „Wymiana okien”' }),
    );
    expect(dialog.getByRole('textbox', { name: 'Kwota z rachunku' })).toHaveTextContent('500');
    expect(dialog.getByText('Wybierz')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Zapłacone' }));
    expect(await dialog.findByText('Wybierz konto')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('Ekran miesiąca — wejścia do planera (F9-8)', () => {
  const budget = (
    overrides: Partial<MonthSummaryDto['budget']> = {},
  ): MonthSummaryDto['budget'] => ({
    month: '2026-09',
    hasDraft: false,
    canCreate: true,
    leftoverMinor: null,
    nextMonth: '2026-10',
    nextMonthHasDraft: false,
    suggestNextMonth: false,
    ...overrides,
  });

  it('ostatni tydzień: „Zaplanuj październik 2026" prowadzi do szkicu', async () => {
    const user = userEvent.setup();
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({ budget: budget({ suggestNextMonth: true }) }),
    );
    const router = renderMonth();
    await user.click(await screen.findByRole('link', { name: /Zaplanuj październik 2026/u }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/budget/2026-10');
    });
  });

  it('bez podpowiedzi — brak wiersza', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(summary());
    renderMonth();
    await screen.findByRole('heading', { name: 'Ostatnie' });
    expect(screen.queryByRole('link', { name: /Zaplanuj/u })).not.toBeInTheDocument();
  });

  it('podgląd przyszłości ze szkicem — „Plan budżetu"', async () => {
    const future = { month: '2026-11', isCurrent: false, isPartial: false, isFuture: true };
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({
        ...future,
        budget: budget({ month: '2026-11', hasDraft: true, leftoverMinor: 1 }),
      }),
    );
    renderMonth('/m/2026-11');
    expect(await screen.findByRole('link', { name: 'Plan budżetu' })).toHaveAttribute(
      'href',
      '/budget/2026-11',
    );
  });

  it('podgląd przyszłości bez szkicu — „Zaplanuj"', async () => {
    const future = { month: '2026-11', isCurrent: false, isPartial: false, isFuture: true };
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({ ...future, budget: budget({ month: '2026-11' }) }),
    );
    renderMonth('/m/2026-11');
    expect(await screen.findByRole('link', { name: 'Zaplanuj' })).toHaveAttribute(
      'href',
      '/budget/2026-11',
    );
  });

  it('podgląd poza zakresem planów — bez odnośnika', async () => {
    vi.spyOn(monthsApi, 'fetchMonthSummary').mockResolvedValue(
      summary({
        month: '2028-01',
        isCurrent: false,
        isPartial: false,
        isFuture: true,
        budget: budget({ month: '2028-01', canCreate: false }),
      }),
    );
    renderMonth('/m/2028-01');
    await screen.findByText(/Podgląd — ten miesiąc/u);
    expect(screen.queryByRole('link', { name: /Zaplanuj|Plan budżetu/u })).not.toBeInTheDocument();
  });
});
