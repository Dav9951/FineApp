import { access } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  CommitShoppingImportResult,
  ShoppingImportDto,
  ShoppingItemsDto,
  ShoppingListDto,
} from '@fineapp/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import { multipart, receiptPhoto } from '../../../test/documents-fixtures.js';
import { householdFixture, type HouseholdFixture } from '../../../test/factories.js';
import { ExtractionError } from '../../ai/document-extractor.js';
import type {
  ListExtraction,
  RecipeExtraction,
  ShoppingExtractor,
} from '../../ai/shopping-extractor.js';
import { mutableClock } from '../../core/clock.js';
import { SafeFetchError } from '../../core/safe-fetch.js';
import { newId } from '../../core/id.js';
import { createDocumentJobs, type DocumentJobs } from '../documents/documents.jobs.js';
import { shoppingImports, shoppingProducts } from '../../db/schema/shopping.js';
import { failInterruptedImports } from './shopping.imports.js';

/**
 * Testy importów list zakupów (`F10-8`, `F10-9`, 08 §17, I-30, I-31) — z atrapą
 * ekstraktora i pobierania strony: żaden test nie woła AI ani sieci.
 */

const NOW = new Date('2026-11-23T10:00:00.000Z');
const META = {
  usage: { inputTokens: 1000, outputTokens: 500 },
  model: 'claude-haiku-5-5',
  requestId: 'r',
  diagnostics: {},
};

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Środowisko testu. */
interface Setup {
  app: TestApp;
  home: HouseholdFixture;
  jobs: DocumentJobs;
  extractor: { extractList: ReturnType<typeof vi.fn>; extractRecipe: ReturnType<typeof vi.fn> };
  fetchHtml: ReturnType<typeof vi.fn>;
  listId: string;
}

/**
 * Aplikacja z atrapą ekstraktora i listą „Spożywcze".
 *
 * @param budgetMinor - Limit kosztów (`0` — bez limitu).
 * @returns Środowisko.
 */
async function setup(budgetMinor = 0): Promise<Setup> {
  const extractor = { extractList: vi.fn(), extractRecipe: vi.fn() };
  const fetchHtml = vi.fn();
  const jobs = createDocumentJobs();
  const app = await buildTestApp(
    { ai: { ...testConfig().ai, monthlyBudgetMinor: budgetMinor } },
    mutableClock(NOW),
    {
      shoppingExtractor: extractor as unknown as ShoppingExtractor,
      documentJobs: jobs,
      fetchRecipeHtml: fetchHtml,
    },
  );
  harness = app;
  const home = await householdFixture(app.db, testConfig(), NOW);
  const lists = await app.app.inject({
    method: 'GET',
    url: '/api/v1/shopping-lists',
    headers: home.headers,
  });
  const listId = (lists.json<{ data: ShoppingListDto[] }>().data[0] as ShoppingListDto).id;
  return { app, home, jobs, extractor, fetchHtml, listId };
}

/**
 * Żądanie jako domownik.
 *
 * @param s - Środowisko.
 * @param method - Metoda.
 * @param url - Ścieżka za `/api/v1`.
 * @param payload - Ciało JSON.
 * @param headers - Dodatkowe nagłówki.
 * @returns Status i dane.
 */
async function call<T>(
  s: Setup,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: T; body: string }> {
  const response = await s.app.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...s.home.headers, ...headers },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
  const parsed = response.body === '' ? {} : (JSON.parse(response.body) as { data?: T });
  return { status: response.statusCode, data: parsed.data as T, body: response.body };
}

/**
 * Wysyła zdjęcie listy i czeka na odczyt.
 *
 * @param s - Środowisko.
 * @param fields - Dodatkowe pola.
 * @returns Import po odczycie.
 */
async function uploadPhoto(
  s: Setup,
  fields: Record<string, string> = {},
): Promise<ShoppingImportDto> {
  const body = multipart(
    { listId: s.listId, kind: 'list_photo', ...fields },
    {
      field: 'image',
      filename: 'tablica.jpg',
      contentType: 'image/jpeg',
      bytes: await receiptPhoto(),
    },
  );
  const response = await s.app.app.inject({
    method: 'POST',
    url: '/api/v1/shopping-imports',
    headers: { ...s.home.headers, ...body.headers },
    payload: body.payload,
  });
  expect(response.statusCode, response.body).toBe(202);
  await s.jobs.idle();
  const id = response.json<{ data: ShoppingImportDto }>().data.id;
  return (await call<ShoppingImportDto>(s, 'GET', `/shopping-imports/${id}`)).data;
}

