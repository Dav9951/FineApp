import {
  formatMonth,
  monthKeyOf,
  todayInTimezone,
  type ContributionMode,
  type GoalDto,
  type GoalKind,
  type GoalPurpose,
  type ProgressSource,
} from '@fineapp/shared';
import { ArrowLeftRight, Info } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Button,
  Field,
  Money,
  OptionGrid,
  Sheet,
  TextField,
} from '../../../components/ui/index.js';
import { useDebouncedValue } from '../../../hooks/use-debounced-value.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { useAuth } from '../../auth/auth-context.js';
import { AccountPicker } from '../../transactions/components/transaction-pickers.js';
import {
  convertedText,
  convertRequest,
  editConverter,
  emptyGoalForm,
  formErrorsFromApi,
  goalFormFrom,
  percentToText,
  QUICK_PERCENTS,
  settleConverter,
  switchMode,
  toCreateRequest,
  toUpdateRequest,
  type GoalFormErrors,
  type GoalFormState,
} from '../goal-form-state.js';
import {
  GOAL_KIND_LABEL,
  GOAL_PURPOSE_ICON,
  GOAL_PURPOSE_LABEL,
  GOAL_PURPOSE_ORDER,
  percentOneDecimal,
} from '../goals-view.js';
import {
  useCompleteGoal,
  useConvertContribution,
  useCreateGoal,
  useDeleteGoal,
  useUpdateGoal,
} from '../hooks/use-goals.js';

/**
 * Formularz celu w arkuszu
 * ([06 §3.5](../../../../../../plans/06-ui-views.md#35-cele--goals), `F5-6`).
 *
 * Sedno to przelicznik % ↔ kwota (wymaganie #6): oba pola są edytowalne i przeliczają się
 * nawzajem przez `POST /goals/convert` z opóźnieniem 300 ms. Przełącznik trybu mówi,
 * **co zostanie zapisane** — stała kwota czy procent wpływów — bo z tego wynika zachowanie
 * celu w kolejnych miesiącach (07 §3).
 */

/** Opóźnienie przelicznika po ostatnim znaku (06 §3.5). */
const CONVERT_DEBOUNCE_MS = 300;

/** Opcje rodzaju. */
const KIND_OPTIONS = (['savings', 'investment'] as const).map((kind) => ({
  value: kind,
  label: GOAL_KIND_LABEL[kind],
}));

/** Opcje źródła postępu. */
const PROGRESS_OPTIONS: readonly { value: ProgressSource; label: string }[] = [
  { value: 'contributions', label: 'Z wpłat na cel' },
  { value: 'account_balance', label: 'Z salda konta' },
];

/** Opcje trybu wpłaty — z nich wynika, co zostanie zapisane (07 §3). */
const MODE_OPTIONS: readonly { value: ContributionMode; label: string }[] = [
  { value: 'fixed', label: 'Stała kwota' },
  { value: 'percent_of_income', label: 'Procent wpływów' },
  { value: 'none', label: 'Bez planu' },
];

/** Opcje przeznaczenia z ikonami; „brak" jako pierwsza. */
const PURPOSE_OPTIONS: readonly { value: GoalPurpose | 'none'; label: string; icon?: ReactNode }[] =
  [
    { value: 'none', label: 'Bez przeznaczenia' },
    ...GOAL_PURPOSE_ORDER.map((purpose) => {
      const Icon = GOAL_PURPOSE_ICON[purpose];
      return {
        value: purpose,
        label: GOAL_PURPOSE_LABEL[purpose],
        icon: <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />,
      };
    }),
  ];

/** Widok arkusza: formularz albo wybór konta. */
type View = 'form' | 'account';

/**
 * Komunikat błędu pola pod wierszem wyboru.
 *
 * @param props - Właściwości komponentu.
 * @param props.message - Treść; brak — nic.
 * @returns Element albo `null`.
 */
function FieldError({ message }: { message: string | undefined }): ReactNode {
  return message === undefined ? null : (
    <p className="pb-2 text-caption text-danger" role="alert">
      {message}
    </p>
  );
}

/** Właściwości treści formularza. */
interface GoalFormProps {
  /** Cel do edycji; brak = nowy. */
  goal?: GoalDto;
  /** Rodzaj nowego celu — z zakładki ekranu. */
  kind: GoalKind;
  onDone: () => void;
}

/**
 * Treść formularza — montowana od nowa przy każdym otwarciu arkusza.
 *
 * @param props - Właściwości komponentu.
 * @param props.goal - Cel do edycji.
 * @param props.kind - Rodzaj nowego celu.
 * @param props.onDone - Zamknięcie po zapisie albo usunięciu.
 * @returns Element formularza.
 */
