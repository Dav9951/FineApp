import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import {
  isPublicAddress,
  safeFetchHtml,
  SafeFetchError,
  type SafeFetchDeps,
} from './safe-fetch.js';

/**
 * Testy ochrony przed SSRF (09 §7a, ADR-095) — bez wychodzenia do sieci: DNS i żądania
 * są atrapami, a sprawdzamy, czego `safeFetchHtml` w ogóle próbuje.
 */

/**
 * Odpowiedź HTTP jako strumień.
 *
 * @param status - Kod.
 * @param headers - Nagłówki.
 * @param body - Treść.
 * @returns Atrapa `IncomingMessage`.
 */
function response(
  status: number,
  headers: Record<string, string>,
  body: string | Buffer = '',
): IncomingMessage {
  const stream = new PassThrough();
  stream.end(body);
  return Object.assign(stream, { statusCode: status, headers }) as unknown as IncomingMessage;
}

/**
 * Atrapy sieci: DNS z mapy, odpowiedzi z kolejki.
 *
 * @param dns - Nazwa → adresy.
 * @param replies - Kolejne odpowiedzi.
 * @returns Zależności i atrapa żądań.
 */
function fakeNet(dns: Record<string, string[]>, replies: IncomingMessage[]) {
  const get = vi.fn<SafeFetchDeps['get']>(() => {
    const next = replies.shift();
    return next === undefined
      ? Promise.reject(new Error('brak odpowiedzi'))
      : Promise.resolve(next);
  });
  const deps: SafeFetchDeps = {
    resolveAll: (host) => {
      const addresses = dns[host];
      return addresses === undefined
        ? Promise.reject(new Error('ENOTFOUND'))
        : Promise.resolve(
            addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
          );
    },
    get,
  };
  return { deps, get };
}

const HTML = { 'content-type': 'text/html; charset=utf-8' };

