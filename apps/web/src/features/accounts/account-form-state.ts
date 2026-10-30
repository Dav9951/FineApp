import {
  allocationClassAfterTypeChange,
  CreateAccountRequestSchema,
  defaultAllocationClass,
  parseAmountToMinor,
  type AccountDto,
  type AccountType,
  type AllocationClass,
  type CreateAccountInput,
  type UpdateAccountRequest,
} from '@fineapp/shared';

/**
 * Stan i reguły formularza konta ([06 §3.7](../../../../../plans/06-ui-views.md#37-konta--accounts)).
 *
 * Formularz trzyma **tekst** kwoty, a nie grosze: `12,` jest poprawnym stanem w trakcie
 * pisania, ale nie jest liczbą. Grosze powstają dopiero przy zapisie, tą samą funkcją
 * `parseAmountToMinor`, której używa reszta aplikacji (07 §8.2).
 */

/** Pola formularza tak, jak je widzi użytkownik. */
export interface AccountFormState {
  readonly name: string;
  readonly type: AccountType;
  /**
   * Pula wybrana ręcznie; `null` = podąża za rodzajem.
   *
   * Rozróżnienie jest potrzebne, bo serwer przelicza pulę przy zmianie rodzaju **tylko
   * wtedy, gdy nie była nadpisana** (07 §2.1). Wysłanie wyliczonej wartości wyglądałoby
   * dla niego jak świadome nadpisanie.
   */
  readonly allocationOverride: AllocationClass | null;
  readonly openingBalanceText: string;
  /** Saldo ujemne: debet, karta kredytowa. Osobny przełącznik, bo klawiatura dziesiętna na iOS nie ma minusa. */
  readonly negative: boolean;
  readonly openingBalanceOn: string;
  readonly institution: string;
  readonly includeInNetWorth: boolean;
}

/** Błędy pól formularza — klucze to nazwy pól stanu. */
export type AccountFormErrors = Partial<Record<keyof AccountFormState, string>>;

/** Wynik złożenia żądania: gotowe ciało albo błędy pól. */
export type FormResult<T> =
  | { readonly ok: true; readonly body: T }
  | { readonly ok: false; readonly errors: AccountFormErrors };

/**
 * Stan pustego formularza nowego konta.
 *
 * @param today - Dzisiejsza data w strefie gospodarstwa — domyślny dzień salda.
 * @returns Stan początkowy.
 */
export function emptyAccountForm(today: string): AccountFormState {
  return {
    name: '',
    type: 'checking',
    allocationOverride: null,
    openingBalanceText: '',
    negative: false,
    openingBalanceOn: today,
    institution: '',
    includeInNetWorth: true,
  };
}

/**
 * Zamienia kwotę w groszach na tekst pola (bez znaku — znak niesie przełącznik).
 *
 * @param amountMinor - Kwota w groszach.
 * @returns Tekst z przecinkiem, bez separatora tysięcy, np. `1234,50`.
 */
function amountToText(amountMinor: number): string {
  if (amountMinor === 0) return '';
  const abs = Math.abs(amountMinor);
  const whole = Math.trunc(abs / 100);
  const fraction = abs % 100;
  return fraction === 0 ? String(whole) : `${String(whole)},${String(fraction).padStart(2, '0')}`;
}

/**
 * Stan formularza edycji istniejącego konta.
 *
 * Pula jest traktowana jako nadpisana, gdy różni się od domyślnej dla rodzaju — ta sama
 * reguła, którą stosuje serwer (`allocationClassAfterTypeChange`).
 *
 * @param account - Konto do edycji.
 * @returns Stan wypełniony wartościami konta.
 */
export function accountFormFrom(account: AccountDto): AccountFormState {
  return {
    name: account.name,
    type: account.type,
    allocationOverride:
      account.allocationClass === defaultAllocationClass(account.type)
        ? null
        : account.allocationClass,
    openingBalanceText: amountToText(account.openingBalanceMinor),
    negative: account.openingBalanceMinor < 0,
    openingBalanceOn: account.openingBalanceOn,
    institution: account.institution ?? '',
    includeInNetWorth: account.includeInNetWorth,
  };
}

/**
 * Pula, którą konto będzie miało po zapisie — do podglądu w formularzu.
 *
 * @param state - Stan formularza.
 * @param original - Konto przed edycją; brak przy zakładaniu.
 * @returns Pula po zapisie.
 */
export function effectiveAllocationClass(
  state: AccountFormState,
  original?: AccountDto,
): AllocationClass {
  if (state.allocationOverride !== null) return state.allocationOverride;
  return original === undefined
    ? defaultAllocationClass(state.type)
    : allocationClassAfterTypeChange(original.type, original.allocationClass, state.type);
}

/** Pola żądania, które formularz pokazuje pod innym polem stanu. */
const REQUEST_FIELD_TO_FORM: Readonly<Record<string, keyof AccountFormState>> = {
  name: 'name',
  type: 'type',
  allocationClass: 'allocationOverride',
  openingBalanceMinor: 'openingBalanceText',
  openingBalanceOn: 'openingBalanceOn',
  institution: 'institution',
  includeInNetWorth: 'includeInNetWorth',
};

