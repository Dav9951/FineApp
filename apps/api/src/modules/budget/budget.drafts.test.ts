import type { BudgetDraftDto, BudgetDraftListDto, BudgetLineDto } from '@fineapp/shared';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertAccount,
  insertCategory,
  insertGoal,
  insertIncomeSource,
  insertLiability,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock, type MutableClock } from '../../core/clock.js';
import { newId } from '../../core/id.js';
import { allocationTargets } from '../../db/schema/allocation-targets.js';
import { budgetDraftLines } from '../../db/schema/budget.js';
import { goals } from '../../db/schema/goals.js';
import { liabilities } from '../../db/schema/liabilities.js';
import { plannedExpenses } from '../../db/schema/planned-expenses.js';
import {
  recurringOccurrences,
  recurringRules,
  type RecurringRuleInsert,
} from '../../db/schema/recurring.js';
import { transactions } from '../../db/schema/transactions.js';
import { signAccessToken } from '../auth/auth.tokens.js';

/**
 * Testy szkicu budżetu — `F9-4`
 * ([04 §14a](../../../../../../plans/04-api-spec.md#14a-planer-budżetu--apiv1budget-drafts),
 * [07 §13](../../../../../../plans/07-domain-rules.md#13-planer-budżetu)).
 * Prawdziwe API i baza; źródła wstawiane wprost, żeby test nie zależał od walidacji
 * innych modułów.
 */

/** 27 października 2026, 11:00 w Warszawie — ostatni tydzień miesiąca. */
const NOW = new Date('2026-10-27T10:00:00.000Z');
const DAY = 86_400_000;
const BASE = '/api/v1/budget-drafts';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Aplikacja z gospodarstwem, kontami i zegarem do przesuwania. */
interface Setup {
  app: TestApp;
  home: HouseholdFixture;
  clock: MutableClock;
  checking: string;
  savings: string;
}

/**
 * Buduje aplikację z gospodarstwem i dwoma kontami (wydatkowe, oszczędnościowe).
 *
 * @returns Kontekst testu.
 */
async function setup(): Promise<Setup> {
  const clock = mutableClock(NOW);
  const app = await buildTestApp({}, clock);
  harness = app;
  const home = await householdFixture(app.db, testConfig(), NOW);
  const checking = insertAccount(app.db, home, { name: 'ROR' });
  const savings = insertAccount(app.db, home, {
    name: 'Poduszka',
    type: 'savings',
    allocationClass: 'savings',
  });
  return { app, home, clock, checking, savings };
}

/**
 * Wywołuje trasę planera.
 *
 * @param s - Kontekst.
 * @param method - Metoda HTTP.
 * @param url - Ścieżka względem `/budget-drafts`.
 * @param payload - Ciało żądania.
 * @param home - Gospodarstwo (domyślnie z kontekstu).
 * @returns Odpowiedź.
 */
async function call(
  s: Setup,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
  home: HouseholdFixture = s.home,
): Promise<LightMyRequestResponse> {
  return s.app.app.inject({
    method,
    url: `${BASE}${url}`,
    headers: home.headers,
    ...(payload === undefined ? {} : { payload }),
  });
}

/**
 * Wywołuje trasę i zwraca szkic, sprawdzając status.
 *
 * @param s - Kontekst.
 * @param method - Metoda HTTP.
 * @param url - Ścieżka.
 * @param payload - Ciało.
 * @param status - Oczekiwany status.
 * @returns Szkic z odpowiedzi.
 */
async function draft(
  s: Setup,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
  status = 200,
): Promise<BudgetDraftDto> {
  const response = await call(s, method, url, payload);
  expect(response.statusCode, response.body).toBe(status);
  return response.json<{ data: BudgetDraftDto }>().data;
}

/**
 * Wstawia regułę cykliczną.
 *
 * @param s - Kontekst.
 * @param values - Pola reguły (reszta domyślna: wydatek 10. dnia od września).
 * @returns Identyfikator reguły.
 */
