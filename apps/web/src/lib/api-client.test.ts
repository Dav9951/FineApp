import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiRequest, ApiRequestError, buildUrl, NetworkError } from './api-client.js';

/**
 * Podstawia odpowiedź serwera.
 *
 * @param init - Ciało, status i nagłówki odpowiedzi.
 * @param init.body - Ciało odpowiedzi; serializowane do JSON.
 * @param init.status - Status HTTP.
 * @param init.headers - Dodatkowe nagłówki.
 * @returns Atrapa `fetch` zapamiętująca wywołania.
 */
function stubFetch(init: { body?: unknown; status?: number; headers?: Record<string, string> }) {
  const response = new Response(init.body === undefined ? null : JSON.stringify(init.body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const spy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildUrl', () => {
  it('dokłada prefiks /api/v1', () => {
    expect(buildUrl('/accounts')).toBe('/api/v1/accounts');
    expect(buildUrl('accounts')).toBe('/api/v1/accounts');
  });

  it('składa parametry zapytania', () => {
    expect(buildUrl('/transactions', { limit: 50, cursor: 'abc' })).toBe(
      '/api/v1/transactions?limit=50&cursor=abc',
    );
  });

  it('tablica daje parametr powtórzony; pusta tablica — żaden', () => {
    expect(buildUrl('/transactions', { type: ['expense', 'income'], categoryId: [] })).toBe(
      '/api/v1/transactions?type=expense&type=income',
    );
  });

  it('pomija parametry puste', () => {
    expect(buildUrl('/transactions', { limit: 50, cursor: undefined, q: null })).toBe(
      '/api/v1/transactions?limit=50',
    );
  });

  it('nie dokleja znaku zapytania, gdy nie ma parametrów', () => {
    expect(buildUrl('/accounts', {})).toBe('/api/v1/accounts');
  });
});

describe('apiRequest — odpowiedź poprawna', () => {
  it('rozpakowuje kopertę `data`', async () => {
    stubFetch({ body: { data: { id: 'a1', name: 'Konto' } } });
    await expect(apiRequest('/accounts/a1')).resolves.toEqual({ id: 'a1', name: 'Konto' });
  });

  it('obsługuje 204 bez ciała', async () => {
    stubFetch({ status: 204 });
    await expect(apiRequest('/accounts/a1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('wysyła nagłówek chroniący przed CSRF', async () => {
    // Prosty formularz z obcej strony nie potrafi ustawić tego nagłówka (09 §5).
    const spy = stubFetch({ body: { data: null } });
    await apiRequest('/accounts');
    expect(spy.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ 'X-Requested-With': 'fineapp' }),
      credentials: 'include',
    });
  });

  it('dokłada token dostępu i klucz idempotencji, gdy podane', async () => {
    const spy = stubFetch({ body: { data: null } });
    await apiRequest('/recurring/o1/post', {
      method: 'POST',
      body: { amountMinor: 1000 },
      accessToken: 'tok',
      idempotencyKey: 'key-1',
    });
    const headers = (spy.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['Idempotency-Key']).toBe('key-1');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('nie ustawia Content-Type bez ciała', async () => {
    const spy = stubFetch({ body: { data: null } });
    await apiRequest('/accounts');
    const headers = (spy.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
    expect(headers['Content-Type']).toBeUndefined();
  });
});

describe('apiRequest — błędy', () => {
  it('zamienia kopertę błędu na ApiRequestError z komunikatem serwera', async () => {
    // Komunikat pochodzi z serwera: jest po polsku i dotyczy konkretnej sytuacji,
    // zamiast być ogólnikiem dopisanym na froncie.
    stubFetch({
      status: 422,
      body: {
        error: {
          code: 'DOMAIN_RULE_VIOLATION',
          message: 'Przelew wymaga konta docelowego.',
          details: [{ path: 'counterAccountId', message: 'Pole wymagane' }],
          requestId: '01JB2X9K7TQW3R5Y7U9I1O3P5A',
        },
      },
    });

    const error = await apiRequest('/transactions', { method: 'POST' }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    const apiError = error as ApiRequestError;
    expect(apiError.code).toBe('DOMAIN_RULE_VIOLATION');
    expect(apiError.status).toBe(422);
    expect(apiError.message).toBe('Przelew wymaga konta docelowego.');
    expect(apiError.requestId).toBe('01JB2X9K7TQW3R5Y7U9I1O3P5A');
  });

  it('zamienia szczegóły na mapę dla react-hook-form', async () => {
    stubFetch({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Błąd.',
          details: [
            { path: 'amountMinor', message: 'Kwota musi być większa od zera' },
            { path: 'bookedOn', message: 'Nieistniejąca data' },
          ],
          requestId: 'r',
        },
      },
    });

    const error = (await apiRequest('/transactions', { method: 'POST' }).catch(
      (caught: unknown) => caught,
    )) as ApiRequestError;
    expect(error.fieldErrors()).toEqual({
      amountMinor: 'Kwota musi być większa od zera',
      bookedOn: 'Nieistniejąca data',
    });
  });

  it('radzi sobie z odpowiedzią spoza kontraktu, zachowując status', async () => {
    // Serwer pośredniczący potrafi zwrócić HTML. Status wciąż pozwala odróżnić 401 od 500.
    stubFetch({ status: 502, body: '<html>Bad gateway</html>' });
    const error = (await apiRequest('/accounts').catch(
      (caught: unknown) => caught,
    )) as ApiRequestError;
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.status).toBe(502);
  });

  it('bierze requestId z nagłówka, gdy ciała nie da się odczytać', async () => {
    stubFetch({ status: 500, headers: { 'x-request-id': '01JB2X9K7TQW3R5Y7U9I1O3P5A' } });
    const error = (await apiRequest('/accounts').catch(
      (caught: unknown) => caught,
    )) as ApiRequestError;
    expect(error.requestId).toBe('01JB2X9K7TQW3R5Y7U9I1O3P5A');
  });

  it('awarię sieci zgłasza jako NetworkError, nie jako błąd API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await apiRequest('/accounts').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).message).toBe('Brak połączenia z serwerem.');
  });

  it('przerwanie żądania przepuszcza dalej, nie zamienia w NetworkError', async () => {
    // TanStack Query przerywa żądania przy odmontowaniu — to nie jest awaria.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
    const error = await apiRequest('/accounts').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });
});
