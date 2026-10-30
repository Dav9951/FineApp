import { toBps } from '../utils/money.js';
import { clampDayToMonth, shiftMonth } from '../utils/month.js';
import type { MonthKey } from './primitives.js';

/**
 * Stan i harmonogram zobowiązania
 * ([07 §5](../../../../plans/07-domain-rules.md#5-zobowiązania), `F4-4`, ADR-047).
 *
 * Czyste funkcje w `shared`: API liczy z nich stan każdego zobowiązania, a formularz
 * (`F4-6`) pokaże liczbę rat i datę ostatniej, **zanim** użytkownik zapisze.
 *
 * Uproszczenie z ADR-004: rata nie dzieli się na kapitał i odsetki — cała pomniejsza
 * „pozostałą kwotę".
 */

/** Warunki zobowiązania, z których wynika stan. */
export interface LiabilityTerms {
  /** Pozostało do spłaty na dzień `balanceAsOf` — punkt odniesienia. */
  readonly openingBalanceMinor: number;
  /**
   * Dzień punktu odniesienia. Kwota „na ten dzień" obejmuje raty zapłacone do niego
   * włącznie, więc żadna rata z tego dnia ani wcześniejsza nie jest do zapłaty (ADR-068).
   */
  readonly balanceAsOf: string;
  readonly monthlyPaymentMinor: number;
  /** Dzień płatności raty 1–31; `null` — nieznany. */
  readonly paymentDay: number | null;
  /**
   * Najbliższa rata wskazana wprost — gdy spłata zaczyna się później albo ratę bieżącego
   * miesiąca już zapłacono. Wygrywa z wyliczeniem z `balanceAsOf` (ADR-068).
   */
  readonly firstPaymentOn: string | null;
}

/** Płatności zaksięgowane na zobowiązanie. */
export interface LiabilityPayments {
  /** Suma rat zaksięgowanych **po** `balanceAsOf` (07 §5.1). */
  readonly paidSinceAsOfMinor: number;
  /** Czy w bieżącym miesiącu jest zaksięgowana rata. */
  readonly paidThisMonth: boolean;
}

/** Wyliczony stan zobowiązania. */
export interface LiabilityState {
  readonly remainingMinor: number;
  readonly paidSoFarMinor: number;
  /** Udział spłaconej części punktu odniesienia; `10000` — spłacone. */
  readonly progressBps: number;
  readonly installmentsRemaining: number;
  /** Najbliższa rata do zapłaty; `null` — spłacone albo nieznany dzień płatności. */
  readonly nextDueOn: string | null;
  readonly projectedFinalPaymentOn: string | null;
}

/**
 * Dzień płatności: jawny albo z pierwszej raty.
 *
 * @param terms - Warunki zobowiązania.
 * @returns Dzień 1–31 albo `null`, gdy nie wiadomo, kiedy płacić.
 */
function dayOfPayment(terms: LiabilityTerms): number | null {
  if (terms.paymentDay !== null) return terms.paymentDay;
  return terms.firstPaymentOn === null ? null : Number(terms.firstPaymentOn.slice(8, 10));
}

/**
 * Liczba rat potrzebnych do spłaty kwoty — dzielenie z zaokrągleniem w górę na liczbach
 * całkowitych: ostatnia rata może być niepełna, ale nadal jest ratą.
 *
 * @param remainingMinor - Pozostała kwota.
 * @param monthlyPaymentMinor - Rata, dodatnia.
 * @returns Liczba rat; `0` dla spłaconego.
 */
export function installmentsFor(remainingMinor: number, monthlyPaymentMinor: number): number {
  if (remainingMinor <= 0) return 0;
  const whole = Math.floor(remainingMinor / monthlyPaymentMinor);
  return whole * monthlyPaymentMinor < remainingMinor ? whole + 1 : whole;
}

