import {
  allocationExceedsIncome,
  buildAllocationStatus,
  earliestPostableDate,
  formatMonth,
  monthKeyOf,
  monthsBetween,
  monthsDiff,
  monthTiming,
  shiftMonth,
  todayInTimezone,
  ALLOCATION_TREND_MAX_MONTHS,
  type AllocationMonthQuery,
  type AllocationStatusDto,
  type AllocationTargetDto,
  type AllocationTargetMeta,
  type AllocationTrendQuery,
  type MonthKey,
  type UpsertAllocationTargetRequest,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import { DomainRuleViolationError, NotFoundError, ValidationError } from '../../core/errors.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import type { AllocationTargetRow } from '../../db/schema/allocation-targets.js';
import { getHousehold } from '../auth/auth.service.js';
import { allocationSumsByMonth } from '../transactions/transactions.ledger.js';
import { toAllocationTargetDto, toTargetShares } from './allocation.mapper.js';
import {
  findAllocationTargetFrom,
  findAllocationTargets,
  insertAllocationTarget,
  patchAllocationTarget,
} from './allocation.repository.js';

/**
 * Rozkład docelowy — zadania `F5-3` i `F5-4`
 * ([04 §11](../../../../../../plans/04-api-spec.md#11-rozkład-docelowy--apiv1allocation),
 * [07 §2](../../../../../../plans/07-domain-rules.md#2-alokacje-i-realizacja-celów-procentowych),
 * ADR-053).
 *
 * Rozkład jest wersjonowany od miesiąca: zmiana założeń w listopadzie nie przepisuje
 * planu z sierpnia (wymaganie #8). Wykonanie liczy księga (`allocationSumsByMonth` —
 * te same wyrażenia SQL co ekran miesiąca), porównanie — czyste funkcje z
 * `shared/domain/allocation-status.ts`. Wykonanie jest **netto** (ADR-011).
 */

/** Ile miesięcy pokazuje trend bez parametrów — do bieżącego włącznie (06 §3.6). */
const DEFAULT_TREND_MONTHS = 6;

/** „Dziś" i bieżący miesiąc gospodarstwa. */
interface HouseholdNow {
  readonly today: string;
  readonly currentMonth: MonthKey;
  readonly monthStartDay: number;
  readonly backPostingLimitMonths: number;
}

/**
 * Dzisiejsza data i bieżący miesiąc gospodarstwa (07 §1.1).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Dziś, bieżący miesiąc i ustawienia miesiąca.
 */
function householdNow(handle: DbHandle, clock: Clock, householdId: string): HouseholdNow {
  const household = getHousehold(handle, householdId);
  const today = todayInTimezone(household.timezone, clock.now());
  return {
    today,
    currentMonth: monthKeyOf(today, household.monthStartDay),
    monthStartDay: household.monthStartDay,
    backPostingLimitMonths: household.backPostingLimitMonths,
  };
}

/**
 * Wybiera wersję obowiązującą w miesiącu: największe `effectiveFromMonth <= month`.
 *
 * @param versions - Wersje malejąco po miesiącu początku.
 * @param month - Miesiąc.
 * @returns Wersja albo `null`, gdy żadna jeszcze nie obowiązywała.
 */
function versionFor(
  versions: readonly AllocationTargetRow[],
  month: MonthKey,
): AllocationTargetRow | null {
  return versions.find((row) => row.effectiveFromMonth <= month) ?? null;
}

/**
 * Stany wielu miesięcy — wspólne dla kafla, ekranu i trendu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param now - Dziś i ustawienia miesiąca.
 * @param months - Miesiące rosnąco, niepusta lista.
 * @returns Stan każdego miesiąca w tej samej kolejności.
 */
function statusesFor(
  handle: DbHandle,
  householdId: string,
  now: HouseholdNow,
  months: readonly MonthKey[],
): AllocationStatusDto[] {
  const first = months[0];
  const last = months[months.length - 1];
  if (first === undefined || last === undefined) return [];
  const versions = findAllocationTargets(handle, householdId);
  const sums = allocationSumsByMonth(handle, householdId, first, last);
  return months.map((month) => {
    const version = versionFor(versions, month);
    const row = sums.get(month);
    return buildAllocationStatus(
      month,
      version === null ? null : toTargetShares(version),
      {
        incomeBaseMinor: row?.incomeBaseMinor ?? 0,
        savingsMinor: row?.savingsMinor ?? 0,
        investmentMinor: row?.investmentMinor ?? 0,
        debtRepaymentMinor: row?.debtRepaymentMinor ?? 0,
      },
      monthTiming(month, now.today, now.monthStartDay),
    );
  });
}

/**
 * Rozkład obowiązujący w miesiącu (`GET /allocation/target`).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Miesiąc; pominięty — bieżący.
 * @returns Wersja rozkładu albo `null`, gdy żadna nie obowiązuje.
 */
export function getAllocationTarget(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  query: AllocationMonthQuery,
): AllocationTargetDto | null {
  const month = query.month ?? householdNow(handle, clock, householdId).currentMonth;
  const version = versionFor(findAllocationTargets(handle, householdId), month);
  return version === null ? null : toAllocationTargetDto(version);
}

/**
 * Wszystkie wersje rozkładu, od najnowszej (`GET /allocation/history`).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Wersje malejąco po miesiącu początku.
 */
export function listAllocationHistory(
  handle: DbHandle,
  householdId: string,
): AllocationTargetDto[] {
  return findAllocationTargets(handle, householdId).map(toAllocationTargetDto);
}

/**
 * Ustawia rozkład od wskazanego miesiąca (`PUT /allocation/target`).
 *
 * - Ponowny zapis tego samego miesiąca **zmienia** tę wersję — to poprawka, nie nowa
 *   wersja (unikalny `(household_id, effective_from_month)`).
 * - Miesiąc zamknięty (07 §1.4) jest poza zasięgiem: jego plan jest zamrożony tak samo
 *   jak liczby. Wersja od miesiąca w oknie księgowania działa też na późniejsze miesiące,
 *   aż do następnej wersji.
 * - Suma ponad 100% jest dozwolona, z ostrzeżeniem `ALLOCATION_EXCEEDS_INCOME` (07 §2.7).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Miesiąc początku, udziały, notatka.
 * @returns Zapisana wersja i ostrzeżenie.
 * @throws {DomainRuleViolationError} Gdy miesiąc jest zamknięty.
 */
export function upsertAllocationTarget(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  input: UpsertAllocationTargetRequest,
): { data: AllocationTargetDto; meta: AllocationTargetMeta } {
  const now = householdNow(handle, clock, householdId);
  const firstOpen = monthKeyOf(
    earliestPostableDate(now.today, now.backPostingLimitMonths),
    now.monthStartDay,
  );
  if (input.effectiveFromMonth < firstOpen) {
    throw new DomainRuleViolationError(
      `Rozkład można ustawić od ${formatMonth(firstOpen)} — wcześniejsze miesiące są zamknięte. ` +
        'Zmień limit w ustawieniach.',
      [{ path: 'effectiveFromMonth', message: 'Miesiąc zamknięty' }],
    );
  }

  const at = clock.now().getTime();
  const shares = {
    savingsPercentBps: input.savingsPercentBps,
    investmentPercentBps: input.investmentPercentBps,
    debtPercentBps: input.debtPercentBps,
    note: input.note ?? null,
  };
  const row = handle.sqlite.transaction(() => {
    const existing = findAllocationTargetFrom(handle, householdId, input.effectiveFromMonth);
    if (existing === undefined) {
      return insertAllocationTarget(handle, {
        id: newId(),
        householdId,
        effectiveFromMonth: input.effectiveFromMonth,
        ...shares,
        createdAt: at,
        updatedAt: at,
      });
    }
    const updated = patchAllocationTarget(handle, householdId, existing.id, shares, at);
    if (updated === undefined) throw new NotFoundError('Nie znaleziono rozkładu.');
    return updated;
  })();
  return {
    data: toAllocationTargetDto(row),
    meta: { warning: allocationExceedsIncome(input) ? 'ALLOCATION_EXCEEDS_INCOME' : null },
  };
}

/**
 * Porównanie plan/wykonanie w miesiącu (`GET /allocation/status`, 07 §2.4–§2.7).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc; pominięty — bieżący.
 * @returns Stan realizacji rozkładu.
 */
export function getAllocationStatus(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey | undefined,
): AllocationStatusDto {
  const now = householdNow(handle, clock, householdId);
  const [status] = statusesFor(handle, householdId, now, [month ?? now.currentMonth]);
  if (status === undefined) throw new NotFoundError('Nie znaleziono miesiąca.');
  return status;
}

/**
 * Realizacja rozkładu miesiąc po miesiącu (`GET /allocation/trend`, wykres w 06 §3.6).
 *
 * Każdy miesiąc porównywany z wersją rozkładu, która **wtedy** obowiązywała. Bez
 * parametrów — sześć miesięcy do bieżącego; sam `from` albo sam `to` — sześć miesięcy
 * od niego albo do niego.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Zakres miesięcy.
 * @returns Stany miesięcy rosnąco.
 * @throws {ValidationError} Gdy zakres po uzupełnieniu jest odwrócony albo za długi.
 */
export function getAllocationTrend(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  query: AllocationTrendQuery,
): AllocationStatusDto[] {
  const now = householdNow(handle, clock, householdId);
  const span = DEFAULT_TREND_MONTHS - 1;
  const to =
    query.to ?? (query.from === undefined ? now.currentMonth : shiftMonth(query.from, span));
  const from = query.from ?? shiftMonth(to, -span);
  if (monthsDiff(from, to) < 0 || monthsDiff(from, to) >= ALLOCATION_TREND_MAX_MONTHS) {
    throw new ValidationError('Nieprawidłowy zakres trendu.', [
      { path: 'from', message: 'Zakres od 1 do 24 miesięcy' },
    ]);
  }
  return statusesFor(handle, householdId, now, monthsBetween(from, to));
}

/**
 * Kafel „Cele procentowe" na dashboardzie (`F5-8`) — to samo co `GET /allocation/status`.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Oglądany miesiąc.
 * @returns Stan realizacji rozkładu.
 */
export function allocationSectionForMonth(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
): AllocationStatusDto {
  return getAllocationStatus(handle, clock, householdId, month);
}
