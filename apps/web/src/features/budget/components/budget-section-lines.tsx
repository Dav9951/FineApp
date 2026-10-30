import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
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
  groupsByOrigin,
  type BudgetActualsDto,
  type BudgetGroupDto,
  type BudgetLineDto,
  type MonthKey,
} from '@fineapp/shared';
import { ChevronDown, FolderPlus, GripVertical, MoreHorizontal } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { Button, IconButton, Money, useToast } from '../../../components/ui/index.js';
import { cn } from '../../../lib/cn.js';
import {
  arrangeItems,
  dropArrangeItem,
  groupItem,
  isGroupItem,
  itemId,
  layoutRequest,
  lineItem,
  NO_GROUP_ITEM,
} from '../budget-arrange.js';
import {
  groupProgress,
  progressText,
  type BudgetGroupView,
  type BudgetSectionView,
  type LineProgress,
} from '../budget-view.js';
import { useBudgetGroupChange } from '../hooks/use-budget.js';
import { BudgetLineRow } from './budget-line-row.js';

/**
 * Linie jednej sekcji szkicu z grupami i trybem „Układaj"
 * ([06 §3.14](../../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth),
 * ADR-081, makieta `design/mockups/budget-layout.html`).
 *
 * Przeciąganie (dnd-kit) działa w trybie układania, a na desktopie — także po najechaniu
 * na wiersz. Uchwyt jest przyciskiem: spacja podnosi, strzałki przesuwają, spacja odkłada
 * — gest nie jest jedyną drogą (15 §2), a pole „Grupa" w arkuszu linii robi to samo bez
 * przeciągania. Zapis po upuszczeniu; błąd przywraca układ z serwera.
 */

/** Klucz zwiniętych grup w `localStorage` — sekcja i nazwa, więc działa też w kolejnych miesiącach. */
const COLLAPSED_STORAGE_KEY = 'fineapp.budget.collapsedGroups';

/** Słuchacze zmiany zwiniętych grup (wspólny stan wszystkich sekcji ekranu). */
const collapsedListeners = new Set<() => void>();

/**
 * Zwinięte grupy z pamięci urządzenia. Pamięć bywa niedostępna (tryb prywatny) —
 * wtedy wszystko rozwinięte.
 *
 * @returns Zapis zwiniętych grup (JSON) albo pusty napis.
 */
function readCollapsed(): string {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Klucz zwinięcia grupy.
 *
 * @param group - Grupa.
 * @returns `sekcja:nazwa` małymi literami.
 */
function collapseKey(group: BudgetGroupDto): string {
  return `${group.section}:${group.name.trim().toLocaleLowerCase('pl')}`;
}

/** Stan zwinięcia grup. */
interface CollapsedGroups {
  readonly isCollapsed: (group: BudgetGroupDto) => boolean;
  readonly toggle: (group: BudgetGroupDto) => void;
}

/**
 * Zwinięte grupy, zapamiętane na urządzeniu (06 §3.14).
 *
 * @returns Odczyt i przełącznik.
 */
function useCollapsedGroups(): CollapsedGroups {
  const raw = useSyncExternalStore(
    (listener) => {
      collapsedListeners.add(listener);
      return () => collapsedListeners.delete(listener);
    },
    readCollapsed,
    () => '',
  );
  const keys = useMemo(() => {
    try {
      const parsed: unknown = raw === '' ? [] : JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : []);
    } catch {
      return new Set<string>();
    }
  }, [raw]);
  return {
    isCollapsed: (group) => keys.has(collapseKey(group)),
    toggle: (group) => {
      const next = new Set(keys);
      const key = collapseKey(group);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Bez pamięci zwinięcie nie przetrwa przeładowania — ekran działa dalej.
      }
      for (const listener of collapsedListeners) listener();
    },
  };
}

/** Wskaźnik precyzyjny z najechaniem — mysz albo gładzik (desktop). */
const FINE_POINTER = '(hover: hover) and (pointer: fine)';

