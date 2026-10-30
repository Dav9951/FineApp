import {
  formatMinor,
  monthKeyOf,
  monthlySetAsideMinor,
  monthsLeftUntil,
  shiftMonth,
  todayInTimezone,
  type AccountDto,
  type PlannedExpenseDto,
} from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PLANNED_ID,
  plannedFixture,
  SET_ASIDE_ACCOUNT_ID,
  upcomingMetaFixture,
} from '../../../../test/planned-fixture.js';
import { renderScreen } from '../../../../test/render-screen.js';
import { AppShell } from '../../../components/layout/app-shell.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import * as accountsApi from '../../accounts/api.js';
import * as categoriesApi from '../../categories/api.js';
import * as plannedApi from '../api.js';
import { monthName } from '../planned-view.js';
import PlannedRoute from './planned-route.js';
import PlannedScreen from './planned-screen.js';

/**
 * Testy ekranu planowanych wydatków i formularza z ratą na żywo
 * ([06 §3.10](../../../../../../plans/06-ui-views.md#310-planowane-wydatki--planned),
 * `F6-6`, `F6-7`).
 */

const MONTH = monthKeyOf(todayInTimezone('Europe/Warsaw'));
const ROR = '01JB0000000000000000000001';
const TRIP = '01JP0000000000000000000002';

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

/** Wydatki: OC z odkładaniem i wakacje bez odkładania, w dwóch miesiącach. */
const ITEMS: PlannedExpenseDto[] = [
  plannedFixture(),
  plannedFixture({
    id: TRIP,
    name: 'Wakacje',
    estimatedAmountMinor: 200_000,
    dueMonth: '2027-07',
    dueOn: null,
    monthsUntilDue: 10,
    priority: 'nice',
    status: 'planned',
    repeatsYearly: false,
    alreadySetAsideMinor: 0,
    setAside: {
      ...plannedFixture().setAside,
      enabled: false,
      accountId: null,
      accumulatedMinor: 0,
      remainingMinor: 200_000,
      coverageBps: 0,
      monthlyRequiredMinor: 18_182,
    },
  }),
];

/** Ekran w powłoce — powłoka daje `ToastProvider`. */
const ROUTES = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'planned', element: <PlannedScreen /> },
      { path: 'planned/:id', element: <PlannedRoute /> },
    ],
  },
];

/**
 * Renderuje ekran z atrapami API.
 *
 * @param items - Wydatki z API.
 * @param path - Adres startowy.
 * @returns Router.
 */
function renderPlanned(
  items: PlannedExpenseDto[] = ITEMS,
  path = '/planned',
): ReturnType<typeof renderScreen>['router'] {
  vi.spyOn(plannedApi, 'fetchPlannedExpenses').mockResolvedValue(items);
  vi.spyOn(plannedApi, 'fetchUpcoming').mockResolvedValue({
    data: items.slice(0, 1),
    meta: upcomingMetaFixture({
      liquidityWarnings: [
        {
          month: '2027-03',
          code: 'SET_ASIDE_BEHIND',
          plannedExpenseId: PLANNED_ID,
          message: `Odkładanie na „OC + AC samochód” jest opóźnione o ${formatMinor(30_000)}.`,
          gapMinor: 30_000,
        },
      ],
    }),
  });
  vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([
    account(ROR, 'ROR', 'spending'),
    account(SET_ASIDE_ACCOUNT_ID, 'Oszczędnościowe', 'savings'),
  ]);
  vi.spyOn(categoriesApi, 'fetchCategoryTree').mockResolvedValue([]);
  return renderScreen(path, ROUTES).router;
}

/**
 * Widoczny tekst elementu ze spacjami zwykłymi — kwoty mają spację niełamliwą,
 * a odczyt kwoty słowami (`.sr-only` w `<Money>`) nie jest częścią tego, co widać.
 *
 * @param element - Element.
 * @returns Tekst.
 */
