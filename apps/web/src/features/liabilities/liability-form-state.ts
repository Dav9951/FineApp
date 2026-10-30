import {
  CreateLiabilityRequestSchema,
  formatMinor,
  installmentsFor,
  parseAmountToMinor,
  type CreateLiabilityInput,
  type LiabilityDto,
  type LiabilityKind,
  type UpdateLiabilityRequest,
} from '@fineapp/shared';

/**
 * Stan i reguły formularza zobowiązania
 * ([06 §3.8](../../../../../plans/06-ui-views.md#38-zobowiązania--liabilities), `F4-6`).
 *
 * Wymaganie #2 wprost: **pozostała kwota, rata, okres**. Trzy pola są powiązane — wpisanie
 * dwóch wylicza trzecie. Wyliczane jest to, którego użytkownik dotykał najdawniej, więc
 * poprawienie raty przy znanym okresie przelicza kwotę albo okres zależnie od tego, co
 * wpisał wcześniej. Kwoty w stanie są **tekstem** (jak w formularzu konta, 07 §8.2).
 */

/** Pola powiązane „dwa z trzech". */
export type LinkedField = 'remaining' | 'monthly' | 'installments';

/** Pola formularza tak, jak je widzi użytkownik. */
export interface LiabilityFormState {
  readonly name: string;
  readonly kind: LiabilityKind;
  readonly creditor: string;
  readonly remainingText: string;
  readonly monthlyText: string;
  readonly installmentsText: string;
  /** Dwa ostatnio edytowane pola powiązane, od najnowszego; trzecie jest wyliczane. */
  readonly touched: readonly [LinkedField, LinkedField];
  readonly balanceAsOf: string;
  readonly paymentDayText: string;
  /**
   * Najbliższa rata wskazana wprost (`firstPaymentOn`); `''` — wyliczana z dnia
   * płatności i dnia „na dzień" (ADR-068).
   */
  readonly firstPaymentOn: string;
  readonly paymentAccountId: string | null;
  readonly categoryId: string | null;
  readonly createRecurringRule: boolean;
  readonly notes: string;
}

/** Błędy pól formularza — klucze to nazwy pól stanu. */
export type LiabilityFormErrors = Partial<Record<keyof LiabilityFormState, string>>;

/** Wynik złożenia żądania. */
export type LiabilityFormResult<T> =
  | { readonly ok: true; readonly body: T }
  | { readonly ok: false; readonly errors: LiabilityFormErrors };

/** Wszystkie pola powiązane. */
const LINKED: readonly LinkedField[] = ['remaining', 'monthly', 'installments'];

/** Pole stanu z tekstem pola powiązanego. */
const LINKED_TEXT: Readonly<
  Record<LinkedField, 'remainingText' | 'monthlyText' | 'installmentsText'>
> = { remaining: 'remainingText', monthly: 'monthlyText', installments: 'installmentsText' };

/**
 * Pole wyliczane — to spośród trzech, którego nie ma wśród dwóch ostatnio edytowanych.
 *
 * @param state - Stan formularza.
 * @returns Pole wyliczane.
 */
export function derivedField(state: Pick<LiabilityFormState, 'touched'>): LinkedField {
  return LINKED.find((field) => !state.touched.includes(field)) ?? 'installments';
}

/**
 * Tekst pola z kwotą w groszach — bez separatora tysięcy, z przecinkiem.
 *
 * @param amountMinor - Kwota.
 * @returns Tekst, np. `1850` albo `1850,50`.
 */
function amountToText(amountMinor: number): string {
  const whole = Math.trunc(amountMinor / 100);
  const fraction = amountMinor % 100;
  return fraction === 0 ? String(whole) : `${String(whole)},${String(fraction).padStart(2, '0')}`;
}

/**
 * Liczba całkowita dodatnia z pola tekstowego.
 *
 * @param text - Tekst pola.
 * @returns Liczba albo `null`.
 */
