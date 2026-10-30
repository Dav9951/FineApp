import type {
  MonthSummaryDto,
  OccurrenceMutationMeta,
  PostOccurrenceResultDto,
  RecurringOccurrenceDto,
  RecurringOccurrencesMeta,
  RecurringRuleDto,
  TransactionListItemDto,
} from '@fineapp/shared';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertAccount,
  insertCategory,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';
import { accounts } from '../../db/schema/accounts.js';
import { households } from '../../db/schema/households.js';
import { recurringRules } from '../../db/schema/recurring.js';
import { transactions } from '../../db/schema/transactions.js';

/**
 * Testy księgowania, pomijania i cofania wystąpień — zadanie `F4-3`
 * ([04 §9](../../../../../../plans/04-api-spec.md#9-pozycje-cykliczne--apiv1recurring),
 * [07 §6.5–§6.7](../../../../../../plans/07-domain-rules.md#65-księgowanie-wystąpienia),
 * ADR-042, ADR-046).
 */

/** 23 września 2026, 12:00 w Warszawie. Limit księgowania 1 → okno sierpień–wrzesień. */
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
  card: string;
  savings: string;
  rent: string;
}

/** Wynik zaksięgowania z metadanymi. */
interface PostBody {
  data: PostOccurrenceResultDto;
  meta: OccurrenceMutationMeta;
}

/** Kształt błędu. */
interface ErrorBody {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
}

/**
 * Aplikacja z gospodarstwem, dwoma kontami bieżącymi, oszczędnościowym i kategorią.
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
    card: insertAccount(app.db, home, { name: 'Karta' }),
    savings: insertAccount(app.db, home, {
      name: 'Oszczędności',
      type: 'savings',
      allocationClass: 'savings',
    }),
    rent: insertCategory(app.db, home, { name: 'Czynsz' }),
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
 * Zakłada regułę: domyślnie czynsz 1 850 zł 10. dnia każdego miesiąca od sierpnia.
 *
 * @param s - Środowisko.
 * @param overrides - Nadpisane pola.
 * @returns Reguła.
 */
