import type { CategoryDto, CategoryKind, CategoryTreeDto } from '@fineapp/shared';
import { useId, useState, type ReactNode } from 'react';

import {
  Badge,
  Button,
  Field,
  Section,
  Sheet,
  TextField,
  useToast,
} from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { cn } from '../../../lib/cn.js';
import {
  canMerge,
  draftOf,
  mergeTargets,
  parentOptions,
  toCreateRequest,
  toUpdateRequest,
  type CategoryDraft,
  type CategoryOption,
} from '../categories-view.js';
import {
  useCreateCategory,
  useDeleteCategory,
  useMergeCategory,
  useSetCategoryArchived,
  useUpdateCategory,
} from '../hooks/use-categories.js';

/**
 * Arkusz kategorii: nowa, edycja, archiwizacja, scalenie, usunięcie
 * ([06 §3.11](../../../../../../plans/06-ui-views.md#311-kategorie--settingscategories)).
 *
 * Pole „Podpowiedzi dla AI" ma wyjaśnienie wprost pod sobą — to ono steruje jakością
 * przypisania kategorii z paragonu (wymaganie #4), więc użytkownik ma wiedzieć, po co je
 * wypełnia.
 */

/** Wyjaśnienie pod polem podpowiedzi (06 §3.11). */
const AI_HINTS_HINT =
  'Nazwy sklepów i słowa z paragonów, po przecinku. Im więcej podasz, tym trafniej AI przypisze wydatki do tej kategorii.';

/** Nazwy rodzajów w tytule arkusza. */
const KIND_NOUN: Readonly<Record<CategoryKind, string>> = {
  expense: 'wydatku',
  income: 'przychodu',
  transfer: 'przelewu',
};

/**
 * Lista jednokrotnego wyboru z natywnymi przyciskami opcji.
 *
 * Nie `<OptionGrid>`: nazwy kategorii są długie („Oprogramowanie i narzędzia"), a siatka
 * trzech kafli na 390 px by je urywała. Wiersz 44 px z etykietą obejmującą cały wiersz,
 * jak `<Checkbox>` (15 §4.10).
 *
 * @param props - Właściwości komponentu.
 * @param props.legend - Podpis grupy.
 * @param props.options - Opcje.
 * @param props.value - Wybrany identyfikator.
 * @param props.onChange - Zmiana wyboru.
 * @returns Element listy.
 */
