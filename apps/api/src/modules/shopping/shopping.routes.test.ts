import type {
  ClearCheckedResult,
  CreateShoppingItemResult,
  ShoppingItemDto,
  ShoppingItemsDto,
  ShoppingListDto,
  ShoppingProductDto,
} from '@fineapp/shared';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import { householdFixture, type HouseholdFixture } from '../../../test/factories.js';
import { mutableClock, type MutableClock } from '../../core/clock.js';
import { newId } from '../../core/id.js';
import { households } from '../../db/schema/households.js';
import { shoppingImports, shoppingItems, shoppingProducts } from '../../db/schema/shopping.js';
import { users } from '../../db/schema/users.js';
import { hashPin } from '../auth/auth.pin.js';
import { signAccessToken } from '../auth/auth.tokens.js';

/**
 * Testy tras list zakupów — `F10-4`
 * ([04 §14b](../../../../../../plans/04-api-spec.md#14b-listy-zakupów--apiv1shopping-lists-shopping-items-shopping-products-shopping-imports),
 * [07 §14](../../../../../../plans/07-domain-rules.md#14-listy-zakupów), I-26…I-29).
 */

const NOW = new Date('2026-11-22T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Aplikacja z gospodarstwem i sterowanym zegarem. */
interface Setup {
  app: TestApp;
  home: HouseholdFixture;
  clock: MutableClock;
}

/**
 * Buduje aplikację z jednym gospodarstwem.
 *
 * @returns Aplikacja, gospodarstwo i zegar.
 */
async function setup(): Promise<Setup> {
  const clock = mutableClock(NOW);
  const app = await buildTestApp({}, clock);
  harness = app;
  const home = await householdFixture(app.db, testConfig(), NOW);
  return { app, home, clock };
}

/**
 * Przesuwa zegar i wystawia świeży token — dostęp żyje krócej niż doba.
 *
 * @param s - Aplikacja.
 * @param ms - O ile przesunąć zegar.
 */
async function advance(s: Setup, ms: number): Promise<void> {
  s.clock.advance(ms);
  const token = await signAccessToken(
    testConfig(),
    { sub: s.home.userId, hid: s.home.householdId, sid: newId() },
    s.clock.now(),
  );
  s.home = { ...s.home, headers: { ...s.home.headers, authorization: `Bearer ${token}` } };
}

/** Odpowiedź w postaci do sprawdzania. */
interface Reply {
  status: number;
  body: string;
  headers: Record<string, unknown>;
  json<T>(): T;
}

/**
 * Wysyła żądanie jako domownik.
 *
 * @param s - Aplikacja.
 * @param method - Metoda.
 * @param url - Ścieżka za `/api/v1`.
 * @param payload - Ciało.
 * @param headers - Dodatkowe nagłówki.
 * @param home - Gospodarstwo (domyślnie z `setup`).
 * @returns Odpowiedź.
 */
async function call(
  s: Setup,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
  home: HouseholdFixture = s.home,
): Promise<Reply> {
  const response = await s.app.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...home.headers, ...headers },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
  return {
    status: response.statusCode,
    body: response.body,
    headers: response.headers,
    json: <T>() => response.json<{ data: T }>().data,
  };
}

/**
 * Listy bieżące (zakłada zestaw startowy).
 *
 * @param s - Aplikacja.
 * @returns Listy.
 */
async function lists(s: Setup): Promise<ShoppingListDto[]> {
  const reply = await call(s, 'GET', '/shopping-lists');
  expect(reply.status, reply.body).toBe(200);
  return reply.json<ShoppingListDto[]>();
}

/**
 * Lista „Spożywcze" z zestawu startowego.
 *
 * @param s - Aplikacja.
 * @returns Identyfikator listy.
 */
async function groceries(s: Setup): Promise<string> {
  const [first] = await lists(s);
  return (first as ShoppingListDto).id;
}

/**
 * Dopisuje pozycję i sprawdza kod.
 *
 * @param s - Aplikacja.
 * @param listId - Lista.
 * @param body - Pozycja.
 * @param status - Oczekiwany kod.
 * @returns Wynik dopisania.
 */
async function add(
  s: Setup,
  listId: string,
  body: Record<string, unknown>,
  status = 201,
): Promise<CreateShoppingItemResult> {
  const reply = await call(s, 'POST', `/shopping-lists/${listId}/items`, body);
  expect(reply.status, reply.body).toBe(status);
  return reply.json<CreateShoppingItemResult>();
}

/**
 * Pozycje listy.
 *
 * @param s - Aplikacja.
 * @param listId - Lista.
 * @returns Lista z pozycjami.
 */
async function items(s: Setup, listId: string): Promise<ShoppingItemsDto> {
  const reply = await call(s, 'GET', `/shopping-lists/${listId}/items`);
  expect(reply.status, reply.body).toBe(200);
  return reply.json<ShoppingItemsDto>();
}

/**
 * Zmienia pozycję.
 *
 * @param s - Aplikacja.
 * @param itemId - Pozycja.
 * @param body - Zmiany.
 * @param status - Oczekiwany kod.
 * @returns Pozycja po zmianie.
 */
