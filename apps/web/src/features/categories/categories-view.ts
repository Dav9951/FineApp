import {
  CreateCategoryRequestSchema,
  type CategoryDto,
  type CategoryKind,
  type CategoryTreeDto,
  type CategoryUsageDto,
  type CreateCategoryRequest,
  type UpdateCategoryRequest,
} from '@fineapp/shared';

/**
 * Czyste reguły ekranu kategorii — `/settings/categories`
 * ([06 §3.11](../../../../../plans/06-ui-views.md#311-kategorie--settingscategories)).
 */

/** Użycie kategorii w postaci do wyświetlenia. */
export interface Usage {
  readonly transactionCount: number;
  readonly monthAmountMinor: number;
}

/** Brak transakcji. */
const NO_USAGE: Usage = { transactionCount: 0, monthAmountMinor: 0 };

/**
 * Składa użycie kategorii z wierszy API.
 *
 * Kategoria główna pokazuje **sumę ze swoimi podkategoriami**: „Jedzenie — 0,00 zł"
 * przy „Kawie — 120,00 zł" pod spodem wyglądałoby na błąd, bo wydatki trafiają
 * zwykle do podkategorii. API liczy każdą kategorię osobno (ADR-038), więc sumuje front.
 *
 * @param tree - Drzewo kategorii.
 * @param rows - Wiersze `GET /categories/usage`.
 * @returns Funkcja zwracająca użycie dla identyfikatora.
 */
export function usageLookup(
  tree: readonly CategoryTreeDto[],
  rows: readonly CategoryUsageDto[],
): (categoryId: string) => Usage {
  const own = new Map<string, Usage>(
    rows.map((row) => [
      row.categoryId,
      { transactionCount: row.transactionCount, monthAmountMinor: row.monthAmountMinor },
    ]),
  );
  const totals = new Map<string, Usage>();
  for (const root of tree) {
    let transactionCount = own.get(root.id)?.transactionCount ?? 0;
    let monthAmountMinor = own.get(root.id)?.monthAmountMinor ?? 0;
    for (const child of root.children) {
      const usage = own.get(child.id);
      totals.set(child.id, usage ?? NO_USAGE);
      transactionCount += usage?.transactionCount ?? 0;
      monthAmountMinor += usage?.monthAmountMinor ?? 0;
    }
    totals.set(root.id, { transactionCount, monthAmountMinor });
  }
  return (categoryId) => totals.get(categoryId) ?? own.get(categoryId) ?? NO_USAGE;
}

/** Kategoria z archiwum z nazwą rodzica — do sekcji „Archiwum". */
export interface ArchivedEntry {
  readonly category: CategoryDto;
  /** Rodzic aktywny albo z archiwum; `null` dla kategorii głównej. */
  readonly parentName: string | null;
}

/** Drzewo rozdzielone na aktywne i archiwum. */
export interface SplitTree {
  /** Aktywne kategorie główne wyłącznie z aktywnymi podkategoriami. */
  readonly active: readonly CategoryTreeDto[];
  /** Zarchiwizowane kategorie — główne i podkategorie — płasko, w kolejności drzewa. */
  readonly archived: readonly ArchivedEntry[];
}

/**
 * Rozdziela drzewo z archiwum na część aktywną i archiwum.
 *
 * Podkategoria zarchiwizowana pod aktywnym rodzicem trafia do archiwum, nie zostaje
 * pod rodzicem z plakietką: lista aktywnych ma odpowiadać temu, co widać w formularzu
 * transakcji. Archiwizacja rodzica archiwizuje dzieci (04 §6), więc dzieci rodzica
 * z archiwum też tam są.
 *
 * @param tree - Drzewo z `includeArchived=true`.
 * @returns Część aktywna i archiwum.
 */
export function splitTree(tree: readonly CategoryTreeDto[]): SplitTree {
  const active: CategoryTreeDto[] = [];
  const archived: ArchivedEntry[] = [];
  for (const root of tree) {
    const { children, ...rootCategory } = root;
    if (root.isArchived) archived.push({ category: rootCategory, parentName: null });
    else active.push({ ...root, children: children.filter((child) => !child.isArchived) });
    for (const child of children) {
      if (root.isArchived || child.isArchived) {
        archived.push({ category: child, parentName: root.name });
      }
    }
  }
  return { active, archived };
}

/** Kategoria jako cel wyboru (rodzic, scalenie). */
export interface CategoryOption {
  readonly id: string;
  /** „Jedzenie" albo „Jedzenie › Kawa". */
  readonly label: string;
}

/**
 * Kategorie, pod które można przenieść `category` (I-11: jeden poziom zagnieżdżenia).
 *
 * Kategoria z podkategoriami nie może sama stać się podkategorią (04 §6) — wtedy lista
 * jest pusta i formularz nie pokazuje wyboru rodzica.
 *
 * @param active - Aktywne drzewo tego samego rodzaju.
 * @param category - Edytowana kategoria; `undefined` przy nowej.
 * @returns Aktywne kategorie główne poza samą edytowaną.
 */
