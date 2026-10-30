import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertAccount,
  insertCategory,
  insertGoal,
  insertIncomeSource,
  insertLiability,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';
import type { TransactionInsert } from '../../db/schema/transactions.js';

/**
 * Testy `GET /transactions`: filtry, wyszukiwanie, sortowanie, paginacja kursorowa — `F2-5`
 * ([04 §7](../../../../../../plans/04-api-spec.md#7-transakcje--apiv1transactions)).
 *
 * Transakcje są wstawiane fabryką, z pominięciem serwisu: test listy ma sprawdzać listę,
 * a nie okno księgowania czy walidację odwołań.
 */

/** Pozycja listy — tylko pola używane w asercjach. */
interface Item {
  id: string;
  type: string;
  bookedOn: string;
  amountMinor: number;
  createdAt: number;
  deletedAt: number | null;
  allocationEffects: { kind: string; amountMinor: number }[];
}

/** Odpowiedź listy. */
interface ListBody {
  data: Item[];
  meta: { nextCursor: string | null; hasMore: boolean };
}

const START = new Date('2026-09-23T10:00:00.000Z');
const BASE = '/api/v1/transactions';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Środowisko testu listy. */
interface Setup {
  app: TestApp;
  home: HouseholdFixture;
  ror: string;
  savings: string;
  broker: string;
}

/**
 * Buduje aplikację z gospodarstwem i trzema kontami różnych klas.
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
    savings: insertAccount(app.db, home, { type: 'savings', allocationClass: 'savings' }),
    broker: insertAccount(app.db, home, { type: 'investment', allocationClass: 'investment' }),
  };
}

/**
 * Wstawia transakcję w gospodarstwie testu.
 *
 * @param s - Środowisko testu.
 * @param overrides - Nadpisane kolumny; domyślnie wydatek 10,00 zł z ROR 10 września.
 * @returns Identyfikator.
 */
function tx(s: Setup, overrides: Partial<TransactionInsert> = {}): string {
  return insertTransaction(s.app.db, s.home, { accountId: s.ror, ...overrides });
}

/**
 * Pobiera listę.
 *
 * @param s - Środowisko testu.
 * @param query - Napis zapytania bez `?`.
 * @returns Odpowiedź.
 */
function list(s: Setup, query = ''): Promise<LightMyRequestResponse> {
  return s.app.app.inject({
    method: 'GET',
    url: `${BASE}${query ? `?${query}` : ''}`,
    headers: s.home.headers,
  });
}

/**
 * Pobiera listę i zwraca identyfikatory w kolejności odpowiedzi.
 *
 * @param s - Środowisko testu.
 * @param query - Napis zapytania bez `?`.
 * @returns Identyfikatory.
 */
async function ids(s: Setup, query = ''): Promise<string[]> {
  const response = await list(s, query);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<ListBody>().data.map((item) => item.id);
}

describe('GET /transactions — podstawy', () => {
  it('pusta lista: brak danych, brak kolejnej strony', async () => {
    const s = await setup();
    const response = await list(s);
    expect(response.statusCode).toBe(200);
    expect(response.json<ListBody>()).toEqual({
      data: [],
      meta: {
        nextCursor: null,
        hasMore: false,
        summary: { count: 0, expenseMinor: 0, incomeMinor: 0, transferMinor: 0, days: [] },
      },
    });
  });

  it('domyślnie od najnowszej daty; remis rozstrzyga identyfikator malejąco', async () => {
    const s = await setup();
    const early = tx(s, { bookedOn: '2026-09-01' });
    const sameDayFirst = tx(s, { bookedOn: '2026-09-15' });
    const sameDaySecond = tx(s, { bookedOn: '2026-09-15' });
    const late = tx(s, { bookedOn: '2026-09-20' });
    expect(await ids(s)).toEqual([late, sameDaySecond, sameDayFirst, early]);
  });

  it('pomija transakcje innego gospodarstwa i z kosza', async () => {
    const s = await setup();
    const mine = tx(s);
    const binned = tx(s, { deletedAt: START.getTime() });
    const other = await householdFixture(s.app.db, testConfig(), START);
    insertTransaction(s.app.db, other);
    expect(await ids(s)).toEqual([mine]);
    expect(await ids(s, 'includeDeleted=false')).toEqual([mine]);
    expect((await ids(s, 'includeDeleted=true')).sort()).toEqual([mine, binned].sort());
  });

  it('`uncategorized=true` — tylko transakcje bez kategorii (Z-18)', async () => {
    const s = await setup();
    const food = insertCategory(s.app.db, s.home, { name: 'Jedzenie' });
    const none = tx(s, { categoryId: null });
    tx(s, { categoryId: food });
    expect(await ids(s, 'uncategorized=true')).toEqual([none]);
    expect(await ids(s, 'uncategorized=false')).toHaveLength(2);
  });

  it('pozycja listy niesie nazwy i efekty alokacji', async () => {
    const s = await setup();
    tx(s, {
      type: 'transfer',
      counterAccountId: s.savings,
      sourceAllocationClass: 'spending',
      targetAllocationClass: 'savings',
      amountMinor: 50_000,
    });
    const [item] = (await list(s)).json<{ data: (Item & { accountName: string })[] }>().data;
    expect(item?.accountName).toBe('ROR');
    expect(item?.allocationEffects).toEqual([{ kind: 'savings', amountMinor: 50_000 }]);
  });
});