function RadioList({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly CategoryOption[];
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-1 text-sm text-muted-foreground">{legend}</legend>
      {options.map((option) => (
        <label
          className="flex min-h-touch cursor-pointer items-center gap-3 border-t border-border py-2 first-of-type:border-t-0"
          key={option.id}
        >
          <input
            checked={option.id === value}
            className={cn(
              'h-5 w-5 shrink-0 accent-primary',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
            name={name}
            onChange={() => {
              onChange(option.id);
            }}
            type="radio"
          />
          <span className="text-sm">{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Wartość „kategoria główna" w wyborze rodzica — radio wymaga napisu. */
const ROOT = '';

/** Właściwości arkusza kategorii. */
export interface CategoryFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rodzaj z zakładki ekranu — dla nowej kategorii. */
  kind: CategoryKind;
  /** Edytowana kategoria; brak = nowa. */
  category?: CategoryDto;
  /** Liczba podkategorii edytowanej (także z archiwum) — decyduje o scaleniu i rodzicu. */
  childCount?: number;
  /** Aktywne drzewo tego rodzaju — rodzice i cele scalenia. */
  active: readonly CategoryTreeDto[];
}

/**
 * Arkusz kategorii.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana otwarcia.
 * @param props.kind - Rodzaj nowej kategorii.
 * @param props.category - Edytowana kategoria.
 * @param props.childCount - Liczba podkategorii edytowanej.
 * @param props.active - Aktywne drzewo tego rodzaju.
 * @returns Element arkusza.
 */
export function CategoryFormSheet({
  open,
  onOpenChange,
  kind,
  category,
  childCount = 0,
  active,
}: CategoryFormSheetProps): ReactNode {
  const title = category === undefined ? `Nowa kategoria ${KIND_NOUN[kind]}` : 'Edytuj kategorię';
  // „Cofnij" w toaście działa po zamknięciu arkusza, gdy formularza już nie ma —
  // mutacja przywracająca musi żyć tutaj, nie w nim.
  const { mutate: restore } = useSetCategoryArchived();
  return (
    <Sheet onOpenChange={onOpenChange} open={open} title={title}>
      {/* Treść montowana przy każdym otwarciu — szkic zaczyna od stanu kategorii. */}
      {open ? (
        <CategoryForm
          active={active}
          category={category}
          childCount={childCount}
          kind={kind}
          onDone={() => {
            onOpenChange(false);
          }}
          onUndoArchive={(categoryId) => {
            restore({ categoryId, archived: false });
          }}
        />
      ) : null}
    </Sheet>
  );
}

/**
 * Treść arkusza.
 *
 * @param props - Właściwości komponentu.
 * @param props.kind - Rodzaj nowej kategorii.
 * @param props.category - Edytowana kategoria.
 * @param props.childCount - Liczba podkategorii edytowanej.
 * @param props.active - Aktywne drzewo tego rodzaju.
 * @param props.onDone - Zamknięcie arkusza.
 * @param props.onUndoArchive - „Cofnij" po archiwizacji.
 * @returns Element formularza.
 */
function CategoryForm({
  kind,
  category,
  childCount,
  active,
  onDone,
  onUndoArchive,
}: {
  kind: CategoryKind;
  category: CategoryDto | undefined;
  childCount: number;
  active: readonly CategoryTreeDto[];
  onDone: () => void;
  onUndoArchive: (categoryId: string) => void;
}): ReactNode {
  const [draft, setDraft] = useState<CategoryDraft>(() => draftOf(category));
  const [errors, setErrors] = useState<{ name?: string; aiHints?: string }>({});
  const [actionError, setActionError] = useState<string | undefined>();
  const [merging, setMerging] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [choosingParent, setChoosingParent] = useState(false);
  const { show } = useToast();

  const create = useCreateCategory();
  const update = useUpdateCategory();
  const archive = useSetCategoryArchived();
  const merge = useMergeCategory();
  const remove = useDeleteCategory();
  const busy =
    create.isPending ||
    update.isPending ||
    archive.isPending ||
    merge.isPending ||
    remove.isPending;

  const parents = parentOptions(active, category);
  const parentChoices = [{ id: ROOT, label: 'Kategoria główna' }, ...parents];
  const targets = category === undefined ? [] : mergeTargets(active, category);

  /**
   * Błąd zapisu: `409` (jedyny przy zapisie: nazwa zajęta wśród rodzeństwa, 04 §6)
   * trafia pod nazwę, reszta nad przyciskiem — `422` o rodzicu nie ma pola do podświetlenia.
   *
   * @param error - Błąd mutacji.
   */
  const onSaveError = (error: Error): void => {
    if (error instanceof ApiRequestError && error.status === 409)
      setErrors({ name: error.message });
    else setActionError(error.message);
  };

  const save = (): void => {
    setActionError(undefined);
    if (category === undefined) {
      const result = toCreateRequest(draft, kind);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      create.mutate(result.value, {
        onSuccess: (created) => {
          show({ message: `Dodano kategorię „${created.name}"` });
          onDone();
        },
        onError: onSaveError,
      });
      return;
    }
    const result = toUpdateRequest(category, draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (Object.keys(result.value).length === 0) {
      onDone();
      return;
    }
    update.mutate(
      { categoryId: category.id, body: result.value },
      { onSuccess: onDone, onError: onSaveError },
    );
  };

  const setArchived = (target: CategoryDto, archived: boolean): void => {
    setActionError(undefined);
    archive.mutate(
      { categoryId: target.id, archived },
      {
        onSuccess: () => {
          onDone();
          if (!archived) {
            show({ message: `Przywrócono „${target.name}"` });
            return;
          }
          show({
            message: `„${target.name}" w archiwum`,
            action: {
              label: 'Cofnij',
              onAction: () => {
                onUndoArchive(target.id);
              },
            },
          });
        },
        onError: (error) => {
          setActionError(error.message);
        },
      },
    );
  };

  return (
    <div>
      {category?.isSystem ? (
        <p className="mb-4 flex items-center gap-2 text-caption text-muted-foreground">
          <Badge tone="neutral">systemowa</Badge>
          Można ją zmienić i zarchiwizować, ale nie usunąć.
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        <TextField
          autoFocus={category === undefined}
          error={errors.name}
          label="Nazwa"
          maxLength={50}
          onChange={(name) => {
            setErrors({ ...errors, name: undefined });
            setDraft({ ...draft, name });
          }}
          value={draft.name}
        />

        <TextField
          error={errors.aiHints}
          hint={AI_HINTS_HINT}
          label="Podpowiedzi dla AI"
          maxLength={500}
          onChange={(aiHints) => {
            setErrors({ ...errors, aiHints: undefined });
            setDraft({ ...draft, aiHints });
          }}
          placeholder="Biedronka, Lidl, Żabka, Kaufland"
          rows={3}
          value={draft.aiHints}
        />

        {/* Rodzic zwinięty do jednego wiersza: pełna lista kategorii głównych (kilkanaście
            w zestawie domyślnym) spychała podpowiedzi dla AI poza ekran. */}
        {parents.length > 0 ? (
          choosingParent ? (
            <RadioList
              legend="Należy do"
              onChange={(value) => {
                setDraft({ ...draft, parentId: value === ROOT ? null : value });
                setChoosingParent(false);
              }}
              options={parentChoices}
              value={draft.parentId ?? ROOT}
            />
          ) : (
            <Field
              label="Należy do"
              onOpen={() => {
                setChoosingParent(true);
              }}
              value={
                parentChoices.find((option) => option.id === (draft.parentId ?? ROOT))?.label ??
                'Kategoria główna'
              }
            />
          )
        ) : null}
      </div>

      {actionError === undefined ? null : (
        <p className="mt-4 text-sm text-danger" role="alert">
          {actionError}
        </p>
      )}

      {category === undefined ? null : (
        <Section title="Działania">
          <div className="flex flex-col gap-2">
            {canMerge(category, childCount) && targets.length > 0 ? (
              merging ? (
                <div className="flex flex-col gap-3">
                  <RadioList
                    legend={`Scal „${category.name}" z`}
                    onChange={setMergeTarget}
                    options={targets}
                    value={mergeTarget ?? ''}
                  />
                  <p className="text-caption text-muted-foreground">
                    Transakcje i podpowiedzi przejdą do wybranej kategorii, a „{category.name}"
                    trafi do archiwum.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      onClick={() => {
                        setMerging(false);
                      }}
                      variant="ghost"
                    >
                      Anuluj
                    </Button>
                    <Button
                      className="flex-1"
                      disabled={mergeTarget === undefined || busy}
                      loading={merge.isPending}
                      onClick={() => {
                        if (mergeTarget === undefined) return;
                        setActionError(undefined);
                        merge.mutate(
                          { categoryId: category.id, targetCategoryId: mergeTarget },
                          {
                            onSuccess: (result) => {
                              onDone();
                              show({
                                message: `Scalono z „${result.target.name}" · przeniesiono transakcji: ${String(result.transactionsMoved)}`,
                              });
                            },
                            onError: (error) => {
                              setActionError(error.message);
                            },
                          },
                        );
                      }}
                      variant="primary"
                    >
                      Scal
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setMerging(true);
                  }}
                  variant="ghost"
                >
                  Scal z inną…
                </Button>
              )
            ) : null}

            <Button
              disabled={busy}
              loading={archive.isPending}
              onClick={() => {
                setArchived(category, !category.isArchived);
              }}
              variant="ghost"
            >
              {category.isArchived ? 'Przywróć z archiwum' : 'Archiwizuj'}
            </Button>

            {category.isSystem ? null : confirmDelete ? (
              <div className="flex flex-col gap-2 rounded-md border border-danger p-3">
                <p className="text-sm">
                  Usunąć „{category.name}" na stałe? Kategorii z transakcjami nie da się usunąć —
                  wtedy zarchiwizuj ją albo scal z inną.
                </p>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      setConfirmDelete(false);
                    }}
                    variant="ghost"
                  >
                    Anuluj
                  </Button>
                  <Button
                    className="flex-1"
                    loading={remove.isPending}
                    onClick={() => {
                      setActionError(undefined);
                      remove.mutate(category.id, {
                        onSuccess: () => {
                          onDone();
                          show({ message: `Usunięto „${category.name}"` });
                        },
                        onError: (error) => {
                          setConfirmDelete(false);
                          setActionError(error.message);
                        },
                      });
                    }}
                    variant="danger"
                  >
                    Usuń
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                disabled={busy}
                onClick={() => {
                  setConfirmDelete(true);
                }}
                variant="ghost"
              >
                Usuń
              </Button>
            )}
          </div>
        </Section>
      )}

      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-border bg-card px-4 pb-2 pt-3">
        <Button
          disabled={busy && !(create.isPending || update.isPending)}
          loading={create.isPending || update.isPending}
          onClick={save}
          size="large"
          variant="primary"
        >
          {category === undefined ? 'Dodaj' : 'Zapisz zmiany'}
        </Button>
      </div>
    </div>
  );
}