/**
 * Czy urządzenie ma wskaźnik precyzyjny — wtedy uchwyt pojawia się po najechaniu.
 *
 * @returns `true` na desktopie z myszą.
 */
function useFinePointer(): boolean {
  return useSyncExternalStore(
    (listener) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const media = window.matchMedia(FINE_POINTER);
      media.addEventListener('change', listener);
      return () => {
        media.removeEventListener('change', listener);
      };
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(FINE_POINTER).matches,
    () => false,
  );
}

/**
 * Komunikaty dla czytnika ekranu w trakcie przeciągania — po polsku.
 *
 * @param label - Nazwa elementu po identyfikatorze.
 * @returns Komunikaty dnd-kit.
 */
function announcementsFor(label: (id: string) => string): Announcements {
  return {
    onDragStart: ({ active }) => `Podniesiono: ${label(String(active.id))}.`,
    onDragOver: ({ active, over }) =>
      over === null
        ? `${label(String(active.id))} poza listą.`
        : `${label(String(active.id))} nad: ${label(String(over.id))}.`,
    onDragEnd: ({ active, over }) =>
      over === null
        ? `Odłożono: ${label(String(active.id))}, bez zmiany.`
        : `Odłożono: ${label(String(active.id))} przy: ${label(String(over.id))}.`,
    onDragCancel: ({ active }) => `Anulowano przenoszenie: ${label(String(active.id))}.`,
  };
}

/** Instrukcja dla czytnika ekranu przy uchwycie. */
const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    'Spacja podnosi pozycję, strzałki w górę i w dół ją przesuwają, spacja odkłada, Escape anuluje.',
};

/** Właściwości uchwytu. */
interface HandleProps {
  readonly label: string;
  readonly sortable: ReturnType<typeof useSortable>;
  /** Uchwyt widoczny dopiero po najechaniu (desktop poza trybem). */
  readonly onHover: boolean;
}

/**
 * Uchwyt przeciągania 44 × 44 px.
 *
 * @param props - Właściwości komponentu.
 * @param props.label - Opis dla czytnika ekranu.
 * @param props.sortable - Stan elementu z dnd-kit.
 * @param props.onHover - Widoczny po najechaniu.
 * @returns Przycisk uchwytu.
 */