function textOf(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll('.sr-only')) hidden.remove();
  return (copy.textContent ?? '').replace(/\s/gu, ' ');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlannedScreen — treść', () => {
  it('podsumowanie, ostrzeżenie, grupy po miesiącu terminu i karty', async () => {
    renderPlanned();
    const oc = within((await screen.findByText('OC + AC samochód')).closest('li') as HTMLElement);
    expect(oc.getByText('33%')).toBeInTheDocument();
    expect(oc.getByText('co rok')).toBeInTheDocument();
    expect(oc.getByText('konieczne')).toBeInTheDocument();
    expect(textOf(oc.getByText(/^Odkładaj/u))).toContain('228,58');
    expect(oc.getByText(`Wpłata za ${monthName(MONTH)}`)).toBeInTheDocument();
    expect(oc.getByRole('button', { name: 'Odłóż teraz' })).toBeInTheDocument();

    const trip = within(screen.getByText('Wakacje').closest('li') as HTMLElement);
    expect(trip.getByText('Bez odkładania')).toBeInTheDocument();
    expect(trip.getByRole('button', { name: 'Włącz odkładanie' })).toBeInTheDocument();

    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings).toEqual(
      expect.arrayContaining(['Najbliższe 6 miesięcy', 'marzec 2027', 'lipiec 2027']),
    );
    expect(headings.indexOf('marzec 2027')).toBeLessThan(headings.indexOf('lipiec 2027'));
    expect(screen.getByText('33% pokrycia')).toBeInTheDocument();
    expect(screen.getByText(/jest opóźnione o/u)).toBeInTheDocument();
  });

  it('„Odłóż teraz": rata, konto na wydatki, klucz idempotencji; toast', async () => {
    const user = userEvent.setup();
    const setAside = vi.spyOn(plannedApi, 'setAside').mockResolvedValue({
      data: { plannedExpense: plannedFixture(), transaction: {} as never },
      meta: { affectedMonths: [MONTH] },
    });
    renderPlanned();
    const oc = within((await screen.findByText('OC + AC samochód')).closest('li') as HTMLElement);
    await user.click(oc.getByRole('button', { name: 'Odłóż teraz' }));
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Odłóż na „OC + AC samochód”' }),
    );
    expect(await dialog.findByText('Oszczędnościowe')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Odłóż' }));
    await waitFor(() => {
      expect(setAside).toHaveBeenCalledWith(
        'token-testowy',
        PLANNED_ID,
        { amountMinor: 22_858, fromAccountId: ROR },
        expect.any(String),
      );
    });
    expect(await screen.findByText('Odłożono na „OC + AC samochód”')).toBeInTheDocument();
  });

  it('ostrzeżenie o opóźnieniu: „Odłóż zaległe" z kwotą zaległości', async () => {
    const user = userEvent.setup();
    const setAside = vi.spyOn(plannedApi, 'setAside').mockResolvedValue({
      data: { plannedExpense: plannedFixture(), transaction: {} as never },
      meta: { affectedMonths: [MONTH] },
    });
    renderPlanned();
    await user.click(await screen.findByRole('button', { name: 'Odłóż zaległe' }));
    const dialog = within(await screen.findByRole('dialog', { name: /^Odłóż na/u }));
    await user.click(dialog.getByRole('button', { name: 'Odłóż' }));
    await waitFor(() => {
      expect(setAside).toHaveBeenCalledWith(
        'token-testowy',
        PLANNED_ID,
        expect.objectContaining({ amountMinor: 30_000 }),
        expect.any(String),
      );
    });
  });

  it('„Zapłacone" w miesiącu terminu: kwota do skorygowania i wpis na kolejny rok', async () => {
    const user = userEvent.setup();
    const due = plannedFixture({
      dueMonth: MONTH,
      dueOn: null,
      monthsUntilDue: 0,
      status: 'ready',
    });
    const post = vi.spyOn(plannedApi, 'postPlannedExpense').mockResolvedValue({
      data: {
        plannedExpense: { ...due, status: 'posted' },
        transaction: {} as never,
        nextInstance: { ...due, id: TRIP, dueMonth: shiftMonth(MONTH, 12) },
      },
      meta: { affectedMonths: [MONTH] },
    });
    renderPlanned([due]);
    const card = within((await screen.findByText('OC + AC samochód')).closest('li') as HTMLElement);
    await user.click(card.getByRole('button', { name: 'Zapłacone' }));
    const dialog = within(await screen.findByRole('dialog', { name: /^Zapłacone: /u }));
    expect(dialog.getByText(/^Utworzymy wpis na/u)).toBeInTheDocument();
    const amount = dialog.getByRole('textbox', { name: 'Kwota z rachunku' });
    await user.click(amount);
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}');
    await user.keyboard('2310');
    await user.click(dialog.getByRole('button', { name: 'Zapłacone' }));
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        'token-testowy',
        PLANNED_ID,
        { amountMinor: 231_000, accountId: ROR },
        expect.any(String),
      );
    });
    expect(await screen.findByText(/— wpis na .* gotowy$/u)).toBeInTheDocument();
  });
});

