import {
  CreateRecurringRuleRequestSchema,
  recurringRuleFromRequest,
  upcomingDueDates,
  weekdayOf,
  type CreateRecurringRuleInput,
  type Frequency,
  type NormalizedRecurringRule,
  type RecurringRuleDto,
  type TransactionType,
  type UpdateRecurringRuleRequest,
} from '@fineapp/shared';

/**
 * Stan i reguły formularza reguły cyklicznej
 * ([06 §3.9](../../../../../plans/06-ui-views.md#39-pozycje-cykliczne--recurring), `F4-5`).
 *
 * Sprawdzenie tym samym schematem co serwer (`CreateRecurringRuleRequestSchema` — kształt
 * transakcji i terminarz, ADR-043), więc formularz podświetla pole, zanim cokolwiek wyśle.
 * Liczby wpisywane z klawiatury (dzień, odstęp) są w stanie **tekstem**: puste pole
 * w trakcie pisania jest poprawnym stanem, ale nie liczbą.
 */

/** Pola formularza tak, jak je widzi użytkownik. */
export interface RecurringFormState {
  readonly flow: TransactionType;
  readonly name: string;
  readonly amountMinor: number;
  readonly amountIsEstimate: boolean;
  readonly accountId: string | null;
  readonly counterAccountId: string | null;
  readonly categoryId: string | null;
  readonly incomeSourceId: string | null;
  readonly frequency: Frequency;
  /** Co ile miesięcy — tylko `every_n_months`. */
  readonly intervalText: string;
  readonly dayOfMonthText: string;
  /** 0 = niedziela … 6 = sobota. */
  readonly weekday: number;
  /** 1–12. */
  readonly monthOfYear: number;
  readonly startMonth: string;
  /** Pusty — bezterminowo. */
  readonly endMonth: string;
  readonly autoPost: boolean;
  readonly isFixedExpense: boolean;
  readonly notes: string;
}

/** Błędy pól formularza — klucze to nazwy pól stanu. */
export type RecurringFormErrors = Partial<Record<keyof RecurringFormState, string>>;

/** Wynik złożenia żądania: gotowe ciało albo błędy pól. */
export type RecurringFormResult<T> =
  | { readonly ok: true; readonly body: T; readonly rule: NormalizedRecurringRule }
  | { readonly ok: false; readonly errors: RecurringFormErrors };

/**
 * Stan pustego formularza. Terminarz podpowiada się z dzisiejszej daty — „co miesiąc,
 * dzisiejszego dnia, od tego miesiąca" to najczęstszy przypadek.
 *
 * @param flow - Rodzaj reguły.
 * @param today - Dzisiejsza data w strefie gospodarstwa.
 * @param accountId - Konto domyślne albo `null`.
 * @returns Stan początkowy.
 */
export function emptyRecurringForm(
  flow: TransactionType,
  today: string,
  accountId: string | null,
): RecurringFormState {
  return {
    flow,
    name: '',
    amountMinor: 0,
    amountIsEstimate: false,
    accountId,
    counterAccountId: null,
    categoryId: null,
    incomeSourceId: null,
    frequency: 'monthly',
    intervalText: '2',
    dayOfMonthText: String(Number(today.slice(8, 10))),
    weekday: weekdayOf(today),
    monthOfYear: Number(today.slice(5, 7)),
    startMonth: today.slice(0, 7),
    endMonth: '',
    autoPost: false,
    isFixedExpense: flow === 'expense',
    notes: '',
  };
}

/**
 * Stan formularza edycji istniejącej reguły.
 *
 * @param rule - Reguła do edycji.
 * @param today - Dzisiejsza data — podpowiedź dla pól, których częstotliwość nie używa.
 * @returns Stan wypełniony wartościami reguły.
 */
export function recurringFormFrom(rule: RecurringRuleDto, today: string): RecurringFormState {
  const empty = emptyRecurringForm(rule.flow, today, rule.accountId);
  return {
    ...empty,
    name: rule.name,
    amountMinor: rule.amountMinor,
    amountIsEstimate: rule.amountIsEstimate,
    counterAccountId: rule.counterAccountId,
    categoryId: rule.categoryId,
    incomeSourceId: rule.incomeSourceId,
    frequency: rule.frequency,
    intervalText: rule.frequency === 'every_n_months' ? String(rule.intervalCount) : '2',
    dayOfMonthText: rule.dayOfMonth === null ? empty.dayOfMonthText : String(rule.dayOfMonth),
    weekday: rule.weekday ?? empty.weekday,
    monthOfYear: rule.monthOfYear ?? empty.monthOfYear,
    startMonth: rule.startMonth,
    endMonth: rule.endMonth ?? '',
    autoPost: rule.autoPost,
    isFixedExpense: rule.isFixedExpense,
    notes: rule.notes ?? '',
  };
}

