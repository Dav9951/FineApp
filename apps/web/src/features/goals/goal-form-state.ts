import {
  CreateGoalRequestSchema,
  parseAmountToMinor,
  type ContributionMode,
  type ConvertContributionRequest,
  type ConvertContributionResponse,
  type CreateGoalInput,
  type GoalDto,
  type GoalKind,
  type GoalPurpose,
  type MonthKey,
  type ProgressSource,
  type UpdateGoalRequest,
} from '@fineapp/shared';

/**
 * Stan i reguły formularza celu
 * ([06 §3.5](../../../../../plans/06-ui-views.md#35-cele--goals), `F5-6`).
 *
 * Sedno formularza to **przelicznik % ↔ kwota** (wymaganie #6): oba pola są edytowalne,
 * wpisanie w jedno wylicza drugie przez `POST /goals/convert`, a przełącznik trybu decyduje,
 * **która** strona zostanie zapisana (07 §3). Kwoty i procenty w stanie są tekstem —
 * dokładnie tym, co wpisano (jak w formularzu zobowiązania, 07 §8.2).
 */

/** Strona przelicznika, którą użytkownik ostatnio edytował. */
export type ConverterSide = 'amount' | 'percent';

/** Pola formularza tak, jak je widzi użytkownik. */
export interface GoalFormState {
  readonly name: string;
  readonly kind: GoalKind;
  readonly purpose: GoalPurpose | null;
  readonly targetText: string;
  /** Termin `YYYY-MM-DD` albo `''`. */
  readonly targetDate: string;
  readonly startingText: string;
  readonly progressSource: ProgressSource;
  readonly linkedAccountId: string | null;
  readonly contributionMode: ContributionMode;
  readonly amountText: string;
  readonly percentText: string;
  /** Pole, z którego liczy przelicznik; drugie jest wynikiem. */
  readonly lastEdited: ConverterSide;
}

/** Błędy pól formularza — klucze to nazwy pól stanu. */
export type GoalFormErrors = Partial<Record<keyof GoalFormState, string>>;

/** Wynik złożenia żądania. */
export type GoalFormResult<T> =
  { readonly ok: true; readonly body: T } | { readonly ok: false; readonly errors: GoalFormErrors };

/** Szybkie procenty pod przelicznikiem (06 §3.5), w bps. */
export const QUICK_PERCENTS: readonly number[] = [100, 500, 1000, 1500, 2000, 2500];

/**
 * Tekst pola z kwotą w groszach — bez separatora tysięcy, z przecinkiem.
 *
 * @param amountMinor - Kwota.
 * @returns Tekst, np. `2000` albo `2000,10`.
 */
export function amountToText(amountMinor: number): string {
  const whole = Math.trunc(amountMinor / 100);
  const fraction = amountMinor % 100;
  return fraction === 0 ? String(whole) : `${String(whole)},${String(fraction).padStart(2, '0')}`;
}

/**
 * Tekst pola procentu z punktów bazowych — jedno miejsce po przecinku, jak w UI (07 §3).
 *
 * @param bps - Udział w punktach bazowych.
 * @returns Tekst, np. `17` albo `16,9`.
 */
export function percentToText(bps: number): string {
  const tenths = Math.round(bps / 10);
  const whole = Math.trunc(tenths / 10);
  const fraction = tenths % 10;
  return fraction === 0 ? String(whole) : `${String(whole)},${String(fraction)}`;
}

/**
 * Procent z pola tekstowego na punkty bazowe.
 *
 * Przecinek i kropka jako separator, najwyżej dwa miejsca po nim (1 bps = 0,01%) — jak
 * przy kwocie: cichy zapis 17,555% jako 17,55% byłby gorszy od komunikatu (07 §8.2).
 *
 * @param text - Tekst pola, np. `17,5` albo `17,5%`.
 * @returns Punkty bazowe albo `null`.
 */