function Handle({ label, sortable, onHover }: HandleProps): ReactNode {
  return (
    <button
      aria-label={label}
      className={cn(
        'grid h-touch w-touch shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        sortable.isDragging ? 'cursor-grabbing text-primary' : '',
        onHover
          ? 'opacity-0 focus-visible:opacity-100 group-hover/head:opacity-100 group-hover/row:opacity-100'
          : '',
      )}
      ref={sortable.setActivatorNodeRef}
      type="button"
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <GripVertical aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
    </button>
  );
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

/** Wspólne właściwości wierszy sekcji. */
interface RowHandlers {
  readonly busy: boolean;
  readonly onOpen?: ((line: BudgetLineDto) => void) | undefined;
  readonly onAcceptSource?: ((line: BudgetLineDto) => void) | undefined;
  readonly onDetach?: ((line: BudgetLineDto) => void) | undefined;
}

/** Właściwości wiersza do przeciągania. */
interface SortableLineProps extends RowHandlers {
  readonly line: BudgetLineDto;
  readonly first: boolean;
  readonly progress: LineProgress | undefined;
  readonly arranging: boolean;
}

/**
 * Wiersz linii z uchwytem.
 *
 * @param props - Właściwości komponentu.
 * @param props.line - Linia.
 * @param props.first - Pierwszy w liście.
 * @param props.progress - Wykonanie.
 * @param props.arranging - Tryb układania (dotknięcie nic nie otwiera).
 * @param props.busy - Akcja w toku.
 * @param props.onOpen - Dotknięcie wiersza.
 * @param props.onAcceptSource - „Przyjmij".
 * @param props.onDetach - „Zostaw jako własną".
 * @returns Element wiersza.
 */
function SortableLine({
  line,
  first,
  progress,
  arranging,
  busy,
  onOpen,
  onAcceptSource,
  onDetach,
}: SortableLineProps): ReactNode {
  const sortable = useSortable({ id: lineItem(line.id) });
  return (
    <BudgetLineRow
      busy={busy}
      containerRef={sortable.setNodeRef}
      dragging={sortable.isDragging}
      first={first}
      handle={<Handle label={`Przesuń: ${line.name}`} onHover={!arranging} sortable={sortable} />}
      line={line}
      progress={arranging ? undefined : progress}
      style={dragStyle(sortable)}
      {...(arranging ? {} : { onAcceptSource, onDetach, onOpen })}
    />
  );
}

/** Właściwości nagłówka grupy. */
interface GroupHeaderProps {
  readonly view: BudgetGroupView;
  readonly collapsed: boolean;
  readonly arranging: boolean;
  readonly progress: LineProgress | null;
  readonly onToggle?: (() => void) | undefined;
  readonly onEdit?: (() => void) | undefined;
  readonly sortable?: ReturnType<typeof useSortable> | undefined;
  readonly first: boolean;
}

/**
 * Nagłówek grupy: nazwa, liczba pozycji, suma planu; poza trybem — zwijanie, w trybie —
 * „⋯" i uchwyt. „Bez grupy" bez liczby i bez akcji.
 *
 * @param props - Właściwości komponentu.
 * @param props.view - Grupa z liniami.
 * @param props.collapsed - Zwinięta.
 * @param props.arranging - Tryb układania.
 * @param props.progress - Wykonanie grupy.
 * @param props.onToggle - Zwinięcie / rozwinięcie.
 * @param props.onEdit - Arkusz grupy.
 * @param props.sortable - Stan elementu z dnd-kit (gdy przeciąganie włączone).
 * @param props.first - Pierwszy element sekcji.
 * @returns Element nagłówka.
 */
function GroupHeader({
  view,
  collapsed,
  arranging,
  progress,
  onToggle,
  onEdit,
  sortable,
  first,
}: GroupHeaderProps): ReactNode {
  const name = view.group?.name ?? 'Bez grupy';
  const title = (
    <>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-left text-sm',
          view.group === null ? 'text-muted-foreground' : 'font-semibold',
        )}
      >
        {name}
        {view.group === null ? null : (
          <span className="ml-1 text-caption font-normal text-muted-foreground">
            · {view.lines.length}
          </span>
        )}
      </span>
      <Money amountMinor={view.totalMinor} size="sm" unit={false} />
    </>
  );
  const text = progress === null ? null : progressText(progress);
  return (
    <li
      className={cn(
        'group/head relative',
        first ? '' : 'mt-3',
        sortable?.isDragging === true ? 'z-10 rounded-md bg-card shadow-sheet' : '',
      )}
      ref={sortable?.setNodeRef}
      style={sortable === undefined ? undefined : dragStyle(sortable)}
    >
      <div className="flex min-h-touch items-center gap-2">
        {onToggle !== undefined && !arranging ? (
          <button
            aria-expanded={!collapsed}
            className="-ml-2 flex min-h-touch min-w-0 flex-1 items-center gap-2 rounded-md pl-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onToggle}
            type="button"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
                collapsed ? '-rotate-90' : '',
              )}
              strokeWidth={1.5}
            />
            {title}
          </button>
        ) : (
          <span className="flex min-h-touch min-w-0 flex-1 items-center gap-2">{title}</span>
        )}
        {arranging && onEdit !== undefined ? (
          <IconButton label={`Opcje grupy ${name}`} onClick={onEdit}>
            <MoreHorizontal aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          </IconButton>
        ) : null}
        {sortable !== undefined && view.group !== null ? (
          <Handle label={`Przesuń grupę: ${name}`} onHover={!arranging} sortable={sortable} />
        ) : null}
        {/* „Bez grupy" nie ma uchwytu — odstęp trzyma sumę w kolumnie kwot wierszy. */}
        {sortable !== undefined && view.group === null ? (
          <span aria-hidden="true" className="w-touch shrink-0" />
        ) : null}
      </div>
      {progress === null || text === null || arranging ? null : (
        <div className="-mt-1 flex flex-col gap-1 pb-2 pl-6">
          <p
            className={
              progress.overMinor > 0 && progress.overIsWarning
                ? 'text-caption text-warning'
                : 'text-caption text-muted-foreground'
            }
          >
            {text.verb} <Money amountMinor={progress.actualMinor} size="meta" unit={false} />
            {text.rest === null ? null : (
              <>
                {' · '}
                {text.rest.label}{' '}
                <Money amountMinor={text.rest.amountMinor} size="meta" unit={false} />
              </>
            )}
          </p>
          {progress.plannedMinor > 0 ? (
            <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full',
                  progress.overMinor > 0 && progress.overIsWarning ? 'bg-warning' : 'bg-expense',
                )}
                style={{
                  width: `${String(Math.max(0, Math.min(progress.fulfillmentBps, 10_000)) / 100)}%`,
                }}
              />
            </div>
          ) : null}
        </div>
      )}
      {arranging && view.group !== null && view.lines.length === 0 ? (
        <p className="mb-1 grid min-h-12 place-items-center rounded-md border border-dashed border-border text-caption text-muted-foreground">
          Przeciągnij tu pozycje
        </p>
      ) : null}
    </li>
  );
}

