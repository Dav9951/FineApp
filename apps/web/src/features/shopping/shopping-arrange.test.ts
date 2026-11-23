import type { ShoppingItemDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  arrangeEntries,
  dropEntry,
  itemEntry,
  reorderRequest,
  sectionEntry,
  toBuyItems,
} from './shopping-arrange.js';

/** Przeciąganie pozycji listy zakupów (06 §3.15, ADR-104). */

/**
 * Pozycja testowa.
 *
 * @param id - Identyfikator.
 * @param section - Dział.
 * @param sortOrder - Kolejność.
 * @param checked - Kupiona.
 * @returns Pozycja.
 */
function item(
  id: string,
  section: ShoppingItemDto['section'],
  sortOrder: number,
  checked = false,
): ShoppingItemDto {
  return {
    id,
    listId: 'L',
    productId: null,
    name: id,
    quantityMilli: null,
    unit: null,
    note: null,
    section,
    sortOrder,
    source: 'manual',
    checked,
    checkedAt: checked ? 1 : null,
    checkedByInitials: null,
    isStaple: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

const ITEMS = [
  item('mleko', 'dairy', 2),
  item('chleb', 'bakery', 0),
  item('jajka', 'dairy', 1),
  item('kupione', 'produce', 3, true),
];

describe('arrangeEntries', () => {
  it('płasko: tylko wiersze wg kolejności, bez kupionych', () => {
    expect(arrangeEntries(toBuyItems(ITEMS, false), false)).toEqual([
      itemEntry('chleb'),
      itemEntry('jajka'),
      itemEntry('mleko'),
    ]);
  });

  it('z działami: nagłówki niepustych działów w stałej kolejności', () => {
    expect(arrangeEntries(toBuyItems(ITEMS, true), true)).toEqual([
      sectionEntry('bakery'),
      itemEntry('chleb'),
      sectionEntry('dairy'),
      itemEntry('jajka'),
      itemEntry('mleko'),
    ]);
  });
});

describe('dropEntry + reorderRequest', () => {
  it('płasko: przestawienie bez zmiany działu', () => {
    const entries = arrangeEntries(toBuyItems(ITEMS, false), false);
    const next = dropEntry(entries, itemEntry('mleko'), itemEntry('chleb'));
    expect(reorderRequest(next, ITEMS[0] as ShoppingItemDto)).toEqual({
      itemIds: ['mleko', 'chleb', 'jajka'],
    });
  });

  it('z działami: upuszczenie w innym dziale zmienia dział', () => {
    const entries = arrangeEntries(toBuyItems(ITEMS, true), true);
    const next = dropEntry(entries, itemEntry('mleko'), itemEntry('chleb'));
    expect(next).toEqual([
      sectionEntry('bakery'),
      itemEntry('mleko'),
      itemEntry('chleb'),
      sectionEntry('dairy'),
      itemEntry('jajka'),
    ]);
    expect(reorderRequest(next, ITEMS[0] as ShoppingItemDto)).toEqual({
      itemIds: ['mleko', 'chleb', 'jajka'],
      move: { itemId: 'mleko', section: 'bakery' },
    });
  });

  it('nad pierwszym nagłówkiem nie da się upuścić; nagłówków się nie przeciąga', () => {
    const entries = arrangeEntries(toBuyItems(ITEMS, true), true);
    expect(dropEntry(entries, itemEntry('jajka'), sectionEntry('bakery'))).toEqual([
      sectionEntry('bakery'),
      itemEntry('jajka'),
      itemEntry('chleb'),
      sectionEntry('dairy'),
      itemEntry('mleko'),
    ]);
    expect(dropEntry(entries, sectionEntry('dairy'), itemEntry('chleb'))).toEqual(entries);
    expect(dropEntry(entries, itemEntry('chleb'), itemEntry('chleb'))).toEqual(entries);
  });
});
