import type {
  ApplyToSourceResult,
  BudgetDraftDto,
  BudgetLineDto,
  PromoteBudgetLineResult,
} from '@fineapp/shared';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertAccount,
  insertCategory,
  insertGoal,
  insertLiability,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';
import { newId } from '../../core/id.js';
import { goals } from '../../db/schema/goals.js';
import { liabilities } from '../../db/schema/liabilities.js';
import { plannedExpenses } from '../../db/schema/planned-expenses.js';
import { recurringRules, type RecurringRuleInsert } from '../../db/schema/recurring.js';

/**
 * Testy zamiany linii i „Zastosuj w źródle" — `F9-5`
 * ([07 §13.6–13.7](../../../../../../plans/07-domain-rules.md#136-zamiana-linii-w-byt),
 * ADR-076, ADR-077).
 */

/** 27 października 2026, 11:00 w Warszawie. */
const NOW = new Date('2026-10-27T10:00:00.000Z');
const BASE = '/api/v1/budget-drafts';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Aplikacja z gospodarstwem i kontami. */
interface Setup {
  app: TestApp;
  home: HouseholdFixture;
  checking: string;
  savings: string;
  food: string;
}

/**
 * Buduje aplikację z kontem wydatkowym, oszczędnościowym i kategorią.
 *
 * @returns Kontekst testu.
 */
async function setup(): Promise<Setup> {
  const app = await buildTestApp({}, mutableClock(NOW));
  harness = app;
  const home = await householdFixture(app.db, testConfig(), NOW);
  return {
    app,
    home,
    checking: insertAccount(app.db, home, { name: 'ROR' }),
    savings: insertAccount(app.db, home, {
      name: 'Poduszka',
      type: 'savings',
      allocationClass: 'savings',
    }),
    food: insertCategory(app.db, home, { name: 'Jedzenie' }),
  };
}

/**
 * Wywołuje trasę planera.
 *
 * @param s - Kontekst.
 * @param method - Metoda.
 * @param url - Ścieżka względem `/budget-drafts`.
 * @param payload - Ciało.
 * @param key - Klucz idempotencji; `null` — bez nagłówka.
 * @returns Odpowiedź.
 */
async function call(
  s: Setup,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: object,
  key: string | null = newId(),
): Promise<LightMyRequestResponse> {
  return s.app.app.inject({
    method,
    url: `${BASE}${url}`,
    headers: { ...s.home.headers, ...(key === null ? {} : { 'idempotency-key': key }) },
    ...(payload === undefined ? {} : { payload }),
  });
}

/**
 * Zakłada szkic i zwraca go.
 *
 * @param s - Kontekst.
 * @param month - Miesiąc.
 * @param fill - Czy wypełnić ze źródeł.
 * @returns Szkic.
 */
async function createDraft(s: Setup, month: string, fill = true): Promise<BudgetDraftDto> {
  const response = await call(s, 'POST', `/${month}`, { fillFromSources: fill });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: BudgetDraftDto }>().data;
}

/**
 * Dopisuje linię własną i zwraca ją.
 *
 * @param s - Kontekst.
 * @param month - Miesiąc.
 * @param body - Pola linii.
 * @returns Nowa linia.
 */
async function addLine(s: Setup, month: string, body: object): Promise<BudgetLineDto> {
  const response = await call(s, 'POST', `/${month}/lines`, body);
  expect(response.statusCode, response.body).toBe(201);
  const lines = response.json<{ data: BudgetDraftDto }>().data.lines;
  const last = [...lines].sort((a, b) => b.sortOrder - a.sortOrder)[0];
  if (last === undefined) throw new Error('brak linii');
  return last;
}

/**
 * Pobiera szkic.
 *
 * @param s - Kontekst.
 * @param month - Miesiąc.
 * @returns Szkic.
 */
async function getDraft(s: Setup, month: string): Promise<BudgetDraftDto> {
  const response = await call(s, 'GET', `/${month}`, undefined, null);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ data: BudgetDraftDto }>().data;
}

/**
 * Wstawia regułę wydatku 10. dnia od września.
 *
 * @param s - Kontekst.
 * @param values - Nadpisane pola.
 * @returns Identyfikator reguły.
 */
