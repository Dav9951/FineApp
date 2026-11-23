import {
  formatShoppingQuantity,
  type ShoppingItemDto,
  type ShoppingListDto,
} from '@fineapp/shared';
import { Check, ChevronDown, ChevronLeft, Circle, MoreHorizontal, WifiOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Section,
  Sheet,
  SkeletonList,
  Switch,
  useHideFab,
  useToast,
} from '../../../components/ui/index.js';
import { ApiRequestError, errorDetails } from '../../../lib/api-client.js';
import { cn } from '../../../lib/cn.js';
import { pluralPl } from '../../../lib/format.js';
import { useOnline } from '../../../lib/pwa.js';
import { useWakeLock } from '../../../lib/wake-lock.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useAiEnabled } from '../../scan/hooks/use-documents.js';
import {
  useDeleteShoppingList,
  useDuplicateShoppingList,
  useItemChange,
  useShoppingItems,
  useUndoClear,
  useUpdateShoppingList,
} from '../hooks/use-shopping.js';
import { checkedItems, groupToBuy, shareText } from '../shopping-view.js';
import { ShoppingAddBar } from './shopping-add-bar.js';
import { ShoppingConfirmSheet } from './shopping-confirm-sheet.js';
import { ShoppingItemSheet } from './shopping-item-sheet.js';
import { ShoppingNameSheet } from './shopping-name-sheet.js';

/**
 * Lista zakupów — `/shopping/:listId`
 * ([06 §3.15](../../../../../../plans/06-ui-views.md#315-listy-zakupów--shopping-shoppinglistid-shoppinglistidimportimportid),
 * `F10-5`, `F10-6`).
 *
 * Ekran do używania w sklepie jedną ręką: działy w kolejności sklepu, dotknięcie całego
 * wiersza odhacza, kupione spadają na dół, pole dodawania przyklejone nad paskiem
 * zakładek. Zmiany pozycji działają bez sieci (ADR-096) — baner mówi, że czekają.
 * FAB jest schowany: jego rolę pełni pole dodawania.
 */

/** Lista w zakresie potrzebnym nagłówkowi i menu. */
type ListSummary = Pick<ShoppingListDto, 'id' | 'name' | 'isDefault' | 'archived'>;

/** Przyklejenie pola dodawania nad paskiem zakładek (telefon) albo przy dolnej krawędzi. */
const ADD_BAR_STICKY =
  'sticky bottom-[calc(theme(spacing.tabbar)+1px+env(safe-area-inset-bottom))] md:bottom-0';

/**
 * Trasa listy.
 *
 * @returns Element ekranu.
 */
export default function ShoppingListRoute(): ReactNode {
  const { listId = '' } = useParams();
  // Nowa lista = nowy stan ekranu (arkusz, podpowiedź po zakupach) — np. po „Duplikuj".
  return <ShoppingListScreen key={listId} listId={listId} />;
}

/**
 * Ekran jednej listy.
 *
 * @param props - Właściwości komponentu.
 * @param props.listId - Lista.
 * @returns Element ekranu.
 */
