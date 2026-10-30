import type { CategoryDto } from '@fineapp/shared';

import type { CategoryRow } from '../../db/schema/categories.js';

/**
 * Mapowanie wierszy kategorii na DTO — pole po polu, bez `...row`
 * ([02 §8](../../../../../../plans/02-architecture.md)).
 */

/**
 * Zamienia wiersz kategorii na DTO.
 *
 * @param row - Wiersz z bazy.
 * @returns Kategoria w kształcie kontraktu.
 */
export function toCategoryDto(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    icon: row.icon,
    color: row.color,
    aiHints: row.aiHints,
    isSystem: row.isSystem,
    isArchived: row.isArchived,
    sortOrder: row.sortOrder,
  };
}
