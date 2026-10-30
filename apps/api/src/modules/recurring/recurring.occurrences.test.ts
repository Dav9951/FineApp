import type {
  GenerateOccurrencesResultDto,
  RecurringOccurrenceDto,
  RecurringOccurrencesMeta,
  RecurringRuleDto,
} from '@fineapp/shared';
import { and, eq } from 'drizzle-orm';
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
import { mutableClock, type MutableClock } from '../../core/clock.js';
import { appMeta } from '../../db/schema/app-meta.js';
import { households } from '../../db/schema/households.js';
import { recurringOccurrences } from '../../db/schema/recurring.js';

/**
 * Testy wystąpień cyklicznych — zadanie `F4-2`
 * ([04 §9](../../../../../../plans/04-api-spec.md#9-pozycje-cykliczne--apiv1recurring),
 * [07 §6.2–§6.4](../../../../../../plans/07-domain-rules.md#62-generowanie-wystąpień),
 * ADR-045).
 */

/** 23 września 2026, 12:00 w Warszawie. Limit księgowania 1 → okno sierpień–wrzesień. */
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
}

/** Lista wystąpień z metadanymi. */
interface OccurrenceList {
  data: RecurringOccurrenceDto[];
  meta: RecurringOccurrencesMeta;
}

/** Kształt błędu. */
interface ErrorBody {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
}

/**
 * Aplikacja z gospodarstwem, kontem bieżącym, oszczędnościowym i kategorią.
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
  };
}

/**
 * Wysyła żądanie w imieniu gospodarstwa.
 *
 * @param s - Środowisko.
 * @param method - Metoda.
 * @param url - Ścieżka względem `/api/v1`.
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
    url: `/api/v1${url}`,
    headers: home.headers,
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
 * Pobiera wystąpienia miesiąca i oczekuje `200`.
 *
 * @param s - Środowisko.
 * @param month - Klucz miesiąca.
 * @param home - Gospodarstwo.
 * @returns Lista z metadanymi.
 */
async function occurrences(
  s: Setup,
  month: string,
  home: HouseholdFixture = s.home,
): Promise<OccurrenceList> {
  const response = await call(s, 'GET', `/recurring/occurrences?month=${month}`, undefined, home);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<OccurrenceList>();
}

/**
 * Zmienia regułę i oczekuje `200`.
 *
 * @param s - Środowisko.
 * @param id - Identyfikator reguły.
 * @param payload - Zmiany.
 */
async function patchRule(s: Setup, id: string, payload: Record<string, unknown>): Promise<void> {
  const response = await call(s, 'PATCH', `/recurring/rules/${id}`, payload);
  expect(response.statusCode, response.body).toBe(200);
}

/**
 * Wszystkie wiersze wystąpień reguły, rosnąco po terminie.
 *
 * @param s - Środowisko.
 * @param ruleId - Identyfikator reguły.
 * @returns Wiersze z bazy.
 */
function rowsOf(s: Setup, ruleId: string): (typeof recurringOccurrences.$inferSelect)[] {
  return s.app.db.db
    .select()
    .from(recurringOccurrences)
    .where(eq(recurringOccurrences.ruleId, ruleId))
    .orderBy(recurringOccurrences.dueOn)
    .all();
}

/**
 * Oznacza wystąpienie jako zaksięgowane — bez `F4-3`, wprost w bazie.
 *
 * @param s - Środowisko.
 * @param ruleId - Reguła.
 * @param dueOn - Termin.
 * @param amountMinor - Kwota zaksięgowana.
 */
function markPosted(s: Setup, ruleId: string, dueOn: string, amountMinor: number): void {
  const transactionId = insertTransaction(s.app.db, s.home, {
    bookedOn: dueOn,
    monthKey: dueOn.slice(0, 7),
    amountMinor,
    accountId: s.ror,
    source: 'recurring',
  });
  s.app.db.db
    .update(recurringOccurrences)
    .set({ status: 'posted', transactionId, postedAmountMinor: amountMinor, postedAt: Date.now() })
    .where(and(eq(recurringOccurrences.ruleId, ruleId), eq(recurringOccurrences.dueOn, dueOn)))
    .run();
}

