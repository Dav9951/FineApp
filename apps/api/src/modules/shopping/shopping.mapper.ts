import type { ShoppingItemDto, ShoppingListDto, ShoppingProductDto } from '@fineapp/shared';

import type {
  ShoppingItemRow,
  ShoppingListRow,
  ShoppingProductRow,
} from '../../db/schema/shopping.js';

/**
 * Mapowanie wierszy list zakupów na DTO (05 §13c) — wyłącznie tutaj kolumny bazy
 * przechodzą w pola kontraktu.
 */

/** Pola listy wyliczane przy odczycie. */
export interface ListExtras {
  readonly toBuyCount: number;
  readonly checkedCount: number;
  readonly lastActivityBy: string | null;
  readonly pendingImports: ShoppingListDto['pendingImports'];
}

/**
 * Lista w kształcie kontraktu.
 *
 * @param row - Wiersz `shopping_lists`.
 * @param extras - Liczniki i pola wyliczane.
 * @returns DTO listy.
 */
export function toShoppingListDto(row: ShoppingListRow, extras: ListExtras): ShoppingListDto {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    archived: row.archivedAt !== null,
    sortOrder: row.sortOrder,
    toBuyCount: extras.toBuyCount,
    checkedCount: extras.checkedCount,
    lastActivityAt: row.updatedAt,
    lastActivityBy: extras.lastActivityBy,
    pendingImports: extras.pendingImports,
  };
}

/** Słowniki potrzebne do pól wyliczanych pozycji. */
export interface ItemMappingContext {
  /** Inicjały domowników po identyfikatorze. */
  readonly initials: ReadonlyMap<string, string>;
  /** Produkty z flagą „zawsze w domu". */
  readonly stapleProductIds: ReadonlySet<string>;
}

/**
 * Pozycja w kształcie kontraktu.
 *
 * @param row - Wiersz `shopping_items`.
 * @param context - Inicjały i produkty „zawsze w domu".
 * @returns DTO pozycji.
 */
export function toShoppingItemDto(
  row: ShoppingItemRow,
  context: ItemMappingContext,
): ShoppingItemDto {
  return {
    id: row.id,
    listId: row.listId,
    productId: row.productId,
    name: row.name,
    quantityMilli: row.quantityMilli,
    unit: row.unit,
    note: row.note,
    section: row.section,
    source: row.source,
    checked: row.checkedAt !== null,
    checkedAt: row.checkedAt,
    checkedByInitials:
      row.checkedAt === null || row.checkedBy === null
        ? null
        : (context.initials.get(row.checkedBy) ?? null),
    isStaple: row.productId !== null && context.stapleProductIds.has(row.productId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Produkt w kształcie kontraktu.
 *
 * @param row - Wiersz `shopping_products`.
 * @returns DTO produktu.
 */
export function toShoppingProductDto(row: ShoppingProductRow): ShoppingProductDto {
  return {
    id: row.id,
    name: row.name,
    section: row.section,
    isStaple: row.isStaple,
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt,
  };
}

/**
 * Inicjały z imienia domownika: pierwsze litery dwóch pierwszych słów („Adam Kowalski" →
 * „AK", „Ania" → „A").
 *
 * @param displayName - Imię wyświetlane.
 * @returns Inicjały wielkimi literami.
 */
export function initialsOf(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase('pl'))
    .join('');
}
