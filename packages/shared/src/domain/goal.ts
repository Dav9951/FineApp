import { fromBps, roundHalfAwayFromZero, toBps } from '../utils/money.js';
import { monthsDiff, shiftMonth } from '../utils/month.js';
import type { AllocationClass, ContributionMode, GoalKind, ProgressSource } from './enums.js';
import type { MonthKey } from './primitives.js';

/**
 * Postęp, plan wpłat i prognoza celu
 * ([07 §3](../../../../plans/07-domain-rules.md#3-przelicznik-kwoty-i-procentu),
 * [§4](../../../../plans/07-domain-rules.md#4-cele), `F5-1`, ADR-052).
 *
 * Czyste funkcje w `shared`: API liczy z nich każdy cel, a formularz celu pokaże
 * przeliczenie i skutki trybu wpłaty, **zanim** użytkownik zapisze.
 */

/** Najwyższy udział, jaki mieści kontrakt (`BpsSchema`) — 1000%. */
const MAX_BPS = 100_000;

/** Pełny udział: 100% = 10 000 bps. */
const FULL_BPS = 10_000;

/** Ile miesięcy wstecz (z bieżącym) bierze tempo wpłat (07 §4.2). */
export const GOAL_PACE_MONTHS = 6;

/**
 * Horyzont prognozy: sto lat. Dalsza data to w praktyce „przy tym tempie nigdy" —
 * i nie mieści się w kluczu miesiąca `YYYY-MM`.
 */
export const GOAL_PROJECTION_LIMIT_MONTHS = 1200;

/** Plan wpłat zapisany w celu — zawsze tylko jedna strona przelicznika (07 §3). */
export interface GoalPlan {
  readonly contributionMode: ContributionMode;
  readonly contributionAmountMinor: number | null;
  readonly contributionPercentBps: number | null;
}

/** Plan wpłat w miesiącu po przeliczeniu względem wpływów. */
export interface PlannedContribution {
  /** Kwota na miesiąc; w trybie procentowym wyliczona z wpływów. `null` — brak planu. */
  readonly plannedAmountMinor: number | null;
  /** Udział kwoty we wpływach; w trybie kwotowym wyliczony. `null` — brak planu. */
  readonly plannedPercentBps: number | null;
}

/**
 * Przelicza plan wpłat na obie strony — kwotę i procent wpływów miesiąca (07 §3).
 *
 * Zapisana strona jest przepisywana bez zmian, druga liczona względem podstawy. Przy
 * zerowej podstawie procent kwoty wynosi `0` (pułapka „procent przy zerowej podstawie",
 * 12 §6), a kwota z procentu — `0`: nie ma z czego jej wyliczyć. Procent ponad 1000%
 * jest przycinany do granicy kontraktu — tak mała podstawa i tak nic nie mówi.
 *
 * @param plan - Tryb i zapisana wartość.
 * @param incomeBaseMinor - Wpływy miesiąca wliczane do alokacji (07 §2.3).
 * @returns Kwota i procent; oba `null` w trybie `none`.
 */
export function plannedContribution(plan: GoalPlan, incomeBaseMinor: number): PlannedContribution {
  if (plan.contributionMode === 'fixed' && plan.contributionAmountMinor !== null) {
    return {
      plannedAmountMinor: plan.contributionAmountMinor,
      plannedPercentBps: Math.min(MAX_BPS, toBps(plan.contributionAmountMinor, incomeBaseMinor)),
    };
  }
  if (plan.contributionMode === 'percent_of_income' && plan.contributionPercentBps !== null) {
    return {
      plannedAmountMinor: fromBps(plan.contributionPercentBps, incomeBaseMinor),
      plannedPercentBps: plan.contributionPercentBps,
    };
  }
  return { plannedAmountMinor: null, plannedPercentBps: null };
}

/**
 * Plan do zapisu: pole niezgodne z trybem jest czyszczone (07 §3, „zapisujemy zawsze
 * tylko jedną wartość"). Inaczej cel przełączony z kwoty na procent niósłby starą kwotę,
 * której nikt już nie widzi, a powrót do trybu kwotowego przywróciłby ją po cichu.
 *
 * @param plan - Tryb i pola z żądania (przy edycji — po scaleniu).
 * @returns Plan z wypełnionym wyłącznie polem trybu.
 */
export function normalizeGoalPlan(plan: GoalPlan): GoalPlan {
  return {
    contributionMode: plan.contributionMode,
    contributionAmountMinor:
      plan.contributionMode === 'fixed' ? plan.contributionAmountMinor : null,
    contributionPercentBps:
      plan.contributionMode === 'percent_of_income' ? plan.contributionPercentBps : null,
  };
}

