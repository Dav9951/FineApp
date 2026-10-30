import { toBps } from '../utils/money.js';
import { monthsBetween, monthsDiff, shiftMonth } from '../utils/month.js';
import type { PlannedExpensePriority, PlannedExpenseStatus } from './enums.js';
import type { MonthKey } from './primitives.js';

/**
 * Odkładanie, statusy, powtarzanie i ostrzeżenia planowanych wydatków
 * ([07 §6.5](../../../../plans/07-domain-rules.md#65-planowane-wydatki), `F6-1`, `F6-2`,
 * `F6-4`, `F6-5`, ADR-055).
 *
 * Czyste funkcje: API liczy z nich każdy wydatek przy odczycie, a formularz pokazuje
 * „Trzeba odkładać X przez N miesięcy" **zanim** użytkownik zapisze (06 §3.10).
 */

/** Najwyższy udział, jaki mieści kontrakt (`BpsSchema`) — 1000%. */
const MAX_BPS = 100_000;

/** Pełne pokrycie: 100% = 10 000 bps. */
export const FULL_COVERAGE_BPS = 10_000;

/** Statusy „w grze" — wydatek jeszcze nie zapłacony i nie odwołany. */
export const ACTIVE_PLANNED_STATUSES: readonly PlannedExpenseStatus[] = [
  'planned',
  'funding',
  'ready',
  'deferred',
];

/** Problem walidacji krzyżowej planowanego wydatku. */
export interface PlannedExpenseIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Reguły między polami — wspólne dla formularza i serwisu (I-16, I-17, I-19).
 *
 * @param value - Pola wydatku (przy edycji — po scaleniu).
 * @param value.dueMonth - Miesiąc terminu.
 * @param value.dueOn - Dokładna data.
 * @param value.setAsideEnabled - Czy odkładać.
 * @param value.setAsideAccountId - Konto odkładania.
 * @param value.setAsideGoalId - Cel odkładania.
 * @param value.setAsideStartMonth - Początek odkładania.
 * @returns Lista problemów; pusta, gdy wszystko się zgadza.
 */
export function plannedExpenseIssues(value: {
  readonly dueMonth: MonthKey;
  readonly dueOn?: string | null;
  readonly setAsideEnabled?: boolean;
  readonly setAsideAccountId?: string | null;
  readonly setAsideGoalId?: string | null;
  readonly setAsideStartMonth?: MonthKey | null;
}): PlannedExpenseIssue[] {
  const issues: PlannedExpenseIssue[] = [];
  if (value.dueOn && value.dueOn.slice(0, 7) !== value.dueMonth) {
    issues.push({ path: 'dueOn', message: 'Data musi mieścić się w wybranym miesiącu' });
  }
  if (value.setAsideEnabled === true && !value.setAsideAccountId && !value.setAsideGoalId) {
    issues.push({
      path: 'setAsideAccountId',
      message: 'Wskaż konto lub cel, na którym odkładasz',
    });
  }
  if (value.setAsideStartMonth && value.setAsideStartMonth > value.dueMonth) {
    issues.push({
      path: 'setAsideStartMonth',
      message: 'Odkładanie nie może zaczynać się po terminie wydatku',
    });
  }
  return issues;
}

/**
 * Wylicza, ile trzeba odkładać miesięcznie, by uzbierać na termin.
 *
 * Wartość nie jest przechowywana, tylko liczona przy każdym odczycie: po pominięciu
 * jednej wpłaty rata musi wzrosnąć, a zapisana liczba byłaby nieaktualna zaraz po zapisie.
 * Zaokrąglenie w górę — lepiej odłożyć o grosz za dużo niż zabraknąć w terminie.
 *
 * @param remainingMinor - Ile jeszcze brakuje.
 * @param monthsLeft - Pełne miesiące do terminu włącznie z bieżącym (co najmniej 1).
 * @returns Rata miesięczna w groszach.
 */
export function monthlySetAsideMinor(remainingMinor: number, monthsLeft: number): number {
  if (remainingMinor <= 0) return 0;
  const months = Math.max(1, monthsLeft);
  const whole = Math.floor(remainingMinor / months);
  return whole * months < remainingMinor ? whole + 1 : whole;
}

