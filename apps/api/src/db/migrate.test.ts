import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../core/config.js';
import { openDatabase } from './client.js';
import { backupBeforeMigration, countPendingMigrations, runMigrations } from './migrate.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'fineapp-migrate-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * Buduje konfigurację wskazującą bazę w katalogu tymczasowym.
 *
 * @param path - Ścieżka pliku bazy.
 * @returns Minimalna konfiguracja potrzebna runnerowi migracji.
 */
function configFor(path: string): Config {
  return {
    env: 'test',
    isProduction: false,
    server: { port: 3000, host: '127.0.0.1', appUrl: 'http://localhost', logLevel: 'silent' },
    db: { path },
    uploads: { dir: join(workDir, 'uploads'), maxBytes: 1 },
    auth: {
      jwtSecret: 'x'.repeat(48),
      ipHashSalt: 'y'.repeat(24),
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 2_592_000,
      pinMinLength: 6,
      pinMaxLength: 8,
      maxFailedAttempts: 5,
      lockoutSeconds: 900,
      cookieSecure: false,
      cookieDomain: '',
    },
    ai: {
      enabled: false,
      apiKey: '',
      model: 'claude-sonnet-5',
      maxOutputTokens: 4096,
      monthlyBudgetMinor: 5000,
      inputCostMinorPerMTok: 800,
      outputCostMinorPerMTok: 4000,
    },
    web: { distPath: null },
    defaults: { currency: 'PLN', timezone: 'Europe/Warsaw', locale: 'pl-PL' },
  };
}

describe('runMigrations', () => {
  it('tworzy komplet 21 tabel na pustej bazie', () => {
    const path = join(workDir, 'fineapp.db');
    const result = runMigrations(configFor(path));
    expect(result.applied).toBeGreaterThan(0);

    const handle = openDatabase(path);
    const tables = handle.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
      )
      .all();
    handle.close();
    expect(tables).toHaveLength(21);
  });

  it('jest idempotentny — drugi przebieg nie stosuje niczego', () => {
    // Restart kontenera bez nowej migracji jest sytuacją normalną i częstą.
    const path = join(workDir, 'fineapp.db');
    const first = runMigrations(configFor(path));
    const second = runMigrations(configFor(path));
    expect(first.applied).toBeGreaterThan(0);
    expect(second.applied).toBe(0);
  });

  it('nie robi kopii pustej bazy przy pierwszej instalacji', () => {
    // Kopia powstaje PRZED migracją, więc na świeżej bazie zapisałaby pustkę.
    const path = join(workDir, 'fineapp.db');
    const first = runMigrations(configFor(path));
    expect(first.applied).toBeGreaterThan(0);
    expect(first.backupPath).toBeNull();
    expect(existsSync(join(workDir, 'backups'))).toBe(false);
  });

  it('przy przebiegu bez zmian nie robi ani kopii, ani migracji', () => {
    const path = join(workDir, 'fineapp.db');
    runMigrations(configFor(path));
    const second = runMigrations(configFor(path));
    expect(second.applied).toBe(0);
    expect(second.backupPath).toBeNull();
  });

  it('zapisuje transakcję po migracji — schemat naprawdę działa', () => {
    const path = join(workDir, 'fineapp.db');
    runMigrations(configFor(path));
    const handle = openDatabase(path);
    const now = Date.now();
    handle.sqlite
      .prepare(
        'INSERT INTO households (id,name,base_currency,timezone,locale,back_posting_limit_months,month_start_day,created_at,updated_at) ' +
          "VALUES ('H','Dom','PLN','Europe/Warsaw','pl-PL',1,1,?,?)",
      )
      .run(now, now);
    const row = handle.sqlite.prepare('SELECT name FROM households WHERE id = ?').get('H');
    handle.close();
    expect(row).toEqual({ name: 'Dom' });
  });
});

describe('countPendingMigrations', () => {
  it('na pustej bazie zwraca wszystkie migracje z dziennika', () => {
    const handle = openDatabase(':memory:');
    expect(countPendingMigrations(handle.sqlite)).toBeGreaterThan(0);
    handle.close();
  });
});

describe('backupBeforeMigration', () => {
  it('pomija bazę w pamięci', () => {
    const handle = openDatabase(':memory:');
    expect(backupBeforeMigration(handle.sqlite, ':memory:')).toBeNull();
    handle.close();
  });

  it('pomija bazę bez tabel — nie ma czego stracić', () => {
    const path = join(workDir, 'pusta.db');
    const handle = openDatabase(path);
    expect(backupBeforeMigration(handle.sqlite, path)).toBeNull();
    handle.close();
  });

  it('nazywa kopię według wzorca z 10 §6', () => {
    const path = join(workDir, 'fineapp.db');
    const handle = openDatabase(path);
    handle.sqlite.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY)');
    const target = backupBeforeMigration(handle.sqlite, path, new Date('2026-09-21T14:30:00.000Z'));
    handle.close();
    expect(target).toContain('backups');
    expect(target).toMatch(/pre-migration-2026-09-21T14-30-00-000Z\.db$/);
  });

  it('kopia jest czytelną bazą SQLite i niesie dane, nie kawałek pliku', () => {
    // Kopiowanie samego pliku .db przy włączonym WAL potrafi dać kopię niekompletną;
    // VACUUM INTO daje spójną migawkę bez zatrzymywania bazy.
    const path = join(workDir, 'fineapp.db');
    const handle = openDatabase(path);
    handle.sqlite.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, note TEXT)');
    handle.sqlite.prepare("INSERT INTO probe (id, note) VALUES (1, 'przed migracją')").run();
    const target = backupBeforeMigration(handle.sqlite, path) as string;
    handle.close();

    expect(statSync(target).size).toBeGreaterThan(0);
    const copy = new Database(target, { readonly: true });
    const row = copy.prepare('SELECT note FROM probe WHERE id = 1').get();
    copy.close();
    expect(row).toEqual({ note: 'przed migracją' });
  });
});
