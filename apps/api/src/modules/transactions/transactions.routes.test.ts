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
  insertIncomeSource,
  insertLiability,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock, type MutableClock } from '../../core/clock.js';
import { households } from '../../db/schema/households.js';

/**
 * Testy tras transakcji: zapis, odczyt, edycja, kosz i niezmienniki I-1…I-8 — `F2-5`
 * ([04 §7](../../../../../../plans/04-api-spec.md#7-transakcje--apiv1transactions)).
 *
 * Lista, filtry i paginacja: `transactions.list.test.ts`.
 */

/** Transakcja w kształcie odpowiedzi. */
interface TxBody {
  id: string;
  type: string;
  status: string;
  bookedOn: string;
  monthKey: string;
  amountMinor: number;
  accountId: string | null;
  counterAccountId: string | null;
  categoryId: string | null;
  incomeSourceId: string | null;
  liabilityId: string | null;
  goalId: string | null;
  sourceAllocationClass: string | null;
  targetAllocationClass: string | null;
  allocationOverride: string | null;
  allocationEffects: { kind: string; amountMinor: number }[];
  description: string | null;
  merchant: string | null;
  notes: string | null;
  source: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  accountName?: string | null;
  counterAccountName?: string | null;
  categoryName?: string | null;
  categoryIcon?: string | null;
  categoryColor?: string | null;
  incomeSourceName?: string | null;
  goalName?: string | null;
  liabilityName?: string | null;
  createdByName?: string;
}

/** Odpowiedź zapisu. */
interface MutationBody {
  data: TxBody;
  meta: { affectedMonths: string[] };
}

/** Kształt odpowiedzi błędu. */
interface ErrorBody {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
}

const START = new Date('2026-09-23T10:00:00.000Z');
const BASE = '/api/v1/transactions';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Aplikacja z gospodarstwem i podstawowym zestawem kont i kategorii. */
interface Setup {
  app: TestApp;
  clock: MutableClock;
  home: HouseholdFixture;
  /** Konto bieżące (`spending`). */
  ror: string;
  /** Konto oszczędnościowe (`savings`). */
  savings: string;
  /** Rachunek maklerski (`investment`). */
  broker: string;
  /** Kategoria wydatków. */
  food: string;
  /** Kategoria przychodów. */
  salary: string;
  /** Źródło przychodu. */
  job: string;
}

/**
 * Buduje aplikację z gospodarstwem, trzema kontami, dwiema kategoriami i źródłem.
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
      name: 'Konto mieszkaniowe',
      type: 'savings',
      allocationClass: 'savings',
    }),
    broker: insertAccount(app.db, home, {
      name: 'Maklerskie',
      type: 'investment',
      allocationClass: 'investment',
    }),
    food: insertCategory(app.db, home, {
      name: 'Jedzenie',
      icon: 'utensils',
      color: '#a16207',
    }),
    salary: insertCategory(app.db, home, { name: 'Wynagrodzenie', kind: 'income' }),
    job: insertIncomeSource(app.db, home, { name: 'Pensja' }),
  };
}

/**
 * Wysyła żądanie w imieniu gospodarstwa.
 *
 * @param s - Środowisko testu.
 * @param method - Metoda HTTP.
 * @param url - Ścieżka względem `/api/v1/transactions`.
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
 * Zakłada transakcję i oczekuje `201`.
 *
 * @param s - Środowisko testu.
 * @param payload - Ciało; brakujące pola uzupełnia zwykły wydatek z ROR.
 * @returns Odpowiedź zapisu.
 */
