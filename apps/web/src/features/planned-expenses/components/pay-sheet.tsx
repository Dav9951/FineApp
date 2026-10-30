import { formatMonth, type PlannedExpenseDto } from '@fineapp/shared';
import { Info } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  AmountInput,
  Button,
  Field,
  Money,
  Sheet,
  useToast,
} from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { AccountPicker } from '../../transactions/components/transaction-pickers.js';
import { useAuth } from '../../auth/auth-context.js';
import { defaultAccountId } from '../../transactions/transaction-form-state.js';
import { usePostPlannedExpense } from '../hooks/use-planned-expenses.js';
import { nextInstanceMonth } from '../planned-form-state.js';

/**
 * „Zapłacone" — `POST /planned-expenses/:id/post` (`F6-3`, `F6-8`, 06 §3.10).
 *
 * Formularz z wpisaną kwotą szacunkową do skorygowania: szacunek prawie nigdy nie jest
 * kwotą z rachunku, a przy powtarzaniu co rok to **zapłacona** kwota staje się szacunkiem
 * na kolejny rok (07 §6.5), więc warto ją poprawić teraz. Jeden klucz idempotencji na
 * otwarcie — ponowienie nie zaksięguje drugi raz.
 */

/**
 * Treść arkusza — montowana od nowa przy każdym otwarciu.
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Wydatek.
 * @param props.onDone - Zamknięcie po zapisie.
 * @returns Element formularza.
 */
function PayForm({ item, onDone }: { item: PlannedExpenseDto; onDone: () => void }): ReactNode {
  const navigate = useNavigate();
  const accounts = useAccountList(false);
  const mutation = usePostPlannedExpense();
  const { show } = useToast();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [picking, setPicking] = useState(false);
  const [amountMinor, setAmountMinor] = useState(item.estimatedAmountMinor);
  const [accountId, setAccountId] = useState<string | null>(item.accountId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const { household } = useAuth();
  const list = accounts.data ?? [];
  const account = accountId ?? defaultAccountId(list, household?.defaultExpenseAccountId ?? null);
  const accountName =
    account === null ? 'Wybierz' : (list.find((entry) => entry.id === account)?.name ?? '…');
  const next = item.repeatsYearly ? nextInstanceMonth(item.dueMonth) : null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    const nextErrors: Record<string, string> = {};
    if (amountMinor <= 0) nextErrors.amountMinor = 'Wpisz kwotę z rachunku';
    if (account === null) nextErrors.accountId = 'Wybierz konto';
    setErrors(nextErrors);
    if (account === null || Object.keys(nextErrors).length > 0) return;
    mutation.mutate(
      { id: item.id, body: { amountMinor, accountId: account }, idempotencyKey },
      {
        onSuccess: ({ data }) => {
          show({
            message:
              data.nextInstance === null
                ? `Zapłacono „${item.name}”`
                : `Zapłacono „${item.name}” — wpis na ${formatMonth(data.nextInstance.dueMonth)} gotowy`,
          });
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
        onBack={() => {
          setPicking(false);
        }}
        onManageAccounts={() => {
          void navigate('/accounts');
        }}
        onSelect={(selected) => {
          setAccountId(selected);
          setPicking(false);
        }}
        selectedId={account}
        title="Z konta"
      />
    );
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <p className="text-sm text-muted-foreground">
        Szacowano <Money amountMinor={item.estimatedAmountMinor} size="sm" />. Wpisz kwotę z
        rachunku — tyle trafi do historii.
      </p>
      <AmountInput
        autoFocus
        defaultValueMinor={item.estimatedAmountMinor}
        error={errors.amountMinor}
        label="Kwota z rachunku"
        onChange={setAmountMinor}
      />
      <div>
        <Field
          label="Z konta"
          onOpen={() => {
            setPicking(true);
          }}
          value={accountName}
        />
        {errors.accountId === undefined ? null : (
          <p className="pb-2 text-caption text-danger" role="alert">
            {errors.accountId}
          </p>
        )}
      </div>
      {next === null ? null : (
        <p className="flex items-start gap-1 text-caption text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          Utworzymy wpis na {formatMonth(next)} z tą kwotą.
        </p>
      )}
      <div className="sticky bottom-0 -mx-4 border-t border-border bg-card px-4 pb-2 pt-3">
        {formError === undefined ? null : (
          <p className="mb-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Button loading={mutation.isPending} size="large" type="submit" variant="primary">
          Zapłacone
        </Button>
      </div>
    </form>
  );
}

/** Właściwości arkusza. */
export interface PaySheetProps {
  /** Wydatek do zapłaty; `null` — arkusz zamknięty. */
  item: PlannedExpenseDto | null;
  onClose: () => void;
}

/**
 * Arkusz „Zapłacone".
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Wydatek.
 * @param props.onClose - Zamknięcie.
 * @returns Element arkusza.
 */
export function PaySheet({ item, onClose }: PaySheetProps): ReactNode {
  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={item !== null}
      title={item === null ? 'Zapłacone' : `Zapłacone: „${item.name}”`}
    >
      {item === null ? null : <PayForm item={item} key={item.id} onDone={onClose} />}
    </Sheet>
  );
}
