import { fromBps, toBps } from '../utils/money.js';
import type { AllocationKind, AllocationStatus } from './enums.js';
import type { MonthKey } from './primitives.js';

/**
 * Porównanie plan/wykonanie rozkładu docelowego
 * ([07 §2.4–§2.7](../../../../plans/07-domain-rules.md#24-wykonanie), `F5-3`, `F5-4`,
 * ADR-011, ADR-053).
 *
 * Czyste funkcje: serwis rozkładu dostarcza sumy miesiąca z księgi, tutaj powstają
 * z nich linie, statusy i `shortfallMinor`. Wykonanie jest **netto** — wartości ujemne
 * są poprawnym wynikiem i nigdy nie są obcinane do zera.
 */

/** Rozkład obowiązujący w miesiącu: udziały planu i miesiąc, od którego obowiązuje. */
export interface AllocationTargetShares {
  readonly effectiveFromMonth: MonthKey;
  readonly savingsPercentBps: number;
  readonly investmentPercentBps: number;
  readonly debtPercentBps: number;
}

/** Sumy miesiąca z księgi (07 §2.3, §2.4, §2.2a). */
export interface AllocationSums {
  /** Podstawa procentu — przychody wliczane do alokacji. */
  readonly incomeBaseMinor: number;
  /** Efekt netto przelewów na oszczędności; może być ujemny. */
  readonly savingsMinor: number;
  /** Efekt netto przelewów na inwestycje; może być ujemny. */
  readonly investmentMinor: number;
  /** Spłata zobowiązań — nigdy ujemna. */
  readonly debtRepaymentMinor: number;
}

/** Upływ miesiąca (07 §12.2). */
export interface AllocationTiming {
  readonly isPartial: boolean;
  readonly daysElapsed: number;
  readonly daysInMonth: number;
}

/** Jedna linia porównania. */
export interface AllocationLine {
  readonly kind: AllocationKind;
  readonly targetPercentBps: number;
  readonly targetAmountMinor: number;
  readonly actualAmountMinor: number;
  readonly actualPercentBps: number;
  readonly deltaAmountMinor: number;
  readonly deltaPercentBps: number;
  readonly fulfillmentBps: number;
  readonly status: AllocationStatus;
}

/** Stan realizacji rozkładu w miesiącu. */
export interface AllocationStatusResult {
  readonly month: MonthKey;
  /** Miesiąc, od którego obowiązuje porównywany rozkład; `null` — rozkładu nie ma. */
  readonly effectiveFromMonth: MonthKey | null;
  readonly incomeBaseMinor: number;
  readonly isPartialMonth: boolean;
  readonly daysElapsed: number;
  readonly daysInMonth: number;
  readonly lines: AllocationLine[];
  readonly totals: {
    readonly targetPercentBps: number;
    readonly actualPercentBps: number;
    readonly targetAmountMinor: number;
    readonly actualAmountMinor: number;
    readonly shortfallMinor: number;
  };
}

/**
 * Ocenia realizację pojedynczej linii rozkładu (07 §2.5).
 *
 * W trwającym miesiącu plan jest skalowany proporcjonalnie do upływu dni, więc
 * „jestem na dobrej drodze" oznacza wykonanie proporcjonalne do części miesiąca,
 * która już minęła. W miesiącu zamkniętym liczy się wyłącznie pełne wykonanie.
 * Wykonanie ujemne jest zawsze `behind` — także przy zerowym planie.
 *
 * @param actualMinor - Wykonanie netto; może być ujemne, gdy wypłaty przewyższyły wpłaty.
 * @param targetMinor - Kwota planowana na cały miesiąc.
 * @param progress - Udział upływu miesiąca (0–1); 1 dla miesięcy przeszłych, 0 dla przyszłych.
 * @returns Status linii.
 */
export function allocationLineStatus(
  actualMinor: number,
  targetMinor: number,
  progress: number,
): AllocationStatus {
  if (targetMinor === 0) return actualMinor < 0 ? 'behind' : 'met';
  if (actualMinor >= targetMinor) return actualMinor > targetMinor ? 'ahead' : 'met';
  const expectedByNow = Math.round(targetMinor * progress);
  return actualMinor >= expectedByNow ? 'on_track' : 'behind';
}

/**
 * Buduje linię porównania dla jednej puli (07 §2.4).
 *
 * ```
 * target      = fromBps(targetBps, incomeBase)
 * actualBps   = toBps(actual, incomeBase)
 * delta       = actual − target
 * fulfillment = toBps(actual, target)          // 10000 = plan wykonany
 * ```
 *
 * @param kind - Pula.
 * @param targetPercentBps - Udział planu.
 * @param actualMinor - Wykonanie netto.
 * @param incomeBaseMinor - Podstawa procentu.
 * @param progress - Upływ miesiąca 0–1.
 * @returns Linia.
 */
