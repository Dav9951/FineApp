import { describe, expect, it } from 'vitest';

import {
  CreateRecurringRuleRequestSchema,
  GenerateOccurrencesRequestSchema,
  ListOccurrencesQuerySchema,
  ListRecurringRulesQuerySchema,
  PostOccurrenceRequestSchema,
  RecurringOccurrenceDtoSchema,
  SkipOccurrenceRequestSchema,
  recurringNameFromTransaction,
  recurringRuleFromRequest,
  recurringRuleFromTransaction,
  RecurringRuleFieldsSchema,
  SaveAsRecurringRequestSchema,
  UpdateRecurringRuleRequestSchema,
  type RecurringSourceTransaction,
} from './recurring.js';

/**
 * Testy kontraktów reguł cyklicznych
 * ([05 §11](../../../../plans/05-dto-contracts.md#11-pozycje-cykliczne--dtorecurringdtots)).
 */

const ROR = '01J9ZQK8WQ0000000000000000';
const IKE = '01J9ZQK8WQ0000000000000001';

/** Przykład z 04 §9. */
const IKE_TRANSFER = {
  name: 'Wpłata na IKE',
  flow: 'transfer',
  amountMinor: 100_000,
  amountIsEstimate: false,
  accountId: ROR,
  counterAccountId: IKE,
  allocationOverride: null,
  frequency: 'monthly',
  dayOfMonth: 5,
  startMonth: '2026-10',
  endMonth: null,
  autoPost: true,
  isFixedExpense: false,
} as const;

describe('RecurringRuleFieldsSchema', () => {
  it('przyjmuje przykład z 04 §9 i uzupełnia wartości domyślne', () => {
    const parsed = RecurringRuleFieldsSchema.parse({ ...IKE_TRANSFER, name: '  Wpłata na IKE ' });
    expect(parsed).toMatchObject({ name: 'Wpłata na IKE', intervalCount: 1 });
  });

  it('bez walidacji krzyżowej — przelew bez konta docelowego przechodzi (422 z serwisu)', () => {
    const { counterAccountId: _omit, ...withoutTarget } = IKE_TRANSFER;
    expect(RecurringRuleFieldsSchema.safeParse(withoutTarget).success).toBe(true);
  });

  it('odrzuca kwotę zero, pustą nazwę i dzień 32', () => {
    expect(RecurringRuleFieldsSchema.safeParse({ ...IKE_TRANSFER, amountMinor: 0 }).success).toBe(
      false,
    );
    expect(RecurringRuleFieldsSchema.safeParse({ ...IKE_TRANSFER, name: ' ' }).success).toBe(false);
    expect(RecurringRuleFieldsSchema.safeParse({ ...IKE_TRANSFER, dayOfMonth: 32 }).success).toBe(
      false,
    );
  });
});