/**
 * Nagłówek grupy jako element listy przeciągania.
 *
 * @param props - Właściwości nagłówka i identyfikator elementu listy.
 * @returns Element nagłówka.
 */
function SortableGroupHeader(
  props: Omit<GroupHeaderProps, 'sortable'> & { readonly item: string },
): ReactNode {
  // „Bez grupy" nie przeciąga się, ale musi być celem upuszczenia.
  const sortable = useSortable({ id: props.item, disabled: props.item === NO_GROUP_ITEM });
  return <GroupHeader {...props} sortable={sortable} />;
}

/** Właściwości szybkiego startu. */
interface QuickStartProps {
  readonly section: BudgetSectionView;
  readonly month: MonthKey;
  readonly onDismiss: () => void;
}

/**
 * „Podzielić na grupy?" — pierwsze „Układaj" w sekcji bez grup (07 §13.10).
 *
 * @param props - Właściwości komponentu.
 * @param props.section - Sekcja.
 * @param props.month - Miesiąc szkicu.
 * @param props.onDismiss - „Sam ułożę".
 * @returns Kafel z podglądem.
 */
function QuickStart({ section, month, onDismiss }: QuickStartProps): ReactNode {
  const toast = useToast();
  const change = useBudgetGroupChange(month);
  const split = groupsByOrigin(section.lines);
  const amounts = new Map(section.lines.map((line) => [line.id, line.amountMinor]));
  return (
    <div className="mb-3 flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Podzielić na grupy?</h3>
        <p className="text-caption text-muted-foreground">
          Na początek według tego, skąd pozycje pochodzą. Nazwy i przydział zmienisz potem
          przeciąganiem.
        </p>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {split.map((group) => (
          <li className="flex items-baseline justify-between gap-2" key={group.name}>
            <span>
              {group.name} · {group.lineIds.length}
            </span>
            <Money
              amountMinor={group.lineIds.reduce((sum, id) => sum + (amounts.get(id) ?? 0), 0)}
              size="sm"
              unit={false}
            />
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <Button
          disabled={change.isPending}
          onClick={() => {
            change.mutate(
              { kind: 'by-origin', section: section.key },
              {
                onError: (error) => {
                  toast.show({ message: error.message });
                },
              },
            );
          }}
          variant="primary"
        >
          Utwórz grupy
        </Button>
        <Button onClick={onDismiss} variant="ghost">
          Sam ułożę
        </Button>
      </div>
    </div>
  );
}

/** Właściwości linii sekcji. */
export interface BudgetSectionLinesProps extends RowHandlers {
  readonly section: BudgetSectionView;
  readonly month: MonthKey;
  readonly editable: boolean;
  /** Tryb „Układaj" tej sekcji. */
  readonly arranging: boolean;
  readonly actuals: BudgetActualsDto | null;
  readonly progress: ReadonlyMap<string, LineProgress>;
  /** Arkusz grupy: istniejącej albo nowej (`null`). */
  readonly onEditGroup: (group: BudgetGroupDto | null) => void;
}

/**
 * Linie sekcji: grupy z nagłówkami, „Bez grupy", przeciąganie i szybki start.
 *
 * @param props - Właściwości komponentu.
 * @param props.section - Sekcja z grupami.
 * @param props.month - Miesiąc szkicu.
 * @param props.editable - Szkic edytowalny.
 * @param props.arranging - Tryb „Układaj".
 * @param props.actuals - Wykonanie (miesiąc bieżący i miniony).
 * @param props.progress - Wykonanie linii.
 * @param props.onEditGroup - Arkusz grupy.
 * @param props.busy - Akcja w toku.
 * @param props.onOpen - Dotknięcie wiersza.
 * @param props.onAcceptSource - „Przyjmij".
 * @param props.onDetach - „Zostaw jako własną".
 * @returns Element listy.
 */
export function BudgetSectionLines({
  section,
  month,
  editable,
  arranging,
  actuals,
  progress,
  onEditGroup,
  ...handlers
}: BudgetSectionLinesProps): ReactNode {
  const toast = useToast();
  const change = useBudgetGroupChange(month);
  const collapsed = useCollapsedGroups();
  const finePointer = useFinePointer();
  const [dismissedQuickStart, setDismissedQuickStart] = useState(false);

  const serverItems = useMemo(() => arrangeItems(section), [section]);
  const signature = serverItems.join('|');
  // Układ po upuszczeniu, zanim przyjdzie odpowiedź; odpowiedź (albo błąd) go zastępuje.
  const [pending, setPending] = useState<readonly string[] | null>(null);
  useEffect(() => {
    setPending(null);
  }, [signature]);
  const items = pending ?? serverItems;

  const lines = new Map(section.lines.map((line) => [line.id, line]));
  const views = new Map(
    section.groups.map((view) => [
      view.group === null ? NO_GROUP_ITEM : groupItem(view.group.id),
      view,
    ]),
  );
  // Widok po upuszczeniu: grupy z liniami w kolejności z `items`.
  const viewOf = (item: string, members: readonly string[]): BudgetGroupView | undefined => {
    const base = views.get(item);
    if (base === undefined) return undefined;
    const own = members.flatMap((id) => {
      const line = lines.get(itemId(id));
      return line === undefined ? [] : [line];
    });
    return {
      ...base,
      lines: own,
      totalMinor: own.reduce((sum, line) => sum + line.amountMinor, 0),
    };
  };

  const isCollapsed = (item: string): boolean => {
    const group = views.get(item)?.group ?? null;
    return !arranging && group !== null && collapsed.isCollapsed(group);
  };
  // Pusty „Bez grupy" widać tylko w trybie układania — tam jest celem upuszczenia.
  const looseEmpty =
    section.groups.find((view) => view.group === null)?.lines.length === 0 && !arranging;
  const visible: string[] = [];
  let hiding = false;
  for (const item of items) {
    if (item === NO_GROUP_ITEM && looseEmpty && pending === null) continue;
    if (item === NO_GROUP_ITEM || isGroupItem(item)) {
      hiding = isCollapsed(item);
      visible.push(item);
    } else if (!hiding) visible.push(item);
  }

  const sortable = editable && (arranging || finePointer);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const label = (id: string): string => {
    if (id === NO_GROUP_ITEM) return 'Bez grupy';
    if (isGroupItem(id)) return `grupa ${views.get(id)?.group?.name ?? ''}`;
    return lines.get(itemId(id))?.name ?? '';
  };

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (over === null) return;
    const next = dropArrangeItem(items, visible, String(active.id), String(over.id));
    if (next.join('|') === items.join('|')) return;
    setPending(next);
    change.mutate(
      { kind: 'layout', body: layoutRequest(section.key, next) },
      {
        onError: () => {
          setPending(null);
          toast.show({ message: 'Nie zapisano kolejności.' });
        },
      },
    );
  };

  const showQuickStart =
    arranging && section.groups.length === 0 && section.lines.length > 0 && !dismissedQuickStart;

  // Członkowie grup z pełnej listy — także wiersze grup zwiniętych (suma w nagłówku).
  const members = new Map<string, string[]>();
  let head: string | null = null;
  for (const item of items) {
    if (item === NO_GROUP_ITEM || isGroupItem(item)) {
      head = item;
      members.set(item, []);
    } else if (head !== null) {
      members.get(head)?.push(item);
    }
  }

  const rendered = visible.map((item, index): ReactNode => {
    if (item === NO_GROUP_ITEM || isGroupItem(item)) {
      const view = viewOf(item, members.get(item) ?? []);
      if (view === undefined) return null;
      const group = view.group;
      const props = {
        view,
        collapsed: isCollapsed(item),
        arranging,
        progress: groupProgress(actuals, view),
        first: index === 0,
        onToggle:
          group === null
            ? undefined
            : () => {
                collapsed.toggle(group);
              },
        onEdit:
          group === null
            ? undefined
            : () => {
                onEditGroup(group);
              },
      };
      return sortable ? (
        <SortableGroupHeader {...props} item={item} key={item} />
      ) : (
        <GroupHeader {...props} key={item} />
      );
    }
    const line = lines.get(itemId(item));
    if (line === undefined) return null;
    if (sortable) {
      return (
        <SortableLine
          {...handlers}
          arranging={arranging}
          first={index === 0}
          key={item}
          line={line}
          progress={progress.get(line.id)}
        />
      );
    }
    return (
      <BudgetLineRow
        busy={handlers.busy}
        first={index === 0}
        key={item}
        line={line}
        progress={progress.get(line.id)}
        {...(editable
          ? {
              onAcceptSource: handlers.onAcceptSource,
              onDetach: handlers.onDetach,
              onOpen: handlers.onOpen,
            }
          : {})}
      />
    );
  });

  const list =
    section.lines.length === 0 && section.groups.length === 0 ? (
      <p className="text-sm text-muted-foreground">Brak pozycji.</p>
    ) : (
      <ul>{rendered}</ul>
    );

  return (
    <>
      {showQuickStart ? (
        <QuickStart
          month={month}
          onDismiss={() => {
            setDismissedQuickStart(true);
          }}
          section={section}
        />
      ) : null}
      {sortable ? (
        <DndContext
          accessibility={{
            announcements: announcementsFor(label),
            screenReaderInstructions: SCREEN_READER_INSTRUCTIONS,
          }}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          sensors={sensors}
        >
          <SortableContext items={visible} strategy={verticalListSortingStrategy}>
            {list}
          </SortableContext>
        </DndContext>
      ) : (
        list
      )}
      {arranging ? (
        <Button
          className="mt-3 w-full justify-start gap-2"
          onClick={() => {
            onEditGroup(null);
          }}
          variant="ghost"
        >
          <FolderPlus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          Nowa grupa
        </Button>
      ) : null}
    </>
  );
}
