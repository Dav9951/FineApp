import {
  averageWindow,
  budgetActuals,
  budgetLineIssues,
  budgetMonthRange,
  budgetPromoteTargets,
  budgetSectionOf,
  BUDGET_SECTIONS,
  budgetSourceKey,
  budgetSourceStatus,
  buildBudgetSourceLines,
  canCreateBudgetDraft,
  categoryAverages,
  clampDayToMonth,
  evaluateBudget,
  formatMonth,
  groupsByOrigin,
  inheritBudgetLayout,
  isBudgetDraftEditable,
  isNearBudgetMonthEnd,
  liabilityInstallmentForMonth,
  monthKeyOf,
  normalizeBudgetName,
  ruleApplyKind,
  setAsidePool,
  shiftMonth,
  sortBudgetLines,
  suggestedBudgetMonth,
  todayInTimezone,
  transferBudgetFlow,
  type ApplyToSourceResult,
  type AverageMonths,
  type BudgetActuals,
  type BudgetAllocationTargets,
  type BudgetDraftDto,
  type BudgetDraftListDto,
  type BudgetGoalCheckInput,
  type BudgetLayoutLine,
  type BudgetLineFlow,
  type BudgetLineIssue,
  type BudgetPlannedSource,
  type BudgetSection,
  type BudgetSetAsideCheckInput,
  type BudgetSourceLine,
  type BudgetSources,
  type BudgetSummaryDto,
  type CategoryAveragesDto,
  type CategoryKind,
  type ContributionMode,
  type CreateBudgetDraftRequest,
  type CreateBudgetGroupRequest,
  type CreateBudgetLineRequest,
  type GoalKind,
  type MonthBudgetSectionDto,
  type MonthKey,
  type PromoteBudgetLineRequest,
  type PromoteBudgetLineResult,
  type UpdateBudgetLayoutRequest,
  type UpdateBudgetLineRequest,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import { ConflictError, DomainRuleViolationError, NotFoundError } from '../../core/errors.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import type {
  BudgetDraftGroupInsert,
  BudgetDraftGroupRow,
  BudgetDraftLineInsert,
  BudgetDraftLineRow,
  BudgetDraftRow,
} from '../../db/schema/budget.js';
import { lookupAccount } from '../accounts/accounts.service.js';
import { getAllocationTarget } from '../allocation/allocation.service.js';
import { getHousehold } from '../auth/auth.service.js';
import { listCategoriesFlat, listCategoryTree } from '../categories/categories.service.js';
import { listGoals, updateGoal } from '../goals/goals.service.js';
import { listIncomeSources } from '../income-sources/income-sources.service.js';
import { listLiabilities } from '../liabilities/liabilities.service.js';
import {
  createPlannedExpense,
  listPlannedExpenses,
  updatePlannedExpense,
} from '../planned-expenses/planned-expenses.service.js';
import { budgetRuleSources } from '../recurring/recurring.external.js';
import {
  createRecurringRule,
  getRecurringRule,
  updateRecurringRule,
} from '../recurring/recurring.service.js';
import {
  categorySpendByMonth,
  firstTransactionMonth,
  monthLedger,
} from '../transactions/transactions.ledger.js';
import { toBudgetGroupDto, toBudgetLineDto, type LineMappingContext } from './budget.mapper.js';
import {
  findDraftByMonth,
  findDrafts,
  findGroups,
  findLine,
  findLines,
  findMaxLineOrder,
  insertDraft,
  insertGroups,
  insertLines,
  patchDraft,
  patchGroup,
  patchLine,
  relinkRuleLines,
  removeDraft,
  removeGroup,
  removeLine,
} from './budget.repository.js';

/**
 * Serwis planera budżetu — wymaganie #14, Faza 9
 * ([07 §13](../../../../../../plans/07-domain-rules.md#13-planer-budżetu), ADR-075…079).
 *
 * Źródła czyta przez serwisy innych modułów, `recurring.external.ts`
 * i `transactions.ledger.ts` — bez wyjątku od reguły 4 z 02 §3 (ADR-079). Wyliczenia
 * są w `shared/domain/budget.ts`; tutaj zbieranie danych, niezmienniki zapisu i składanie
 * DTO. Każda zmiana zwraca **cały szkic**: ocena zależy od wszystkich linii (04 §14a).
 */

/** Zakończony miesiąc nie przyjmuje zmian (07 §13.1). */
const READ_ONLY_MESSAGE = 'Plan zakończonego miesiąca jest tylko do odczytu.';

/** Dzisiejsza data i bieżący miesiąc gospodarstwa. */
interface Calendar {
  readonly today: string;
  readonly currentMonth: MonthKey;
}

/**
 * Kalendarz gospodarstwa w jego strefie czasu (07 §1.1).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Dzień i miesiąc.
 */
function calendarOf(handle: DbHandle, clock: Clock, householdId: string): Calendar {
  const household = getHousehold(handle, householdId);
  const today = todayInTimezone(household.timezone, clock.now());
  return { today, currentMonth: monthKeyOf(today, household.monthStartDay) };
}

/** Dane gospodarstwa niezależne od miesiąca szkicu. */
interface HouseholdContext extends Calendar {
  readonly categories: ReadonlyMap<
    string,
    { name: string; kind: CategoryKind; parentId: string | null }
  >;
  readonly incomeSourceNames: ReadonlyMap<string, string>;
  /** Rodzaj i konto celu — kierunek przelewu w wykonaniu (07 §4.1). */
  readonly goalAccounts: ReadonlyMap<
    string,
    { readonly kind: GoalKind; readonly linkedAccountId: string | null }
  >;
  readonly incomeSourceIds: ReadonlySet<string>;
  readonly nonCountingIncomeSourceIds: ReadonlySet<string>;
  readonly goals: BudgetSources['goals'];
  readonly goalKinds: ReadonlyMap<string, GoalKind>;
  readonly goalModes: ReadonlyMap<string, ContributionMode>;
  readonly goalChecks: readonly BudgetGoalCheckInput[];
  readonly liabilities: Parameters<typeof liabilityInstallmentForMonth>[0][];
  readonly liabilityRuleIds: ReadonlySet<string>;
  readonly plannedExpenses: readonly BudgetPlannedSource[];
  readonly setAsideChecks: readonly BudgetSetAsideCheckInput[];
}

/**
 * Zbiera źródła gospodarstwa, które nie zależą od miesiąca szkicu: kategorie, źródła
 * przychodu, cele, zobowiązania i planowane wydatki ze stanem odkładania na dziś.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Kontekst gospodarstwa.
 */
function loadHousehold(handle: DbHandle, clock: Clock, householdId: string): HouseholdContext {
  const calendar = calendarOf(handle, clock, householdId);

  const categories = new Map(
    listCategoriesFlat(handle, householdId, { includeArchived: true }).map((category) => [
      category.id,
      { name: category.name, kind: category.kind, parentId: category.parentId },
    ]),
  );
  const incomeSources = listIncomeSources(handle, householdId, { includeArchived: true });

  const goalDtos = listGoals(handle, clock, householdId, { includeArchived: true }).data;
  const goals = goalDtos.map((goal) => ({
    id: goal.id,
    name: goal.name,
    kind: goal.kind,
    status: goal.status,
    plan: {
      contributionMode: goal.contribution.mode,
      contributionAmountMinor: goal.contributionAmountMinor,
      contributionPercentBps: goal.contributionPercentBps,
    },
  }));
  const goalChecks = goals
    .filter((goal) => goal.status === 'active')
    .map((goal) => ({
      id: goal.id,
      name: goal.name,
      kind: goal.kind,
      requiredMonthlyMinor:
        goalDtos.find((dto) => dto.id === goal.id)?.projection
          .requiredMonthlyToHitTargetDateMinor ?? null,
      plan: goal.plan,
    }));

  const liabilityDtos = listLiabilities(handle, clock, householdId, { isActive: undefined });
  const goalKinds = new Map(goals.map((goal) => [goal.id, goal.kind]));

  const plannedExpenses = listPlannedExpenses(handle, clock, householdId, {
    status: ['planned', 'funding', 'ready', 'deferred', 'posted'],
  }).map((expense): BudgetPlannedSource => {
    const accountClass =
      expense.setAside.accountId === null
        ? null
        : (lookupAccount(handle, householdId, expense.setAside.accountId)?.allocationClass ?? null);
    const goalKind =
      expense.setAside.goalId === null ? null : (goalKinds.get(expense.setAside.goalId) ?? null);
    return {
      id: expense.id,
      name: expense.name,
      status: expense.status,
      estimatedAmountMinor: expense.estimatedAmountMinor,
      dueMonth: expense.dueMonth,
      dueOn: expense.dueOn,
      postedAmountMinor: expense.postedAmountMinor,
      categoryId: expense.categoryId,
      liabilityId: expense.liabilityId,
      setAsideEnabled: expense.setAside.enabled,
      setAsidePool: setAsidePool(accountClass, goalKind),
      accumulatedMinor: expense.setAside.accumulatedMinor,
      monthlyRequiredMinor: expense.setAside.monthlyRequiredMinor,
    };
  });

  return {
    ...calendar,
    categories,
    incomeSourceIds: new Set(incomeSources.map((source) => source.id)),
    incomeSourceNames: new Map(incomeSources.map((source) => [source.id, source.name])),
    goalAccounts: new Map(
      goalDtos.map((goal) => [goal.id, { kind: goal.kind, linkedAccountId: goal.linkedAccountId }]),
    ),
    nonCountingIncomeSourceIds: new Set(
      incomeSources.filter((source) => !source.countsTowardAllocation).map((source) => source.id),
    ),
    goals,
    goalKinds,
    goalModes: new Map(goals.map((goal) => [goal.id, goal.plan.contributionMode])),
    goalChecks,
    liabilities: liabilityDtos.map((liability) => ({
      id: liability.id,
      name: liability.name,
      isActive: liability.isActive,
      recurringRuleId: liability.recurringRuleId,
      openingBalanceMinor: liability.openingBalanceMinor,
      balanceAsOf: liability.balanceAsOf,
      monthlyPaymentMinor: liability.monthlyPaymentMinor,
      paymentDay: liability.paymentDay,
      firstPaymentOn: liability.firstPaymentOn,
      remainingMinor: liability.remainingMinor,
      nextDueOn: liability.nextDueOn,
      paidThisMonth: liability.paidThisMonth,
      lastPaymentOn: liability.lastPaymentOn,
    })),
    liabilityRuleIds: new Set(
      liabilityDtos
        .map((liability) => liability.recurringRuleId)
        .filter((id): id is string => id !== null),
    ),
    plannedExpenses,
    // Odkładanie na konto wydatkowe nie ma linii (07 §13.2) — nie oceniamy go jako braku.
    setAsideChecks: plannedExpenses
      .filter(
        (expense) =>
          expense.setAsideEnabled && expense.setAsidePool !== null && expense.status !== 'posted',
      )
      .map((expense) => ({
        plannedExpenseId: expense.id,
        name: expense.name,
        dueMonth: expense.dueMonth,
        requiredMinor: expense.monthlyRequiredMinor,
      })),
  };
}

