import { describe, expect, it } from 'vitest';

import { testConfig } from '../../../test/build-app.js';
import { isAppError } from '../../core/errors.js';
import { sha256Hex } from './auth.hash.js';
import {
  createRefreshToken,
  refreshCookieOptions,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  signAccessToken,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  verifyAccessToken,
} from './auth.tokens.js';

/**
 * Testy tokenów ([09 §3](../../../../../../plans/09-security-auth.md#3-sesje-i-tokeny)).
 */

const CONFIG = testConfig();
const NOW = new Date('2026-09-22T12:00:00.000Z');
const CLAIMS = {
  sub: '01J9ZQK8WQ0000000000000000',
  hid: '01J9ZQK8WQ1111111111111111',
  sid: '01J9ZQK8WQ2222222222222222',
};

describe('signAccessToken i verifyAccessToken', () => {
  it('token niesie użytkownika, gospodarstwo i sesję', async () => {
    const token = await signAccessToken(CONFIG, CLAIMS, NOW);

    await expect(verifyAccessToken(CONFIG, token, NOW)).resolves.toEqual(CLAIMS);
  });

  it('token nie niesie adresu e-mail ani niczego wrażliwego', async () => {
    const token = await signAccessToken(CONFIG, CLAIMS, NOW);
    const [, payload = ''] = token.split('.');
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');

    expect(Object.keys(JSON.parse(decoded) as Record<string, unknown>).sort()).toEqual([
      'aud',
      'exp',
      'hid',
      'iat',
      'iss',
      'sid',
      'sub',
    ]);
  });

  it('token wygasa po czasie z konfiguracji', async () => {
    const token = await signAccessToken(CONFIG, CLAIMS, NOW);
    const justBefore = new Date(NOW.getTime() + (CONFIG.auth.accessTokenTtlSeconds - 1) * 1000);
    const after = new Date(NOW.getTime() + (CONFIG.auth.accessTokenTtlSeconds + 60) * 1000);

    await expect(verifyAccessToken(CONFIG, token, justBefore)).resolves.toMatchObject(CLAIMS);
    await expect(verifyAccessToken(CONFIG, token, after)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('token podpisany innym sekretem jest odrzucany', async () => {
    const token = await signAccessToken(CONFIG, CLAIMS, NOW);
    const other = testConfig({ auth: { ...CONFIG.auth, jwtSecret: 'z'.repeat(48) } });

    await expect(verifyAccessToken(other, token, NOW)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('token bez wymaganych pól jest odrzucany', async () => {
    // Podpisany naszym sekretem, ale bez `hid` — czyli bez zakresu danych.
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(CLAIMS.sub)
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setIssuedAt(Math.floor(NOW.getTime() / 1000))
      .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 900)
      .sign(new TextEncoder().encode(CONFIG.auth.jwtSecret));

    await expect(verifyAccessToken(CONFIG, token, NOW)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('każdy powód odrzucenia daje ten sam komunikat', async () => {
    const messages = new Set<string>();
    for (const token of ['to-nie-jest-token', '', 'a.b.c']) {
      try {
        await verifyAccessToken(CONFIG, token, NOW);
      } catch (error) {
        if (isAppError(error)) messages.add(error.message);
      }
    }

    expect(messages.size).toBe(1);
  });
});

describe('createRefreshToken', () => {
  it('daje token o 256 bitach losowości i jego hash', () => {
    const { token, hash } = createRefreshToken();

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toBe(sha256Hex(token));
    expect(hash).toHaveLength(64);
  });

  it('nie powtarza się', () => {
    const drawn = new Set(Array.from({ length: 50 }, () => createRefreshToken().token));
    expect(drawn.size).toBe(50);
  });

  it('nadaje się do ciasteczka bez kodowania', () => {
    for (let round = 0; round < 20; round += 1) {
      expect(createRefreshToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('refreshCookieOptions', () => {
  it('zawęża ścieżkę, żeby ciasteczko nie jechało z każdym żądaniem', () => {
    expect(refreshCookieOptions(CONFIG)).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: CONFIG.auth.refreshTokenTtlSeconds,
    });
    expect(REFRESH_COOKIE_NAME).toBe('fineapp_rt');
  });

  it('w produkcji ciasteczko jest tylko po HTTPS', () => {
    const production = testConfig({ auth: { ...CONFIG.auth, cookieSecure: true } });
    expect(refreshCookieOptions(production).secure).toBe(true);
  });

  it('domena pojawia się tylko wtedy, gdy jest ustawiona', () => {
    expect(refreshCookieOptions(CONFIG)).not.toHaveProperty('domain');
    expect(
      refreshCookieOptions(testConfig({ auth: { ...CONFIG.auth, cookieDomain: 'fineapp.pl' } })),
    ).toMatchObject({ domain: 'fineapp.pl' });
  });
});
