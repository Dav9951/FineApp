import { todayInTimezone, type LiabilityDetailDto, type LiabilityDto } from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '../../../../test/render-screen.js';
import { AppShell } from '../../../components/layout/app-shell.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import * as accountsApi from '../../accounts/api.js';
import * as categoriesApi from '../../categories/api.js';
import * as transactionsApi from '../../transactions/api.js';
import * as liabilitiesApi from '../api.js';
import LiabilitiesScreen from './liabilities-screen.js';
import LiabilityDetailScreen from './liability-detail-screen.js';

/**
 * Testy ekranów zobowiązań — lista, rata jednym dotknięciem, formularz, szczegóły
 * ([06 §3.8](../../../../../../plans/06-ui-views.md#38-zobowiązania--liabilities), `F4-6`).
 */

const MORTGAGE = '01JH0000000000000000000001';
const PHONE = '01JH0000000000000000000002';
const TV = '01JH0000000000000000000003';
const ROR = '01JB0000000000000000000001';
const TX = '01JT0000000000000000000001';
const TODAY = todayInTimezone('Europe/Warsaw');

/**
 * Data względem dziś — atrapy nie mogą zestarzeć się z kalendarzem.
 *
 * @param days - Przesunięcie w dniach.
 * @returns Data `YYYY-MM-DD`.
 */
function daysFromToday(days: number): string {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Zobowiązanie w kształcie z kontraktu — domyślnie hipoteka zapłacona w tym miesiącu.
 *
 * @param id - Identyfikator.
 * @param overrides - Nadpisane pola.
 * @returns Zobowiązanie.
 */
function liability(id: string, overrides: Partial<LiabilityDto> = {}): LiabilityDto {
  return {
    id,
    name: 'Kredyt hipoteczny',
    kind: 'mortgage',
    creditor: 'mBank',
    currency: 'PLN',
    openingBalanceMinor: 32_000_000,
    balanceAsOf: '2026-01-01',
    remainingMinor: 30_150_000,
    paidSoFarMinor: 1_850_000,
    monthlyPaymentMinor: 185_000,
    installmentsTotal: null,
    installmentsRemainingAtAsOf: null,
    installmentsRemaining: 163,
    nextDueOn: daysFromToday(20),
    projectedFinalPaymentOn: '2040-04-10',
    interestRateBps: null,
    paymentDay: 10,
    firstPaymentOn: null,
    paymentAccountId: ROR,
    categoryId: null,
    recurringRuleId: null,
    progressBps: 578,
    paidThisMonth: true,
    lastPaymentOn: TODAY,
    isActive: true,
    notes: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** Lista z 06 §3.8 plus zamknięte. */
const LIST: LiabilityDto[] = [
  liability(MORTGAGE),
  liability(PHONE, {
    name: 'Telefon na raty',
    kind: 'installment',
    creditor: 'Play',
    remainingMinor: 250_000,
    monthlyPaymentMinor: 50_000,
    installmentsRemaining: 5,
    projectedFinalPaymentOn: '2027-02-20',
    progressBps: 5_800,
    paidThisMonth: false,
    lastPaymentOn: null,
    nextDueOn: daysFromToday(3),
  }),
  liability(TV, { name: 'Telewizor', kind: 'bnpl', isActive: false, remainingMinor: 0 }),
];

/** Ekrany w powłoce — powłoka daje `ToastProvider`. */
const ROUTES = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'liabilities', element: <LiabilitiesScreen /> },
      { path: 'liabilities/:id', element: <LiabilityDetailScreen /> },
    ],
  },
];

/**
 * Renderuje ekran z atrapami API.
 *
 * @param path - Adres startowy.
 * @param list - Odpowiedź listy.
 * @returns Router.
 */
