import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  householdFixture,
  insertAccount,
  insertBudgetDraft,
  insertBudgetGroup,
  insertBudgetLine,
  insertCategory,
  insertGoal,
  insertIncomeSource,
  insertLiability,
  insertTransaction,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock } from '../../core/clock.js';
import { newId } from '../../core/id.js';
import { accounts } from '../../db/schema/accounts.js';
import { budgetDraftGroups, budgetDraftLines, budgetDrafts } from '../../db/schema/budget.js';
import { categories } from '../../db/schema/categories.js';
import { documentItems, documents } from '../../db/schema/documents.js';
import { households } from '../../db/schema/households.js';
import { recurringOccurrences, recurringRules } from '../../db/schema/recurring.js';
import { transactions } from '../../db/schema/transactions.js';
import { users } from '../../db/schema/users.js';
import { hashPin } from '../auth/auth.pin.js';
import { signAccessToken } from '../auth/auth.tokens.js';
import { resolveStoredPath, thumbnailPathFor } from '../documents/documents.files.js';

/**
 * Testy tras ustawień — zadania `F8-1` i `F8-2`
 * ([04 §15](../../../../../../plans/04-api-spec.md#15-ustawienia--apiv1settings)).
 */

/** Kształt odpowiedzi błędu. */
interface ErrorBody {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
}

/** Ustawienia w kształcie odpowiedzi. */
interface SettingsBody {
  household: {
    id: string;
    name: string;
    timezone: string;
    backPostingLimitMonths: number;
    monthStartDay: number;
    baseCurrency: string;
  };
  users: { id: string; displayName: string; isCurrent: boolean; email: string }[];
  appVersion: string;
}

/** Eksport w kształcie odpowiedzi. */
interface ExportBody {
  format: string;
  version: number;
  exportedAt: number;
  appVersion: string;
  household: { id: string; name: string };
  users: Record<string, unknown>[];
  tables: Record<string, Record<string, unknown>[]>;
}

const START = new Date('2026-09-23T10:00:00.000Z');
const BASE = '/api/v1/settings';

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
 * Buduje aplikację z gospodarstwem.
 *
 * @returns Aplikacja i gospodarstwo.
 */
async function setup(): Promise<Setup> {
  const app = await buildTestApp({}, mutableClock(START));
  harness = app;
  return { app, home: await householdFixture(app.db, testConfig(), START) };
}

/**
 * Wysyła żądanie w imieniu gospodarstwa.
 *
 * @param s - Aplikacja.
 * @param method - Metoda HTTP.
 * @param url - Ścieżka względem `/api/v1/settings`.
 * @param payload - Ciało.
 * @param home - Gospodarstwo.
 * @returns Odpowiedź.
 */
function call(
  s: Setup,
  method: 'GET' | 'PATCH' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
  home: Pick<HouseholdFixture, 'headers'> = s.home,
): Promise<LightMyRequestResponse> {
  return s.app.app.inject({
    method,
    url: `${BASE}${url}`,
    headers: home.headers,
    ...(payload === undefined ? {} : { payload }),
  });
}

/**
 * Dokłada drugiego domownika do gospodarstwa i podpisuje mu token.
 *
 * @param s - Aplikacja.
 * @param displayName - Nazwa wyświetlana.
 * @param createdAt - Chwila założenia konta (kolejność na liście).
 * @returns Identyfikator i nagłówki żądania.
 */
async function secondMember(
  s: Setup,
  displayName = 'Ania',
  createdAt = START.getTime() + 1,
): Promise<{ userId: string; headers: Record<string, string> }> {
  const userId = newId();
  s.app.db.db
    .insert(users)
    .values({
      id: userId,
      householdId: s.home.householdId,
      email: `${userId.toLowerCase()}@example.com`,
      displayName,
      pinHash: 'drugi-hash-pinu',
      pinUpdatedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    })
    .run();
  const token = await signAccessToken(
    testConfig(),
    { sub: userId, hid: s.home.householdId, sid: newId() },
    START,
  );
  return {
    userId,
    headers: { authorization: `Bearer ${token}`, 'x-requested-with': 'fineapp' },
  };
}