describe('CreateRecurringRuleRequestSchema', () => {
  it('formularz dostaje te same błędy co serwis', () => {
    const result = CreateRecurringRuleRequestSchema.safeParse({
      ...IKE_TRANSFER,
      counterAccountId: null,
      dayOfMonth: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual([
        'counterAccountId',
        'dayOfMonth',
      ]);
    }
  });
});

describe('recurringRuleFromRequest', () => {
  it('co dwa tygodnie bez kotwicy — pierwszy piątek miesiąca startu; pola bez znaczenia wyczyszczone', () => {
    const rule = recurringRuleFromRequest(
      RecurringRuleFieldsSchema.parse({
        ...IKE_TRANSFER,
        frequency: 'biweekly',
        weekday: 5,
      }),
    );
    expect(rule).toMatchObject({
      anchorDate: '2026-10-02',
      dayOfMonth: null,
      weekday: 5,
      goalId: null,
      notes: null,
    });
  });
});

describe('UpdateRecurringRuleRequestSchema', () => {
  it('bez `flow` i bez wartości domyślnych — puste ciało nic nie zmienia', () => {
    expect(UpdateRecurringRuleRequestSchema.parse({})).toEqual({});
    expect(UpdateRecurringRuleRequestSchema.parse({ flow: 'income' })).toEqual({});
  });
});

describe('ListRecurringRulesQuerySchema', () => {
  it('flagi tylko jako literały; pominięte — bez filtra', () => {
    expect(ListRecurringRulesQuerySchema.parse({})).toEqual({
      isFixedExpense: undefined,
      isActive: undefined,
    });
    expect(ListRecurringRulesQuerySchema.parse({ isActive: 'false' }).isActive).toBe(false);
    expect(ListRecurringRulesQuerySchema.safeParse({ isActive: '0' }).success).toBe(false);
  });
});

describe('RecurringOccurrenceDtoSchema', () => {
  /** Wystąpienie zapisane w bazie. */
  const STORED = {
    id: IKE,
    ruleId: ROR,
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
    isOverdue: false,
    amountIsEstimate: false,
  } as const;

  it('przyjmuje wystąpienie z bazy i podgląd przyszłości bez identyfikatora', () => {
    expect(RecurringOccurrenceDtoSchema.safeParse(STORED).success).toBe(true);
    expect(RecurringOccurrenceDtoSchema.safeParse({ ...STORED, id: null }).success).toBe(true);
  });

  it('kwota planowana musi być dodatnia', () => {
    expect(
      RecurringOccurrenceDtoSchema.safeParse({ ...STORED, plannedAmountMinor: 0 }).success,
    ).toBe(false);
  });
});

describe('ListOccurrencesQuerySchema i GenerateOccurrencesRequestSchema', () => {
  it('miesiąc wymagany i poprawny', () => {
    expect(ListOccurrencesQuerySchema.safeParse({ month: '2026-09' }).success).toBe(true);
    expect(ListOccurrencesQuerySchema.safeParse({}).success).toBe(false);
    expect(GenerateOccurrencesRequestSchema.safeParse({ month: '2026-9' }).success).toBe(false);
  });
});

describe('PostOccurrenceRequestSchema', () => {
  it('puste ciało — księgowanie jak w planie', () => {
    expect(PostOccurrenceRequestSchema.parse({})).toEqual({});
  });

  it('kwota dodatnia, pusta notatka jako brak', () => {
    expect(PostOccurrenceRequestSchema.safeParse({ amountMinor: 0 }).success).toBe(false);
    expect(PostOccurrenceRequestSchema.parse({ notes: '  ' }).notes).toBeNull();
  });
});

describe('SkipOccurrenceRequestSchema', () => {
  it('powód przycięty, pusty jako brak, najwyżej 200 znaków', () => {
    expect(SkipOccurrenceRequestSchema.parse({ reason: ' urlop ' }).reason).toBe('urlop');
    expect(SkipOccurrenceRequestSchema.parse({ reason: '' }).reason).toBeNull();
    expect(SkipOccurrenceRequestSchema.safeParse({ reason: 'x'.repeat(201) }).success).toBe(false);
  });
});

/** Czynsz zapłacony 10 września 2026 (czwartek). */
const RENT_PAYMENT: RecurringSourceTransaction = {
  type: 'expense',
  amountMinor: 185_000,
  bookedOn: '2026-09-10',
  monthKey: '2026-09',
  accountId: ROR,
  counterAccountId: null,
  categoryId: null,
  incomeSourceId: null,
  goalId: null,
  liabilityId: null,
  allocationOverride: null,
  description: 'Czynsz',
  merchant: null,
};

describe('SaveAsRecurringRequestSchema', () => {
  it('puste ciało — co miesiąc, bez automatu', () => {
    expect(SaveAsRecurringRequestSchema.parse({})).toEqual({
      frequency: 'monthly',
      intervalCount: 1,
      amountIsEstimate: false,
      autoPost: false,
    });
  });

  it('nie przyjmuje kwoty ani kont — pochodzą z transakcji', () => {
    const parsed = SaveAsRecurringRequestSchema.parse({ amountMinor: 1, accountId: IKE });
    expect(parsed).not.toHaveProperty('amountMinor');
    expect(parsed).not.toHaveProperty('accountId');
  });
});

describe('recurringNameFromTransaction', () => {
  it('opis, potem zobowiązanie, sprzedawca, kategoria, źródło', () => {
    expect(recurringNameFromTransaction(RENT_PAYMENT)).toBe('Czynsz');
    const bare = { ...RENT_PAYMENT, description: '  ' };
    expect(
      recurringNameFromTransaction({ ...bare, liabilityName: 'Kredyt', merchant: 'Bank' }),
    ).toBe('Kredyt');
    expect(recurringNameFromTransaction({ ...bare, merchant: 'Netflix' })).toBe('Netflix');
    expect(recurringNameFromTransaction({ ...bare, categoryName: 'Mieszkanie' })).toBe(
      'Mieszkanie',
    );
    expect(
      recurringNameFromTransaction({ ...bare, type: 'income', incomeSourceName: 'Pensja' }),
    ).toBe('Pensja');
  });

  it('bez niczego — nazwa z rodzaju; długi opis przycięty do 60 znaków', () => {
    expect(recurringNameFromTransaction({ ...RENT_PAYMENT, description: null })).toBe(
      'Wydatek stały',
    );
    expect(
      recurringNameFromTransaction({ ...RENT_PAYMENT, type: 'transfer', description: null }),
    ).toBe('Stały przelew');
    expect(
      recurringNameFromTransaction({ ...RENT_PAYMENT, description: 'x'.repeat(200) }),
    ).toHaveLength(60);
  });
});

describe('recurringRuleFromTransaction', () => {
  it('domyślnie: co miesiąc, dnia transakcji, od jej miesiąca, wydatek stały', () => {
    const rule = recurringRuleFromTransaction(RENT_PAYMENT, SaveAsRecurringRequestSchema.parse({}));
    expect(rule).toMatchObject({
      name: 'Czynsz',
      flow: 'expense',
      amountMinor: 185_000,
      accountId: ROR,
      frequency: 'monthly',
      dayOfMonth: 10,
      startMonth: '2026-09',
      endMonth: null,
      isFixedExpense: true,
    });
    expect(CreateRecurringRuleRequestSchema.safeParse(rule).success).toBe(true);
  });

  it('terminarz z żądania wygrywa z datą transakcji', () => {
    const rule = recurringRuleFromTransaction(
      RENT_PAYMENT,
      SaveAsRecurringRequestSchema.parse({ dayOfMonth: 31, startMonth: '2026-10', name: 'Najem' }),
    );
    expect(rule).toMatchObject({ name: 'Najem', dayOfMonth: 31, startMonth: '2026-10' });
  });

  it('co 2 tygodnie — kotwica w dniu transakcji, gdy dzień tygodnia się zgadza', () => {
    const biweekly = SaveAsRecurringRequestSchema.parse({ frequency: 'biweekly' });
    const rule = recurringRuleFromRequest(recurringRuleFromTransaction(RENT_PAYMENT, biweekly));
    expect(rule).toMatchObject({ weekday: 4, anchorDate: '2026-09-10', dayOfMonth: null });

    const monday = SaveAsRecurringRequestSchema.parse({ frequency: 'biweekly', weekday: 1 });
    expect(
      recurringRuleFromRequest(recurringRuleFromTransaction(RENT_PAYMENT, monday)),
    ).toMatchObject({ weekday: 1, anchorDate: '2026-09-07' });
  });

  it('co roku — miesiąc z daty; przychód nie jest wydatkiem stałym', () => {
    const rule = recurringRuleFromTransaction(
      { ...RENT_PAYMENT, type: 'income', description: 'Premia roczna' },
      SaveAsRecurringRequestSchema.parse({ frequency: 'yearly' }),
    );
    expect(rule).toMatchObject({ monthOfYear: 9, dayOfMonth: 10, isFixedExpense: false });
  });
});
