import { and, eq, lt } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import {
  idempotencyKeys,
  type IdempotencyKeyInsert,
  type IdempotencyKeyRow,
} from '../../db/schema/idempotency-keys.js';

/**
 * Zapytania modułu idempotencji. `householdId` jest pierwszym argumentem po uchwycie
 * (reguła 4 z `CLAUDE.md`) — klucz jednego gospodarstwa nie może odtworzyć odpowiedzi
 * drugiego, nawet gdyby klienci wylosowali ten sam.
 */

/**
 * Znajduje zapamiętaną odpowiedź.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param scope - Operacja, np. `POST /transactions`.
 * @param key - Klucz z nagłówka.
 * @returns Wiersz albo `undefined`.
 */
export function findIdempotencyKey(
  handle: DbHandle,
  householdId: string,
  scope: string,
  key: string,
): IdempotencyKeyRow | undefined {
  return handle.db
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.householdId, householdId),
        eq(idempotencyKeys.scope, scope),
        eq(idempotencyKeys.key, key),
      ),
    )
    .get();
}

/**
 * Zapamiętuje odpowiedź.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Kompletny wiersz.
 */
export function insertIdempotencyKey(handle: DbHandle, row: IdempotencyKeyInsert): void {
  handle.db.insert(idempotencyKeys).values(row).run();
}

/**
 * Usuwa wpisy starsze niż granica — we wszystkich gospodarstwach naraz.
 *
 * To sprzątanie, nie odczyt danych gospodarstwa: wiek wpisu jest jedynym kryterium,
 * a indeks po `created_at` czyni je tanim.
 *
 * @param handle - Uchwyt bazy.
 * @param olderThan - Znacznik; wpisy utworzone wcześniej są usuwane.
 * @returns Liczba usuniętych wpisów.
 */
export function deleteIdempotencyKeysBefore(handle: DbHandle, olderThan: number): number {
  return handle.db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, olderThan)).run()
    .changes;
}
