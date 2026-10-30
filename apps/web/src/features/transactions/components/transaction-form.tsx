import {
  isInClosedMonth,
  monthKeyOf,
  todayInTimezone,
  TransactionTypeSchema,
  type CategoryKind,
  type TransactionListItemDto,
  type TransactionType,
} from '@fineapp/shared';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import {
  AmountInput,
  Button,
  Checkbox,
  Field,
  Money,
  Tabs,
  TextField,
  useToast,
} from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { cn } from '../../../lib/cn.js';
import { formatDateShort } from '../../../lib/format.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { useAuth } from '../../auth/auth-context.js';
import { useCategoryTree } from '../../categories/hooks/use-categories.js';
import { useGoals } from '../../goals/hooks/use-goals.js';
import { useIncomeSources } from '../../income-sources/hooks/use-income-sources.js';
import { ScheduleFields } from '../../recurring/components/schedule-fields.js';
import { useSaveAsRecurring } from '../../recurring/hooks/use-recurring.js';
import type { RecurringFormErrors } from '../../recurring/recurring-form-state.js';
import { useCreateTransaction, useUpdateTransaction } from '../hooks/use-transactions.js';
import {
  changeRepeat,
  followDate,
  repeatFromDate,
  repeatLabel,
  repeatPreview,
  toSaveAsRecurringRequest,
  type RepeatState,
} from '../repeat-state.js';
import {
  dateLabel,
  defaultAccountId,
  emptyTransactionForm,
  formErrorsFromApi,
  postingBounds,
  previewEffects,
  switchType,
  toCreateRequest,
  toUpdateRequest,
  transactionFormFrom,
  transferCanAffectGoals,
  type TransactionFormErrors,
  type TransactionFormState,
  type TransactionPreset,
} from '../transaction-form-state.js';
import { categoryLabel } from '../transaction-view.js';
import { AllocationEffectBadge } from './allocation-effect-badge.js';
import {
  AccountPicker,
  CategoryPicker,
  DatePicker,
  GoalPicker,
  IncomeSourcePicker,
} from './transaction-pickers.js';

/**
 * Formularz transakcji ([06 §3.3](../../../../../../plans/06-ui-views.md#33-formularz-transakcji--tnew-tid)).
 *
 * Kwota na górze z własną klawiaturą i fokusem od razu — dwa dotknięcia do wydatku
 * (06 §1.3). Pod nią pola zależne od typu, pod nimi opis. Wybór konta, kategorii, daty
 * i źródła podmienia treść arkusza (widoki w `transaction-pickers.tsx`).
 *
 * „Zapisz" stoi przyklejony na dole, nie w nagłówku arkusza jak w makiecie 06 §3.3:
 * nad klawiaturą kwoty kciuk sięga dołu ekranu, a nie prawego górnego rogu (06 §1.2,
 * ADR-037).
 *
 * Nowa transakcja ma na końcu „Zapisz jako wydatek stały" (wymaganie #3, `F4-8`,
 * ADR-051): pole wyboru rozwija terminarz, a po zapisie transakcji formularz zakłada z niej
 * regułę. Transakcja jest wtedy płatnością bieżącego terminu — nie trafi do „Do zrobienia".
 */

/** Nazwy zakładek typu. */
const TYPE_LABEL: Readonly<Record<TransactionType, string>> = {
  expense: 'Wydatek',
  income: 'Przychód',
  transfer: 'Przelew',
};

/** Widok w arkuszu: formularz albo jeden z wyborów. */
type View = 'form' | 'account' | 'counterAccount' | 'category' | 'date' | 'source' | 'goal';

/**
 * Rodzaj kategorii zgodny z typem transakcji (I-4); przelew kategorii w formularzu nie ma.
 *
 * @param type - Typ transakcji.
 * @returns Rodzaj kategorii.
 */
function categoryKindOf(type: TransactionType): CategoryKind {
  return type;
}

/**
 * Błąd pod wierszem pola.
 *
 * @param props - Właściwości komponentu.
 * @param props.message - Komunikat albo `undefined`.
 * @returns Element komunikatu albo nic.
 */
