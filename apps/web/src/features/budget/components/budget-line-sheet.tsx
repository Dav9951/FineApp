import {
  budgetSectionOf,
  formatMinor,
  formatMonth,
  monthKeyOf,
  todayInTimezone,
  type BudgetGroupDto,
  type BudgetLineDto,
  type BudgetLineFlow,
  type MonthKey,
} from '@fineapp/shared';
import { useState, type FormEvent, type ReactNode } from 'react';

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
import { useAuth } from '../../auth/auth-context.js';
import { useCategoryTree } from '../../categories/hooks/use-categories.js';
import { useGoals } from '../../goals/hooks/use-goals.js';
import { CategoryPicker, GoalPicker } from '../../transactions/components/transaction-pickers.js';
import { categoryLabel } from '../../transactions/transaction-view.js';
import {
  applyPreview,
  lineFormFrom,
  toCreateLineRequest,
  toUpdateLineRequest,
  type LineFormErrors,
  type LineFormState,
} from '../budget-form-state.js';
import { averageForCategory, LINE_KIND_LABEL, lineKind } from '../budget-view.js';
import {
  useApplyBudgetLineToSource,
  useBudgetLineAction,
  useCategoryAverages,
  useCreateBudgetLine,
  useUpdateBudgetLine,
} from '../hooks/use-budget.js';
import { BudgetPromoteForm } from './budget-promote-form.js';

/**
 * Arkusz linii szkicu — nowa linia z „+ Dodaj" albo edycja istniejącej
 * ([06 §3.14](../../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth),
 * `F9-7`).
 *
 * Linia własna ma „Zamień w…" (pozycja cykliczna / planowany wydatek). Linia powiązana —
 * blok „Powiązane z" z kwotą w źródle i „Zapisz w źródle", który **najpierw** pokazuje
 * skutek (07 §13.7): edycja w szkicu sama niczego poza szkicem nie zmienia (ADR-076).
 */

/** Okna średniej pokazywane przy kategorii wydatku (07 §13.3). */
const AVERAGE_WINDOWS = [3, 6, 12] as const;

/** Wybór puli przy nowej linii w sekcji „Oszczędności i inwestycje". */
const POOL_OPTIONS: readonly { value: BudgetLineFlow; label: string }[] = [
  { value: 'savings', label: 'Oszczędności' },
  { value: 'investment', label: 'Inwestycje' },
];

/** Widok arkusza. */
type View = 'form' | 'category' | 'goal' | 'recurring' | 'planned';

/** Właściwości treści arkusza. */
interface LineFormProps {
  month: MonthKey;
  line: BudgetLineDto | null;
  addFlow: BudgetLineFlow;
  /** Grupy szkicu — pole „Grupa" dla grup sekcji linii (ADR-081). */
  groups: readonly BudgetGroupDto[];
  /** Grupa nowej linii — ostatnio wybrana w sekcji. */
  addGroupId: string | null;
  /** Wybór grupy przy zapisie — ekran pamięta go dla następnej nowej linii. */
  onGroupChosen?: ((flow: BudgetLineFlow, groupId: string | null) => void) | undefined;
  onDone: () => void;
}

/**
 * Średnie kategorii z przyciskiem „Użyj" — jedna na okno.
 *
 * @param props - Właściwości komponentu.
 * @param props.categoryId - Kategoria linii.
 * @param props.onUse - Wybór średniej: kwota i okno.
 * @returns Element z przyciskami albo nic.
 */
