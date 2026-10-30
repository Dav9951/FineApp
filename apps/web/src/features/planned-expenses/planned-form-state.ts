import {
  CreatePlannedExpenseRequestSchema,
  isValidMonthKey,
  monthlySetAsideMinor,
  parseAmountToMinor,
  monthsLeftUntil,
  shiftMonth,
  type CreatePlannedExpenseInput,
  type MonthKey,
  type PlannedExpenseDto,
  type PlannedExpensePriority,
  type UpdatePlannedExpenseRequest,
} from '@fineapp/shared';

/**
 * Stan i reguły formularza planowanego wydatku
 * ([06 §3.10](../../../../../plans/06-ui-views.md#310-planowane-wydatki--planned), `F6-7`).
 *
 * Sedno formularza to wiersz „Trzeba odkładać X przez N mies.", liczony **na żywo** tymi
 * samymi funkcjami co serwer (`monthlySetAsideMinor`, `monthsLeftUntil` — 07 §6.5): to
 * odpowiedź na pytanie, które użytkownik zadaje sobie, dodając wydatek, i ma być widoczna
 * przed zapisem, nie po nim.
 */

/** Pola formularza tak, jak je widzi użytkownik. */
export interface PlannedFormState {
  readonly name: string;
  readonly amountMinor: number;
  readonly amountIsEstimate: boolean;
  /** Miesiąc terminu `YYYY-MM` albo `''`. */
  readonly dueMonth: string;
  readonly knowsDate: boolean;
  /** Dokładna data `YYYY-MM-DD` albo `''`. */
  readonly dueOn: string;
  readonly categoryId: string | null;
  readonly priority: PlannedExpensePriority;
  readonly setAsideEnabled: boolean;
  readonly setAsideAccountId: string | null;
  readonly setAsideGoalId: string | null;
  /** „Już mam" — zebrane poza aplikacją; tekst pola, jak wpisano (07 §8.2). */
  readonly alreadyText: string;
  readonly repeatsYearly: boolean;
  readonly notes: string;
}

/** Błędy pól formularza — klucze to nazwy pól stanu. */
export type PlannedFormErrors = Partial<Record<keyof PlannedFormState, string>>;

/** Wynik złożenia żądania. */
export type PlannedFormResult<T> =
  | { readonly ok: true; readonly body: T }
  | { readonly ok: false; readonly errors: PlannedFormErrors };

/** Wartości z góry — z pozycji cyklicznej (`F6-9`) albo z ostrzeżenia. */
export interface PlannedPreset {
  readonly name?: string;
  readonly amountMinor?: number;
  readonly categoryId?: string | null;
  readonly dueMonth?: MonthKey;
}

/**
 * Tekst pola z kwotą w groszach — bez separatora tysięcy, z przecinkiem.
 *
 * @param amountMinor - Kwota.
 * @returns Tekst, np. `800` albo `800,50`.
 */
export function amountToText(amountMinor: number): string {
  const whole = Math.trunc(amountMinor / 100);
  const fraction = amountMinor % 100;
  return fraction === 0 ? String(whole) : `${String(whole)},${String(fraction).padStart(2, '0')}`;
}

/**
 * „Już mam" z pola tekstowego: puste — zero.
 *
 * @param text - Tekst pola.
 * @returns Grosze albo `null`, gdy tekst nie jest kwotą.
 */
