import type { AccountDto } from '@fineapp/shared';

import type { AccountRow } from '../../db/schema/accounts.js';

/**
 * Mapowanie wierszy kont na DTO.
 *
 * Wiersz przepisujemy **pole po polu**, nigdy rozrzuceniem `...row`: rozrzucenie
 * przepuściłoby `householdId` i każdą kolumnę dodaną w przyszłości
 * ([02 §8](../../../../../../plans/02-architecture.md)).
 */

/**
 * Zamienia wiersz konta na DTO.
 *
 * @param row - Wiersz z bazy.
 * @returns Konto w kształcie kontraktu.
 */
export function toAccountDto(row: AccountRow): AccountDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    allocationClass: row.allocationClass,
    currency: row.currency,
    openingBalanceMinor: row.openingBalanceMinor,
    openingBalanceOn: row.openingBalanceOn,
    institution: row.institution,
    color: row.color,
    icon: row.icon,
    includeInNetWorth: row.includeInNetWorth,
    sortOrder: row.sortOrder,
    isArchived: row.isArchived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
