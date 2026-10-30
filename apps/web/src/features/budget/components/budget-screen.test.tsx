import { formatMonth, monthKeyOf, shiftMonth, todayInTimezone } from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  budgetDraftFixture,
  budgetLineFixture,
  budgetListFixture,
} from '../../../../test/budget-fixture.js';
import { renderScreen } from '../../../../test/render-screen.js';
import { AppShell } from '../../../components/layout/app-shell.js';
import * as accountsApi from '../../accounts/api.js';
import * as categoriesApi from '../../categories/api.js';
import * as budgetApi from '../api.js';
import BudgetListScreen from './budget-list-screen.js';
import BudgetScreen from './budget-screen.js';

/**
 * Testy ekranów planera budżetu
 * ([06 §3.14](../../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth),
 * `F9-6`). Miesiące liczone od dziś — stan pusty zależy od zakresu [bieżący, +12].
 */

const CURRENT = monthKeyOf(todayInTimezone('Europe/Warsaw'));
const NEXT = shiftMonth(CURRENT, 1);

/** Ekrany w powłoce — powłoka daje `ToastProvider`. */
const ROUTES = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'budget', element: <BudgetListScreen /> },
      { path: 'budget/:month', element: <BudgetScreen /> },
      { path: 'm/:month/transactions', element: <p>historia miesiąca</p> },
    ],
  },
];

/**
 * Widoczny tekst elementu bez odczytu kwot słowami i ze spacjami zwykłymi.
 *
 * @param element - Element.
 * @returns Tekst.
 */
function textOf(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll('.sr-only')) hidden.remove();
  return (copy.textContent ?? '').replace(/\s/gu, ' ');
}

/** Średnie kategorii — Jedzenie 1 900 zł z 3 miesięcy. */
const AVERAGES = {
  months: 3 as const,
  window: { from: shiftMonth(CURRENT, -3), to: shiftMonth(CURRENT, -1) },
  monthsWithData: 3,
  items: [
    {
      categoryId: '01JC0000000000000000000009',
      name: 'Jedzenie',
      icon: null,
      averageMinor: 190_000,
      byMonth: [],
    },
  ],
};

