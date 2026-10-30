import {
  earliestPostableDate,
  monthKeyOf,
  monthsBetween,
  occurrenceDatesForMonth,
  type Frequency,
  type MonthKey,
  type OccurrenceStatus,
  type RecurringOccurrencesMeta,
  type RecurringSchedule,
  type TransactionType,
} from '@fineapp/shared';

/**
 * Czyste reguły wystąpień cyklicznych — zadanie `F4-2`
 * ([07 §6.2–§6.4](../../../../../../plans/07-domain-rules.md#62-generowanie-wystąpień),
 * ADR-045).
 *
 * Bez bazy i bez zegara: serwis podaje „dziś" i stan z bazy, tu zapada decyzja, co
 * zapisać. Dzięki temu przypadki brzegowe (31. w lutym, rok przestępny, zmiana terminarza)
 * są testowane bez aplikacji.
 */

/** Miesiące, w których wystąpienia są zapisywane w bazie. */
export interface GenerationWindow {
  /** Pierwszy otwarty miesiąc — początek okna księgowania (07 §1.3). */
  readonly fromMonth: MonthKey;
  /** Bieżący miesiąc gospodarstwa. */
  readonly currentMonth: MonthKey;
  /** Wszystkie miesiące okna rosnąco. */
  readonly months: readonly MonthKey[];
}

/**
 * Okno generowania: od pierwszego otwartego miesiąca do bieżącego (ADR-045).
 *
 * Górna granica z 07 §6.2 — przyszłość to podgląd bez zapisu, inaczej każda zmiana reguły
 * wymagałaby sprzątania wygenerowanej przyszłości. Dolna — miesiące zamknięte (07 §1.4)
 * mają zamrożone liczby i wystąpienia ich nie dostają: reguła założona dziś od stycznia
 * nie może dopisać zaległego czynszu do miesiąca, którego nie da się już zmienić.
 * Generowane jest **całe** okno, nie tylko oglądany miesiąc: niezapłacony czynsz
 * z poprzedniego miesiąca ma trafić do „Do zrobienia", nawet jeśli nikt tamtego
 * miesiąca nie otworzył (07 §6.6).
 *
 * @param today - Dzisiejsza data biznesowa gospodarstwa.
 * @param backPostingLimitMonths - Limit księgowania wstecz z ustawień.
 * @param monthStartDay - Dzień rozpoczęcia miesiąca budżetowego.
 * @returns Okno generowania.
 */
export function generationWindow(
  today: string,
  backPostingLimitMonths: number,
  monthStartDay = 1,
): GenerationWindow {
  const currentMonth = monthKeyOf(today, monthStartDay);
  const fromMonth = monthKeyOf(earliestPostableDate(today, backPostingLimitMonths), monthStartDay);
  return { fromMonth, currentMonth, months: monthsBetween(fromMonth, currentMonth) };
}

/** Częstotliwości, przy których reguła ma w miesiącu najwyżej jeden termin. */
const ONE_PER_MONTH: ReadonlySet<Frequency> = new Set([
  'monthly',
  'every_n_months',
  'quarterly',
  'yearly',
]);

/**
 * Czy reguła tej częstotliwości ma w miesiącu najwyżej jeden termin.
 *
 * @param frequency - Częstotliwość reguły.
 * @returns `true` dla częstotliwości liczonych w miesiącach.
 */
export function isOncePerMonth(frequency: Frequency): boolean {
  return ONE_PER_MONTH.has(frequency);
}

/** Termin do zapisania. */
export interface DueDate {
  readonly dueOn: string;
  readonly monthKey: MonthKey;
}

/**
 * Terminy reguły, których brakuje w bazie (07 §6.2, kroki 1–3).
 *
 * Reguła liczona w miesiącach (`monthly`, `quarterly`, `every_n_months`, `yearly`) ma
 * w miesiącu najwyżej jedno wystąpienie: gdy już jakieś jest — w dowolnym statusie —
 * miesiąc jest pomijany. Chroni to przed drugim czynszem po zmianie dnia płatności:
 * wrześniowy zapłacony 10., reguła przestawiona na 15. — nowy termin dotyczy października,
 * nie drugiej płatności we wrześniu (ADR-045). Reguły tygodniowe mają wiele terminów
 * w miesiącu; tam decyduje sam termin.
 *
 * @param rule - Terminarz reguły.
 * @param months - Miesiące okna generowania.
 * @param existing - Istniejące wystąpienia **tej** reguły w tych miesiącach.
 * @returns Brakujące terminy rosnąco.
 */
