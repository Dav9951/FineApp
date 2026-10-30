import type { AllocationTargetDto, AllocationTargetShares } from '@fineapp/shared';

import type { AllocationTargetRow } from '../../db/schema/allocation-targets.js';

/**
 * Mapowanie wiersza wersji rozkładu na DTO — jedyne miejsce, gdzie `snake_case` z bazy
 * spotyka `camelCase` kontraktu (02 §4).
 *
 * @param row - Wiersz `allocation_targets`.
 * @returns DTO wersji rozkładu.
 */
export function toAllocationTargetDto(row: AllocationTargetRow): AllocationTargetDto {
  return {
    id: row.id,
    effectiveFromMonth: row.effectiveFromMonth,
    savingsPercentBps: row.savingsPercentBps,
    investmentPercentBps: row.investmentPercentBps,
    debtPercentBps: row.debtPercentBps,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Udziały wersji rozkładu do porównania z wykonaniem.
 *
 * @param row - Wiersz `allocation_targets`.
 * @returns Udziały i miesiąc początku.
 */
export function toTargetShares(row: AllocationTargetRow): AllocationTargetShares {
  return {
    effectiveFromMonth: row.effectiveFromMonth,
    savingsPercentBps: row.savingsPercentBps,
    investmentPercentBps: row.investmentPercentBps,
    debtPercentBps: row.debtPercentBps,
  };
}