function FieldError({ message }: { message: string | undefined }): ReactNode {
  return message === undefined ? null : (
    <p className="pb-1 text-caption text-danger" role="alert">
      {message}
    </p>
  );
}

/**
 * Zdanie pod terminarzem: kolejne terminy po tej transakcji.
 *
 * @param dates - Daty z podglądu.
 * @returns Tekst podglądu.
 */
function repeatPreviewText(dates: readonly string[]): string {
  return dates.length === 0
    ? 'Uzupełnij terminarz, żeby zobaczyć kolejne terminy.'
    : `Kolejne terminy: ${dates.map((date) => formatDateShort(date)).join(' · ')}`;
}

/** Właściwości formularza transakcji. */
export interface TransactionFormProps {
  /** Typ nowej transakcji; przy edycji ignorowany. */
  initialType?: TransactionType;
  /** Wartości wpisane z góry w nową transakcję („Uzupełnij", wpłata na cel). */
  initialPreset?: TransactionPreset;
  /** Transakcja do edycji; brak = nowa. */
  original?: TransactionListItemDto;
  /** Zmiana typu — arkusz zmienia wtedy tytuł. */
  onTypeChange?: (type: TransactionType) => void;
  /** Wywoływane po zapisie albo, przy edycji bez zmian, po „Zapisz". */
  onDone: () => void;
  /** Wyjście do ekranu kont, gdy nie ma żadnego. */
  onManageAccounts: () => void;
}

/**
 * Formularz nowej albo edytowanej transakcji.
 *
 * @param props - Właściwości komponentu.
 * @param props.initialType - Typ nowej transakcji.
 * @param props.initialPreset - Wartości wpisane z góry.
 * @param props.original - Transakcja do edycji.
 * @param props.onTypeChange - Zmiana typu.
 * @param props.onDone - Zakończenie po zapisie.
 * @param props.onManageAccounts - Wyjście do ekranu kont.
 * @returns Element formularza.
 */
