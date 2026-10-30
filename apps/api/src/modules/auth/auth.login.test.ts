import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import { mutableClock } from '../../core/clock.js';
import { authAttempts, authSessions, users } from '../../db/schema/users.js';
import { seedDatabase } from '../../db/seed/index.js';
import { ATTEMPT_RETENTION_DAYS, createUser, pruneLoginAttempts } from './auth.service.js';
import { REFRESH_COOKIE_NAME, verifyAccessToken } from './auth.tokens.js';

/**
 * Testy logowania ([09 §2.4](../../../../../../plans/09-security-auth.md#24-przepływ-logowania)).
 *
 * Sprawdzane jest to, co naprawdę chroni konto: jednakowa odpowiedź niezależnie od
 * przyczyny porażki, blokada po pięciu próbach i to, że token odświeżający wychodzi
 * wyłącznie w ciasteczku `httpOnly`.
 */

/** Kształt odpowiedzi logowania do typowanego odczytu. */
interface LoginBody {
  data: {
    accessToken: string;
    expiresIn: number;
    user: { id: string; email: string; displayName: string };
    household: { id: string; name: string };
  };
}

/** Kształt odpowiedzi błędu. */
interface ErrorBody {
  error: { code: string; message: string; retryAfterSeconds?: number };
}

const EMAIL = 'adam@example.com';
const PIN = '483920';
const START = new Date('2026-09-22T12:00:00.000Z');

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/**
 * Buduje aplikację z jednym założonym użytkownikiem.
 *
 * @returns Aplikacja testowa i zegar, którym da się przesunąć czas.
 */
async function setup(): Promise<{ app: TestApp; clock: ReturnType<typeof mutableClock> }> {
  const clock = mutableClock(START);
  const app = await buildTestApp({}, clock);
  const { householdId } = seedDatabase(app.db, testConfig());
  await createUser(app.db, testConfig(), clock, {
    email: EMAIL,
    displayName: 'Adam',
    householdId,
    pin: PIN,
  });
  harness = app;
  return { app, clock };
}

/**
 * Wysyła żądanie logowania.
 *
 * @param app - Aplikacja testowa.
 * @param body - Ciało żądania.
 * @param ip - Adres IP klienta.
 * @returns Odpowiedź Fastify.
 */
function postLogin(
  app: TestApp,
  body: Record<string, unknown>,
  ip = '203.0.113.7',
): Promise<LightMyRequestResponse> {
  return app.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    // Nagłówek CSRF jest wymagany przy każdej metodzie zmieniającej stan (09 §5).
    headers: { 'x-requested-with': 'fineapp' },
    payload: body,
    remoteAddress: ip,
  });
}