describe('GET /transactions — filtry', () => {
  it('miesiąc i zakres dat (krańce włącznie)', async () => {
    const s = await setup();
    const aug = tx(s, { bookedOn: '2026-08-31', monthKey: '2026-08' });
    const sep1 = tx(s, { bookedOn: '2026-09-01' });
    const sep30 = tx(s, { bookedOn: '2026-09-30' });
    expect(await ids(s, 'month=2026-08')).toEqual([aug]);
    expect(await ids(s, 'month=2026-09')).toEqual([sep30, sep1]);
    expect(await ids(s, 'from=2026-08-31&to=2026-09-01')).toEqual([sep1, aug]);
    expect(await ids(s, 'from=2026-09-30')).toEqual([sep30]);
    expect(await ids(s, 'to=2026-08-31')).toEqual([aug]);
  });

  it('typ — pojedynczy i powtórzony', async () => {
    const s = await setup();
    const expense = tx(s, { bookedOn: '2026-09-03' });
    const income = tx(s, { type: 'income', bookedOn: '2026-09-02' });
    tx(s, {
      type: 'transfer',
      counterAccountId: s.savings,
      sourceAllocationClass: 'spending',
      targetAllocationClass: 'savings',
      bookedOn: '2026-09-01',
    });
    expect(await ids(s, 'type=income')).toEqual([income]);
    expect(await ids(s, 'type=expense&type=income')).toEqual([expense, income]);
  });

  it('konto łapie obie strony przelewu', async () => {
    const s = await setup();
    const out = tx(s, { accountId: s.savings, bookedOn: '2026-09-03' });
    const incoming = tx(s, {
      type: 'transfer',
      counterAccountId: s.savings,
      sourceAllocationClass: 'spending',
      targetAllocationClass: 'savings',
      bookedOn: '2026-09-02',
    });
    tx(s, { bookedOn: '2026-09-01' });
    expect(await ids(s, `accountId=${s.savings}`)).toEqual([out, incoming]);
  });

  it('kategoria, cel, zobowiązanie, źródło przychodu, pochodzenie', async () => {
    const s = await setup();
    const category = insertCategory(s.app.db, s.home);
    const goal = insertGoal(s.app.db, s.home);
    const liability = insertLiability(s.app.db, s.home);
    const source = insertIncomeSource(s.app.db, s.home);
    const withCategory = tx(s, { categoryId: category });
    const withGoal = tx(s, { goalId: goal });
    const withLiability = tx(s, { liabilityId: liability });
    const withSource = tx(s, { type: 'income', incomeSourceId: source });
    const fromOcr = tx(s, { source: 'ocr' });
    expect(await ids(s, `categoryId=${category}`)).toEqual([withCategory]);
    expect(await ids(s, `goalId=${goal}`)).toEqual([withGoal]);
    expect(await ids(s, `liabilityId=${liability}`)).toEqual([withLiability]);
    expect(await ids(s, `incomeSourceId=${source}`)).toEqual([withSource]);
    expect(await ids(s, 'source=ocr')).toEqual([fromOcr]);
  });

  it('zakres kwot (krańce włącznie)', async () => {
    const s = await setup();
    const small = tx(s, { amountMinor: 100, bookedOn: '2026-09-03' });
    const middle = tx(s, { amountMinor: 5_000, bookedOn: '2026-09-02' });
    tx(s, { amountMinor: 90_000, bookedOn: '2026-09-01' });
    expect(await ids(s, 'minAmountMinor=100&maxAmountMinor=5000')).toEqual([small, middle]);
    expect(await ids(s, 'minAmountMinor=5001')).toHaveLength(1);
  });

  it('wyszukiwanie: opis, sprzedawca i notatki, bez względu na wielkość liter i ogonki', async () => {
    const s = await setup();
    const shop = tx(s, { merchant: 'Żabka', bookedOn: '2026-09-03' });
    const note = tx(s, { notes: 'z ŻABKI przy pracy', bookedOn: '2026-09-02' });
    const described = tx(s, { description: 'Łódź — bilet', bookedOn: '2026-09-01' });
    tx(s, { description: 'Lidl' });
    expect(await ids(s, 'q=zabk')).toEqual([shop, note]);
    expect(await ids(s, `q=${encodeURIComponent('żabka')}`)).toEqual([shop]);
    expect(await ids(s, 'q=lodz')).toEqual([described]);
    expect(await ids(s, `q=${encodeURIComponent('  ')}`)).toHaveLength(4);
  });

  it('wyszukiwanie traktuje `%` i `_` dosłownie', async () => {
    const s = await setup();
    const percent = tx(s, { description: 'Rabat 50%' });
    tx(s, { description: 'Rabat 50 zł' });
    expect(await ids(s, `q=${encodeURIComponent('50%')}`)).toEqual([percent]);
    expect(await ids(s, 'q=_')).toEqual([]);
  });
});

