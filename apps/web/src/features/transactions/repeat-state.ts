import {
  dueDatesAfterSource,
  monthKeyOf,
  recurringRuleFromRequest,
  recurringRuleFromTransaction,
  recurringScheduleIssues,
  SaveAsRecurringRequestSchema,
  weekdayOf,
  type SaveAsRecurringInput,
  type TransactionType,
} from '@fineapp/shared';

import {
  parseSchedule,
  type RecurringFormErrors,
  type ScheduleFormState,
} from '../recurring/recurring-form-state.js';
import type { TransactionFormState } from './transaction-form-state.js';

/**
 * „Zapisz jako wydatek stały" w formularzu nowej transakcji
 * ([06 §3.3](../../../../../plans/06-ui-views.md#33-formularz-transakcji--tnew-tid), wymaganie
 * #3, `F4-8`, ADR-051). Bez Reacta.
 *
 * Pole wyboru rozwija terminarz podpowiedziany z daty transakcji; po zapisie transakcji
 * formularz woła `POST /transactions/:id/save-as-recurring`. Kwota, konta i kategoria
 * pochodzą z samej transakcji — tu jest tylko „jak często".
 */

/** Terminarz powtarzania — `null` w formularzu znaczy „nie powtarzaj". */
export interface RepeatState extends ScheduleFormState {
  /**
   * `true`, dopóki użytkownik nie ruszył terminarza: zmiana daty transakcji przesuwa
   * wtedy dzień płatności razem z nią.
   */
  readonly followsDate: boolean;
}

/** Etykieta pola wyboru — „wydatek stały" to słowo z wymagania #3. */
const LABELS: Readonly<Record<TransactionType, string>> = {
  expense: 'Zapisz jako wydatek stały',
  income: 'Zapisz jako stały przychód',
  transfer: 'Zapisz jako stały przelew',
};

/**
 * Etykieta pola wyboru dla typu transakcji.
 *
 * @param type - Typ transakcji.
 * @returns Etykieta.
 */
export function repeatLabel(type: TransactionType): string {
  return LABELS[type];
}

/**
 * Terminarz z daty transakcji: co miesiąc, tego samego dnia.
 *
 * @param bookedOn - Data transakcji.
 * @returns Terminarz podążający za datą.
 */
export function repeatFromDate(bookedOn: string): RepeatState {
  return {
    frequency: 'monthly',
    intervalText: '2',
    dayOfMonthText: String(Number(bookedOn.slice(8, 10))),
    weekday: weekdayOf(bookedOn),
    monthOfYear: Number(bookedOn.slice(5, 7)),
    followsDate: true,
  };
}

/**
 * Terminarz po zmianie daty transakcji: podążający przesuwa się z datą (zachowując
 * częstotliwość), ustawiony ręcznie zostaje.
 *
 * @param repeat - Terminarz albo `null`.
 * @param bookedOn - Nowa data transakcji.
 * @returns Terminarz po zmianie.
 */
export function followDate(repeat: RepeatState | null, bookedOn: string): RepeatState | null {
  if (repeat === null || !repeat.followsDate) return repeat;
  return {
    ...repeatFromDate(bookedOn),
    frequency: repeat.frequency,
    intervalText: repeat.intervalText,
  };
}

/**
 * Zmiana pól terminarza przez użytkownika — od tej chwili nie podąża za datą.
 *
 * @param repeat - Terminarz.
 * @param patch - Zmienione pola.
 * @returns Terminarz po zmianie.
 */
export function changeRepeat(repeat: RepeatState, patch: Partial<ScheduleFormState>): RepeatState {
  // Sama zmiana częstotliwości zostawia dzień z daty — „co tydzień" ma dalej wypadać
  // w dniu tygodnia transakcji.
  const onlyFrequency = Object.keys(patch).every((key) => key === 'frequency');
  return { ...repeat, ...patch, followsDate: repeat.followsDate && onlyFrequency };
}

/** Wynik złożenia ciała „Zapisz jako wydatek stały". */
export type RepeatResult =
  | { readonly ok: true; readonly body: SaveAsRecurringInput }
  | { readonly ok: false; readonly errors: RecurringFormErrors };

/**
 * Ciało `POST /transactions/:id/save-as-recurring`. Nazwę, kwotę, konta i miesiąc startu
 * wyznacza serwer z transakcji.
 *
 * @param repeat - Terminarz.
 * @returns Ciało albo błędy pól.
 */
export function toSaveAsRecurringRequest(repeat: RepeatState): RepeatResult {
  const { schedule, errors } = parseSchedule(repeat);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: schedule };
}

/**
 * Kolejne terminy po tej transakcji — podgląd „co dalej", zanim użytkownik zapisze.
 * Liczony tymi samymi funkcjami co serwer: reguła z transakcji i termin, który ona opłaca
 * (`dueDatesAfterSource`).
 *
 * @param form - Stan formularza transakcji.
 * @param repeat - Terminarz.
 * @param monthStartDay - Pierwszy dzień miesiąca budżetowego gospodarstwa.
 * @param count - Ile terminów.
 * @returns Daty rosnąco; pusto, gdy terminarz jest jeszcze niepoprawny.
 */
export function repeatPreview(
  form: TransactionFormState,
  repeat: RepeatState,
  monthStartDay: number,
  count = 3,
): string[] {
  const request = toSaveAsRecurringRequest(repeat);
  if (!request.ok) return [];
  const monthKey = monthKeyOf(form.bookedOn, monthStartDay);
  const rule = recurringRuleFromRequest(
    recurringRuleFromTransaction(
      {
        type: form.type,
        amountMinor: Math.max(1, form.amountMinor),
        bookedOn: form.bookedOn,
        monthKey,
        accountId: form.accountId,
        counterAccountId: form.counterAccountId,
        categoryId: form.categoryId,
        incomeSourceId: form.incomeSourceId,
        goalId: null,
        liabilityId: null,
        allocationOverride: form.allocationOverride,
        description: form.description,
        merchant: form.merchant,
      },
      SaveAsRecurringRequestSchema.parse(request.body),
    ),
  );
  if (recurringScheduleIssues(rule).length > 0) return [];
  return dueDatesAfterSource(rule, monthKey, form.bookedOn, count);
}