function insertRule(s: Setup, values: Partial<RecurringRuleInsert>): string {
  const id = newId();
  s.app.db.db
    .insert(recurringRules)
    .values({
      id,
      householdId: s.home.householdId,
      name: 'Reguła',
      flow: 'expense',
      amountMinor: 100_00,
      accountId: s.checking,
      frequency: 'monthly',
      dayOfMonth: 10,
      anchorDate: '2026-09-10',
      startMonth: '2026-09',
      createdAt: NOW.getTime(),
      updatedAt: NOW.getTime(),
      ...values,
    })
    .run();
  return id;
}

/**
 * Linia szkicu po nazwie.
 *
 * @param d - Szkic.
 * @param name - Nazwa linii.
 * @returns Linia.
 */
function line(d: BudgetDraftDto, name: string): BudgetLineDto {
  const found = d.lines.find((item) => item.name === name);
  if (found === undefined) throw new Error(`brak linii ${name}`);
  return found;
}

/** Gospodarstwo ze wszystkimi rodzajami źródeł z 07 §13.2. */
interface Seeded extends Setup {
  rentRuleId: string;
  flatCategory: string;
  foodCategory: string;
  salaryCategory: string;
}

/**
 * Pensja, czynsz, przelew na oszczędności, pożyczka bez reguły, przegląd w listopadzie,
 * OC w marcu z odkładaniem, cel z planem 2 000 zł i rozkład 20% oszczędności.
 *
 * @returns Kontekst z identyfikatorami.
 */
async function seeded(): Promise<Seeded> {
  const s = await setup();
  const at = NOW.getTime();
  const flatCategory = insertCategory(s.app.db, s.home, { name: 'Mieszkanie' });
  const foodCategory = insertCategory(s.app.db, s.home, { name: 'Jedzenie' });
  const carCategory = insertCategory(s.app.db, s.home, { name: 'Samochód' });
  const salaryCategory = insertCategory(s.app.db, s.home, { name: 'Pensja', kind: 'income' });
  const job = insertIncomeSource(s.app.db, s.home);

  insertRule(s, {
    name: 'Wynagrodzenie',
    flow: 'income',
    amountMinor: 10_000_00,
    categoryId: salaryCategory,
    incomeSourceId: job,
  });
  const rentRuleId = insertRule(s, {
    name: 'Czynsz',
    amountMinor: 1_850_00,
    categoryId: flatCategory,
  });
  insertRule(s, {
    name: 'Na poduszkę',
    flow: 'transfer',
    amountMinor: 500_00,
    counterAccountId: s.savings,
  });

  const loan = insertLiability(s.app.db, s.home, 'Pożyczka');
  s.app.db.db
    .update(liabilities)
    .set({
      openingBalanceMinor: 1_000_00,
      balanceAsOf: '2026-10-01',
      monthlyPaymentMinor: 400_00,
      paymentDay: 15,
    })
    .where(eq(liabilities.id, loan))
    .run();

  s.app.db.db
    .insert(plannedExpenses)
    .values([
      {
        id: newId(),
        householdId: s.home.householdId,
        name: 'Przegląd',
        estimatedAmountMinor: 800_00,
        dueMonth: '2026-11',
        categoryId: carCategory,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: newId(),
        householdId: s.home.householdId,
        name: 'OC',
        estimatedAmountMinor: 2_400_00,
        dueMonth: '2027-03',
        categoryId: carCategory,
        setAsideEnabled: true,
        setAsideAccountId: s.savings,
        setAsideStartMonth: '2026-10',
        alreadySetAsideMinor: 800_00,
        createdAt: at,
        updatedAt: at,
      },
    ])
    .run();

  const goalId = insertGoal(s.app.db, s.home, 'Wkład własny');
  s.app.db.db
    .update(goals)
    .set({ contributionMode: 'fixed', contributionAmountMinor: 2_000_00 })
    .where(eq(goals.id, goalId))
    .run();

  s.app.db.db
    .insert(allocationTargets)
    .values({
      id: newId(),
      householdId: s.home.householdId,
      effectiveFromMonth: '2026-01',
      savingsPercentBps: 2_000,
      createdAt: at,
      updatedAt: at,
    })
    .run();

  return { ...s, rentRuleId, flatCategory, foodCategory, salaryCategory };
}