describe('GET /transactions — filtr puli zgodny z `allocationEffects`', () => {
  it('dla każdej kombinacji klas i nadpisań lista po puli = transakcje z efektem w tej puli', async () => {
    const s = await setup();
    const classes = ['spending', 'savings', 'investment'] as const;
    const overrides = [null, 'none', 'savings', 'investment'] as const;
    for (const source of classes) {
      for (const target of classes) {
        for (const allocationOverride of overrides) {
          tx(s, {
            type: 'transfer',
            accountId: s.ror,
            counterAccountId: s.savings,
            sourceAllocationClass: source,
            targetAllocationClass: target,
            allocationOverride,
          });
        }
      }
    }
    const liability = insertLiability(s.app.db, s.home);
    tx(s, { liabilityId: liability });
    tx(s, { liabilityId: liability, allocationOverride: 'none' });
    tx(s);
    tx(s, { type: 'income', liabilityId: liability });

    const all = (await list(s, 'limit=200')).json<ListBody>().data;
    for (const kind of ['savings', 'investment', 'debt_repayment'] as const) {
      const expected = all
        .filter((item) => item.allocationEffects.some((effect) => effect.kind === kind))
        .map((item) => item.id);
      expect(expected.length, kind).toBeGreaterThan(0);
      expect(await ids(s, `allocationKind=${kind}&limit=200`), kind).toEqual(expected);
    }
    const both = await ids(s, 'allocationKind=savings&allocationKind=debt_repayment&limit=200');
    expect(both).toEqual(
      all
        .filter((item) =>
          item.allocationEffects.some((e) => e.kind === 'savings' || e.kind === 'debt_repayment'),
        )
        .map((item) => item.id),
    );
  });
});

