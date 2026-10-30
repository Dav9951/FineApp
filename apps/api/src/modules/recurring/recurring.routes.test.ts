import type { RecurringRuleDetailDto, RecurringRuleDto } from '@fineapp/shared';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertAccount,
  insertCategory,
  insertIncomeSource,
  insertLiability,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock, type MutableClock } from '../../core/clock.js';
import { accounts } from '../../db/schema/accounts.js';
import { recurringRules } from '../../db/schema/recurring.js';

/**
 * Testy tras reguł cyklicznych — zadanie `F4-1`
 * ([04 §9](../../../../../../plans/04-api-spec.md#9-pozycje-cykliczne--apiv1recurring),
 * [07 §6](../../../../../../plans/07-domain-rules.md#6-pozycje-cykliczne)).
 */

/** 23 września 2026, 12:00 w Warszawie. */
const START = new Date('2026-09-23T10:00:00.000Z');
const BASE = '/api/v1/recurring';

let harness: TestApp | undefined;

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
  rent: string;
  salary: string;
  job: string;
}

/** Kształt błędu. */
interface ErrorBody {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
}

/**
 * Aplikacja z gospodarstwem, dwoma kontami, kategoriami i źródłem.
 *
 * @param start - Chwila startowa zegara.
 * @returns Środowisko testu.
 */
async function setup(start: Date = START): Promise<Setup> {
  const clock = mutableClock(start);
  const app = await buildTestApp({}, clock);
  harness = app;
  const home = await householdFixture(app.db, testConfig(), start);
  return {
    app,
    clock,
    home,
    ror: insertAccount(app.db, home, { name: 'ROR' }),
    savings: insertAccount(app.db, home, {
      name: 'Oszczędności',
      type: 'savings',
      allocationClass: 'savings',
    }),
    rent: insertCategory(app.db, home, { name: 'Czynsz' }),
    salary: insertCategory(app.db, home, { name: 'Wynagrodzenie', kind: 'income' }),
    job: insertIncomeSource(app.db, home, { name: 'Pensja' }),
  };
}

/**
 * Wysyła żądanie w imieniu gospodarstwa.
 *
 * @param s - Środowisko.
 * @param method - Metoda.
 * @param url - Ścieżka względem `/recurring`.
 * @param payload - Ciało.
 * @param home - Gospodarstwo.
 * @returns Odpowiedź.
 */
function call(
  s: Setup,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
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
 * Ciało nowej reguły: czynsz 10. dnia każdego miesiąca od października.
 *
 * @param s - Środowisko.
 * @param overrides - Nadpisane pola.
 * @returns Ciało żądania.
 */
function rentRule(s: Setup, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Czynsz',
    flow: 'expense',
    amountMinor: 185_000,
    accountId: s.ror,
    categoryId: s.rent,
    frequency: 'monthly',
    dayOfMonth: 10,
    startMonth: '2026-10',
    isFixedExpense: true,
    ...overrides,
  };
}

/**
 * Zakłada regułę i oczekuje `201`.
 *
 * @param s - Środowisko.
 * @param overrides - Nadpisane pola.
 * @returns Reguła.
 */
async function create(
  s: Setup,
  overrides: Record<string, unknown> = {},
): Promise<RecurringRuleDto> {
  const response = await call(s, 'POST', '/rules', rentRule(s, overrides));
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: RecurringRuleDto }>().data;
}

/**
 * Wysyła `POST` i oczekuje błędu.
 *
 * @param s - Środowisko.
 * @param overrides - Nadpisane pola.
 * @param status - Oczekiwany status.
 * @returns Błąd.
 */
async function rejected(
  s: Setup,
  overrides: Record<string, unknown>,
  status: number,
): Promise<ErrorBody['error']> {
  const response = await call(s, 'POST', '/rules', rentRule(s, overrides));
  expect(response.statusCode, response.body).toBe(status);
  return response.json<ErrorBody>().error;
}

