import type { HouseholdDto } from '@fineapp/shared';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button, Sheet } from '../../../components/ui/index.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { AccountPicker } from '../../transactions/components/transaction-pickers.js';
import { useUpdateHousehold } from '../hooks/use-settings.js';

/**
 * Arkusz wyboru domyślnego konta wydatków
 * ([06 §3.12](../../../../../../plans/06-ui-views.md#312-ustawienia--settings), ADR-070).
 *
 * Wybór zapisuje się od razu — to jedno dotknięcie, a formularz z przyciskiem „Zapisz"
 * dokładałby drugie bez żadnej korzyści. Konto proponują potem formularze transakcji
 * i przegląd skanu.
 */

/** Właściwości arkusza. */
export interface ExpenseAccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  household: HouseholdDto;
}

/**
 * Arkusz z listą aktywnych kont i opcją „Bez domyślnego".
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.household - Zapisane ustawienia.
 * @returns Element arkusza.
 */
export function ExpenseAccountSheet({
  open,
  onOpenChange,
  household,
}: ExpenseAccountSheetProps): ReactNode {
  const navigate = useNavigate();
  const accounts = useAccountList(false);
  const update = useUpdateHousehold();
  const [error, setError] = useState<string | undefined>(undefined);

  const save = (accountId: string | null): void => {
    setError(undefined);
    if (accountId === household.defaultExpenseAccountId) {
      onOpenChange(false);
      return;
    }
    update.mutate(
      { defaultExpenseAccountId: accountId },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (mutationError) => {
          setError(mutationError.message);
        },
      },
    );
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open} title="Gospodarstwo">
      {open ? (
        <div className="flex flex-col gap-4">
          <AccountPicker
            accounts={accounts.data ?? []}
            onBack={() => {
              onOpenChange(false);
            }}
            onManageAccounts={() => {
              void navigate('/accounts');
            }}
            onSelect={save}
            selectedId={household.defaultExpenseAccountId}
            title="Konto do wydatków"
          />
          <p className="text-caption text-muted-foreground">
            Proponowane w nowych wydatkach i przy zatwierdzaniu zeskanowanych paragonów.
          </p>
          {error === undefined ? null : (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          {household.defaultExpenseAccountId === null ? null : (
            <Button
              loading={update.isPending}
              onClick={() => {
                save(null);
              }}
              size="large"
              variant="ghost"
            >
              Bez domyślnego
            </Button>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}
