import type { ShoppingListDto } from '@fineapp/shared';
import { ChevronRight, MoreHorizontal, ShoppingCart, Star } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import {
  Button,
  Card,
  ErrorState,
  IconButton,
  Section,
  Sheet,
  SkeletonList,
  useToast,
} from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import {
  useCreateShoppingList,
  useDeleteShoppingList,
  useShoppingLists,
  useUpdateShoppingList,
} from '../hooks/use-shopping.js';
import { relativeTime, toBuyLabel } from '../shopping-view.js';
import { ShoppingConfirmSheet } from './shopping-confirm-sheet.js';
import { ShoppingNameSheet } from './shopping-name-sheet.js';

/**
 * Listy zakupów — `/shopping`
 * ([06 §3.15](../../../../../../plans/06-ui-views.md#315-listy-zakupów--shopping-shoppinglistid-shoppinglistidimportimportid),
 * `F10-5`).
 *
 * Przy jednej liście ekran od razu przechodzi na nią — na co dzień „Zakupy" to po prostu
 * lista „Spożywcze". Strzałka wstecz z listy prowadzi tu z `?all=1`, żeby nie wpaść
 * z powrotem w przekierowanie.
 */

/**
 * Ekran list.
 *
 * @returns Element ekranu.
 */
export default function ShoppingListsScreen(): ReactNode {
  const [params] = useSearchParams();
  const showAll = params.get('all') === '1';
  const lists = useShoppingLists();
  const create = useCreateShoppingList();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  let content: ReactNode;
  if (lists.isPending) {
    content = (
      <Section first>
        <SkeletonList rows={2} />
      </Section>
    );
  } else if (lists.isError) {
    content = (
      <ErrorState
        details={errorDetails(lists.error)}
        lastUpdatedAt={lastUpdatedLabel(lists.dataUpdatedAt)}
        onRetry={() => {
          void lists.refetch();
        }}
        retrying={lists.isFetching}
        title="Nie udało się wczytać list"
      />
    );
  } else if (lists.data.length === 1 && !showAll) {
    return <Navigate replace to={`/shopping/${(lists.data[0] as ShoppingListDto).id}`} />;
  } else {
    content = (
      <Section first>
        {lists.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nie masz żadnej bieżącej listy. Załóż nową albo przywróć którąś z archiwum.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lists.data.map((list) => (
              <li key={list.id}>
                <ListCard list={list} />
              </li>
            ))}
          </ul>
        )}
        <Button
          className="mt-4"
          onClick={() => {
            setCreating(true);
          }}
          size="large"
          variant="ghost"
        >
          + Nowa lista
        </Button>
      </Section>
    );
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Zakupy</h1>
        <IconButton
          label="Więcej opcji"
          onClick={() => {
            setMenuOpen(true);
          }}
          variant="link"
        >
          <MoreHorizontal aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </IconButton>
      </header>
      {content}
      <ShoppingNameSheet
        initialName=""
        onOpenChange={setCreating}
        onSubmit={async (name) => {
          const list = await create.mutateAsync({ name });
          void navigate(`/shopping/${list.id}`);
        }}
        open={creating}
        submitLabel="Utwórz listę"
        title="Nowa lista"
      />
      <ListsMenu onOpenChange={setMenuOpen} open={menuOpen} />
    </main>
  );
}

/**
 * Karta listy: nazwa, ile do kupienia, kto i kiedy ostatnio zmieniał.
 *
 * @param props - Właściwości komponentu.
 * @param props.list - Lista.
 * @returns Element karty.
 */
function ListCard({ list }: { readonly list: ShoppingListDto }): ReactNode {
  const activity =
    list.lastActivityAt === null
      ? null
      : `${list.lastActivityBy === null ? '' : `${list.lastActivityBy} · `}${relativeTime(list.lastActivityAt, Date.now())}`;
  const parsed = list.pendingImports.find((item) => item.status === 'parsed');
  return (
    <Card className="p-0">
      <Link
        className="flex min-h-touch items-center gap-3 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
        to={`/shopping/${list.id}`}
      >
        {list.isDefault ? (
          <Star aria-label="domyślna" className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.5} />
        ) : (
          <ShoppingCart
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-muted-foreground"
            strokeWidth={1.5}
          />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-semibold">{list.name}</span>
          <span className="text-caption text-muted-foreground">
            {toBuyLabel(list.toBuyCount)}
            {activity === null ? '' : ` · ${activity}`}
          </span>
          {parsed === undefined ? null : (
            <span className="text-caption text-primary">Odczyt gotowy do przejrzenia</span>
          )}
        </span>
        <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={1.5} />
      </Link>
    </Card>
  );
}

/**
 * Menu ekranu list: archiwum i „Zawsze w domu".
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy otwarte.
 * @param props.onOpenChange - Zmiana otwarcia.
 * @returns Element arkusza.
 */
function ListsMenu({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  const [archive, setArchive] = useState(false);
  return (
    <>
      <Sheet onOpenChange={onOpenChange} open={open} title="Zakupy">
        <div className="flex flex-col gap-2">
          <Button
            className="justify-start"
            onClick={() => {
              onOpenChange(false);
              setArchive(true);
            }}
            size="large"
            variant="ghost"
          >
            Archiwum
          </Button>
          <Button asChild className="justify-start" size="large" variant="ghost">
            <Link to="/shopping/staples">Zawsze w domu</Link>
          </Button>
        </div>
      </Sheet>
      <ArchiveSheet onOpenChange={setArchive} open={archive} />
    </>
  );
}

/**
 * Archiwum list: przywróć albo usuń.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy otwarte.
 * @param props.onOpenChange - Zmiana otwarcia.
 * @returns Element arkusza.
 */
function ArchiveSheet({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  const archived = useShoppingLists(true, open);
  return (
    <Sheet onOpenChange={onOpenChange} open={open} title="Archiwum">
      {archived.isPending ? (
        <SkeletonList rows={2} />
      ) : archived.isError ? (
        <ErrorState
          details={errorDetails(archived.error)}
          onRetry={() => {
            void archived.refetch();
          }}
          retrying={archived.isFetching}
          title="Nie udało się wczytać archiwum"
        />
      ) : archived.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Archiwum jest puste.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(archived.data ?? []).map((list) => (
            <li key={list.id}>
              <ArchivedRow list={list} />
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/**
 * Wiersz listy z archiwum.
 *
 * @param props - Właściwości komponentu.
 * @param props.list - Lista.
 * @returns Element wiersza.
 */
function ArchivedRow({ list }: { readonly list: ShoppingListDto }): ReactNode {
  const update = useUpdateShoppingList(list.id);
  const remove = useDeleteShoppingList();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const fail = (failure: Error): void => {
    toast.show({ message: failure.message });
  };
  return (
    <div className="flex items-center gap-2">
      <ShoppingConfirmSheet
        listName={confirming ? list.name : null}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          remove.mutate(list.id, { onError: fail });
        }}
      />
      <span className="min-w-0 flex-1 truncate text-sm">{list.name}</span>
      <Button
        onClick={() => {
          update.mutate(
            { archived: false },
            {
              onError: fail,
              onSuccess: () => {
                toast.show({ message: `Przywrócono „${list.name}”.` });
              },
            },
          );
        }}
        size="small"
        variant="soft"
      >
        Przywróć
      </Button>
      <Button
        onClick={() => {
          setConfirming(true);
        }}
        size="small"
        variant="ghost"
      >
        Usuń
      </Button>
    </div>
  );
}