function insertRule(s: Setup, values: Partial<RecurringRuleInsert> = {}): string {
  const id = newId();
  s.app.db.db
    .insert(recurringRules)
    .values({
      id,
      householdId: s.home.householdId,
      name: 'Czynsz',
      flow: 'expense',
      amountMinor: 1_850_00,
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
 * Reguły gospodarstwa po nazwie.
 *
 * @param s - Kontekst.
 * @param name - Nazwa.
 * @returns Wiersze reguł.
 */
function rulesNamed(s: Setup, name: string) {
  return s.app.db.db.select().from(recurringRules).where(eq(recurringRules.name, name)).all();
}

describe('POST …/lines/:lineId/promote — pozycja cykliczna', () => {
  it('reguła od miesiąca szkicu, dzień z linii; linia powiązana; szkic późniejszy dostaje linię', async () => {
    const s = await setup();
    await createDraft(s, '2026-11');
    await createDraft(s, '2026-12');
    const gym = await addLine(s, '2026-11', {
      flow: 'expense',
      name: 'Siłownia',
      amountMinor: 149_00,
      categoryId: s.food,
      dueOn: '2026-11-05',
    });

    const key = newId();
    const body = { target: 'recurring', accountId: s.checking };
    const response = await call(s, 'POST', `/2026-11/lines/${gym.id}/promote`, body, key);
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<{ data: PromoteBudgetLineResult }>().data;

    const [rule] = rulesNamed(s, 'Siłownia');
    expect(rule).toMatchObject({
      flow: 'expense',
      amountMinor: 149_00,
      frequency: 'monthly',
      dayOfMonth: 5,
      startMonth: '2026-11',
      categoryId: s.food,
      isFixedExpense: true,
    });
    expect(result.created).toEqual({ kind: 'recurring_rule', id: rule?.id });
    expect(result.lineMovedTo).toBeNull();
    expect(result.draft.lines.find((item) => item.id === gym.id)).toMatchObject({
      origin: 'recurring',
      recurringRuleId: rule?.id,
      sourceState: 'in_sync',
      dueOn: '2026-11-05',
      canPromote: [],
    });
    const december = await getDraft(s, '2026-12');
    expect(december.lines.find((item) => item.name === 'Siłownia')).toMatchObject({
      origin: 'recurring',
      amountMinor: 149_00,
      dueOn: '2026-12-05',
    });

    // Powtórka z tym samym kluczem — ta sama odpowiedź, bez drugiej reguły.
    const replay = await call(s, 'POST', `/2026-11/lines/${gym.id}/promote`, body, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(rulesNamed(s, 'Siłownia')).toHaveLength(1);
  });

  it('bez klucza idempotencji → 400', async () => {
    const s = await setup();
    await createDraft(s, '2026-11', false);
    const line = await addLine(s, '2026-11', { flow: 'expense', name: 'X', amountMinor: 1_00 });
    const response = await call(
      s,
      'POST',
      `/2026-11/lines/${line.id}/promote`,
      { target: 'recurring', accountId: s.checking },
      null,
    );
    expect(response.statusCode).toBe(400);
  });

  it('reguła tygodniowa — linia dostaje sumę terminów miesiąca', async () => {
    const s = await setup();
    await createDraft(s, '2026-12', false);
    const line = await addLine(s, '2026-12', {
      flow: 'expense',
      name: 'Basen',
      amountMinor: 30_00,
    });
    const response = await call(s, 'POST', `/2026-12/lines/${line.id}/promote`, {
      target: 'recurring',
      frequency: 'weekly',
      weekday: 3,
      accountId: s.checking,
    });
    expect(response.statusCode, response.body).toBe(200);
    const promoted = response
      .json<{ data: PromoteBudgetLineResult }>()
      .data.draft.lines.find((item) => item.id === line.id);
    // Grudzień 2026 ma pięć śród.
    expect(promoted).toMatchObject({ amountMinor: 150_00, sourceAmountMinor: 150_00 });
    expect(promoted?.canApplyToSource).toBe(false);
  });

  it('oszczędności → przelew: konta muszą dawać wpłatę do puli', async () => {
    const s = await setup();
    await createDraft(s, '2026-11', false);
    const line = await addLine(s, '2026-11', {
      flow: 'savings',
      name: 'Na poduszkę',
      amountMinor: 500_00,
      dueOn: '2026-11-11',
    });
    const other = insertAccount(s.app.db, s.home, { name: 'Gotówka', type: 'cash' });

    const wrong = await call(s, 'POST', `/2026-11/lines/${line.id}/promote`, {
      target: 'recurring',
      accountId: s.checking,
      counterAccountId: other,
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json<{ error: { details: { path: string }[] } }>().error.details[0]?.path).toBe(
      'counterAccountId',
    );
    expect(rulesNamed(s, 'Na poduszkę')).toEqual([]);

    const ok = await call(s, 'POST', `/2026-11/lines/${line.id}/promote`, {
      target: 'recurring',
      accountId: s.checking,
      counterAccountId: s.savings,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(rulesNamed(s, 'Na poduszkę')[0]).toMatchObject({
      flow: 'transfer',
      counterAccountId: s.savings,
      isFixedExpense: false,
    });
  });

  it('reguła bez terminu w miesiącu szkicu albo bez dnia → 422 i nic nie powstaje', async () => {
    const s = await setup();
    await createDraft(s, '2026-11', false);
    const line = await addLine(s, '2026-11', { flow: 'expense', name: 'OC', amountMinor: 900_00 });

    const yearly = await call(s, 'POST', `/2026-11/lines/${line.id}/promote`, {
      target: 'recurring',
      frequency: 'yearly',
      monthOfYear: 3,
      dayOfMonth: 14,
      accountId: s.checking,
    });
    expect(yearly.statusCode).toBe(422);
    const noDay = await call(s, 'POST', `/2026-11/lines/${line.id}/promote`, {
      target: 'recurring',
      accountId: s.checking,
    });
    expect(noDay.statusCode).toBe(422);
    expect(rulesNamed(s, 'OC')).toEqual([]);
    expect((await getDraft(s, '2026-11')).lines[0]?.origin).toBe('manual');
  });

  it('linia powiązana, wpływ jako planowany wydatek, kwota 0 → 422', async () => {
    const s = await setup();
    insertRule(s);
    const d = await createDraft(s, '2026-11');
    const rent = d.lines[0];
    expect(
      (await call(s, 'POST', `/2026-11/lines/${rent?.id ?? ''}/promote`, { target: 'planned' }))
        .statusCode,
    ).toBe(422);
    const income = await addLine(s, '2026-11', { flow: 'income', name: 'Premia', amountMinor: 1 });
    const asPlanned = await call(s, 'POST', `/2026-11/lines/${income.id}/promote`, {
      target: 'planned',
    });
    expect(asPlanned.statusCode).toBe(422);
    expect(asPlanned.json<{ error: { message: string } }>().error.message).toBe(
      'Planowanym wydatkiem może zostać tylko wydatek.',
    );
    const zero = await addLine(s, '2026-11', { flow: 'expense', name: 'Zero', amountMinor: 0 });
    expect(
      (await call(s, 'POST', `/2026-11/lines/${zero.id}/promote`, { target: 'planned' }))
        .statusCode,
    ).toBe(422);
  });
});

describe('POST …/lines/:lineId/promote — planowany (nadchodzący) wydatek', () => {
  it('termin w miesiącu szkicu — linia staje się powiązana', async () => {
    const s = await setup();
    await createDraft(s, '2026-11', false);
    const line = await addLine(s, '2026-11', {
      flow: 'expense',
      name: 'Prezent dla mamy',
      amountMinor: 300_00,
      dueOn: '2026-11-20',
    });
    const response = await call(s, 'POST', `/2026-11/lines/${line.id}/promote`, {
      target: 'planned',
    });
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<{ data: PromoteBudgetLineResult }>().data;
    const [expense] = s.app.db.db.select().from(plannedExpenses).all();
    expect(expense).toMatchObject({
      name: 'Prezent dla mamy',
      estimatedAmountMinor: 300_00,
      dueMonth: '2026-11',
      dueOn: '2026-11-20',
      priority: 'should',
      setAsideEnabled: false,
    });
    expect(result.created).toEqual({ kind: 'planned_expense', id: expense?.id });
    expect(result.draft.lines[0]).toMatchObject({
      origin: 'planned',
      plannedExpenseId: expense?.id,
      sourceState: 'in_sync',
      canApplyToSource: true,
    });
  });

  it('termin w innym miesiącu — linia przechodzi do szkicu terminu; bez szkicu tylko znika', async () => {
    const s = await setup();
    await createDraft(s, '2026-11', false);
    await createDraft(s, '2027-02', false);
    const skiing = await addLine(s, '2026-11', {
      flow: 'expense',
      name: 'Narty',
      amountMinor: 3_000_00,
    });
    const moved = await call(s, 'POST', `/2026-11/lines/${skiing.id}/promote`, {
      target: 'planned',
      dueMonth: '2027-02',
      dueOn: '2027-02-14',
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const result = moved.json<{ data: PromoteBudgetLineResult }>().data;
    expect(result.lineMovedTo).toBe('2027-02');
    expect(result.draft.lines).toEqual([]);
    expect((await getDraft(s, '2027-02')).lines).toEqual([
      expect.objectContaining({
        name: 'Narty',
        origin: 'planned',
        amountMinor: 3_000_00,
        dueOn: '2027-02-14',
      }),
    ]);

    const tv = await addLine(s, '2026-11', { flow: 'expense', name: 'Telewizor', amountMinor: 1 });
    const noDraft = await call(s, 'POST', `/2026-11/lines/${tv.id}/promote`, {
      target: 'planned',
      dueMonth: '2027-05',
    });
    expect(noDraft.json<{ data: PromoteBudgetLineResult }>().data.lineMovedTo).toBe('2027-05');
    expect(s.app.db.db.select().from(plannedExpenses).all()).toHaveLength(2);
  });

  it('termin w przeszłości → 422', async () => {
    const s = await setup();
    await createDraft(s, '2026-11', false);
    const line = await addLine(s, '2026-11', { flow: 'expense', name: 'X', amountMinor: 1 });
    expect(
      (
        await call(s, 'POST', `/2026-11/lines/${line.id}/promote`, {
          target: 'planned',
          dueMonth: '2026-09',
        })
      ).statusCode,
    ).toBe(422);
    expect(s.app.db.db.select().from(plannedExpenses).all()).toEqual([]);
  });
});

describe('POST …/lines/:lineId/apply-to-source (07 §13.7)', () => {
  it('bieżący miesiąc — zmiana kwoty reguły', async () => {
    const s = await setup();
    const ruleId = insertRule(s);
    const d = await createDraft(s, '2026-10');
    const rent = d.lines[0];
    await call(s, 'PATCH', `/2026-10/lines/${rent?.id ?? ''}`, { amountMinor: 1_900_00 }, null);

    const response = await call(s, 'POST', `/2026-10/lines/${rent?.id ?? ''}/apply-to-source`);
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<{ data: ApplyToSourceResult }>().data;
    expect(result.effect).toEqual({
      kind: 'rule_updated',
      previousAmountMinor: 1_850_00,
      newAmountMinor: 1_900_00,
      fromMonth: '2026-10',
      newRuleId: null,
    });
    expect(
      s.app.db.db.select().from(recurringRules).where(eq(recurringRules.id, ruleId)).get()
        ?.amountMinor,
    ).toBe(1_900_00);
    expect(result.draft.lines[0]).toMatchObject({
      sourceState: 'in_sync',
      sourceAmountMinor: 1_900_00,
    });
  });

  it('miesiąc przyszły — podział reguły; szkice od tego miesiąca przechodzą na nową', async () => {
    const s = await setup();
    const ruleId = insertRule(s);
    const november = await createDraft(s, '2026-11');
    const december = await createDraft(s, '2026-12');
    await createDraft(s, '2027-01');
    const rentDec = december.lines[0];
    await call(s, 'PATCH', `/2026-12/lines/${rentDec?.id ?? ''}`, { amountMinor: 1_950_00 }, null);

    const key = newId();
    const response = await call(
      s,
      'POST',
      `/2026-12/lines/${rentDec?.id ?? ''}/apply-to-source`,
      undefined,
      key,
    );
    expect(response.statusCode, response.body).toBe(200);
    const { effect } = response.json<{ data: ApplyToSourceResult }>().data;
    expect(effect).toMatchObject({
      kind: 'rule_split',
      previousAmountMinor: 1_850_00,
      newAmountMinor: 1_950_00,
      fromMonth: '2026-12',
    });

    const rules = rulesNamed(s, 'Czynsz');
    expect(rules).toHaveLength(2);
    expect(rules.find((rule) => rule.id === ruleId)).toMatchObject({
      endMonth: '2026-11',
      amountMinor: 1_850_00,
    });
    expect(rules.find((rule) => rule.id === effect.newRuleId)).toMatchObject({
      startMonth: '2026-12',
      endMonth: null,
      amountMinor: 1_950_00,
      dayOfMonth: 10,
      accountId: s.checking,
    });

    expect((await getDraft(s, '2026-11')).lines[0]).toMatchObject({
      recurringRuleId: ruleId,
      amountMinor: 1_850_00,
      sourceState: 'in_sync',
    });
    expect((await getDraft(s, '2026-12')).lines[0]).toMatchObject({
      recurringRuleId: effect.newRuleId,
      amountMinor: 1_950_00,
      sourceState: 'in_sync',
    });
    // Styczeń przepięty; kwota linii zostaje, a źródło ma nową kwotę.
    expect((await getDraft(s, '2027-01')).lines[0]).toMatchObject({
      recurringRuleId: effect.newRuleId,
      amountMinor: 1_850_00,
      sourceState: 'source_changed',
      sourceCurrentAmountMinor: 1_950_00,
    });
    expect(november.lines).toHaveLength(1);

    // Powtórka nie dzieli reguły drugi raz.
    const replay = await call(
      s,
      'POST',
      `/2026-12/lines/${rentDec?.id ?? ''}/apply-to-source`,
      undefined,
      key,
    );
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(rulesNamed(s, 'Czynsz')).toHaveLength(2);
  });

  it('reguła raty zobowiązania i reguła tygodniowa → 422', async () => {
    const s = await setup();
    const loanRule = insertRule(s, { name: 'Rata' });
    const loan = insertLiability(s.app.db, s.home);
    s.app.db.db
      .update(liabilities)
      .set({ recurringRuleId: loanRule })
      .where(eq(liabilities.id, loan))
      .run();
    insertRule(s, { name: 'Basen', frequency: 'weekly', dayOfMonth: null, weekday: 3 });
    const d = await createDraft(s, '2026-11');
    for (const name of ['Rata', 'Basen']) {
      const item = d.lines.find((candidate) => candidate.name === name);
      expect(item?.canApplyToSource, name).toBe(false);
      expect(
        (await call(s, 'POST', `/2026-11/lines/${item?.id ?? ''}/apply-to-source`)).statusCode,
        name,
      ).toBe(422);
    }
  });

  it('planowany wydatek — nowy szacunek; cel kwotowy — nowy plan wpłat', async () => {
    const s = await setup();
    const at = NOW.getTime();
    const expenseId = newId();
    s.app.db.db
      .insert(plannedExpenses)
      .values({
        id: expenseId,
        householdId: s.home.householdId,
        name: 'Przegląd',
        estimatedAmountMinor: 800_00,
        dueMonth: '2026-11',
        createdAt: at,
        updatedAt: at,
      })
      .run();
    const goalId = insertGoal(s.app.db, s.home, 'Wkład własny');
    s.app.db.db
      .update(goals)
      .set({ contributionMode: 'fixed', contributionAmountMinor: 2_000_00 })
      .where(eq(goals.id, goalId))
      .run();
    const d = await createDraft(s, '2026-11');
    const review = d.lines.find((item) => item.name === 'Przegląd');
    const goalLine = d.lines.find((item) => item.name === 'Wkład własny');
    await call(s, 'PATCH', `/2026-11/lines/${review?.id ?? ''}`, { amountMinor: 950_00 }, null);
    await call(s, 'PATCH', `/2026-11/lines/${goalLine?.id ?? ''}`, { amountMinor: 2_500_00 }, null);

    const planned = await call(s, 'POST', `/2026-11/lines/${review?.id ?? ''}/apply-to-source`);
    expect(planned.json<{ data: ApplyToSourceResult }>().data.effect).toMatchObject({
      kind: 'planned_updated',
      previousAmountMinor: 800_00,
      newAmountMinor: 950_00,
    });
    expect(
      s.app.db.db.select().from(plannedExpenses).where(eq(plannedExpenses.id, expenseId)).get()
        ?.estimatedAmountMinor,
    ).toBe(950_00);

    const goal = await call(s, 'POST', `/2026-11/lines/${goalLine?.id ?? ''}/apply-to-source`);
    expect(goal.json<{ data: ApplyToSourceResult }>().data.effect).toMatchObject({
      kind: 'goal_updated',
      previousAmountMinor: 2_000_00,
      newAmountMinor: 2_500_00,
      fromMonth: '2026-10',
    });
    expect(
      s.app.db.db.select().from(goals).where(eq(goals.id, goalId)).get()?.contributionAmountMinor,
    ).toBe(2_500_00);
  });

  it('linia własna → 422; kwota 0 w źródle → 422', async () => {
    const s = await setup();
    insertRule(s);
    const d = await createDraft(s, '2026-11');
    const own = await addLine(s, '2026-11', { flow: 'expense', name: 'X', amountMinor: 1 });
    expect((await call(s, 'POST', `/2026-11/lines/${own.id}/apply-to-source`)).statusCode).toBe(
      422,
    );
    const rent = d.lines[0];
    await call(s, 'PATCH', `/2026-11/lines/${rent?.id ?? ''}`, { amountMinor: 0 }, null);
    const zero = await call(s, 'POST', `/2026-11/lines/${rent?.id ?? ''}/apply-to-source`);
    expect(zero.statusCode).toBe(422);
    expect(rulesNamed(s, 'Czynsz')).toHaveLength(1);
  });
});