/** Odczyt zdjęcia: mleko (już na liście po dopisaniu), chleb, niepewne „mlko". */
const LIST_RESULT: ListExtraction = {
  ...META,
  rawResponse: '{}',
  notes: null,
  items: [
    {
      name: 'Mleko',
      sourceText: 'mleko 2',
      quantityMilli: 2000,
      unit: 'pcs',
      section: 'dairy',
      confidenceBps: 9500,
    },
    {
      name: 'Chleb',
      sourceText: 'chleb',
      quantityMilli: null,
      unit: null,
      section: 'bakery',
      confidenceBps: 4000,
    },
  ],
};

/** Przepis: czekolada w tabliczkach, sól do smaku (staple), jajka w opakowaniu. */
const RECIPE_RESULT: RecipeExtraction = {
  ...META,
  rawResponse: '{}',
  notes: null,
  title: 'Brownie',
  baseServings: 12,
  ingredients: [
    {
      name: 'Czekolada gorzka',
      sourceText: '200 g czekolady',
      baseAmountMilli: 200_000,
      baseUnit: 'g',
      packageAmountMilli: 100_000,
      packageLabel: 'tabliczka',
      pantryStaple: false,
      section: 'dry_goods',
      confidenceBps: 9000,
    },
    {
      name: 'Sól',
      sourceText: 'szczypta soli',
      baseAmountMilli: null,
      baseUnit: null,
      packageAmountMilli: null,
      packageLabel: null,
      pantryStaple: true,
      section: 'dry_goods',
      confidenceBps: 9500,
    },
    {
      name: 'Kakao',
      sourceText: '2 łyżki kakao',
      baseAmountMilli: 20_000,
      baseUnit: 'g',
      packageAmountMilli: 80_000,
      packageLabel: 'opak.',
      pantryStaple: true,
      section: 'dry_goods',
      confidenceBps: 9000,
    },
  ],
};

