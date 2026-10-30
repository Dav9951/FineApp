import {
  formatMonth,
  monthKeyOf,
  todayInTimezone,
  type MonthKey,
  type PlannedExpenseDto,
  type PlannedExpensePriority,
} from '@fineapp/shared';
import { Info } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  AmountInput,
  Button,
  Field,
  Money,
  OptionGrid,
  Sheet,
  TextField,
  useToast,
} from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { pluralPl } from '../../../lib/format.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { useAuth } from '../../auth/auth-context.js';
import { useCategoryTree } from '../../categories/hooks/use-categories.js';
import { useGoals } from '../../goals/hooks/use-goals.js';
import { SwitchRow } from '../../recurring/components/recurring-form-sheet.js';
import {
  AccountPicker,
  CategoryPicker,
  GoalPicker,
} from '../../transactions/components/transaction-pickers.js';
import { categoryLabel } from '../../transactions/transaction-view.js';
import {
  useCancelPlannedExpense,
  useCreatePlannedExpense,
  useDeletePlannedExpense,
  useUpdatePlannedExpense,
} from '../hooks/use-planned-expenses.js';
import {
  emptyPlannedForm,
  formErrorsFromApi,
  nextInstanceMonth,
  plannedFormFrom,
  setAsidePreview,
  toCreateRequest,
  toUpdateRequest,
  type PlannedFormErrors,
  type PlannedFormState,
  type PlannedPreset,
} from '../planned-form-state.js';
import { PRIORITY_LABEL, PRIORITY_ORDER } from '../planned-view.js';

/**
 * Formularz planowanego wydatku w arkuszu
 * ([06 §3.10](../../../../../../plans/06-ui-views.md#310-planowane-wydatki--planned), `F6-7`).
 *
 * Wiersz „Trzeba odkładać X przez N mies." przelicza się przy każdej zmianie kwoty, terminu
 * i „Już mam" — w przeglądarce, tą samą funkcją co serwer (07 §6.5), bez żądania. Ma być
 * widoczny zanim użytkownik zapisze, bo to on odpowiada na pytanie „czy mnie na to stać".
 */

/** Opcje ważności. */
const PRIORITY_OPTIONS = PRIORITY_ORDER.map((value) => ({ value, label: PRIORITY_LABEL[value] }));

/** Widok arkusza: formularz albo jeden z pickerów. */
type View = 'form' | 'category' | 'account' | 'goal';

/**
 * Komunikat błędu pola pod polem wyboru.
 *
 * @param props - Właściwości komponentu.
 * @param props.message - Komunikat albo `undefined`.
 * @returns Element komunikatu albo pusty.
 */
function FieldError({ message }: { message: string | undefined }): ReactNode {
  return message === undefined ? null : (
    <p className="pb-2 text-caption text-danger" role="alert">
      {message}
    </p>
  );
}

/**
 * Wiersz informacyjny z ikoną.
 *
 * @param props - Właściwości komponentu.
 * @param props.children - Treść.
 * @returns Element wiersza.
 */
function InfoLine({ children }: { children: ReactNode }): ReactNode {
  return (
    <p aria-live="polite" className="flex items-start gap-1 text-caption text-muted-foreground">
      <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
      <span>{children}</span>
    </p>
  );
}

/** Właściwości treści formularza. */
interface PlannedFormProps {
  /** Wydatek do edycji; brak = nowy. */
  item?: PlannedExpenseDto;
  /** Wartości z góry dla nowego (`F6-9`). */
  preset?: PlannedPreset;
  onDone: () => void;
}

/**
 * Treść formularza — montowana od nowa przy każdym otwarciu arkusza.
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Wydatek do edycji.
 * @param props.preset - Wartości z góry.
 * @param props.onDone - Zamknięcie po zapisie, odwołaniu albo usunięciu.
 * @returns Element formularza.
 */
