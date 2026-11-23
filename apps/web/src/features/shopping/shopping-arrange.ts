import {
  sortShoppingItems,
  type ReorderShoppingItemsRequest,
  type ShoppingItemDto,
  type ShoppingSection,
} from '@fineapp/shared';

/**
 * Przeciąganie pozycji listy zakupów — czyste reguły
 * ([06 §3.15](../../../../../plans/06-ui-views.md#315-listy-zakupów--shopping), ADR-104),
 * na wzór układania planera (`budget-arrange.ts`).
 *
 * Lista do kupienia to płaska tablica elementów: wiersze (`i:<id>`) i — w widoku z działami
 * — nagłówki działów (`s:<dział>`). Dział wiersza to ostatni nagłówek nad nim, więc jedno
 * przeciągnięcie przenosi wiersz także między działami.
 */

/**
 * Element wiersza.
 *
 * @param itemId - Pozycja.
 * @returns Identyfikator elementu.
 */
export function itemEntry(itemId: string): string {
  return `i:${itemId}`;
}

/**
 * Element nagłówka działu.
 *
 * @param section - Dział.
 * @returns Identyfikator elementu.
 */
export function sectionEntry(section: ShoppingSection): string {
  return `s:${section}`;
}

/**
 * Czy element to nagłówek działu.
 *
 * @param entry - Element.
 * @returns `true` dla `s:<dział>`.
 */
export function isSectionEntry(entry: string): boolean {
  return entry.startsWith('s:');
}

/**
 * Identyfikator pozycji albo dział z elementu.
 *
 * @param entry - Element.
 * @returns Wartość bez przedrostka.
 */
export function entryValue(entry: string): string {
  return entry.slice(2);
}

/**
 * Pozycje do kupienia w kolejności ekranu.
 *
 * @param items - Pozycje listy.
 * @param bySection - Widok z działami.
 * @returns Do kupienia, posortowane.
 */
export function toBuyItems(
  items: readonly ShoppingItemDto[],
  bySection: boolean,
): ShoppingItemDto[] {
  return sortShoppingItems(
    items.filter((item) => !item.checked),
    { bySection },
  );
}

/**
 * Elementy listy do przeciągania: wiersze, a w widoku z działami — także nagłówki
 * niepustych działów.
 *
 * @param toBuy - Do kupienia w kolejności ekranu.
 * @param bySection - Widok z działami.
 * @returns Płaska lista elementów.
 */
export function arrangeEntries(toBuy: readonly ShoppingItemDto[], bySection: boolean): string[] {
  const entries: string[] = [];
  let section: ShoppingSection | null = null;
  for (const item of toBuy) {
    if (bySection && item.section !== section) {
      section = item.section;
      entries.push(sectionEntry(section));
    }
    entries.push(itemEntry(item.id));
  }
  return entries;
}

/**
 * Elementy po upuszczeniu `active` w miejscu `over`. Wiersz nie może stanąć nad pierwszym
 * nagłówkiem — wtedy ląduje zaraz pod nim. Nagłówków się nie przeciąga.
 *
 * @param entries - Elementy przed upuszczeniem.
 * @param active - Przeciągany element.
 * @param over - Element, nad którym upuszczono.
 * @returns Elementy po upuszczeniu (ta sama tablica, gdy nic się nie zmienia).
 */
export function dropEntry(entries: readonly string[], active: string, over: string): string[] {
  const from = entries.indexOf(active);
  const to = entries.indexOf(over);
  if (from < 0 || to < 0 || from === to || isSectionEntry(active)) return [...entries];
  const next = [...entries];
  next.splice(from, 1);
  next.splice(to, 0, active);
  if (next.length > 1 && isSectionEntry(next[1] ?? '') && next[0] === active) {
    // Nad pierwszym nagłówkiem nie ma działu — wiersz trafia do pierwszego działu.
    next.splice(0, 1);
    next.splice(1, 0, active);
  }
  return next;
}

/**
 * Żądanie zapisu kolejności po upuszczeniu.
 *
 * @param entries - Elementy po upuszczeniu.
 * @param moved - Przeciągnięta pozycja.
 * @returns Kolejność i — gdy wiersz zmienił dział — `move`.
 */
export function reorderRequest(
  entries: readonly string[],
  moved: ShoppingItemDto,
): ReorderShoppingItemsRequest {
  const itemIds: string[] = [];
  let section: ShoppingSection | null = null;
  let movedTo: ShoppingSection | null = null;
  for (const entry of entries) {
    if (isSectionEntry(entry)) {
      section = entryValue(entry) as ShoppingSection;
      continue;
    }
    const id = entryValue(entry);
    itemIds.push(id);
    if (id === moved.id) movedTo = section;
  }
  return movedTo === null || movedTo === moved.section
    ? { itemIds }
    : { itemIds, move: { itemId: moved.id, section: movedTo } };
}