export function alreadyMinorOf(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  const parsed = parseAmountToMinor(trimmed);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

/**
 * Pusty formularz nowego wydatku.
 *
 * Termin domyślnie za trzy miesiące — typowy horyzont, dla którego odkładanie ma sens;
 * odkładanie włączone, bo to główny powód, dla którego wydatek trafia tutaj, a nie
 * do pozycji cyklicznych (06 §3.10).
 *
 * @param currentMonth - Bieżący miesiąc gospodarstwa.
 * @param preset - Wartości z góry.
 * @returns Stan początkowy.
 */
export function emptyPlannedForm(
  currentMonth: MonthKey,
  preset: PlannedPreset = {},
): PlannedFormState {
  return {
    name: preset.name ?? '',
    amountMinor: preset.amountMinor ?? 0,
    amountIsEstimate: true,
    dueMonth: preset.dueMonth ?? shiftMonth(currentMonth, 3),
    knowsDate: false,
    dueOn: '',
    categoryId: preset.categoryId ?? null,
    priority: 'should',
    setAsideEnabled: true,
    setAsideAccountId: null,
    setAsideGoalId: null,
    alreadyText: '',
    repeatsYearly: false,
    notes: '',
  };
}

/**
 * Formularz wypełniony istniejącym wydatkiem.
 *
 * @param item - Wydatek do edycji.
 * @returns Stan formularza.
 */
export function plannedFormFrom(item: PlannedExpenseDto): PlannedFormState {
  return {
    name: item.name,
    amountMinor: item.estimatedAmountMinor,
    amountIsEstimate: item.amountIsEstimate,
    dueMonth: item.dueMonth,
    knowsDate: item.dueOn !== null,
    dueOn: item.dueOn ?? '',
    categoryId: item.categoryId,
    priority: item.priority,
    setAsideEnabled: item.setAside.enabled,
    setAsideAccountId: item.setAside.accountId,
    setAsideGoalId: item.setAside.goalId,
    alreadyText: item.alreadySetAsideMinor === 0 ? '' : amountToText(item.alreadySetAsideMinor),
    repeatsYearly: item.repeatsYearly,
    notes: item.notes ?? '',
  };
}

/**
 * Najbliższy miesiąc danego numeru — termin wydatku z rocznej pozycji cyklicznej.
 *
 * @param currentMonth - Bieżący miesiąc.
 * @param monthOfYear - Numer miesiąca 1–12.
 * @returns Ten miesiąc w tym roku, a gdy już minął — w przyszłym.
 */
export function nextMonthOfYear(currentMonth: MonthKey, monthOfYear: number): MonthKey {
  const year = Number(currentMonth.slice(0, 4));
  const candidate = `${String(year)}-${String(monthOfYear).padStart(2, '0')}`;
  return candidate >= currentMonth ? candidate : `${String(year + 1)}${candidate.slice(4)}`;
}

/** Podgląd raty na żywo. */
export interface SetAsidePreview {
  readonly monthlyMinor: number;
  readonly monthsLeft: number;
  readonly remainingMinor: number;
}

/**
 * Rata odkładania z bieżących pól — te same funkcje co na serwerze (07 §6.5).
 *
 * Przy edycji wpłaty już zrobione w aplikacji (`accumulated − alreadySetAside`) się liczą:
 * zmiana szacunku z 2 400 na 3 000 zł ma pokazać ratę od tego, czego jeszcze brakuje.
 *
 * @param state - Stan formularza.
 * @param currentMonth - Bieżący miesiąc.
 * @param contributedMinor - Suma przelewów odkładania (przy edycji); nowy — 0.
 * @returns Podgląd albo `null`, gdy brak kwoty lub terminu.
 */
export function setAsidePreview(
  state: Pick<PlannedFormState, 'amountMinor' | 'dueMonth' | 'alreadyText'>,
  currentMonth: MonthKey,
  contributedMinor = 0,
): SetAsidePreview | null {
  const already = alreadyMinorOf(state.alreadyText);
  if (state.amountMinor <= 0 || already === null || !isValidMonthKey(state.dueMonth)) return null;
  const remainingMinor = Math.max(0, state.amountMinor - already - contributedMinor);
  const monthsLeft = monthsLeftUntil(currentMonth, state.dueMonth);
  return {
    monthlyMinor: monthlySetAsideMinor(remainingMinor, monthsLeft),
    monthsLeft,
    remainingMinor,
  };
}

/**
 * Miesiąc wpisu na kolejny rok — do podpowiedzi „Po zapłacie utworzymy wpis na…".
 *
 * @param dueMonth - Miesiąc terminu z formularza.
 * @returns Miesiąc za rok albo `null` przy niepoprawnym terminie.
 */
export function nextInstanceMonth(dueMonth: string): MonthKey | null {
  return isValidMonthKey(dueMonth) ? shiftMonth(dueMonth, 12) : null;
}

/** Pole kontraktu → pole formularza — do podświetlenia błędów z API i schematu. */
const FIELD_OF: Readonly<Record<string, keyof PlannedFormState>> = {
  name: 'name',
  estimatedAmountMinor: 'amountMinor',
  amountIsEstimate: 'amountIsEstimate',
  dueMonth: 'dueMonth',
  dueOn: 'dueOn',
  categoryId: 'categoryId',
  priority: 'priority',
  setAsideEnabled: 'setAsideEnabled',
  setAsideAccountId: 'setAsideAccountId',
  setAsideGoalId: 'setAsideAccountId',
  setAsideStartMonth: 'dueMonth',
  alreadySetAsideMinor: 'alreadyText',
  repeatsYearly: 'repeatsYearly',
  notes: 'notes',
};

/**
 * Błędy pól z odpowiedzi API.
 *
 * @param fieldErrors - Błędy z `ApiRequestError.fieldErrors()`.
 * @returns Błędy pól formularza.
 */
export function formErrorsFromApi(
  fieldErrors: Readonly<Record<string, string>>,
): PlannedFormErrors {
  const errors: PlannedFormErrors = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    const field = FIELD_OF[path];
    if (field !== undefined) errors[field] ??= message;
  }
  return errors;
}

