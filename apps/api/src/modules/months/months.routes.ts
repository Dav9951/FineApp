import {
  apiResponse,
  MonthCategoriesDtoSchema,
  MonthParamsSchema,
  MonthsAvailableDtoSchema,
  MonthSummaryDtoSchema,
} from '@fineapp/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import { getAvailableMonths, getMonthCategories, getMonthSummary } from './months.service.js';

/**
 * Trasy ekranu miesiąca — `/api/v1/months`
 * ([04 §14](../../../../../../plans/04-api-spec.md#14-miesiąc--apiv1months)).
 *
 * `householdId` wyłącznie z tokenu. `GET /months/compare` czeka na wykres trendu —
 * dziś nie ma odbiorcy (ADR-039).
 */

/**
 * Rejestruje trasy ekranu miesiąca.
 *
 * `/available` jest zarejestrowane obok `/:monthKey/...`, a nie pod `/:monthKey`, więc
 * napis „available" nigdy nie trafi do walidacji klucza miesiąca.
 *
 * @param app - Instancja Fastify z type providerem Zod.
 * @param options - Zależności modułu.
 * @param options.db - Uchwyt bazy.
 * @param options.config - Konfiguracja aplikacji.
 * @param options.clock - Źródło czasu.
 * @param done - Sygnał zakończenia rejestracji.
 */
export const monthsRoutes: FastifyPluginCallbackZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
}> = (app, options, done) => {
  const { db, clock } = options;
  const protectedRoute = { onRequest: requireAuth(options.config, clock) };

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/available',
    schema: { response: { 200: apiResponse(MonthsAvailableDtoSchema) } },
    handler: (request) => ({
      data: getAvailableMonths(db, clock, authContext(request).householdId),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/:monthKey/summary',
    schema: {
      params: MonthParamsSchema,
      response: { 200: apiResponse(MonthSummaryDtoSchema) },
    },
    handler: (request) => {
      const { householdId, userId } = authContext(request);
      return { data: getMonthSummary(db, clock, householdId, userId, request.params.monthKey) };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/:monthKey/categories',
    schema: {
      params: MonthParamsSchema,
      response: { 200: apiResponse(MonthCategoriesDtoSchema) },
    },
    handler: (request) => ({
      data: getMonthCategories(db, authContext(request).householdId, request.params.monthKey),
    }),
  });

  done();
};
