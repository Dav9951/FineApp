import type { PlannedExpenseDto, PlannedExpenseStatus, SetAsideState } from '@fineapp/shared';

import type { PlannedExpenseRow } from '../../db/schema/planned-expenses.js';

/** Wyliczenia serwisu do DTO — stan odkładania, status i miesiące. */
export interface PlannedExpenseComputed {
  readonly state: SetAsideState;
  readonly status: PlannedExpenseStatus;
  readonly startMonth: string;
  readonly monthsLeft: number;
  readonly monthsUntilDue: number;
  readonly categoryName: string | null;
}

/**
 * Mapowanie wiersza planowanego wydatku na DTO — jedyne miejsce, gdzie `snake_case`
 * z bazy spotyka `camelCase` kontraktu (02 §4). Stan odkładania liczy serwis.
 *
 * @param row - Wiersz wydatku.
 * @param computed - Wyliczenia serwisu.
 * @returns DTO.
 */
export function toPlannedExpenseDto(
  row: PlannedExpenseRow,
  computed: PlannedExpenseComputed,
): PlannedExpenseDto {
  const { state } = computed;
  return {
    id: row.id,
    name: row.name,
    estimatedAmountMinor: row.estimatedAmountMinor,
    amountIsEstimate: row.amountIsEstimate,
    currency: row.currency,
    dueMonth: row.dueMonth,
    dueOn: row.dueOn,
    monthsUntilDue: computed.monthsUntilDue,
    categoryId: row.categoryId,
    categoryName: computed.categoryName,
    accountId: row.accountId,
    liabilityId: row.liabilityId,
    priority: row.priority,
    status: computed.status,
    setAside: {
      enabled: row.setAsideEnabled,
      accountId: row.setAsideAccountId,
      goalId: row.setAsideGoalId,
      startMonth: computed.startMonth,
      accumulatedMinor: state.accumulatedMinor,
      remainingMinor: state.remainingMinor,
      coverageBps: state.coverageBps,
      monthlyRequiredMinor: state.monthlyRequiredMinor,
      monthsLeft: computed.monthsLeft,
      paidThisMonth: state.paidThisMonth,
      isOnTrack: state.isOnTrack,
    },
    alreadySetAsideMinor: row.alreadySetAsideMinor,
    repeatsYearly: row.repeatsYearly,
    previousInstanceId: row.previousInstanceId,
    transactionId: row.transactionId,
    postedAmountMinor: row.postedAmountMinor,
    postedAt: row.postedAt,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