describe('zdjęcie listy (F10-8)', () => {
  it('odczyt → propozycje ze scaleniem, „Sprawdź" przy niskiej pewności → commit dopisuje', async () => {
    const s = await setup();
    s.extractor.extractList.mockResolvedValue(LIST_RESULT);
    await call(s, 'POST', `/shopping-lists/${s.listId}/items`, {
      name: 'Mleko',
      quantityMilli: 1000,
      unit: 'pcs',
    });

    const parsed = await uploadPhoto(s);
    expect(parsed).toMatchObject({ status: 'parsed', kind: 'list_photo', errorMessage: null });
    expect(
      parsed.items.map((item) => [
        item.name,
        item.quantityMilli,
        item.needsReview,
        item.mergeInto?.quantityMilli ?? null,
        item.isStaple,
      ]),
    ).toEqual([
      ['Mleko', 2000, false, 1000, true],
      ['Chleb', null, true, null, false],
    ]);
    // Model dostał przygotowany obraz (bez EXIF, przeskalowany) i model z ustawień.
    const [input] = s.extractor.extractList.mock.calls[0] as [
      { model: string; parts: { kind: string }[] },
    ];
    expect(input.model).toBe(testConfig().ai.model);
    expect(input.parts.map((part) => part.kind)).toEqual(['image']);

    const commit = await call<CommitShoppingImportResult>(
      s,
      'POST',
      `/shopping-imports/${parsed.id}/commit`,
      undefined,
      {
        'idempotency-key': 'commit-1-abcdef',
      },
    );
    expect(commit.data).toEqual({ listId: s.listId, addedCount: 1, mergedCount: 1 });
    const again = await call<CommitShoppingImportResult>(
      s,
      'POST',
      `/shopping-imports/${parsed.id}/commit`,
      undefined,
      {
        'idempotency-key': 'commit-1-abcdef',
      },
    );
    expect(again.data).toEqual(commit.data);

    const list = await call<ShoppingItemsDto>(s, 'GET', `/shopping-lists/${s.listId}/items`);
    expect(list.data.items.map((item) => [item.name, item.quantityMilli, item.source])).toEqual([
      ['Chleb', null, 'list_photo'],
      ['Mleko', 3000, 'manual'],
    ]);
    const after = await call<ShoppingImportDto>(s, 'GET', `/shopping-imports/${parsed.id}`);
    expect(after.data.status).toBe('committed');
    const row = s.app.db.db.select().from(shoppingImports).get();
    expect(row).toMatchObject({ filePaths: '[]', aiRawResponse: null });
    expect(row?.costMinor).toBeGreaterThan(0);
  });

  it('pliki zapisane bez EXIF w katalogu shopping, usunięte po odrzuceniu', async () => {
    const s = await setup();
    s.extractor.extractList.mockResolvedValue(LIST_RESULT);
    const parsed = await uploadPhoto(s);
    const [path] = JSON.parse(
      s.app.db.db.select().from(shoppingImports).where(eq(shoppingImports.id, parsed.id)).get()
        ?.filePaths ?? '[]',
    ) as string[];
    expect(path).toMatch(/^shopping\/2026\/11\/[0-9A-Z]{26}-1\.jpg$/u);
    const absolute = join(testConfig().uploads.dir, path ?? '');
    await expect(access(absolute)).resolves.toBeUndefined();
    expect((await call(s, 'POST', `/shopping-imports/${parsed.id}/discard`)).status).toBe(204);
    await expect(access(absolute)).rejects.toThrow();
    expect((await call(s, 'POST', `/shopping-imports/${parsed.id}/discard`)).status).toBe(409);
    expect(
      (
        await call(s, 'POST', `/shopping-imports/${parsed.id}/commit`, undefined, {
          'idempotency-key': 'k-12345678',
        })
      ).status,
    ).toBe(409);
  });

  it('błąd odczytu → failed z kodem, koszt policzony; ponowienie działa', async () => {
    const s = await setup();
    s.extractor.extractList
      .mockRejectedValueOnce(
        new ExtractionError('AI_SCHEMA_MISMATCH', 'x', { usage: META.usage, rawResponse: 'zły' }),
      )
      .mockResolvedValueOnce(LIST_RESULT);
    const failed = await uploadPhoto(s);
    expect(failed).toMatchObject({
      status: 'failed',
      errorCode: 'AI_SCHEMA_MISMATCH',
      errorMessage: 'Nie udało się odczytać. Spróbuj ponownie.',
    });
    const retry = await call<ShoppingImportDto>(s, 'POST', `/shopping-imports/${failed.id}/retry`);
    expect(retry.status).toBe(202);
    await s.jobs.idle();
    expect(
      (await call<ShoppingImportDto>(s, 'GET', `/shopping-imports/${failed.id}`)).data.status,
    ).toBe('parsed');
    expect((await call(s, 'POST', `/shopping-imports/${failed.id}/retry`)).status).toBe(409);
  });

  it('nie-obraz → 415; brak zdjęcia → 400; cudzy import → 404; AI wyłączone → 502', async () => {
    const s = await setup();
    const pdf = multipart(
      { listId: s.listId, kind: 'list_photo' },
      {
        field: 'image',
        filename: 'x.pdf',
        contentType: 'application/pdf',
        bytes: Buffer.from('%PDF-1.4\n'),
      },
    );
    const notImage = await s.app.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-imports',
      headers: { ...s.home.headers, ...pdf.headers },
      payload: pdf.payload,
    });
    expect(notImage.statusCode).toBe(415);
    const empty = multipart({ listId: s.listId, kind: 'list_photo' }, null);
    const none = await s.app.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-imports',
      headers: { ...s.home.headers, ...empty.headers },
      payload: empty.payload,
    });
    expect(none.statusCode).toBe(400);

    s.extractor.extractList.mockResolvedValue(LIST_RESULT);
    const parsed = await uploadPhoto(s);
    const other = await householdFixture(s.app.db, testConfig(), NOW);
    const foreign = await s.app.app.inject({
      method: 'GET',
      url: `/api/v1/shopping-imports/${parsed.id}`,
      headers: other.headers,
    });
    expect(foreign.statusCode).toBe(404);

    const off = await buildTestApp({}, mutableClock(NOW), { shoppingExtractor: null });
    const home = await householdFixture(off.db, testConfig(), NOW);
    const text = await off.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-imports',
      headers: home.headers,
      payload: {
        input: 'text',
        listId: newId(),
        kind: 'recipe',
        text: 'a'.repeat(30),
        servingsFactorBps: 10_000,
      },
    });
    // Jak przy dokumentach: `EXTERNAL_SERVICE_ERROR` (502), komunikat „wyłączony”.
    expect(text.statusCode).toBe(502);
    await off.close();
  });

  it('wyczerpany limit kosztów → 402, import zostaje jako failed', async () => {
    const s = await setup(1);
    s.app.db.sqlite
      .prepare(
        "INSERT INTO app_meta(key, value, updated_at) VALUES ('ai_spend_2026-11_minor', '5', 0)",
      )
      .run();
    const response = await call<unknown>(s, 'POST', '/shopping-imports', {
      input: 'text',
      listId: s.listId,
      kind: 'recipe',
      text: 'Brownie: 200 g czekolady, sól',
      servingsFactorBps: 10_000,
    });
    expect(response.status).toBe(402);
    const row = s.app.db.db.select().from(shoppingImports).get();
    expect(row).toMatchObject({ status: 'failed', errorCode: 'AI_BUDGET_EXCEEDED' });
    expect(s.extractor.extractRecipe).not.toHaveBeenCalled();
  });

  it('przerwany restartem odczyt jest oznaczany przy starcie', async () => {
    const s = await setup();
    const id = newId();
    // Przerwany chwilę przed restartem — też martwy (ADR-102).
    const old = NOW.getTime() - 30_000;
    s.app.db.db
      .insert(shoppingImports)
      .values({
        id,
        householdId: s.home.householdId,
        listId: s.listId,
        kind: 'list_photo',
        input: 'image',
        status: 'processing',
        createdBy: s.home.userId,
        createdAt: old,
        updatedAt: old,
      })
      .run();
    expect(failInterruptedImports({ db: s.app.db, clock: mutableClock(NOW) })).toBe(1);
    expect((await call<ShoppingImportDto>(s, 'GET', `/shopping-imports/${id}`)).data).toMatchObject(
      {
        status: 'failed',
        errorCode: 'INTERRUPTED',
        errorMessage: 'Odczyt przerwany — spróbuj ponownie.',
      },
    );
  });
});