/**
 * Miesiące do terminu włącznie z bieżącym (07 §6.5): termin w tym miesiącu albo miniony
 * (zaległy) — 1, czyli cała reszta teraz.
 *
 * @param currentMonth - Bieżący miesiąc.
 * @param dueMonth - Miesiąc terminu.
 * @returns Liczba miesięcy, co najmniej 1.
 */
export function monthsLeftUntil(currentMonth: MonthKey, dueMonth: MonthKey): number {
  return dueMonth < currentMonth ? 1 : monthsBetween(currentMonth, dueMonth).length;
}

/**
 * Ile powinno być odłożone na dziś (07 §6.5): szacunek × pełne miesiące od startu /
 * wszystkie miesiące odkładania. Bieżący miesiąc się nie liczy — 1 października nikt nie
 * jest spóźniony z październikową wpłatą.
 *
 * @param estimatedAmountMinor - Szacunek wydatku.
 * @param startMonth - Początek odkładania.
 * @param dueMonth - Miesiąc terminu.
 * @param currentMonth - Bieżący miesiąc.
 * @returns Kwota oczekiwana, zaokrąglona w dół.
 */
export function expectedSetAsideMinor(
  estimatedAmountMinor: number,
  startMonth: MonthKey,
  dueMonth: MonthKey,
  currentMonth: MonthKey,
): number {
  const total = Math.max(1, monthsBetween(startMonth, dueMonth).length);
  const elapsed = Math.min(total, Math.max(0, monthsDiff(startMonth, currentMonth)));
  return Math.floor((estimatedAmountMinor * elapsed) / total);
}

/** Wejście do stanu odkładania. */
export interface SetAsideInput {
  readonly estimatedAmountMinor: number;
  readonly setAsideEnabled: boolean;
  /** Zebrane poza aplikacją. */
  readonly alreadySetAsideMinor: number;
  /** Suma przelewów oznaczonych wydatkiem (poza koszem). */
  readonly contributedMinor: number;
  /** Czy w bieżącym miesiącu jest przelew oznaczony wydatkiem. */
  readonly paidThisMonth: boolean;
  readonly setAsideStartMonth: MonthKey;
  readonly dueMonth: MonthKey;
}

/** Stan odkładania. */
export interface SetAsideState {
  readonly accumulatedMinor: number;
  readonly remainingMinor: number;
  readonly coverageBps: number;
  readonly monthlyRequiredMinor: number;
  readonly paidThisMonth: boolean;
  readonly isOnTrack: boolean;
  /** Ile powinno być odłożone na dziś — podstawa `isOnTrack` i `SET_ASIDE_BEHIND`. */
  readonly expectedByNowMinor: number;
}

/**
 * Stan odkładania na wydatek (07 §6.5).
 *
 * ```
 * accumulated = already_set_aside + Σ przelewów z planned_expense_id
 * remaining   = max(0, estimated − accumulated)
 * monthly     = ⌈remaining / miesiące do terminu⌉
 * expected    = ⌊estimated × pełne miesiące od startu / wszystkie miesiące odkładania⌋
 * ```
 *
 * „Pełne miesiące od startu" nie liczą bieżącego — 1 października nikt nie jest spóźniony
 * z październikową wpłatą. Bez włączonego odkładania wydatek jest „w tempie": o braku
 * planu mówi osobne ostrzeżenie `UNFUNDED_MUST_EXPENSE`.
 *
 * @param input - Kwoty i miesiące.
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @returns Stan odkładania.
 */
export function setAsideState(input: SetAsideInput, currentMonth: MonthKey): SetAsideState {
  const accumulatedMinor = input.alreadySetAsideMinor + input.contributedMinor;
  const remainingMinor = Math.max(0, input.estimatedAmountMinor - accumulatedMinor);
  const expectedByNowMinor = expectedSetAsideMinor(
    input.estimatedAmountMinor,
    input.setAsideStartMonth,
    input.dueMonth,
    currentMonth,
  );
  return {
    accumulatedMinor,
    remainingMinor,
    coverageBps: Math.min(
      MAX_BPS,
      Math.max(0, toBps(accumulatedMinor, input.estimatedAmountMinor)),
    ),
    monthlyRequiredMinor: monthlySetAsideMinor(
      remainingMinor,
      monthsLeftUntil(currentMonth, input.dueMonth),
    ),
    paidThisMonth: input.paidThisMonth,
    isOnTrack: !input.setAsideEnabled || accumulatedMinor >= expectedByNowMinor,
    expectedByNowMinor,
  };
}