async function patchItem(
  s: Setup,
  itemId: string,
  body: Record<string, unknown>,
  status = 200,
): Promise<ShoppingItemDto> {
  const reply = await call(s, 'PATCH', `/shopping-items/${itemId}`, body);
  expect(reply.status, reply.body).toBe(status);
  return reply.json<ShoppingItemDto>();
}

describe('dostęp', () => {
  it('bez tokenu → 401', async () => {
    const s = await setup();
    const reply = await s.app.app.inject({ method: 'GET', url: '/api/v1/shopping-lists' });
    expect(reply.statusCode).toBe(401);
  });

  it('lista i pozycja innego gospodarstwa → 404', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const { item } = await add(s, listId, { name: 'Mleko' });
    const other = await householdFixture(s.app.db, testConfig(), NOW);
    expect(
      (await call(s, 'GET', `/shopping-lists/${listId}/items`, undefined, {}, other)).status,
    ).toBe(404);
    expect(
      (await call(s, 'PATCH', `/shopping-items/${item.id}`, { checked: true }, {}, other)).status,
    ).toBe(404);
    expect(
      (await call(s, 'POST', `/shopping-lists/${listId}/items`, { name: 'X' }, {}, other)).status,
    ).toBe(404);
  });
});

describe('zestaw startowy (07 §14.6)', () => {
  it('pierwsze wejście zakłada „Spożywcze" i produkty „zawsze w domu" — raz', async () => {
    const s = await setup();
    const first = await lists(s);
    expect(first.map((list) => [list.name, list.isDefault])).toEqual([['Spożywcze', true]]);
    await lists(s);
    expect(await lists(s)).toHaveLength(1);

    const staples = (await call(s, 'GET', '/shopping-products?staple=true&limit=50')).json<
      ShoppingProductDto[]
    >();
    expect(staples.map((product) => product.name)).toEqual(
      expect.arrayContaining(['Mleko', 'Jajka', 'Masło', 'Sól', 'Mąka pszenna']),
    );
    expect(staples).toHaveLength(11);
  });

  it('usunięcie wszystkich list nie zakłada ich ponownie', async () => {
    const s = await setup();
    const listId = await groceries(s);
    expect((await call(s, 'DELETE', `/shopping-lists/${listId}`)).status).toBe(204);
    expect(await lists(s)).toEqual([]);
  });

  it('istniejący produkt dostaje flagę zamiast duplikatu', async () => {
    const s = await setup();
    const at = NOW.getTime();
    s.app.db.db
      .insert(shoppingProducts)
      .values({
        id: newId(),
        householdId: s.home.householdId,
        name: 'mleko',
        normalizedName: 'mleko',
        section: 'drinks',
        createdAt: at,
        updatedAt: at,
      })
      .run();
    await lists(s);
    const milk = s.app.db.db
      .select()
      .from(shoppingProducts)
      .where(eq(shoppingProducts.normalizedName, 'mleko'))
      .all();
    expect(milk).toHaveLength(1);
    expect(milk[0]?.isStaple).toBe(true);
  });
});

