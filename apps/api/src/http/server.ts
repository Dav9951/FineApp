import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { createAnthropicExtractor } from '../ai/anthropic-extractor.js';
import type { DocumentExtractor } from '../ai/document-extractor.js';
import { systemClock, type Clock } from '../core/clock.js';
import type { Config } from '../core/config.js';
import { ValidationError } from '../core/errors.js';
import { newId } from '../core/id.js';
import { loggerOptions } from '../core/logger.js';
import type { DbHandle } from '../db/client.js';
import { accountsRoutes } from '../modules/accounts/accounts.routes.js';
import { allocationRoutes } from '../modules/allocation/allocation.routes.js';
import { authRoutes } from '../modules/auth/auth.routes.js';
import { budgetRoutes } from '../modules/budget/budget.routes.js';
import { categoriesRoutes } from '../modules/categories/categories.routes.js';
import { createDocumentJobs, type DocumentJobs } from '../modules/documents/documents.jobs.js';
import { documentsRoutes } from '../modules/documents/documents.routes.js';
import { goalsRoutes } from '../modules/goals/goals.routes.js';
import { incomeSourcesRoutes } from '../modules/income-sources/income-sources.routes.js';
import { monthsRoutes } from '../modules/months/months.routes.js';
import { plannedExpensesRoutes } from '../modules/planned-expenses/planned-expenses.routes.js';
import { liabilitiesRoutes } from '../modules/liabilities/liabilities.routes.js';
import { recurringRoutes } from '../modules/recurring/recurring.routes.js';
import { settingsRoutes } from '../modules/settings/settings.routes.js';
import { transactionsRoutes } from '../modules/transactions/transactions.routes.js';
import { registerErrorHandler } from './error-handler.js';
import { healthRoutes } from './health.routes.js';
import { registerCsrfGuard } from './middleware/csrf.js';
import { registerSecurity } from './plugins/security.js';
import { registerSpa } from './spa.js';

/**
 * Budowa instancji Fastify i kompozycja modułów.
 *
 * To jest jedyne miejsce, w którym zależności są składane w całość — bez kontenera DI,
 * za to z jawnym grafem ([02 §5](../../../../plans/02-architecture.md#5-serwisy--wstrzykiwanie-zależności)).
 *
 * Serwer jest budowany **bez nasłuchu**: `buildServer` zwraca instancję, a `listen`
 * woła dopiero `index.ts`. Dzięki temu testy używają `app.inject()` i nie zajmują portu
 * ([02 §9](../../../../plans/02-architecture.md)).
 */

/** Bazowy prefiks wszystkich tras API ([04](../../../../plans/04-api-spec.md)). */
export const API_PREFIX = '/api/v1';

/** Zależności serwera. */
export interface ServerDeps {
  readonly config: Config;
  readonly db: DbHandle;
  /** Wersja aplikacji zwracana przez `/health`. */
  readonly version: string;
  /** Źródło czasu; testy podstawiają zegar zatrzymany. */
  readonly clock?: Clock;
  /**
   * Ekstraktor dokumentów; testy podstawiają atrapę. Pominięty — Anthropic przy
   * `AI_ENABLED=true`, brak przy `false`.
   */
  readonly extractor?: DocumentExtractor | null;
  /** Rejestr analiz w tle; testy czekają na nim, aż analiza się skończy. */
  readonly documentJobs?: DocumentJobs;
}

