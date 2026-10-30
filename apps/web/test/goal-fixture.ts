import type { AllocationStatusDto, GoalDto } from '@fineapp/shared';

/**
 * Dane testowe celów i rozkładu — wspólne dla testów reguł i ekranów (`F5-5`…`F5-8`).
 *
 * Wartości z przykładów 04 §10 i §11: wkład własny 42 000 z 120 000 zł, plan 2 000 zł
 * z wpływów 11 800 zł, rozkład 20% / 10%.
 */

/** Identyfikator celu „Wkład własny". */
export const GOAL_ID = '01JG0000000000000000000001';

/**
 * Cel z postępem — domyślnie „Wkład własny" z 04 §10, plan wykonany we wrześniu.
 *
 * @param overrides - Nadpisane pola.
 * @returns Cel.
 */
export function goalFixture(overrides: Partial<GoalDto> = {}): GoalDto {
  return {
    id: GOAL_ID,
    name: 'Wkład własny',
    kind: 'savings',
    purpose: 'down_payment',
    targetAmountMinor: 12_000_000,
    targetDate: '2028-06-30',
    startingAmountMinor: 4_000_000,
    linkedAccountId: null,
    progressSource: 'contributions',
    contributionAmountMinor: 200_000,
    contributionPercentBps: null,
    currentAmountMinor: 4_200_000,
    progressBps: 3500,
    remainingMinor: 7_800_000,
    contribution: {
      mode: 'fixed',
      plannedAmountMinor: 200_000,
      plannedPercentBps: 1695,
      contributedThisMonthMinor: 200_000,
      isPlanMetThisMonth: true,
    },
    projection: {
      paceMonthlyMinor: 200_000,
      monthsToTargetAtCurrentPace: 39,
      projectedCompletionMonth: '2029-12',
      requiredMonthlyToHitTargetDateMinor: 371_429,
      isOnTrack: false,
    },
    priority: 0,
    color: null,
    icon: null,
    status: 'active',
    achievedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/**
 * Stan rozkładu września z 04 §11: 2 000 z 2 360 w oszczędnościach, inwestycje wykonane.
 *
 * @param overrides - Nadpisane pola.
 * @returns Stan rozkładu.
 */
export function allocationFixture(
  overrides: Partial<AllocationStatusDto> = {},
): AllocationStatusDto {
  return {
    month: '2026-09',
    effectiveFromMonth: '2026-09',
    incomeBaseMinor: 1_180_000,
    isPartialMonth: true,
    daysElapsed: 20,
    daysInMonth: 30,
    lines: [
      {
        kind: 'savings',
        targetPercentBps: 2000,
        targetAmountMinor: 236_000,
        actualAmountMinor: 200_000,
        actualPercentBps: 1695,
        deltaAmountMinor: -36_000,
        deltaPercentBps: -305,
        fulfillmentBps: 8475,
        status: 'on_track',
      },
      {
        kind: 'investment',
        targetPercentBps: 1000,
        targetAmountMinor: 118_000,
        actualAmountMinor: 118_000,
        actualPercentBps: 1000,
        deltaAmountMinor: 0,
        deltaPercentBps: 0,
        fulfillmentBps: 10_000,
        status: 'met',
      },
    ],
    totals: {
      targetPercentBps: 3000,
      actualPercentBps: 2695,
      targetAmountMinor: 354_000,
      actualAmountMinor: 318_000,
      shortfallMinor: 36_000,
    },
    ...overrides,
  };
}
