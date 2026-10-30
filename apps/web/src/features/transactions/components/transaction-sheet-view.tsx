import { isInClosedMonth, todayInTimezone, type TransactionType } from '@fineapp/shared';
import type { ReactNode } from 'react';

import {
  Button,
  EmptyState,
  ErrorState,
  Sheet,
  SkeletonList,
  useToast,
} from '../../../components/ui/index.js';
import { ApiRequestError, errorDetails } from '../../../lib/api-client.js';
import { useAuth } from '../../auth/auth-context.js';
import { useTrashTransaction } from '../hooks/use-trash-transaction.js';
import { useRestoreTransaction, useTransaction } from '../hooks/use-transactions.js';
import { formTitle, type TransactionPreset } from '../transaction-form-state.js';
import { TransactionForm } from './transaction-form.js';

/**
 * Arkusz z formularzem transakcji — ładowany leniwie przez `TransactionSheetProvider`.
 *
 * Powłoka montuje provider na każdym ekranie; gdyby formularz szedł z nią statycznie,
 * ścieżka krytyczna urosłaby o prymitywy, Radix i pickery, których ekran startowy nie
 * potrzebuje (ADR-037). Provider pobiera ten moduł w wolnej chwili po starcie, więc
 * pierwsze dotknięcie FAB-a go nie czeka.
 */

/** Co ma pokazać arkusz. */
export type SheetRequest =
  | { readonly key: number; readonly type: TransactionType; readonly preset?: TransactionPreset }
  | { readonly key: number; readonly transactionId: string };

/**
 * Treść arkusza w trybie edycji: wczytanie transakcji i jej stany.
 *
 * @param props - Właściwości komponentu.
 * @param props.transactionId - Identyfikator transakcji.
 * @param props.onDone - Zamknięcie po zapisie.
 * @param props.onManageAccounts - Wyjście do ekranu kont.
 * @returns Element treści.
 */
function EditContent({
  transactionId,
  onDone,
  onManageAccounts,
}: {
  transactionId: string;
  onDone: () => void;
  onManageAccounts: () => void;
}): ReactNode {
  const tx = useTransaction(transactionId);
  const trash = useTrashTransaction();
  const restore = useRestoreTransaction();
  const { show } = useToast();
  const { household } = useAuth();
  if (tx.isPending) return <SkeletonList rows={5} />;
  if (tx.isError) {
    if (tx.error instanceof ApiRequestError && tx.error.status === 404) {
      return (
        <EmptyState
          description="Mogła zostać usunięta na innym urządzeniu."
          title="Nie ma takiej transakcji"
        />
      );
    }
    return (
      <ErrorState
        details={errorDetails(tx.error)}
        onRetry={() => {
          void tx.refetch();
        }}
        retrying={tx.isFetching}
        title="Nie udało się wczytać transakcji"
      />
    );
  }
  // Zamknięty miesiąc: bez usuwania i przywracania — serwer i tak by odmówił (07 §1.4).
  const locked = isInClosedMonth(
    tx.data.bookedOn,
    todayInTimezone(household?.timezone ?? 'Europe/Warsaw'),
    household?.backPostingLimitMonths ?? 1,
  );
  if (tx.data.deletedAt !== null && locked) {
    return (
      <EmptyState
        description="Należy do zamkniętego miesiąca, więc nie da się jej przywrócić. Podnieś limit księgowania wstecz w ustawieniach."
        title="Transakcja jest w koszu"
      />
    );
  }
  if (tx.data.deletedAt !== null) {
    // Przywrócenie unieważnia `qk.transactions()`, więc arkusz sam przechodzi do formularza.
    return (
      <EmptyState
        action={
          <Button
            loading={restore.isPending}
            onClick={() => {
              restore.mutate(transactionId, {
                onError: (error) => {
                  show({ message: `Nie udało się przywrócić: ${error.message}` });
                },
              });
            }}
            size="large"
            variant="primary"
          >
            Przywróć
          </Button>
        }
        description="Przywróć ją, zanim ją zmienisz. Po 30 dniach kosz usuwa ją na stałe."
        title="Transakcja jest w koszu"
      />
    );
  }
  const original = tx.data;
  return (
    <>
      <TransactionForm onDone={onDone} onManageAccounts={onManageAccounts} original={original} />
      {/* Druga droga do usunięcia obok gestu na liście (15 §2.7). Wariant `ghost`, nie
          `danger`: usunięcie trafia do kosza i ma „Cofnij" (15 §4.3). */}
      {locked ? null : (
        <Button
          className="mt-6"
          onClick={() => {
            trash({ id: original.id, monthKey: original.monthKey }, onDone);
          }}
          size="large"
          variant="ghost"
        >
          Usuń transakcję
        </Button>
      )}
    </>
  );
}

/** Właściwości arkusza. */
export interface TransactionSheetViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ostatnie żądanie; zostaje po zamknięciu, żeby treść nie znikała w trakcie animacji. */
  request: SheetRequest;
  /** Typ wybrany w zakładkach nowej transakcji — do tytułu. */
  newType: TransactionType;
  onTypeChange: (type: TransactionType) => void;
  onDone: () => void;
  onManageAccounts: () => void;
}

/**
 * Arkusz: formularz nowej transakcji albo edycja wczytanej.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana otwarcia.
 * @param props.request - Co pokazać.
 * @param props.newType - Typ nowej transakcji.
 * @param props.onTypeChange - Zmiana typu w zakładkach.
 * @param props.onDone - Zamknięcie po zapisie.
 * @param props.onManageAccounts - Wyjście do ekranu kont.
 * @returns Element arkusza.
 */
export default function TransactionSheetView({
  open,
  onOpenChange,
  request,
  newType,
  onTypeChange,
  onDone,
  onManageAccounts,
}: TransactionSheetViewProps): ReactNode {
  const editing = 'transactionId' in request;
  return (
    <Sheet
      onOpenChange={onOpenChange}
      open={open}
      title={editing ? 'Edytuj transakcję' : formTitle(newType, false)}
    >
      {editing ? (
        <EditContent
          key={request.key}
          onDone={onDone}
          onManageAccounts={onManageAccounts}
          transactionId={request.transactionId}
        />
      ) : (
        <TransactionForm
          initialPreset={request.preset}
          initialType={request.type}
          key={request.key}
          onDone={onDone}
          onManageAccounts={onManageAccounts}
          onTypeChange={onTypeChange}
        />
      )}
    </Sheet>
  );
}
