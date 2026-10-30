import {
  allocationEffects,
  type TransactionDto,
  type TransactionListItemDto,
  type TransactionListSummary,
} from '@fineapp/shared';

import type { TransactionRow } from '../../db/schema/transactions.js';
import type { ListSummaryRow } from './transactions.repository.js';
import type { TransactionListItemRow } from './transactions.types.js';

/**
 * Mapowanie wierszy transakcji na DTO — pole po polu, bez `...row`
 * ([02 §8](../../../../../../plans/02-architecture.md)).
 *
 * `allocationEffects` nie jest kolumną: liczy się z migawek klas i nadpisania przy
 * każdym odczycie, tą samą funkcją co formularz (07 §2.2). Zapisany wynik
 * rozjechałby się z regułą przy pierwszej jej poprawce.
 */

/**
 * Zamienia wiersz transakcji na DTO.
 *
 * @param row - Wiersz z bazy.
 * @returns Transakcja w kształcie kontraktu.
 */
export function toTransactionDto(row: TransactionRow): TransactionDto {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    bookedOn: row.bookedOn,
    monthKey: row.monthKey,
    amountMinor: row.amountMinor,
    currency: row.currency,
    accountId: row.accountId,
    counterAccountId: row.counterAccountId,
    categoryId: row.categoryId,
    incomeSourceId: row.incomeSourceId,
    liabilityId: row.liabilityId,
    goalId: row.goalId,
    sourceAllocationClass: row.sourceAllocationClass,
    targetAllocationClass: row.targetAllocationClass,
    allocationOverride: row.allocationOverride,
    allocationEffects: allocationEffects(row),
    description: row.description,
    merchant: row.merchant,
    notes: row.notes,
    source: row.source,
    sourceDocumentId: row.sourceDocumentId,
    recurringOccurrenceId: row.recurringOccurrenceId,
    plannedExpenseId: row.plannedExpenseId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

/**
 * Zamienia wiersz z nazwami powiązanych bytów na pozycję listy.
 *
 * @param row - Wiersz z bazy wraz z nazwami.
 * @returns Pozycja listy w kształcie kontraktu.
 */
export function toTransactionListItemDto(row: TransactionListItemRow): TransactionListItemDto {
  return {
    ...toTransactionDto(row),
    accountName: row.accountName,
    counterAccountName: row.counterAccountName,
    categoryName: row.categoryName,
    categoryIcon: row.categoryIcon,
    categoryColor: row.categoryColor,
    incomeSourceName: row.incomeSourceName,
    goalName: row.goalName,
    liabilityName: row.liabilityName,
    createdByName: row.createdByName,
  };
}

/**
 * Zamienia podsumowanie listy na DTO (ADR-038).
 *
 * @param row - Wynik zapytań agregujących.
 * @returns Podsumowanie w kształcie kontraktu.
 */
export function toTransactionListSummaryDto(row: ListSummaryRow): TransactionListSummary {
  return {
    count: row.count,
    expenseMinor: row.expenseMinor,
    incomeMinor: row.incomeMinor,
    transferMinor: row.transferMinor,
    days: row.days.map((day) => ({
      bookedOn: day.bookedOn,
      expenseMinor: day.expenseMinor,
      incomeMinor: day.incomeMinor,
    })),
  };
}