/** Słowniki, z których korzystają arkusze — puste wystarczą. */
function mockDictionaries(): void {
  vi.spyOn(categoriesApi, 'fetchCategoryTree').mockResolvedValue([]);
  vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([]);
  vi.spyOn(budgetApi, 'fetchCategoryAverages').mockResolvedValue(AVERAGES);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BudgetListScreen', () => {
  it('kafel „Zaplanuj" i opis bez planów', async () => {
    vi.spyOn(budgetApi, 'fetchBudgetDrafts').mockResolvedValue(
      budgetListFixture({ suggestedMonth: NEXT }),
    );
    renderScreen('/budget', ROUTES);
    // Pierwszy test pliku płaci za wczytanie ekranów planera (leniwe trasy) — pod
    // obciążeniem pełnego przebiegu to bywa ponad sekundę.
    const tile = await screen.findByRole(
      'link',
      {
        name: new RegExp(`Zaplanuj ${formatMonth(NEXT)}`, 'u'),
      },
      { timeout: 3_000 },
    );
    expect(tile).toHaveAttribute('href', `/budget/${NEXT}`);
    expect(screen.getByText(/Nie ma jeszcze żadnego planu/u)).toBeInTheDocument();
  });

  it('plany z liczbą pozycji i ostrzeżeń; dotknięcie otwiera szkic', async () => {
    const user = userEvent.setup();
    vi.spyOn(budgetApi, 'fetchBudgetDrafts').mockResolvedValue(
      budgetListFixture({
        suggestedMonth: null,
        items: [
          {
            month: NEXT,
            incomeMinor: 1,
            expenseMinor: 1,
            leftoverMinor: 23_600,
            lineCount: 7,
            warningCount: 2,
          },
        ],
      }),
    );
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(budgetDraftFixture({ month: NEXT }));
    const { router } = renderScreen('/budget', ROUTES);
    const row = await screen.findByRole('button', { name: new RegExp(formatMonth(NEXT), 'u') });
    expect(textOf(row)).toContain('7 pozycji · 2 ostrzeżenia');
    expect(textOf(row)).toContain('236,00');
    await user.click(row);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/budget/${NEXT}`);
    });
  });

  it('błąd wczytania', async () => {
    vi.spyOn(budgetApi, 'fetchBudgetDrafts').mockRejectedValue(new Error('awaria'));
    renderScreen('/budget', ROUTES);
    expect(await screen.findByText('Nie udało się wczytać planów')).toBeInTheDocument();
  });
});

describe('BudgetScreen — szkic', () => {
  it('bilans, rozkład, ostrzeżenie, cele, sekcje i pominięte', async () => {
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(
      budgetDraftFixture({
        month: NEXT,
        lines: [
          budgetLineFixture({
            id: '01JL0000000000000000000010',
            flow: 'income',
            name: 'Wynagrodzenie',
            amountMinor: 1_180_000,
            categoryName: null,
          }),
          budgetLineFixture(),
          budgetLineFixture({
            id: '01JL0000000000000000000011',
            origin: 'manual',
            name: 'Jedzenie',
            amountMinor: 190_000,
            categoryName: 'Jedzenie',
            averageMonths: 3,
            sourceState: null,
            sourceAmountMinor: null,
            recurringRuleId: null,
          }),
          budgetLineFixture({
            id: '01JL0000000000000000000012',
            name: 'Netflix',
            amountMinor: 4_300,
            isExcluded: true,
          }),
        ],
      }),
    );
    renderScreen(`/budget/${NEXT}`, ROUTES);
    await screen.findByText('Czynsz');

    const plan = screen.getByRole('heading', { name: 'Plan' }).closest('section') as HTMLElement;
    expect(textOf(plan)).toContain('Zostaje');
    expect(textOf(plan)).toContain('236,00');
    expect(within(plan).getByText('Oszczędności 18,4% z 20,0%')).toBeInTheDocument();
    expect(within(plan).getByText('Do planu oszczędności brakuje 190,00 zł.')).toBeInTheDocument();
    expect(within(plan).getByRole('button', { name: /Dodaj brakujące/u })).toBeInTheDocument();

    const goals = screen
      .getByRole('heading', { name: 'Cele i odkładanie' })
      .closest('section') as HTMLElement;
    expect(within(goals).getByText('Poduszka')).toBeInTheDocument();
    expect(within(goals).getByLabelText('za mało')).toBeInTheDocument();

    const expenses = screen
      .getByRole('heading', { name: 'Wydatki' })
      .closest('section') as HTMLElement;
    expect(within(expenses).getByText('Czynsz')).toBeInTheDocument();
    expect(within(expenses).getByText(', pozycja cykliczna')).toHaveClass('sr-only');
    expect(within(expenses).getByText('Jedzenie · średnia 3 mies.')).toBeInTheDocument();
    expect(within(expenses).queryByText('Netflix')).not.toBeInTheDocument();
    expect(screen.getByText('Pominięte w planie (1)')).toBeInTheDocument();

    const pools = screen
      .getByRole('heading', { name: 'Oszczędności i inwestycje' })
      .closest('section') as HTMLElement;
    expect(within(pools).getByText('Brak pozycji.')).toBeInTheDocument();
  });

  it('„Dodaj brakujące" dopisuje linię z niedoborem', async () => {
    const user = userEvent.setup();
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(budgetDraftFixture({ month: NEXT }));
    const create = vi.spyOn(budgetApi, 'createBudgetLine').mockResolvedValue(
      budgetDraftFixture({
        month: NEXT,
        summary: { ...budgetDraftFixture().summary, warnings: [] },
      }),
    );
    renderScreen(`/budget/${NEXT}`, ROUTES);
    await user.click(await screen.findByRole('button', { name: /Dodaj brakujące/u }));
    expect(create).toHaveBeenCalledWith('token-testowy', NEXT, {
      flow: 'savings',
      name: 'Uzupełnienie oszczędności',
      amountMinor: 19_000,
      notes: null,
    });
    expect(await screen.findByText('Dodano „Uzupełnienie oszczędności”.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Dodaj brakujące/u })).not.toBeInTheDocument();
    });
  });

  it('„Przyjmij", „Zostaw jako własną" i „Przywróć"', async () => {
    const user = userEvent.setup();
    const changed = budgetLineFixture({
      sourceState: 'source_changed',
      sourceCurrentAmountMinor: 195_000,
    });
    const orphan = budgetLineFixture({
      id: '01JL0000000000000000000020',
      name: 'Siłownia',
      sourceState: 'missing',
      recurringRuleId: null,
    });
    const hidden = budgetLineFixture({
      id: '01JL0000000000000000000021',
      name: 'Netflix',
      isExcluded: true,
    });
    const draft = budgetDraftFixture({ month: NEXT, lines: [changed, orphan, hidden] });
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(draft);
    const accept = vi.spyOn(budgetApi, 'acceptBudgetLineSource').mockResolvedValue(draft);
    const detach = vi.spyOn(budgetApi, 'detachBudgetLine').mockResolvedValue(draft);
    const update = vi.spyOn(budgetApi, 'updateBudgetLine').mockResolvedValue(draft);
    renderScreen(`/budget/${NEXT}`, ROUTES);

    expect(await screen.findByText(/^W regule teraz 1 950,00/u)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Przyjmij' }));
    expect(accept).toHaveBeenCalledWith('token-testowy', NEXT, changed.id);

    expect(screen.getByText('Źródło usunięto')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zostaw jako własną' }));
    expect(detach).toHaveBeenCalledWith('token-testowy', NEXT, orphan.id);

    await user.click(screen.getByText('Pominięte w planie (1)'));
    await user.click(screen.getByRole('button', { name: 'Przywróć' }));
    expect(update).toHaveBeenCalledWith('token-testowy', NEXT, hidden.id, { isExcluded: false });
  });

  it('odświeżenie ze źródeł i usunięcie planu z potwierdzeniem', async () => {
    const user = userEvent.setup();
    const draft = budgetDraftFixture({ month: NEXT });
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(draft);
    vi.spyOn(budgetApi, 'fetchBudgetDrafts').mockResolvedValue(budgetListFixture());
    const refresh = vi.spyOn(budgetApi, 'refreshBudgetDraft').mockResolvedValue(draft);
    const remove = vi.spyOn(budgetApi, 'deleteBudgetDraft').mockResolvedValue(undefined);
    const { router } = renderScreen(`/budget/${NEXT}`, ROUTES);

    await user.click(await screen.findByRole('button', { name: 'Odśwież ze źródeł' }));
    expect(refresh).toHaveBeenCalledWith('token-testowy', NEXT);
    expect(await screen.findByText('Plan odświeżony ze źródeł.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Usuń plan' }));
    const dialog = within(
      await screen.findByRole('dialog', { name: `Usunąć plan na ${formatMonth(NEXT)}?` }),
    );
    await user.click(dialog.getByRole('button', { name: 'Usuń plan' }));
    expect(remove).toHaveBeenCalledWith('token-testowy', NEXT);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/budget');
    });
  });

  it('plan minionego miesiąca — tylko do odczytu, bez akcji na liniach', async () => {
    const past = shiftMonth(CURRENT, -1);
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(
      budgetDraftFixture({
        month: past,
        isEditable: false,
        lines: [budgetLineFixture({ sourceState: null, isExcluded: true })],
      }),
    );
    renderScreen(`/budget/${past}`, ROUTES);
    expect(await screen.findByRole('note')).toHaveTextContent('tylko do odczytu');
    expect(screen.queryByRole('button', { name: 'Odśwież ze źródeł' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dodaj brakujące/u })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Przywróć' })).not.toBeInTheDocument();
  });

  it('błąd wczytania — stan błędu z ponowieniem', async () => {
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockRejectedValue(new Error('awaria'));
    renderScreen(`/budget/${NEXT}`, ROUTES);
    expect(await screen.findByText('Nie udało się wczytać planu')).toBeInTheDocument();
  });
});

describe('BudgetScreen — brak planu', () => {
  it('trzy drogi założenia; kopia z najbliższego wcześniejszego planu', async () => {
    const user = userEvent.setup();
    const later = shiftMonth(CURRENT, 2);
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(null);
    vi.spyOn(budgetApi, 'fetchBudgetDrafts').mockResolvedValue(
      budgetListFixture({
        items: [
          {
            month: CURRENT,
            incomeMinor: 0,
            expenseMinor: 0,
            leftoverMinor: 0,
            lineCount: 0,
            warningCount: 0,
          },
          {
            month: NEXT,
            incomeMinor: 0,
            expenseMinor: 0,
            leftoverMinor: 0,
            lineCount: 0,
            warningCount: 0,
          },
        ],
      }),
    );
    const create = vi
      .spyOn(budgetApi, 'createBudgetDraft')
      .mockResolvedValue(budgetDraftFixture({ month: later }));
    renderScreen(`/budget/${later}`, ROUTES);

    expect(await screen.findByText(`Brak planu na ${formatMonth(later)}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zacznij od zera' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: `Skopiuj z ${formatMonth(NEXT)}` }));
    expect(create).toHaveBeenCalledWith('token-testowy', later, {
      fillFromSources: true,
      copyManualFrom: NEXT,
    });
    expect(await screen.findByRole('heading', { name: 'Plan' })).toBeInTheDocument();
  });

  it('„Utwórz z danych" otwiera arkusz: źródła, średnie, kopia; „Zacznij od zera"', async () => {
    const user = userEvent.setup();
    mockDictionaries();
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(null);
    vi.spyOn(budgetApi, 'fetchBudgetDrafts').mockResolvedValue(budgetListFixture());
    const create = vi
      .spyOn(budgetApi, 'createBudgetDraft')
      .mockRejectedValue(new Error('Plan na ten miesiąc już istnieje.'));
    renderScreen(`/budget/${NEXT}`, ROUTES);
    expect(screen.queryByRole('button', { name: /Skopiuj z/u })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Utwórz z danych' }));
    const dialog = within(
      await screen.findByRole('dialog', { name: `Plan na ${formatMonth(NEXT)}` }),
    );
    await user.click(await dialog.findByRole('checkbox', { name: /Jedzenie/u }));
    await user.click(dialog.getByRole('button', { name: 'Utwórz plan' }));
    expect(create).toHaveBeenLastCalledWith('token-testowy', NEXT, {
      fillFromSources: true,
      copyManualFrom: null,
      averageLines: [{ categoryId: '01JC0000000000000000000009', months: 3 }],
      notes: null,
    });
    expect(await screen.findByText('Plan na ten miesiąc już istnieje.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Zacznij od zera' }));
    expect(create).toHaveBeenLastCalledWith('token-testowy', NEXT, { fillFromSources: false });
  });

  it('miesiąc miniony bez planu i poza zakresem — wyjaśnienie bez przycisków', async () => {
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(null);
    vi.spyOn(budgetApi, 'fetchBudgetDrafts').mockResolvedValue(budgetListFixture());
    const past = shiftMonth(CURRENT, -2);
    renderScreen(`/budget/${past}`, ROUTES);
    expect(await screen.findByText(`Nie było planu na ${formatMonth(past)}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Utwórz z danych' })).not.toBeInTheDocument();
  });

  it('za daleko w przyszłość', async () => {
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(null);
    vi.spyOn(budgetApi, 'fetchBudgetDrafts').mockResolvedValue(budgetListFixture());
    const far = shiftMonth(CURRENT, 13);
    renderScreen(`/budget/${far}`, ROUTES);
    expect(
      await screen.findByText(`Za wcześnie na plan na ${formatMonth(far)}`),
    ).toBeInTheDocument();
  });

  it('zły klucz miesiąca', async () => {
    renderScreen('/budget/2026-13', ROUTES);
    expect(await screen.findByText('Nie ma takiego miesiąca')).toBeInTheDocument();
  });
});

describe('BudgetScreen — arkusz linii', () => {
  it('„+ Dodaj" w wydatkach dopisuje linię własną ze średnią kategorii', async () => {
    const user = userEvent.setup();
    mockDictionaries();
    const draft = budgetDraftFixture({ month: NEXT });
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(draft);
    const create = vi.spyOn(budgetApi, 'createBudgetLine').mockResolvedValue(draft);
    renderScreen(`/budget/${NEXT}`, ROUTES);

    await user.click(await screen.findByRole('button', { name: 'Dodaj: Wydatki' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Nowa pozycja planu' }));
    await user.type(dialog.getByLabelText('Nazwa'), 'Prezent');
    await user.type(dialog.getByLabelText('Kwota'), '250');
    await user.click(dialog.getByRole('button', { name: 'Dodaj do planu' }));
    expect(create).toHaveBeenCalledWith('token-testowy', NEXT, {
      flow: 'expense',
      name: 'Prezent',
      amountMinor: 25_000,
      categoryId: null,
      goalId: null,
      dueOn: null,
      averageMonths: null,
      notes: null,
      groupId: null,
    });
  });

  it('brak nazwy — błąd pola bez wysyłki', async () => {
    const user = userEvent.setup();
    mockDictionaries();
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(budgetDraftFixture({ month: NEXT }));
    const create = vi.spyOn(budgetApi, 'createBudgetLine');
    renderScreen(`/budget/${NEXT}`, ROUTES);
    await user.click(await screen.findByRole('button', { name: 'Dodaj: Wpływy' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Nowa pozycja planu' }));
    await user.click(dialog.getByRole('button', { name: 'Dodaj do planu' }));
    expect(dialog.getByText('Nazwa jest wymagana')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('edycja linii wysyła tylko zmienione pola; „Użyj" średniej ustawia kwotę i okno', async () => {
    const user = userEvent.setup();
    mockDictionaries();
    const food = budgetLineFixture({
      id: '01JL0000000000000000000011',
      origin: 'manual',
      name: 'Jedzenie',
      amountMinor: 150_000,
      categoryId: '01JC0000000000000000000009',
      categoryName: 'Jedzenie',
      recurringRuleId: null,
      sourceAmountMinor: null,
      sourceState: null,
      canApplyToSource: false,
      canPromote: ['recurring', 'planned'],
      dueOn: null,
    });
    const draft = budgetDraftFixture({ month: NEXT, lines: [food] });
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(draft);
    const update = vi.spyOn(budgetApi, 'updateBudgetLine').mockResolvedValue(draft);
    renderScreen(`/budget/${NEXT}`, ROUTES);

    await user.click(await screen.findByRole('button', { name: /Jedzenie/u }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Jedzenie' }));
    await user.click(await dialog.findByRole('button', { name: /3 mies\./u }));
    await user.click(dialog.getByRole('button', { name: 'Zapisz zmiany' }));
    expect(update).toHaveBeenCalledWith('token-testowy', NEXT, food.id, {
      amountMinor: 190_000,
      averageMonths: 3,
    });
  });

  it('linia własna → planowany wydatek z kluczem idempotencji', async () => {
    const user = userEvent.setup();
    mockDictionaries();
    const gift = budgetLineFixture({
      id: '01JL0000000000000000000012',
      origin: 'manual',
      name: 'Prezent',
      amountMinor: 25_000,
      recurringRuleId: null,
      sourceAmountMinor: null,
      sourceState: null,
      canApplyToSource: false,
      canPromote: ['recurring', 'planned'],
      dueOn: null,
    });
    const draft = budgetDraftFixture({ month: NEXT, lines: [gift] });
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(draft);
    const promote = vi.spyOn(budgetApi, 'promoteBudgetLine').mockResolvedValue({
      draft,
      created: { kind: 'planned_expense', id: '01JP0000000000000000000001' },
      lineMovedTo: null,
    });
    renderScreen(`/budget/${NEXT}`, ROUTES);

    await user.click(await screen.findByRole('button', { name: /Prezent/u }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Prezent' }));
    await user.click(dialog.getByRole('button', { name: 'Planowany wydatek' }));
    await user.click(dialog.getByRole('button', { name: 'Zapisz jako planowany' }));
    expect(promote).toHaveBeenCalledWith(
      'token-testowy',
      NEXT,
      gift.id,
      expect.objectContaining({ target: 'planned', dueMonth: NEXT, dueOn: null }),
      expect.any(String),
    );
    expect(
      await screen.findByText('„Prezent” jest teraz planowanym wydatkiem.'),
    ).toBeInTheDocument();
  });

  it('„Zapisz w regule" najpierw pokazuje skutek, potem zapisuje z kluczem', async () => {
    const user = userEvent.setup();
    mockDictionaries();
    const rent = budgetLineFixture({ amountMinor: 195_000 });
    const draft = budgetDraftFixture({ month: NEXT, lines: [rent] });
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(draft);
    const apply = vi.spyOn(budgetApi, 'applyBudgetLineToSource').mockResolvedValue({
      draft,
      effect: {
        kind: 'rule_split',
        previousAmountMinor: 185_000,
        newAmountMinor: 195_000,
        fromMonth: NEXT,
        newRuleId: '01JR0000000000000000000002',
      },
    });
    renderScreen(`/budget/${NEXT}`, ROUTES);

    await user.click(await screen.findByRole('button', { name: /Czynsz/u }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Czynsz' }));
    await user.click(dialog.getByRole('button', { name: 'Zapisz w regule' }));
    expect(textOf(dialog.getByText(/^Od /u))).toContain('1 950,00');
    expect(apply).not.toHaveBeenCalled();
    await user.click(dialog.getByRole('button', { name: 'Zapisz' }));
    expect(apply).toHaveBeenCalledWith('token-testowy', NEXT, rent.id, expect.any(String));
    expect(await screen.findByText(/pozycja cykliczna ma kwotę 1 950,00/u)).toBeInTheDocument();
  });

  it('„Pomiń w planie" dla linii powiązanej', async () => {
    const user = userEvent.setup();
    mockDictionaries();
    const draft = budgetDraftFixture({ month: NEXT, lines: [budgetLineFixture()] });
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(draft);
    const remove = vi.spyOn(budgetApi, 'deleteBudgetLine').mockResolvedValue(draft);
    renderScreen(`/budget/${NEXT}`, ROUTES);
    await user.click(await screen.findByRole('button', { name: /Czynsz/u }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Czynsz' }));
    await user.click(dialog.getByRole('button', { name: 'Pomiń w planie' }));
    expect(remove).toHaveBeenCalledWith('token-testowy', NEXT, '01JL0000000000000000000001');
  });
});

describe('BudgetScreen — plan kontra wykonanie (F9-9)', () => {
  it('kolumna „Wykonanie", zdanie pod linią i „Poza planem" z odnośnikiem do historii', async () => {
    const rent = budgetLineFixture();
    const food = budgetLineFixture({
      id: '01JL0000000000000000000011',
      origin: 'manual',
      name: 'Jedzenie',
      amountMinor: 190_000,
      recurringRuleId: null,
      sourceAmountMinor: null,
      sourceState: null,
    });
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(
      budgetDraftFixture({
        month: CURRENT,
        lines: [rent, food],
        actuals: {
          lines: { [rent.id]: 185_000 },
          groups: [
            {
              kind: 'category',
              id: '01JC0000000000000000000009',
              name: 'Jedzenie',
              lineIds: [food.id],
              plannedMinor: 190_000,
              actualMinor: 202_000,
            },
          ],
          totals: {
            incomeMinor: 0,
            expenseMinor: 419_000,
            savingsMinor: 0,
            investmentMinor: 0,
            netMinor: -419_000,
          },
          unplannedMinor: 32_000,
        },
      }),
    );
    const { router } = renderScreen(`/budget/${CURRENT}`, ROUTES);
    expect(await screen.findByText('Wykonanie')).toBeInTheDocument();
    /**
     * Akapit, którego widoczny tekst zaczyna się od podanego.
     *
     * @param start - Początek tekstu.
     * @returns Element akapitu.
     */
    const paragraph = (start: string): HTMLElement =>
      screen.getByText(
        (_, element) =>
          element instanceof HTMLParagraphElement && textOf(element).trim().startsWith(start),
      );
    expect(textOf(paragraph('wydano 1 850,00'))).toBe('wydano 1 850,00');
    const over = paragraph('wydano 2 020,00');
    expect(textOf(over)).toBe('wydano 2 020,00 · ponad plan 120,00');
    expect(over).toHaveClass('text-warning');
    expect(textOf(paragraph('Poza planem'))).toContain('320,00');
    await userEvent.setup().click(screen.getByRole('link', { name: 'historia' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/m/${CURRENT}/transactions`);
    });
  });

  it('miesiąc przyszły — bez kolumny wykonania', async () => {
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(budgetDraftFixture({ month: NEXT }));
    renderScreen(`/budget/${NEXT}`, ROUTES);
    await screen.findByText('Czynsz');
    expect(screen.queryByText('Wykonanie')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Poza planem/u)).not.toBeInTheDocument();
  });
});