function renderLiabilities(
  path = '/liabilities',
  list: LiabilityDto[] = LIST,
): ReturnType<typeof renderScreen>['router'] {
  vi.spyOn(liabilitiesApi, 'fetchLiabilities').mockResolvedValue(list);
  vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([]);
  vi.spyOn(categoriesApi, 'fetchCategoryTree').mockResolvedValue([]);
  return renderScreen(path, ROUTES).router;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LiabilitiesScreen — treść', () => {
  it('razem do spłaty, miesięcznie, karty aktywnych i zamknięte osobno', async () => {
    renderLiabilities();
    await screen.findByText('Telefon na raty');
    const total = screen.getByRole('heading', { name: 'Razem do spłaty' }).closest('section');
    const scope = within(total as HTMLElement);
    expect(scope.getByText('304 000,00 zł')).toBeInTheDocument();
    expect(scope.getByText('2 350,00 zł')).toBeInTheDocument();
    const closed = screen.getByRole('heading', { name: 'Zamknięte' }).closest('section');
    expect(within(closed as HTMLElement).getByText('Telewizor')).toBeInTheDocument();
  });

  it('karta: zostało, procent, rata z liczbą rat i końcem, stan raty', async () => {
    renderLiabilities();
    const card = (await screen.findByText('Telefon na raty')).closest('li');
    const scope = within(card as HTMLElement);
    expect(scope.getByText('2 500,00 zł')).toBeInTheDocument();
    expect(scope.getByText('58% spłacone')).toBeInTheDocument();
    expect(scope.getByText(/5 rat · do II 2027/)).toBeInTheDocument();
    expect(scope.getByText(/^Rata na /)).toBeInTheDocument();
    // Hipoteka zapłacona w tym miesiącu — bez „Zaksięguj".
    const mortgage = screen.getByText('Kredyt hipoteczny').closest('li');
    expect(within(mortgage as HTMLElement).getByText(/^Zapłacono /)).toBeInTheDocument();
    expect(
      within(mortgage as HTMLElement).queryByRole('button', { name: 'Zaksięguj' }),
    ).not.toBeInTheDocument();
  });

  it('„Zaksięguj" z kluczem idempotencji i „Cofnij" usuwa transakcję', async () => {
    const user = userEvent.setup();
    const record = vi.spyOn(liabilitiesApi, 'recordPayment').mockResolvedValue({
      data: {
        liability: LIST[1] as LiabilityDto,
        transaction: { id: TX, monthKey: TODAY.slice(0, 7) } as never,
      },
      meta: { affectedMonths: [TODAY.slice(0, 7)] },
    });
    const remove = vi.spyOn(transactionsApi, 'deleteTransaction').mockResolvedValue(undefined);
    renderLiabilities();

    const card = (await screen.findByText('Telefon na raty')).closest('li');
    await user.click(within(card as HTMLElement).getByRole('button', { name: 'Zaksięguj' }));
    await waitFor(() => {
      expect(record).toHaveBeenCalledWith('token-testowy', PHONE, {}, expect.any(String));
    });
    expect(await screen.findByText('Zaksięgowano ratę „Telefon na raty"')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cofnij' }));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith('token-testowy', TX);
    });
  });
});