export function parsePercentToBps(text: string): number | null {
  const match = /^(\d{1,4})(?:[.,](\d{1,2}))?\s*%?$/u.exec(text.trim());
  if (match === null) return null;
  const [, whole = '0', fraction = ''] = match;
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/**
 * Kwota dodatnia z pola tekstowego.
 *
 * @param text - Tekst pola.
 * @returns Grosze albo `null`.
 */
function positiveAmount(text: string): number | null {
  const parsed = parseAmountToMinor(text.trim());
  return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * Pusty formularz nowego celu.
 *
 * @param kind - Rodzaj z zakładki ekranu.
 * @returns Stan początkowy: stała kwota, postęp z wpłat.
 */
export function emptyGoalForm(kind: GoalKind): GoalFormState {
  return {
    name: '',
    kind,
    purpose: null,
    targetText: '',
    targetDate: '',
    startingText: '',
    progressSource: 'contributions',
    linkedAccountId: null,
    contributionMode: 'fixed',
    amountText: '',
    percentText: '',
    lastEdited: 'amount',
  };
}

/**
 * Formularz wypełniony istniejącym celem. Zapisana strona przelicznika trafia do swojego
 * pola, druga — z wyliczenia na bieżący miesiąc.
 *
 * @param goal - Cel do edycji.
 * @returns Stan formularza.
 */
export function goalFormFrom(goal: GoalDto): GoalFormState {
  const { plannedAmountMinor, plannedPercentBps } = goal.contribution;
  return {
    name: goal.name,
    kind: goal.kind,
    purpose: goal.purpose,
    targetText: goal.targetAmountMinor === null ? '' : amountToText(goal.targetAmountMinor),
    targetDate: goal.targetDate ?? '',
    startingText: goal.startingAmountMinor === 0 ? '' : amountToText(goal.startingAmountMinor),
    progressSource: goal.progressSource,
    linkedAccountId: goal.linkedAccountId,
    contributionMode: goal.contribution.mode,
    amountText: plannedAmountMinor === null ? '' : amountToText(plannedAmountMinor),
    percentText: plannedPercentBps === null ? '' : percentToText(plannedPercentBps),
    lastEdited: goal.contribution.mode === 'percent_of_income' ? 'percent' : 'amount',
  };
}

/**
 * Wpisanie w jedno z pól przelicznika — to pole staje się źródłem wyliczenia.
 *
 * @param state - Stan formularza.
 * @param side - Pole edytowane.
 * @param text - Nowy tekst.
 * @returns Stan po zmianie.
 */
export function editConverter(
  state: GoalFormState,
  side: ConverterSide,
  text: string,
): GoalFormState {
  return side === 'amount'
    ? { ...state, amountText: text, lastEdited: 'amount' }
    : { ...state, percentText: text, lastEdited: 'percent' };
}

/**
 * Żądanie przelicznika z ostatnio edytowanego pola.
 *
 * @param state - Stan formularza.
 * @param month - Miesiąc podstawy (bieżący).
 * @returns Żądanie albo `null`, gdy pole jest puste albo niepoprawne.
 */
export function convertRequest(
  state: Pick<GoalFormState, 'amountText' | 'percentText' | 'lastEdited'>,
  month: MonthKey,
): ConvertContributionRequest | null {
  if (state.lastEdited === 'amount') {
    const amountMinor = positiveAmount(state.amountText);
    return amountMinor === null ? null : { month, amountMinor };
  }
  const percentBps = parsePercentToBps(state.percentText);
  return percentBps === null || percentBps === 0 ? null : { month, percentBps };
}

/**
 * Tekst pola wyliczanego — druga strona przelicznika z odpowiedzi serwera.
 *
 * Odpowiedź dla innego wejścia niż bieżące (np. spóźniona) nie jest pokazywana, żeby
 * pole nie pokazało wyniku dla liczby, której już nie ma w drugim polu.
 *
 * @param state - Stan formularza.
 * @param request - Bieżące żądanie przelicznika.
 * @param response - Odpowiedź przelicznika.
 * @returns Tekst pola wyliczanego albo `null`, gdy nie ma czego pokazać.
 */
export function convertedText(
  state: Pick<GoalFormState, 'lastEdited'>,
  request: ConvertContributionRequest | null,
  response: ConvertContributionResponse | undefined,
): string | null {
  if (request === null || response === undefined) return null;
  if (state.lastEdited === 'amount') {
    return response.amountMinor === request.amountMinor ? percentToText(response.percentBps) : null;
  }
  return response.percentBps === request.percentBps ? amountToText(response.amountMinor) : null;
}

/**
 * Przełączenie trybu. Pole trybu dostaje wartość wyliczoną, jeśli jest — żeby przejście
 * „2 000 zł → procent" nie kasowało przeliczonych 17%.
 *
 * @param state - Stan formularza.
 * @param mode - Nowy tryb.
 * @param converted - Tekst pola wyliczanego (z `convertedText`).
 * @returns Stan po zmianie.
 */
export function switchMode(
  state: GoalFormState,
  mode: ContributionMode,
  converted: string | null,
): GoalFormState {
  if (mode === state.contributionMode) return state;
  if (converted === null || mode === 'none') return { ...state, contributionMode: mode };
  if (mode === 'fixed' && state.lastEdited === 'percent') {
    return { ...state, contributionMode: mode, amountText: converted, lastEdited: 'amount' };
  }
  if (mode === 'percent_of_income' && state.lastEdited === 'amount') {
    return { ...state, contributionMode: mode, percentText: converted, lastEdited: 'percent' };
  }
  return { ...state, contributionMode: mode };
}

/**
 * Uzgadnia pole trybu z przelicznikiem przed zapisem.
 *
 * Użytkownik w trybie „stała kwota" mógł wpisać procent — wtedy pole kwoty pokazuje
 * wynik przeliczenia, ale w stanie nadal jest stary tekst. Zapisujemy to, co widać.
 *
 * @param state - Stan formularza.
 * @param converted - Tekst pola wyliczanego (z `convertedText`).
 * @returns Stan z polem trybu równym temu, co na ekranie.
 */
export function settleConverter(state: GoalFormState, converted: string | null): GoalFormState {
  if (converted === null) return state;
  if (state.contributionMode === 'fixed' && state.lastEdited === 'percent') {
    return { ...state, amountText: converted };
  }
  if (state.contributionMode === 'percent_of_income' && state.lastEdited === 'amount') {
    return { ...state, percentText: converted };
  }
  return state;
}

/**
 * Składa ciało `POST /goals` i sprawdza je schematem formularza (te same reguły co API).
 *
 * Zapisywana jest tylko strona zgodna z trybem — druga to pochodna (07 §3).
 *
 * @param state - Stan formularza.
 * @returns Ciało albo błędy pól.
 */
export function toCreateRequest(state: GoalFormState): GoalFormResult<CreateGoalInput> {
  const errors: GoalFormErrors = {};
  const target = state.targetText.trim() === '' ? null : positiveAmount(state.targetText);
  if (state.targetText.trim() !== '' && target === null) {
    errors.targetText = 'Wpisz kwotę większą od zera';
  }
  const starting =
    state.startingText.trim() === '' ? 0 : parseAmountToMinor(state.startingText.trim());
  if (starting === null || starting < 0) errors.startingText = 'Wpisz kwotę, np. 18 000';

  let amount: number | null = null;
  let percent: number | null = null;
  if (state.contributionMode === 'fixed') {
    amount = positiveAmount(state.amountText);
    if (amount === null) errors.amountText = 'Podaj kwotę miesięcznej wpłaty';
  }
  if (state.contributionMode === 'percent_of_income') {
    percent = parsePercentToBps(state.percentText);
    if (percent === null || percent === 0) errors.percentText = 'Podaj procent wpływów';
    else if (percent > 10_000) errors.percentText = 'Wpłata nie może przekraczać 100% wpływów';
  }

  const body: CreateGoalInput = {
    name: state.name.trim(),
    kind: state.kind,
    purpose: state.purpose,
    targetAmountMinor: target,
    targetDate: state.targetDate === '' ? null : state.targetDate,
    startingAmountMinor: starting ?? 0,
    linkedAccountId: state.linkedAccountId,
    progressSource: state.progressSource,
    contributionMode: state.contributionMode,
    contributionAmountMinor: amount,
    contributionPercentBps: percent,
  };

  if (Object.keys(errors).length === 0) {
    const parsed = CreateGoalRequestSchema.safeParse(body);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = FIELD_OF[String(issue.path[0])];
        if (field !== undefined) errors[field] ??= issue.message;
      }
    }
  }
  return Object.keys(errors).length === 0 ? { ok: true, body } : { ok: false, errors };
}

