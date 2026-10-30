import {
  sameName,
  type CategoryDto,
  type CategoryTreeDto,
  type CategoryUsageDto,
  type CategoryUsageQuery,
  type CreateCategoryRequest,
  type ListCategoriesQuery,
  type MergeCategoryRequest,
  type MergeCategoryResponse,
  type UpdateCategoryRequest,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import { ConflictError, DomainRuleViolationError, NotFoundError } from '../../core/errors.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import type { CategoryRow } from '../../db/schema/categories.js';
import {
  categoryHasTransactions,
  categoryUsage,
  moveTransactionsToCategory,
} from '../transactions/transactions.ledger.js';
import { moveBudgetLinesToCategory } from '../budget/budget.external.js';
import { moveLiabilitiesToCategory } from '../liabilities/liabilities.external.js';
import { moveDocumentItemsToCategory } from '../documents/documents.external.js';
import { movePlannedExpensesToCategory } from '../planned-expenses/planned-expenses.external.js';
import { moveRecurringRulesToCategory } from '../recurring/recurring.external.js';
import { toCategoryDto } from './categories.mapper.js';
import {
  findCategories,
  findCategoryById,
  findChildren,
  findMaxSiblingSortOrder,
  findSiblings,
  insertCategory,
  patchCategory,
  removeCategory,
  setArchived,
  slugTaken,
  type CategoryPatch,
} from './categories.repository.js';
import {
  buildCategoryTree,
  flattenCategoryTree,
  mergeAiHints,
  slugCandidates,
} from './categories.rules.js';

/**
 * Reguły kategorii — zadanie `F2-3`
 * ([04 §6](../../../../../../plans/04-api-spec.md#6-kategorie--apiv1categories),
 * [07 §9](../../../../../../plans/07-domain-rules.md#9-kategoryzacja)).
 *
 * Pilnowane tutaj niezmienniki: I-9 (systemowej nie usuwamy), I-10 (z transakcjami
 * tylko archiwizacja), I-11 (jeden poziom zagnieżdżenia). Do tego rodzic i dziecko
 * mają ten sam `kind` — inaczej I-4 dałoby się obejść przez drzewo.
 */

/** Komunikat dla kategorii spoza gospodarstwa albo nieistniejącej — celowo ten sam. */
const NOT_FOUND = 'Nie znaleziono kategorii.';

/**
 * Zwraca kategorię gospodarstwa albo rzuca `404`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param categoryId - Identyfikator kategorii.
 * @param message - Komunikat błędu.
 * @returns Wiersz kategorii.
 * @throws {NotFoundError} Gdy kategorii nie ma w gospodarstwie.
 */
function requireCategory(
  handle: DbHandle,
  householdId: string,
  categoryId: string,
  message = NOT_FOUND,
): CategoryRow {
  const row = findCategoryById(handle, householdId, categoryId);
  if (row === undefined) throw new NotFoundError(message);
  return row;
}

/**
 * Sprawdza, czy kategoria może zostać rodzicem kategorii rodzaju `kind`.
 *
 * @param parent - Kandydat na rodzica.
 * @param kind - Rodzaj dziecka.
 * @throws {DomainRuleViolationError} Gdy rodzic sam jest podkategorią (I-11), jest
 *   innego rodzaju albo jest zarchiwizowany.
 */
function assertValidParent(parent: CategoryRow, kind: CategoryRow['kind']): void {
  if (parent.parentId !== null) {
    throw new DomainRuleViolationError(
      'Podkategoria nie może mieć własnych podkategorii — wybierz kategorię główną.',
    );
  }
  if (parent.kind !== kind) {
    throw new DomainRuleViolationError(
      'Kategoria nadrzędna musi być tego samego rodzaju (wydatek, przychód, przelew).',
    );
  }
  if (parent.isArchived) {
    throw new DomainRuleViolationError('Kategoria nadrzędna jest zarchiwizowana.');
  }
}

/**
 * Sprawdza, czy nazwa jest wolna wśród rodzeństwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param kind - Rodzaj kategorii.
 * @param parentId - Rodzic albo `null`.
 * @param name - Nazwa do sprawdzenia.
 * @param selfId - Kategoria, która może tę nazwę już nosić (przy edycji).
 * @throws {ConflictError} Gdy nazwa jest zajęta.
 */
function assertNameFree(
  handle: DbHandle,
  householdId: string,
  kind: CategoryRow['kind'],
  parentId: string | null,
  name: string,
  selfId?: string,
): void {
  const clash = findSiblings(handle, householdId, kind, parentId).find(
    (row) => row.id !== selfId && sameName(row.name, name),
  );
  if (clash !== undefined) {
    throw new ConflictError(
      clash.isArchived
        ? `Kategoria „${clash.name}” już istnieje w archiwum — przywróć ją zamiast zakładać nową.`
        : `Kategoria „${clash.name}” już istnieje.`,
    );
  }
}

/**
 * Zwraca kategorię gospodarstwa na potrzeby innego modułu.
 *
 * Serwis transakcji sprawdza tędy zgodność rodzaju kategorii z typem transakcji (I-4).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param categoryId - Identyfikator kategorii.
 * @returns Kategoria albo `undefined`, także dla kategorii innego gospodarstwa.
 */
export function lookupCategory(
  handle: DbHandle,
  householdId: string,
  categoryId: string,
): CategoryDto | undefined {
  const row = findCategoryById(handle, householdId, categoryId);
  return row === undefined ? undefined : toCategoryDto(row);
}

/**
 * Zwraca drzewo kategorii gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Rodzaj i czy dołączyć zarchiwizowane.
 * @returns Kategorie główne z podkategoriami.
 */
export function listCategoryTree(
  handle: DbHandle,
  householdId: string,
  query: ListCategoriesQuery,
): CategoryTreeDto[] {
  return buildCategoryTree(findCategories(handle, householdId, query).map(toCategoryDto));
}

/**
 * Zwraca kategorie jako listę płaską w kolejności drzewa — dla selectów i promptu AI.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Rodzaj i czy dołączyć zarchiwizowane.
 * @returns Lista płaska: rodzic, jego dzieci, następny rodzic.
 */
export function listCategoriesFlat(
  handle: DbHandle,
  householdId: string,
  query: ListCategoriesQuery,
): CategoryDto[] {
  return flattenCategoryTree(listCategoryTree(handle, householdId, query));
}

/**
 * Zwraca użycie kategorii gospodarstwa: liczbę transakcji i sumę w miesiącu (ADR-038).
 *
 * Liczby dotyczą samej kategorii — sumę rodzica z podkategoriami składa ekran. Tylko
 * kategorie z transakcjami; brak wiersza znaczy „nieużywana".
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Miesiąc sumy.
 * @returns Użycie kategorii.
 */
export function listCategoryUsage(
  handle: DbHandle,
  householdId: string,
  query: CategoryUsageQuery,
): CategoryUsageDto[] {
  return categoryUsage(handle, householdId, query.month).map((row) => ({
    categoryId: row.categoryId,
    transactionCount: row.transactionCount,
    monthAmountMinor: row.monthAmountMinor,
  }));
}

/**
 * Zakłada kategorię albo podkategorię.
 *
 * Slug powstaje raz, przy założeniu, i się nie zmienia (ADR-033). Nowa kategoria
 * trafia na koniec swojego rodzeństwa.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Zwalidowane dane.
 * @returns Założona kategoria.
 * @throws {NotFoundError} Gdy rodzica nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Gdy rodzic łamie I-11, rodzaj albo jest zarchiwizowany.
 * @throws {ConflictError} Gdy nazwa jest zajęta wśród rodzeństwa.
 */
export function createCategory(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  input: CreateCategoryRequest,
): CategoryDto {
  const now = clock.now().getTime();
  const parentId = input.parentId ?? null;

  const row = handle.sqlite.transaction(() => {
    let parentSlug: string | null = null;
    if (parentId !== null) {
      const parent = requireCategory(
        handle,
        householdId,
        parentId,
        'Nie znaleziono kategorii nadrzędnej.',
      );
      assertValidParent(parent, input.kind);
      parentSlug = parent.slug;
    }
    assertNameFree(handle, householdId, input.kind, parentId, input.name);

    let slug = '';
    for (const candidate of slugCandidates(input.name, parentSlug)) {
      if (!slugTaken(handle, householdId, input.kind, candidate)) {
        slug = candidate;
        break;
      }
    }

    return insertCategory(handle, {
      id: newId(),
      householdId,
      parentId,
      name: input.name,
      slug,
      kind: input.kind,
      icon: input.icon ?? null,
      color: input.color ?? null,
      aiHints: input.aiHints ?? null,
      isSystem: false,
      isArchived: false,
      sortOrder: findMaxSiblingSortOrder(handle, householdId, input.kind, parentId) + 1,
      createdAt: now,
      updatedAt: now,
    });
  })();
  return toCategoryDto(row);
}

/**
 * Zmienia kategorię — także systemową (nazwa, ikona, podpowiedzi AI).
 *
 * Przeniesienie pod innego rodzica pilnuje I-11 z obu stron: nowy rodzic musi być
 * kategorią główną, a przenoszona kategoria nie może mieć własnych dzieci — inaczej
 * powstałby trzeci poziom. Przeniesiona kategoria trafia na koniec nowego rodzeństwa.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param categoryId - Identyfikator kategorii.
 * @param input - Zwalidowane zmiany.
 * @returns Kategoria po zmianie.
 * @throws {NotFoundError} Gdy kategorii albo nowego rodzica nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Gdy przeniesienie łamie I-11 albo zgodność rodzaju.
 * @throws {ConflictError} Gdy nazwa jest zajęta w docelowym rodzeństwie.
 */
export function updateCategory(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  categoryId: string,
  input: UpdateCategoryRequest,
): CategoryDto {
  const now = clock.now().getTime();
  const row = handle.sqlite.transaction(() => {
    const current = requireCategory(handle, householdId, categoryId);
    const patch: CategoryPatch = {};

    const moving = input.parentId !== undefined && input.parentId !== current.parentId;
    const parentId = moving ? (input.parentId ?? null) : current.parentId;
    if (moving && parentId !== null) {
      if (parentId === current.id) {
        throw new DomainRuleViolationError('Kategoria nie może być własną podkategorią.');
      }
      const parent = requireCategory(
        handle,
        householdId,
        parentId,
        'Nie znaleziono kategorii nadrzędnej.',
      );
      assertValidParent(parent, current.kind);
      if (findChildren(handle, householdId, current.id).length > 0) {
        throw new DomainRuleViolationError(
          'Kategoria ma podkategorie, więc nie może stać się podkategorią.',
        );
      }
    }

    const name = input.name ?? current.name;
    if (moving || !sameName(name, current.name)) {
      assertNameFree(handle, householdId, current.kind, parentId, name, current.id);
    }

    if (input.name !== undefined && input.name !== current.name) patch.name = input.name;
    if (moving) {
      patch.parentId = parentId;
      // Kategoria nie należy jeszcze do nowego rodzeństwa, więc `max + 1` liczone przed
      // zapisem stawia ją na końcu, nie licząc jej samej.
      patch.sortOrder = findMaxSiblingSortOrder(handle, householdId, current.kind, parentId) + 1;
    }
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.color !== undefined) patch.color = input.color;
    if (input.aiHints !== undefined) patch.aiHints = input.aiHints;

    // Puste PATCH nie jest zmianą — `updated_at` zostaje.
    if (Object.keys(patch).length === 0) return current;

    const updated = patchCategory(handle, householdId, categoryId, patch, now);
    // Drugi użytkownik mógł usunąć kategorię w międzyczasie — lepiej 404 niż 500.
    if (updated === undefined) throw new NotFoundError(NOT_FOUND);
    return updated;
  })();
  return toCategoryDto(row);
}