describe('GET /transactions — paginacja kursorowa', () => {
  /**
   * Przechodzi całą listę stronami.
   *
   * @param s - Środowisko testu.
   * @param query - Parametry bez `limit` i `cursor`.
   * @param limit - Rozmiar strony.
   * @returns Identyfikatory ze wszystkich stron i rozmiary stron.
   */
  async function walk(
    s: Setup,
    query: string,
    limit: number,
  ): Promise<{ all: string[]; sizes: number[] }> {
    const all: string[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    do {
      const suffix: string = cursor === null ? '' : `&cursor=${cursor}`;
      const body: ListBody = (await list(s, `${query}&limit=${String(limit)}${suffix}`)).json();
      all.push(...body.data.map((item) => item.id));
      sizes.push(body.data.length);
      expect(body.meta.hasMore).toBe(body.meta.nextCursor !== null);
      cursor = body.meta.nextCursor;
    } while (cursor !== null);
    return { all, sizes };
  }

  it.each(['bookedOn:desc', 'bookedOn:asc', 'amount:desc', 'amount:asc', 'createdAt:desc'])(
    '%s: strony składają się w pełną listę bez dziur i powtórzeń, także przy remisach',
    async (sort) => {
      const s = await setup();
      // Remisy dat, kwot i znaczników utworzenia — dokładnie tam gubi się OFFSET.
      const rows: Partial<TransactionInsert>[] = [
        { bookedOn: '2026-09-05', amountMinor: 700, createdAt: 3 },
        { bookedOn: '2026-09-05', amountMinor: 700, createdAt: 3 },
        { bookedOn: '2026-09-05', amountMinor: 200, createdAt: 1 },
        { bookedOn: '2026-09-01', amountMinor: 900, createdAt: 2 },
        { bookedOn: '2026-09-09', amountMinor: 700, createdAt: 3 },
        { bookedOn: '2026-09-09', amountMinor: 100, createdAt: 5 },
        { bookedOn: '2026-09-01', amountMinor: 300, createdAt: 4 },
      ];
      for (const row of rows) tx(s, row);

      const full = await ids(s, `sort=${sort}&limit=200`);
      expect(full).toHaveLength(rows.length);
      const { all, sizes } = await walk(s, `sort=${sort}`, 3);
      expect(all).toEqual(full);
      expect(sizes).toEqual([3, 3, 1]);
    },
  );

  it('sortowanie po kwocie i po dacie daje oczekiwaną kolejność', async () => {
    const s = await setup();
    const a = tx(s, { amountMinor: 300, bookedOn: '2026-09-02' });
    const b = tx(s, { amountMinor: 100, bookedOn: '2026-09-03' });
    const c = tx(s, { amountMinor: 200, bookedOn: '2026-09-01' });
    expect(await ids(s, 'sort=amount:desc')).toEqual([a, c, b]);
    expect(await ids(s, 'sort=amount:asc')).toEqual([b, c, a]);
    expect(await ids(s, 'sort=bookedOn:asc')).toEqual([c, a, b]);
  });

  it('pełna ostatnia strona: `hasMore` fałsz bez pustej strony na końcu', async () => {
    const s = await setup();
    tx(s);
    tx(s);
    const body = (await list(s, 'limit=2')).json<ListBody>();
    expect(body.data).toHaveLength(2);
    expect(body.meta).toMatchObject({ nextCursor: null, hasMore: false });
  });

  it('kursor z innego sortowania albo uszkodzony → 400', async () => {
    const s = await setup();
    tx(s);
    tx(s);
    const { meta } = (await list(s, 'limit=1&sort=amount:desc')).json<ListBody>();
    expect(meta.nextCursor).not.toBeNull();
    const wrongSort = await list(s, `limit=1&cursor=${meta.nextCursor ?? ''}`);
    expect(wrongSort.statusCode).toBe(400);
    expect((await list(s, 'cursor=zepsuty')).statusCode).toBe(400);
  });
});

describe('GET /transactions — walidacja parametrów', () => {
  it.each([
    ['miesiąc z zakresem', 'month=2026-09&from=2026-09-01'],
    ['odwrócony zakres', 'from=2026-09-10&to=2026-09-01'],
    ['odwrócone kwoty', 'minAmountMinor=500&maxAmountMinor=100'],
    ['zły miesiąc', 'month=2026-13'],
    ['zły identyfikator', 'accountId=abc'],
    ['nieznane sortowanie', 'sort=merchant:asc'],
    ['limit 0', 'limit=0'],
    ['includeDeleted spoza literałów', 'includeDeleted=yes'],
    ['bez kategorii razem z kategorią', 'uncategorized=true&categoryId=01JB0000000000000000000001'],
  ])('%s → 400', async (_label, query) => {
    const s = await setup();
    expect((await list(s, query)).statusCode).toBe(400);
  });
});

/** Podsumowanie listy — tylko pola używane w asercjach. */
interface Summary {
  count: number;
  expenseMinor: number;
  incomeMinor: number;
  transferMinor: number;
  days: { bookedOn: string; expenseMinor: number; incomeMinor: number }[];
}

/**
 * Pobiera podsumowanie z pierwszej strony listy.
 *
 * @param s - Środowisko testu.
 * @param query - Napis zapytania bez `?`.
 * @returns Podsumowanie albo `undefined`, gdy odpowiedź go nie niesie.
 */
async function summaryOf(s: Setup, query = ''): Promise<Summary | undefined> {
  const response = await list(s, query);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ meta: { summary?: Summary } }>().meta.summary;
}