export function missingDueDates(
  rule: RecurringSchedule,
  months: readonly MonthKey[],
  existing: readonly DueDate[],
): DueDate[] {
  const takenDates = new Set(existing.map((row) => row.dueOn));
  const takenMonths = new Set(existing.map((row) => row.monthKey));
  const result: DueDate[] = [];
  for (const monthKey of months) {
    if (isOncePerMonth(rule.frequency) && takenMonths.has(monthKey)) continue;
    for (const dueOn of occurrenceDatesForMonth(rule, monthKey)) {
      if (!takenDates.has(dueOn)) result.push({ dueOn, monthKey });
    }
  }
  return result;
}

/** Pola terminarza — ich zmiana generuje wystąpienia na nowo (07 §6.4). */
export const SCHEDULE_FIELDS = [
  'frequency',
  'intervalCount',
  'dayOfMonth',
  'weekday',
  'monthOfYear',
  'anchorDate',
  'startMonth',
  'endMonth',
] as const satisfies readonly (keyof RecurringSchedule)[];

/**
 * Czy edycja zmieniła terminarz reguły.
 *
 * @param before - Terminarz przed zmianą.
 * @param after - Terminarz po zmianie.
 * @returns `true`, gdy różni się choć jedno pole terminarza.
 */
export function scheduleChanged(before: RecurringSchedule, after: RecurringSchedule): boolean {
  return SCHEDULE_FIELDS.some((field) => before[field] !== after[field]);
}

/**
 * Czy wystąpienie jest zaległe: czeka, a jego termin minął (07 §6.6).
 *
 * Termin dzisiejszy nie jest zaległy — płatność „10." można zrobić 10.
 *
 * @param status - Status wystąpienia.
 * @param dueOn - Termin.
 * @param today - Dzisiejsza data biznesowa.
 * @returns `true` dla zaległego.
 */
export function isOverdue(status: OccurrenceStatus, dueOn: string, today: string): boolean {
  return status === 'planned' && dueOn < today;
}

/** Pola wystąpienia potrzebne do sum. */
export interface OccurrenceAmounts {
  readonly flow: TransactionType;
  readonly status: OccurrenceStatus;
  readonly plannedAmountMinor: number;
  readonly postedAmountMinor: number | null;
}

/**
 * Sumy listy wystąpień miesiąca (04 §9).
 *
 * - `planned` — kwoty planowane wszystkiego poza pominiętym: pominięcie znaczy „w tym
 *   miesiącu tego nie będzie", więc nie jest częścią planu;
 * - `posted` — kwoty **faktycznie** zaksięgowane (rachunek za prąd bywa inny niż plan);
 * - `remaining` — kwoty planowane tego, co wciąż czeka.
 *
 * Dlatego `remaining` nie musi równać się `planned − posted`: przy prądzie zaplanowanym
 * na 280 zł i zapłaconym 312 zł nic już nie zostaje do zrobienia.
 *
 * @param items - Wystąpienia miesiąca.
 * @returns Sumy łączne i w podziale na rodzaj.
 */
export function occurrenceTotals(
  items: readonly OccurrenceAmounts[],
): Omit<RecurringOccurrencesMeta, 'month' | 'isPreview'> {
  const byFlow = {
    expense: { plannedMinor: 0, postedMinor: 0 },
    income: { plannedMinor: 0, postedMinor: 0 },
    transfer: { plannedMinor: 0, postedMinor: 0 },
  };
  let remainingTotalMinor = 0;
  for (const item of items) {
    if (item.status === 'skipped') continue;
    byFlow[item.flow].plannedMinor += item.plannedAmountMinor;
    if (item.status === 'posted') byFlow[item.flow].postedMinor += item.postedAmountMinor ?? 0;
    if (item.status === 'planned') remainingTotalMinor += item.plannedAmountMinor;
  }
  const flows = Object.values(byFlow);
  return {
    plannedTotalMinor: flows.reduce((sum, flow) => sum + flow.plannedMinor, 0),
    postedTotalMinor: flows.reduce((sum, flow) => sum + flow.postedMinor, 0),
    remainingTotalMinor,
    byFlow,
  };
}