describe('uwierzytelnienie i walidacja', () => {
  it('bez tokenu 401', async () => {
    const s = await setup();
    for (const [method, url] of [
      ['GET', '/occurrences?month=2026-09'],
      ['POST', '/generate'],
    ] as const) {
      const response = await s.app.app.inject({
        method,
        url: `${BASE}${url}`,
        headers: { 'x-requested-with': 'fineapp' },
        ...(method === 'POST' ? { payload: { month: '2026-09' } } : {}),
      });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('brak albo zły miesiąc — 400', async () => {
    const s = await setup();
    for (const url of ['/recurring/occurrences', '/recurring/occurrences?month=2026-13']) {
      expect((await call(s, 'GET', url)).statusCode, url).toBe(400);
    }
  });
});

describe('GET /recurring/occurrences — generowanie leniwe', () => {
  it('generuje całe okno: zaległy sierpień i wrześniowy termin', async () => {
    const s = await setup();
    const rule = await createRule(s, { dayOfMonth: 31 });

    const september = await occurrences(s, '2026-09');
    expect(september.data).toHaveLength(1);
    expect(september.data[0]).toMatchObject({
      ruleId: rule.id,
      ruleName: 'Czynsz',
      flow: 'expense',
      dueOn: '2026-09-30',
      monthKey: '2026-09',
      plannedAmountMinor: 185_000,
      status: 'planned',
      postedAmountMinor: null,
      transactionId: null,
      categoryId: s.rent,
      categoryName: 'Czynsz',
      allocationEffects: [],
      isFixedExpense: true,
      isOverdue: false,
      amountIsEstimate: false,
    });
    expect(september.data[0]?.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(september.meta).toEqual({
      month: '2026-09',
      isPreview: false,
      plannedTotalMinor: 185_000,
      postedTotalMinor: 0,
      remainingTotalMinor: 185_000,
      byFlow: {
        expense: { plannedMinor: 185_000, postedMinor: 0 },
        income: { plannedMinor: 0, postedMinor: 0 },
        transfer: { plannedMinor: 0, postedMinor: 0 },
      },
    });

    // Sierpnia nikt nie otwierał, a jego czynsz już jest — i jest zaległy.
    expect(rowsOf(s, rule.id).map((row) => row.dueOn)).toEqual(['2026-08-31', '2026-09-30']);
    const august = await occurrences(s, '2026-08');
    expect(august.data[0]).toMatchObject({ dueOn: '2026-08-31', isOverdue: true });
  });

  it('idempotentne: kolejne odczyty nie tworzą duplikatów ani nowych identyfikatorów', async () => {
    const s = await setup();
    const rule = await createRule(s);
    const first = await occurrences(s, '2026-09');
    const second = await occurrences(s, '2026-09');
    expect(second.data.map((item) => item.id)).toEqual(first.data.map((item) => item.id));
    expect(rowsOf(s, rule.id)).toHaveLength(2);
  });

  it('znacznik ostatniego generowania w app_meta', async () => {
    const s = await setup();
    await createRule(s);
    await occurrences(s, '2026-09');
    const meta = s.app.db.db
      .select()
      .from(appMeta)
      .where(eq(appMeta.key, 'last_recurring_generation'))
      .get();
    expect(meta?.value).toBe(String(START.getTime()));
  });

  it('reguła tygodniowa: każdy poniedziałek miesiąca, rosnąco', async () => {
    const s = await setup();
    await createRule(s, {
      name: 'Basen',
      frequency: 'weekly',
      weekday: 1,
      dayOfMonth: null,
      isFixedExpense: false,
      startMonth: '2026-09',
    });
    const { data } = await occurrences(s, '2026-09');
    expect(data.map((item) => [item.dueOn, item.isOverdue])).toEqual([
      ['2026-09-07', true],
      ['2026-09-14', true],
      ['2026-09-21', true],
      ['2026-09-28', false],
    ]);
  });

  it('wstrzymana reguła nie generuje', async () => {
    const s = await setup();
    const rule = await createRule(s);
    await call(s, 'POST', `/recurring/rules/${rule.id}/pause`);
    expect((await occurrences(s, '2026-09')).data).toEqual([]);
    expect(rowsOf(s, rule.id)).toEqual([]);
  });

  it('miesiąc zamknięty: nic nie powstaje', async () => {
    const s = await setup();
    const rule = await createRule(s, { startMonth: '2026-06' });
    expect((await occurrences(s, '2026-07')).data).toEqual([]);
    expect(rowsOf(s, rule.id).map((row) => row.monthKey)).toEqual(['2026-08', '2026-09']);
  });

  it('limit księgowania 0: tylko bieżący miesiąc', async () => {
    const s = await setup();
    s.app.db.db.update(households).set({ backPostingLimitMonths: 0 }).run();
    const rule = await createRule(s);
    await occurrences(s, '2026-09');
    expect(rowsOf(s, rule.id).map((row) => row.dueOn)).toEqual(['2026-09-10']);
  });

  it('przelew na oszczędności: przewidywany efekt alokacji z klas kont', async () => {
    const s = await setup();
    await createRule(s, {
      name: 'Na oszczędności',
      flow: 'transfer',
      amountMinor: 200_000,
      counterAccountId: s.savings,
      categoryId: null,
      isFixedExpense: false,
    });
    const { data, meta } = await occurrences(s, '2026-09');
    expect(data[0]?.allocationEffects).toEqual([{ kind: 'savings', amountMinor: 200_000 }]);
    expect(meta.byFlow.transfer).toEqual({ plannedMinor: 200_000, postedMinor: 0 });
  });

  it('nowy miesiąc: minutę po północy 1 października w Warszawie powstaje październik', async () => {
    // 30 września, 21:59 UTC = 23:59 w Warszawie; dwie minuty później jest już październik.
    const s = await setup(new Date('2026-09-30T21:59:00.000Z'));
    const rule = await createRule(s);
    expect((await occurrences(s, '2026-10')).meta.isPreview).toBe(true);
    expect(rowsOf(s, rule.id)).toEqual([]);

    s.clock.advance(2 * 60_000);
    expect((await occurrences(s, '2026-10')).meta.isPreview).toBe(false);
    // Okno przesunęło się: sierpień jest już zamknięty i nie dostaje wystąpienia.
    expect(rowsOf(s, rule.id).map((row) => row.dueOn)).toEqual(['2026-09-10', '2026-10-10']);
  });

  it('izolacja gospodarstw', async () => {
    const s = await setup();
    await createRule(s);
    const other = await householdFixture(s.app.db, testConfig(), START);
    expect((await occurrences(s, '2026-09', other)).data).toEqual([]);
  });
});

describe('GET /recurring/occurrences — miesiąc przyszły', () => {
  it('podgląd z reguł: bez identyfikatorów i bez zapisu', async () => {
    const s = await setup();
    const rule = await createRule(s, { amountIsEstimate: true });
    const { data, meta } = await occurrences(s, '2026-11');
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      id: null,
      dueOn: '2026-11-10',
      monthKey: '2026-11',
      status: 'planned',
      isOverdue: false,
      amountIsEstimate: true,
    });
    expect(meta).toMatchObject({ month: '2026-11', isPreview: true, remainingTotalMinor: 185_000 });
    expect(rowsOf(s, rule.id).some((row) => row.monthKey > '2026-09')).toBe(false);
  });
});

describe('GET /months/:key/summary — wyzwala generowanie', () => {
  it('odczyt bieżącego miesiąca zapisuje wystąpienia okna', async () => {
    const s = await setup();
    const rule = await createRule(s);
    const response = await call(s, 'GET', '/months/2026-09/summary');
    expect(response.statusCode, response.body).toBe(200);
    expect(rowsOf(s, rule.id).map((row) => row.dueOn)).toEqual(['2026-08-10', '2026-09-10']);
  });

  it('podgląd miesiąca przyszłego niczego nie zapisuje', async () => {
    const s = await setup();
    const rule = await createRule(s);
    expect((await call(s, 'GET', '/months/2026-12/summary')).statusCode).toBe(200);
    expect(rowsOf(s, rule.id)).toEqual([]);
  });
});

describe('edycja reguły — skutki dla wystąpień (07 §6.4)', () => {
  it('kwota: czekające od bieżącego miesiąca dostają nową, zaległe i zaksięgowane nie', async () => {
    const s = await setup();
    const weekly = await createRule(s, {
      name: 'Basen',
      frequency: 'weekly',
      weekday: 1,
      dayOfMonth: null,
      amountMinor: 3_000,
    });
    await occurrences(s, '2026-09');
    markPosted(s, weekly.id, '2026-09-07', 3_000);

    await patchRule(s, weekly.id, { amountMinor: 3_500 });
    const amounts = rowsOf(s, weekly.id).map((row) => [row.dueOn, row.plannedAmountMinor]);
    expect(amounts).toContainEqual(['2026-08-31', 3_000]); // zaległy z sierpnia — migawka
    expect(amounts).toContainEqual(['2026-09-07', 3_000]); // zaksięgowany
    expect(amounts).toContainEqual(['2026-09-14', 3_500]);
    expect(amounts).toContainEqual(['2026-09-28', 3_500]);
  });

  it('dzień płatności: czekający wrzesień generowany na nowo, sierpień zostaje', async () => {
    const s = await setup();
    const rule = await createRule(s);
    await occurrences(s, '2026-09');

    await patchRule(s, rule.id, { dayOfMonth: 15 });
    expect(rowsOf(s, rule.id).map((row) => row.dueOn)).toEqual(['2026-08-10', '2026-09-15']);
  });

  it('dzień płatności po zaksięgowaniu: bez drugiego czynszu w tym samym miesiącu', async () => {
    const s = await setup();
    const rule = await createRule(s);
    await occurrences(s, '2026-09');
    markPosted(s, rule.id, '2026-09-10', 185_000);

    await patchRule(s, rule.id, { dayOfMonth: 15 });
    const rows = rowsOf(s, rule.id);
    expect(rows.map((row) => [row.dueOn, row.status])).toEqual([
      ['2026-08-10', 'planned'],
      ['2026-09-10', 'posted'],
    ]);
  });

  it('koniec reguły w przeszłości: czekające po nim usuwane, zaksięgowane zostają', async () => {
    const s = await setup();
    const rule = await createRule(s, { startMonth: '2026-08' });
    await occurrences(s, '2026-09');
    markPosted(s, rule.id, '2026-08-10', 185_000);

    await patchRule(s, rule.id, { endMonth: '2026-08' });
    expect(rowsOf(s, rule.id).map((row) => [row.dueOn, row.status])).toEqual([
      ['2026-08-10', 'posted'],
    ]);
  });

  it('start przesunięty później: czekające sprzed startu usuwane', async () => {
    const s = await setup();
    const rule = await createRule(s);
    await occurrences(s, '2026-09');
    await patchRule(s, rule.id, { startMonth: '2026-09' });
    expect(rowsOf(s, rule.id).map((row) => row.dueOn)).toEqual(['2026-09-10']);
  });

  it('nazwa i kategoria: wystąpienie bierze je z reguły', async () => {
    const s = await setup();
    const rule = await createRule(s);
    await occurrences(s, '2026-09');
    await patchRule(s, rule.id, { name: 'Czynsz + media', categoryId: null });
    const { data } = await occurrences(s, '2026-09');
    expect(data[0]).toMatchObject({ ruleName: 'Czynsz + media', categoryId: null });
  });

  it('wstrzymanie: istniejące czekające zostają', async () => {
    const s = await setup();
    const rule = await createRule(s);
    await occurrences(s, '2026-09');
    await call(s, 'POST', `/recurring/rules/${rule.id}/pause`);
    expect((await occurrences(s, '2026-09')).data).toHaveLength(1);
  });

  it('wznowienie: terminy z czasu wstrzymania pominięte, bieżący miesiąc czeka', async () => {
    const s = await setup();
    const rule = await createRule(s);
    await call(s, 'POST', `/recurring/rules/${rule.id}/pause`);
    await call(s, 'POST', `/recurring/rules/${rule.id}/resume`);
    await occurrences(s, '2026-09');

    expect(rowsOf(s, rule.id).map((row) => [row.dueOn, row.status, row.skippedReason])).toEqual([
      ['2026-08-10', 'skipped', 'Reguła była wstrzymana'],
      ['2026-09-10', 'planned', null],
    ]);
    const august = await occurrences(s, '2026-08');
    expect(august.data[0]).toMatchObject({ status: 'skipped', isOverdue: false });
    expect(august.meta.plannedTotalMinor).toBe(0);
  });

  it('usunięcie reguły: wystąpienia znikają, zaksięgowana transakcja zostaje', async () => {
    const s = await setup();
    const rule = await createRule(s);
    await occurrences(s, '2026-09');
    markPosted(s, rule.id, '2026-09-10', 185_000);
    const transactionId = rowsOf(s, rule.id).find((row) => row.status === 'posted')?.transactionId;

    expect((await call(s, 'DELETE', `/recurring/rules/${rule.id}`)).statusCode).toBe(204);
    expect(rowsOf(s, rule.id)).toEqual([]);
    expect((await call(s, 'GET', `/transactions/${transactionId}`)).statusCode).toBe(200);
  });
});

describe('POST /recurring/generate', () => {
  it('generuje okno i zwraca liczbę nowych; powtórzenie — zero', async () => {
    const s = await setup();
    await createRule(s);
    const first = await call(s, 'POST', '/recurring/generate', { month: '2026-09' });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<{ data: GenerateOccurrencesResultDto }>().data).toEqual({
      month: '2026-09',
      createdCount: 2,
    });
    const again = await call(s, 'POST', '/recurring/generate', { month: '2026-08' });
    expect(again.json<{ data: GenerateOccurrencesResultDto }>().data.createdCount).toBe(0);
  });

  it('miesiąc przyszły i zamknięty — 422', async () => {
    const s = await setup();
    const future = await call(s, 'POST', '/recurring/generate', { month: '2026-10' });
    expect(future.statusCode).toBe(422);
    expect(future.json<ErrorBody>().error.message).toBe(
      'Październik 2026 to miesiąc przyszły — jego pozycje cykliczne są wyliczane z reguł, bez zapisu.',
    );
    const closed = await call(s, 'POST', '/recurring/generate', { month: '2026-07' });
    expect(closed.statusCode).toBe(422);
    expect(closed.json<ErrorBody>().error.message).toBe(
      'Lipiec 2026 jest zamknięty — nowe pozycje cykliczne powstają od 1 sierpnia 2026. Zmień limit w ustawieniach.',
    );
  });
});
