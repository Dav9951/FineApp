import type { BudgetDraftDto, BudgetDraftListDto, BudgetLineDto } from '@fineapp/shared';

/**
 * Dane testowe planera budżetu — wspólne dla testów reguł i ekranów (`F9-6`).
 *
 * Wartości z makiety 06 §3.14: listopad 2026, wpływy 11 800 zł, rozkład 20%
 * oszczędności z niedoborem 190 zł.
 */

/** Identyfikator szkicu. */
export const DRAFT_ID = '01JD0000000000000000000001';

/**
 * Linia szkicu — domyślnie czynsz z reguły, zgodny ze źródłem.
 *
 * @param overrides - Nadpisane pola.
 * @returns Linia.
 */
export function budgetLineFixture(overrides: Partial<BudgetLineDto> = {}): BudgetLineDto {
  return {
    id: '01JL0000000000000000000001',
    flow: 'expense',
    name: 'Czynsz',
    amountMinor: 185_000,
    categoryId: '01JC0000000000000000000001',
    categoryName: 'Mieszkanie',
    incomeSourceId: null,
    goalId: null,
    liabilityId: null,
    dueOn: '2026-11-10',
    origin: 'recurring',
    recurringRuleId: '01JR0000000000000000000001',
    plannedExpenseId: null,
    sourceAmountMinor: 185_000,
    sourceState: 'in_sync',
    sourceCurrentAmountMinor: null,
    averageMonths: null,
    isExcluded: false,
    canPromote: [],
    canApplyToSource: true,
    groupId: null,
    sortOrder: 0,
    notes: null,
    ...overrides,
  };
}

/** Ocena szkicu z makiety: zostaje 236 zł, oszczędności 18,4% z 20%. */
export const SUMMARY_FIXTURE: BudgetDraftDto['summary'] = {
  incomeMinor: 1_180_000,
  incomeBaseMinor: 1_180_000,
  hasIncomeBase: true,
  expenseMinor: 821_400,
  savingsMinor: 217_000,
  investmentMinor: 118_000,
  debtRepaymentMinor: 0,
  leftoverMinor: 23_600,
  allocation: [
    {
      kind: 'savings',
      targetBps: 2_000,
      targetMinor: 236_000,
      plannedMinor: 217_000,
      plannedBps: 1_839,
      status: 'short',
      shortfallMinor: 19_000,
    },
    {
      kind: 'investment',
      targetBps: 1_000,
      targetMinor: 118_000,
      plannedMinor: 118_000,
      plannedBps: 1_000,
      status: 'met',
      shortfallMinor: 0,
    },
  ],
  goals: [
    {
      goalId: '01JG0000000000000000000001',
      name: 'Poduszka',
      kind: 'savings',
      plannedMinor: 0,
      requiredMinor: 30_000,
      requirementBasis: 'contribution_plan',
      status: 'short',
      shortfallMinor: 30_000,
    },
  ],
  setAside: [],
  warnings: [
    {
      code: 'ALLOCATION_SHORT',
      message: 'Do planu oszczędności brakuje 190,00 zł.',
      amountMinor: 19_000,
      target: { kind: 'savings', id: null },
    },
  ],
};

/**
 * Szkic — domyślnie listopad 2026, edytowalny, z czynszem.
 *
 * @param overrides - Nadpisane pola.
 * @returns Szkic.
 */
export function budgetDraftFixture(overrides: Partial<BudgetDraftDto> = {}): BudgetDraftDto {
  return {
    id: DRAFT_ID,
    month: '2026-11',
    isEditable: true,
    notes: null,
    lastFilledAt: 1,
    lines: [budgetLineFixture()],
    groups: [],
    summary: SUMMARY_FIXTURE,
    actuals: null,
    ...overrides,
  };
}

/**
 * Lista szkiców — domyślnie pusta, z podpowiedzią listopada.
 *
 * @param overrides - Nadpisane pola.
 * @returns Lista.
 */
export function budgetListFixture(overrides: Partial<BudgetDraftListDto> = {}): BudgetDraftListDto {
  return {
    items: [],
    suggestedMonth: '2026-11',
    range: { from: '2026-10', to: '2027-10' },
    ...overrides,
  };
}
