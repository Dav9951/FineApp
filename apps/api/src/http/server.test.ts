import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, type TestApp } from '../../test/build-app.js';
import {
  ConflictError,
  DomainRuleViolationError,
  NotFoundError,
  UnauthorizedError,
} from '../core/errors.js';
import { isId } from '../core/id.js';

/** Kształt ciała odpowiedzi błędu, do typowanego odczytu w testach. */
interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
    retryAfterSeconds?: number;
    requestId: string;
  };
}

/** Kształt odpowiedzi `/health`. */
interface HealthBody {
  status: string;
  version: string;
  dbOk: boolean;
  uptimeSeconds: number;
}

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe('GET /api/v1/health', () => {
  it('odpowiada kontraktem z 10 §8, bez autoryzacji', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json<HealthBody>()).toEqual({
      status: 'ok',
      version: '0.0.0-test',
      dbOk: true,
      uptimeSeconds: expect.any(Number),
    });
  });

  it('zgłasza dbOk: false, gdy baza nie odpowiada', async () => {
    // Kontener, który wstał, ale nie widzi bazy, jest bezużyteczny — bez tego pola
    // wyglądałby na zdrowy.
    harness = await buildTestApp();
    harness.db.sqlite.close();
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json<HealthBody>().dbOk).toBe(false);
  });

  it('nie jest limitowany — healthcheck odpytuje co 30 sekund', async () => {
    harness = await buildTestApp();
    const codes: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const response = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
      codes.push(response.statusCode);
    }
    expect(new Set(codes)).toEqual(new Set([200]));
  });
});

describe('X-Request-Id', () => {
  it('jest w każdej odpowiedzi i jest identyfikatorem tego samego formatu co klucze główne', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    const requestId = response.headers['x-request-id'];

    expect(typeof requestId).toBe('string');
    expect(isId(requestId as string)).toBe(true);
  });

  it('różni się między żądaniami', async () => {
    harness = await buildTestApp();
    const first = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    const second = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });
});

describe('nagłówki bezpieczeństwa (09 §6)', () => {
  it('ustawia CSP, nosniff, frameguard i referrer-policy', async () => {
    harness = await buildTestApp();
    const { headers } = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).toContain("connect-src 'self'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('same-origin');
  });

  it('nie wysyła HSTS poza produkcją', async () => {
    // W dev nagłówek zablokowałby localhost po HTTP na czas swojej ważności.
    harness = await buildTestApp();
    const { headers } = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(headers['strict-transport-security']).toBeUndefined();
  });

  it('wysyła HSTS w produkcji', async () => {
    harness = await buildTestApp({ isProduction: true });
    const { headers } = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(headers['strict-transport-security']).toContain('max-age=');
  });
});