/** Pole kontraktu → pole formularza — do podświetlenia błędów z API i schematu. */
const FIELD_OF: Readonly<Record<string, keyof GoalFormState>> = {
  name: 'name',
  kind: 'kind',
  purpose: 'purpose',
  targetAmountMinor: 'targetText',
  targetDate: 'targetDate',
  startingAmountMinor: 'startingText',
  linkedAccountId: 'linkedAccountId',
  progressSource: 'progressSource',
  contributionMode: 'contributionMode',
  contributionAmountMinor: 'amountText',
  contributionPercentBps: 'percentText',
};

/**
 * Błędy pól z odpowiedzi API.
 *
 * @param fieldErrors - Błędy z `ApiRequestError.fieldErrors()`.
 * @returns Błędy pól formularza.
 */
export function formErrorsFromApi(fieldErrors: Readonly<Record<string, string>>): GoalFormErrors {
  const errors: GoalFormErrors = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    const field = FIELD_OF[path];
    if (field !== undefined) errors[field] ??= message;
  }
  return errors;
}

/**
 * Składa ciało `PATCH /goals/:id` — wyłącznie pola, które się zmieniły.
 *
 * @param goal - Cel przed edycją.
 * @param state - Stan formularza.
 * @returns Ciało albo błędy pól; puste ciało = brak zmian.
 */
