import {
  allocationEffects,
  CreateTransactionRequestSchema,
  earliestPostableDate,
  formatDateOnly,
  latestPostableDate,
  type AccountDto,
  type AllocationClass,
  type AllocationEffect,
  type AllocationOverride,
  type CreateTransactionInput,
  type TransactionDto,
  type TransactionType,
  type UpdateTransactionRequest,
} from '@fineapp/shared';

/**
 * Stan i reguły formularza transakcji ([06 §3.3](../../../../../plans/06-ui-views.md#33-formularz-transakcji--tnew-tid)).
 *
 * Reguły kształtu (I-2, I-3, I-7a) sprawdza ten sam schemat co API
 * (`CreateTransactionRequestSchema` → `transactionShapeIssues`), więc formularz pokazuje
 * błąd pod polem, zanim cokolwiek wyśle. Tutaj są tylko rzeczy, których schemat nie wie:
 * co znaczy „brak kwoty" w klawiaturze, jakie wartości domyślne, jak zmiana typu czyści
 * pola, które do niego nie pasują.
 */

/** Pola formularza. */
export interface TransactionFormState {
  readonly type: TransactionType;
  /** Grosze z klawiatury kwoty; `0` = nic nie wpisano. */
  readonly amountMinor: number;
  readonly accountId: string | null;
  /** Wyłącznie przelew: konto docelowe. */
  readonly counterAccountId: string | null;
  readonly categoryId: string | null;
  /** Wyłącznie przychód (I-3a). */
  readonly incomeSourceId: string | null;
  readonly bookedOn: string;
  /**
   * Nadpisanie alokacji. Formularz daje tylko wyłączenie (`'none'`, 06 §3.3); wymuszone
   * `'savings'`/`'investment'` z API zostaje przy edycji nietknięte.
   */
  readonly allocationOverride: AllocationOverride | null;
  /** Wyłącznie przelew: cel, na który idzie wpłata (07 §4.1, `Z-23`). */
  readonly goalId: string | null;
  readonly description: string;
  readonly merchant: string;
  readonly notes: string;
}

/** Błędy pól formularza. */
export type TransactionFormErrors = Partial<Record<keyof TransactionFormState, string>>;

/** Wynik złożenia żądania. */
export type TransactionFormResult<T> =
  | { readonly ok: true; readonly body: T }
  | { readonly ok: false; readonly errors: TransactionFormErrors };

/** Tytuł arkusza — rodzaj operacji w bierniku widać od razu. */
const TITLES: Readonly<Record<TransactionType, { create: string; edit: string }>> = {
  expense: { create: 'Nowy wydatek', edit: 'Edytuj wydatek' },
  income: { create: 'Nowy przychód', edit: 'Edytuj przychód' },
  transfer: { create: 'Nowy przelew', edit: 'Edytuj przelew' },
};

/**
 * Tytuł arkusza formularza.
 *
 * @param type - Typ transakcji.
 * @param editing - Czy to edycja.
 * @returns Tytuł.
 */
export function formTitle(type: TransactionType, editing: boolean): string {
  return editing ? TITLES[type].edit : TITLES[type].create;
}

/**
 * Konto proponowane w nowej transakcji.
 *
 * Domyślne konto wydatków gospodarstwa (ADR-070), jeśli jest wśród aktywnych; inaczej
 * pierwsze aktywne konto na wydatki — tak wygląda „dwa dotknięcia do wydatku" (06 §1.3):
 * większość wydatków idzie z rachunku bieżącego. Gdy takiego nie ma — pierwsze aktywne.
 *
 * @param accounts - Konta w kolejności wyświetlania.
 * @param preferredId - Domyślne konto wydatków z ustawień albo `null`.
 * @returns Identyfikator albo `null`, gdy nie ma żadnego aktywnego konta.
 */
export function defaultAccountId(
  accounts: readonly AccountDto[],
  preferredId: string | null = null,
): string | null {
  const active = accounts.filter((account) => !account.isArchived);
  if (preferredId !== null && active.some((account) => account.id === preferredId)) {
    return preferredId;
  }
  return (
    active.find((account) => account.allocationClass === 'spending')?.id ?? active[0]?.id ?? null
  );
}

