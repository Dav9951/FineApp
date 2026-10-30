import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import { mutableClock } from '../../core/clock.js';
import { authSessions, users } from '../../db/schema/users.js';
import { seedDatabase } from '../../db/seed/index.js';
import { sha256Hex } from './auth.hash.js';
import {
  createUser,
  pruneDeadSessions,
  REFRESH_REUSE_GRACE_SECONDS,
  REVOKED_SESSION_RETENTION_DAYS,
} from './auth.service.js';
import { REFRESH_COOKIE_NAME, verifyAccessToken } from './auth.tokens.js';

/**
 * Testy rotacji tokenu odświeżającego
 * ([09 §3.3](../../../../../../plans/09-security-auth.md#33-rotacja-refresh-tokenów)).
 *
 * Najważniejszy przypadek to **wykrycie ponownego użycia**: dwa urządzenia z tym samym
 * tokenem znaczą, że jedno jest napastnikiem. Ta ścieżka nie odpala się nigdy w normalnym
 * użyciu, więc jeśli przestanie działać, nikt tego nie zauważy bez testu.
 */

/** Kształt odpowiedzi logowania i odświeżenia. */
interface SessionBody {
  data: { accessToken: string; user: { id: string }; household: { id: string } };
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

/**
 * Buduje aplikację z jednym użytkownikiem i loguje go.
 *
 * @returns Aplikacja, zegar oraz token odświeżający z ciasteczka.
 */
async function loggedIn(): Promise<{
  app: TestApp;
  clock: ReturnType<typeof mutableClock>;
  refreshToken: string;
}> {
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
    payload: { email: EMAIL, pin: PIN, deviceLabel: 'iPhone' },
  });

  return { app, clock, refreshToken: cookieOf(response) };
}

/**
 * Wyciąga token odświeżający z odpowiedzi.
 *
 * @param response - Odpowiedź Fastify.
 * @returns Wartość ciasteczka.
 */
function cookieOf(response: LightMyRequestResponse): string {
  return response.cookies.find((entry) => entry.name === REFRESH_COOKIE_NAME)?.value ?? '';
}

/**
 * Wysyła żądanie odświeżenia.
 *
 * @param app - Aplikacja testowa.
 * @param refreshToken - Token do ciasteczka.
 * @returns Odpowiedź Fastify.
 */
function postRefresh(app: TestApp, refreshToken: string): Promise<LightMyRequestResponse> {
  return app.app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    headers: CSRF,
    cookies: { [REFRESH_COOKIE_NAME]: refreshToken },
  });
}