export function toUpdateRequest(
  goal: GoalDto,
  state: GoalFormState,
): GoalFormResult<UpdateGoalRequest> {
  const created = toCreateRequest(state);
  if (!created.ok) return created;
  const next = created.body;
  const body: UpdateGoalRequest = {};
  if (next.name !== goal.name) body.name = next.name;
  if (next.kind !== goal.kind) body.kind = next.kind;
  if ((next.purpose ?? null) !== goal.purpose) body.purpose = next.purpose ?? null;
  if ((next.targetAmountMinor ?? null) !== goal.targetAmountMinor) {
    body.targetAmountMinor = next.targetAmountMinor ?? null;
  }
  if ((next.targetDate ?? null) !== goal.targetDate) body.targetDate = next.targetDate ?? null;
  if ((next.startingAmountMinor ?? 0) !== goal.startingAmountMinor) {
    body.startingAmountMinor = next.startingAmountMinor ?? 0;
  }
  if ((next.linkedAccountId ?? null) !== goal.linkedAccountId) {
    body.linkedAccountId = next.linkedAccountId ?? null;
  }
  if (next.progressSource !== goal.progressSource) body.progressSource = next.progressSource;
  if (next.contributionMode !== goal.contribution.mode) {
    body.contributionMode = next.contributionMode;
  }
  if ((next.contributionAmountMinor ?? null) !== goal.contributionAmountMinor) {
    body.contributionAmountMinor = next.contributionAmountMinor ?? null;
  }
  if ((next.contributionPercentBps ?? null) !== goal.contributionPercentBps) {
    body.contributionPercentBps = next.contributionPercentBps ?? null;
  }
  return { ok: true, body };
}
