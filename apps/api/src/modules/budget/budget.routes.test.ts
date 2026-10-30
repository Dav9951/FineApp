import type { CategoryAveragesDto } from '@fineapp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertCategory,
  insertLiability,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';
import { newId } from '../../core/id.js';
import { plannedExpenses } from '../../db/schema/planned-expenses.js';
import { recurringOccurrences, recurringRules } from '../../db/schema/recurring.js';

/**
 * Testy tras planera budżetu — od `F9-3` średnie kategorii
 * ([04 §14a](../../../../../../plans/04-api-spec.md#14a-planer-budżetu--apiv1budget-drafts),
 * [07 §13.3](../../../../../../plans/07-domain-rules.md#133-średnia-kategorii)).
 */

/** 27 października 2026, 11:00 w Warszawie — okno 3 miesięcy to lipiec–wrzesień. */
const NOW = new Date('2026-10-27T10:00:00.000Z');
const BASE = '/api/v1/budget-drafts';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Aplikacja z gospodarstwem. */
interface Setup {
  app: TestApp;
  home: HouseholdFixture;
}

/**
 * Buduje aplikację z jednym gospodarstwem.
 *
 * @returns Aplikacja i gospodarstwo.
 */
async function setup(): Promise<Setup> {
  const app = await buildTestApp({}, mutableClock(NOW));
  harness = app;
  const home = await householdFixture(app.db, testConfig(), NOW);
  return { app, home };
}

/**
 * Pobiera średnie i sprawdza `200`.
 *
 * @param s - Aplikacja.
 * @param query - Zapytanie (np. `?months=6`).
 * @returns Dane z koperty.
 */
