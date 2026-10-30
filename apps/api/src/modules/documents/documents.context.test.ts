import { describe, expect, it } from 'vitest';

import { testConfig, testDb } from '../../../test/build-app.js';
import {
  householdFixture,
  insertAccount,
  insertCategory,
  insertTransaction,
} from '../../../test/factories.js';
import { buildCategoryContext, monthEpochRange } from './documents.service.js';

/**
 * Kontekst kategorii dla AI (08 §4, `F7-4`) i granice miesiąca w strefie.
 */

describe('buildCategoryContext', () => {
  it('ścieżka Rodzic > Dziecko, bez archiwum i transferów; paragon bez przychodów', async () => {
    const db = testDb();
    const home = await householdFixture(db, testConfig(), new Date('2026-09-23T10:00:00Z'));
    const food = insertCategory(db, home, { name: 'Jedzenie' });
    const groceries = insertCategory(db, home, { name: 'Zakupy', parentId: food, aiHints: 'Lidl' });
    insertCategory(db, home, { name: 'Stara', isArchived: true });
    insertCategory(db, home, { name: 'Przelewy', kind: 'transfer' });
    const salary = insertCategory(db, home, { name: 'Pensja', kind: 'income' });

    const receipt = buildCategoryContext(db, home.householdId, 'receipt', '2026-09-23');
    expect(receipt).toEqual([
      { id: food, path: 'Jedzenie', kind: 'expense', hints: null },
      { id: groceries, path: 'Jedzenie > Zakupy', kind: 'expense', hints: 'Lidl' },
    ]);
    const statement = buildCategoryContext(db, home.householdId, 'bank_statement', '2026-09-23');
    expect(statement.map((entry) => entry.id)).toContain(salary);
  });

  it('ponad 120 kategorii: zostają systemowe i używane w ostatnich 6 miesiącach', async () => {
    const db = testDb();
    const home = await householdFixture(db, testConfig(), new Date('2026-09-23T10:00:00Z'));
    const ror = insertAccount(db, home);
    const ids = Array.from({ length: 121 }, (_, index) =>
      insertCategory(db, home, { name: `K${String(index)}`, isSystem: index === 0 }),
    );
    insertTransaction(db, home, {
      accountId: ror,
      categoryId: ids[5],
      bookedOn: '2026-04-01',
      monthKey: '2026-04',
    });
    insertTransaction(db, home, {
      accountId: ror,
      categoryId: ids[6],
      bookedOn: '2026-02-28',
      monthKey: '2026-02',
    });

    const context = buildCategoryContext(db, home.householdId, 'receipt', '2026-09-23');
    expect(context.map((entry) => entry.id)).toEqual([ids[0], ids[5]]);
  });
});

describe('monthEpochRange', () => {
  it('północ w Warszawie: CEST we wrześniu, CET w listopadzie', () => {
    expect(monthEpochRange('2026-09', 'Europe/Warsaw')).toEqual({
      from: Date.parse('2026-08-31T22:00:00Z'),
      to: Date.parse('2026-09-30T22:00:00Z'),
    });
    expect(monthEpochRange('2026-11', 'Europe/Warsaw')).toEqual({
      from: Date.parse('2026-10-31T23:00:00Z'),
      to: Date.parse('2026-11-30T23:00:00Z'),
    });
  });
});
