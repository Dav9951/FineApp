import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, readPragmas, type DbHandle } from './client.js';

let handle: DbHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

describe('openDatabase', () => {
  it('ustawia pragmy wymagane przez 01 §2.3', () => {
    handle = openDatabase(':memory:');
    const pragmas = readPragmas(handle.sqlite);
    // Bez foreign_keys=ON cały ON DELETE w schemacie jest dekoracją.
    expect(pragmas.foreignKeys).toBe(1);
    expect(pragmas.busyTimeout).toBe(5000);
    // synchronous = NORMAL
    expect(pragmas.synchronous).toBe(1);
  });

  it('przy bazie :memory: journal_mode zgłasza `memory`, nie `wal` — i tak ma być', () => {
    // SQLite nie prowadzi WAL dla bazy w pamięci. To nie jest błąd konfiguracji
    // i nie należy tego „naprawiać" w testach (ADR-014).
    handle = openDatabase(':memory:');
    expect(readPragmas(handle.sqlite).journalMode).toBe('memory');
  });

  it('daje działające połączenie z transakcją synchroniczną', () => {
    handle = openDatabase(':memory:');
    const { sqlite } = handle;
    sqlite.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, amount_minor INTEGER NOT NULL)');
    const insert = sqlite.prepare('INSERT INTO probe (amount_minor) VALUES (?)');
    sqlite.transaction(() => {
      insert.run(100);
      insert.run(200);
    })();
    expect(sqlite.prepare('SELECT SUM(amount_minor) s FROM probe').get()).toEqual({ s: 300 });
  });

  it('wycofuje transakcję przy błędzie', () => {
    handle = openDatabase(':memory:');
    const { sqlite } = handle;
    sqlite.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY)');
    const failing = sqlite.transaction(() => {
      sqlite.prepare('INSERT INTO probe (id) VALUES (1)').run();
      throw new Error('celowy błąd');
    });
    expect(() => failing()).toThrow('celowy błąd');
    expect(sqlite.prepare('SELECT COUNT(*) c FROM probe').get()).toEqual({ c: 0 });
  });

  it('egzekwuje klucze obce, bo pragma jest włączona', () => {
    handle = openDatabase(':memory:');
    const { sqlite } = handle;
    sqlite.exec(`
      CREATE TABLE parent (id TEXT PRIMARY KEY);
      CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id));
    `);
    expect(() =>
      sqlite.prepare("INSERT INTO child (id, parent_id) VALUES ('a', 'nie-istnieje')").run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});