async function create(s: Setup, payload: Record<string, unknown> = {}): Promise<MutationBody> {
  const response = await call(s, 'POST', '/', {
    type: 'expense',
    bookedOn: '2026-09-18',
    amountMinor: 12_799,
    accountId: s.ror,
    ...payload,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<MutationBody>();
}

/**
 * Wysyła `POST` i oczekuje błędu o danym statusie.
 *
 * @param s - Środowisko testu.
 * @param payload - Ciało (uzupełniane jak w {@link create}).
 * @param status - Oczekiwany status.
 * @returns Ciało błędu.
 */
async function rejected(
  s: Setup,
  payload: Record<string, unknown>,
  status: number,
): Promise<ErrorBody['error']> {
  const response = await call(s, 'POST', '/', {
    type: 'expense',
    bookedOn: '2026-09-18',
    amountMinor: 12_799,
    accountId: s.ror,
    ...payload,
  });
  expect(response.statusCode, response.body).toBe(status);
  return response.json<ErrorBody>().error;
}

describe('uwierzytelnienie', () => {
  it('każda trasa bez tokenu daje 401 — także z błędnym ciałem', async () => {
    const s = await setup();
    const id = insertTransaction(s.app.db, s.home);
    const routes: [string, string][] = [
      ['GET', '/'],
      ['POST', '/'],
      ['GET', `/${id}`],
      ['PATCH', `/${id}`],
      ['DELETE', `/${id}`],
      ['POST', `/${id}/restore`],
    ];
    for (const [method, url] of routes) {
      const response = await s.app.app.inject({
        method: method as 'GET',
        url: `${BASE}${url}`,
        headers: CSRF_HEADER,
        payload: method === 'GET' || method === 'DELETE' ? undefined : { amountMinor: 'x' },
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('POST /transactions — wydatek i przychód', () => {
  it('wydatek: 201, Location, I-1, status i źródło, autor z tokenu', async () => {
    const s = await setup();
    const response = await call(s, 'POST', '/', {
      type: 'expense',
      bookedOn: '2026-09-18',
      amountMinor: 12_799,
      accountId: s.ror,
      categoryId: s.food,
      description: 'Zakupy tygodniowe',
      merchant: 'Lidl',
      notes: null,
    });
    expect(response.statusCode).toBe(201);
    const { data, meta } = response.json<MutationBody>();
    expect(response.headers.location).toBe(`${BASE}/${data.id}`);
    expect(data).toMatchObject({
      type: 'expense',
      status: 'posted',
      source: 'manual',
      bookedOn: '2026-09-18',
      monthKey: '2026-09',
      amountMinor: 12_799,
      accountId: s.ror,
      counterAccountId: null,
      categoryId: s.food,
      sourceAllocationClass: null,
      targetAllocationClass: null,
      allocationEffects: [],
      merchant: 'Lidl',
      createdBy: s.home.userId,
      createdAt: START.getTime(),
      deletedAt: null,
    });
    expect(meta.affectedMonths).toEqual(['2026-09']);
  });

  it('przychód ze źródłem i kategorią przychodu', async () => {
    const s = await setup();
    const { data } = await create(s, {
      type: 'income',
      bookedOn: '2026-09-10',
      amountMinor: 980_000,
      incomeSourceId: s.job,
      categoryId: s.salary,
    });
    expect(data).toMatchObject({
      type: 'income',
      incomeSourceId: s.job,
      categoryId: s.salary,
      allocationEffects: [],
    });
  });

  it('pola tekstowe są przycinane, puste zapisywane jako brak', async () => {
    const s = await setup();
    const { data } = await create(s, { description: '  Chleb ', merchant: '  ' });
    expect(data.description).toBe('Chleb');
    expect(data.merchant).toBeNull();
  });

  it.each([
    ['kwota zero', { amountMinor: 0 }],
    ['kwota ujemna', { amountMinor: -5 }],
    ['kwota ułamkowa', { amountMinor: 1.5 }],
    ['nieistniejąca data', { bookedOn: '2026-02-31' }],
    ['brak konta', { accountId: undefined }],
    ['nieznany typ', { type: 'loan' }],
  ])('%s → 400', async (_label, payload) => {
    const s = await setup();
    const error = await rejected(s, payload, 400);
    expect(error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /transactions — przelewy i alokacje (I-5, I-6, I-7)', () => {
  it('bieżące → oszczędnościowe: migawki klas i efekt dodatni', async () => {
    const s = await setup();
    const { data } = await create(s, {
      type: 'transfer',
      amountMinor: 200_000,
      counterAccountId: s.savings,
      allocationOverride: null,
    });
    expect(data).toMatchObject({
      sourceAllocationClass: 'spending',
      targetAllocationClass: 'savings',
      allocationOverride: null,
      allocationEffects: [{ kind: 'savings', amountMinor: 200_000 }],
    });
  });

  it('oszczędnościowe → bieżące: efekt ujemny, nie zero (ADR-011)', async () => {
    const s = await setup();
    const { data } = await create(s, {
      type: 'transfer',
      amountMinor: 150_000,
      accountId: s.savings,
      counterAccountId: s.ror,
    });
    expect(data.allocationEffects).toEqual([{ kind: 'savings', amountMinor: -150_000 }]);
  });

  it('oszczędnościowe → maklerskie dotyka dwóch pul', async () => {
    const s = await setup();
    const { data } = await create(s, {
      type: 'transfer',
      amountMinor: 500_000,
      accountId: s.savings,
      counterAccountId: s.broker,
    });
    expect(data.allocationEffects).toEqual([
      { kind: 'investment', amountMinor: 500_000 },
      { kind: 'savings', amountMinor: -500_000 },
    ]);
  });

  it('I-7: przelew między kontami tej samej klasy jest neutralny', async () => {
    const s = await setup();
    const second = insertAccount(s.app.db, s.home, {
      name: 'Lokata',
      type: 'savings',
      allocationClass: 'savings',
    });
    const { data } = await create(s, {
      type: 'transfer',
      accountId: s.savings,
      counterAccountId: second,
    });
    expect(data.sourceAllocationClass).toBe('savings');
    expect(data.targetAllocationClass).toBe('savings');
    expect(data.allocationEffects).toEqual([]);
  });

  it('nadpisanie `none` wyłącza, nadpisanie puli wymusza', async () => {
    const s = await setup();
    const off = await create(s, {
      type: 'transfer',
      counterAccountId: s.savings,
      allocationOverride: 'none',
    });
    expect(off.data.allocationEffects).toEqual([]);

    const cash = insertAccount(s.app.db, s.home, { name: 'Gotówka', type: 'cash' });
    const forced = await create(s, {
      type: 'transfer',
      amountMinor: 30_000,
      counterAccountId: cash,
      allocationOverride: 'savings',
    });
    expect(forced.data.allocationEffects).toEqual([{ kind: 'savings', amountMinor: 30_000 }]);
  });

  it('I-6: zmiana klasy konta nie przepisuje migawki w zapisanej transakcji', async () => {
    const s = await setup();
    const { data } = await create(s, { type: 'transfer', counterAccountId: s.savings });

    const reclass = await s.app.app.inject({
      method: 'PATCH',
      url: `/api/v1/accounts/${s.savings}`,
      headers: s.home.headers,
      payload: { allocationClass: 'spending' },
    });
    expect(reclass.statusCode).toBe(200);

    const after = (await call(s, 'GET', `/${data.id}`)).json<{ data: TxBody }>().data;
    expect(after.targetAllocationClass).toBe('savings');
    expect(after.allocationEffects).toEqual([{ kind: 'savings', amountMinor: 12_799 }]);

    // Nowy przelew na to samo konto bierze już nową klasę.
    const fresh = await create(s, { type: 'transfer', counterAccountId: s.savings });
    expect(fresh.data.targetAllocationClass).toBe('spending');
    expect(fresh.data.allocationEffects).toEqual([]);
  });

  it('przelew może mieć kategorię przelewów, ale nie wydatków (I-4)', async () => {
    const s = await setup();
    const transferCategory = insertCategory(s.app.db, s.home, { kind: 'transfer' });
    await create(s, {
      type: 'transfer',
      counterAccountId: s.savings,
      categoryId: transferCategory,
    });
    const error = await rejected(
      s,
      { type: 'transfer', counterAccountId: s.savings, categoryId: s.food },
      422,
    );
    expect(error.message).toBe(
      'Kategoria „Jedzenie” nie pasuje do typu transakcji — wybierz kategorię przelewów.',
    );
  });
});

describe('POST /transactions — rata zobowiązania (07 §2.2a, I-7a)', () => {
  it('wydatek ze zobowiązaniem liczy się do spłaty długu', async () => {
    const s = await setup();
    const mortgage = insertLiability(s.app.db, s.home);
    const { data } = await create(s, { amountMinor: 250_000, liabilityId: mortgage });
    expect(data.allocationEffects).toEqual([{ kind: 'debt_repayment', amountMinor: 250_000 }]);
  });

  it('rata wyłączona przez `none` jest neutralna', async () => {
    const s = await setup();
    const mortgage = insertLiability(s.app.db, s.home);
    const { data } = await create(s, { liabilityId: mortgage, allocationOverride: 'none' });
    expect(data.allocationOverride).toBe('none');
    expect(data.allocationEffects).toEqual([]);
  });
});

describe('POST /transactions — niezmienniki kształtu dają 422, nie 400 (04 §2)', () => {
  it('I-2: przelew bez konta docelowego', async () => {
    const s = await setup();
    const error = await rejected(s, { type: 'transfer' }, 422);
    expect(error).toMatchObject({
      code: 'DOMAIN_RULE_VIOLATION',
      message: 'Przelew wymaga konta docelowego.',
      details: [{ path: 'counterAccountId', message: 'Przelew wymaga konta docelowego' }],
    });
  });

  it('I-2: przelew na to samo konto', async () => {
    const s = await setup();
    const error = await rejected(s, { type: 'transfer', counterAccountId: s.ror }, 422);
    expect(error.details?.[0]?.path).toBe('counterAccountId');
  });

  it.each(['expense', 'income'])('I-3: %s z kontem docelowym', async (type) => {
    const s = await setup();
    const error = await rejected(s, { type, counterAccountId: s.savings }, 422);
    expect(error.message).toBe('Konto docelowe dotyczy wyłącznie przelewów.');
  });

  it('I-7a: nadpisanie alokacji na zwykłym wydatku', async () => {
    const s = await setup();
    const error = await rejected(s, { allocationOverride: 'none' }, 422);
    expect(error.details?.[0]?.path).toBe('allocationOverride');
  });

  it('I-7a: rata może być tylko wyłączona, nie przypisana do puli', async () => {
    const s = await setup();
    const mortgage = insertLiability(s.app.db, s.home);
    await rejected(s, { liabilityId: mortgage, allocationOverride: 'savings' }, 422);
  });

  it('źródło przychodu przy wydatku', async () => {
    const s = await setup();
    const error = await rejected(s, { incomeSourceId: s.job }, 422);
    expect(error.details?.[0]?.path).toBe('incomeSourceId');
  });

  it('wszystkie problemy naraz w `details`', async () => {
    const s = await setup();
    const error = await rejected(
      s,
      { counterAccountId: s.savings, allocationOverride: 'savings', incomeSourceId: s.job },
      422,
    );
    expect(error.details?.map((detail) => detail.path)).toEqual([
      'counterAccountId',
      'allocationOverride',
      'incomeSourceId',
    ]);
  });
});

describe('POST /transactions — odwołania', () => {
  it('I-4: wydatek z kategorią przychodów', async () => {
    const s = await setup();
    const error = await rejected(s, { categoryId: s.salary }, 422);
    expect(error.message).toBe(
      'Kategoria „Wynagrodzenie” nie pasuje do typu transakcji — wybierz kategorię wydatków.',
    );
    expect(error.details).toEqual([{ path: 'categoryId', message: 'Kategoria innego rodzaju' }]);
  });

  it('I-4: przychód z kategorią wydatków', async () => {
    const s = await setup();
    await rejected(s, { type: 'income', categoryId: s.food }, 422);
  });

  it('konto, kategoria i źródło z archiwum → 422', async () => {
    const s = await setup();
    const oldAccount = insertAccount(s.app.db, s.home, { name: 'Stare', isArchived: true });
    const oldCategory = insertCategory(s.app.db, s.home, { name: 'Stara', isArchived: true });
    const oldSource = insertIncomeSource(s.app.db, s.home, { name: 'Stare', isArchived: true });

    expect((await rejected(s, { accountId: oldAccount }, 422)).message).toBe(
      'Konto „Stare” jest zarchiwizowane. Przywróć je, żeby na nim księgować.',
    );
    expect(
      (await rejected(s, { type: 'transfer', counterAccountId: oldAccount }, 422)).details?.[0]
        ?.path,
    ).toBe('counterAccountId');
    expect((await rejected(s, { categoryId: oldCategory }, 422)).details?.[0]?.path).toBe(
      'categoryId',
    );
    expect(
      (await rejected(s, { type: 'income', incomeSourceId: oldSource }, 422)).details?.[0]?.path,
    ).toBe('incomeSourceId');
  });

  it('byty innego gospodarstwa → 404 z polem w `details`', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const cases: [Record<string, unknown>, string][] = [
      [{ accountId: insertAccount(s.app.db, other) }, 'accountId'],
      [{ type: 'transfer', counterAccountId: insertAccount(s.app.db, other) }, 'counterAccountId'],
      [{ categoryId: insertCategory(s.app.db, other) }, 'categoryId'],
      [{ type: 'income', incomeSourceId: insertIncomeSource(s.app.db, other) }, 'incomeSourceId'],
      [{ goalId: insertGoal(s.app.db, other) }, 'goalId'],
      [{ liabilityId: insertLiability(s.app.db, other) }, 'liabilityId'],
    ];
    for (const [payload, path] of cases) {
      const error = await rejected(s, payload, 404);
      expect(error.details?.[0]?.path, path).toBe(path);
    }
  });

  it('cel i zobowiązanie z własnego gospodarstwa są przyjmowane', async () => {
    const s = await setup();
    const goal = insertGoal(s.app.db, s.home);
    const { data } = await create(s, {
      type: 'transfer',
      counterAccountId: s.savings,
      goalId: goal,
    });
    expect(data.goalId).toBe(goal);
  });
});

describe('POST /transactions — okno księgowania (I-8, 07 §1.3)', () => {
  it('limit 1: od 1 sierpnia do 30 września włącznie', async () => {
    const s = await setup();
    const august = await create(s, { bookedOn: '2026-08-01' });
    expect(august.data.monthKey).toBe('2026-08');
    expect(august.meta.affectedMonths).toEqual(['2026-08']);
    await create(s, { bookedOn: '2026-09-30' });
  });

  it('dzień przed oknem → 422 z komunikatem z 07 §1.3', async () => {
    const s = await setup();
    const error = await rejected(s, { bookedOn: '2026-07-31' }, 422);
    expect(error).toMatchObject({
      code: 'DOMAIN_RULE_VIOLATION',
      message: 'Nie można księgować przed 1 sierpnia 2026. Zmień limit w ustawieniach.',
      details: [{ path: 'bookedOn' }],
    });
  });

  it('dzień po końcu bieżącego miesiąca → 422', async () => {
    const s = await setup();
    const error = await rejected(s, { bookedOn: '2026-10-01' }, 422);
    expect(error.message).toContain('Nie można księgować po 30 września 2026');
  });

  it('„dziś" liczone w strefie gospodarstwa: 22:30 UTC ostatniego dnia to już nowy miesiąc', async () => {
    // 2026-09-30T22:30Z = 1 października 00:30 w Warszawie.
    const s = await setup(new Date('2026-09-30T22:30:00.000Z'));
    const october = await create(s, { bookedOn: '2026-10-01' });
    expect(october.data.monthKey).toBe('2026-10');
    await create(s, { bookedOn: '2026-09-01' });
    await rejected(s, { bookedOn: '2026-08-31' }, 422);
  });

  it('limit 0 z ustawień gospodarstwa: tylko bieżący miesiąc', async () => {
    const s = await setup();
    s.app.db.db
      .update(households)
      .set({ backPostingLimitMonths: 0 })
      .where(eq(households.id, s.home.householdId))
      .run();
    await rejected(s, { bookedOn: '2026-08-31' }, 422);
    await create(s, { bookedOn: '2026-09-01' });
  });
});

describe('GET /transactions/:id', () => {
  it('zwraca transakcję z nazwami powiązanych bytów', async () => {
    const s = await setup();
    const goal = insertGoal(s.app.db, s.home, 'Wkład własny');
    const transferCategory = insertCategory(s.app.db, s.home, {
      name: 'Oszczędzanie',
      kind: 'transfer',
    });
    const { data: transfer } = await create(s, {
      type: 'transfer',
      counterAccountId: s.savings,
      goalId: goal,
      categoryId: transferCategory,
    });
    const response = await call(s, 'GET', `/${transfer.id}`);
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: TxBody }>().data).toMatchObject({
      id: transfer.id,
      accountName: 'ROR',
      counterAccountName: 'Konto mieszkaniowe',
      categoryName: 'Oszczędzanie',
      goalName: 'Wkład własny',
      liabilityName: null,
      incomeSourceName: null,
      createdByName: 'Test',
    });

    const mortgage = insertLiability(s.app.db, s.home, 'Hipoteka');
    const { data: rate } = await create(s, { categoryId: s.food, liabilityId: mortgage });
    expect((await call(s, 'GET', `/${rate.id}`)).json<{ data: TxBody }>().data).toMatchObject({
      categoryName: 'Jedzenie',
      categoryIcon: 'utensils',
      categoryColor: '#a16207',
      liabilityName: 'Hipoteka',
      counterAccountName: null,
    });

    const { data: income } = await create(s, { type: 'income', incomeSourceId: s.job });
    expect(
      (await call(s, 'GET', `/${income.id}`)).json<{ data: TxBody }>().data.incomeSourceName,
    ).toBe('Pensja');
  });

  it('transakcja innego gospodarstwa i nieistniejąca → 404, zły identyfikator → 400', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = insertTransaction(s.app.db, other);
    expect((await call(s, 'GET', `/${foreign}`)).statusCode).toBe(404);
    expect((await call(s, 'GET', '/01JB0000000000000000000000')).statusCode).toBe(404);
    expect((await call(s, 'GET', '/nie-id')).statusCode).toBe(400);
  });
});

describe('PATCH /transactions/:id', () => {
  it('zmienia tylko przysłane pola i podbija `updatedAt`', async () => {
    const s = await setup();
    const { data } = await create(s, { categoryId: s.food, merchant: 'Lidl' });
    s.clock.advance(60_000);
    const response = await call(s, 'PATCH', `/${data.id}`, { amountMinor: 5_000 });
    expect(response.statusCode).toBe(200);
    const body = response.json<MutationBody>();
    expect(body.data).toMatchObject({
      amountMinor: 5_000,
      merchant: 'Lidl',
      categoryId: s.food,
      updatedAt: START.getTime() + 60_000,
      createdAt: START.getTime(),
    });
    expect(body.meta.affectedMonths).toEqual(['2026-09']);
  });

  it('puste albo niczego niezmieniające ciało nie rusza `updatedAt`', async () => {
    const s = await setup();
    const { data } = await create(s);
    s.clock.advance(60_000);
    for (const payload of [{}, { amountMinor: data.amountMinor }]) {
      const body = (await call(s, 'PATCH', `/${data.id}`, payload)).json<MutationBody>();
      expect(body.data.updatedAt).toBe(data.updatedAt);
    }
  });

  it('typ transakcji jest niezmienny — pole jest ignorowane', async () => {
    const s = await setup();
    const { data } = await create(s);
    const body = (await call(s, 'PATCH', `/${data.id}`, { type: 'income' })).json<MutationBody>();
    expect(body.data.type).toBe('expense');
  });

  it('`null` czyści pole opcjonalne', async () => {
    const s = await setup();
    const { data } = await create(s, { categoryId: s.food, description: 'Chleb' });
    const body = (
      await call(s, 'PATCH', `/${data.id}`, { categoryId: null, description: null })
    ).json<MutationBody>();
    expect(body.data.categoryId).toBeNull();
    expect(body.data.description).toBeNull();
  });

  it('I-1: zmiana daty przelicza miesiąc; oba miesiące do unieważnienia', async () => {
    const s = await setup();
    const { data } = await create(s, { bookedOn: '2026-09-02' });
    const body = (
      await call(s, 'PATCH', `/${data.id}`, { bookedOn: '2026-08-30' })
    ).json<MutationBody>();
    expect(body.data.monthKey).toBe('2026-08');
    expect(body.meta.affectedMonths).toEqual(['2026-08', '2026-09']);
  });

  it('I-8: nowa data poza oknem → 422', async () => {
    const s = await setup();
    const { data } = await create(s);
    const response = await call(s, 'PATCH', `/${data.id}`, { bookedOn: '2026-07-15' });
    expect(response.statusCode).toBe(422);
  });

  it('zamknięty miesiąc: opis, sprzedawcę i notatki wolno poprawić (07 §1.4)', async () => {
    const s = await setup();
    const old = insertTransaction(s.app.db, s.home, {
      accountId: s.ror,
      bookedOn: '2026-05-10',
      monthKey: '2026-05',
    });
    const response = await call(s, 'PATCH', `/${old}`, {
      description: 'Poprawka opisu',
      merchant: 'Lidl',
      notes: 'paragon w szufladzie',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<MutationBody>().meta.affectedMonths).toEqual(['2026-05']);
  });

  it('zamknięty miesiąc: zmiana liczb → 422 ze wskazaniem pól (ADR-040)', async () => {
    const s = await setup();
    const old = insertTransaction(s.app.db, s.home, {
      accountId: s.ror,
      bookedOn: '2026-07-31',
      monthKey: '2026-07',
    });
    const response = await call(s, 'PATCH', `/${old}`, {
      amountMinor: 5_000,
      categoryId: s.food,
      notes: 'ok',
    });
    expect(response.statusCode).toBe(422);
    const error = response.json<ErrorBody>().error;
    expect(error.message).toBe(
      'Transakcja należy do zamkniętego miesiąca — można poprawić tylko opis, sprzedawcę i notatki. Zmiany są możliwe od 1 sierpnia 2026 — zmień limit w ustawieniach.',
    );
    expect(error.details?.map((detail) => detail.path)).toEqual(['amountMinor', 'categoryId']);
    // Nic się nie zapisało — także dozwolona część żądania.
    const after = await call(s, 'GET', `/${old}`);
    expect(after.json<{ data: { notes: string | null } }>().data.notes).toBeNull();
  });

  it('zamknięty miesiąc: przeniesienie daty do okna też zmienia zamknięty miesiąc → 422', async () => {
    const s = await setup();
    const old = insertTransaction(s.app.db, s.home, {
      accountId: s.ror,
      bookedOn: '2026-07-31',
      monthKey: '2026-07',
    });
    const response = await call(s, 'PATCH', `/${old}`, { bookedOn: '2026-09-01' });
    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorBody>().error.details?.[0]?.path).toBe('bookedOn');
  });

  it('pierwszy dzień okna jest otwarty — 1 sierpnia da się zmienić', async () => {
    const s = await setup();
    const edge = insertTransaction(s.app.db, s.home, {
      accountId: s.ror,
      bookedOn: '2026-08-01',
      monthKey: '2026-08',
    });
    const response = await call(s, 'PATCH', `/${edge}`, { amountMinor: 7_777 });
    expect(response.statusCode).toBe(200);
  });

  it('kształt sprawdzany po scaleniu: przelew bez konta docelowego → 422', async () => {
    const s = await setup();
    const { data } = await create(s, { type: 'transfer', counterAccountId: s.savings });
    const response = await call(s, 'PATCH', `/${data.id}`, { counterAccountId: null });
    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorBody>().error.details?.[0]?.path).toBe('counterAccountId');

    const same = await call(s, 'PATCH', `/${data.id}`, { accountId: s.savings });
    expect(same.statusCode).toBe(422);
  });

  it('I-7a po scaleniu: zdjęcie zobowiązania z raty wyłączonej z rozliczenia → 422', async () => {
    const s = await setup();
    const mortgage = insertLiability(s.app.db, s.home);
    const { data } = await create(s, { liabilityId: mortgage, allocationOverride: 'none' });
    const response = await call(s, 'PATCH', `/${data.id}`, { liabilityId: null });
    expect(response.statusCode).toBe(422);
    const cleared = await call(s, 'PATCH', `/${data.id}`, {
      liabilityId: null,
      allocationOverride: null,
    });
    expect(cleared.statusCode).toBe(200);
  });

  it('zmiana konta w przelewie bierze migawkę z nowego konta, drugiej strony nie rusza', async () => {
    const s = await setup();
    const { data } = await create(s, {
      type: 'transfer',
      amountMinor: 100_000,
      counterAccountId: s.savings,
    });
    const body = (
      await call(s, 'PATCH', `/${data.id}`, { counterAccountId: s.broker })
    ).json<MutationBody>();
    expect(body.data).toMatchObject({
      sourceAllocationClass: 'spending',
      targetAllocationClass: 'investment',
      allocationEffects: [{ kind: 'investment', amountMinor: 100_000 }],
    });

    const swapped = (
      await call(s, 'PATCH', `/${data.id}`, { accountId: s.savings })
    ).json<MutationBody>();
    expect(swapped.data.sourceAllocationClass).toBe('savings');
    expect(swapped.data.targetAllocationClass).toBe('investment');
  });

  it('wydatek nie dostaje migawek przy zmianie konta (I-5)', async () => {
    const s = await setup();
    const { data } = await create(s);
    const body = (
      await call(s, 'PATCH', `/${data.id}`, { accountId: s.savings })
    ).json<MutationBody>();
    expect(body.data.sourceAllocationClass).toBeNull();
    expect(body.data.accountId).toBe(s.savings);
  });

  it('odwołania sprawdzane przy zmianie: zły rodzaj kategorii, archiwum, cudze konto', async () => {
    const s = await setup();
    const { data } = await create(s);
    expect((await call(s, 'PATCH', `/${data.id}`, { categoryId: s.salary })).statusCode).toBe(422);
    const archived = insertAccount(s.app.db, s.home, { isArchived: true });
    expect((await call(s, 'PATCH', `/${data.id}`, { accountId: archived })).statusCode).toBe(422);
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = insertAccount(s.app.db, other);
    expect((await call(s, 'PATCH', `/${data.id}`, { accountId: foreign })).statusCode).toBe(404);
  });

  it('transakcja na koncie zarchiwizowanym później wciąż daje się poprawić', async () => {
    const s = await setup();
    const { data } = await create(s);
    await s.app.app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${s.ror}/archive`,
      headers: s.home.headers,
    });
    expect(
      (await call(s, 'PATCH', `/${data.id}`, { notes: 'Paragon w szufladzie' })).statusCode,
    ).toBe(200);
  });

  it('transakcja w koszu → 409; innego gospodarstwa → 404', async () => {
    const s = await setup();
    const { data } = await create(s);
    await call(s, 'DELETE', `/${data.id}`);
    const response = await call(s, 'PATCH', `/${data.id}`, { amountMinor: 1 });
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.message).toBe(
      'Transakcja jest w koszu — przywróć ją, zanim ją zmienisz.',
    );

    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = insertTransaction(s.app.db, other);
    expect((await call(s, 'PATCH', `/${foreign}`, { amountMinor: 1 })).statusCode).toBe(404);
  });

  it('błędny typ pola → 400', async () => {
    const s = await setup();
    const { data } = await create(s);
    expect((await call(s, 'PATCH', `/${data.id}`, { amountMinor: 0 })).statusCode).toBe(400);
    expect((await call(s, 'PATCH', `/${data.id}`, { accountId: null })).statusCode).toBe(400);
  });
});

describe('kosz: DELETE i restore', () => {
  it('usunięcie jest miękkie i idempotentne; przywrócenie cofa je', async () => {
    const s = await setup();
    const { data } = await create(s);

    s.clock.advance(1_000);
    const deleted = await call(s, 'DELETE', `/${data.id}`);
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe('');
    expect((await call(s, 'DELETE', `/${data.id}`)).statusCode).toBe(204);

    const inBin = (await call(s, 'GET', `/${data.id}`)).json<{ data: TxBody }>().data;
    expect(inBin.deletedAt).toBe(START.getTime() + 1_000);

    const restored = await call(s, 'POST', `/${data.id}/restore`);
    expect(restored.statusCode).toBe(200);
    const body = restored.json<MutationBody>();
    expect(body.data.deletedAt).toBeNull();
    expect(body.meta.affectedMonths).toEqual(['2026-09']);

    const again = await call(s, 'POST', `/${data.id}/restore`);
    expect(again.statusCode).toBe(200);
    expect(again.json<MutationBody>().data.updatedAt).toBe(body.data.updatedAt);
  });

  it('transakcja w koszu nie wpływa na saldo konta, przywrócona — znowu wpływa', async () => {
    const s = await setup();
    const { data } = await create(s, { amountMinor: 10_000 });

    /**
     * Odczytuje saldo ROR.
     *
     * @returns Saldo w groszach.
     */
    const balance = async (): Promise<number> =>
      (
        await s.app.app.inject({
          method: 'GET',
          url: `/api/v1/accounts/${s.ror}`,
          headers: s.home.headers,
        })
      ).json<{ data: { balanceMinor: number } }>().data.balanceMinor;

    expect(await balance()).toBe(-10_000);
    await call(s, 'DELETE', `/${data.id}`);
    expect(await balance()).toBe(0);
    await call(s, 'POST', `/${data.id}/restore`);
    expect(await balance()).toBe(-10_000);
  });

  it('konto z transakcją w koszu nadal nie daje się usunąć (I-10)', async () => {
    const s = await setup();
    const { data } = await create(s);
    await call(s, 'DELETE', `/${data.id}`);
    const response = await s.app.app.inject({
      method: 'DELETE',
      url: `/api/v1/accounts/${s.ror}`,
      headers: s.home.headers,
    });
    expect(response.statusCode).toBe(409);
  });

  it('zamknięty miesiąc: nie da się usunąć ani przywrócić (07 §1.4)', async () => {
    const s = await setup();
    const live = insertTransaction(s.app.db, s.home, {
      accountId: s.ror,
      bookedOn: '2026-06-15',
      monthKey: '2026-06',
    });
    const binned = insertTransaction(s.app.db, s.home, {
      accountId: s.ror,
      bookedOn: '2026-06-16',
      monthKey: '2026-06',
      deletedAt: START.getTime(),
    });

    const deleted = await call(s, 'DELETE', `/${live}`);
    expect(deleted.statusCode).toBe(422);
    expect(deleted.json<ErrorBody>().error.message).toMatch(
      /^Nie można usunąć transakcji z zamkniętego miesiąca/,
    );
    const restored = await call(s, 'POST', `/${binned}/restore`);
    expect(restored.statusCode).toBe(422);
    expect(restored.json<ErrorBody>().error.message).toMatch(/^Nie można przywrócić/);

    // Operacje bez skutku zostają idempotentne: ponowne usunięcie usuniętej nie jest błędem.
    expect((await call(s, 'DELETE', `/${binned}`)).statusCode).toBe(204);
    expect((await call(s, 'POST', `/${live}/restore`)).statusCode).toBe(200);
  });

  it('transakcja innego gospodarstwa → 404 w obu trasach', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = insertTransaction(s.app.db, other);
    expect((await call(s, 'DELETE', `/${foreign}`)).statusCode).toBe(404);
    expect((await call(s, 'POST', `/${foreign}/restore`)).statusCode).toBe(404);
  });
});

describe('salda liczą transakcje zapisane przez API (07 §7)', () => {
  it('wydatek, przychód i przelew przesuwają salda obu kont', async () => {
    const s = await setup();
    await create(s, { type: 'income', amountMinor: 500_000 });
    await create(s, { amountMinor: 20_000 });
    await create(s, { type: 'transfer', amountMinor: 100_000, counterAccountId: s.savings });

    const response = await s.app.app.inject({
      method: 'GET',
      url: '/api/v1/accounts/balances?month=2026-09',
      headers: s.home.headers,
    });
    const balances = response
      .json<{ data: { accountId: string; balanceMinor: number }[] }>()
      .data.map((row) => [row.accountId, row.balanceMinor]);
    expect(Object.fromEntries(balances)).toEqual({
      [s.ror]: 380_000,
      [s.savings]: 100_000,
      [s.broker]: 0,
    });
  });
});
