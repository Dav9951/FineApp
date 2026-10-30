import type { LightMyRequestResponse } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  CSRF_HEADER,
  householdFixture,
  insertBudgetDraft,
  insertBudgetLine,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';
import { newId } from '../../core/id.js';
import { budgetDraftLines } from '../../db/schema/budget.js';
import { recurringRules } from '../../db/schema/recurring.js';
import { transactions } from '../../db/schema/transactions.js';
import { seedDatabase } from '../../db/seed/index.js';

/**
 * Testy tras kategorii — zadanie `F2-3`
 * ([04 §6](../../../../../../plans/04-api-spec.md#6-kategorie--apiv1categories),
 * [07 §9](../../../../../../plans/07-domain-rules.md#9-kategoryzacja)).
 *
 * Pilnują I-9, I-10, I-11, zgodności rodzaju, scalania i zakresu gospodarstwa.
 */

/** Kategoria w kształcie odpowiedzi. */
interface CategoryBody {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  kind: string;
  aiHints: string | null;
  isSystem: boolean;
  isArchived: boolean;
  sortOrder: number;
}

/** Węzeł drzewa. */
interface TreeBody extends CategoryBody {
  children: CategoryBody[];
}

/** Kształt odpowiedzi błędu. */
interface ErrorBody {
  error: { code: string; message: string };
}

const START = new Date('2026-09-23T10:00:00.000Z');
const BASE = '/api/v1/categories';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Aplikacja z gospodarstwem. */
interface Setup {
  app: TestApp;
  home: HouseholdFixture;
}

/**
 * Buduje aplikację z gospodarstwem, opcjonalnie z kategoriami domyślnymi.
 *
 * @param seeded - Czy wstawić 94 kategorie domyślne (03 §5).
 * @returns Aplikacja i gospodarstwo.
 */
async function setup(seeded = false): Promise<Setup> {
  const app = await buildTestApp({}, mutableClock(START));
  harness = app;
  const home = await householdFixture(app.db, testConfig(), START);
  // Seed wybiera pierwsze gospodarstwo w bazie — to z fabryki.
  if (seeded) seedDatabase(app.db, testConfig(), START.getTime());
  return { app, home };
}

/**
 * Wysyła żądanie w imieniu gospodarstwa.
 *
 * @param s - Aplikacja.
 * @param method - Metoda HTTP.
 * @param url - Ścieżka względem `/api/v1/categories`.
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
 * Zakłada kategorię i zwraca ją.
 *
 * @param s - Aplikacja.
 * @param body - Pola nadpisujące minimalną kategorię wydatku.
 * @param home - Gospodarstwo.
 * @returns Kategoria.
 */
async function create(
  s: Setup,
  body: Record<string, unknown> = {},
  home: HouseholdFixture = s.home,
): Promise<CategoryBody> {
  const response = await call(s, 'POST', '', { name: 'Kawa', kind: 'expense', ...body }, home);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: CategoryBody }>().data;
}

/**
 * Zwraca drzewo.
 *
 * @param s - Aplikacja.
 * @param query - Ciąg zapytania.
 * @returns Drzewo kategorii.
 */
async function tree(s: Setup, query = ''): Promise<TreeBody[]> {
  const response = await call(s, 'GET', query);
  expect(response.statusCode).toBe(200);
  return response.json<{ data: TreeBody[] }>().data;
}

/**
 * Znajduje kategorię systemową po slugu.
 *
 * @param s - Aplikacja.
 * @param slug - Slug.
 * @param kind - Rodzaj.
 * @returns Kategoria.
 */
async function bySlug(s: Setup, slug: string, kind = 'expense'): Promise<CategoryBody> {
  const response = await call(s, 'GET', `/flat?kind=${kind}&includeArchived=true`);
  const found = response.json<{ data: CategoryBody[] }>().data.find((row) => row.slug === slug);
  if (found === undefined) throw new Error(`brak kategorii ${slug}`);
  return found;
}

/**
 * Status odpowiedzi i kod błędu.
 *
 * @param response - Odpowiedź.
 * @returns Para status i kod.
 */
function failure(response: LightMyRequestResponse): [number, string] {
  return [response.statusCode, response.json<ErrorBody>().error.code];
}