async function createRule(
  s: Setup,
  overrides: Record<string, unknown> = {},
): Promise<RecurringRuleDto> {
  const response = await call(s, 'POST', '/recurring/rules', {
    name: 'Czynsz',
    flow: 'expense',
    amountMinor: 185_000,
    accountId: s.ror,
    categoryId: s.rent,
    frequency: 'monthly',
    dayOfMonth: 10,
    startMonth: '2026-08',
    isFixedExpense: true,
    ...overrides,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: RecurringRuleDto }>().data;
}

/**
 * Wystąpienia miesiąca.
 *
 * @param s - Środowisko.
 * @param month - Klucz miesiąca.
 * @returns Lista z metadanymi.
 */
async function occurrences(
  s: Setup,
  month: string,
): Promise<{ data: RecurringOccurrenceDto[]; meta: RecurringOccurrencesMeta }> {
  const response = await call(s, 'GET', `/recurring/occurrences?month=${month}`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

/**
 * Identyfikator wystąpienia reguły z danym terminem.
 *
 * @param s - Środowisko.
 * @param dueOn - Termin.
 * @returns Identyfikator.
 */
async function occurrenceOn(s: Setup, dueOn: string): Promise<string> {
  const { data } = await occurrences(s, dueOn.slice(0, 7));
  const id = data.find((item) => item.dueOn === dueOn)?.id;
  if (id === undefined || id === null) throw new Error(`Brak wystąpienia ${dueOn}`);
  return id;
}

/**
 * Nowy klucz idempotencji.
 *
 * @returns Klucz.
 */
function newKey(): string {
  keyCounter += 1;
  return `test-key-${String(keyCounter).padStart(4, '0')}`;
}

/**
 * Księguje wystąpienie.
 *
 * @param s - Środowisko.
 * @param id - Identyfikator wystąpienia.
 * @param payload - Ciało.
 * @param key - Klucz idempotencji.
 * @returns Odpowiedź.
 */
function post(
  s: Setup,
  id: string,
  payload: Record<string, unknown> = {},
  key: string = newKey(),
): Promise<LightMyRequestResponse> {
  return call(s, 'POST', `/recurring/occurrences/${id}/post`, payload, {
    'idempotency-key': key,
  });
}

/**
 * Księguje wystąpienie i oczekuje `201`.
 *
 * @param s - Środowisko.
 * @param id - Identyfikator wystąpienia.
 * @param payload - Ciało.
 * @returns Wynik.
 */
async function posted(
  s: Setup,
  id: string,
  payload: Record<string, unknown> = {},
): Promise<PostBody> {
  const response = await post(s, id, payload);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<PostBody>();
}

/**
 * Transakcja przez API — także z kosza.
 *
 * @param s - Środowisko.
 * @param id - Identyfikator transakcji.
 * @returns Transakcja.
 */
async function transaction(s: Setup, id: string): Promise<TransactionListItemDto> {
  const response = await call(s, 'GET', `/transactions/${id}`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ data: TransactionListItemDto }>().data;
}

/**
 * Liczba transakcji gospodarstwa w bazie, z koszem.
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

describe('uwierzytelnienie i walidacja', () => {
  it('bez tokenu 401', async () => {
    const s = await setup();
    const id = '01J9ZQK8WQ0000000000000000';
    for (const action of ['post', 'skip', 'unpost']) {
      const response = await s.app.app.inject({
        method: 'POST',
        url: `/api/v1/recurring/occurrences/${id}/${action}`,
        headers: { 'x-requested-with': 'fineapp', 'idempotency-key': 'klucz-testowy' },
        payload: {},
      });
      expect(response.statusCode, action).toBe(401);
    }
  });

  it('księgowanie bez ciała — jak w planie', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    const response = await s.app.app.inject({
      method: 'POST',
      url: `/api/v1/recurring/occurrences/${id}/post`,
      headers: { ...s.home.headers, 'idempotency-key': newKey() },
    });
    expect(response.statusCode, response.body).toBe(201);
  });

  it('księgowanie bez Idempotency-Key — 400', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    const response = await call(s, 'POST', `/recurring/occurrences/${id}/post`, {});
    expect(response.statusCode).toBe(400);
  });

  it('cudze wystąpienie — 404 przy każdej operacji', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    const other = await householdFixture(s.app.db, testConfig(), START);
    for (const action of ['post', 'skip', 'unpost']) {
      const response = await call(
        s,
        'POST',
        `/recurring/occurrences/${id}/${action}`,
        {},
        { 'idempotency-key': newKey() },
        other,
      );
      expect(response.statusCode, action).toBe(404);
    }
  });
});

describe('POST /recurring/occurrences/:id/post', () => {
  it('puste ciało: kwota planowana w dniu terminu, transakcja dziedziczy z reguły', async () => {
    const s = await setup();
    const rule = await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');

    const { data, meta } = await posted(s, id);
    expect(data.transaction).toMatchObject({
      type: 'expense',
      bookedOn: '2026-09-10',
      monthKey: '2026-09',
      amountMinor: 185_000,
      accountId: s.ror,
      categoryId: s.rent,
      description: 'Czynsz',
      source: 'recurring',
      recurringOccurrenceId: id,
    });
    expect(data.occurrence).toMatchObject({
      id,
      ruleId: rule.id,
      status: 'posted',
      postedAmountMinor: 185_000,
      transactionId: data.transaction.id,
      isOverdue: false,
    });
    expect(meta.affectedMonths).toEqual(['2026-09']);

    const list = await occurrences(s, '2026-09');
    expect(list.meta).toMatchObject({ postedTotalMinor: 185_000, remainingTotalMinor: 0 });
  });

  it('kwota, data, konto i notatka inne niż w planie', async () => {
    const s = await setup();
    await createRule(s, { name: 'Prąd', amountMinor: 28_000, amountIsEstimate: true });
    const id = await occurrenceOn(s, '2026-09-10');

    const { data, meta } = await posted(s, id, {
      amountMinor: 31_200,
      bookedOn: '2026-09-12',
      accountId: s.card,
      notes: 'wyższy rachunek',
    });
    expect(data.transaction).toMatchObject({
      amountMinor: 31_200,
      bookedOn: '2026-09-12',
      accountId: s.card,
      notes: 'wyższy rachunek',
    });
    expect(data.occurrence).toMatchObject({
      plannedAmountMinor: 28_000,
      postedAmountMinor: 31_200,
    });
    expect(meta.affectedMonths).toEqual(['2026-09']);
  });

  it('zaległe z sierpnia zaksięgowane we wrześniu — oba miesiące do unieważnienia', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-08-10');
    const { meta } = await posted(s, id, { bookedOn: '2026-09-02' });
    expect(meta.affectedMonths).toEqual(['2026-08', '2026-09']);
  });

  it('przelew na oszczędności: migawki klas i efekt alokacji', async () => {
    const s = await setup();
    await createRule(s, {
      name: 'Na oszczędności',
      flow: 'transfer',
      amountMinor: 200_000,
      counterAccountId: s.savings,
      categoryId: null,
      isFixedExpense: false,
    });
    const id = await occurrenceOn(s, '2026-09-10');
    const { data } = await posted(s, id);
    expect(data.transaction).toMatchObject({
      type: 'transfer',
      counterAccountId: s.savings,
      sourceAllocationClass: 'spending',
      targetAllocationClass: 'savings',
      allocationEffects: [{ kind: 'savings', amountMinor: 200_000 }],
    });
  });

  it('powtórka z tym samym kluczem: ta sama odpowiedź, jedna transakcja', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    const key = newKey();

    const first = await post(s, id, {}, key);
    const second = await post(s, id, {}, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(transactionCount(s)).toBe(1);
  });

  it('ten sam klucz z innym ciałem — 409', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    const key = newKey();
    expect((await post(s, id, {}, key)).statusCode).toBe(201);
    expect((await post(s, id, { amountMinor: 1 }, key)).statusCode).toBe(409);
  });

  it('ten sam klucz przy innym wystąpieniu to inna operacja', async () => {
    const s = await setup();
    await createRule(s);
    const august = await occurrenceOn(s, '2026-08-10');
    const september = await occurrenceOn(s, '2026-09-10');
    const key = newKey();
    expect((await post(s, august, {}, key)).statusCode).toBe(201);
    expect((await post(s, september, {}, key)).statusCode).toBe(201);
    expect(transactionCount(s)).toBe(2);
  });

  it('drugie zaksięgowanie innym kluczem — 409, bez drugiej transakcji', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    await posted(s, id);
    const again = await post(s, id);
    expect(again.statusCode).toBe(409);
    expect(transactionCount(s)).toBe(1);
  });

  it('data sprzed okna księgowania — 422, nic nie zapisane', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    const response = await post(s, id, { bookedOn: '2026-07-31' });
    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorBody>().error.details?.[0]?.path).toBe('bookedOn');
    expect((await occurrences(s, '2026-09')).data[0]?.status).toBe('planned');
  });

  it('konto z archiwum — 422; reguła bez konta — 422, chyba że konto podane', async () => {
    const s = await setup();
    const rule = await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');

    s.app.db.db.update(accounts).set({ isArchived: true }).where(eq(accounts.id, s.ror)).run();
    expect((await post(s, id)).statusCode).toBe(422);

    s.app.db.db
      .update(recurringRules)
      .set({ accountId: null })
      .where(eq(recurringRules.id, rule.id))
      .run();
    const noAccount = await post(s, id);
    expect(noAccount.statusCode).toBe(422);
    expect(noAccount.json<ErrorBody>().error.details?.[0]?.path).toBe('accountId');
    expect((await post(s, id, { accountId: s.card })).statusCode).toBe(201);
  });

  it('pominięte można jednak zaksięgować', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    await call(s, 'POST', `/recurring/occurrences/${id}/skip`, { reason: 'urlop' });
    const { data } = await posted(s, id);
    expect(data.occurrence.status).toBe('posted');
  });

  it('kwota na dashboardzie miesiąca', async () => {
    const s = await setup();
    await createRule(s);
    await posted(s, await occurrenceOn(s, '2026-09-10'));
    const summary = await call(s, 'GET', '/months/2026-09/summary');
    expect(summary.json<{ data: MonthSummaryDto }>().data.totals.expenseMinor).toBe(185_000);
  });
});

describe('POST /recurring/occurrences/:id/skip', () => {
  it('pomija z powodem, idempotentnie; poza planem miesiąca', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await call(s, 'POST', `/recurring/occurrences/${id}/skip`, {
        reason: ' urlop ',
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<{ data: RecurringOccurrenceDto }>().data).toMatchObject({
        status: 'skipped',
        isOverdue: false,
      });
    }
    const { meta } = await occurrences(s, '2026-09');
    expect(meta).toMatchObject({ plannedTotalMinor: 0, remainingTotalMinor: 0 });
  });

  it('bez ciała też działa', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    const response = await s.app.app.inject({
      method: 'POST',
      url: `/api/v1/recurring/occurrences/${id}/skip`,
      headers: s.home.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
  });

  it('zaksięgowanego nie można pominąć — 409', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    await posted(s, id);
    expect((await call(s, 'POST', `/recurring/occurrences/${id}/skip`, {})).statusCode).toBe(409);
  });
});

describe('cofnięcie zaksięgowania — dwa wejścia, jedna operacja (07 §6.7)', () => {
  it('unpost: transakcja w koszu, wystąpienie znowu czeka', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    const { data } = await posted(s, id);

    const response = await call(s, 'POST', `/recurring/occurrences/${id}/unpost`);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ data: RecurringOccurrenceDto; meta: OccurrenceMutationMeta }>();
    expect(body.data).toMatchObject({
      status: 'planned',
      transactionId: null,
      postedAmountMinor: null,
    });
    expect(body.meta.affectedMonths).toEqual(['2026-09']);
    expect((await transaction(s, data.transaction.id)).deletedAt).not.toBeNull();

    // Powtórka niczego nie zmienia.
    const again = await call(s, 'POST', `/recurring/occurrences/${id}/unpost`);
    expect(again.json<{ data: RecurringOccurrenceDto }>().data.status).toBe('planned');
  });

  it('usunięcie transakcji z listy cofa zaksięgowanie', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    const { data } = await posted(s, id);

    expect((await call(s, 'DELETE', `/transactions/${data.transaction.id}`)).statusCode).toBe(204);
    const [occurrence] = (await occurrences(s, '2026-09')).data;
    expect(occurrence).toMatchObject({ status: 'planned', transactionId: null });
  });

  it('przywrócenie z kosza („Cofnij") wiąże ponownie', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    const { data } = await posted(s, id, { amountMinor: 190_000 });
    await call(s, 'POST', `/recurring/occurrences/${id}/unpost`);

    const restored = await call(s, 'POST', `/transactions/${data.transaction.id}/restore`);
    expect(restored.statusCode, restored.body).toBe(200);
    const [occurrence] = (await occurrences(s, '2026-09')).data;
    expect(occurrence).toMatchObject({
      status: 'posted',
      transactionId: data.transaction.id,
      postedAmountMinor: 190_000,
    });
  });

  it('przywrócenie, gdy zaksięgowano inną transakcją — wraca jako zwykła', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    const first = await posted(s, id);
    await call(s, 'POST', `/recurring/occurrences/${id}/unpost`);
    const second = await posted(s, id);

    await call(s, 'POST', `/transactions/${first.data.transaction.id}/restore`);
    expect((await transaction(s, first.data.transaction.id)).recurringOccurrenceId).toBeNull();
    const [occurrence] = (await occurrences(s, '2026-09')).data;
    expect(occurrence?.transactionId).toBe(second.data.transaction.id);

    // Usunięcie tej zwykłej transakcji nie rusza cudzego zaksięgowania.
    await call(s, 'DELETE', `/transactions/${first.data.transaction.id}`);
    expect((await occurrences(s, '2026-09')).data[0]?.status).toBe('posted');
  });

  it('zamknięty miesiąc blokuje cofnięcie — 422', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-08-10');
    await posted(s, id);
    s.app.db.db.update(households).set({ backPostingLimitMonths: 0 }).run();

    const response = await call(s, 'POST', `/recurring/occurrences/${id}/unpost`);
    expect(response.statusCode).toBe(422);
    expect((await occurrences(s, '2026-08')).data[0]?.status).toBe('posted');
  });

  it('zmiana kwoty transakcji przechodzi na wystąpienie', async () => {
    const s = await setup();
    await createRule(s);
    const id = await occurrenceOn(s, '2026-09-10');
    const { data } = await posted(s, id);
    await call(s, 'PATCH', `/transactions/${data.transaction.id}`, { amountMinor: 187_500 });
    const [occurrence] = (await occurrences(s, '2026-09')).data;
    expect(occurrence?.postedAmountMinor).toBe(187_500);
  });
});

describe('auto-księgowanie (07 §6.2, krok 4)', () => {
  it('termin minął albo jest dziś — księguje; przyszły — czeka', async () => {
    const s = await setup();
    await createRule(s, { autoPost: true });
    await createRule(s, { name: 'Internet', amountMinor: 8_900, dayOfMonth: 23, autoPost: true });
    await createRule(s, { name: 'Prąd', amountMinor: 28_000, dayOfMonth: 30, autoPost: true });

    const { data } = await occurrences(s, '2026-09');
    expect(data.map((item) => [item.ruleName, item.status])).toEqual([
      ['Czynsz', 'posted'],
      ['Internet', 'posted'],
      ['Prąd', 'planned'],
    ]);
    const august = await occurrences(s, '2026-08');
    expect(august.data.every((item) => item.status === 'posted')).toBe(true);

    const rent = data[0]?.transactionId ?? '';
    expect(await transaction(s, rent)).toMatchObject({
      bookedOn: '2026-09-10',
      source: 'recurring',
      createdBy: s.home.userId,
    });
  });

  it('dashboard miesiąca liczy auto-zaksięgowane', async () => {
    const s = await setup();
    await createRule(s, { autoPost: true });
    const summary = await call(s, 'GET', '/months/2026-09/summary');
    expect(summary.json<{ data: MonthSummaryDto }>().data.totals.expenseMinor).toBe(185_000);
  });

  it('kwota szacunkowa nie księguje się sama', async () => {
    const s = await setup();
    await createRule(s, { autoPost: true, amountIsEstimate: true });
    const { data } = await occurrences(s, '2026-09');
    expect(data[0]?.status).toBe('planned');
  });

  it('cofnięte auto-zaksięgowanie nie wraca przy kolejnym odczycie', async () => {
    const s = await setup();
    await createRule(s, { autoPost: true });
    const id = await occurrenceOn(s, '2026-09-10');
    await call(s, 'POST', `/recurring/occurrences/${id}/unpost`);

    const { data } = await occurrences(s, '2026-09');
    expect(data[0]).toMatchObject({ status: 'planned', isOverdue: true });
    expect(transactionCount(s)).toBe(2); // sierpień + wrześniowa w koszu
  });

  it('nie da się zaksięgować — zostaje do zrobienia, odczyt działa', async () => {
    const s = await setup();
    await createRule(s, { autoPost: true });
    await createRule(s, {
      name: 'Karta',
      amountMinor: 5_000,
      accountId: s.card,
      categoryId: null,
      autoPost: true,
    });
    s.app.db.db.update(accounts).set({ isArchived: true }).where(eq(accounts.id, s.card)).run();

    const { data } = await occurrences(s, '2026-09');
    expect(data.map((item) => [item.ruleName, item.status])).toEqual([
      ['Czynsz', 'posted'],
      ['Karta', 'planned'],
    ]);
  });

  it('podgląd przyszłości niczego nie księguje', async () => {
    const s = await setup();
    await createRule(s, { autoPost: true, startMonth: '2026-10' });
    const { data } = await occurrences(s, '2026-10');
    expect(data[0]).toMatchObject({ id: null, status: 'planned' });
    expect(transactionCount(s)).toBe(0);
  });
});
