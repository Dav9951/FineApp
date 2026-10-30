import {
  IncomeSourceKindSchema,
  type AccountDto,
  type CategoryKind,
  type GoalDto,
  type IncomeSourceDto,
  type IncomeSourceKind,
  type MonthKey,
} from '@fineapp/shared';
import { Check, ChevronLeft, Plus } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import {
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  OptionGrid,
  SkeletonList,
  TextField,
} from '../../../components/ui/index.js';
import { cn } from '../../../lib/cn.js';
import { ACCOUNT_TYPE_ICON, ALLOCATION_CLASS_SHORT_LABEL } from '../../accounts/accounts-view.js';
import { useCategoryTree } from '../../categories/hooks/use-categories.js';
import { GOAL_KIND_LABEL } from '../../goals/goals-view.js';
import { useGoals } from '../../goals/hooks/use-goals.js';
import {
  useCreateIncomeSource,
  useIncomeSources,
} from '../../income-sources/hooks/use-income-sources.js';
import { dateShortcuts, type DateShortcut } from '../transaction-form-state.js';
import { filterCategoryTree, INCOME_SOURCE_KIND_LABEL } from '../transaction-view.js';

/**
 * Widoki wyboru wewnątrz arkusza formularza transakcji: konto, kategoria, data, źródło.
 *
 * **Widoki, nie osobne arkusze.** Każdy `<Sheet>` przechwytuje przycisk „wstecz"
 * (15 §4.6); dwa arkusze jeden na drugim zamknęłyby się naraz jednym gestem, gubiąc
 * wypełniony formularz. Wybór podmienia treść arkusza, a „Wróć" przywraca formularz.
 */

/**
 * Nagłówek widoku wyboru: powrót do formularza i nazwa pola.
 *
 * @param props - Właściwości komponentu.
 * @param props.title - Czego dotyczy wybór.
 * @param props.onBack - Powrót do formularza.
 * @returns Element nagłówka.
 */
export function PickerHeader({ title, onBack }: { title: string; onBack: () => void }): ReactNode {
  return (
    <div className="mb-2 flex items-center gap-1">
      <button
        className="-ml-2 inline-flex min-h-touch min-w-touch items-center gap-1 px-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onBack}
        type="button"
      >
        <ChevronLeft aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        Wróć
      </button>
      <h3 className="text-base font-medium">{title}</h3>
    </div>
  );
}

/**
 * Znacznik wybranej pozycji: ikona, nie kolor (15 §2.4).
 *
 * @param props - Właściwości komponentu.
 * @param props.selected - Czy pozycja jest wybrana.
 * @returns Element znacznika albo pusty.
 */
function Selected({ selected }: { selected: boolean }): ReactNode {
  return selected ? (
    <Check aria-label="wybrane" className="h-5 w-5 text-primary" strokeWidth={1.5} />
  ) : null;
}

/** Właściwości wyboru konta. */
export interface AccountPickerProps {
  title: string;
  accounts: readonly AccountDto[];
  selectedId: string | null;
  /** Konto, którego nie wolno wybrać — drugie konto przelewu (I-2). */
  excludeId?: string | null;
  onSelect: (accountId: string) => void;
  onBack: () => void;
  /** Wyjście do ekranu kont, gdy nie ma żadnego. */
  onManageAccounts: () => void;
}

/**
 * Wybór konta — aktywne konta w kolejności listy kont.
 *
 * @param props - Właściwości komponentu.
 * @param props.title - Nazwa pola.
 * @param props.accounts - Konta do wyboru.
 * @param props.selectedId - Wybrane konto.
 * @param props.excludeId - Konto wykluczone z wyboru.
 * @param props.onSelect - Wybór konta.
 * @param props.onBack - Powrót do formularza.
 * @param props.onManageAccounts - Wyjście do ekranu kont.
 * @returns Element widoku.
 */
