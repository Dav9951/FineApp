import type {
  LiabilityDetailDto,
  LiabilityDto,
  LiabilityPaymentResultDto,
  RecurringOccurrenceDto,
  RecurringRuleDto,
  ScheduledInstallmentDto,
  TransactionMutationMeta,
} from '@fineapp/shared';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertAccount,
  insertCategory,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';
import { accounts } from '../../db/schema/accounts.js';
import { transactions } from '../../db/schema/transactions.js';

/**
 * Testy tras zobowiązań — zadanie `F4-4`
 * ([04 §8](../../../../../../plans/04-api-spec.md#8-zobowiązania--apiv1liabilities),
 * [07 §5](../../../../../../plans/07-domain-rules.md#5-zobowiązania), ADR-047).
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
  mortgage: string;
  salary: string;
}

/** Kształt błędu. */
interface ErrorBody {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
}

/** Wynik zaksięgowania raty. */
interface PaymentBody {
  data: LiabilityPaymentResultDto;
  meta: TransactionMutationMeta;
}

/**
 * Aplikacja z gospodarstwem, kontem, kategorią raty i kategorią przychodu.
 *
 * @returns Środowisko testu.
 */
async function setup(): Promise<Setup> {
  const app = await buildTestApp({}, mutableClock(START));
  harness = app;
  const home = await householdFixture(app.db, testConfig(), START);
  return {
    app,
    home,
    ror: insertAccount(app.db, home, { name: 'ROR' }),
    mortgage: insertCategory(app.db, home, { name: 'Rata kredytu' }),
    salary: insertCategory(app.db, home, { name: 'Pensja', kind: 'income' }),
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
 * Ciało zobowiązania: telefon na raty, 2 500 zł na 23 września, rata 500 zł 20. dnia.
 *
 * @param s - Środowisko.
 * @param overrides - Nadpisane pola.
 * @returns Ciało żądania.
 */
function phone(s: Setup, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Telefon na raty',
    kind: 'installment',
    creditor: 'Play',
    openingBalanceMinor: 250_000,
    balanceAsOf: '2026-09-01',
    monthlyPaymentMinor: 50_000,
    paymentDay: 20,
    paymentAccountId: s.ror,
    categoryId: s.mortgage,
    ...overrides,
  };
}

/**
 * Zakłada zobowiązanie i oczekuje `201`.
 *
 * @param s - Środowisko.
 * @param overrides - Nadpisane pola.
 * @returns Zobowiązanie.
 */
async function create(s: Setup, overrides: Record<string, unknown> = {}): Promise<LiabilityDto> {
  const response = await call(s, 'POST', '/liabilities', phone(s, overrides));
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: LiabilityDto }>().data;
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
  const response = await call(s, 'POST', '/liabilities', phone(s, overrides));
  expect(response.statusCode, response.body).toBe(status);
  return response.json<ErrorBody>().error;
}

/**
 * Szczegóły zobowiązania.
 *
 * @param s - Środowisko.
 * @param id - Identyfikator.
 * @returns Szczegóły.
 */
async function detail(s: Setup, id: string): Promise<LiabilityDetailDto> {
  const response = await call(s, 'GET', `/liabilities/${id}`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ data: LiabilityDetailDto }>().data;
}

/**
 * Księguje ratę z nowym kluczem idempotencji.
 *
 * @param s - Środowisko.
 * @param id - Zobowiązanie.
 * @param payload - Ciało.
 * @param key - Klucz.
 * @returns Odpowiedź.
 */
function pay(
  s: Setup,
  id: string,
  payload: Record<string, unknown> = {},
  key?: string,
): Promise<LightMyRequestResponse> {
  keyCounter += 1;
  return call(s, 'POST', `/liabilities/${id}/payments`, payload, {
    'idempotency-key': key ?? `liability-key-${String(keyCounter).padStart(4, '0')}`,
  });
}

/**
 * Liczba transakcji gospodarstwa w bazie.
 *
 * @param s - Środowisko.
 * @returns Liczba wierszy.
 */
function transactionCount(s: Setup): number {
  return s.app.db.db
    .select()
    .from(transactions)
    .where(eq(transactions.householdId, s.home.householdId))
    .all().length;
}

