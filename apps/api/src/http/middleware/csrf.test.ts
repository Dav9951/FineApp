import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, type TestApp } from '../../../test/build-app.js';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from './csrf.js';

/**
 * Testy ochrony przed CSRF ([09 §5](../../../../../plans/09-security-auth.md#5-ochrona-csrf)).
 *
 * Druga z trzech warstw. Sprawdzamy oba kierunki: że brak nagłówka odbija żądanie
 * **i** że jego obecność niczego nie psuje przy metodach bezpiecznych.
 */

/** Kształt odpowiedzi błędu. */
interface ErrorBody {
  error: { code: string; message: string };
}

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe('registerCsrfGuard', () => {
  it('odbija POST bez nagłówka', async () => {
    harness = await buildTestApp();
    harness.app.post('/api/v1/boom', () => ({ ok: true }));
    await harness.app.ready();

    const response = await harness.app.inject({ method: 'POST', url: '/api/v1/boom' });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe('FORBIDDEN');
    expect(response.json<ErrorBody>().error.message).toContain(CSRF_HEADER);
  });

  it('odbija POST z nagłówkiem o złej wartości', async () => {
    harness = await buildTestApp();
    harness.app.post('/api/v1/boom', () => ({ ok: true }));
    await harness.app.ready();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/boom',
      headers: { [CSRF_HEADER]: 'cos-innego' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('przepuszcza POST z właściwym nagłówkiem', async () => {
    harness = await buildTestApp();
    harness.app.post('/api/v1/boom', () => ({ ok: true }));
    await harness.app.ready();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/boom',
      headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
    });

    expect(response.statusCode).toBe(200);
  });

  it.each(['DELETE', 'PATCH', 'PUT'])('wymaga nagłówka także przy %s', async (method) => {
    harness = await buildTestApp();
    harness.app.route({ method, url: '/api/v1/boom', handler: () => ({ ok: true }) });
    await harness.app.ready();

    const response = await harness.app.inject({
      method: method as 'DELETE' | 'PATCH' | 'PUT',
      url: '/api/v1/boom',
    });

    expect(response.statusCode).toBe(403);
  });

  it('metody bezpieczne nie wymagają nagłówka', async () => {
    // `/health` jest odpytywane przez HEALTHCHECK Dockera, który nagłówka nie ustawi.
    harness = await buildTestApp();

    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
  });

  it('odbija, zanim serwer zacznie parsować ciało', async () => {
    // Hook stoi na `onRequest`. Ciało jest tu jawnie niepoprawnym JSON-em: gdyby
    // dotarło do parsera, odpowiedź miałaby status 400, a nie 403.
    harness = await buildTestApp();
    harness.app.post('/api/v1/boom', () => ({ ok: true }));
    await harness.app.ready();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/boom',
      headers: { 'content-type': 'application/json' },
      payload: '{to nie jest json',
    });

    expect(response.statusCode).toBe(403);
  });
});
