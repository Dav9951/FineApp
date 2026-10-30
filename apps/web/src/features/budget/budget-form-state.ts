import {
  shiftMonth,
  type BudgetLineDto,
  type BudgetLineFlow,
  type CreateBudgetDraftRequest,
  type CreateBudgetLineRequest,
  type MonthKey,
  type PlannedExpensePriority,
  type PromoteBudgetLineRequest,
  type UpdateBudgetLineRequest,
} from '@fineapp/shared';

import { parseSchedule, type ScheduleFormState } from '../recurring/recurring-form-state.js';

/**
 * Stan formularzy planera budżetu — arkusz linii i zamiana w byt
 * ([06 §3.14](../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth),
 * `F9-7`). Czyste funkcje: z nich powstają żądania, a testy nie potrzebują ekranu.
 */

/** Pola arkusza linii. */
export interface LineFormState {
  readonly flow: BudgetLineFlow;
  readonly name: string;
  readonly amountMinor: number;
  readonly categoryId: string | null;
  readonly goalId: string | null;
  /** Data `YYYY-MM-DD` albo pusty napis. */
  readonly dueOn: string;
  /** Okno średniej, gdy kwota przyszła ze średniej. */
  readonly averageMonths: 3 | 6 | 12 | null;
  /** Grupa w sekcji (07 §13.10); `null` — „Bez grupy". */
  readonly groupId: string | null;
}

/** Błędy pól arkusza linii. */
export type LineFormErrors = Partial<Record<'name' | 'amountMinor' | 'dueOn', string>>;

/** Wynik zamiany stanu w żądanie. */
export type FormResult<T, E> = { ok: true; body: T } | { ok: false; errors: E };

/**
 * Stan arkusza dla linii istniejącej albo nowej.
 *
 * @param line - Linia do edycji; `null` — nowa.
 * @param flow - Strona bilansu nowej linii (z sekcji „+ Dodaj").
 * @param groupId - Grupa nowej linii — ostatnio wybrana w sekcji; `null` — „Bez grupy".
 * @returns Stan formularza.
 */
export function lineFormFrom(
  line: BudgetLineDto | null,
  flow: BudgetLineFlow,
  groupId: string | null = null,
): LineFormState {
  if (line === null) {
    return {
      flow,
      name: '',
      amountMinor: 0,
      categoryId: null,
      goalId: null,
      dueOn: '',
      averageMonths: null,
      groupId,
    };
  }
  return {
    flow: line.flow,
    name: line.name,
    amountMinor: line.amountMinor,
    categoryId: line.categoryId,
    goalId: line.goalId,
    dueOn: line.dueOn ?? '',
    averageMonths: line.averageMonths,
    groupId: line.groupId,
  };
}

/**
 * Sprawdza pola widoczne bez serwera: nazwę i datę w miesiącu planu. Reszta (I-21, I-23)
 * przychodzi z API przy zapisie.
 *
 * @param state - Stan formularza.
 * @param month - Miesiąc planu.
 * @returns Błędy pól; puste, gdy można wysłać.
 */
function lineErrors(state: LineFormState, month: MonthKey): LineFormErrors {
  const errors: LineFormErrors = {};
  if (state.name.trim() === '') errors.name = 'Nazwa jest wymagana';
  if (state.dueOn !== '' && !state.dueOn.startsWith(month)) {
    errors.dueOn = 'Data musi mieścić się w miesiącu planu';
  }
  return errors;
}

/**
 * Żądanie nowej linii własnej.
 *
 * @param state - Stan formularza.
 * @param month - Miesiąc planu.
 * @returns Żądanie albo błędy pól.
 */
export function toCreateLineRequest(
  state: LineFormState,
  month: MonthKey,
): FormResult<CreateBudgetLineRequest, LineFormErrors> {
  const errors = lineErrors(state, month);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const isPool = state.flow === 'savings' || state.flow === 'investment';
  return {
    ok: true,
    body: {
      flow: state.flow,
      name: state.name.trim(),
      amountMinor: state.amountMinor,
      categoryId: isPool ? null : state.categoryId,
      goalId: isPool ? state.goalId : null,
      dueOn: state.dueOn === '' ? null : state.dueOn,
      averageMonths: state.averageMonths,
      notes: null,
      groupId: state.groupId,
    },
  };
}

