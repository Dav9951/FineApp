import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Database as SqliteDatabase } from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { loadConfig, type Config } from '../core/config.js';
import { isEntryPoint } from '../core/entry-point.js';
import { loadEnvFile } from '../core/env-file.js';
import { createLogger } from '../core/logger.js';
import { openDatabase, type DbHandle } from './client.js';

/**
 * Runner migracji — wołany przez `docker/entrypoint.sh` przed startem serwera HTTP.
 *
 * Migracje są **tylko do przodu** ([03 §6](../../../../plans/03-data-model.md#6-strategia-migracji)).
 * Nie ma skryptów `down`: przy jednym gospodarstwie wycofanie to przywrócenie kopii,
 * co jest prostsze i pewniejsze niż odwrotne skrypty, które trzeba by testować.
 *
 * Idempotencję zapewnia sam Drizzle — prowadzi tabelę `__drizzle_migrations`
 * i pomija to, co już zastosowano. Dzięki temu restart kontenera jest bezpieczny.
 */

/** Katalog z migracjami leży obok tego modułu — tak w `src/`, jak i w `dist/`. */
const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Nazwa tabeli, w której Drizzle prowadzi dziennik zastosowanych migracji. */
const JOURNAL_TABLE = '__drizzle_migrations';

/** Wpis dziennika migracji generowany przez `drizzle-kit`. */
interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

/**
 * Czyta dziennik migracji wygenerowany przez `drizzle-kit`.
 *
 * @param folder - Katalog z migracjami.
 * @returns Wpisy dziennika w kolejności rosnącej.
 */
function readJournal(folder: string): JournalEntry[] {
  const raw = readFileSync(join(folder, 'meta', '_journal.json'), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('entries' in parsed) ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error('migrate: nieczytelny dziennik migracji (_journal.json)');
  }
  return parsed.entries as JournalEntry[];
}

/**
 * Zlicza migracje, które nie zostały jeszcze zastosowane.
 *
 * Potrzebne, żeby nie robić kopii bazy przy każdym restarcie kontenera — restart bez
 * nowej migracji jest sytuacją normalną i częstą.
 *
 * @param sqlite - Surowe połączenie.
 * @param folder - Katalog z migracjami.
 * @returns Liczba migracji do zastosowania.
 */
export function countPendingMigrations(sqlite: SqliteDatabase, folder = MIGRATIONS_FOLDER): number {
  const total = readJournal(folder).length;
  const tableExists = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(JOURNAL_TABLE);
  if (!tableExists) return total;

  const row = sqlite.prepare(`SELECT COUNT(*) AS applied FROM ${JOURNAL_TABLE}`).get();
  const applied =
    typeof row === 'object' && row !== null && 'applied' in row ? Number(row.applied) : 0;
  return Math.max(total - applied, 0);
}

/**
 * Wykonuje migawkę bazy przed migracją.
 *
 * `VACUUM INTO` daje spójną kopię **bez zatrzymywania bazy** i bez kopiowania plików
 * `-wal` / `-shm` — próba skopiowania samego pliku `.db` przy włączonym WAL potrafi dać
 * kopię niekompletną ([03 §6](../../../../plans/03-data-model.md#6-strategia-migracji)).
 *
 * Kopia jest **pomijana na pustej bazie**: przy pierwszej instalacji nie ma czego
 * stracić, a plik `pre-migration-*.db` z zerem tabel to tylko śmieć w `/data/backups/`.
 *
 * @param sqlite - Surowe połączenie.
 * @param databasePath - Ścieżka pliku bazy; `:memory:` pomijamy.
 * @param now - Znacznik czasu użyty w nazwie pliku.
 * @returns Ścieżka kopii albo `null`, gdy kopii nie robiono.
 */
export function backupBeforeMigration(
  sqlite: SqliteDatabase,
  databasePath: string,
  now = new Date(),
): string | null {
  if (databasePath === ':memory:') return null;

  const existing = sqlite
    .prepare(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .get();
  const tableCount =
    typeof existing === 'object' && existing !== null && 'c' in existing ? Number(existing.c) : 0;
  if (tableCount === 0) return null;

  const backupsDir = join(dirname(databasePath), 'backups');
  mkdirSync(backupsDir, { recursive: true });

  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = join(backupsDir, `pre-migration-${stamp}.db`);
  sqlite.prepare('VACUUM INTO ?').run(target);
  return target;
}

/**
 * Stosuje migracje do już otwartego uchwytu.
 *
 * Wydzielone z {@link runMigrations}, bo testy pracują na bazie `:memory:`, której nie
 * da się podać ścieżką — połączenie do bazy w pamięci jest prywatne dla tego, kto je
 * otworzył, więc runner otwierający własne połączenie migrowałby pustkę obok.
 *
 * @param handle - Uchwyt otwartej bazy.
 */
export function applyMigrations(handle: DbHandle): void {
  migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/**
 * Stosuje migracje do wskazanej bazy.
 *
 * @param config - Konfiguracja aplikacji.
 * @returns Liczba zastosowanych migracji i ścieżka kopii, jeśli powstała.
 */
export function runMigrations(config: Config): { applied: number; backupPath: string | null } {
  const logger = createLogger(config);
  const handle = openDatabase(config.db.path);

  try {
    const pending = countPendingMigrations(handle.sqlite);
    if (pending === 0) {
      logger.info('Brak migracji do zastosowania.');
      return { applied: 0, backupPath: null };
    }

    logger.info({ pending }, 'Migracje do zastosowania');
    const backupPath = backupBeforeMigration(handle.sqlite, config.db.path);
    if (backupPath) {
      logger.info({ backupPath }, 'Kopia przed migracją');
    }

    applyMigrations(handle);
    logger.info({ applied: pending }, 'Migracje zastosowane');
    return { applied: pending, backupPath };
  } finally {
    handle.close();
  }
}

/**
 * Punkt wejścia `node dist/db/migrate.js`.
 *
 * Kod wyjścia `1` przy błędzie jest istotny: `entrypoint.sh` działa z `set -e`, więc
 * nieudana migracja **zatrzymuje start kontenera**, zamiast wpuścić aplikację
 * do bazy w nieznanym stanie.
 */
function main(): void {
  try {
    loadEnvFile();
    const config = loadConfig();
    runMigrations(config);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// Uruchamiane jako skrypt, nie przy imporcie w testach.
if (isEntryPoint(import.meta.url)) {
  main();
}