describe('uwierzytelnienie', () => {
  it('każda trasa bez tokenu daje 401', async () => {
    const s = await setup();
    const id = '01J9ZQK8WQ0000000000000000';
    const routes: ['GET' | 'POST' | 'PATCH' | 'DELETE', string][] = [
      ['GET', '/rules'],
      ['POST', '/rules'],
      ['GET', `/rules/${id}`],
      ['PATCH', `/rules/${id}`],
      ['DELETE', `/rules/${id}`],
      ['POST', `/rules/${id}/pause`],
      ['POST', `/rules/${id}/resume`],
    ];
    for (const [method, url] of routes) {
      const response = await s.app.app.inject({
        method,
        url: `${BASE}${url}`,
        headers: { 'x-requested-with': 'fineapp' },
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('POST /recurring/rules', () => {
  it('zakłada regułę: 201, Location, wartości domyślne i najbliższy termin', async () => {
    const s = await setup();
    const response = await call(s, 'POST', '/rules', rentRule(s));
    expect(response.statusCode, response.body).toBe(201);
    const { data } = response.json<{ data: RecurringRuleDto }>();
    expect(response.headers.location).toBe(`${BASE}/rules/${data.id}`);
    expect(data).toMatchObject({
      name: 'Czynsz',
      flow: 'expense',
      amountIsEstimate: false,
      intervalCount: 1,
      weekday: null,
      monthOfYear: null,
      anchorDate: '2026-10-01',
      endMonth: null,
      autoPost: false,
      isFixedExpense: true,
      isActive: true,
      notes: null,
      nextDueOn: '2026-10-10',
    });
  });

  it('przykład z 04 §9: przelew na IKE z celem', async () => {
    const s = await setup();
    const data = await create(s, {
      name: 'Wpłata na IKE',
      flow: 'transfer',
      amountMinor: 100_000,
      counterAccountId: s.savings,
      categoryId: null,
      dayOfMonth: 5,
      autoPost: true,
    });
    expect(data).toMatchObject({ flow: 'transfer', counterAccountId: s.savings, autoPost: true });
  });

  it('co dwa tygodnie bez kotwicy — pierwszy piątek miesiąca startu; pola bez znaczenia czyszczone', async () => {
    const s = await setup();
    const data = await create(s, { frequency: 'biweekly', weekday: 5, dayOfMonth: 10 });
    expect(data).toMatchObject({ anchorDate: '2026-10-02', dayOfMonth: null, weekday: 5 });
    expect(data.nextDueOn).toBe('2026-10-02');
  });

  it('kształt jak transakcja: 422 z polami w `details`', async () => {
    const s = await setup();
    const transfer = await rejected(s, { flow: 'transfer', categoryId: null }, 422);
    expect(transfer.code).toBe('DOMAIN_RULE_VIOLATION');
    expect(transfer.details?.map((detail) => detail.path)).toEqual(['counterAccountId']);

    const source = await rejected(s, { incomeSourceId: s.job }, 422);
    expect(source.details?.[0]?.path).toBe('incomeSourceId');
  });

  it('terminarz: brak dnia, koniec przed startem, „co N" mniej niż 2 → 422', async () => {
    const s = await setup();
    expect((await rejected(s, { dayOfMonth: null }, 422)).details?.[0]?.path).toBe('dayOfMonth');
    expect((await rejected(s, { endMonth: '2026-09' }, 422)).details?.[0]?.path).toBe('endMonth');
    expect(
      (await rejected(s, { frequency: 'every_n_months', intervalCount: 1 }, 422)).details?.[0]
        ?.path,
    ).toBe('intervalCount');
    expect(
      (await rejected(s, { frequency: 'yearly' }, 422)).details?.map((detail) => detail.path),
    ).toEqual(['monthOfYear']);
  });

  it('odwołania: cudze konto → 404, kategoria innego rodzaju i archiwum → 422', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = insertAccount(s.app.db, other);
    expect((await rejected(s, { accountId: foreign }, 404)).details?.[0]?.path).toBe('accountId');

    expect((await rejected(s, { categoryId: s.salary }, 422)).message).toContain(
      'nie pasuje do typu',
    );
    const archived = insertAccount(s.app.db, s.home, { name: 'Stare', isArchived: true });
    expect((await rejected(s, { accountId: archived }, 422)).details?.[0]?.path).toBe('accountId');
  });

  it('rata zobowiązania: zobowiązanie spoza gospodarstwa → 404', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const loan = insertLiability(s.app.db, other);
    expect((await rejected(s, { liabilityId: loan }, 404)).details?.[0]?.path).toBe('liabilityId');
    const mine = insertLiability(s.app.db, s.home);
    await create(s, { liabilityId: mine });
  });

  it('błąd typu danych → 400 przed regułami domeny', async () => {
    const s = await setup();
    await rejected(s, { amountMinor: 0 }, 400);
    await rejected(s, { frequency: 'daily' }, 400);
  });
});

describe('GET /recurring/rules', () => {
  it('filtry i kolejność: aktywne przed wstrzymanymi, potem po nazwie', async () => {
    const s = await setup();
    await create(s, { name: 'Woda' });
    const netflix = await create(s, { name: 'Netflix', isFixedExpense: false });
    await create(s, {
      name: 'Pensja',
      flow: 'income',
      categoryId: s.salary,
      incomeSourceId: s.job,
      isFixedExpense: false,
    });
    await call(s, 'POST', `/rules/${netflix.id}/pause`);

    const names = async (query = ''): Promise<string[]> =>
      (await call(s, 'GET', `/rules${query}`))
        .json<{ data: RecurringRuleDto[] }>()
        .data.map((rule) => rule.name);
    expect(await names()).toEqual(['Pensja', 'Woda', 'Netflix']);
    expect(await names('?flow=income')).toEqual(['Pensja']);
    expect(await names('?isFixedExpense=true')).toEqual(['Woda']);
    expect(await names('?isActive=false')).toEqual(['Netflix']);
    expect((await call(s, 'GET', '/rules?isActive=nie')).statusCode).toBe(400);
  });

  it('nie pokazuje reguł innego gospodarstwa', async () => {
    const s = await setup();
    await create(s);
    const other = await householdFixture(s.app.db, testConfig(), START);
    const response = await call(s, 'GET', '/rules', undefined, other);
    expect(response.json<{ data: unknown[] }>().data).toEqual([]);
  });
});

describe('GET /recurring/rules/:id', () => {
  it('najbliższe terminy z przycięciem dnia — 31. w listopadzie to 30.', async () => {
    const s = await setup();
    const rule = await create(s, { dayOfMonth: 31 });
    const { data } = (await call(s, 'GET', `/rules/${rule.id}`)).json<{
      data: RecurringRuleDetailDto;
    }>();
    expect(data.upcomingDueDates).toEqual([
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
    expect(data.nextDueOn).toBe('2026-10-31');
  });

  it('najbliższy termin liczony od dziś w strefie gospodarstwa', async () => {
    const noon = await create(await setup(), { startMonth: '2026-09', dayOfMonth: 23 });
    expect(noon.nextDueOn).toBe('2026-09-23');
    await harness?.close();
    // 23 września 22:30 UTC to już 24 września w Warszawie — wrześniowy termin minął.
    const late = await setup(new Date('2026-09-23T22:30:00.000Z'));
    const rule = await create(late, { startMonth: '2026-09', dayOfMonth: 23 });
    expect(rule.nextDueOn).toBe('2026-10-23');
  });

  it('wstrzymana i zakończona — bez terminów', async () => {
    const s = await setup();
    const ended = await create(s, { startMonth: '2026-01', endMonth: '2026-08' });
    expect(ended.nextDueOn).toBeNull();
    const paused = await create(s);
    await call(s, 'POST', `/rules/${paused.id}/pause`);
    const { data } = (await call(s, 'GET', `/rules/${paused.id}`)).json<{
      data: RecurringRuleDetailDto;
    }>();
    expect(data).toMatchObject({ isActive: false, nextDueOn: null, upcomingDueDates: [] });
  });

  it('reguła innego gospodarstwa → 404', async () => {
    const s = await setup();
    const rule = await create(s);
    const other = await householdFixture(s.app.db, testConfig(), START);
    expect((await call(s, 'GET', `/rules/${rule.id}`, undefined, other)).statusCode).toBe(404);
  });
});

describe('PATCH /recurring/rules/:id', () => {
  it('zmienia kwotę; `flow` jest niezmienny; `null` czyści notatkę', async () => {
    const s = await setup();
    const rule = await create(s, { notes: 'umowa do 2027' });
    s.clock.advance(1_000);
    const response = await call(s, 'PATCH', `/rules/${rule.id}`, {
      amountMinor: 190_000,
      flow: 'income',
      notes: null,
    });
    expect(response.statusCode, response.body).toBe(200);
    const { data } = response.json<{ data: RecurringRuleDto }>();
    expect(data).toMatchObject({ amountMinor: 190_000, flow: 'expense', notes: null });
    expect(data.updatedAt).toBe(START.getTime() + 1_000);
  });

  it('puste ciało i te same wartości nie ruszają `updatedAt`', async () => {
    const s = await setup();
    const rule = await create(s);
    s.clock.advance(1_000);
    for (const body of [{}, { amountMinor: 185_000 }]) {
      const { data } = (await call(s, 'PATCH', `/rules/${rule.id}`, body)).json<{
        data: RecurringRuleDto;
      }>();
      expect(data.updatedAt).toBe(rule.updatedAt);
    }
  });

  it('zmiana na co dwa tygodnie wylicza kotwicę i czyści dzień miesiąca', async () => {
    const s = await setup();
    const rule = await create(s);
    const { data } = (
      await call(s, 'PATCH', `/rules/${rule.id}`, { frequency: 'biweekly', weekday: 1 })
    ).json<{ data: RecurringRuleDto }>();
    expect(data).toMatchObject({ dayOfMonth: null, weekday: 1, anchorDate: '2026-10-05' });
  });

  it('kształt po scaleniu: przelew bez konta docelowego → 422, nic nie zapisane', async () => {
    const s = await setup();
    const rule = await create(s, {
      flow: 'transfer',
      counterAccountId: s.savings,
      categoryId: null,
    });
    const response = await call(s, 'PATCH', `/rules/${rule.id}`, {
      counterAccountId: null,
      amountMinor: 1,
    });
    expect(response.statusCode).toBe(422);
    const row = s.app.db.db
      .select()
      .from(recurringRules)
      .where(eq(recurringRules.id, rule.id))
      .get();
    expect(row?.amountMinor).toBe(185_000);
  });

  it('nowe odwołanie sprawdzane: kategoria przychodów przy wydatku → 422', async () => {
    const s = await setup();
    const rule = await create(s);
    expect((await call(s, 'PATCH', `/rules/${rule.id}`, { categoryId: s.salary })).statusCode).toBe(
      422,
    );
  });

  it('odwołanie niezmienione nie jest sprawdzane ponownie — konto zarchiwizowane później', async () => {
    const s = await setup();
    const rule = await create(s);
    s.app.db.db.update(accounts).set({ isArchived: true }).where(eq(accounts.id, s.ror)).run();
    expect((await call(s, 'PATCH', `/rules/${rule.id}`, { amountMinor: 1 })).statusCode).toBe(200);
  });
});

describe('pause / resume / DELETE', () => {
  it('wstrzymanie i wznowienie są idempotentne', async () => {
    const s = await setup();
    const rule = await create(s);
    for (const [action, expected] of [
      ['pause', false],
      ['pause', false],
      ['resume', true],
      ['resume', true],
    ] as const) {
      const response = await call(s, 'POST', `/rules/${rule.id}/${action}`);
      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: RecurringRuleDto }>().data.isActive).toBe(expected);
    }
  });

  it('usunięcie: 204, potem 404; cudza reguła → 404', async () => {
    const s = await setup();
    const rule = await create(s);
    const other = await householdFixture(s.app.db, testConfig(), START);
    expect((await call(s, 'DELETE', `/rules/${rule.id}`, undefined, other)).statusCode).toBe(404);
    expect((await call(s, 'DELETE', `/rules/${rule.id}`)).statusCode).toBe(204);
    expect((await call(s, 'DELETE', `/rules/${rule.id}`)).statusCode).toBe(404);
  });
});

describe('scalanie kategorii przepina reguły (07 §9.3, Z-13)', () => {
  it('reguła z kategorią źródłową wskazuje po scaleniu docelową', async () => {
    const s = await setup();
    const housing = insertCategory(s.app.db, s.home, { name: 'Mieszkanie' });
    const rule = await create(s);
    const merge = await s.app.app.inject({
      method: 'POST',
      url: `/api/v1/categories/${s.rent}/merge`,
      headers: s.home.headers,
      payload: { targetCategoryId: housing },
    });
    expect(merge.statusCode, merge.body).toBe(200);
    const { data } = (await call(s, 'GET', `/rules/${rule.id}`)).json<{
      data: RecurringRuleDetailDto;
    }>();
    expect(data.categoryId).toBe(housing);
  });
});

describe('konto reguły usunięte albo zarchiwizowane — reguła wstrzymana (Z-28, ADR-044)', () => {
  /**
   * Wysyła żądanie do tras kont.
   *
   * @param s - Środowisko.
   * @param method - Metoda.
   * @param url - Ścieżka względem `/accounts`.
   * @returns Odpowiedź.
   */
  function accountCall(
    s: Setup,
    method: 'POST' | 'DELETE',
    url: string,
  ): Promise<LightMyRequestResponse> {
    return s.app.app.inject({ method, url: `/api/v1/accounts${url}`, headers: s.home.headers });
  }

  /**
   * Czyta regułę.
   *
   * @param s - Środowisko.
   * @param id - Identyfikator reguły.
   * @returns Reguła.
   */
  async function ruleOf(s: Setup, id: string): Promise<RecurringRuleDetailDto> {
    return (await call(s, 'GET', `/rules/${id}`)).json<{ data: RecurringRuleDetailDto }>().data;
  }

  it('usunięcie konta docelowego przelewu wstrzymuje regułę; reguły na innych kontach nietknięte', async () => {
    const s = await setup();
    const spare = insertAccount(s.app.db, s.home, {
      name: 'Nowe oszczędności',
      type: 'savings',
      allocationClass: 'savings',
    });
    const transfer = await create(s, {
      flow: 'transfer',
      counterAccountId: spare,
      categoryId: null,
    });
    const rent = await create(s);

    expect((await accountCall(s, 'DELETE', `/${spare}`)).statusCode).toBe(204);
    expect(await ruleOf(s, transfer.id)).toMatchObject({
      isActive: false,
      counterAccountId: null,
      nextDueOn: null,
    });
    expect((await ruleOf(s, rent.id)).isActive).toBe(true);
  });

  it('nieudane usunięcie (konto ma transakcje) nie wstrzymuje reguły', async () => {
    const s = await setup();
    const rent = await create(s);
    insertTransaction(s.app.db, s.home, { accountId: s.ror });
    expect((await accountCall(s, 'DELETE', `/${s.ror}`)).statusCode).toBe(409);
    expect((await ruleOf(s, rent.id)).isActive).toBe(true);
  });

  it('archiwizacja konta wstrzymuje regułę; przywrócenie konta jej nie wznawia', async () => {
    const s = await setup();
    const rent = await create(s);
    expect((await accountCall(s, 'POST', `/${s.ror}/archive`)).statusCode).toBe(200);
    expect(await ruleOf(s, rent.id)).toMatchObject({ isActive: false, accountId: s.ror });
    expect((await accountCall(s, 'POST', `/${s.ror}/unarchive`)).statusCode).toBe(200);
    expect((await ruleOf(s, rent.id)).isActive).toBe(false);
  });

  it('usunięcie kategorii reguły tylko czyści pole — reguła działa dalej', async () => {
    const s = await setup();
    const extra = insertCategory(s.app.db, s.home, { name: 'Abonamenty' });
    const rule = await create(s, { categoryId: extra });
    const response = await s.app.app.inject({
      method: 'DELETE',
      url: `/api/v1/categories/${extra}`,
      headers: s.home.headers,
    });
    expect(response.statusCode, response.body).toBe(204);
    expect(await ruleOf(s, rule.id)).toMatchObject({ isActive: true, categoryId: null });
  });
});
