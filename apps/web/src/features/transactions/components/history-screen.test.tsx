import type { AccountDto, CategoryTreeDto, TransactionListSummary } from '@fineapp/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '../../../../test/render-screen.js';
import { transactionItem } from '../../../../test/transaction-fixture.js';
import { AppShell } from '../../../components/layout/app-shell.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import * as accountsApi from '../../accounts/api.js';
import * as categoriesApi from '../../categories/api.js';
import * as incomeSourcesApi from '../../income-sources/api.js';
import * as transactionsApi from '../api.js';
import HistoryScreen from './history-screen.js';

/**
 * Testy ekranu historii — cztery stany, filtry w adresie, doczytywanie, usunięcie
 * z „Cofnij" ([06 §3.2](../../../../../../plans/06-ui-views.md#32-historia-transakcji--mmonthtransactions)).
 */

const ROR = '01JB0000000000000000000001';
const FOOD = '01JC0000000000000000000001';
const COFFEE = '01JC0000000000000000000002';

/** Podsumowanie z dwoma dniami. */
const SUMMARY: TransactionListSummary = {
  count: 3,
  expenseMinor: 22_798,
  incomeMinor: 980_000,
  transferMinor: 0,
  days: [
    { bookedOn: '2026-09-18', expenseMinor: 22_798, incomeMinor: 0 },
    { bookedOn: '2026-09-15', expenseMinor: 0, incomeMinor: 980_000 },
  ],
};

/** Trzy transakcje z dwóch dni. */
const ITEMS = [
  transactionItem({ id: 'tx-lidl', merchant: 'Lidl', amountMinor: 12_799, bookedOn: '2026-09-18' }),
  transactionItem({
    id: 'tx-orlen',
    merchant: 'Orlen',
    amountMinor: 9_999,
    bookedOn: '2026-09-18',
    source: 'ocr',
  }),
  transactionItem({
    id: 'tx-salary',
    type: 'income',
    description: 'Wynagrodzenie wrzesień',
    categoryName: 'Wynagrodzenie',
    amountMinor: 980_000,
    bookedOn: '2026-09-15',
  }),
];

/** Konto do panelu filtrów. */
const ACCOUNT: AccountDto = {
  id: ROR,
  name: 'ROR mBank',
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
};

/** Drzewo kategorii do panelu filtrów. */
const TREE: CategoryTreeDto[] = [
  {
    id: FOOD,
    parentId: null,
    name: 'Jedzenie',
    slug: 'jedzenie',
    kind: 'expense',
    icon: null,
    color: null,
    aiHints: null,
    isSystem: true,
    isArchived: false,
    sortOrder: 0,
    children: [
      {
        id: COFFEE,
        parentId: FOOD,
        name: 'Kawa',
        slug: 'jedzenie-kawa',
        kind: 'expense',
        icon: null,
        color: null,
        aiHints: null,
        isSystem: false,
        isArchived: false,
        sortOrder: 0,
      },
    ],
  },
];