export function TransactionForm({
  initialType = 'expense',
  initialPreset,
  original,
  onTypeChange,
  onDone,
  onManageAccounts,
}: TransactionFormProps): ReactNode {
  const { household } = useAuth();
  const [today] = useState(() => todayInTimezone(household?.timezone ?? 'Europe/Warsaw'));
  const monthStartDay = household?.monthStartDay ?? 1;
  const bounds = postingBounds(
    today,
    household?.backPostingLimitMonths ?? 1,
    household?.monthStartDay ?? 1,
  );

  // Transakcja z zamkniętego miesiąca: liczby zamrożone, opisy do poprawienia (07 §1.4).
  // Pola zablokowane od razu, zamiast odrzucenia po „Zapisz" (ADR-040).
  const locked =
    original !== undefined &&
    isInClosedMonth(original.bookedOn, today, household?.backPostingLimitMonths ?? 1);

  const [state, setState] = useState<TransactionFormState>(() =>
    original === undefined
      ? emptyTransactionForm(initialType, today, null, initialPreset)
      : transactionFormFrom(original),
  );
  // Jeden klucz na formularz: ponowienie po zerwanym połączeniu niesie ten sam, więc
  // serwer odda pierwszy wynik zamiast zapisać wydatek drugi raz (ADR-037).
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [view, setView] = useState<View>('form');
  const [errors, setErrors] = useState<TransactionFormErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [moreOpen, setMoreOpen] = useState(
    () => original !== undefined && (original.merchant !== null || original.notes !== null),
  );
  // „Zapisz jako wydatek stały": `null` — nie powtarzaj. Własny klucz idempotencji:
  // ponowienie nie założy drugiej reguły (ADR-051).
  const [repeat, setRepeat] = useState<RepeatState | null>(null);
  const [repeatErrors, setRepeatErrors] = useState<RecurringFormErrors>({});
  const [repeatKey] = useState(() => crypto.randomUUID());
  const { show } = useToast();

  const accounts = useAccountList(false);
  const categories = useCategoryTree(categoryKindOf(state.type), state.type !== 'transfer');
  const sources = useIncomeSources(state.type === 'income');
  const goalsForName = useGoals(monthKeyOf(today, monthStartDay), state.type === 'transfer');
  const create = useCreateTransaction();
  const update = useUpdateTransaction();
  const saveAsRecurring = useSaveAsRecurring();
  const pending = create.isPending || update.isPending || saveAsRecurring.isPending;

  // Nowa transakcja dostaje konto domyślne, gdy tylko lista kont dojdzie.
  const accountList = accounts.data;
  useEffect(() => {
    if (original !== undefined || accountList === undefined) return;
    setState((current) =>
      current.accountId === null
        ? {
            ...current,
            accountId: defaultAccountId(accountList, household?.defaultExpenseAccountId ?? null),
          }
        : current,
    );
  }, [accountList, original]);

  /**
   * Zmienia pola i czyści ich błędy.
   *
   * @param patch - Zmienione pola.
   */
  const change = (patch: Partial<TransactionFormState>): void => {
    setState((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key as keyof TransactionFormState];
      return next;
    });
  };

  /**
   * Zamyka wybór i wraca do formularza z nową wartością.
   *
   * @param patch - Wybrana wartość.
   */
  const choose = (patch: Partial<TransactionFormState>): void => {
    change(patch);
    setView('form');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    // Jak serwer (ADR-035): okno sprawdzamy przy zapisie **daty** — poprawka opisu starej
    // transakcji z niezmienioną datą przechodzi.
    const dateChanged = original === undefined || state.bookedOn !== original.bookedOn;
    if (dateChanged && (state.bookedOn < bounds.min || state.bookedOn > bounds.max)) {
      setErrors({ bookedOn: 'Ta data jest poza oknem księgowania.' });
      return;
    }
    const handlers = {
      onSuccess: onDone,
      onError: (error: Error) => {
        setFormError(error.message);
        if (error instanceof ApiRequestError) setErrors(formErrorsFromApi(error.fieldErrors()));
      },
    };

    if (original === undefined) {
      const result = toCreateRequest(state);
      const repeatRequest = repeat === null ? null : toSaveAsRecurringRequest(repeat);
      if (repeatRequest?.ok === false) setRepeatErrors(repeatRequest.errors);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      if (repeatRequest?.ok === false) return;
      create.mutate(
        { body: result.body, idempotencyKey },
        {
          onError: handlers.onError,
          onSuccess: ({ data: transaction }) => {
            if (repeatRequest === null) {
              onDone();
              return;
            }
            // Transakcja już jest zapisana — niezależnie od wyniku reguły arkusz się zamyka;
            // ponowne „Zapisz" dopisałoby tylko powtórkę tej samej transakcji.
            // Następny termin **po** tej transakcji — `rule.nextDueOn` liczy od dziś
            // włącznie i pokazałby termin, który ta transakcja właśnie opłaciła.
            const [next] = repeat === null ? [] : repeatPreview(state, repeat, monthStartDay, 1);
            saveAsRecurring.mutate(
              {
                transactionId: transaction.id,
                body: repeatRequest.body,
                idempotencyKey: repeatKey,
              },
              {
                onSuccess: (rule) => {
                  show({
                    message:
                      next === undefined
                        ? `Zapisano „${rule.name}" jako pozycję cykliczną`
                        : `Zapisano „${rule.name}" — następny termin ${formatDateShort(next)}`,
                  });
                  onDone();
                },
                onError: (error) => {
                  show({
                    message: `Transakcja zapisana, ale pozycji cyklicznej nie: ${error.message}`,
                  });
                  onDone();
                },
              },
            );
          },
        },
      );
      return;
    }

    const result = toUpdateRequest(original, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (Object.keys(result.body).length === 0) {
      onDone();
      return;
    }
    update.mutate({ transactionId: original.id, body: result.body }, handlers);
  };

  const accountName = (accountId: string | null, fallback: string | null | undefined): string => {
    if (accountId === null) return 'Wybierz';
    return accounts.data?.find((account) => account.id === accountId)?.name ?? fallback ?? '…';
  };

  // --- Widoki wyboru -------------------------------------------------------------------
  const back = (): void => {
    setView('form');
  };
  if (view === 'account' || view === 'counterAccount') {
    const counter = view === 'counterAccount';
    return (
      <AccountPicker
        accounts={accounts.data ?? []}
        excludeId={
          counter ? state.accountId : state.type === 'transfer' ? state.counterAccountId : null
        }
        onBack={back}
        onManageAccounts={onManageAccounts}
        onSelect={(accountId) => {
          choose(counter ? { counterAccountId: accountId } : { accountId });
        }}
        selectedId={counter ? state.counterAccountId : state.accountId}
        title={counter || state.type === 'income' ? 'Na konto' : 'Z konta'}
      />
    );
  }
  if (view === 'category') {
    return (
      <CategoryPicker
        kind={categoryKindOf(state.type)}
        onBack={back}
        onSelect={(categoryId) => {
          choose({ categoryId });
        }}
        selectedId={state.categoryId}
      />
    );
  }
  if (view === 'date') {
    return (
      <DatePicker
        max={bounds.max}
        min={bounds.min}
        onBack={back}
        onSelect={(bookedOn) => {
          choose({ bookedOn });
          setRepeat((current) => followDate(current, bookedOn));
        }}
        selected={state.bookedOn}
        today={today}
      />
    );
  }
  if (view === 'goal') {
    return (
      <GoalPicker
        month={monthKeyOf(today, monthStartDay)}
        onBack={back}
        onSelect={(goal) => {
          // Cel z kontem podpowiada konto docelowe — o ile użytkownik go jeszcze nie wybrał.
          const counter =
            state.counterAccountId ??
            (goal?.linkedAccountId === state.accountId ? null : (goal?.linkedAccountId ?? null));
          choose({ goalId: goal?.id ?? null, counterAccountId: counter });
        }}
        selectedId={state.goalId}
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
  const effects = previewEffects(state, accounts.data ?? [], original);
  const canAffect = transferCanAffectGoals(state, accounts.data ?? [], original);
  const categoryName =
    state.categoryId === null
      ? 'Bez kategorii'
      : (categoryLabel(categories.data ?? [], state.categoryId) ??
        (state.categoryId === original?.categoryId ? original.categoryName : null) ??
        '…');
  const sourceName =
    state.incomeSourceId === null
      ? 'Bez źródła'
      : (sources.data?.find((source) => source.id === state.incomeSourceId)?.name ??
        (state.incomeSourceId === original?.incomeSourceId ? original.incomeSourceName : null) ??
        '…');

  const goalName =
    state.goalId === null
      ? 'Bez celu'
      : (goalsForName.data?.data.find((goal) => goal.id === state.goalId)?.name ??
        (state.goalId === original?.goalId ? original.goalName : null) ??
        '…');

  const fields = (
    <div className="flex flex-col">
      {locked ? (
        <>
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground" role="note">
            Miesiąc jest zamknięty — możesz poprawić opis, sprzedawcę i notatkę. Kwoty, daty i
            kategorii nie zmienisz bez podniesienia limitu księgowania wstecz.
          </p>
          <Field
            className="mt-3"
            label="Kwota"
            value={<Money amountMinor={state.amountMinor} size="base" />}
          />
        </>
      ) : (
        <AmountInput
          autoFocus={original === undefined}
          defaultValueMinor={state.amountMinor}
          error={errors.amountMinor}
          label="Kwota"
          onChange={(amountMinor) => {
            change({ amountMinor });
          }}
        />
      )}

      <div className={locked ? undefined : 'mt-4'}>
        {state.type === 'income' ? (
          <>
            <Field
              label="Źródło"
              onOpen={
                locked
                  ? undefined
                  : () => {
                      setView('source');
                    }
              }
              value={sourceName}
            />
            <FieldError message={errors.incomeSourceId} />
          </>
        ) : null}
        {state.type === 'transfer' ? null : (
          <>
            <Field
              label="Kategoria"
              onOpen={
                locked
                  ? undefined
                  : () => {
                      setView('category');
                    }
              }
              value={categoryName}
            />
            <FieldError message={errors.categoryId} />
          </>
        )}
        <Field
          label={state.type === 'income' ? 'Na konto' : 'Z konta'}
          onOpen={
            locked
              ? undefined
              : () => {
                  setView('account');
                }
          }
          value={accountName(state.accountId, original?.accountName)}
        />
        <FieldError message={errors.accountId} />
        {state.type === 'transfer' ? (
          <>
            <Field
              label="Na konto"
              onOpen={
                locked
                  ? undefined
                  : () => {
                      setView('counterAccount');
                    }
              }
              value={accountName(state.counterAccountId, original?.counterAccountName)}
            />
            <FieldError message={errors.counterAccountId} />
            <Field
              label="Na cel"
              onOpen={
                locked
                  ? undefined
                  : () => {
                      setView('goal');
                    }
              }
              value={goalName}
            />
            <FieldError message={errors.goalId} />
          </>
        ) : null}
        <Field
          label="Data"
          onOpen={
            locked
              ? undefined
              : () => {
                  setView('date');
                }
          }
          value={dateLabel(state.bookedOn, today)}
        />
        <FieldError message={errors.bookedOn} />
      </div>

      {!locked &&
      state.type === 'transfer' &&
      state.accountId !== null &&
      state.counterAccountId !== null ? (
        <div className="mt-3">
          <AllocationEffectBadge
            canAffect={canAffect}
            counts={state.allocationOverride !== 'none'}
            effects={effects}
            onCountsChange={(counts) => {
              // Wyłączenie to `none`; ponowne włączenie przywraca nadpisanie z transakcji
              // (np. wymuszone z API), a w nowej — wyliczenie z klas kont.
              const restored =
                original?.allocationOverride === 'none'
                  ? null
                  : (original?.allocationOverride ?? null);
              change({ allocationOverride: counts ? restored : 'none' });
            }}
          />
          <FieldError message={errors.allocationOverride} />
        </div>
      ) : null}

      <TextField
        className="mt-4"
        error={errors.description}
        label="Opis"
        maxLength={200}
        onChange={(description) => {
          change({ description });
        }}
        placeholder={state.type === 'expense' ? 'np. Zakupy tygodniowe' : undefined}
        value={state.description}
      />

      <div className="mt-4 border-t border-border">
        <button
          aria-expanded={moreOpen}
          className="flex min-h-touch w-full items-center justify-between gap-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setMoreOpen((open) => !open);
          }}
          type="button"
        >
          Więcej (sprzedawca, notatka)
          <ChevronDown
            aria-hidden="true"
            className={cn('h-5 w-5 transition-transform', moreOpen ? 'rotate-180' : '')}
            strokeWidth={1.5}
          />
        </button>
        {moreOpen ? (
          <div className="flex flex-col gap-4 pb-2">
            <TextField
              error={errors.merchant}
              label="Sprzedawca"
              maxLength={120}
              onChange={(merchant) => {
                change({ merchant });
              }}
              placeholder="np. Lidl"
              value={state.merchant}
            />
            <TextField
              error={errors.notes}
              label="Notatka"
              maxLength={1000}
              onChange={(notes) => {
                change({ notes });
              }}
              value={state.notes}
            />
          </div>
        ) : null}
      </div>

      {original === undefined ? (
        <div className="border-t border-border">
          <Checkbox
            checked={repeat !== null}
            onCheckedChange={(checked) => {
              setRepeat(checked ? repeatFromDate(state.bookedOn) : null);
              setRepeatErrors({});
            }}
          >
            {repeatLabel(state.type)}
          </Checkbox>
          {repeat === null ? null : (
            <div className="flex flex-col gap-4 pb-2">
              <ScheduleFields
                errors={repeatErrors}
                onChange={(patch) => {
                  setRepeat((current) => (current === null ? null : changeRepeat(current, patch)));
                  setRepeatErrors({});
                }}
                value={repeat}
              />
              <p aria-live="polite" className="text-meta text-muted-foreground">
                {repeatPreviewText(repeatPreview(state, repeat, household?.monthStartDay ?? 1))}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <form noValidate onSubmit={handleSubmit}>
      {original === undefined ? (
        <Tabs
          items={TransactionTypeSchema.options.map((type) => ({
            value: type,
            label: TYPE_LABEL[type],
            content: type === state.type ? fields : null,
          }))}
          onValueChange={(value) => {
            const type = TransactionTypeSchema.parse(value);
            setState((current) => switchType(current, type));
            setErrors({});
            onTypeChange?.(type);
          }}
          value={state.type}
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
          {original === undefined ? 'Zapisz' : 'Zapisz zmiany'}
        </Button>
      </div>
    </form>
  );
}
