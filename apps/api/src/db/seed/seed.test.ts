import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../core/config.js';
import { isId } from '../../core/id.js';
import { openDatabase, type DbHandle } from '../client.js';
import { runMigrations } from '../migrate.js';
import {
  childSlug,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  slugify,
  TRANSFER_CATEGORIES,
} from './categories.js';
import { seedDatabase } from './index.js';

let workDir: string;
let dbPath: string;
let handle: DbHandle;

/**
 * Buduje konfigurację wskazującą bazę w katalogu tymczasowym.
 *
 * @param path - Ścieżka pliku bazy.
 * @returns Minimalna konfiguracja potrzebna seedowi.
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

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'fineapp-seed-'));
  dbPath = join(workDir, 'fineapp.db');
  runMigrations(configFor(dbPath));
  handle = openDatabase(dbPath);
});

afterEach(() => {
  handle.close();
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * Zlicza wiersze w tabeli.
 *
 * @param table - Nazwa tabeli.
 * @returns Liczba wierszy.
 */
function count(table: string): number {
  const row = handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
  return row.c;
}

describe('seedDatabase — pierwszy przebieg', () => {
  it('tworzy gospodarstwo z ustawień domyślnych', () => {
    const result = seedDatabase(handle, configFor(dbPath));
    expect(result.householdCreated).toBe(true);
    expect(isId(result.householdId)).toBe(true);

    const row = handle.sqlite
      .prepare('SELECT name, base_currency, timezone, locale, month_start_day FROM households')
      .get();
    expect(row).toEqual({
      name: 'Dom',
      base_currency: 'PLN',
      timezone: 'Europe/Warsaw',
      locale: 'pl-PL',
      month_start_day: 1,
    });
  });

  it('wstawia komplet kategorii z 03 §5', () => {
    const expected =
      EXPENSE_CATEGORIES.reduce((sum, c) => sum + 1 + (c.children?.length ?? 0), 0) +
      INCOME_CATEGORIES.length +
      TRANSFER_CATEGORIES.length;
    const result = seedDatabase(handle, configFor(dbPath));
    expect(result.categoriesInserted).toBe(expected);
    expect(count('categories')).toBe(expected);
  });

  it('oznacza wszystkie kategorie jako systemowe (niezmiennik I-9)', () => {
    seedDatabase(handle, configFor(dbPath));
    const row = handle.sqlite
      .prepare('SELECT COUNT(*) AS c FROM categories WHERE is_system = 0')
      .get() as { c: number };
    expect(row.c).toBe(0);
  });

  it('zachowuje hierarchię jednopoziomową (niezmiennik I-11)', () => {
    seedDatabase(handle, configFor(dbPath));
    // Żadne dziecko nie może być rodzicem.
    const row = handle.sqlite
      .prepare(
        'SELECT COUNT(*) AS c FROM categories c ' +
          'WHERE c.parent_id IS NOT NULL ' +
          'AND EXISTS (SELECT 1 FROM categories d WHERE d.parent_id = c.id)',
      )
      .get() as { c: number };
    expect(row.c).toBe(0);
  });

  it('zapisuje ai_hints tam, gdzie 03 §5 je podaje', () => {
    seedDatabase(handle, configFor(dbPath));
    const row = handle.sqlite
      .prepare("SELECT ai_hints FROM categories WHERE slug = 'jedzenie' AND kind = 'expense'")
      .get() as { ai_hints: string };
    expect(row.ai_hints).toContain('Biedronka');
    expect(row.ai_hints).toContain('Żabka');
  });

  it('nie zawiera kategorii US ani ZUS (ADR-012)', () => {
    seedDatabase(handle, configFor(dbPath));
    const rows = handle.sqlite
      .prepare("SELECT name FROM categories WHERE name LIKE '%ZUS%' OR name LIKE '%US %'")
      .all();
    expect(rows).toEqual([]);
  });

  it('odnotowuje przebieg w app_meta', () => {
    seedDatabase(handle, configFor(dbPath), 1_790_000_000_000);
    const row = handle.sqlite.prepare("SELECT value FROM app_meta WHERE key = 'seeded_at'").get();
    expect(row).toEqual({ value: '1790000000000' });
  });
});

