import {
  currentMonthKey,
  todayInTimezone,
  type AccountDto,
  type CategoryTreeDto,
  type IncomeSourceDto,
  type RecurringRuleDto,
  type TransactionListItemDto,
} from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '../../../../test/render-screen.js';
import { AppShell } from '../../../components/layout/app-shell.js';
import { ApiRequestError, NetworkError } from '../../../lib/api-client.js';
import * as accountsApi from '../../accounts/api.js';
import * as categoriesApi from '../../categories/api.js';
import * as incomeSourcesApi from '../../income-sources/api.js';
import * as recurringApi from '../../recurring/api.js';
import * as transactionsApi from '../api.js';
import TransactionRoute from './transaction-route.js';

/**
 * Testy arkusza formularza transakcji
 * ([06 §3.3](../../../../../../plans/06-ui-views.md#33-formularz-transakcji--tnew-tid)):
 * wejścia (FAB, `/t/new`, `/t/:id`), wybory w arkuszu, żądania i klucz idempotencji.
 */

const ROR = '01JB0000000000000000000001';
const SAVINGS = '01JB0000000000000000000002';
const FOOD = '01JB0000000000000000000011';
const RESTAURANTS = '01JB0000000000000000000012';
const TRANSPORT = '01JB0000000000000000000013';
const SALARY = '01JB0000000000000000000021';
const TX = '01JB0000000000000000000031';

/**
 * Konto w kształcie z kontraktu.
 *
 * @param id - Identyfikator.
 * @param overrides - Nadpisane pola.
 * @returns Konto.
 */
