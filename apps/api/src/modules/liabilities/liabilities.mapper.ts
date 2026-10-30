import type { LiabilityDto, LiabilityState } from '@fineapp/shared';

import type { LiabilityRow } from '../../db/schema/liabilities.js';

/**
 * Mapowanie wierszy zobowiązań na DTO — pole po polu, bez `...row` (02 §8).
 */

/**
 * Zamienia wiersz zobowiązania na DTO ze stanem.
 *
 * Stan nie jest kolumną: wynika z punktu odniesienia i rat w księdze, więc liczy go serwis
 * przy każdym odczycie (`liabilityState`, 07 §5.1).
 *
 * @param row - Wiersz z bazy.
 * @param state - Wyliczony stan.
 * @param paidThisMonth - Czy w bieżącym miesiącu jest rata.
 * @param lastPaymentOn - Data ostatniej raty albo `null`.
 * @returns Zobowiązanie w kształcie kontraktu.
 */
export function toLiabilityDto(
  row: LiabilityRow,
  state: LiabilityState,
  paidThisMonth: boolean,
  lastPaymentOn: string | null,
): LiabilityDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    creditor: row.creditor,
    currency: row.currency,
    openingBalanceMinor: row.openingBalanceMinor,
    balanceAsOf: row.balanceAsOf,
    remainingMinor: state.remainingMinor,
    paidSoFarMinor: state.paidSoFarMinor,
    monthlyPaymentMinor: row.monthlyPaymentMinor,
    installmentsTotal: row.installmentsTotal,
    installmentsRemainingAtAsOf: row.installmentsRemainingAtAsOf,
    installmentsRemaining: state.installmentsRemaining,
    nextDueOn: state.nextDueOn,
    projectedFinalPaymentOn: state.projectedFinalPaymentOn,
    interestRateBps: row.interestRateBps,
    paymentDay: row.paymentDay,
    firstPaymentOn: row.firstPaymentOn,
    paymentAccountId: row.paymentAccountId,
    categoryId: row.categoryId,
    recurringRuleId: row.recurringRuleId,
    progressBps: state.progressBps,
    paidThisMonth,
    lastPaymentOn,
    isActive: row.isActive,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