/**
 * Zmiana rodzaju nowej reguły: pola, które do nowego rodzaju nie pasują, są czyszczone
 * (kategoria wydatku nie może zostać przy wpływie, I-4).
 *
 * @param state - Stan formularza.
 * @param flow - Nowy rodzaj.
 * @returns Stan po zmianie.
 */
export function switchFlow(state: RecurringFormState, flow: TransactionType): RecurringFormState {
  return {
    ...state,
    flow,
    counterAccountId: null,
    categoryId: null,
    incomeSourceId: null,
    isFixedExpense: flow === 'expense',
  };
}

/** Pola żądania pokazywane pod innym polem formularza. */
const REQUEST_FIELD_TO_FORM: Readonly<Record<string, keyof RecurringFormState>> = {
  dayOfMonth: 'dayOfMonthText',
  intervalCount: 'intervalText',
  anchorDate: 'weekday',
};

/** Pola stanu, które mogą nieść błąd z żądania pod tą samą nazwą. */
const SAME_NAME_FIELDS: ReadonlySet<string> = new Set<keyof RecurringFormState>([
  'name',
  'amountMinor',
  'accountId',
  'counterAccountId',
  'categoryId',
  'incomeSourceId',
  'frequency',
  'weekday',
  'monthOfYear',
  'startMonth',
  'endMonth',
  'notes',
]);

/**
 * Tłumaczy błędy pól żądania (z Zoda albo z API) na pola formularza.
 *
 * @param fieldErrors - Mapa `pole żądania → komunikat`.
 * @returns Błędy pól formularza; pierwszy komunikat na pole wygrywa.
 */
export function formErrorsFromRequest(
  fieldErrors: Readonly<Record<string, string>>,
): RecurringFormErrors {
  const errors: RecurringFormErrors = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    const field =
      REQUEST_FIELD_TO_FORM[path] ??
      (SAME_NAME_FIELDS.has(path) ? (path as keyof RecurringFormState) : undefined);
    if (field !== undefined && errors[field] === undefined) errors[field] = message;
  }
  return errors;
}

/**
 * Liczba całkowita z pola tekstowego.
 *
 * @param text - Tekst pola.
 * @returns Liczba albo `null`, gdy to nie liczba całkowita.
 */
function integerOf(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/u.test(trimmed) ? Number(trimmed) : null;
}

/** Częstotliwości, które wybierają dzień miesiąca. */
const USES_DAY: ReadonlySet<Frequency> = new Set([
  'monthly',
  'quarterly',
  'yearly',
  'every_n_months',
]);

/** Pola terminarza — wspólne dla reguły i „Zapisz jako wydatek stały" (`F4-8`). */
export type ScheduleFormState = Pick<
  RecurringFormState,
  'frequency' | 'intervalText' | 'dayOfMonthText' | 'weekday' | 'monthOfYear'
>;

/** Terminarz z pól tekstowych: tylko pola, których częstotliwość używa. */
export interface ParsedSchedule {
  readonly frequency: Frequency;
  readonly intervalCount: number;
  readonly dayOfMonth: number | null;
  readonly weekday: number | null;
  readonly monthOfYear: number | null;
}

/**
 * Terminarz z pól formularza. Pola, których częstotliwość nie używa, są `null` — serwer
 * i tak by je wyczyścił (`normalizeSchedule`, ADR-043).
 *
 * @param state - Pola terminarza.
 * @returns Terminarz i błędy pól liczbowych (puste, gdy poprawne).
 */
export function parseSchedule(state: ScheduleFormState): {
  schedule: ParsedSchedule;
  errors: RecurringFormErrors;
} {
  const errors: RecurringFormErrors = {};
  const dayOfMonth = USES_DAY.has(state.frequency) ? integerOf(state.dayOfMonthText) : null;
  if (USES_DAY.has(state.frequency) && (dayOfMonth === null || dayOfMonth < 1 || dayOfMonth > 31)) {
    errors.dayOfMonthText = 'Dzień miesiąca od 1 do 31';
  }
  const interval = state.frequency === 'every_n_months' ? integerOf(state.intervalText) : 1;
  if (interval === null) errors.intervalText = 'Wpisz liczbę miesięcy';
  const usesWeekday = state.frequency === 'weekly' || state.frequency === 'biweekly';
  return {
    schedule: {
      frequency: state.frequency,
      intervalCount: interval ?? 1,
      dayOfMonth,
      weekday: usesWeekday ? state.weekday : null,
      monthOfYear: state.frequency === 'yearly' ? state.monthOfYear : null,
    },
    errors,
  };
}

/**
 * Składa ciało `POST /recurring/rules` i sprawdza je tym samym schematem co serwer.
 *
 * Pola, których rodzaj albo częstotliwość nie używa, nie są wysyłane — serwer i tak by je
 * wyczyścił (`normalizeSchedule`, ADR-043).
 *
 * @param state - Stan formularza.
 * @returns Ciało żądania z regułą po normalizacji albo błędy pól.
 */