describe('uwierzytelnienie', () => {
  it('każda trasa bez tokenu daje 401', async () => {
    const s = await setup();
    const id = '01J9ZQK8WQ0000000000000000';
    const routes: ['GET' | 'POST' | 'PATCH' | 'DELETE', string][] = [
      ['GET', ''],
      ['POST', ''],
      ['GET', `/${id}`],
      ['PATCH', `/${id}`],
      ['DELETE', `/${id}`],
      ['GET', `/${id}/schedule`],
      ['POST', `/${id}/rebase`],
      ['POST', `/${id}/payments`],
    ];
    for (const [method, url] of routes) {
      const response = await s.app.app.inject({
        method,
        url: `/api/v1/liabilities${url}`,
        headers: { 'x-requested-with': 'fineapp' },
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('POST /liabilities', () => {
  it('zakłada: 201, Location, stan wyliczony', async () => {
    const s = await setup();
    const response = await call(s, 'POST', '/liabilities', phone(s));
    expect(response.statusCode, response.body).toBe(201);
    const { data } = response.json<{ data: LiabilityDto }>();
    expect(response.headers.location).toBe(`/api/v1/liabilities/${data.id}`);
    expect(data).toMatchObject({
      name: 'Telefon na raty',
      creditor: 'Play',
      remainingMinor: 250_000,
      paidSoFarMinor: 0,
      progressBps: 0,
      installmentsRemaining: 5,
      nextDueOn: '2026-09-20',
      projectedFinalPaymentOn: '2027-01-20',
      paidThisMonth: false,
      lastPaymentOn: null,
      recurringRuleId: null,
      isActive: true,
    });
  });

  it('z regułą na ratę: wydatek stały od pierwszej raty po punkcie odniesienia', async () => {
    const s = await setup();
    const liability = await create(s, { balanceAsOf: '2026-09-23', createRecurringRule: true });
    expect(liability.recurringRuleId).not.toBeNull();

    const rule = await call(s, 'GET', `/recurring/rules/${liability.recurringRuleId ?? ''}`);
    expect(rule.json<{ data: RecurringRuleDto }>().data).toMatchObject({
      name: 'Telefon na raty',
      flow: 'expense',
      amountMinor: 50_000,
      accountId: s.ror,
      categoryId: s.mortgage,
      liabilityId: liability.id,
      frequency: 'monthly',
      dayOfMonth: 20,
      // Rata z 20 września jest już w kwocie „na 23 września".
      startMonth: '2026-10',
      endMonth: '2027-02',
      isFixedExpense: true,
      autoPost: false,
    });
  });

  it('reguła bez konta i dnia płatności — 422 z polami', async () => {
    const s = await setup();
    const error = await rejected(
      s,
      { createRecurringRule: true, paymentAccountId: null, paymentDay: null },
      422,
    );
    expect(error.details?.map((d) => d.path)).toEqual(['paymentAccountId', 'paymentDay']);
  });

  it('pierwsza rata przed punktem odniesienia — 422', async () => {
    const s = await setup();
    const error = await rejected(s, { firstPaymentOn: '2026-08-20' }, 422);
    expect(error.details?.[0]?.path).toBe('firstPaymentOn');
  });

  it('odwołania: cudze konto 404, konto z archiwum i kategoria przychodu 422', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = insertAccount(s.app.db, other);
    expect((await rejected(s, { paymentAccountId: foreign }, 404)).details?.[0]?.path).toBe(
      'paymentAccountId',
    );
    const archived = insertAccount(s.app.db, s.home, { name: 'Stare', isArchived: true });
    expect((await rejected(s, { paymentAccountId: archived }, 422)).details?.[0]?.path).toBe(
      'paymentAccountId',
    );
    expect((await rejected(s, { categoryId: s.salary }, 422)).details?.[0]?.path).toBe(
      'categoryId',
    );
  });

  it('walidacja pól — 400', async () => {
    const s = await setup();
    await rejected(s, { openingBalanceMinor: 0 }, 400);
    await rejected(s, { kind: 'pozyczka' }, 400);
    await rejected(s, { paymentDay: 32 }, 400);
  });
});

describe('stan zobowiązania (07 §5.1)', () => {
  it('liczą się wydatki po punkcie odniesienia, poza koszem', async () => {
    const s = await setup();
    const liability = await create(s);
    const base = { liabilityId: liability.id, accountId: s.ror, amountMinor: 50_000 };
    insertTransaction(s.app.db, s.home, { ...base, bookedOn: '2026-08-20', monthKey: '2026-08' });
    insertTransaction(s.app.db, s.home, { ...base, bookedOn: '2026-09-01', monthKey: '2026-09' });
    insertTransaction(s.app.db, s.home, { ...base, bookedOn: '2026-09-20', monthKey: '2026-09' });
    insertTransaction(s.app.db, s.home, {
      ...base,
      bookedOn: '2026-09-21',
      monthKey: '2026-09',
      deletedAt: Date.now(),
    });
    insertTransaction(s.app.db, s.home, {
      ...base,
      type: 'income',
      bookedOn: '2026-09-22',
      monthKey: '2026-09',
    });

    const data = await detail(s, liability.id);
    expect(data).toMatchObject({
      remainingMinor: 200_000,
      paidSoFarMinor: 50_000,
      progressBps: 2_000,
      installmentsRemaining: 4,
      paidThisMonth: true,
      lastPaymentOn: '2026-09-20',
      nextDueOn: '2026-10-20',
      projectedFinalPaymentOn: '2027-01-20',
    });
    // Historia: wszystkie zaksięgowane wydatki, od najnowszego (sprzed punktu też).
    expect(data.payments.map((p) => p.bookedOn)).toEqual([
      '2026-09-20',
      '2026-09-01',
      '2026-08-20',
    ]);
  });

  it('nadpłata — zostało zero, 100%', async () => {
    const s = await setup();
    const liability = await create(s);
    insertTransaction(s.app.db, s.home, {
      liabilityId: liability.id,
      accountId: s.ror,
      amountMinor: 300_000,
      bookedOn: '2026-09-10',
      monthKey: '2026-09',
    });
    expect(await detail(s, liability.id)).toMatchObject({
      remainingMinor: 0,
      progressBps: 10_000,
      installmentsRemaining: 0,
      nextDueOn: null,
    });
  });
});

describe('najbliższa rata od punktu odniesienia (ADR-068)', () => {
  /**
   * Reguła raty zobowiązania.
   *
   * @param s - Środowisko.
   * @param id - Reguła.
   * @returns Reguła.
   */
  async function ruleOf(s: Setup, id: string | null): Promise<RecurringRuleDto> {
    const response = await call(s, 'GET', `/recurring/rules/${id ?? ''}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ data: RecurringRuleDto }>().data;
  }

  it('rata sprzed dnia „na dzień" nie jest zaległa — najbliższa w następnym miesiącu', async () => {
    const s = await setup();
    // Rata 20. dnia, stan na 23 września: wrześniowa jest już w kwocie.
    const liability = await create(s, { balanceAsOf: '2026-09-23' });
    expect(liability.nextDueOn).toBe('2026-10-20');
    expect(liability.projectedFinalPaymentOn).toBe('2027-02-20');
  });

  it('spłata od listopada: reguła od listopada, we wrześniu nic niezapłaconego', async () => {
    const s = await setup();
    const liability = await create(s, {
      balanceAsOf: '2026-09-23',
      firstPaymentOn: '2026-11-20',
      createRecurringRule: true,
    });
    expect(liability.nextDueOn).toBe('2026-11-20');
    expect(await ruleOf(s, liability.recurringRuleId)).toMatchObject({
      startMonth: '2026-11',
      endMonth: '2027-03',
    });

    const summary = await call(s, 'GET', '/months/2026-09/summary');
    expect(
      summary.json<{ data: { liabilities: { unpaidCount: number } } }>().data.liabilities
        .unpaidCount,
    ).toBe(0);
  });

  it('zmiana najbliższej raty przesuwa start i koniec reguły; wyczyszczenie cofa', async () => {
    const s = await setup();
    const liability = await create(s, { balanceAsOf: '2026-09-23', createRecurringRule: true });

    const moved = await call(s, 'PATCH', `/liabilities/${liability.id}`, {
      firstPaymentOn: '2026-12-20',
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json<{ data: LiabilityDto }>().data.nextDueOn).toBe('2026-12-20');
    expect(await ruleOf(s, liability.recurringRuleId)).toMatchObject({
      startMonth: '2026-12',
      endMonth: '2027-04',
    });

    const cleared = await call(s, 'PATCH', `/liabilities/${liability.id}`, {
      firstPaymentOn: null,
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(await ruleOf(s, liability.recurringRuleId)).toMatchObject({
      startMonth: '2026-10',
      endMonth: '2027-02',
    });
  });
});

describe('GET /liabilities', () => {
  it('aktywne przed zamkniętymi, filtr, izolacja', async () => {
    const s = await setup();
    const closed = await create(s, { name: 'A — spłacony' });
    await call(s, 'PATCH', `/liabilities/${closed.id}`, { isActive: false });
    await create(s, { name: 'Z — kredyt' });

    const all = await call(s, 'GET', '/liabilities');
    expect(all.json<{ data: LiabilityDto[] }>().data.map((l) => l.name)).toEqual([
      'Z — kredyt',
      'A — spłacony',
    ]);
    const active = await call(s, 'GET', '/liabilities?isActive=true');
    expect(active.json<{ data: LiabilityDto[] }>().data).toHaveLength(1);

    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = await call(s, 'GET', `/liabilities/${closed.id}`, undefined, {}, other);
    expect(foreign.statusCode).toBe(404);
  });
});

describe('POST /liabilities/:id/payments', () => {
  it('bez reguły: wydatek z ratą, dziś, z konta płatności', async () => {
    const s = await setup();
    const liability = await create(s);
    const response = await pay(s, liability.id);
    expect(response.statusCode, response.body).toBe(201);
    const { data, meta } = response.json<PaymentBody>();
    expect(data.transaction).toMatchObject({
      type: 'expense',
      bookedOn: '2026-09-23',
      amountMinor: 50_000,
      accountId: s.ror,
      categoryId: s.mortgage,
      liabilityId: liability.id,
      description: 'Telefon na raty',
      allocationEffects: [{ kind: 'debt_repayment', amountMinor: 50_000 }],
    });
    expect(data.liability).toMatchObject({ remainingMinor: 200_000, paidThisMonth: true });
    expect(meta.affectedMonths).toEqual(['2026-09']);
  });

  it('z regułą: księguje czekające wystąpienie raty zamiast drugiej transakcji', async () => {
    const s = await setup();
    const liability = await create(s, { createRecurringRule: true });
    const { data } = (await pay(s, liability.id)).json<PaymentBody>();
    expect(data.transaction).toMatchObject({ bookedOn: '2026-09-20', source: 'recurring' });

    const list = await call(s, 'GET', '/recurring/occurrences?month=2026-09');
    const [occurrence] = list.json<{ data: RecurringOccurrenceDto[] }>().data;
    expect(occurrence).toMatchObject({ status: 'posted', transactionId: data.transaction.id });
    expect(transactionCount(s)).toBe(1);
  });

  it('powtórka z kluczem — jedna transakcja; bez klucza — 400', async () => {
    const s = await setup();
    const liability = await create(s);
    const first = await pay(s, liability.id, {}, 'rata-wrzesien-01');
    const second = await pay(s, liability.id, {}, 'rata-wrzesien-01');
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(transactionCount(s)).toBe(1);

    const noKey = await call(s, 'POST', `/liabilities/${liability.id}/payments`, {});
    expect(noKey.statusCode).toBe(400);
  });

  it('bez konta płatności — 422; zamknięte — 409', async () => {
    const s = await setup();
    const liability = await create(s, { paymentAccountId: null });
    const noAccount = await pay(s, liability.id);
    expect(noAccount.statusCode).toBe(422);
    expect(noAccount.json<ErrorBody>().error.details?.[0]?.path).toBe('accountId');
    expect((await pay(s, liability.id, { accountId: s.ror })).statusCode).toBe(201);

    await call(s, 'PATCH', `/liabilities/${liability.id}`, { isActive: false });
    expect((await pay(s, liability.id, { accountId: s.ror })).statusCode).toBe(409);
  });
});

describe('GET /liabilities/:id/schedule', () => {
  it('pełne raty, ostatnia — reszta; suma równa pozostałej', async () => {
    const s = await setup();
    const liability = await create(s, { openingBalanceMinor: 120_000 });
    const response = await call(s, 'GET', `/liabilities/${liability.id}/schedule`);
    const { data } = response.json<{ data: ScheduledInstallmentDto[] }>();
    expect(data).toEqual([
      { number: 1, dueOn: '2026-09-20', amountMinor: 50_000, remainingAfterMinor: 70_000 },
      { number: 2, dueOn: '2026-10-20', amountMinor: 50_000, remainingAfterMinor: 20_000 },
      { number: 3, dueOn: '2026-11-20', amountMinor: 20_000, remainingAfterMinor: 0 },
    ]);
  });
});

describe('POST /liabilities/:id/rebase', () => {
  it('nowy punkt odniesienia; raty po nim liczą się dalej; notatka dopisana', async () => {
    const s = await setup();
    const liability = await create(s, { notes: 'Umowa 123' });
    insertTransaction(s.app.db, s.home, {
      liabilityId: liability.id,
      accountId: s.ror,
      amountMinor: 50_000,
      bookedOn: '2026-09-20',
      monthKey: '2026-09',
    });
    const response = await call(s, 'POST', `/liabilities/${liability.id}/rebase`, {
      remainingMinor: 180_000,
      asOf: '2026-09-15',
      note: 'wyciąg za sierpień',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ data: LiabilityDto }>().data).toMatchObject({
      openingBalanceMinor: 180_000,
      balanceAsOf: '2026-09-15',
      remainingMinor: 130_000,
      notes: 'Umowa 123\nKorekta z wyciągu (15 września 2026): wyciąg za sierpień',
    });
  });

  it('dzień w przyszłości — 422', async () => {
    const s = await setup();
    const liability = await create(s);
    const response = await call(s, 'POST', `/liabilities/${liability.id}/rebase`, {
      remainingMinor: 0,
      asOf: '2026-09-24',
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('PATCH i DELETE', () => {
  it('zmienia pola; reguły między polami po scaleniu', async () => {
    const s = await setup();
    const liability = await create(s);
    const ok = await call(s, 'PATCH', `/liabilities/${liability.id}`, {
      monthlyPaymentMinor: 62_500,
      creditor: null,
    });
    expect(ok.json<{ data: LiabilityDto }>().data).toMatchObject({
      monthlyPaymentMinor: 62_500,
      creditor: null,
      installmentsRemaining: 4,
    });
    const bad = await call(s, 'PATCH', `/liabilities/${liability.id}`, {
      firstPaymentOn: '2026-08-01',
    });
    expect(bad.statusCode).toBe(422);
  });

  it('zamknięcie wstrzymuje regułę raty; ponowne otwarcie jej nie wznawia', async () => {
    const s = await setup();
    const liability = await create(s, { createRecurringRule: true });
    const ruleUrl = `/recurring/rules/${liability.recurringRuleId ?? ''}`;
    await call(s, 'PATCH', `/liabilities/${liability.id}`, { isActive: false });
    expect((await call(s, 'GET', ruleUrl)).json<{ data: RecurringRuleDto }>().data.isActive).toBe(
      false,
    );
    await call(s, 'PATCH', `/liabilities/${liability.id}`, { isActive: true });
    expect((await call(s, 'GET', ruleUrl)).json<{ data: RecurringRuleDto }>().data.isActive).toBe(
      false,
    );
  });

  it('usunięcie: raty zostają jako zwykłe wydatki, reguła wstrzymana', async () => {
    const s = await setup();
    const liability = await create(s, { createRecurringRule: true });
    const { data } = (await pay(s, liability.id)).json<PaymentBody>();

    expect((await call(s, 'DELETE', `/liabilities/${liability.id}`)).statusCode).toBe(204);
    expect((await call(s, 'GET', `/liabilities/${liability.id}`)).statusCode).toBe(404);
    const tx = await call(s, 'GET', `/transactions/${data.transaction.id}`);
    expect(tx.json<{ data: { liabilityId: string | null } }>().data.liabilityId).toBeNull();
    const rule = await call(s, 'GET', `/recurring/rules/${liability.recurringRuleId ?? ''}`);
    expect(rule.json<{ data: RecurringRuleDto }>().data).toMatchObject({
      isActive: false,
      liabilityId: null,
    });
  });
});

describe('zobowiązania poza modułem', () => {
  it('majątek netto odejmuje pozostałą kwotę — od punktu odniesienia', async () => {
    const s = await setup();
    s.app.db.db.update(accounts).set({ openingBalanceMinor: 1_000_000 }).run();
    await create(s, { balanceAsOf: '2026-09-01' });

    const september = await call(s, 'GET', '/accounts/balances?month=2026-09');
    expect(
      september.json<{ meta: { liabilitiesRemainingMinor: number } }>().meta
        .liabilitiesRemainingMinor,
    ).toBe(250_000);
    const august = await call(s, 'GET', '/accounts/balances?month=2026-08');
    expect(
      august.json<{ meta: { liabilitiesRemainingMinor: number } }>().meta.liabilitiesRemainingMinor,
    ).toBe(0);
  });

  it('scalenie kategorii przepina kategorię raty', async () => {
    const s = await setup();
    const liability = await create(s);
    const target = insertCategory(s.app.db, s.home, { name: 'Kredyty' });
    const merge = await call(s, 'POST', `/categories/${s.mortgage}/merge`, {
      targetCategoryId: target,
    });
    expect(merge.statusCode, merge.body).toBe(200);
    expect((await detail(s, liability.id)).categoryId).toBe(target);
  });

  it('rata liczy się do spłaty zobowiązań w miesiącu', async () => {
    const s = await setup();
    const liability = await create(s);
    await pay(s, liability.id);
    const summary = await call(s, 'GET', '/months/2026-09/summary');
    expect(
      summary.json<{ data: { totals: { debtRepaymentMinor: number } } }>().data.totals
        .debtRepaymentMinor,
    ).toBe(50_000);
  });
});
