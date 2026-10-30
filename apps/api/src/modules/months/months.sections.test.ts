import type { MonthSummaryDto } from '@fineapp/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertAccount,
  insertBudgetDraft,
  insertBudgetLine,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';

/**
 * Sekcje `recurring` i `liabilities` podsumowania miesiąca — zadanie `F4-7`
 * ([05 §13](../../../../../../plans/05-dto-contracts.md#13-miesiąc--dtomonthdtots),
 * [07 §6.6](../../../../../../plans/07-domain-rules.md#66-zaległości), ADR-050).
 */

/** 23 września 2026, 12:00 w Warszawie. Okno sierpień–wrzesień. */
const START = new Date('2026-09-23T10:00:00.000Z');

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Środowisko testu. */
interface Setup {
  app: TestApp;
  home: HouseholdFixture;
  ror: string;
}

/**
 * Aplikacja z gospodarstwem i kontem.
 *
 * @returns Środowisko testu.
 */
async function setup(): Promise<Setup> {
  const app = await buildTestApp({}, mutableClock(START));
  harness = app;
  const home = await householdFixture(app.db, testConfig(), START);
  return { app, home, ror: insertAccount(app.db, home, { name: 'ROR' }) };
}

/**
 * Wysyła żądanie w imieniu gospodarstwa.
 *
 * @param s - Środowisko.
 * @param method - Metoda.
 * @param url - Ścieżka względem `/api/v1`.
 * @param payload - Ciało.
 * @returns Odpowiedź.
 */
function call(
  s: Setup,
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return s.app.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...s.home.headers, 'idempotency-key': 'klucz-testowy-1' },
    ...(payload === undefined ? {} : { payload }),
  });
}

/**
 * Podsumowanie miesiąca.
 *
 * @param s - Środowisko.
 * @param month - Klucz miesiąca.
 * @returns Podsumowanie.
 */
async function summary(s: Setup, month: string): Promise<MonthSummaryDto> {
  const response = await call(s, 'GET', `/months/${month}/summary`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ data: MonthSummaryDto }>().data;
}

/**
 * Zakłada regułę czynszu 10. dnia od sierpnia.
 *
 * @param s - Środowisko.
 * @param overrides - Nadpisane pola.
 */
async function rent(s: Setup, overrides: Record<string, unknown> = {}): Promise<void> {
  const response = await call(s, 'POST', '/recurring/rules', {
    name: 'Czynsz',
    flow: 'expense',
    amountMinor: 185_000,
    accountId: s.ror,
    frequency: 'monthly',
    dayOfMonth: 10,
    startMonth: '2026-08',
    isFixedExpense: true,
    ...overrides,
  });
  expect(response.statusCode, response.body).toBe(201);
}

describe('sekcja recurring', () => {
  it('bieżący miesiąc: wrześniowe i zaległe z sierpnia, rosnąco, z miesiącem', async () => {
    const s = await setup();
    await rent(s);
    await rent(s, { name: 'Internet', amountMinor: 8_900, dayOfMonth: 25 });

    const { recurring } = await summary(s, '2026-09');
    expect(
      recurring.items.map((item) => [item.ruleName, item.dueOn, item.monthKey, item.isOverdue]),
    ).toEqual([
      ['Czynsz', '2026-08-10', '2026-08', true],
      ['Internet', '2026-08-25', '2026-08', true],
      ['Czynsz', '2026-09-10', '2026-09', true],
      ['Internet', '2026-09-25', '2026-09', false],
    ]);
    expect(recurring).toMatchObject({
      pendingCount: 4,
      overdueCount: 3,
      plannedTotalMinor: 193_900,
      postedTotalMinor: 0,
    });
  });

  it('zaksięgowane znika z „Do zrobienia" i wchodzi do wykonania', async () => {
    const s = await setup();
    await rent(s);
    const before = await summary(s, '2026-09');
    const september = before.recurring.items.find((item) => item.monthKey === '2026-09');
    const post = await call(s, 'POST', `/recurring/occurrences/${september?.id ?? ''}/post`, {});
    expect(post.statusCode, post.body).toBe(201);

    const { recurring, totals } = await summary(s, '2026-09');
    expect(recurring.items.map((item) => item.monthKey)).toEqual(['2026-08']);
    expect(recurring.postedTotalMinor).toBe(185_000);
    expect(totals.expenseMinor).toBe(185_000);
  });

  it('miesiąc poprzedni: tylko jego pozycje, bez „wcześniejszych"', async () => {
    const s = await setup();
    await rent(s);
    const { recurring } = await summary(s, '2026-08');
    expect(recurring.items.map((item) => item.dueOn)).toEqual(['2026-08-10']);
  });

  it('miesiąc przyszły: podgląd bez identyfikatorów, nic nie zaległe', async () => {
    const s = await setup();
    await rent(s);
    const { recurring } = await summary(s, '2026-11');
    expect(recurring.items).toHaveLength(1);
    expect(recurring.items[0]).toMatchObject({ id: null, dueOn: '2026-11-10', isOverdue: false });
    expect(recurring.overdueCount).toBe(0);
  });

  it('bez reguł — pusta sekcja z zerami', async () => {
    const s = await setup();
    expect((await summary(s, '2026-09')).recurring).toEqual({
      plannedTotalMinor: 0,
      postedTotalMinor: 0,
      pendingCount: 0,
      overdueCount: 0,
      items: [],
    });
  });
});