/**
 * Wartości wpisane z góry w nową transakcję — „Uzupełnij" na kaflu celów procentowych
 * otwiera przelew z brakującą kwotą (06 §3.1), wpłata z celu — z celem i jego kontem.
 */
export interface TransactionPreset {
  readonly amountMinor?: number;
  readonly counterAccountId?: string | null;
  readonly goalId?: string | null;
}

/**
 * Pusty formularz nowej transakcji.
 *
 * @param type - Typ wybrany z FAB albo zakładki.
 * @param today - Dzisiejsza data w strefie gospodarstwa.
 * @param accountId - Konto proponowane.
 * @param preset - Wartości wpisane z góry.
 * @returns Stan początkowy.
 */
export function emptyTransactionForm(
  type: TransactionType,
  today: string,
  accountId: string | null,
  preset: TransactionPreset = {},
): TransactionFormState {
  const transfer = type === 'transfer';
  return {
    type,
    amountMinor: preset.amountMinor ?? 0,
    accountId,
    counterAccountId: transfer ? (preset.counterAccountId ?? null) : null,
    categoryId: null,
    incomeSourceId: null,
    bookedOn: today,
    allocationOverride: null,
    goalId: transfer ? (preset.goalId ?? null) : null,
    description: '',
    merchant: '',
    notes: '',
  };
}

/**
 * Formularz wypełniony istniejącą transakcją.
 *
 * @param tx - Transakcja do edycji.
 * @returns Stan formularza.
 */
export function transactionFormFrom(tx: TransactionDto): TransactionFormState {
  return {
    type: tx.type,
    amountMinor: tx.amountMinor,
    accountId: tx.accountId,
    counterAccountId: tx.counterAccountId,
    categoryId: tx.categoryId,
    incomeSourceId: tx.incomeSourceId,
    bookedOn: tx.bookedOn,
    allocationOverride: tx.allocationOverride,
    goalId: tx.goalId,
    description: tx.description ?? '',
    merchant: tx.merchant ?? '',
    notes: tx.notes ?? '',
  };
}

/**
 * Zmienia typ nowej transakcji.
 *
 * Kwota, data, konto i opisy zostają — to te same pieniądze, tylko źle zaklasyfikowane.
 * Kategoria, źródło, konto docelowe, cel i nadpisanie alokacji znikają, bo w innym typie są
 * błędem (I-3, I-3a, I-4, I-7a), a zostawione po cichu wróciłyby jako `422`.
 *
 * @param state - Stan formularza.
 * @param type - Nowy typ.
 * @returns Stan po zmianie.
 */
export function switchType(
  state: TransactionFormState,
  type: TransactionType,
): TransactionFormState {
  if (type === state.type) return state;
  return {
    ...state,
    type,
    categoryId: null,
    incomeSourceId: null,
    counterAccountId: null,
    allocationOverride: null,
    goalId: null,
  };
}

/**
 * Tekst opcjonalny: przycięty, pusty jako `null`.
 *
 * @param value - Tekst z pola.
 * @returns Tekst albo `null`.
 */
function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Składa ciało `POST /transactions` i sprawdza je schematem formularza.
 *
 * @param state - Stan formularza.
 * @returns Ciało albo błędy pól.
 */
export function toCreateRequest(
  state: TransactionFormState,
): TransactionFormResult<CreateTransactionInput> {
  // Brak kwoty i brak konta dostają własne, ludzkie komunikaty — Zod powiedziałby
  // „Expected string, received null".
  const errors: TransactionFormErrors = {};
  if (state.amountMinor <= 0) errors.amountMinor = 'Wpisz kwotę większą od zera';
  if (state.accountId === null) {
    errors.accountId = state.type === 'transfer' ? 'Wybierz konto, z którego' : 'Wybierz konto';
  }
  if (state.type === 'transfer' && state.counterAccountId === null) {
    errors.counterAccountId = 'Wybierz konto, na które';
  }

  const body: CreateTransactionInput = {
    type: state.type,
    bookedOn: state.bookedOn,
    amountMinor: state.amountMinor,
    accountId: state.accountId ?? '',
    counterAccountId: state.type === 'transfer' ? state.counterAccountId : null,
    categoryId: state.type === 'transfer' ? null : state.categoryId,
    incomeSourceId: state.type === 'income' ? state.incomeSourceId : null,
    allocationOverride: state.allocationOverride,
    goalId: state.type === 'transfer' ? state.goalId : null,
    description: optional(state.description),
    merchant: optional(state.merchant),
    notes: optional(state.notes),
  };

  if (Object.keys(errors).length === 0) {
    const parsed = CreateTransactionRequestSchema.safeParse(body);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && field in state) {
          const key = field as keyof TransactionFormState;
          errors[key] ??= issue.message;
        }
      }
    }
  }

  return Object.keys(errors).length === 0 ? { ok: true, body } : { ok: false, errors };
}