/**
 * Status wynikający z pieniędzy i kalendarza (07 §6.5, ADR-055).
 *
 * Statusy `planned` → `funding` → `ready` nie są ustawiane ręcznie, tylko wynikają ze stanu:
 * `ready` — pokryte w całości albo nadszedł miesiąc terminu; `funding` — cokolwiek zebrano;
 * inaczej `planned`. `posted` i `cancelled` są końcowe i zostają. Dzięki temu cofnięcie
 * zaksięgowania (07 §6.7) i usunięcie wpłaty same wracają do właściwego stanu.
 *
 * @param stored - Status zapisany.
 * @param state - Stan odkładania.
 * @param dueMonth - Miesiąc terminu.
 * @param currentMonth - Bieżący miesiąc.
 * @returns Status do pokazania i zapisania.
 */
export function derivedPlannedStatus(
  stored: PlannedExpenseStatus,
  state: Pick<SetAsideState, 'accumulatedMinor' | 'coverageBps'>,
  dueMonth: MonthKey,
  currentMonth: MonthKey,
): PlannedExpenseStatus {
  if (stored === 'posted' || stored === 'cancelled') return stored;
  if (state.coverageBps >= FULL_COVERAGE_BPS || dueMonth <= currentMonth) return 'ready';
  return state.accumulatedMinor > 0 ? 'funding' : 'planned';
}

/**
 * Data terminu przesunięta o rok — 29 lutego przechodzi na 28 lutego.
 *
 * @param dueOn - Data `YYYY-MM-DD`.
 * @returns Ta sama data rok później, przycięta do długości miesiąca.
 */
function nextYearDate(dueOn: string): string {
  const year = Number(dueOn.slice(0, 4)) + 1;
  const month = dueOn.slice(5, 7);
  const day = dueOn.slice(8, 10);
  if (month === '02' && day === '29') {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return `${String(year)}-02-${leap ? '29' : '28'}`;
  }
  return `${String(year)}-${month}-${day}`;
}

/** Pola kolejnej instancji wydatku powtarzanego co rok. */
export interface NextYearlyInstance {
  readonly dueMonth: MonthKey;
  readonly dueOn: string | null;
  readonly estimatedAmountMinor: number;
  readonly setAsideStartMonth: MonthKey;
}

/**
 * Kolejna instancja powtarzalnego wydatku po zaksięgowaniu bieżącej (07 §6.5).
 *
 * Kwotą nowej instancji jest kwota FAKTYCZNIE zapłacona, nie poprzedni szacunek —
 * to najlepsza dostępna prognoza na przyszły rok. Odkładanie zaczyna się w miesiącu po
 * zapłacie, więc rozkłada się na pełny rok (jedenaście miesięcy przy zapłacie w terminie
 * — dwunasty to miesiąc samego wydatku).
 *
 * @param dueMonth - Miesiąc terminu zaksięgowanego wydatku.
 * @param dueOn - Dokładna data albo `null`.
 * @param postedAmountMinor - Kwota zapłacona.
 * @param postedMonth - Miesiąc zapłaty.
 * @returns Pola nowej instancji.
 */
export function nextYearlyInstance(
  dueMonth: MonthKey,
  dueOn: string | null,
  postedAmountMinor: number,
  postedMonth: MonthKey,
): NextYearlyInstance {
  const nextDue = shiftMonth(dueMonth, 12);
  const start = shiftMonth(postedMonth, 1);
  return {
    dueMonth: nextDue,
    dueOn: dueOn === null ? null : nextYearDate(dueOn),
    estimatedAmountMinor: postedAmountMinor,
    setAsideStartMonth: start > nextDue ? nextDue : start,
  };
}

/** Kod ostrzeżenia o płynności (07 §6.5). */
export type LiquidityWarningCode =
  'INSUFFICIENT_PROJECTED_BALANCE' | 'UNFUNDED_MUST_EXPENSE' | 'SET_ASIDE_BEHIND';