function account(id: string, overrides: Partial<AccountDto>): AccountDto {
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

const ACCOUNTS: AccountDto[] = [
  account(ROR, { name: 'ROR mBank' }),
  account(SAVINGS, { name: 'Konto oszczędnościowe', type: 'savings', allocationClass: 'savings' }),
];

/**
 * Kategoria w drzewie.
 *
 * @param id - Identyfikator.
 * @param name - Nazwa.
 * @param children - Podkategorie.
 * @returns Węzeł drzewa.
 */
function category(id: string, name: string, children: CategoryTreeDto[] = []): CategoryTreeDto {
  return {
    id,
    parentId: null,
    name,
    slug: name.toLowerCase(),
    kind: 'expense',
    icon: null,
    color: null,
    aiHints: null,
    isSystem: true,
    isArchived: false,
    sortOrder: 0,
    children: children.map((child) => ({ ...child, parentId: id })),
  };
}

const TREE: CategoryTreeDto[] = [
  category(FOOD, 'Jedzenie', [category(RESTAURANTS, 'Restauracje')]),
  category(TRANSPORT, 'Transport'),
];

const SOURCES: IncomeSourceDto[] = [
  {
    id: SALARY,
    name: 'Pensja',
    kind: 'salary',
    ownerUserId: null,
    countsTowardAllocation: true,
    isArchived: false,
    sortOrder: 0,
  },
];

const TODAY = todayInTimezone('Europe/Warsaw', new Date());
const MONTH = currentMonthKey('Europe/Warsaw');

/**
 * Transakcja z nazwami — odpowiedź zapisu i szczegółów.
 *
 * Data domyślnie dzisiejsza, a nie stała: transakcja sprzed okna księgowania ma
 * zablokowane liczby (07 §1.4), więc stała data zmieniałaby wynik testów z upływem czasu.
 *
 * @param overrides - Nadpisane pola.
 * @returns Transakcja.
 */
function transaction(overrides: Partial<TransactionListItemDto> = {}): TransactionListItemDto {
  return {
    id: TX,
    type: 'expense',
    status: 'posted',
    bookedOn: TODAY,
    monthKey: MONTH,
    amountMinor: 4_599,
    currency: 'PLN',
    accountId: ROR,
    counterAccountId: null,
    categoryId: RESTAURANTS,
    incomeSourceId: null,
    liabilityId: null,
    goalId: null,
    sourceAllocationClass: null,
    targetAllocationClass: null,
    allocationOverride: null,
    allocationEffects: [],
    description: 'Obiad',
    merchant: null,
    notes: null,
    source: 'manual',
    sourceDocumentId: null,
    recurringOccurrenceId: null,
    plannedExpenseId: null,
    createdBy: '01J9ZQK8WQ0000000000000000',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    accountName: 'ROR mBank',
    counterAccountName: null,
    categoryName: 'Restauracje',
    categoryIcon: null,
    categoryColor: null,
    incomeSourceName: null,
    goalName: null,
    liabilityName: null,
    createdByName: 'Adam',
    ...overrides,
  };
}

const SAVED: transactionsApi.TransactionMutation = {
  data: transaction(),
  meta: { affectedMonths: [MONTH] },
};

/**
 * Renderuje powłokę z arkuszem pod wskazanym adresem, z atrapami słowników.
 *
 * @param path - Adres startowy.
 * @returns Router.
 */
function renderShell(path = `/m/${MONTH}`): ReturnType<typeof renderScreen>['router'] {
  vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue(ACCOUNTS);
  vi.spyOn(categoriesApi, 'fetchCategoryTree').mockResolvedValue(TREE);
  vi.spyOn(incomeSourcesApi, 'fetchIncomeSources').mockResolvedValue(SOURCES);
  return renderScreen(path, [
    {
      path: '/',
      element: <AppShell />,
      children: [
        { path: 'm/:month', element: <p>ekran miesiąca</p> },
        { path: 'accounts', element: <p>ekran kont</p> },
        { path: 't/new', element: <TransactionRoute /> },
        { path: 't/:id', element: <TransactionRoute /> },
      ],
    },
  ]).router;
}

/**
 * Wystukuje kwotę na klawiaturze arkusza.
 *
 * @param user - Sesja zdarzeń.
 * @param dialog - Arkusz.
 * @param keys - Klawisze, np. `45,99`.
 */
async function typeAmount(user: UserEvent, dialog: HTMLElement, keys: string): Promise<void> {
  for (const key of keys) {
    const name = key === ',' ? 'Przecinek' : key;
    await user.click(within(dialog).getByRole('button', { name }));
  }
}

/**
 * Otwiera arkusz nowego wydatku przyciskiem FAB.
 *
 * @param user - Sesja zdarzeń.
 * @returns Arkusz.
 */
async function openExpense(user: UserEvent): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: 'Dodaj transakcję' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nowy wydatek' });
  // Konto domyślne pojawia się, gdy dojdzie lista kont.
  await within(dialog).findByRole('button', { name: /Z konta.*ROR mBank/ });
  return dialog;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Arkusz transakcji — nowy wydatek', () => {
  it('FAB → kwota → kategoria → zapis: żądanie z kontem domyślnym, dzisiejszą datą i kluczem', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(transactionsApi, 'createTransaction').mockResolvedValue(SAVED);
    renderShell();

    const dialog = await openExpense(user);
    const form = within(dialog);
    await typeAmount(user, dialog, '45,99');
    expect(form.getByRole('textbox', { name: 'Kwota' })).toHaveTextContent('45,99');

    await user.click(form.getByRole('button', { name: /Kategoria.*Bez kategorii/ }));
    await user.click(await form.findByRole('button', { name: /Restauracje/ }));
    expect(
      form.getByRole('button', { name: /Kategoria.*Jedzenie › Restauracje/ }),
    ).toBeInTheDocument();

    await user.click(form.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });
    const [token, body, key] = create.mock.calls[0] ?? [];
    expect(token).toBe('token-testowy');
    expect(body).toMatchObject({
      type: 'expense',
      amountMinor: 4_599,
      accountId: ROR,
      categoryId: RESTAURANTS,
      bookedOn: TODAY,
    });
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('ponowienie po błędzie sieci niesie ten sam klucz idempotencji', async () => {
    const user = userEvent.setup();
    const create = vi
      .spyOn(transactionsApi, 'createTransaction')
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValue(SAVED);
    renderShell();

    const dialog = await openExpense(user);
    await typeAmount(user, dialog, '12');
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText('Brak połączenia z serwerem.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(2);
    });
    expect(create.mock.calls[1]?.[2]).toBe(create.mock.calls[0]?.[2]);
  });

  it('kolejny arkusz dostaje nowy klucz — to już inna transakcja', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(transactionsApi, 'createTransaction').mockResolvedValue(SAVED);
    renderShell();

    for (let round = 0; round < 2; round += 1) {
      const dialog = await openExpense(user);
      await typeAmount(user, dialog, '5');
      await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    }
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[2]).not.toBe(create.mock.calls[0]?.[2]);
  });

  it('kwota zero: komunikat pod kwotą i żadnego żądania', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(transactionsApi, 'createTransaction');
    renderShell();

    const dialog = await openExpense(user);
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(within(dialog).getByText('Wpisz kwotę większą od zera')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('błąd pola z serwera trafia pod pole', async () => {
    const user = userEvent.setup();
    vi.spyOn(transactionsApi, 'createTransaction').mockRejectedValue(
      new ApiRequestError('VALIDATION_ERROR', 'Popraw zaznaczone pola.', 422, 'req-1', [
        { path: 'bookedOn', message: 'Data poza oknem księgowania' },
      ]),
    );
    renderShell();

    const dialog = await openExpense(user);
    await typeAmount(user, dialog, '7');
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText('Data poza oknem księgowania')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Nowy wydatek' })).toBeInTheDocument();
  });

  it('wybór daty: skrót „Wczoraj" zmienia pole i trafia do żądania', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(transactionsApi, 'createTransaction').mockResolvedValue(SAVED);
    renderShell();

    const dialog = await openExpense(user);
    const form = within(dialog);
    await typeAmount(user, dialog, '3');
    await user.click(form.getByRole('button', { name: /Data.*dziś/ }));
    await user.click(form.getByRole('button', { name: /^Wczoraj/ }));
    expect(form.getByRole('button', { name: /Data.*wczoraj/ })).toBeInTheDocument();

    await user.click(form.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });
    expect(create.mock.calls[0]?.[1].bookedOn).not.toBe(TODAY);
  });
});

