import { formatMinor, fromBps, toBps } from '../utils/money.js';
import { daysBetween, monthRange, monthsDiff, shiftMonth } from '../utils/month.js';
import { allocationEffects } from './allocation.js';
import type {
  AllocationClass,
  AllocationOverride,
  BudgetLineFlow,
  BudgetLineOrigin,
  GoalKind,
  GoalStatus,
  OccurrenceStatus,
  PlannedExpenseStatus,
  TransactionType,
} from './enums.js';
import { goalTransferSign, plannedContribution, type GoalPlan } from './goal.js';
import { liabilitySchedule, type LiabilityTerms } from './liability.js';
import type { MonthKey } from './primitives.js';
import { occurrenceDatesForMonth, type RecurringSchedule } from './recurring.js';

/**
 * Planer budżetu — czyste wyliczenia szkicu miesiąca
 * ([07 §13](../../../../plans/07-domain-rules.md#13-planer-budżetu), `F9-2`,
 * ADR-075…079).
 *
 * Wszystko tutaj działa na danych już wczytanych przez serwis: reguły z wystąpieniami,
 * planowane wydatki ze stanem odkładania, cele z prognozą. Dzięki temu te same funkcje
 * liczą wypełnienie, stan źródła i ocenę — a testy nie potrzebują bazy.
 */

/** Ile miesięcy naprzód można założyć szkic (I-20). */
export const BUDGET_HORIZON_MONTHS = 12;

/** Granica `SignedBpsSchema` — udział planu przy groszowej podstawie i tak nic nie mówi. */
const MAX_PLANNED_BPS = 100_000;

/** Pula, na którą może trafić linia oszczędności/inwestycji. */
export type BudgetPool = Extract<BudgetLineFlow, 'savings' | 'investment'>;

/**
 * Zakres miesięcy, na które można założyć szkic: od bieżącego do +12 (07 §13.1, I-20).
 *
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @returns Pierwszy i ostatni dozwolony miesiąc.
 */
export function budgetMonthRange(currentMonth: MonthKey): { from: MonthKey; to: MonthKey } {
  return { from: currentMonth, to: shiftMonth(currentMonth, BUDGET_HORIZON_MONTHS) };
}

/**
 * Czy wolno założyć szkic na miesiąc (I-20).
 *
 * @param month - Miesiąc szkicu.
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @returns `true` w zakresie [bieżący, bieżący + 12].
 */
export function canCreateBudgetDraft(month: MonthKey, currentMonth: MonthKey): boolean {
  const range = budgetMonthRange(currentMonth);
  return month >= range.from && month <= range.to;
}

/**
 * Czy szkic można zmieniać (07 §13.1). Plan minionego miesiąca to historia — zostaje
 * do porównania z wykonaniem, ale nie do poprawiania po fakcie.
 *
 * @param month - Miesiąc szkicu.
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @returns `true` dla bieżącego i przyszłych.
 */
export function isBudgetDraftEditable(month: MonthKey, currentMonth: MonthKey): boolean {
  return month >= currentMonth;
}

// ---------------------------------------------------------------------------
// Kwoty źródeł w miesiącu (07 §13.2)
// ---------------------------------------------------------------------------

/** Istniejące wystąpienie reguły — migawka kwoty i status (07 §6.3). */
export interface BudgetOccurrence {
  readonly dueOn: string;
  readonly status: OccurrenceStatus;
  readonly plannedAmountMinor: number;
}

/**
 * Kwota reguły cyklicznej w miesiącu (07 §13.2, kroki 1–3).
 *
 * Każdy termin z `occurrenceDatesForMonth` liczy się migawką istniejącego wystąpienia
 * (podwyżka czynszu nie zmienia planu wstecz, 07 §6.3), zerem, gdy wystąpienie pominięto,
 * albo bieżącą kwotą reguły, gdy wystąpienia jeszcze nie ma — miesiące przyszłe nie mają
 * zapisanych wystąpień (07 §6.2). Tygodniowa siłownia z pięcioma środami daje 5 × kwota.
 *
 * @param schedule - Terminarz reguły.
 * @param amountMinor - Bieżąca kwota reguły.
 * @param month - Miesiąc szkicu.
 * @param occurrences - Wystąpienia reguły (dowolne; liczą się te z terminem w miesiącu).
 * @returns Kwota w miesiącu; `null`, gdy reguła nie ma w nim terminu.
 */
export function ruleAmountForMonth(
  schedule: RecurringSchedule,
  amountMinor: number,
  month: MonthKey,
  occurrences: readonly BudgetOccurrence[],
): number | null {
  const dates = occurrenceDatesForMonth(schedule, month);
  return dates.length === 0
    ? null
    : amountForDates(dates, amountMinor, occurrences, schedule.frequency, month);
}

/**
 * Suma kwot terminów: migawka wystąpienia, 0 dla pominiętego, kwota reguły bez wystąpienia.
 *
 * @param dates - Terminy w miesiącu.
 * @param amountMinor - Bieżąca kwota reguły.
 * @param occurrences - Wystąpienia reguły.
 * @param frequency - Częstotliwość reguły.
 * @param month - Miesiąc terminów.
 * @returns Suma w groszach.
 */
function amountForDates(
  dates: readonly string[],
  amountMinor: number,
  occurrences: readonly BudgetOccurrence[],
  frequency: RecurringSchedule['frequency'],
  month: MonthKey,
): number {
  // Reguła liczona w miesiącach ma w miesiącu najwyżej jedno wystąpienie (ADR-045):
  // czynsz zapłacony 8., po czym dzień zmieniono na 15., to nadal jeden czynsz —
  // liczy się zapisane wystąpienie, nie nowy termin.
  if (frequency !== 'weekly' && frequency !== 'biweekly') {
    const recorded = occurrences.find((occurrence) => occurrence.dueOn.startsWith(month));
    if (recorded !== undefined) {
      return recorded.status === 'skipped' ? 0 : recorded.plannedAmountMinor;
    }
  }
  const byDate = new Map(occurrences.map((occurrence) => [occurrence.dueOn, occurrence]));
  let total = 0;
  for (const date of dates) {
    const occurrence = byDate.get(date);
    if (occurrence === undefined) total += amountMinor;
    else if (occurrence.status !== 'skipped') total += occurrence.plannedAmountMinor;
  }
  return total;
}

/** Klasy kont i nadpisanie przelewu — to, z czego wynika jego pula. */
export interface BudgetTransferClasses {
  readonly sourceAllocationClass: AllocationClass | null;
  readonly targetAllocationClass: AllocationClass | null;
  readonly allocationOverride: AllocationOverride | null;
}

/**
 * Strona bilansu i znak linii z przelewu cyklicznego (07 §13.2, krok 3).
 *
 * Liczone tym samym `allocationEffects`, co wykonanie (§2.2), żeby plan i wykonanie
 * mówiły o tej samej puli. Bez efektu (konto wydatkowe → wydatkowe) — brak linii:
 * przelew między własnymi kontami nie zmienia bilansu. Dwa efekty (oszczędności →
 * inwestycje) — też brak: jedna linia nie wyrazi dwóch pul, a na „Zostaje" taki
 * przelew i tak nie wpływa.
 *
 * @param classes - Klasy kont reguły i nadpisanie.
 * @returns Pula i znak (`1` wpłata, `-1` wypłata) albo `null`.
 */
export function transferBudgetFlow(
  classes: BudgetTransferClasses,
): { flow: BudgetPool; sign: 1 | -1 } | null {
  const effects = allocationEffects({
    type: 'transfer',
    amountMinor: 1,
    ...classes,
    liabilityId: null,
  });
  const [effect] = effects;
  if (effects.length !== 1 || effect === undefined || effect.kind === 'debt_repayment') {
    return null;
  }
  return { flow: effect.kind, sign: effect.amountMinor > 0 ? 1 : -1 };
}

