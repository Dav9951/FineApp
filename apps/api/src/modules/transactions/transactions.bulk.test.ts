import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import { householdFixture, insertAccount, insertCategory } from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';
import { transactions } from '../../db/schema/transactions.js';

/**
 * `POST /transactions/bulk` (`F7-6`, ADR-035): wszystkie albo żadna.
 */

const START = new Date('2026-09-23T10:00:00.000Z');

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/**
 * Buduje aplikację z gospodarstwem, kontem i kategorią.
 *
 * @returns Aplikacja, nagłówki, konto i kategoria.
 */
async function setup() {
  const app = await buildTestApp({}, mutableClock(START));
  harness = app;
  const home = await householdFixture(app.db, testConfig(), START);
  return { app, home, ror: insertAccount(app.db, home), food: insertCategory(app.db, home) };
}

describe('POST /transactions/bulk', () => {
  it('tworzy wszystkie; miesiące do unieważnienia bez powtórzeń', async () => {
    const { app, home, ror, food } = await setup();
    const response = await app.app.inject({
      method: 'POST',
      url: '/api/v1/transactions/bulk',
      headers: home.headers,
      payload: {
        transactions: [
          {
            type: 'expense',
            bookedOn: '2026-09-18',
            amountMinor: 698,
            accountId: ror,
            categoryId: food,
          },
          { type: 'expense', bookedOn: '2026-08-31', amountMinor: 2499, accountId: ror },
          { type: 'income', bookedOn: '2026-09-10', amountMinor: 300, accountId: ror },
        ],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      data: [{ amountMinor: 698, source: 'manual' }, { amountMinor: 2499 }, { amountMinor: 300 }],
      meta: { affectedMonths: ['2026-08', '2026-09'] },
    });
  });

  it('jedna zła pozycja wycofuje całość; ścieżka wskazuje indeks', async () => {
    const { app, home, ror, food } = await setup();
    const response = await app.app.inject({
      method: 'POST',
      url: '/api/v1/transactions/bulk',
      headers: home.headers,
      payload: {
        transactions: [
          { type: 'expense', bookedOn: '2026-09-18', amountMinor: 698, accountId: ror },
          {
            type: 'income',
            bookedOn: '2026-09-18',
            amountMinor: 100,
            accountId: ror,
            categoryId: food,
          },
        ],
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { details: [{ path: 'transactions.1.categoryId' }] },
    });
    expect(app.db.db.select().from(transactions).all()).toHaveLength(0);
  });

  it('kształt: pusta lista → 400; bez tokenu → 401', async () => {
    const { app, home } = await setup();
    const empty = await app.app.inject({
      method: 'POST',
      url: '/api/v1/transactions/bulk',
      headers: home.headers,
      payload: { transactions: [] },
    });
    expect(empty.statusCode).toBe(400);
    const anonymous = await app.app.inject({
      method: 'POST',
      url: '/api/v1/transactions/bulk',
      headers: { 'x-requested-with': 'fineapp' },
      payload: { transactions: [] },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