describe('LiabilitiesScreen — pozostałe stany', () => {
  it('ładowanie: szkielet', async () => {
    vi.spyOn(liabilitiesApi, 'fetchLiabilities').mockReturnValue(new Promise(() => undefined));
    renderScreen('/liabilities', ROUTES);
    expect(await screen.findByLabelText('Wczytywanie zobowiązań')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('pusto: jedna akcja otwiera formularz', async () => {
    const user = userEvent.setup();
    renderLiabilities('/liabilities', []);
    expect(await screen.findByText('Nie masz zobowiązań')).toBeInTheDocument();
    const [, emptyAction] = screen.getAllByRole('button', { name: 'Dodaj zobowiązanie' });
    await user.click(emptyAction as HTMLElement);
    expect(await screen.findByRole('dialog', { name: 'Nowe zobowiązanie' })).toBeInTheDocument();
  });

  it('błąd: z ponowieniem', async () => {
    const user = userEvent.setup();
    const fetch = vi
      .spyOn(liabilitiesApi, 'fetchLiabilities')
      .mockRejectedValueOnce(new ApiRequestError('INTERNAL_ERROR', 'Błąd.', 500, 'req-1'))
      .mockResolvedValue(LIST);
    renderScreen('/liabilities', ROUTES);
    expect(await screen.findByText('Nie udało się wczytać zobowiązań')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('Telefon na raty')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('LiabilitiesScreen — formularz', () => {
  it('dwa z trzech: kwota i rata wyliczają liczbę rat; ciało z regułą na ratę', async () => {
    const user = userEvent.setup();
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([]);
    const create = vi.spyOn(liabilitiesApi, 'createLiability').mockResolvedValue(liability(PHONE));
    renderLiabilities();

    await user.click(await screen.findByRole('button', { name: 'Dodaj zobowiązanie' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Nowe zobowiązanie' }));
    await user.type(dialog.getByRole('textbox', { name: 'Nazwa' }), 'Laptop');
    await user.type(dialog.getByRole('textbox', { name: 'Pozostało do spłaty (zł)' }), '4800');
    await user.type(dialog.getByRole('textbox', { name: 'Miesięczna rata (zł)' }), '400');
    expect(dialog.getByRole('textbox', { name: 'Liczba rat' })).toHaveValue('12');

    // Reguła na ratę jest domyślnie włączona — bez konta i dnia serwer by odmówił.
    await user.click(dialog.getByRole('button', { name: 'Dodaj zobowiązanie' }));
    expect(await dialog.findByText('Podaj dzień płatności raty')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    await user.click(dialog.getByRole('switch', { name: 'Utwórz pozycję cykliczną na ratę' }));
    await user.click(dialog.getByRole('button', { name: 'Dodaj zobowiązanie' }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        'token-testowy',
        expect.objectContaining({
          name: 'Laptop',
          openingBalanceMinor: 480_000,
          monthlyPaymentMinor: 40_000,
          installmentsRemainingAtAsOf: 12,
          createRecurringRule: false,
        }),
      );
    });
  });
});

describe('LiabilityDetailScreen', () => {
  /** Szczegóły hipoteki z jedną ratą. */
  const DETAIL: LiabilityDetailDto = {
    ...liability(MORTGAGE),
    payments: [
      {
        id: TX,
        bookedOn: TODAY,
        amountMinor: 185_000,
        accountName: 'ROR',
      } as LiabilityDetailDto['payments'][number],
    ],
  };

  /**
   * Renderuje szczegóły z atrapami.
   *
   * @param detail - Odpowiedź szczegółów.
   * @returns Router.
   */
  function renderDetail(
    detail: LiabilityDetailDto = DETAIL,
  ): ReturnType<typeof renderScreen>['router'] {
    vi.spyOn(liabilitiesApi, 'fetchLiability').mockResolvedValue(detail);
    vi.spyOn(liabilitiesApi, 'fetchSchedule').mockResolvedValue([
      { number: 1, dueOn: '2026-10-10', amountMinor: 185_000, remainingAfterMinor: 29_965_000 },
    ]);
    vi.spyOn(liabilitiesApi, 'fetchLiabilities').mockResolvedValue(LIST);
    return renderScreen(`/liabilities/${detail.id}`, ROUTES).router;
  }

  it('stan, warunki, raty i harmonogram', async () => {
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'Kredyt hipoteczny' })).toBeInTheDocument();
    expect(screen.getByText('301 500,00 zł')).toBeInTheDocument();
    expect(screen.getByText('163 raty')).toBeInTheDocument();
    const payments = screen.getByRole('heading', { name: 'Zaksięgowane raty' }).closest('section');
    expect(within(payments as HTMLElement).getByText('−1 850,00 zł')).toBeInTheDocument();
    const schedule = screen.getByRole('heading', { name: 'Harmonogram' }).closest('section');
    expect(within(schedule as HTMLElement).getByText('10 października 2026')).toBeInTheDocument();
  });

  it('korekta z wyciągu: kwota i dzień', async () => {
    const user = userEvent.setup();
    const rebase = vi.spyOn(liabilitiesApi, 'rebaseLiability').mockResolvedValue(DETAIL);
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Zaktualizuj stan z wyciągu' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Stan z wyciągu' }));
    await user.type(
      dialog.getByRole('textbox', { name: 'Pozostało według wyciągu (zł)' }),
      '298 400,00',
    );
    await user.click(dialog.getByRole('button', { name: 'Zapisz stan' }));
    await waitFor(() => {
      expect(rebase).toHaveBeenCalledWith('token-testowy', MORTGAGE, {
        remainingMinor: 29_840_000,
        asOf: TODAY,
        note: '',
      });
    });
  });

  it('zamknięcie — PATCH isActive: false', async () => {
    const user = userEvent.setup();
    const update = vi
      .spyOn(liabilitiesApi, 'updateLiability')
      .mockResolvedValue(liability(MORTGAGE, { isActive: false }));
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Zamknij — spłacone' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('token-testowy', MORTGAGE, { isActive: false });
    });
  });

  it('404 — informacja i powrót', async () => {
    vi.spyOn(liabilitiesApi, 'fetchLiability').mockRejectedValue(
      new ApiRequestError('NOT_FOUND', 'Nie znaleziono zobowiązania.', 404, 'req-1'),
    );
    vi.spyOn(liabilitiesApi, 'fetchSchedule').mockResolvedValue([]);
    renderScreen(`/liabilities/${MORTGAGE}`, ROUTES);
    expect(await screen.findByText('Nie ma takiego zobowiązania')).toBeInTheDocument();
  });
});