function positiveInteger(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 ? value : null;
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

/** Wartości trzech pól powiązanych po wyliczeniu. */
export interface LinkedValues {
  readonly remainingMinor: number | null;
  readonly monthlyMinor: number | null;
  readonly installments: number | null;
  /** Tekst pola wyliczanego — `''`, gdy dwóch pozostałych jeszcze nie wpisano. */
  readonly derivedText: string;
}

/**
 * Wylicza trzecie pole z dwóch wpisanych.
 *
 * - liczba rat = `ceil(kwota / rata)` — ta sama `installmentsFor` co stan na serwerze;
 * - rata = `ceil(kwota / liczba rat)` — w groszach, w górę, żeby ostatnia rata nie wyszła
 *   większa od pozostałych;
 * - kwota = `rata × liczba rat` — górna granica: ostatnia rata bywa niepełna.
 *
 * @param state - Stan formularza.
 * @returns Wartości wszystkich trzech pól.
 */
export function linkedValues(state: LiabilityFormState): LinkedValues {
  const derived = derivedField(state);
  let remaining = positiveAmount(state.remainingText);
  let monthly = positiveAmount(state.monthlyText);
  let installments = positiveInteger(state.installmentsText);
  let derivedText: string;

  if (derived === 'installments') {
    installments =
      remaining !== null && monthly !== null ? installmentsFor(remaining, monthly) : null;
    derivedText = installments === null ? '' : String(installments);
  } else if (derived === 'monthly') {
    monthly =
      remaining !== null && installments !== null
        ? Math.floor((remaining + installments - 1) / installments)
        : null;
    derivedText = monthly === null ? '' : amountToText(monthly);
  } else {
    remaining = monthly !== null && installments !== null ? monthly * installments : null;
    derivedText = remaining === null ? '' : amountToText(remaining);
  }
  return { remainingMinor: remaining, monthlyMinor: monthly, installments, derivedText };
}

/**
 * Rozpisanie rat, gdy ostatnia jest mniejsza od pozostałych.
 *
 * Liczba rat to `ceil(kwota / rata)` (07 §5.1), więc 979 zł przy racie 97 zł daje
 * **11** rat: 10 pełnych i ostatnią 9 zł. Samo „11" wygląda jak błąd rachunku —
 * podpis pokazuje, skąd się bierze. Przy kwocie podzielnej przez ratę nie ma czego
 * wyjaśniać.
 *
 * @param linked - Wartości pól powiązanych.
 * @returns Np. `10 × 97,00 zł, ostatnia 9,00 zł` albo `null`.
 */
export function installmentBreakdown(linked: LinkedValues): string | null {
  const { remainingMinor, monthlyMinor, installments } = linked;
  if (remainingMinor === null || monthlyMinor === null || installments === null) return null;
  if (installments < 2) return null;
  const lastMinor = remainingMinor - monthlyMinor * (installments - 1);
  if (lastMinor <= 0 || lastMinor >= monthlyMinor) return null;
  return `${String(installments - 1)} × ${formatMinor(monthlyMinor)}, ostatnia ${formatMinor(lastMinor)}`;
}

/**
 * Zmienia pole powiązane: zapisuje tekst i przesuwa je na początek „dotkniętych".
 * Edycja pola wyliczanego zamienia je we wpisane, a wyliczane staje się to najdawniej
 * dotknięte — jego dotychczasowy tekst przestaje się liczyć.
 *
 * @param state - Stan formularza.
 * @param field - Zmieniane pole.
 * @param text - Nowy tekst.
 * @returns Stan po zmianie.
 */
export function editLinked(
  state: LiabilityFormState,
  field: LinkedField,
  text: string,
): LiabilityFormState {
  const [latest] = state.touched;
  return {
    ...state,
    [LINKED_TEXT[field]]: text,
    touched: latest === field ? state.touched : [field, latest],
  };
}

/**
 * Stan pustego formularza nowego zobowiązania.
 *
 * @param today - Dzisiejsza data — domyślny dzień, na który podaje się kwotę.
 * @returns Stan początkowy.
 */
export function emptyLiabilityForm(today: string): LiabilityFormState {
  return {
    name: '',
    kind: 'cash_loan',
    creditor: '',
    remainingText: '',
    monthlyText: '',
    installmentsText: '',
    touched: ['monthly', 'remaining'],
    balanceAsOf: today,
    paymentDayText: '',
    firstPaymentOn: '',
    paymentAccountId: null,
    categoryId: null,
    // 06 §3.8: domyślnie zaznaczone — rata to modelowy wydatek stały.
    createRecurringRule: true,
    notes: '',
  };
}

/**
 * Stan formularza edycji.
 *
 * @param liability - Zobowiązanie do edycji.
 * @returns Stan wypełniony wartościami zobowiązania.
 */
export function liabilityFormFrom(liability: LiabilityDto): LiabilityFormState {
  return {
    name: liability.name,
    kind: liability.kind,
    creditor: liability.creditor ?? '',
    remainingText: amountToText(liability.openingBalanceMinor),
    monthlyText: amountToText(liability.monthlyPaymentMinor),
    installmentsText: '',
    touched: ['monthly', 'remaining'],
    balanceAsOf: liability.balanceAsOf,
    paymentDayText: liability.paymentDay === null ? '' : String(liability.paymentDay),
    firstPaymentOn: liability.firstPaymentOn ?? '',
    paymentAccountId: liability.paymentAccountId,
    categoryId: liability.categoryId,
    createRecurringRule: false,
    notes: liability.notes ?? '',
  };
}

/** Pola żądania pokazywane pod innym polem formularza. */
const REQUEST_FIELD_TO_FORM: Readonly<Record<string, keyof LiabilityFormState>> = {
  name: 'name',
  kind: 'kind',
  creditor: 'creditor',
  openingBalanceMinor: 'remainingText',
  monthlyPaymentMinor: 'monthlyText',
  installmentsRemainingAtAsOf: 'installmentsText',
  balanceAsOf: 'balanceAsOf',
  paymentDay: 'paymentDayText',
  firstPaymentOn: 'firstPaymentOn',
  paymentAccountId: 'paymentAccountId',
  categoryId: 'categoryId',
  notes: 'notes',
};

/**
 * Tłumaczy błędy pól żądania (z Zoda albo z API) na pola formularza.
 *
 * @param fieldErrors - Mapa `pole żądania → komunikat`.
 * @returns Błędy pól formularza.
 */
export function formErrorsFromRequest(
  fieldErrors: Readonly<Record<string, string>>,
): LiabilityFormErrors {
  const errors: LiabilityFormErrors = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    const field = REQUEST_FIELD_TO_FORM[path];
    if (field !== undefined && errors[field] === undefined) errors[field] = message;
  }
  return errors;
}