/** Pola, które edycja porównuje z transakcją. */
const EDITABLE: readonly (keyof UpdateTransactionRequest & keyof TransactionFormState)[] = [
  'bookedOn',
  'amountMinor',
  'accountId',
  'counterAccountId',
  'categoryId',
  'incomeSourceId',
  'allocationOverride',
  'goalId',
  'description',
  'merchant',
  'notes',
];

/**
 * Składa ciało `PATCH /transactions/:id` — wyłącznie pola, które się zmieniły.
 *
 * @param original - Transakcja przed edycją.
 * @param state - Stan formularza.
 * @returns Ciało albo błędy pól; puste ciało = brak zmian.
 */
export function toUpdateRequest(
  original: TransactionDto,
  state: TransactionFormState,
): TransactionFormResult<UpdateTransactionRequest> {
  const created = toCreateRequest(state);
  if (!created.ok) return created;

  const next = created.body;
  const before = toCreateRequest(transactionFormFrom(original));
  const previous: Partial<CreateTransactionInput> = before.ok ? before.body : {};
  const body: UpdateTransactionRequest = {};
  for (const field of EDITABLE) {
    if (next[field] !== previous[field]) Object.assign(body, { [field]: next[field] });
  }
  return { ok: true, body };
}

/**
 * Tłumaczy `details` z odpowiedzi API (`422`, `404`) na błędy pól formularza.
 *
 * @param fieldErrors - Mapa `pole → komunikat` z `ApiRequestError.fieldErrors()`.
 * @returns Błędy pól; nieznane pola są pomijane.
 */
export function formErrorsFromApi(
  fieldErrors: Readonly<Record<string, string>>,
): TransactionFormErrors {
  const known: readonly string[] = [
    'amountMinor',
    'accountId',
    'counterAccountId',
    'categoryId',
    'incomeSourceId',
    'bookedOn',
    'allocationOverride',
    'description',
    'merchant',
    'notes',
  ];
  const errors: TransactionFormErrors = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    if (known.includes(path)) errors[path as keyof TransactionFormState] = message;
  }
  return errors;
}

/**
 * Podgląd efektu przelewu na cele — plakietka „Liczy się jako oszczędności +2 000,00"
 * (06 §3.3, 07 §2.2), liczona **tą samą funkcją** co serwer.
 *
 * Przy edycji strona z niezmienionym kontem bierze migawkę z transakcji, nie bieżącą
 * klasę konta — tak zrobi serwer (I-6, ADR-035), więc podgląd nie może obiecać czegoś
 * innego niż zapis.
 *
 * @param state - Stan formularza.
 * @param accounts - Konta z klasami alokacji.
 * @param original - Transakcja przed edycją.
 * @returns Efekty; pusta lista, gdy przelew jest neutralny albo kont brakuje.
 */
export function previewEffects(
  state: TransactionFormState,
  accounts: readonly AccountDto[],
  original?: TransactionDto,
): AllocationEffect[] {
  if (state.type !== 'transfer') return [];
  const classOf = (
    accountId: string | null,
    originalId: string | null | undefined,
    snapshot: AllocationClass | null | undefined,
  ): AllocationClass | null => {
    if (accountId === null) return null;
    if (original !== undefined && accountId === originalId && snapshot) return snapshot;
    return accounts.find((account) => account.id === accountId)?.allocationClass ?? null;
  };
  const source = classOf(state.accountId, original?.accountId, original?.sourceAllocationClass);
  const target = classOf(
    state.counterAccountId,
    original?.counterAccountId,
    original?.targetAllocationClass,
  );
  if (source === null || target === null) return [];
  return allocationEffects({
    type: 'transfer',
    amountMinor: state.amountMinor,
    sourceAllocationClass: source,
    targetAllocationClass: target,
    allocationOverride: state.allocationOverride,
    liabilityId: null,
  });
}