describe('listy (I-26)', () => {
  it('nowa lista na końcu, nie domyślna; zmiana domyślnej przenosi flagę', async () => {
    const s = await setup();
    const groceriesId = await groceries(s);
    const created = await call(s, 'POST', '/shopping-lists', { name: ' Decathlon ' });
    expect(created.status).toBe(201);
    const decathlon = created.json<ShoppingListDto>();
    expect(decathlon).toMatchObject({ name: 'Decathlon', isDefault: false, sortOrder: 1 });

    const changed = await call(s, 'PATCH', `/shopping-lists/${decathlon.id}`, { isDefault: true });
    expect(changed.json<ShoppingListDto>().isDefault).toBe(true);
    expect((await lists(s)).map((list) => [list.id, list.isDefault])).toEqual([
      [groceriesId, false],
      [decathlon.id, true],
    ]);
  });

  it('archiwizacja domyślnej przenosi flagę; z archiwum nie można być domyślną', async () => {
    const s = await setup();
    const groceriesId = await groceries(s);
    const other = (
      await call(s, 'POST', '/shopping-lists', { name: 'Decathlon' })
    ).json<ShoppingListDto>();

    const archived = await call(s, 'PATCH', `/shopping-lists/${groceriesId}`, { archived: true });
    expect(archived.json<ShoppingListDto>()).toMatchObject({ archived: true, isDefault: false });
    expect((await lists(s)).map((list) => [list.id, list.isDefault])).toEqual([[other.id, true]]);

    const fromArchive = await call(s, 'GET', '/shopping-lists?archived=true');
    expect(fromArchive.json<ShoppingListDto[]>().map((list) => list.id)).toEqual([groceriesId]);
    expect(
      (await call(s, 'PATCH', `/shopping-lists/${groceriesId}`, { isDefault: true })).status,
    ).toBe(409);

    expect(
      (await call(s, 'PATCH', `/shopping-lists/${groceriesId}`, { archived: false })).status,
    ).toBe(200);
    expect(
      (
        await call(s, 'PATCH', `/shopping-lists/${groceriesId}`, { name: 'Dom' })
      ).json<ShoppingListDto>(),
    ).toMatchObject({
      name: 'Dom',
      isDefault: false,
    });
  });

  it('przywrócenie jedynej listy z archiwum czyni ją domyślną', async () => {
    const s = await setup();
    const groceriesId = await groceries(s);
    await call(s, 'PATCH', `/shopping-lists/${groceriesId}`, { archived: true });
    expect(await lists(s)).toEqual([]);
    const restored = await call(s, 'PATCH', `/shopping-lists/${groceriesId}`, { archived: false });
    expect(restored.json<ShoppingListDto>()).toMatchObject({ archived: false, isDefault: true });
  });

  it('usunięcie domyślnej przenosi flagę na następną', async () => {
    const s = await setup();
    const groceriesId = await groceries(s);
    const other = (
      await call(s, 'POST', '/shopping-lists', { name: 'Decathlon' })
    ).json<ShoppingListDto>();
    await call(s, 'DELETE', `/shopping-lists/${groceriesId}`);
    expect((await lists(s)).map((list) => [list.id, list.isDefault])).toEqual([[other.id, true]]);
    expect((await call(s, 'DELETE', `/shopping-lists/${groceriesId}`)).status).toBe(404);
  });

  it('kolejność list; nieznana lista → 404', async () => {
    const s = await setup();
    const groceriesId = await groceries(s);
    const b = (await call(s, 'POST', '/shopping-lists', { name: 'B' })).json<ShoppingListDto>();
    const c = (await call(s, 'POST', '/shopping-lists', { name: 'C' })).json<ShoppingListDto>();
    const reordered = await call(s, 'PATCH', '/shopping-lists/order', {
      listIds: [c.id, groceriesId],
    });
    expect(reordered.json<ShoppingListDto[]>().map((list) => list.name)).toEqual([
      'C',
      'Spożywcze',
      'B',
    ]);
    expect((await call(s, 'PATCH', '/shopping-lists/order', { listIds: [newId()] })).status).toBe(
      404,
    );
    void b;
  });

  it('walidacja nazwy → 400', async () => {
    const s = await setup();
    expect((await call(s, 'POST', '/shopping-lists', { name: '  ' })).status).toBe(400);
  });

  it('duplikat: kupione wracają jako do kupienia, ze scaleniem powtórzeń', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const bought = await add(s, listId, { name: 'Mleko', quantityMilli: 2000, unit: 'pcs' });
    await patchItem(s, bought.item.id, { checked: true });
    await add(s, listId, { name: 'mleko', quantityMilli: 1000, unit: 'pcs', note: 'bez laktozy' });
    await add(s, listId, { name: 'Chleb' });

    const copy = await call(s, 'POST', `/shopping-lists/${listId}/duplicate`, { name: 'Szablon' });
    expect(copy.status).toBe(201);
    const copied = await items(s, copy.json<ShoppingListDto>().id);
    expect(
      copied.items.map((item) => [item.name, item.quantityMilli, item.checked, item.note]),
    ).toEqual([
      ['Chleb', null, false, null],
      ['Mleko', 3000, false, 'bez laktozy'],
    ]);
  });
});

