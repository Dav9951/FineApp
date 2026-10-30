import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  CSRF_HEADER,
  householdFixture,
  insertAccount,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock, type MutableClock } from '../../core/clock.js';
import { newId } from '../../core/id.js';
import { idempotencyKeys } from '../../db/schema/idempotency-keys.js';
import { transactions } from '../../db/schema/transactions.js';
import { signAccessToken } from '../auth/auth.tokens.js';
import { IDEMPOTENCY_TTL_MS } from '../idempotency/idempotency.service.js';

/**
 * `POST /transactions` z nagłówkiem `Idempotency-Key` (ADR-037, pułapka „podwójne
 * zaksięgowanie na słabym łączu" z `CLAUDE.md`).
 */

const START = new Date('2026-09-23T10:00:00.000Z');
const KEY = '3f0c7c1e-6a8e-4b8a-9d1e-0c2b5f1a7e44';

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
}

/**
 * Buduje aplikację z gospodarstwem i kontem.
 *
 * @returns Środowisko testu.
 */
async function setup(): Promise<Setup> {
  const clock = mutableClock(START);
  const app = await buildTestApp({}, clock);
  harness = app;
  const home = await householdFixture(app.db, testConfig(), START);
  return { app, clock, home, ror: insertAccount(app.db, home) };
}

/**
 * Wysyła wydatek.
 *
 * @param s - Środowisko testu.
 * @param key - Klucz idempotencji albo `undefined`.
 * @param overrides - Nadpisane pola ciała.
 * @param home - Gospodarstwo.
 * @returns Odpowiedź.
 */
function post(
  s: Setup,
  key: string | undefined,
  overrides: Record<string, unknown> = {},
  home: HouseholdFixture = s.home,
): Promise<LightMyRequestResponse> {
  return s.app.app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: { ...home.headers, ...(key === undefined ? {} : { 'idempotency-key': key }) },
    payload: {
      type: 'expense',
      bookedOn: '2026-09-18',
      amountMinor: 12_799,
      accountId: s.ror,
      ...overrides,
    },
  });
}

/**
 * Liczy transakcje gospodarstwa.
 *
 * @param s - Środowisko testu.
 * @param home - Gospodarstwo.
 * @returns Liczba wierszy.
 */
function count(s: Setup, home: HouseholdFixture = s.home): number {
  return s.app.db.db
    .select()
    .from(transactions)
    .where(eq(transactions.householdId, home.householdId))
    .all().length;
}

describe('Idempotency-Key', () => {
  it('powtórzone żądanie zwraca pierwszą odpowiedź i nie tworzy drugiej transakcji', async () => {
    const s = await setup();
    const first = await post(s, KEY);
    s.clock.advance(5_000);
    const second = await post(s, KEY);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(second.headers.location).toBe(first.headers.location);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(count(s)).toBe(1);
  });

  it('ten sam klucz z innym ciałem → 409, bez zapisu', async () => {
    const s = await setup();
    await post(s, KEY);
    const changed = await post(s, KEY, { amountMinor: 5_000 });
    expect(changed.statusCode).toBe(409);
    expect(changed.json<{ error: { code: string } }>().error.code).toBe('CONFLICT');
    expect(count(s)).toBe(1);
  });

  it('kolejność pól w ciele nie jest „innym ciałem"', async () => {
    const s = await setup();
    await post(s, KEY, { description: 'Chleb', merchant: 'Lidl' });
    const reordered = await s.app.app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: { ...s.home.headers, 'idempotency-key': KEY },
      payload: {
        merchant: 'Lidl',
        description: 'Chleb',
        accountId: s.ror,
        amountMinor: 12_799,
        bookedOn: '2026-09-18',
        type: 'expense',
      },
    });
    expect(reordered.statusCode).toBe(201);
    expect(count(s)).toBe(1);
  });

  it('odrzucone żądanie nie zajmuje klucza — poprawione przechodzi', async () => {
    const s = await setup();
    const rejected = await post(s, KEY, { bookedOn: '2026-07-01' });
    expect(rejected.statusCode).toBe(422);
    const fixed = await post(s, KEY);
    expect(fixed.statusCode).toBe(201);
    expect(count(s)).toBe(1);
  });

  it('bez nagłówka każde żądanie tworzy transakcję', async () => {
    const s = await setup();
    await post(s, undefined);
    await post(s, undefined);
    expect(count(s)).toBe(2);
  });

  it('klucze gospodarstw są rozłączne', async () => {
    const s = await setup();
    const other = await householdFixture(s.app.db, testConfig(), START);
    const otherRor = insertAccount(s.app.db, other);
    await post(s, KEY);
    const theirs = await post(s, KEY, { accountId: otherRor }, other);
    expect(theirs.statusCode).toBe(201);
    expect(theirs.headers['idempotent-replayed']).toBeUndefined();
    expect(count(s, other)).toBe(1);
  });

  it('po dobie klucz wygasa i jest sprzątany', async () => {
    const s = await setup();
    await post(s, KEY);
    s.clock.advance(IDEMPOTENCY_TTL_MS + 1);
    // Token sprzed doby wygasł — ta sama osoba loguje się ponownie.
    const token = await signAccessToken(
      testConfig(),
      { sub: s.home.userId, hid: s.home.householdId, sid: newId() },
      s.clock.now(),
    );
    const later = { ...s.home, headers: { authorization: `Bearer ${token}`, ...CSRF_HEADER } };
    const again = await post(s, KEY, {}, later);
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replayed']).toBeUndefined();
    expect(count(s)).toBe(2);
    expect(s.app.db.db.select().from(idempotencyKeys).all()).toHaveLength(1);
  });

  it.each(['krótki', 'ze spacją w środku!', 'x'.repeat(129)])(
    'nieprawidłowy klucz „%s" → 400',
    async (key) => {
      const s = await setup();
      expect((await post(s, key)).statusCode).toBe(400);
      expect(count(s)).toBe(0);
    },
  );

  it('klucz nie narusza reszty nagłówków — autor transakcji z tokenu', async () => {
    const s = await setup();
    const response = await post(s, KEY);
    expect(response.json<{ data: { createdBy: string } }>().data.createdBy).toBe(s.home.userId);
  });
});