describe('PlannedScreen — pozostałe stany', () => {
  it('ładowanie: szkielet', async () => {
    vi.spyOn(plannedApi, 'fetchPlannedExpenses').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(plannedApi, 'fetchUpcoming').mockReturnValue(new Promise(() => undefined));
    renderScreen('/planned', ROUTES);
    expect(await screen.findByLabelText('Wczytywanie planowanych wydatków')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('pusto: zachęta z akcją otwierającą formularz', async () => {
    const user = userEvent.setup();
    renderPlanned([]);
    expect(await screen.findByText('Brak planowanych wydatków')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dodaj wydatek' }));
    expect(
      await screen.findByRole('dialog', { name: 'Nowy planowany wydatek' }),
    ).toBeInTheDocument();
  });

  it('błąd: z ponowieniem', async () => {
    const user = userEvent.setup();
    const fetch = vi
      .spyOn(plannedApi, 'fetchPlannedExpenses')
      .mockRejectedValueOnce(new ApiRequestError('INTERNAL_ERROR', 'Błąd.', 500, 'req-1'))
      .mockResolvedValue(ITEMS);
    vi.spyOn(plannedApi, 'fetchUpcoming').mockResolvedValue({
      data: [],
      meta: upcomingMetaFixture(),
    });
    renderScreen('/planned', ROUTES);
    expect(
      await screen.findByText('Nie udało się wczytać planowanych wydatków'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('OC + AC samochód')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('wejście z /planned/:id otwiera arkusz tego wydatku', async () => {
    const router = renderPlanned(ITEMS, `/planned/${PLANNED_ID}`);
    expect(await screen.findByRole('dialog', { name: 'Edytuj wydatek' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/planned');
  });
});

describe('Formularz — rata na żywo (F6-7)', () => {
  it('„Trzeba odkładać X przez N mies." przed zapisem; I-17 bez konta; zapis', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(plannedApi, 'createPlannedExpense').mockResolvedValue(plannedFixture());
    renderPlanned();
    await screen.findByText('OC + AC samochód');
    await user.click(screen.getByRole('button', { name: 'Dodaj planowany wydatek' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Nowy planowany wydatek' }));
    await user.type(dialog.getByRole('textbox', { name: 'Nazwa' }), 'Przegląd');
    await user.click(dialog.getByRole('textbox', { name: 'Szacowana kwota' }));
    await user.keyboard('1200');

    // Termin domyślny: za 3 miesiące → 4 raty z bieżącym.
    const months = monthsLeftUntil(MONTH, shiftMonth(MONTH, 3));
    const line = await dialog.findByText(/^Trzeba odkładać/u);
    expect(textOf(line.closest('p') as HTMLElement)).toContain(
      `${formatMinor(monthlySetAsideMinor(120_000, months)).replace(/\s/gu, ' ')} przez ${String(months)} mies.`,
    );

    await user.click(dialog.getByRole('button', { name: 'Dodaj wydatek' }));
    expect(await dialog.findByText('Wskaż konto lub cel, na którym odkładasz')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    await user.click(dialog.getByRole('button', { name: /^Gdzie/u }));
    await user.click(await screen.findByRole('button', { name: /Oszczędnościowe/u }));
    await user.click(dialog.getByRole('button', { name: 'Dodaj wydatek' }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        'token-testowy',
        expect.objectContaining({
          name: 'Przegląd',
          estimatedAmountMinor: 120_000,
          dueMonth: shiftMonth(MONTH, 3),
          setAsideEnabled: true,
          setAsideAccountId: SET_ASIDE_ACCOUNT_ID,
          alreadySetAsideMinor: 0,
        }),
      );
    });
  });
});
