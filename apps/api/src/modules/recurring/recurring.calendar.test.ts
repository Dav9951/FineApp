import type {
  MonthSummaryDto,
  RecurringOccurrenceDto,
  RecurringOccurrencesMeta,
  TransactionListItemDto,
} from '@fineapp/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  CSRF_HEADER,
  householdFixture,
  insertAccount,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { newId } from '../../core/id.js';
import { mutableClock, type MutableClock } from '../../core/clock.js';
import { signAccessToken } from '../auth/auth.tokens.js';

/**
 * Pozycje cykliczne w kalendarzu — testy brzegowe `F4-9`
 * ([11 §Faza 4](../../../../../../plans/11-roadmap.md), [07 §6](../../../../../../plans/07-domain-rules.md#6-pozycje-cykliczne)).
 *
 * Czyste wyliczanie terminów (29/30/31, luty, rok przestępny) sprawdza `shared`. Tutaj —
 * ta sama reguła przez **upływ czasu** na prawdziwym API: generowanie przy przejściu
 * miesiąca o północy w Warszawie, auto-księgowanie dokładnie w dniu przyciętego terminu,
 * okno księgowania przez granicę roku i powtarzane odczyty z auto-księgowaniem.
 */

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Środowisko testu z zegarem, który da się przesuwać. */
interface Setup {
  app: TestApp;
  clock: MutableClock;
  home: HouseholdFixture;
  /** Nagłówki z tokenem wystawionym na bieżącą chwilę zegara. */
  headers: Record<string, string>;
  ror: string;
}

/**
 * Aplikacja z gospodarstwem i kontem, zegar ustawiony na `start`.
 *
 * @param start - Chwila startowa (UTC).
 * @returns Środowisko testu.
 */
async function setup(start: string): Promise<Setup> {
  const clock = mutableClock(start);
  const app = await buildTestApp({}, clock);
  harness = app;
  const home = await householdFixture(app.db, testConfig(), clock.now());
  return {
    app,
    clock,
    home,
    headers: { ...home.headers },
    ror: insertAccount(app.db, home, { name: 'ROR' }),
  };
}

/**
 * Przesuwa zegar do wskazanej chwili i wystawia nowy token — stary by już wygasł.
 *
 * @param s - Środowisko.
 * @param at - Docelowa chwila (UTC), późniejsza od bieżącej.
 */
async function travelTo(s: Setup, at: string): Promise<void> {
  const delta = new Date(at).getTime() - s.clock.now().getTime();
  expect(delta).toBeGreaterThan(0);
  s.clock.advance(delta);
  const token = await signAccessToken(
    testConfig(),
    { sub: s.home.userId, hid: s.home.householdId, sid: newId() },
    s.clock.now(),
  );
  s.headers = { authorization: `Bearer ${token}`, ...CSRF_HEADER };
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
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
  key?: string,
): Promise<LightMyRequestResponse> {
  return s.app.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...s.headers, ...(key === undefined ? {} : { 'idempotency-key': key }) },
    ...(payload === undefined ? {} : { payload }),
  });
}

/**
 * Ciało odpowiedzi po sprawdzeniu statusu.
 *
 * @param response - Odpowiedź.
 * @param status - Oczekiwany status.
 * @returns Ciało JSON.
 */
function bodyOf<T>(response: LightMyRequestResponse, status: number): T {
  expect(response.statusCode, response.body).toBe(status);
  return response.json<T>();
}

/**
 * Zakłada regułę czynszu.
 *
 * @param s - Środowisko.
 * @param overrides - Nadpisane pola.
 */
async function rent(s: Setup, overrides: Record<string, unknown>): Promise<void> {
  bodyOf(
    await call(s, 'POST', '/recurring/rules', {
      name: 'Czynsz',
      flow: 'expense',
      amountMinor: 185_000,
      accountId: s.ror,
      frequency: 'monthly',
      isFixedExpense: true,
      ...overrides,
    }),
    201,
  );
}

/**
 * Wystąpienia miesiąca.
 *
 * @param s - Środowisko.
 * @param month - Klucz miesiąca.
 * @returns Lista i metadane.
 */
async function occurrences(
  s: Setup,
  month: string,
): Promise<{ data: RecurringOccurrenceDto[]; meta: RecurringOccurrencesMeta }> {
  return bodyOf(await call(s, 'GET', `/recurring/occurrences?month=${month}`), 200);
}