export function AccountPicker({
  title,
  accounts,
  selectedId,
  excludeId,
  onSelect,
  onBack,
  onManageAccounts,
}: AccountPickerProps): ReactNode {
  const choices = accounts.filter((account) => !account.isArchived && account.id !== excludeId);
  return (
    <div>
      <PickerHeader onBack={onBack} title={title} />
      {choices.length === 0 ? (
        <EmptyState
          action={
            <Button onClick={onManageAccounts} size="large" variant="primary">
              Przejdź do kont
            </Button>
          }
          description="Transakcja musi mieć konto. Dodaj je na ekranie kont."
          title="Nie ma konta do wyboru"
        />
      ) : (
        <ul>
          {choices.map((account, index) => {
            const Icon = ACCOUNT_TYPE_ICON[account.type];
            return (
              <li key={account.id}>
                <ListRow
                  amount={<Selected selected={account.id === selectedId} />}
                  caption={ALLOCATION_CLASS_SHORT_LABEL[account.allocationClass]}
                  first={index === 0}
                  icon={<Icon aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={1.5} />}
                  name={account.name}
                  onClick={() => {
                    onSelect(account.id);
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Właściwości wyboru kategorii. */
export interface CategoryPickerProps {
  kind: CategoryKind;
  selectedId: string | null;
  onSelect: (categoryId: string | null) => void;
  onBack: () => void;
}

/**
 * Wybór kategorii: wyszukiwarka, „Bez kategorii", drzewo rodzaju zgodnego z typem (I-4).
 *
 * Kategorie z seeda nie mają ikon, więc zamiast siatki ikon z 15 §4.10 jest lista
 * z podkategoriami pod rodzicem (ADR-037). Kategoria jest opcjonalna (07 §9.2) — lepiej
 * zapisać kwotę teraz niż wcale.
 *
 * @param props - Właściwości komponentu.
 * @param props.kind - Rodzaj kategorii.
 * @param props.selectedId - Wybrana kategoria.
 * @param props.onSelect - Wybór kategorii albo jej brak.
 * @param props.onBack - Powrót do formularza.
 * @returns Element widoku.
 */
export function CategoryPicker({
  kind,
  selectedId,
  onSelect,
  onBack,
}: CategoryPickerProps): ReactNode {
  const tree = useCategoryTree(kind);
  const [query, setQuery] = useState('');

  let list: ReactNode;
  if (tree.isPending) {
    list = <SkeletonList caption={false} rows={6} />;
  } else if (tree.isError) {
    list = (
      <ErrorState
        onRetry={() => {
          void tree.refetch();
        }}
        retrying={tree.isFetching}
        title="Nie udało się wczytać kategorii"
      />
    );
  } else {
    const filtered = filterCategoryTree(tree.data, query);
    list =
      filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Żadna kategoria nie pasuje do „{query.trim()}”.
        </p>
      ) : (
        <ul>
          {filtered.map((parent) => (
            <li key={parent.id}>
              <ListRow
                amount={<Selected selected={parent.id === selectedId} />}
                name={parent.name}
                onClick={() => {
                  onSelect(parent.id);
                }}
                wrapName
              />
              {parent.children.length > 0 ? (
                <ul className="pl-6">
                  {parent.children.map((child) => (
                    <li key={child.id}>
                      <ListRow
                        amount={<Selected selected={child.id === selectedId} />}
                        name={child.name}
                        onClick={() => {
                          onSelect(child.id);
                        }}
                        wrapName
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      );
  }

  return (
    <div>
      <PickerHeader onBack={onBack} title="Kategoria" />
      <TextField
        autoFocus
        label="Szukaj kategorii"
        onChange={setQuery}
        placeholder="np. kawa"
        value={query}
      />
      <div className="mt-3">
        <ListRow
          amount={<Selected selected={selectedId === null} />}
          first
          name="Bez kategorii"
          onClick={() => {
            onSelect(null);
          }}
        />
        {list}
      </div>
    </div>
  );
}

/** Właściwości wyboru daty. */
export interface DatePickerProps {
  selected: string;
  today: string;
  min: string;
  max: string;
  onSelect: (date: string) => void;
  onBack: () => void;
}

/**
 * Wybór daty: skróty „dziś / wczoraj / przedwczoraj" i kalendarz ograniczony do okna
 * księgowania (06 §3.3, I-8) — daty poza oknem są w kalendarzu wyszarzone.
 *
 * @param props - Właściwości komponentu.
 * @param props.selected - Wybrana data.
 * @param props.today - Dzisiejsza data.
 * @param props.min - Najwcześniejsza dozwolona data.
 * @param props.max - Najpóźniejsza dozwolona data.
 * @param props.onSelect - Wybór daty.
 * @param props.onBack - Powrót do formularza.
 * @returns Element widoku.
 */
export function DatePicker({
  selected,
  today,
  min,
  max,
  onSelect,
  onBack,
}: DatePickerProps): ReactNode {
  const shortcuts: DateShortcut[] = dateShortcuts(today, min);
  const inputId = useId();
  return (
    <div>
      <PickerHeader onBack={onBack} title="Data" />
      <ul>
        {shortcuts.map((shortcut, index) => (
          <li key={shortcut.date}>
            <ListRow
              amount={<Selected selected={shortcut.date === selected} />}
              first={index === 0}
              name={shortcut.label}
              onClick={() => {
                onSelect(shortcut.date);
              }}
            />
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-col gap-1">
        <label className="text-sm text-muted-foreground" htmlFor={inputId}>
          Inny dzień
        </label>
        <input
          className="min-h-touch w-full rounded-sm border border-input bg-card px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          id={inputId}
          max={max}
          min={min}
          onChange={(event) => {
            const value = event.target.value;
            if (value !== '' && value >= min && value <= max) onSelect(value);
          }}
          type="date"
          value={selected}
        />
        <p className="text-caption text-muted-foreground">
          Księgować można w obecnym miesiącu i w oknie ustawionym dla domu.
        </p>
      </div>
    </div>
  );
}

/** Właściwości wyboru źródła przychodu. */
export interface IncomeSourcePickerProps {
  selectedId: string | null;
  onSelect: (incomeSourceId: string | null) => void;
  onBack: () => void;
}

/** Opcje rodzaju źródła. */
const SOURCE_KIND_OPTIONS = IncomeSourceKindSchema.options.map((kind) => ({
  value: kind,
  label: INCOME_SOURCE_KIND_LABEL[kind],
}));

/**
 * Wybór źródła przychodu z szybkim dodaniem nowego (06 §3.3, wymaganie #10).
 *
 * Rodzaj jest wybierany przy dodaniu, bo od niego zależy, czy źródło wchodzi do podstawy
 * celów procentowych — zwrot podatku domyślnie nie wchodzi (07 §2.3).
 *
 * @param props - Właściwości komponentu.
 * @param props.selectedId - Wybrane źródło.
 * @param props.onSelect - Wybór źródła albo jego brak.
 * @param props.onBack - Powrót do formularza.
 * @returns Element widoku.
 */
export function IncomeSourcePicker({
  selectedId,
  onSelect,
  onBack,
}: IncomeSourcePickerProps): ReactNode {
  const sources = useIncomeSources();
  const create = useCreateIncomeSource();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<IncomeSourceKind>('salary');
  const [error, setError] = useState<string | undefined>(undefined);

  const add = (): void => {
    if (name.trim() === '') {
      setError('Nazwa jest wymagana');
      return;
    }
    create.mutate(
      { name: name.trim(), kind },
      {
        onSuccess: (source: IncomeSourceDto) => {
          onSelect(source.id);
        },
        onError: (failure) => {
          setError(failure.message);
        },
      },
    );
  };

  let list: ReactNode;
  if (sources.isPending) {
    list = <SkeletonList caption={false} rows={3} />;
  } else if (sources.isError) {
    list = (
      <ErrorState
        onRetry={() => {
          void sources.refetch();
        }}
        retrying={sources.isFetching}
        title="Nie udało się wczytać źródeł"
      />
    );
  } else {
    list = (
      <ul>
        {sources.data.map((source) => (
          <li key={source.id}>
            <ListRow
              amount={<Selected selected={source.id === selectedId} />}
              caption={INCOME_SOURCE_KIND_LABEL[source.kind]}
              name={source.name}
              onClick={() => {
                onSelect(source.id);
              }}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      <PickerHeader onBack={onBack} title="Źródło przychodu" />
      <ListRow
        amount={<Selected selected={selectedId === null} />}
        first
        name="Bez źródła"
        onClick={() => {
          onSelect(null);
        }}
      />
      {list}

      <div className={cn('mt-2 border-t border-border pt-3')}>
        {adding ? (
          <div className="flex flex-col gap-4">
            <TextField
              autoFocus
              error={error}
              label="Nazwa nowego źródła"
              maxLength={60}
              onChange={(value) => {
                setName(value);
                setError(undefined);
              }}
              placeholder="np. Pensja Adama"
              value={name}
            />
            <OptionGrid
              legend="Rodzaj"
              onChange={setKind}
              options={SOURCE_KIND_OPTIONS}
              value={kind}
            />
            <Button loading={create.isPending} onClick={add} size="large" variant="primary">
              Dodaj i wybierz
            </Button>
          </div>
        ) : (
          <Button
            onClick={() => {
              setAdding(true);
            }}
            size="large"
            variant="ghost"
          >
            <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            Nowe źródło
          </Button>
        )}
      </div>
    </div>
  );
}

/** Właściwości wyboru celu. */
export interface GoalPickerProps {
  /** Miesiąc planu — lista celów jest ta sama co na ekranie celów. */
  month: MonthKey;
  selectedId: string | null;
  /** Wybór celu (z celem — jego konto, gdy ma) albo jego brak. */
  onSelect: (goal: GoalDto | null) => void;
  onBack: () => void;
}

/**
 * Wybór celu wpłaty w przelewie — „Na cel" (06 §3.3, `Z-23`).
 *
 * Tylko cele aktywne i wstrzymane: na cel z archiwum API i tak nie przyjmie wpłaty.
 *
 * @param props - Właściwości komponentu.
 * @param props.month - Miesiąc planu.
 * @param props.selectedId - Wybrany cel.
 * @param props.onSelect - Wybór celu albo jego brak.
 * @param props.onBack - Powrót do formularza.
 * @returns Element widoku.
 */
export function GoalPicker({ month, selectedId, onSelect, onBack }: GoalPickerProps): ReactNode {
  const goals = useGoals(month);
  let list: ReactNode;
  if (goals.isPending) {
    list = <SkeletonList caption={false} rows={3} />;
  } else if (goals.isError) {
    list = (
      <ErrorState
        onRetry={() => {
          void goals.refetch();
        }}
        retrying={goals.isFetching}
        title="Nie udało się wczytać celów"
      />
    );
  } else {
    list = (
      <ul>
        {goals.data.data
          .filter((goal) => goal.status === 'active' || goal.status === 'paused')
          .map((goal) => (
            <li key={goal.id}>
              <ListRow
                amount={<Selected selected={goal.id === selectedId} />}
                caption={GOAL_KIND_LABEL[goal.kind]}
                name={goal.name}
                onClick={() => {
                  onSelect(goal);
                }}
              />
            </li>
          ))}
      </ul>
    );
  }
  return (
    <div>
      <PickerHeader onBack={onBack} title="Na cel" />
      <ListRow
        amount={<Selected selected={selectedId === null} />}
        first
        name="Bez celu"
        onClick={() => {
          onSelect(null);
        }}
      />
      {list}
    </div>
  );
}
