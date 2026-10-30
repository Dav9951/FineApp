import {
  formatDateOnly,
  monthKeyOf,
  TransactionTypeSchema,
  todayInTimezone,
  type RecurringRuleDto,
  type TransactionType,
} from '@fineapp/shared';
import { Info } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  AmountInput,
  Button,
  Field,
  Sheet,
  Switch,
  Tabs,
  TextField,
  useToast,
} from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { useAuth } from '../../auth/auth-context.js';
import { useCategoryTree } from '../../categories/hooks/use-categories.js';
import { useIncomeSources } from '../../income-sources/hooks/use-income-sources.js';
import {
  AccountPicker,
  CategoryPicker,
  IncomeSourcePicker,
} from '../../transactions/components/transaction-pickers.js';
import { defaultAccountId } from '../../transactions/transaction-form-state.js';
import { categoryLabel } from '../../transactions/transaction-view.js';
import { useCreateRule, useDeleteRule, useUpdateRule } from '../hooks/use-recurring.js';
import { nextMonthOfYear } from '../../planned-expenses/planned-form-state.js';
import {
  emptyRecurringForm,
  formErrorsFromRequest,
  previewDueDates,
  recurringFormFrom,
  suggestsPlannedExpense,
  switchFlow,
  toCreateRequest,
  toUpdateRequest,
  type RecurringFormErrors,
  type RecurringFormState,
} from '../recurring-form-state.js';
import { ScheduleFields } from './schedule-fields.js';

/**
 * Formularz reguły cyklicznej w arkuszu
 * ([06 §3.9](../../../../../../plans/06-ui-views.md#39-pozycje-cykliczne--recurring), `F4-5`).
 *
 * Wybór konta, kategorii i źródła to **widoki** tych samych pickerów co w formularzu
 * transakcji — reguła opisuje transakcję, którą kiedyś utworzy (ADR-043), więc pola mają
 * wyglądać i działać tak samo. Pod terminarzem podgląd najbliższych terminów, liczony
 * w przeglądarce tą samą funkcją co na serwerze (`upcomingDueDates`).
 */

/** Nazwa rodzaju w zakładce. */
const FLOW_LABEL: Readonly<Record<TransactionType, string>> = {
  expense: 'Wydatek',
  income: 'Wpływ',
  transfer: 'Przelew',
};

/** Widok arkusza: formularz albo jeden z pickerów. */
type View = 'form' | 'account' | 'counterAccount' | 'category' | 'source';

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
 * Wiersz z przełącznikiem i opisem — także w formularzu planowanego wydatku (`F6-7`).
 *
 * @param props - Właściwości komponentu.
 * @param props.label - Etykieta.
 * @param props.hint - Opis pod etykietą.
 * @param props.checked - Stan przełącznika.
 * @param props.onChange - Zmiana stanu.
 * @returns Element wiersza.
 */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): ReactNode {
  return (
    <div className="flex min-h-touch items-center justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-sm">{label}</span>
        {hint === undefined ? null : (
          <span className="text-caption text-muted-foreground">{hint}</span>
        )}
      </span>
      <Switch checked={checked} label={label} onCheckedChange={onChange} />
    </div>
  );
}

/** Właściwości treści formularza. */
interface RecurringFormProps {
  /** Reguła do edycji; brak = nowa. */
  rule?: RecurringRuleDto;
  onDone: () => void;
}

/**
 * Treść formularza — montowana od nowa przy każdym otwarciu arkusza.
 *
 * @param props - Właściwości komponentu.
 * @param props.rule - Reguła do edycji.
 * @param props.onDone - Zakończenie po zapisie albo usunięciu.
 * @returns Element formularza.
 */