describe('pozycje (07 §14.3, I-29)', () => {
  it('dopisanie: nazwa uporządkowana, dział ze słów kluczowych, produkt w słowniku', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const { item, merged } = await add(s, listId, {
      name: '  pomidory  malinowe',
      quantityMilli: 1000,
      unit: 'kg',
    });
    expect(merged).toBe(false);
    expect(item).toMatchObject({
      name: 'Pomidory malinowe',
      section: 'produce',
      quantityMilli: 1000,
      unit: 'kg',
      checked: false,
      isStaple: false,
      source: 'manual',
    });
    const suggestions = (await call(s, 'GET', '/shopping-products?q=mal')).json<
      ShoppingProductDto[]
    >();
    expect(suggestions.map((product) => [product.name, product.useCount])).toEqual([
      ['Pomidory malinowe', 1],
    ]);
  });

  it('scalanie: ta sama nazwa i jednostka sumuje; bez ilości przyjmuje ilość; inna jednostka osobno', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const first = await add(s, listId, { name: 'Mleko', quantityMilli: 2000, unit: 'pcs' });
    const again = await add(s, listId, { name: 'MLEKO', quantityMilli: 1000, unit: 'pcs' }, 200);
    expect(again).toMatchObject({ merged: true, item: { id: first.item.id, quantityMilli: 3000 } });

    const plain = await add(s, listId, { name: 'Mąka' });
    const withQty = await add(s, listId, { name: 'maka', quantityMilli: 1000, unit: 'kg' }, 200);
    expect(withQty.item).toMatchObject({ id: plain.item.id, quantityMilli: 1000, unit: 'kg' });
    const other = await add(s, listId, { name: 'Mąka', quantityMilli: 2000, unit: 'pcs' });
    expect(other.item.id).not.toBe(plain.item.id);
  });

  it('mleko jest „zawsze w domu" — pozycja niesie flagę', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const { item } = await add(s, listId, { name: 'Mleko' });
    expect(item).toMatchObject({ isStaple: true, section: 'dairy' });
  });

  it('identyfikator od klienta: ponowienie oddaje tę samą pozycję, zajęty gdzie indziej → 409', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const id = newId();
    const first = await add(s, listId, { id, name: 'Chleb' });
    expect(first.item.id).toBe(id);
    // Ponowienie odtwarza pierwszą odpowiedź (klucz idempotencji = identyfikator).
    const repeated = await add(s, listId, { id, name: 'Chleb' }, 201);
    expect(repeated).toMatchObject({ merged: false, item: { id } });
    expect((await items(s, listId)).items).toHaveLength(1);

    const other = await householdFixture(s.app.db, testConfig(), NOW);
    const otherList = (await call(s, 'GET', '/shopping-lists', undefined, {}, other)).json<
      ShoppingListDto[]
    >();
    const clash = await call(
      s,
      'POST',
      `/shopping-lists/${(otherList[0] as ShoppingListDto).id}/items`,
      { id, name: 'Chleb' },
      {},
      other,
    );
    expect(clash.status).toBe(409);
  });

  it('walidacja: ilość bez jednostki → 400', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const reply = await call(s, 'POST', `/shopping-lists/${listId}/items`, {
      name: 'Mleko',
      quantityMilli: 1000,
    });
    expect(reply.status).toBe(400);
  });

  it('odhaczenie jest idempotentne i zapisuje, kto odhaczył', async () => {
    const s = await setup();
    s.app.db.db
      .update(users)
      .set({ displayName: 'Adam Kowalski' })
      .where(eq(users.id, s.home.userId))
      .run();
    const listId = await groceries(s);
    const { item } = await add(s, listId, { name: 'Chleb' });
    s.clock.advance(1000);
    const checked = await patchItem(s, item.id, { checked: true });
    expect(checked).toMatchObject({ checked: true, checkedByInitials: 'AK' });
    s.clock.advance(1000);
    const again = await patchItem(s, item.id, { checked: true });
    expect(again.updatedAt).toBe(checked.updatedAt);
    expect(again.checkedAt).toBe(checked.checkedAt);
    expect((await lists(s))[0]).toMatchObject({
      toBuyCount: 0,
      checkedCount: 1,
      lastActivityBy: 'Adam Kowalski',
    });
  });

  it('odznaczenie scala z nową pozycją o tym samym kluczu', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const bought = await add(s, listId, { name: 'Jajka', quantityMilli: 1000, unit: 'pack' });
    await patchItem(s, bought.item.id, { checked: true });
    const fresh = await add(s, listId, { name: 'Jajka', quantityMilli: 1000, unit: 'pack' });
    expect(fresh.item.id).not.toBe(bought.item.id);

    const unchecked = await patchItem(s, bought.item.id, { checked: false });
    expect(unchecked).toMatchObject({ id: bought.item.id, checked: false, quantityMilli: 2000 });
    expect((await items(s, listId)).items.map((item) => item.id)).toEqual([bought.item.id]);
  });

  it('zmiana nazwy na istniejącą scala; zmiana działu trafia do słownika', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const a = await add(s, listId, { name: 'Ser żółty', quantityMilli: 1000, unit: 'pcs' });
    const b = await add(s, listId, { name: 'Ser zolty?', quantityMilli: 1000, unit: 'pcs' });
    const renamed = await patchItem(s, b.item.id, { name: 'ser żółty' });
    expect(renamed).toMatchObject({ id: b.item.id, name: 'Ser żółty', quantityMilli: 2000 });
    expect((await items(s, listId)).items.map((item) => item.id)).toEqual([b.item.id]);
    void a;

    await patchItem(s, b.item.id, { section: 'dairy' });
    const next = await add(s, listId, { name: 'Ser żółty' }, 200);
    expect(next.item.section).toBe('dairy');
    const [product] = (await call(s, 'GET', '/shopping-products?q=ser')).json<
      ShoppingProductDto[]
    >();
    expect(product).toMatchObject({ section: 'dairy' });
  });

  it('nowa nazwa bez produktu zakłada produkt', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const { item } = await add(s, listId, { name: 'Klej' });
    const renamed = await patchItem(s, item.id, {
      name: 'Klej do drewna',
      quantityMilli: 1000,
      unit: 'pcs',
      note: 'Wikol',
    });
    expect(renamed).toMatchObject({ name: 'Klej do drewna', note: 'Wikol', quantityMilli: 1000 });
    expect(renamed.productId).not.toBe(item.productId);
    const cleared = await patchItem(s, item.id, { quantityMilli: null, unit: null, note: '' });
    expect(cleared).toMatchObject({ quantityMilli: null, unit: null, note: null });
  });

  it('przeniesienie na inną listę scala z pozycją tam', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const other = (
      await call(s, 'POST', '/shopping-lists', { name: 'Dom' })
    ).json<ShoppingListDto>();
    const here = await add(s, listId, {
      name: 'Papier toaletowy',
      quantityMilli: 1000,
      unit: 'pack',
    });
    await add(s, other.id, { name: 'Papier toaletowy', quantityMilli: 2000, unit: 'pack' });

    const moved = await patchItem(s, here.item.id, { listId: other.id });
    expect(moved).toMatchObject({
      id: here.item.id,
      listId: other.id,
      quantityMilli: 3000,
      section: 'hygiene',
    });
    expect((await items(s, listId)).items).toEqual([]);
    expect((await items(s, other.id)).items.map((item) => item.id)).toEqual([here.item.id]);
    expect(
      (await call(s, 'PATCH', `/shopping-items/${here.item.id}`, { listId: newId() })).status,
    ).toBe(404);
  });

  it('lista w archiwum i pozycja wyczyszczona nie przyjmują zmian → 409', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const { item } = await add(s, listId, { name: 'Chleb' });
    await patchItem(s, item.id, { checked: true });
    await call(s, 'POST', `/shopping-lists/${listId}/clear-checked`);
    await patchItem(s, item.id, { checked: false }, 409);

    const other = await add(s, listId, { name: 'Masło' });
    await call(s, 'PATCH', `/shopping-lists/${listId}`, { archived: true });
    await patchItem(s, other.item.id, { checked: true }, 409);
    expect((await call(s, 'POST', `/shopping-lists/${listId}/items`, { name: 'X' })).status).toBe(
      409,
    );
    expect((await call(s, 'DELETE', `/shopping-items/${other.item.id}`)).status).toBe(409);
    expect((await call(s, 'POST', `/shopping-lists/${listId}/clear-checked`)).status).toBe(409);
  });

  it('usunięcie pozycji; nieistniejąca to też 204 (ponowienie)', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const { item } = await add(s, listId, { name: 'Chleb' });
    expect((await call(s, 'DELETE', `/shopping-items/${item.id}`)).status).toBe(204);
    expect((await call(s, 'DELETE', `/shopping-items/${item.id}`)).status).toBe(204);
    expect((await items(s, listId)).items).toEqual([]);
  });

  it('kolejność: działy w stałym porządku, kupione na końcu', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const soap = await add(s, listId, { name: 'Mydło' });
    await add(s, listId, { name: 'Chleb' });
    await add(s, listId, { name: 'Cebula' });
    await patchItem(s, soap.item.id, { checked: true });
    expect((await items(s, listId)).items.map((item) => item.name)).toEqual([
      'Cebula',
      'Chleb',
      'Mydło',
    ]);
  });
});