describe('sekcja liabilities', () => {
  it('sumy, raty w oglądanym miesiącu i niezapłacone', async () => {
    const s = await setup();
    const create = async (body: Record<string, unknown>): Promise<string> => {
      const response = await call(s, 'POST', '/liabilities', {
        kind: 'installment',
        balanceAsOf: '2026-08-01',
        paymentDay: 20,
        ...body,
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json<{ data: { id: string } }>().data.id;
    };
    const phone = await create({
      name: 'Telefon',
      openingBalanceMinor: 250_000,
      monthlyPaymentMinor: 50_000,
    });
    await create({ name: 'Laptop', openingBalanceMinor: 120_000, monthlyPaymentMinor: 40_000 });
    insertTransaction(s.app.db, s.home, {
      liabilityId: phone,
      accountId: s.ror,
      amountMinor: 50_000,
      bookedOn: '2026-09-20',
      monthKey: '2026-09',
    });

    const september = (await summary(s, '2026-09')).liabilities;
    expect(september).toMatchObject({
      totalRemainingMinor: 320_000,
      monthlyPaymentTotalMinor: 90_000,
      paidThisMonthMinor: 50_000,
      unpaidCount: 1,
    });
    expect(september.items.map((item) => item.name)).toEqual(['Laptop', 'Telefon']);

    const august = (await summary(s, '2026-08')).liabilities;
    expect(august).toMatchObject({ paidThisMonthMinor: 0, unpaidCount: 2 });
  });
});

describe('Sekcje `allocation` i `goals` (F5-8)', () => {
  it('kafel celów procentowych i aktywne cele z planem oglądanego miesiąca', async () => {
    const s = await setup();
    const savings = insertAccount(s.app.db, s.home, {
      type: 'savings',
      allocationClass: 'savings',
    });
    insertTransaction(s.app.db, s.home, {
      type: 'income',
      amountMinor: 1_180_000,
      accountId: s.ror,
    });
    const put = await s.app.app.inject({
      method: 'PUT',
      url: '/api/v1/allocation/target',
      headers: s.home.headers,
      payload: {
        effectiveFromMonth: '2026-09',
        savingsPercentBps: 2000,
        investmentPercentBps: 1000,
      },
    });
    expect(put.statusCode).toBe(200);
    const goal = await call(s, 'POST', '/goals', {
      name: 'Wkład własny',
      kind: 'savings',
      contributionAmountMinor: 200_000,
    });
    const goalId = goal.json<{ data: { id: string } }>().data.id;
    insertTransaction(s.app.db, s.home, {
      type: 'transfer',
      amountMinor: 200_000,
      accountId: s.ror,
      counterAccountId: savings,
      sourceAllocationClass: 'spending',
      targetAllocationClass: 'savings',
      goalId,
    });

    const september = await summary(s, '2026-09');
    expect(september.allocation).toMatchObject({
      month: '2026-09',
      effectiveFromMonth: '2026-09',
      totals: { shortfallMinor: 154_000, actualAmountMinor: 200_000 },
    });
    expect(september.allocation.totals.actualAmountMinor).toBe(september.totals.savingsMinor);
    expect(september.goals).toHaveLength(1);
    expect(september.goals[0]?.contribution).toMatchObject({
      plannedPercentBps: 1695,
      contributedThisMonthMinor: 200_000,
      isPlanMetThisMonth: true,
    });

    const august = await summary(s, '2026-08');
    expect(august.allocation.effectiveFromMonth).toBeNull();
    expect(august.goals[0]?.contribution.contributedThisMonthMinor).toBe(0);
  });
});

describe('Sekcja `budget` (F9-8)', () => {
  it('bez planów: brak szkicu, można założyć; 23 września — jeszcze bez podpowiedzi', async () => {
    const s = await setup();
    expect((await summary(s, '2026-09')).budget).toEqual({
      month: '2026-09',
      hasDraft: false,
      canCreate: true,
      leftoverMinor: null,
      nextMonth: '2026-10',
      nextMonthHasDraft: false,
      suggestNextMonth: false,
    });
  });

  it('ostatni tydzień: podpowiedź tylko na bieżącym miesiącu i tylko bez planu następnego', async () => {
    // 25 września — do końca miesiąca mniej niż 7 dni.
    const at = new Date('2026-09-25T10:00:00.000Z');
    const app = await buildTestApp({}, mutableClock(at));
    harness = app;
    const home = await householdFixture(app.db, testConfig(), at);
    const s: Setup = { app, home, ror: insertAccount(app.db, home, { name: 'ROR' }) };

    expect((await summary(s, '2026-09')).budget.suggestNextMonth).toBe(true);
    expect((await summary(s, '2026-08')).budget).toMatchObject({
      suggestNextMonth: false,
      canCreate: false,
    });
    insertBudgetDraft(app.db, home, '2026-10');
    expect((await summary(s, '2026-09')).budget).toMatchObject({
      nextMonthHasDraft: true,
      suggestNextMonth: false,
    });
  });

  it('szkic oglądanego miesiąca — „Zostaje" z oceny szkicu', async () => {
    const s = await setup();
    const draftId = insertBudgetDraft(s.app.db, s.home, '2026-10');
    insertBudgetLine(s.app.db, s.home, draftId, {
      flow: 'income',
      name: 'Premia',
      amountMinor: 500_000,
    });
    insertBudgetLine(s.app.db, s.home, draftId);
    const budget = (await summary(s, '2026-10')).budget;
    expect(budget).toMatchObject({
      month: '2026-10',
      hasDraft: true,
      canCreate: true,
      leftoverMinor: 490_000,
      nextMonth: '2026-11',
      nextMonthHasDraft: false,
    });
  });
});