function PlannedForm({ item, preset, onDone }: PlannedFormProps): ReactNode {
  const navigate = useNavigate();
  const { show } = useToast();
  const { household } = useAuth();
  const [currentMonth] = useState<MonthKey>(() =>
    monthKeyOf(todayInTimezone(household?.timezone ?? 'Europe/Warsaw'), household?.monthStartDay),
  );
  const [state, setState] = useState<PlannedFormState>(() =>
    item === undefined ? emptyPlannedForm(currentMonth, preset) : plannedFormFrom(item),
  );
  const [view, setView] = useState<View>('form');
  const [errors, setErrors] = useState<PlannedFormErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);

  const accounts = useAccountList(false);
  const categories = useCategoryTree('expense');
  const goals = useGoals(currentMonth, state.setAsideGoalId !== null);
  const create = useCreatePlannedExpense();
  const update = useUpdatePlannedExpense();
  const cancel = useCancelPlannedExpense();
  const remove = useDeletePlannedExpense();
  const pending = create.isPending || update.isPending;

  /**
   * Zmienia pola i czyści ich błędy.
   *
   * @param patch - Zmienione pola.
   */
  const change = (patch: Partial<PlannedFormState>): void => {
    setState((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key as keyof PlannedFormState];
      return next;
    });
  };

  /**
   * Zamyka wybór i wraca do formularza z nową wartością.
   *
   * @param patch - Wybrana wartość.
   */
  const choose = (patch: Partial<PlannedFormState>): void => {
    change(patch);
    setView('form');
  };

  const handleError = (error: Error): void => {
    setFormError(error.message);
    if (error instanceof ApiRequestError) setErrors(formErrorsFromApi(error.fieldErrors()));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    if (item === undefined) {
      const result = toCreateRequest(state);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      create.mutate(result.body, { onSuccess: onDone, onError: handleError });
      return;
    }
    const result = toUpdateRequest(item, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (Object.keys(result.body).length === 0) {
      onDone();
      return;
    }
    update.mutate({ id: item.id, body: result.body }, { onSuccess: onDone, onError: handleError });
  };

  // --- Widoki wyboru -------------------------------------------------------------------
  const back = (): void => {
    setView('form');
  };
  if (view === 'category') {
    return (
      <CategoryPicker
        kind="expense"
        onBack={back}
        onSelect={(categoryId) => {
          choose({ categoryId });
        }}
        selectedId={state.categoryId}
      />
    );
  }
  if (view === 'account') {
    return (
      <AccountPicker
        accounts={accounts.data ?? []}
        onBack={back}
        onManageAccounts={() => {
          void navigate('/accounts');
        }}
        onSelect={(setAsideAccountId) => {
          choose({ setAsideAccountId });
        }}
        selectedId={state.setAsideAccountId}
        title="Gdzie odkładać"
      />
    );
  }
  if (view === 'goal') {
    return (
      <GoalPicker
        month={currentMonth}
        onBack={back}
        onSelect={(goal) => {
          // Cel z kontem od razu wskazuje miejsce odkładania — jeden wybór zamiast dwóch.
          choose({
            setAsideGoalId: goal?.id ?? null,
            ...(goal?.linkedAccountId && state.setAsideAccountId === null
              ? { setAsideAccountId: goal.linkedAccountId }
              : {}),
          });
        }}
        selectedId={state.setAsideGoalId}
      />
    );
  }

  // --- Formularz -----------------------------------------------------------------------
  const categoryName =
    state.categoryId === null
      ? 'Bez kategorii'
      : (categoryLabel(categories.data ?? [], state.categoryId) ?? '…');
  const accountName =
    state.setAsideAccountId === null
      ? 'Wybierz'
      : (accounts.data?.find((account) => account.id === state.setAsideAccountId)?.name ?? '…');
  const goalName =
    state.setAsideGoalId === null
      ? 'Bez celu'
      : (goals.data?.data.find((goal) => goal.id === state.setAsideGoalId)?.name ?? '…');
  const contributed =
    item === undefined ? 0 : item.setAside.accumulatedMinor - item.alreadySetAsideMinor;
  const preview = setAsidePreview(state, currentMonth, contributed);
  const nextMonth = nextInstanceMonth(state.dueMonth);
  const editable = item === undefined || (item.status !== 'posted' && item.status !== 'cancelled');

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <TextField
        autoFocus={item === undefined && preset?.name === undefined}
        error={errors.name}
        label="Nazwa"
        maxLength={60}
        onChange={(name) => {
          change({ name });
        }}
        placeholder="np. OC + AC samochód"
        value={state.name}
      />

      <div>
        <AmountInput
          defaultValueMinor={state.amountMinor}
          error={errors.amountMinor}
          label="Szacowana kwota"
          onChange={(amountMinor) => {
            change({ amountMinor });
          }}
        />
        <SwitchRow
          checked={state.amountIsEstimate}
          hint="Przy zapłacie wpiszesz kwotę z rachunku."
          label="To tylko szacunek"
          onChange={(amountIsEstimate) => {
            change({ amountIsEstimate });
          }}
        />
      </div>

      <div>
        <TextField
          error={errors.dueMonth}
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
      </div>

      <div>
        <Field
          label="Kategoria"
          onOpen={() => {
            setView('category');
          }}
          value={categoryName}
        />
        <FieldError message={errors.categoryId} />
      </div>

      <OptionGrid
        legend="Ważność"
        onChange={(priority: PlannedExpensePriority) => {
          change({ priority });
        }}
        options={PRIORITY_OPTIONS}
        value={state.priority}
      />

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <SwitchRow
          checked={state.setAsideEnabled}
          hint="Co miesiąc przelew na osobne konto albo cel — w terminie pieniądze czekają."
          label="Odkładaj co miesiąc"
          onChange={(setAsideEnabled) => {
            change({ setAsideEnabled });
          }}
        />
        {state.setAsideEnabled ? (
          <>
            <div>
              <Field
                label="Gdzie"
                onOpen={() => {
                  setView('account');
                }}
                value={accountName}
              />
              <FieldError message={errors.setAsideAccountId} />
              <Field
                label="Na cel"
                onOpen={() => {
                  setView('goal');
                }}
                value={goalName}
              />
            </div>
            <TextField
              error={errors.alreadyText}
              hint="Ile już jest odłożone poza aplikacją."
              inputMode="decimal"
              label="Już mam (zł)"
              onChange={(alreadyText) => {
                change({ alreadyText });
              }}
              placeholder="0"
              value={state.alreadyText}
            />
          </>
        ) : null}
        {preview === null ? null : preview.monthlyMinor === 0 ? (
          <InfoLine>Cała kwota jest już odłożona.</InfoLine>
        ) : state.setAsideEnabled ? (
          <InfoLine>
            Trzeba odkładać <Money amountMinor={preview.monthlyMinor} size="meta" /> przez{' '}
            {String(preview.monthsLeft)} {pluralPl(preview.monthsLeft, 'miesiąc', 'mies.', 'mies.')}
            .
          </InfoLine>
        ) : (
          <InfoLine>
            Odkładając, wystarczy <Money amountMinor={preview.monthlyMinor} size="meta" /> co
            miesiąc.
          </InfoLine>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <SwitchRow
          checked={state.repeatsYearly}
          label="Powtarzaj co rok"
          onChange={(repeatsYearly) => {
            change({ repeatsYearly });
          }}
        />
        {state.repeatsYearly && nextMonth !== null ? (
          <InfoLine>
            Po zapłacie utworzymy wpis na {formatMonth(nextMonth)} z faktycznie zapłaconą kwotą.
          </InfoLine>
        ) : null}
      </div>

      <TextField
        error={errors.notes}
        label="Notatka"
        maxLength={1000}
        onChange={(notes) => {
          change({ notes });
        }}
        value={state.notes}
      />

      {item === undefined ? null : confirm === null ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {editable ? (
            <Button
              disabled={pending}
              onClick={() => {
                setConfirm('cancel');
              }}
              type="button"
              variant="ghost"
            >
              Odwołaj wydatek
            </Button>
          ) : null}
          <Button
            disabled={pending}
            onClick={() => {
              setConfirm('delete');
            }}
            type="button"
            variant="ghost"
          >
            Usuń
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-danger p-3">
          <p className="text-sm">
            {confirm === 'cancel'
              ? `Odwołać „${item.name}”? Zniknie z planu, a odłożone pieniądze zostaną na koncie.`
              : `Usunąć „${item.name}” na stałe? Przelewy odkładania zostaną w historii jako zwykłe przelewy.`}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => {
                setConfirm(null);
              }}
              type="button"
              variant="ghost"
            >
              Wróć
            </Button>
            <Button
              loading={cancel.isPending || remove.isPending}
              onClick={() => {
                const handlers = {
                  onSuccess: () => {
                    onDone();
                    show({
                      message: `${confirm === 'cancel' ? 'Odwołano' : 'Usunięto'} „${item.name}”`,
                    });
                  },
                  onError: (error: Error) => {
                    setConfirm(null);
                    setFormError(error.message);
                  },
                };
                if (confirm === 'cancel') cancel.mutate(item.id, handlers);
                else remove.mutate(item.id, handlers);
              }}
              type="button"
              variant="danger"
            >
              {confirm === 'cancel' ? 'Odwołaj' : 'Usuń'}
            </Button>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-card px-4 pb-2 pt-3">
        {formError === undefined ? null : (
          <p className="mb-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Button disabled={!editable} loading={pending} size="large" type="submit" variant="primary">
          {item === undefined ? 'Dodaj wydatek' : 'Zapisz zmiany'}
        </Button>
      </div>
    </form>
  );
}

/** Właściwości arkusza. */
export interface PlannedFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wydatek do edycji; brak = nowy. */
  item?: PlannedExpenseDto;
  /** Wartości z góry dla nowego. */
  preset?: PlannedPreset;
}

/**
 * Arkusz z formularzem nowego albo edytowanego wydatku.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.item - Wydatek do edycji.
 * @param props.preset - Wartości z góry.
 * @returns Element arkusza.
 */
export function PlannedFormSheet({
  open,
  onOpenChange,
  item,
  preset,
}: PlannedFormSheetProps): ReactNode {
  return (
    <Sheet
      onOpenChange={onOpenChange}
      open={open}
      title={item === undefined ? 'Nowy planowany wydatek' : 'Edytuj wydatek'}
    >
      {open ? (
        <PlannedForm
          item={item}
          key={item?.id ?? 'new'}
          onDone={() => {
            onOpenChange(false);
          }}
          preset={preset}
        />
      ) : null}
    </Sheet>
  );
}