/**
 * Żądanie zmiany linii — tylko pola, które się zmieniły. Pusta zmiana = nic do wysłania.
 *
 * Kwota zmieniona bez średniej wysyła `averageMonths` tylko wtedy, gdy średnią wybrano
 * w arkuszu — inaczej serwer sam czyści pamiątkę średniej (07 §13.5).
 *
 * @param line - Linia przed zmianą.
 * @param state - Stan formularza.
 * @param month - Miesiąc planu.
 * @returns Żądanie albo błędy pól.
 */
export function toUpdateLineRequest(
  line: BudgetLineDto,
  state: LineFormState,
  month: MonthKey,
): FormResult<UpdateBudgetLineRequest, LineFormErrors> {
  const errors = lineErrors(state, month);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const body: { -readonly [K in keyof UpdateBudgetLineRequest]: UpdateBudgetLineRequest[K] } = {};
  const name = state.name.trim();
  if (name !== line.name) body.name = name;
  if (state.amountMinor !== line.amountMinor) body.amountMinor = state.amountMinor;
  if (state.categoryId !== line.categoryId) body.categoryId = state.categoryId;
  if (state.goalId !== line.goalId) body.goalId = state.goalId;
  const dueOn = state.dueOn === '' ? null : state.dueOn;
  if (dueOn !== line.dueOn) body.dueOn = dueOn;
  if (state.averageMonths !== line.averageMonths && state.averageMonths !== null) {
    body.averageMonths = state.averageMonths;
  }
  if (state.groupId !== line.groupId) body.groupId = state.groupId;
  return { ok: true, body };
}

/** Pola zamiany linii w byt. */
export interface PromoteFormState extends ScheduleFormState {
  readonly target: 'recurring' | 'planned';
  readonly accountId: string | null;
  readonly counterAccountId: string | null;
  readonly dueMonth: MonthKey;
  readonly knowsDate: boolean;
  readonly dueOn: string;
  readonly priority: PlannedExpensePriority;
}

/** Błędy pól zamiany. */
export type PromoteFormErrors = Partial<
  Record<
    'accountId' | 'counterAccountId' | 'dayOfMonthText' | 'intervalText' | 'weekday' | 'dueOn',
    string
  >
>;

/**
 * Stan zamiany: dzień płatności z daty linii, termin planowanego — miesiąc planu.
 *
 * @param line - Linia własna.
 * @param target - Cel zamiany.
 * @param month - Miesiąc planu.
 * @param defaultAccountId - Domyślne konto wydatków gospodarstwa.
 * @returns Stan formularza.
 */
export function promoteFormFrom(
  line: BudgetLineDto,
  target: 'recurring' | 'planned',
  month: MonthKey,
  defaultAccountId: string | null,
): PromoteFormState {
  const day = line.dueOn === null ? '' : String(Number(line.dueOn.slice(8, 10)));
  return {
    target,
    frequency: 'monthly',
    intervalText: '2',
    dayOfMonthText: day,
    weekday: 1,
    monthOfYear: Number(month.slice(5, 7)),
    accountId: defaultAccountId,
    counterAccountId: null,
    dueMonth: month,
    knowsDate: line.dueOn !== null,
    dueOn: line.dueOn ?? '',
    priority: 'should',
  };
}

/**
 * Żądanie zamiany linii.
 *
 * Dla pozycji cyklicznej konto jest wymagane (reguła bez konta nie powstaje, 05 §11),
 * a przelew z linii puli — także konto docelowe. Dla planowanego wydatku data musi
 * mieścić się w wybranym miesiącu (I-16).
 *
 * @param state - Stan formularza.
 * @param line - Linia własna.
 * @returns Żądanie albo błędy pól.
 */
