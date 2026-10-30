import {
  formatMinor,
  type MonthSummaryDto,
  type PlannedExpenseDetailDto,
  type PlannedExpenseDto,
  type PostPlannedExpenseResultDto,
  type SetAsideResultDto,
  type TransactionDto,
  type UpcomingExpensesMeta,
} from '@fineapp/shared';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  CSRF_HEADER,
  householdFixture,
  insertAccount,
  insertCategory,
  insertGoal,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock, type MutableClock } from '../../core/clock.js';
import { newId } from '../../core/id.js';
import { signAccessToken } from '../auth/auth.tokens.js';
import { transactions } from '../../db/schema/transactions.js';

/**
 * Testy tras planowanych wydatków — zadania `F6-1`…`F6-5`
 * ([04 §9a](../../../../../../plans/04-api-spec.md#9a-planowane-wydatki--apiv1planned-expenses),
 * [07 §6.5](../../../../../../plans/07-domain-rules.md#65-planowane-wydatki), ADR-055).
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
  clock: MutableClock;
  home: HouseholdFixture;
  ror: string;
  savings: string;
  insurance: string;
}

/**
 * Aplikacja z kontem bieżącym (5 000 zł), oszczędnościowym i kategorią ubezpieczeń.
 *
 * @returns Środowisko testu.
 */
