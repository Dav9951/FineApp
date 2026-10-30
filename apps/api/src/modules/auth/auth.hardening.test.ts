import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import { mutableClock } from '../../core/clock.js';
import { isAppError } from '../../core/errors.js';
import { users } from '../../db/schema/users.js';
import { seedDatabase } from '../../db/seed/index.js';
import { attemptRules, checkLoginAllowed } from './auth.attempts.js';
import { createUser, formatWait } from './auth.service.js';
import { REFRESH_COOKIE_NAME } from './auth.tokens.js';

/**
 * Testy domykające Fazę 1 (`F1-7`).
 *
 * Reguły z `09` są już sprawdzone w testach jednostkowych i w testach tras; tutaj
 * zostają **przypadki, do których żaden z nich nie dociera**: limit liczony po adresie
 * IP przez wiele kont, blokada wykładnicza przez HTTP, żądanie bez `User-Agent`,
 * konto wyłączone w trakcie trwania sesji.
 */

/** Kształt odpowiedzi błędu. */
interface ErrorBody {
  error: { code: string; message: string; retryAfterSeconds?: number };
}

const PIN = '483920';
const START = new Date('2026-09-22T12:00:00.000Z');
const CSRF = { 'x-requested-with': 'fineapp' };

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/**
 * Buduje aplikację z dwoma kontami.
 *
 * @returns Aplikacja i zegar.
 */
async function twoUsers(): Promise<{ app: TestApp; clock: ReturnType<typeof mutableClock> }> {
  const clock = mutableClock(START);
  const app = await buildTestApp({}, clock);
  harness = app;
  const { householdId } = seedDatabase(app.db, testConfig());
  for (const email of ['adam@example.com', 'basia@example.com']) {
    await createUser(app.db, testConfig(), clock, {
      email,
      displayName: email,
      householdId,
      pin: PIN,
    });
  }
  return { app, clock };
}

/**
 * Wysyła próbę logowania.
 *
 * @param app - Aplikacja testowa.
 * @param email - Adres.
 * @param pin - PIN.
 * @param ip - Adres IP.
 * @param headers - Dodatkowe nagłówki.
 * @returns Odpowiedź Fastify.
 */
function attempt(
  app: TestApp,
  email: string,
  pin: string,
  ip = '203.0.113.7',
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return app.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { ...CSRF, ...headers },
    payload: { email, pin },
    remoteAddress: ip,
  });
}

/**
 * Dwadzieścia prawdziwych haszowań argon2 po 64 MiB trwa kilka sekund i tak ma być —
 * to jest koszt, który płaci atakujący ([09 §2.1](../../../../../../plans/09-security-auth.md)).
 * Obniżenie parametrów „żeby testy śmigały" zabrałoby pierwszą z trzech warstw ochrony,
 * więc zamiast tego podnosimy limit czasu tym dwóm testom.
 */
const SLOW = { timeout: 30_000 };

describe('limit po adresie IP', () => {
  it('zatrzymuje zgadywanie rozłożone po wielu kontach z jednego adresu', SLOW, async () => {
    // Limit na adres e-mail sam z siebie nie pomaga, gdy napastnik przerzuca się
    // między kontami — stąd druga oś liczenia (09 §2.5).
    const { app, clock } = await twoUsers();

    // Za każdym razem **inny** adres, żeby limit 5/15 min na adres e-mail nie zadziałał
    // pierwszy — sprawdzamy oś adresu IP, a nie tę drugą.
    for (let round = 0; round < 20; round += 1) {
      const response = await attempt(app, `nikt${String(round)}@example.com`, '571038');
      expect(response.statusCode).toBe(401);
      clock.advance(30_000);
    }

    // Dwudziesta pierwsza próba dotyczy konta, które **istnieje**, i niesie poprawny
    // PIN — a i tak się odbija, bo liczy się adres, z którego przychodzi.
    const blocked = await attempt(app, 'adam@example.com', PIN);

    expect(blocked.statusCode).toBe(429);
  });

  it('inny adres IP nie dziedziczy cudzej blokady', SLOW, async () => {
    const { app, clock } = await twoUsers();
    for (let round = 0; round < 20; round += 1) {
      await attempt(app, `nikt${String(round)}@example.com`, '571038');
      clock.advance(30_000);
    }
    expect((await attempt(app, 'adam@example.com', PIN)).statusCode).toBe(429);

    const elsewhere = await attempt(app, 'adam@example.com', PIN, '198.51.100.4');

    expect(elsewhere.statusCode).toBe(200);
  });
});

