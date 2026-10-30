import {
  defaultCountsTowardAllocation,
  sameName,
  type CreateIncomeSourceRequest,
  type IncomeSourceDto,
  type ListIncomeSourcesQuery,
  type UpdateIncomeSourceRequest,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import { ConflictError, NotFoundError } from '../../core/errors.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import type { IncomeSourceRow } from '../../db/schema/income-sources.js';
import { isHouseholdMember } from '../auth/auth.service.js';
import { incomeSourceHasTransactions } from '../transactions/transactions.ledger.js';
import { toIncomeSourceDto } from './income-sources.mapper.js';
import {
  findIncomeSourceById,
  findIncomeSources,
  findMaxSortOrder,
  insertIncomeSource,
  patchIncomeSource,
  removeIncomeSource,
  type IncomeSourcePatch,
} from './income-sources.repository.js';

/**
 * Reguły źródeł przychodu — zadanie `F2-4`
 * ([04 §12](../../../../../../plans/04-api-spec.md#12-źródła-przychodu--apiv1income-sources)).
 *
 * `countsTowardAllocation` decyduje o podstawie celów procentowych (07 §2.3) — dlatego
 * domyślna wartość wynika z rodzaju, a nie jest ślepym `true`.
 */

/** Komunikat dla źródła spoza gospodarstwa albo nieistniejącego — celowo ten sam. */
const NOT_FOUND = 'Nie znaleziono źródła przychodu.';

/**
 * Zwraca źródło gospodarstwa albo rzuca `404`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param incomeSourceId - Identyfikator źródła.
 * @returns Wiersz źródła.
 * @throws {NotFoundError} Gdy źródła nie ma w gospodarstwie.
 */
function requireIncomeSource(
  handle: DbHandle,
  householdId: string,
  incomeSourceId: string,
): IncomeSourceRow {
  const row = findIncomeSourceById(handle, householdId, incomeSourceId);
  if (row === undefined) throw new NotFoundError(NOT_FOUND);
  return row;
}

/**
 * Sprawdza, czy właściciel źródła należy do gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param ownerUserId - Właściciel z żądania albo `null`/`undefined`.
 * @throws {NotFoundError} Gdy osoby nie ma w gospodarstwie — tak samo jak dla każdego
 *   innego zasobu spoza gospodarstwa (09 §4).
 */
function assertOwner(
  handle: DbHandle,
  householdId: string,
  ownerUserId: string | null | undefined,
): void {
  if (ownerUserId == null) return;
  if (!isHouseholdMember(handle, householdId, ownerUserId)) {
    throw new NotFoundError('Nie znaleziono osoby w gospodarstwie.');
  }
}

/**
 * Sprawdza, czy nazwa jest wolna w gospodarstwie (łącznie z archiwum).
 *
 * Porównanie `sameName` z `shared` — jak przy kategoriach: bez względu na wielkość liter,
 * z polskimi znakami. Dwie „Pensje" na liście wyboru są nieodróżnialne.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param name - Nazwa do sprawdzenia.
 * @param selfId - Źródło, które może już nosić tę nazwę (przy edycji).
 * @throws {ConflictError} Gdy nazwa jest zajęta.
 */
function assertNameFree(
  handle: DbHandle,
  householdId: string,
  name: string,
  selfId?: string,
): void {
  const clash = findIncomeSources(handle, householdId, true).find(
    (row) => row.id !== selfId && sameName(row.name, name),
  );
  if (clash !== undefined) {
    throw new ConflictError(
      clash.isArchived
        ? `Źródło „${clash.name}” już istnieje w archiwum — przywróć je zamiast zakładać nowe.`
        : `Źródło „${clash.name}” już istnieje.`,
    );
  }
}

/**
 * Zwraca źródło gospodarstwa na potrzeby innego modułu.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param incomeSourceId - Identyfikator źródła.
 * @returns Źródło albo `undefined`, także dla źródła innego gospodarstwa.
 */
export function lookupIncomeSource(
  handle: DbHandle,
  householdId: string,
  incomeSourceId: string,
): IncomeSourceDto | undefined {
  const row = findIncomeSourceById(handle, householdId, incomeSourceId);
  return row === undefined ? undefined : toIncomeSourceDto(row);
}

/**
 * Zwraca źródła gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Czy dołączyć zarchiwizowane.
 * @returns Źródła w kolejności wyświetlania.
 */
export function listIncomeSources(
  handle: DbHandle,
  householdId: string,
  query: ListIncomeSourcesQuery,
): IncomeSourceDto[] {
  return findIncomeSources(handle, householdId, query.includeArchived).map(toIncomeSourceDto);
}

/**
 * Zakłada źródło przychodu na końcu listy.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Zwalidowane dane.
 * @returns Założone źródło.
 * @throws {NotFoundError} Gdy właściciel nie należy do gospodarstwa.
 * @throws {ConflictError} Gdy nazwa jest zajęta.
 */
export function createIncomeSource(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  input: CreateIncomeSourceRequest,
): IncomeSourceDto {
  const now = clock.now().getTime();
  const row = handle.sqlite.transaction(() => {
    assertOwner(handle, householdId, input.ownerUserId);
    assertNameFree(handle, householdId, input.name);
    return insertIncomeSource(handle, {
      id: newId(),
      householdId,
      name: input.name,
      kind: input.kind,
      ownerUserId: input.ownerUserId ?? null,
      countsTowardAllocation:
        input.countsTowardAllocation ?? defaultCountsTowardAllocation(input.kind),
      isArchived: false,
      sortOrder: findMaxSortOrder(handle, householdId) + 1,
      createdAt: now,
      updatedAt: now,
    });
  })();
  return toIncomeSourceDto(row);
}

/**
 * Zmienia źródło przychodu.
 *
 * Zmiana `countsTowardAllocation` przelicza podstawę celów procentowych **także za
 * przeszłe miesiące** — flaga nie jest migawką na transakcji. To świadome: flaga mówi,
 * czym źródło **jest** (zwrot podatku zawsze był zwrotem), a nie jak było traktowane.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param incomeSourceId - Identyfikator źródła.
 * @param input - Zwalidowane zmiany.
 * @returns Źródło po zmianie.
 * @throws {NotFoundError} Gdy źródła albo właściciela nie ma w gospodarstwie.
 * @throws {ConflictError} Gdy nowa nazwa jest zajęta.
 */
export function updateIncomeSource(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  incomeSourceId: string,
  input: UpdateIncomeSourceRequest,
): IncomeSourceDto {
  const now = clock.now().getTime();
  const row = handle.sqlite.transaction(() => {
    const current = requireIncomeSource(handle, householdId, incomeSourceId);
    assertOwner(handle, householdId, input.ownerUserId);

    const patch: IncomeSourcePatch = {};
    if (input.name !== undefined && input.name !== current.name) {
      if (!sameName(input.name, current.name)) {
        assertNameFree(handle, householdId, input.name, current.id);
      }
      patch.name = input.name;
    }
    if (input.kind !== undefined) patch.kind = input.kind;
    if (input.ownerUserId !== undefined) patch.ownerUserId = input.ownerUserId;
    if (input.countsTowardAllocation !== undefined) {
      patch.countsTowardAllocation = input.countsTowardAllocation;
    }

    if (Object.keys(patch).length === 0) return current;
    const updated = patchIncomeSource(handle, householdId, incomeSourceId, patch, now);
    // Drugi użytkownik mógł usunąć źródło w międzyczasie — lepiej 404 niż 500.
    if (updated === undefined) throw new NotFoundError(NOT_FOUND);
    return updated;
  })();
  return toIncomeSourceDto(row);
}

/**
 * Archiwizuje źródło albo je przywraca. Idempotentne; historia zostaje.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param incomeSourceId - Identyfikator źródła.
 * @param archived - `true` archiwizuje, `false` przywraca.
 * @returns Źródło po zmianie.
 * @throws {NotFoundError} Gdy źródła nie ma w gospodarstwie.
 */
export function setIncomeSourceArchived(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  incomeSourceId: string,
  archived: boolean,
): IncomeSourceDto {
  const current = requireIncomeSource(handle, householdId, incomeSourceId);
  if (current.isArchived === archived) return toIncomeSourceDto(current);
  const updated = patchIncomeSource(
    handle,
    householdId,
    incomeSourceId,
    { isArchived: archived },
    clock.now().getTime(),
  );
  if (updated === undefined) throw new NotFoundError(NOT_FOUND);
  return toIncomeSourceDto(updated);
}

/**
 * Usuwa źródło bez historii (I-10, 07 §10).
 *
 * `transactions.income_source_id` ma `ON DELETE SET NULL`, więc o historii decyduje
 * zliczenie transakcji — łącznie z koszem, jak przy kategoriach (ADR-033).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param incomeSourceId - Identyfikator źródła.
 * @throws {NotFoundError} Gdy źródła nie ma w gospodarstwie.
 * @throws {ConflictError} Gdy źródło ma transakcje.
 */
export function deleteIncomeSource(
  handle: DbHandle,
  householdId: string,
  incomeSourceId: string,
): void {
  handle.sqlite.transaction(() => {
    const current = requireIncomeSource(handle, householdId, incomeSourceId);
    if (incomeSourceHasTransactions(handle, householdId, current.id)) {
      throw new ConflictError(
        'Źródło ma przychody, więc nie można go usunąć. Możesz je zarchiwizować.',
      );
    }
    removeIncomeSource(handle, householdId, current.id);
  })();
}