function RecurringForm({ rule, onDone }: RecurringFormProps): ReactNode {
  const navigate = useNavigate();
  const { show } = useToast();
  const { household } = useAuth();
  const [today] = useState(() => todayInTimezone(household?.timezone ?? 'Europe/Warsaw'));
  const [state, setState] = useState<RecurringFormState>(() =>
    rule === undefined
      ? emptyRecurringForm('expense', today, null)
      : recurringFormFrom(rule, today),
  );
  const [view, setView] = useState<View>('form');
  const [errors, setErrors] = useState<RecurringFormErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const accounts = useAccountList(false);
  const categories = useCategoryTree(
    state.flow === 'income' ? 'income' : 'expense',
    state.flow !== 'transfer',
  );
  const sources = useIncomeSources(state.flow === 'income');
  const create = useCreateRule();
  const update = useUpdateRule();
  const remove = useDeleteRule();
  const pending = create.isPending || update.isPending;

  // Nowa reguła dostaje konto domyślne, gdy tylko lista kont dojdzie.
  const accountList = accounts.data;
  useEffect(() => {
    if (rule !== undefined || accountList === undefined) return;
    setState((current) =>
      current.accountId === null
        ? {
            ...current,
            accountId: defaultAccountId(accountList, household?.defaultExpenseAccountId ?? null),
          }
        : current,
    );
  }, [accountList, rule]);

  /**
   * Zmienia pola i czyści ich błędy.
   *
   * @param patch - Zmienione pola.
   */
  const change = (patch: Partial<RecurringFormState>): void => {
    setState((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key as keyof RecurringFormState];
      return next;
    });
  };

  /**
   * Zamyka wybór i wraca do formularza z nową wartością.
   *
   * @param patch - Wybrana wartość.
   */
  const choose = (patch: Partial<RecurringFormState>): void => {
    change(patch);
    setView('form');
  };

  const handleError = (error: Error): void => {
    setFormError(error.message);
    if (error instanceof ApiRequestError) setErrors(formErrorsFromRequest(error.fieldErrors()));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    if (rule === undefined) {
      const result = toCreateRequest(state);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      create.mutate(result.body, { onSuccess: onDone, onError: handleError });
      return;
    }
    const result = toUpdateRequest(rule, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (Object.keys(result.body).length === 0) {
      onDone();
      return;
    }
    update.mutate(
      { ruleId: rule.id, body: result.body },
      { onSuccess: onDone, onError: handleError },
    );
  };

  // --- Widoki wyboru -------------------------------------------------------------------
  const back = (): void => {
    setView('form');
  };
  const manageAccounts = (): void => {
    void navigate('/accounts');
  };
  if (view === 'account' || view === 'counterAccount') {
    const counter = view === 'counterAccount';
    return (
      <AccountPicker
        accounts={accounts.data ?? []}
        excludeId={
          counter ? state.accountId : state.flow === 'transfer' ? state.counterAccountId : null
        }
        onBack={back}
        onManageAccounts={manageAccounts}
        onSelect={(accountId) => {
          choose(counter ? { counterAccountId: accountId } : { accountId });
        }}
        selectedId={counter ? state.counterAccountId : state.accountId}
        title={counter || state.flow === 'income' ? 'Na konto' : 'Z konta'}
      />
    );
  }
  if (view === 'category') {
    return (
      <CategoryPicker
        kind={state.flow === 'income' ? 'income' : 'expense'}
        onBack={back}
        onSelect={(categoryId) => {
          choose({ categoryId });
        }}
        selectedId={state.categoryId}
      />
    );
  }
  if (view === 'source') {
    return (
      <IncomeSourcePicker
        onBack={back}
        onSelect={(incomeSourceId) => {
          choose({ incomeSourceId });
        }}
        selectedId={state.incomeSourceId}
      />
    );
  }

  // --- Formularz -----------------------------------------------------------------------
  const accountName = (accountId: string | null): string => {
    if (accountId === null) return 'Wybierz';
    return accounts.data?.find((account) => account.id === accountId)?.name ?? '…';
  };
  const categoryName =
    state.categoryId === null
      ? 'Bez kategorii'
      : (categoryLabel(categories.data ?? [], state.categoryId) ?? '…');
  const sourceName =
    state.incomeSourceId === null
      ? 'Bez źródła'
      : (sources.data?.find((source) => source.id === state.incomeSourceId)?.name ?? '…');
  const preview = previewDueDates(state, today, rule?.anchorDate);

  const fields = (
    <div className="flex flex-col gap-4">
      <TextField
        autoFocus={rule === undefined}
        error={errors.name}
        label="Nazwa"
        maxLength={60}
        onChange={(name) => {
          change({ name });
        }}
        placeholder={state.flow === 'income' ? 'np. Wynagrodzenie' : 'np. Czynsz'}
        value={state.name}
      />

      <div>
        <AmountInput
          defaultValueMinor={state.amountMinor}
          error={errors.amountMinor}
          label="Kwota"
          onChange={(amountMinor) => {
            change({ amountMinor });
          }}
        />
        <SwitchRow
          checked={state.amountIsEstimate}
          hint="Rachunek zmienny, np. prąd — przy księgowaniu zapytamy o rzeczywistą kwotę."
          label="Kwota szacunkowa"
          onChange={(amountIsEstimate) => {
            change({ amountIsEstimate });
          }}
        />
      </div>

      <div>
        {state.flow === 'income' ? (
          <>
            <Field
              label="Źródło"
              onOpen={() => {
                setView('source');
              }}
              value={sourceName}
            />
            <FieldError message={errors.incomeSourceId} />
          </>
        ) : null}
        {state.flow === 'transfer' ? null : (
          <>
            <Field
              label="Kategoria"
              onOpen={() => {
                setView('category');
              }}
              value={categoryName}
            />
            <FieldError message={errors.categoryId} />
          </>
        )}
        <Field
          label={state.flow === 'income' ? 'Na konto' : 'Z konta'}
          onOpen={() => {
            setView('account');
          }}
          value={accountName(state.accountId)}
        />
        <FieldError message={errors.accountId} />
        {state.flow === 'transfer' ? (
          <>
            <Field
              label="Na konto"
              onOpen={() => {
                setView('counterAccount');
              }}
              value={accountName(state.counterAccountId)}
            />
            <FieldError message={errors.counterAccountId} />
          </>
        ) : null}
      </div>

      <ScheduleFields errors={errors} onChange={change} value={state} />

      {suggestsPlannedExpense(state, rule === undefined) ? (
        <div className="flex flex-col gap-2 rounded-md bg-muted p-3">
          <p className="flex items-start gap-2 text-sm">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
            Dla nieregularnych wydatków jak OC lepiej sprawdzą się Planowane wydatki — pozwalają
            odkładać co miesiąc.
          </p>
          <Button
            className="self-start"
            onClick={() => {
              // Przeniesienie tego, co już wpisano — nikt nie chce wpisywać drugi raz.
              void navigate('/planned', {
                state: {
                  preset: {
                    ...(state.name.trim() === '' ? {} : { name: state.name.trim() }),
                    ...(state.amountMinor > 0 ? { amountMinor: state.amountMinor } : {}),
                    categoryId: state.categoryId,
                    dueMonth: nextMonthOfYear(
                      monthKeyOf(today, household?.monthStartDay),
                      state.monthOfYear,
                    ),
                  },
                },
              });
            }}
            size="small"
            type="button"
            variant="soft"
          >
            Utwórz tam zamiast tego
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <TextField
          error={errors.startMonth}
          label="Od miesiąca"
          onChange={(startMonth) => {
            change({ startMonth });
          }}
          type="month"
          value={state.startMonth}
        />
        <TextField
          error={errors.endMonth}
          label="Do miesiąca"
          onChange={(endMonth) => {
            change({ endMonth });
          }}
          placeholder="bez końca"
          type="month"
          value={state.endMonth}
        />
      </div>

      <p className="text-meta text-muted-foreground" aria-live="polite">
        {preview.length === 0
          ? 'Uzupełnij terminarz, żeby zobaczyć najbliższe terminy.'
          : `Najbliższe terminy: ${preview.map((date) => formatDateOnly(date)).join(' · ')}`}
      </p>

      <div>
        {state.flow === 'expense' ? (
          <SwitchRow
            checked={state.isFixedExpense}
            hint="Czynsz, abonamenty, raty — grupowane osobno."
            label="Wydatek stały"
            onChange={(isFixedExpense) => {
              change({ isFixedExpense });
            }}
          />
        ) : null}
        <SwitchRow
          checked={state.autoPost}
          hint={
            state.amountIsEstimate
              ? 'Kwota szacunkowa nie księguje się sama — zawsze trafi do potwierdzenia.'
              : 'W dniu terminu transakcja zapisze się sama, bez potwierdzania.'
          }
          label="Księguj automatycznie"
          onChange={(autoPost) => {
            change({ autoPost });
          }}
        />
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

      {rule === undefined ? null : confirmDelete ? (
        <div className="flex flex-col gap-2 rounded-md border border-danger p-3">
          <p className="text-sm">
            Usunąć „{rule.name}" na stałe? Czekające terminy znikną, a zaksięgowane płatności
            zostaną w historii jako zwykłe transakcje. Żeby tylko przerwać — wstrzymaj regułę.
          </p>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => {
                setConfirmDelete(false);
              }}
              type="button"
              variant="ghost"
            >
              Anuluj
            </Button>
            <Button
              className="flex-1"
              loading={remove.isPending}
              onClick={() => {
                remove.mutate(rule.id, {
                  onSuccess: () => {
                    onDone();
                    show({ message: `Usunięto „${rule.name}"` });
                  },
                  onError: (error) => {
                    setConfirmDelete(false);
                    setFormError(error.message);
                  },
                });
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
          disabled={pending}
          onClick={() => {
            setConfirmDelete(true);
          }}
          // W formularzu: bez `type="button"` przycisk wysłałby formularz.
          type="button"
          variant="ghost"
        >
          Usuń pozycję
        </Button>
      )}
    </div>
  );

  return (
    <form noValidate onSubmit={handleSubmit}>
      {rule === undefined ? (
        <Tabs
          items={TransactionTypeSchema.options.map((flow) => ({
            value: flow,
            label: FLOW_LABEL[flow],
            content: flow === state.flow ? fields : null,
          }))}
          onValueChange={(value) => {
            setState((current) => switchFlow(current, TransactionTypeSchema.parse(value)));
            setErrors({});
          }}
          value={state.flow}
        />
      ) : (
        fields
      )}

      {/* Przyklejony do dołu arkusza: widoczny nad klawiaturą kwoty i w zasięgu kciuka. */}
      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-border bg-card px-4 pb-2 pt-3">
        {formError === undefined ? null : (
          <p className="mb-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Button loading={pending} size="large" type="submit" variant="primary">
          {rule === undefined ? 'Dodaj pozycję' : 'Zapisz zmiany'}
        </Button>
      </div>
    </form>
  );
}

/** Właściwości arkusza reguły. */
export interface RecurringFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reguła do edycji; brak = nowa. */
  rule?: RecurringRuleDto;
}

/**
 * Arkusz z formularzem nowej albo edytowanej reguły.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.rule - Reguła do edycji.
 * @returns Element arkusza.
 */
export function RecurringFormSheet({
  open,
  onOpenChange,
  rule,
}: RecurringFormSheetProps): ReactNode {
  return (
    <Sheet
      onOpenChange={onOpenChange}
      open={open}
      title={rule === undefined ? 'Nowa pozycja cykliczna' : 'Edytuj pozycję'}
    >
      {open ? (
        <RecurringForm
          key={rule?.id ?? 'new'}
          onDone={() => {
            onOpenChange(false);
          }}
          rule={rule}
        />
      ) : null}
    </Sheet>
  );
}
