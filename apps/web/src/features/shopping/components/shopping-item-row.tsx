import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  sortableKeyboardCoordinates,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  formatShoppingQuantity,
  SHOPPING_SECTION_LABELS,
  type ShoppingItemDto,
  type ShoppingItemsDto,
  type ShoppingSection,
} from '@fineapp/shared';
import { Check, Circle, GripVertical, MoreHorizontal, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { CSSProperties, ReactNode } from 'react';

import { IconButton, useToast } from '../../../components/ui/index.js';
import { newClientId } from '../../../lib/client-id.js';
import { cn } from '../../../lib/cn.js';
import { qk } from '../../../lib/query-keys.js';
import { useItemChange } from '../hooks/use-shopping.js';
import {
  arrangeEntries,
  dropEntry,
  entryValue,
  isSectionEntry,
  itemEntry,
  reorderRequest,
  toBuyItems,
} from '../shopping-arrange.js';

/**
 * Wiersze listy zakupów (06 §3.15, ADR-104): odhaczenie dotknięciem, kosz z „Cofnij",
 * `⋯` do arkusza i — dla pozycji do kupienia — przytrzymanie i przeciągnięcie.
 */

/**
 * Po upuszczeniu przeglądarka i tak wysyła „click" w przeciągnięty wiersz — ten jeden ma
 * nie odhaczać. Tylko ten wiersz: dotknięcie innego zaraz po przeciągnięciu działa.
 */
let lastDrag: { readonly itemId: string; readonly at: number } | null = null;

/**
 * Zapamiętuje koniec przeciągania wiersza.
 *
 * @param itemId - Przeciągnięta pozycja.
 */
function markDragEnd(itemId: string): void {
  lastDrag = { itemId, at: Date.now() };
}

/** Dodatki wiersza przeciąganego. */
interface DragProps {
  readonly sortable: ReturnType<typeof useSortable>;
}

/**
 * Wiersz pozycji: dotknięcie całego wiersza odhacza, kosz usuwa z „Cofnij", „⋯" otwiera
 * arkusz.
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Pozycja.
 * @param props.archived - Lista w archiwum — wiersz tylko do odczytu.
 * @param props.onEdit - Otwarcie arkusza pozycji.
 * @param props.position - Miejsce wśród do kupienia — „Cofnij" przywraca pozycję w to miejsce.
 * @param props.drag - Stan przeciągania (tylko do kupienia).
 * @returns Element wiersza.
 */
export function ItemRow({
  item,
  archived,
  onEdit,
  position,
  drag,
}: {
  readonly item: ShoppingItemDto;
  readonly archived: boolean;
  readonly onEdit: (item: ShoppingItemDto) => void;
  readonly position?: number;
  readonly drag?: DragProps;
}): ReactNode {
  const change = useItemChange(item.listId);
  const client = useQueryClient();
  const toast = useToast();
  const quantity = formatShoppingQuantity(item);
  const sortable = drag?.sortable;

  const toggle = (): void => {
    if (lastDrag?.itemId === item.id && Date.now() - lastDrag.at < 400) return;
    const checked = !item.checked;
    void change({ kind: 'update', itemId: item.id, body: { checked } }).then((outcome) => {
      if (outcome.rejected) {
        toast.show({ message: 'Nie udało się zapisać — lista się odświeży.' });
      }
    });
    if (checked) {
      toast.show({
        message: `Odhaczono ${item.name}`,
        action: {
          label: 'Cofnij',
          onAction: () => {
            void change({ kind: 'update', itemId: item.id, body: { checked: false } });
          },
        },
      });
    }
  };

  const remove = (): void => {
    void change({ kind: 'delete', itemId: item.id });
    toast.show({
      message: `Usunięto ${item.name}`,
      action: {
        label: 'Cofnij',
        onAction: () => {
          // Dopisanie od nowa (nowy identyfikator) i — dla do kupienia — powrót na miejsce.
          const id = newClientId();
          void change({
            kind: 'add',
            body: {
              id,
              name: item.name,
              quantityMilli: item.quantityMilli,
              unit: item.unit,
              note: item.note,
              section: item.section,
            },
          });
          if (item.checked) {
            // Z „Kupionych" wraca do „Kupionych", nie na listę do kupienia.
            void change({ kind: 'update', itemId: id, body: { checked: true } });
          } else if (position !== undefined) {
            // Kolejność z chwili cofnięcia (nie usunięcia) — przeciągnięcia zrobione
            // w międzyczasie, także na innym telefonie, zostają (ADR-104).
            const current = client.getQueryData<ShoppingItemsDto>(qk.shoppingItems(item.listId));
            const order = toBuyItems(current?.items ?? [], false)
              .map((other) => other.id)
              .filter((other) => other !== id);
            order.splice(Math.min(position, order.length), 0, id);
            if (order.length > 1) void change({ kind: 'reorder', body: { itemIds: order } });
          }
        },
      },
    });
  };

  return (
    <div
      className={cn(
        'flex items-stretch border-t border-border bg-background first:border-t-0',
        sortable?.isDragging === true && 'relative z-10 rounded-md shadow-sheet',
      )}
      ref={sortable?.setNodeRef}
      style={sortable === undefined ? undefined : dragStyle(sortable)}
    >
      <button
        aria-checked={item.checked}
        className={cn(
          'flex min-h-touch min-w-0 flex-1 items-center gap-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted disabled:opacity-60',
          // Przytrzymanie podnosi wiersz — bez systemowego menu i zaznaczania tekstu.
          sortable !== undefined && 'select-none [-webkit-touch-callout:none]',
        )}
        disabled={archived}
        onClick={toggle}
        onContextMenu={
          sortable === undefined
            ? undefined
            : (event) => {
                event.preventDefault();
              }
        }
        role="checkbox"
        type="button"
        {...(sortable === undefined ? {} : pointerListeners(sortable))}
      >
        {item.checked ? (
          <Check aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" strokeWidth={2} />
        ) : (
          <Circle
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-muted-foreground"
            strokeWidth={1.5}
          />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              'truncate text-base',
              item.checked && 'text-muted-foreground line-through',
            )}
          >
            {item.name}
          </span>
          {item.note === null ? null : (
            <span className="truncate text-caption text-muted-foreground">{item.note}</span>
          )}
        </span>
        {quantity === '' ? null : (
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{quantity}</span>
        )}
        {item.checked && item.checkedByInitials !== null ? (
          <span
            aria-label={`odhaczył(a) ${item.checkedByInitials}`}
            className="shrink-0 rounded-full bg-muted px-2 text-caption"
          >
            {item.checkedByInitials}
          </span>
        ) : null}
      </button>
      {sortable === undefined ? null : (
        // Gest nigdy nie jest jedyną drogą: klawiatura przesuwa wiersz tym przyciskiem.
        <button
          aria-label={`Przesuń: ${item.name}`}
          className="sr-only focus-visible:not-sr-only focus-visible:grid focus-visible:h-touch focus-visible:w-touch focus-visible:shrink-0 focus-visible:place-items-center focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={archived}
          ref={sortable.setActivatorNodeRef}
          type="button"
          {...sortable.attributes}
          {...keyboardListeners(sortable)}
        >
          <GripVertical aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </button>
      )}
      <IconButton disabled={archived} label={`Usuń: ${item.name}`} onClick={remove} variant="link">
        <Trash2 aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
      </IconButton>
      <IconButton
        disabled={archived}
        label={`Szczegóły: ${item.name}`}
        onClick={() => {
          onEdit(item);
        }}
        variant="link"
      >
        <MoreHorizontal aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}

/**
 * Słuchacze wskaźnika (dotyk, mysz) — na całym wierszu.
 *
 * @param sortable - Stan elementu z dnd-kit.
 * @returns Słuchacze bez klawiatury.
 */
function pointerListeners(sortable: ReturnType<typeof useSortable>): Record<string, unknown> {
  const { onKeyDown: _keyDown, ...rest } = (sortable.listeners ?? {}) as Record<string, unknown>;
  return rest;
}

/**
 * Słuchacze klawiatury — tylko na przycisku „Przesuń".
 *
 * @param sortable - Stan elementu z dnd-kit.
 * @returns Słuchacz klawiatury.
 */
function keyboardListeners(sortable: ReturnType<typeof useSortable>): Record<string, unknown> {
  const listeners = (sortable.listeners ?? {}) as Record<string, unknown>;
  return listeners.onKeyDown === undefined ? {} : { onKeyDown: listeners.onKeyDown };
}

/**
 * Styl przesunięcia elementu w trakcie przeciągania.
 *
 * @param sortable - Stan elementu z dnd-kit.
 * @returns Styl CSS.
 */
function dragStyle(sortable: ReturnType<typeof useSortable>): CSSProperties {
  return {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };
}

/**
 * Wiersz do kupienia z przeciąganiem.
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Pozycja.
 * @param props.archived - Lista w archiwum.
 * @param props.onEdit - Otwarcie arkusza.
 * @param props.position - Miejsce wśród do kupienia.
 * @returns Element wiersza.
 */
function SortableItemRow({
  item,
  archived,
  onEdit,
  position,
}: {
  readonly item: ShoppingItemDto;
  readonly archived: boolean;
  readonly onEdit: (item: ShoppingItemDto) => void;
  readonly position: number;
}): ReactNode {
  const sortable = useSortable({ id: itemEntry(item.id), disabled: archived });
  return (
    <ItemRow
      archived={archived}
      drag={{ sortable }}
      item={item}
      onEdit={onEdit}
      position={position}
    />
  );
}

/**
 * Nagłówek działu w widoku z działami — element listy przeciągania (nie da się go
 * podnieść, ale wiersz upuszczony pod nim trafia do tego działu).
 *
 * @param props - Właściwości komponentu.
 * @param props.section - Dział.
 * @param props.first - Pierwszy na ekranie (bez linii nad).
 * @returns Element nagłówka.
 */
function SectionHeading({
  section,
  first,
}: {
  readonly section: ShoppingSection;
  readonly first: boolean;
}): ReactNode {
  const sortable = useSortable({ id: `s:${section}`, disabled: true });
  return (
    <h2
      className={cn(
        'mb-3 pt-6 text-caption font-medium uppercase tracking-[.1em] text-muted-foreground',
        first ? '' : 'mt-6 border-t border-border',
      )}
      ref={sortable.setNodeRef}
      style={dragStyle(sortable)}
    >
      {SHOPPING_SECTION_LABELS[section]}
    </h2>
  );
}

/** Instrukcja dla czytnika ekranu przy przycisku „Przesuń". */
const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    'Spacja podnosi pozycję, strzałki w górę i w dół ją przesuwają, spacja odkłada, Escape anuluje.',
};

/**
 * Pozycje do kupienia: płasko albo z nagłówkami działów, z przeciąganiem (ADR-104).
 *
 * @param props - Właściwości komponentu.
 * @param props.listId - Lista.
 * @param props.toBuy - Do kupienia w kolejności ekranu.
 * @param props.bySection - Widok z działami.
 * @param props.archived - Lista w archiwum.
 * @param props.onEdit - Otwarcie arkusza.
 * @returns Element listy.
 */
export function ToBuyList({
  listId,
  toBuy,
  bySection,
  archived,
  onEdit,
}: {
  readonly listId: string;
  readonly toBuy: readonly ShoppingItemDto[];
  readonly bySection: boolean;
  readonly archived: boolean;
  readonly onEdit: (item: ShoppingItemDto) => void;
}): ReactNode {
  const change = useItemChange(listId);
  const toast = useToast();
  const announce = announcements(toBuy);
  const entries = arrangeEntries(toBuy, bySection);
  const byId = new Map(toBuy.map((item) => [item.id, item]));
  const flatOrder = toBuyItems(toBuy, false).map((item) => item.id);
  const sensors = useSensors(
    // Mysz: przesunięcie o kilka pikseli; dotyk: przytrzymanie — krótkie dotknięcie
    // dalej odhacza, a przewijanie palcem działa.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    markDragEnd(entryValue(String(active.id)));
    if (over === null) return;
    const moved = byId.get(entryValue(String(active.id)));
    if (moved === undefined) return;
    const next = dropEntry(entries, String(active.id), String(over.id));
    if (next.join('|') === entries.join('|')) return;
    void change({ kind: 'reorder', body: reorderRequest(next, moved) }).then((outcome) => {
      if (outcome.rejected) toast.show({ message: 'Nie zapisano kolejności.' });
    });
  };

  let firstHeading = true;
  return (
    <DndContext
      accessibility={{
        announcements: announce,
        screenReaderInstructions: SCREEN_READER_INSTRUCTIONS,
      }}
      collisionDetection={closestCenter}
      onDragCancel={({ active }) => {
        markDragEnd(entryValue(String(active.id)));
      }}
      onDragEnd={onDragEnd}
      sensors={sensors}
    >
      <SortableContext items={entries} strategy={verticalListSortingStrategy}>
        <ul className={bySection ? '' : 'pt-6'}>
          {entries.map((entry) => {
            if (isSectionEntry(entry)) {
              const heading = (
                <li key={entry}>
                  <SectionHeading
                    first={firstHeading}
                    section={entryValue(entry) as ShoppingSection}
                  />
                </li>
              );
              firstHeading = false;
              return heading;
            }
            const item = byId.get(entryValue(entry));
            if (item === undefined) return null;
            return (
              <li key={entry}>
                <SortableItemRow
                  archived={archived}
                  item={item}
                  onEdit={onEdit}
                  position={flatOrder.indexOf(item.id)}
                />
              </li>
            );
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

/**
 * Komunikaty dla czytnika ekranu przy przeciąganiu.
 *
 * @param toBuy - Pozycje (nazwy).
 * @returns Komunikaty dnd-kit.
 */
function announcements(toBuy: readonly ShoppingItemDto[]): Announcements {
  const names = new Map(toBuy.map((item) => [itemEntry(item.id), item.name]));
  const label = (id: string): string =>
    isSectionEntry(id)
      ? `dział ${SHOPPING_SECTION_LABELS[entryValue(id) as ShoppingSection]}`
      : (names.get(id) ?? 'pozycja');
  return {
    onDragStart: ({ active }) => `Podniesiono: ${label(String(active.id))}.`,
    onDragOver: ({ active, over }) =>
      over === null
        ? `${label(String(active.id))} poza listą.`
        : `${label(String(active.id))} przy: ${label(String(over.id))}.`,
    onDragEnd: ({ active, over }) =>
      over === null
        ? `Odłożono: ${label(String(active.id))}, bez zmiany.`
        : `Odłożono: ${label(String(active.id))} przy: ${label(String(over.id))}.`,
    onDragCancel: ({ active }) => `Anulowano przenoszenie: ${label(String(active.id))}.`,
  };
}