function AverageHints({
  categoryId,
  onUse,
}: {
  categoryId: string;
  onUse: (amountMinor: number, months: 3 | 6 | 12) => void;
}): ReactNode {
  const tree = useCategoryTree('expense');
  const three = useCategoryAverages(3);
  const six = useCategoryAverages(6);
  const twelve = useCategoryAverages(12);
  const byWindow = { 3: three.data, 6: six.data, 12: twelve.data };
  const options = AVERAGE_WINDOWS.map((months) => ({
    months,
    amountMinor: averageForCategory(byWindow[months], tree.data ?? [], categoryId),
  })).filter(
    (option): option is { months: 3 | 6 | 12; amountMinor: number } => option.amountMinor !== null,
  );
  if (options.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-muted-foreground">Średnia wydatków w kategorii</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.months}
            onClick={() => {
              onUse(option.amountMinor, option.months);
            }}
            size="small"
            type="button"
            variant="soft"
          >
            {String(option.months)} mies. <Money amountMinor={option.amountMinor} size="sm" />
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Treść arkusza — montowana od nowa przy każdym otwarciu.
 *
 * @param props - Właściwości komponentu.
 * @param props.month - Miesiąc planu.
 * @param props.line - Linia do edycji; `null` — nowa.
 * @param props.addFlow - Strona bilansu nowej linii.
 * @param props.groups - Grupy szkicu.
 * @param props.addGroupId - Grupa nowej linii.
 * @param props.onGroupChosen - Zapamiętanie wybranej grupy.
 * @param props.onDone - Zamknięcie arkusza.
 * @returns Element treści.
 */
function LineForm({
  month,
  line,
  addFlow,
  groups,
  addGroupId,
  onGroupChosen,
  onDone,
}: LineFormProps): ReactNode {
  const { show } = useToast();
  const { household } = useAuth();
  const [currentMonth] = useState<MonthKey>(() =>
    monthKeyOf(todayInTimezone(household?.timezone ?? 'Europe/Warsaw'), household?.monthStartDay),
  );
  const [state, setState] = useState<LineFormState>(() => lineFormFrom(line, addFlow, addGroupId));
  // Klucz pola kwoty: wybór średniej montuje pole od nowa z nową kwotą.
  const [amountKey, setAmountKey] = useState(0);
  const [view, setView] = useState<View>('form');
  const [errors, setErrors] = useState<LineFormErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applyKey] = useState(() => crypto.randomUUID());

  const isPool = state.flow === 'savings' || state.flow === 'investment';
  const categoryKind = state.flow === 'income' ? 'income' : 'expense';
  const categories = useCategoryTree(categoryKind, !isPool);
  const goals = useGoals(currentMonth, isPool && state.goalId !== null);
  const create = useCreateBudgetLine(month);
  const update = useUpdateBudgetLine(month);
  const lineAction = useBudgetLineAction(month);
  const apply = useApplyBudgetLineToSource(month);
  const pending = create.isPending || update.isPending || lineAction.isPending || apply.isPending;

  const change = (patch: Partial<LineFormState>): void => {
    setState((current) => ({ ...current, ...patch }));
    setErrors({});
  };
  const handleError = (error: Error): void => {
    setFormError(error.message);
    if (error instanceof ApiRequestError) {
      const fields = error.fieldErrors();
      setErrors({
        ...(fields.name === undefined ? {} : { name: fields.name }),
        ...(fields.amountMinor === undefined ? {} : { amountMinor: fields.amountMinor }),
        ...(fields.dueOn === undefined ? {} : { dueOn: fields.dueOn }),
      });
    }
  };

  if (line !== null && (view === 'recurring' || view === 'planned')) {
    return (
      <BudgetPromoteForm
        line={line}
        month={month}
        onBack={() => {
          setView('form');
        }}
        onDone={onDone}
        target={view}
      />
    );
  }
  if (view === 'category') {
    return (
      <CategoryPicker
        kind={categoryKind}
        onBack={() => {
          setView('form');
        }}
        onSelect={(categoryId) => {
          change({ categoryId });
          setView('form');
        }}
        selectedId={state.categoryId}
      />
    );
  }
  if (view === 'goal') {
    return (
      <GoalPicker
        month={currentMonth}
        onBack={() => {
          setView('form');
        }}
        onSelect={(goal) => {
          change({ goalId: goal?.id ?? null });
          setView('form');
        }}
        selectedId={state.goalId}
      />
    );
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    onGroupChosen?.(state.flow, state.groupId);
    if (line === null) {
      const result = toCreateLineRequest(state, month);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      create.mutate(result.body, { onSuccess: onDone, onError: handleError });
      return;
    }
    const result = toUpdateLineRequest(line, state, month);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (Object.keys(result.body).length === 0) {
      onDone();
      return;
    }
    update.mutate(
      { lineId: line.id, body: result.body },
      { onSuccess: onDone, onError: handleError },
    );
  };

  const categoryName =
    state.categoryId === null
      ? 'Bez kategorii'
      : (categoryLabel(categories.data ?? [], state.categoryId) ?? line?.categoryName ?? '…');
  const goalName =
    state.goalId === null
      ? 'Bez celu'
      : (goals.data?.data.find((goal) => goal.id === state.goalId)?.name ?? '…');
  const preview = line === null ? null : applyPreview(line, month, currentMonth);
  const sectionGroups = groups.filter((group) => group.section === budgetSectionOf(state.flow));
  const isLinked = line !== null && line.origin !== 'manual';

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      {line === null && addFlow !== 'income' && addFlow !== 'expense' ? (
        <OptionGrid
          legend="Pula"
          onChange={(flow: BudgetLineFlow) => {
            change({ flow });
          }}
          options={POOL_OPTIONS}
          value={state.flow}
        />
      ) : null}

      <TextField
        autoFocus={line === null}
        error={errors.name}
        label="Nazwa"
        maxLength={60}
        onChange={(name) => {
          change({ name });
        }}
        placeholder={state.flow === 'income' ? 'np. Premia' : 'np. Prezent dla mamy'}
        value={state.name}
      />

      <AmountInput
        defaultValueMinor={state.amountMinor}
        error={errors.amountMinor}
        key={amountKey}
        label="Kwota"
        onChange={(amountMinor) => {
          change({ amountMinor, averageMonths: null });
        }}
      />

      {isPool ? (
        <Field
          label="Na cel"
          onOpen={() => {
            setView('goal');
          }}
          value={goalName}
        />
      ) : (
        <Field
          label="Kategoria"
          onOpen={() => {
            setView('category');
          }}
          value={categoryName}
        />
      )}

      {state.flow === 'expense' && state.categoryId !== null ? (
        <AverageHints
          categoryId={state.categoryId}
          onUse={(amountMinor, averageMonths) => {
            change({ amountMinor, averageMonths });
            setAmountKey((key) => key + 1);
          }}
        />
      ) : null}

      {sectionGroups.length === 0 ? null : (
        <OptionGrid
          legend="Grupa"
          onChange={(groupId: string) => {
            change({ groupId: groupId === '' ? null : groupId });
          }}
          options={[
            ...sectionGroups.map((group) => ({ value: group.id, label: group.name })),
            { value: '', label: 'Bez grupy' },
          ]}
          value={state.groupId ?? ''}
        />
      )}

      <TextField
        error={errors.dueOn}
        hint="Opcjonalnie — podpowie dzień przy zamianie w pozycję cykliczną."
        label="Dzień"
        onChange={(dueOn) => {
          change({ dueOn });
        }}
        type="date"
        value={state.dueOn}
      />

      {line !== null && line.canPromote.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <span className="text-sm font-medium">Zamień w…</span>
          <div className="grid grid-cols-2 gap-2">
            {line.canPromote.includes('recurring') ? (
              <Button
                disabled={pending}
                onClick={() => {
                  setView('recurring');
                }}
                type="button"
                variant="soft"
              >
                Pozycję cykliczną
              </Button>
            ) : null}
            {line.canPromote.includes('planned') ? (
              <Button
                disabled={pending}
                onClick={() => {
                  setView('planned');
                }}
                type="button"
                variant="soft"
              >
                Planowany wydatek
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {isLinked ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm">
            Powiązane z: {LINE_KIND_LABEL[lineKind(line)]}
            {line.sourceAmountMinor === null ? null : (
              <>
                {' '}
                · w źródle{' '}
                <Money
                  amountMinor={line.sourceCurrentAmountMinor ?? line.sourceAmountMinor}
                  size="sm"
                />
              </>
            )}
          </p>
          {preview === null ? null : confirmApply ? (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <p className="text-sm">
                {preview.kind === 'rule_split' ? (
                  <>
                    Od {formatMonth(preview.fromMonth)}:{' '}
                    <Money amountMinor={preview.newMinor} size="sm" />. Do{' '}
                    {formatMonth(preview.untilMonth)} zostaje{' '}
                    <Money amountMinor={preview.oldMinor} size="sm" />.
                  </>
                ) : preview.kind === 'rule_updated' ? (
                  <>
                    Kwota pozycji cyklicznej zmieni się na{' '}
                    <Money amountMinor={preview.newMinor} size="sm" /> od bieżącego miesiąca.
                  </>
                ) : preview.kind === 'planned_updated' ? (
                  <>
                    Szacunek wydatku zmieni się z <Money amountMinor={preview.oldMinor} size="sm" />{' '}
                    na <Money amountMinor={preview.newMinor} size="sm" />.
                  </>
                ) : (
                  <>
                    Plan wpłat na cel zmieni się na{' '}
                    <Money amountMinor={preview.newMinor} size="sm" /> miesięcznie — od teraz.
                  </>
                )}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={() => {
                    setConfirmApply(false);
                  }}
                  type="button"
                  variant="ghost"
                >
                  Wróć
                </Button>
                <Button
                  loading={apply.isPending}
                  onClick={() => {
                    apply.mutate(
                      { lineId: line.id, idempotencyKey: applyKey },
                      {
                        onSuccess: ({ effect }) => {
                          onDone();
                          show({
                            message:
                              effect.kind === 'rule_split'
                                ? `Od ${formatMonth(effect.fromMonth)} pozycja cykliczna ma kwotę ${formatMinor(effect.newAmountMinor)}.`
                                : `Zapisano ${formatMinor(effect.newAmountMinor)} w źródle.`,
                          });
                        },
                        onError: (error) => {
                          setConfirmApply(false);
                          setFormError(error.message);
                        },
                      },
                    );
                  }}
                  type="button"
                  variant="primary"
                >
                  Zapisz
                </Button>
              </div>
            </div>
          ) : (
            <Button
              disabled={pending || state.amountMinor !== line.amountMinor}
              onClick={() => {
                setConfirmApply(true);
              }}
              type="button"
              variant="soft"
            >
              {line.origin === 'recurring' ? 'Zapisz w regule' : 'Zapisz w źródle'}
            </Button>
          )}
          <Button
            disabled={pending}
            onClick={() => {
              lineAction.mutate(
                { lineId: line.id, action: 'detach' },
                {
                  onSuccess: onDone,
                  onError: (error) => {
                    setFormError(error.message);
                  },
                },
              );
            }}
            type="button"
            variant="ghost"
          >
            Zostaw jako własną
          </Button>
        </div>
      ) : null}

      {line === null ? null : (
        <Button
          className="text-danger"
          disabled={pending}
          onClick={() => {
            lineAction.mutate(
              { lineId: line.id, action: 'delete' },
              {
                onSuccess: () => {
                  onDone();
                  show({
                    message: isLinked
                      ? `„${line.name}” pominięto w planie.`
                      : `Usunięto „${line.name}”.`,
                  });
                },
                onError: (error) => {
                  setFormError(error.message);
                },
              },
            );
          }}
          type="button"
          variant="ghost"
        >
          {isLinked ? 'Pomiń w planie' : 'Usuń z planu'}
        </Button>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-card px-4 pb-2 pt-3">
        {formError === undefined ? null : (
          <p className="mb-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Button
          loading={create.isPending || update.isPending}
          size="large"
          type="submit"
          variant="primary"
        >
          {line === null ? 'Dodaj do planu' : 'Zapisz zmiany'}
        </Button>
      </div>
    </form>
  );
}

/** Właściwości arkusza linii. */
export interface BudgetLineSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: MonthKey;
  /** Linia do edycji; `null` — nowa. */
  line: BudgetLineDto | null;
  /** Strona bilansu nowej linii (z sekcji). */
  addFlow: BudgetLineFlow;
  /** Grupy szkicu (ADR-081); domyślnie żadnych — pole „Grupa" się nie pokazuje. */
  groups?: readonly BudgetGroupDto[];
  /** Grupa nowej linii — ostatnio wybrana w sekcji. */
  addGroupId?: string | null;
  /** Wybór grupy przy zapisie. */
  onGroupChosen?: (flow: BudgetLineFlow, groupId: string | null) => void;
}

/**
 * Arkusz linii szkicu.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.month - Miesiąc planu.
 * @param props.line - Linia do edycji.
 * @param props.addFlow - Strona bilansu nowej linii.
 * @param props.groups - Grupy szkicu.
 * @param props.addGroupId - Grupa nowej linii.
 * @param props.onGroupChosen - Zapamiętanie wybranej grupy.
 * @returns Element arkusza.
 */
export function BudgetLineSheet({
  open,
  onOpenChange,
  month,
  line,
  addFlow,
  groups = [],
  addGroupId = null,
  onGroupChosen,
}: BudgetLineSheetProps): ReactNode {
  return (
    <Sheet
      onOpenChange={onOpenChange}
      open={open}
      title={line === null ? 'Nowa pozycja planu' : line.name}
    >
      {open ? (
        <LineForm
          addFlow={addFlow}
          addGroupId={addGroupId}
          groups={groups}
          onGroupChosen={onGroupChosen}
          key={line?.id ?? `new-${addFlow}`}
          line={line}
          month={month}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      ) : null}
    </Sheet>
  );
}