/**
 * Pierwsza rata do zapłaty od punktu odniesienia (ADR-068).
 *
 * Wskazana wprost (`firstPaymentOn`) — ta data. W przeciwnym razie pierwszy dzień
 * płatności **po** `balanceAsOf`: kwota „na dzień" obejmuje raty do tego dnia, więc
 * zobowiązanie wpisane 28 września z ratą 10. ma pierwszą ratę 10 października, a nie
 * zaległą z 10 września.
 *
 * @param terms - Warunki zobowiązania.
 * @returns Data pierwszej raty albo `null`, gdy dzień płatności jest nieznany.
 */
export function firstInstallmentOn(terms: LiabilityTerms): string | null {
  if (terms.firstPaymentOn !== null) return terms.firstPaymentOn;
  const day = dayOfPayment(terms);
  if (day === null) return null;
  const month = terms.balanceAsOf.slice(0, 7);
  const inAsOfMonth = clampDayToMonth(month, day);
  return inAsOfMonth > terms.balanceAsOf ? inAsOfMonth : clampDayToMonth(shiftMonth(month, 1), day);
}

/**
 * Najbliższa rata do zapłaty.
 *
 * Rata bieżącego miesiąca, dopóki nie jest zaksięgowana — także po terminie (wtedy jest
 * zaległa, a nie „w przyszłym miesiącu"); po zaksięgowaniu — rata następnego miesiąca.
 * Dzień przycinany do długości miesiąca jak w pozycjach cyklicznych (07 §6.1). Nigdy
 * wcześniej niż {@link firstInstallmentOn}: rata sprzed punktu odniesienia jest już
 * w podanej kwocie, a zobowiązanie spłacane od listopada nie ma zaległej raty we wrześniu.
 *
 * @param terms - Warunki zobowiązania.
 * @param today - Dzisiejsza data biznesowa.
 * @param paidThisMonth - Czy rata bieżącego miesiąca jest zaksięgowana.
 * @returns Data raty albo `null`, gdy dzień płatności jest nieznany.
 */
export function nextInstallmentOn(
  terms: LiabilityTerms,
  today: string,
  paidThisMonth: boolean,
): string | null {
  const day = dayOfPayment(terms);
  const first = firstInstallmentOn(terms);
  if (day === null || first === null) return null;
  const month = paidThisMonth ? shiftMonth(today.slice(0, 7), 1) : today.slice(0, 7);
  const due = clampDayToMonth(month, day);
  return first > due ? first : due;
}

/**
 * Data raty `n` miesięcy po wskazanej — z dniem płatności przyciętym do długości
 * miesiąca, ale liczonym od **dnia płatności**, nie od przyciętej daty (31 → 28 lutego
 * → 31 marca).
 *
 * @param from - Data raty wyjściowej.
 * @param months - Ile miesięcy dalej.
 * @param day - Dzień płatności.
 * @returns Data raty.
 */
function installmentAfter(from: string, months: number, day: number): string {
  return clampDayToMonth(shiftMonth(from.slice(0, 7), months), day);
}

/**
 * Stan zobowiązania (07 §5.1).
 *
 * - `remaining = max(0, opening − Σ rat po balanceAsOf)` — nadpłata nie daje ujemnego
 *   długu; serwis może zaproponować zamknięcie, ale nie robi tego sam.
 * - `progressBps` — udział spłaconej części punktu odniesienia. Spłacone to zawsze
 *   `10000`, także po korekcie do zera (`rebase` na 0 zł), gdzie podstawa jest zerowa.
 * - `installmentsRemaining = ceil(remaining / rata)`.
 * - `projectedFinalPaymentOn` — najbliższa rata plus `(raty − 1)` miesięcy.
 *
 * @param terms - Warunki zobowiązania.
 * @param payments - Płatności zaksięgowane na zobowiązanie.
 * @param today - Dzisiejsza data biznesowa.
 * @returns Stan zobowiązania.
 */