export function toPromoteRequest(
  state: PromoteFormState,
  line: BudgetLineDto,
): FormResult<PromoteBudgetLineRequest, PromoteFormErrors> {
  if (state.target === 'planned') {
    const dueOn = state.knowsDate && state.dueOn !== '' ? state.dueOn : null;
    if (dueOn !== null && !dueOn.startsWith(state.dueMonth)) {
      return { ok: false, errors: { dueOn: 'Data musi mieścić się w wybranym miesiącu' } };
    }
    return {
      ok: true,
      body: {
        target: 'planned',
        dueMonth: state.dueMonth,
        dueOn,
        priority: state.priority,
        amountIsEstimate: true,
        setAsideEnabled: false,
        alreadySetAsideMinor: 0,
        repeatsYearly: false,
      },
    };
  }
  const { schedule, errors: scheduleErrors } = parseSchedule(state);
  const errors: PromoteFormErrors = { ...scheduleErrors };
  const isPool = line.flow === 'savings' || line.flow === 'investment';
  if (state.accountId === null) {
    errors.accountId = isPool ? 'Wybierz konto, z którego idzie przelew' : 'Wybierz konto';
  }
  if (isPool && state.counterAccountId === null) {
    errors.counterAccountId = 'Wybierz konto, na które idzie przelew';
  }
  if (Object.keys(errors).length > 0 || state.accountId === null) return { ok: false, errors };
  return {
    ok: true,
    body: {
      target: 'recurring',
      frequency: schedule.frequency,
      intervalCount: schedule.intervalCount,
      dayOfMonth: schedule.dayOfMonth,
      weekday: schedule.weekday,
      monthOfYear: schedule.monthOfYear,
      accountId: state.accountId,
      counterAccountId: isPool ? state.counterAccountId : null,
      autoPost: false,
      amountIsEstimate: false,
      isFixedExpense: line.flow === 'expense',
    },
  };
}

/** Podgląd skutku „Zapisz w źródle" — przed zatwierdzeniem (07 §13.7). */
export type ApplyPreview =
  | {
      readonly kind: 'rule_split';
      readonly fromMonth: MonthKey;
      readonly untilMonth: MonthKey;
      readonly newMinor: number;
      readonly oldMinor: number;
    }
  | { readonly kind: 'rule_updated'; readonly newMinor: number }
  | { readonly kind: 'planned_updated'; readonly newMinor: number; readonly oldMinor: number }
  | { readonly kind: 'goal_updated'; readonly newMinor: number; readonly oldMinor: number };

/**
 * Co zrobi „Zapisz w źródle" — do zdania nad przyciskiem.
 *
 * Dla reguły w miesiącu przyszłym serwer dzieli ją, chyba że reguła zaczyna się dopiero
 * w tym miesiącu — wtedy zmienia kwotę. Ekran nie zna startu reguły, ale w obu
 * przypadkach prawdą jest „od M nowa kwota, wcześniej stara", więc podgląd podziału
 * nie wprowadza w błąd.
 *
 * @param line - Linia powiązana.
 * @param month - Miesiąc planu.
 * @param currentMonth - Bieżący miesiąc.
 * @returns Podgląd albo `null`, gdy linii nie da się zapisać w źródle.
 */
export function applyPreview(
  line: BudgetLineDto,
  month: MonthKey,
  currentMonth: MonthKey,
): ApplyPreview | null {
  if (!line.canApplyToSource) return null;
  const oldMinor = line.sourceCurrentAmountMinor ?? line.sourceAmountMinor ?? 0;
  const newMinor = Math.abs(line.amountMinor);
  switch (line.origin) {
    case 'recurring':
      return month > currentMonth
        ? {
            kind: 'rule_split',
            fromMonth: month,
            untilMonth: shiftMonth(month, -1),
            newMinor,
            oldMinor: Math.abs(oldMinor),
          }
        : { kind: 'rule_updated', newMinor };
    case 'planned':
      return { kind: 'planned_updated', newMinor, oldMinor };
    default:
      return { kind: 'goal_updated', newMinor, oldMinor };
  }
}

/** Pola arkusza „Utwórz z danych". */
export interface FillFormState {
  readonly fillFromSources: boolean;
  readonly months: 3 | 6 | 12;
  /** Kategorie, dla których powstanie linia ze średnią. */
  readonly categoryIds: readonly string[];
  /** Miesiąc, z którego kopiować linie własne; `null` — bez kopii. */
  readonly copyManualFrom: MonthKey | null;
}

/**
 * Żądanie założenia szkicu z arkusza „Utwórz z danych" (07 §13.2). Jedno okno średniej
 * dla wszystkich wybranych kategorii — tak jak w arkuszu; każdą linię można potem
 * przeliczyć na innym oknie.
 *
 * @param state - Stan arkusza.
 * @returns Żądanie.
 */
export function toCreateDraftRequest(state: FillFormState): CreateBudgetDraftRequest {
  return {
    fillFromSources: state.fillFromSources,
    copyManualFrom: state.copyManualFrom,
    averageLines: state.categoryIds.map((categoryId) => ({ categoryId, months: state.months })),
    notes: null,
  };
}
