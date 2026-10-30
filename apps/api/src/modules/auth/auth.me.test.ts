import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import { mutableClock } from '../../core/clock.js';
import { authSessions, users } from '../../db/schema/users.js';
import { seedDatabase } from '../../db/seed/index.js';
import { createUser } from './auth.service.js';
import { REFRESH_COOKIE_NAME, signAccessToken } from './auth.tokens.js';

/**
 * Testy tras wymagających zalogowania
 * ([09 §4](../../../../../../plans/09-security-auth.md#4-autoryzacja)).
 *
 * Reguła, której pilnują: **zakres danych wynika wyłącznie z `hid` w tokenie**.
 * Cudze gospodarstwo daje `404`, nie `403` — nie potwierdzamy istnienia cudzych danych.
 */

/** Kształt odpowiedzi `/auth/me`. */
interface MeBody {
  data: { user: { id: string; email: string }; household: { id: string; name: string } };
}

/** Kształt listy sesji. */
interface SessionsBody {
  data: {
    id: string;
    deviceLabel: string | null;
    current: boolean;
    sameDevice: boolean;
    createdAt: number;
  }[];
}

/** Kształt potwierdzenia operacji. */
interface AckBody {
  data: { affected: number };
}

/** Kształt odpowiedzi błędu. */
interface ErrorBody {
  error: { code: string; message: string };
}

const EMAIL = 'adam@example.com';
const PIN = '483920';
const START = new Date('2026-09-22T12:00:00.000Z');
const CSRF = { 'x-requested-with': 'fineapp' };

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Zalogowana aplikacja wraz z tokenem dostępu. */
interface LoggedIn {
  app: TestApp;
  clock: ReturnType<typeof mutableClock>;
  /** Podmieniany w testach, które przesuwają zegar poza ważność tokenu. */
  accessToken: string;
  refreshToken: string;
  userId: string;
  householdId: string;
}

/**
 * Buduje aplikację z jednym użytkownikiem i loguje go.
 *
 * @param deviceLabel - Etykieta urządzenia.
 * @returns Zalogowana aplikacja.
 */
async function loggedIn(deviceLabel = 'iPhone'): Promise<LoggedIn> {
  const clock = mutableClock(START);
  const app = await buildTestApp({}, clock);
  harness = app;
  const { householdId } = seedDatabase(app.db, testConfig());
  await createUser(app.db, testConfig(), clock, {
    email: EMAIL,
    displayName: 'Adam',
    householdId,
    pin: PIN,
  });

  const response = await app.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { email: EMAIL, pin: PIN, deviceLabel },
  });
  const body = response.json<{ data: { accessToken: string; user: { id: string } } }>();

  return {
    app,
    clock,
    accessToken: body.data.accessToken,
    refreshToken: response.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)?.value ?? '',
    userId: body.data.user.id,
    householdId,
  };
}

/**
 * Wysyła żądanie z tokenem dostępu.
 *
 * @param session - Zalogowana aplikacja.
 * @param method - Metoda HTTP.
 * @param url - Ścieżka bez prefiksu.
 * @param payload - Ciało żądania.
 * @returns Odpowiedź Fastify.
 */
function authed(
  session: LoggedIn,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return session.app.app.inject({
    method,
    url: `/api/v1/auth${url}`,
    headers: { ...CSRF, authorization: `Bearer ${session.accessToken}` },
    ...(payload === undefined ? {} : { payload }),
  });
}