export function liabilityState(
  terms: LiabilityTerms,
  payments: LiabilityPayments,
  today: string,
): LiabilityState {
  const remainingMinor = Math.max(0, terms.openingBalanceMinor - payments.paidSinceAsOfMinor);
  const paidSoFarMinor = terms.openingBalanceMinor - remainingMinor;
  const installmentsRemaining = installmentsFor(remainingMinor, terms.monthlyPaymentMinor);
  const day = dayOfPayment(terms);
  const nextDueOn =
    remainingMinor === 0 ? null : nextInstallmentOn(terms, today, payments.paidThisMonth);
  return {
    remainingMinor,
    paidSoFarMinor,
    progressBps: remainingMinor === 0 ? 10_000 : toBps(paidSoFarMinor, terms.openingBalanceMinor),
    installmentsRemaining,
    nextDueOn,
    projectedFinalPaymentOn:
      nextDueOn === null || day === null
        ? null
        : installmentAfter(nextDueOn, installmentsRemaining - 1, day),
  };
}

/** Jedna rata prognozowanego harmonogramu. */
export interface ScheduledInstallment {
  /** Numer kolejny od najbliższej raty, od 1. */
  readonly number: number;
  readonly dueOn: string;
  readonly amountMinor: number;
  /** Ile zostanie po zapłaceniu tej raty. */
  readonly remainingAfterMinor: number;
}

/** Najdłuższy harmonogram — 50 lat rat miesięcznych. Dłuższy to raczej błąd w danych. */
export const MAX_SCHEDULE_LENGTH = 600;

/**
 * Prognozowany harmonogram spłaty: pełne raty, ostatnia — reszta (07 §5.1).
 *
 * Bez odsetek (ADR-004): to rozpisanie pozostałej kwoty na raty, a nie harmonogram banku.
 *
 * @param terms - Warunki zobowiązania.
 * @param state - Stan bieżący (pozostała kwota i najbliższa rata).
 * @returns Raty rosnąco; pusta lista, gdy spłacone albo dzień płatności nieznany.
 */
export function liabilitySchedule(
  terms: LiabilityTerms,
  state: Pick<LiabilityState, 'remainingMinor' | 'nextDueOn'>,
): ScheduledInstallment[] {
  const day = dayOfPayment(terms);
  if (state.nextDueOn === null || day === null) return [];
  const result: ScheduledInstallment[] = [];
  let remaining = state.remainingMinor;
  while (remaining > 0 && result.length < MAX_SCHEDULE_LENGTH) {
    const amountMinor = Math.min(terms.monthlyPaymentMinor, remaining);
    remaining -= amountMinor;
    result.push({
      number: result.length + 1,
      dueOn: installmentAfter(state.nextDueOn, result.length, day),
      amountMinor,
      remainingAfterMinor: remaining,
    });
  }
  return result;
}

/**
 * Miesiąc pierwszej raty — start reguły cyklicznej na ratę.
 *
 * Ta sama data co {@link firstInstallmentOn}, więc reguła nie wygeneruje raty sprzed
 * punktu odniesienia jako zaległej: kredyt wpisany 23 września z ratą 10. dostaje pierwszą
 * ratę w październiku, a z ratą 25. — jeszcze we wrześniu. Wskazana wprost pierwsza rata
 * wygrywa (ADR-068).
 *
 * @param balanceAsOf - Dzień punktu odniesienia.
 * @param paymentDay - Dzień płatności raty.
 * @param firstPaymentOn - Najbliższa rata wskazana wprost.
 * @returns Klucz miesiąca pierwszej raty.
 */
export function firstInstallmentMonth(
  balanceAsOf: string,
  paymentDay: number,
  firstPaymentOn: string | null,
): MonthKey {
  const first = firstInstallmentOn({
    openingBalanceMinor: 0,
    monthlyPaymentMinor: 1,
    balanceAsOf,
    paymentDay,
    firstPaymentOn,
  });
  // Dzień płatności jest podany, więc data zawsze istnieje.
  return (first ?? balanceAsOf).slice(0, 7);
}
