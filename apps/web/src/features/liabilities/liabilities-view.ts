import type { LiabilityDto, LiabilityKind } from '@fineapp/shared';
import {
  Car,
  CreditCard,
  HandCoins,
  Home,
  Landmark,
  ShoppingBag,
  Smartphone,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { formatDateShort, inMonth, pluralPl } from '../../lib/format.js';

/**
 * Czyste reguły ekranu zobowiązań
 * ([06 §3.8](../../../../../plans/06-ui-views.md#38-zobowiązania--liabilities), `F4-6`):
 * nazwy, ikony, sumy i linia stanu raty. Bez Reacta — testowane wprost.
 */

/** Nazwa rodzaju zobowiązania. */
export const LIABILITY_KIND_LABEL: Readonly<Record<LiabilityKind, string>> = {
  mortgage: 'Kredyt hipoteczny',
  cash_loan: 'Kredyt gotówkowy',
  car_loan: 'Kredyt samochodowy',
  installment: 'Raty',
  credit_card: 'Karta kredytowa',
  bnpl: 'Odroczona płatność',
  private: 'Pożyczka prywatna',
  other: 'Inne',
};

/** Kolejność rodzajów w formularzu — od najczęstszych. */
export const LIABILITY_KIND_ORDER: readonly LiabilityKind[] = [
  'mortgage',
  'cash_loan',
  'car_loan',
  'installment',
  'credit_card',
  'bnpl',
  'private',
  'other',
];

/**
 * Ikona rodzaju — stała mapa, nie dynamiczny import (budżet paczki, jak przy kontach).
 */
export const LIABILITY_KIND_ICON: Readonly<Record<LiabilityKind, LucideIcon>> = {
  mortgage: Home,
  cash_loan: Landmark,
  car_loan: Car,
  installment: Smartphone,
  credit_card: CreditCard,
  bnpl: ShoppingBag,
  private: HandCoins,
  other: Wallet,
};

/** Sumy nad listą. */
export interface LiabilityTotals {
  /** „Razem do spłaty" — pozostałe kwoty aktywnych. */
  readonly remainingMinor: number;
  /** „Miesięcznie" — raty aktywnych, jeszcze niespłaconych. */
  readonly monthlyMinor: number;
}

/**
 * Sumy aktywnych zobowiązań (06 §3.8). Spłacone, ale jeszcze niezamknięte, nie dokładają
 * raty — nic już nie płacą.
 *
 * @param liabilities - Zobowiązania.
 * @returns Sumy.
 */
export function liabilityTotals(liabilities: readonly LiabilityDto[]): LiabilityTotals {
  const active = liabilities.filter((item) => item.isActive);
  return {
    remainingMinor: active.reduce((sum, item) => sum + item.remainingMinor, 0),
    monthlyMinor: active
      .filter((item) => item.remainingMinor > 0)
      .reduce((sum, item) => sum + item.monthlyPaymentMinor, 0),
  };
}

/** Rzymskie numery miesięcy — „do IV 2040" jak w 06 §3.8. */
const ROMAN_MONTH = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/**
 * Liczba rat z polską odmianą: „1 rata", „3 raty", „163 raty", „5 rat".
 *
 * @param count - Liczba rat.
 * @returns Opis.
 */
export function installmentsLabel(count: number): string {
  return `${String(count)} ${pluralPl(count, 'rata', 'raty', 'rat')}`;
}

/**
 * Miesiąc ostatniej raty: „do IV 2040".
 *
 * @param finalOn - Data ostatniej raty albo `null`.
 * @returns Opis albo `null`.
 */
export function finalPaymentLabel(finalOn: string | null): string | null {
  if (finalOn === null) return null;
  return `do ${ROMAN_MONTH[Number(finalOn.slice(5, 7)) - 1] ?? ''} ${finalOn.slice(0, 4)}`;
}

/** Stan raty na karcie zobowiązania. */
export type InstallmentStatus =
  | { readonly kind: 'paid'; readonly label: string }
  | { readonly kind: 'due'; readonly label: string }
  | { readonly kind: 'overdue'; readonly label: string }
  | { readonly kind: 'done'; readonly label: string }
  | { readonly kind: 'closed'; readonly label: string }
  | { readonly kind: 'unknown'; readonly label: string };

/**
 * Linia stanu raty pod kartą (06 §3.8): „✓ Zapłacono we wrześniu (10 wrz)",
 * „Rata na 20 wrz", „Rata po terminie — 10 wrz", „Spłacone".
 *
 * Kolejność ma znaczenie: zamknięte i spłacone nie mają raty, zapłacona w tym miesiącu
 * wygrywa z najbliższym terminem (który jest już w następnym miesiącu).
 *
 * @param liability - Zobowiązanie ze stanem.
 * @param today - Dzisiejsza data biznesowa.
 * @returns Rodzaj stanu i opis.
 */
export function installmentStatus(liability: LiabilityDto, today: string): InstallmentStatus {
  if (!liability.isActive) return { kind: 'closed', label: 'Zamknięte' };
  if (liability.remainingMinor === 0) {
    return { kind: 'done', label: 'Spłacone — możesz je zamknąć' };
  }
  if (liability.paidThisMonth && liability.lastPaymentOn !== null) {
    const month = inMonth(today);
    return {
      kind: 'paid',
      label: `Zapłacono ${month} (${formatDateShort(liability.lastPaymentOn)})`,
    };
  }
  if (liability.nextDueOn === null) return { kind: 'unknown', label: 'Dzień raty nieznany' };
  return liability.nextDueOn < today
    ? { kind: 'overdue', label: `Rata po terminie — ${formatDateShort(liability.nextDueOn)}` }
    : { kind: 'due', label: `Rata na ${formatDateShort(liability.nextDueOn)}` };
}

/**
 * Czy karta ma pokazać „Zaksięguj": aktywne, niespłacone, bez raty w tym miesiącu.
 *
 * @param status - Stan raty.
 * @returns `true`, gdy ratę można zaksięgować jednym dotknięciem.
 */
export function canPayNow(status: InstallmentStatus): boolean {
  return status.kind === 'due' || status.kind === 'overdue' || status.kind === 'unknown';
}