/**
 * Składa ciało `POST /planned-expenses` i sprawdza je schematem formularza — tym samym,
 * który ma walidację krzyżową I-16, I-17, I-19 (ADR-035).
 *
 * Wyłączone odkładanie nie wysyła miejsca odkładania: stary wybór nie ma zostać
 * w danych, gdy przełącznik jest wyłączony.
 *
 * @param state - Stan formularza.
 * @returns Ciało albo błędy pól.
 */
export function toCreateRequest(
  state: PlannedFormState,
): PlannedFormResult<CreatePlannedExpenseInput> {
  const errors: PlannedFormErrors = {};
  if (state.amountMinor <= 0) errors.amountMinor = 'Wpisz szacowaną kwotę';
  if (!isValidMonthKey(state.dueMonth)) errors.dueMonth = 'Wybierz miesiąc';
  if (state.knowsDate && state.dueOn === '') errors.dueOn = 'Wybierz datę albo odznacz';
  const already = alreadyMinorOf(state.alreadyText);
  if (already === null) errors.alreadyText = 'Wpisz kwotę, np. 800';

  const body: CreatePlannedExpenseInput = {
    name: state.name.trim(),
    estimatedAmountMinor: state.amountMinor,
    amountIsEstimate: state.amountIsEstimate,
    dueMonth: state.dueMonth,
    dueOn: state.knowsDate && state.dueOn !== '' ? state.dueOn : null,
    categoryId: state.categoryId,
    priority: state.priority,
    setAsideEnabled: state.setAsideEnabled,
    setAsideAccountId: state.setAsideEnabled ? state.setAsideAccountId : null,
    setAsideGoalId: state.setAsideEnabled ? state.setAsideGoalId : null,
    alreadySetAsideMinor: already ?? 0,
    repeatsYearly: state.repeatsYearly,
    notes: state.notes.trim() === '' ? null : state.notes.trim(),
  };

  const parsed = CreatePlannedExpenseRequestSchema.safeParse(body);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = FIELD_OF[String(issue.path[0])];
      if (field !== undefined) errors[field] ??= issue.message;
    }
  }
  return Object.keys(errors).length === 0 ? { ok: true, body } : { ok: false, errors };
}

/**
 * Składa ciało `PATCH /planned-expenses/:id` — wyłącznie pola, które się zmieniły.
 *
 * @param item - Wydatek przed edycją.
 * @param state - Stan formularza.
 * @returns Ciało albo błędy pól; puste ciało = brak zmian.
 */
export function toUpdateRequest(
  item: PlannedExpenseDto,
  state: PlannedFormState,
): PlannedFormResult<UpdatePlannedExpenseRequest> {
  const created = toCreateRequest(state);
  if (!created.ok) return created;
  const next = created.body;
  const body: UpdatePlannedExpenseRequest = {};
  if (next.name !== item.name) body.name = next.name;
  if (next.estimatedAmountMinor !== item.estimatedAmountMinor) {
    body.estimatedAmountMinor = next.estimatedAmountMinor;
  }
  if (next.amountIsEstimate !== item.amountIsEstimate) {
    body.amountIsEstimate = next.amountIsEstimate ?? true;
  }
  if (next.dueMonth !== item.dueMonth) body.dueMonth = next.dueMonth;
  if ((next.dueOn ?? null) !== item.dueOn) body.dueOn = next.dueOn ?? null;
  if ((next.categoryId ?? null) !== item.categoryId) body.categoryId = next.categoryId ?? null;
  if (next.priority !== item.priority) body.priority = next.priority ?? 'should';
  if (next.setAsideEnabled !== item.setAside.enabled) {
    body.setAsideEnabled = next.setAsideEnabled ?? false;
  }
  if ((next.setAsideAccountId ?? null) !== item.setAside.accountId) {
    body.setAsideAccountId = next.setAsideAccountId ?? null;
  }
  if ((next.setAsideGoalId ?? null) !== item.setAside.goalId) {
    body.setAsideGoalId = next.setAsideGoalId ?? null;
  }
  if (next.alreadySetAsideMinor !== item.alreadySetAsideMinor) {
    body.alreadySetAsideMinor = next.alreadySetAsideMinor ?? 0;
  }
  if (next.repeatsYearly !== item.repeatsYearly) body.repeatsYearly = next.repeatsYearly ?? false;
  if ((next.notes ?? null) !== item.notes) body.notes = next.notes ?? null;
  return { ok: true, body };
}
