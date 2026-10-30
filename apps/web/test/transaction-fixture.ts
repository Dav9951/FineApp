import type { TransactionListItemDto } from '@fineapp/shared';

/**
 * Transakcja z nazwami powiązanych bytów — wspólny przykład testów historii.
 *
 * Domyślnie wydatek 45,99 zł z ROR w kategorii „Restauracje", autor „Adam Kowalski".
 *
 * @param overrides - Nadpisane pola.
 * @returns Pozycja listy w kształcie kontraktu.
 */
export function transactionItem(
  overrides: Partial<TransactionListItemDto> = {},
): TransactionListItemDto {
  return {
    id: '01JT0000000000000000000001',
    type: 'expense',
    status: 'posted',
    bookedOn: '2026-09-18',
    monthKey: '2026-09',
    amountMinor: 4_599,
    currency: 'PLN',
    accountId: '01JB0000000000000000000001',
    counterAccountId: null,
    categoryId: '01JC0000000000000000000001',
    incomeSourceId: null,
    liabilityId: null,
    goalId: null,
    sourceAllocationClass: null,
    targetAllocationClass: null,
    allocationOverride: null,
    allocationEffects: [],
    description: null,
    merchant: null,
    notes: null,
    source: 'manual',
    sourceDocumentId: null,
    recurringOccurrenceId: null,
    plannedExpenseId: null,
    createdBy: '01J9ZQK8WQ0000000000000000',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    accountName: 'ROR',
    counterAccountName: null,
    categoryName: 'Restauracje',
    categoryIcon: null,
    categoryColor: null,
    incomeSourceName: null,
    goalName: null,
    liabilityName: null,
    createdByName: 'Adam Kowalski',
    ...overrides,
  };
}