describe('odpytywanie z ETag', () => {
  it('niezmieniona lista → 304, każda zmiana pozycji zmienia wersję', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const first = await call(s, 'GET', `/shopping-lists/${listId}/items`);
    const etag = String(first.headers.etag);
    expect(etag).toMatch(/^W\/"\d+"$/);
    expect(
      (
        await call(s, 'GET', `/shopping-lists/${listId}/items`, undefined, {
          'if-none-match': etag,
        })
      ).status,
    ).toBe(304);

    const { item } = await add(s, listId, { name: 'Chleb' });
    const afterAdd = await call(s, 'GET', `/shopping-lists/${listId}/items`, undefined, {
      'if-none-match': etag,
    });
    expect(afterAdd.status).toBe(200);
    const etag2 = String(afterAdd.headers.etag);
    expect(etag2).not.toBe(etag);

    // Zmiana w tej samej milisekundzie też podbija wersję.
    await call(s, 'DELETE', `/shopping-items/${item.id}`);
    const afterDelete = await call(s, 'GET', `/shopping-lists/${listId}/items`, undefined, {
      'if-none-match': etag2,
    });
    expect(afterDelete.status).toBe(200);
  });
});

describe('wyczyść kupione (07 §14.7, I-28)', () => {
  it('czyści kupione, zostawia niekupione, cofnięcie działa 24 h', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const bread = await add(s, listId, { name: 'Chleb' });
    const butter = await add(s, listId, { name: 'Masło' });
    await patchItem(s, bread.item.id, { checked: true });

    const cleared = await call(s, 'POST', `/shopping-lists/${listId}/clear-checked`);
    expect(cleared.json<ClearCheckedResult>()).toEqual({
      clearedIds: [bread.item.id],
      listEmpty: false,
    });
    expect((await items(s, listId)).items.map((item) => item.id)).toEqual([butter.item.id]);
    expect((await lists(s))[0]).toMatchObject({ toBuyCount: 1, checkedCount: 0 });

    const restored = await call(s, 'POST', `/shopping-lists/${listId}/restore-cleared`, {
      itemIds: [bread.item.id, newId()],
    });
    expect(restored.json<{ restoredIds: string[] }>()).toEqual({ restoredIds: [bread.item.id] });
    expect((await items(s, listId)).items.find((item) => item.id === bread.item.id)?.checked).toBe(
      true,
    );

    // Puste czyszczenie nie zmienia wersji listy.
    await call(s, 'POST', `/shopping-lists/${listId}/clear-checked`);
    await advance(s, 25 * HOUR);
    const late = await call(s, 'POST', `/shopping-lists/${listId}/restore-cleared`, {
      itemIds: [bread.item.id],
    });
    expect(late.json<{ restoredIds: string[] }>()).toEqual({ restoredIds: [] });
    const empty = await call(s, 'POST', `/shopping-lists/${listId}/clear-checked`);
    expect(empty.json<ClearCheckedResult>()).toEqual({ clearedIds: [], listEmpty: false });
  });

  it('wyczyszczone dawniej niż 24 h znikają przy następnym czyszczeniu', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const bread = await add(s, listId, { name: 'Chleb' });
    await patchItem(s, bread.item.id, { checked: true });
    const first = await call(s, 'POST', `/shopping-lists/${listId}/clear-checked`);
    expect(first.json<ClearCheckedResult>().listEmpty).toBe(true);
    expect(s.app.db.db.select().from(shoppingItems).all()).toHaveLength(1);

    await advance(s, 25 * HOUR);
    await call(s, 'POST', `/shopping-lists/${listId}/clear-checked`);
    expect(s.app.db.db.select().from(shoppingItems).all()).toHaveLength(0);
  });
});

