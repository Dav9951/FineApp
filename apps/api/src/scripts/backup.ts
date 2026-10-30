import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import Database, { type Database as SqliteDatabase } from 'better-sqlite3';

import { loadConfig } from '../core/config.js';
import { isEntryPoint } from '../core/entry-point.js';
import { loadEnvFile } from '../core/env-file.js';
import { countPendingMigrations } from '../db/migrate.js';

/**
 * Kopia zapasowa bazy i jej sprawdzenie
 * ([10 §5](../../../../plans/10-deployment.md#5-kopie-zapasowe), `F8-8`).
 *
 * Działa w kontenerze, z zależnościami aplikacji — skrypt hosta (`scripts/backup.sh`)
 * woła go przez `docker compose exec`, zamiast wklejać kod JavaScriptu w `node -e`.
 *
 * ```bash
 * node dist/scripts/backup.js /data/backups/snapshot.db   # migawka + sprawdzenie
 * node dist/scripts/backup.js --verify /backup/plik.db     # samo sprawdzenie (odtworzenie)
 * ```
 *
 * „Kopia nieprzetestowana to nie kopia" (10 §5.4): każda migawka jest od razu otwierana
 * i sprawdzana `PRAGMA integrity_check`, a raport podaje liczbę transakcji i domowników —
 * po odtworzeniu widać od razu, czy to ta baza, której się spodziewamy.
 */

/** Wynik sprawdzenia pliku kopii. */
export interface BackupReport {
  /** Wynik `PRAGMA integrity_check` — `ok` albo pierwszy problem. */
  integrity: string;
  /** Migracje zapisane w kopii. */
  migrations: number;
  /** Migracje z tej wersji aplikacji, których kopia jeszcze nie ma. */
  pendingMigrations: number;
  users: number;
  accounts: number;
  /** Transakcje poza koszem. */
  transactions: number;
  /** Najnowsza data transakcji — „do kiedy sięgają dane". */
  lastBookedOn: string | null;
}

/**
 * Czyta liczbę z pierwszej kolumny pierwszego wiersza.
 *
 * @param sqlite - Połączenie.
 * @param sql - Zapytanie zwracające jedną wartość.
 * @returns Wartość liczbowa albo `0`.
 */
function scalar(sqlite: SqliteDatabase, sql: string): number {
  const row = sqlite.prepare(sql).pluck().get();
  return typeof row === 'number' ? row : 0;
}

/**
 * Robi spójną migawkę bazy przez `VACUUM INTO` (10 §5.1 — nie `cp`).
 *
 * Istniejący plik docelowy jest usuwany: `VACUUM INTO` odmawia zapisu do niepustego
 * pliku, a stała nazwa `snapshot.db` jest nadpisywana przy każdym uruchomieniu.
 *
 * @param sourcePath - Baza aplikacji.
 * @param targetPath - Plik kopii.
 */
export function createSnapshot(sourcePath: string, targetPath: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  rmSync(targetPath, { force: true });
  const sqlite = new Database(sourcePath, { fileMustExist: true });
  try {
    sqlite.prepare('VACUUM INTO ?').run(targetPath);
  } finally {
    sqlite.close();
  }
}

/**
 * Sprawdza plik kopii: spójność, migracje i podstawowe liczby.
 *
 * Plik jest otwierany **tylko do odczytu** — sprawdzenie nie może zmienić kopii,
 * którą za chwilę będziemy odtwarzać.
 *
 * @param path - Plik kopii.
 * @returns Raport.
 * @throws {Error} Gdy pliku nie ma albo nie jest bazą SQLite.
 */
export function verifySnapshot(path: string): BackupReport {
  if (!existsSync(path)) throw new Error(`Brak pliku kopii: ${path}`);
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = sqlite.pragma('integrity_check', { simple: true });
    const hasJournal =
      sqlite
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get('__drizzle_migrations') !== undefined;
    const lastBookedOn = sqlite
      .prepare('SELECT MAX(booked_on) FROM transactions WHERE deleted_at IS NULL')
      .pluck()
      .get();
    return {
      integrity: typeof integrity === 'string' ? integrity : String(integrity),
      migrations: hasJournal ? scalar(sqlite, 'SELECT COUNT(*) FROM __drizzle_migrations') : 0,
      pendingMigrations: countPendingMigrations(sqlite),
      users: scalar(sqlite, 'SELECT COUNT(*) FROM users'),
      accounts: scalar(sqlite, 'SELECT COUNT(*) FROM accounts'),
      transactions: scalar(sqlite, 'SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL'),
      lastBookedOn: typeof lastBookedOn === 'string' ? lastBookedOn : null,
    };
  } finally {
    sqlite.close();
  }
}

/**
 * Raport do logu kopii — jedna linia na wartość.
 *
 * @param path - Plik kopii.
 * @param report - Wynik sprawdzenia.
 * @returns Tekst raportu.
 */
export function formatReport(path: string, report: BackupReport): string {
  return [
    `Kopia: ${path}`,
    `  spójność:          ${report.integrity}`,
    `  migracje:          ${String(report.migrations)}` +
      (report.pendingMigrations > 0
        ? ` (brakuje ${String(report.pendingMigrations)} — zastosują się przy starcie)`
        : ''),
    `  domownicy:         ${String(report.users)}`,
    `  konta:             ${String(report.accounts)}`,
    `  transakcje:        ${String(report.transactions)}`,
    `  ostatnia data:     ${report.lastBookedOn ?? '—'}`,
  ].join('\n');
}

/** Punkt wejścia `node dist/scripts/backup.js`. */
function main(): void {
  const argv = process.argv.slice(2);
  try {
    let target: string;
    if (argv[0] === '--verify') {
      target = argv[1] ?? '';
      if (target === '') throw new Error('Użycie: backup.js --verify <plik.db>');
    } else {
      target = argv[0] ?? '';
      if (target === '') throw new Error('Użycie: backup.js <plik-docelowy.db>');
      loadEnvFile();
      createSnapshot(loadConfig().db.path, target);
    }
    const report = verifySnapshot(target);
    console.log(formatReport(target, report));
    if (report.integrity !== 'ok') {
      console.error('Kopia USZKODZONA — nie odtwarzaj jej.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// Uruchamiane jako skrypt, nie przy imporcie w testach.
if (isEntryPoint(import.meta.url)) {
  main();
}
