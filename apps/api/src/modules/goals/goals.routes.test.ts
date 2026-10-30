import type {
  ConvertContributionResponse,
  GoalContributionResultDto,
  GoalDetailDto,
  GoalDto,
  GoalsListMeta,
  TransactionMutationMeta,
} from '@fineapp/shared';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertAccount,
  insertIncomeSource,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';
import { transactions, type TransactionInsert } from '../../db/schema/transactions.js';

/**
 * Testy tras celów — zadania `F5-1` i `F5-2`
 * ([04 §10](../../../../../../plans/04-api-spec.md#10-cele--apiv1goals),
 * [07 §3–§4](../../../../../../plans/07-domain-rules.md#4-cele), ADR-052).
 */

/** 23 września 2026, 12:00 w Warszawie. */
const START = new Date('2026-09-23T10:00:00.000Z');

let harness: TestApp | undefined;
let keyCounter = 0;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Środowisko testu. */
interface Setup {
  app: TestApp;
  home: HouseholdFixture;
  ror: string;
  savings: string;
  broker: string;
}

/** Kształt błędu. */
interface ErrorBody {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
}

/**
 * Aplikacja z gospodarstwem, kontem bieżącym, oszczędnościowym i maklerskim oraz
 * wrześniowymi wpływami 11 800 zł (podstawa z 04 §10).
 *
 * @returns Środowisko testu.
 */
async function setup(): Promise<Setup> {
  const app = await buildTestApp({}, mutableClock(START));
  harness = app;
  const home = await householdFixture(app.db, testConfig(), START);
  const ror = insertAccount(app.db, home, { name: 'ROR' });
  const savings = insertAccount(app.db, home, {
    name: 'Oszczędności',
    type: 'savings',
    allocationClass: 'savings',
  });
  const broker = insertAccount(app.db, home, {
    name: 'Maklerskie',
    type: 'investment',
    allocationClass: 'investment',
  });
  insertTransaction(app.db, home, {
    type: 'income',
    amountMinor: 1_180_000,
    accountId: ror,
    bookedOn: '2026-09-10',
    monthKey: '2026-09',
  });
  return { app, home, ror, savings, broker };
}

/**
 * Wysyła żądanie w imieniu gospodarstwa.
 *
 * @param s - Środowisko.
 * @param method - Metoda.
 * @param url - Ścieżka względem `/api/v1`.
 * @param payload - Ciało.
 * @param headers - Dodatkowe nagłówki.
 * @param home - Gospodarstwo.
 * @returns Odpowiedź.
 */
function call(
  s: Setup,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = {},
  home: HouseholdFixture = s.home,
): Promise<LightMyRequestResponse> {
  return s.app.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...home.headers, ...headers },
    ...(payload === undefined ? {} : { payload }),
  });
}

/**
 * Zakłada cel i oczekuje `201`.
 *
 * @param s - Środowisko.
 * @param body - Pola celu ponad domyślne („Wkład własny", 2 000 zł/mies.).
 * @returns Cel.
 */