/**
 * Składa ciało `POST /liabilities` i sprawdza je tym samym schematem co formularz serwera
 * (`CreateLiabilityRequestSchema` — z regułami `liabilityIssues`).
 *
 * @param state - Stan formularza.
 * @returns Ciało żądania albo błędy pól.
 */
export function toCreateRequest(
  state: LiabilityFormState,
): LiabilityFormResult<CreateLiabilityInput> {
  const values = linkedValues(state);
  const errors: LiabilityFormErrors = {};
  if (values.remainingMinor === null) errors.remainingText = 'Wpisz pozostałą kwotę, np. 2 500,00';
  if (values.monthlyMinor === null) errors.monthlyText = 'Wpisz ratę albo liczbę rat';
  const dayText = state.paymentDayText.trim();
  const paymentDay = dayText === '' ? null : positiveInteger(dayText);
  if (dayText !== '' && (paymentDay === null || paymentDay > 31)) {
    errors.paymentDayText = 'Dzień miesiąca od 1 do 31';
  }

  const body: CreateLiabilityInput = {
    name: state.name,
    kind: state.kind,
    creditor: state.creditor,
    openingBalanceMinor: values.remainingMinor ?? 0,
    balanceAsOf: state.balanceAsOf,
    monthlyPaymentMinor: values.monthlyMinor ?? 0,
    installmentsRemainingAtAsOf: values.installments,
    paymentDay: paymentDay !== null && paymentDay <= 31 ? paymentDay : null,
    firstPaymentOn: state.firstPaymentOn === '' ? null : state.firstPaymentOn,
    paymentAccountId: state.paymentAccountId,
    categoryId: state.categoryId,
    createRecurringRule: state.createRecurringRule,
    notes: state.notes,
  };
  const parsed = CreateLiabilityRequestSchema.safeParse(body);
  const fromSchema = parsed.success
    ? {}
    : formErrorsFromRequest(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0] ?? ''), issue.message]),
        ),
      );
  // Własne komunikaty kwot i dnia wygrywają z ogólnymi z Zoda.
  const all = { ...fromSchema, ...errors };
  return Object.keys(all).length === 0 ? { ok: true, body } : { ok: false, errors: all };
}

/**
 * Składa ciało `PATCH /liabilities/:id` — wyłącznie pola, które się zmieniły.
 *
 * @param original - Zobowiązanie przed edycją.
 * @param state - Stan formularza.
 * @returns Ciało żądania albo błędy pól.
 */
export function toUpdateRequest(
  original: LiabilityDto,
  state: LiabilityFormState,
): LiabilityFormResult<UpdateLiabilityRequest> {
  const created = toCreateRequest({ ...state, createRecurringRule: false });
  if (!created.ok) return created;
  const next = created.body;
  const body: UpdateLiabilityRequest = {};
  const name = next.name.trim();
  if (name !== original.name) body.name = name;
  if (next.kind !== original.kind) body.kind = next.kind;
  const creditor = next.creditor?.trim() || null;
  if (creditor !== original.creditor) body.creditor = creditor;
  if (next.openingBalanceMinor !== original.openingBalanceMinor) {
    body.openingBalanceMinor = next.openingBalanceMinor;
  }
  if (next.balanceAsOf !== original.balanceAsOf) body.balanceAsOf = next.balanceAsOf;
  if (next.monthlyPaymentMinor !== original.monthlyPaymentMinor) {
    body.monthlyPaymentMinor = next.monthlyPaymentMinor;
  }
  const installments = next.installmentsRemainingAtAsOf ?? null;
  if (
    state.installmentsText.trim() !== '' &&
    installments !== original.installmentsRemainingAtAsOf
  ) {
    body.installmentsRemainingAtAsOf = installments;
  }
  const paymentDay = next.paymentDay ?? null;
  if (paymentDay !== original.paymentDay) body.paymentDay = paymentDay;
  const firstPaymentOn = next.firstPaymentOn ?? null;
  if (firstPaymentOn !== (original.firstPaymentOn ?? null)) body.firstPaymentOn = firstPaymentOn;
  const paymentAccountId = next.paymentAccountId ?? null;
  if (paymentAccountId !== original.paymentAccountId) body.paymentAccountId = paymentAccountId;
  const categoryId = next.categoryId ?? null;
  if (categoryId !== original.categoryId) body.categoryId = categoryId;
  const notes = next.notes?.trim() || null;
  if (notes !== original.notes) body.notes = notes;
  return { ok: true, body };
}