beforeAll(() => {
  // jsdom nie przechwytuje wskaźnika; gest i tak dostaje zdarzenia z elementu.
  if (!('setPointerCapture' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'setPointerCapture', { value: () => undefined });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Podstawia jedną stronę listy.
 *
 * @param data - Transakcje.
 * @param summary - Podsumowanie.
 * @returns Atrapa `fetchTransactionPage`.
 */
function stubPage(data = ITEMS, summary: TransactionListSummary = SUMMARY) {
  return vi
    .spyOn(transactionsApi, 'fetchTransactionPage')
    .mockResolvedValue({ data, meta: { nextCursor: null, hasMore: false, summary } });
}

/**
 * Zwraca sekcję dnia po jej nagłówku.
 *
 * @param name - Nazwa nagłówka dnia.
 * @returns Element sekcji.
 */
function daySection(name: RegExp): HTMLElement {
  const section = screen.getByRole('heading', { name }).closest('section');
  if (section === null) throw new Error('brak sekcji dnia');
  return section;
}

/**
 * Renderuje historię w powłoce aplikacji.
 *
 * @param path - Adres startowy.
 * @returns Router.
 */
function renderHistory(path = '/m/2026-09/transactions') {
  return renderScreen(path, [
    {
      path: '/',
      element: <AppShell />,
      children: [{ path: 'm/:month/transactions', element: <HistoryScreen /> }],
    },
  ]).router;
}

describe('stany ekranu', () => {
  it('treść: dni z sumą, linia podsumowania, wiersze z podpisem i przycisk poprzedniego miesiąca', async () => {
    const fetch = stubPage();
    renderHistory();

    expect(await screen.findByText('Lidl')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('token-testowy', { month: '2026-09' }, undefined);

    const friday = daySection(/piątek, 18 września/iu);
    expect(within(friday).getByText('−227,98 zł')).toBeInTheDocument();
    expect(within(friday).getByText('Orlen')).toBeInTheDocument();
    expect(within(friday).getByRole('img', { name: 'z paragonu' })).toBeInTheDocument();
    expect(within(friday).getAllByText('Restauracje · ROR · AK')).toHaveLength(2);

    // Dzień z samą wypłatą: suma dnia i kwota wiersza są równe.
    const tuesday = daySection(/wtorek, 15 września/iu);
    expect(within(tuesday).getAllByText('+9 800,00 zł')).toHaveLength(2);

    expect(screen.getByText('3 transakcje')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pokaż sierpień 2026' })).toHaveAttribute(
      'href',
      '/m/2026-08/transactions',
    );
  });

  it('pusty miesiąc — jedna akcja: dodaj wydatek', async () => {
    stubPage([], { ...SUMMARY, count: 0, expenseMinor: 0, incomeMinor: 0, days: [] });
    renderHistory();
    expect(await screen.findByText('Pusty miesiąc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dodaj wydatek' })).toBeInTheDocument();
  });

  it('pusto przy filtrach — „Wyczyść filtry" czyści adres', async () => {
    stubPage([], { ...SUMMARY, count: 0, days: [] });
    const router = renderHistory(`/m/2026-09/transactions?type=expense&accountId=${ROR}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Wyczyść filtry' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
  });

  it('błąd — bez starych kwot, z ponowieniem', async () => {
    const fetch = vi
      .spyOn(transactionsApi, 'fetchTransactionPage')
      .mockRejectedValueOnce(new ApiRequestError('INTERNAL_ERROR', 'Awaria', 500, 'req-1'))
      .mockResolvedValueOnce({
        data: ITEMS,
        meta: { nextCursor: null, hasMore: false, summary: SUMMARY },
      });
    renderHistory();
    expect(await screen.findByText('Nie udało się wczytać transakcji')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('Lidl')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('filtry w adresie', () => {
  it('szybki filtr typu trafia do adresu i do zapytania', async () => {
    const fetch = stubPage();
    const router = renderHistory();
    await screen.findByText('Lidl');
    await userEvent.click(screen.getByRole('tab', { name: 'Wydatki' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?type=expense');
    });
    await waitFor(() => {
      expect(fetch).toHaveBeenLastCalledWith(
        'token-testowy',
        { month: '2026-09', type: 'expense' },
        undefined,
      );
    });
  });

  it('adres z filtrami wybiera zakładkę i jest przenoszony na sąsiedni miesiąc', async () => {
    stubPage();
    renderHistory('/m/2026-09/transactions?type=income');
    expect(await screen.findByRole('tab', { name: 'Wpływy' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('link', { name: /Poprzedni miesiąc/u })).toHaveAttribute(
      'href',
      '/m/2026-08/transactions?type=income',
    );
  });

  it('wyszukiwarka wysyła tekst po chwili bez pisania', async () => {
    const fetch = stubPage();
    const router = renderHistory();
    await screen.findByText('Lidl');
    await userEvent.click(screen.getByRole('button', { name: 'Szukaj' }));
    await userEvent.type(screen.getByRole('textbox', { name: /Szukaj/u }), 'żabka');
    await waitFor(() => {
      expect(router.state.location.search).toBe(`?q=${encodeURIComponent('żabka')}`);
    });
    await waitFor(() => {
      expect(fetch).toHaveBeenLastCalledWith(
        'token-testowy',
        { month: '2026-09', q: 'żabka' },
        undefined,
      );
    });
  });

  it('panel: konto i kategoria z podkategoriami trafiają do adresu po „Pokaż wyniki"', async () => {
    const fetch = stubPage();
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([ACCOUNT]);
    vi.spyOn(categoriesApi, 'fetchCategoryTree').mockImplementation((_token, kind) =>
      Promise.resolve(kind === 'expense' ? TREE : []),
    );
    vi.spyOn(incomeSourcesApi, 'fetchIncomeSources').mockResolvedValue([]);
    const router = renderHistory();
    await screen.findByText('Lidl');

    await userEvent.click(screen.getByRole('button', { name: 'Filtry' }));
    const panel = await screen.findByRole('dialog', { name: 'Filtry' });
    await userEvent.click(await within(panel).findByRole('checkbox', { name: 'ROR mBank' }));
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Jedzenie' }));
    expect(within(panel).getByRole('checkbox', { name: 'Kawa' })).toBeChecked();
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Kwota od' }), '25,5');
    await userEvent.click(within(panel).getByRole('button', { name: 'Pokaż wyniki' }));

    await waitFor(() => {
      expect(router.state.location.search).toBe(
        `?accountId=${ROR}&categoryId=${FOOD}&categoryId=${COFFEE}&minAmountMinor=2550`,
      );
    });
    await waitFor(() => {
      expect(fetch).toHaveBeenLastCalledWith(
        'token-testowy',
        { month: '2026-09', accountId: [ROR], categoryId: [FOOD, COFFEE], minAmountMinor: 2550 },
        undefined,
      );
    });
    expect(screen.getByRole('button', { name: 'Filtry, aktywne: 3' })).toBeInTheDocument();
  });

  it('panel: nieczytelna kwota zatrzymuje zatwierdzenie z komunikatem przy polu', async () => {
    stubPage();
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([]);
    vi.spyOn(categoriesApi, 'fetchCategoryTree').mockResolvedValue([]);
    vi.spyOn(incomeSourcesApi, 'fetchIncomeSources').mockResolvedValue([]);
    const router = renderHistory();
    await screen.findByText('Lidl');
    await userEvent.click(screen.getByRole('button', { name: 'Filtry' }));
    const panel = await screen.findByRole('dialog', { name: 'Filtry' });
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Kwota do' }), 'dużo');
    await userEvent.click(within(panel).getByRole('button', { name: 'Pokaż wyniki' }));
    expect(within(panel).getByText('Wpisz kwotę, np. 250')).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
  });
});

describe('doczytywanie', () => {
  it('„Wczytaj więcej" pobiera kolejną stronę kursorem i dokleja ją do dnia', async () => {
    const fetch = vi
      .spyOn(transactionsApi, 'fetchTransactionPage')
      .mockResolvedValueOnce({
        data: [ITEMS[0] ?? transactionItem()],
        meta: { nextCursor: 'c-1', hasMore: true, summary: SUMMARY },
      })
      .mockResolvedValueOnce({
        data: ITEMS.slice(1),
        meta: { nextCursor: null, hasMore: false },
      });
    renderHistory();
    await screen.findByText('Lidl');
    // Suma dnia z serwera, choć wczytany jest tylko jeden z dwóch wydatków.
    expect(screen.getByText('−227,98 zł')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Wczytaj więcej' }));
    expect(await screen.findByText('Orlen')).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith('token-testowy', { month: '2026-09' }, 'c-1');
    expect(screen.getAllByRole('heading', { name: /piątek/iu })).toHaveLength(1);
    expect(within(daySection(/piątek/iu)).getByText('Orlen')).toBeInTheDocument();
    expect(screen.getByText('3 transakcje')).toBeInTheDocument();
  });
});

describe('usuwanie', () => {
  it('przesunięcie w lewo przenosi do kosza, a „Cofnij" przywraca', async () => {
    stubPage();
    const remove = vi.spyOn(transactionsApi, 'deleteTransaction').mockResolvedValue();
    const restore = vi.spyOn(transactionsApi, 'restoreTransaction').mockResolvedValue({
      data: ITEMS[0] ?? transactionItem(),
      meta: { affectedMonths: ['2026-09'] },
    });
    renderHistory();
    const row = (await screen.findByText('Lidl')).closest('button');
    if (row === null) throw new Error('brak wiersza');

    fireEvent.pointerDown(row, { pointerId: 1, isPrimary: true, clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { pointerId: 1, isPrimary: true, clientX: 250, clientY: 12 });
    fireEvent.pointerMove(row, { pointerId: 1, isPrimary: true, clientX: 180, clientY: 12 });
    fireEvent.pointerUp(row, { pointerId: 1, isPrimary: true, clientX: 180, clientY: 12 });
    fireEvent.click(row);

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith('token-testowy', 'tx-lidl');
    });
    // Kliknięcie po geście nie otwiera edycji.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith('token-testowy', 'tx-lidl');
    });
  });

  it('ruch w pionie nie jest gestem — przewijanie nie usuwa', async () => {
    stubPage();
    const remove = vi.spyOn(transactionsApi, 'deleteTransaction').mockResolvedValue();
    renderHistory();
    const row = (await screen.findByText('Lidl')).closest('button');
    if (row === null) throw new Error('brak wiersza');
    fireEvent.pointerDown(row, { pointerId: 1, isPrimary: true, clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { pointerId: 1, isPrimary: true, clientX: 290, clientY: 60 });
    fireEvent.pointerMove(row, { pointerId: 1, isPrimary: true, clientX: 150, clientY: 70 });
    fireEvent.pointerUp(row, { pointerId: 1, isPrimary: true, clientX: 150, clientY: 70 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('transakcja z kosza ma plakietkę i nie reaguje na gest', async () => {
    stubPage([transactionItem({ id: 'tx-bin', merchant: 'Żabka', deletedAt: 5 })]);
    const remove = vi.spyOn(transactionsApi, 'deleteTransaction').mockResolvedValue();
    renderHistory('/m/2026-09/transactions?includeDeleted=true');
    const title = await screen.findByText('Żabka');
    expect(screen.getByText('w koszu')).toBeInTheDocument();
    const row = title.closest('button');
    if (row === null) throw new Error('brak wiersza');
    fireEvent.pointerDown(row, { pointerId: 1, isPrimary: true, clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { pointerId: 1, isPrimary: true, clientX: 100, clientY: 10 });
    fireEvent.pointerUp(row, { pointerId: 1, isPrimary: true, clientX: 100, clientY: 10 });
    expect(remove).not.toHaveBeenCalled();
  });
});