describe('GET /transactions — podsumowanie (ADR-038)', () => {
  it('sumy per typ i per dzień, dni od najnowszego; przelew nie jest wydatkiem', async () => {
    const s = await setup();
    tx(s, { bookedOn: '2026-09-18', amountMinor: 12_799 });
    tx(s, { bookedOn: '2026-09-18', amountMinor: 9_999 });
    tx(s, { bookedOn: '2026-09-15', amountMinor: 185_000 });
    tx(s, { type: 'income', bookedOn: '2026-09-15', amountMinor: 980_000 });
    tx(s, {
      type: 'transfer',
      bookedOn: '2026-09-11',
      counterAccountId: s.savings,
      sourceAllocationClass: 'spending',
      targetAllocationClass: 'savings',
      amountMinor: 200_000,
    });

    expect(await summaryOf(s, 'month=2026-09')).toEqual({
      count: 5,
      expenseMinor: 207_798,
      incomeMinor: 980_000,
      transferMinor: 200_000,
      days: [
        { bookedOn: '2026-09-18', expenseMinor: 22_798, incomeMinor: 0 },
        { bookedOn: '2026-09-15', expenseMinor: 185_000, incomeMinor: 980_000 },
        { bookedOn: '2026-09-11', expenseMinor: 0, incomeMinor: 0 },
      ],
    });
  });

  it('liczy ten sam zestaw co lista — filtry zawężają także sumy', async () => {
    const s = await setup();
    tx(s, { amountMinor: 1_000 });
    tx(s, { type: 'income', amountMinor: 5_000 });
    tx(s, { bookedOn: '2026-08-31', monthKey: '2026-08', amountMinor: 7_000 });

    const expenses = await summaryOf(s, 'month=2026-09&type=expense');
    expect(expenses).toMatchObject({ count: 1, expenseMinor: 1_000, incomeMinor: 0 });
    const august = await summaryOf(s, 'month=2026-08');
    expect(august).toMatchObject({ count: 1, expenseMinor: 7_000 });
    expect(await summaryOf(s, 'minAmountMinor=2000')).toMatchObject({
      count: 2,
      expenseMinor: 7_000,
      incomeMinor: 5_000,
    });
  });

  it('kosz pokazany na liście liczy się do liczby, ale nie do sum', async () => {
    const s = await setup();
    tx(s, { amountMinor: 1_000 });
    tx(s, { amountMinor: 50_000, deletedAt: START.getTime() });

    expect(await summaryOf(s)).toMatchObject({ count: 1, expenseMinor: 1_000 });
    expect(await summaryOf(s, 'includeDeleted=true')).toMatchObject({
      count: 2,
      expenseMinor: 1_000,
      days: [{ bookedOn: '2026-09-10', expenseMinor: 1_000, incomeMinor: 0 }],
    });
  });

  it('wyłącznie `posted` wchodzi do sum', async () => {
    const s = await setup();
    tx(s, { amountMinor: 1_000 });
    tx(s, { amountMinor: 2_000, status: 'pending' });
    tx(s, { amountMinor: 4_000, status: 'void' });
    expect(await summaryOf(s)).toMatchObject({ count: 3, expenseMinor: 1_000 });
  });

  it('kolejna strona nie niesie podsumowania', async () => {
    const s = await setup();
    tx(s, { bookedOn: '2026-09-01' });
    tx(s, { bookedOn: '2026-09-02' });
    const first = await list(s, 'limit=1');
    const body = first.json<ListBody & { meta: { summary?: Summary } }>();
    expect(body.meta.summary?.count).toBe(2);
    const cursor = body.meta.nextCursor ?? '';
    const second = await list(s, `limit=1&cursor=${encodeURIComponent(cursor)}`);
    expect(second.json<{ meta: Record<string, unknown> }>().meta).not.toHaveProperty('summary');
  });

  it('nie liczy transakcji innego gospodarstwa', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    insertTransaction(s.app.db, other, { amountMinor: 99_999 });
    expect(await summaryOf(s)).toMatchObject({ count: 0, expenseMinor: 0, days: [] });
  });
});