describe('uwierzytelnienie', () => {
  it('każda trasa bez tokenu daje 401', async () => {
    const s = await setup();
    const routes: ['GET' | 'PATCH' | 'POST', string][] = [
      ['GET', ''],
      ['PATCH', '/household'],
      ['PATCH', '/profile'],
      ['GET', '/export'],
      ['GET', '/export.csv'],
      ['GET', '/ai-usage'],
      ['POST', '/reset'],
    ];
    for (const [method, url] of routes) {
      const response = await s.app.app.inject({
        method,
        url: `${BASE}${url}`,
        headers: { 'x-requested-with': 'fineapp' },
        ...(method === 'GET' ? {} : { payload: {} }),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('GET /settings', () => {
  it('zwraca gospodarstwo, domowników i wersję', async () => {
    const s = await setup();
    const response = await call(s, 'GET', '');
    expect(response.statusCode).toBe(200);
    const data = response.json<{ data: SettingsBody }>().data;
    expect(data.household).toMatchObject({
      id: s.home.householdId,
      name: 'Dom',
      timezone: 'Europe/Warsaw',
      baseCurrency: 'PLN',
      backPostingLimitMonths: 1,
      monthStartDay: 1,
    });
    expect(data.users).toEqual([expect.objectContaining({ id: s.home.userId, isCurrent: true })]);
    expect(data.appVersion).toBe('0.0.0-test');
  });

  it('zalogowana osoba pierwsza, nawet gdy drugi domownik założył konto wcześniej', async () => {
    const s = await setup();
    const other = await secondMember(s, 'Ania', START.getTime() - 1_000);

    const mine = (await call(s, 'GET', '')).json<{ data: SettingsBody }>().data.users;
    expect(mine.map((u) => [u.id, u.isCurrent])).toEqual([
      [s.home.userId, true],
      [other.userId, false],
    ]);

    const theirs = (await call(s, 'GET', '', undefined, other)).json<{ data: SettingsBody }>().data
      .users;
    expect(theirs.map((u) => u.displayName)).toEqual(['Ania', 'Test']);
  });

  it('nie pokazuje wyłączonych domowników ani ludzi z innego gospodarstwa', async () => {
    const s = await setup();
    const other = await secondMember(s);
    s.app.db.db.update(users).set({ isActive: false }).where(eq(users.id, other.userId)).run();
    await householdFixture(s.app.db, testConfig(), START);

    const list = (await call(s, 'GET', '')).json<{ data: SettingsBody }>().data.users;
    expect(list.map((u) => u.id)).toEqual([s.home.userId]);
    expect(list.map((u) => u.id)).not.toContain(other.userId);
  });

  it('nie zdradza hasha PIN-u', async () => {
    const s = await setup();
    await secondMember(s);
    const body = (await call(s, 'GET', '')).body;
    expect(body).not.toContain('pinHash');
    expect(body).not.toContain('nie-jest-hashem');
    expect(body).not.toContain('drugi-hash-pinu');
  });
});

describe('PATCH /settings/household', () => {
  it('zmienia nazwę, strefę i limit wstecz', async () => {
    const s = await setup();
    const response = await call(s, 'PATCH', '/household', {
      name: '  Mieszkanie na Woli ',
      timezone: 'Europe/London',
      backPostingLimitMonths: 3,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ data: SettingsBody['household'] }>().data).toMatchObject({
      name: 'Mieszkanie na Woli',
      timezone: 'Europe/London',
      backPostingLimitMonths: 3,
    });

    const me = (
      await s.app.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: s.home.headers })
    ).json<{ data: { household: SettingsBody['household'] } }>().data.household;
    expect(me.name).toBe('Mieszkanie na Woli');
  });

  it('puste ciało niczego nie zmienia', async () => {
    const s = await setup();
    const response = await call(s, 'PATCH', '/household', {});
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: SettingsBody['household'] }>().data.name).toBe('Dom');
  });

  it('odrzuca nieznaną strefę, limit ponad 12 i dzień startu inny niż 1', async () => {
    const s = await setup();
    for (const [payload, path] of [
      [{ timezone: 'Europe/Gdansk' }, 'timezone'],
      [{ backPostingLimitMonths: 13 }, 'backPostingLimitMonths'],
      [{ monthStartDay: 26 }, 'monthStartDay'],
      [{ name: '' }, 'name'],
    ] as const) {
      const response = await call(s, 'PATCH', '/household', payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json<ErrorBody>().error.details?.[0]?.path).toBe(path);
    }
  });

  it('nie rusza cudzego gospodarstwa', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    await call(s, 'PATCH', '/household', { name: 'Nasz dom' });
    const theirs = (await call(s, 'GET', '', undefined, other)).json<{ data: SettingsBody }>().data
      .household;
    expect(theirs.name).toBe('Dom');
  });

  it('limit działa od razu — obniżony zamyka poprzedni miesiąc', async () => {
    const s = await setup();
    const accountId = insertAccount(s.app.db, s.home);
    const post = (): Promise<LightMyRequestResponse> =>
      s.app.app.inject({
        method: 'POST',
        url: '/api/v1/transactions',
        headers: s.home.headers,
        payload: { type: 'expense', amountMinor: 1_000, bookedOn: '2026-08-20', accountId },
      });

    expect((await post()).statusCode).toBe(201);
    await call(s, 'PATCH', '/household', { backPostingLimitMonths: 0 });
    const blocked = await post();
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json<ErrorBody>().error.message).toContain('1 września 2026');
  });
});

describe('PATCH /settings/household — domyślne konto wydatków (ADR-070)', () => {
  it('ustawia i czyści konto; usunięcie konta czyści ustawienie', async () => {
    const s = await setup();
    const accountId = insertAccount(s.app.db, s.home, { name: 'Wspólne' });
    const set = await call(s, 'PATCH', '/household', { defaultExpenseAccountId: accountId });
    expect(set.statusCode, set.body).toBe(200);
    expect(
      set.json<{ data: { defaultExpenseAccountId: string | null } }>().data.defaultExpenseAccountId,
    ).toBe(accountId);

    const me = (
      await s.app.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: s.home.headers })
    ).json<{ data: { household: { defaultExpenseAccountId: string | null } } }>().data.household;
    expect(me.defaultExpenseAccountId).toBe(accountId);

    const cleared = await call(s, 'PATCH', '/household', { defaultExpenseAccountId: null });
    expect(
      cleared.json<{ data: { defaultExpenseAccountId: string | null } }>().data
        .defaultExpenseAccountId,
    ).toBeNull();

    await call(s, 'PATCH', '/household', { defaultExpenseAccountId: accountId });
    s.app.db.db.delete(accounts).where(eq(accounts.id, accountId)).run();
    const after = (await call(s, 'GET', '')).json<{
      data: { household: { defaultExpenseAccountId: string | null } };
    }>().data.household;
    expect(after.defaultExpenseAccountId).toBeNull();
  });

  it('konto innego gospodarstwa → 404, zarchiwizowane → 422', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreign = insertAccount(s.app.db, other);
    const missing = await call(s, 'PATCH', '/household', { defaultExpenseAccountId: foreign });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ErrorBody>().error.details?.[0]?.path).toBe('defaultExpenseAccountId');

    const archived = insertAccount(s.app.db, s.home, { isArchived: true });
    const rejected = await call(s, 'PATCH', '/household', { defaultExpenseAccountId: archived });
    expect(rejected.statusCode).toBe(422);
  });
});