describe('słownik (07 §14.5)', () => {
  it('podpowiedzi: prefiks słowa bez polskich znaków, najczęściej używane najpierw, „%" dosłownie', async () => {
    const s = await setup();
    const listId = await groceries(s);
    await add(s, listId, { name: 'Mąka orkiszowa' });
    await add(s, listId, { name: 'Ser 100%' });
    const found = (await call(s, 'GET', '/shopping-products?q=maka&limit=5')).json<
      ShoppingProductDto[]
    >();
    expect(found.map((product) => product.name)).toEqual(['Mąka orkiszowa', 'Mąka pszenna']);
    const word = (await call(s, 'GET', '/shopping-products?q=orki')).json<ShoppingProductDto[]>();
    expect(word.map((product) => product.name)).toEqual(['Mąka orkiszowa']);
    const percent = (await call(s, 'GET', '/shopping-products?q=%25')).json<ShoppingProductDto[]>();
    expect(percent).toEqual([]);
    const all = (await call(s, 'GET', '/shopping-products?limit=200')).json<ShoppingProductDto[]>();
    expect(all.length).toBeGreaterThan(11);
  });

  it('często kupowane: z 90 dni, bez tych, które są na liście', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const bread = await add(s, listId, { name: 'Chleb' });
    await add(s, listId, { name: 'Ser' });
    await patchItem(s, bread.item.id, { checked: true });
    const frequent = await call(s, 'GET', `/shopping-products/frequent?listId=${listId}`);
    expect(frequent.json<ShoppingProductDto[]>().map((product) => product.name)).toEqual(['Chleb']);

    await advance(s, 91 * 24 * HOUR);
    const stale = await call(s, 'GET', `/shopping-products/frequent?listId=${listId}`);
    expect(stale.json<ShoppingProductDto[]>()).toEqual([]);
    expect((await call(s, 'GET', `/shopping-products/frequent?listId=${newId()}`)).status).toBe(
      404,
    );
  });

  it('dopisanie produktu: nowy 201, istniejący 200 ze zmianą flagi', async () => {
    const s = await setup();
    await lists(s);
    const created = await call(s, 'POST', '/shopping-products', { name: 'kakao', isStaple: true });
    expect(created.status).toBe(201);
    expect(created.json<ShoppingProductDto>()).toMatchObject({
      name: 'Kakao',
      section: 'dry_goods',
      isStaple: true,
      useCount: 0,
    });

    const milk = await call(s, 'POST', '/shopping-products', { name: 'Mleko', isStaple: false });
    expect(milk.status).toBe(200);
    expect(milk.json<ShoppingProductDto>()).toMatchObject({
      name: 'Mleko',
      isStaple: false,
      section: 'dairy',
    });
    const withSection = await call(s, 'POST', '/shopping-products', {
      name: 'Mleko',
      isStaple: false,
      section: 'drinks',
    });
    expect(withSection.json<ShoppingProductDto>().section).toBe('drinks');
  });

  it('zmiana produktu: nazwa zajęta → 409, nieznany → 404; usunięcie zostawia pozycje', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const { item } = await add(s, listId, { name: 'Kakao' });
    const productId = item.productId as string;
    expect(
      (await call(s, 'PATCH', `/shopping-products/${productId}`, { name: 'Mleko' })).status,
    ).toBe(409);
    expect(
      (await call(s, 'PATCH', `/shopping-products/${newId()}`, { isStaple: true })).status,
    ).toBe(404);
    const renamed = await call(s, 'PATCH', `/shopping-products/${productId}`, {
      name: 'Kakao naturalne',
      isStaple: true,
    });
    expect(renamed.json<ShoppingProductDto>()).toMatchObject({
      name: 'Kakao naturalne',
      isStaple: true,
    });
    expect(
      (await call(s, 'PATCH', `/shopping-products/${productId}`, {})).json<ShoppingProductDto>()
        .name,
    ).toBe('Kakao naturalne');

    expect((await call(s, 'DELETE', `/shopping-products/${productId}`)).status).toBe(204);
    const [left] = (await items(s, listId)).items;
    expect(left).toMatchObject({ name: 'Kakao', productId: null, isStaple: false });
  });
});

