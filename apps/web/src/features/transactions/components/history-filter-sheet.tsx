import { type CategoryKind, type CategoryTreeDto } from '@fineapp/shared';
import { useState, type ReactNode } from 'react';

import {
  Button,
  Checkbox,
  Section,
  Sheet,
  SkeletonList,
  TextField,
  minorToDraft,
} from '../../../components/ui/index.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { useCategoryTree } from '../../categories/hooks/use-categories.js';
import { useIncomeSources } from '../../income-sources/hooks/use-income-sources.js';
import { parseAmountBound, toggleCategory, type HistoryFilters } from '../history-filters.js';

/**
 * Panel filtrów historii (06 §3.2): konto, kategoria (wybór wielokrotny), źródło
 * przychodu, zakres kwot, kosz (ADR-038). Tekst i typ są na samym ekranie.
 *
 * Panel pracuje na **szkicu**: zmiany trafiają do adresu dopiero po „Pokaż wyniki".
 * Filtrowanie przy każdym kliknięciu pole wyboru wysyłałoby żądanie za żądaniem
 * i przewijało listę pod otwartym arkuszem, którego i tak nie widać.
 */

/** Szkic filtrów panelu. */
interface Draft {
  accountIds: readonly string[];
  categoryIds: readonly string[];
  uncategorized: boolean;
  incomeSourceIds: readonly string[];
  min: string;
  max: string;
  includeDeleted: boolean;
}

/**
 * Szkic z bieżących filtrów.
 *
 * @param filters - Filtry z adresu.
 * @returns Szkic panelu.
 */
function draftOf(filters: HistoryFilters): Draft {
  return {
    accountIds: filters.accountIds,
    categoryIds: filters.categoryIds,
    uncategorized: filters.uncategorized === true,
    incomeSourceIds: filters.incomeSourceIds,
    min: filters.minAmountMinor === undefined ? '' : minorToDraft(filters.minAmountMinor) || '0',
    max: filters.maxAmountMinor === undefined ? '' : minorToDraft(filters.maxAmountMinor) || '0',
    includeDeleted: filters.includeDeleted === true,
  };
}

/**
 * Przełącza identyfikator w liście.
 *
 * @param list - Wybrane identyfikatory.
 * @param id - Przełączany identyfikator.
 * @returns Nowa lista.
 */
function toggle(list: readonly string[], id: string): readonly string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

/** Nazwy sekcji kategorii według rodzaju. */
const KIND_TITLE: Readonly<Record<CategoryKind, string>> = {
  expense: 'Kategorie wydatków',
  income: 'Kategorie przychodów',
  transfer: 'Kategorie przelewów',
};

/**
 * Lista kategorii jednego rodzaju z polami wyboru.
 *
 * @param props - Właściwości komponentu.
 * @param props.kind - Rodzaj kategorii.
 * @param props.selected - Wybrane identyfikatory.
 * @param props.onChange - Zmiana wyboru.
 * @returns Element sekcji.
 */