describe('GET /auth/me', () => {
  it('oddaje profil i gospodarstwo', async () => {
    const session = await loggedIn();

    const response = await authed(session, 'GET', '/me');

    expect(response.statusCode).toBe(200);
    const { data } = response.json<MeBody>();
    expect(data.user.email).toBe(EMAIL);
    expect(data.household.id).toBe(session.householdId);
  });

  it('bez nagłówka Authorization daje 401', async () => {
    const session = await loggedIn();

    const response = await session.app.app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('token podrobiony albo wygasły daje 401', async () => {
    const session = await loggedIn();
    const expired = await signAccessToken(
      testConfig(),
      { sub: session.userId, hid: session.householdId, sid: 'x' },
      new Date(START.getTime() - 3_600_000),
    );

    for (const token of ['to-nie-jest-token', expired]) {
      const response = await session.app.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it('nagłówek bez schematu Bearer nie wystarcza', async () => {
    const session = await loggedIn();

    const response = await session.app.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: session.accessToken },
    });

    expect(response.statusCode).toBe(401);
  });

  it('konto wyłączone po wydaniu tokenu traci dostęp', async () => {
    const session = await loggedIn();
    session.app.db.db.update(users).set({ isActive: false }).run();

    expect((await authed(session, 'GET', '/me')).statusCode).toBe(401);
  });

  it('nie wymaga nagłówka CSRF — to metoda bezpieczna', async () => {
    const session = await loggedIn();

    const response = await session.app.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('GET /auth/sessions', () => {
  it('pokazuje po jednym wpisie na urządzenie i zaznacza bieżące', async () => {
    const session = await loggedIn('iPhone');
    await session.app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { email: EMAIL, pin: PIN, deviceLabel: 'Laptop' },
    });

    const response = await authed(session, 'GET', '/sessions');

    const { data } = response.json<SessionsBody>();
    expect(data).toHaveLength(2);
    expect(data.filter((entry) => entry.current)).toHaveLength(1);
    expect(data.map((entry) => entry.deviceLabel).sort()).toEqual(['Laptop', 'iPhone']);
  });

  it('rotacja nie mnoży wpisów ani nie odmładza daty zalogowania', async () => {
    // `created_at` żywego wiersza to moment ostatniej rotacji — lista musi pokazywać
    // moment **zalogowania**, inaczej każde urządzenie wygląda na świeżo zalogowane.
    const session = await loggedIn();
    const before = (await authed(session, 'GET', '/sessions')).json<SessionsBody>().data[0];

    session.clock.advance(60 * 60_000);
    const refreshed = await session.app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: CSRF,
      cookies: { [REFRESH_COOKIE_NAME]: session.refreshToken },
    });
    // Access token żyje 15 minut, a zegar przesunął się o godzinę — dalej idziemy
    // tokenem świeżo wydanym przez odświeżenie, bo tak robi prawdziwy klient.
    session.accessToken = refreshed.json<{ data: { accessToken: string } }>().data.accessToken;

    const after = (await authed(session, 'GET', '/sessions')).json<SessionsBody>().data;
    expect(after).toHaveLength(1);
    expect(after[0]?.createdAt).toBe(before?.createdAt);
  });

  it('nie pokazuje sesji innego użytkownika', async () => {
    const session = await loggedIn();
    await createUser(session.app.db, testConfig(), session.clock, {
      email: 'basia@example.com',
      displayName: 'Basia',
      householdId: session.householdId,
      pin: '571038',
    });
    await session.app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { email: 'basia@example.com', pin: '571038', deviceLabel: 'Tablet' },
    });

    const { data } = (await authed(session, 'GET', '/sessions')).json<SessionsBody>();

    expect(data).toHaveLength(1);
    expect(data[0]?.deviceLabel).toBe('iPhone');
  });
});

describe('DELETE /auth/sessions/:id', () => {
  it('unieważnia wskazane urządzenie', async () => {
    const session = await loggedIn('iPhone');
    const other = await session.app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { email: EMAIL, pin: PIN, deviceLabel: 'Laptop' },
    });
    const otherToken = other.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)?.value ?? '';
    const list = (await authed(session, 'GET', '/sessions')).json<SessionsBody>().data;
    const laptop = list.find((entry) => entry.deviceLabel === 'Laptop');

    const response = await authed(session, 'DELETE', `/sessions/${laptop?.id ?? ''}`);

    expect(response.statusCode).toBe(200);
    expect(response.json<AckBody>().data.affected).toBeGreaterThan(0);
    const refreshed = await session.app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: CSRF,
      cookies: { [REFRESH_COOKIE_NAME]: otherToken },
    });
    expect(refreshed.statusCode).toBe(401);
  });

  it('cudza sesja daje 404, nie 403 — nie potwierdzamy istnienia cudzych danych', async () => {
    const session = await loggedIn();
    await createUser(session.app.db, testConfig(), session.clock, {
      email: 'basia@example.com',
      displayName: 'Basia',
      householdId: session.householdId,
      pin: '571038',
    });
    const other = await session.app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { email: 'basia@example.com', pin: '571038' },
    });
    const otherFamily = other.json<{ data: { accessToken: string } }>().data.accessToken;
    const payload = otherFamily.split('.')[1] ?? '';
    const sid = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sid: string })
      .sid;

    const response = await authed(session, 'DELETE', `/sessions/${sid}`);

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('nieistniejąca sesja daje 404', async () => {
    const session = await loggedIn();

    const response = await authed(session, 'DELETE', '/sessions/01J9ZQK8WQ0000000000000000');

    expect(response.statusCode).toBe(404);
  });

  it('wylogowanie samego siebie czyści ciasteczko', async () => {
    const session = await loggedIn();
    const list = (await authed(session, 'GET', '/sessions')).json<SessionsBody>().data;

    const response = await authed(session, 'DELETE', `/sessions/${list[0]?.id ?? ''}`);

    const cleared = response.cookies.find((c) => c.name === REFRESH_COOKIE_NAME);
    expect(cleared?.value).toBe('');
  });
});

