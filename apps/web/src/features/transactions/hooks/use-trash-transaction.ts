import type { MonthKey } from '@fineapp/shared';
import { useCallback } from 'react';

import { useToast } from '../../../components/ui/index.js';
import { useDeleteTransaction, useRestoreTransaction } from './use-transactions.js';

/**
 * Usunięcie transakcji z „Cofnij" — jedna ścieżka dla gestu na liście i przycisku
 * w arkuszu (15 §2.7: gest nigdy nie jest jedyną drogą do akcji).
 *
 * Bez okna potwierdzenia: usunięcie jest miękkie i odwracalne przez 30 dni (07 §10),
 * więc zamiast pytać „na pewno?" przy każdym przesunięciu wiersza, pokazujemy toast
 * z „Cofnij" (15 §4.10). Pytanie przed operacją odwracalną uczy klikać „Tak" bez czytania.
 */

/** Transakcja do usunięcia. */
export interface TrashTarget {
  readonly id: string;
  readonly monthKey: MonthKey;
}

/**
 * Zwraca funkcję przenoszącą transakcję do kosza z toastem „Cofnij".
 *
 * @returns Funkcja usuwająca; `onDeleted` wołane po sukcesie (np. zamknięcie arkusza).
 */
export function useTrashTransaction(): (target: TrashTarget, onDeleted?: () => void) => void {
  const remove = useDeleteTransaction();
  const restore = useRestoreTransaction();
  const { show } = useToast();
  const { mutate: removeMutate } = remove;
  const { mutate: restoreMutate } = restore;

  return useCallback(
    (target, onDeleted) => {
      removeMutate(
        { transactionId: target.id, monthKey: target.monthKey },
        {
          onSuccess: () => {
            onDeleted?.();
            show({
              message: 'Przeniesiono do kosza',
              action: {
                label: 'Cofnij',
                onAction: () => {
                  restoreMutate(target.id, {
                    onError: (error) => {
                      show({ message: `Nie udało się przywrócić: ${error.message}` });
                    },
                  });
                },
              },
            });
          },
          onError: (error) => {
            show({ message: `Nie udało się usunąć: ${error.message}` });
          },
        },
      );
    },
    [removeMutate, restoreMutate, show],
  );
}
