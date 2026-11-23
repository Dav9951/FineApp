import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { ErrorState, Sheet, SkeletonList, useToast } from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { useShoppingLists } from '../hooks/use-shopping.js';
import { ShoppingAddBar } from './shopping-add-bar.js';

/**
 * „Do listy zakupów" z menu FAB (06 §2, §3.15) — dopisanie do listy domyślnej z dowolnego
 * ekranu, bez przechodzenia na listę. Arkusz zostaje otwarty: kilka produktów pod rząd.
 */

/** Właściwości arkusza szybkiego dopisania. */
export interface ShoppingQuickAddSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Arkusz szybkiego dopisania.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy otwarty.
 * @param props.onOpenChange - Zmiana otwarcia.
 * @returns Element arkusza.
 */
export function ShoppingQuickAddSheet({
  open,
  onOpenChange,
}: ShoppingQuickAddSheetProps): ReactNode {
  return (
    <Sheet onOpenChange={onOpenChange} open={open} title="Do listy zakupów">
      {open ? <QuickAdd onOpenChange={onOpenChange} /> : null}
    </Sheet>
  );
}

/**
 * Treść arkusza — wczytuje listy dopiero po otwarciu.
 *
 * @param props - Właściwości komponentu.
 * @param props.onOpenChange - Zamknięcie arkusza.
 * @returns Element treści.
 */
function QuickAdd({ onOpenChange }: { readonly onOpenChange: (open: boolean) => void }): ReactNode {
  const lists = useShoppingLists();
  const toast = useToast();
  if (lists.isPending) return <SkeletonList rows={1} />;
  if (lists.isError) {
    return (
      <ErrorState
        details={errorDetails(lists.error)}
        onRetry={() => {
          void lists.refetch();
        }}
        retrying={lists.isFetching}
        title="Nie udało się wczytać list"
      />
    );
  }
  const target = (lists.data ?? []).find((list) => list.isDefault) ?? lists.data?.[0];
  if (target === undefined) {
    return (
      <p className="text-sm">
        Nie masz żadnej listy.{' '}
        <Link
          className="text-primary underline"
          onClick={() => {
            onOpenChange(false);
          }}
          to="/shopping?all=1"
        >
          Załóż listę
        </Link>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption text-muted-foreground">
        Dopisujesz do listy „{target.name}”.{' '}
        <Link
          className="text-primary underline"
          onClick={() => {
            onOpenChange(false);
          }}
          to={`/shopping/${target.id}`}
        >
          Otwórz listę
        </Link>
      </p>
      <ShoppingAddBar
        autoFocus
        suggestions="below"
        listId={target.id}
        onAdded={(name) => {
          toast.show({ message: `Dopisano „${name}” do „${target.name}”.` });
        }}
      />
    </div>
  );
}
