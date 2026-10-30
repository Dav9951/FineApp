import type { BudgetSection, UpdateBudgetLayoutRequest } from '@fineapp/shared';

import type { BudgetSectionView } from './budget-view.js';

/**
 * Układanie sekcji szkicu — czyste reguły trybu „Układaj"
 * ([06 §3.14](../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth),
 * [07 §13.10](../../../../../plans/07-domain-rules.md#1310-układ-szkicu-grupy-i-kolejność),
 * ADR-081).
 *
 * Sekcja to płaska lista elementów: nagłówki grup (`g:<id>`), wiersze (`l:<id>`)
 * i nagłówek „Bez grupy" (`none`, tylko gdy sekcja ma grupy). Grupa wiersza to ostatni
 * nagłówek nad nim — dzięki temu jedno przeciągnięcie na płaskiej liście przenosi wiersz
 * także między grupami. Biblioteka przeciągania zna tylko tę listę; tutaj zamienia się
 * ją z powrotem w układ do zapisu.
 */

/** Element nagłówka „Bez grupy". */
export const NO_GROUP_ITEM = 'none';

/**
 * Element nagłówka grupy.
 *
 * @param groupId - Grupa.
 * @returns Identyfikator elementu.
 */
export function groupItem(groupId: string): string {
  return `g:${groupId}`;
}

/**
 * Element wiersza linii.
 *
 * @param lineId - Linia.
 * @returns Identyfikator elementu.
 */
export function lineItem(lineId: string): string {
  return `l:${lineId}`;
}

/**
 * Czy element jest nagłówkiem grupy (nie „Bez grupy").
 *
 * @param item - Element.
 * @returns `true` dla `g:<id>`.
 */
export function isGroupItem(item: string): boolean {
  return item.startsWith('g:');
}

/**
 * Identyfikator grupy albo linii z elementu.
 *
 * @param item - Element `g:<id>` albo `l:<id>`.
 * @returns Identyfikator bez przedrostka.
 */
export function itemId(item: string): string {
  return item.slice(2);
}

/**
 * Płaska lista elementów sekcji w kolejności ekranu.
 *
 * @param section - Sekcja z grupami.
 * @returns Elementy: bez grup same wiersze; z grupami nagłówki, wiersze i „Bez grupy".
 */
export function arrangeItems(section: BudgetSectionView): string[] {
  if (section.groups.length === 0) return section.lines.map((line) => lineItem(line.id));
  return section.groups.flatMap((view) => [
    view.group === null ? NO_GROUP_ITEM : groupItem(view.group.id),
    ...view.lines.map((line) => lineItem(line.id)),
  ]);
}

/** Nagłówek z wierszami pod nim. */
interface Block {
  readonly head: string | null;
  readonly rows: string[];
}

/**
 * Dzieli listę na bloki: wiersze przed pierwszym nagłówkiem, potem nagłówek z wierszami.
 *
 * @param items - Elementy.
 * @returns Bloki w kolejności.
 */
function blocksOf(items: readonly string[]): Block[] {
  const blocks: Block[] = [{ head: null, rows: [] }];
  for (const item of items) {
    if (item === NO_GROUP_ITEM || isGroupItem(item)) blocks.push({ head: item, rows: [] });
    else blocks.at(-1)?.rows.push(item);
  }
  return blocks;
}

/**
 * Lista z bloków. Wiersze sprzed pierwszego nagłówka trafiają do pierwszej grupy — gdy
 * sekcja ma grupy, każdy wiersz stoi pod jakimś nagłówkiem.
 *
 * @param blocks - Bloki.
 * @returns Elementy.
 */
function itemsOf(blocks: readonly Block[]): string[] {
  const [loose, ...headed] = blocks;
  if (headed.length === 0) return [...(loose?.rows ?? [])];
  return headed.flatMap((block, index) => [
    block.head ?? NO_GROUP_ITEM,
    ...(index === 0 ? (loose?.rows ?? []) : []),
    ...block.rows,
  ]);
}

/**
 * Przesuwa element tablicy z jednego miejsca na drugie (jak `arrayMove` z dnd-kit).
 *
 * @param items - Elementy.
 * @param from - Indeks źródłowy.
 * @param to - Indeks docelowy.
 * @returns Nowa tablica.
 */
