import type {
  LiabilityDto,
  MonthSummaryDto,
  RecurringOccurrenceDto,
  RecurringRuleDto,
  TransactionDto,
} from '@fineapp/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertAccount,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';

/**
 * „Zapisz jako wydatek stały" — `POST /transactions/:id/save-as-recurring` (`F4-8`,
 * [04 §7](../../../../../../plans/04-api-spec.md#7-transakcje--apiv1transactions), ADR-051).
 */

/** 23 września 2026 (środa), 12:00 w Warszawie. Okno księgowania sierpień–wrzesień. */
const START = new Date('2026-09-23T10:00:00.000Z');

let harness: TestApp | undefined;

/** Licznik kluczy idempotencji transakcji — każda z formularza ma własny. */
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
 * @param key - Klucz idempotencji.
 * @returns Odpowiedź.
 */
function call(
  s: Setup,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
  key?: string,
): Promise<LightMyRequestResponse> {
  return s.app.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...s.home.headers, ...(key === undefined ? {} : { 'idempotency-key': key }) },
    ...(payload === undefined ? {} : { payload }),
  });
}

/**
 * Dane z odpowiedzi po sprawdzeniu statusu.
 *
 * @param response - Odpowiedź.
 * @param status - Oczekiwany status.
 * @returns Pole `data`.
 */
function dataOf<T>(response: LightMyRequestResponse, status: number): T {
  expect(response.statusCode, response.body).toBe(status);
  return response.json<{ data: T }>().data;
}

/**
 * Czynsz zapłacony 10 września przez formularz.
 *
 * @param s - Środowisko.
 * @param overrides - Nadpisane pola transakcji.
 * @returns Identyfikator transakcji.
 */
async function rentPayment(s: Setup, overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await call(
    s,
    'POST',
    '/transactions',
    {
      type: 'expense',
      bookedOn: '2026-09-10',
      amountMinor: 185_000,
      accountId: s.ror,
      description: 'Czynsz',
      ...overrides,
    },
    `klucz-transakcji-${String((keyCounter += 1))}`,
  );
  return dataOf<TransactionDto>(response, 201).id;
}

/**
 * „Zapisz jako wydatek stały".
 *
 * @param s - Środowisko.
 * @param transactionId - Transakcja źródłowa.
 * @param body - Terminarz.
 * @param key - Klucz idempotencji.
 * @returns Odpowiedź.
 */
function saveAs(
  s: Setup,
  transactionId: string,
  body: Record<string, unknown> = {},
  key?: string,
): Promise<LightMyRequestResponse> {
  return call(s, 'POST', `/transactions/${transactionId}/save-as-recurring`, body, key);
}

/**
 * Wystąpienia miesiąca.
 *
 * @param s - Środowisko.
 * @param month - Klucz miesiąca.
 * @returns Wystąpienia.
 */
async function occurrences(s: Setup, month: string): Promise<RecurringOccurrenceDto[]> {
  return dataOf(await call(s, 'GET', `/recurring/occurrences?month=${month}`), 200);
}

