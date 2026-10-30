import {
  budgetPromoteTargets,
  budgetSourceStatus,
  canApplyBudgetLineToSource,
  type BudgetGroupDto,
  type BudgetLineDto,
  type BudgetSourceLine,
  type ContributionMode,
} from '@fineapp/shared';

import type { BudgetDraftGroupRow, BudgetDraftLineRow } from '../../db/schema/budget.js';

/**
 * Mapowanie linii i grup szkicu na DTO (05 §13b) — wyłącznie tutaj kolumny bazy przechodzą
 * w pola kontraktu (`CLAUDE.md`, „Język").
 */

/** Kontekst potrzebny do pól wyliczanych linii. */
export interface LineMappingContext {
  /** Szkic edytowalny — tylko wtedy liczy się stan źródła i dostępne akcje (07 §13.1). */
  readonly editable: boolean;
  /** Linie proponowane teraz przez źródła, po kluczu (`buildBudgetSourceLines`). */
  readonly sourceLines: ReadonlyMap<string, BudgetSourceLine>;
  readonly categoryNames: ReadonlyMap<string, string>;
  /** Reguły będące regułą raty zobowiązania — „Zastosuj" dla nich jest zabronione. */
  readonly liabilityRuleIds: ReadonlySet<string>;
  /** Reguły tygodniowe i co dwa tygodnie — linia niesie sumę terminów (07 §13.7). */
  readonly weeklyRuleIds: ReadonlySet<string>;
  readonly goalModes: ReadonlyMap<string, ContributionMode>;
}

/**
 * Linia szkicu w kształcie kontraktu.
 *
 * @param row - Wiersz `budget_draft_lines`.
 * @param context - Źródła i słowniki.
 * @returns DTO linii.
 */
export function toBudgetLineDto(
  row: BudgetDraftLineRow,
  context: LineMappingContext,
): BudgetLineDto {
  const status = context.editable
    ? budgetSourceStatus(row, context.sourceLines)
    : { state: null, currentAmountMinor: null };
  return {
    id: row.id,
    flow: row.flow,
    name: row.name,
    amountMinor: row.amountMinor,
    categoryId: row.categoryId,
    categoryName:
      row.categoryId === null ? null : (context.categoryNames.get(row.categoryId) ?? null),
    incomeSourceId: row.incomeSourceId,
    goalId: row.goalId,
    liabilityId: row.liabilityId,
    dueOn: row.dueOn,
    origin: row.origin,
    recurringRuleId: row.recurringRuleId,
    plannedExpenseId: row.plannedExpenseId,
    sourceAmountMinor: row.sourceAmountMinor,
    sourceState: status.state,
    sourceCurrentAmountMinor: status.currentAmountMinor,
    averageMonths: row.averageMonths,
    isExcluded: row.isExcluded,
    canPromote: budgetPromoteTargets(row, context.editable),
    canApplyToSource: canApplyBudgetLineToSource(row, context.editable, {
      isLiabilityRule:
        row.recurringRuleId !== null && context.liabilityRuleIds.has(row.recurringRuleId),
      isWeeklyRule: row.recurringRuleId !== null && context.weeklyRuleIds.has(row.recurringRuleId),
      goalContributionMode:
        row.origin === 'goal' && row.goalId !== null
          ? (context.goalModes.get(row.goalId) ?? null)
          : null,
    }),
    groupId: row.groupId,
    sortOrder: row.sortOrder,
    notes: row.notes,
  };
}

/**
 * Grupa szkicu w kształcie kontraktu (03 §3.21).
 *
 * @param row - Wiersz `budget_draft_groups`.
 * @returns DTO grupy.
 */
export function toBudgetGroupDto(row: BudgetDraftGroupRow): BudgetGroupDto {
  return { id: row.id, section: row.section, name: row.name, sortOrder: row.sortOrder };
}
