import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { householdFixture, insertAccount, insertTransaction } from '../../test/factories.js';
import { testConfig } from '../../test/build-app.js';
import { openDatabase } from '../db/client.js';
import { applyMigrations } from '../db/migrate.js';
import { createSnapshot, formatReport, verifySnapshot } from './backup.js';

/**
 * Testy kopii zapasowej — `F8-8`
 * ([10 §5](../../../../plans/10-deployment.md#5-kopie-zapasowe)).
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fineapp-backup-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Baza w pliku z migracjami, jednym kontem i dwiema transakcjami (jedna w koszu).
 *
 * @returns Ścieżka bazy.
 */
async function liveDatabase(): Promise<string> {
  const path = join(dir, 'fineapp.db');
  const handle = openDatabase(path);
  applyMigrations(handle);
  const home = await householdFixture(handle, testConfig(), new Date('2026-09-25T10:00:00Z'));
  const accountId = insertAccount(handle, home);
  insertTransaction(handle, home, { accountId, bookedOn: '2026-09-20' });
  insertTransaction(handle, home, { accountId, bookedOn: '2026-09-24', deletedAt: 1 });
  // Połączenie zostaje otwarte, jak w działającej aplikacji — migawka ma być spójna
  // także wtedy, gdy część zmian siedzi jeszcze w pliku `-wal`.
  return path;
}

describe('createSnapshot + verifySnapshot', () => {
  it('migawka żywej bazy jest spójna i ma te same dane', async () => {
    const source = await liveDatabase();
    const target = join(dir, 'backups', 'snapshot.db');

    createSnapshot(source, target);
    const report = verifySnapshot(target);

    expect(report).toMatchObject({
      integrity: 'ok',
      pendingMigrations: 0,
      users: 1,
      accounts: 1,
      transactions: 1,
      lastBookedOn: '2026-09-20',
    });
    expect(report.migrations).toBeGreaterThan(0);
  });

  it('nadpisuje poprzednią migawkę o tej samej nazwie', async () => {
    const source = await liveDatabase();
    const target = join(dir, 'snapshot.db');
    createSnapshot(source, target);
    expect(() => {
      createSnapshot(source, target);
    }).not.toThrow();
    expect(verifySnapshot(target).integrity).toBe('ok');
  });

  it('brak pliku i plik, który nie jest bazą — błąd, nie pusty raport', () => {
    expect(() => verifySnapshot(join(dir, 'nie-ma.db'))).toThrow(/Brak pliku kopii/u);
    const junk = join(dir, 'junk.db');
    writeFileSync(junk, 'to nie jest baza danych'.repeat(100));
    expect(() => verifySnapshot(junk)).toThrow();
  });

  it('baza bez tabel aplikacji — liczby zerowe, wszystkie migracje brakujące', () => {
    const empty = join(dir, 'empty.db');
    const handle = openDatabase(empty);
    handle.sqlite.exec('CREATE TABLE users (id TEXT); CREATE TABLE accounts (id TEXT);');
    handle.sqlite.exec('CREATE TABLE transactions (id TEXT, booked_on TEXT, deleted_at INTEGER);');
    handle.close();
    const report = verifySnapshot(empty);
    expect(report).toMatchObject({ migrations: 0, users: 0, transactions: 0, lastBookedOn: null });
    expect(report.pendingMigrations).toBeGreaterThan(0);
  });
});

describe('formatReport', () => {
  it('wypisuje liczby i ostrzega o brakujących migracjach', () => {
    const text = formatReport('/b/x.db', {
      integrity: 'ok',
      migrations: 3,
      pendingMigrations: 1,
      users: 2,
      accounts: 4,
      transactions: 120,
      lastBookedOn: null,
    });
    expect(text).toContain('Kopia: /b/x.db');
    expect(text).toContain('spójność:          ok');
    expect(text).toContain('3 (brakuje 1 — zastosują się przy starcie)');
    expect(text).toContain('ostatnia data:     —');
  });
});