function buildLine(
  kind: AllocationKind,
  targetPercentBps: number,
  actualMinor: number,
  incomeBaseMinor: number,
  progress: number,
): AllocationLine {
  const targetAmountMinor = fromBps(targetPercentBps, incomeBaseMinor);
  const actualPercentBps = toBps(actualMinor, incomeBaseMinor);
  return {
    kind,
    targetPercentBps,
    targetAmountMinor,
    actualAmountMinor: actualMinor,
    actualPercentBps,
    deltaAmountMinor: actualMinor - targetAmountMinor,
    deltaPercentBps: actualPercentBps - targetPercentBps,
    fulfillmentBps: toBps(actualMinor, targetAmountMinor),
    status: allocationLineStatus(actualMinor, targetAmountMinor, progress),
  };
}

/**
 * Porównuje rozkład z wykonaniem w miesiącu (07 §2.4–§2.7).
 *
 * - Linie `savings` i `investment` są zawsze — także bez rozkładu (cel 0%, status `met`,
 *   07 §2.7). Linia `debt_repayment` — tylko gdy rozkład planuje spłatę długu: rata jest
 *   wydatkiem (07 §2.2a), więc bez planu nie ma czego porównywać, a doliczona do sum
 *   zawyżałaby „odłożone".
 * - `shortfall = Σ max(0, target − actual)` (07 §2.6): nadwyżka jednej linii nie
 *   kompensuje niedoboru drugiej — oszczędzanie i inwestowanie to różne cele.
 * - Przy zerowej podstawie procenty są nieokreślone: `0` i `isPartialMonth: true`
 *   (07 §2.7) — UI pokazuje `—`, nie `0%`.
 *
 * @param month - Miesiąc.
 * @param target - Rozkład obowiązujący w miesiącu; `null` — brak rozkładu.
 * @param sums - Sumy miesiąca z księgi.
 * @param timing - Upływ miesiąca.
 * @returns Stan realizacji.
 */
export function buildAllocationStatus(
  month: MonthKey,
  target: AllocationTargetShares | null,
  sums: AllocationSums,
  timing: AllocationTiming,
): AllocationStatusResult {
  const base = sums.incomeBaseMinor;
  // `daysInMonth` jest zawsze dodatnie (07 §12.2) — dzielenie jest bezpieczne.
  const progress = timing.daysElapsed / timing.daysInMonth;
  const lines = [
    buildLine('savings', target?.savingsPercentBps ?? 0, sums.savingsMinor, base, progress),
    buildLine(
      'investment',
      target?.investmentPercentBps ?? 0,
      sums.investmentMinor,
      base,
      progress,
    ),
  ];
  if (target !== null && target.debtPercentBps > 0) {
    lines.push(
      buildLine('debt_repayment', target.debtPercentBps, sums.debtRepaymentMinor, base, progress),
    );
  }

  const actualAmountMinor = lines.reduce((sum, line) => sum + line.actualAmountMinor, 0);
  return {
    month,
    effectiveFromMonth: target?.effectiveFromMonth ?? null,
    incomeBaseMinor: base,
    isPartialMonth: timing.isPartial || base === 0,
    daysElapsed: timing.daysElapsed,
    daysInMonth: timing.daysInMonth,
    lines,
    totals: {
      targetPercentBps: lines.reduce((sum, line) => sum + line.targetPercentBps, 0),
      actualPercentBps: toBps(actualAmountMinor, base),
      targetAmountMinor: lines.reduce((sum, line) => sum + line.targetAmountMinor, 0),
      actualAmountMinor,
      shortfallMinor: lines.reduce(
        (sum, line) => sum + Math.max(0, line.targetAmountMinor - line.actualAmountMinor),
        0,
      ),
    },
  };
}

/** Suma udziałów, od której rozkład „przekracza wpływy" (07 §2.7). */
export const ALLOCATION_FULL_BPS = 10_000;

/**
 * Czy rozkład przekracza wpływy — zapis dozwolony, UI ostrzega (07 §2.7).
 *
 * @param shares - Udziały rozkładu.
 * @returns `true`, gdy suma udziałów przekracza 100%.
 */
export function allocationExceedsIncome(
  shares: Pick<
    AllocationTargetShares,
    'savingsPercentBps' | 'investmentPercentBps' | 'debtPercentBps'
  >,
): boolean {
  return (
    shares.savingsPercentBps + shares.investmentPercentBps + shares.debtPercentBps >
    ALLOCATION_FULL_BPS
  );
}