describe('uwierzytelnienie', () => {
  it('każda trasa bez tokenu daje 401', async () => {
    const s = await setup();
    const id = '01J9ZQK8WQ0000000000000000';
    const routes: ['GET' | 'POST' | 'PATCH' | 'DELETE', string][] = [
      ['GET', ''],
      ['GET', '/flat'],
      ['GET', '/usage?month=2026-09'],
      ['POST', ''],
      ['PATCH', `/${id}`],
      ['POST', `/${id}/archive`],
      ['POST', `/${id}/unarchive`],
      ['POST', `/${id}/merge`],
      ['DELETE', `/${id}`],
    ];
    for (const [method, url] of routes) {
      const response = await s.app.app.inject({
        method,
        url: `${BASE}${url}`,
        headers: CSRF_HEADER,
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('GET /categories i /categories/flat', () => {
  it('drzewo kategorii domyślnych: 33 główne, 61 podkategorii, filtr rodzaju', async () => {
    const s = await setup(true);
    const all = await tree(s);
    expect(all).toHaveLength(33);
    expect(all.flatMap((node) => node.children)).toHaveLength(61);
    expect((await tree(s, '?kind=income')).every((node) => node.kind === 'income')).toBe(true);
  });

  it('lista płaska stawia podkategorie zaraz za rodzicem', async () => {
    const s = await setup(true);
    const flat = (await call(s, 'GET', '/flat?kind=expense')).json<{ data: CategoryBody[] }>().data;
    const food = flat.findIndex((row) => row.slug === 'jedzenie');
    expect(flat[food + 1]?.parentId).toBe(flat[food]?.id);
  });

  it('nie pokazuje kategorii innego gospodarstwa', async () => {
    const s = await setup(true);
    const other = await householdFixture(s.app.db, testConfig(), START);
    expect(await tree({ ...s, home: other })).toEqual([]);
  });
});

describe('POST /categories', () => {
  it('zakłada kategorię główną na końcu rodzeństwa, z Location', async () => {
    const s = await setup();
    await create(s, { name: 'Pierwsza' });
    const response = await call(s, 'POST', '', {
      name: 'Kawa na mieście',
      kind: 'expense',
      aiHints: 'Starbucks, Costa',
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ data: CategoryBody }>().data;
    expect(response.headers.location).toBe(`${BASE}/${body.id}`);
    expect(body).toMatchObject({
      slug: 'kawa-na-miescie',
      parentId: null,
      isSystem: false,
      sortOrder: 1,
      aiHints: 'Starbucks, Costa',
    });
  });

  it('podkategoria dostaje slug z prefiksem rodzica', async () => {
    const s = await setup(true);
    const food = await bySlug(s, 'jedzenie');
    const coffee = await create(s, { name: 'Bubble tea', parentId: food.id });
    expect(coffee).toMatchObject({ parentId: food.id, slug: 'jedzenie-bubble-tea' });
  });

  it('podkategoria podkategorii łamie I-11 — 422', async () => {
    const s = await setup(true);
    const groceries = await bySlug(s, 'jedzenie-zakupy-spozywcze');
    expect(
      failure(await call(s, 'POST', '', { name: 'X', kind: 'expense', parentId: groceries.id })),
    ).toEqual([422, 'DOMAIN_RULE_VIOLATION']);
  });

  it('rodzic innego rodzaju albo zarchiwizowany — 422', async () => {
    const s = await setup(true);
    const salary = await bySlug(s, 'wynagrodzenie', 'income');
    expect(
      failure(await call(s, 'POST', '', { name: 'X', kind: 'expense', parentId: salary.id }))[0],
    ).toBe(422);

    const pets = await bySlug(s, 'zwierzeta');
    await call(s, 'POST', `/${pets.id}/archive`);
    expect(
      failure(await call(s, 'POST', '', { name: 'X', kind: 'expense', parentId: pets.id }))[0],
    ).toBe(422);
  });

  it('rodzic z innego gospodarstwa — 404', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = await create(s, { name: 'Obca' }, other);
    expect(
      failure(await call(s, 'POST', '', { name: 'X', kind: 'expense', parentId: foreign.id })),
    ).toEqual([404, 'NOT_FOUND']);
  });

  it('nazwa zajęta wśród rodzeństwa bez względu na wielkość liter — 409', async () => {
    const s = await setup(true);
    const response = await call(s, 'POST', '', { name: 'JEDZENIE', kind: 'expense' });
    expect(failure(response)).toEqual([409, 'CONFLICT']);
  });

  it('nazwa zajęta przez kategorię w archiwum — 409 z podpowiedzią przywrócenia', async () => {
    const s = await setup();
    const old = await create(s, { name: 'Siłownia' });
    await call(s, 'POST', `/${old.id}/archive`);
    const response = await call(s, 'POST', '', { name: 'siłownia', kind: 'expense' });
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.message).toContain('przywróć');
  });

  it('ta sama nazwa pod innym rodzicem albo w innym rodzaju jest dozwolona', async () => {
    const s = await setup(true);
    // „Transport" jest już kategorią główną i podkategorią „Podróży" (ADR-020) —
    // pod trzecim rodzicem wciąż jest wolny.
    const holidays = await create(s, { name: 'Wakacje' });
    expect((await create(s, { name: 'Transport', parentId: holidays.id })).slug).toBe(
      'wakacje-transport',
    );
    expect((await create(s, { name: 'Jedzenie', kind: 'income' })).kind).toBe('income');
  });

  it('slug zajęty przez przemianowaną kategorię dostaje przyrostek', async () => {
    const s = await setup();
    const coffee = await create(s, { name: 'Kawa' });
    await call(s, 'PATCH', `/${coffee.id}`, { name: 'Kawiarnie' });
    expect((await create(s, { name: 'Kawa' })).slug).toBe('kawa-2');
  });
});

describe('PATCH /categories/:id', () => {
  it('zmiana nazwy systemowej kategorii nie zmienia sluga (ADR-033)', async () => {
    const s = await setup(true);
    const food = await bySlug(s, 'jedzenie');
    const response = await call(s, 'PATCH', `/${food.id}`, { name: 'Żywność', aiHints: 'Lidl' });
    expect(response.json<{ data: CategoryBody }>().data).toMatchObject({
      name: 'Żywność',
      slug: 'jedzenie',
      aiHints: 'Lidl',
      isSystem: true,
    });
  });

  it('przeniesienie podkategorii pod innego rodzica stawia ją na końcu', async () => {
    const s = await setup();
    const a = await create(s, { name: 'A' });
    const b = await create(s, { name: 'B' });
    await create(s, { name: 'b1', parentId: b.id });
    const a1 = await create(s, { name: 'a1', parentId: a.id });

    const moved = (await call(s, 'PATCH', `/${a1.id}`, { parentId: b.id })).json<{
      data: CategoryBody;
    }>().data;
    expect(moved).toMatchObject({ parentId: b.id, sortOrder: 1, slug: 'a-a1' });
  });

  it('przeniesienie na poziom główny', async () => {
    const s = await setup();
    const a = await create(s, { name: 'A' });
    const a1 = await create(s, { name: 'a1', parentId: a.id });
    const moved = (await call(s, 'PATCH', `/${a1.id}`, { parentId: null })).json<{
      data: CategoryBody;
    }>().data;
    expect(moved.parentId).toBeNull();
  });

  it('przeniesienie pod siebie, pod podkategorię i rodzica z dziećmi — 422', async () => {
    const s = await setup();
    const a = await create(s, { name: 'A' });
    const a1 = await create(s, { name: 'a1', parentId: a.id });
    const b = await create(s, { name: 'B' });

    expect(failure(await call(s, 'PATCH', `/${b.id}`, { parentId: b.id }))[0]).toBe(422);
    expect(failure(await call(s, 'PATCH', `/${b.id}`, { parentId: a1.id }))[0]).toBe(422);
    expect(failure(await call(s, 'PATCH', `/${a.id}`, { parentId: b.id }))[0]).toBe(422);
  });

  it('nazwa zajęta w docelowym rodzeństwie — 409', async () => {
    const s = await setup();
    const a = await create(s, { name: 'A' });
    const b = await create(s, { name: 'B' });
    await create(s, { name: 'Wspólna', parentId: b.id });
    const mine = await create(s, { name: 'Wspólna', parentId: a.id });
    expect(failure(await call(s, 'PATCH', `/${mine.id}`, { parentId: b.id }))[0]).toBe(409);
  });

  it('zmiana wielkości liter własnej nazwy nie jest konfliktem', async () => {
    const s = await setup();
    const coffee = await create(s, { name: 'kawa' });
    expect((await call(s, 'PATCH', `/${coffee.id}`, { name: 'Kawa' })).statusCode).toBe(200);
  });

  it('puste PATCH i kind w ciele niczego nie zmieniają', async () => {
    const s = await setup();
    const coffee = await create(s);
    const response = await call(s, 'PATCH', `/${coffee.id}`, { kind: 'income' });
    expect(response.json<{ data: CategoryBody }>().data.kind).toBe('expense');
  });

  it('kategoria innego gospodarstwa — 404', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = await create(s, {}, other);
    expect(failure(await call(s, 'PATCH', `/${foreign.id}`, { name: 'X' }))[0]).toBe(404);
  });
});

describe('archiwizacja', () => {
  it('rodzic zabiera dzieci; przywrócenie rodzica dzieci nie przywraca', async () => {
    const s = await setup();
    const a = await create(s, { name: 'A' });
    const a1 = await create(s, { name: 'a1', parentId: a.id });

    await call(s, 'POST', `/${a.id}/archive`);
    expect(await tree(s)).toEqual([]);

    await call(s, 'POST', `/${a.id}/unarchive`);
    const [node] = await tree(s);
    expect(node?.children).toEqual([]);
    expect((await tree(s, '?includeArchived=true'))[0]?.children[0]).toMatchObject({
      id: a1.id,
      isArchived: true,
    });
  });

  it('przywrócenie dziecka przywraca rodzica', async () => {
    const s = await setup();
    const a = await create(s, { name: 'A' });
    const a1 = await create(s, { name: 'a1', parentId: a.id });
    await call(s, 'POST', `/${a.id}/archive`);

    await call(s, 'POST', `/${a1.id}/unarchive`);
    expect((await tree(s)).map((node) => [node.id, node.children.map((c) => c.id)])).toEqual([
      [a.id, [a1.id]],
    ]);
  });

  it('jest idempotentna i działa dla kategorii systemowych', async () => {
    const s = await setup(true);
    const pets = await bySlug(s, 'zwierzeta');
    expect((await call(s, 'POST', `/${pets.id}/archive`)).statusCode).toBe(200);
    const again = await call(s, 'POST', `/${pets.id}/archive`);
    expect(again.json<{ data: CategoryBody }>().data.isArchived).toBe(true);
  });

  it('kategoria innego gospodarstwa — 404', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = await create(s, {}, other);
    expect((await call(s, 'POST', `/${foreign.id}/archive`)).statusCode).toBe(404);
    expect((await call(s, 'POST', `/${foreign.id}/unarchive`)).statusCode).toBe(404);
  });
});

describe('DELETE /categories/:id', () => {
  it('usuwa kategorię własną bez historii — 204', async () => {
    const s = await setup();
    const coffee = await create(s);
    expect((await call(s, 'DELETE', `/${coffee.id}`)).statusCode).toBe(204);
    expect(await tree(s, '?includeArchived=true')).toEqual([]);
  });

  it('systemowej nie usuwa nigdy — 422 (I-9)', async () => {
    const s = await setup(true);
    const pets = await bySlug(s, 'zwierzeta-karma');
    const response = await call(s, 'DELETE', `/${pets.id}`);
    expect(failure(response)).toEqual([422, 'DOMAIN_RULE_VIOLATION']);
    expect(response.json<ErrorBody>().error.message).toContain('zarchiwizować');
  });

  it('kategoria z podkategoriami — 409', async () => {
    const s = await setup();
    const a = await create(s, { name: 'A' });
    await create(s, { name: 'a1', parentId: a.id });
    expect(failure(await call(s, 'DELETE', `/${a.id}`))).toEqual([409, 'CONFLICT']);
  });

  it('kategoria z transakcją, także miękko usuniętą — 409 (I-10)', async () => {
    const s = await setup();
    const used = await create(s, { name: 'Używana' });
    insertTransaction(s.app.db, s.home, { categoryId: used.id });
    expect(failure(await call(s, 'DELETE', `/${used.id}`))).toEqual([409, 'CONFLICT']);

    const binned = await create(s, { name: 'W koszu' });
    insertTransaction(s.app.db, s.home, { categoryId: binned.id, deletedAt: START.getTime() });
    expect((await call(s, 'DELETE', `/${binned.id}`)).statusCode).toBe(409);
  });

  it('kategoria innego gospodarstwa — 404', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = await create(s, {}, other);
    expect((await call(s, 'DELETE', `/${foreign.id}`)).statusCode).toBe(404);
  });
});

describe('POST /categories/:id/merge', () => {
  it('przepina transakcje (także z kosza) i reguły, łączy podpowiedzi, archiwizuje źródło', async () => {
    const s = await setup();
    const target = await create(s, { name: 'Restauracje', aiHints: 'Costa' });
    const source = await create(s, { name: 'Kawa', aiHints: 'Starbucks, costa' });
    const live = insertTransaction(s.app.db, s.home, { categoryId: source.id });
    const binned = insertTransaction(s.app.db, s.home, {
      categoryId: source.id,
      deletedAt: START.getTime(),
    });
    const ruleId = newId();
    s.app.db.db
      .insert(recurringRules)
      .values({
        id: ruleId,
        householdId: s.home.householdId,
        name: 'Kawa co miesiąc',
        flow: 'expense',
        amountMinor: 3_000,
        categoryId: source.id,
        frequency: 'monthly',
        anchorDate: '2026-09-01',
        startMonth: '2026-09',
        createdAt: START.getTime(),
        updatedAt: START.getTime(),
      })
      .run();

    const response = await call(s, 'POST', `/${source.id}/merge`, { targetCategoryId: target.id });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response.json<{ data: { target: CategoryBody; transactionsMoved: number } }>().data,
    ).toMatchObject({
      target: { id: target.id, aiHints: 'Costa, Starbucks' },
      transactionsMoved: 2,
    });

    const categoryOf = (id: string): string | null | undefined =>
      s.app.db.db.select().from(transactions).where(eq(transactions.id, id)).get()?.categoryId;
    expect([categoryOf(live), categoryOf(binned)]).toEqual([target.id, target.id]);
    expect(
      s.app.db.db.select().from(recurringRules).where(eq(recurringRules.id, ruleId)).get()
        ?.categoryId,
    ).toBe(target.id);
    expect((await bySlug(s, 'kawa')).isArchived).toBe(true);
  });

  it('przepina linie szkiców budżetu z tej kategorii (ADR-079)', async () => {
    const s = await setup();
    const target = await create(s, { name: 'Restauracje' });
    const source = await create(s, { name: 'Kawa' });
    const draftId = insertBudgetDraft(s.app.db, s.home, '2026-10');
    const lineId = insertBudgetLine(s.app.db, s.home, draftId, {
      name: 'Kawa na mieście',
      categoryId: source.id,
    });
    const otherLineId = insertBudgetLine(s.app.db, s.home, draftId, { name: 'Bez kategorii' });

    const response = await call(s, 'POST', `/${source.id}/merge`, { targetCategoryId: target.id });
    expect(response.statusCode, response.body).toBe(200);

    const categoryOf = (id: string): string | null | undefined =>
      s.app.db.db.select().from(budgetDraftLines).where(eq(budgetDraftLines.id, id)).get()
        ?.categoryId;
    expect(categoryOf(lineId)).toBe(target.id);
    expect(categoryOf(otherLineId)).toBeNull();
  });

  it('można scalić kategorię własną w systemową', async () => {
    const s = await setup(true);
    const mine = await create(s, { name: 'Moje zakupy' });
    const food = await bySlug(s, 'jedzenie');
    expect(
      (await call(s, 'POST', `/${mine.id}/merge`, { targetCategoryId: food.id })).statusCode,
    ).toBe(200);
  });

  it('łamanie reguł z 07 §9.3 — 422', async () => {
    const s = await setup(true);
    const food = await bySlug(s, 'jedzenie');
    const mine = await create(s, { name: 'Moje' });
    const withChild = await create(s, { name: 'Rodzic' });
    await create(s, { name: 'Dziecko', parentId: withChild.id });
    const salary = await bySlug(s, 'wynagrodzenie', 'income');
    const archived = await create(s, { name: 'Stara' });
    await call(s, 'POST', `/${archived.id}/archive`);

    const cases: [string, string][] = [
      [mine.id, mine.id], // sama w siebie
      [food.id, mine.id], // systemowa jako źródło
      [mine.id, salary.id], // inny rodzaj
      [mine.id, archived.id], // cel w archiwum
      [withChild.id, mine.id], // źródło z dziećmi
    ];
    for (const [sourceId, targetCategoryId] of cases) {
      const response = await call(s, 'POST', `/${sourceId}/merge`, { targetCategoryId });
      expect(failure(response), `${sourceId} → ${targetCategoryId}`).toEqual([
        422,
        'DOMAIN_RULE_VIOLATION',
      ]);
    }
  });

  it('cel z innego gospodarstwa — 404 i nic się nie zmienia', async () => {
    const s = await setup();
    const mine = await create(s);
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = await create(s, {}, other);
    const response = await call(s, 'POST', `/${mine.id}/merge`, { targetCategoryId: foreign.id });
    expect(failure(response)).toEqual([404, 'NOT_FOUND']);
    expect((await tree(s))[0]?.isArchived).toBe(false);
  });
});

describe('GET /categories/usage (ADR-038)', () => {
  /** Wiersz użycia. */
  interface UsageBody {
    categoryId: string;
    transactionCount: number;
    monthAmountMinor: number;
  }

  /**
   * Pobiera użycie jako mapę po identyfikatorze.
   *
   * @param s - Aplikacja.
   * @param month - Miesiąc sumy.
   * @param home - Gospodarstwo.
   * @returns Mapa identyfikator → użycie.
   */
  async function usage(
    s: Setup,
    month: string,
    home: HouseholdFixture = s.home,
  ): Promise<Map<string, UsageBody>> {
    const response = await call(s, 'GET', `/usage?month=${month}`, undefined, home);
    expect(response.statusCode, response.body).toBe(200);
    const rows = response.json<{ data: UsageBody[] }>().data;
    return new Map(rows.map((row) => [row.categoryId, row]));
  }

  it('liczy transakcje ze wszystkich miesięcy, a sumę tylko z podanego', async () => {
    const s = await setup();
    const food = await create(s, { name: 'Jedzenie' });
    insertTransaction(s.app.db, s.home, { categoryId: food.id, amountMinor: 12_799 });
    insertTransaction(s.app.db, s.home, { categoryId: food.id, amountMinor: 1_000 });
    insertTransaction(s.app.db, s.home, {
      categoryId: food.id,
      bookedOn: '2026-08-20',
      monthKey: '2026-08',
      amountMinor: 50_000,
    });

    expect((await usage(s, '2026-09')).get(food.id)).toEqual({
      categoryId: food.id,
      transactionCount: 3,
      monthAmountMinor: 13_799,
    });
    expect((await usage(s, '2026-08')).get(food.id)?.monthAmountMinor).toBe(50_000);
    expect((await usage(s, '2026-07')).get(food.id)?.monthAmountMinor).toBe(0);
  });

  it('pomija kosz i transakcje bez kategorii; do sumy tylko `posted`', async () => {
    const s = await setup();
    const food = await create(s, { name: 'Jedzenie' });
    const unused = await create(s, { name: 'Nieużywana' });
    insertTransaction(s.app.db, s.home, { categoryId: food.id, amountMinor: 1_000 });
    insertTransaction(s.app.db, s.home, { categoryId: food.id, status: 'pending' });
    insertTransaction(s.app.db, s.home, { categoryId: food.id, deletedAt: START.getTime() });
    insertTransaction(s.app.db, s.home, { categoryId: null });

    const rows = await usage(s, '2026-09');
    expect(rows.get(food.id)).toMatchObject({ transactionCount: 2, monthAmountMinor: 1_000 });
    expect(rows.has(unused.id)).toBe(false);
    expect(rows.size).toBe(1);
  });

  it('podkategoria liczona osobno, bez doliczania do rodzica', async () => {
    const s = await setup();
    const food = await create(s, { name: 'Jedzenie' });
    const coffee = await create(s, { name: 'Kawa', parentId: food.id });
    insertTransaction(s.app.db, s.home, { categoryId: coffee.id, amountMinor: 1_500 });

    const rows = await usage(s, '2026-09');
    expect(rows.has(food.id)).toBe(false);
    expect(rows.get(coffee.id)?.monthAmountMinor).toBe(1_500);
  });

  it('nie widzi transakcji innego gospodarstwa', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const theirs = await create(s, { name: 'Ich' }, other);
    insertTransaction(s.app.db, other, { categoryId: theirs.id });
    expect((await usage(s, '2026-09')).size).toBe(0);
    expect((await usage(s, '2026-09', other)).get(theirs.id)?.transactionCount).toBe(1);
  });

  it('miesiąc jest wymagany i musi być poprawny', async () => {
    const s = await setup();
    expect((await call(s, 'GET', '/usage')).statusCode).toBe(400);
    expect((await call(s, 'GET', '/usage?month=2026-13')).statusCode).toBe(400);
  });
});