/**
 * Tłumaczy błędy pól żądania (z Zoda albo z odpowiedzi API) na pola formularza.
 *
 * @param fieldErrors - Mapa `pole żądania → komunikat`.
 * @returns Błędy pól formularza.
 */
export function formErrorsFromRequest(
  fieldErrors: Readonly<Record<string, string>>,
): AccountFormErrors {
  const errors: AccountFormErrors = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    const field = REQUEST_FIELD_TO_FORM[path];
    if (field !== undefined && errors[field] === undefined) errors[field] = message;
  }
  return errors;
}

/**
 * Odczytuje saldo początkowe z pola i przełącznika znaku.
 *
 * @param state - Stan formularza.
 * @returns Grosze albo komunikat błędu.
 */
function openingBalance(state: AccountFormState): number | { error: string } {
  const text = state.openingBalanceText.trim();
  if (text === '') return 0;
  const parsed = parseAmountToMinor(text);
  if (parsed === null) return { error: 'Wpisz kwotę, np. 1 250,00' };
  // Minus z klawiatury i przełącznik naraz dawałyby dwie drogi do jednego znaku —
  // i pytanie, co znaczy „ujemne" przy wpisanym minusie. Jedna droga: przełącznik.
  if (parsed < 0) return { error: 'Wpisz kwotę bez minusa — saldo ujemne ustawisz przełącznikiem' };
  return state.negative ? -parsed : parsed;
}

/**
 * Składa ciało `POST /accounts` i sprawdza je tym samym schematem co serwer.
 *
 * Pula jest wysyłana **tylko wtedy, gdy wybrano ją ręcznie** — inaczej serwer sam
 * wyprowadza ją z rodzaju (07 §2.1).
 *
 * @param state - Stan formularza.
 * @returns Ciało żądania albo błędy pól.
 */
export function toCreateRequest(state: AccountFormState): FormResult<CreateAccountInput> {
  const balance = openingBalance(state);
  const body: CreateAccountInput = {
    name: state.name,
    type: state.type,
    ...(state.allocationOverride === null ? {} : { allocationClass: state.allocationOverride }),
    openingBalanceMinor: typeof balance === 'number' ? balance : 0,
    openingBalanceOn: state.openingBalanceOn,
    institution: state.institution.trim() === '' ? null : state.institution,
    includeInNetWorth: state.includeInNetWorth,
  };

  const parsed = CreateAccountRequestSchema.safeParse(body);
  const errors = parsed.success
    ? {}
    : formErrorsFromRequest(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
        ),
      );
  if (typeof balance !== 'number') errors.openingBalanceText = balance.error;

  return Object.keys(errors).length === 0 ? { ok: true, body } : { ok: false, errors };
}

/**
 * Składa ciało `PATCH /accounts/:id` — wyłącznie pola, które się zmieniły.
 *
 * Puste ciało jest poprawne: serwer niczego wtedy nie zmienia, nawet `updatedAt` (04 §5).
 * Zmiana rodzaju bez ręcznie wybranej puli nie wysyła puli, więc serwer zastosuje regułę
 * z 07 §2.1 — nadpisanej nie ruszy, nienadpisaną przeliczy.
 *
 * @param original - Konto przed edycją.
 * @param state - Stan formularza.
 * @returns Ciało żądania albo błędy pól.
 */
export function toUpdateRequest(
  original: AccountDto,
  state: AccountFormState,
): FormResult<UpdateAccountRequest> {
  const created = toCreateRequest(state);
  if (!created.ok) return created;
  const next = created.body;

  const body: UpdateAccountRequest = {};
  if (next.name.trim() !== original.name) body.name = next.name.trim();
  if (next.type !== original.type) body.type = next.type;
  // Wybrana ręcznie pula idzie także wtedy, gdy się nie zmieniła, a zmienił się rodzaj:
  // bez niej serwer przeliczyłby nienadpisaną pulę z nowego rodzaju, wbrew temu, co
  // formularz pokazywał jako wynik zapisu.
  if (
    state.allocationOverride !== null &&
    (state.allocationOverride !== original.allocationClass || next.type !== original.type)
  ) {
    body.allocationClass = state.allocationOverride;
  }
  if (next.openingBalanceMinor !== original.openingBalanceMinor) {
    body.openingBalanceMinor = next.openingBalanceMinor;
  }
  if (next.openingBalanceOn !== original.openingBalanceOn)
    body.openingBalanceOn = next.openingBalanceOn;
  const institution = next.institution?.trim() ?? null;
  if (institution !== original.institution) body.institution = institution;
  if (next.includeInNetWorth !== original.includeInNetWorth) {
    body.includeInNetWorth = next.includeInNetWorth ?? true;
  }
  return { ok: true, body };
}