describe('lista z licznikami i importami', () => {
  it('pokazuje importy w toku i do przejrzenia', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const at = NOW.getTime();
    const base = {
      householdId: s.home.householdId,
      listId,
      kind: 'list_photo' as const,
      input: 'image' as const,
      createdBy: s.home.userId,
      createdAt: at,
      updatedAt: at,
    };
    const processing = newId();
    s.app.db.db
      .insert(shoppingImports)
      .values([
        { ...base, id: processing, status: 'processing' },
        { ...base, id: newId(), status: 'committed' },
      ])
      .run();
    expect((await lists(s))[0]?.pendingImports).toEqual([
      { id: processing, status: 'processing', kind: 'list_photo' },
    ]);
  });
});

describe('eksport i reset', () => {
  it('eksport zawiera listy, reset je czyści i zeruje zestaw startowy', async () => {
    const s = await setup();
    const listId = await groceries(s);
    await add(s, listId, { name: 'Chleb' });

    const exported = await call(s, 'GET', '/settings/export');
    const body = JSON.parse(exported.body) as { tables: Record<string, unknown[]> };
    expect(body.tables.shoppingLists).toHaveLength(1);
    expect(body.tables.shoppingItems).toHaveLength(1);
    expect(body.tables.shoppingProducts?.length).toBeGreaterThan(11);

    const household = s.app.db.db
      .select({ at: households.shoppingInitializedAt })
      .from(households)
      .where(eq(households.id, s.home.householdId))
      .get();
    expect(household?.at).not.toBeNull();
  });

  it('reset usuwa listy, pozycje, słownik, importy z plikami i zakłada zestaw od nowa', async () => {
    const s = await setup();
    const PIN = '482915';
    s.app.db.db
      .update(users)
      .set({ pinHash: await hashPin(PIN) })
      .where(eq(users.id, s.home.userId))
      .run();
    const listId = await groceries(s);
    const bought = await add(s, listId, { name: 'Chleb' });
    await patchItem(s, bought.item.id, { checked: true });
    await call(s, 'POST', `/shopping-lists/${listId}/clear-checked`);
    await add(s, listId, { name: 'Ser' });

    const storagePath = 'shopping/2026/11/import-1.jpg';
    const absolute = join(testConfig().uploads.dir, storagePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, 'jpeg');
    const at = NOW.getTime();
    s.app.db.db
      .insert(shoppingImports)
      .values({
        id: newId(),
        householdId: s.home.householdId,
        listId,
        kind: 'list_photo',
        input: 'image',
        status: 'parsed',
        filePaths: JSON.stringify([storagePath]),
        createdBy: s.home.userId,
        createdAt: at,
        updatedAt: at,
      })
      .run();

    const reset = await call(s, 'POST', '/settings/reset', { pin: PIN });
    expect(reset.status, reset.body).toBe(200);
    expect(reset.json<{ deleted: Record<string, number> }>().deleted).toMatchObject({
      shoppingLists: 1,
      shoppingItems: 2,
      shoppingImports: 1,
      shoppingImportItems: 0,
      shoppingProducts: 13,
    });
    await expect(access(absolute)).rejects.toThrow();
    expect(s.app.db.db.select().from(shoppingItems).all()).toEqual([]);

    const again = await lists(s);
    expect(again.map((list) => list.name)).toEqual(['Spożywcze']);
  });
});

