import { formatMonth, type MonthKey } from '@fineapp/shared';
import { useState, type FormEvent, type ReactNode } from 'react';

import {
  Button,
  Checkbox,
  Money,
  OptionGrid,
  Sheet,
  Skeleton,
  useToast,
} from '../../../components/ui/index.js';
import { SwitchRow } from '../../recurring/components/recurring-form-sheet.js';
import { toCreateDraftRequest, type FillFormState } from '../budget-form-state.js';
import { useCategoryAverages, useCreateBudgetDraft } from '../hooks/use-budget.js';

/**
 * Arkusz „Utwórz z danych" — co wciągnąć do nowego planu
 * ([06 §3.14](../../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth),
 * 07 §13.2, `F9-7`).
 *
 * Źródła (reguły, raty, planowane, cele) są domyślnie włączone. Średnie kategorii —
 * zaznaczane ręcznie: plan ma być świadomy, a nie kopią wczorajszych wydatków (ADR-076).
 */

/** Okna średniej do wyboru. */
const WINDOW_OPTIONS: readonly { value: '3' | '6' | '12'; label: string }[] = [
  { value: '3', label: '3 mies.' },
  { value: '6', label: '6 mies.' },
  { value: '12', label: '12 mies.' },
];

/** Właściwości treści arkusza. */
interface FillFormProps {
  month: MonthKey;
  copyFrom: MonthKey | null;
  onDone: () => void;
}

/**
 * Treść arkusza — montowana przy każdym otwarciu.
 *
 * @param props - Właściwości komponentu.
 * @param props.month - Miesiąc nowego planu.
 * @param props.copyFrom - Najbliższy wcześniejszy plan albo `null`.
 * @param props.onDone - Zamknięcie arkusza.
 * @returns Element formularza.
 */
function FillForm({ month, copyFrom, onDone }: FillFormProps): ReactNode {
  const { show } = useToast();
  const create = useCreateBudgetDraft(month);
  const [state, setState] = useState<FillFormState>({
    fillFromSources: true,
    months: 3,
    categoryIds: [],
    copyManualFrom: null,
  });
  const averages = useCategoryAverages(state.months);
  const change = (patch: Partial<FillFormState>): void => {
    setState((current) => ({ ...current, ...patch }));
  };
  const toggle = (categoryId: string, checked: boolean): void => {
    setState((current) => ({
      ...current,
      categoryIds: checked
        ? [...current.categoryIds, categoryId]
        : current.categoryIds.filter((id) => id !== categoryId),
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    create.mutate(toCreateDraftRequest(state), {
      onSuccess: onDone,
      onError: (error) => {
        show({ message: error.message });
      },
    });
  };

  const items = averages.data?.items.filter((item) => item.averageMinor > 0) ?? [];

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <SwitchRow
        checked={state.fillFromSources}
        label="Pozycje cykliczne, raty, planowane wydatki i cele"
        onChange={(fillFromSources) => {
          change({ fillFromSources });
        }}
      />

      <div className="flex flex-col gap-2">
        <OptionGrid
          legend="Średnia wydatków z"
          onChange={(value) => {
            change({ months: Number(value) as 3 | 6 | 12 });
          }}
          options={WINDOW_OPTIONS}
          value={String(state.months) as '3' | '6' | '12'}
        />
        {averages.isPending ? (
          <div aria-busy="true" aria-label="Wczytywanie średnich">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="mt-2 h-11 w-full" />
          </div>
        ) : averages.isError ? (
          <p className="text-sm text-danger" role="alert">
            Nie udało się wczytać średnich.{' '}
            <Button
              onClick={() => {
                void averages.refetch();
              }}
              size="small"
              type="button"
              variant="link"
            >
              Spróbuj ponownie
            </Button>
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Za mało wydatków, żeby policzyć średnie.</p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.categoryId}>
                <Checkbox
                  checked={state.categoryIds.includes(item.categoryId)}
                  onCheckedChange={(checked) => {
                    toggle(item.categoryId, checked);
                  }}
                >
                  <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm">{item.name}</span>
                    <Money amountMinor={item.averageMinor} size="sm" />
                  </span>
                </Checkbox>
              </li>
            ))}
          </ul>
        )}
      </div>

      {copyFrom === null ? null : (
        <Checkbox
          checked={state.copyManualFrom !== null}
          onCheckedChange={(checked) => {
            change({ copyManualFrom: checked ? copyFrom : null });
          }}
        >
          <span className="text-sm">Skopiuj własne pozycje z {formatMonth(copyFrom)}</span>
        </Checkbox>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-card px-4 pb-2 pt-3">
        <Button loading={create.isPending} size="large" type="submit" variant="primary">
          Utwórz plan
        </Button>
      </div>
    </form>
  );
}

/** Właściwości arkusza. */
export interface BudgetFillSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: MonthKey;
  /** Najbliższy wcześniejszy plan — do kopii linii własnych. */
  copyFrom: MonthKey | null;
}

/**
 * Arkusz „Utwórz z danych".
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.month - Miesiąc nowego planu.
 * @param props.copyFrom - Najbliższy wcześniejszy plan.
 * @returns Element arkusza.
 */
export function BudgetFillSheet({
  open,
  onOpenChange,
  month,
  copyFrom,
}: BudgetFillSheetProps): ReactNode {
  return (
    <Sheet onOpenChange={onOpenChange} open={open} title={`Plan na ${formatMonth(month)}`}>
      {open ? (
        <FillForm
          copyFrom={copyFrom}
          month={month}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      ) : null}
    </Sheet>
  );
}
