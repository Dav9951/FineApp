import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { foldForSearch } from '@fineapp/shared';

import type { Config } from '../core/config.js';
import * as schema from './schema/index.js';

/**
 * Połączenie z SQLite wraz z instancją Drizzle.
 *
 * `better-sqlite3` jest **synchroniczne** i to jest tu zaletą: przy jednym procesie
 * i dwóch użytkownikach nie ma wyścigów, transakcje są trywialne (`db.transaction(fn)`),
 * a repozytoria nie muszą być `async`
 * ([01 §2.3](../../../../plans/01-tech-stack.md#23-dlaczego-better-sqlite3-synchroniczne-a-nie-nodesqlite--libsql)).
 */

/** Pragmy ustawiane na każdym połączeniu, w tej kolejności. */
const PRAGMAS = [
  // Równoległy odczyt podczas zapisu — bez tego drugi użytkownik czeka na pierwszym.
  'journal_mode = WAL',
  // Rozsądny kompromis trwałości i szybkości przy WAL.
  'synchronous = NORMAL',
  // SQLite domyślnie NIE egzekwuje kluczy obcych. Bez tego cały ON DELETE w schemacie
  // jest dekoracją, a osierocone wiersze pojawią się po pierwszym usunięciu konta.
  'foreign_keys = ON',
  // Czekaj, zamiast rzucać SQLITE_BUSY.
  'busy_timeout = 5000',
  'temp_store = MEMORY',
] as const;

/**
 * Nazwa funkcji SQL sprowadzającej tekst do postaci wyszukiwania (`foldForSearch`).
 *
 * Wbudowane `lower()` i `LIKE` w SQLite rozróżniają wielkość liter poza ASCII — „żabka"
 * nie znalazłoby „Żabki". Funkcja jest rejestrowana na każdym połączeniu, więc zapytania
 * mogą porównywać tekst tak samo, jak robi to `shared`.
 */
export const SEARCH_FOLD_FUNCTION = 'fold_search';

/** Uchwyt bazy zwracany przez {@link createDb}. */
export interface DbHandle {
  /** Instancja Drizzle z wpiętym schematem. */
  readonly db: BetterSQLite3Database<typeof schema>;
  /** Surowe połączenie — do pragm, migracji i konserwacji. */
  readonly sqlite: SqliteDatabase;
  /** Zamyka połączenie. */
  close(): void;
}

/**
 * Otwiera bazę i ustawia pragmy.
 *
 * Katalog pliku bazy jest tworzony, jeśli nie istnieje — w kontenerze `/data` jest
 * wolumenem i przy pierwszym starcie bywa pusty.
 *
 * @param databasePath - Ścieżka do pliku bazy albo `:memory:`.
 * @returns Uchwyt z instancją Drizzle i surowym połączeniem.
 */
export function openDatabase(databasePath: string): DbHandle {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath);
  for (const pragma of PRAGMAS) {
    sqlite.pragma(pragma);
  }
  sqlite.function(SEARCH_FOLD_FUNCTION, { deterministic: true }, (value: unknown) =>
    typeof value === 'string' ? foldForSearch(value) : null,
  );

  const db = drizzle(sqlite, { schema });
  return {
    db,
    sqlite,
    close: () => {
      sqlite.close();
    },
  };
}

/**
 * Otwiera bazę wskazaną w konfiguracji.
 *
 * @param config - Konfiguracja aplikacji.
 * @returns Uchwyt z instancją Drizzle i surowym połączeniem.
 */
export function createDb(config: Config): DbHandle {
  return openDatabase(config.db.path);
}

/**
 * Odczytuje faktyczne wartości pragm z otwartego połączenia.
 *
 * Istnieje, bo pragma potrafi zostać **cicho zignorowana**: przy bazie `:memory:`
 * `journal_mode` zgłasza `memory`, a nie `wal`, i to jest poprawne zachowanie SQLite,
 * nie błąd konfiguracji (ADR-014). Bez możliwości odczytu nie da się tego odróżnić
 * od realnej awarii.
 *
 * @param sqlite - Surowe połączenie.
 * @returns Wartości pragm istotnych dla poprawności działania.
 */
export function readPragmas(sqlite: SqliteDatabase): {
  journalMode: string;
  foreignKeys: number;
  busyTimeout: number;
  synchronous: number;
} {
  return {
    journalMode: String(sqlite.pragma('journal_mode', { simple: true })),
    foreignKeys: Number(sqlite.pragma('foreign_keys', { simple: true })),
    busyTimeout: Number(sqlite.pragma('busy_timeout', { simple: true })),
    synchronous: Number(sqlite.pragma('synchronous', { simple: true })),
  };
}

export { schema };