/** Kontekst jednego miesiąca szkicu. */
interface MonthContext {
  readonly household: HouseholdContext;
  readonly month: MonthKey;
  readonly editable: boolean;
  readonly sources: BudgetSources;
  readonly sourceLines: readonly BudgetSourceLine[];
  readonly targets: BudgetAllocationTargets;
}

/**
 * Źródła i rozkład dla miesiąca szkicu.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param household - Kontekst gospodarstwa.
 * @param month - Miesiąc szkicu.
 * @returns Kontekst miesiąca.
 */
function loadMonth(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  household: HouseholdContext,
  month: MonthKey,
): MonthContext {
  const sources: BudgetSources = {
    rules: budgetRuleSources(handle, householdId, month),
    liabilities: household.liabilities
      .map((liability) => liabilityInstallmentForMonth(liability, month, household.currentMonth))
      .filter((liability) => liability !== null),
    plannedExpenses: household.plannedExpenses,
    goals: household.goals,
    nonCountingIncomeSourceIds: household.nonCountingIncomeSourceIds,
  };
  const target = getAllocationTarget(handle, clock, householdId, { month });
  return {
    household,
    month,
    editable: isBudgetDraftEditable(month, household.currentMonth),
    sources,
    sourceLines: buildBudgetSourceLines(sources, month, household.currentMonth),
    targets: {
      savingsBps: target?.savingsPercentBps ?? 0,
      investmentBps: target?.investmentPercentBps ?? 0,
      debtBps: target?.debtPercentBps ?? 0,
    },
  };
}

/**
 * Ocena szkicu z jego linii (07 §13.4).
 *
 * @param context - Kontekst miesiąca.
 * @param lines - Linie szkicu.
 * @param sourceLines - Linie źródeł po kluczu.
 * @returns Ocena.
 */
function summaryOf(
  context: MonthContext,
  lines: readonly BudgetDraftLineRow[],
  sourceLines: ReadonlyMap<string, BudgetSourceLine>,
): BudgetSummaryDto {
  return evaluateBudget({
    month: context.month,
    lines: lines.map((line) => ({
      ...line,
      sourceState: context.editable ? budgetSourceStatus(line, sourceLines).state : null,
    })),
    nonCountingIncomeSourceIds: context.household.nonCountingIncomeSourceIds,
    targets: context.targets,
    goals: context.household.goalChecks,
    setAside: context.household.setAsideChecks,
  });
}

/**
 * Kategoria główna — podkategoria zwinięta do rodzica, jak w średniej (07 §13.3).
 *
 * @param household - Kontekst gospodarstwa.
 * @param categoryId - Kategoria.
 * @returns Identyfikator kategorii głównej albo `null`.
 */
function mainCategoryOf(household: HouseholdContext, categoryId: string | null): string | null {
  if (categoryId === null) return null;
  return household.categories.get(categoryId)?.parentId ?? categoryId;
}

/**
 * Plan kontra wykonanie (07 §13.8) — tylko dla miesięcy, które już trwają albo minęły.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param context - Kontekst miesiąca.
 * @param lines - Linie szkicu.
 * @returns Wykonanie albo `null` dla miesiąca przyszłego.
 */
function actualsOf(
  handle: DbHandle,
  householdId: string,
  context: MonthContext,
  lines: readonly BudgetDraftLineRow[],
): BudgetActuals | null {
  const { household } = context;
  if (context.month > household.currentMonth) return null;
  const names = new Map<string, string>(household.incomeSourceNames);
  for (const [id, category] of household.categories) names.set(id, category.name);
  return budgetActuals({
    lines: lines.map((line) => ({
      ...line,
      mainCategoryId: mainCategoryOf(household, line.categoryId),
    })),
    ledger: monthLedger(handle, householdId, context.month).map((row) => ({
      ...row,
      mainCategoryId: mainCategoryOf(household, row.categoryId),
    })),
    goals: household.goalAccounts,
    names,
  });
}

/**
 * Grupy w kolejności ekranu: sekcje po kolei, w sekcji po `sort_order` (07 §13.10).
 *
 * @param groups - Grupy szkicu.
 * @returns Nowa tablica grup.
 */
function sortedGroups(groups: readonly BudgetDraftGroupRow[]): BudgetDraftGroupRow[] {
  return BUDGET_SECTIONS.flatMap((section) => groups.filter((group) => group.section === section));
}

/**
 * Składa DTO szkicu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param context - Kontekst miesiąca.
 * @param draft - Wiersz szkicu.
 * @returns Szkic z liniami i oceną.
 */
function draftDto(
  handle: DbHandle,
  householdId: string,
  context: MonthContext,
  draft: BudgetDraftRow,
): BudgetDraftDto {
  const lines = findLines(handle, householdId, [draft.id]);
  const groups = sortedGroups(findGroups(handle, householdId, [draft.id]));
  const sourceLines = new Map(context.sourceLines.map((line) => [line.key, line]));
  const mapping: LineMappingContext = {
    editable: context.editable,
    sourceLines,
    categoryNames: new Map(
      [...context.household.categories].map(([id, category]) => [id, category.name]),
    ),
    liabilityRuleIds: context.household.liabilityRuleIds,
    weeklyRuleIds: new Set(
      context.sources.rules
        .filter(
          (rule) => rule.schedule.frequency === 'weekly' || rule.schedule.frequency === 'biweekly',
        )
        .map((rule) => rule.id),
    ),
    goalModes: context.household.goalModes,
  };
  return {
    id: draft.id,
    month: draft.monthKey,
    isEditable: context.editable,
    notes: draft.notes,
    lastFilledAt: draft.lastFilledAt,
    lines: sortBudgetLines(groups, lines).map((line) => toBudgetLineDto(line, mapping)),
    groups: groups.map(toBudgetGroupDto),
    summary: summaryOf(context, lines, sourceLines),
    actuals: actualsOf(handle, householdId, context, lines),
  };
}

/**
 * Szkic na miesiąc albo `404`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @returns Wiersz szkicu.
 * @throws {NotFoundError} Gdy szkicu nie ma.
 */
function requireDraft(handle: DbHandle, householdId: string, month: MonthKey): BudgetDraftRow {
  const draft = findDraftByMonth(handle, householdId, month);
  if (draft === undefined) {
    throw new NotFoundError(`Brak planu na ${formatMonth(month)}.`);
  }
  return draft;
}

/**
 * Zapewnia, że szkic jest edytowalny (07 §13.1).
 *
 * @param context - Kontekst miesiąca.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 */
function requireEditable(context: MonthContext): void {
  if (!context.editable) throw new ConflictError(READ_ONLY_MESSAGE);
}

/**
 * Linia szkicu albo `404`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param draftId - Szkic.
 * @param lineId - Linia.
 * @returns Wiersz linii.
 * @throws {NotFoundError} Gdy linii nie ma w szkicu.
 */
