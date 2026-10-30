import type { LiabilityDto } from '@fineapp/shared';

import { useToast } from '../../../components/ui/index.js';
import { useDeleteTransaction } from '../../transactions/hooks/use-transactions.js';
import { useRecordPayment } from './use-liabilities.js';

/** Sterowanie księgowaniem raty jednym dotknięciem. */
export interface PayInstallment {
  /** Księguje ratę z warunków zobowiązania, dziś (albo czekające wystąpienie reguły). */
  readonly pay: (liability: LiabilityDto) => void;
  /** Identyfikator zobowiązania, którego rata właśnie się zapisuje. */
  readonly pendingId: string | undefined;
}

/**
 * Rata jednym dotknięciem z „Cofnij" w toaście (06 §3.8 — „[Zaksięguj]" na karcie).
 *
 * Klucz idempotencji powstaje przy każdym dotknięciu: to osobna decyzja „zapłaciłem", a
 * ochronę przed podwójnym dotknięciem daje przycisk w stanie ładowania. „Cofnij" to
 * usunięcie utworzonej transakcji — ta sama droga co z listy transakcji, więc cofa też
 * zaksięgowanie wystąpienia raty (07 §6.7).
 *
 * @returns Funkcja księgująca i stan.
 */
export function usePayInstallment(): PayInstallment {
  const record = useRecordPayment();
  const undo = useDeleteTransaction();
  const { show } = useToast();

  const pay = (liability: LiabilityDto): void => {
    record.mutate(
      { liabilityId: liability.id, body: {}, idempotencyKey: crypto.randomUUID() },
      {
        onSuccess: ({ data }) => {
          const { transaction } = data;
          show({
            message: `Zaksięgowano ratę „${liability.name}"`,
            action: {
              label: 'Cofnij',
              onAction: () => {
                undo.mutate({ transactionId: transaction.id, monthKey: transaction.monthKey });
              },
            },
          });
        },
        onError: (error) => {
          show({ message: error.message });
        },
      },
    );
  };

  return {
    pay,
    pendingId: record.isPending ? record.variables.liabilityId : undefined,
  };
}