/**
 * Pula odkładania na planowany wydatek: klasa konta albo rodzaj celu (07 §13.2, krok 6).
 *
 * @param accountClass - Klasa konta odkładania; `null`, gdy odkładanie idzie na cel.
 * @param goalKind - Rodzaj celu odkładania; `null`, gdy idzie na konto.
 * @returns Pula; `null` dla konta wydatkowego — pieniądze nie wychodzą z puli wydatków.
 */
export function setAsidePool(
  accountClass: AllocationClass | null,
  goalKind: GoalKind | null,
): BudgetPool | null {
  if (accountClass !== null) return accountClass === 'spending' ? null : accountClass;
  return goalKind;
}

/** Stan odkładania potrzebny do linii szkicu. */
export interface BudgetSetAsideInput {
  readonly estimatedAmountMinor: number;
  readonly dueMonth: MonthKey;
  /** Zebrane do dziś (07 §6.5). */
  readonly accumulatedMinor: number;
  /** Rata liczona na dziś — przyjmowana jako plan na każdy miesiąc do terminu. */
  readonly monthlyRequiredMinor: number;
}

/**
 * Kwota linii odkładania w miesiącu (07 §13.2, krok 6).
 *
 * ```
 * M < due:  +req
 * M = due:  −S_M,  S_M = min(estimated, accumulated + req × monthsDiff(current, M))
 * M > due:  brak
 * ```
 *
 * W miesiącu terminu linia jest **ujemna**: wydatek obciąża miesiąc w całości (krok 5),
 * a odłożone pieniądze wracają z puli — ujęcie netto (ADR-011). Bilans obciąża więc tylko
 * część niepokryta. Bez tego OC za 2 400 zł „rozwaliłoby" marzec, choć od pół roku się
 * na nie odkłada.
 *
 * @param input - Stan odkładania na dziś.
 * @param month - Miesiąc szkicu.
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @returns Kwota ze znakiem; `null`, gdy w tym miesiącu nie ma czego planować.
 */
export function setAsideAmountForMonth(
  input: BudgetSetAsideInput,
  month: MonthKey,
  currentMonth: MonthKey,
): number | null {
  if (month > input.dueMonth) return null;
  if (month < input.dueMonth) {
    return input.monthlyRequiredMinor > 0 ? input.monthlyRequiredMinor : null;
  }
  const monthsBefore = Math.max(0, monthsDiff(currentMonth, month));
  const saved = Math.min(
    input.estimatedAmountMinor,
    input.accumulatedMinor + input.monthlyRequiredMinor * monthsBefore,
  );
  return saved > 0 ? -saved : null;
}

// ---------------------------------------------------------------------------
// Wypełnianie ze źródeł (07 §13.2)
// ---------------------------------------------------------------------------

/** Reguła cykliczna z tym, co potrzebne do linii. */
export interface BudgetRuleSource extends BudgetTransferClasses {
  readonly id: string;
  readonly name: string;
  readonly flow: TransactionType;
  readonly amountMinor: number;
  readonly isActive: boolean;
  readonly schedule: RecurringSchedule;
  readonly occurrences: readonly BudgetOccurrence[];
  readonly categoryId: string | null;
  readonly incomeSourceId: string | null;
  readonly goalId: string | null;
  readonly liabilityId: string | null;
}

/** Rata zobowiązania **bez** reguły, wypadająca w miesiącu szkicu (krok 4). */
export interface BudgetLiabilitySource {
  readonly id: string;
  readonly name: string;
  readonly installmentMinor: number;
  readonly dueOn: string | null;
}

/** Planowany wydatek ze stanem odkładania (kroki 5–6). */
export interface BudgetPlannedSource extends BudgetSetAsideInput {
  readonly id: string;
  readonly name: string;
  readonly status: PlannedExpenseStatus;
  readonly dueOn: string | null;
  readonly postedAmountMinor: number | null;
  readonly categoryId: string | null;
  readonly liabilityId: string | null;
  readonly setAsideEnabled: boolean;
  /** Pula odkładania (`setAsidePool`); `null` — odkładanie nie tworzy linii. */
  readonly setAsidePool: BudgetPool | null;
}

/** Cel z planem wpłat (krok 7). */
export interface BudgetGoalSource {
  readonly id: string;
  readonly name: string;
  readonly kind: GoalKind;
  readonly status: GoalStatus;
  readonly plan: GoalPlan;
}

/** Komplet źródeł gospodarstwa wczytany przez serwis. */
export interface BudgetSources {
  readonly rules: readonly BudgetRuleSource[];
  readonly liabilities: readonly BudgetLiabilitySource[];
  readonly plannedExpenses: readonly BudgetPlannedSource[];
  readonly goals: readonly BudgetGoalSource[];
  /** Źródła przychodu, które **nie** liczą się do podstawy procentu (07 §2.3). */
  readonly nonCountingIncomeSourceIds: ReadonlySet<string>;
}

/** Linia zaproponowana przez źródło — kandydat do wstawienia albo porównania. */
export interface BudgetSourceLine {
  readonly key: string;
  readonly origin: Exclude<BudgetLineOrigin, 'manual'>;
  readonly flow: BudgetLineFlow;
  readonly name: string;
  readonly amountMinor: number;
  readonly categoryId: string | null;
  readonly incomeSourceId: string | null;
  readonly goalId: string | null;
  readonly liabilityId: string | null;
  readonly recurringRuleId: string | null;
  readonly plannedExpenseId: string | null;
  readonly dueOn: string | null;
}

/** Wskaźniki źródła linii — z nich powstaje klucz. */
export interface BudgetSourceRef {
  readonly origin: BudgetLineOrigin;
  readonly recurringRuleId: string | null;
  readonly plannedExpenseId: string | null;
  readonly goalId: string | null;
  readonly liabilityId: string | null;
}

/**
 * Klucz źródła linii — ten sam podział co unikalne indeksy z 03 §3.20.
 *
 * @param ref - Pochodzenie i wskaźniki linii.
 * @returns Klucz; `null` dla linii własnej i osieroconej (źródło usunięte).
 */
export function budgetSourceKey(ref: BudgetSourceRef): string | null {
  switch (ref.origin) {
    case 'recurring':
      return ref.recurringRuleId === null ? null : `recurring:${ref.recurringRuleId}`;
    case 'planned':
    case 'set_aside':
      return ref.plannedExpenseId === null ? null : `${ref.origin}:${ref.plannedExpenseId}`;
    case 'goal':
      return ref.goalId === null ? null : `goal:${ref.goalId}`;
    case 'liability':
      return ref.liabilityId === null ? null : `liability:${ref.liabilityId}`;
    case 'manual':
      return null;
  }
}

/** Pola linii bez klucza — budowane w krokach, klucz dokłada {@link withKey}. */
type LineFields = Omit<BudgetSourceLine, 'key'>;

/** Linia bez żadnych wskaźników — reszta pól nadpisywana w krokach. */
const EMPTY_REFS = {
  categoryId: null,
  incomeSourceId: null,
  goalId: null,
  liabilityId: null,
  recurringRuleId: null,
  plannedExpenseId: null,
  dueOn: null,
} as const;

/**
 * Dokłada do linii jej klucz źródła — `origin:id`, jak w {@link budgetSourceKey}.
 *
 * @param line - Pola linii ze źródła.
 * @param sourceId - Identyfikator źródła.
 * @returns Linia z kluczem.
 */
function withKey(line: LineFields, sourceId: string): BudgetSourceLine {
  return { ...line, key: `${line.origin}:${sourceId}` };
}

