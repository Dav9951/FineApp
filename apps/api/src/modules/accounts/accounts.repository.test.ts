import { afterEach, describe, expect, it } from 'vitest';

import { testConfig, testDb } from '../../../test/build-app.js';
import { householdFixture } from '../../../test/factories.js';
import type { DbHandle } from '../../db/client.js';
import { findMaxSortOrder, insertAccount, removeAccount } from './accounts.repository.js';

/**
 * Testy repozytorium kont — to, czego trasy nie są w stanie wywołać.
 */

const NOW = new Date('2026-09-23T10:00:00.000Z');

let handle: DbHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

describe('removeAccount', () => {
  it('błąd inny niż klucz obcy leci dalej, a nie udaje „konto w użyciu"', async () => {
    handle = testDb();
    const { householdId } = await householdFixture(handle, testConfig(), NOW);
    // Wyzwalacz z RAISE() daje ten sam kod SQLITE_CONSTRAINT_TRIGGER co RESTRICT —
    // rozróżnić je może tylko komunikat.
    handle.sqlite.exec(`
      CREATE TRIGGER block_delete BEFORE DELETE ON accounts
      BEGIN SELECT RAISE(ABORT, 'zablokowane'); END;
    `);
    insertAccount(handle, {
      id: '01J9ZQK8WQ0000000000000000',
      householdId,
      name: 'ROR',
      type: 'checking',
      allocationClass: 'spending',
      openingBalanceOn: '2026-09-01',
      createdAt: NOW.getTime(),
      updatedAt: NOW.getTime(),
    });

    expect(() =>
      removeAccount(handle as DbHandle, householdId, '01J9ZQK8WQ0000000000000000'),
    ).toThrow('zablokowane');
  });
});

describe('findMaxSortOrder', () => {
  it('dla gospodarstwa bez kont zwraca -1, więc pierwsze konto dostaje 0', async () => {
    handle = testDb();
    const { householdId } = await householdFixture(handle, testConfig(), NOW);
    expect(findMaxSortOrder(handle, householdId)).toBe(-1);
  });
});
