import {
  BUDGET_GROUP_NAME_MAX,
  type BudgetGroupDto,
  type BudgetSection,
  type MonthKey,
} from '@fineapp/shared';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';

import { Button, Money, Sheet, TextField, useToast } from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { pluralPl } from '../../../lib/format.js';
import { layoutRequest, moveGroupBy } from '../budget-arrange.js';
import type { BudgetGroupView } from '../budget-view.js';
import { useBudgetGroupChange } from '../hooks/use-budget.js';

/**
 * Arkusz grupy linii szkicu — nowa grupa („+ Nowa grupa") albo istniejąca („⋯" przy
 * nagłówku w trybie układania)
 * ([06 §3.14](../../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth),
 * ADR-081).
 *
 * „Przesuń wyżej / niżej" to droga bez przeciągania (15 §2). „Usuń grupę" nie pyta
 * o potwierdzenie — pozycje zostają w „Bez grupy", a toast ma „Cofnij".
 */

/** Właściwości arkusza grupy. */
export interface BudgetGroupSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly month: MonthKey;
  readonly section: BudgetSection;
  /** Grupa z liniami; `null` — nowa grupa. */
  readonly view: BudgetGroupView | null;
  /** Pozycja grupy wśród grup sekcji (do „Cofnij" usunięcia). */
  readonly position: number;
  /** Pełna lista elementów sekcji (`arrangeItems`) — do „Przesuń". */
  readonly items: readonly string[];
}

/** Właściwości treści arkusza. */
type GroupFormProps = Omit<BudgetGroupSheetProps, 'open' | 'onOpenChange'> & {
  readonly group: BudgetGroupDto | null;
  readonly onDone: () => void;
};

/**
 * Treść arkusza — montowana od nowa przy każdym otwarciu.
 *
 * @param props - Właściwości komponentu.
 * @param props.month - Miesiąc szkicu.
 * @param props.section - Sekcja.
 * @param props.view - Grupa z liniami albo `null`.
 * @param props.group - Grupa albo `null`.
 * @param props.position - Miejsce grupy w sekcji.
 * @param props.items - Elementy sekcji.
 * @param props.onDone - Zamknięcie arkusza.
 * @returns Element treści.
 */
function GroupForm({
  month,
  section,
  view,
  group,
  position,
  items,
  onDone,
}: GroupFormProps): ReactNode {
  const toast = useToast();
  const change = useBudgetGroupChange(month);
  const [name, setName] = useState(group?.name ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const order = items.filter((item) => item.startsWith('g:'));
  const index = group === null ? -1 : order.indexOf(`g:${group.id}`);

  const onError = (failure: Error): void => {
    setError(
      failure instanceof ApiRequestError
        ? (failure.fieldErrors().name ?? failure.message)
        : failure.message,
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('Nazwa jest wymagana');
      return;
    }
    if (group === null) {
      change.mutate(
        { kind: 'create', body: { section, name: trimmed } },
        { onSuccess: onDone, onError },
      );
    } else if (trimmed === group.name) {
      onDone();
    } else {
      change.mutate(
        { kind: 'rename', groupId: group.id, name: trimmed },
        { onSuccess: onDone, onError },
      );
    }
  };

  const move = (delta: -1 | 1): void => {
    if (group === null) return;
    change.mutate(
      { kind: 'layout', body: layoutRequest(section, moveGroupBy(items, group.id, delta)) },
      {
        onError: (failure) => {
          toast.show({ message: failure.message });
        },
      },
    );
  };

  const remove = (): void => {
    if (group === null) return;
    const lineIds = view?.lines.map((line) => line.id) ?? [];
    change.mutate(
      { kind: 'delete', groupId: group.id },
      {
        onError,
        onSuccess: () => {
          onDone();
          toast.show({
            message: `Usunięto grupę „${group.name}”. Pozycje zostały.`,
            action: {
              label: 'Cofnij',
              onAction: () => {
                change.mutate(
                  { kind: 'create', body: { section, name: group.name, lineIds, position } },
                  {
                    onError: (failure) => {
                      toast.show({ message: failure.message });
                    },
                  },
                );
              },
            },
          });
        },
      },
    );
  };

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
      <TextField
        autoFocus={group === null}
        error={error}
        label="Nazwa"
        maxLength={BUDGET_GROUP_NAME_MAX}
        onChange={(value) => {
          setName(value);
          setError(undefined);
        }}
        placeholder="np. Mieszkanie i media"
        value={name}
      />
      {view === null || group === null ? null : (
        <>
          <p className="flex items-baseline justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {String(view.lines.length)}{' '}
              {pluralPl(view.lines.length, 'pozycja', 'pozycje', 'pozycji')} w grupie
            </span>
            <Money amountMinor={view.totalMinor} size="sm" />
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              disabled={change.isPending || index <= 0}
              onClick={() => {
                move(-1);
              }}
              type="button"
              variant="ghost"
            >
              <ArrowUp aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
              Przesuń wyżej
            </Button>
            <Button
              disabled={change.isPending || index < 0 || index >= order.length - 1}
              onClick={() => {
                move(1);
              }}
              type="button"
              variant="ghost"
            >
              <ArrowDown aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
              Przesuń niżej
            </Button>
          </div>
          <Button
            className="justify-start text-danger"
            disabled={change.isPending}
            onClick={remove}
            type="button"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
            Usuń grupę — pozycje zostają
          </Button>
        </>
      )}
      <Button loading={change.isPending} size="large" type="submit" variant="primary">
        {group === null ? 'Dodaj grupę' : 'Zapisz'}
      </Button>
    </form>
  );
}

/**
 * Arkusz grupy.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy otwarty.
 * @param props.onOpenChange - Zmiana otwarcia.
 * @param props.month - Miesiąc szkicu.
 * @param props.section - Sekcja.
 * @param props.view - Grupa z liniami albo `null` (nowa).
 * @param props.position - Miejsce grupy w sekcji.
 * @param props.items - Elementy sekcji.
 * @returns Element arkusza.
 */
export function BudgetGroupSheet({
  open,
  onOpenChange,
  month,
  section,
  view,
  position,
  items,
}: BudgetGroupSheetProps): ReactNode {
  const group = view?.group ?? null;
  return (
    <Sheet onOpenChange={onOpenChange} open={open} title={group === null ? 'Nowa grupa' : 'Grupa'}>
      {open ? (
        <GroupForm
          group={group}
          items={items}
          key={group?.id ?? `new-${section}`}
          month={month}
          onDone={() => {
            onOpenChange(false);
          }}
          position={position}
          section={section}
          view={view}
        />
      ) : null}
    </Sheet>
  );
}