describe('przepis (F10-9)', () => {
  /**
   * Przepis z wklejonego tekstu, po odczycie.
   *
   * @param s - Środowisko.
   * @param factor - Mnożnik.
   * @returns Import.
   */
  async function textRecipe(s: Setup, factor = 5_000): Promise<ShoppingImportDto> {
    s.extractor.extractRecipe.mockResolvedValue(RECIPE_RESULT);
    const created = await call<ShoppingImportDto>(s, 'POST', '/shopping-imports', {
      input: 'text',
      listId: s.listId,
      kind: 'recipe',
      text: 'Brownie: 200 g czekolady, szczypta soli',
      servingsFactorBps: factor,
    });
    expect(created.status, created.body).toBe(202);
    await s.jobs.idle();
    return (await call<ShoppingImportDto>(s, 'GET', `/shopping-imports/${created.data.id}`)).data;
  }

  it('opakowania przy mnożniku, „Już mam" z flagi i z oceny modelu, dopisek z potrzebą', async () => {
    const s = await setup();
    // Kakao z flagą zdjętą w słowniku — słownik wygrywa z oceną modelu.
    await call(s, 'POST', '/shopping-products', { name: 'Kakao', isStaple: false });
    const parsed = await textRecipe(s);
    expect(parsed).toMatchObject({
      status: 'parsed',
      recipeTitle: 'Brownie',
      baseServings: 12,
      servingsFactorBps: 5_000,
    });
    expect(
      parsed.items.map((item) => [
        item.name,
        item.quantityMilli,
        item.unit,
        item.neededAmountMilli,
        item.alreadyHave,
        item.selected,
      ]),
    ).toEqual([
      ['Czekolada gorzka', 1000, 'pcs', 100_000, false, true],
      ['Sól', 1000, 'pcs', null, true, false],
      ['Kakao', 1000, 'pcs', 10_000, false, true],
    ]);
    const [input] = s.extractor.extractRecipe.mock.calls[0] as [
      { text: string; staples: string[]; parts: unknown[] },
    ];
    expect(input.text).toBe('Brownie: 200 g czekolady, szczypta soli');
    expect(input.parts).toEqual([]);
    expect(input.staples).toEqual(expect.arrayContaining(['Sól', 'Mleko']));
    expect(input.staples).not.toContain('Kakao');

    const commit = await call<CommitShoppingImportResult>(
      s,
      'POST',
      `/shopping-imports/${parsed.id}/commit`,
      undefined,
      { 'idempotency-key': 'commit-recipe-1' },
    );
    expect(commit.data).toMatchObject({ addedCount: 2, mergedCount: 0 });
    const list = await call<ShoppingItemsDto>(s, 'GET', `/shopping-lists/${s.listId}/items`);
    expect(list.data.items.map((item) => [item.name, item.note])).toEqual([
      ['Czekolada gorzka', '100 g · Brownie'],
      ['Kakao', '10 g · Brownie'],
    ]);
  });

  it('zmiana mnożnika przelicza bez AI, poprawionej ilości nie rusza', async () => {
    const s = await setup();
    const parsed = await textRecipe(s);
    const chocolate = parsed.items[0]?.id ?? '';
    const cocoa = parsed.items[2]?.id ?? '';
    await call(s, 'PATCH', `/shopping-imports/${parsed.id}/items/${cocoa}`, {
      quantityMilli: 3000,
      unit: 'pcs',
    });
    const doubled = await call<ShoppingImportDto>(s, 'PATCH', `/shopping-imports/${parsed.id}`, {
      servingsFactorBps: 20_000,
    });
    const byId = new Map(doubled.data.items.map((item) => [item.id, item]));
    expect(byId.get(chocolate)).toMatchObject({ quantityMilli: 4000, neededAmountMilli: 400_000 });
    expect(byId.get(cocoa)).toMatchObject({ quantityMilli: 3000, quantityOverridden: true });
    expect(s.extractor.extractRecipe).toHaveBeenCalledTimes(1);

    const moved = await call<ShoppingImportDto>(
      s,
      'PATCH',
      `/shopping-imports/${parsed.id}/items/${chocolate}`,
      { selected: false, alreadyHave: true, name: ' Czekolada ' },
    );
    expect(moved.data.items[0]).toMatchObject({
      name: 'Czekolada',
      selected: false,
      alreadyHave: true,
    });
    expect(
      (
        await call(s, 'PATCH', `/shopping-imports/${parsed.id}/items/${newId()}`, {
          selected: true,
        })
      ).status,
    ).toBe(404);
  });

  it('link: strona pobrana przez bezpieczne pobieranie, JSON-LD do modelu', async () => {
    const s = await setup();
    s.fetchHtml.mockResolvedValue({
      url: 'https://przepisy.pl/brownie',
      html: `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Brownie', recipeIngredient: ['200 g czekolady'] })}</script>`,
    });
    s.extractor.extractRecipe.mockResolvedValue(RECIPE_RESULT);
    const created = await call<ShoppingImportDto>(s, 'POST', '/shopping-imports', {
      input: 'url',
      listId: s.listId,
      kind: 'recipe',
      url: 'https://przepisy.pl/brownie',
      servingsFactorBps: 10_000,
    });
    await s.jobs.idle();
    expect(s.fetchHtml).toHaveBeenCalledWith('https://przepisy.pl/brownie');
    const [input] = s.extractor.extractRecipe.mock.calls[0] as [{ text: string }];
    expect(input.text).toBe('Tytuł: Brownie\nSkładniki:\n- 200 g czekolady');
    expect(
      (await call<ShoppingImportDto>(s, 'GET', `/shopping-imports/${created.data.id}`)).data,
    ).toMatchObject({
      status: 'parsed',
      input: 'url',
      sourceUrl: 'https://przepisy.pl/brownie',
    });
  });

  it.each([
    [
      new SafeFetchError('RECIPE_FETCH_BLOCKED', 'Adres 127.0.0.1 nie jest publiczny'),
      'RECIPE_FETCH_BLOCKED',
      /Tego adresu nie da się pobrać/u,
    ],
    [
      new SafeFetchError('RECIPE_FETCH_FAILED', 'Status 403'),
      'RECIPE_FETCH_FAILED',
      /Nie udało się pobrać przepisu/u,
    ],
    [new Error('nieoczekiwany'), 'RECIPE_FETCH_FAILED', /Nie udało się pobrać przepisu/u],
  ])('nieudane pobranie (%s) → failed bez wywołania modelu', async (error, code, message) => {
    const s = await setup();
    s.fetchHtml.mockRejectedValue(error);
    const created = await call<ShoppingImportDto>(s, 'POST', '/shopping-imports', {
      input: 'url',
      listId: s.listId,
      kind: 'recipe',
      url: 'http://127.0.0.1/',
      servingsFactorBps: 10_000,
    });
    await s.jobs.idle();
    const after = (await call<ShoppingImportDto>(s, 'GET', `/shopping-imports/${created.data.id}`))
      .data;
    expect(after).toMatchObject({ status: 'failed', errorCode: code });
    expect(after.errorMessage).toMatch(message);
    expect(s.extractor.extractRecipe).not.toHaveBeenCalled();
  });

  it('link z innym schematem → 400 od razu; model bez składników → RECIPE_NOT_FOUND', async () => {
    const s = await setup();
    const bad = await call(s, 'POST', '/shopping-imports', {
      input: 'url',
      listId: s.listId,
      kind: 'recipe',
      url: 'file:///etc/passwd',
      servingsFactorBps: 10_000,
    });
    expect(bad.status).toBe(400);
    s.extractor.extractRecipe.mockResolvedValue({
      ...RECIPE_RESULT,
      ingredients: [],
      notes: 'To nie jest przepis.',
    });
    const created = await call<ShoppingImportDto>(s, 'POST', '/shopping-imports', {
      input: 'text',
      listId: s.listId,
      kind: 'recipe',
      text: 'Regulamin sklepu internetowego…',
      servingsFactorBps: 10_000,
    });
    await s.jobs.idle();
    expect(
      (await call<ShoppingImportDto>(s, 'GET', `/shopping-imports/${created.data.id}`)).data,
    ).toMatchObject({
      status: 'failed',
      errorCode: 'RECIPE_NOT_FOUND',
      notes: 'To nie jest przepis.',
    });
  });

  it('zrzuty ekranu przepisu idą jako obrazy; mnożnik tylko dla przepisu', async () => {
    const s = await setup();
    s.extractor.extractRecipe.mockResolvedValue(RECIPE_RESULT);
    const photo = await receiptPhoto();
    const body = multipart(
      { listId: s.listId, kind: 'recipe', servingsFactorBps: '15000' },
      { field: 'image', filename: 'a.jpg', contentType: 'image/jpeg', bytes: photo },
    );
    const response = await s.app.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-imports',
      headers: { ...s.home.headers, ...body.headers },
      payload: body.payload,
    });
    expect(response.statusCode, response.body).toBe(202);
    await s.jobs.idle();
    const [input] = s.extractor.extractRecipe.mock.calls[0] as [
      { text: string | null; parts: unknown[] },
    ];
    expect(input.text).toBeNull();
    expect(input.parts).toHaveLength(1);

    s.extractor.extractList.mockResolvedValue(LIST_RESULT);
    const photoImport = await uploadPhoto(s);
    expect(
      (await call(s, 'PATCH', `/shopping-imports/${photoImport.id}`, { servingsFactorBps: 20_000 }))
        .status,
    ).toBe(400);
  });

  it('zmiana listy docelowej przelicza scalenie; zatwierdzenie bez zaznaczonych → 409', async () => {
    const s = await setup();
    const other = await call<ShoppingListDto>(s, 'POST', '/shopping-lists', { name: 'Dom' });
    await call(s, 'POST', `/shopping-lists/${other.data.id}/items`, {
      name: 'Czekolada gorzka',
      quantityMilli: 1000,
      unit: 'pcs',
    });
    const parsed = await textRecipe(s);
    expect(parsed.items[0]?.mergeInto).toBeNull();
    const moved = await call<ShoppingImportDto>(s, 'PATCH', `/shopping-imports/${parsed.id}`, {
      listId: other.data.id,
    });
    expect(moved.data.items[0]?.mergeInto).toMatchObject({ quantityMilli: 1000 });
    for (const item of moved.data.items) {
      await call(s, 'PATCH', `/shopping-imports/${parsed.id}/items/${item.id}`, {
        selected: false,
      });
    }
    expect(
      (
        await call(s, 'POST', `/shopping-imports/${parsed.id}/commit`, undefined, {
          'idempotency-key': 'empty-commit-1',
        })
      ).status,
    ).toBe(409);
  });
});

