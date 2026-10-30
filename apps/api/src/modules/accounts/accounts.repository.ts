import Database from 'better-sqlite3';
import { and, asc, eq, sql } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import { accounts, type AccountInsert, type AccountRow } from '../../db/schema/accounts.js';

/**
 * Zapytania modułu kont.
 *
 * `householdId` jest **pierwszym argumentem po uchwycie** każdej metody i trafia do
 * każdego `WHERE` — konto cudzego gospodarstwa jest dla tego modułu nieodróżnialne
 * od konta, które nie istnieje (reguła 4 z `CLAUDE.md`).
 *
 * Repozytorium nie zna HTTP i nie rzuca błędów ze statusem
 * ([02 §3](../../../../../../plans/02-architecture.md#3-warstwy-i-kierunek-zależności)):
 * wynik, który serwis musi rozróżnić (np. „konto ma historię"), wraca jako wartość.
 */

/** Pola konta, które wolno zmienić przez PATCH. */
export type AccountPatch = Partial<
  Pick<
    AccountInsert,
    | 'name'
    | 'type'
    | 'allocationClass'
    | 'openingBalanceMinor'
    | 'openingBalanceOn'
    | 'institution'
    | 'color'
    | 'icon'
    | 'includeInNetWorth'
    | 'isArchived'
  >
>;

/** Wynik próby usunięcia konta. */
export type DeleteAccountResult = 'deleted' | 'not_found' | 'in_use';

/**
 * Zwraca konta gospodarstwa w kolejności wyświetlania.
 *
 * Remis na `sort_order` rozstrzyga identyfikator — ULID rośnie z czasem, więc
 * starsze konto jest wyżej, a kolejność jest deterministyczna między odczytami.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param includeArchived - Czy dołączyć konta zarchiwizowane.
 * @returns Wiersze kont.
 */
export function findAccounts(
  handle: DbHandle,
  householdId: string,
  includeArchived: boolean,
): AccountRow[] {
  const scope = includeArchived
    ? eq(accounts.householdId, householdId)
    : and(eq(accounts.householdId, householdId), eq(accounts.isArchived, false));
  return handle.db
    .select()
    .from(accounts)
    .where(scope)
    .orderBy(asc(accounts.sortOrder), asc(accounts.id))
    .all();
}

/**
 * Znajduje konto gospodarstwa po identyfikatorze.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param accountId - Identyfikator konta.
 * @returns Wiersz konta albo `undefined`, także gdy konto należy do innego gospodarstwa.
 */
export function findAccountById(
  handle: DbHandle,
  householdId: string,
  accountId: string,
): AccountRow | undefined {
  return handle.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.id, accountId)))
    .get();
}

/**
 * Zwraca najwyższą pozycję na liście kont gospodarstwa.
 *
 * Liczy także konta zarchiwizowane — przywrócone konto nie może wylądować na tym
 * samym miejscu co nowo dodane.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Najwyższe `sort_order` albo `-1`, gdy gospodarstwo nie ma kont.
 */
export function findMaxSortOrder(handle: DbHandle, householdId: string): number {
  const row = handle.db
    .select({ max: sql<number | null>`max(${accounts.sortOrder})` })
    .from(accounts)
    .where(eq(accounts.householdId, householdId))
    .get();
  return row?.max ?? -1;
}

/**
 * Zapisuje nowe konto.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Kompletny wiersz, łącznie z `householdId` z tokenu.
 * @returns Zapisany wiersz.
 */
export function insertAccount(handle: DbHandle, row: AccountInsert): AccountRow {
  return handle.db.insert(accounts).values(row).returning().get();
}

/**
 * Zmienia pola konta gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param accountId - Identyfikator konta.
 * @param patch - Zmieniane pola.
 * @param now - Znacznik `updated_at`.
 * @returns Wiersz po zmianie albo `undefined`, gdy konta nie ma w gospodarstwie.
 */
export function patchAccount(
  handle: DbHandle,
  householdId: string,
  accountId: string,
  patch: AccountPatch,
  now: number,
): AccountRow | undefined {
  return handle.db
    .update(accounts)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(accounts.householdId, householdId), eq(accounts.id, accountId)))
    .returning()
    .get();
}

/**
 * Usuwa konto gospodarstwa, o ile nie ma ono historii.
 *
 * Decyzję „ma historię" podejmuje **baza**, a nie wcześniejsze zliczenie transakcji:
 * `transactions.account_id` i `counter_account_id` mają `ON DELETE RESTRICT`
 * ([03 §3.16](../../../../../../plans/03-data-model.md#316-transactions)). Dzięki temu:
 *
 * - transakcje **miękko usunięte** też blokują usunięcie — i słusznie, bo przez 30 dni
 *   można je przywrócić, a przywrócona transakcja bez konta rozbiłaby salda;
 * - nie ma okna wyścigu między „policz" a „usuń";
 * - moduł kont nie sięga do tabeli transakcji, której właścicielem jest inny moduł.
 *
 * Referencje z pozostałych tabel (cele, zobowiązania, reguły cykliczne, planowane
 * wydatki) mają `ON DELETE SET NULL` — to konfiguracja, nie historia (07 §10).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param accountId - Identyfikator konta.
 * @returns `deleted`, `not_found` albo `in_use`, gdy konto ma transakcje.
 */
export function removeAccount(
  handle: DbHandle,
  householdId: string,
  accountId: string,
): DeleteAccountResult {
  try {
    const result = handle.db
      .delete(accounts)
      .where(and(eq(accounts.householdId, householdId), eq(accounts.id, accountId)))
      .run();
    return result.changes === 0 ? 'not_found' : 'deleted';
  } catch (error) {
    if (isForeignKeyViolation(error)) return 'in_use';
    throw error;
  }
}

/**
 * Rozpoznaje naruszenie klucza obcego.
 *
 * `ON DELETE RESTRICT` SQLite zgłasza kodem `SQLITE_CONSTRAINT_TRIGGER`, a nie
 * `SQLITE_CONSTRAINT_FOREIGNKEY` — ten drugi dostaje tylko sprawdzenie odroczone do końca
 * instrukcji (`NO ACTION`). Kod `TRIGGER` niesie też `RAISE()` z wyzwalacza, dlatego
 * rozstrzyga dopiero komunikat.
 *
 * @param error - Wyjątek z zapytania.
 * @returns `true`, gdy zapis odrzucił klucz obcy.
 */
function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Database.SqliteError &&
    (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || error.code === 'SQLITE_CONSTRAINT_TRIGGER') &&
    error.message === 'FOREIGN KEY constraint failed'
  );
}

/**
 * Ustawia pozycje kont gospodarstwa.
 *
 * Nie otwiera transakcji bazodanowej — o jej granicy decyduje serwis
 * ([02 §6](../../../../../../plans/02-architecture.md#6-repozytoria)).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param positions - Pary identyfikator konta → nowa pozycja.
 * @param now - Znacznik `updated_at`.
 */
export function writeSortOrders(
  handle: DbHandle,
  householdId: string,
  positions: readonly { readonly id: string; readonly sortOrder: number }[],
  now: number,
): void {
  for (const { id, sortOrder } of positions) {
    handle.db
      .update(accounts)
      .set({ sortOrder, updatedAt: now })
      .where(and(eq(accounts.householdId, householdId), eq(accounts.id, id)))
      .run();
  }
}