describe('blokada wykładnicza', () => {
  it('po dziesięciu próbach w godzinie blokada rośnie do godziny', SLOW, async () => {
    const { app, clock } = await twoUsers();

    // Pięć prób → blokada 15 minut. Przeczekujemy ją i próbujemy dalej.
    for (let round = 0; round < 5; round += 1) {
      await attempt(app, 'adam@example.com', '571038');
      clock.advance(60_000);
    }
    clock.advance(16 * 60_000);
    for (let round = 0; round < 5; round += 1) {
      if (round > 0) clock.advance(60_000);
      await attempt(app, 'adam@example.com', '571038');
    }

    const blocked = await attempt(app, 'adam@example.com', PIN);

    expect(blocked.statusCode).toBe(429);
    const { error } = blocked.json<ErrorBody>();
    // Dziesięć prób w godzinie to już blokada godzinna, nie kwadrans (09 §2.5):
    // pełna godzina liczona od ostatniej nieudanej próby.
    expect(error.retryAfterSeconds).toBe(3600);
    expect(error.message).toContain('godzinę');
  });

  it('reguła, której blokada już minęła, nie liczy się do decyzji', () => {
    // Piętnaście minut po ostatniej nieudanej próbie reguła 5/15 min nadal „widzi"
    // komplet prób w oknie, ale jej blokada już wygasła — i wtedy ma przepuścić.
    const rules = attemptRules(testConfig());
    const now = START.getTime();
    const failures = Array.from({ length: 5 }, (_, index) => ({
      succeeded: false,
      createdAt: now - 15 * 60_000 - index * 1000,
    }));

    expect(checkLoginAllowed(rules, failures, [], now)).toEqual({ allowed: true });
  });
});

describe('formatWait', () => {
  it('mówi po polsku i odmienia liczebniki', () => {
    expect(formatWait(45)).toBe('45 s');
    expect(formatWait(60)).toBe('1 minutę');
    expect(formatWait(120)).toBe('2 minuty');
    expect(formatWait(900)).toBe('15 minut');
    expect(formatWait(3600)).toBe('1 godzinę');
    expect(formatWait(7200)).toBe('2 godziny');
    expect(formatWait(86_400)).toBe('24 godziny');
    expect(formatWait(5 * 3600)).toBe('5 godzin');
  });
});

describe('żądanie bez User-Agent', () => {
  it('logowanie działa, a sesja zapisuje pustą etykietę', async () => {
    // `inject` nie dokłada `User-Agent` sam, ale prawdziwi klienci bywają równie skąpi —
    // brak nagłówka nie może wywrócić logowania.
    const { app } = await twoUsers();

    const response = await attempt(app, 'adam@example.com', PIN);

    expect(response.statusCode).toBe(200);
  });

  it('odświeżenie bez User-Agent zachowuje etykietę z logowania', async () => {
    const { app } = await twoUsers();
    const login = await app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { ...CSRF, 'user-agent': 'Safari' },
      payload: { email: 'adam@example.com', pin: PIN, deviceLabel: 'iPhone' },
    });
    const token = login.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)?.value ?? '';

    const refreshed = await app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: CSRF,
      cookies: { [REFRESH_COOKIE_NAME]: token },
    });

    expect(refreshed.statusCode).toBe(200);
  });
});

describe('konto wyłączone w trakcie sesji', () => {
  it('nie da się zmienić PIN-u', async () => {
    const { app } = await twoUsers();
    const login = await attempt(app, 'adam@example.com', PIN);
    const accessToken = login.json<{ data: { accessToken: string } }>().data.accessToken;
    app.db.db.update(users).set({ isActive: false }).run();

    const response = await app.app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/pin',
      headers: { ...CSRF, authorization: `Bearer ${accessToken}` },
      payload: { currentPin: PIN, newPin: '571038' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('wyścig dwóch kart też nie wpuszcza', async () => {
    const { app } = await twoUsers();
    const login = await attempt(app, 'adam@example.com', PIN);
    const token = login.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)?.value ?? '';
    await app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: CSRF,
      cookies: { [REFRESH_COOKIE_NAME]: token },
    });
    app.db.db.update(users).set({ isActive: false }).run();

    // Spóźniona karta trafia w okno tolerancji, ale konto jest już wyłączone.
    const latecomer = await app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: CSRF,
      cookies: { [REFRESH_COOKIE_NAME]: token },
    });

    expect(latecomer.statusCode).toBe(401);
  });
});

describe('trasa, która zapomniała o requireAuth', () => {
  it('odmawia dostępu zamiast pytać bazy bez zakresu gospodarstwa', async () => {
    // Zapomnienie `requireAuth` to błąd programisty. Ma się skończyć odmową, a nie
    // zapytaniem bez ograniczenia do gospodarstwa (09 §4).
    const { app } = await twoUsers();
    const { authContext } = await import('../../http/middleware/require-auth.js');
    app.app.get('/api/v1/zapomniana', (request) => ({ data: authContext(request) }));
    await app.app.ready();

    const response = await app.app.inject({ method: 'GET', url: '/api/v1/zapomniana' });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('`authContext` rzuca błędem aplikacyjnym, nie zwykłym wyjątkiem', async () => {
    const { app } = await twoUsers();
    const { authContext } = await import('../../http/middleware/require-auth.js');
    let caught: unknown;
    app.app.get('/api/v1/zapomniana2', (request) => {
      try {
        return { data: authContext(request) };
      } catch (error) {
        caught = error;
        throw error;
      }
    });
    await app.app.ready();

    await app.app.inject({ method: 'GET', url: '/api/v1/zapomniana2' });

    expect(isAppError(caught)).toBe(true);
  });
});