export function parentOptions(
  active: readonly CategoryTreeDto[],
  category?: CategoryDto,
): CategoryOption[] {
  if (category !== undefined) {
    const own = active.find((root) => root.id === category.id);
    if (own !== undefined && own.children.length > 0) return [];
  }
  return active
    .filter((root) => root.id !== category?.id)
    .map((root) => ({ id: root.id, label: root.name }));
}

/**
 * Kategorie, w które można scalić `source` (07 §9.3).
 *
 * Aktywne, tego samego rodzaju (drzewo jest już jednego rodzaju), poza samą sobą.
 * Źródło z podkategoriami i źródło systemowe API odrzuca — ekran w ogóle nie
 * proponuje wtedy scalenia ({@link canMerge}).
 *
 * @param active - Aktywne drzewo tego samego rodzaju.
 * @param source - Kategoria scalana.
 * @returns Cele scalenia z pełną ścieżką w etykiecie.
 */
export function mergeTargets(
  active: readonly CategoryTreeDto[],
  source: CategoryDto,
): CategoryOption[] {
  const options: CategoryOption[] = [];
  for (const root of active) {
    if (root.id !== source.id) options.push({ id: root.id, label: root.name });
    for (const child of root.children) {
      if (child.id !== source.id)
        options.push({ id: child.id, label: `${root.name} › ${child.name}` });
    }
  }
  return options;
}

/**
 * Czy kategorię da się scalić z inną — te same warunki co w API (04 §6).
 *
 * @param category - Kategoria.
 * @param childCount - Liczba jej podkategorii (także z archiwum).
 * @returns `true`, gdy scalenie ma sens.
 */
export function canMerge(category: CategoryDto, childCount: number): boolean {
  return !category.isSystem && !category.isArchived && childCount === 0;
}

/** Szkic formularza kategorii. */
export interface CategoryDraft {
  readonly name: string;
  /** `null` = kategoria główna. */
  readonly parentId: string | null;
  readonly aiHints: string;
}

/**
 * Szkic z kategorii albo pusty dla nowej.
 *
 * @param category - Edytowana kategoria.
 * @param parentId - Rodzic nowej podkategorii („Dodaj podkategorię").
 * @returns Szkic formularza.
 */
export function draftOf(category?: CategoryDto, parentId: string | null = null): CategoryDraft {
  if (category === undefined) return { name: '', parentId, aiHints: '' };
  return { name: category.name, parentId: category.parentId, aiHints: category.aiHints ?? '' };
}

/** Wynik walidacji szkicu. */
export type DraftResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: Readonly<Partial<Record<'name' | 'aiHints', string>>> };

/**
 * Sprawdza szkic tym samym schematem, co API, i buduje ciało `POST`.
 *
 * @param draft - Szkic formularza.
 * @param kind - Rodzaj kategorii (zakładka ekranu).
 * @returns Ciało żądania albo błędy pól.
 */
export function toCreateRequest(
  draft: CategoryDraft,
  kind: CategoryKind,
): DraftResult<CreateCategoryRequest> {
  const parsed = CreateCategoryRequestSchema.safeParse({
    name: draft.name,
    kind,
    parentId: draft.parentId,
    aiHints: draft.aiHints.trim() === '' ? null : draft.aiHints,
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Partial<Record<'name' | 'aiHints', string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if ((field === 'name' || field === 'aiHints') && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }
  return { ok: false, errors };
}

/**
 * Buduje `PATCH` z pól, które się zmieniły — jak formularz konta i transakcji.
 *
 * Wysłanie niezmienionego rodzica przy zmianie samej nazwy nic by nie zepsuło, ale
 * wysłanie **wszystkiego** przy każdej zmianie nadpisałoby zmianę drugiej osoby
 * zrobioną w międzyczasie na innym polu.
 *
 * @param original - Kategoria przed zmianą.
 * @param draft - Szkic formularza.
 * @returns Zmienione pola albo błędy; pusty obiekt, gdy nic się nie zmieniło.
 */
export function toUpdateRequest(
  original: CategoryDto,
  draft: CategoryDraft,
): DraftResult<UpdateCategoryRequest> {
  const checked = toCreateRequest(draft, original.kind);
  if (!checked.ok) return checked;
  const { name, parentId, aiHints } = checked.value;
  const body: UpdateCategoryRequest = {
    ...(name === original.name ? {} : { name }),
    ...((parentId ?? null) === original.parentId ? {} : { parentId: parentId ?? null }),
    ...((aiHints ?? null) === original.aiHints ? {} : { aiHints: aiHints ?? null }),
  };
  return { ok: true, value: body };
}