/**
 * Podsumowanie miesiąca — odczyt dashboardu, który generuje i auto-księguje.
 *
 * @param s - Środowisko.
 * @param month - Klucz miesiąca.
 * @returns Podsumowanie.
 */
async function summary(s: Setup, month: string): Promise<MonthSummaryDto> {
  return bodyOf<{ data: MonthSummaryDto }>(await call(s, 'GET', `/months/${month}/summary`), 200)
    .data;
}

/**
 * Transakcje z pozycji cyklicznych w miesiącu.
 *
 * @param s - Środowisko.
 * @param month - Klucz miesiąca.
 * @returns Transakcje.
 */
async function recurringTransactions(s: Setup, month: string): Promise<TransactionListItemDto[]> {
  return bodyOf<{ data: TransactionListItemDto[] }>(
    await call(s, 'GET', `/transactions?month=${month}&source=recurring`),
    200,
  ).data;
}

/**
 * Terminy i statusy wystąpień — zwięzły zapis do porównań.
 *
 * @param items - Wystąpienia.
 * @returns Pary `[termin, status]`.
 */
function schedule(items: readonly RecurringOccurrenceDto[]): [string, string][] {
  return items.map((item) => [item.dueOn, item.status]);
}

describe('31. dnia przez luty przestępny (2028)', () => {
  it('termin 29.02; auto-księgowanie dokładnie 29., nie 28.; marzec wraca do 31.', async () => {
    // 31 stycznia 2028, 11:00 w Warszawie.
    const s = await setup('2028-01-31T10:00:00.000Z');
    await rent(s, { dayOfMonth: 31, startMonth: '2028-01', autoPost: true });

    // Termin dziś — odczyt dashboardu księguje styczeń.
    expect((await summary(s, '2028-01')).recurring.postedTotalMinor).toBe(185_000);
    // Luty to jeszcze podgląd: 29, nie 28 i nie 2 marca.
    const preview = await occurrences(s, '2028-02');
    expect(preview.meta.isPreview).toBe(true);
    expect(preview.data.map((item) => [item.id, item.dueOn])).toEqual([[null, '2028-02-29']]);

    // 28 lutego: termin jutro — czeka, nie jest zaległy, nic się nie księguje.
    await travelTo(s, '2028-02-28T10:00:00.000Z');
    const february = await summary(s, '2028-02');
    expect(february.recurring.items).toMatchObject([
      { dueOn: '2028-02-29', status: 'planned', isOverdue: false },
    ]);
    expect(await recurringTransactions(s, '2028-02')).toEqual([]);

    // 29 lutego: termin dziś — auto-księgowanie z datą 29.02 w lutym.
    await travelTo(s, '2028-02-29T10:00:00.000Z');
    expect((await summary(s, '2028-02')).recurring.items).toEqual([]);
    const [posted] = await recurringTransactions(s, '2028-02');
    expect(posted).toMatchObject({ bookedOn: '2028-02-29', monthKey: '2028-02' });

    // 1 marca, 00:30 w Warszawie (29.02, 23:30 UTC): marzec już bieżący, termin 31.
    await travelTo(s, '2028-02-29T23:30:00.000Z');
    const march = await occurrences(s, '2028-03');
    expect(march.meta.isPreview).toBe(false);
    expect(schedule(march.data)).toEqual([['2028-03-31', 'planned']]);
    expect(schedule((await occurrences(s, '2028-02')).data)).toEqual([['2028-02-29', 'posted']]);
  });
});

describe('31. dnia w lutym roku zwykłego (2027)', () => {
  it('termin 28.02; niezapłacony jest 1 marca zaległy z podpisem lutego', async () => {
    const s = await setup('2027-02-27T10:00:00.000Z');
    await rent(s, { dayOfMonth: 31, startMonth: '2027-02' });
    expect((await occurrences(s, '2027-02')).data).toMatchObject([
      { dueOn: '2027-02-28', isOverdue: false },
    ]);

    await travelTo(s, '2027-03-01T10:00:00.000Z');
    const items = (await summary(s, '2027-03')).recurring.items;
    expect(items.map((item) => [item.dueOn, item.monthKey, item.isOverdue])).toEqual([
      ['2027-02-28', '2027-02', true],
      ['2027-03-31', '2027-03', false],
    ]);
  });
});

