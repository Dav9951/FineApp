import type { RecurringRuleDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  emptyRecurringForm,
  formErrorsFromRequest,
  previewDueDates,
  recurringFormFrom,
  suggestsPlannedExpense,
  switchFlow,
  toCreateRequest,
  toUpdateRequest,
  type RecurringFormState,
} from './recurring-form-state.js';

/**
 * Testy formularza reguły cyklicznej
 * ([06 §3.9](../../../../../plans/06-ui-views.md#39-pozycje-cykliczne--recurring), ADR-043).
 */

const ROR = '01J9ZQK8WQ0000000000000000';
const SAVINGS = '01J9ZQK8WQ0000000000000001';
const RENT = '01J9ZQK8WQ0000000000000002';
const TODAY = '2026-09-23';

/**
 * Wypełniony formularz czynszu.
 *
 * @param overrides - Nadpisane pola.
 * @returns Stan.
 */
function filled(overrides: Partial<RecurringFormState> = {}): RecurringFormState {
  return {
    ...emptyRecurringForm('expense', TODAY, ROR),
    name: 'Czynsz',
    amountMinor: 185_000,
    categoryId: RENT,
    dayOfMonthText: '10',
    ...overrides,
  };
}

/** Reguła czynszu tak, jak przychodzi z API. */
const RULE: RecurringRuleDto = {
  id: ROR,
  name: 'Czynsz',
  flow: 'expense',
  amountMinor: 185_000,
  amountIsEstimate: false,
  currency: 'PLN',
  accountId: ROR,
  counterAccountId: null,
  categoryId: RENT,
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
  createdAt: 0,
  updatedAt: 0,
};

describe('emptyRecurringForm', () => {
  it('podpowiada terminarz z dziś: co miesiąc, dzisiejszego dnia, od tego miesiąca', () => {
    expect(emptyRecurringForm('expense', TODAY, ROR)).toMatchObject({
      frequency: 'monthly',
      dayOfMonthText: '23',
      weekday: 3,
      monthOfYear: 9,
      startMonth: '2026-09',
      isFixedExpense: true,
      accountId: ROR,
    });
    expect(emptyRecurringForm('income', TODAY, null).isFixedExpense).toBe(false);
  });
});

describe('switchFlow', () => {
  it('czyści pola, które do nowego rodzaju nie pasują', () => {
    const switched = switchFlow(filled({ incomeSourceId: SAVINGS }), 'transfer');
    expect(switched).toMatchObject({
      flow: 'transfer',
      categoryId: null,
      incomeSourceId: null,
      isFixedExpense: false,
    });
  });
});

describe('toCreateRequest', () => {
  it('czynsz miesięczny: ciało bez pól tygodniowych', () => {
    const result = toCreateRequest(filled());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      flow: 'expense',
      amountMinor: 185_000,
      accountId: ROR,
      categoryId: RENT,
      dayOfMonth: 10,
      weekday: null,
      monthOfYear: null,
      endMonth: null,
      isFixedExpense: true,
    });
  });

  it('te same błędy co serwer: przelew bez konta docelowego, pusta nazwa, kwota zero', () => {
    const result = toCreateRequest(
      filled({ flow: 'transfer', name: ' ', amountMinor: 0, categoryId: null }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject({
      counterAccountId: expect.any(String) as string,
      name: 'Nazwa jest wymagana',
      amountMinor: expect.any(String) as string,
    });
  });

  it('dzień spoza 1–31, odstęp i brak konta — własne komunikaty', () => {
    const result = toCreateRequest(
      filled({
        dayOfMonthText: '32',
        frequency: 'every_n_months',
        intervalText: 'x',
        accountId: null,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject({
      dayOfMonthText: 'Dzień miesiąca od 1 do 31',
      intervalText: 'Wpisz liczbę miesięcy',
      accountId: 'Wybierz konto',
    });
  });

  it('co 1 miesiąc przy „co N" — błąd terminarza z shared', () => {
    const result = toCreateRequest(filled({ frequency: 'every_n_months', intervalText: '1' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.intervalText).toBeDefined();
  });

  it('koniec przed startem — błąd przy polu końca', () => {
    const result = toCreateRequest(filled({ endMonth: '2026-08' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.endMonth).toBeDefined();
  });

  it('wydatek stały tylko przy wydatku', () => {
    const result = toCreateRequest(
      filled({ flow: 'income', isFixedExpense: true, categoryId: null }),
    );
    expect(result.ok && result.body.isFixedExpense).toBe(false);
  });
});

describe('toUpdateRequest', () => {
  it('bez zmian — puste ciało', () => {
    const result = toUpdateRequest(RULE, recurringFormFrom(RULE, TODAY));
    expect(result.ok && result.body).toEqual({});
  });

  it('tylko zmienione pola, porównane po normalizacji', () => {
    const state = {
      ...recurringFormFrom(RULE, TODAY),
      amountMinor: 190_000,
      frequency: 'weekly' as const,
      weekday: 1,
    };
    const result = toUpdateRequest(RULE, state);
    expect(result.ok && result.body).toEqual({
      amountMinor: 190_000,
      frequency: 'weekly',
      dayOfMonth: null,
      weekday: 1,
    });
  });

  it('wyczyszczona notatka i koniec ustawiony', () => {
    const state = {
      ...recurringFormFrom({ ...RULE, notes: 'stara' }, TODAY),
      notes: '',
      endMonth: '2027-06',
    };
    const result = toUpdateRequest({ ...RULE, notes: 'stara' }, state);
    expect(result.ok && result.body).toEqual({ notes: null, endMonth: '2027-06' });
  });
});

describe('previewDueDates', () => {
  it('trzy najbliższe terminy od dziś; 31. przycięte', () => {
    expect(previewDueDates(filled(), TODAY)).toEqual(['2026-10-10', '2026-11-10', '2026-12-10']);
    expect(previewDueDates(filled({ dayOfMonthText: '31' }), TODAY)).toEqual([
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
    ]);
  });

  it('formularz niepoprawny — brak podglądu', () => {
    expect(previewDueDates(filled({ dayOfMonthText: '' }), TODAY)).toEqual([]);
  });

  it('co dwa tygodnie z kotwicą edytowanej reguły', () => {
    const state = filled({ frequency: 'biweekly', weekday: 5 });
    // Kotwica piątek 2 października — terminy co 14 dni od niej, nie od pierwszego piątku.
    expect(previewDueDates(state, TODAY, '2026-10-02')).toEqual([
      '2026-10-02',
      '2026-10-16',
      '2026-10-30',
    ]);
  });
});

describe('formErrorsFromRequest', () => {
  it('mapuje pola żądania na pola formularza', () => {
    expect(
      formErrorsFromRequest({
        dayOfMonth: 'a',
        intervalCount: 'b',
        anchorDate: 'c',
        accountId: 'd',
        nieznane: 'e',
      }),
    ).toEqual({ dayOfMonthText: 'a', intervalText: 'b', weekday: 'c', accountId: 'd' });
  });
});

describe('suggestsPlannedExpense (F6-9)', () => {
  it('tylko nowy roczny wydatek', () => {
    expect(suggestsPlannedExpense({ flow: 'expense', frequency: 'yearly' }, true)).toBe(true);
    expect(suggestsPlannedExpense({ flow: 'expense', frequency: 'yearly' }, false)).toBe(false);
    expect(suggestsPlannedExpense({ flow: 'income', frequency: 'yearly' }, true)).toBe(false);
    expect(suggestsPlannedExpense({ flow: 'expense', frequency: 'monthly' }, true)).toBe(false);
  });
});
