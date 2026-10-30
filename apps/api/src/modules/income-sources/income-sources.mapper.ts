import type { IncomeSourceDto } from '@fineapp/shared';

import type { IncomeSourceRow } from '../../db/schema/income-sources.js';

/**
 * Mapowanie wierszy źródeł przychodu na DTO — pole po polu, bez `...row`
 * ([02 §8](../../../../../../plans/02-architecture.md)).
 */

/**
 * Zamienia wiersz źródła na DTO.
 *
 * @param row - Wiersz z bazy.
 * @returns Źródło w kształcie kontraktu.
 */
export function toIncomeSourceDto(row: IncomeSourceRow): IncomeSourceDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    ownerUserId: row.ownerUserId,
    countsTowardAllocation: row.countsTowardAllocation,
    isArchived: row.isArchived,
    sortOrder: row.sortOrder,
  };
}
