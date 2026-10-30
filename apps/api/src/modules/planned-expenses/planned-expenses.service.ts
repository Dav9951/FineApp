import {
  ACTIVE_PLANNED_STATUSES,
  derivedPlannedStatus,
  detectLiquidityWarnings,
  expectedSetAsideMinor,
  formatMinor,
  formatMonth,
  monthKeyOf,
  monthsBetween,
  monthsDiff,
  monthsLeftUntil,
  nextYearlyInstance,
  plannedExpenseIssues,
  setAsideState,
  shiftMonth,
  todayInTimezone,
  type CreatePlannedExpenseRequest,
  type DeferPlannedExpenseRequest,
  type LiquidityWarning,
  type LiquidityWarningDto,
  type ListPlannedExpensesQuery,
  type MonthKey,
  type MonthPlannedExpensesSectionDto,
  type PlannedExpenseDetailDto,
  type PlannedExpenseDto,
  type PostPlannedExpenseRequest,
  type PostPlannedExpenseResultDto,
  type SetAsideContributionRequest,
  type SetAsideResultDto,
  type TransactionMutationMeta,
  type UpcomingExpensesMeta,
  type UpdatePlannedExpenseRequest,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import { ConflictError, DomainRuleViolationError, NotFoundError } from '../../core/errors.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import type { PlannedExpenseRow } from '../../db/schema/planned-expenses.js';
import { getAccountBalances, lookupAccount } from '../accounts/accounts.service.js';
import { getHousehold } from '../auth/auth.service.js';
import { lookupCategory } from '../categories/categories.service.js';
import { goalLinkedAccount } from '../goals/goals.external.js';
import { pendingRecurringNet } from '../recurring/recurring.external.js';
import { plannedSetAside, type PlannedSetAside } from '../transactions/transactions.ledger.js';
import { checkTransactionReferences } from '../transactions/transactions.references.js';
import { createTransaction, listTransactions } from '../transactions/transactions.service.js';
import { toPlannedExpenseDto } from './planned-expenses.mapper.js';
import {
  findNextInstance,
  findPlannedExpenseById,
  findPlannedExpenses,
  insertPlannedExpense,
  patchPlannedExpense,
  removePlannedExpense,
  type PlannedExpensePatch,
} from './planned-expenses.repository.js';

/**
 * Planowane wydatki — zadania `F6-1`…`F6-5`
 * ([04 §9a](../../../../../../plans/04-api-spec.md#9a-planowane-wydatki--apiv1planned-expenses),
 * [07 §6.5](../../../../../../plans/07-domain-rules.md#65-planowane-wydatki), ADR-055).
 *
 * Rata odkładania, pokrycie i status nie są zapisywane na stałe: liczą je przy każdym
 * odczycie czyste funkcje z `shared/domain/planned-expense.ts`. Status `planned` /
 * `funding` / `ready` jest przy odczycie synchronizowany z bazą, żeby filtry listy
 * i dashboard widziały to samo co DTO. Wpłata na odkładanie to przelew, zapłata —
 * wydatek; oba z `plannedExpenseId`, tworzone przez serwis transakcji.
 */

/** Komunikat dla wydatku spoza gospodarstwa albo nieistniejącego — celowo ten sam. */
const NOT_FOUND = 'Nie znaleziono planowanego wydatku.';

/** Ile wpłat pokazują szczegóły. */
const HISTORY_LIMIT = 24;

/** Horyzont kafla „Nadchodzące" (06 §3.10). */
const DASHBOARD_HORIZON_MONTHS = 6;

/** Ile wydatków mieści kafel. */
const DASHBOARD_ITEMS = 3;

/** „Dziś" gospodarstwa. */
interface HouseholdNow {
  readonly today: string;
  readonly currentMonth: MonthKey;
}

/**
 * Dzisiejsza data i bieżący miesiąc gospodarstwa (07 §1.1).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Dziś i bieżący miesiąc.
 */
function householdNow(handle: DbHandle, clock: Clock, householdId: string): HouseholdNow {
  const household = getHousehold(handle, householdId);
  const today = todayInTimezone(household.timezone, clock.now());
  return { today, currentMonth: monthKeyOf(today, household.monthStartDay) };
}

/**
 * Miesiąc startu odkładania: zapisany albo — dla starszych wierszy — termin.
 *
 * @param row - Wiersz wydatku.
 * @returns Miesiąc `YYYY-MM`.
 */
function startMonthOf(row: PlannedExpenseRow): MonthKey {
  return row.setAsideStartMonth ?? row.dueMonth;
}

/**
 * Wylicza DTO i status wydatku; zmieniony status zapisuje (synchronizacja przy odczycie).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param row - Wiersz wydatku.
 * @param sums - Wpłaty na odkładanie gospodarstwa.
 * @param now - „Dziś" gospodarstwa.
 * @param at - Znacznik zapisu statusu.
 * @returns DTO.
 */
function computeDto(
  handle: DbHandle,
  householdId: string,
  row: PlannedExpenseRow,
  sums: ReadonlyMap<string, PlannedSetAside>,
  now: HouseholdNow,
  at: number,
): PlannedExpenseDto {
  const paid = sums.get(row.id);
  const startMonth = startMonthOf(row);
  const state = setAsideState(
    {
      estimatedAmountMinor: row.estimatedAmountMinor,
      setAsideEnabled: row.setAsideEnabled,
      alreadySetAsideMinor: row.alreadySetAsideMinor,
      contributedMinor: paid?.contributedMinor ?? 0,
      paidThisMonth: (paid?.inMonthMinor ?? 0) > 0,
      setAsideStartMonth: startMonth,
      dueMonth: row.dueMonth,
    },
    now.currentMonth,
  );
  const status = derivedPlannedStatus(row.status, state, row.dueMonth, now.currentMonth);
  if (status !== row.status) {
    patchPlannedExpense(handle, householdId, row.id, { status }, at);
  }
  const category =
    row.categoryId === null ? undefined : lookupCategory(handle, householdId, row.categoryId);
  return toPlannedExpenseDto(row, {
    state,
    status,
    startMonth,
    monthsLeft: monthsLeftUntil(now.currentMonth, row.dueMonth),
    monthsUntilDue: monthsDiff(now.currentMonth, row.dueMonth),
    categoryName: category?.name ?? null,
  });
}

/**
 * Wiele wierszy jako DTO — wpłaty z księgi pobrane raz.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param rows - Wiersze.
 * @returns DTO w kolejności wierszy.
 */
function dtosOf(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  rows: readonly PlannedExpenseRow[],
): PlannedExpenseDto[] {
  const now = householdNow(handle, clock, householdId);
  const sums = plannedSetAside(handle, householdId, now.currentMonth);
  const at = clock.now().getTime();
  return rows.map((row) => computeDto(handle, householdId, row, sums, now, at));
}

/**
 * Jeden wiersz jako DTO.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param row - Wiersz.
 * @returns DTO.
 */
function dtoOf(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  row: PlannedExpenseRow,
): PlannedExpenseDto {
  const [dto] = dtosOf(handle, clock, householdId, [row]);
  if (dto === undefined) throw new NotFoundError(NOT_FOUND);
  return dto;
}

/**
 * Zwraca wydatek albo rzuca `404`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator wydatku.
 * @returns Wiersz.
 * @throws {NotFoundError} Gdy wydatku nie ma w gospodarstwie.
 */
function requireExpense(handle: DbHandle, householdId: string, id: string): PlannedExpenseRow {
  const row = findPlannedExpenseById(handle, householdId, id);
  if (row === undefined) throw new NotFoundError(NOT_FOUND);
  return row;
}

/**
 * Wydatek zapłacony albo odwołany nie przyjmuje już zmian stanu — `409`.
 *
 * @param row - Wiersz wydatku.
 * @throws {ConflictError} Gdy wydatek jest `posted` albo `cancelled`.
 */
function assertOpen(row: PlannedExpenseRow): void {
  if (row.status === 'posted') {
    throw new ConflictError(`„${row.name}” jest już zapłacony — cofnij zapłatę, żeby go zmienić.`);
  }
  if (row.status === 'cancelled') {
    throw new ConflictError(`„${row.name}” jest odwołany.`);
  }
}

/**
 * Sprawdza reguły między polami (I-16, I-17, I-19) i rzuca `422`.
 *
 * @param value - Pola wydatku (przy edycji — po scaleniu).
 * @throws {DomainRuleViolationError} Gdy pola się wykluczają.
 */
function assertIssues(value: Parameters<typeof plannedExpenseIssues>[0]): void {
  const issues = plannedExpenseIssues(value);
  const [first] = issues;
  if (first !== undefined) throw new DomainRuleViolationError(`${first.message}.`, issues);
}

/**
 * Sprawdza odwołania: konto płatności, kategorię wydatku i zobowiązanie jak w transakcji
 * wydatkowej (zapłata z nich powstanie), konto i cel odkładania.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param refs - Zmieniane odwołania; `undefined` i `null` nie są sprawdzane.
 * @param refs.accountId - Konto płatności.
 * @param refs.categoryId - Kategoria wydatku.
 * @param refs.liabilityId - Zobowiązanie.
 * @param refs.setAsideAccountId - Konto odkładania.
 * @param refs.setAsideGoalId - Cel odkładania.
 * @throws {NotFoundError} Gdy odwołania nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Przy archiwum albo kategorii innego rodzaju.
 */
function checkReferences(
  handle: DbHandle,
  householdId: string,
  refs: {
    accountId?: string | null;
    categoryId?: string | null;
    liabilityId?: string | null;
    setAsideAccountId?: string | null;
    setAsideGoalId?: string | null;
  },
): void {
  checkTransactionReferences(handle, householdId, 'expense', {
    ...(refs.accountId ? { accountId: refs.accountId } : {}),
    ...(refs.categoryId ? { categoryId: refs.categoryId } : {}),
    ...(refs.liabilityId ? { liabilityId: refs.liabilityId } : {}),
  });
  if (refs.setAsideAccountId) {
    const account = lookupAccount(handle, householdId, refs.setAsideAccountId);
    if (account === undefined) {
      throw new NotFoundError('Nie znaleziono konta.', [
        { path: 'setAsideAccountId', message: 'Nie znaleziono konta' },
      ]);
    }
    if (account.isArchived) {
      throw new DomainRuleViolationError(`Konto „${account.name}” jest zarchiwizowane.`, [
        { path: 'setAsideAccountId', message: 'Konto jest zarchiwizowane' },
      ]);
    }
  }
  if (
    refs.setAsideGoalId &&
    goalLinkedAccount(handle, householdId, refs.setAsideGoalId) === undefined
  ) {
    throw new NotFoundError('Nie znaleziono celu.', [
      { path: 'setAsideGoalId', message: 'Nie znaleziono celu' },
    ]);
  }
}

/**
 * Lista planowanych wydatków (04 §9a) — domyślnie aktywne, rosnąco po terminie.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Statusy, zakres, priorytet.
 * @returns Wydatki.
 */
export function listPlannedExpenses(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  query: ListPlannedExpensesQuery,
): PlannedExpenseDto[] {
  // Najpierw synchronizacja statusów aktywnych — filtr po `ready` ma widzieć wydatek,
  // któremu właśnie nadszedł termin.
  dtosOf(
    handle,
    clock,
    householdId,
    findPlannedExpenses(handle, householdId, {
      statuses: ACTIVE_PLANNED_STATUSES,
    }),
  );
  const rows = findPlannedExpenses(handle, householdId, {
    statuses: query.status ?? ACTIVE_PLANNED_STATUSES,
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    ...(query.priority === undefined ? {} : { priority: query.priority }),
  });
  return dtosOf(handle, clock, householdId, rows);
}

/**
 * Szczegóły z historią odkładania (04 §9a).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator wydatku.
 * @returns Wydatek z przelewami odkładania, od najnowszego.
 * @throws {NotFoundError} Gdy wydatku nie ma w gospodarstwie.
 */
export function getPlannedExpense(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  id: string,
): PlannedExpenseDetailDto {
  const row = requireExpense(handle, householdId, id);
  const history = listTransactions(handle, householdId, {
    plannedExpenseId: [id],
    type: ['transfer'],
    limit: HISTORY_LIMIT,
    sort: 'bookedOn:desc',
    uncategorized: false,
    includeDeleted: false,
  });
  return { ...dtoOf(handle, clock, householdId, row), setAsideHistory: history.data };
}

/**
 * Zakłada planowany wydatek.
 *
 * Start odkładania pominięty — bieżący miesiąc, a dla terminu już minionego — termin
 * (I-19: odkładanie nie zaczyna się po terminie).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Pola wydatku.
 * @returns Założony wydatek.
 * @throws {DomainRuleViolationError} Przy wykluczających się polach albo archiwum.
 * @throws {NotFoundError} Gdy odwołanie nie należy do gospodarstwa.
 */
export function createPlannedExpense(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  input: CreatePlannedExpenseRequest,
): PlannedExpenseDto {
  const now = householdNow(handle, clock, householdId);
  const at = clock.now().getTime();
  const start =
    input.setAsideStartMonth ??
    (input.dueMonth < now.currentMonth ? input.dueMonth : now.currentMonth);
  const row = handle.sqlite.transaction(() => {
    assertIssues({ ...input, setAsideStartMonth: start });
    checkReferences(handle, householdId, input);
    return insertPlannedExpense(handle, {
      id: newId(),
      householdId,
      name: input.name,
      estimatedAmountMinor: input.estimatedAmountMinor,
      amountIsEstimate: input.amountIsEstimate,
      dueMonth: input.dueMonth,
      dueOn: input.dueOn ?? null,
      categoryId: input.categoryId ?? null,
      accountId: input.accountId ?? null,
      liabilityId: input.liabilityId ?? null,
      priority: input.priority,
      status: 'planned',
      setAsideEnabled: input.setAsideEnabled,
      setAsideAccountId: input.setAsideAccountId ?? null,
      setAsideGoalId: input.setAsideGoalId ?? null,
      setAsideStartMonth: start,
      alreadySetAsideMinor: input.alreadySetAsideMinor,
      repeatsYearly: input.repeatsYearly,
      notes: input.notes ?? null,
      createdAt: at,
      updatedAt: at,
    });
  })();
  return dtoOf(handle, clock, householdId, row);
}

/** Pola, które edycja może zmienić — w kolejności z kontraktu. */
const EDITABLE_FIELDS = [
  'name',
  'estimatedAmountMinor',
  'amountIsEstimate',
  'dueMonth',
  'dueOn',
  'categoryId',
  'accountId',
  'liabilityId',
  'priority',
  'setAsideEnabled',
  'setAsideAccountId',
  'setAsideGoalId',
  'setAsideStartMonth',
  'alreadySetAsideMinor',
  'repeatsYearly',
  'notes',
] as const satisfies readonly (keyof UpdatePlannedExpenseRequest & keyof PlannedExpenseRow)[];

/**
 * Zmienia wydatek (także korekta szacunku). Zapłacony i odwołany — `409`.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator wydatku.
 * @param input - Zmiany.
 * @returns Wydatek po zmianie.
 * @throws {NotFoundError} Gdy wydatku albo odwołania nie ma w gospodarstwie.
 * @throws {ConflictError} Gdy wydatek jest zapłacony albo odwołany.
 * @throws {DomainRuleViolationError} Przy wykluczających się polach albo archiwum.
 */
export function updatePlannedExpense(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  id: string,
  input: UpdatePlannedExpenseRequest,
): PlannedExpenseDto {
  const at = clock.now().getTime();
  const row = handle.sqlite.transaction(() => {
    const current = requireExpense(handle, householdId, id);
    const patch: PlannedExpensePatch = {};
    for (const field of EDITABLE_FIELDS) {
      const value = input[field];
      if (value !== undefined && value !== current[field]) Object.assign(patch, { [field]: value });
    }
    if (Object.keys(patch).length === 0) return current;
    assertOpen(current);
    const merged = { ...current, ...patch };
    // Termin przesunięty przed start odkładania — start idzie za nim (I-19).
    if (
      patch.dueMonth !== undefined &&
      merged.setAsideStartMonth !== null &&
      merged.setAsideStartMonth > patch.dueMonth &&
      input.setAsideStartMonth === undefined
    ) {
      patch.setAsideStartMonth = patch.dueMonth;
      merged.setAsideStartMonth = patch.dueMonth;
    }
    assertIssues(merged);
    checkReferences(handle, householdId, patch);
    const updated = patchPlannedExpense(handle, householdId, id, patch, at);
    if (updated === undefined) throw new NotFoundError(NOT_FOUND);
    return updated;
  })();
  return dtoOf(handle, clock, householdId, row);
}

/**
 * Usuwa wydatek. Wpłaty i zapłata zostają w księdze bez powiązania (07 §10).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator wydatku.
 * @throws {NotFoundError} Gdy wydatku nie ma w gospodarstwie.
 */
export function deletePlannedExpense(handle: DbHandle, householdId: string, id: string): void {
  if (!removePlannedExpense(handle, householdId, id)) throw new NotFoundError(NOT_FOUND);
}

/**
 * Przesuwa termin (04 §9a „defer"). Zebrane pieniądze zostają, rata przelicza się sama;
 * status wynika z nowego terminu (`deferred` jest przejściowy, ADR-055).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator wydatku.
 * @param input - Nowy miesiąc i opcjonalnie dzień.
 * @returns Wydatek po zmianie.
 * @throws {ConflictError} Gdy wydatek jest zapłacony albo odwołany.
 * @throws {DomainRuleViolationError} Gdy nowy termin jest w przeszłości albo data poza miesiącem.
 */
export function deferPlannedExpense(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  id: string,
  input: DeferPlannedExpenseRequest,
): PlannedExpenseDto {
  const now = householdNow(handle, clock, householdId);
  if (input.dueMonth < now.currentMonth) {
    throw new DomainRuleViolationError('Nowy termin nie może być w przeszłości.', [
      { path: 'dueMonth', message: 'Termin w przeszłości' },
    ]);
  }
  const row = handle.sqlite.transaction(() => {
    const current = requireExpense(handle, householdId, id);
    assertOpen(current);
    const dueOn = input.dueOn ?? null;
    assertIssues({ dueMonth: input.dueMonth, dueOn });
    const updated = patchPlannedExpense(
      handle,
      householdId,
      id,
      { dueMonth: input.dueMonth, dueOn, status: 'planned' },
      clock.now().getTime(),
    );
    if (updated === undefined) throw new NotFoundError(NOT_FOUND);
    return updated;
  })();
  return dtoOf(handle, clock, householdId, row);
}

/**
 * Odwołuje wydatek (np. sprzedany samochód). Wpłaty zostają na koncie odkładania.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator wydatku.
 * @returns Wydatek po zmianie; odwołany wcześniej — bez zmian.
 * @throws {ConflictError} Gdy wydatek jest już zapłacony.
 */
export function cancelPlannedExpense(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  id: string,
): PlannedExpenseDto {
  const row = handle.sqlite.transaction(() => {
    const current = requireExpense(handle, householdId, id);
    if (current.status === 'cancelled') return current;
    assertOpen(current);
    const updated = patchPlannedExpense(
      handle,
      householdId,
      id,
      { status: 'cancelled' },
      clock.now().getTime(),
    );
    if (updated === undefined) throw new NotFoundError(NOT_FOUND);
    return updated;
  })();
  return dtoOf(handle, clock, householdId, row);
}

/**
 * Wpłata na odkładanie — przelew z `plannedExpenseId` (04 §9a, `F6-3`).
 *
 * Kwota pominięta — rata wyliczona. Konto docelowe: konto odkładania albo konto celu
 * odkładania (wtedy przelew niesie też `goalId` — liczy się do celu i do wydatku, 07 §6.5).
 * Konto źródłowe pominięte — konto płatności wydatku. Idempotencję zapewnia trasa.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor przelewu z tokenu.
 * @param id - Identyfikator wydatku.
 * @param input - Kwota, data, konto źródłowe.
 * @returns Wydatek po wpłacie, przelew i miesiące do unieważnienia.
 * @throws {ConflictError} Gdy wydatek jest zapłacony albo odwołany.
 * @throws {DomainRuleViolationError} Gdy brak konta albo nic do odłożenia.
 */
export function setAsideForPlannedExpense(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  id: string,
  input: SetAsideContributionRequest,
): { data: SetAsideResultDto; meta: TransactionMutationMeta } {
  const now = householdNow(handle, clock, householdId);
  const { row, transaction } = handle.sqlite.transaction(() => {
    const current = requireExpense(handle, householdId, id);
    assertOpen(current);
    const target =
      current.setAsideAccountId ??
      (current.setAsideGoalId === null
        ? null
        : (goalLinkedAccount(handle, householdId, current.setAsideGoalId) ?? null));
    if (target === null) {
      throw new DomainRuleViolationError(
        'Wydatek nie ma konta odkładania — wskaż konto albo cel z kontem.',
        [{ path: 'setAsideAccountId', message: 'Wybierz, gdzie odkładasz' }],
      );
    }
    const from = input.fromAccountId ?? current.accountId;
    if (from === null) {
      throw new DomainRuleViolationError('Wskaż konto, z którego odkładasz.', [
        { path: 'fromAccountId', message: 'Wybierz konto' },
      ]);
    }
    const amount =
      input.amountMinor ?? dtoOf(handle, clock, householdId, current).setAside.monthlyRequiredMinor;
    if (amount <= 0) {
      throw new DomainRuleViolationError('Na ten wydatek jest już odłożone w całości.', [
        { path: 'amountMinor', message: 'Nic do odłożenia' },
      ]);
    }
    const { data } = createTransaction(
      handle,
      clock,
      householdId,
      userId,
      {
        type: 'transfer',
        bookedOn: input.bookedOn ?? now.today,
        amountMinor: amount,
        accountId: from,
        counterAccountId: target,
        goalId: current.setAsideGoalId,
        description: `Odkładanie: ${current.name}`,
      },
      { source: 'planned', plannedExpenseId: current.id },
    );
    return { row: current, transaction: data };
  })();
  return {
    data: { plannedExpense: dtoOf(handle, clock, householdId, row), transaction },
    meta: { affectedMonths: [transaction.monthKey] },
  };
}

/**
 * Zaksięgowanie wydatku (04 §9a, `F6-3`, `F6-4`): wydatek z `plannedExpenseId`, status
 * `posted`, a przy `repeatsYearly` — instancja na kolejny rok z kwotą faktycznie zapłaconą,
 * o ile jeszcze jej nie ma (ponowne zaksięgowanie po cofnięciu nie tworzy drugiej, 07 §6.7).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor transakcji z tokenu.
 * @param id - Identyfikator wydatku.
 * @param input - Kwota, data, konto, kategoria, notatka — pominięte z wydatku, data — dziś.
 * @returns Wydatek, transakcja, instancja na kolejny rok i miesiące do unieważnienia.
 * @throws {ConflictError} Gdy wydatek jest zapłacony albo odwołany.
 * @throws {DomainRuleViolationError} Gdy brak konta albo transakcja łamie niezmienniki.
 */
export function postPlannedExpense(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  id: string,
  input: PostPlannedExpenseRequest,
): { data: PostPlannedExpenseResultDto; meta: TransactionMutationMeta } {
  const now = householdNow(handle, clock, householdId);
  const at = clock.now().getTime();
  const result = handle.sqlite.transaction(() => {
    const current = requireExpense(handle, householdId, id);
    assertOpen(current);
    const accountId = input.accountId ?? current.accountId;
    if (accountId === null) {
      throw new DomainRuleViolationError('Wskaż konto, z którego zapłacono.', [
        { path: 'accountId', message: 'Wybierz konto' },
      ]);
    }
    const { data: transaction } = createTransaction(
      handle,
      clock,
      householdId,
      userId,
      {
        type: 'expense',
        bookedOn: input.bookedOn ?? now.today,
        amountMinor: input.amountMinor ?? current.estimatedAmountMinor,
        accountId,
        categoryId: input.categoryId === undefined ? current.categoryId : input.categoryId,
        liabilityId: current.liabilityId,
        description: current.name,
        notes: input.notes ?? null,
      },
      { source: 'planned', plannedExpenseId: current.id },
    );
    const posted = patchPlannedExpense(
      handle,
      householdId,
      id,
      {
        status: 'posted',
        transactionId: transaction.id,
        postedAmountMinor: transaction.amountMinor,
        postedAt: at,
      },
      at,
    );
    if (posted === undefined) throw new NotFoundError(NOT_FOUND);

    let next: PlannedExpenseRow | null = null;
    if (current.repeatsYearly && findNextInstance(handle, householdId, current.id) === undefined) {
      const fields = nextYearlyInstance(
        current.dueMonth,
        current.dueOn,
        transaction.amountMinor,
        transaction.monthKey,
      );
      next = insertPlannedExpense(handle, {
        id: newId(),
        householdId,
        name: current.name,
        estimatedAmountMinor: fields.estimatedAmountMinor,
        amountIsEstimate: current.amountIsEstimate,
        dueMonth: fields.dueMonth,
        dueOn: fields.dueOn,
        categoryId: current.categoryId,
        accountId: current.accountId,
        liabilityId: current.liabilityId,
        priority: current.priority,
        status: 'planned',
        setAsideEnabled: current.setAsideEnabled,
        setAsideAccountId: current.setAsideAccountId,
        setAsideGoalId: current.setAsideGoalId,
        setAsideStartMonth: fields.setAsideStartMonth,
        alreadySetAsideMinor: 0,
        repeatsYearly: true,
        previousInstanceId: current.id,
        notes: current.notes,
        createdAt: at,
        updatedAt: at,
      });
    }
    return { posted, transaction, next };
  })();
  return {
    data: {
      plannedExpense: dtoOf(handle, clock, householdId, result.posted),
      transaction: result.transaction,
      nextInstance: result.next === null ? null : dtoOf(handle, clock, householdId, result.next),
    },
    meta: { affectedMonths: [result.transaction.monthKey] },
  };
}

/**
 * Miesiąc, w którym wydatek obciąża budżet: termin albo — dla zaległego — bieżący.
 *
 * @param dto - Wydatek.
 * @param currentMonth - Bieżący miesiąc.
 * @returns Miesiąc `YYYY-MM`.
 */
function chargeMonth(dto: Pick<PlannedExpenseDto, 'dueMonth'>, currentMonth: MonthKey): MonthKey {
  return dto.dueMonth < currentMonth ? currentMonth : dto.dueMonth;
}

/**
 * Treść ostrzeżenia po polsku — mówi, co się stało, i podaje kwotę (15 §5).
 *
 * @param warning - Ostrzeżenie z `detectLiquidityWarnings`.
 * @param names - Nazwy wydatków po identyfikatorze.
 * @returns Ostrzeżenie w kształcie kontraktu.
 */
function warningDto(
  warning: LiquidityWarning,
  names: ReadonlyMap<string, string>,
): LiquidityWarningDto {
  const gap = formatMinor(warning.gapMinor);
  const name = warning.plannedExpenseId === null ? '' : (names.get(warning.plannedExpenseId) ?? '');
  const month = formatMonth(warning.month);
  const message =
    warning.code === 'INSUFFICIENT_PROJECTED_BALANCE'
      ? `${month.charAt(0).toUpperCase()}${month.slice(1)}: na planowane wydatki zabraknie ${gap}.`
      : warning.code === 'UNFUNDED_MUST_EXPENSE'
        ? `„${name}” jest konieczny, a nic na niego nie odkładasz — brakuje ${gap}.`
        : `Odkładanie na „${name}” jest opóźnione o ${gap}.`;
  return { ...warning, message };
}

/**
 * Najbliższe wydatki i prognoza płynności (04 §9a `upcoming`, `F6-5`).
 *
 * Wydatki aktywne z terminem do końca horyzontu, także zaległe (liczone w bieżącym
 * miesiącu). Prognoza salda kont wydatkowych: dziś plus czekające wpływy minus czekające
 * wydatki cykliczne w kolejnych miesiącach (`pendingRecurringNet` — bez zapisu).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param months - Horyzont w miesiącach od bieżącego.
 * @returns Wydatki i metadane.
 */
export function upcomingPlannedExpenses(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  months: number,
): { data: PlannedExpenseDto[]; meta: UpcomingExpensesMeta } {
  const now = householdNow(handle, clock, householdId);
  const horizon = monthsBetween(now.currentMonth, shiftMonth(now.currentMonth, months - 1));
  const end = horizon[horizon.length - 1] ?? now.currentMonth;
  // Rata łączna liczy każdy aktywny wydatek z odkładaniem — także ten za horyzontem:
  // na lipcowe wakacje odkłada się już teraz. Horyzont zawęża tylko listę i prognozę.
  const active = listPlannedExpenses(handle, clock, householdId, {});
  const data = active.filter((dto) => dto.dueMonth <= end);

  const spendingBalance = getAccountBalances(handle, clock, householdId, {})
    .data.filter((account) => account.allocationClass === 'spending')
    .reduce((sum, account) => sum + account.balanceMinor, 0);
  const flows = horizon.map((month) => ({
    month,
    netMinor: pendingRecurringNet(handle, householdId, month),
  }));
  const warnings = detectLiquidityWarnings(
    data.map((dto) => ({
      id: dto.id,
      dueMonth: dto.dueMonth,
      priority: dto.priority,
      setAsideEnabled: dto.setAside.enabled,
      remainingMinor: dto.setAside.remainingMinor,
      isOnTrack: dto.setAside.isOnTrack,
      expectedByNowMinor: expectedSetAsideMinor(
        dto.estimatedAmountMinor,
        dto.setAside.startMonth,
        dto.dueMonth,
        now.currentMonth,
      ),
      accumulatedMinor: dto.setAside.accumulatedMinor,
    })),
    spendingBalance,
    flows,
    now.currentMonth,
  );
  const names = new Map(data.map((dto) => [dto.id, dto.name]));
  const funded = active.filter((dto) => dto.setAside.enabled);
  const sums = plannedSetAside(handle, householdId, now.currentMonth);

  return {
    data,
    meta: {
      horizonMonths: months,
      totalUpcomingMinor: data.reduce((sum, dto) => sum + dto.estimatedAmountMinor, 0),
      totalSetAsideMinor: data.reduce(
        (sum, dto) => sum + Math.min(dto.setAside.accumulatedMinor, dto.estimatedAmountMinor),
        0,
      ),
      monthlySetAsideRequiredMinor: funded.reduce(
        (sum, dto) => sum + dto.setAside.monthlyRequiredMinor,
        0,
      ),
      setAsidePaidThisMonthMinor: active.reduce(
        (sum, dto) => sum + (sums.get(dto.id)?.inMonthMinor ?? 0),
        0,
      ),
      byMonth: horizon
        .map((month) => {
          const due = data.filter((dto) => chargeMonth(dto, now.currentMonth) === month);
          const total = due.reduce((sum, dto) => sum + dto.estimatedAmountMinor, 0);
          const covered = due.reduce(
            (sum, dto) => sum + Math.min(dto.setAside.accumulatedMinor, dto.estimatedAmountMinor),
            0,
          );
          return {
            month,
            totalMinor: total,
            coveredMinor: covered,
            shortfallMinor: total - covered,
          };
        })
        .filter((item) => item.totalMinor > 0),
      liquidityWarnings: warnings.map((warning) => warningDto(warning, names)),
    },
  };
}

/**
 * Sekcja „Nadchodzące" na dashboardzie (`F6-8`).
 *
 * Horyzont liczony od dziś (to prognoza, nie historia). Z oglądanym miesiącem związana jest
 * suma terminów w nim i lista do zapłaty: wydatki `ready` z terminem do oglądanego
 * miesiąca — tylko w miesiącu bieżącym, bo tylko w nim da się księgować „Zapłacone" bez
 * kombinowania z datą.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Oglądany miesiąc.
 * @returns Sekcja.
 */
export function plannedExpensesSectionForMonth(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
): MonthPlannedExpensesSectionDto {
  const now = householdNow(handle, clock, householdId);
  const upcoming = upcomingPlannedExpenses(handle, clock, householdId, DASHBOARD_HORIZON_MONTHS);
  // Skrót na kafel sięga za horyzont: jedyny wydatek za dziesięć miesięcy też ma być widać
  // (sekcja znika tylko wtedy, gdy nie ma żadnego — 06 §3.10).
  const active = listPlannedExpenses(handle, clock, householdId, {});
  const dueThisMonth = listPlannedExpenses(handle, clock, householdId, {
    status: ['planned', 'funding', 'ready', 'deferred', 'posted'],
    from: month,
    to: month,
  });
  return {
    dueThisMonthMinor: dueThisMonth.reduce((sum, dto) => sum + dto.estimatedAmountMinor, 0),
    upcoming6MonthsMinor: upcoming.meta.totalUpcomingMinor,
    monthlySetAsideRequiredMinor: upcoming.meta.monthlySetAsideRequiredMinor,
    setAsidePaidThisMonthMinor: upcoming.meta.setAsidePaidThisMonthMinor,
    warningCount: upcoming.meta.liquidityWarnings.length,
    warnings: upcoming.meta.liquidityWarnings,
    items: active.slice(0, DASHBOARD_ITEMS),
    readyToPay:
      month === now.currentMonth
        ? upcoming.data.filter((dto) => dto.status === 'ready' && dto.dueMonth <= month)
        : [],
  };
}