describe('POST /transactions/:id/save-as-recurring', () => {
  it('czynsz: co miesiąc, dnia płatności, od jej miesiąca — i ona jest wrześniową płatnością', async () => {
    const s = await setup();
    const txId = await rentPayment(s);

    const rule = dataOf<RecurringRuleDto>(await saveAs(s, txId), 201);
    expect(rule).toMatchObject({
      name: 'Czynsz',
      flow: 'expense',
      amountMinor: 185_000,
      accountId: s.ror,
      frequency: 'monthly',
      dayOfMonth: 10,
      startMonth: '2026-09',
      endMonth: null,
      isFixedExpense: true,
      autoPost: false,
      nextDueOn: '2026-10-10',
    });

    const september = await occurrences(s, '2026-09');
    expect(september).toHaveLength(1);
    expect(september[0]).toMatchObject({
      dueOn: '2026-09-10',
      status: 'posted',
      transactionId: txId,
      postedAmountMinor: 185_000,
    });
    const tx = dataOf<TransactionDto>(await call(s, 'GET', `/transactions/${txId}`), 200);
    expect(tx.recurringOccurrenceId).toBe(september[0]?.id);

    // Dashboard: nic do zapłacenia drugi raz, wydatek policzony raz.
    const summary = dataOf<MonthSummaryDto>(await call(s, 'GET', '/months/2026-09/summary'), 200);
    expect(summary.recurring).toMatchObject({ pendingCount: 0, postedTotalMinor: 185_000 });
    expect(summary.totals.expenseMinor).toBe(185_000);

    // Październik — podgląd z regułą.
    expect((await occurrences(s, '2026-10')).map((item) => item.dueOn)).toEqual(['2026-10-10']);
  });

  it('usunięcie transakcji cofa zaksięgowanie — termin wraca do „Do zrobienia" (I-12)', async () => {
    const s = await setup();
    const txId = await rentPayment(s);
    dataOf(await saveAs(s, txId), 201);

    expect((await call(s, 'DELETE', `/transactions/${txId}`)).statusCode).toBe(204);
    const [september] = await occurrences(s, '2026-09');
    expect(september).toMatchObject({ status: 'planned', transactionId: null, isOverdue: true });
  });

  it('terminarz z żądania: inny dzień nie tworzy drugiej płatności we wrześniu', async () => {
    const s = await setup();
    const txId = await rentPayment(s);
    const rule = dataOf<RecurringRuleDto>(
      await saveAs(s, txId, { name: 'Najem', dayOfMonth: 15, autoPost: true }),
      201,
    );
    expect(rule).toMatchObject({ name: 'Najem', dayOfMonth: 15, autoPost: true });
    const september = await occurrences(s, '2026-09');
    expect(september.map((item) => [item.dueOn, item.status])).toEqual([['2026-09-15', 'posted']]);
  });

  it('co tydzień: wcześniejsze terminy miesiąca pominięte, późniejsze czekają', async () => {
    const s = await setup();
    const txId = await rentPayment(s, {
      bookedOn: '2026-09-23',
      amountMinor: 6_000,
      description: 'Basen',
    });
    const rule = dataOf<RecurringRuleDto>(await saveAs(s, txId, { frequency: 'weekly' }), 201);
    expect(rule).toMatchObject({ frequency: 'weekly', weekday: 3, dayOfMonth: null });

    const september = await occurrences(s, '2026-09');
    expect(september.map((item) => [item.dueOn, item.status])).toEqual([
      ['2026-09-02', 'skipped'],
      ['2026-09-09', 'skipped'],
      ['2026-09-16', 'skipped'],
      ['2026-09-23', 'posted'],
      ['2026-09-30', 'planned'],
    ]);
  });

  it('przychód — reguła przychodu ze źródłem, nie wydatek stały', async () => {
    const s = await setup();
    const txId = await rentPayment(s, {
      type: 'income',
      description: null,
      merchant: 'Firma',
      bookedOn: '2026-09-01',
      amountMinor: 900_000,
    });
    const rule = dataOf<RecurringRuleDto>(await saveAs(s, txId), 201);
    expect(rule).toMatchObject({
      name: 'Firma',
      flow: 'income',
      isFixedExpense: false,
      dayOfMonth: 1,
    });
  });

  it('transakcja z zamkniętego miesiąca — reguła powstaje, transakcja zostaje zwykła', async () => {
    const s = await setup();
    const txId = insertTransaction(s.app.db, s.home, {
      accountId: s.ror,
      bookedOn: '2026-07-10',
      monthKey: '2026-07',
      amountMinor: 185_000,
      description: 'Czynsz',
    });
    const rule = dataOf<RecurringRuleDto>(await saveAs(s, txId, { startMonth: '2026-10' }), 201);
    expect(rule.startMonth).toBe('2026-10');
    const tx = dataOf<TransactionDto>(await call(s, 'GET', `/transactions/${txId}`), 200);
    expect(tx.recurringOccurrenceId).toBeNull();
    expect(await occurrences(s, '2026-09')).toEqual([]);
  });

  it('rata zobowiązania bez reguły — reguła zostaje regułą raty', async () => {
    const s = await setup();
    const liability = dataOf<LiabilityDto>(
      await call(s, 'POST', '/liabilities', {
        name: 'Telefon na raty',
        kind: 'installment',
        openingBalanceMinor: 250_000,
        balanceAsOf: '2026-08-01',
        monthlyPaymentMinor: 50_000,
        paymentDay: 20,
      }),
      201,
    );
    const txId = await rentPayment(s, {
      description: null,
      bookedOn: '2026-09-20',
      amountMinor: 50_000,
      liabilityId: liability.id,
    });

    const rule = dataOf<RecurringRuleDto>(await saveAs(s, txId), 201);
    expect(rule).toMatchObject({ name: 'Telefon na raty', liabilityId: liability.id });
    const after = dataOf<LiabilityDto>(await call(s, 'GET', `/liabilities/${liability.id}`), 200);
    expect(after.recurringRuleId).toBe(rule.id);

    // Druga reguła na tę samą ratę — nie.
    const next = await rentPayment(s, {
      bookedOn: '2026-09-21',
      amountMinor: 50_000,
      liabilityId: liability.id,
    });
    expect((await saveAs(s, next)).statusCode).toBe(409);
  });

  it('transakcja z pozycji cyklicznej albo z kosza — 409; obca — 404', async () => {
    const s = await setup();
    const txId = await rentPayment(s);
    dataOf(await saveAs(s, txId), 201);
    const again = await saveAs(s, txId);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { message: string } }>().error.message).toContain(
      'już pochodzi z pozycji cyklicznej',
    );

    const trashed = await rentPayment(s, { bookedOn: '2026-09-11' });
    expect((await call(s, 'DELETE', `/transactions/${trashed}`)).statusCode).toBe(204);
    expect((await saveAs(s, trashed)).statusCode).toBe(409);

    expect((await saveAs(s, '01J9ZQK8WQ0000000000000009')).statusCode).toBe(404);
  });

  it('niepoprawny terminarz — 422, bez reguły i bez zmian w transakcji', async () => {
    const s = await setup();
    const txId = await rentPayment(s);
    const response = await saveAs(s, txId, { endMonth: '2026-08' });
    expect(response.statusCode, response.body).toBe(422);
    expect(dataOf<RecurringRuleDto[]>(await call(s, 'GET', '/recurring/rules'), 200)).toEqual([]);
    const tx = dataOf<TransactionDto>(await call(s, 'GET', `/transactions/${txId}`), 200);
    expect(tx.recurringOccurrenceId).toBeNull();
  });

  it('ponowienie z tym samym kluczem nie zakłada drugiej reguły', async () => {
    const s = await setup();
    const txId = await rentPayment(s);
    const first = await saveAs(s, txId, {}, 'zapisz-stale-1');
    const second = await saveAs(s, txId, {}, 'zapisz-stale-1');
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(dataOf<RecurringRuleDto[]>(await call(s, 'GET', '/recurring/rules'), 200)).toHaveLength(
      1,
    );
  });
});