describe('dostęp i zakres', () => {
  it('wymaga zalogowania; zły miesiąc → 400; brak szkicu → 404', async () => {
    const s = await setup();
    expect((await s.app.app.inject({ method: 'GET', url: BASE })).statusCode).toBe(401);
    expect((await call(s, 'GET', '/2026-13')).statusCode).toBe(400);
    const missing = await call(s, 'GET', '/2026-11');
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ error: { message: string } }>().error.message).toBe(
      'Brak planu na listopad 2026.',
    );
  });

  it('szkic poza [bieżący, +12] → 422; drugi na ten sam miesiąc → 409 (I-20)', async () => {
    const s = await setup();
    expect((await call(s, 'POST', '/2026-09', {})).statusCode).toBe(422);
    expect((await call(s, 'POST', '/2027-11', {})).statusCode).toBe(422);
    await draft(s, 'POST', '/2027-10', { fillFromSources: false }, 201);
    expect((await call(s, 'POST', '/2027-10', {})).statusCode).toBe(409);
  });

  it('szkic innego gospodarstwa jest niewidoczny', async () => {
    const s = await setup();
    await draft(s, 'POST', '/2026-11', {}, 201);
    const other = await householdFixture(s.app.db, testConfig(), NOW);
    expect((await call(s, 'GET', '/2026-11', undefined, other)).statusCode).toBe(404);
  });
});

describe('POST /budget-drafts/:month — wypełnienie ze źródeł (07 §13.2)', () => {
  it('linie z reguł, raty, planowanych, odkładania i celu; ocena z rozkładem', async () => {
    const s = await seeded();
    const d = await draft(s, 'POST', '/2026-11', {}, 201);

    expect(d.isEditable).toBe(true);
    expect(d.lastFilledAt).toBe(NOW.getTime());
    expect(d.lines.map((item) => [item.flow, item.origin, item.name, item.amountMinor])).toEqual([
      ['income', 'recurring', 'Wynagrodzenie', 10_000_00],
      ['expense', 'recurring', 'Czynsz', 1_850_00],
      ['expense', 'liability', 'Pożyczka', 400_00],
      ['expense', 'planned', 'Przegląd', 800_00],
      ['savings', 'recurring', 'Na poduszkę', 500_00],
      ['savings', 'set_aside', 'Odkładanie: OC', 266_67],
      ['savings', 'goal', 'Wkład własny', 2_000_00],
    ]);
    const rent = line(d, 'Czynsz');
    expect(rent).toMatchObject({
      categoryName: 'Mieszkanie',
      dueOn: '2026-11-10',
      sourceAmountMinor: 1_850_00,
      sourceState: 'in_sync',
      canPromote: [],
      canApplyToSource: true,
    });
    expect(line(d, 'Odkładanie: OC').canApplyToSource).toBe(false);
    expect(line(d, 'Wkład własny').canApplyToSource).toBe(true);

    expect(d.summary).toMatchObject({
      incomeMinor: 10_000_00,
      expenseMinor: 3_050_00,
      savingsMinor: 2_766_67,
      leftoverMinor: 4_183_33,
      allocation: [
        {
          kind: 'savings',
          targetMinor: 2_000_00,
          plannedMinor: 2_766_67,
          status: 'met',
        },
      ],
    });
    expect(d.actuals).toBeNull();
  });

  it('bez wypełnienia — pusty szkic, bez znacznika wypełnienia', async () => {
    const s = await seeded();
    const d = await draft(s, 'POST', '/2026-12', { fillFromSources: false, notes: 'Narty' }, 201);
    expect(d).toMatchObject({ lines: [], lastFilledAt: null, notes: 'Narty' });
    // Bez linii: cel i odkładanie bez planu; rozkład przy zerowych wpływach nie ma celu kwotowego.
    expect(d.summary.warnings.map((w) => w.code)).toEqual(['GOAL_SHORT', 'SET_ASIDE_SHORT']);
  });
});

