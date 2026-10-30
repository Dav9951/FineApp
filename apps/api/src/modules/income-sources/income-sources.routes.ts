import {
  apiResponse,
  CreateIncomeSourceRequestSchema,
  IdSchema,
  IncomeSourceDtoSchema,
  ListIncomeSourcesQuerySchema,
  UpdateIncomeSourceRequestSchema,
} from '@fineapp/shared';
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import {
  createIncomeSource,
  deleteIncomeSource,
  listIncomeSources,
  setIncomeSourceArchived,
  updateIncomeSource,
} from './income-sources.service.js';

/**
 * Trasy źródeł przychodu — `/api/v1/income-sources`
 * ([04 §12](../../../../../../plans/04-api-spec.md#12-źródła-przychodu--apiv1income-sources)).
 *
 * `householdId` wyłącznie z tokenu. `GET /income-sources/summary` należy do raportu
 * miesiąca i dochodzi w Fazie 3 (ADR-034).
 */

/** Parametr ścieżki z identyfikatorem źródła. */
const IncomeSourceParamsSchema = z.object({ id: IdSchema });

/**
 * Rejestruje trasy źródeł przychodu.
 *
 * Każda trasa wymaga zalogowania; `requireAuth` per trasa w fazie `onRequest`
 * (ADR-027, ADR-031).
 *
 * @param app - Instancja Fastify z type providerem Zod.
 * @param options - Zależności modułu.
 * @param options.db - Uchwyt bazy.
 * @param options.config - Konfiguracja aplikacji.
 * @param options.clock - Źródło czasu.
 * @param done - Sygnał zakończenia rejestracji.
 */
export const incomeSourcesRoutes: FastifyPluginCallbackZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
}> = (app, options, done) => {
  const { db, clock } = options;
  const protectedRoute = { onRequest: requireAuth(options.config, clock) };

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/',
    schema: {
      querystring: ListIncomeSourcesQuerySchema,
      response: { 200: apiResponse(IncomeSourceDtoSchema.array()) },
    },
    handler: (request) => ({
      data: listIncomeSources(db, authContext(request).householdId, request.query),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/',
    schema: {
      body: CreateIncomeSourceRequestSchema,
      response: { 201: apiResponse(IncomeSourceDtoSchema) },
    },
    handler: (request, reply) => {
      const source = createIncomeSource(db, clock, authContext(request).householdId, request.body);
      const collection = (request.url.split('?')[0] ?? '').replace(/\/$/, '');
      void reply.status(201).header('location', `${collection}/${source.id}`);
      return { data: source };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:id',
    schema: {
      params: IncomeSourceParamsSchema,
      body: UpdateIncomeSourceRequestSchema,
      response: { 200: apiResponse(IncomeSourceDtoSchema) },
    },
    handler: (request) => ({
      data: updateIncomeSource(
        db,
        clock,
        authContext(request).householdId,
        request.params.id,
        request.body,
      ),
    }),
  });

  for (const [url, archived] of [
    ['/:id/archive', true],
    ['/:id/unarchive', false],
  ] as const) {
    app.route({
      ...protectedRoute,
      method: 'POST',
      url,
      schema: {
        params: IncomeSourceParamsSchema,
        response: { 200: apiResponse(IncomeSourceDtoSchema) },
      },
      handler: (request) => ({
        data: setIncomeSourceArchived(
          db,
          clock,
          authContext(request).householdId,
          request.params.id,
          archived,
        ),
      }),
    });
  }

  app.route({
    ...protectedRoute,
    method: 'DELETE',
    url: '/:id',
    schema: { params: IncomeSourceParamsSchema },
    handler: async (request, reply) => {
      deleteIncomeSource(db, authContext(request).householdId, request.params.id);
      await reply.status(204).send();
    },
  });

  done();
};