describe('PATCH /settings/profile', () => {
  it('zmienia własną nazwę i kolor, `null` przywraca domyślny', async () => {
    const s = await setup();
    const changed = await call(s, 'PATCH', '/profile', {
      displayName: ' Adam ',
      avatarColor: '#7A5AF8',
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(
      changed.json<{ data: { displayName: string; avatarColor: string } }>().data,
    ).toMatchObject({ id: s.home.userId, displayName: 'Adam', avatarColor: '#7A5AF8' });

    const reset = await call(s, 'PATCH', '/profile', { avatarColor: null });
    expect(reset.json<{ data: { avatarColor: string | null } }>().data.avatarColor).toBeNull();
  });

  it('zmienia tylko siebie — drugi domownik zostaje bez zmian', async () => {
    const s = await setup();
    const other = await secondMember(s, 'Ania');
    await call(s, 'PATCH', '/profile', { displayName: 'Ktoś inny' });
    const list = (await call(s, 'GET', '', undefined, other)).json<{ data: SettingsBody }>().data
      .users;
    expect(list.find((u) => u.id === other.userId)?.displayName).toBe('Ania');
    expect(list.find((u) => u.id === s.home.userId)?.displayName).toBe('Ktoś inny');
  });

  it('odrzuca kolor spoza formatu', async () => {
    const s = await setup();
    const response = await call(s, 'PATCH', '/profile', { avatarColor: 'fioletowy' });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /settings/export', () => {
  it('oddaje plik z kompletem tabel, bez koperty i bez pamięci podręcznej', async () => {
    const s = await setup();
    const response = await call(s, 'GET', '/export');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="fineapp-2026-09-23.json"',
    );
    expect(response.headers['cache-control']).toBe('no-store');

    const body = response.json<ExportBody>();
    expect(body).toMatchObject({
      format: 'fineapp-export',
      version: 1,
      exportedAt: START.getTime(),
      appVersion: '0.0.0-test',
      household: { id: s.home.householdId, name: 'Dom' },
    });
    expect(Object.keys(body.tables)).toEqual([
      'accounts',
      'categories',
      'incomeSources',
      'goals',
      'liabilities',
      'allocationTargets',
      'recurringRules',
      'recurringOccurrences',
      'plannedExpenses',
      'documents',
      'documentItems',
      'budgetDrafts',
      'budgetDraftGroups',
      'budgetDraftLines',
      'transactions',
    ]);
  });

  it('zawiera szkice budżetu z liniami, bez cudzego gospodarstwa (ADR-079)', async () => {
    const s = await setup();
    const draftId = insertBudgetDraft(s.app.db, s.home, '2026-10');
    const lineId = insertBudgetLine(s.app.db, s.home, draftId, {
      name: 'Prezent dla mamy',
      amountMinor: 300_00,
    });
    const other = await householdFixture(s.app.db, testConfig(), START);
    insertBudgetDraft(s.app.db, other, '2026-10');

    const body = (await call(s, 'GET', '/export')).json<ExportBody>();
    expect(body.tables.budgetDrafts).toEqual([
      expect.objectContaining({ id: draftId, monthKey: '2026-10', createdBy: s.home.userId }),
    ]);
    expect(body.tables.budgetDraftLines).toEqual([
      expect.objectContaining({
        id: lineId,
        draftId,
        name: 'Prezent dla mamy',
        amountMinor: 300_00,
        origin: 'manual',
        isExcluded: false,
      }),
    ]);
  });

  it('zawiera dane gospodarstwa w całości — kwoty w groszach, pola w camelCase', async () => {
    const s = await setup();
    const accountId = insertAccount(s.app.db, s.home, {
      name: 'Konto wspólne',
      openingBalanceMinor: 123_45,
    });
    const txId = insertTransaction(s.app.db, s.home, {
      accountId,
      amountMinor: 4_99,
      description: 'Chleb',
    });

    const body = (await call(s, 'GET', '/export')).json<ExportBody>();
    expect(body.tables.accounts).toEqual([
      expect.objectContaining({
        id: accountId,
        name: 'Konto wspólne',
        openingBalanceMinor: 123_45,
        householdId: s.home.householdId,
      }),
    ]);
    expect(body.tables.transactions).toEqual([
      expect.objectContaining({ id: txId, amountMinor: 4_99, description: 'Chleb', accountId }),
    ]);
  });

  it('pomija kosz, cudze gospodarstwo, sesje i hashe PIN-ów', async () => {
    const s = await setup();
    await secondMember(s);
    const kept = insertTransaction(s.app.db, s.home);
    insertTransaction(s.app.db, s.home, { deletedAt: START.getTime() });
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreignAccount = insertAccount(s.app.db, other, { name: 'Cudze' });
    const foreignTx = insertTransaction(s.app.db, other, { description: 'Cudza' });

    const response = await call(s, 'GET', '/export');
    const body = response.json<ExportBody>();
    expect(body.tables.transactions?.map((row) => row.id)).toEqual([kept]);
    expect(response.body).not.toContain(foreignAccount);
    expect(response.body).not.toContain(foreignTx);
    expect(response.body).not.toContain('Cudza');

    expect(body.users).toHaveLength(2);
    for (const user of body.users) {
      expect(Object.keys(user).sort()).toEqual([
        'avatarColor',
        'createdAt',
        'displayName',
        'email',
        'id',
        'isActive',
      ]);
    }
    for (const secret of ['nie-jest-hashem', 'drugi-hash-pinu', 'pinHash', 'refreshTokenHash']) {
      expect(response.body).not.toContain(secret);
    }
  });

  it('pozycje dokumentów tylko z dokumentów gospodarstwa', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const insertDocument = (owner: HouseholdFixture, description: string): string => {
      const documentId = newId();
      const at = START.getTime();
      s.app.db.db
        .insert(documents)
        .values({
          id: documentId,
          householdId: owner.householdId,
          kind: 'receipt',
          status: 'parsed',
          originalFilename: 'paragon.jpg',
          storagePath: `2026/09/${documentId}`,
          mimeType: 'image/jpeg',
          byteSize: 1,
          sha256: documentId,
          uploadedBy: owner.userId,
          createdAt: at,
          updatedAt: at,
        })
        .run();
      s.app.db.db
        .insert(documentItems)
        .values({
          id: newId(),
          documentId,
          lineNo: 1,
          description,
          amountMinor: 250,
          createdAt: at,
          updatedAt: at,
        })
        .run();
      return documentId;
    };
    const mine = insertDocument(s.home, 'Masło');
    insertDocument(other, 'Cudze masło');

    const body = (await call(s, 'GET', '/export')).json<ExportBody>();
    expect(body.tables.documents?.map((row) => row.id)).toEqual([mine]);
    expect(body.tables.documentItems?.map((row) => row.description)).toEqual(['Masło']);
  });
});

describe('GET /settings/export.csv', () => {
  it('oddaje CSV dla polskiego Excela: BOM, średniki, kwota ze znakiem', async () => {
    const s = await setup();
    const ror = insertAccount(s.app.db, s.home, { name: 'ROR' });
    const savings = insertAccount(s.app.db, s.home, {
      name: 'Oszczędności',
      allocationClass: 'savings',
    });
    const food = insertCategory(s.app.db, s.home, { name: 'Jedzenie' });
    const bakery = insertCategory(s.app.db, s.home, { name: 'Piekarnia', parentId: food });
    const salary = insertIncomeSource(s.app.db, s.home, { name: 'Pensja Adama' });
    insertTransaction(s.app.db, s.home, {
      accountId: ror,
      categoryId: bakery,
      amountMinor: 1_234_56,
      bookedOn: '2026-09-02',
      description: 'Chleb; bułki',
      merchant: '=HYPERLINK("x")',
    });
    insertTransaction(s.app.db, s.home, {
      type: 'income',
      accountId: ror,
      incomeSourceId: salary,
      amountMinor: 800_000,
      bookedOn: '2026-09-01',
    });
    insertTransaction(s.app.db, s.home, {
      type: 'transfer',
      accountId: ror,
      counterAccountId: savings,
      amountMinor: 50_000,
      bookedOn: '2026-09-03',
    });

    const response = await call(s, 'GET', '/export.csv?month=2026-09');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="fineapp-2026-09.csv"',
    );
    expect(response.headers['cache-control']).toBe('no-store');

    const text = response.rawPayload.toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    const lines = text.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Data;Miesiąc;Typ;Kwota;Waluta;Konto;Konto docelowe;Kategoria;Źródło przychodu;Opis;Sprzedawca;Notatki;Status;Pochodzenie;Identyfikator',
    );
    expect(lines.slice(1).map((line) => line.split(';').slice(0, 9).join(';'))).toEqual([
      '2026-09-01;2026-09;Przychód;8000,00;PLN;ROR;;;Pensja Adama',
      '2026-09-02;2026-09;Wydatek;-1234,56;PLN;ROR;;Jedzenie / Piekarnia;',
      '2026-09-03;2026-09;Przelew;500,00;PLN;ROR;Oszczędności;;',
    ]);
    expect(lines[2]).toContain(';"Chleb; bułki";"\'=HYPERLINK(""x"")";');
  });

  it('bez miesiąca — wszystkie transakcje, plik z dzisiejszą datą; bez kosza', async () => {
    const s = await setup();
    insertTransaction(s.app.db, s.home, { bookedOn: '2026-08-31', monthKey: '2026-08' });
    insertTransaction(s.app.db, s.home, { bookedOn: '2026-09-01' });
    insertTransaction(s.app.db, s.home, { deletedAt: START.getTime() });
    const other = await householdFixture(s.app.db, testConfig(), START);
    insertTransaction(s.app.db, other);

    const all = await call(s, 'GET', '/export.csv');
    expect(all.headers['content-disposition']).toBe(
      'attachment; filename="fineapp-2026-09-23.csv"',
    );
    expect(all.body.trimEnd().split('\r\n')).toHaveLength(3);

    const august = await call(s, 'GET', '/export.csv?month=2026-08');
    expect(august.body.trimEnd().split('\r\n')).toHaveLength(2);
  });

  it('pusty miesiąc — sam nagłówek', async () => {
    const s = await setup();
    const response = await call(s, 'GET', '/export.csv?month=2025-01');
    expect(response.statusCode).toBe(200);
    expect(response.body.trimEnd().split('\r\n')).toHaveLength(1);
  });

  it('odrzuca zły miesiąc', async () => {
    const s = await setup();
    expect((await call(s, 'GET', '/export.csv?month=2026-13')).statusCode).toBe(400);
  });
});