describe('Arkusz transakcji — bez kont', () => {
  it('„Przejdź do kont" zamyka arkusz i dopiero potem przechodzi do kont', async () => {
    const user = userEvent.setup();
    const router = renderShell();
    vi.mocked(accountsApi.fetchAccounts).mockResolvedValue([]);

    await user.click(await screen.findByRole('button', { name: 'Dodaj transakcję' }));
    const form = within(await screen.findByRole('dialog', { name: 'Nowy wydatek' }));
    await user.click(await form.findByRole('button', { name: /Z konta.*Wybierz/ }));
    expect(form.getByText('Nie ma konta do wyboru')).toBeInTheDocument();
    await user.click(form.getByRole('button', { name: 'Przejdź do kont' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/accounts');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('ekran kont')).toBeInTheDocument();
  });
});

describe('Arkusz transakcji — przelew i przychód', () => {
  it('/t/new?type=transfer: arkusz nad miesiącem, plakietka celów, wyłącznik daje `none`', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(transactionsApi, 'createTransaction').mockResolvedValue(SAVED);
    const router = renderShell('/t/new?type=transfer');

    const dialog = await screen.findByRole('dialog', { name: 'Nowy przelew' });
    expect(router.state.location.pathname).toBe(`/m/${MONTH}`);
    const form = within(dialog);
    await form.findByRole('button', { name: /Z konta.*ROR mBank/ });
    await typeAmount(user, dialog, '100');

    await user.click(form.getByRole('button', { name: /Na konto.*Wybierz/ }));
    // Konto źródłowe nie wraca na liście docelowych (I-2).
    expect(form.queryByRole('button', { name: /ROR mBank/ })).not.toBeInTheDocument();
    await user.click(form.getByRole('button', { name: /Konto oszczędnościowe/ }));

    const badge = within(form.getByRole('group', { name: 'Wpływ na cele' }));
    expect(badge.getByText(/Zwiększa\s+oszczędności\s+o/)).toHaveTextContent('100,00 zł');

    await user.click(badge.getByRole('switch', { name: 'Liczy się do celów' }));
    expect(badge.getByText(/nie zmieni realizacji celów/)).toBeInTheDocument();

    await user.click(form.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });
    expect(create.mock.calls[0]?.[1]).toMatchObject({
      type: 'transfer',
      amountMinor: 10_000,
      accountId: ROR,
      counterAccountId: SAVINGS,
      allocationOverride: 'none',
    });
  });

  it('zakładka „Przychód": tytuł arkusza, szybkie dodanie źródła i wybór go od razu', async () => {
    const user = userEvent.setup();
    const created: IncomeSourceDto = {
      ...(SOURCES[0] as IncomeSourceDto),
      id: '01JB0000000000000000000022',
      name: 'Zlecenie',
      kind: 'freelance',
    };
    const createSource = vi
      .spyOn(incomeSourcesApi, 'createIncomeSource')
      .mockResolvedValue(created);
    renderShell();
    // Po dodaniu serwer zwraca listę już z nowym źródłem.
    vi.mocked(incomeSourcesApi.fetchIncomeSources)
      .mockResolvedValueOnce(SOURCES)
      .mockResolvedValue([...SOURCES, created]);

    const dialog = await openExpense(user);
    const form = within(dialog);
    await user.click(form.getByRole('tab', { name: 'Przychód' }));
    expect(await screen.findByRole('dialog', { name: 'Nowy przychód' })).toBeInTheDocument();

    await user.click(form.getByRole('button', { name: /Źródło.*Bez źródła/ }));
    expect(await form.findByRole('button', { name: /Pensja/ })).toBeInTheDocument();
    await user.click(form.getByRole('button', { name: 'Nowe źródło' }));
    await user.type(form.getByRole('textbox', { name: 'Nazwa nowego źródła' }), 'Zlecenie');
    await user.click(form.getByRole('radio', { name: 'Zlecenia' }));
    await user.click(form.getByRole('button', { name: 'Dodaj i wybierz' }));

    await waitFor(() => {
      expect(createSource).toHaveBeenCalledWith('token-testowy', {
        name: 'Zlecenie',
        kind: 'freelance',
      });
    });
    expect(await form.findByRole('button', { name: /Źródło.*Zlecenie/ })).toBeInTheDocument();
  });
});

describe('Arkusz transakcji — edycja', () => {
  it('/t/:id: PATCH wyłącznie ze zmienionym polem', async () => {
    const user = userEvent.setup();
    vi.spyOn(transactionsApi, 'fetchTransaction').mockResolvedValue(transaction());
    const update = vi.spyOn(transactionsApi, 'updateTransaction').mockResolvedValue(SAVED);
    renderShell(`/t/${TX}`);

    const dialog = await screen.findByRole('dialog', { name: 'Edytuj transakcję' });
    const form = within(dialog);
    const description = await form.findByRole('textbox', { name: 'Opis' });
    expect(form.queryByRole('tab')).not.toBeInTheDocument();
    await user.clear(description);
    await user.type(description, 'Obiad z rodzicami');
    await user.click(form.getByRole('button', { name: 'Zapisz zmiany' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('token-testowy', TX, {
        description: 'Obiad z rodzicami',
      });
    });
  });

  it('bez zmian: „Zapisz zmiany" tylko zamyka arkusz', async () => {
    const user = userEvent.setup();
    vi.spyOn(transactionsApi, 'fetchTransaction').mockResolvedValue(transaction());
    const update = vi.spyOn(transactionsApi, 'updateTransaction');
    renderShell(`/t/${TX}`);

    const dialog = await screen.findByRole('dialog', { name: 'Edytuj transakcję' });
    await user.click(await within(dialog).findByRole('button', { name: 'Zapisz zmiany' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('transakcja w koszu: zamiast formularza podpowiedź z „Przywróć"', async () => {
    vi.spyOn(transactionsApi, 'fetchTransaction')
      .mockResolvedValueOnce(transaction({ deletedAt: 5 }))
      .mockResolvedValue(transaction());
    const restore = vi.spyOn(transactionsApi, 'restoreTransaction').mockResolvedValue(SAVED);
    renderShell(`/t/${TX}`);
    expect(await screen.findByText('Transakcja jest w koszu')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zapisz zmiany' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Przywróć' }));
    expect(restore).toHaveBeenCalledWith('token-testowy', TX);
    // Przywrócenie unieważnia transakcję — arkusz sam przechodzi do formularza.
    expect(await screen.findByRole('button', { name: 'Zapisz zmiany' })).toBeInTheDocument();
  });

  it('„Usuń transakcję": kosz, zamknięcie arkusza i toast z „Cofnij"', async () => {
    vi.spyOn(transactionsApi, 'fetchTransaction').mockResolvedValue(transaction());
    const remove = vi.spyOn(transactionsApi, 'deleteTransaction').mockResolvedValue();
    const restore = vi.spyOn(transactionsApi, 'restoreTransaction').mockResolvedValue(SAVED);
    renderShell(`/t/${TX}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Usuń transakcję' }));
    expect(remove).toHaveBeenCalledWith('token-testowy', TX);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Przeniesiono do kosza')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cofnij' }));
    expect(restore).toHaveBeenCalledWith('token-testowy', TX);
  });

  it('nieudane usunięcie zostawia arkusz i mówi, co się stało', async () => {
    vi.spyOn(transactionsApi, 'fetchTransaction').mockResolvedValue(transaction());
    vi.spyOn(transactionsApi, 'deleteTransaction').mockRejectedValue(
      new ApiRequestError('CONFLICT', 'Transakcja jest już w koszu.', 409, 'req-3'),
    );
    renderShell(`/t/${TX}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Usuń transakcję' }));
    expect(
      await screen.findByText('Nie udało się usunąć: Transakcja jest już w koszu.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('zamknięty miesiąc: liczby tylko do odczytu, bez usuwania, opis do poprawienia', async () => {
    const user = userEvent.setup();
    vi.spyOn(transactionsApi, 'fetchTransaction').mockResolvedValue(
      transaction({ bookedOn: '2020-01-15', monthKey: '2020-01' }),
    );
    const update = vi.spyOn(transactionsApi, 'updateTransaction').mockResolvedValue(SAVED);
    renderShell(`/t/${TX}`);

    const dialog = await screen.findByRole('dialog', { name: 'Edytuj transakcję' });
    const form = within(dialog);
    expect(await form.findByRole('note')).toHaveTextContent('Miesiąc jest zamknięty');
    // Wybory kategorii, konta i daty to zwykłe wiersze, nie przyciski.
    expect(form.queryByRole('button', { name: /Kategoria/ })).not.toBeInTheDocument();
    expect(form.queryByRole('button', { name: /Data/ })).not.toBeInTheDocument();
    expect(form.queryByRole('button', { name: '1' })).not.toBeInTheDocument();
    expect(form.queryByRole('button', { name: 'Usuń transakcję' })).not.toBeInTheDocument();

    const description = form.getByRole('textbox', { name: 'Opis' });
    await user.clear(description);
    await user.type(description, 'Obiad');
    await user.type(description, ' u babci');
    await user.click(form.getByRole('button', { name: 'Zapisz zmiany' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('token-testowy', TX, { description: 'Obiad u babci' });
    });
  });

  it('zamknięty miesiąc w koszu: bez „Przywróć"', async () => {
    vi.spyOn(transactionsApi, 'fetchTransaction').mockResolvedValue(
      transaction({ bookedOn: '2020-01-15', monthKey: '2020-01', deletedAt: 5 }),
    );
    renderShell(`/t/${TX}`);
    expect(await screen.findByText(/nie da się jej przywrócić/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Przywróć' })).not.toBeInTheDocument();
  });

  it('nieistniejąca transakcja: stan „nie ma takiej"', async () => {
    vi.spyOn(transactionsApi, 'fetchTransaction').mockRejectedValue(
      new ApiRequestError('NOT_FOUND', 'Nie znaleziono.', 404, 'req-2'),
    );
    renderShell(`/t/${TX}`);
    expect(await screen.findByText('Nie ma takiej transakcji')).toBeInTheDocument();
  });
});

describe('Arkusz transakcji — „Zapisz jako wydatek stały" (F4-8)', () => {
  /** Reguła z odpowiedzi serwera — tylko pola, których używa toast. */
  const RULE = { id: TX, name: 'Obiad', nextDueOn: TODAY } as RecurringRuleDto;

  it('pole wyboru rozwija terminarz z dnia transakcji; po zapisie powstaje reguła', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(transactionsApi, 'createTransaction').mockResolvedValue(SAVED);
    const save = vi.spyOn(recurringApi, 'saveAsRecurring').mockResolvedValue(RULE);
    renderShell();

    const dialog = await openExpense(user);
    const form = within(dialog);
    await typeAmount(user, dialog, '45,99');
    await user.click(form.getByRole('checkbox', { name: 'Zapisz jako wydatek stały' }));
    expect(form.getByRole('textbox', { name: 'Dzień miesiąca' })).toHaveValue(
      String(Number(TODAY.slice(8, 10))),
    );
    expect(form.getByText(/Kolejne terminy:/)).toBeInTheDocument();

    await user.click(form.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(create).toHaveBeenCalledTimes(1);
    const [token, transactionId, body, key] = save.mock.calls[0] ?? [];
    expect(token).toBe('token-testowy');
    expect(transactionId).toBe(TX);
    expect(body).toEqual({
      frequency: 'monthly',
      intervalCount: 1,
      dayOfMonth: Number(TODAY.slice(8, 10)),
      weekday: null,
      monthOfYear: null,
    });
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(key).not.toBe(create.mock.calls[0]?.[2]);
    // Następny termin po tej transakcji — za miesiąc, nie dziś (dzisiejszy opłaciła).
    expect(await screen.findByText(/^Zapisano „Obiad" — następny termin /)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('błąd reguły — transakcja zostaje zapisana, toast mówi, czego nie zapisano', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(transactionsApi, 'createTransaction').mockResolvedValue(SAVED);
    vi.spyOn(recurringApi, 'saveAsRecurring').mockRejectedValue(new NetworkError());
    renderShell();

    const dialog = await openExpense(user);
    await typeAmount(user, dialog, '12');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Zapisz jako wydatek stały' }));
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }));

    expect(
      await screen.findByText(
        'Transakcja zapisana, ale pozycji cyklicznej nie: Brak połączenia z serwerem.',
      ),
    ).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('błędny dzień — komunikat pod polem i żadnego żądania', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(transactionsApi, 'createTransaction').mockResolvedValue(SAVED);
    renderShell();

    const dialog = await openExpense(user);
    const form = within(dialog);
    await typeAmount(user, dialog, '12');
    await user.click(form.getByRole('checkbox', { name: 'Zapisz jako wydatek stały' }));
    const day = form.getByRole('textbox', { name: 'Dzień miesiąca' });
    await user.clear(day);
    await user.type(day, '40');
    await user.click(form.getByRole('button', { name: 'Zapisz' }));

    expect(await form.findByText('Dzień miesiąca od 1 do 31')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('przychód ma własną etykietę', async () => {
    const user = userEvent.setup();
    renderShell();
    const dialog = await openExpense(user);
    await user.click(within(dialog).getByRole('tab', { name: 'Przychód' }));
    expect(
      within(dialog).getByRole('checkbox', { name: 'Zapisz jako stały przychód' }),
    ).toBeInTheDocument();
  });

  it('edycja istniejącej transakcji — bez pola wyboru', async () => {
    vi.spyOn(transactionsApi, 'fetchTransaction').mockResolvedValue(transaction());
    renderShell(`/t/${TX}`);
    const dialog = await screen.findByRole('dialog', { name: 'Edytuj transakcję' });
    await within(dialog).findByRole('textbox', { name: 'Opis' });
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
