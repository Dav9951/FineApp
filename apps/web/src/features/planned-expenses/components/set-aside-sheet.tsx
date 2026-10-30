import type { PlannedExpenseDto } from '@fineapp/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { AmountInput, Button, Field, Sheet, useToast } from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { AccountPicker } from '../../transactions/components/transaction-pickers.js';
import { useAuth } from '../../auth/auth-context.js';
import { defaultAccountId } from '../../transactions/transaction-form-state.js';
import { useSetAside } from '../hooks/use-planned-expenses.js';

/**
 * „Odłóż teraz" — `POST /planned-expenses/:id/set-aside` (`F6-3`, 06 §3.10).
 *
 * Kwota proponowana to rata miesiąca (albo zaległość z ostrzeżenia), konto docelowe
 * wynika z wydatku (konto odkładania albo konto celu), do wyboru jest tylko źródło.
 * Jeden klucz idempotencji na otwarcie arkusza: ponowienie po zerwanym połączeniu nie
 * odłoży drugi raz (ADR-037).
 */

/** Cel arkusza: wydatek i kwota proponowana. */
export interface SetAsideTarget {
  readonly item: PlannedExpenseDto;
  /** Kwota proponowana; brak — rata miesiąca. */
  readonly amountMinor?: number;
}

/**
 * Treść arkusza — montowana od nowa przy każdym otwarciu.
 *
 * @param props - Właściwości komponentu.
 * @param props.target - Wydatek i kwota.
 * @param props.onDone - Zamknięcie po zapisie.
 * @returns Element formularza.
 */
function SetAsideForm({
  target,
  onDone,
}: {
  target: SetAsideTarget;
  onDone: () => void;
}): ReactNode {
  const { item } = target;
  const navigate = useNavigate();
  const accounts = useAccountList(false);
  const mutation = useSetAside();
  const { show } = useToast();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [picking, setPicking] = useState(false);
  const [amountMinor, setAmountMinor] = useState(
    () => target.amountMinor ?? item.setAside.monthlyRequiredMinor,
  );
  const [fromId, setFromId] = useState<string | null>(item.accountId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const { household } = useAuth();
  const list = accounts.data ?? [];
  const toId = item.setAside.accountId;
  // Źródło domyślnie jak w formularzu transakcji — domyślne konto wydatków (ADR-070)
  // albo pierwsze konto na wydatki.
  const from =
    fromId ??
    defaultAccountId(
      list.filter((account) => account.id !== toId),
      household?.defaultExpenseAccountId ?? null,
    );
  const nameOf = (id: string | null): string =>
    id === null ? 'Wybierz' : (list.find((account) => account.id === id)?.name ?? '…');

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    const next: Record<string, string> = {};
    if (amountMinor <= 0) next.amountMinor = 'Wpisz kwotę większą od zera';
    if (from === null) next.fromAccountId = 'Wybierz konto, z którego';
    setErrors(next);
    if (from === null || Object.keys(next).length > 0) return;
    mutation.mutate(
      { id: item.id, body: { amountMinor, fromAccountId: from }, idempotencyKey },
      {
        onSuccess: () => {
          show({ message: `Odłożono na „${item.name}”` });
          onDone();
        },
        onError: (error) => {
          setFormError(error.message);
          if (error instanceof ApiRequestError) setErrors(error.fieldErrors());
        },
      },
    );
  };

  if (picking) {
    return (
      <AccountPicker
        accounts={list}
        excludeId={toId}
        onBack={() => {
          setPicking(false);
        }}
        onManageAccounts={() => {
          void navigate('/accounts');
        }}
        onSelect={(accountId) => {
          setFromId(accountId);
          setPicking(false);
        }}
        selectedId={from}
        title="Z konta"
      />
    );
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <AmountInput
        autoFocus
        defaultValueMinor={amountMinor}
        error={errors.amountMinor}
        label="Kwota"
        onChange={setAmountMinor}
      />
      <div>
        <Field
          label="Z konta"
          onOpen={() => {
            setPicking(true);
          }}
          value={nameOf(from)}
        />
        {errors.fromAccountId === undefined ? null : (
          <p className="pb-2 text-caption text-danger" role="alert">
            {errors.fromAccountId}
          </p>
        )}
        <p className="flex min-h-touch items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Na konto</span>
          <span>{toId === null ? 'konto celu' : nameOf(toId)}</span>
        </p>
      </div>
      <div className="sticky bottom-0 -mx-4 border-t border-border bg-card px-4 pb-2 pt-3">
        {formError === undefined ? null : (
          <p className="mb-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Button loading={mutation.isPending} size="large" type="submit" variant="primary">
          Odłóż
        </Button>
      </div>
    </form>
  );
}

/** Właściwości arkusza. */
export interface SetAsideSheetProps {
  /** Wydatek i kwota; `null` — arkusz zamknięty. */
  target: SetAsideTarget | null;
  onClose: () => void;
}

/**
 * Arkusz „Odłóż teraz".
 *
 * @param props - Właściwości komponentu.
 * @param props.target - Wydatek i kwota.
 * @param props.onClose - Zamknięcie.
 * @returns Element arkusza.
 */
export function SetAsideSheet({ target, onClose }: SetAsideSheetProps): ReactNode {
  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={target !== null}
      title={target === null ? 'Odłóż' : `Odłóż na „${target.item.name}”`}
    >
      {target === null ? null : (
        <SetAsideForm key={target.item.id} onDone={onClose} target={target} />
      )}
    </Sheet>
  );
}
