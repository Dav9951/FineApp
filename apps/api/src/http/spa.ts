import { existsSync } from 'node:fs';
import { join } from 'node:path';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Serwowanie zbudowanego frontu z tego samego procesu co API
 * ([10 §1](../../../../plans/10-deployment.md#1-model-wdrożenia), `F8-7`).
 *
 * Jeden kontener, jedno pochodzenie: ciasteczko sesji i `connect-src 'self'` z CSP
 * działają bez CORS-u. Pliki z `assets/` mają w nazwie skrót treści, więc mogą leżeć
 * w pamięci podręcznej rok; `index.html`, `sw.js` i manifest — nigdy, bo to one
 * wskazują nową wersję po wdrożeniu. Przy `sw.js` z długim cache telefon trzymałby
 * starą aplikację do skutku.
 */

/** Pamięć podręczna plików z odciskiem treści w nazwie. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Pliki wskazujące wersję — zawsze pytamy serwer. */
const REVALIDATE = 'no-cache';

/**
 * Nagłówek `Cache-Control` dla pliku frontu.
 *
 * @param path - Ścieżka pliku na dysku.
 * @returns Wartość nagłówka.
 */
export function cacheControlFor(path: string): string {
  return /[\\/]assets[\\/]/u.test(path) ? IMMUTABLE : REVALIDATE;
}

/**
 * Czy żądanie powinno dostać `index.html` — nawigacja w SPA, a nie brakujący plik ani API.
 *
 * Adres z kropką w ostatnim członie (`/logo.png`) to plik, którego nie ma: `404`, a nie
 * strona aplikacji, bo przeglądarka próbowałaby odczytać HTML jako obrazek.
 *
 * @param request - Żądanie.
 * @returns `true`, gdy oddać powłokę aplikacji.
 */
export function wantsSpaShell(request: Pick<FastifyRequest, 'method' | 'url'>): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const path = request.url.split('?')[0] ?? '';
  // Całe `/api`, nie tylko `/api/v1`: literówka w wersji ma dostać JSON-owe 404.
  if (path === '/api' || path.startsWith('/api/')) return false;
  const last = path.split('/').at(-1) ?? '';
  return !last.includes('.');
}

/**
 * Oddaje `index.html` dla trasy aplikacji.
 *
 * @param reply - Odpowiedź.
 * @returns Odpowiedź z powłoką.
 */
export function sendSpaShell(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', REVALIDATE).type('text/html').sendFile('index.html');
}

/**
 * Rejestruje pliki frontu, jeżeli katalog istnieje.
 *
 * @param app - Instancja Fastify.
 * @param distPath - Katalog `apps/web/dist`.
 * @throws {Error} Gdy katalog wskazano, ale nie ma w nim `index.html` — lepiej nie
 *   wystartować, niż wystawić API bez aplikacji.
 */
export async function registerSpa(app: FastifyInstance, distPath: string): Promise<void> {
  if (!existsSync(join(distPath, 'index.html'))) {
    throw new Error(`WEB_DIST_PATH: brak index.html w ${distPath}`);
  }
  await app.register(fastifyStatic, {
    root: distPath,
    prefix: '/',
    // Bez `index.html` pod `/` z automatu — tę ścieżkę obsługuje fallback z tym samym
    // nagłówkiem co każda inna trasa aplikacji.
    index: false,
    // Pliki listowane przy starcie; nieznany adres trafia do obsługi 404, a nie do
    // odczytu z dysku przy każdym żądaniu.
    wildcard: false,
    setHeaders: (reply, path) => {
      void reply.header('cache-control', cacheControlFor(path));
    },
  });
}