describe('okno księgowania przez granicę roku', () => {
  it('styczeń widzi zaległy grudzień; zaksięgowany trafia do grudnia poprzedniego roku', async () => {
    // 5 stycznia 2027 — okno grudzień 2026 – styczeń 2027.
    const s = await setup('2027-01-05T10:00:00.000Z');
    await rent(s, { dayOfMonth: 20, startMonth: '2026-11' });

    const items = (await summary(s, '2027-01')).recurring.items;
    // Listopad jest poza oknem (zamknięty) — nie wraca jako zaległy.
    expect(items.map((item) => [item.dueOn, item.isOverdue])).toEqual([
      ['2026-12-20', true],
      ['2027-01-20', false],
    ]);

    const december = items[0];
    const result = bodyOf<{
      data: { transaction: TransactionListItemDto };
      meta: { affectedMonths: string[] };
    }>(
      await call(
        s,
        'POST',
        `/recurring/occurrences/${december?.id ?? ''}/post`,
        {},
        'grudzien-2026-czynsz',
      ),
      201,
    );
    expect(result.data.transaction).toMatchObject({
      bookedOn: '2026-12-20',
      monthKey: '2026-12',
    });
    expect(result.meta.affectedMonths).toEqual(['2026-12']);
    expect((await summary(s, '2026-12')).totals.expenseMinor).toBe(185_000);
    expect((await summary(s, '2027-01')).totals.expenseMinor).toBe(0);
  });
});

describe('idempotencja przy wielu odczytach', () => {
  it('dashboard, lista i generowanie wielokrotnie — jedno wystąpienie i jedna transakcja', async () => {
    const s = await setup('2026-09-23T10:00:00.000Z');
    await rent(s, { dayOfMonth: 10, startMonth: '2026-09', autoPost: true });

    for (let round = 0; round < 3; round += 1) {
      await summary(s, '2026-09');
      await occurrences(s, '2026-09');
      bodyOf(await call(s, 'POST', '/recurring/generate', { month: '2026-09' }), 200);
    }

    expect(schedule((await occurrences(s, '2026-09')).data)).toEqual([['2026-09-10', 'posted']]);
    expect(await recurringTransactions(s, '2026-09')).toHaveLength(1);
    expect((await summary(s, '2026-09')).totals.expenseMinor).toBe(185_000);
  });

  it('ten sam klucz w różnych operacjach — każda zapisuje się raz, niezależnie', async () => {
    const s = await setup('2026-09-23T10:00:00.000Z');
    await rent(s, { dayOfMonth: 10, startMonth: '2026-09' });
    const [occurrence] = (await occurrences(s, '2026-09')).data;
    const key = 'wspolny-klucz-1';

    const posted = await call(
      s,
      'POST',
      `/recurring/occurrences/${occurrence?.id ?? ''}/post`,
      {},
      key,
    );
    const manual = await call(
      s,
      'POST',
      '/transactions',
      { type: 'expense', bookedOn: '2026-09-20', amountMinor: 5_000, accountId: s.ror },
      key,
    );
    expect(posted.statusCode, posted.body).toBe(201);
    expect(manual.statusCode, manual.body).toBe(201);
    expect(manual.headers['idempotent-replayed']).toBeUndefined();
    expect((await summary(s, '2026-09')).totals.expenseMinor).toBe(190_000);
  });
});

describe('najbliższe terminy rzadkich reguł', () => {
  it('reguła roczna 29 lutego — sześć terminów przez sześć lat, nie dwa', async () => {
    const s = await setup('2027-09-23T10:00:00.000Z');
    const created = bodyOf<{ data: { id: string } }>(
      await call(s, 'POST', '/recurring/rules', {
        name: 'Przegląd kotła',
        flow: 'expense',
        amountMinor: 30_000,
        accountId: s.ror,
        frequency: 'yearly',
        monthOfYear: 2,
        dayOfMonth: 29,
        startMonth: '2027-09',
      }),
      201,
    ).data;
    const detail = bodyOf<{ data: { upcomingDueDates: string[]; nextDueOn: string } }>(
      await call(s, 'GET', `/recurring/rules/${created.id}`),
      200,
    ).data;
    expect(detail.nextDueOn).toBe('2028-02-29');
    expect(detail.upcomingDueDates).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
      '2033-02-28',
    ]);
  });
});