function ShoppingListScreen({ listId }: { readonly listId: string }): ReactNode {
  const query = useShoppingItems(listId);
  useHideFab(true);
  const [editing, setEditing] = useState<ShoppingItemDto | null>(null);
  const [cleared, setCleared] = useState(false);

  if (query.isPending) {
    return (
      <main aria-busy="true">
        <ListHeader name="" />
        <Section first>
          <SkeletonList rows={6} />
        </Section>
      </main>
    );
  }

  const notFound = query.error instanceof ApiRequestError && query.error.status === 404;
  // 404 wygrywa z migawką: stare pozycje usuniętej listy nie mogą wyglądać na żywe.
  if (notFound || (query.isError && query.data === undefined)) {
    return (
      <main>
        <ListHeader name="" />
        {notFound ? (
          <EmptyState
            action={
              <Button asChild>
                <Link to="/shopping?all=1">Wszystkie listy</Link>
              </Button>
            }
            title="Tej listy już nie ma"
            description="Ktoś mógł ją usunąć na drugim telefonie."
          />
        ) : (
          <ErrorState
            details={errorDetails(query.error)}
            lastUpdatedAt={lastUpdatedLabel(query.dataUpdatedAt)}
            onRetry={() => {
              void query.refetch();
            }}
            retrying={query.isFetching}
            title="Nie udało się wczytać listy"
          />
        )}
      </main>
    );
  }

  const { list, items } = query.data;
  const groups = groupToBuy(items);
  const bought = checkedItems(items);
  const archived = list.archived;

  return (
    <main>
      <ListHeader items={items} list={list} name={list.name} />
      <OfflineNote />
      {archived ? (
        <p className="mt-4 rounded-md border border-border bg-card p-3 text-sm">
          Lista jest w archiwum — przywróć ją w menu, żeby coś zmienić.
        </p>
      ) : null}

      {groups.length === 0 && bought.length === 0 ? (
        <EmptyState
          className="mt-6"
          description="Dopisz pierwszy produkt na dole ekranu. Ilość możesz wpisać od razu: „2 mleko”, „mąka 1kg”."
          title="Lista jest pusta"
        />
      ) : null}

      {groups.map((group, index) => (
        <Section first={index === 0} key={group.section} title={group.label}>
          <ul>
            {group.items.map((item) => (
              <li key={item.id}>
                <ItemRow archived={archived} item={item} onEdit={setEditing} />
              </li>
            ))}
          </ul>
        </Section>
      ))}

      {bought.length > 0 ? (
        <BoughtSection
          archived={archived}
          items={bought}
          listId={listId}
          onCleared={() => {
            setCleared(true);
          }}
          onEdit={setEditing}
        />
      ) : null}

      {cleared ? (
        <AfterClear
          canArchive={!list.isDefault && groups.length === 0}
          listId={listId}
          listName={list.name}
          onDismiss={() => {
            setCleared(false);
          }}
        />
      ) : null}

      <div
        className={cn('z-20 -mx-4 mt-6 bg-background px-4 py-3 md:-mx-6 md:px-6', ADD_BAR_STICKY)}
      >
        <ShoppingAddBar disabled={archived} listId={listId} />
      </div>

      <ShoppingItemSheet
        item={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
    </main>
  );
}

/**
 * Baner pracy bez sieci — zmiany pozycji czekają w kolejce (ADR-096).
 *
 * @returns Element albo nic.
 */
function OfflineNote(): ReactNode {
  const online = useOnline();
  if (online) return null;
  return (
    <p
      className="mt-4 flex gap-2 rounded-md border border-warning bg-card p-3 text-sm"
      role="status"
    >
      <WifiOff
        aria-hidden="true"
        className="mt-px h-4 w-4 shrink-0 text-warning"
        strokeWidth={1.5}
      />
      Brak połączenia — odhaczenia i nowe pozycje wyślę, gdy wróci sieć.
    </p>
  );
}

/**
 * Wiersz pozycji: dotknięcie całego wiersza odhacza, „⋯" otwiera arkusz.
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Pozycja.
 * @param props.archived - Lista w archiwum — wiersz tylko do odczytu.
 * @param props.onEdit - Otwarcie arkusza pozycji.
 * @returns Element wiersza.
 */
function ItemRow({
  item,
  archived,
  onEdit,
}: {
  readonly item: ShoppingItemDto;
  readonly archived: boolean;
  readonly onEdit: (item: ShoppingItemDto) => void;
}): ReactNode {
  const change = useItemChange(item.listId);
  const toast = useToast();
  const quantity = formatShoppingQuantity(item);

  const toggle = (): void => {
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

  return (
    <div className="flex items-stretch border-t border-border first:border-t-0">
      <button
        aria-checked={item.checked}
        className="flex min-h-touch min-w-0 flex-1 items-center gap-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted disabled:opacity-60"
        disabled={archived}
        onClick={toggle}
        role="checkbox"
        type="button"
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
 * Sekcja „Kupione" — zwinięta domyślnie; „Wyczyść kupione" bez potwierdzenia, z „Cofnij".
 *
 * @param props - Właściwości komponentu.
 * @param props.items - Kupione pozycje.
 * @param props.listId - Lista.
 * @param props.archived - Lista w archiwum.
 * @param props.onEdit - Otwarcie arkusza pozycji.
 * @param props.onCleared - Po wyczyszczeniu (podpowiedzi pod listą).
 * @returns Element sekcji.
 */
function BoughtSection({
  items,
  listId,
  archived,
  onEdit,
  onCleared,
}: {
  readonly items: readonly ShoppingItemDto[];
  readonly listId: string;
  readonly archived: boolean;
  readonly onEdit: (item: ShoppingItemDto) => void;
  readonly onCleared: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const change = useItemChange(listId);
  const undo = useUndoClear(listId);
  const toast = useToast();

  const clear = (): void => {
    const ids = items.map((item) => item.id);
    void change({ kind: 'clear' });
    toast.show({
      message: `Wyczyszczono ${String(ids.length)} ${pluralPl(ids.length, 'pozycję', 'pozycje', 'pozycji')}`,
      action: {
        label: 'Cofnij',
        onAction: () => {
          void undo(ids);
        },
      },
    });
    onCleared();
  };

  return (
    <Section>
      <div className="flex items-center justify-between gap-2">
        <button
          aria-expanded={open}
          className="flex min-h-touch items-center gap-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setOpen((value) => !value);
          }}
          type="button"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn('h-4 w-4 transition-transform', open ? 'rotate-0' : '-rotate-90')}
            strokeWidth={1.5}
          />
          Kupione ({items.length})
        </button>
        <Button disabled={archived} onClick={clear} size="small" variant="link">
          Wyczyść kupione
        </Button>
      </div>
      {open ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <ItemRow archived={archived} item={item} onEdit={onEdit} />
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

/**
 * Podpowiedzi po „Wyczyść kupione" (06 §3.15, 17 §5.6): „Zeskanuj paragon?" — jedyny
 * most listy do finansów — i dla pustej listy okazjonalnej „Zarchiwizować?".
 *
 * @param props - Właściwości komponentu.
 * @param props.listId - Lista.
 * @param props.listName - Nazwa listy.
 * @param props.canArchive - Lista jest pusta i nie jest domyślna.
 * @param props.onDismiss - Zamknięcie podpowiedzi.
 * @returns Element podpowiedzi.
 */
function AfterClear({
  listId,
  listName,
  canArchive,
  onDismiss,
}: {
  readonly listId: string;
  readonly listName: string;
  readonly canArchive: boolean;
  readonly onDismiss: () => void;
}): ReactNode {
  const aiEnabled = useAiEnabled();
  const update = useUpdateShoppingList(listId);
  const toast = useToast();
  const navigate = useNavigate();
  if (!aiEnabled && !canArchive) return null;
  return (
    <Section title="Po zakupach">
      <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
        {canArchive ? (
          <p className="text-sm">Lista jest pusta. Zarchiwizować „{listName}”?</p>
        ) : null}
        {aiEnabled ? (
          <p className="text-sm">Masz paragon? Zeskanuj go, a wydatek sam trafi do budżetu.</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {canArchive ? (
            <Button
              onClick={() => {
                update.mutate(
                  { archived: true },
                  {
                    onError: (failure) => {
                      toast.show({ message: failure.message });
                    },
                    onSuccess: () => {
                      void navigate('/shopping?all=1');
                    },
                  },
                );
              }}
              size="small"
              variant="soft"
            >
              Archiwizuj
            </Button>
          ) : null}
          {aiEnabled ? (
            <Button asChild size="small" variant="soft">
              <Link to="/scan">Zeskanuj paragon</Link>
            </Button>
          ) : null}
          <Button onClick={onDismiss} size="small" variant="ghost">
            Nie teraz
          </Button>
        </div>
      </div>
    </Section>
  );
}

/**
 * Nagłówek listy z menu.
 *
 * @param props - Właściwości komponentu.
 * @param props.name - Nazwa listy (pusta podczas wczytywania).
 * @param props.list - Lista z serwera (gdy wczytana).
 * @param props.items - Pozycje (do udostępnienia).
 * @returns Element nagłówka.
 */
function ListHeader({
  name,
  list,
  items = [],
}: {
  readonly name: string;
  readonly list?: ListSummary;
  readonly items?: readonly ShoppingItemDto[];
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="flex items-center gap-2">
      <IconButton asChild label="Wszystkie listy" variant="link">
        <Link to="/shopping?all=1">
          <ChevronLeft aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </Link>
      </IconButton>
      <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{name}</h1>
      {list === undefined ? null : (
        <>
          <IconButton
            label="Menu listy"
            onClick={() => {
              setMenuOpen(true);
            }}
            variant="link"
          >
            <MoreHorizontal aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          </IconButton>
          <ListMenu items={items} list={list} onOpenChange={setMenuOpen} open={menuOpen} />
        </>
      )}
    </header>
  );
}

/**
 * Menu listy: nazwa, domyślna, kopia, udostępnienie, ekran, archiwum, usunięcie.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy otwarte.
 * @param props.onOpenChange - Zmiana otwarcia.
 * @param props.list - Lista.
 * @param props.items - Pozycje (do udostępnienia).
 * @returns Element arkusza.
 */
function ListMenu({
  open,
  onOpenChange,
  list,
  items,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly list: ListSummary;
  readonly items: readonly ShoppingItemDto[];
}): ReactNode {
  const toast = useToast();
  const navigate = useNavigate();
  const update = useUpdateShoppingList(list.id);
  const duplicate = useDuplicateShoppingList(list.id);
  const remove = useDeleteShoppingList();
  const wakeLock = useWakeLock();
  const [naming, setNaming] = useState<'rename' | 'duplicate' | null>(null);
  const [confirming, setConfirming] = useState(false);

  const fail = (failure: Error): void => {
    toast.show({ message: failure.message });
  };

  const share = (): void => {
    const text = shareText(list.name, items);
    onOpenChange(false);
    if (typeof navigator.share === 'function') {
      void navigator.share({ title: list.name, text }).catch(() => undefined);
      return;
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        toast.show({ message: 'Skopiowano listę do schowka.' });
      })
      .catch(() => {
        toast.show({ message: 'Nie udało się skopiować listy.' });
      });
  };

  return (
    <>
      <Sheet onOpenChange={onOpenChange} open={open} title={list.name}>
        <div className="flex flex-col gap-2">
          <MenuButton
            label="Zmień nazwę"
            onClick={() => {
              onOpenChange(false);
              setNaming('rename');
            }}
          />
          {list.isDefault || list.archived ? null : (
            <MenuButton
              label="Ustaw jako domyślną"
              onClick={() => {
                update.mutate(
                  { isDefault: true },
                  {
                    onError: fail,
                    onSuccess: () => {
                      toast.show({ message: `„${list.name}” jest teraz listą domyślną.` });
                    },
                  },
                );
                onOpenChange(false);
              }}
            />
          )}
          <MenuButton
            label="Duplikuj"
            onClick={() => {
              onOpenChange(false);
              setNaming('duplicate');
            }}
          />
          <MenuButton label="Udostępnij jako tekst" onClick={share} />
          {wakeLock.supported ? (
            <div className="flex min-h-touch items-center justify-between gap-3 px-1">
              <span className="text-sm">Nie wygaszaj ekranu</span>
              <Switch
                checked={wakeLock.active}
                label="Nie wygaszaj ekranu"
                onCheckedChange={wakeLock.toggle}
              />
            </div>
          ) : null}
          <MenuButton
            label={list.archived ? 'Przywróć z archiwum' : 'Archiwizuj'}
            onClick={() => {
              onOpenChange(false);
              update.mutate(
                { archived: !list.archived },
                {
                  onError: fail,
                  onSuccess: () => {
                    toast.show({
                      message: list.archived
                        ? `Przywrócono „${list.name}”.`
                        : `„${list.name}” jest w archiwum.`,
                    });
                    if (!list.archived) void navigate('/shopping?all=1');
                  },
                },
              );
            }}
          />
          <Button
            onClick={() => {
              onOpenChange(false);
              setConfirming(true);
            }}
            size="large"
            variant="danger"
          >
            Usuń listę
          </Button>
        </div>
      </Sheet>
      <ShoppingConfirmSheet
        listName={confirming ? list.name : null}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          remove.mutate(list.id, {
            onError: fail,
            onSuccess: () => {
              toast.show({ message: `Usunięto listę „${list.name}”.` });
              void navigate('/shopping?all=1');
            },
          });
        }}
      />
      <ShoppingNameSheet
        initialName={naming === 'duplicate' ? `${list.name} (kopia)` : list.name}
        onOpenChange={(value) => {
          if (!value) setNaming(null);
        }}
        onSubmit={async (name) => {
          if (naming === 'duplicate') {
            const copy = await duplicate.mutateAsync(name);
            void navigate(`/shopping/${copy.id}`);
          } else {
            await update.mutateAsync({ name });
          }
        }}
        open={naming !== null}
        submitLabel={naming === 'duplicate' ? 'Utwórz kopię' : 'Zapisz'}
        title={naming === 'duplicate' ? 'Kopia listy' : 'Nazwa listy'}
      />
    </>
  );
}

/**
 * Pozycja menu.
 *
 * @param props - Właściwości komponentu.
 * @param props.label - Etykieta.
 * @param props.onClick - Działanie.
 * @returns Element przycisku.
 */
function MenuButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}): ReactNode {
  return (
    <Button className="justify-start" onClick={onClick} size="large" variant="ghost">
      {label}
    </Button>
  );
}