describe('POST /auth/refresh', () => {
  it('wymienia token na nowy i oddaje komplet danych sesji', async () => {
    const { app, refreshToken } = await loggedIn();

    const response = await postRefresh(app, refreshToken);

    expect(response.statusCode).toBe(200);
    const fresh = cookieOf(response);
    expect(fresh).not.toBe('');
    expect(fresh).not.toBe(refreshToken);
    // Po odświeżeniu strony front nie ma profilu — odświeżenie musi go oddać (09 §3.1).
    const { data } = response.json<SessionBody>();
    expect(data.user.id).not.toBe('');
    expect(data.household.id).not.toBe('');
  });

  it('`sid` nie zmienia się przy odświeżeniu — to rodzina, nie wiersz', async () => {
    const { app, refreshToken } = await loggedIn();
    const first = await postRefresh(app, refreshToken);
    const second = await postRefresh(app, cookieOf(first));

    const claims = await Promise.all(
      [first, second].map(async (response) =>
        verifyAccessToken(testConfig(), response.json<SessionBody>().data.accessToken, START),
      ),
    );

    expect(claims[0]?.sid).toBe(claims[1]?.sid);
  });

  it('stary token przestaje działać po upływie okna tolerancji', async () => {
    const { app, clock, refreshToken } = await loggedIn();
    await postRefresh(app, refreshToken);

    clock.advance((REFRESH_REUSE_GRACE_SECONDS + 1) * 1000);
    const replay = await postRefresh(app, refreshToken);

    expect(replay.statusCode).toBe(401);
  });

  it('dwie karty otwarte naraz to wyścig, nie kradzież', async () => {
    // Każde wejście na stronę odtwarza sesję jednym `/auth/refresh`, więc druga karta
    // wysyła to samo ciasteczko, zanim pierwsza zdąży je podmienić. Bez okna tolerancji
    // zwykłe „otwórz w nowej karcie" wylogowywałoby ze wszystkich urządzeń (09 §3.3).
    const { app, refreshToken } = await loggedIn();
    const winner = await postRefresh(app, refreshToken);
    expect(winner.statusCode).toBe(200);

    const latecomer = await postRefresh(app, refreshToken);

    expect(latecomer.statusCode).toBe(200);
    // Spóźniona karta dostaje sam access token — ciasteczka nie rusza, bo zwycięzca
    // zdążył już zapisać w nim swój.
    expect(latecomer.cookies.find((entry) => entry.name === REFRESH_COOKIE_NAME)).toBeUndefined();
    // Token zwycięzcy działa dalej, a rodzina ma nadal jeden żywy wiersz.
    expect((await postRefresh(app, cookieOf(winner))).statusCode).toBe(200);
    const live = app.db.db
      .select()
      .from(authSessions)
      .all()
      .filter((row) => row.revokedAt === null);
    expect(live).toHaveLength(1);
  });

  it('wyścig nie przedłuża się w nieskończoność — po oknie tolerancji to już kradzież', async () => {
    const { app, clock, refreshToken } = await loggedIn();
    await postRefresh(app, refreshToken);

    clock.advance((REFRESH_REUSE_GRACE_SECONDS - 1) * 1000);
    expect((await postRefresh(app, refreshToken)).statusCode).toBe(200);

    clock.advance(2 * 1000);
    expect((await postRefresh(app, refreshToken)).statusCode).toBe(401);
  });

  it('ponowne użycie zużytego tokenu unieważnia WSZYSTKIE sesje użytkownika', async () => {
    // Scenariusz kradzieży ciasteczka: złodziej odświeża, potem wraca właściciel
    // ze swoim (już zużytym) tokenem — albo odwrotnie. Nie wiadomo, kto jest kim,
    // więc wylogowujemy oboje (09 §3.3).
    const { app, clock, refreshToken } = await loggedIn();

    // Drugie urządzenie tego samego użytkownika — ma żyć do momentu wykrycia.
    const second = await app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { email: EMAIL, pin: PIN, deviceLabel: 'Laptop' },
    });
    const secondToken = cookieOf(second);

    const rotated = await postRefresh(app, refreshToken);
    expect(rotated.statusCode).toBe(200);

    // Poza oknem tolerancji: to już nie wyścig dwóch kart, tylko odtworzenie tokenu.
    clock.advance((REFRESH_REUSE_GRACE_SECONDS + 1) * 1000);
    const replay = await postRefresh(app, refreshToken);
    expect(replay.statusCode).toBe(401);

    // Token wydany złodziejowi przestaje działać…
    expect((await postRefresh(app, cookieOf(rotated))).statusCode).toBe(401);
    // …i drugie urządzenie też jest wylogowane.
    expect((await postRefresh(app, secondToken)).statusCode).toBe(401);

    const live = app.db.db
      .select()
      .from(authSessions)
      .all()
      .filter((row) => row.revokedAt === null);
    expect(live).toHaveLength(0);
  });

  it('nieznany token daje 401 bez alarmu', async () => {
    const { app } = await loggedIn();

    const response = await postRefresh(app, 'to-nie-jest-token');

    expect(response.statusCode).toBe(401);
    // Żadna istniejąca sesja nie ucierpiała — to nie jest sygnał kradzieży.
    const live = app.db.db
      .select()
      .from(authSessions)
      .all()
      .filter((row) => row.revokedAt === null);
    expect(live).toHaveLength(1);
  });

  it('brak ciasteczka daje 401', async () => {
    const { app } = await loggedIn();

    const response = await app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: CSRF,
    });

    expect(response.statusCode).toBe(401);
  });

  it('rodzina zachowuje swój termin ważności, nie dostaje nowych trzydziestu dni', async () => {
    // Inaczej skradziona sesja odświeżana w kółko żyłaby wiecznie.
    const { app, clock, refreshToken } = await loggedIn();
    const original = app.db.db.select().from(authSessions).get()?.expiresAt;

    clock.advance(10 * 24 * 60 * 60 * 1000);
    await postRefresh(app, refreshToken);

    const live = app.db.db
      .select()
      .from(authSessions)
      .all()
      .filter((row) => row.revokedAt === null);
    expect(live[0]?.expiresAt).toBe(original);
  });

  it('token po terminie ważności nie odnawia sesji', async () => {
    const { app, clock, refreshToken } = await loggedIn();

    clock.advance(31 * 24 * 60 * 60 * 1000);
    const response = await postRefresh(app, refreshToken);

    expect(response.statusCode).toBe(401);
  });

  it('konto wyłączone po zalogowaniu traci wszystkie sesje', async () => {
    const { app, refreshToken } = await loggedIn();
    app.db.db.update(users).set({ isActive: false }).run();

    const response = await postRefresh(app, refreshToken);

    expect(response.statusCode).toBe(401);
    const live = app.db.db
      .select()
      .from(authSessions)
      .all()
      .filter((row) => row.revokedAt === null);
    expect(live).toHaveLength(0);
  });

  it('w bazie nigdy nie ma surowego tokenu', async () => {
    const { app, refreshToken } = await loggedIn();
    const response = await postRefresh(app, refreshToken);
    const fresh = cookieOf(response);

    const hashes = app.db.db
      .select()
      .from(authSessions)
      .all()
      .map((row) => row.refreshTokenHash);

    expect(hashes).not.toContain(fresh);
    expect(hashes).toContain(sha256Hex(fresh));
  });

  it('limit sześćdziesięciu odświeżeń na godzinę liczy się per sesja', async () => {
    // Normalne użycie to cztery odświeżenia na godzinę (access token żyje 15 minut),
    // więc limit zatrzymuje pętlę, a nie użytkownika z kilkoma kartami (04 §12).
    const { app, refreshToken } = await loggedIn();

    let token = refreshToken;
    let lastStatus = 0;
    for (let round = 0; round < 61; round += 1) {
      const response = await postRefresh(app, token);
      lastStatus = response.statusCode;
      if (lastStatus !== 200) break;
      token = cookieOf(response);
    }

    expect(lastStatus).toBe(429);
  });

  it('wymaga nagłówka CSRF', async () => {
    const { app, refreshToken } = await loggedIn();

    const response = await app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { [REFRESH_COOKIE_NAME]: refreshToken },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('POST /auth/logout', () => {
  it('usuwa całą rodzinę i czyści ciasteczko', async () => {
    const { app, refreshToken } = await loggedIn();
    await postRefresh(app, refreshToken);

    const response = await app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: CSRF,
      cookies: { [REFRESH_COOKIE_NAME]: refreshToken },
    });

    expect(response.statusCode).toBe(200);
    expect(app.db.db.select().from(authSessions).all()).toHaveLength(0);
    const cleared = response.cookies.find((entry) => entry.name === REFRESH_COOKIE_NAME);
    expect(cleared?.value).toBe('');
  });

  it('stary token po wylogowaniu daje zwykłe 401, a nie alarm o kradzieży', async () => {
    // Karta zostawiona otwarta w tle odeśle po wylogowaniu swój stary token. Gdyby
    // wylogowanie unieważniało wiersze zamiast je usuwać, zostałaby wzięta za kradzież
    // i wylogowała użytkownika z pozostałych urządzeń (03 §3.3).
    const { app, refreshToken } = await loggedIn();
    const second = await app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { email: EMAIL, pin: PIN, deviceLabel: 'Laptop' },
    });
    const secondToken = cookieOf(second);

    await app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: CSRF,
      cookies: { [REFRESH_COOKIE_NAME]: refreshToken },
    });
    expect((await postRefresh(app, refreshToken)).statusCode).toBe(401);

    // Drugie urządzenie działa dalej.
    expect((await postRefresh(app, secondToken)).statusCode).toBe(200);
  });

  it('jest idempotentne — bez ciasteczka też kończy się powodzeniem', async () => {
    const { app } = await loggedIn();

    const response = await app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: CSRF,
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('pruneDeadSessions', () => {
  it('usuwa wygasłe, a unieważnione dopiero po okresie karencji', async () => {
    const { app, clock, refreshToken } = await loggedIn();
    await postRefresh(app, refreshToken);
    expect(app.db.db.select().from(authSessions).all()).toHaveLength(2);

    // Zaraz po rotacji zużyty wiersz musi zostać — to na nim opiera się wykrycie
    // ponownego użycia.
    expect(pruneDeadSessions(app.db, clock)).toBe(0);

    clock.advance((REVOKED_SESSION_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(pruneDeadSessions(app.db, clock)).toBe(1);
    expect(app.db.db.select().from(authSessions).all()).toHaveLength(1);
  });

  it('usuwa wiersze po terminie ważności', async () => {
    const { app, clock } = await loggedIn();

    clock.advance(31 * 24 * 60 * 60 * 1000);

    expect(pruneDeadSessions(app.db, clock)).toBe(1);
    expect(app.db.db.select().from(authSessions).all()).toHaveLength(0);
  });
});