function moved(items: readonly string[], from: number, to: number): string[] {
  const result = [...items];
  const [item] = result.splice(from, 1);
  if (item !== undefined) result.splice(to, 0, item);
  return result;
}

/**
 * Układ grup w nowej kolejności — każda grupa jedzie ze swoimi wierszami, „Bez grupy"
 * zostaje na końcu.
 *
 * @param items - Pełna lista elementów.
 * @param order - Nagłówki grup w nowej kolejności.
 * @returns Pełna lista elementów.
 */
function withGroupOrder(items: readonly string[], order: readonly string[]): string[] {
  const blocks = blocksOf(items);
  const byHead = new Map(blocks.map((block) => [block.head, block]));
  const ordered = [
    blocks[0] ?? { head: null, rows: [] },
    ...order.flatMap((head) => {
      const block = byHead.get(head);
      return block === undefined ? [] : [block];
    }),
    ...blocks.filter((block) => block.head === NO_GROUP_ITEM),
  ];
  return itemsOf(ordered);
}

/**
 * Wynik upuszczenia elementu na liście widocznej (06 §3.14).
 *
 * Nagłówek grupy zmienia tylko kolejność grup — grupa jedzie razem z wierszami. Wiersz
 * ląduje tam, gdzie go upuszczono, a jego grupą staje się nagłówek nad nim. Wiersze grup
 * zwiniętych (niewidoczne) zostają pod swoimi nagłówkami.
 *
 * @param items - Pełna lista elementów sekcji.
 * @param visible - Elementy na ekranie (bez wierszy grup zwiniętych), w tej samej kolejności.
 * @param active - Przeciągany element.
 * @param over - Element, nad którym go upuszczono.
 * @returns Pełna lista po zmianie (ta sama, gdy nic się nie zmieniło).
 */
export function dropArrangeItem(
  items: readonly string[],
  visible: readonly string[],
  active: string,
  over: string,
): string[] {
  const from = visible.indexOf(active);
  const to = visible.indexOf(over);
  if (active === over || from < 0 || to < 0 || active === NO_GROUP_ITEM) return [...items];
  const next = moved(visible, from, to);
  if (isGroupItem(active)) return withGroupOrder(items, next.filter(isGroupItem));
  const shown = new Set(visible);
  const hidden = new Map(
    blocksOf(items).map((block) => [block.head, block.rows.filter((row) => !shown.has(row))]),
  );
  const expanded = next.flatMap((item) =>
    item === NO_GROUP_ITEM || isGroupItem(item) ? [item, ...(hidden.get(item) ?? [])] : [item],
  );
  return itemsOf(blocksOf(expanded));
}

/**
 * Przesuwa grupę o jedno miejsce — „Przesuń wyżej / niżej" w arkuszu grupy.
 *
 * @param items - Pełna lista elementów sekcji.
 * @param groupId - Grupa.
 * @param delta - `-1` wyżej, `1` niżej.
 * @returns Pełna lista po zmianie (ta sama na brzegu).
 */
export function moveGroupBy(items: readonly string[], groupId: string, delta: -1 | 1): string[] {
  const order = items.filter(isGroupItem);
  const from = order.indexOf(groupItem(groupId));
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return [...items];
  return withGroupOrder(items, moved(order, from, to));
}

/**
 * Żądanie zapisu układu z listy elementów (`PATCH …/layout`).
 *
 * @param section - Sekcja.
 * @param items - Pełna lista elementów sekcji.
 * @returns Układ: grupy z wierszami i wiersze bez grupy.
 */
export function layoutRequest(
  section: BudgetSection,
  items: readonly string[],
): UpdateBudgetLayoutRequest {
  const groups: { id: string; lineIds: string[] }[] = [];
  const ungroupedLineIds: string[] = [];
  let current: { id: string; lineIds: string[] } | null = null;
  for (const item of items) {
    if (isGroupItem(item)) {
      current = { id: itemId(item), lineIds: [] };
      groups.push(current);
    } else if (item === NO_GROUP_ITEM) {
      current = null;
    } else if (current === null) {
      ungroupedLineIds.push(itemId(item));
    } else {
      current.lineIds.push(itemId(item));
    }
  }
  return { section, groups, ungroupedLineIds };
}