/**
 * Czy przelew między tymi kontami w ogóle rusza jakąś pulę — bez względu na wyłącznik.
 *
 * Wyłącznik „Liczy się do celów" ma sens tylko wtedy; przy przelewie ROR → gotówka
 * nie ma czego wyłączać (I-7).
 *
 * @param state - Stan formularza.
 * @param accounts - Konta.
 * @param original - Transakcja przed edycją.
 * @returns `true`, gdy bez wyłączenia byłby jakiś efekt.
 */
export function transferCanAffectGoals(
  state: TransactionFormState,
  accounts: readonly AccountDto[],
  original?: TransactionDto,
): boolean {
  const unlocked = {
    ...state,
    allocationOverride: null,
    amountMinor: Math.max(state.amountMinor, 1),
  };
  return previewEffects(unlocked, accounts, original).length > 0;
}

/**
 * Przesuwa datę biznesową o liczbę dni.
 *
 * Arytmetyka w UTC na samej dacie — bez strefy nie ma zmiany czasu, która
 * przesunęłaby wynik o godzinę i dzień.
 *
 * @param dateOnly - Data `YYYY-MM-DD`.
 * @param days - Liczba dni; ujemna cofa.
 * @returns Data `YYYY-MM-DD`.
 */
export function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const pad = (value: number): string => String(value).padStart(2, '0');
  // Składane z części UTC, nie przez `toISOString().slice(0, 10)` — ten zapis jest
  // w projekcie zakazany (`CLAUDE.md`, reguła 3), nawet gdy akurat dałby dobry wynik.
  return `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Skrót daty w wyborze daty. */
export interface DateShortcut {
  readonly label: string;
  readonly date: string;
}

/**
 * Skróty „dziś / wczoraj / przedwczoraj" (06 §3.3) — tylko te, które mieszczą się
 * w oknie księgowania (I-8). Pierwszego dnia miesiąca przy limicie 0 zostaje samo „dziś".
 *
 * @param today - Dzisiejsza data.
 * @param min - Najwcześniejsza dozwolona data.
 * @returns Skróty w kolejności od dziś.
 */
export function dateShortcuts(today: string, min: string): DateShortcut[] {
  return [
    { label: 'Dziś', date: today },
    { label: 'Wczoraj', date: addDays(today, -1) },
    { label: 'Przedwczoraj', date: addDays(today, -2) },
  ].filter((shortcut) => shortcut.date >= min);
}

/**
 * Okno dat, które wolno wybrać (I-8, 07 §1.3).
 *
 * @param today - Dzisiejsza data w strefie gospodarstwa.
 * @param limitMonths - Limit księgowania wstecz z ustawień gospodarstwa.
 * @param monthStartDay - Dzień rozpoczęcia miesiąca budżetowego.
 * @returns Najwcześniejsza i najpóźniejsza data.
 */
export function postingBounds(
  today: string,
  limitMonths: number,
  monthStartDay: number,
): { min: string; max: string } {
  return {
    min: earliestPostableDate(today, limitMonths),
    max: latestPostableDate(today, monthStartDay),
  };
}

/**
 * Data w wierszu formularza: „dziś, 18 września", „wczoraj, 17 września" albo pełna.
 *
 * @param date - Wybrana data.
 * @param today - Dzisiejsza data.
 * @returns Tekst do pokazania.
 */
export function dateLabel(date: string, today: string): string {
  const full = formatDateOnly(date);
  const withoutYear = full.replace(/ \d{4}$/, '');
  if (date === today) return `dziś, ${withoutYear}`;
  if (date === addDays(today, -1)) return `wczoraj, ${withoutYear}`;
  if (date === addDays(today, -2)) return `przedwczoraj, ${withoutYear}`;
  return full;
}
