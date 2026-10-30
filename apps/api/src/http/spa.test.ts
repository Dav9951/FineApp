import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, type TestApp } from '../../test/build-app.js';
import { cacheControlFor, wantsSpaShell } from './spa.js';

/**
 * Testy serwowania frontu — `F8-7`
 * ([10 §1](../../../../plans/10-deployment.md#1-model-wdrożenia)).
 */

let dist: string;
let harness: TestApp | undefined;

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'fineapp-web-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(dist, 'sw.js'), 'self.x = 1');
  writeFileSync(join(dist, 'manifest.webmanifest'), '{}');
});

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/**
 * Aplikacja z frontem w katalogu tymczasowym.
 *
 * @returns Aplikacja testowa.
 */
async function withSpa(): Promise<TestApp> {
  harness = await buildTestApp({ web: { distPath: dist } });
  return harness;
}

describe('wantsSpaShell', () => {
  it('nawigacja — tak; API, pliki i zapis — nie', () => {
    expect(wantsSpaShell({ method: 'GET', url: '/' })).toBe(true);
    expect(wantsSpaShell({ method: 'GET', url: '/m/2026-09?x=1' })).toBe(true);
    expect(wantsSpaShell({ method: 'HEAD', url: '/settings/income-sources' })).toBe(true);
    expect(wantsSpaShell({ method: 'GET', url: '/api/v1/nie-ma' })).toBe(false);
    expect(wantsSpaShell({ method: 'GET', url: '/api/v2/accounts' })).toBe(false);
    expect(wantsSpaShell({ method: 'GET', url: '/api' })).toBe(false);
    expect(wantsSpaShell({ method: 'GET', url: '/logo.png' })).toBe(false);
    expect(wantsSpaShell({ method: 'POST', url: '/m/2026-09' })).toBe(false);
  });
});

describe('cacheControlFor', () => {
  it('rok dla plików z odciskiem, zawsze pytaj dla reszty', () => {
    expect(cacheControlFor('/app/web/assets/index-abc.js')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(cacheControlFor('C:\\app\\web\\assets\\index-abc.js')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(cacheControlFor('/app/web/sw.js')).toBe('no-cache');
    expect(cacheControlFor('/app/web/index.html')).toBe('no-cache');
  });
});

describe('serwowanie frontu', () => {
  it('trasa aplikacji dostaje index.html bez pamięci podręcznej, z CSP', async () => {
    const { app } = await withSpa();
    for (const url of ['/', '/m/2026-09', '/settings']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/html/u);
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.body).toContain('<div id="root">');
    }
  });

  it('pliki z assets — rok; sw.js i manifest — bez pamięci podręcznej', async () => {
    const { app } = await withSpa();
    const asset = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    for (const url of ['/sw.js', '/manifest.webmanifest']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers['cache-control'], url).toBe('no-cache');
    }
  });

  it('API ma pierwszeństwo, a nieznane API dostaje JSON-owe 404', async () => {
    const { app } = await withSpa();
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(health.json<{ status: string }>().status).toBe('ok');

    const missing = await app.inject({ method: 'GET', url: '/api/v1/nie-ma' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });

  it('poza katalogiem frontu nic nie wychodzi — uploady tylko przez API (09 §11)', async () => {
    const { app } = await withSpa();
    // Adres wychodzący poza katalog jest normalizowany do ścieżki aplikacji — dostaje
    // powłokę SPA, nigdy plik systemowy.
    for (const url of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.body, url).not.toContain('root:');
    }
    for (const url of ['/uploads/2026/09/paragon.jpg', '/data/fineapp.db', '/.env']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(404);
    }
  });

  it('brakujący plik to 404, nie strona aplikacji', async () => {
    const { app } = await withSpa();
    const response = await app.inject({ method: 'GET', url: '/assets/nie-ma.js' });
    expect(response.statusCode).toBe(404);
  });

  it('bez WEB_DIST_PATH — nawigacja dostaje JSON-owe 404 (dev: front z Vite)', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({ method: 'GET', url: '/m/2026-09' });
    expect(response.statusCode).toBe(404);
  });

  it('katalog bez index.html — odmowa startu', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'fineapp-empty-'));
    try {
      await expect(buildTestApp({ web: { distPath: empty } })).rejects.toThrow(
        /WEB_DIST_PATH: brak index.html/u,
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
