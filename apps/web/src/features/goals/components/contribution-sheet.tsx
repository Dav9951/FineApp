import type { GoalDto } from '@fineapp/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { AmountInput, Button, Field, Sheet, useToast } from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { useAuth } from '../../auth/auth-context.js';
import { defaultAccountId } from '../../transactions/transaction-form-state.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { AccountPicker } from '../../transactions/components/transaction-pickers.js';
import { useContribute } from '../hooks/use-goals.js';

/**
 * Wpłata na cel — `POST /goals/:id/contributions` (`F5-5`, 06 §3.5 „[Wpłać]").
 *
 * Kwota proponowana to brakująca część planu miesiąca: jedno dotknięcie „Wpłać" domyka
 * plan. Przelew idzie z konta na wydatki na konto celu — oba do zmiany. Jeden klucz
 * idempotencji na otwarcie arkusza: ponowienie po zerwanym połączeniu nie przeleje
 * drugi raz (ADR-037).
 */

/** Widok arkusza. */
type View = 'form' | 'from' | 'to';

/**
 * Kwota proponowana: brakująca część planu miesiąca, gdy jest.
 *
 * @param goal - Cel.
 * @returns Grosze; `0` — bez propozycji.
 */
export function suggestedContribution(goal: Pick<GoalDto, 'contribution'>): number {
  const planned = goal.contribution.plannedAmountMinor ?? 0;
  return Math.max(0, planned - Math.max(0, goal.contribution.contributedThisMonthMinor));
}

/**
 * Treść arkusza — montowana od nowa przy każdym otwarciu.
 *
 * @param props - Właściwości komponentu.
 * @param props.goal - Cel.
 * @param props.onDone - Zamknięcie po zapisie.
 * @returns Element formularza.
 */
function ContributionForm({ goal, onDone }: { goal: GoalDto; onDone: () => void }): ReactNode {
  const navigate = useNavigate();
  const accounts = useAccountList(false);
  const contribute = useContribute();
  const { show } = useToast();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [view, setView] = useState<View>('form');
  const [amountMinor, setAmountMinor] = useState(() => suggestedContribution(goal));
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(goal.linkedAccountId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const { household } = useAuth();
  const list = accounts.data ?? [];
  // Konto źródłowe domyślnie jak w formularzu transakcji — domyślne konto wydatków
  // (ADR-070) albo pierwsze na wydatki.
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
    if (toId === null) next.toAccountId = 'Wybierz konto, na które';
    setErrors(next);
    if (from === null || toId === null || Object.keys(next).length > 0) return;
    contribute.mutate(
      {
        goalId: goal.id,
        body: { amountMinor, fromAccountId: from, toAccountId: toId },
        idempotencyKey,
      },
      {
        onSuccess: () => {
          show({ message: `Wpłacono na „${goal.name}”` });
          onDone();
        },
        onError: (error) => {
          setFormError(error.message);
          if (error instanceof ApiRequestError) setErrors(error.fieldErrors());
        },
      },
    );
  };

  if (view !== 'form') {
    const choosingFrom = view === 'from';
    return (
      <AccountPicker
        accounts={list}
        excludeId={choosingFrom ? toId : from}
        onBack={() => {
          setView('form');
        }}
        onManageAccounts={() => {
          void navigate('/accounts');
        }}
        onSelect={(accountId) => {
          if (choosingFrom) setFromId(accountId);
          else setToId(accountId);
          setView('form');
        }}
        selectedId={choosingFrom ? from : toId}
        title={choosingFrom ? 'Z konta' : 'Na konto'}
      />
    );
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <AmountInput
        autoFocus
        defaultValueMinor={amountMinor}
        error={errors.amountMinor}
        label="Kwota wpłaty"
        onChange={setAmountMinor}
      />
      <div>
        <Field
          label="Z konta"
          onOpen={() => {
            setView('from');
          }}
          value={nameOf(from)}
        />
        {errors.fromAccountId === undefined ? null : (
          <p className="pb-2 text-caption text-danger" role="alert">
            {errors.fromAccountId}
          </p>
        )}
        <Field
          label="Na konto"
          onOpen={() => {
            setView('to');
          }}
          value={nameOf(toId)}
        />
        {errors.toAccountId === undefined ? null : (
          <p className="pb-2 text-caption text-danger" role="alert">
            {errors.toAccountId}
          </p>
        )}
      </div>
      <div className="sticky bottom-0 -mx-4 border-t border-border bg-card px-4 pb-2 pt-3">
        {formError === undefined ? null : (
          <p className="mb-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Button loading={contribute.isPending} size="large" type="submit" variant="primary">
          Wpłać
        </Button>
      </div>
    </form>
  );
}

/** Właściwości arkusza wpłaty. */
export interface ContributionSheetProps {
  /** Cel, na który wpłacamy; `null` — arkusz zamknięty. */
  goal: GoalDto | null;
  onClose: () => void;
}

/**
 * Arkusz wpłaty na cel.
 *
 * @param props - Właściwości komponentu.
 * @param props.goal - Cel.
 * @param props.onClose - Zamknięcie.
 * @returns Element arkusza.
 */
export function ContributionSheet({ goal, onClose }: ContributionSheetProps): ReactNode {
  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={goal !== null}
      title={goal === null ? 'Wpłata' : `Wpłata na „${goal.name}”`}
    >
      {goal === null ? null : <ContributionForm goal={goal} key={goal.id} onDone={onClose} />}
    </Sheet>
  );
}
