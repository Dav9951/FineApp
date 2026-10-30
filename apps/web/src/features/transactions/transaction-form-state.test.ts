import type { AccountDto, TransactionDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  addDays,
  dateLabel,
  dateShortcuts,
  defaultAccountId,
  emptyTransactionForm,
  formErrorsFromApi,
  formTitle,
  postingBounds,
  previewEffects,
  switchType,
  toCreateRequest,
  toUpdateRequest,
  transactionFormFrom,
  transferCanAffectGoals,
  type TransactionFormState,
} from './transaction-form-state.js';

/**
 * Testy formularza transakcji ([06 §3.3](../../../../../plans/06-ui-views.md#33-formularz-transakcji--tnew-tid)).
 */

const TODAY = '2026-09-23';
const ROR = '01JB0000000000000000000001';
const HOME = '01JB0000000000000000000002';
const BROKER = '01JB0000000000000000000003';
const CASH = '01JB0000000000000000000004';
const FOOD = '01JC0000000000000000000001';
const GOAL = '01JG0000000000000000000001';

/**
 * Konto testowe.
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
    openingBalanceOn: '2026-01-01',
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
  account(HOME, { type: 'savings', allocationClass: 'savings' }),
  account(ROR),
  account(BROKER, { type: 'investment', allocationClass: 'investment' }),
  account(CASH, { type: 'cash' }),
];

/**
 * Formularz z nadpisanymi polami.
 *
 * @param overrides - Nadpisane pola.
 * @returns Stan.
 */
function form(overrides: Partial<TransactionFormState> = {}): TransactionFormState {
  return { ...emptyTransactionForm('expense', TODAY, ROR), amountMinor: 12_799, ...overrides };
}