/**
 * Archiwizuje kategorię; kategoria główna zabiera ze sobą podkategorie.
 *
 * Aktywna podkategoria pod zarchiwizowanym rodzicem zniknęłaby z drzewa razem z nim,
 * a mimo to dalej byłaby do wybrania w formularzu — dlatego archiwizacja idzie w dół.
 * Historia zostaje: transakcje nadal liczą się w swoich miesiącach. Idempotentne.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param categoryId - Identyfikator kategorii.
 * @returns Kategoria po archiwizacji.
 * @throws {NotFoundError} Gdy kategorii nie ma w gospodarstwie.
 */
export function archiveCategory(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  categoryId: string,
): CategoryDto {
  const now = clock.now().getTime();
  const row = handle.sqlite.transaction(() => {
    const current = requireCategory(handle, householdId, categoryId);
    const toArchive = [current, ...findChildren(handle, householdId, current.id)]
      .filter((category) => !category.isArchived)
      .map((category) => category.id);
    setArchived(handle, householdId, toArchive, true, now);
    return requireCategory(handle, householdId, categoryId);
  })();
  return toCategoryDto(row);
}

/**
 * Przywraca kategorię z archiwum; podkategoria przywraca też swojego rodzica.
 *
 * W drugą stronę niż archiwizacja: przywrócenie rodzica **nie** przywraca dzieci, bo
 * część z nich mogła zostać zarchiwizowana świadomie, wcześniej i osobno. Przywrócenie
 * dziecka musi natomiast przywrócić rodzica — inaczej wróciłoby w miejsce, którego nie
 * widać. Idempotentne.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param categoryId - Identyfikator kategorii.
 * @returns Kategoria po przywróceniu.
 * @throws {NotFoundError} Gdy kategorii nie ma w gospodarstwie.
 */
