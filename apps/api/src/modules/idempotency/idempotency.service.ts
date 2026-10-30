import type { Clock } from '../../core/clock.js';
import { ConflictError } from '../../core/errors.js';
import type { DbHandle } from '../../db/client.js';
import {
  deleteIdempotencyKeysBefore,
  findIdempotencyKey,
  insertIdempotencyKey,
} from './idempotency.repository.js';
import { requestHash } from './idempotency.rules.js';

/**
 * Idempotencja operacji z nagłówkiem `Idempotency-Key`
 * ([04 §1](../../../../../../plans/04-api-spec.md#1-zasady-ogólne), ADR-037).
 *
 * Jeden mechanizm dla wszystkich operacji, które go potrzebują: dziś `POST /transactions`,
 * potem księgowanie wystąpień (`F4-3`), odkładanie na wydatek (`F6-3`) i commit
 * dokumentu (`F7-6`).
 */

/** Jak długo pamiętamy odpowiedź: doba. Dłużej nikt nie ponawia żądania. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Odpowiedź operacji: status i ciało. */
export interface IdempotentResponse<T> {
  readonly statusCode: number;
  readonly body: T;
}

/** Wynik: odpowiedź i informacja, czy to powtórka zapamiętanej. */
export interface IdempotentResult<T> extends IdempotentResponse<T> {
  readonly replayed: boolean;
}

/**
 * Wykonuje operację najwyżej raz dla danego klucza.
 *
 * - bez klucza — operacja wykonuje się zawsze (nagłówek jest opcjonalny);
 * - klucz nowy — operacja się wykonuje, a jej odpowiedź jest zapisywana **w tej samej
 *   transakcji bazodanowej** co jej skutki: albo jest jedno i drugie, albo nic;
 * - klucz znany, to samo ciało — zwracamy zapamiętaną odpowiedź bez ponownego wykonania;
 * - klucz znany, inne ciało — `409`. Zwrócenie wyniku dla innych danych udawałoby, że
 *   zapisało się to, co klient wysłał za drugim razem.
 *
 * Błąd operacji (np. `422`) przerywa transakcję, więc klucz nie zostaje zapamiętany
 * i poprawione żądanie może użyć go ponownie. Dwa równoległe żądania z tym samym kluczem
 * nie są możliwe: `better-sqlite3` jest synchroniczne, a cała funkcja wykonuje się bez
 * oddawania sterowania.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param scope - Operacja, np. `POST /transactions`.
 * @param key - Klucz z nagłówka albo `undefined`.
 * @param request - Zwalidowane ciało żądania — z niego powstaje odcisk.
 * @param run - Operacja; wołana najwyżej raz.
 * @returns Odpowiedź i informacja o powtórce.
 * @throws {ConflictError} Gdy klucz użyto już dla innego ciała.
 */
export function runIdempotent<T>(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  scope: string,
  key: string | undefined,
  request: unknown,
  run: () => IdempotentResponse<T>,
): IdempotentResult<T> {
  if (key === undefined) return { ...run(), replayed: false };

  const now = clock.now().getTime();
  const hash = requestHash(request);
  return handle.sqlite.transaction((): IdempotentResult<T> => {
    deleteIdempotencyKeysBefore(handle, now - IDEMPOTENCY_TTL_MS);

    const stored = findIdempotencyKey(handle, householdId, scope, key);
    if (stored !== undefined) {
      if (stored.requestHash !== hash) {
        throw new ConflictError(
          'Ten zapis został już wysłany z innymi danymi. Odśwież listę, zanim spróbujesz ponownie.',
        );
      }
      // Odtwarzamy własny, wcześniej zserializowany wynik tej samej operacji.
      return {
        statusCode: stored.statusCode,
        body: JSON.parse(stored.responseJson) as T,
        replayed: true,
      };
    }

    const response = run();
    insertIdempotencyKey(handle, {
      householdId,
      scope,
      key,
      requestHash: hash,
      statusCode: response.statusCode,
      responseJson: JSON.stringify(response.body),
      createdAt: now,
    });
    return { ...response, replayed: false };
  })();
}