/** Ostrzeżenie o płynności. */
export interface LiquidityWarning {
  readonly month: MonthKey;
  readonly code: LiquidityWarningCode;
  /** Wydatek, którego dotyczy; `null` — cały miesiąc. */
  readonly plannedExpenseId: string | null;
  readonly gapMinor: number;
}

/** Wydatek widziany przez prognozę. */
export interface LiquidityExpense {
  readonly id: string;
  readonly dueMonth: MonthKey;
  readonly priority: PlannedExpensePriority;
  readonly setAsideEnabled: boolean;
  readonly remainingMinor: number;
  readonly isOnTrack: boolean;
  readonly expectedByNowMinor: number;
  readonly accumulatedMinor: number;
}

/** Przepływ netto pozycji cyklicznych na kontach wydatkowych w miesiącu. */
export interface MonthlyFlow {
  readonly month: MonthKey;
  readonly netMinor: number;
}

/** Ile miesięcy przed terminem (`monthsUntilDue`) ostrzegamy o braku odkładania i zaległości. */
export const LIQUIDITY_WARNING_MONTHS = 3;

/**
 * Wykrywa miesiące, w których planowane wydatki mogą przekroczyć dostępne środki
 * (07 §6.5, ADR-055).
 *
 * Prognoza salda: dzisiejsze saldo kont wydatkowych plus czekające wpływy minus czekające
 * wydatki cykliczne, narastająco po miesiącach. Z wydatków planowanych odejmowana jest
 * **niepokryta** część (`remainingMinor`) — odłożone pieniądze leżą na koncie
 * oszczędnościowym albo celu i czekają na ten wydatek. Wydatki nieregularne celowo pominięte:
 * prognoza ma być ostrożna, a nie dokładna. Ostrzeżenia informują, nie blokują.
 *
 * @param expenses - Aktywne wydatki w horyzoncie.
 * @param startBalanceMinor - Dzisiejsze saldo kont wydatkowych.
 * @param flows - Przepływ cykliczny w kolejnych miesiącach horyzontu, rosnąco.
 * @param currentMonth - Bieżący miesiąc.
 * @returns Ostrzeżenia, rosnąco po miesiącu; pusta lista, gdy wszystko jest pokryte.
 */
export function detectLiquidityWarnings(
  expenses: readonly LiquidityExpense[],
  startBalanceMinor: number,
  flows: readonly MonthlyFlow[],
  currentMonth: MonthKey,
): LiquidityWarning[] {
  const warnings: LiquidityWarning[] = [];
  let balance = startBalanceMinor;
  for (const flow of flows) {
    balance += flow.netMinor;
    const due = expenses.filter(
      (expense) =>
        (expense.dueMonth < currentMonth ? currentMonth : expense.dueMonth) === flow.month,
    );
    const uncovered = due.reduce((sum, expense) => sum + expense.remainingMinor, 0);
    if (uncovered > 0 && uncovered > balance) {
      warnings.push({
        month: flow.month,
        code: 'INSUFFICIENT_PROJECTED_BALANCE',
        plannedExpenseId: null,
        gapMinor: uncovered - Math.max(0, balance),
      });
    }
    balance -= uncovered;
  }

  for (const expense of expenses) {
    const monthsUntilDue = monthsDiff(currentMonth, expense.dueMonth);
    if (monthsUntilDue > LIQUIDITY_WARNING_MONTHS || expense.remainingMinor === 0) continue;
    const month = expense.dueMonth < currentMonth ? currentMonth : expense.dueMonth;
    if (expense.priority === 'must' && !expense.setAsideEnabled) {
      warnings.push({
        month,
        code: 'UNFUNDED_MUST_EXPENSE',
        plannedExpenseId: expense.id,
        gapMinor: expense.remainingMinor,
      });
    } else if (expense.setAsideEnabled && !expense.isOnTrack) {
      warnings.push({
        month,
        code: 'SET_ASIDE_BEHIND',
        plannedExpenseId: expense.id,
        gapMinor: expense.expectedByNowMinor - expense.accumulatedMinor,
      });
    }
  }
  return warnings.sort((a, b) => a.month.localeCompare(b.month));
}
