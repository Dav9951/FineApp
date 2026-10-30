import {
  formatMonth,
  type BudgetLineDto,
  type MonthKey,
  type PlannedExpensePriority,
} from '@fineapp/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button, Field, OptionGrid, TextField, useToast } from '../../../components/ui/index.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { useAuth } from '../../auth/auth-context.js';
import { PRIORITY_LABEL, PRIORITY_ORDER } from '../../planned-expenses/planned-view.js';
import { SwitchRow } from '../../recurring/components/recurring-form-sheet.js';
import { ScheduleFields } from '../../recurring/components/schedule-fields.js';
import { AccountPicker, PickerHeader } from '../../transactions/components/transaction-pickers.js';
import {
  promoteFormFrom,
  toPromoteRequest,
  type PromoteFormErrors,
  type PromoteFormState,
} from '../budget-form-state.js';
import { usePromoteBudgetLine } from '../hooks/use-budget.js';

/**
 * Zamiana linii własnej w pozycję cykliczną albo planowany (nadchodzący) wydatek
 * ([07 §13.6](../../../../../../plans/07-domain-rules.md#136-zamiana-linii-w-byt), ADR-077).
 *
 * Pola jak w formularzach reguły i planowanego wydatku — te same komponenty terminarza
 * i wyboru konta. Klucz idempotencji jeden na otwarcie: powtórzone dotknięcie na słabym
 * łączu nie założy drugiej reguły.
 */

/** Opcje ważności planowanego wydatku. */
const PRIORITY_OPTIONS = PRIORITY_ORDER.map((value) => ({ value, label: PRIORITY_LABEL[value] }));

/** Właściwości formularza zamiany. */
export interface BudgetPromoteFormProps {
  line: BudgetLineDto;
  target: 'recurring' | 'planned';
  month: MonthKey;
  onBack: () => void;
  onDone: () => void;
}

/**
 * Formularz zamiany.
 *
 * @param props - Właściwości komponentu.
 * @param props.line - Linia własna.
 * @param props.target - Cel zamiany.
 * @param props.month - Miesiąc planu.
 * @param props.onBack - Powrót do arkusza linii.
 * @param props.onDone - Zamknięcie arkusza po zamianie.
 * @returns Element formularza.
 */
export function BudgetPromoteForm({
  line,
  target,
  month,
  onBack,
  onDone,
}: BudgetPromoteFormProps): ReactNode {
  const navigate = useNavigate();
  const { show } = useToast();
  const { household } = useAuth();
  const accounts = useAccountList(false);
  const promote = usePromoteBudgetLine(month);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<PromoteFormState>(() =>
    promoteFormFrom(line, target, month, household?.defaultExpenseAccountId ?? null),
  );
  const [errors, setErrors] = useState<PromoteFormErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState<'accountId' | 'counterAccountId' | null>(null);
  const isPool = line.flow === 'savings' || line.flow === 'investment';

  const change = (patch: Partial<PromoteFormState>): void => {
    setState((current) => ({ ...current, ...patch }));
    setErrors({});
  };

  if (picking !== null) {
    return (
      <AccountPicker
        accounts={accounts.data ?? []}
        excludeId={picking === 'accountId' ? state.counterAccountId : state.accountId}
        onBack={() => {
          setPicking(null);
        }}
        onManageAccounts={() => {
          void navigate('/accounts');
        }}
        onSelect={(accountId) => {
          change({ [picking]: accountId });
          setPicking(null);
        }}
        selectedId={state[picking]}
        title={picking === 'accountId' ? 'Z konta' : 'Na konto'}
      />
    );
  }

  const accountName = (id: string | null): string =>
    id === null ? 'Wybierz' : (accounts.data?.find((account) => account.id === id)?.name ?? '…');

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    const result = toPromoteRequest(state, line);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    promote.mutate(
      { lineId: line.id, body: result.body, idempotencyKey },
      {
        onSuccess: (data) => {
          onDone();
          show({
            message:
              data.created.kind === 'recurring_rule'
                ? `„${line.name}” jest teraz pozycją cykliczną.`
                : data.lineMovedTo === null
                  ? `„${line.name}” jest teraz planowanym wydatkiem.`
                  : `„${line.name}” przeniesiono do planowanych na ${formatMonth(data.lineMovedTo)}.`,
          });
        },
        onError: (error) => {
          setFormError(error.message);
        },
      },
    );
  };

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <PickerHeader
        onBack={onBack}
        title={target === 'recurring' ? 'Pozycja cykliczna' : 'Planowany wydatek'}
      />
      {target === 'recurring' ? (
        <>
          <p className="text-sm text-muted-foreground">
            Od {formatMonth(month)}, z kwotą z planu. Kolejne plany dostaną ją same.
          </p>
          <ScheduleFields
            errors={errors}
            onChange={(patch) => {
              change(patch);
            }}
            value={state}
          />
          <div>
            <Field
              label={isPool ? 'Z konta' : 'Konto'}
              onOpen={() => {
                setPicking('accountId');
              }}
              value={accountName(state.accountId)}
            />
            {errors.accountId === undefined ? null : (
              <p className="pb-2 text-caption text-danger" role="alert">
                {errors.accountId}
              </p>
            )}
            {isPool ? (
              <>
                <Field
                  label="Na konto"
                  onOpen={() => {
                    setPicking('counterAccountId');
                  }}
                  value={accountName(state.counterAccountId)}
                />
                {errors.counterAccountId === undefined ? null : (
                  <p className="pb-2 text-caption text-danger" role="alert">
                    {errors.counterAccountId}
                  </p>
                )}
              </>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Pojawi się w „Nadchodzące”, a w swoim miesiącu w „Do zrobienia”.
          </p>
          <TextField
            label="Kiedy"
            onChange={(dueMonth) => {
              change({ dueMonth });
            }}
            type="month"
            value={state.dueMonth}
          />
          <SwitchRow
            checked={state.knowsDate}
            label="Znam dokładną datę"
            onChange={(knowsDate) => {
              change({ knowsDate });
            }}
          />
          {state.knowsDate ? (
            <TextField
              error={errors.dueOn}
              label="Data"
              onChange={(dueOn) => {
                change({ dueOn });
              }}
              type="date"
              value={state.dueOn}
            />
          ) : null}
          <OptionGrid
            legend="Ważność"
            onChange={(priority: PlannedExpensePriority) => {
              change({ priority });
            }}
            options={PRIORITY_OPTIONS}
            value={state.priority}
          />
        </>
      )}
      <div className="sticky bottom-0 -mx-4 border-t border-border bg-card px-4 pb-2 pt-3">
        {formError === undefined ? null : (
          <p className="mb-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Button loading={promote.isPending} size="large" type="submit" variant="primary">
          {target === 'recurring' ? 'Zapisz jako cykliczną' : 'Zapisz jako planowany'}
        </Button>
      </div>
    </form>
  );
}
