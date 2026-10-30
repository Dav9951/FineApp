import {
  GOAL_PACE_MONTHS,
  goalIssues,
  goalPace,
  goalProgress,
  goalTransferSign,
  monthKeyOf,
  monthsBetween,
  normalizeGoalPlan,
  plannedContribution,
  projectGoal,
  shiftMonth,
  todayInTimezone,
  toBps,
  fromBps,
  type ConvertContributionRequest,
  type ConvertContributionResponse,
  type CreateGoalRequest,
  type GoalContributionDto,
  type GoalContributionRequest,
  type GoalContributionResultDto,
  type GoalDetailDto,
  type GoalDto,
  type GoalsListMeta,
  type ListGoalsQuery,
  type MonthKey,
  type ReorderGoalsRequest,
  type TransactionMutationMeta,
  type UpdateGoalRequest,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import { ConflictError, DomainRuleViolationError, NotFoundError } from '../../core/errors.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import type { GoalRow } from '../../db/schema/goals.js';
import { getAccountBalances, lookupAccount } from '../accounts/accounts.service.js';
import { getHousehold } from '../auth/auth.service.js';
import {
  accountNetByMonth,
  allocationSumsByMonth,
  goalTransfers,
  type GoalTransfer,
} from '../transactions/transactions.ledger.js';
import { createTransaction, listTransactions } from '../transactions/transactions.service.js';
import { toGoalDto } from './goals.mapper.js';
import {
  findGoalById,
  findGoals,
  insertGoal,
  markGoalsAchieved,
  maxGoalPriority,
  patchGoal,
  removeGoal,
  setGoalPriorities,
  type GoalPatch,
} from './goals.repository.js';

/**
 * Cele — zadania `F5-1` i `F5-2`
 * ([04 §10](../../../../../../plans/04-api-spec.md#10-cele--apiv1goals),
 * [07 §3–§4](../../../../../../plans/07-domain-rules.md#4-cele), ADR-052).
 *
 * Postęp nie jest zapisywany: liczą go przy każdym odczycie czyste funkcje z
 * `shared/domain/goal.ts` — z przelewów oznaczonych celem (tryb `contributions`) albo
 * z salda powiązanego konta (tryb `account_balance`). Wpłata na cel to zwykły przelew
 * z `goalId`, tworzony przez serwis transakcji — te same niezmienniki i okno księgowania.
 */

/** Komunikat dla celu spoza gospodarstwa albo nieistniejącego — celowo ten sam. */
const NOT_FOUND = 'Nie znaleziono celu.';

/** Ile ostatnich wpłat pokazują szczegóły. */
const CONTRIBUTIONS_LIMIT = 24;

/**
 * Wspólne dane do wyliczenia celów — pobierane raz na odpowiedź, nie raz na cel.
 */
interface GoalContext {
  /** Bieżący miesiąc gospodarstwa — od niego liczy się prognoza. */
  readonly currentMonth: MonthKey;
  /** Miesiąc planu wpłat (`?month=`). */
  readonly month: MonthKey;
  /** Podstawa przelicznika w miesiącu planu. */
  readonly incomeBaseMinor: number;
  /** Podstawa w bieżącym miesiącu — plan jako tempo przy krótkiej historii (07 §4.2). */
  readonly currentIncomeBaseMinor: number;
  readonly isPartialMonth: boolean;
  /** Miesiące tempa: sześć do bieżącego włącznie. */
  readonly paceMonths: readonly MonthKey[];
  readonly transfers: ReadonlyMap<string, readonly GoalTransfer[]>;
  /** Saldo na dziś kont powiązanych z celami śledzonymi saldem. */
  readonly balances: ReadonlyMap<string, number>;
  /** Ruch netto kont celów śledzonych saldem: konto → miesiąc → kwota. */
  readonly accountNets: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

/**
 * Czy cel śledzi postęp saldem konta — tylko z kontem; konto usunięte (`SET NULL`)
 * przełącza liczenie na wpłaty, zamiast pokazywać zero.
 *
 * @param row - Wiersz celu.
 * @returns Identyfikator konta albo `null`.
 */
function balanceAccountOf(row: GoalRow): string | null {
  return row.progressSource === 'account_balance' ? row.linkedAccountId : null;
}

/**
 * Zbiera dane do wyliczenia celów.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param rows - Cele do wyliczenia.
 * @param month - Miesiąc planu; pominięty — bieżący.
 * @returns Kontekst.
 */
function buildContext(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  rows: readonly GoalRow[],
  month: MonthKey | undefined,
): GoalContext {
  const household = getHousehold(handle, householdId);
  const today = todayInTimezone(household.timezone, clock.now());
  const currentMonth = monthKeyOf(today, household.monthStartDay);
  const planMonth = month ?? currentMonth;
  const paceFrom = shiftMonth(currentMonth, 1 - GOAL_PACE_MONTHS);
  const rangeFrom = planMonth < paceFrom ? planMonth : paceFrom;
  const rangeTo = planMonth > currentMonth ? planMonth : currentMonth;

  const sums = allocationSumsByMonth(handle, householdId, planMonth, planMonth);
  const currentSums = allocationSumsByMonth(handle, householdId, currentMonth, currentMonth);

  const transfers = new Map<string, GoalTransfer[]>();
  for (const transfer of goalTransfers(handle, householdId)) {
    const list = transfers.get(transfer.goalId) ?? [];
    list.push(transfer);
    transfers.set(transfer.goalId, list);
  }

  const accountIds = [
    ...new Set(rows.map(balanceAccountOf).filter((id): id is string => id !== null)),
  ];
  const balances = new Map<string, number>();
  const accountNets = new Map<string, Map<string, number>>();
  if (accountIds.length > 0) {
    for (const item of getAccountBalances(handle, clock, householdId, {}).data) {
      balances.set(item.accountId, item.balanceMinor);
    }
    for (const net of accountNetByMonth(handle, householdId, accountIds, rangeFrom, rangeTo)) {
      const byMonth = accountNets.get(net.accountId) ?? new Map<string, number>();
      byMonth.set(net.monthKey, net.netMinor);
      accountNets.set(net.accountId, byMonth);
    }
  }

  return {
    currentMonth,
    month: planMonth,
    incomeBaseMinor: sums.get(planMonth)?.incomeBaseMinor ?? 0,
    currentIncomeBaseMinor: currentSums.get(currentMonth)?.incomeBaseMinor ?? 0,
    isPartialMonth: planMonth >= currentMonth,
    paceMonths: monthsBetween(paceFrom, currentMonth),
    transfers,
    balances,
    accountNets,
  };
}

/**
 * Wpłaty netto na cel w miesiącu: przelewy oznaczone celem (ze znakiem kierunku) albo —
 * przy śledzeniu saldem — ruch netto na koncie celu.
 *
 * @param row - Wiersz celu.
 * @param context - Kontekst.
 * @param month - Miesiąc.
 * @returns Kwota netto; ujemna, gdy z celu wypłacono więcej, niż wpłacono.
 */
function monthNet(row: GoalRow, context: GoalContext, month: MonthKey): number {
  const account = balanceAccountOf(row);
  if (account !== null) return context.accountNets.get(account)?.get(month) ?? 0;
  return (context.transfers.get(row.id) ?? [])
    .filter((transfer) => transfer.monthKey === month)
    .reduce((sum, transfer) => sum + goalTransferSign(row, transfer) * transfer.amountMinor, 0);
}

/**
 * Zebrana kwota przed przycięciem do zera (07 §4.1).
 *
 * @param row - Wiersz celu.
 * @param context - Kontekst.
 * @returns Saldo konta celu albo kwota początkowa plus wpłaty netto.
 */
function rawAmountOf(row: GoalRow, context: GoalContext): number {
  const account = balanceAccountOf(row);
  if (account !== null) return context.balances.get(account) ?? 0;
  return (context.transfers.get(row.id) ?? []).reduce(
    (sum, transfer) => sum + goalTransferSign(row, transfer) * transfer.amountMinor,
    row.startingAmountMinor,
  );
}

/**
 * Wylicza DTO celu z wiersza i kontekstu.
 *
 * @param row - Wiersz celu.
 * @param context - Kontekst.
 * @returns DTO.
 */
function computeGoal(row: GoalRow, context: GoalContext): GoalDto {
  const progress = goalProgress(rawAmountOf(row, context), row.targetAmountMinor);
  const plan = plannedContribution(row, context.incomeBaseMinor);
  const contributed = monthNet(row, context, context.month);
  const contribution: GoalContributionDto = {
    mode: row.contributionMode,
    plannedAmountMinor: plan.plannedAmountMinor,
    plannedPercentBps: plan.plannedPercentBps,
    contributedThisMonthMinor: contributed,
    isPlanMetThisMonth: plan.plannedAmountMinor !== null && contributed >= plan.plannedAmountMinor,
  };
  const history = context.paceMonths.map((month) => monthNet(row, context, month));
  const planNow = plannedContribution(row, context.currentIncomeBaseMinor).plannedAmountMinor;
  const projection = projectGoal(
    progress.remainingMinor,
    row.targetDate,
    goalPace(history, planNow),
    context.currentMonth,
  );
  return toGoalDto(row, progress, contribution, projection);
}

/**
 * Wylicza cele i oznacza jako osiągnięte te, które doszły do kwoty docelowej (07 §4.3).
 *
 * Osiągnięcie wykrywa odczyt — wpłata może przyjść z dowolnego miejsca (formularz,
 * pozycja cykliczna, saldo konta), a jedno miejsce sprawdzenia nie zgubi żadnej drogi.
 * Kolejne wpłaty są nadal możliwe; cel nie jest zamykany.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param rows - Wiersze celów.
 * @param context - Kontekst.
 * @returns DTO w kolejności wierszy.
 */
function computeGoals(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  rows: readonly GoalRow[],
  context: GoalContext,
): GoalDto[] {
  const dtos = rows.map((row) => computeGoal(row, context));
  const reached = dtos.filter(
    (dto) => dto.status === 'active' && dto.remainingMinor === 0 && dto.targetAmountMinor !== null,
  );
  if (reached.length === 0) return dtos;

  const now = clock.now().getTime();
  markGoalsAchieved(
    handle,
    householdId,
    reached.map((dto) => dto.id),
    now,
  );
  const ids = new Set(reached.map((dto) => dto.id));
  return dtos.map((dto) =>
    ids.has(dto.id) ? { ...dto, status: 'achieved', achievedAt: now, updatedAt: now } : dto,
  );
}

/**
 * Jeden cel jako DTO — plan wpłat dla bieżącego miesiąca.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param row - Wiersz celu.
 * @returns DTO.
 */
function dtoOf(handle: DbHandle, clock: Clock, householdId: string, row: GoalRow): GoalDto {
  const context = buildContext(handle, clock, householdId, [row], undefined);
  const [dto] = computeGoals(handle, clock, householdId, [row], context);
  if (dto === undefined) throw new NotFoundError(NOT_FOUND);
  return dto;
}

/**
 * Zwraca cel albo rzuca `404`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param goalId - Identyfikator celu.
 * @returns Wiersz.
 * @throws {NotFoundError} Gdy celu nie ma w gospodarstwie.
 */
function requireGoal(handle: DbHandle, householdId: string, goalId: string): GoalRow {
  const row = findGoalById(handle, householdId, goalId);
  if (row === undefined) throw new NotFoundError(NOT_FOUND);
  return row;
}

/**
 * Sprawdza reguły między polami (`goalIssues`, I-14) i rzuca `422` z listą problemów.
 *
 * @param value - Pola celu (przy edycji — po scaleniu).
 * @throws {DomainRuleViolationError} Gdy pola się wykluczają.
 */
function assertIssues(value: Parameters<typeof goalIssues>[0]): void {
  const issues = goalIssues(value);
  const [first] = issues;
  if (first !== undefined) throw new DomainRuleViolationError(`${first.message}.`, issues);
}

/**
 * Sprawdza powiązane konto: istnieje w gospodarstwie i nie jest w archiwum.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param accountId - Konto z żądania; `undefined` i `null` nie są sprawdzane.
 * @param path - Pole formularza do podświetlenia.
 * @throws {NotFoundError} Gdy konta nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Gdy konto jest zarchiwizowane.
 */
function checkAccount(
  handle: DbHandle,
  householdId: string,
  accountId: string | null | undefined,
  path: string,
): void {
  if (!accountId) return;
  const account = lookupAccount(handle, householdId, accountId);
  if (account === undefined) {
    throw new NotFoundError('Nie znaleziono konta.', [{ path, message: 'Nie znaleziono konta' }]);
  }
  if (account.isArchived) {
    throw new DomainRuleViolationError(`Konto „${account.name}” jest zarchiwizowane.`, [
      { path, message: 'Konto jest zarchiwizowane' },
    ]);
  }
}

/**
 * Lista celów z postępem i planem miesiąca (04 §10).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Miesiąc planu, rodzaj, archiwum.
 * @returns Cele w kolejności priorytetu i podsumowanie planu miesiąca.
 */
export function listGoals(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  query: ListGoalsQuery,
): { data: GoalDto[]; meta: GoalsListMeta } {
  const rows = findGoals(handle, householdId, {
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    includeArchived: query.includeArchived ?? false,
  });
  const context = buildContext(handle, clock, householdId, rows, query.month);
  const data = computeGoals(handle, clock, householdId, rows, context);
  const active = data.filter((goal) => goal.status === 'active');
  return {
    data,
    meta: {
      month: context.month,
      incomeBaseMinor: context.incomeBaseMinor,
      isPartialMonth: context.isPartialMonth,
      plannedTotalMinor: active.reduce(
        (sum, goal) => sum + (goal.contribution.plannedAmountMinor ?? 0),
        0,
      ),
      contributedTotalMinor: active.reduce(
        (sum, goal) => sum + goal.contribution.contributedThisMonthMinor,
        0,
      ),
    },
  };
}

/**
 * Cele na kafel dashboardu (`F5-8`): aktywne, z planem oglądanego miesiąca.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Oglądany miesiąc.
 * @returns Aktywne cele w kolejności priorytetu.
 */
export function goalsForMonth(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
): GoalDto[] {
  return listGoals(handle, clock, householdId, { month, includeArchived: false }).data.filter(
    (goal) => goal.status === 'active',
  );
}

/**
 * Szczegóły celu z historią wpłat (04 §10).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param goalId - Identyfikator celu.
 * @returns Cel, ostatnie wpłaty i wpłaty miesiąc po miesiącu.
 * @throws {NotFoundError} Gdy celu nie ma w gospodarstwie.
 */
export function getGoal(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  goalId: string,
): GoalDetailDto {
  const row = requireGoal(handle, householdId, goalId);
  const context = buildContext(handle, clock, householdId, [row], undefined);
  const [dto] = computeGoals(handle, clock, householdId, [row], context);
  if (dto === undefined) throw new NotFoundError(NOT_FOUND);
  const contributions = listTransactions(handle, householdId, {
    goalId: [goalId],
    type: ['transfer'],
    limit: CONTRIBUTIONS_LIMIT,
    sort: 'bookedOn:desc',
    uncategorized: false,
    includeDeleted: false,
  });
  return {
    ...dto,
    contributions: contributions.data,
    history: context.paceMonths.map((month) => ({
      month,
      amountMinor: monthNet(row, context, month),
    })),
  };
}

/**
 * Zakłada cel.
 *
 * Zapisywana jest tylko strona przelicznika zgodna z trybem (07 §3); nowy cel trafia
 * na koniec listy priorytetów.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Pola celu.
 * @returns Założony cel.
 * @throws {DomainRuleViolationError} Przy wykluczających się polach albo koncie z archiwum.
 * @throws {NotFoundError} Gdy konto nie należy do gospodarstwa.
 */
export function createGoal(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  input: CreateGoalRequest,
): GoalDto {
  const now = clock.now().getTime();
  const row = handle.sqlite.transaction(() => {
    assertIssues(input);
    checkAccount(handle, householdId, input.linkedAccountId, 'linkedAccountId');
    const plan = normalizeGoalPlan({
      contributionMode: input.contributionMode,
      contributionAmountMinor: input.contributionAmountMinor ?? null,
      contributionPercentBps: input.contributionPercentBps ?? null,
    });
    return insertGoal(handle, {
      id: newId(),
      householdId,
      name: input.name,
      kind: input.kind,
      purpose: input.purpose ?? null,
      targetAmountMinor: input.targetAmountMinor ?? null,
      targetDate: input.targetDate ?? null,
      startingAmountMinor: input.startingAmountMinor,
      linkedAccountId: input.linkedAccountId ?? null,
      progressSource: input.progressSource,
      ...plan,
      priority: maxGoalPriority(handle, householdId) + 1,
      color: input.color ?? null,
      icon: input.icon ?? null,
      createdAt: now,
      updatedAt: now,
    });
  })();
  return dtoOf(handle, clock, householdId, row);
}

/** Pola, które edycja może zmienić — w kolejności z kontraktu. */
const EDITABLE_FIELDS = [
  'name',
  'kind',
  'purpose',
  'targetAmountMinor',
  'targetDate',
  'startingAmountMinor',
  'linkedAccountId',
  'progressSource',
  'contributionMode',
  'contributionAmountMinor',
  'contributionPercentBps',
  'color',
  'icon',
  'status',
] as const satisfies readonly (keyof UpdateGoalRequest & keyof GoalRow)[];

/**
 * Zmienia cel.
 *
 * Zmieniane są wyłącznie pola, które się różnią; reguły między polami — po scaleniu,
 * a plan normalizowany do trybu (07 §3). Powrót do `active` czyści `achievedAt` — cel
 * znów się liczy; jeśli nadal ma zebraną kwotę docelową, następny odczyt oznaczy go
 * ponownie (podniesienie kwoty docelowej to właściwa droga, 07 §4.3).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param goalId - Identyfikator celu.
 * @param input - Zmiany.
 * @returns Cel po zmianie.
 * @throws {NotFoundError} Gdy celu albo konta nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Przy wykluczających się polach albo archiwum.
 */
export function updateGoal(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  goalId: string,
  input: UpdateGoalRequest,
): GoalDto {
  const now = clock.now().getTime();
  const row = handle.sqlite.transaction(() => {
    const current = requireGoal(handle, householdId, goalId);
    const patch: GoalPatch = {};
    for (const field of EDITABLE_FIELDS) {
      const value = input[field];
      if (value !== undefined && value !== current[field]) Object.assign(patch, { [field]: value });
    }
    if (Object.keys(patch).length === 0) return current;

    const merged = { ...current, ...patch };
    assertIssues(merged);
    checkAccount(handle, householdId, patch.linkedAccountId, 'linkedAccountId');
    Object.assign(patch, normalizeGoalPlan(merged));
    if (patch.status === 'active') patch.achievedAt = null;
    const updated = patchGoal(handle, householdId, goalId, patch, now);
    if (updated === undefined) throw new NotFoundError(NOT_FOUND);
    return updated;
  })();
  return dtoOf(handle, clock, householdId, row);
}

/**
 * Usuwa cel. Wpłaty zostają w księdze, tracąc powiązanie (07 §10).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param goalId - Identyfikator celu.
 * @throws {NotFoundError} Gdy celu nie ma w gospodarstwie.
 */
export function deleteGoal(handle: DbHandle, householdId: string, goalId: string): void {
  if (!removeGoal(handle, householdId, goalId)) throw new NotFoundError(NOT_FOUND);
}

/**
 * Oznacza cel jako osiągnięty ręcznie — np. mieszkanie kupione przed zebraniem całej
 * kwoty (04 §10).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param goalId - Identyfikator celu.
 * @returns Cel po zmianie; osiągnięty wcześniej zostaje z pierwotną datą.
 * @throws {NotFoundError} Gdy celu nie ma w gospodarstwie.
 */
export function completeGoal(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  goalId: string,
): GoalDto {
  const current = requireGoal(handle, householdId, goalId);
  if (current.status === 'achieved') return dtoOf(handle, clock, householdId, current);
  const now = clock.now().getTime();
  const row = patchGoal(handle, householdId, goalId, { status: 'achieved', achievedAt: now }, now);
  if (row === undefined) throw new NotFoundError(NOT_FOUND);
  return dtoOf(handle, clock, householdId, row);
}

/**
 * Zmienia kolejność celów (`PATCH /goals/order`).
 *
 * Lista musi zawierać dokładnie wszystkie cele gospodarstwa — częściowa kolejność
 * zostawiłaby resztę z priorytetami, które się z nią zderzają.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Identyfikatory od najważniejszego.
 * @returns Cele w nowej kolejności (bez archiwum).
 * @throws {DomainRuleViolationError} Gdy lista nie jest permutacją celów gospodarstwa.
 */
export function reorderGoals(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  input: ReorderGoalsRequest,
): GoalDto[] {
  handle.sqlite.transaction(() => {
    const all = findGoals(handle, householdId, { includeArchived: true });
    const known = new Set(all.map((row) => row.id));
    const given = new Set(input.ids);
    if (
      given.size !== input.ids.length ||
      given.size !== known.size ||
      input.ids.some((id) => !known.has(id))
    ) {
      throw new DomainRuleViolationError('Kolejność musi obejmować każdy cel dokładnie raz.', [
        { path: 'ids', message: 'Lista celów się nie zgadza' },
      ]);
    }
    setGoalPriorities(handle, householdId, input.ids, clock.now().getTime());
  })();
  return listGoals(handle, clock, householdId, { includeArchived: false }).data;
}

/**
 * Wpłata na cel — przelew z `goalId` (04 §10).
 *
 * Konto docelowe: z żądania albo powiązane z celem. Przelew tworzy serwis transakcji,
 * więc obowiązują te same niezmienniki (I-2: różne konta) i okno księgowania; efekt
 * alokacji wynika z klas kont jak przy każdym przelewie. Idempotencję względem
 * `Idempotency-Key` zapewnia trasa.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor przelewu z tokenu.
 * @param goalId - Identyfikator celu.
 * @param input - Kwota, konta, data, notatka.
 * @returns Cel po wpłacie, przelew i miesiące do unieważnienia.
 * @throws {NotFoundError} Gdy celu albo konta nie ma w gospodarstwie.
 * @throws {ConflictError} Gdy cel jest w archiwum.
 * @throws {DomainRuleViolationError} Gdy brak konta docelowego albo przelew łamie niezmienniki.
 */
export function contributeToGoal(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  goalId: string,
  input: GoalContributionRequest,
): { data: GoalContributionResultDto; meta: TransactionMutationMeta } {
  const { row, transaction } = handle.sqlite.transaction(() => {
    const current = requireGoal(handle, householdId, goalId);
    if (current.status === 'archived') {
      throw new ConflictError('Cel jest w archiwum — przywróć go, żeby wpłacić.');
    }
    const toAccountId = input.toAccountId ?? current.linkedAccountId;
    if (toAccountId === null) {
      throw new DomainRuleViolationError(
        'Cel nie ma powiązanego konta — wskaż konto, na które wpłacasz.',
        [{ path: 'toAccountId', message: 'Wybierz konto' }],
      );
    }
    const household = getHousehold(handle, householdId);
    const { data } = createTransaction(handle, clock, householdId, userId, {
      type: 'transfer',
      bookedOn: input.bookedOn ?? todayInTimezone(household.timezone, clock.now()),
      amountMinor: input.amountMinor,
      accountId: input.fromAccountId,
      counterAccountId: toAccountId,
      goalId,
      description: current.name,
      notes: input.notes ?? null,
    });
    return { row: current, transaction: data };
  })();
  return {
    data: { goal: dtoOf(handle, clock, householdId, row), transaction },
    meta: { affectedMonths: [transaction.monthKey] },
  };
}

/** Udział, który mieści kontrakt (`BpsSchema`) — 1000%. */
const MAX_BPS = 100_000;

/**
 * Przelicznik % ↔ kwota względem wpływów miesiąca (wymaganie #6, 07 §3), bez zapisu.
 *
 * Miesiąc trwający (i przyszły) liczy z dotychczasowych wpływów — podstawa może urosnąć,
 * co UI dopisuje jako zastrzeżenie. Przy zerowej podstawie procent wynosi `0`, kwota `0`.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Miesiąc i dokładnie jedna strona.
 * @returns Obie strony i podstawa.
 */
export function convertContribution(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  input: ConvertContributionRequest,
): ConvertContributionResponse {
  const household = getHousehold(handle, householdId);
  const currentMonth = monthKeyOf(
    todayInTimezone(household.timezone, clock.now()),
    household.monthStartDay,
  );
  const base =
    allocationSumsByMonth(handle, householdId, input.month, input.month).get(input.month)
      ?.incomeBaseMinor ?? 0;
  const isPartialMonth = input.month >= currentMonth;
  const amountMinor = input.amountMinor ?? fromBps(input.percentBps ?? 0, base);
  const percentBps = input.percentBps ?? Math.min(MAX_BPS, toBps(input.amountMinor ?? 0, base));
  return {
    month: input.month,
    incomeBaseMinor: base,
    amountMinor,
    percentBps,
    isPartialMonth,
    basedOnIncomeSoFar: isPartialMonth,
  };
}