/** Zapisany przelew ROR → konto mieszkaniowe. */
const TRANSFER: TransactionDto = {
  id: '01JT0000000000000000000001',
  type: 'transfer',
  status: 'posted',
  bookedOn: '2026-09-11',
  monthKey: '2026-09',
  amountMinor: 200_000,
  currency: 'PLN',
  accountId: ROR,
  counterAccountId: HOME,
  categoryId: null,
  incomeSourceId: null,
  liabilityId: null,
  goalId: null,
  sourceAllocationClass: 'spending',
  targetAllocationClass: 'savings',
  allocationOverride: null,
  allocationEffects: [{ kind: 'savings', amountMinor: 200_000 }],
  description: 'Wkład własny',
  merchant: null,
  notes: null,
  source: 'manual',
  sourceDocumentId: null,
  recurringOccurrenceId: null,
  plannedExpenseId: null,
  createdBy: '01JU0000000000000000000001',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

describe('wartości domyślne', () => {
  it('konto proponowane: pierwsze aktywne na wydatki, potem pierwsze aktywne', () => {
    expect(defaultAccountId(ACCOUNTS)).toBe(ROR);
    expect(defaultAccountId([account(HOME, { allocationClass: 'savings' })])).toBe(HOME);
    expect(defaultAccountId([account(ROR, { isArchived: true })])).toBeNull();
    expect(defaultAccountId([])).toBeNull();
  });

  it('domyślne konto wydatków z ustawień wygrywa, o ile jest aktywne (ADR-070)', () => {
    expect(defaultAccountId(ACCOUNTS, CASH)).toBe(CASH);
    expect(defaultAccountId([account(ROR), account(CASH, { isArchived: true })], CASH)).toBe(ROR);
    expect(defaultAccountId(ACCOUNTS, '01JB0000000000000000000099')).toBe(ROR);
    expect(defaultAccountId(ACCOUNTS, null)).toBe(ROR);
  });

  it('tytuł arkusza mówi, co powstaje', () => {
    expect(formTitle('expense', false)).toBe('Nowy wydatek');
    expect(formTitle('transfer', true)).toBe('Edytuj przelew');
  });
});

describe('switchType', () => {
  it('zostawia kwotę, datę, konto i opis; czyści pola, które w nowym typie byłyby błędem', () => {
    const state = form({
      categoryId: FOOD,
      description: 'Zakupy',
      bookedOn: '2026-09-20',
    });
    const income = switchType(state, 'income');
    expect(income).toMatchObject({
      type: 'income',
      amountMinor: 12_799,
      accountId: ROR,
      bookedOn: '2026-09-20',
      description: 'Zakupy',
      categoryId: null,
    });
    const transfer = switchType({ ...income, incomeSourceId: 'S' }, 'transfer');
    expect(transfer.incomeSourceId).toBeNull();
    expect(switchType(transfer, 'transfer')).toBe(transfer);
  });
});

describe('toCreateRequest', () => {
  it('wydatek: puste teksty jako `null`, bez pól innych typów', () => {
    expect(toCreateRequest(form({ categoryId: FOOD, merchant: ' Lidl ' }))).toEqual({
      ok: true,
      body: {
        type: 'expense',
        bookedOn: TODAY,
        amountMinor: 12_799,
        accountId: ROR,
        counterAccountId: null,
        categoryId: FOOD,
        incomeSourceId: null,
        allocationOverride: null,
        goalId: null,
        description: null,
        merchant: 'Lidl',
        notes: null,
      },
    });
  });

  it('przelew na cel: `goalId` tylko w przelewie; zmiana typu go czyści (Z-23)', () => {
    const transfer = form({ type: 'transfer', counterAccountId: HOME, goalId: GOAL });
    const result = toCreateRequest(transfer);
    expect(result.ok && result.body.goalId).toBe(GOAL);
    expect(switchType(transfer, 'expense').goalId).toBeNull();
    const expense = toCreateRequest(form({ goalId: GOAL }));
    expect(expense.ok && expense.body.goalId).toBeNull();
  });

  it('wartości z góry: kwota, konto docelowe i cel tylko w przelewie', () => {
    const preset = { amountMinor: 36_000, counterAccountId: HOME, goalId: GOAL };
    expect(emptyTransactionForm('transfer', TODAY, ROR, preset)).toMatchObject(preset);
    expect(emptyTransactionForm('expense', TODAY, ROR, preset)).toMatchObject({
      amountMinor: 36_000,
      counterAccountId: null,
      goalId: null,
    });
  });

  it('brak kwoty i konta: ludzkie komunikaty, nie komunikaty Zoda', () => {
    expect(toCreateRequest(form({ amountMinor: 0, accountId: null }))).toEqual({
      ok: false,
      errors: { amountMinor: 'Wpisz kwotę większą od zera', accountId: 'Wybierz konto' },
    });
  });

  it('przelew bez konta docelowego i na to samo konto', () => {
    const missing = toCreateRequest(form({ type: 'transfer' }));
    expect(!missing.ok && missing.errors.counterAccountId).toBe('Wybierz konto, na które');
    const same = toCreateRequest(form({ type: 'transfer', counterAccountId: ROR }));
    expect(!same.ok && same.errors.counterAccountId).toBe(
      'Konto docelowe musi być inne niż źródłowe',
    );
  });

  it('przychód niesie źródło, przelew — konto docelowe i wyłączenie z celów', () => {
    const income = toCreateRequest(
      form({ type: 'income', incomeSourceId: '01JS0000000000000000000001' }),
    );
    expect(income.ok && income.body.incomeSourceId).toBe('01JS0000000000000000000001');
    const transfer = toCreateRequest(
      form({ type: 'transfer', counterAccountId: HOME, allocationOverride: 'none' }),
    );
    expect(transfer.ok && transfer.body).toMatchObject({
      counterAccountId: HOME,
      categoryId: null,
      allocationOverride: 'none',
    });
  });

  it('za długi opis wraca jako błąd pola z komunikatem schematu', () => {
    const result = toCreateRequest(form({ description: 'x'.repeat(201) }));
    expect(!result.ok && result.errors.description).toBe('Tekst może mieć najwyżej 200 znaków');
  });
});

describe('toUpdateRequest', () => {
  it('bez zmian — puste ciało', () => {
    expect(toUpdateRequest(TRANSFER, transactionFormFrom(TRANSFER))).toEqual({
      ok: true,
      body: {},
    });
  });

  it('wysyła tylko zmienione pola; wyczyszczony opis jako `null`', () => {
    const state = { ...transactionFormFrom(TRANSFER), amountMinor: 150_000, description: '  ' };
    expect(toUpdateRequest(TRANSFER, state)).toEqual({
      ok: true,
      body: { amountMinor: 150_000, description: null },
    });
  });

  it('błędny stan nie daje ciała', () => {
    expect(toUpdateRequest(TRANSFER, { ...transactionFormFrom(TRANSFER), amountMinor: 0 }).ok).toBe(
      false,
    );
  });
});

describe('previewEffects — plakietka efektu (07 §2.2)', () => {
  it('ROR → oszczędności: wpłata do puli', () => {
    expect(
      previewEffects(
        form({ type: 'transfer', counterAccountId: HOME, amountMinor: 200_000 }),
        ACCOUNTS,
      ),
    ).toEqual([{ kind: 'savings', amountMinor: 200_000 }]);
  });

  it('oszczędności → maklerskie: dwie linie naraz', () => {
    expect(
      previewEffects(
        form({ type: 'transfer', accountId: HOME, counterAccountId: BROKER, amountMinor: 5_000 }),
        ACCOUNTS,
      ),
    ).toEqual([
      { kind: 'investment', amountMinor: 5_000 },
      { kind: 'savings', amountMinor: -5_000 },
    ]);
  });

  it('wyłączenie, wydatek i brakujące konto dają pustą listę', () => {
    expect(
      previewEffects(
        form({ type: 'transfer', counterAccountId: HOME, allocationOverride: 'none' }),
        ACCOUNTS,
      ),
    ).toEqual([]);
    expect(previewEffects(form(), ACCOUNTS)).toEqual([]);
    expect(previewEffects(form({ type: 'transfer' }), ACCOUNTS)).toEqual([]);
  });

  it('edycja: niezmienione konto bierze migawkę z transakcji, nie bieżącą klasę (I-6)', () => {
    // Konto mieszkaniowe przeklasyfikowane później na „wydatki".
    const reclassified = ACCOUNTS.map((item) =>
      item.id === HOME ? { ...item, allocationClass: 'spending' as const } : item,
    );
    const state = transactionFormFrom(TRANSFER);
    expect(previewEffects(state, reclassified, TRANSFER)).toEqual([
      { kind: 'savings', amountMinor: 200_000 },
    ]);
    // Zmienione konto docelowe — klasa bieżąca.
    expect(previewEffects({ ...state, counterAccountId: BROKER }, reclassified, TRANSFER)).toEqual([
      { kind: 'investment', amountMinor: 200_000 },
    ]);
  });

  it('wyłącznik ma sens tylko, gdy przelew rusza pulę (I-7)', () => {
    expect(
      transferCanAffectGoals(form({ type: 'transfer', counterAccountId: CASH }), ACCOUNTS),
    ).toBe(false);
    expect(
      transferCanAffectGoals(
        form({
          type: 'transfer',
          counterAccountId: HOME,
          allocationOverride: 'none',
          amountMinor: 0,
        }),
        ACCOUNTS,
      ),
    ).toBe(true);
  });
});

describe('daty', () => {
  it('addDays przechodzi przez granice miesiąca i roku, także w przestępnym lutym', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-01-01', -2)).toBe('2025-12-30');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // zmiana czasu w Polsce
  });

  it('skróty tylko w oknie księgowania', () => {
    expect(dateShortcuts(TODAY, '2026-08-01').map((s) => s.date)).toEqual([
      '2026-09-23',
      '2026-09-22',
      '2026-09-21',
    ]);
    expect(dateShortcuts('2026-09-01', '2026-09-01').map((s) => s.label)).toEqual(['Dziś']);
  });

  it('okno z ustawień gospodarstwa (I-8)', () => {
    expect(postingBounds(TODAY, 1, 1)).toEqual({ min: '2026-08-01', max: '2026-09-30' });
    expect(postingBounds(TODAY, 0, 1)).toEqual({ min: '2026-09-01', max: '2026-09-30' });
  });

  it('etykieta daty', () => {
    expect(dateLabel(TODAY, TODAY)).toBe('dziś, 23 września');
    expect(dateLabel('2026-09-22', TODAY)).toBe('wczoraj, 22 września');
    expect(dateLabel('2026-09-21', TODAY)).toBe('przedwczoraj, 21 września');
    expect(dateLabel('2026-08-05', TODAY)).toBe('5 sierpnia 2026');
  });
});

describe('formErrorsFromApi', () => {
  it('przepisuje znane pola, pomija resztę', () => {
    expect(
      formErrorsFromApi({ bookedOn: 'Poza oknem', counterAccountId: 'Zarchiwizowane', foo: 'x' }),
    ).toEqual({ bookedOn: 'Poza oknem', counterAccountId: 'Zarchiwizowane' });
  });
});