describe('linie własne', () => {
  it('dopisanie, walidacja i zamiana dostępna dla wydatku', async () => {
    const s = await seeded();
    await draft(s, 'POST', '/2026-11', { fillFromSources: false }, 201);

    const d = await draft(
      s,
      'POST',
      '/2026-11/lines',
      { flow: 'expense', name: 'Prezent dla mamy', amountMinor: 300_00, dueOn: '2026-11-20' },
      201,
    );
    expect(line(d, 'Prezent dla mamy')).toMatchObject({
      origin: 'manual',
      sourceState: null,
      canPromote: ['recurring', 'planned'],
      canApplyToSource: false,
    });

    const wrongKind = await call(s, 'POST', '/2026-11/lines', {
      flow: 'expense',
      name: 'Zła',
      amountMinor: 1,
      categoryId: s.salaryCategory,
    });
    expect(wrongKind.statusCode).toBe(422);
    expect(wrongKind.json<{ error: { message: string } }>().error.message).toBe(
      'Wydatek wymaga kategorii wydatku.',
    );
    expect(
      (
        await call(s, 'POST', '/2026-11/lines', {
          flow: 'expense',
          name: 'Poza',
          amountMinor: 1,
          dueOn: '2026-12-01',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await call(s, 'POST', '/2026-11/lines', {
          flow: 'expense',
          name: 'Nieznana',
          amountMinor: 1,
          categoryId: newId(),
        })
      ).statusCode,
    ).toBe(422);
    // Kształt (I-21) łapie już kontrakt.
    expect(
      (await call(s, 'POST', '/2026-11/lines', { flow: 'expense', name: 'Minus', amountMinor: -1 }))
        .statusCode,
    ).toBe(400);
  });

  it('usunięcie własnej kasuje ją; pominięcie własnej → 422 (I-24)', async () => {
    const s = await seeded();
    await draft(s, 'POST', '/2026-11', { fillFromSources: false }, 201);
    const added = await draft(
      s,
      'POST',
      '/2026-11/lines',
      { flow: 'expense', name: 'Prezent', amountMinor: 300_00 },
      201,
    );
    const id = line(added, 'Prezent').id;
    expect((await call(s, 'PATCH', `/2026-11/lines/${id}`, { isExcluded: true })).statusCode).toBe(
      422,
    );
    const after = await draft(s, 'DELETE', `/2026-11/lines/${id}`);
    expect(after.lines).toEqual([]);
    expect((await call(s, 'DELETE', `/2026-11/lines/${id}`)).statusCode).toBe(404);
  });

  it('kwota wpisana ręcznie czyści pamiątkę średniej', async () => {
    const s = await seeded();
    await draft(s, 'POST', '/2026-11', { fillFromSources: false }, 201);
    const added = await draft(
      s,
      'POST',
      '/2026-11/lines',
      {
        flow: 'expense',
        name: 'Jedzenie',
        amountMinor: 1_874_00,
        categoryId: s.foodCategory,
        averageMonths: 3,
      },
      201,
    );
    const id = line(added, 'Jedzenie').id;
    expect(line(added, 'Jedzenie').averageMonths).toBe(3);
    const renamed = await draft(s, 'PATCH', `/2026-11/lines/${id}`, { name: 'Jedzenie i chemia' });
    expect(line(renamed, 'Jedzenie i chemia').averageMonths).toBe(3);
    const edited = await draft(s, 'PATCH', `/2026-11/lines/${id}`, { amountMinor: 1_900_00 });
    expect(line(edited, 'Jedzenie i chemia').averageMonths).toBeNull();
  });
});

describe('linie powiązane (07 §13.5, ADR-076)', () => {
  it('edycja w szkicu nie zmienia stanu; zmiana reguły — source_changed; „Przyjmij"', async () => {
    const s = await seeded();
    const created = await draft(s, 'POST', '/2026-11', {}, 201);
    const rentId = line(created, 'Czynsz').id;

    const edited = await draft(s, 'PATCH', `/2026-11/lines/${rentId}`, { amountMinor: 1_900_00 });
    expect(line(edited, 'Czynsz')).toMatchObject({
      amountMinor: 1_900_00,
      sourceAmountMinor: 1_850_00,
      sourceState: 'in_sync',
    });

    s.app.db.db
      .update(recurringRules)
      .set({ amountMinor: 1_950_00 })
      .where(eq(recurringRules.id, s.rentRuleId))
      .run();
    const changed = await draft(s, 'GET', '/2026-11');
    expect(line(changed, 'Czynsz')).toMatchObject({
      amountMinor: 1_900_00,
      sourceState: 'source_changed',
      sourceCurrentAmountMinor: 1_950_00,
    });

    const accepted = await draft(s, 'POST', `/2026-11/lines/${rentId}/accept-source`);
    expect(line(accepted, 'Czynsz')).toMatchObject({
      amountMinor: 1_950_00,
      sourceAmountMinor: 1_950_00,
      sourceState: 'in_sync',
    });
  });

  it('usunięcie linii powiązanej to pominięcie; odświeżenie jej nie wskrzesza', async () => {
    const s = await seeded();
    const created = await draft(s, 'POST', '/2026-11', {}, 201);
    const rentId = line(created, 'Czynsz').id;

    const excluded = await draft(s, 'DELETE', `/2026-11/lines/${rentId}`);
    expect(line(excluded, 'Czynsz').isExcluded).toBe(true);
    expect(excluded.summary.expenseMinor).toBe(created.summary.expenseMinor - 1_850_00);

    const refreshed = await draft(s, 'POST', '/2026-11/refresh');
    expect(refreshed.lines.filter((item) => item.name === 'Czynsz')).toHaveLength(1);
    expect(line(refreshed, 'Czynsz').isExcluded).toBe(true);

    const restored = await draft(s, 'PATCH', `/2026-11/lines/${rentId}`, { isExcluded: false });
    expect(restored.summary.expenseMinor).toBe(created.summary.expenseMinor);
  });

  it('odświeżenie dokłada nową regułę na koniec i nie rusza edytowanych linii', async () => {
    const s = await seeded();
    const created = await draft(s, 'POST', '/2026-11', {}, 201);
    const rentId = line(created, 'Czynsz').id;
    await draft(s, 'PATCH', `/2026-11/lines/${rentId}`, { amountMinor: 1_700_00 });
    insertRule(s, { name: 'Siłownia', amountMinor: 149_00 });
    s.clock.advance(60_000);

    const refreshed = await draft(s, 'POST', '/2026-11/refresh');
    expect(line(refreshed, 'Siłownia')).toMatchObject({ origin: 'recurring', amountMinor: 149_00 });
    expect(line(refreshed, 'Siłownia').sortOrder).toBeGreaterThan(
      line(refreshed, 'Czynsz').sortOrder,
    );
    expect(line(refreshed, 'Czynsz').amountMinor).toBe(1_700_00);
    expect(refreshed.lastFilledAt).toBe(NOW.getTime() + 60_000);
  });

  it('usunięta reguła — linia osierocona z ostrzeżeniem; „Zostaw jako własną"', async () => {
    const s = await seeded();
    const created = await draft(s, 'POST', '/2026-11', {}, 201);
    const rentId = line(created, 'Czynsz').id;
    expect(
      (await call(s, 'POST', `/2026-11/lines/${rentId}/detach`)).statusCode,
      'źródło istnieje',
    ).toBe(422);

    s.app.db.db.delete(recurringRules).where(eq(recurringRules.id, s.rentRuleId)).run();
    const orphaned = await draft(s, 'GET', '/2026-11');
    expect(line(orphaned, 'Czynsz')).toMatchObject({
      sourceState: 'missing',
      recurringRuleId: null,
    });
    expect(orphaned.summary.warnings.map((w) => w.code)).toContain('ORPHAN_LINES');
    expect((await call(s, 'POST', `/2026-11/lines/${rentId}/accept-source`)).statusCode).toBe(422);

    const detached = await draft(s, 'POST', `/2026-11/lines/${rentId}/detach`);
    expect(line(detached, 'Czynsz')).toMatchObject({
      origin: 'manual',
      sourceState: null,
      sourceAmountMinor: null,
      canPromote: ['recurring', 'planned'],
    });
    expect(detached.summary.warnings.map((w) => w.code)).not.toContain('ORPHAN_LINES');
  });

  it('reguła wstrzymana — not_in_month', async () => {
    const s = await seeded();
    await draft(s, 'POST', '/2026-11', {}, 201);
    s.app.db.db
      .update(recurringRules)
      .set({ isActive: false })
      .where(eq(recurringRules.id, s.rentRuleId))
      .run();
    expect(line(await draft(s, 'GET', '/2026-11'), 'Czynsz').sourceState).toBe('not_in_month');
  });
});

describe('kopiowanie i średnie (07 §13.2–13.3)', () => {
  it('linie ze średniej i kopia linii własnych z innego szkicu', async () => {
    const s = await seeded();
    for (const [month, amount] of [
      ['2026-07', 1_450_00],
      ['2026-08', 2_210_00],
      ['2026-09', 1_960_00],
    ] as const) {
      insertTransaction(s.app.db, s.home, {
        categoryId: s.foodCategory,
        bookedOn: `${month}-15`,
        monthKey: month,
        amountMinor: amount,
      });
    }

    const november = await draft(
      s,
      'POST',
      '/2026-11',
      {
        averageLines: [{ categoryId: s.foodCategory }, { categoryId: s.flatCategory, months: 6 }],
      },
      201,
    );
    expect(line(november, 'Jedzenie')).toMatchObject({
      origin: 'manual',
      amountMinor: 1_874_00,
      averageMonths: 3,
      categoryId: s.foodCategory,
    });
    // Bez wydatków zmiennych — kwota 0, kategoria wybrana świadomie.
    expect(line(november, 'Mieszkanie')).toMatchObject({ amountMinor: 0, averageMonths: 6 });
    await draft(
      s,
      'POST',
      '/2026-11/lines',
      { flow: 'expense', name: 'Prezent', amountMinor: 300_00, dueOn: '2026-11-30' },
      201,
    );

    const december = await draft(
      s,
      'POST',
      '/2026-12',
      { fillFromSources: false, copyManualFrom: '2026-11' },
      201,
    );
    expect(december.lines.map((item) => [item.name, item.amountMinor, item.dueOn])).toEqual([
      ['Jedzenie', 1_874_00, null],
      ['Mieszkanie', 0, null],
      ['Prezent', 300_00, '2026-12-30'],
    ]);
    expect(december.lines.every((item) => item.origin === 'manual')).toBe(true);
  });

  it('kopia z nieistniejącego szkicu i średnia kategorii przychodu → 422', async () => {
    const s = await seeded();
    expect((await call(s, 'POST', '/2026-11', { copyManualFrom: '2026-10' })).statusCode).toBe(422);
    expect(
      (await call(s, 'POST', '/2026-11', { averageLines: [{ categoryId: s.salaryCategory }] }))
        .statusCode,
    ).toBe(422);
    expect((await call(s, 'GET', '/2026-11')).statusCode).toBe(404);
  });
});

describe('szkic minionego miesiąca (07 §13.1)', () => {
  it('po końcu miesiąca tylko do odczytu, ale do usunięcia', async () => {
    const s = await seeded();
    const october = await draft(s, 'POST', '/2026-10', {}, 201);
    const rentId = line(october, 'Czynsz').id;
    s.clock.advance(10 * DAY);
    // Token z chwili startu wygasł — podpisujemy nowy dla tej samej osoby.
    const token = await signAccessToken(
      testConfig(),
      { sub: s.home.userId, hid: s.home.householdId, sid: newId() },
      s.clock.now(),
    );
    s.home = { ...s.home, headers: { ...s.home.headers, authorization: `Bearer ${token}` } };

    const past = await draft(s, 'GET', '/2026-10');
    expect(past.isEditable).toBe(false);
    expect(past.lines.every((item) => item.sourceState === null)).toBe(true);
    expect(past.lines.every((item) => item.canPromote.length === 0 && !item.canApplyToSource)).toBe(
      true,
    );

    for (const [method, url, payload] of [
      ['PATCH', `/2026-10/lines/${rentId}`, { amountMinor: 1 }],
      ['DELETE', `/2026-10/lines/${rentId}`, undefined],
      ['POST', '/2026-10/lines', { flow: 'expense', name: 'X', amountMinor: 1 }],
      ['POST', '/2026-10/refresh', undefined],
      ['PATCH', '/2026-10', { notes: 'x' }],
      ['POST', `/2026-10/lines/${rentId}/accept-source`, undefined],
    ] as const) {
      const response = await call(s, method, url, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(409);
    }
    expect((await call(s, 'DELETE', '/2026-10')).statusCode).toBe(204);
    expect(s.app.db.db.select().from(budgetDraftLines).all()).toEqual([]);
  });
});

describe('GET /budget-drafts — lista', () => {
  it('szkice z bilansem; podpowiedź: w ostatnim tygodniu następny miesiąc bez szkicu', async () => {
    const s = await seeded();
    const empty = await call(s, 'GET', '');
    expect(empty.json<{ data: BudgetDraftListDto }>().data).toEqual({
      items: [],
      suggestedMonth: '2026-11',
      range: { from: '2026-10', to: '2027-10' },
    });

    const november = await draft(s, 'POST', '/2026-11', {}, 201);
    const list = (await call(s, 'GET', '')).json<{ data: BudgetDraftListDto }>().data;
    expect(list.suggestedMonth).toBe('2026-12');
    expect(list.items).toEqual([
      {
        month: '2026-11',
        incomeMinor: november.summary.incomeMinor,
        expenseMinor: november.summary.expenseMinor,
        leftoverMinor: november.summary.leftoverMinor,
        lineCount: november.lines.length,
        warningCount: november.summary.warnings.length,
      },
    ]);
  });

  it('notatka szkicu i usunięcie', async () => {
    const s = await seeded();
    await draft(s, 'POST', '/2026-11', { fillFromSources: false }, 201);
    expect((await draft(s, 'PATCH', '/2026-11', { notes: 'Prezenty' })).notes).toBe('Prezenty');
    expect((await draft(s, 'PATCH', '/2026-11', { notes: '' })).notes).toBeNull();
    expect((await call(s, 'DELETE', '/2026-11')).statusCode).toBe(204);
    expect((await call(s, 'DELETE', '/2026-11')).statusCode).toBe(404);
  });
});

describe('plan kontra wykonanie (07 §13.8, F9-9)', () => {
  it('bieżący miesiąc: linia reguły, grupa kategorii z podkategorią, cel i „Poza planem"', async () => {
    const s = await seeded();
    const at = NOW.getTime();
    const restaurants = insertCategory(s.app.db, s.home, {
      name: 'Restauracje',
      parentId: s.foodCategory,
    });
    const other = insertCategory(s.app.db, s.home, { name: 'Różne' });

    // Czynsz zaksięgowany przez wystąpienie reguły.
    const occurrenceId = newId();
    const rentTx = insertTransaction(s.app.db, s.home, {
      bookedOn: '2026-10-10',
      monthKey: '2026-10',
      amountMinor: 1_850_00,
      accountId: s.checking,
      categoryId: s.flatCategory,
      status: 'posted',
    });
    s.app.db.db
      .insert(recurringOccurrences)
      .values({
        id: occurrenceId,
        householdId: s.home.householdId,
        ruleId: s.rentRuleId,
        dueOn: '2026-10-10',
        monthKey: '2026-10',
        plannedAmountMinor: 1_850_00,
        status: 'posted',
        transactionId: rentTx,
        postedAmountMinor: 1_850_00,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    s.app.db.db
      .update(transactions)
      .set({ recurringOccurrenceId: occurrenceId })
      .where(eq(transactions.id, rentTx))
      .run();

    const d0 = await draft(s, 'POST', '/2026-10', { fillFromSources: true }, 201);
    await draft(
      s,
      'POST',
      '/2026-10/lines',
      { flow: 'expense', name: 'Jedzenie', amountMinor: 1_500_00, categoryId: s.foodCategory },
      201,
    );

    const posted = { monthKey: '2026-10', accountId: s.checking, status: 'posted' as const };
    insertTransaction(s.app.db, s.home, {
      ...posted,
      bookedOn: '2026-10-05',
      amountMinor: 1_200_00,
      categoryId: s.foodCategory,
    });
    // Podkategoria liczy się do grupy kategorii głównej.
    insertTransaction(s.app.db, s.home, {
      ...posted,
      bookedOn: '2026-10-06',
      amountMinor: 300_00,
      categoryId: restaurants,
    });
    // W kategorii bez linii — poza planem.
    insertTransaction(s.app.db, s.home, {
      ...posted,
      bookedOn: '2026-10-07',
      amountMinor: 320_00,
      categoryId: other,
    });
    // Usunięta — nie liczy się nigdzie.
    insertTransaction(s.app.db, s.home, {
      ...posted,
      bookedOn: '2026-10-08',
      amountMinor: 999_00,
      categoryId: s.foodCategory,
      deletedAt: at,
    });

    const d = await draft(s, 'GET', '/2026-10');
    expect(d0.actuals).not.toBeNull();
    const actuals = d.actuals;
    if (actuals === null) throw new Error('brak wykonania');
    expect(actuals.lines[line(d, 'Czynsz').id]).toBe(1_850_00);
    expect(actuals.lines[line(d, 'Wkład własny').id]).toBe(0);
    expect(actuals.groups).toEqual([
      {
        kind: 'category',
        id: s.foodCategory,
        name: 'Jedzenie',
        lineIds: [line(d, 'Jedzenie').id],
        plannedMinor: 1_500_00,
        actualMinor: 1_500_00,
      },
    ]);
    expect(actuals.totals.expenseMinor).toBe(1_850_00 + 1_500_00 + 320_00);
    expect(actuals.unplannedMinor).toBe(320_00);
  });

  it('miesiąc przyszły — bez wykonania', async () => {
    const s = await seeded();
    const d = await draft(s, 'POST', '/2026-11', { fillFromSources: true }, 201);
    expect(d.actuals).toBeNull();
  });
});

describe('przypadki brzegowe 07 §13.9 (F9-10)', () => {
  it('odświeżenie po zmianie kwoty reguły — linia bez zmian, source_changed', async () => {
    const s = await seeded();
    const created = await draft(s, 'POST', '/2026-11', {}, 201);
    const count = created.lines.length;
    s.app.db.db
      .update(recurringRules)
      .set({ amountMinor: 1_950_00 })
      .where(eq(recurringRules.id, s.rentRuleId))
      .run();
    const refreshed = await draft(s, 'POST', '/2026-11/refresh');
    expect(refreshed.lines).toHaveLength(count);
    expect(line(refreshed, 'Czynsz')).toMatchObject({
      amountMinor: 1_850_00,
      sourceAmountMinor: 1_850_00,
      sourceState: 'source_changed',
      sourceCurrentAmountMinor: 1_950_00,
    });
  });

  it('plan minionego miesiąca: wykonanie zostaje, szkic tylko do odczytu', async () => {
    const s = await seeded();
    await draft(s, 'POST', '/2026-10', { fillFromSources: false }, 201);
    await draft(
      s,
      'POST',
      '/2026-10/lines',
      { flow: 'expense', name: 'Jedzenie', amountMinor: 1_000_00, categoryId: s.foodCategory },
      201,
    );
    insertTransaction(s.app.db, s.home, {
      bookedOn: '2026-10-20',
      monthKey: '2026-10',
      amountMinor: 1_100_00,
      accountId: s.checking,
      categoryId: s.foodCategory,
      status: 'posted',
    });

    s.clock.advance(10 * DAY);
    const token = await signAccessToken(
      testConfig(),
      { sub: s.home.userId, hid: s.home.householdId, sid: newId() },
      s.clock.now(),
    );
    s.home = { ...s.home, headers: { ...s.home.headers, authorization: `Bearer ${token}` } };

    const past = await draft(s, 'GET', '/2026-10');
    expect(past.isEditable).toBe(false);
    expect(past.actuals?.groups).toEqual([
      expect.objectContaining({ plannedMinor: 1_000_00, actualMinor: 1_100_00 }),
    ]);
    expect(past.actuals?.unplannedMinor).toBe(0);
  });
});