describe('obsługa błędów — kontrakt z 04 §3', () => {
  it('nieznana trasa daje 404 NOT_FOUND w kopercie błędu', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/nie-ma' });

    expect(response.statusCode).toBe(404);
    const body = response.json<ErrorBody>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Nie znaleziono zasobu.');
    expect(isId(body.error.requestId)).toBe(true);
  });

  it('requestId w ciele zgadza się z nagłówkiem', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/nie-ma' });
    expect(response.json<ErrorBody>().error.requestId).toBe(response.headers['x-request-id']);
  });

  it.each([
    [new NotFoundError('Nie znaleziono konta.'), 404, 'NOT_FOUND'],
    [new UnauthorizedError(), 401, 'UNAUTHORIZED'],
    [new ConflictError('Konto o tej nazwie już istnieje.'), 409, 'CONFLICT'],
    [
      new DomainRuleViolationError('Przelew wymaga konta docelowego.'),
      422,
      'DOMAIN_RULE_VIOLATION',
    ],
  ])('błąd aplikacyjny trafia na właściwy status i kod', async (error, status, code) => {
    harness = await buildTestApp();
    harness.app.get('/api/v1/boom', () => {
      throw error;
    });
    await harness.app.ready();

    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/boom' });
    expect(response.statusCode).toBe(status);
    expect(response.json<ErrorBody>().error).toMatchObject({ code, message: error.message });
  });

  it('przenosi szczegóły do podświetlenia pól formularza', async () => {
    harness = await buildTestApp();
    const details = [{ path: 'amountMinor', message: 'Oczekiwano liczby dodatniej' }];
    harness.app.get('/api/v1/boom', () => {
      throw new DomainRuleViolationError('Kwota musi być większa od zera.', details);
    });
    await harness.app.ready();

    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/boom' });
    expect(response.json<ErrorBody>().error.details).toEqual(details);
  });

  it('limit żądań podaje czas oczekiwania w ciele, nie tylko w nagłówku', async () => {
    // Front czyta odpowiedź, a nie nagłówki (04 §4). Wartość stoi OBOK `details`,
    // bo `details` jest jednorodną listą `{ path, message }` dla pól formularza.
    harness = await buildTestApp();
    harness.app.get('/api/v1/boom', (_request, reply) => {
      void reply.header('retry-after', '42');
      throw Object.assign(new Error('za dużo'), { statusCode: 429 });
    });
    await harness.app.ready();

    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/boom' });
    expect(response.statusCode).toBe(429);
    const body = response.json<ErrorBody>();
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.retryAfterSeconds).toBe(42);
    expect(body.error.details).toBeUndefined();
  });

  it('limit żądań bez nagłówka nie zmyśla czasu oczekiwania', async () => {
    harness = await buildTestApp();
    harness.app.get('/api/v1/boom', () => {
      throw Object.assign(new Error('za dużo'), { statusCode: 429 });
    });
    await harness.app.ready();

    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/boom' });
    expect(response.json<ErrorBody>().error.retryAfterSeconds).toBeUndefined();
  });

  it('nieobsłużony wyjątek nie wynosi szczegółów na zewnątrz', async () => {
    // Pierwszy lepszy wyciek zdradziłby ścieżkę na dysku albo fragment zapytania SQL.
    harness = await buildTestApp();
    harness.app.get('/api/v1/boom', () => {
      throw new Error('SELECT * FROM users WHERE pin_hash = ...');
    });
    await harness.app.ready();

    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/boom' });
    expect(response.statusCode).toBe(500);
    const body = response.json<ErrorBody>();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Wystąpił nieoczekiwany błąd.');
    expect(response.payload).not.toContain('pin_hash');
    expect(response.payload).not.toContain('SELECT');
  });
});

describe('parsowanie ciała', () => {
  it('puste ciało przy Content-Type: application/json nie jest błędem', async () => {
    // Trasy `/auth/refresh` i `/auth/logout` ciała nie mają, a wiele klientów HTTP
    // ustawia ten nagłówek odruchowo. Bez tego użytkownik dostawałby „Żądanie zawiera
    // nieprawidłowe dane" zamiast odnowionej sesji.
    harness = await buildTestApp();
    harness.app.post('/api/v1/echo', (request) => ({ body: request.body }));
    await harness.app.ready();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'fineapp' },
      payload: '',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ body: unknown }>().body).toEqual({});
  });

  it('ciało, które nie jest JSON-em, nadal jest błędem', async () => {
    harness = await buildTestApp();
    harness.app.post('/api/v1/echo', () => ({ ok: true }));
    await harness.app.ready();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'fineapp' },
      payload: '{to nie jest json',
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('serializacja odpowiedzi', () => {
  it('pole spoza schematu odpowiedzi nie wychodzi na zewnątrz', async () => {
    // Serializer działa jako lista dozwoleń — to jest jedna z warstw, na których
    // opiera się 09: odpowiedź nie wynosi pól spoza kontraktu.
    harness = await buildTestApp();
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(Object.keys(response.json<HealthBody>()).sort()).toEqual([
      'dbOk',
      'status',
      'uptimeSeconds',
      'version',
    ]);
  });
});