describe('poprawki po przeglądzie (ADR-102)', () => {
  it('dział ze słownika wygrywa z modelem i nie jest nadpisywany przy zatwierdzeniu', async () => {
    const s = await setup();
    await call(s, 'POST', `/shopping-lists/${s.listId}/items`, { name: 'Chleb', section: 'other' });
    s.extractor.extractList.mockResolvedValue(LIST_RESULT);
    const parsed = await uploadPhoto(s);
    expect(parsed.items.find((item) => item.name === 'Chleb')?.section).toBe('other');
    await call(s, 'POST', `/shopping-imports/${parsed.id}/commit`, undefined, {
      'idempotency-key': 'commit-adr102-a',
    });
    const product = s.app.db.db
      .select()
      .from(shoppingProducts)
      .where(eq(shoppingProducts.normalizedName, 'chleb'))
      .get();
    expect(product?.section).toBe('other');
  });

  it('pusty odczyt zdjęcia da się ponowić', async () => {
    const s = await setup();
    s.extractor.extractList
      .mockResolvedValueOnce({ ...LIST_RESULT, items: [], notes: 'Rozmyte' })
      .mockResolvedValueOnce(LIST_RESULT);
    const empty = await uploadPhoto(s);
    expect(empty).toMatchObject({ status: 'parsed', items: [] });
    expect((await call(s, 'POST', `/shopping-imports/${empty.id}/retry`)).status).toBe(202);
    await s.jobs.idle();
    const again = (await call<ShoppingImportDto>(s, 'GET', `/shopping-imports/${empty.id}`)).data;
    expect(again.items).toHaveLength(2);
    // Odczyt z propozycjami ponowić już nie można — byłoby to wyrzucenie przeglądu.
    expect((await call(s, 'POST', `/shopping-imports/${empty.id}/retry`)).status).toBe(409);
  });

  it('powtórzone zatwierdzenie ma nagłówek Idempotent-Replayed', async () => {
    const s = await setup();
    s.extractor.extractList.mockResolvedValue(LIST_RESULT);
    const parsed = await uploadPhoto(s);
    const send = () =>
      s.app.app.inject({
        method: 'POST',
        url: `/api/v1/shopping-imports/${parsed.id}/commit`,
        headers: { ...s.home.headers, 'idempotency-key': 'commit-adr102-b' },
      });
    expect((await send()).headers['idempotent-replayed']).toBeUndefined();
    expect((await send()).headers['idempotent-replayed']).toBe('true');
  });

  it('strona bez tekstu → RECIPE_NOT_FOUND bez wywołania modelu', async () => {
    const s = await setup();
    s.fetchHtml.mockResolvedValue({
      url: 'https://spa.example/przepis',
      html: '<div id="root"></div><script src="app.js"></script>',
    });
    const created = await call<ShoppingImportDto>(s, 'POST', '/shopping-imports', {
      input: 'url',
      listId: s.listId,
      kind: 'recipe',
      url: 'https://spa.example/przepis',
      servingsFactorBps: 10_000,
    });
    await s.jobs.idle();
    expect(
      (await call<ShoppingImportDto>(s, 'GET', `/shopping-imports/${created.data.id}`)).data,
    ).toMatchObject({ status: 'failed', errorCode: 'RECIPE_NOT_FOUND' });
    expect(s.extractor.extractRecipe).not.toHaveBeenCalled();
  });

  it('stan odczytu zmienia wersję listy — baner „Odczyt gotowy" dochodzi mimo ETag', async () => {
    const s = await setup();
    s.extractor.extractList.mockResolvedValue(LIST_RESULT);
    const etagOf = async (): Promise<string | undefined> =>
      (
        await s.app.app.inject({
          method: 'GET',
          url: `/api/v1/shopping-lists/${s.listId}/items`,
          headers: s.home.headers,
        })
      ).headers.etag;
    const before = await etagOf();
    const parsed = await uploadPhoto(s);
    const after = await etagOf();
    expect(after).not.toBe(before);
    const items = await call<{ list: { pendingImports: { id: string; status: string }[] } }>(
      s,
      'GET',
      `/shopping-lists/${s.listId}/items`,
    );
    expect(items.data.list.pendingImports).toEqual([
      { id: parsed.id, status: 'parsed', kind: 'list_photo' },
    ]);
    await call(s, 'POST', `/shopping-imports/${parsed.id}/discard`);
    expect(await etagOf()).not.toBe(after);
  });
});
