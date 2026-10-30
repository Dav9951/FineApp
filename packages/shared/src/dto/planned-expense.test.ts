import { describe, expect, it } from 'vitest';

import {
  CreatePlannedExpenseRequestSchema,
  ListPlannedExpensesQuerySchema,
  PlannedExpenseFieldsSchema,
  UpcomingPlannedExpensesQuerySchema,
  UpdatePlannedExpenseRequestSchema,
} from './planned-expense.js';

/**
 * Testy kontraktów planowanych wydatków
 * ([05 §11a](../../../../plans/05-dto-contracts.md#11a-planowane-wydatki--dtoplanned-expensedtots)).
 */

const OC = { name: 'OC + AC', estimatedAmountMinor: 240_000, dueMonth: '2027-03' } as const;

describe('PlannedExpenseFieldsSchema', () => {
  it('wartości domyślne; pusta notatka to brak', () => {
    expect(PlannedExpenseFieldsSchema.parse({ ...OC, notes: '' })).toMatchObject({
      amountIsEstimate: true,
      priority: 'should',
      setAsideEnabled: false,
      alreadySetAsideMinor: 0,
      repeatsYearly: false,
      notes: null,
    });
  });

  it('bez walidacji krzyżowej — formularz ją ma', () => {
    const body = { ...OC, setAsideEnabled: true };
    expect(PlannedExpenseFieldsSchema.safeParse(body).success).toBe(true);
    expect(CreatePlannedExpenseRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('UpdatePlannedExpenseRequestSchema', () => {
  it('bez wartości domyślnych', () => {
    expect(UpdatePlannedExpenseRequestSchema.parse({ name: 'OC' })).toEqual({ name: 'OC' });
  });
});

describe('zapytania', () => {
  it('status pojedynczy albo wiele; horyzont 1–24, domyślnie 6', () => {
    expect(ListPlannedExpensesQuerySchema.parse({ status: 'ready' }).status).toEqual(['ready']);
    expect(
      ListPlannedExpensesQuerySchema.parse({ status: ['ready', 'posted'] }).status,
    ).toHaveLength(2);
    expect(UpcomingPlannedExpensesQuerySchema.parse({}).months).toBe(6);
    expect(UpcomingPlannedExpensesQuerySchema.safeParse({ months: '25' }).success).toBe(false);
  });
});