describe('POST /auth/logout-all', () => {
  it('usuwa wszystkie urządzenia, także bieżące', async () => {
    const session = await loggedIn();
    await session.app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { email: EMAIL, pin: PIN, deviceLabel: 'Laptop' },
    });

    const response = await authed(session, 'POST', '/logout-all');

    expect(response.statusCode).toBe(200);
    expect(session.app.db.db.select().from(authSessions).all()).toHaveLength(0);
  });
});

describe('PATCH /auth/pin', () => {
  it('zmienia PIN i wylogowuje pozostałe urządzenia', async () => {
    const session = await loggedIn();
    const other = await session.app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { email: EMAIL, pin: PIN, deviceLabel: 'Laptop' },
    });
    const otherToken = other.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)?.value ?? '';

    const response = await authed(session, 'PATCH', '/pin', {
      currentPin: PIN,
      newPin: '571038',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<AckBody>().data.affected).toBeGreaterThan(0);

    // Stary PIN nie działa, nowy działa.
    const withOld = await session.app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { email: EMAIL, pin: PIN },
    });
    expect(withOld.statusCode).toBe(401);
    const withNew = await session.app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { email: EMAIL, pin: '571038' },
    });
    expect(withNew.statusCode).toBe(200);

    // Drugie urządzenie wyproszone; bieżące działa dalej.
    const refreshedOther = await session.app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: CSRF,
      cookies: { [REFRESH_COOKIE_NAME]: otherToken },
    });
    expect(refreshedOther.statusCode).toBe(401);
    const refreshedSelf = await session.app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: CSRF,
      cookies: { [REFRESH_COOKIE_NAME]: session.refreshToken },
    });
    expect(refreshedSelf.statusCode).toBe(200);
  });

  it('błędny obecny PIN nie zmienia niczego', async () => {
    const session = await loggedIn();

    const response = await authed(session, 'PATCH', '/pin', {
      currentPin: '111111',
      newPin: '571038',
    });

    expect(response.statusCode).toBe(401);
  });

  it('nowy PIN przechodzi przez reguły z 09 §2.3', async () => {
    const session = await loggedIn();

    const response = await authed(session, 'PATCH', '/pin', {
      currentPin: PIN,
      newPin: '123456',
    });

    expect(response.statusCode).toBe(400);
  });

  it('nowy PIN musi różnić się od obecnego', async () => {
    const session = await loggedIn();

    const response = await authed(session, 'PATCH', '/pin', { currentPin: PIN, newPin: PIN });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.message).toContain('różnić');
  });

  it('wymaga nagłówka CSRF', async () => {
    const session = await loggedIn();

    const response = await session.app.app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/pin',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { currentPin: PIN, newPin: '571038' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('bez tokenu daje 401 także przy błędnym ciele (ADR-031)', async () => {
    // Walidacja ciała biegnie przed `preHandler`; dopiero `onRequest` sprawia, że brak
    // tokenu wygrywa z kształtem ciała.
    const session = await loggedIn();

    const response = await session.app.app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/pin',
      headers: CSRF,
      payload: { currentPin: 'x' },
    });

    expect(response.statusCode).toBe(401);
  });
});