describe('isPublicAddress', () => {
  it.each([
    ['93.184.216.34', true],
    ['2606:4700::1111', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.20.0.5', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['::1', false],
    ['::', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:7f00:1', false],
    ['::ffff:a00:1', false],
    ['::ffff:5db8:d822', true],
    ['::127.0.0.1', false],
    ['nie-ip', false],
  ])('%s → %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});

describe('safeFetchHtml', () => {
  it('pobiera stronę i łączy się na sprawdzony adres', async () => {
    const { deps, get } = fakeNet({ 'przepisy.pl': ['93.184.216.34'] }, [
      response(200, HTML, '<h1>Brownie</h1>'),
    ]);
    const result = await safeFetchHtml('https://przepisy.pl/brownie', deps);
    expect(result).toEqual({ url: 'https://przepisy.pl/brownie', html: '<h1>Brownie</h1>' });
    const [, options] = get.mock.calls[0] ?? [];
    expect(options?.headers).toEqual({
      'user-agent': 'FineApp/1.0 (recipe import)',
      accept: 'text/html,application/xhtml+xml',
    });
    // `lookup` zwraca wyłącznie adres sprawdzony wcześniej — bez drugiego zapytania DNS.
    const lookup = options?.lookup as unknown as (
      host: string,
      opts: { all?: boolean },
      cb: (...args: unknown[]) => void,
    ) => void;
    const single = vi.fn();
    lookup('przepisy.pl', {}, single);
    expect(single).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    const all = vi.fn();
    lookup('przepisy.pl', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  });

  it.each([
    ['ftp://przepisy.pl/x', 'RECIPE_FETCH_BLOCKED'],
    ['file:///etc/passwd', 'RECIPE_FETCH_BLOCKED'],
    ['http://przepisy.pl:8080/x', 'RECIPE_FETCH_BLOCKED'],
    ['https://user:pass@przepisy.pl/x', 'RECIPE_FETCH_BLOCKED'],
    ['http://127.0.0.1/admin', 'RECIPE_FETCH_BLOCKED'],
    ['http://[::1]/', 'RECIPE_FETCH_BLOCKED'],
    ['http://[::ffff:127.0.0.1]/', 'RECIPE_FETCH_BLOCKED'],
    ['http://169.254.169.254/latest/meta-data', 'RECIPE_FETCH_BLOCKED'],
    ['http://wewnetrzny.lan/', 'RECIPE_FETCH_BLOCKED'],
    ['http://mieszany.pl/', 'RECIPE_FETCH_BLOCKED'],
    ['http://nieznany.pl/', 'RECIPE_FETCH_FAILED'],
    ['to nie jest adres', 'RECIPE_FETCH_BLOCKED'],
  ])('%s → %s, bez połączenia', async (url, code) => {
    const { deps, get } = fakeNet(
      { 'wewnetrzny.lan': ['10.0.0.5'], 'mieszany.pl': ['93.184.216.34', '192.168.0.10'] },
      [],
    );
    await expect(safeFetchHtml(url, deps)).rejects.toMatchObject({ code });
    expect(get).not.toHaveBeenCalled();
  });

  it('każde przekierowanie jest sprawdzane od nowa — nie wpuści do sieci prywatnej', async () => {
    const { deps, get } = fakeNet({ 'przepisy.pl': ['93.184.216.34'] }, [
      response(302, { location: 'http://127.0.0.1:3000/api/v1/settings/export' }),
    ]);
    await expect(safeFetchHtml('https://przepisy.pl/x', deps)).rejects.toMatchObject({
      code: 'RECIPE_FETCH_BLOCKED',
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('przekierowania względne działają, ale najwyżej trzy', async () => {
    const hop = (to: string): IncomingMessage => response(301, { location: to });
    const ok = fakeNet({ 'przepisy.pl': ['93.184.216.34'] }, [
      hop('/a'),
      hop('/b'),
      hop('/c'),
      response(200, HTML, 'ok'),
    ]);
    expect((await safeFetchHtml('https://przepisy.pl/', ok.deps)).url).toBe(
      'https://przepisy.pl/c',
    );
    const tooMany = fakeNet({ 'przepisy.pl': ['93.184.216.34'] }, [
      hop('/a'),
      hop('/b'),
      hop('/c'),
      hop('/d'),
    ]);
    await expect(safeFetchHtml('https://przepisy.pl/', tooMany.deps)).rejects.toMatchObject({
      code: 'RECIPE_FETCH_FAILED',
      message: 'Za dużo przekierowań',
    });
  });

  it('odrzuca status błędu, nie-HTML i za dużą stronę (także bez Content-Length)', async () => {
    const dns = { 'przepisy.pl': ['93.184.216.34'] };
    const limits = { timeoutMs: 1000, maxBytes: 10, maxRedirects: 3 };
    await expect(
      safeFetchHtml('https://przepisy.pl/', fakeNet(dns, [response(404, HTML)]).deps, limits),
    ).rejects.toMatchObject({ message: 'Status 404' });
    await expect(
      safeFetchHtml(
        'https://przepisy.pl/',
        fakeNet(dns, [response(200, { 'content-type': 'application/pdf' })]).deps,
        limits,
      ),
    ).rejects.toMatchObject({ message: 'To nie jest strona HTML' });
    await expect(
      safeFetchHtml(
        'https://przepisy.pl/',
        fakeNet(dns, [response(200, { ...HTML, 'content-length': '999' })]).deps,
        limits,
      ),
    ).rejects.toMatchObject({ message: 'Strona za duża' });
    await expect(
      safeFetchHtml(
        'https://przepisy.pl/',
        fakeNet(dns, [response(200, HTML, 'x'.repeat(50))]).deps,
        limits,
      ),
    ).rejects.toMatchObject({ message: 'Strona za duża' });
  });

  it('przekroczony czas przerywa pobieranie', async () => {
    const deps: SafeFetchDeps = {
      resolveAll: () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
      get: (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    };
    const error: unknown = await safeFetchHtml('https://przepisy.pl/', deps, {
      timeoutMs: 20,
      maxBytes: 100,
      maxRedirects: 3,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SafeFetchError);
    expect(error).toMatchObject({ code: 'RECIPE_FETCH_FAILED', message: 'Przekroczony czas' });
  });
});
