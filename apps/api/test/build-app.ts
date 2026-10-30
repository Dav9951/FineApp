import type { FastifyInstance } from 'fastify';

import type { Clock } from '../src/core/clock.js';
import type { Config } from '../src/core/config.js';
import { openDatabase, type DbHandle } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate.js';
import { buildServer, type ServerDeps } from '../src/http/server.js';

/**
 * Fabryki danych testowych dla API.
 *
 * Testy tras używają bazy `:memory:` i `app.inject()` — bez portu, bez pliku, bez
 * sprzątania po sobie ([02 §9](../../../plans/02-architecture.md)).
 */

/**
 * Buduje konfigurację testową.
 *
 * @param overrides - Nadpisania sekcji konfiguracji.
 * @returns Konfiguracja gotowa do wstrzyknięcia.
 */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    env: 'test',
    isProduction: false,
    server: {
      port: 0,
      host: '127.0.0.1',
      appUrl: 'http://localhost:5173',
      logLevel: 'silent',
    },
    db: { path: ':memory:' },
    uploads: { dir: '/tmp/fineapp-test-uploads', maxBytes: 10_485_760 },
    auth: {
      jwtSecret: 'x'.repeat(48),
      ipHashSalt: 'y'.repeat(24),
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 2_592_000,
      pinMinLength: 6,
      pinMaxLength: 8,
      maxFailedAttempts: 5,
      lockoutSeconds: 900,
      cookieSecure: false,
      cookieDomain: '',
    },
    ai: {
      enabled: false,
      apiKey: '',
      model: 'claude-sonnet-5',
      maxOutputTokens: 4096,
      monthlyBudgetMinor: 5000,
      inputCostMinorPerMTok: 800,
      outputCostMinorPerMTok: 4000,
    },
    web: { distPath: null },
    defaults: { currency: 'PLN', timezone: 'Europe/Warsaw', locale: 'pl-PL' },
    ...overrides,
  };
}

/**
 * Otwiera bazę `:memory:` z zastosowanymi migracjami, bez budowania serwera.
 *
 * Testy serwisów i skryptów nie potrzebują Fastify — samo zbudowanie instancji
 * kosztuje więcej niż cały taki test.
 *
 * @returns Uchwyt bazy gotowy do użycia.
 */
export function testDb(): DbHandle {
  const handle = openDatabase(':memory:');
  applyMigrations(handle);
  return handle;
}

/** Zbudowana aplikacja testowa wraz z uchwytem bazy. */
export interface TestApp {
  readonly app: FastifyInstance;
  readonly db: DbHandle;
  /** Zamyka serwer i bazę. */
  close(): Promise<void>;
}

/**
 * Buduje aplikację na bazie `:memory:` ze świeżo zastosowanymi migracjami.
 *
 * @param overrides - Nadpisania konfiguracji.
 * @param clock - Zegar; brak oznacza czas systemowy.
 * @param extra - Atrapa ekstraktora i rejestr analiz (testy dokumentów).
 * @returns Aplikacja, uchwyt bazy i funkcja sprzątająca.
 */
export async function buildTestApp(
  overrides: Partial<Config> = {},
  clock?: Clock,
  extra: Pick<ServerDeps, 'extractor' | 'documentJobs'> = {},
): Promise<TestApp> {
  const config = testConfig(overrides);
  const db = openDatabase(':memory:');
  applyMigrations(db);
  // Celowo bez `app.ready()`: test może jeszcze dorejestrować własną trasę, a `inject()`
  // i tak doprowadzi instancję do gotowości przy pierwszym żądaniu.
  const app = await buildServer({
    config,
    db,
    version: '0.0.0-test',
    ...(clock === undefined ? {} : { clock }),
    ...extra,
  });

  return {
    app,
    db,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}