function requireLine(
  handle: DbHandle,
  householdId: string,
  draftId: string,
  lineId: string,
): BudgetDraftLineRow {
  const line = findLine(handle, householdId, draftId, lineId);
  if (line === undefined) throw new NotFoundError('Nie ma takiej pozycji w planie.');
  return line;
}

/**
 * Grupa szkicu albo `404`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param draftId - Szkic.
 * @param groupId - Grupa.
 * @returns Wiersz grupy.
 * @throws {NotFoundError} Gdy grupy nie ma w szkicu.
 */
function requireGroup(
  handle: DbHandle,
  householdId: string,
  draftId: string,
  groupId: string,
): BudgetDraftGroupRow {
  const group = findGroups(handle, householdId, [draftId]).find((item) => item.id === groupId);
  if (group === undefined) throw new NotFoundError('Nie ma takiej grupy w planie.');
  return group;
}

/**
 * Sprawdza grupę linii (I-25): ta sama grupa szkicu i sekcja zgodna ze stroną bilansu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param draftId - Szkic.
 * @param flow - Strona bilansu linii.
 * @param groupId - Wskazana grupa; `null` — „Bez grupy".
 * @throws {DomainRuleViolationError} Gdy grupy nie ma w szkicu albo jest z innej sekcji.
 */
function assertLineGroup(
  handle: DbHandle,
  householdId: string,
  draftId: string,
  flow: BudgetLineFlow,
  groupId: string | null,
): void {
  if (groupId === null) return;
  const group = findGroups(handle, householdId, [draftId]).find((item) => item.id === groupId);
  if (group === undefined || group.section !== budgetSectionOf(flow)) {
    throw new DomainRuleViolationError('Pozycja może być tylko w grupie swojej sekcji.', [
      { path: 'groupId', message: 'Grupa z innej sekcji albo spoza planu' },
    ]);
  }
}

/**
 * Rzuca `422` z pierwszym problemem jako komunikatem.
 *
 * @param issues - Problemy z linią.
 * @throws {DomainRuleViolationError} Gdy lista nie jest pusta.
 */
function throwIssues(issues: readonly BudgetLineIssue[]): void {
  const [first] = issues;
  if (first !== undefined) throw new DomainRuleViolationError(`${first.message}.`, issues);
}

/** Pola linii po scaleniu — to, co sprawdzają niezmienniki. */
interface LineShape {
  readonly flow: BudgetLineFlow;
  readonly amountMinor: number;
  readonly categoryId: string | null;
  readonly incomeSourceId: string | null;
  readonly goalId: string | null;
  readonly dueOn: string | null;
}

/**
 * Niezmienniki linii z odwołaniami do innych bytów (I-21, I-23, 07 §13.1).
 *
 * @param context - Kontekst miesiąca.
 * @param shape - Pola linii po scaleniu.
 * @throws {DomainRuleViolationError} Przy złamanym niezmienniku albo nieznanym odwołaniu.
 */
function assertLine(context: MonthContext, shape: LineShape): void {
  throwIssues(budgetLineIssues(shape, context.month));
  const issues: BudgetLineIssue[] = [];
  if (shape.categoryId !== null) {
    const category = context.household.categories.get(shape.categoryId);
    if (category === undefined) {
      issues.push({ path: 'categoryId', message: 'Nie ma takiej kategorii' });
    } else if (category.kind !== shape.flow) {
      issues.push({
        path: 'categoryId',
        message:
          shape.flow === 'income'
            ? 'Wpływ wymaga kategorii przychodu'
            : 'Wydatek wymaga kategorii wydatku',
      });
    }
  }
  if (
    shape.incomeSourceId !== null &&
    !context.household.incomeSourceIds.has(shape.incomeSourceId)
  ) {
    issues.push({ path: 'incomeSourceId', message: 'Nie ma takiego źródła przychodu' });
  }
  if (shape.goalId !== null && !context.household.goalKinds.has(shape.goalId)) {
    issues.push({ path: 'goalId', message: 'Nie ma takiego celu' });
  }
  throwIssues(issues);
}

/**
 * Wiersz linii do wstawienia z linii źródła (07 §13.2).
 *
 * @param householdId - Gospodarstwo.
 * @param draftId - Szkic.
 * @param line - Linia źródła.
 * @param sortOrder - Pozycja w szkicu.
 * @param now - Znacznik czasu.
 * @returns Wiersz.
 */