/**
 * Buduje instancję Fastify z kompletem wtyczek i tras.
 *
 * @param deps - Zależności serwera.
 * @returns Gotowa instancja, jeszcze bez nasłuchu.
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, db, version, clock = systemClock } = deps;
  const extractor =
    deps.extractor === undefined
      ? config.ai.enabled
        ? createAnthropicExtractor(config.ai)
        : null
      : deps.extractor;
  const documentJobs = deps.documentJobs ?? createDocumentJobs();
  const startedAt = Date.now();

  const app = Fastify({
    // Fastify buduje pino sam z podanych opcji. Przekazanie gotowej instancji
    // (`loggerInstance`) parametryzuje typ instancji konkretnym loggerem i psuje
    // zgodność wszystkiego, co przyjmuje `FastifyInstance`.
    logger: loggerOptions(config),
    // Identyfikator żądania jest tym samym ULID-em, co klucze główne — jeden format
    // w logach i w odpowiedziach błędów ułatwia szukanie.
    genReqId: () => newId(),
    requestIdHeader: 'x-request-id',
    // Za reverse proxy (Caddy/nginx) bez tego limit prób logowania widziałby jeden
    // adres IP dla wszystkich ([10 §…](../../../../plans/10-deployment.md)).
    trustProxy: config.isProduction,
    disableRequestLogging: false,
  });

  // Walidacja wejścia i serializacja odpowiedzi przez te same schematy Zod, które
  // idą do frontu. Serializer działa jako lista dozwoleń: pole spoza schematu
  // odpowiedzi nie wyjdzie na zewnątrz.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Puste ciało przy `Content-Type: application/json` Fastify odrzuca komunikatem
  // „Body cannot be empty". Trasy takie jak `/auth/refresh` i `/auth/logout` ciała
  // nie mają, a wiele klientów HTTP ustawia ten nagłówek odruchowo — użytkownik
  // zobaczyłby wtedy „Żądanie zawiera nieprawidłowe dane" zamiast odnowionej sesji.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body: string, done) => {
      if (body.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch {
        // Goły `SyntaxError` nie niesie statusu, więc obsługa błędów potraktowałaby go
        // jak awarię serwera i odpowiedziała `500` na cudzą literówkę w JSON-ie.
        done(new ValidationError('Ciało żądania nie jest poprawnym JSON-em.'), undefined);
      }
    },
  );

  await registerSecurity(app, config);
  const spa = config.web.distPath !== null;
  registerErrorHandler(app, { spa });
  registerCsrfGuard(app);

  // Każda odpowiedź niesie `X-Request-Id` ([04 §1](../../../../plans/04-api-spec.md#1-zasady-ogólne)).
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });

  await app.register(healthRoutes, {
    prefix: `${API_PREFIX}/health`,
    db,
    version,
    startedAt,
  });

  await app.register(authRoutes, { prefix: `${API_PREFIX}/auth`, db, config, clock });
  await app.register(accountsRoutes, { prefix: `${API_PREFIX}/accounts`, db, config, clock });
  await app.register(categoriesRoutes, {
    prefix: `${API_PREFIX}/categories`,
    db,
    config,
    clock,
  });
  await app.register(incomeSourcesRoutes, {
    prefix: `${API_PREFIX}/income-sources`,
    db,
    config,
    clock,
  });
  await app.register(transactionsRoutes, {
    prefix: `${API_PREFIX}/transactions`,
    db,
    config,
    clock,
  });
  await app.register(monthsRoutes, { prefix: `${API_PREFIX}/months`, db, config, clock });
  await app.register(recurringRoutes, {
    prefix: `${API_PREFIX}/recurring`,
    db,
    config,
    clock,
  });
  await app.register(liabilitiesRoutes, {
    prefix: `${API_PREFIX}/liabilities`,
    db,
    config,
    clock,
  });
  await app.register(goalsRoutes, { prefix: `${API_PREFIX}/goals`, db, config, clock });
  await app.register(plannedExpensesRoutes, {
    prefix: `${API_PREFIX}/planned-expenses`,
    db,
    config,
    clock,
  });
  await app.register(budgetRoutes, { prefix: `${API_PREFIX}/budget-drafts`, db, config, clock });
  await app.register(allocationRoutes, {
    prefix: `${API_PREFIX}/allocation`,
    db,
    config,
    clock,
  });
  await app.register(documentsRoutes, {
    prefix: `${API_PREFIX}/documents`,
    db,
    config,
    clock,
    extractor,
    jobs: documentJobs,
  });
  await app.register(settingsRoutes, {
    prefix: `${API_PREFIX}/settings`,
    db,
    config,
    clock,
    version,
  });

  // Front na końcu: jego pliki nie mogą przesłonić żadnej trasy API.
  if (config.web.distPath !== null) await registerSpa(app, config.web.distPath);

  // Zamknięcie serwera czeka na rozpoczęte analizy — inaczej restart zostawiłby dokument
  // w `processing` do czasu sprzątania przy kolejnym starcie.
  app.addHook('onClose', async () => {
    await documentJobs.idle();
  });

  return app;
}