export function unarchiveCategory(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  categoryId: string,
): CategoryDto {
  const now = clock.now().getTime();
  const row = handle.sqlite.transaction(() => {
    const current = requireCategory(handle, householdId, categoryId);
    const parent =
      current.parentId === null
        ? undefined
        : findCategoryById(handle, householdId, current.parentId);
    const toRestore = [current, parent]
      .filter((category): category is CategoryRow => category?.isArchived === true)
      .map((category) => category.id);
    setArchived(handle, householdId, toRestore, false, now);
    return requireCategory(handle, householdId, categoryId);
  })();
  return toCategoryDto(row);
}

/**
 * Usuwa kategorię (07 §10).
 *
 * Kolejność sprawdzeń idzie od reguły najtwardszej: systemowej nie usuwa się nigdy
 * (I-9); kategorii z podkategoriami nie, bo `ON DELETE SET NULL` po cichu wypchnęłoby
 * je na poziom główny; kategorii z transakcjami nie (I-10) — zostaje archiwizacja.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param categoryId - Identyfikator kategorii.
 * @throws {NotFoundError} Gdy kategorii nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Gdy kategoria jest systemowa (I-9).
 * @throws {ConflictError} Gdy kategoria ma podkategorie albo transakcje (I-10).
 */
export function deleteCategory(handle: DbHandle, householdId: string, categoryId: string): void {
  handle.sqlite.transaction(() => {
    const current = requireCategory(handle, householdId, categoryId);
    if (current.isSystem) {
      throw new DomainRuleViolationError(
        'Kategorii domyślnej nie można usunąć. Możesz ją zarchiwizować.',
      );
    }
    if (findChildren(handle, householdId, current.id).length > 0) {
      throw new ConflictError('Kategoria ma podkategorie — najpierw je przenieś albo usuń.');
    }
    if (categoryHasTransactions(handle, householdId, current.id)) {
      throw new ConflictError(
        'Kategoria ma transakcje, więc nie można jej usunąć. Możesz ją zarchiwizować albo scalić z inną.',
      );
    }
    removeCategory(handle, householdId, current.id);
  })();
}