/** Problem walidacji krzyżowej celu. */
export interface GoalIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Reguły między polami celu — wspólne dla formularza i serwisu (I-14).
 *
 * @param value - Pola celu (przy edycji — po scaleniu).
 * @param value.contributionMode - Tryb wpłaty.
 * @param value.contributionAmountMinor - Kwota miesięcznej wpłaty.
 * @param value.contributionPercentBps - Procent wpływów.
 * @param value.progressSource - Źródło postępu.
 * @param value.linkedAccountId - Powiązane konto.
 * @returns Lista problemów; pusta, gdy wszystko się zgadza.
 */
export function goalIssues(value: {
  readonly contributionMode: ContributionMode;
  readonly contributionAmountMinor?: number | null;
  readonly contributionPercentBps?: number | null;
  readonly progressSource: ProgressSource;
  readonly linkedAccountId?: string | null;
}): GoalIssue[] {
  const issues: GoalIssue[] = [];
  if (value.contributionMode === 'fixed' && value.contributionAmountMinor == null) {
    issues.push({ path: 'contributionAmountMinor', message: 'Podaj kwotę miesięcznej wpłaty' });
  }
  if (value.contributionMode === 'percent_of_income') {
    if (value.contributionPercentBps == null) {
      issues.push({ path: 'contributionPercentBps', message: 'Podaj procent wpływów' });
    } else if (value.contributionPercentBps === 0) {
      issues.push({ path: 'contributionPercentBps', message: 'Procent musi być większy od zera' });
    } else if (value.contributionPercentBps > FULL_BPS) {
      issues.push({
        path: 'contributionPercentBps',
        message: 'Wpłata nie może przekraczać 100% wpływów',
      });
    }
  }
  if (value.progressSource === 'account_balance' && !value.linkedAccountId) {
    issues.push({
      path: 'linkedAccountId',
      message: 'Śledzenie po saldzie wymaga wskazania konta',
    });
  }
  return issues;
}

/** Przelew oznaczony celem — pola, z których wynika kierunek wpłaty. */
export interface GoalTransfer {
  readonly accountId: string | null;
  readonly counterAccountId: string | null;
  readonly sourceAllocationClass: AllocationClass | null;
  readonly targetAllocationClass: AllocationClass | null;
}

/**
 * Kierunek przelewu oznaczonego celem: wpłata (`+1`) czy wypłata z celu (`−1`).
 *
 * Postęp liczony netto, jak wykonanie rozkładu (ADR-011): odebranie 3 000 zł z celu
 * „Wakacje" na wyjazd zmniejsza zebraną kwotę, a nie ją powiększa. Kierunek:
 *
 * 1. cel ma **powiązane konto** — przelew na nie to wpłata, z niego — wypłata;
 * 2. inaczej z migawek klas (I-6): z konta klasy celu na konto innej klasy — wypłata.
 *    Przelew między dwoma kontami klasy celu (np. z głównego konta oszczędnościowego
 *    na subkonto celu) to wpłata — dla rozkładu jest neutralny (I-7), dla celu nie.
 *
 * @param goal - Rodzaj celu i powiązane konto.
 * @param goal.kind - Rodzaj celu — pula, do której należy.
 * @param goal.linkedAccountId - Konto celu, jeśli wskazane.
 * @param transfer - Przelew z `goal_id` celu.
 * @returns `1` dla wpłaty, `−1` dla wypłaty.
 */
export function goalTransferSign(
  goal: { readonly kind: GoalKind; readonly linkedAccountId: string | null },
  transfer: GoalTransfer,
): 1 | -1 {
  if (goal.linkedAccountId !== null) {
    if (transfer.counterAccountId === goal.linkedAccountId) return 1;
    if (transfer.accountId === goal.linkedAccountId) return -1;
  }
  const leavesPool =
    transfer.sourceAllocationClass === goal.kind && transfer.targetAllocationClass !== goal.kind;
  return leavesPool ? -1 : 1;
}

/** Postęp celu względem kwoty docelowej. */
export interface GoalProgress {
  /** Zebrana kwota; nigdy ujemna — na celu nie da się mieć długu. */
  readonly currentAmountMinor: number;
  /** Udział zebranej kwoty w docelowej; `null` dla celu bez kwoty docelowej. */
  readonly progressBps: number | null;
  /** Ile brakuje; `null` dla celu bez kwoty docelowej, `0` po osiągnięciu. */
  readonly remainingMinor: number | null;
}

/**
 * Postęp celu (07 §4.1).
 *
 * @param rawAmountMinor - Zebrana kwota przed przycięciem: kwota początkowa plus wpłaty
 *   netto (tryb `contributions`) albo saldo konta (tryb `account_balance`).
 * @param targetAmountMinor - Kwota docelowa; `null` — cel bezterminowy.
 * @returns Postęp.
 */