describe('BudgetScreen — grupy i „Układaj" (ADR-081)', () => {
  const HOME = {
    id: '01JK0000000000000000000001',
    section: 'expense' as const,
    name: 'Dom',
    sortOrder: 0,
  };
  const DEBT = {
    id: '01JK0000000000000000000002',
    section: 'expense' as const,
    name: 'Raty',
    sortOrder: 1,
  };
  const rent = budgetLineFixture({ groupId: HOME.id });
  const power = budgetLineFixture({
    id: '01JL0000000000000000000012',
    name: 'Prąd',
    amountMinor: 12_000,
    recurringRuleId: '01JR0000000000000000000002',
    groupId: HOME.id,
  });
  const loan = budgetLineFixture({
    id: '01JL0000000000000000000013',
    name: 'Rata',
    amountMinor: 90_000,
    recurringRuleId: '01JR0000000000000000000003',
    groupId: DEBT.id,
  });
  const gift = budgetLineFixture({
    id: '01JL0000000000000000000014',
    origin: 'manual',
    name: 'Prezent',
    amountMinor: 30_000,
    recurringRuleId: null,
    sourceAmountMinor: null,
    sourceState: null,
  });
  const grouped = budgetDraftFixture({
    month: NEXT,
    lines: [rent, power, loan, gift],
    groups: [HOME, DEBT],
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('nagłówki grup z sumą, „Bez grupy" na końcu; zwinięcie chowa pozycje i zostaje zapamiętane', async () => {
    const user = userEvent.setup();
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(grouped);
    renderScreen(`/budget/${NEXT}`, ROUTES);
    const toggle = await screen.findByRole('button', { name: /^Dom/u });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(textOf(toggle)).toContain('1 970,00');
    expect(screen.getByText('Bez grupy')).toBeInTheDocument();
    expect(screen.getByText('Prąd')).toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Prąd')).not.toBeInTheDocument();
    expect(screen.getByText('Rata')).toBeInTheDocument();
    expect(window.localStorage.getItem('fineapp.budget.collapsedGroups')).toBe('["expense:dom"]');
  });

  it('sekcja bez grup: „Układaj" pokazuje szybki start i zakłada grupy według pochodzenia', async () => {
    const user = userEvent.setup();
    const plain = budgetDraftFixture({
      month: NEXT,
      lines: [rent, gift].map((line) => ({ ...line, groupId: null })),
    });
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(plain);
    const byOrigin = vi.spyOn(budgetApi, 'groupBudgetByOrigin').mockResolvedValue(grouped);
    renderScreen(`/budget/${NEXT}`, ROUTES);
    await screen.findByText('Czynsz');
    expect(screen.queryByText('Bez grupy')).not.toBeInTheDocument();
    const expenses = screen.getByRole('heading', { name: 'Wydatki' }).closest('section');
    if (expenses === null) throw new Error('brak sekcji');
    await user.click(within(expenses).getByRole('button', { name: 'Układaj' }));
    expect(screen.getByText('Podzielić na grupy?')).toBeInTheDocument();
    expect(textOf(screen.getByText(/^Stałe/u))).toBe('Stałe · 1');
    expect(screen.getByRole('button', { name: 'Przesuń: Czynsz' })).toBeInTheDocument();
    // Dotknięcie wiersza w trybie układania nic nie otwiera.
    expect(screen.queryByRole('button', { name: /^Czynsz/u })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Utwórz grupy' }));
    expect(byOrigin).toHaveBeenCalledWith('token-testowy', NEXT, 'expense');
    await user.click(screen.getAllByRole('button', { name: 'Gotowe' })[0] ?? document.body);
    expect(screen.queryByRole('button', { name: 'Przesuń: Czynsz' })).not.toBeInTheDocument();
  });

  it('„Sam ułożę" chowa szybki start; „Nowa grupa" zakłada grupę w sekcji', async () => {
    const user = userEvent.setup();
    const plain = budgetDraftFixture({ month: NEXT, lines: [{ ...rent, groupId: null }] });
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(plain);
    const create = vi.spyOn(budgetApi, 'createBudgetGroup').mockResolvedValue(grouped);
    renderScreen(`/budget/${NEXT}`, ROUTES);
    await screen.findByText('Czynsz');
    await user.click(screen.getByRole('button', { name: 'Układaj' }));
    await user.click(screen.getByRole('button', { name: 'Sam ułożę' }));
    expect(screen.queryByText('Podzielić na grupy?')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nowa grupa' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Nowa grupa' }));
    await user.type(dialog.getByLabelText('Nazwa'), ' Mieszkanie ');
    await user.click(dialog.getByRole('button', { name: 'Dodaj grupę' }));
    expect(create).toHaveBeenCalledWith('token-testowy', NEXT, {
      section: 'expense',
      name: 'Mieszkanie',
    });
  });

  it('arkusz grupy: „Przesuń niżej" zapisuje układ, „Usuń" ma „Cofnij"', async () => {
    const user = userEvent.setup();
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(grouped);
    const layout = vi.spyOn(budgetApi, 'updateBudgetLayout').mockResolvedValue(grouped);
    const remove = vi.spyOn(budgetApi, 'deleteBudgetGroup').mockResolvedValue(grouped);
    const create = vi.spyOn(budgetApi, 'createBudgetGroup').mockResolvedValue(grouped);
    renderScreen(`/budget/${NEXT}`, ROUTES);
    await screen.findByText('Prąd');
    await user.click(screen.getByRole('button', { name: 'Układaj' }));
    await user.click(screen.getByRole('button', { name: 'Opcje grupy Dom' }));
    let dialog = within(await screen.findByRole('dialog', { name: 'Grupa' }));
    expect(dialog.getByRole('button', { name: 'Przesuń wyżej' })).toBeDisabled();
    expect(textOf(dialog.getByText(/w grupie/u))).toContain('2 pozycje w grupie');
    await user.click(dialog.getByRole('button', { name: 'Przesuń niżej' }));
    expect(layout).toHaveBeenCalledWith('token-testowy', NEXT, {
      section: 'expense',
      groups: [
        { id: DEBT.id, lineIds: [loan.id] },
        { id: HOME.id, lineIds: [rent.id, power.id] },
      ],
      ungroupedLineIds: [gift.id],
    });
    await user.click(dialog.getByRole('button', { name: /Usuń grupę/u }));
    expect(remove).toHaveBeenCalledWith('token-testowy', NEXT, HOME.id);
    await user.click(await screen.findByRole('button', { name: 'Cofnij' }));
    expect(create).toHaveBeenCalledWith('token-testowy', NEXT, {
      section: 'expense',
      name: 'Dom',
      lineIds: [rent.id, power.id],
      position: 0,
    });
    dialog = within(document.body);
    expect(dialog.queryByRole('dialog', { name: 'Grupa' })).not.toBeInTheDocument();
  });

  it('pole „Grupa" w arkuszu linii przenosi pozycję bez przeciągania', async () => {
    const user = userEvent.setup();
    mockDictionaries();
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue(grouped);
    const update = vi.spyOn(budgetApi, 'updateBudgetLine').mockResolvedValue(grouped);
    renderScreen(`/budget/${NEXT}`, ROUTES);
    await user.click(await screen.findByRole('button', { name: /^Prezent/u }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Prezent' }));
    expect(dialog.getByRole('radio', { name: 'Bez grupy' })).toBeChecked();
    await user.click(dialog.getByRole('radio', { name: 'Raty' }));
    await user.click(dialog.getByRole('button', { name: 'Zapisz zmiany' }));
    expect(update).toHaveBeenCalledWith('token-testowy', NEXT, gift.id, { groupId: DEBT.id });
  });

  it('plan minionego miesiąca — grupy widać, „Układaj" nie ma', async () => {
    const past = shiftMonth(CURRENT, -1);
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue({
      ...grouped,
      month: past,
      isEditable: false,
    });
    renderScreen(`/budget/${past}`, ROUTES);
    expect(await screen.findByRole('button', { name: /^Dom/u })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Układaj' })).not.toBeInTheDocument();
  });

  it('wykonanie grupy w nagłówku w bieżącym miesiącu', async () => {
    vi.spyOn(budgetApi, 'fetchBudgetDraft').mockResolvedValue({
      ...grouped,
      month: CURRENT,
      actuals: {
        lines: { [rent.id]: 185_000, [power.id]: 5_000, [loan.id]: 90_000 },
        groups: [],
        totals: {
          incomeMinor: 0,
          expenseMinor: 280_000,
          savingsMinor: 0,
          investmentMinor: 0,
          netMinor: -280_000,
        },
        unplannedMinor: 0,
      },
    });
    renderScreen(`/budget/${CURRENT}`, ROUTES);
    await screen.findByRole('button', { name: /^Dom/u });
    expect(
      screen.getByText(
        (_, element) =>
          element instanceof HTMLParagraphElement &&
          textOf(element).trim() === 'wydano 1 900,00 · zostało 70,00',
      ),
    ).toBeInTheDocument();
  });
});