async function create(s: Setup, body: Record<string, unknown> = {}): Promise<GoalDto> {
  const response = await call(s, 'POST', '/goals', {
    name: 'Wkład własny',
    kind: 'savings',
    contributionAmountMinor: 200_000,
    ...body,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: GoalDto }>().data;
}

/**
 * Pobiera cel z listy.
 *
 * @param s - Środowisko.
 * @param id - Identyfikator celu.
 * @param query - Parametry listy.
 * @returns Cel.
 */
async function listed(s: Setup, id: string, query = ''): Promise<GoalDto> {
  const response = await call(s, 'GET', `/goals${query}`);
  expect(response.statusCode, response.body).toBe(200);
  const goal = response.json<{ data: GoalDto[] }>().data.find((item) => item.id === id);
  if (goal === undefined) throw new Error('Brak celu na liście');
  return goal;
}

/**
 * Wstawia przelew wprost do księgi.
 *
 * @param s - Środowisko.
 * @param from - Konto źródłowe.
 * @param to - Konto docelowe.
 * @param amountMinor - Kwota.
 * @param overrides - Nadpisane kolumny (data, cel, klasy).
 * @returns Identyfikator transakcji.
 */
function transfer(
  s: Setup,
  from: string,
  to: string,
  amountMinor: number,
  overrides: Partial<TransactionInsert> = {},
): string {
  const classOf = (id: string) =>
    id === s.savings ? 'savings' : id === s.broker ? 'investment' : 'spending';
  return insertTransaction(s.app.db, s.home, {
    type: 'transfer',
    amountMinor,
    accountId: from,
    counterAccountId: to,
    sourceAllocationClass: classOf(from),
    targetAllocationClass: classOf(to),
    bookedOn: '2026-09-15',
    monthKey: '2026-09',
    ...overrides,
  });
}

/**
 * Nowy klucz idempotencji.
 *
 * @returns Nagłówek.
 */
function key(): Record<string, string> {
  keyCounter += 1;
  return { 'idempotency-key': `goal-key-${String(keyCounter).padStart(4, '0')}` };
}

describe('POST /goals', () => {
  it('zakłada cel z planem przeliczonym na procent wpływów (04 §10: 2 000 z 11 800 = 16,95%)', async () => {
    const s = await setup();
    const goal = await create(s, { targetAmountMinor: 12_000_000, targetDate: '2028-06-30' });
    expect(goal).toMatchObject({
      name: 'Wkład własny',
      kind: 'savings',
      progressSource: 'contributions',
      contributionAmountMinor: 200_000,
      contributionPercentBps: null,
      currentAmountMinor: 0,
      progressBps: 0,
      remainingMinor: 12_000_000,
      status: 'active',
      priority: 0,
      contribution: {
        mode: 'fixed',
        plannedAmountMinor: 200_000,
        plannedPercentBps: 1695,
        contributedThisMonthMinor: 0,
        isPlanMetThisMonth: false,
      },
    });
    const second = await create(s, { name: 'Poduszka' });
    expect(second.priority).toBe(1);
  });

  it('zapisuje tylko stronę przelicznika zgodną z trybem (07 §3)', async () => {
    const s = await setup();
    const goal = await create(s, {
      contributionMode: 'percent_of_income',
      contributionPercentBps: 1000,
      contributionAmountMinor: 999,
    });
    expect(goal.contributionAmountMinor).toBeNull();
    expect(goal.contributionPercentBps).toBe(1000);
    expect(goal.contribution).toMatchObject({
      plannedAmountMinor: 118_000,
      plannedPercentBps: 1000,
    });
  });

  it('I-14: tryb bez wartości → 422 ze wskazaniem pola', async () => {
    const s = await setup();
    const response = await call(s, 'POST', '/goals', {
      name: 'Cel',
      kind: 'savings',
      contributionMode: 'percent_of_income',
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorBody>().error.details?.[0]?.path).toBe('contributionPercentBps');

    const noAccount = await call(s, 'POST', '/goals', {
      name: 'Cel',
      kind: 'savings',
      contributionMode: 'none',
      progressSource: 'account_balance',
    });
    expect(noAccount.statusCode).toBe(422);
    expect(noAccount.json<ErrorBody>().error.details?.[0]?.path).toBe('linkedAccountId');
  });

  it('powiązane konto spoza gospodarstwa → 404, z archiwum → 422', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = insertAccount(s.app.db, other);
    expect(
      (
        await call(s, 'POST', '/goals', {
          name: 'C',
          kind: 'savings',
          contributionMode: 'none',
          linkedAccountId: foreign,
        })
      ).statusCode,
    ).toBe(404);
    const archived = insertAccount(s.app.db, s.home, { isArchived: true });
    expect(
      (
        await call(s, 'POST', '/goals', {
          name: 'C',
          kind: 'savings',
          contributionMode: 'none',
          linkedAccountId: archived,
        })
      ).statusCode,
    ).toBe(422);
  });

  it('bez zalogowania → 401', async () => {
    const s = await setup();
    const response = await s.app.app.inject({ method: 'GET', url: '/api/v1/goals' });
    expect(response.statusCode).toBe(401);
  });
});

describe('postęp w trybie wpłat (07 §4.1)', () => {
  it('kwota początkowa plus wpłaty netto: wypłata z celu zmniejsza postęp', async () => {
    const s = await setup();
    const goal = await create(s, { targetAmountMinor: 12_000_000, startingAmountMinor: 4_000_000 });
    transfer(s, s.ror, s.savings, 200_000, { goalId: goal.id });
    transfer(s, s.savings, s.ror, 50_000, { goalId: goal.id, bookedOn: '2026-09-20' });
    // Nie liczą się: przelew bez celu, przelew w koszu, wydatek z celem.
    transfer(s, s.ror, s.savings, 70_000);
    transfer(s, s.ror, s.savings, 90_000, { goalId: goal.id, deletedAt: Date.now() });
    insertTransaction(s.app.db, s.home, { goalId: goal.id, accountId: s.ror, amountMinor: 5_000 });

    const dto = await listed(s, goal.id);
    expect(dto).toMatchObject({
      currentAmountMinor: 4_150_000,
      progressBps: 3458,
      remainingMinor: 7_850_000,
      contribution: { contributedThisMonthMinor: 150_000, isPlanMetThisMonth: false },
    });
  });

  it('przelew między kontami klasy celu to wpłata; plan wykonany', async () => {
    const s = await setup();
    const second = insertAccount(s.app.db, s.home, { type: 'savings', allocationClass: 'savings' });
    const goal = await create(s);
    transfer(s, s.savings, second, 200_000, {
      goalId: goal.id,
      targetAllocationClass: 'savings',
    });
    const dto = await listed(s, goal.id);
    expect(dto.currentAmountMinor).toBe(200_000);
    expect(dto.contribution.isPlanMetThisMonth).toBe(true);
  });

  it('?month= liczy plan i wpłaty wskazanego miesiąca', async () => {
    const s = await setup();
    const goal = await create(s);
    transfer(s, s.ror, s.savings, 120_000, {
      goalId: goal.id,
      bookedOn: '2026-08-05',
      monthKey: '2026-08',
    });
    const response = await call(s, 'GET', '/goals?month=2026-08');
    const body = response.json<{ data: GoalDto[]; meta: GoalsListMeta }>();
    expect(body.meta).toEqual({
      month: '2026-08',
      incomeBaseMinor: 0,
      isPartialMonth: false,
      plannedTotalMinor: 200_000,
      contributedTotalMinor: 120_000,
    });
    expect(body.data[0]?.contribution.plannedPercentBps).toBe(0);
  });
});

describe('postęp w trybie salda konta', () => {
  it('saldo powiązanego konta, wpłaty miesiąca = ruch netto na koncie', async () => {
    const s = await setup();
    const cushion = insertAccount(s.app.db, s.home, {
      type: 'savings',
      allocationClass: 'savings',
      openingBalanceMinor: 1_000_000,
    });
    const goal = await create(s, {
      name: 'Poduszka',
      targetAmountMinor: 3_000_000,
      progressSource: 'account_balance',
      linkedAccountId: cushion,
      contributionMode: 'none',
    });
    transfer(s, s.ror, cushion, 50_000, { targetAllocationClass: 'savings' });
    insertTransaction(s.app.db, s.home, {
      type: 'income',
      accountId: cushion,
      amountMinor: 1_234,
      bookedOn: '2026-09-20',
    });
    const dto = await listed(s, goal.id);
    expect(dto).toMatchObject({
      currentAmountMinor: 1_051_234,
      progressBps: 3504,
      contribution: {
        mode: 'none',
        plannedAmountMinor: null,
        contributedThisMonthMinor: 51_234,
        isPlanMetThisMonth: false,
      },
    });
  });
});

describe('prognoza (07 §4.2)', () => {
  it('przykład z 04 §10: 39 miesięcy, grudzień 2029, potrzeba 3 714,29 zł', async () => {
    const s = await setup();
    const goal = await create(s, {
      targetAmountMinor: 12_000_000,
      targetDate: '2028-06-30',
      startingAmountMinor: 4_200_000,
    });
    expect(goal.projection).toEqual({
      paceMonthlyMinor: 200_000,
      monthsToTargetAtCurrentPace: 39,
      projectedCompletionMonth: '2029-12',
      requiredMonthlyToHitTargetDateMinor: 371_429,
      isOnTrack: false,
    });
  });

  it('tempo z historii, gdy są co najmniej dwa miesiące z wpłatą', async () => {
    const s = await setup();
    const goal = await create(s, { targetAmountMinor: 1_000_000 });
    transfer(s, s.ror, s.savings, 300_000, {
      goalId: goal.id,
      bookedOn: '2026-06-02',
      monthKey: '2026-06',
    });
    transfer(s, s.ror, s.savings, 100_000, {
      goalId: goal.id,
      bookedOn: '2026-08-02',
      monthKey: '2026-08',
    });
    // Sprzed sześciu miesięcy — poza tempem, ale w postępie.
    transfer(s, s.ror, s.savings, 100_000, {
      goalId: goal.id,
      bookedOn: '2026-03-02',
      monthKey: '2026-03',
    });

    const response = await call(s, 'GET', `/goals/${goal.id}`);
    const detail = response.json<{ data: GoalDetailDto }>().data;
    expect(detail.currentAmountMinor).toBe(500_000);
    expect(detail.projection).toMatchObject({
      paceMonthlyMinor: 200_000,
      monthsToTargetAtCurrentPace: 3,
      projectedCompletionMonth: '2026-12',
    });
    expect(detail.history).toEqual([
      { month: '2026-04', amountMinor: 0 },
      { month: '2026-05', amountMinor: 0 },
      { month: '2026-06', amountMinor: 300_000 },
      { month: '2026-07', amountMinor: 0 },
      { month: '2026-08', amountMinor: 100_000 },
      { month: '2026-09', amountMinor: 0 },
    ]);
    expect(detail.contributions.map((tx) => tx.amountMinor)).toEqual([100_000, 300_000, 100_000]);
  });
});

describe('osiągnięcie celu (07 §4.3)', () => {
  it('odczyt oznacza cel jako osiągnięty; wpłaty nadal możliwe', async () => {
    const s = await setup();
    const goal = await create(s, { targetAmountMinor: 100_000, startingAmountMinor: 60_000 });
    expect(goal.status).toBe('active');
    transfer(s, s.ror, s.savings, 40_000, { goalId: goal.id });
    const reached = await listed(s, goal.id);
    expect(reached.status).toBe('achieved');
    expect(reached.achievedAt).toBe(START.getTime());
    expect(reached.remainingMinor).toBe(0);

    // Podniesienie kwoty nie cofa osiągnięcia — o tym decyduje użytkownik.
    const raised = await call(s, 'PATCH', `/goals/${goal.id}`, { targetAmountMinor: 200_000 });
    expect(raised.json<{ data: GoalDto }>().data.status).toBe('achieved');
    const reopened = await call(s, 'PATCH', `/goals/${goal.id}`, { status: 'active' });
    expect(reopened.json<{ data: GoalDto }>().data).toMatchObject({
      status: 'active',
      achievedAt: null,
      remainingMinor: 100_000,
    });
  });

  it('POST /:id/complete oznacza ręcznie, powtórzenie zostawia datę', async () => {
    const s = await setup();
    const goal = await create(s);
    const done = await call(s, 'POST', `/goals/${goal.id}/complete`);
    expect(done.json<{ data: GoalDto }>().data.status).toBe('achieved');
    const again = await call(s, 'POST', `/goals/${goal.id}/complete`);
    expect(again.json<{ data: GoalDto }>().data.achievedAt).toBe(START.getTime());
  });
});

describe('PATCH /goals/:id', () => {
  it('zmiana trybu czyści drugą stronę; reguły po scaleniu', async () => {
    const s = await setup();
    const goal = await create(s);
    const switched = await call(s, 'PATCH', `/goals/${goal.id}`, {
      contributionMode: 'percent_of_income',
      contributionPercentBps: 2000,
    });
    expect(switched.json<{ data: GoalDto }>().data).toMatchObject({
      contributionAmountMinor: null,
      contributionPercentBps: 2000,
      contribution: { plannedAmountMinor: 236_000 },
    });
    const broken = await call(s, 'PATCH', `/goals/${goal.id}`, { contributionMode: 'fixed' });
    expect(broken.statusCode).toBe(422);
  });

  it('archiwum znika z listy, chyba że includeArchived=true', async () => {
    const s = await setup();
    const goal = await create(s);
    await call(s, 'PATCH', `/goals/${goal.id}`, { status: 'archived' });
    const plain = await call(s, 'GET', '/goals');
    expect(plain.json<{ data: GoalDto[] }>().data).toHaveLength(0);
    const all = await call(s, 'GET', '/goals?includeArchived=true');
    expect(all.json<{ data: GoalDto[] }>().data[0]?.status).toBe('archived');
  });
});

describe('POST /goals/:id/contributions', () => {
  it('tworzy przelew z celem na konto powiązane; powtórka klucza — ten sam przelew', async () => {
    const s = await setup();
    const goal = await create(s, { linkedAccountId: s.savings, targetAmountMinor: 1_000_000 });
    const headers = key();
    const body = { amountMinor: 200_000, fromAccountId: s.ror };
    const first = await call(s, 'POST', `/goals/${goal.id}/contributions`, body, headers);
    expect(first.statusCode, first.body).toBe(201);
    const result = first.json<{ data: GoalContributionResultDto; meta: TransactionMutationMeta }>();
    expect(result.data.transaction).toMatchObject({
      type: 'transfer',
      accountId: s.ror,
      counterAccountId: s.savings,
      goalId: goal.id,
      description: 'Wkład własny',
      bookedOn: '2026-09-23',
      allocationEffects: [{ kind: 'savings', amountMinor: 200_000 }],
    });
    expect(result.data.goal).toMatchObject({
      currentAmountMinor: 200_000,
      contribution: { isPlanMetThisMonth: true },
    });
    expect(result.meta.affectedMonths).toEqual(['2026-09']);

    const replay = await call(s, 'POST', `/goals/${goal.id}/contributions`, body, headers);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const rows = s.app.db.db
      .select()
      .from(transactions)
      .where(eq(transactions.goalId, goal.id))
      .all();
    expect(rows).toHaveLength(1);
  });

  it('bez klucza → 400; bez konta docelowego → 422; cel w archiwum → 409', async () => {
    const s = await setup();
    const goal = await create(s);
    const body = { amountMinor: 1_000, fromAccountId: s.ror };
    expect((await call(s, 'POST', `/goals/${goal.id}/contributions`, body)).statusCode).toBe(400);
    const noTarget = await call(s, 'POST', `/goals/${goal.id}/contributions`, body, key());
    expect(noTarget.statusCode).toBe(422);
    expect(noTarget.json<ErrorBody>().error.details?.[0]?.path).toBe('toAccountId');
    await call(s, 'PATCH', `/goals/${goal.id}`, { status: 'archived' });
    const archived = await call(
      s,
      'POST',
      `/goals/${goal.id}/contributions`,
      { ...body, toAccountId: s.savings },
      key(),
    );
    expect(archived.statusCode).toBe(409);
  });

  it('przelew łamiący niezmiennik (to samo konto) → 422, nic nie zapisano', async () => {
    const s = await setup();
    const goal = await create(s, { linkedAccountId: s.ror });
    const response = await call(
      s,
      'POST',
      `/goals/${goal.id}/contributions`,
      { amountMinor: 1_000, fromAccountId: s.ror },
      key(),
    );
    expect(response.statusCode).toBe(422);
    expect(
      s.app.db.db.select().from(transactions).where(eq(transactions.goalId, goal.id)).all(),
    ).toHaveLength(0);
  });
});

describe('POST /goals/convert (07 §3)', () => {
  it('kwota → procent: 2 000 z 11 800 = 16,95%, miesiąc trwa', async () => {
    const s = await setup();
    const response = await call(s, 'POST', '/goals/convert', {
      month: '2026-09',
      amountMinor: 200_000,
    });
    expect(response.json<{ data: ConvertContributionResponse }>().data).toEqual({
      month: '2026-09',
      incomeBaseMinor: 1_180_000,
      amountMinor: 200_000,
      percentBps: 1695,
      isPartialMonth: true,
      basedOnIncomeSoFar: true,
    });
  });

  it('procent → kwota: 20% z 11 800 = 2 360 zł', async () => {
    const s = await setup();
    const response = await call(s, 'POST', '/goals/convert', {
      month: '2026-09',
      percentBps: 2000,
    });
    expect(response.json<{ data: ConvertContributionResponse }>().data.amountMinor).toBe(236_000);
  });

  it('zwrot podatku nie wchodzi do podstawy (07 §2.3)', async () => {
    const s = await setup();
    const refund = insertIncomeSource(s.app.db, s.home, {
      kind: 'refund',
      countsTowardAllocation: false,
    });
    insertTransaction(s.app.db, s.home, {
      type: 'income',
      amountMinor: 500_000,
      accountId: s.ror,
      incomeSourceId: refund,
    });
    const response = await call(s, 'POST', '/goals/convert', {
      month: '2026-09',
      percentBps: 1000,
    });
    expect(response.json<{ data: ConvertContributionResponse }>().data).toMatchObject({
      incomeBaseMinor: 1_180_000,
      amountMinor: 118_000,
    });
  });

  it('zerowa podstawa (zamknięty miesiąc bez wpływów): 0 i 0, nie NaN', async () => {
    const s = await setup();
    const response = await call(s, 'POST', '/goals/convert', {
      month: '2026-08',
      amountMinor: 200_000,
    });
    expect(response.json<{ data: ConvertContributionResponse }>().data).toEqual({
      month: '2026-08',
      incomeBaseMinor: 0,
      amountMinor: 200_000,
      percentBps: 0,
      isPartialMonth: false,
      basedOnIncomeSoFar: false,
    });
  });

  it('obie strony albo żadna → 400', async () => {
    const s = await setup();
    expect((await call(s, 'POST', '/goals/convert', { month: '2026-09' })).statusCode).toBe(400);
    expect(
      (await call(s, 'POST', '/goals/convert', { month: '2026-09', amountMinor: 1, percentBps: 1 }))
        .statusCode,
    ).toBe(400);
  });
});

describe('PATCH /goals/order i DELETE', () => {
  it('kolejność z listy; lista niepełna → 422', async () => {
    const s = await setup();
    const a = await create(s, { name: 'A' });
    const b = await create(s, { name: 'B' });
    const response = await call(s, 'PATCH', '/goals/order', { ids: [b.id, a.id] });
    expect(response.json<{ data: GoalDto[] }>().data.map((goal) => goal.name)).toEqual(['B', 'A']);
    expect((await call(s, 'PATCH', '/goals/order', { ids: [a.id] })).statusCode).toBe(422);
    expect((await call(s, 'PATCH', '/goals/order', { ids: [a.id, a.id] })).statusCode).toBe(422);
  });

  it('usunięcie: 204, wpłata zostaje w księdze bez powiązania (07 §10)', async () => {
    const s = await setup();
    const goal = await create(s);
    const tx = transfer(s, s.ror, s.savings, 1_000, { goalId: goal.id });
    expect((await call(s, 'DELETE', `/goals/${goal.id}`)).statusCode).toBe(204);
    const row = s.app.db.db.select().from(transactions).where(eq(transactions.id, tx)).get();
    expect(row?.goalId).toBeNull();
    expect((await call(s, 'GET', `/goals/${goal.id}`)).statusCode).toBe(404);
  });

  it('cel innego gospodarstwa — 404 dla odczytu, zmiany i usunięcia', async () => {
    const s = await setup();
    const goal = await create(s);
    const other = await householdFixture(s.app.db, testConfig(), START);
    for (const [method, url] of [
      ['GET', `/goals/${goal.id}`],
      ['PATCH', `/goals/${goal.id}`],
      ['DELETE', `/goals/${goal.id}`],
      ['POST', `/goals/${goal.id}/complete`],
    ] as const) {
      const response = await call(
        s,
        method,
        url,
        method === 'PATCH' ? { name: 'X' } : undefined,
        {},
        other,
      );
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});
