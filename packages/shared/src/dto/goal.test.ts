import { describe, expect, it } from 'vitest';

import {
  ConvertContributionRequestSchema,
  CreateGoalRequestSchema,
  GoalFieldsSchema,
  ListGoalsQuerySchema,
  UpdateGoalRequestSchema,
} from './goal.js';

/**
 * Testy kontraktów celów
 * ([05 §9](../../../../plans/05-dto-contracts.md#9-cele--dtogoaldtots), ADR-052).
 */

/** Wkład własny z 04 §10. */
const DOWN_PAYMENT = {
  name: 'Wkład własny',
  kind: 'savings',
  contributionAmountMinor: 200_000,
} as const;

describe('GoalFieldsSchema', () => {
  it('uzupełnia wartości domyślne', () => {
    expect(GoalFieldsSchema.parse(DOWN_PAYMENT)).toMatchObject({
      startingAmountMinor: 0,
      progressSource: 'contributions',
      contributionMode: 'fixed',
    });
  });

  it('pusta ikona to brak, przycięta ikona zostaje', () => {
    expect(GoalFieldsSchema.parse({ ...DOWN_PAYMENT, icon: '' }).icon).toBeNull();
    expect(UpdateGoalRequestSchema.parse({ icon: ' home ' }).icon).toBe('home');
  });

  it('bez walidacji krzyżowej — tryb procentowy bez procentu przechodzi (422 z serwisu)', () => {
    expect(
      GoalFieldsSchema.safeParse({ ...DOWN_PAYMENT, contributionMode: 'percent_of_income' })
        .success,
    ).toBe(true);
  });

  it('odrzuca nieznane przeznaczenie, ujemną kwotę początkową i pustą nazwę', () => {
    expect(GoalFieldsSchema.safeParse({ ...DOWN_PAYMENT, purpose: 'yacht' }).success).toBe(false);
    expect(GoalFieldsSchema.safeParse({ ...DOWN_PAYMENT, startingAmountMinor: -1 }).success).toBe(
      false,
    );
    expect(GoalFieldsSchema.safeParse({ ...DOWN_PAYMENT, name: '  ' }).success).toBe(false);
  });
});

describe('CreateGoalRequestSchema (I-14)', () => {
  it('podświetla pole zgodne z trybem', () => {
    const result = CreateGoalRequestSchema.safeParse({
      ...DOWN_PAYMENT,
      contributionMode: 'percent_of_income',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'contributionPercentBps',
    ]);
  });
});

describe('UpdateGoalRequestSchema', () => {
  it('bez wartości domyślnych — pominięte pole zostaje nietknięte', () => {
    expect(UpdateGoalRequestSchema.parse({ name: 'Mieszkanie' })).toEqual({ name: 'Mieszkanie' });
  });

  it('status „achieved" nie jest do ustawienia edycją', () => {
    expect(UpdateGoalRequestSchema.safeParse({ status: 'achieved' }).success).toBe(false);
    expect(UpdateGoalRequestSchema.safeParse({ status: 'archived' }).success).toBe(true);
  });
});

describe('ListGoalsQuerySchema', () => {
  it('flaga tylko z dwóch literałów', () => {
    expect(ListGoalsQuerySchema.parse({ includeArchived: 'false' }).includeArchived).toBe(false);
    expect(ListGoalsQuerySchema.safeParse({ includeArchived: '1' }).success).toBe(false);
    expect(ListGoalsQuerySchema.parse({}).includeArchived).toBeUndefined();
  });
});

describe('ConvertContributionRequestSchema', () => {
  it('dokładnie jedno: kwota albo procent', () => {
    expect(
      ConvertContributionRequestSchema.safeParse({ month: '2026-09', amountMinor: 200_000 })
        .success,
    ).toBe(true);
    expect(
      ConvertContributionRequestSchema.safeParse({ month: '2026-09', percentBps: 2000 }).success,
    ).toBe(true);
    expect(ConvertContributionRequestSchema.safeParse({ month: '2026-09' }).success).toBe(false);
    expect(
      ConvertContributionRequestSchema.safeParse({
        month: '2026-09',
        amountMinor: 1,
        percentBps: 1,
      }).success,
    ).toBe(false);
  });
});