function GoalForm({ goal, kind, onDone }: GoalFormProps): ReactNode {
  const navigate = useNavigate();
  const { household } = useAuth();
  const month = monthKeyOf(
    todayInTimezone(household?.timezone ?? 'Europe/Warsaw'),
    household?.monthStartDay ?? 1,
  );
  const [state, setState] = useState<GoalFormState>(() =>
    goal === undefined ? emptyGoalForm(kind) : goalFormFrom(goal),
  );
  const [view, setView] = useState<View>('form');
  const [errors, setErrors] = useState<GoalFormErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const accounts = useAccountList(false);
  const create = useCreateGoal();
  const update = useUpdateGoal();
  const remove = useDeleteGoal();
  const complete = useCompleteGoal();
  const pending = create.isPending || update.isPending;

  const request = useDebouncedValue(convertRequest(state, month), CONVERT_DEBOUNCE_MS);
  const conversion = useConvertContribution(request);
  const liveRequest = convertRequest(state, month);
  const converted = convertedText(state, liveRequest, conversion.data);

  /**
   * Zmienia pola i czyści ich błędy.
   *
   * @param patch - Zmienione pola.
   */
  const change = (patch: Partial<GoalFormState>): void => {
    setState((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key as keyof GoalFormState];
      return next;
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    const settled = settleConverter(state, converted);
    const handlers = {
      onSuccess: onDone,
      onError: (error: Error) => {
        setFormError(error.message);
        if (error instanceof ApiRequestError) setErrors(formErrorsFromApi(error.fieldErrors()));
      },
    };
    if (goal === undefined) {
      const result = toCreateRequest(settled);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      create.mutate(result.body, handlers);
      return;
    }
    const result = toUpdateRequest(goal, settled);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (Object.keys(result.body).length === 0) {
      onDone();
      return;
    }
    update.mutate({ goalId: goal.id, body: result.body }, handlers);
  };

  if (view === 'account') {
    return (
      <AccountPicker
        accounts={accounts.data ?? []}
        onBack={() => {
          setView('form');
        }}
        onManageAccounts={() => {
          void navigate('/accounts');
        }}
        onSelect={(linkedAccountId) => {
          change({ linkedAccountId });
          setView('form');
        }}
        selectedId={state.linkedAccountId}
        title="Konto celu"
      />
    );
  }

  const accountName =
    state.linkedAccountId === null
      ? 'Brak'
      : (accounts.data?.find((account) => account.id === state.linkedAccountId)?.name ?? '…');
  // Pole wyliczane pokazuje wynik przelicznika; do jego przyjścia — pusto, nie starą liczbę.
  const amountValue =
    state.lastEdited === 'percent' && liveRequest !== null ? (converted ?? '') : state.amountText;
  const percentValue =
    state.lastEdited === 'amount' && liveRequest !== null ? (converted ?? '') : state.percentText;
  const base = conversion.data;

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <TextField
        autoFocus={goal === undefined}
        error={errors.name}
        label="Nazwa"
        maxLength={60}
        onChange={(name) => {
          change({ name });
        }}
        placeholder="np. Wkład własny"
        value={state.name}
      />

      <OptionGrid
        legend="Rodzaj"
        onChange={(value) => {
          change({ kind: value });
        }}
        options={KIND_OPTIONS}
        value={state.kind}
      />

      <div className="grid grid-cols-2 gap-3">
        <TextField
          error={errors.targetText}
          hint="Puste — cel bez kwoty, np. rosnąca poduszka."
          inputMode="decimal"
          label="Kwota docelowa (zł)"
          onChange={(targetText) => {
            change({ targetText });
          }}
          placeholder="np. 120 000"
          value={state.targetText}
        />
        <TextField
          error={errors.targetDate}
          label="Termin"
          onChange={(targetDate) => {
            change({ targetDate });
          }}
          type="date"
          value={state.targetDate}
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">Miesięczna wpłata</legend>
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
          <TextField
            error={errors.amountText}
            inputMode="decimal"
            label="kwota (zł)"
            onChange={(text) => {
              setState((current) => editConverter(current, 'amount', text));
              setErrors((current) => ({ ...current, amountText: undefined }));
            }}
            placeholder="np. 2000"
            value={amountValue}
          />
          <ArrowLeftRight
            aria-hidden="true"
            className="mt-9 h-5 w-5 text-muted-foreground"
            strokeWidth={1.5}
          />
          <TextField
            error={errors.percentText}
            inputMode="decimal"
            label="% wpływów"
            onChange={(text) => {
              setState((current) => editConverter(current, 'percent', text));
              setErrors((current) => ({ ...current, percentText: undefined }));
            }}
            placeholder="np. 17"
            value={percentValue}
          />
        </div>
        {base === undefined ? null : (
          <p className="text-caption text-muted-foreground">
            Podstawa: <Money amountMinor={base.incomeBaseMinor} size="meta" /> (
            {formatMonth(base.month)})
            {base.incomeBaseMinor === 0
              ? ' — brak wpływów, procent nie jest jeszcze określony'
              : ''}
          </p>
        )}
        {base?.isPartialMonth === true ? (
          <p className="flex items-start gap-1 text-caption text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            Miesiąc trwa — kwota procentu może się jeszcze zmienić.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2" role="group" aria-label="Szybki procent wpływów">
          {QUICK_PERCENTS.map((bps) => (
            <Button
              key={bps}
              onClick={() => {
                setState((current) => editConverter(current, 'percent', percentToText(bps)));
              }}
              size="small"
              type="button"
              variant="ghost"
            >
              {percentOneDecimal(bps).replace(',0', '')}
            </Button>
          ))}
        </div>

        <OptionGrid
          legend="Co zapisać"
          onChange={(mode) => {
            setState((current) => switchMode(current, mode, converted));
            setErrors((current) => ({ ...current, amountText: undefined, percentText: undefined }));
          }}
          options={MODE_OPTIONS}
          value={state.contributionMode}
        />
        <p className="text-caption text-muted-foreground">
          {state.contributionMode === 'fixed'
            ? 'Co miesiąc ta sama kwota — procent zmienia się wraz z wpływami.'
            : state.contributionMode === 'percent_of_income'
              ? 'Co miesiąc ten sam procent — kwota zmienia się wraz z wpływami.'
              : 'Cel śledzi tylko postęp, bez planu wpłat.'}
        </p>
      </fieldset>

      <OptionGrid
        legend="Postęp liczony"
        onChange={(value) => {
          change({ progressSource: value });
        }}
        options={PROGRESS_OPTIONS}
        value={state.progressSource}
      />
      <div>
        <Field
          hint={
            state.progressSource === 'account_balance'
              ? 'Postęp to saldo tego konta — z odsetkami.'
              : 'Wpłaty „Na cel" trafiają domyślnie tutaj.'
          }
          label="Konto celu"
          onOpen={() => {
            setView('account');
          }}
          value={accountName}
        />
        <FieldError message={errors.linkedAccountId} />
      </div>

      {state.progressSource === 'contributions' ? (
        <TextField
          error={errors.startingText}
          hint="Ile już było odłożone, zanim cel trafił do aplikacji."
          inputMode="decimal"
          label="Zebrane na start (zł)"
          onChange={(startingText) => {
            change({ startingText });
          }}
          placeholder="0"
          value={state.startingText}
        />
      ) : null}

      <OptionGrid
        legend="Przeznaczenie"
        onChange={(value) => {
          change({ purpose: value === 'none' ? null : value });
        }}
        options={PURPOSE_OPTIONS}
        value={state.purpose ?? 'none'}
      />

      {goal === undefined ? null : (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {goal.status === 'active' ? (
            <Button
              loading={complete.isPending}
              onClick={() => {
                complete.mutate(goal.id, { onSuccess: onDone });
              }}
              type="button"
              variant="ghost"
            >
              Oznacz jako osiągnięty
            </Button>
          ) : null}
          {confirmDelete ? (
            <div className="flex flex-col gap-2 rounded-md bg-danger/10 p-3">
              <p className="text-sm">
                Usunąć cel „{goal.name}”? Wpłaty zostaną w historii jako zwykłe przelewy.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={() => {
                    setConfirmDelete(false);
                  }}
                  type="button"
                  variant="ghost"
                >
                  Anuluj
                </Button>
                <Button
                  loading={remove.isPending}
                  onClick={() => {
                    remove.mutate(goal.id, { onSuccess: onDone });
                  }}
                  type="button"
                  variant="danger"
                >
                  Usuń
                </Button>
              </div>
            </div>
          ) : (
            <Button
              onClick={() => {
                setConfirmDelete(true);
              }}
              type="button"
              variant="ghost"
            >
              Usuń cel
            </Button>
          )}
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-card px-4 pb-2 pt-3">
        {formError === undefined ? null : (
          <p className="mb-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Button loading={pending} size="large" type="submit" variant="primary">
          {goal === undefined ? 'Dodaj cel' : 'Zapisz zmiany'}
        </Button>
      </div>
    </form>
  );
}

/** Właściwości arkusza celu. */
export interface GoalFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cel do edycji; brak = nowy. */
  goal?: GoalDto;
  /** Rodzaj nowego celu. */
  kind: GoalKind;
}

/**
 * Arkusz z formularzem nowego albo edytowanego celu.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.goal - Cel do edycji.
 * @param props.kind - Rodzaj nowego celu.
 * @returns Element arkusza.
 */
export function GoalFormSheet({ open, onOpenChange, goal, kind }: GoalFormSheetProps): ReactNode {
  return (
    <Sheet
      onOpenChange={onOpenChange}
      open={open}
      title={goal === undefined ? 'Nowy cel' : 'Edytuj cel'}
    >
      {open ? (
        <GoalForm
          goal={goal}
          key={goal?.id ?? 'new'}
          kind={kind}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      ) : null}
    </Sheet>
  );
}