/**
 * Linia reguły cyklicznej (kroki 1–3).
 *
 * @param rule - Reguła.
 * @param month - Miesiąc szkicu.
 * @returns Linia albo `null`, gdy reguła nie daje nic w miesiącu.
 */
function ruleLine(rule: BudgetRuleSource, month: MonthKey): BudgetSourceLine | null {
  if (!rule.isActive) return null;
  const dates = occurrenceDatesForMonth(rule.schedule, month);
  const [firstDate] = dates;
  if (firstDate === undefined) return null;
  const amount = amountForDates(
    dates,
    rule.amountMinor,
    rule.occurrences,
    rule.schedule.frequency,
    month,
  );
  const base = {
    ...EMPTY_REFS,
    origin: 'recurring' as const,
    name: rule.name,
    recurringRuleId: rule.id,
    dueOn: firstDate,
  };
  if (rule.flow === 'income') {
    return withKey(
      {
        ...base,
        flow: 'income',
        amountMinor: amount,
        categoryId: rule.categoryId,
        incomeSourceId: rule.incomeSourceId,
      },
      rule.id,
    );
  }
  if (rule.flow === 'expense') {
    return withKey(
      {
        ...base,
        flow: 'expense',
        amountMinor: amount,
        categoryId: rule.categoryId,
        liabilityId: rule.liabilityId,
      },
      rule.id,
    );
  }
  const pool = transferBudgetFlow(rule);
  if (pool === null) return null;
  return withKey(
    { ...base, flow: pool.flow, amountMinor: amount * pool.sign, goalId: rule.goalId },
    rule.id,
  );
}

/**
 * Suma wpływów liczonych do podstawy procentu (07 §2.3) — z linii albo kandydatów.
 *
 * @param lines - Linie z polami `flow`, kwotą i źródłem przychodu.
 * @param nonCounting - Źródła, które się nie liczą.
 * @returns Podstawa w groszach.
 */
function incomeBaseOf(
  lines: readonly Pick<BudgetSourceLine, 'flow' | 'amountMinor' | 'incomeSourceId'>[],
  nonCounting: ReadonlySet<string>,
): number {
  let base = 0;
  for (const line of lines) {
    if (line.flow !== 'income') continue;
    if (line.incomeSourceId !== null && nonCounting.has(line.incomeSourceId)) continue;
    base += line.amountMinor;
  }
  return base;
}

/**
 * Linie, które źródła proponują dla miesiąca (07 §13.2, kroki 1–7).
 *
 * Kolejność kroków jest ustalona — cele procentowe liczą się od wpływów z kroku 1.
 * Wynik służy dwóm rzeczom: wstawieniu brakujących linii (`ON CONFLICT DO NOTHING`
 * po kluczu) i stanowi źródła istniejących linii (§13.5). Każde źródło daje najwyżej
 * jedną linię.
 *
 * @param sources - Źródła gospodarstwa.
 * @param month - Miesiąc szkicu.
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @returns Linie w kolejności kroków.
 */