/**
 * Scala kategorię w inną (07 §9.3).
 *
 * W jednej transakcji bazodanowej: przepina transakcje (także miękko usunięte),
 * odwołania konfiguracyjne i podpowiedzi AI na cel, a źródło archiwizuje. Źródło nie
 * jest usuwane — zostaje w archiwum, więc ponowny seed nie założy go od nowa (ADR-020).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param sourceId - Kategoria scalana.
 * @param input - Kategoria docelowa.
 * @returns Cel po scaleniu i liczba przepiętych transakcji.
 * @throws {NotFoundError} Gdy źródła albo celu nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Gdy scalenie łamie którąś z reguł z 07 §9.3.
 */
export function mergeCategory(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  sourceId: string,
  input: MergeCategoryRequest,
): MergeCategoryResponse {
  const now = clock.now().getTime();
  return handle.sqlite.transaction(() => {
    const source = requireCategory(handle, householdId, sourceId);
    const target = requireCategory(
      handle,
      householdId,
      input.targetCategoryId,
      'Nie znaleziono kategorii docelowej.',
    );

    if (source.id === target.id) {
      throw new DomainRuleViolationError('Nie można scalić kategorii z nią samą.');
    }
    if (source.isSystem) {
      throw new DomainRuleViolationError(
        'Kategorii domyślnej nie można scalić w inną — można scalić inną w nią.',
      );
    }
    if (source.kind !== target.kind) {
      // Przepięcie transakcji do kategorii innego rodzaju złamałoby I-4.
      throw new DomainRuleViolationError('Można scalać tylko kategorie tego samego rodzaju.');
    }
    if (target.isArchived) {
      throw new DomainRuleViolationError('Kategoria docelowa jest zarchiwizowana.');
    }
    if (findChildren(handle, householdId, source.id).length > 0) {
      throw new DomainRuleViolationError(
        'Kategoria ma podkategorie — najpierw je scal albo przenieś.',
      );
    }

    const transactionsMoved = moveTransactionsToCategory(
      handle,
      householdId,
      source.id,
      target.id,
      now,
    );
    moveRecurringRulesToCategory(handle, householdId, source.id, target.id, now);
    moveLiabilitiesToCategory(handle, householdId, source.id, target.id, now);
    movePlannedExpensesToCategory(handle, householdId, source.id, target.id, now);
    moveDocumentItemsToCategory(handle, householdId, source.id, target.id, now);
    moveBudgetLinesToCategory(handle, householdId, source.id, target.id, now);
    const aiHints = mergeAiHints(target.aiHints, source.aiHints);
    const updatedTarget =
      aiHints === target.aiHints
        ? target
        : (patchCategory(handle, householdId, target.id, { aiHints }, now) ?? target);
    if (!source.isArchived) setArchived(handle, householdId, [source.id], true, now);

    return { target: toCategoryDto(updatedTarget), transactionsMoved };
  })();
}