export function toCreateRequest(
  state: RecurringFormState,
): RecurringFormResult<CreateRecurringRuleInput> {
  const { schedule, errors } = parseSchedule(state);
  if (state.accountId === null) errors.accountId = 'Wybierz konto';

  const body: CreateRecurringRuleInput = {
    name: state.name,
    flow: state.flow,
    amountMinor: state.amountMinor,
    amountIsEstimate: state.amountIsEstimate,
    accountId: state.accountId ?? '',
    counterAccountId: state.flow === 'transfer' ? state.counterAccountId : null,
    categoryId: state.flow === 'transfer' ? null : state.categoryId,
    incomeSourceId: state.flow === 'income' ? state.incomeSourceId : null,
    ...schedule,
    startMonth: state.startMonth,
    endMonth: state.endMonth === '' ? null : state.endMonth,
    autoPost: state.autoPost,
    isFixedExpense: state.flow === 'expense' && state.isFixedExpense,
    notes: state.notes,
  };

  const parsed = CreateRecurringRuleRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fromSchema = formErrorsFromRequest(
      Object.fromEntries(
        parsed.error.issues.map((issue) => [String(issue.path[0] ?? ''), issue.message]),
      ),
    );
    // Własne komunikaty pól liczbowych i konta wygrywają z ogólnymi z Zoda.
    Object.assign(fromSchema, errors);
    return { ok: false, errors: fromSchema };
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body, rule: recurringRuleFromRequest(parsed.data) };
}

/** Pola porównywane przy edycji — wszystko poza `flow` (niezmienny) i kotwicą. */
const DIFF_FIELDS = [
  'name',
  'amountMinor',
  'amountIsEstimate',
  'accountId',
  'counterAccountId',
  'categoryId',
  'incomeSourceId',
  'frequency',
  'intervalCount',
  'dayOfMonth',
  'weekday',
  'monthOfYear',
  'startMonth',
  'endMonth',
  'autoPost',
  'isFixedExpense',
  'notes',
] as const satisfies readonly (keyof NormalizedRecurringRule &
  keyof RecurringRuleDto &
  keyof UpdateRecurringRuleRequest)[];

/**
 * Składa ciało `PATCH /recurring/rules/:id` — wyłącznie pola, które się zmieniły.
 *
 * Porównanie po normalizacji: dzień miesiąca zostawiony w stanie przy regule tygodniowej
 * nie jest zmianą. Kotwicy nie wysyłamy — serwer wylicza ją na nowo przy zmianie
 * częstotliwości albo dnia tygodnia (ADR-043).
 *
 * @param original - Reguła przed edycją.
 * @param state - Stan formularza.
 * @returns Ciało żądania albo błędy pól.
 */
export function toUpdateRequest(
  original: RecurringRuleDto,
  state: RecurringFormState,
): RecurringFormResult<UpdateRecurringRuleRequest> {
  const created = toCreateRequest(state);
  if (!created.ok) return created;
  const body: UpdateRecurringRuleRequest = {};
  for (const field of DIFF_FIELDS) {
    const value = created.rule[field];
    if (value !== original[field]) Object.assign(body, { [field]: value });
  }
  return { ok: true, body, rule: created.rule };
}

/**
 * Najbliższe terminy reguły z formularza — podgląd, **zanim** użytkownik zapisze.
 *
 * @param state - Stan formularza.
 * @param today - Dzisiejsza data.
 * @param anchorDate - Kotwica edytowanej reguły `biweekly`, gdy dzień tygodnia się nie zmienił.
 * @returns Do trzech dat; pusto, gdy formularz jest jeszcze niepoprawny.
 */
export function previewDueDates(
  state: RecurringFormState,
  today: string,
  anchorDate?: string,
): string[] {
  const result = toCreateRequest(state);
  if (!result.ok) return [];
  const rule =
    anchorDate !== undefined && weekdayOf(anchorDate) === result.rule.weekday
      ? { ...result.rule, anchorDate }
      : result.rule;
  return upcomingDueDates(rule, today, 3);
}

/**
 * Czy podpowiedzieć „Planowane wydatki" zamiast reguły (06 §3.10, `F6-9`).
 *
 * Roczny wydatek — OC, podatek od nieruchomości — to zwykle kwota, na którą trzeba odłożyć
 * przez cały rok, a reguła cykliczna tylko przypomni o niej w terminie. Podpowiedź tylko
 * przy nowej regule: istniejącej nikt nie przenosi przypadkiem.
 *
 * @param state - Stan formularza.
 * @param isNew - Czy to nowa reguła.
 * @returns `true`, gdy pokazać podpowiedź.
 */
export function suggestsPlannedExpense(
  state: Pick<RecurringFormState, 'flow' | 'frequency'>,
  isNew: boolean,
): boolean {
  return isNew && state.flow === 'expense' && state.frequency === 'yearly';
}