describe('poprawki po przeglądzie kodu', () => {
  it('ponowienie scalonego dopisania z tym samym id nie sumuje drugi raz', async () => {
    const s = await setup();
    const listId = await groceries(s);
    await add(s, listId, { name: 'Mleko', quantityMilli: 2000, unit: 'pcs' });
    const id = newId();
    const body = { id, name: 'Mleko', quantityMilli: 1000, unit: 'pcs' };
    const first = await add(s, listId, body, 200);
    expect(first).toMatchObject({ merged: true, item: { quantityMilli: 3000 } });
    const retry = await add(s, listId, body, 200);
    expect(retry).toMatchObject({ merged: true, item: { quantityMilli: 3000 } });
    expect((await items(s, listId)).items.map((item) => item.quantityMilli)).toEqual([3000]);
    // To samo id z innym ciałem to inny zapis — 409, a nie cicha zgoda.
    const changed = await call(s, 'POST', `/shopping-lists/${listId}/items`, {
      ...body,
      quantityMilli: 5000,
    });
    expect(changed.status).toBe(409);
  });

  /**
   * Aktualny ETag listy.
   *
   * @param s - Aplikacja.
   * @param listId - Lista.
   * @returns Wartość nagłówka.
   */
  async function etagOf(s: Setup, listId: string): Promise<string> {
    return String((await call(s, 'GET', `/shopping-lists/${listId}/items`)).headers.etag);
  }

  it('ETag zmienia się po zmianie flagi i usunięciu produktu oraz po zmianie kolejności', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const { item } = await add(s, listId, { name: 'Kakao' });
    const productId = item.productId as string;

    let before = await etagOf(s, listId);
    await call(s, 'PATCH', `/shopping-products/${productId}`, { isStaple: true });
    expect(await etagOf(s, listId)).not.toBe(before);
    expect((await items(s, listId)).items[0]?.isStaple).toBe(true);

    before = await etagOf(s, listId);
    await call(s, 'POST', '/shopping-products', { name: 'Kakao', isStaple: false });
    expect(await etagOf(s, listId)).not.toBe(before);

    before = await etagOf(s, listId);
    await call(s, 'DELETE', `/shopping-products/${productId}`);
    expect(await etagOf(s, listId)).not.toBe(before);

    const other = (
      await call(s, 'POST', '/shopping-lists', { name: 'Dom' })
    ).json<ShoppingListDto>();
    before = await etagOf(s, listId);
    await call(s, 'PATCH', '/shopping-lists/order', { listIds: [other.id, listId] });
    expect(await etagOf(s, listId)).not.toBe(before);
  });

  it('wersja listy nie cofa się, gdy zmiana listy przychodzi w tej samej milisekundzie', async () => {
    const s = await setup();
    const groceriesId = await groceries(s);
    const other = (
      await call(s, 'POST', '/shopping-lists', { name: 'Dom' })
    ).json<ShoppingListDto>();
    // Dwie zmiany pozycji w tej samej milisekundzie: wersja = teraz + 1.
    const { item } = await add(s, other.id, { name: 'Chleb' });
    await patchItem(s, item.id, { checked: true });
    const before = await etagOf(s, other.id);
    // Archiwizacja domyślnej przenosi flagę na „Dom" — wersja musi wzrosnąć, nie spaść.
    await call(s, 'PATCH', `/shopping-lists/${groceriesId}`, { archived: true });
    const after = await call(s, 'GET', `/shopping-lists/${other.id}/items`, undefined, {
      'if-none-match': before,
    });
    expect(after.status).toBe(200);
    expect(after.json<ShoppingItemsDto>().list.isDefault).toBe(true);
  });

  it('usunięcie listy usuwa z dysku pliki jej importów', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const storagePath = 'shopping/2026/11/delete-list.jpg';
    const absolute = join(testConfig().uploads.dir, storagePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, 'jpeg');
    const at = NOW.getTime();
    s.app.db.db
      .insert(shoppingImports)
      .values({
        id: newId(),
        householdId: s.home.householdId,
        listId,
        kind: 'list_photo',
        input: 'image',
        status: 'parsed',
        filePaths: JSON.stringify([storagePath]),
        createdBy: s.home.userId,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    expect((await call(s, 'DELETE', `/shopping-lists/${listId}`)).status).toBe(204);
    await expect(access(absolute)).rejects.toThrow();
  });

  it('przeniesienie: dział zostaje z pozycji, która już była na liście', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const other = (
      await call(s, 'POST', '/shopping-lists', { name: 'Dom' })
    ).json<ShoppingListDto>();
    const moving = await add(s, listId, { name: 'Woda', section: 'other' });
    await add(s, other.id, { name: 'Woda', section: 'drinks' });
    const moved = await patchItem(s, moving.item.id, { listId: other.id });
    expect(moved).toMatchObject({ id: moving.item.id, section: 'drinks' });
  });

  it('„ostatnio" pochodzi z pozycji i wskazuje tego, kto zmienił — nie autora', async () => {
    const s = await setup();
    const at = NOW.getTime();
    const secondId = newId();
    s.app.db.db
      .insert(users)
      .values({
        id: secondId,
        householdId: s.home.householdId,
        email: `${secondId.toLowerCase()}@example.com`,
        displayName: 'Tomek',
        pinHash: 'nie-jest-hashem',
        pinUpdatedAt: at,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    const token = await signAccessToken(
      testConfig(),
      { sub: secondId, hid: s.home.householdId, sid: newId() },
      NOW,
    );
    const tomek = {
      ...s.home,
      userId: secondId,
      headers: { ...s.home.headers, authorization: `Bearer ${token}` },
    };

    const listId = await groceries(s);
    expect((await lists(s))[0]).toMatchObject({ lastActivityAt: null, lastActivityBy: null });
    const { item } = await add(s, listId, { name: 'Chleb' });
    await advance(s, 1000);
    const changed = await call(
      s,
      'PATCH',
      `/shopping-items/${item.id}`,
      { quantityMilli: 2000, unit: 'pcs' },
      {},
      tomek,
    );
    expect(changed.status, changed.body).toBe(200);
    const [card] = await lists(s);
    expect(card).toMatchObject({
      lastActivityBy: 'Tomek',
      lastActivityAt: changed.json<ShoppingItemDto>().updatedAt,
    });

    // Zmiana nazwy listy to nie aktywność na pozycjach.
    await advance(s, 1000);
    await call(s, 'PATCH', `/shopping-lists/${listId}`, { name: 'Dom' });
    expect((await lists(s))[0]?.lastActivityAt).toBe(card?.lastActivityAt);
  });

  it('PATCH z samym quantityMilli: null czyści ilość', async () => {
    const s = await setup();
    const listId = await groceries(s);
    const { item } = await add(s, listId, { name: 'Chleb', quantityMilli: 2000, unit: 'pcs' });
    const cleared = await patchItem(s, item.id, { quantityMilli: null });
    expect(cleared).toMatchObject({ quantityMilli: null, unit: null });
    await patchItem(s, item.id, { quantityMilli: 1000 }, 400);
  });
});