async function averages(s: Setup, query = ''): Promise<CategoryAveragesDto> {
  const response = await s.app.app.inject({
    method: 'GET',
    url: `${BASE}/averages${query}`,
    headers: s.home.headers,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ data: CategoryAveragesDto }>().data;
}

/**
 * Wydatek w miesiącu — 15. dnia.
 *
 * @param s - Aplikacja.
 * @param categoryId - Kategoria.
 * @param month - Miesiąc `YYYY-MM`.
 * @param amountMinor - Kwota.
 * @param extra - Dodatkowe kolumny.
 * @returns Identyfikator transakcji.
 */
function spend(
  s: Setup,
  categoryId: string,
  month: string,
  amountMinor: number,
  extra: Parameters<typeof insertTransaction>[2] = {},
): string {
  return insertTransaction(s.app.db, s.home, {
    categoryId,
    bookedOn: `${month}-15`,
    monthKey: month,
    amountMinor,
    ...extra,
  });
}

describe('GET /budget-drafts/averages', () => {
  it('wymaga zalogowania; okno spoza 3/6/12 → 400', async () => {
    const s = await setup();
    const anonymous = await s.app.app.inject({ method: 'GET', url: `${BASE}/averages` });
    expect(anonymous.statusCode).toBe(401);
    const wrong = await s.app.app.inject({
      method: 'GET',
      url: `${BASE}/averages?months=5`,
      headers: s.home.headers,
    });
    expect(wrong.statusCode).toBe(400);
  });

  it('bez transakcji — okno, zero miesięcy z danymi, pusta lista', async () => {
    const s = await setup();
    expect(await averages(s)).toEqual({
      months: 3,
      window: { from: '2026-07', to: '2026-09' },
      monthsWithData: 0,
      items: [],
    });
  });

  it('średnia zmiennych wydatków: podkategorie do głównej, zera się liczą, w górę do złotego', async () => {
    const s = await setup();
    const food = insertCategory(s.app.db, s.home, { name: 'Jedzenie' });
    const grocery = insertCategory(s.app.db, s.home, { name: 'Zakupy', parentId: food });
    const cafe = insertCategory(s.app.db, s.home, {
      name: 'Kawa',
      parentId: food,
      isArchived: true,
    });
    const barber = insertCategory(s.app.db, s.home, { name: 'Fryzjer' });

    spend(s, grocery, '2026-07', 1_200_00);
    spend(s, cafe, '2026-07', 250_00);
    spend(s, food, '2026-08', 2_210_00);
    spend(s, grocery, '2026-09', 1_960_00);
    spend(s, barber, '2026-08', 90_00);
    // Historia sprzed okna ustawia początek danych, ale się nie liczy.
    spend(s, grocery, '2026-03', 9_000_00);
    // Bieżący miesiąc jest niepełny — poza oknem.
    spend(s, grocery, '2026-10', 5_000_00);

    const result = await averages(s);
    expect(result.monthsWithData).toBe(3);
    expect(result.items).toEqual([
      {
        categoryId: food,
        name: 'Jedzenie',
        icon: null,
        averageMinor: 1_874_00,
        byMonth: [
          { month: '2026-07', amountMinor: 1_450_00 },
          { month: '2026-08', amountMinor: 2_210_00 },
          { month: '2026-09', amountMinor: 1_960_00 },
        ],
      },
      {
        categoryId: barber,
        name: 'Fryzjer',
        icon: null,
        averageMinor: 30_00,
        byMonth: [
          { month: '2026-07', amountMinor: 0 },
          { month: '2026-08', amountMinor: 90_00 },
          { month: '2026-09', amountMinor: 0 },
        ],
      },
    ]);
  });

  it('pomija wydatki z reguł, planowanych wydatków i zobowiązań, kosz, nieksięgowane i przychody', async () => {
    const s = await setup();
    const at = NOW.getTime();
    const flat = insertCategory(s.app.db, s.home, { name: 'Mieszkanie' });
    const salary = insertCategory(s.app.db, s.home, { name: 'Pensja', kind: 'income' });

    const ruleId = newId();
    s.app.db.db
      .insert(recurringRules)
      .values({
        id: ruleId,
        householdId: s.home.householdId,
        name: 'Czynsz',
        flow: 'expense',
        amountMinor: 1_850_00,
        frequency: 'monthly',
        dayOfMonth: 10,
        anchorDate: '2026-08-10',
        startMonth: '2026-08',
        createdAt: at,
        updatedAt: at,
      })
      .run();
    const occurrenceId = newId();
    s.app.db.db
      .insert(recurringOccurrences)
      .values({
        id: occurrenceId,
        householdId: s.home.householdId,
        ruleId,
        dueOn: '2026-08-10',
        monthKey: '2026-08',
        plannedAmountMinor: 1_850_00,
        status: 'posted',
        createdAt: at,
        updatedAt: at,
      })
      .run();
    const plannedId = newId();
    s.app.db.db
      .insert(plannedExpenses)
      .values({
        id: plannedId,
        householdId: s.home.householdId,
        name: 'Malowanie',
        estimatedAmountMinor: 3_000_00,
        dueMonth: '2026-09',
        createdAt: at,
        updatedAt: at,
      })
      .run();
    const liabilityId = insertLiability(s.app.db, s.home);

    spend(s, flat, '2026-07', 300_00); // jedyny wydatek zmienny
    spend(s, flat, '2026-08', 1_850_00, { recurringOccurrenceId: occurrenceId });
    spend(s, flat, '2026-09', 3_000_00, { plannedExpenseId: plannedId });
    spend(s, flat, '2026-09', 2_500_00, { liabilityId });
    spend(s, flat, '2026-08', 777_00, { deletedAt: at });
    spend(s, flat, '2026-08', 555_00, { status: 'pending' });
    spend(s, salary, '2026-08', 9_800_00, { type: 'income' });

    const result = await averages(s);
    expect(result.items).toEqual([
      expect.objectContaining({ categoryId: flat, averageMinor: 100_00 }),
    ]);
  });

  it('krótka historia — mianownik od pierwszego miesiąca z transakcją; okno z zapytania', async () => {
    const s = await setup();
    const food = insertCategory(s.app.db, s.home, { name: 'Jedzenie' });
    spend(s, food, '2026-08', 1_000_00);
    spend(s, food, '2026-09', 2_000_00);

    const result = await averages(s, '?months=6');
    expect(result).toMatchObject({
      months: 6,
      window: { from: '2026-04', to: '2026-09' },
      monthsWithData: 2,
    });
    expect(result.items[0]?.averageMinor).toBe(1_500_00);
  });

  it('nie widzi wydatków innego gospodarstwa', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), NOW);
    const foreign = insertCategory(s.app.db, other, { name: 'Cudze' });
    insertTransaction(s.app.db, other, {
      categoryId: foreign,
      bookedOn: '2026-08-15',
      monthKey: '2026-08',
      amountMinor: 500_00,
    });
    expect((await averages(s)).items).toEqual([]);
  });
});