export function buildBudgetSourceLines(
  sources: BudgetSources,
  month: MonthKey,
  currentMonth: MonthKey,
): BudgetSourceLine[] {
  const ruleLines = sources.rules
    .map((rule) => ruleLine(rule, month))
    .filter((line): line is BudgetSourceLine => line !== null);
  const byFlow = (flows: readonly BudgetLineFlow[]): BudgetSourceLine[] =>
    ruleLines.filter((line) => flows.includes(line.flow));

  const lines: BudgetSourceLine[] = [
    ...byFlow(['income']),
    ...byFlow(['expense']),
    ...byFlow(['savings', 'investment']),
  ];

  for (const liability of sources.liabilities) {
    if (liability.installmentMinor <= 0) continue;
    lines.push(
      withKey(
        {
          ...EMPTY_REFS,
          origin: 'liability',
          flow: 'expense',
          name: liability.name,
          amountMinor: liability.installmentMinor,
          liabilityId: liability.id,
          dueOn: liability.dueOn,
        },
        liability.id,
      ),
    );
  }

  const setAsideLines: BudgetSourceLine[] = [];
  for (const expense of sources.plannedExpenses) {
    if (expense.status === 'cancelled') continue;
    if (expense.dueMonth === month) {
      lines.push(
        withKey(
          {
            ...EMPTY_REFS,
            origin: 'planned',
            flow: 'expense',
            name: expense.name,
            amountMinor:
              expense.status === 'posted' && expense.postedAmountMinor !== null
                ? expense.postedAmountMinor
                : expense.estimatedAmountMinor,
            categoryId: expense.categoryId,
            liabilityId: expense.liabilityId,
            plannedExpenseId: expense.id,
            dueOn: expense.dueOn,
          },
          expense.id,
        ),
      );
    }
    // Zapłacony wydatek nie ma już czego odkładać ani skąd wypłacać.
    if (!expense.setAsideEnabled || expense.setAsidePool === null) continue;
    if (expense.status === 'posted') continue;
    const amount = setAsideAmountForMonth(expense, month, currentMonth);
    if (amount === null) continue;
    setAsideLines.push(
      withKey(
        {
          ...EMPTY_REFS,
          origin: 'set_aside',
          flow: expense.setAsidePool,
          name: amount < 0 ? `Z odłożonego: ${expense.name}` : `Odkładanie: ${expense.name}`,
          amountMinor: amount,
          plannedExpenseId: expense.id,
        },
        expense.id,
      ),
    );
  }
  lines.push(...setAsideLines);

  const incomeBase = incomeBaseOf(lines, sources.nonCountingIncomeSourceIds);
  const goalsWithRule = new Set(
    ruleLines.map((line) => line.goalId).filter((id): id is string => id !== null),
  );
  for (const goal of sources.goals) {
    if (goal.status !== 'active' || goalsWithRule.has(goal.id)) continue;
    const amount = plannedContribution(goal.plan, incomeBase).plannedAmountMinor;
    if (amount === null || amount <= 0) continue;
    lines.push(
      withKey(
        {
          ...EMPTY_REFS,
          origin: 'goal',
          flow: goal.kind,
          name: goal.name,
          amountMinor: amount,
          goalId: goal.id,
        },
        goal.id,
      ),
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Stan źródła (07 §13.5)
// ---------------------------------------------------------------------------

/** Stan źródła linii powiązanej (07 §13.5). */
export type BudgetSourceState = 'in_sync' | 'source_changed' | 'not_in_month' | 'missing';

/** Linia w zakresie potrzebnym do stanu źródła. */
export interface BudgetSourceStateLine extends BudgetSourceRef {
  readonly sourceAmountMinor: number | null;
}

/** Stan źródła i bieżąca kwota źródła, gdy się zmieniła. */
export interface BudgetSourceStatus {
  readonly state: BudgetSourceState | null;
  readonly currentAmountMinor: number | null;
}

/**
 * Stan źródła linii w szkicu edytowalnym (07 §13.5).
 *
 * Różnica między kwotą linii a `sourceAmountMinor` to **decyzja** w szkicu — nie zmienia
 * stanu. Liczy się tylko to, czy źródło zmieniło się od wypełnienia (ADR-076).
 *
 * @param line - Linia ze wskaźnikami i migawką kwoty źródła.
 * @param current - Linie proponowane teraz przez źródła (`buildBudgetSourceLines`), po kluczu.
 * @returns Stan; `null` dla linii własnej.
 */
export function budgetSourceStatus(
  line: BudgetSourceStateLine,
  current: ReadonlyMap<string, BudgetSourceLine>,
): BudgetSourceStatus {
  if (line.origin === 'manual') return { state: null, currentAmountMinor: null };
  const key = budgetSourceKey(line);
  if (key === null) return { state: 'missing', currentAmountMinor: null };
  const source = current.get(key);
  if (source === undefined) return { state: 'not_in_month', currentAmountMinor: null };
  if (source.amountMinor === line.sourceAmountMinor) {
    return { state: 'in_sync', currentAmountMinor: null };
  }
  return { state: 'source_changed', currentAmountMinor: source.amountMinor };
}

// ---------------------------------------------------------------------------
// Co można zrobić z linią (07 §13.6–13.7)
// ---------------------------------------------------------------------------

/** Cel zamiany linii własnej. */
export type BudgetPromoteTarget = 'recurring' | 'planned';

/** Linia w zakresie potrzebnym do decyzji o zamianie. */
export interface BudgetPromotableLine {
  readonly origin: BudgetLineOrigin;
  readonly flow: BudgetLineFlow;
  readonly amountMinor: number;
  readonly isExcluded: boolean;
}

/**
 * Na co można zamienić linię (07 §13.6): tylko własną, niewykluczoną, z kwotą > 0,
 * w szkicu edytowalnym. Planowany wydatek — tylko z wydatku.
 *
 * @param line - Linia.
 * @param editable - Czy szkic jest edytowalny.
 * @returns Dozwolone cele, w kolejności pokazywania.
 */
export function budgetPromoteTargets(
  line: BudgetPromotableLine,
  editable: boolean,
): BudgetPromoteTarget[] {
  if (!editable || line.origin !== 'manual' || line.isExcluded || line.amountMinor <= 0) {
    return [];
  }
  return line.flow === 'expense' ? ['recurring', 'planned'] : ['recurring'];
}

/** Kontekst źródła potrzebny do „Zastosuj w źródle". */
export interface BudgetApplyContext {
  /** Reguła jest regułą raty zobowiązania (`liabilities.recurring_rule_id`). */
  readonly isLiabilityRule: boolean;
  /**
   * Reguła tygodniowa albo co dwa tygodnie — linia niesie sumę kilku terminów
   * miesiąca, więc nie da się z niej odczytać kwoty jednej płatności.
   */
  readonly isWeeklyRule: boolean;
  /** Tryb planu wpłat celu linii `goal`; `null` dla innych. */
  readonly goalContributionMode: GoalPlan['contributionMode'] | null;
}

/**
 * Czy kwotę linii można zapisać w źródle (07 §13.7). Odkładanie, rata bez reguły i cel
 * procentowy mają kwotę wyliczaną — nie ma czego zapisać. Rata z reguły zmienia się
 * w zobowiązaniu, bo podział reguły zerwałby powiązanie. Reguła tygodniowa ma w linii
 * sumę kilku terminów — jej kwotę zmienia się na ekranie pozycji cyklicznych.
 *
 * @param line - Linia ze wskaźnikami.
 * @param editable - Czy szkic jest edytowalny.
 * @param context - Kontekst źródła.
 * @returns `true`, gdy akcja jest dozwolona.
 */
export function canApplyBudgetLineToSource(
  line: BudgetSourceRef & { readonly isExcluded: boolean },
  editable: boolean,
  context: BudgetApplyContext,
): boolean {
  if (!editable || line.isExcluded || budgetSourceKey(line) === null) return false;
  switch (line.origin) {
    case 'recurring':
      return !context.isLiabilityRule && !context.isWeeklyRule;
    case 'planned':
      return true;
    case 'goal':
      return context.goalContributionMode === 'fixed';
    default:
      return false;
  }
}

/** Skutek „Zastosuj w regule" — zmiana kwoty albo podział (07 §13.7). */
export type BudgetRuleApplyKind = 'rule_updated' | 'rule_split';

/**
 * Jak zastosować kwotę w regule dla miesiąca szkicu (07 §13.7).
 *
 * Zmiana kwoty reguły działa od bieżącego miesiąca (07 §6.4). Dla miesiąca późniejszego
 * niż bieżący i niż start reguły trzeba ją **podzielić** — inaczej podwyżka „od grudnia"
 * zmieniłaby też październik i listopad.
 *
 * @param month - Miesiąc szkicu.
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @param ruleStartMonth - Pierwszy miesiąc reguły.
 * @returns Rodzaj skutku.
 */
export function ruleApplyKind(
  month: MonthKey,
  currentMonth: MonthKey,
  ruleStartMonth: MonthKey,
): BudgetRuleApplyKind {
  return month > currentMonth && month > ruleStartMonth ? 'rule_split' : 'rule_updated';
}

// ---------------------------------------------------------------------------
// Ocena szkicu (07 §13.4)
// ---------------------------------------------------------------------------

/** Linia w zakresie potrzebnym do oceny. */
export interface BudgetEvaluationLine {
  readonly flow: BudgetLineFlow;
  readonly origin: BudgetLineOrigin;
  readonly amountMinor: number;
  readonly isExcluded: boolean;
  readonly incomeSourceId: string | null;
  readonly goalId: string | null;
  readonly liabilityId: string | null;
  readonly plannedExpenseId: string | null;
  readonly sourceState: BudgetSourceState | null;
}

/** Rozkład docelowy obowiązujący w miesiącu szkicu (03 §3.10). */
export interface BudgetAllocationTargets {
  readonly savingsBps: number;
  readonly investmentBps: number;
  readonly debtBps: number;
}

/** Aktywny cel do oceny. */
export interface BudgetGoalCheckInput {
  readonly id: string;
  readonly name: string;
  readonly kind: GoalKind;
  /** `requiredMonthly` z prognozy (07 §4.2) — gdy cel ma kwotę i termin. */
  readonly requiredMonthlyMinor: number | null;
  readonly plan: GoalPlan;
}

/** Planowany wydatek z odkładaniem do oceny. */
export interface BudgetSetAsideCheckInput {
  readonly plannedExpenseId: string;
  readonly name: string;
  readonly dueMonth: MonthKey;
  /** Rata na dziś (07 §6.5). */
  readonly requiredMinor: number;
}

/** Wejście oceny szkicu. */
export interface BudgetEvaluationInput {
  readonly month: MonthKey;
  readonly lines: readonly BudgetEvaluationLine[];
  readonly nonCountingIncomeSourceIds: ReadonlySet<string>;
  readonly targets: BudgetAllocationTargets;
  readonly goals: readonly BudgetGoalCheckInput[];
  readonly setAside: readonly BudgetSetAsideCheckInput[];
}

/** Ocena linii rozkładu. */
export interface BudgetAllocationLine {
  readonly kind: 'savings' | 'investment' | 'debt';
  readonly targetBps: number;
  readonly targetMinor: number;
  readonly plannedMinor: number;
  readonly plannedBps: number;
  readonly status: 'met' | 'short';
  readonly shortfallMinor: number;
}

/** Ocena celu. */
export interface BudgetGoalCheck {
  readonly goalId: string;
  readonly name: string;
  readonly kind: GoalKind;
  readonly plannedMinor: number;
  readonly requiredMinor: number | null;
  readonly requirementBasis: 'target_date' | 'contribution_plan' | null;
  readonly status: 'met' | 'short' | 'no_requirement';
  readonly shortfallMinor: number;
}

/** Ocena odkładania. */
export interface BudgetSetAsideCheck {
  readonly plannedExpenseId: string;
  readonly name: string;
  readonly dueMonth: MonthKey;
  readonly requiredMinor: number;
  readonly plannedMinor: number;
  readonly status: 'met' | 'short';
}

/** Kod ostrzeżenia szkicu (07 §13.4). */
export type BudgetWarningCode =
  | 'NEGATIVE_LEFTOVER'
  | 'NO_INCOME'
  | 'ALLOCATION_SHORT'
  | 'GOAL_SHORT'
  | 'SET_ASIDE_SHORT'
  | 'ORPHAN_LINES';

/** Ostrzeżenie szkicu — informuje, nie blokuje. */
export interface BudgetWarning {
  readonly code: BudgetWarningCode;
  readonly message: string;
  readonly amountMinor: number | null;
  readonly target: {
    readonly kind: 'savings' | 'investment' | 'debt' | 'goal' | 'planned_expense';
    readonly id: string | null;
  } | null;
}

/** Ocena szkicu (07 §13.4). */
export interface BudgetSummary {
  readonly incomeMinor: number;
  readonly incomeBaseMinor: number;
  readonly hasIncomeBase: boolean;
  readonly expenseMinor: number;
  readonly savingsMinor: number;
  readonly investmentMinor: number;
  readonly debtRepaymentMinor: number;
  readonly leftoverMinor: number;
  readonly allocation: BudgetAllocationLine[];
  readonly goals: BudgetGoalCheck[];
  readonly setAside: BudgetSetAsideCheck[];
  readonly warnings: BudgetWarning[];
}

/** Nazwy pul w komunikatach. */
const POOL_LABEL: Record<BudgetAllocationLine['kind'], string> = {
  savings: 'oszczędności',
  investment: 'inwestycji',
  debt: 'spłaty zobowiązań',
};

/**
 * Ocena linii rozkładu docelowego (07 §13.4). Plan dotyczy całego miesiąca, więc nie ma
 * statusu „w tempie" z 07 §2.5.
 *
 * @param kind - Pula.
 * @param targetBps - Cel w bps.
 * @param plannedMinor - Plan netto (może być ujemny).
 * @param incomeBaseMinor - Podstawa procentu.
 * @returns Ocena linii.
 */
function allocationLine(
  kind: BudgetAllocationLine['kind'],
  targetBps: number,
  plannedMinor: number,
  incomeBaseMinor: number,
): BudgetAllocationLine {
  const targetMinor = fromBps(targetBps, incomeBaseMinor);
  const shortfallMinor = Math.max(0, targetMinor - plannedMinor);
  const plannedBps = Math.max(
    -MAX_PLANNED_BPS,
    Math.min(MAX_PLANNED_BPS, toBps(plannedMinor, incomeBaseMinor)),
  );
  return {
    kind,
    targetBps,
    targetMinor,
    plannedMinor,
    plannedBps,
    status: shortfallMinor > 0 ? 'short' : 'met',
    shortfallMinor,
  };
}

/**
 * Ocena celu (07 §13.4): wymaganie z terminu celu, a bez terminu — z planu wpłat.
 *
 * @param goal - Cel.
 * @param plannedMinor - Suma linii z tym celem.
 * @param incomeBaseMinor - Podstawa procentu (plan procentowy).
 * @returns Ocena celu.
 */
function goalCheck(
  goal: BudgetGoalCheckInput,
  plannedMinor: number,
  incomeBaseMinor: number,
): BudgetGoalCheck {
  let requiredMinor: number | null = null;
  let requirementBasis: BudgetGoalCheck['requirementBasis'] = null;
  if (goal.requiredMonthlyMinor !== null) {
    requiredMinor = goal.requiredMonthlyMinor;
    requirementBasis = 'target_date';
  } else {
    const fromPlan = plannedContribution(goal.plan, incomeBaseMinor).plannedAmountMinor;
    if (fromPlan !== null) {
      requiredMinor = fromPlan;
      requirementBasis = 'contribution_plan';
    }
  }
  const base = { goalId: goal.id, name: goal.name, kind: goal.kind, plannedMinor };
  if (requiredMinor === null) {
    return {
      ...base,
      requiredMinor,
      requirementBasis,
      status: 'no_requirement',
      shortfallMinor: 0,
    };
  }
  const shortfallMinor = Math.max(0, requiredMinor - plannedMinor);
  return {
    ...base,
    requiredMinor,
    requirementBasis,
    status: shortfallMinor > 0 ? 'short' : 'met',
    shortfallMinor,
  };
}

/**
 * Ocena szkicu (07 §13.4): bilans, rozkład docelowy, cele, odkładanie i ostrzeżenia.
 *
 * Rachunek jest lustrem `net(M)` z 07 §12.1, żeby plan i wykonanie dało się porównać
 * linia w linię. Linie wykluczone się nie liczą (I-24). „Zostaje" ujemne zostaje ujemne —
 * obcięcie do zera ukryłoby, że plan się nie domyka (ADR-011). Nic tu nie blokuje
 * zapisu — użytkownik może wiedzieć coś, czego aplikacja nie wie.
 *
 * @param input - Linie, rozkład, cele i odkładanie.
 * @returns Ocena szkicu.
 */
export function evaluateBudget(input: BudgetEvaluationInput): BudgetSummary {
  const lines = input.lines.filter((line) => !line.isExcluded);
  const sum = (predicate: (line: BudgetEvaluationLine) => boolean): number =>
    lines.filter(predicate).reduce((total, line) => total + line.amountMinor, 0);

  const incomeMinor = sum((line) => line.flow === 'income');
  const incomeBaseMinor = incomeBaseOf(lines, input.nonCountingIncomeSourceIds);
  const expenseMinor = sum((line) => line.flow === 'expense');
  const savingsMinor = sum((line) => line.flow === 'savings');
  const investmentMinor = sum((line) => line.flow === 'investment');
  const debtRepaymentMinor = sum((line) => line.flow === 'expense' && line.liabilityId !== null);
  const leftoverMinor = incomeMinor - expenseMinor - savingsMinor - investmentMinor;

  const allocation: BudgetAllocationLine[] = (
    [
      ['savings', input.targets.savingsBps, savingsMinor],
      ['investment', input.targets.investmentBps, investmentMinor],
      ['debt', input.targets.debtBps, debtRepaymentMinor],
    ] as const
  )
    .filter(([, bps]) => bps > 0)
    .map(([kind, bps, planned]) => allocationLine(kind, bps, planned, incomeBaseMinor));

  const goals = input.goals.map((goal) =>
    goalCheck(
      goal,
      sum((line) => line.origin !== 'set_aside' && line.goalId === goal.id),
      incomeBaseMinor,
    ),
  );

  const setAside: BudgetSetAsideCheck[] = input.setAside
    .filter((item) => item.dueMonth > input.month)
    .map((item) => {
      const plannedMinor = sum(
        (line) => line.origin === 'set_aside' && line.plannedExpenseId === item.plannedExpenseId,
      );
      return {
        plannedExpenseId: item.plannedExpenseId,
        name: item.name,
        dueMonth: item.dueMonth,
        requiredMinor: item.requiredMinor,
        plannedMinor,
        status: plannedMinor < item.requiredMinor ? 'short' : 'met',
      };
    });

  const warnings: BudgetWarning[] = [];
  if (leftoverMinor < 0) {
    warnings.push({
      code: 'NEGATIVE_LEFTOVER',
      message: `Plan jest na minusie o ${formatMinor(-leftoverMinor)}.`,
      amountMinor: leftoverMinor,
      target: null,
    });
  }
  if (incomeMinor === 0 && expenseMinor > 0) {
    warnings.push({
      code: 'NO_INCOME',
      message: 'W planie nie ma żadnych wpływów.',
      amountMinor: null,
      target: null,
    });
  }
  for (const line of allocation) {
    if (line.status !== 'short') continue;
    warnings.push({
      code: 'ALLOCATION_SHORT',
      message: `Do planu ${POOL_LABEL[line.kind]} brakuje ${formatMinor(line.shortfallMinor)}.`,
      amountMinor: line.shortfallMinor,
      target: { kind: line.kind, id: null },
    });
  }
  for (const goal of goals) {
    if (goal.status !== 'short') continue;
    warnings.push({
      code: 'GOAL_SHORT',
      message: `„${goal.name}” — do wymaganej wpłaty brakuje ${formatMinor(goal.shortfallMinor)}.`,
      amountMinor: goal.shortfallMinor,
      target: { kind: 'goal', id: goal.goalId },
    });
  }
  for (const item of setAside) {
    if (item.status !== 'short') continue;
    const missing = item.requiredMinor - item.plannedMinor;
    warnings.push({
      code: 'SET_ASIDE_SHORT',
      message: `„${item.name}” — na odkładanie brakuje ${formatMinor(missing)}.`,
      amountMinor: missing,
      target: { kind: 'planned_expense', id: item.plannedExpenseId },
    });
  }
  const orphans = input.lines.filter((line) => line.sourceState === 'missing').length;
  if (orphans > 0) {
    warnings.push({
      code: 'ORPHAN_LINES',
      message:
        orphans === 1
          ? 'Jedna pozycja planu straciła źródło — zostaw ją jako własną albo usuń.'
          : `Pozycje planu bez źródła: ${String(orphans)} — zostaw je jako własne albo usuń.`,
      amountMinor: null,
      target: null,
    });
  }

  return {
    incomeMinor,
    incomeBaseMinor,
    hasIncomeBase: incomeBaseMinor > 0,
    expenseMinor,
    savingsMinor,
    investmentMinor,
    debtRepaymentMinor,
    leftoverMinor,
    allocation,
    goals,
    setAside,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Walidacja linii (I-21, I-23)
// ---------------------------------------------------------------------------

/** Problem z linią szkicu — ścieżka pola i komunikat. */
export interface BudgetLineIssue {
  readonly path: string;
  readonly message: string;
}

/** Pola linii, których spójność sprawdzamy bez bazy. */
export interface BudgetLineShape {
  readonly flow: BudgetLineFlow;
  readonly amountMinor: number;
  readonly categoryId: string | null;
  readonly incomeSourceId: string | null;
  readonly goalId: string | null;
  readonly dueOn: string | null;
}

/**
 * Niezmienniki kształtu linii widoczne bez bazy (I-21, I-23) i data w miesiącu szkicu.
 * Zgodność rodzaju kategorii z `flow` sprawdza serwis — potrzebuje kategorii z bazy.
 *
 * @param line - Pola linii.
 * @param month - Miesiąc szkicu; `null`, gdy nieznany (walidacja samego żądania).
 * @returns Lista problemów; pusta, gdy linia jest spójna.
 */
export function budgetLineIssues(line: BudgetLineShape, month: MonthKey | null): BudgetLineIssue[] {
  const issues: BudgetLineIssue[] = [];
  const isPool = line.flow === 'savings' || line.flow === 'investment';
  if (line.amountMinor < 0 && !isPool) {
    issues.push({
      path: 'amountMinor',
      message: 'Kwota ujemna jest dozwolona tylko dla oszczędności i inwestycji',
    });
  }
  if (isPool && line.categoryId !== null) {
    issues.push({ path: 'categoryId', message: 'Oszczędności i inwestycje nie mają kategorii' });
  }
  if (line.incomeSourceId !== null && line.flow !== 'income') {
    issues.push({ path: 'incomeSourceId', message: 'Źródło przychodu dotyczy tylko wpływów' });
  }
  if (line.goalId !== null && !isPool) {
    issues.push({ path: 'goalId', message: 'Cel dotyczy tylko oszczędności i inwestycji' });
  }
  if (month !== null && line.dueOn !== null && line.dueOn.slice(0, 7) !== month) {
    issues.push({ path: 'dueOn', message: 'Data musi mieścić się w miesiącu planu' });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Średnia kategorii (07 §13.3, ADR-078)
// ---------------------------------------------------------------------------

/** Dozwolone okna średniej w miesiącach. */
export const BUDGET_AVERAGE_WINDOWS = [3, 6, 12] as const;

/**
 * Okno średniej: N pełnych miesięcy przed bieżącym (07 §13.3).
 *
 * Nie zależy od miesiąca szkicu — przy planowaniu na luty najświeższą wiedzą są i tak
 * ostatnie pełne miesiące, a okno „do lutego" zawierałoby miesiące bez danych.
 *
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @param months - Długość okna.
 * @returns Pierwszy i ostatni miesiąc okna (włącznie).
 */
export function averageWindow(
  currentMonth: MonthKey,
  months: number,
): { from: MonthKey; to: MonthKey } {
  return { from: shiftMonth(currentMonth, -months), to: shiftMonth(currentMonth, -1) };
}

/**
 * Zaokrągla kwotę w górę do pełnego złotego — plan ma być ostrożny, a grosze w planie
 * są szumem (07 §13.3).
 *
 * @param minor - Kwota w groszach, nieujemna.
 * @returns Kwota w groszach, wielokrotność 100.
 */
export function ceilToZloty(minor: number): number {
  return Math.ceil(minor / 100) * 100;
}

/** Kategoria główna z identyfikatorami podkategorii. */
export interface AverageCategory {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly childIds: readonly string[];
}

/** Wydatek zmienny kategorii w miesiącu — wiersz zapytania księgi. */
export interface CategoryMonthSpend {
  readonly categoryId: string;
  readonly monthKey: MonthKey;
  readonly amountMinor: number;
}

/** Średnia kategorii z kwotami miesięcy, które się liczą. */
export interface CategoryAverage {
  readonly categoryId: string;
  readonly name: string;
  readonly icon: string | null;
  readonly averageMinor: number;
  readonly byMonth: { readonly month: MonthKey; readonly amountMinor: number }[];
}

/** Średnie kategorii w oknie. */
export interface CategoryAverages {
  readonly window: { readonly from: MonthKey; readonly to: MonthKey };
  readonly monthsWithData: number;
  readonly items: CategoryAverage[];
}

/**
 * Średnie miesięczne kategorii wydatków (07 §13.3).
 *
 * - Miesiące bez wydatku liczą się jako **0** — rzadki wydatek (fryzjer co dwa miesiące)
 *   ma się rozłożyć, a nie podwoić.
 * - Mianownik to miesiące okna nie wcześniejsze niż pierwsza transakcja gospodarstwa:
 *   przy dwóch miesiącach historii średnia z sześciu dzieli przez dwa.
 * - Podkategorie doliczane do kategorii głównej (jak rozbicie, 07 §12.4); wydatki
 *   w kategoriach spoza drzewa się nie liczą.
 * - Wynik w górę do pełnego złotego.
 *
 * Wiersze wydatków mają już wyłączone transakcje z reguł, planowanych wydatków
 * i zobowiązań — to robi zapytanie księgi, żeby czynsz nie był w szkicu dwa razy.
 *
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @param months - Długość okna.
 * @param firstDataMonth - Miesiąc najwcześniejszej transakcji; `null` — brak historii.
 * @param categories - Kategorie główne wydatków z podkategoriami.
 * @param spend - Wydatki zmienne w oknie, po kategorii i miesiącu.
 * @returns Kategorie z wydatkiem w oknie, malejąco po średniej, potem po nazwie.
 */
export function categoryAverages(
  currentMonth: MonthKey,
  months: number,
  firstDataMonth: MonthKey | null,
  categories: readonly AverageCategory[],
  spend: readonly CategoryMonthSpend[],
): CategoryAverages {
  const window = averageWindow(currentMonth, months);
  const counted =
    firstDataMonth === null || firstDataMonth > window.to
      ? []
      : Array.from({ length: months }, (_, index) => shiftMonth(window.from, index)).filter(
          (month) => month >= firstDataMonth,
        );
  const countedSet = new Set(counted);

  const parentOf = new Map<string, string>();
  for (const category of categories) {
    parentOf.set(category.id, category.id);
    for (const childId of category.childIds) parentOf.set(childId, category.id);
  }
  const totals = new Map<string, Map<MonthKey, number>>();
  for (const row of spend) {
    const parentId = parentOf.get(row.categoryId);
    if (parentId === undefined || !countedSet.has(row.monthKey)) continue;
    const byMonth = totals.get(parentId) ?? new Map<MonthKey, number>();
    byMonth.set(row.monthKey, (byMonth.get(row.monthKey) ?? 0) + row.amountMinor);
    totals.set(parentId, byMonth);
  }

  const items: CategoryAverage[] = [];
  for (const category of categories) {
    const byMonth = totals.get(category.id);
    if (byMonth === undefined) continue;
    const total = [...byMonth.values()].reduce((sum, amount) => sum + amount, 0);
    if (total <= 0) continue;
    items.push({
      categoryId: category.id,
      name: category.name,
      icon: category.icon,
      averageMinor: ceilToZloty(total / counted.length),
      byMonth: counted.map((month) => ({ month, amountMinor: byMonth.get(month) ?? 0 })),
    });
  }
  items.sort((a, b) => b.averageMinor - a.averageMinor || a.name.localeCompare(b.name, 'pl'));
  return { window, monthsWithData: counted.length, items };
}

// ---------------------------------------------------------------------------
// Pomocnicze dla serwisu (07 §13.1–13.2, 06 §3.14)
// ---------------------------------------------------------------------------

/** Ile ostatnich dni miesiąca podpowiada planowanie następnego (06 §3.14). */
export const BUDGET_SUGGEST_NEXT_DAYS = 7;

/**
 * Czy trwa ostatni tydzień miesiąca — pora planować następny (06 §3.14).
 *
 * Wspólne dla kafla „Zaplanuj …" na liście planów i podpowiedzi na dashboardzie, żeby
 * oba miejsca zmieniały zdanie tego samego dnia.
 *
 * @param today - Dzisiejsza data gospodarstwa.
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @returns `true` w ostatnich `BUDGET_SUGGEST_NEXT_DAYS` dniach miesiąca.
 */
export function isNearBudgetMonthEnd(today: string, currentMonth: MonthKey): boolean {
  return daysBetween(today, monthRange(currentMonth).to) < BUDGET_SUGGEST_NEXT_DAYS;
}

/**
 * Miesiąc, który warto teraz zaplanować — kafel „Zaplanuj …" (04 §14a, 06 §3.14).
 *
 * W ostatnim tygodniu miesiąca to już następny miesiąc (planuje się „pod koniec
 * miesiąca albo na początku kolejnego"); poza nim — bieżący. Pierwszy z zakresu,
 * który nie ma jeszcze szkicu.
 *
 * @param today - Dzisiejsza data gospodarstwa.
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @param existing - Miesiące, które mają szkic.
 * @returns Miesiąc bez szkicu albo `null`, gdy cały zakres jest zaplanowany.
 */
export function suggestedBudgetMonth(
  today: string,
  currentMonth: MonthKey,
  existing: ReadonlySet<MonthKey>,
): MonthKey | null {
  const nearEnd = isNearBudgetMonthEnd(today, currentMonth);
  const range = budgetMonthRange(currentMonth);
  for (let month = nearEnd ? shiftMonth(currentMonth, 1) : currentMonth; month <= range.to;) {
    if (!existing.has(month)) return month;
    month = shiftMonth(month, 1);
  }
  return null;
}

/** Zobowiązanie w zakresie potrzebnym do raty w miesiącu (07 §5.1). */
export interface BudgetLiabilityInput extends LiabilityTerms {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly recurringRuleId: string | null;
  readonly remainingMinor: number;
  readonly nextDueOn: string | null;
  readonly paidThisMonth: boolean;
  readonly lastPaymentOn: string | null;
}

/**
 * Rata zobowiązania **bez** reguły w miesiącu szkicu (07 §13.2, krok 4).
 *
 * Z harmonogramu (07 §5.1) — rata wypadająca w M. W bieżącym miesiącu rata już
 * zapłacona przesuwa „najbliższą" na kolejny, a plan miesiąca nadal ją zawiera — wtedy
 * linia to rata z dniem ostatniej płatności. Zobowiązanie z regułą raty ma ratę
 * w kroku 2 — nie pojawia się dwa razy (ADR-050).
 *
 * @param liability - Zobowiązanie ze stanem na dziś.
 * @param month - Miesiąc szkicu.
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @returns Źródło linii albo `null`, gdy w M nie ma raty.
 */
export function liabilityInstallmentForMonth(
  liability: BudgetLiabilityInput,
  month: MonthKey,
  currentMonth: MonthKey,
): BudgetLiabilitySource | null {
  if (!liability.isActive || liability.recurringRuleId !== null) return null;
  const base = { id: liability.id, name: liability.name };
  if (month === currentMonth && liability.paidThisMonth) {
    return {
      ...base,
      installmentMinor: liability.monthlyPaymentMinor,
      dueOn: liability.lastPaymentOn,
    };
  }
  const installment = liabilitySchedule(liability, liability).find((item) =>
    item.dueOn.startsWith(month),
  );
  return installment === undefined
    ? null
    : { ...base, installmentMinor: installment.amountMinor, dueOn: installment.dueOn };
}

// ---------------------------------------------------------------------------
// Plan kontra wykonanie (07 §13.8, `F9-9`)
// ---------------------------------------------------------------------------

/**
 * Zaksięgowana transakcja miesiąca szkicu — surowiec wykonania. Serwis podaje tylko
 * `posted`, spoza kosza, z `month_key = M`; kategorię już zwiniętą do głównej.
 */
export interface BudgetLedgerRow {
  readonly type: TransactionType;
  readonly amountMinor: number;
  /** Kategoria **główna** transakcji (podkategoria zwinięta przez serwis). */
  readonly mainCategoryId: string | null;
  readonly incomeSourceId: string | null;
  /** Reguła wystąpienia, które ta transakcja opłaca. */
  readonly ruleId: string | null;
  readonly plannedExpenseId: string | null;
  readonly liabilityId: string | null;
  readonly goalId: string | null;
  readonly accountId: string | null;
  readonly counterAccountId: string | null;
  readonly sourceAllocationClass: AllocationClass | null;
  readonly targetAllocationClass: AllocationClass | null;
  readonly allocationOverride: AllocationOverride | null;
}

/** Linia szkicu w zakresie potrzebnym do wykonania. */
export interface BudgetActualLine {
  readonly id: string;
  readonly flow: BudgetLineFlow;
  readonly origin: BudgetLineOrigin;
  readonly amountMinor: number;
  readonly isExcluded: boolean;
  /** Kategoria **główna** linii. */
  readonly mainCategoryId: string | null;
  readonly incomeSourceId: string | null;
  readonly goalId: string | null;
  readonly liabilityId: string | null;
  readonly plannedExpenseId: string | null;
  readonly recurringRuleId: string | null;
}

/** Wejście wykonania. */
export interface BudgetActualsInput {
  readonly lines: readonly BudgetActualLine[];
  readonly ledger: readonly BudgetLedgerRow[];
  /** Cele: rodzaj i konto — kierunek przelewu z `goal_id` (07 §4.1). */
  readonly goals: ReadonlyMap<
    string,
    { readonly kind: GoalKind; readonly linkedAccountId: string | null }
  >;
  /** Nazwy grup: kategorie główne i źródła przychodu. */
  readonly names: ReadonlyMap<string, string>;
}

/** Grupa linii własnych z jednym wykonaniem. */
export interface BudgetActualGroup {
  readonly kind: 'category' | 'income_source';
  readonly id: string;
  readonly name: string;
  readonly lineIds: string[];
  readonly plannedMinor: number;
  readonly actualMinor: number;
}

/** Wykonanie planu — kształt `BudgetActualsSchema` (05 §13b). */
export interface BudgetActuals {
  /** Wykonanie linii powiązanych; klucz = id linii. */
  readonly lines: Record<string, number>;
  readonly groups: BudgetActualGroup[];
  readonly totals: {
    readonly incomeMinor: number;
    readonly expenseMinor: number;
    readonly savingsMinor: number;
    readonly investmentMinor: number;
    readonly netMinor: number;
  };
  readonly unplannedMinor: number;
}

/**
 * Efekt transakcji w puli linii (`savings` / `investment`) — netto, jak rozkład (ADR-011).
 *
 * @param row - Transakcja.
 * @param pool - Pula linii.
 * @returns Suma efektów w tej puli; `0`, gdy przelew jej nie dotyka.
 */
function poolEffect(row: BudgetLedgerRow, pool: BudgetLineFlow): number {
  return allocationEffects(row)
    .filter((effect) => effect.kind === pool)
    .reduce((sum, effect) => sum + effect.amountMinor, 0);
}

/**
 * Wkład transakcji w wykonanie linii o danej stronie bilansu: wpływ i wydatek liczą się
 * kwotą transakcji tego typu, linia puli — efektem w swojej puli.
 *
 * @param row - Transakcja.
 * @param flow - Strona bilansu linii.
 * @returns Kwota wykonania; `0` dla transakcji innej strony.
 */
function flowAmount(row: BudgetLedgerRow, flow: BudgetLineFlow): number {
  if (flow === 'income') return row.type === 'income' ? row.amountMinor : 0;
  if (flow === 'expense') return row.type === 'expense' ? row.amountMinor : 0;
  return poolEffect(row, flow);
}

/**
 * Zwykły wpływ albo wydatek — bez wystąpienia, planowanego wydatku i zobowiązania. Te
 * mają w szkicu własne linie, więc w grupie kategorii liczyłyby się drugi raz (§13.3).
 *
 * @param row - Transakcja.
 * @returns `true` dla transakcji „zmiennej".
 */
function isVariable(row: BudgetLedgerRow): boolean {
  return row.ruleId === null && row.plannedExpenseId === null && row.liabilityId === null;
}

/**
 * Wykonanie jednej linii powiązanej (07 §13.8, tabela).
 *
 * @param line - Linia nie-`manual`.
 * @param ledger - Transakcje miesiąca.
 * @param input - Cele i reguły z liniami.
 * @param ruleIdsWithLine - Reguły, które mają w szkicu własną linię.
 * @returns Kwota wykonania.
 */
function linkedActual(
  line: BudgetActualLine,
  ledger: readonly BudgetLedgerRow[],
  input: BudgetActualsInput,
  ruleIdsWithLine: ReadonlySet<string>,
): number {
  let sum = 0;
  for (const row of ledger) {
    switch (line.origin) {
      case 'recurring':
        if (row.ruleId !== null && row.ruleId === line.recurringRuleId) {
          sum += flowAmount(row, line.flow);
        }
        break;
      case 'planned':
        if (row.type === 'expense' && row.plannedExpenseId === line.plannedExpenseId) {
          sum += row.amountMinor;
        }
        break;
      case 'liability':
        if (row.type === 'expense' && row.ruleId === null && row.liabilityId === line.liabilityId) {
          sum += row.amountMinor;
        }
        break;
      case 'set_aside':
        if (row.type === 'transfer' && row.plannedExpenseId === line.plannedExpenseId) {
          sum += poolEffect(row, line.flow);
        }
        break;
      default: {
        // `goal`: wpłaty netto na cel, bez przelewów z reguł z własną linią.
        const goal = line.goalId === null ? undefined : input.goals.get(line.goalId);
        if (
          goal !== undefined &&
          row.type === 'transfer' &&
          row.goalId === line.goalId &&
          (row.ruleId === null || !ruleIdsWithLine.has(row.ruleId))
        ) {
          sum += goalTransferSign(goal, row) * row.amountMinor;
        }
      }
    }
  }
  return sum;
}

/**
 * Plan kontra wykonanie miesiąca (07 §13.8).
 *
 * Linie powiązane mają wykonanie każda osobno. Linie własne z kategorią (albo źródłem
 * przychodu) — **grupowo**: dwie linie „Jedzenie" dzielą jedno wykonanie, bo księga nie
 * wie, której dotyczy zakup. Linia własna bez kategorii i źródła wykonania nie ma.
 * Linie pominięte nie biorą udziału — ich wydatki trafiają do „Poza planem".
 *
 * Pule netto, jak rozkład (ADR-011): wykonanie linii oszczędności może być ujemne.
 *
 * @param input - Linie, transakcje miesiąca, cele i nazwy grup.
 * @returns Wykonanie w kształcie `BudgetActualsSchema`.
 */
export function budgetActuals(input: BudgetActualsInput): BudgetActuals {
  const active = input.lines.filter((line) => !line.isExcluded);
  const ruleIdsWithLine = new Set(
    active.flatMap((line) =>
      line.origin === 'recurring' && line.recurringRuleId !== null ? [line.recurringRuleId] : [],
    ),
  );

  const lines: Record<string, number> = {};
  let assignedExpense = 0;
  for (const line of active) {
    if (line.origin === 'manual') continue;
    const actual = linkedActual(line, input.ledger, input, ruleIdsWithLine);
    lines[line.id] = actual;
    if (line.flow === 'expense') assignedExpense += actual;
  }

  const groups = new Map<string, BudgetActualGroup>();
  for (const line of active) {
    if (line.origin !== 'manual' || (line.flow !== 'income' && line.flow !== 'expense')) continue;
    const bySource = line.flow === 'income' && line.incomeSourceId !== null;
    const id = bySource ? line.incomeSourceId : line.mainCategoryId;
    if (id === null) continue;
    const kind = bySource ? 'income_source' : 'category';
    const key = `${line.flow}:${kind}:${id}`;
    const group = groups.get(key) ?? {
      kind,
      id,
      name: input.names.get(id) ?? '',
      lineIds: [],
      plannedMinor: 0,
      actualMinor: input.ledger
        .filter(
          (row) =>
            row.type === line.flow &&
            isVariable(row) &&
            (bySource ? row.incomeSourceId === id : row.mainCategoryId === id),
        )
        .reduce((sum, row) => sum + row.amountMinor, 0),
    };
    groups.set(key, {
      ...group,
      lineIds: [...group.lineIds, line.id],
      plannedMinor: group.plannedMinor + line.amountMinor,
    });
  }
  for (const [key, group] of groups) {
    if (key.startsWith('expense:')) assignedExpense += group.actualMinor;
  }

  const sumOf = (pick: (row: BudgetLedgerRow) => number): number =>
    input.ledger.reduce((sum, row) => sum + pick(row), 0);
  const incomeMinor = sumOf((row) => flowAmount(row, 'income'));
  const expenseMinor = sumOf((row) => flowAmount(row, 'expense'));
  const savingsMinor = sumOf((row) => poolEffect(row, 'savings'));
  const investmentMinor = sumOf((row) => poolEffect(row, 'investment'));

  return {
    lines,
    groups: [...groups.values()],
    totals: {
      incomeMinor,
      expenseMinor,
      savingsMinor,
      investmentMinor,
      netMinor: incomeMinor - expenseMinor - savingsMinor - investmentMinor,
    },
    unplannedMinor: Math.max(0, expenseMinor - assignedExpense),
  };
}