function CategoryChecklist({
  kind,
  selected,
  onChange,
}: {
  kind: CategoryKind;
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
}): ReactNode {
  const tree = useCategoryTree(kind);
  let content: ReactNode;
  if (tree.isPending) content = <SkeletonList rows={3} />;
  else if (tree.isError)
    content = <p className="text-caption text-danger">Nie udało się wczytać.</p>;
  else {
    content = (
      <ul>
        {tree.data.map((root: CategoryTreeDto) => (
          <li key={root.id}>
            <Checkbox
              checked={selected.includes(root.id)}
              onCheckedChange={() => {
                onChange(toggleCategory(selected, root));
              }}
            >
              <span className="font-medium">{root.name}</span>
            </Checkbox>
            {root.children.length > 0 ? (
              <ul className="pl-8">
                {root.children.map((child) => (
                  <li key={child.id}>
                    <Checkbox
                      checked={selected.includes(child.id)}
                      onCheckedChange={() => {
                        onChange(toggleCategory(selected, { id: child.id, children: [] }));
                      }}
                    >
                      {child.name}
                    </Checkbox>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }
  return <Section title={KIND_TITLE[kind]}>{content}</Section>;
}

/** Właściwości panelu filtrów. */
export interface HistoryFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bieżące filtry z adresu. */
  filters: HistoryFilters;
  /** Zatwierdzenie — nowe filtry z zachowanym typem i tekstem. */
  onApply: (filters: HistoryFilters) => void;
}

/**
 * Arkusz z filtrami historii.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana otwarcia.
 * @param props.filters - Bieżące filtry.
 * @param props.onApply - Zatwierdzenie filtrów.
 * @returns Element arkusza.
 */
export function HistoryFilterSheet({
  open,
  onOpenChange,
  filters,
  onApply,
}: HistoryFilterSheetProps): ReactNode {
  return (
    <Sheet onOpenChange={onOpenChange} open={open} title="Filtry">
      {/* Treść montowana na nowo przy każdym otwarciu — szkic startuje od filtrów
          z adresu, a nie od porzuconego poprzednio szkicu. */}
      {open ? <FilterPanel filters={filters} onApply={onApply} /> : null}
    </Sheet>
  );
}

/**
 * Treść panelu filtrów.
 *
 * @param props - Właściwości komponentu.
 * @param props.filters - Bieżące filtry.
 * @param props.onApply - Zatwierdzenie filtrów.
 * @returns Element panelu.
 */
function FilterPanel({
  filters,
  onApply,
}: {
  filters: HistoryFilters;
  onApply: (filters: HistoryFilters) => void;
}): ReactNode {
  const [draft, setDraft] = useState<Draft>(() => draftOf(filters));
  const [errors, setErrors] = useState<{ min?: string; max?: string }>({});
  const accounts = useAccountList(true);
  const showIncomeSources = filters.type === undefined || filters.type === 'income';
  const sources = useIncomeSources(showIncomeSources);
  const kinds: readonly CategoryKind[] =
    filters.type === undefined ? ['expense', 'income'] : [filters.type];

  const apply = (): void => {
    const min = parseAmountBound(draft.min);
    const max = parseAmountBound(draft.max);
    const nextErrors = {
      ...(min.ok ? {} : { min: 'Wpisz kwotę, np. 25,50' }),
      ...(max.ok ? {} : { max: 'Wpisz kwotę, np. 250' }),
    };
    setErrors(nextErrors);
    if (!min.ok || !max.ok) return;
    let low = min.minor;
    let high = max.minor;
    if (low !== undefined && high !== undefined && low > high) [low, high] = [high, low];
    onApply({
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.q ? { q: filters.q } : {}),
      accountIds: draft.accountIds,
      categoryIds: draft.uncategorized ? [] : draft.categoryIds,
      ...(draft.uncategorized ? { uncategorized: true as const } : {}),
      incomeSourceIds: showIncomeSources ? draft.incomeSourceIds : [],
      ...(low === undefined ? {} : { minAmountMinor: low }),
      ...(high === undefined ? {} : { maxAmountMinor: high }),
      ...(draft.includeDeleted ? { includeDeleted: true as const } : {}),
    });
  };

  return (
    <div>
      <Section first title="Kwota">
        <div className="grid grid-cols-2 gap-3">
          <TextField
            error={errors.min}
            inputMode="decimal"
            label="Kwota od"
            onChange={(min) => {
              setDraft({ ...draft, min });
            }}
            placeholder="0"
            value={draft.min}
          />
          <TextField
            error={errors.max}
            inputMode="decimal"
            label="Kwota do"
            onChange={(max) => {
              setDraft({ ...draft, max });
            }}
            placeholder="bez limitu"
            value={draft.max}
          />
        </div>
      </Section>

      <Section title="Konto">
        {accounts.isPending ? (
          <SkeletonList rows={2} />
        ) : accounts.isError ? (
          <p className="text-caption text-danger">Nie udało się wczytać kont.</p>
        ) : (
          <ul>
            {accounts.data.map((account) => (
              <li key={account.id}>
                <Checkbox
                  checked={draft.accountIds.includes(account.id)}
                  onCheckedChange={() => {
                    setDraft({ ...draft, accountIds: toggle(draft.accountIds, account.id) });
                  }}
                >
                  {account.name}
                  {account.isArchived ? (
                    <span className="text-muted-foreground"> · w archiwum</span>
                  ) : null}
                </Checkbox>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {kinds.map((kind) => (
        <CategoryChecklist
          key={kind}
          kind={kind}
          onChange={(categoryIds) => {
            setDraft({ ...draft, categoryIds, uncategorized: false });
          }}
          selected={draft.categoryIds}
        />
      ))}

      {showIncomeSources ? (
        <Section title="Źródło przychodu">
          {sources.isPending ? (
            <SkeletonList rows={2} />
          ) : sources.isError ? (
            <p className="text-caption text-danger">Nie udało się wczytać źródeł.</p>
          ) : sources.data.length === 0 ? (
            <p className="text-caption text-muted-foreground">Brak źródeł przychodu.</p>
          ) : (
            <ul>
              {sources.data.map((source) => (
                <li key={source.id}>
                  <Checkbox
                    checked={draft.incomeSourceIds.includes(source.id)}
                    onCheckedChange={() => {
                      setDraft({
                        ...draft,
                        incomeSourceIds: toggle(draft.incomeSourceIds, source.id),
                      });
                    }}
                  >
                    {source.name}
                  </Checkbox>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      <Section title="Bez kategorii">
        <Checkbox
          checked={draft.uncategorized}
          onCheckedChange={(uncategorized) => {
            // Wybrane kategorie i „bez kategorii" się wykluczają — zaznaczenie czyści wybór.
            setDraft({
              ...draft,
              uncategorized,
              categoryIds: uncategorized ? [] : draft.categoryIds,
            });
          }}
        >
          Tylko transakcje bez kategorii
        </Checkbox>
      </Section>

      <Section title="Kosz">
        <Checkbox
          checked={draft.includeDeleted}
          onCheckedChange={(includeDeleted) => {
            setDraft({ ...draft, includeDeleted });
          }}
        >
          Pokaż usunięte transakcje
        </Checkbox>
      </Section>

      <div className="sticky bottom-0 -mx-4 mt-4 flex gap-3 border-t border-border bg-card px-4 pb-2 pt-3">
        <Button
          className="flex-1"
          onClick={() => {
            setErrors({});
            setDraft({
              accountIds: [],
              categoryIds: [],
              uncategorized: false,
              incomeSourceIds: [],
              min: '',
              max: '',
              includeDeleted: false,
            });
          }}
          size="large"
          variant="ghost"
        >
          Wyczyść
        </Button>
        <Button className="flex-1" onClick={apply} size="large" variant="primary">
          Pokaż wyniki
        </Button>
      </div>
    </div>
  );
}