describe('POST /auth/login', () => {
  it('poprawne dane dają access token, profil i gospodarstwo', async () => {
    const { app } = await setup();

    const response = await postLogin(app, { email: EMAIL, pin: PIN, deviceLabel: 'iPhone' });

    expect(response.statusCode).toBe(200);
    const { data } = response.json<LoginBody>();
    expect(data.user.email).toBe(EMAIL);
    expect(data.household.name).not.toBe('');
    expect(data.expiresIn).toBe(900);
    await expect(verifyAccessToken(testConfig(), data.accessToken, START)).resolves.toMatchObject({
      sub: data.user.id,
      hid: data.household.id,
    });
  });

  it('token odświeżający wychodzi wyłącznie w ciasteczku httpOnly', async () => {
    const { app } = await setup();

    const response = await postLogin(app, { email: EMAIL, pin: PIN });

    const cookie = response.cookies.find((entry) => entry.name === REFRESH_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    expect(cookie?.path).toBe('/api/v1/auth');
    // W ciele odpowiedzi tokenu nie ma — skrypt na stronie go nie odczyta.
    expect(response.payload).not.toContain(cookie?.value ?? 'NIEMOŻLIWE');
  });

  it('odpowiedź nie niesie hasha PIN-u', async () => {
    const { app } = await setup();

    const response = await postLogin(app, { email: EMAIL, pin: PIN });

    expect(response.payload).not.toContain('argon2');
    expect(response.payload).not.toContain('pinHash');
  });

  it('zapisuje sesję z hashem tokenu, nie z tokenem', async () => {
    const { app } = await setup();

    const response = await postLogin(app, { email: EMAIL, pin: PIN, deviceLabel: 'iPhone' });
    const cookie = response.cookies.find((entry) => entry.name === REFRESH_COOKIE_NAME);

    const session = app.db.db.select().from(authSessions).get();
    expect(session?.deviceLabel).toBe('iPhone');
    expect(session?.refreshTokenHash).not.toBe(cookie?.value);
    expect(session?.refreshTokenHash).toHaveLength(64);
    expect(session?.ipHash).toHaveLength(64);
  });

  it('zapisuje znacznik ostatniego logowania', async () => {
    const { app } = await setup();

    await postLogin(app, { email: EMAIL, pin: PIN });

    expect(app.db.db.select().from(users).get()?.lastLoginAt).toBe(START.getTime());
  });

  it('nieistniejący adres i zły PIN dają identyczną odpowiedź', async () => {
    const { app } = await setup();

    const unknown = await postLogin(app, { email: 'nikt@example.com', pin: PIN });
    const wrongPin = await postLogin(app, { email: EMAIL, pin: '571038' });

    expect(unknown.statusCode).toBe(401);
    expect(wrongPin.statusCode).toBe(401);
    expect(unknown.json<ErrorBody>().error.message).toBe(wrongPin.json<ErrorBody>().error.message);
    expect(unknown.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('zapisuje próbę także dla adresu, który nie istnieje', async () => {
    // Bez tego blokada pojawiałaby się tylko dla kont prawdziwych i sama byłaby
    // wyrocznią, które adresy istnieją (09 §2.4).
    const { app } = await setup();

    await postLogin(app, { email: 'nikt@example.com', pin: PIN });

    const attempts = app.db.db.select().from(authAttempts).all();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.succeeded).toBe(false);
    // W tabeli siedzi hash, nigdy jawny adres.
    expect(attempts[0]?.emailHash).toHaveLength(64);
    expect(attempts[0]?.emailHash).not.toContain('nikt');
  });

  it('blokuje po pięciu nieudanych próbach i podaje czas oczekiwania', async () => {
    const { app } = await setup();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await postLogin(app, { email: EMAIL, pin: '571038' });
      expect(response.statusCode).toBe(401);
    }

    const blocked = await postLogin(app, { email: EMAIL, pin: PIN });
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json<ErrorBody>();
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.retryAfterSeconds).toBe(900);
    expect(blocked.headers['retry-after']).toBe('900');
    // Komunikat mówi, ile czekać — UI ma pokazać odliczanie, nie „spróbuj później".
    expect(body.error.message).toContain('15 minut');
  });

  it('blokada nie przedłuża się przy samym odświeżaniu strony', async () => {
    const { app, clock } = await setup();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await postLogin(app, { email: EMAIL, pin: '571038' });
    }

    clock.advance(5 * 60_000);
    const first = await postLogin(app, { email: EMAIL, pin: PIN });
    clock.advance(5 * 60_000);
    const second = await postLogin(app, { email: EMAIL, pin: PIN });

    expect(first.json<ErrorBody>().error.retryAfterSeconds).toBe(600);
    expect(second.json<ErrorBody>().error.retryAfterSeconds).toBe(300);
  });

  it('po wygaśnięciu blokady logowanie znowu działa', async () => {
    const { app, clock } = await setup();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await postLogin(app, { email: EMAIL, pin: '571038' });
    }

    clock.advance(15 * 60_000 + 1000);
    const response = await postLogin(app, { email: EMAIL, pin: PIN });

    expect(response.statusCode).toBe(200);
  });

  it('konto wyłączone nie wpuszcza, choć PIN się zgadza', async () => {
    const { app } = await setup();
    app.db.db.update(users).set({ isActive: false }).run();

    const response = await postLogin(app, { email: EMAIL, pin: PIN });

    expect(response.statusCode).toBe(401);
    expect(app.db.db.select().from(authSessions).all()).toHaveLength(0);
  });

  it('adres jest normalizowany przed wyszukaniem', async () => {
    const { app } = await setup();

    const response = await postLogin(app, { email: '  ADAM@Example.COM  ', pin: PIN });

    expect(response.statusCode).toBe(200);
  });

  it('nieistniejący adres kosztuje tyle samo czasu co istniejący', async () => {
    // Bez porównania z hashem-atrapą odpowiedź dla nieistniejącego adresu wracałaby
    // natychmiast, a dla istniejącego po ~150 ms — z samego czasu dałoby się wyliczyć,
    // które konta istnieją (09 §2.4, krok 4). Próg jest luźny celowo: test ma wyłapać
    // brak haszowania, a nie mierzyć wydajność maszyny.
    const { app } = await setup();

    const started = performance.now();
    await postLogin(app, { email: 'nikt@example.com', pin: PIN });
    const elapsed = performance.now() - started;

    expect(elapsed).toBeGreaterThan(40);
  });

  it('żądanie bez PIN-u odbija się o schemat, nie o serwis', async () => {
    const { app } = await setup();

    const response = await postLogin(app, { email: EMAIL });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
    // Odbite żądanie nie może liczyć się do limitu prób.
    expect(app.db.db.select().from(authAttempts).all()).toHaveLength(0);
  });
});

describe('pruneLoginAttempts', () => {
  it('usuwa historię starszą niż trzydzieści dni, zostawiając świeższą', async () => {
    const { app, clock } = await setup();
    await postLogin(app, { email: EMAIL, pin: '571038' });

    // Bez sprzątania tabela rośnie o wiersz na każdą próbę — przy ataku szybciej
    // niż cała reszta bazy (03 §3.4).
    clock.advance((ATTEMPT_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    await postLogin(app, { email: EMAIL, pin: '571038' });

    expect(app.db.db.select().from(authAttempts).all()).toHaveLength(2);
    expect(pruneLoginAttempts(app.db, clock)).toBe(1);
    expect(app.db.db.select().from(authAttempts).all()).toHaveLength(1);
  });

  it('na pustej tabeli nie ma czego usuwać', async () => {
    const { app, clock } = await setup();

    expect(pruneLoginAttempts(app.db, clock)).toBe(0);
  });
});
