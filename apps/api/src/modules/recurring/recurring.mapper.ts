import {
  allocationEffects,
  type OccurrenceStatus,
  type RecurringOccurrenceDto,
  type RecurringRuleDto,
} from '@fineapp/shared';

import type { RecurringRuleRow } from '../../db/schema/recurring.js';
import type { RuleWithRefs } from './recurring.repository.js';

/**
 * Mapowanie wierszy reguł na DTO — pole po polu, bez `...row` (02 §8).
 */

/**
 * Zamienia wiersz reguły na DTO.
 *
 * `nextDueOn` nie jest kolumną: wynika z terminarza i dzisiejszej daty, więc liczy go
 * serwis przy każdym odczycie.
 *
 * @param row - Wiersz z bazy.
 * @param nextDueOn - Najbliższy termin albo `null`.
 * @returns Reguła w kształcie kontraktu.
 */
export function toRecurringRuleDto(
  row: RecurringRuleRow,
  nextDueOn: string | null,
): RecurringRuleDto {
  return {
    id: row.id,
    name: row.name,
    flow: row.flow,
    amountMinor: row.amountMinor,
    amountIsEstimate: row.amountIsEstimate,
    currency: row.currency,
    accountId: row.accountId,
    counterAccountId: row.counterAccountId,
    categoryId: row.categoryId,
    incomeSourceId: row.incomeSourceId,
    goalId: row.goalId,
    liabilityId: row.liabilityId,
    allocationOverride: row.allocationOverride,
    frequency: row.frequency,
    intervalCount: row.intervalCount,
    dayOfMonth: row.dayOfMonth,
    weekday: row.weekday,
    monthOfYear: row.monthOfYear,
    anchorDate: row.anchorDate,
    startMonth: row.startMonth,
    endMonth: row.endMonth,
    autoPost: row.autoPost,
    isFixedExpense: row.isFixedExpense,
    isActive: row.isActive,
    notes: row.notes,
    nextDueOn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Pola wystąpienia — z wiersza bazy albo wyliczone dla podglądu przyszłości. */
export interface OccurrenceFields {
  /** `null` dla podglądu — wystąpienia nie ma w bazie. */
  readonly id: string | null;
  readonly dueOn: string;
  readonly monthKey: string;
  readonly plannedAmountMinor: number;
  readonly status: OccurrenceStatus;
  readonly postedAmountMinor: number | null;
  readonly transactionId: string | null;
}

/**
 * Składa DTO wystąpienia z pól wystąpienia i jego reguły.
 *
 * Przewidywany efekt alokacji liczy ta sama funkcja co efekt transakcji
 * (`allocationEffects`), z klasami **bieżących** kont reguły — tak zaksięgowałaby się
 * transakcja utworzona teraz. Kwota: zaksięgowana, jeśli jest, inaczej planowana.
 *
 * @param fields - Pola wystąpienia.
 * @param ref - Reguła z nazwą kategorii i klasami kont.
 * @param isOverdue - Czy termin minął, a wystąpienie czeka (liczy serwis z „dziś").
 * @returns Wystąpienie w kształcie kontraktu.
 */
export function toOccurrenceDto(
  fields: OccurrenceFields,
  ref: RuleWithRefs,
  isOverdue: boolean,
): RecurringOccurrenceDto {
  const { rule } = ref;
  const isTransfer = rule.flow === 'transfer';
  return {
    id: fields.id,
    ruleId: rule.id,
    ruleName: rule.name,
    flow: rule.flow,
    dueOn: fields.dueOn,
    monthKey: fields.monthKey,
    plannedAmountMinor: fields.plannedAmountMinor,
    status: fields.status,
    postedAmountMinor: fields.postedAmountMinor,
    transactionId: fields.transactionId,
    categoryId: rule.categoryId,
    categoryName: ref.categoryName,
    allocationEffects: allocationEffects({
      type: rule.flow,
      amountMinor: fields.postedAmountMinor ?? fields.plannedAmountMinor,
      sourceAllocationClass: isTransfer ? ref.sourceClass : null,
      targetAllocationClass: isTransfer ? ref.targetClass : null,
      allocationOverride: rule.allocationOverride,
      liabilityId: rule.liabilityId,
    }),
    isFixedExpense: rule.isFixedExpense,
    isOverdue,
    amountIsEstimate: rule.amountIsEstimate,
  };
}