async function setup(): Promise<Setup> {
  const clock = mutableClock(START);
  const app = await buildTestApp({}, clock);
  harness = app;
  const home = await householdFixture(app.db, testConfig(), START);
  return {
    app,
    clock,
    home,
    ror: insertAccount(app.db, home, { name: 'ROR', openingBalanceMinor: 500_000 }),
    savings: insertAccount(app.db, home, {
      name: 'Oszczędności',
      type: 'savings',
      allocationClass: 'savings',
    }),
    insurance: insertCategory(app.db, home, { name: 'Ubezpieczenie' }),
  };
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
 * Przesuwa zegar do wskazanej chwili i wystawia nowy token — stary by już wygasł.
 *
 * @param s - Środowisko.
 * @param at - Docelowa chwila (UTC), późniejsza od bieżącej.
 */
async function travelTo(s: Setup, at: string): Promise<void> {
  s.clock.advance(new Date(at).getTime() - s.clock.now().getTime());
  const token = await signAccessToken(
    testConfig(),
    { sub: s.home.userId, hid: s.home.householdId, sid: newId() },
    s.clock.now(),
  );
  s.home = { ...s.home, headers: { authorization: `Bearer ${token}`, ...CSRF_HEADER } };
}

/**
 * Nowy klucz idempotencji.
 *
 * @returns Nagłówek.
 */
function key(): Record<string, string> {
  keyCounter += 1;
  return { 'idempotency-key': `planned-key-${String(keyCounter).padStart(4, '0')}` };
}

/**
 * Zakłada OC 2 400 zł na marzec 2027 z odkładaniem na konto oszczędnościowe.
 *
 * @param s - Środowisko.
 * @param overrides - Nadpisane pola.
 * @returns Wydatek.
 */
async function createOc(
  s: Setup,
  overrides: Record<string, unknown> = {},
): Promise<PlannedExpenseDto> {
  const response = await call(s, 'POST', '/planned-expenses', {
    name: 'OC + AC samochód',
    estimatedAmountMinor: 240_000,
    dueMonth: '2027-03',
    dueOn: '2027-03-14',
    categoryId: s.insurance,
    accountId: s.ror,
    priority: 'must',
    setAsideEnabled: true,
    setAsideAccountId: s.savings,
    repeatsYearly: true,
    ...overrides,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: PlannedExpenseDto }>().data;
}

/**
 * Szczegóły wydatku.
 *
 * @param s - Środowisko.
 * @param id - Identyfikator.
 * @returns Wydatek z historią.
 */
async function detail(s: Setup, id: string): Promise<PlannedExpenseDetailDto> {
  const response = await call(s, 'GET', `/planned-expenses/${id}`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ data: PlannedExpenseDetailDto }>().data;
}

describe('POST /planned-expenses', () => {
  it('rata odkładania od bieżącego miesiąca: 2 400 zł / 7 miesięcy', async () => {
    const s = await setup();
    const oc = await createOc(s);
    expect(oc).toMatchObject({
      status: 'planned',
      monthsUntilDue: 6,
      categoryName: 'Ubezpieczenie',
      setAside: {
        enabled: true,
        accountId: s.savings,
        startMonth: '2026-09',
        accumulatedMinor: 0,
        remainingMinor: 240_000,
        coverageBps: 0,
        monthlyRequiredMinor: 34_286,
        monthsLeft: 7,
        paidThisMonth: false,
        isOnTrack: true,
      },
    });
  });

  it('kwota zebrana poza aplikacją → od razu „funding"', async () => {
    const s = await setup();
    const oc = await createOc(s, { alreadySetAsideMinor: 80_000 });
    expect(oc.status).toBe('funding');
    expect(oc.setAside).toMatchObject({ coverageBps: 3333, monthlyRequiredMinor: 22_858 });
  });

  it('I-16, I-17, I-19 → 422 ze wskazaniem pola', async () => {
    const s = await setup();
    const cases: [Record<string, unknown>, string][] = [
      [{ dueOn: '2027-04-01' }, 'dueOn'],
      [{ setAsideAccountId: null }, 'setAsideAccountId'],
      [{ setAsideStartMonth: '2027-04' }, 'setAsideStartMonth'],
    ];
    for (const [overrides, path] of cases) {
      const response = await call(s, 'POST', '/planned-expenses', {
        name: 'OC',
        estimatedAmountMinor: 1_000,
        dueMonth: '2027-03',
        setAsideEnabled: true,
        setAsideAccountId: s.savings,
        ...overrides,
      });
      expect(response.statusCode, path).toBe(422);
      expect(
        response.json<{ error: { details: { path: string }[] } }>().error.details[0]?.path,
      ).toBe(path);
    }
  });

  it('odwołania: kategoria przychodu 422, obce konto 404, cel spoza gospodarstwa 404', async () => {
    const s = await setup();
    const salary = insertCategory(s.app.db, s.home, { kind: 'income' });
    const other = await householdFixture(s.app.db, testConfig(), START);
    const base = { name: 'X', estimatedAmountMinor: 1_000, dueMonth: '2027-03' };
    expect(
      (await call(s, 'POST', '/planned-expenses', { ...base, categoryId: salary })).statusCode,
    ).toBe(422);
    expect(
      (
        await call(s, 'POST', '/planned-expenses', {
          ...base,
          setAsideAccountId: insertAccount(s.app.db, other),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call(s, 'POST', '/planned-expenses', {
          ...base,
          setAsideGoalId: insertGoal(s.app.db, other),
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('POST /:id/set-aside (F6-3)', () => {
  it('rata wyliczona, przelew z konta płatności na konto odkładania; powtórka klucza — ten sam', async () => {
    const s = await setup();
    const oc = await createOc(s);
    const headers = key();
    const first = await call(s, 'POST', `/planned-expenses/${oc.id}/set-aside`, undefined, headers);
    expect(first.statusCode, first.body).toBe(201);
    const { data } = first.json<{ data: SetAsideResultDto }>();
    expect(data.transaction).toMatchObject({
      type: 'transfer',
      amountMinor: 34_286,
      accountId: s.ror,
      counterAccountId: s.savings,
      plannedExpenseId: oc.id,
      source: 'planned',
      description: 'Odkładanie: OC + AC samochód',
      allocationEffects: [{ kind: 'savings', amountMinor: 34_286 }],
    });
    expect(data.plannedExpense).toMatchObject({
      status: 'funding',
      setAside: { accumulatedMinor: 34_286, paidThisMonth: true },
    });
    const replay = await call(
      s,
      'POST',
      `/planned-expenses/${oc.id}/set-aside`,
      undefined,
      headers,
    );
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((await detail(s, oc.id)).setAsideHistory).toHaveLength(1);
  });

  it('odkładanie na cel: przelew niesie `goalId` — liczy się do celu i do wydatku', async () => {
    const s = await setup();
    const goal = await call(s, 'POST', '/goals', {
      name: 'Samochód',
      kind: 'savings',
      contributionMode: 'none',
      linkedAccountId: s.savings,
    });
    const goalId = goal.json<{ data: { id: string } }>().data.id;
    const oc = await createOc(s, { setAsideAccountId: null, setAsideGoalId: goalId });
    const response = await call(
      s,
      'POST',
      `/planned-expenses/${oc.id}/set-aside`,
      { amountMinor: 50_000 },
      key(),
    );
    const { transaction } = response.json<{ data: SetAsideResultDto }>().data;
    expect(transaction).toMatchObject({ counterAccountId: s.savings, goalId });
    const goalAfter = await call(s, 'GET', `/goals/${goalId}`);
    expect(goalAfter.json<{ data: { currentAmountMinor: number } }>().data.currentAmountMinor).toBe(
      50_000,
    );
  });

  it('bez konta odkładania 422; pokryte w całości 422; bez klucza 400', async () => {
    const s = await setup();
    const noTarget = await createOc(s, { setAsideEnabled: false, setAsideAccountId: null });
    expect(
      (await call(s, 'POST', `/planned-expenses/${noTarget.id}/set-aside`, undefined, key()))
        .statusCode,
    ).toBe(422);
    const full = await createOc(s, { alreadySetAsideMinor: 240_000 });
    expect(
      (await call(s, 'POST', `/planned-expenses/${full.id}/set-aside`, undefined, key()))
        .statusCode,
    ).toBe(422);
    expect((await call(s, 'POST', `/planned-expenses/${full.id}/set-aside`)).statusCode).toBe(400);
  });
});

describe('POST /:id/post i powtarzanie co rok (F6-3, F6-4)', () => {
  it('zapłata: wydatek, `posted`, instancja na przyszły rok z kwotą zapłaconą', async () => {
    const s = await setup();
    const oc = await createOc(s);
    const response = await call(
      s,
      'POST',
      `/planned-expenses/${oc.id}/post`,
      { amountMinor: 251_300 },
      key(),
    );
    expect(response.statusCode, response.body).toBe(201);
    const { data, meta } = response.json<{
      data: PostPlannedExpenseResultDto;
      meta: { affectedMonths: string[] };
    }>();
    expect(data.transaction).toMatchObject({
      type: 'expense',
      amountMinor: 251_300,
      accountId: s.ror,
      categoryId: s.insurance,
      plannedExpenseId: oc.id,
      source: 'planned',
      bookedOn: '2026-09-23',
    });
    expect(data.plannedExpense).toMatchObject({
      status: 'posted',
      transactionId: data.transaction.id,
      postedAmountMinor: 251_300,
    });
    expect(data.nextInstance).toMatchObject({
      dueMonth: '2028-03',
      dueOn: '2028-03-14',
      estimatedAmountMinor: 251_300,
      previousInstanceId: oc.id,
      repeatsYearly: true,
      status: 'planned',
      setAside: { startMonth: '2026-10', accumulatedMinor: 0 },
    });
    expect(meta.affectedMonths).toEqual(['2026-09']);

    const again = await call(s, 'POST', `/planned-expenses/${oc.id}/post`, {}, key());
    expect(again.statusCode).toBe(409);
  });

  it('usunięcie zapłaty cofa zaksięgowanie; ponowna zapłata nie tworzy drugiej instancji (07 §6.7)', async () => {
    const s = await setup();
    const oc = await createOc(s);
    const first = await call(s, 'POST', `/planned-expenses/${oc.id}/post`, {}, key());
    const txId = first.json<{ data: PostPlannedExpenseResultDto }>().data.transaction.id;

    expect((await call(s, 'DELETE', `/transactions/${txId}`)).statusCode).toBe(204);
    const back = await detail(s, oc.id);
    expect(back).toMatchObject({ status: 'planned', transactionId: null, postedAmountMinor: null });

    const second = await call(s, 'POST', `/planned-expenses/${oc.id}/post`, {}, key());
    expect(second.json<{ data: PostPlannedExpenseResultDto }>().data.nextInstance).toBeNull();
    const list = await call(s, 'GET', '/planned-expenses?status=planned');
    expect(
      list.json<{ data: PlannedExpenseDto[] }>().data.filter((p) => p.dueMonth === '2028-03'),
    ).toHaveLength(1);

    // Przywrócona pierwsza zapłata wraca jako zwykła — wydatek zapłacono już drugą.
    const restored = await call(s, 'POST', `/transactions/${txId}/restore`);
    expect(restored.json<{ data: TransactionDto }>().data.plannedExpenseId).toBeNull();
  });

  it('przywrócenie zapłaty wiąże ponownie; zmiana kwoty przechodzi na wydatek', async () => {
    const s = await setup();
    const oc = await createOc(s, { repeatsYearly: false });
    const posted = await call(s, 'POST', `/planned-expenses/${oc.id}/post`, {}, key());
    const txId = posted.json<{ data: PostPlannedExpenseResultDto }>().data.transaction.id;
    await call(s, 'DELETE', `/transactions/${txId}`);
    await call(s, 'POST', `/transactions/${txId}/restore`);
    expect((await detail(s, oc.id)).status).toBe('posted');
    await call(s, 'PATCH', `/transactions/${txId}`, { amountMinor: 230_000 });
    expect((await detail(s, oc.id)).postedAmountMinor).toBe(230_000);
  });

  it('bez konta płatności 422, nic nie zapisano', async () => {
    const s = await setup();
    const oc = await createOc(s, { accountId: null });
    expect((await call(s, 'POST', `/planned-expenses/${oc.id}/post`, {}, key())).statusCode).toBe(
      422,
    );
    const rows = s.app.db.db
      .select()
      .from(transactions)
      .where(eq(transactions.plannedExpenseId, oc.id))
      .all();
    expect(rows).toHaveLength(0);
  });
});

describe('statusy, defer, cancel, PATCH, DELETE', () => {
  it('termin w bieżącym miesiącu → `ready`; pokryty w całości → `ready`', async () => {
    const s = await setup();
    const now = await createOc(s, { dueMonth: '2026-09', dueOn: null });
    expect(now.status).toBe('ready');
    const covered = await createOc(s, { alreadySetAsideMinor: 240_000 });
    expect(covered.status).toBe('ready');
    const ready = await call(s, 'GET', '/planned-expenses?status=ready');
    expect(ready.json<{ data: PlannedExpenseDto[] }>().data).toHaveLength(2);
  });

  it('upływ czasu: marzec 2027 przychodzi — `ready` bez żadnego zapisu wydatku', async () => {
    const s = await setup();
    const oc = await createOc(s);
    await travelTo(s, '2027-03-02T10:00:00.000Z');
    expect((await detail(s, oc.id)).status).toBe('ready');
  });

  it('defer: nowy termin, rata przelicza się sama; w przeszłość 422', async () => {
    const s = await setup();
    const oc = await createOc(s, { dueMonth: '2026-10', dueOn: null });
    const deferred = await call(s, 'POST', `/planned-expenses/${oc.id}/defer`, {
      dueMonth: '2027-08',
    });
    expect(deferred.json<{ data: PlannedExpenseDto }>().data).toMatchObject({
      dueMonth: '2027-08',
      status: 'planned',
      setAside: { monthsLeft: 12, monthlyRequiredMinor: 20_000 },
    });
    expect(
      (await call(s, 'POST', `/planned-expenses/${oc.id}/defer`, { dueMonth: '2026-08' }))
        .statusCode,
    ).toBe(422);
  });

  it('cancel; potem wpłata, zapłata i edycja → 409', async () => {
    const s = await setup();
    const oc = await createOc(s);
    const cancelled = await call(s, 'POST', `/planned-expenses/${oc.id}/cancel`);
    expect(cancelled.json<{ data: PlannedExpenseDto }>().data.status).toBe('cancelled');
    expect(
      (await call(s, 'POST', `/planned-expenses/${oc.id}/set-aside`, {}, key())).statusCode,
    ).toBe(409);
    expect((await call(s, 'POST', `/planned-expenses/${oc.id}/post`, {}, key())).statusCode).toBe(
      409,
    );
    expect((await call(s, 'PATCH', `/planned-expenses/${oc.id}`, { name: 'Y' })).statusCode).toBe(
      409,
    );
    const all = await call(s, 'GET', '/planned-expenses');
    expect(all.json<{ data: PlannedExpenseDto[] }>().data).toHaveLength(0);
  });

  it('PATCH: korekta szacunku; termin przed startem przesuwa start (I-19)', async () => {
    const s = await setup();
    const oc = await createOc(s, { setAsideStartMonth: '2026-12' });
    const response = await call(s, 'PATCH', `/planned-expenses/${oc.id}`, {
      estimatedAmountMinor: 300_000,
      dueMonth: '2026-11',
      dueOn: null,
    });
    expect(response.json<{ data: PlannedExpenseDto }>().data).toMatchObject({
      estimatedAmountMinor: 300_000,
      setAside: { startMonth: '2026-11' },
    });
  });

  it('DELETE: wpłata zostaje w księdze bez powiązania; obce gospodarstwo 404', async () => {
    const s = await setup();
    const oc = await createOc(s);
    const paid = await call(s, 'POST', `/planned-expenses/${oc.id}/set-aside`, {}, key());
    const txId = paid.json<{ data: SetAsideResultDto }>().data.transaction.id;
    const other = await householdFixture(s.app.db, testConfig(), START);
    expect(
      (await call(s, 'DELETE', `/planned-expenses/${oc.id}`, undefined, {}, other)).statusCode,
    ).toBe(404);
    expect((await call(s, 'DELETE', `/planned-expenses/${oc.id}`)).statusCode).toBe(204);
    const row = s.app.db.db.select().from(transactions).where(eq(transactions.id, txId)).get();
    expect(row?.plannedExpenseId).toBeNull();
  });

  it('scalenie kategorii przepina wydatek (Z-13)', async () => {
    const s = await setup();
    const oc = await createOc(s);
    const target = insertCategory(s.app.db, s.home, { name: 'Samochód' });
    const merged = await call(s, 'POST', `/categories/${s.insurance}/merge`, {
      targetCategoryId: target,
    });
    expect(merged.statusCode, merged.body).toBe(200);
    expect((await detail(s, oc.id)).categoryId).toBe(target);
  });
});

describe('GET /upcoming i sekcja dashboardu (F6-5, F6-8)', () => {
  it('sumy horyzontu, rata łączna, obciążenie miesięcy i ostrzeżenia', async () => {
    const s = await setup();
    const oc = await createOc(s, { alreadySetAsideMinor: 80_000 });
    await createOc(s, {
      name: 'Przegląd',
      estimatedAmountMinor: 80_000,
      dueMonth: '2026-11',
      dueOn: null,
      priority: 'should',
      setAsideEnabled: false,
      setAsideAccountId: null,
      repeatsYearly: false,
    });
    await createOc(s, { name: 'Daleko', dueMonth: '2027-12', dueOn: null });

    const response = await call(s, 'GET', '/planned-expenses/upcoming?months=7');
    const { data, meta } = response.json<{
      data: PlannedExpenseDto[];
      meta: UpcomingExpensesMeta;
    }>();
    expect(data.map((item) => item.name)).toEqual(['Przegląd', 'OC + AC samochód']);
    expect(meta).toMatchObject({
      horizonMonths: 7,
      totalUpcomingMinor: 320_000,
      totalSetAsideMinor: 80_000,
      // OC 1 600 zł / 7 mies. = 228,58 zł + „Daleko" za horyzontem 2 400 zł / 16 mies. =
      // 150 zł: rata łączna liczy każdy wydatek z odkładaniem, nie tylko te w horyzoncie.
      monthlySetAsideRequiredMinor: 37_858,
      setAsidePaidThisMonthMinor: 0,
      byMonth: [
        { month: '2026-11', totalMinor: 80_000, coveredMinor: 0, shortfallMinor: 80_000 },
        { month: '2027-03', totalMinor: 240_000, coveredMinor: 80_000, shortfallMinor: 160_000 },
      ],
    });
    // 5 000 zł na ROR: przegląd 800 zł mieści się, OC (1 600 zł niepokryte) — też.
    expect(meta.liquidityWarnings).toEqual([]);
    expect(oc.id).toBeDefined();
  });

  it('za mało na koncie wydatkowym → INSUFFICIENT_PROJECTED_BALANCE z komunikatem', async () => {
    const s = await setup();
    await createOc(s, { estimatedAmountMinor: 700_000, dueMonth: '2026-11', dueOn: null });
    const response = await call(s, 'GET', '/planned-expenses/upcoming');
    const { meta } = response.json<{ meta: UpcomingExpensesMeta }>();
    expect(meta.liquidityWarnings).toEqual([
      {
        month: '2026-11',
        code: 'INSUFFICIENT_PROJECTED_BALANCE',
        plannedExpenseId: null,
        gapMinor: 200_000,
        message: `Listopad 2026: na planowane wydatki zabraknie ${formatMinor(200_000)}.`,
      },
    ]);
  });

  it('konieczny bez odkładania i odkładanie spóźnione', async () => {
    const s = await setup();
    await createOc(s, {
      name: 'Podatek',
      estimatedAmountMinor: 10_000,
      dueMonth: '2026-12',
      dueOn: null,
      setAsideEnabled: false,
      setAsideAccountId: null,
    });
    await createOc(s, {
      name: 'Opony',
      estimatedAmountMinor: 60_000,
      dueMonth: '2027-02',
      dueOn: null,
      priority: 'should',
    });
    await travelTo(s, '2026-12-05T10:00:00.000Z');
    const response = await call(s, 'GET', '/planned-expenses/upcoming');
    const codes = response
      .json<{ meta: UpcomingExpensesMeta }>()
      .meta.liquidityWarnings.map((warning) => [warning.code, warning.message]);
    expect(codes).toEqual([
      [
        'UNFUNDED_MUST_EXPENSE',
        `„Podatek” jest konieczny, a nic na niego nie odkładasz — brakuje ${formatMinor(10_000)}.`,
      ],
      [
        'SET_ASIDE_BEHIND', // Wrzesień–luty to 6 miesięcy; w grudniu minęły 3 → 300 zł, zebrane 0.
        `Odkładanie na „Opony” jest opóźnione o ${formatMinor(30_000)}.`,
      ],
    ]);
  });

  it('sekcja miesiąca: do zapłaty tylko w bieżącym; podgląd przyszłości bez zapisu', async () => {
    const s = await setup();
    await createOc(s, {
      name: 'Wymiana okien',
      dueMonth: '2026-09',
      dueOn: null,
      estimatedAmountMinor: 50_000,
    });
    await createOc(s);
    const september = await call(s, 'GET', '/months/2026-09/summary');
    const section = september.json<{ data: MonthSummaryDto }>().data.plannedExpenses;
    expect(section).toMatchObject({
      dueThisMonthMinor: 50_000,
      // OC (marzec 2027) jest poza sześcioma miesiącami od września.
      upcoming6MonthsMinor: 50_000,
      warningCount: 0,
    });
    expect(section.readyToPay.map((item) => item.name)).toEqual(['Wymiana okien']);
    // Skrót na kafel sięga za horyzont — OC też jest widoczne.
    expect(section.items.map((item) => item.name)).toEqual(['Wymiana okien', 'OC + AC samochód']);
    const october = await call(s, 'GET', '/months/2026-10/summary');
    expect(october.json<{ data: MonthSummaryDto }>().data.plannedExpenses.readyToPay).toEqual([]);
  });
});