describe('seedDatabase — idempotencja', () => {
  it('drugi przebieg nie dodaje niczego', () => {
    const first = seedDatabase(handle, configFor(dbPath));
    const second = seedDatabase(handle, configFor(dbPath));
    expect(second.householdCreated).toBe(false);
    expect(second.categoriesInserted).toBe(0);
    expect(count('categories')).toBe(first.categoriesInserted);
  });

  it('nie tworzy drugiego gospodarstwa', () => {
    seedDatabase(handle, configFor(dbPath));
    seedDatabase(handle, configFor(dbPath));
    expect(count('households')).toBe(1);
  });

  it('nie nadpisuje zmian użytkownika', () => {
    // Seed bywa uruchamiany ręcznie po aktualizacji. Kategoria z przypisanymi
    // transakcjami, którą seed by „naprawił", zabrałaby ze sobą historię.
    seedDatabase(handle, configFor(dbPath));
    handle.sqlite
      .prepare(
        "UPDATE categories SET name = 'Moje jedzenie', ai_hints = 'własne' WHERE slug = 'jedzenie'",
      )
      .run();
    seedDatabase(handle, configFor(dbPath));
    const row = handle.sqlite
      .prepare("SELECT name, ai_hints FROM categories WHERE slug = 'jedzenie' AND kind = 'expense'")
      .get();
    expect(row).toEqual({ name: 'Moje jedzenie', ai_hints: 'własne' });
  });

  it('dodaje wyłącznie brakującą kategorię, gdy jedną usunięto', () => {
    // Dopisanie nowej kategorii domyślnej w kolejnej wersji ma wnieść tylko ją.
    const first = seedDatabase(handle, configFor(dbPath));
    // „Kawa" jest dzieckiem „Jedzenia", więc jej slug niesie prefiks rodzica.
    const removed = handle.sqlite
      .prepare("DELETE FROM categories WHERE slug = 'jedzenie-kawa' AND kind = 'expense'")
      .run();
    expect(removed.changes).toBe(1);
    const second = seedDatabase(handle, configFor(dbPath));
    expect(second.categoriesInserted).toBe(1);
    expect(count('categories')).toBe(first.categoriesInserted);
  });
});

describe('slugi', () => {
  it('transliteruje polskie znaki', () => {
    expect(slugify('Żłobek/przedszkole')).toBe('zlobek-przedszkole');
    expect(slugify('Zakupy spożywcze')).toBe('zakupy-spozywcze');
    expect(slugify('Działalność (B2B)')).toBe('dzialalnosc-b2b');
    expect(slugify('Ubezpieczenie OC/AC')).toBe('ubezpieczenie-oc-ac');
    expect(slugify('Świadczenia (800+, zasiłki)')).toBe('swiadczenia-800-zasilki');
  });

  it('rozwiązuje kolizję „Transport" — główna kategoria kontra dziecko Podróży', () => {
    // Bez prefiksu rodzica obie dałyby slug „transport" przy kind = 'expense',
    // co łamie uq_categories_slug.
    expect(slugify('Transport')).toBe('transport');
    expect(childSlug('Podróże', 'Transport')).toBe('podroze-transport');
    expect(childSlug('Podróże', 'Transport')).not.toBe(slugify('Transport'));
  });

  it('wszystkie slugi w obrębie rodzaju są unikalne', () => {
    for (const [kind, tree] of [
      ['expense', EXPENSE_CATEGORIES],
      ['income', INCOME_CATEGORIES],
      ['transfer', TRANSFER_CATEGORIES],
    ] as const) {
      const slugs: string[] = [];
      for (const parent of tree) {
        slugs.push(slugify(parent.name));
        for (const child of parent.children ?? []) {
          slugs.push(childSlug(parent.name, child.name));
        }
      }
      expect(new Set(slugs).size, `duplikat slugu w ${kind}`).toBe(slugs.length);
    }
  });

  it('nie produkuje pustych slugów ani znaków spoza zakresu', () => {
    for (const tree of [EXPENSE_CATEGORIES, INCOME_CATEGORIES, TRANSFER_CATEGORIES]) {
      for (const parent of tree) {
        expect(slugify(parent.name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        for (const child of parent.children ?? []) {
          expect(childSlug(parent.name, child.name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        }
      }
    }
  });
});