export function goalProgress(
  rawAmountMinor: number,
  targetAmountMinor: number | null,
): GoalProgress {
  const currentAmountMinor = Math.max(0, rawAmountMinor);
  if (targetAmountMinor === null) {
    return { currentAmountMinor, progressBps: null, remainingMinor: null };
  }
  return {
    currentAmountMinor,
    progressBps: Math.min(MAX_BPS, toBps(currentAmountMinor, targetAmountMinor)),
    remainingMinor: Math.max(0, targetAmountMinor - currentAmountMinor),
  };
}

/** Prognoza dojścia do celu. */
export interface GoalProjection {
  /** Tempo wpłat, na którym stoi prognoza; `null` — brak historii i planu. */
  readonly paceMonthlyMinor: number | null;
  readonly monthsToTargetAtCurrentPace: number | null;
  readonly projectedCompletionMonth: MonthKey | null;
  /** Ile wpłacać miesięcznie, żeby zdążyć na `targetDate`. */
  readonly requiredMonthlyToHitTargetDateMinor: number | null;
  readonly isOnTrack: boolean | null;
}

/**
 * Dzielenie z zaokrągleniem w górę na liczbach całkowitych — ostatnia wpłata może być
 * niepełna, ale nadal jest miesiącem.
 *
 * @param amount - Dzielna, nieujemna.
 * @param divisor - Dzielnik, dodatni.
 * @returns `⌈amount / divisor⌉`.
 */
function ceilDiv(amount: number, divisor: number): number {
  const whole = Math.floor(amount / divisor);
  return whole * divisor < amount ? whole + 1 : whole;
}

/**
 * Tempo wpłat (07 §4.2): średnia z miesięcy z jakąkolwiek wpłatą — przerwa nie zaniża
 * prognozy do absurdu. Przy mniej niż dwóch takich miesiącach historia nic nie mówi,
 * więc tempem jest plan.
 *
 * @param history - Wpłaty netto z ostatnich miesięcy (kolejność bez znaczenia).
 * @param plannedMonthlyMinor - Plan wpłat w bieżącym miesiącu; `null` — brak planu.
 * @returns Tempo w groszach na miesiąc; `null`, gdy nie ma ani historii, ani planu.
 */
export function goalPace(
  history: readonly number[],
  plannedMonthlyMinor: number | null,
): number | null {
  const active = history.filter((amount) => amount !== 0);
  if (active.length < 2) return plannedMonthlyMinor;
  const total = active.reduce((sum, amount) => sum + amount, 0);
  return roundHalfAwayFromZero(total / active.length);
}

/**
 * Prognozuje dojście do celu (07 §4.2).
 *
 * ```
 * monthsToTarget  = ⌈remaining / pace⌉                 // null, gdy pace ≤ 0
 * requiredMonthly = ⌈remaining / miesiące do terminu⌉  // null bez terminu
 * isOnTrack       = pace ≥ requiredMonthly
 * ```
 *
 * Miesiące do terminu liczone od bieżącego miesiąca do miesiąca `targetDate`
 * (wrzesień 2026 → czerwiec 2028 = 21), najmniej jeden: termin w tym miesiącu albo już
 * miniony oznacza „cała reszta teraz". Cel osiągnięty jest „na czas" z zerową wpłatą.
 *
 * @param remainingMinor - Ile brakuje; `null` — cel bez kwoty docelowej (wszystko `null`).
 * @param targetDate - Termin celu `YYYY-MM-DD` albo `null`.
 * @param paceMonthlyMinor - Tempo z `goalPace`.
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @returns Prognoza.
 */
export function projectGoal(
  remainingMinor: number | null,
  targetDate: string | null,
  paceMonthlyMinor: number | null,
  currentMonth: MonthKey,
): GoalProjection {
  if (remainingMinor === null) {
    return {
      paceMonthlyMinor,
      monthsToTargetAtCurrentPace: null,
      projectedCompletionMonth: null,
      requiredMonthlyToHitTargetDateMinor: null,
      isOnTrack: null,
    };
  }

  let monthsToTarget: number | null = null;
  if (remainingMinor === 0) monthsToTarget = 0;
  else if (paceMonthlyMinor !== null && paceMonthlyMinor > 0) {
    monthsToTarget = ceilDiv(remainingMinor, paceMonthlyMinor);
  }
  if (monthsToTarget !== null && monthsToTarget > GOAL_PROJECTION_LIMIT_MONTHS) {
    monthsToTarget = null;
  }

  let required: number | null = null;
  if (targetDate !== null) {
    const months = Math.max(1, monthsDiff(currentMonth, targetDate.slice(0, 7)));
    required = ceilDiv(remainingMinor, months);
  }

  return {
    paceMonthlyMinor,
    monthsToTargetAtCurrentPace: monthsToTarget,
    projectedCompletionMonth:
      monthsToTarget === null ? null : shiftMonth(currentMonth, monthsToTarget),
    requiredMonthlyToHitTargetDateMinor: required,
    isOnTrack: required === null ? null : (paceMonthlyMinor ?? 0) >= required,
  };
}