describe('POST /settings/reset (ADR-072)', () => {
  const PIN = '482915';
  const UPLOAD_DIR = testConfig().uploads.dir;

  /**
   * Gospodarstwo z prawdziwym PIN-em i danymi w każdej warstwie — także z powiązaniami
   * cyklicznymi (reguła ↔ zobowiązanie, wystąpienie ↔ transakcja), kluczami `RESTRICT`
   * (transakcja → konto) i plikiem dokumentu na dysku.
   *
   * @returns Aplikacja, gospodarstwo i identyfikatory tego, co ma zostać.
   */
  async function seeded(): Promise<
    Setup & { systemCategoryId: string; storagePath: string; documentId: string }
  > {
    const s = await setup();
    const at = START.getTime();
    s.app.db.db
      .update(users)
      .set({ pinHash: await hashPin(PIN) })
      .where(eq(users.id, s.home.userId))
      .run();

    const accountId = insertAccount(s.app.db, s.home, { name: 'Konto' });
    const systemCategoryId = insertCategory(s.app.db, s.home, { isSystem: true, name: 'Jedzenie' });
    const ownCategoryId = insertCategory(s.app.db, s.home, { name: 'Własna' });
    insertIncomeSource(s.app.db, s.home);
    const goalId = insertGoal(s.app.db, s.home);
    const liabilityId = insertLiability(s.app.db, s.home);
    s.app.db.db
      .update(households)
      .set({ defaultExpenseAccountId: accountId })
      .where(eq(households.id, s.home.householdId))
      .run();

    const ruleId = newId();
    s.app.db.db
      .insert(recurringRules)
      .values({
        id: ruleId,
        householdId: s.home.householdId,
        name: 'Rata',
        flow: 'expense',
        amountMinor: 2_500_00,
        accountId,
        liabilityId,
        frequency: 'monthly',
        anchorDate: '2026-09-10',
        startMonth: '2026-09',
        createdAt: at,
        updatedAt: at,
      })
      .run();
    const occurrenceId = newId();
    s.app.db.db
      .insert(recurringOccurrences)
      .values({
        id: occurrenceId,
        householdId: s.home.householdId,
        ruleId,
        dueOn: '2026-09-10',
        monthKey: '2026-09',
        plannedAmountMinor: 2_500_00,
        status: 'posted',
        createdAt: at,
        updatedAt: at,
      })
      .run();

    const documentId = newId();
    const storagePath = `2026/09/${documentId}.jpg`;
    s.app.db.db
      .insert(documents)
      .values({
        id: documentId,
        householdId: s.home.householdId,
        kind: 'receipt',
        status: 'parsed',
        originalFilename: 'paragon.jpg',
        storagePath,
        mimeType: 'image/jpeg',
        byteSize: 1,
        sha256: documentId,
        uploadedBy: s.home.userId,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    s.app.db.db
      .insert(documentItems)
      .values({
        id: newId(),
        documentId,
        lineNo: 1,
        description: 'Chleb',
        amountMinor: 5_00,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    for (const path of [storagePath, thumbnailPathFor(storagePath)]) {
      const full = resolveStoredPath(UPLOAD_DIR, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, 'x');
    }

    const postedId = insertTransaction(s.app.db, s.home, {
      accountId,
      categoryId: ownCategoryId,
      goalId,
      liabilityId,
      recurringOccurrenceId: occurrenceId,
      sourceDocumentId: documentId,
    });
    s.app.db.db
      .update(recurringOccurrences)
      .set({ transactionId: postedId })
      .where(eq(recurringOccurrences.id, occurrenceId))
      .run();
    // Transakcja w koszu też znika.
    insertTransaction(s.app.db, s.home, { accountId, deletedAt: at });

    // Szkic budżetu z linią powiązaną z regułą i linią własną w usuwanej kategorii.
    const draftId = insertBudgetDraft(s.app.db, s.home, '2026-10');
    insertBudgetLine(s.app.db, s.home, draftId, {
      name: 'Rata',
      amountMinor: 2_500_00,
      origin: 'recurring',
      recurringRuleId: ruleId,
      liabilityId,
      sourceAmountMinor: 2_500_00,
    });
    insertBudgetLine(s.app.db, s.home, draftId, {
      categoryId: ownCategoryId,
      groupId: insertBudgetGroup(s.app.db, s.home, draftId),
    });

    return { ...s, systemCategoryId, storagePath, documentId };
  }

  it('usuwa dane gospodarstwa razem z koszem i plikami, zostawia logowanie i kategorie systemowe', async () => {
    const s = await seeded();

    const response = await call(s, 'POST', '/reset', { pin: PIN });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ data: { deleted: Record<string, number> } }>().data.deleted).toEqual({
      accounts: 1,
      categories: 1,
      incomeSources: 1,
      goals: 1,
      liabilities: 1,
      allocationTargets: 0,
      recurringRules: 1,
      recurringOccurrences: 1,
      plannedExpenses: 0,
      documents: 1,
      documentItems: 1,
      transactions: 2,
      budgetDrafts: 1,
      budgetDraftGroups: 1,
      budgetDraftLines: 2,
    });

    const { db } = s.app.db;
    expect(db.select().from(transactions).all()).toEqual([]);
    expect(db.select().from(accounts).all()).toEqual([]);
    expect(db.select().from(documents).all()).toEqual([]);
    expect(db.select().from(budgetDrafts).all()).toEqual([]);
    expect(db.select().from(budgetDraftLines).all()).toEqual([]);
    expect(db.select().from(budgetDraftGroups).all()).toEqual([]);
    expect(db.select({ id: categories.id }).from(categories).all()).toEqual([
      { id: s.systemCategoryId },
    ]);
    expect(db.select().from(users).all()).toHaveLength(1);
    const household = db
      .select()
      .from(households)
      .where(eq(households.id, s.home.householdId))
      .get();
    expect(household?.defaultExpenseAccountId).toBeNull();

    for (const path of [s.storagePath, thumbnailPathFor(s.storagePath)]) {
      await expect(access(resolveStoredPath(UPLOAD_DIR, path))).rejects.toThrow();
    }

    // Aplikacja działa dalej na pustym gospodarstwie.
    expect((await call(s, 'GET', '/export')).statusCode).toBe(200);
  });

  it('nie rusza cudzego gospodarstwa', async () => {
    const s = await seeded();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const foreignAccount = insertAccount(s.app.db, other, { name: 'Cudze' });
    const foreignTx = insertTransaction(s.app.db, other, { accountId: foreignAccount });

    expect((await call(s, 'POST', '/reset', { pin: PIN })).statusCode).toBe(200);

    const { db } = s.app.db;
    expect(db.select({ id: accounts.id }).from(accounts).all()).toEqual([{ id: foreignAccount }]);
    expect(db.select({ id: transactions.id }).from(transactions).all()).toEqual([
      { id: foreignTx },
    ]);
  });

  it('zły PIN daje 401 i niczego nie usuwa', async () => {
    const s = await seeded();

    const response = await call(s, 'POST', '/reset', { pin: '111222' });
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.message).toBe('PIN się nie zgadza.');

    const { db } = s.app.db;
    expect(db.select().from(transactions).all()).toHaveLength(2);
    expect(db.select().from(accounts).all()).toHaveLength(1);
    await expect(access(resolveStoredPath(UPLOAD_DIR, s.storagePath))).resolves.toBeUndefined();
  });

  it('PIN w złym formacie daje 400', async () => {
    const s = await setup();
    const response = await call(s, 'POST', '/reset', { pin: '12' });
    expect(response.statusCode).toBe(400);
  });
});