function sourceLineRow(
  householdId: string,
  draftId: string,
  line: BudgetSourceLine,
  sortOrder: number,
  now: number,
): BudgetDraftLineInsert {
  return {
    id: newId(),
    householdId,
    draftId,
    flow: line.flow,
    name: line.name,
    amountMinor: line.amountMinor,
    categoryId: line.categoryId,
    incomeSourceId: line.incomeSourceId,
    goalId: line.goalId,
    liabilityId: line.liabilityId,
    dueOn: line.dueOn,
    origin: line.origin,
    recurringRuleId: line.recurringRuleId,
    plannedExpenseId: line.plannedExpenseId,
    sourceAmountMinor: line.amountMinor,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Średnie kategorii w oknie — wspólne dla trasy i linii ze średniej.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param currentMonth - Bieżący miesiąc.
 * @param months - Długość okna.
 * @returns Średnie.
 */
function averagesFor(
  handle: DbHandle,
  householdId: string,
  currentMonth: MonthKey,
  months: AverageMonths,
): CategoryAveragesDto {
  const window = averageWindow(currentMonth, months);
  const tree = listCategoryTree(handle, householdId, { kind: 'expense', includeArchived: true });
  const result = categoryAverages(
    currentMonth,
    months,
    firstTransactionMonth(handle, householdId),
    tree.map((category) => ({
      id: category.id,
      name: category.name,
      icon: category.icon,
      childIds: category.children.map((child) => child.id),
    })),
    categorySpendByMonth(handle, householdId, window.from, window.to),
  );
  return { months, ...result };
}

/**
 * Średnie miesięczne kategorii wydatków — `GET /budget-drafts/averages` (07 §13.3).
 *
 * Kategorie zarchiwizowane też się liczą: wydatek w zarchiwizowanej podkategorii nadal
 * jest wydatkiem kategorii głównej (07 §10), a średnia ma opisywać to, co się działo.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param months - Długość okna (3, 6 albo 12).
 * @returns Średnie kategorii głównych z wydatkiem w oknie.
 */
export function getCategoryAverages(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  months: AverageMonths,
): CategoryAveragesDto {
  return averagesFor(
    handle,
    householdId,
    calendarOf(handle, clock, householdId).currentMonth,
    months,
  );
}

/**
 * Lista szkiców z bilansem — `GET /budget-drafts` (04 §14a).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Szkice rosnąco po miesiącu, podpowiedź miesiąca i dozwolony zakres.
 */
export function listBudgetDrafts(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
): BudgetDraftListDto {
  const household = loadHousehold(handle, clock, householdId);
  const drafts = findDrafts(handle, householdId);
  const lines = findLines(
    handle,
    householdId,
    drafts.map((draft) => draft.id),
  );
  const items = drafts.map((draft) => {
    const context = loadMonth(handle, clock, householdId, household, draft.monthKey);
    const own = lines.filter((line) => line.draftId === draft.id);
    const summary = summaryOf(
      context,
      own,
      new Map(context.sourceLines.map((line) => [line.key, line])),
    );
    return {
      month: draft.monthKey,
      incomeMinor: summary.incomeMinor,
      expenseMinor: summary.expenseMinor,
      leftoverMinor: summary.leftoverMinor,
      lineCount: own.filter((line) => !line.isExcluded).length,
      warningCount: summary.warnings.length,
    };
  });
  return {
    items,
    suggestedMonth: suggestedBudgetMonth(
      household.today,
      household.currentMonth,
      new Set(drafts.map((draft) => draft.monthKey)),
    ),
    range: budgetMonthRange(household.currentMonth),
  };
}

/**
 * Szkic miesiąca — `GET /budget-drafts/:month` (04 §14a).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @returns Szkic z liniami i oceną.
 * @throws {NotFoundError} Gdy szkicu nie ma.
 */
export function getBudgetDraft(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
): BudgetDraftDto {
  const draft = requireDraft(handle, householdId, month);
  const context = loadMonth(
    handle,
    clock,
    householdId,
    loadHousehold(handle, clock, householdId),
    month,
  );
  return draftDto(handle, householdId, context, draft);
}

/**
 * Sekcja `budget` podsumowania miesiąca (04 §14, `F9-8`, ADR-079).
 *
 * Ocena szkicu (pełny kontekst gospodarstwa) liczona tylko wtedy, gdy szkic oglądanego
 * miesiąca istnieje — dashboard bez planu nie płaci za zebranie źródeł.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Oglądany miesiąc.
 * @returns Stan planu oglądanego i następnego miesiąca.
 */
export function budgetSectionForMonth(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
): MonthBudgetSectionDto {
  const calendar = calendarOf(handle, clock, householdId);
  const nextMonth = shiftMonth(month, 1);
  const draft = findDraftByMonth(handle, householdId, month);
  const nextMonthHasDraft = findDraftByMonth(handle, householdId, nextMonth) !== undefined;
  let leftoverMinor: number | null = null;
  if (draft !== undefined) {
    const context = loadMonth(
      handle,
      clock,
      householdId,
      loadHousehold(handle, clock, householdId),
      month,
    );
    leftoverMinor = summaryOf(
      context,
      findLines(handle, householdId, [draft.id]),
      new Map(context.sourceLines.map((line) => [line.key, line])),
    ).leftoverMinor;
  }
  return {
    month,
    hasDraft: draft !== undefined,
    canCreate: canCreateBudgetDraft(month, calendar.currentMonth),
    leftoverMinor,
    nextMonth,
    nextMonthHasDraft,
    suggestNextMonth:
      month === calendar.currentMonth &&
      !nextMonthHasDraft &&
      isNearBudgetMonthEnd(calendar.today, calendar.currentMonth),
  };
}

/**
 * Zakłada szkic — `POST /budget-drafts/:month` (07 §13.1–13.3).
 *
 * W jednej transakcji bazy: szkic, linie ze źródeł (kroki 1–7), linie własne
 * skopiowane z innego szkicu i linie ze średniej. Linia ze średniej bez danych powstaje
 * z kwotą 0 — kategoria była wybrana świadomie (04 §14a).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor szkicu.
 * @param month - Miesiąc szkicu.
 * @param input - Co wciągnąć.
 * @returns Założony szkic.
 * @throws {DomainRuleViolationError} Poza zakresem miesięcy, przy złym szkicu do kopii
 *   albo kategorii spoza wydatków.
 * @throws {ConflictError} Gdy szkic na ten miesiąc już istnieje.
 */
export function createBudgetDraft(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  month: MonthKey,
  input: CreateBudgetDraftRequest,
): BudgetDraftDto {
  const household = loadHousehold(handle, clock, householdId);
  if (!canCreateBudgetDraft(month, household.currentMonth)) {
    const range = budgetMonthRange(household.currentMonth);
    throw new DomainRuleViolationError(
      `Plan można założyć na miesiące od ${formatMonth(range.from)} do ${formatMonth(range.to)}.`,
      [{ path: 'month', message: 'Miesiąc poza zakresem planowania' }],
    );
  }
  if (findDraftByMonth(handle, householdId, month) !== undefined) {
    throw new ConflictError(`Plan na ${formatMonth(month)} już istnieje.`);
  }

  const copyFrom =
    input.copyManualFrom === null || input.copyManualFrom === undefined
      ? null
      : findDraftByMonth(handle, householdId, input.copyManualFrom);
  if (
    input.copyManualFrom !== null &&
    input.copyManualFrom !== undefined &&
    copyFrom === undefined
  ) {
    throw new DomainRuleViolationError(
      `Brak planu na ${formatMonth(input.copyManualFrom)} do skopiowania.`,
      [{ path: 'copyManualFrom', message: 'Nie ma takiego planu' }],
    );
  }
  for (const [index, line] of input.averageLines.entries()) {
    if (household.categories.get(line.categoryId)?.kind !== 'expense') {
      throw new DomainRuleViolationError('Średnią da się wziąć tylko dla kategorii wydatku.', [
        { path: `averageLines.${String(index)}.categoryId`, message: 'Kategoria spoza wydatków' },
      ]);
    }
  }

  // Układ przychodzi z planu, z którego kopiujemy linie, a bez niego z najbliższego
  // wcześniejszego (07 §13.10) — także przy „Zacznij od zera".
  const layoutFrom =
    copyFrom ??
    findDrafts(handle, householdId)
      .filter((candidate) => candidate.monthKey < month)
      .at(-1) ??
    null;

  const context = loadMonth(handle, clock, householdId, household, month);
  const averages = new Map<AverageMonths, ReadonlyMap<string, number>>();
  const averageOf = (categoryId: string, months: AverageMonths): number | null => {
    let byCategory = averages.get(months);
    if (byCategory === undefined) {
      byCategory = new Map(
        averagesFor(handle, householdId, household.currentMonth, months).items.map((item) => [
          item.categoryId,
          item.averageMinor,
        ]),
      );
      averages.set(months, byCategory);
    }
    return byCategory.get(categoryId) ?? null;
  };

  const now = clock.now().getTime();
  const draftId = newId();
  handle.sqlite.transaction(() => {
    insertDraft(handle, {
      id: draftId,
      householdId,
      monthKey: month,
      notes: input.notes ?? null,
      lastFilledAt: input.fillFromSources ? now : null,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    const rows: BudgetDraftLineInsert[] = [];
    if (input.fillFromSources) {
      for (const line of context.sourceLines) {
        rows.push(sourceLineRow(householdId, draftId, line, rows.length, now));
      }
    }
    if (copyFrom !== null && copyFrom !== undefined) {
      for (const line of findLines(handle, householdId, [copyFrom.id])) {
        if (line.origin !== 'manual' || line.isExcluded) continue;
        const average =
          line.averageMonths === null || line.categoryId === null
            ? null
            : averageOf(line.categoryId, line.averageMonths);
        rows.push({
          id: newId(),
          householdId,
          draftId,
          flow: line.flow,
          name: line.name,
          amountMinor: average ?? line.amountMinor,
          categoryId: line.categoryId,
          incomeSourceId: line.incomeSourceId,
          goalId: line.goalId,
          dueOn: line.dueOn === null ? null : clampDayToMonth(month, Number(line.dueOn.slice(8))),
          averageMonths: line.averageMonths,
          notes: line.notes,
          sortOrder: rows.length,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    for (const line of input.averageLines) {
      rows.push({
        id: newId(),
        householdId,
        draftId,
        flow: 'expense',
        // Kategoria sprawdzona wyżej, więc nazwa jest.
        name: household.categories.get(line.categoryId)?.name ?? '',
        amountMinor: averageOf(line.categoryId, line.months) ?? 0,
        categoryId: line.categoryId,
        averageMonths: line.months,
        sortOrder: rows.length,
        createdAt: now,
        updatedAt: now,
      });
    }
    insertGroups(handle, inheritLayout(handle, householdId, layoutFrom, draftId, rows, now));
    insertLines(handle, rows);
  })();
  return draftDto(handle, householdId, context, requireDraft(handle, householdId, month));
}

/**
 * Linia do wstawienia w kształcie potrzebnym przy kopiowaniu układu.
 *
 * @param row - Wiersz do wstawienia (pola opcjonalne jeszcze bez wartości domyślnych).
 * @returns Linia układu.
 */
function layoutLineOf(row: BudgetDraftLineInsert): BudgetLayoutLine {
  return {
    id: row.id,
    flow: row.flow,
    name: row.name,
    origin: row.origin ?? 'manual',
    categoryId: row.categoryId ?? null,
    recurringRuleId: row.recurringRuleId ?? null,
    plannedExpenseId: row.plannedExpenseId ?? null,
    goalId: row.goalId ?? null,
    liabilityId: row.liabilityId ?? null,
    groupId: row.groupId ?? null,
    sortOrder: row.sortOrder ?? 0,
  };
}

/**
 * Kopiuje układ szkicu źródłowego na nowy szkic (07 §13.10): zwraca grupy do wstawienia
 * i **w miejscu** ustawia `groupId` i `sortOrder` wierszy linii.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param source - Szkic źródłowy albo `null` (bez układu — kolejność wypełnienia).
 * @param draftId - Nowy szkic.
 * @param rows - Wiersze linii nowego szkicu w kolejności wypełnienia.
 * @param now - Znacznik czasu.
 * @returns Grupy nowego szkicu.
 */
function inheritLayout(
  handle: DbHandle,
  householdId: string,
  source: BudgetDraftRow | null,
  draftId: string,
  rows: BudgetDraftLineInsert[],
  now: number,
): BudgetDraftGroupInsert[] {
  if (source === null) return [];
  const layout = inheritBudgetLayout(
    {
      groups: findGroups(handle, householdId, [source.id]),
      lines: findLines(handle, householdId, [source.id]),
    },
    rows.map(layoutLineOf),
  );
  const ids = new Map(layout.groups.map((group) => [group.sourceGroupId, newId()]));
  rows.forEach((row, index) => {
    const placement = layout.placements[index];
    if (placement === undefined) return;
    row.groupId =
      placement.sourceGroupId === null ? null : (ids.get(placement.sourceGroupId) ?? null);
    row.sortOrder = placement.sortOrder;
  });
  return layout.groups.map((group) => ({
    id: ids.get(group.sourceGroupId) ?? newId(),
    householdId,
    draftId,
    section: group.section,
    name: group.name,
    sortOrder: group.sortOrder,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Zmienia notatkę szkicu — `PATCH /budget-drafts/:month`.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @param notes - Nowa notatka; `null` czyści.
 * @returns Szkic.
 * @throws {NotFoundError} Gdy szkicu nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 */
export function updateBudgetDraft(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
  notes: string | null | undefined,
): BudgetDraftDto {
  const draft = requireDraft(handle, householdId, month);
  const context = loadMonth(
    handle,
    clock,
    householdId,
    loadHousehold(handle, clock, householdId),
    month,
  );
  requireEditable(context);
  if (notes !== undefined) {
    patchDraft(handle, householdId, draft.id, { notes, updatedAt: clock.now().getTime() });
  }
  return draftDto(handle, householdId, context, requireDraft(handle, householdId, month));
}

/**
 * Usuwa szkic z liniami — `DELETE /budget-drafts/:month`. Źródła nietknięte; dozwolone
 * także dla minionych miesięcy (04 §14a).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @throws {NotFoundError} Gdy szkicu nie ma.
 */
export function deleteBudgetDraft(handle: DbHandle, householdId: string, month: MonthKey): void {
  removeDraft(handle, householdId, requireDraft(handle, householdId, month).id);
}

/**
 * Dociąga brakujące linie ze źródeł — `POST /budget-drafts/:month/refresh` (07 §13.2).
 *
 * Nie zmienia istniejących linii i nie wskrzesza wykluczonych: wstawianie idzie przez
 * `ON CONFLICT DO NOTHING` na unikalnych indeksach (ADR-076).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @returns Szkic po odświeżeniu.
 * @throws {NotFoundError} Gdy szkicu nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 */
export function refreshBudgetDraft(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
): BudgetDraftDto {
  const draft = requireDraft(handle, householdId, month);
  const context = loadMonth(
    handle,
    clock,
    householdId,
    loadHousehold(handle, clock, householdId),
    month,
  );
  requireEditable(context);
  const now = clock.now().getTime();
  handle.sqlite.transaction(() => {
    let order = findMaxLineOrder(handle, householdId, draft.id) + 1;
    insertLines(
      handle,
      context.sourceLines.map((line) => sourceLineRow(householdId, draft.id, line, order++, now)),
    );
    patchDraft(handle, householdId, draft.id, { lastFilledAt: now, updatedAt: now });
  })();
  return draftDto(handle, householdId, context, requireDraft(handle, householdId, month));
}

/**
 * Dopisuje linię własną — `POST /budget-drafts/:month/lines`.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @param input - Pola linii.
 * @returns Szkic z nową linią.
 * @throws {NotFoundError} Gdy szkicu nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 * @throws {DomainRuleViolationError} Przy złamanym niezmienniku linii.
 */
export function createBudgetLine(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
  input: CreateBudgetLineRequest,
): BudgetDraftDto {
  const draft = requireDraft(handle, householdId, month);
  const context = loadMonth(
    handle,
    clock,
    householdId,
    loadHousehold(handle, clock, householdId),
    month,
  );
  requireEditable(context);
  const shape: LineShape = {
    flow: input.flow,
    amountMinor: input.amountMinor,
    categoryId: input.categoryId ?? null,
    incomeSourceId: input.incomeSourceId ?? null,
    goalId: input.goalId ?? null,
    dueOn: input.dueOn ?? null,
  };
  assertLine(context, shape);
  assertLineGroup(handle, householdId, draft.id, input.flow, input.groupId ?? null);
  const now = clock.now().getTime();
  insertLines(handle, [
    {
      id: newId(),
      householdId,
      draftId: draft.id,
      ...shape,
      name: input.name,
      averageMonths: input.averageMonths ?? null,
      notes: input.notes ?? null,
      groupId: input.groupId ?? null,
      sortOrder: findMaxLineOrder(handle, householdId, draft.id) + 1,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return draftDto(handle, householdId, context, draft);
}

/**
 * Zmienia linię — `PATCH /budget-drafts/:month/lines/:lineId`.
 *
 * Zmiana kwoty bez `averageMonths` czyści pamiątkę średniej: kwota wpisana ręcznie
 * nie jest już średnią. Wykluczyć można tylko linię powiązaną (I-24) — własną się usuwa.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @param lineId - Linia.
 * @param input - Zmienione pola.
 * @returns Szkic po zmianie.
 * @throws {NotFoundError} Gdy szkicu albo linii nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 * @throws {DomainRuleViolationError} Przy złamanym niezmienniku linii.
 */
export function updateBudgetLine(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
  lineId: string,
  input: UpdateBudgetLineRequest,
): BudgetDraftDto {
  const draft = requireDraft(handle, householdId, month);
  const context = loadMonth(
    handle,
    clock,
    householdId,
    loadHousehold(handle, clock, householdId),
    month,
  );
  requireEditable(context);
  const line = requireLine(handle, householdId, draft.id, lineId);
  if (input.isExcluded === true && line.origin === 'manual') {
    throw new DomainRuleViolationError('Własną pozycję się usuwa, nie pomija.', [
      { path: 'isExcluded', message: 'Tylko pozycja powiązana ze źródłem' },
    ]);
  }
  const merged: LineShape = {
    flow: line.flow,
    amountMinor: input.amountMinor ?? line.amountMinor,
    categoryId: input.categoryId === undefined ? line.categoryId : input.categoryId,
    incomeSourceId: input.incomeSourceId === undefined ? line.incomeSourceId : input.incomeSourceId,
    goalId: input.goalId === undefined ? line.goalId : input.goalId,
    dueOn: input.dueOn === undefined ? line.dueOn : input.dueOn,
  };
  assertLine(context, merged);
  // Zmiana grupy przenosi linię na koniec nowej grupy (07 §13.10).
  const regroup = input.groupId !== undefined && input.groupId !== line.groupId;
  if (regroup) assertLineGroup(handle, householdId, draft.id, line.flow, input.groupId ?? null);
  const averageMonths =
    input.averageMonths !== undefined
      ? input.averageMonths
      : input.amountMinor !== undefined && input.amountMinor !== line.amountMinor
        ? null
        : line.averageMonths;
  patchLine(handle, householdId, line.id, {
    ...merged,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    ...(input.isExcluded === undefined ? {} : { isExcluded: input.isExcluded }),
    ...(regroup
      ? {
          groupId: input.groupId ?? null,
          sortOrder: findMaxLineOrder(handle, householdId, draft.id) + 1,
        }
      : {}),
    ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
    averageMonths,
    updatedAt: clock.now().getTime(),
  });
  return draftDto(handle, householdId, context, draft);
}

/**
 * Usuwa linię własną albo wyklucza powiązaną — `DELETE /budget-drafts/:month/lines/:lineId`.
 *
 * Linia powiązana zostaje jako wykluczona, żeby odświeżenie jej nie przywróciło (I-24,
 * ADR-076); wraca przez `PATCH { isExcluded: false }`.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @param lineId - Linia.
 * @returns Szkic po zmianie.
 * @throws {NotFoundError} Gdy szkicu albo linii nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 */
export function deleteBudgetLine(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
  lineId: string,
): BudgetDraftDto {
  const draft = requireDraft(handle, householdId, month);
  const context = loadMonth(
    handle,
    clock,
    householdId,
    loadHousehold(handle, clock, householdId),
    month,
  );
  requireEditable(context);
  const line = requireLine(handle, householdId, draft.id, lineId);
  if (line.origin === 'manual') removeLine(handle, householdId, line.id);
  else
    patchLine(handle, householdId, line.id, { isExcluded: true, updatedAt: clock.now().getTime() });
  return draftDto(handle, householdId, context, draft);
}

/**
 * „Przyjmij" bieżącą kwotę źródła — `POST …/lines/:lineId/accept-source` (07 §13.5).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @param lineId - Linia.
 * @returns Szkic po zmianie.
 * @throws {NotFoundError} Gdy szkicu albo linii nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 * @throws {DomainRuleViolationError} Dla linii własnej albo źródła, które nic nie daje.
 */
export function acceptBudgetLineSource(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
  lineId: string,
): BudgetDraftDto {
  const draft = requireDraft(handle, householdId, month);
  const context = loadMonth(
    handle,
    clock,
    householdId,
    loadHousehold(handle, clock, householdId),
    month,
  );
  requireEditable(context);
  const line = requireLine(handle, householdId, draft.id, lineId);
  const source = context.sourceLines.find((candidate) => candidate.key === budgetSourceKey(line));
  if (source === undefined) {
    throw new DomainRuleViolationError(
      line.origin === 'manual'
        ? 'Własna pozycja nie ma źródła.'
        : 'Źródło tej pozycji nie daje już nic w tym miesiącu.',
    );
  }
  patchLine(handle, householdId, line.id, {
    amountMinor: source.amountMinor,
    sourceAmountMinor: source.amountMinor,
    averageMonths: null,
    updatedAt: clock.now().getTime(),
  });
  return draftDto(handle, householdId, context, draft);
}

/**
 * „Zostaw jako własną" — linia osierocona staje się linią własną
 * (`POST …/lines/:lineId/detach`, 07 §13.5).
 *
 * Tylko przy źródle usuniętym: linia z istniejącym źródłem po odłączeniu wróciłaby przy
 * odświeżeniu jako druga.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @param lineId - Linia.
 * @returns Szkic po zmianie.
 * @throws {NotFoundError} Gdy szkicu albo linii nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 * @throws {DomainRuleViolationError} Gdy źródło linii istnieje.
 */
export function detachBudgetLine(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
  lineId: string,
): BudgetDraftDto {
  const draft = requireDraft(handle, householdId, month);
  const context = loadMonth(
    handle,
    clock,
    householdId,
    loadHousehold(handle, clock, householdId),
    month,
  );
  requireEditable(context);
  const line = requireLine(handle, householdId, draft.id, lineId);
  if (line.origin === 'manual' || budgetSourceKey(line) !== null) {
    throw new DomainRuleViolationError('Odłączyć można tylko pozycję, której źródło usunięto.');
  }
  patchLine(handle, householdId, line.id, {
    origin: 'manual',
    recurringRuleId: null,
    plannedExpenseId: null,
    sourceAmountMinor: null,
    isExcluded: false,
    updatedAt: clock.now().getTime(),
  });
  return draftDto(handle, householdId, context, draft);
}

/**
 * Linia źródła reguły w miesiącu — do linii po zamianie i do szkiców późniejszych.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param household - Kontekst gospodarstwa.
 * @param ruleId - Reguła.
 * @param month - Miesiąc szkicu.
 * @returns Linia albo `undefined`, gdy reguła nie ma terminu w miesiącu.
 */
function ruleSourceLine(
  handle: DbHandle,
  householdId: string,
  household: HouseholdContext,
  ruleId: string,
  month: MonthKey,
): BudgetSourceLine | undefined {
  const rule = budgetRuleSources(handle, householdId, month).find((item) => item.id === ruleId);
  if (rule === undefined) return undefined;
  return buildBudgetSourceLines(
    {
      rules: [rule],
      liabilities: [],
      plannedExpenses: [],
      goals: [],
      nonCountingIncomeSourceIds: household.nonCountingIncomeSourceIds,
    },
    month,
    household.currentMonth,
  )[0];
}

/**
 * Sprawdza, że przelew z linii puli naprawdę do niej trafia (07 §13.6) — inaczej
 * reguła dałaby w szkicu linię innej puli albo żadnej.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param flow - Pula linii.
 * @param accountId - Konto źródłowe przelewu.
 * @param counterAccountId - Konto docelowe przelewu.
 * @throws {DomainRuleViolationError} Gdy konta nie dają wpłaty do puli linii.
 */
function assertTransferPool(
  handle: DbHandle,
  householdId: string,
  flow: BudgetLineFlow,
  accountId: string,
  counterAccountId: string | null | undefined,
): void {
  if (counterAccountId === null || counterAccountId === undefined) return; // kształt sprawdzi reguła
  const source = lookupAccount(handle, householdId, accountId);
  const target = lookupAccount(handle, householdId, counterAccountId);
  if (source === undefined || target === undefined) return; // odwołania sprawdzi reguła
  const pool = transferBudgetFlow({
    sourceAllocationClass: source.allocationClass,
    targetAllocationClass: target.allocationClass,
    allocationOverride: null,
  });
  if (pool?.flow !== flow || pool.sign !== 1) {
    throw new DomainRuleViolationError(
      flow === 'savings'
        ? 'Ten przelew nie trafia do oszczędności — wybierz konto oszczędnościowe jako docelowe.'
        : 'Ten przelew nie trafia do inwestycji — wybierz konto inwestycyjne jako docelowe.',
      [{ path: 'counterAccountId', message: 'Konto docelowe innej puli' }],
    );
  }
}

/**
 * Zamienia linię własną w regułę cykliczną albo planowany wydatek —
 * `POST …/lines/:lineId/promote` (07 §13.6, ADR-077).
 *
 * Byt powstaje przez serwis docelowego modułu (te same walidacje co na jego ekranie),
 * a całość — byt, linia, linie w późniejszych szkicach — w jednej transakcji bazy.
 * Idempotencję zapewnia trasa (`runIdempotent`).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @param lineId - Linia.
 * @param input - Cel zamiany i jego pola.
 * @returns Szkic po zmianie, utworzony byt i miesiąc, do którego przeniosła się linia.
 * @throws {NotFoundError} Gdy szkicu albo linii nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 * @throws {DomainRuleViolationError} Gdy linii nie da się tak zamienić albo byt się nie waliduje.
 */
export function promoteBudgetLine(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
  lineId: string,
  input: PromoteBudgetLineRequest,
): PromoteBudgetLineResult {
  const draft = requireDraft(handle, householdId, month);
  const household = loadHousehold(handle, clock, householdId);
  const context = loadMonth(handle, clock, householdId, household, month);
  requireEditable(context);
  const line = requireLine(handle, householdId, draft.id, lineId);
  if (!budgetPromoteTargets(line, true).includes(input.target)) {
    throw new DomainRuleViolationError(
      line.origin !== 'manual'
        ? 'Zamienić można tylko własną pozycję planu.'
        : line.amountMinor <= 0
          ? 'Pozycja do zamiany musi mieć kwotę większą od zera.'
          : line.isExcluded
            ? 'Pominiętej pozycji nie da się zamienić.'
            : 'Planowanym wydatkiem może zostać tylko wydatek.',
      [{ path: 'target', message: 'Niedozwolona zamiana' }],
    );
  }
  const now = clock.now().getTime();

  const result = handle.sqlite.transaction(
    (): {
      created: PromoteBudgetLineResult['created'];
      lineMovedTo: MonthKey | null;
    } => {
      if (input.target === 'recurring') {
        const flow = line.flow === 'income' || line.flow === 'expense' ? line.flow : 'transfer';
        if (flow === 'transfer') {
          assertTransferPool(
            handle,
            householdId,
            line.flow,
            input.accountId,
            input.counterAccountId,
          );
        }
        const rule = createRecurringRule(handle, clock, householdId, {
          name: line.name,
          flow,
          amountMinor: line.amountMinor,
          amountIsEstimate: input.amountIsEstimate,
          accountId: input.accountId,
          counterAccountId: flow === 'transfer' ? (input.counterAccountId ?? null) : null,
          categoryId: line.categoryId,
          incomeSourceId: line.incomeSourceId,
          goalId: flow === 'transfer' ? line.goalId : null,
          liabilityId: null,
          allocationOverride: null,
          frequency: input.frequency,
          intervalCount: input.intervalCount,
          dayOfMonth:
            input.dayOfMonth ?? (line.dueOn === null ? null : Number(line.dueOn.slice(8, 10))),
          weekday: input.weekday ?? null,
          monthOfYear: input.monthOfYear ?? null,
          startMonth: month,
          endMonth: input.endMonth ?? null,
          autoPost: input.autoPost,
          isFixedExpense: flow === 'expense' && input.isFixedExpense,
          notes: line.notes,
        });
        const source = ruleSourceLine(handle, householdId, household, rule.id, month);
        if (source === undefined) {
          throw new DomainRuleViolationError(
            `Ta pozycja cykliczna nie ma terminu w ${formatMonth(month)} — zmień terminarz.`,
            [{ path: 'frequency', message: 'Brak terminu w miesiącu planu' }],
          );
        }
        patchLine(handle, householdId, line.id, {
          origin: 'recurring',
          recurringRuleId: rule.id,
          amountMinor: source.amountMinor,
          sourceAmountMinor: source.amountMinor,
          dueOn: source.dueOn,
          averageMonths: null,
          updatedAt: now,
        });
        // Pozycja „od listopada" ma być od razu w szkicu grudnia (07 §13.6).
        for (const later of findDrafts(handle, householdId)) {
          if (later.monthKey <= month) continue;
          const laterLine = ruleSourceLine(handle, householdId, household, rule.id, later.monthKey);
          if (laterLine === undefined) continue;
          insertLines(handle, [
            sourceLineRow(
              householdId,
              later.id,
              laterLine,
              findMaxLineOrder(handle, householdId, later.id) + 1,
              now,
            ),
          ]);
        }
        return { created: { kind: 'recurring_rule', id: rule.id }, lineMovedTo: null };
      }

      const dueMonth = input.dueMonth ?? month;
      if (dueMonth < household.currentMonth) {
        throw new DomainRuleViolationError(
          'Planowany wydatek nie może mieć terminu w przeszłości.',
          [{ path: 'dueMonth', message: 'Miesiąc miniony' }],
        );
      }
      const dueOn =
        input.dueOn !== undefined ? input.dueOn : dueMonth === month ? line.dueOn : null;
      const expense = createPlannedExpense(handle, clock, householdId, {
        name: line.name,
        estimatedAmountMinor: line.amountMinor,
        amountIsEstimate: input.amountIsEstimate,
        dueMonth,
        dueOn,
        categoryId: line.categoryId,
        accountId: input.accountId ?? null,
        liabilityId: null,
        priority: input.priority,
        setAsideEnabled: input.setAsideEnabled,
        setAsideAccountId: input.setAsideAccountId ?? null,
        setAsideGoalId: input.setAsideGoalId ?? null,
        alreadySetAsideMinor: input.alreadySetAsideMinor,
        repeatsYearly: input.repeatsYearly,
        notes: line.notes,
      });
      const plannedLine: BudgetSourceLine = {
        key: `planned:${expense.id}`,
        origin: 'planned',
        flow: 'expense',
        name: expense.name,
        amountMinor: expense.estimatedAmountMinor,
        categoryId: expense.categoryId,
        incomeSourceId: null,
        goalId: null,
        liabilityId: null,
        recurringRuleId: null,
        plannedExpenseId: expense.id,
        dueOn: expense.dueOn,
      };
      if (dueMonth === month) {
        patchLine(handle, householdId, line.id, {
          origin: 'planned',
          plannedExpenseId: expense.id,
          sourceAmountMinor: expense.estimatedAmountMinor,
          dueOn: expense.dueOn,
          averageMonths: null,
          updatedAt: now,
        });
        return { created: { kind: 'planned_expense', id: expense.id }, lineMovedTo: null };
      }
      // Wydatek nie wypada w tym miesiącu — linia przechodzi do szkicu miesiąca terminu.
      removeLine(handle, householdId, line.id);
      const target = findDraftByMonth(handle, householdId, dueMonth);
      if (target !== undefined) {
        insertLines(handle, [
          sourceLineRow(
            householdId,
            target.id,
            plannedLine,
            findMaxLineOrder(handle, householdId, target.id) + 1,
            now,
          ),
        ]);
      }
      return { created: { kind: 'planned_expense', id: expense.id }, lineMovedTo: dueMonth };
    },
  )();

  const after = loadMonth(
    handle,
    clock,
    householdId,
    loadHousehold(handle, clock, householdId),
    month,
  );
  return { draft: draftDto(handle, householdId, after, draft), ...result };
}

/**
 * Zapisuje kwotę linii w źródle — `POST …/lines/:lineId/apply-to-source` (07 §13.7).
 *
 * Reguła dla miesiąca późniejszego niż bieżący i niż jej start **dzieli się**: stara
 * kończy się miesiąc wcześniej, nowa zaczyna się w miesiącu szkicu z nową kwotą, a linie
 * szkiców od tego miesiąca przechodzą na nową (ADR-076). Planowany wydatek dostaje nowy
 * szacunek, cel kwotowy — nowy plan wpłat.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @param lineId - Linia.
 * @returns Szkic po zmianie i skutek w źródle.
 * @throws {NotFoundError} Gdy szkicu albo linii nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca albo zapłaconego wydatku.
 * @throws {DomainRuleViolationError} Gdy kwoty nie da się zapisać w źródle.
 */
export function applyBudgetLineToSource(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
  lineId: string,
): ApplyToSourceResult {
  const draft = requireDraft(handle, householdId, month);
  const household = loadHousehold(handle, clock, householdId);
  const context = loadMonth(handle, clock, householdId, household, month);
  requireEditable(context);
  const line = requireLine(handle, householdId, draft.id, lineId);
  const lineDto = draftDto(handle, householdId, context, draft).lines.find(
    (item) => item.id === line.id,
  );
  if (lineDto === undefined || !lineDto.canApplyToSource) {
    throw new DomainRuleViolationError('Kwoty tej pozycji nie da się zapisać w źródle.');
  }
  const key = budgetSourceKey(line);
  const source = context.sourceLines.find((candidate) => candidate.key === key);
  if (source === undefined) {
    throw new DomainRuleViolationError('Źródło tej pozycji nie daje już nic w tym miesiącu.');
  }
  const now = clock.now().getTime();
  const positive = (amount: number): number => {
    if (amount <= 0) {
      throw new DomainRuleViolationError('Kwota w źródle musi być większa od zera.', [
        { path: 'amountMinor', message: 'Kwota musi być większa od zera' },
      ]);
    }
    return amount;
  };

  const effect = handle.sqlite.transaction((): ApplyToSourceResult['effect'] => {
    if (line.origin === 'recurring' && line.recurringRuleId !== null) {
      const rule = getRecurringRule(handle, clock, householdId, line.recurringRuleId);
      // Linia wypłaty z puli ma kwotę ujemną, a reguła — zawsze dodatnią.
      const amountMinor = positive(source.amountMinor < 0 ? -line.amountMinor : line.amountMinor);
      if (ruleApplyKind(month, household.currentMonth, rule.startMonth) === 'rule_updated') {
        updateRecurringRule(handle, clock, householdId, rule.id, { amountMinor });
        patchLine(handle, householdId, line.id, {
          sourceAmountMinor: line.amountMinor,
          updatedAt: now,
        });
        return {
          kind: 'rule_updated',
          previousAmountMinor: rule.amountMinor,
          newAmountMinor: amountMinor,
          fromMonth:
            rule.startMonth > household.currentMonth ? rule.startMonth : household.currentMonth,
          newRuleId: null,
        };
      }
      if (rule.accountId === null) {
        throw new DomainRuleViolationError(
          'Pozycja cykliczna nie ma konta — uzupełnij je na ekranie pozycji cyklicznych.',
        );
      }
      updateRecurringRule(handle, clock, householdId, rule.id, { endMonth: shiftMonth(month, -1) });
      const next = createRecurringRule(handle, clock, householdId, {
        name: rule.name,
        flow: rule.flow,
        amountMinor,
        amountIsEstimate: rule.amountIsEstimate,
        accountId: rule.accountId,
        counterAccountId: rule.counterAccountId,
        categoryId: rule.categoryId,
        incomeSourceId: rule.incomeSourceId,
        goalId: rule.goalId,
        liabilityId: rule.liabilityId,
        allocationOverride: rule.allocationOverride,
        frequency: rule.frequency,
        intervalCount: rule.intervalCount,
        dayOfMonth: rule.dayOfMonth,
        weekday: rule.weekday,
        monthOfYear: rule.monthOfYear,
        startMonth: month,
        endMonth: rule.endMonth,
        autoPost: rule.autoPost,
        isFixedExpense: rule.isFixedExpense,
        notes: rule.notes,
      });
      relinkRuleLines(handle, householdId, rule.id, next.id, month, now);
      patchLine(handle, householdId, line.id, {
        sourceAmountMinor: line.amountMinor,
        updatedAt: now,
      });
      return {
        kind: 'rule_split',
        previousAmountMinor: rule.amountMinor,
        newAmountMinor: amountMinor,
        fromMonth: month,
        newRuleId: next.id,
      };
    }
    if (line.origin === 'planned' && line.plannedExpenseId !== null) {
      const previous = household.plannedExpenses.find((item) => item.id === line.plannedExpenseId);
      const amountMinor = positive(line.amountMinor);
      updatePlannedExpense(handle, clock, householdId, line.plannedExpenseId, {
        estimatedAmountMinor: amountMinor,
      });
      patchLine(handle, householdId, line.id, { sourceAmountMinor: amountMinor, updatedAt: now });
      return {
        kind: 'planned_updated',
        previousAmountMinor: previous?.estimatedAmountMinor ?? source.amountMinor,
        newAmountMinor: amountMinor,
        fromMonth: month,
        newRuleId: null,
      };
    }
    // Zostaje cel kwotowy — `canApplyToSource` wyklucza resztę.
    const goalId = line.goalId ?? '';
    const previous = household.goals.find((goal) => goal.id === goalId);
    const amountMinor = positive(line.amountMinor);
    updateGoal(handle, clock, householdId, goalId, { contributionAmountMinor: amountMinor });
    patchLine(handle, householdId, line.id, { sourceAmountMinor: amountMinor, updatedAt: now });
    return {
      kind: 'goal_updated',
      previousAmountMinor: previous?.plan.contributionAmountMinor ?? source.amountMinor,
      newAmountMinor: amountMinor,
      fromMonth: household.currentMonth,
      newRuleId: null,
    };
  })();

  const after = loadMonth(
    handle,
    clock,
    householdId,
    loadHousehold(handle, clock, householdId),
    month,
  );
  return { draft: draftDto(handle, householdId, after, draft), effect };
}

/**
 * Szkic edytowalny z kontekstem miesiąca — wspólny początek zmian układu.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @returns Szkic i kontekst.
 * @throws {NotFoundError} Gdy szkicu nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 */
function editableDraft(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
): { draft: BudgetDraftRow; context: MonthContext } {
  const draft = requireDraft(handle, householdId, month);
  const context = loadMonth(
    handle,
    clock,
    householdId,
    loadHousehold(handle, clock, householdId),
    month,
  );
  requireEditable(context);
  return { draft, context };
}

/**
 * Nazwa grupy wolna w sekcji — bez względu na wielkość liter (I-25).
 *
 * @param groups - Grupy szkicu.
 * @param section - Sekcja.
 * @param name - Nazwa po przycięciu.
 * @param exceptId - Grupa zmieniana (jej obecna nazwa się nie liczy).
 * @throws {DomainRuleViolationError} Gdy nazwa jest zajęta.
 */
function assertGroupNameFree(
  groups: readonly BudgetDraftGroupRow[],
  section: BudgetSection,
  name: string,
  exceptId: string | null,
): void {
  const wanted = normalizeBudgetName(name);
  const taken = groups.some(
    (group) =>
      group.section === section &&
      group.id !== exceptId &&
      normalizeBudgetName(group.name) === wanted,
  );
  if (taken) {
    throw new DomainRuleViolationError(`Grupa „${name}” już jest w tej sekcji.`, [
      { path: 'name', message: 'Nazwa zajęta' },
    ]);
  }
}

/** Komunikat dla układu rozjechanego z planem (inna karta, drugi domownik). */
const LAYOUT_MISMATCH = 'Układ nie zgadza się z planem — odśwież ekran.';

/**
 * Niewykluczone linie sekcji po identyfikatorze — to, co układ musi objąć (07 §13.10).
 *
 * @param lines - Linie szkicu.
 * @param section - Sekcja.
 * @returns Linie sekcji po identyfikatorze.
 */
function sectionLines(
  lines: readonly BudgetDraftLineRow[],
  section: BudgetSection,
): Map<string, BudgetDraftLineRow> {
  return new Map(
    lines
      .filter((line) => !line.isExcluded && budgetSectionOf(line.flow) === section)
      .map((line) => [line.id, line]),
  );
}

/**
 * Zakłada grupę — `POST /budget-drafts/:month/groups` (07 §13.10, ADR-081).
 *
 * `lineIds` przenosi linie do nowej grupy w podanej kolejności (na koniec szkicu),
 * `position` wstawia grupę między istniejące — razem służą do „Cofnij" usunięcia grupy.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @param input - Sekcja, nazwa, opcjonalnie linie i miejsce.
 * @returns Szkic z nową grupą.
 * @throws {NotFoundError} Gdy szkicu nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 * @throws {DomainRuleViolationError} Przy zajętej nazwie albo linii spoza sekcji.
 */
export function createBudgetGroup(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
  input: CreateBudgetGroupRequest,
): BudgetDraftDto {
  const { draft, context } = editableDraft(handle, clock, householdId, month);
  const groups = findGroups(handle, householdId, [draft.id]);
  assertGroupNameFree(groups, input.section, input.name, null);
  const available = sectionLines(findLines(handle, householdId, [draft.id]), input.section);
  if (
    new Set(input.lineIds).size !== input.lineIds.length ||
    input.lineIds.some((id) => !available.has(id))
  ) {
    throw new DomainRuleViolationError('Do grupy trafiają tylko pozycje jej sekcji.', [
      { path: 'lineIds', message: 'Pozycja spoza sekcji, pominięta albo podana dwa razy' },
    ]);
  }
  const ordered = groups.filter((group) => group.section === input.section);
  const position = Math.min(input.position ?? ordered.length, ordered.length);
  const now = clock.now().getTime();
  const id = newId();
  handle.sqlite.transaction(() => {
    ordered.forEach((group, index) => {
      const sortOrder = index < position ? index : index + 1;
      if (group.sortOrder !== sortOrder) {
        patchGroup(handle, householdId, group.id, { sortOrder, updatedAt: now });
      }
    });
    insertGroups(handle, [
      {
        id,
        householdId,
        draftId: draft.id,
        section: input.section,
        name: input.name,
        sortOrder: position,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    let order = findMaxLineOrder(handle, householdId, draft.id) + 1;
    for (const lineId of input.lineIds) {
      patchLine(handle, householdId, lineId, { groupId: id, sortOrder: order++, updatedAt: now });
    }
  })();
  return draftDto(handle, householdId, context, draft);
}

/**
 * Zmienia nazwę grupy — `PATCH /budget-drafts/:month/groups/:groupId`.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @param groupId - Grupa.
 * @param name - Nowa nazwa po przycięciu.
 * @returns Szkic po zmianie.
 * @throws {NotFoundError} Gdy szkicu albo grupy nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 * @throws {DomainRuleViolationError} Przy zajętej nazwie.
 */
export function renameBudgetGroup(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
  groupId: string,
  name: string,
): BudgetDraftDto {
  const { draft, context } = editableDraft(handle, clock, householdId, month);
  const group = requireGroup(handle, householdId, draft.id, groupId);
  assertGroupNameFree(findGroups(handle, householdId, [draft.id]), group.section, name, group.id);
  patchGroup(handle, householdId, group.id, { name, updatedAt: clock.now().getTime() });
  return draftDto(handle, householdId, context, draft);
}

/**
 * Usuwa grupę — `DELETE /budget-drafts/:month/groups/:groupId`. Linie przechodzą do
 * „Bez grupy" (klucz obcy `ON DELETE SET NULL`), ich kolejność względem siebie zostaje.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @param groupId - Grupa.
 * @returns Szkic po zmianie.
 * @throws {NotFoundError} Gdy szkicu albo grupy nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 */
export function deleteBudgetGroup(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
  groupId: string,
): BudgetDraftDto {
  const { draft, context } = editableDraft(handle, clock, householdId, month);
  removeGroup(handle, householdId, requireGroup(handle, householdId, draft.id, groupId).id);
  return draftDto(handle, householdId, context, draft);
}

/**
 * Szybki start — `POST /budget-drafts/:month/groups/by-origin` (07 §13.10): grupy
 * „Stałe", „Planowane" i „Zmienne" według pochodzenia linii, bez pustych.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @param section - Sekcja do podziału.
 * @returns Szkic z grupami.
 * @throws {NotFoundError} Gdy szkicu nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 * @throws {DomainRuleViolationError} Gdy sekcja ma już grupy albo nie ma pozycji.
 */
export function groupBudgetByOrigin(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
  section: BudgetSection,
): BudgetDraftDto {
  const { draft, context } = editableDraft(handle, clock, householdId, month);
  if (findGroups(handle, householdId, [draft.id]).some((group) => group.section === section)) {
    throw new DomainRuleViolationError('Ta sekcja ma już grupy.', [
      { path: 'section', message: 'Sekcja z grupami' },
    ]);
  }
  const lines = [
    ...sectionLines(
      sortBudgetLines([], findLines(handle, householdId, [draft.id])),
      section,
    ).values(),
  ];
  const split = groupsByOrigin(lines);
  if (split.length === 0) {
    throw new DomainRuleViolationError('W tej sekcji nie ma pozycji do podziału.', [
      { path: 'section', message: 'Brak pozycji' },
    ]);
  }
  const now = clock.now().getTime();
  handle.sqlite.transaction(() => {
    split.forEach((group, index) => {
      const id = newId();
      insertGroups(handle, [
        {
          id,
          householdId,
          draftId: draft.id,
          section,
          name: group.name,
          sortOrder: index,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      for (const lineId of group.lineIds) {
        patchLine(handle, householdId, lineId, { groupId: id, updatedAt: now });
      }
    });
  })();
  return draftDto(handle, householdId, context, draft);
}

/**
 * Zapisuje układ jednej sekcji — `PATCH /budget-drafts/:month/layout` (07 §13.10).
 *
 * Układ musi objąć każdą grupę sekcji i każdą niewykluczoną linię sekcji dokładnie raz;
 * inaczej ekran układał nieaktualny stan (druga karta, drugi domownik) i zapis by go
 * nadpisał. Linie wykluczone zachowują grupę i miejsce.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @param input - Grupy z liniami i linie bez grupy, w kolejności ekranu.
 * @returns Szkic w nowym układzie.
 * @throws {NotFoundError} Gdy szkicu nie ma.
 * @throws {ConflictError} Dla szkicu minionego miesiąca.
 * @throws {DomainRuleViolationError} Gdy układ nie zgadza się z planem.
 */
export function updateBudgetLayout(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
  input: UpdateBudgetLayoutRequest,
): BudgetDraftDto {
  const { draft, context } = editableDraft(handle, clock, householdId, month);
  const groupIds = new Set(
    findGroups(handle, householdId, [draft.id])
      .filter((group) => group.section === input.section)
      .map((group) => group.id),
  );
  const available = sectionLines(findLines(handle, householdId, [draft.id]), input.section);
  const placed = [
    ...input.groups.flatMap((group) =>
      group.lineIds.map((lineId) => ({ lineId, groupId: group.id })),
    ),
    ...input.ungroupedLineIds.map((lineId) => ({ lineId, groupId: null })),
  ];
  const requestedGroups = new Set(input.groups.map((group) => group.id));
  const requestedLines = new Set(placed.map((item) => item.lineId));
  const matches =
    requestedGroups.size === input.groups.length &&
    requestedGroups.size === groupIds.size &&
    [...requestedGroups].every((id) => groupIds.has(id)) &&
    requestedLines.size === placed.length &&
    requestedLines.size === available.size &&
    [...requestedLines].every((id) => available.has(id));
  if (!matches) throw new DomainRuleViolationError(LAYOUT_MISMATCH);

  const now = clock.now().getTime();
  handle.sqlite.transaction(() => {
    input.groups.forEach((group, index) => {
      patchGroup(handle, householdId, group.id, { sortOrder: index, updatedAt: now });
    });
    placed.forEach((item, index) => {
      const line = available.get(item.lineId);
      if (line === undefined || (line.groupId === item.groupId && line.sortOrder === index)) return;
      patchLine(handle, householdId, item.lineId, {
        groupId: item.groupId,
        sortOrder: index,
        updatedAt: now,
      });
    });
  })();
  return draftDto(handle, householdId, context, draft);
}
