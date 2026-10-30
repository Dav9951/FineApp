import {
  AllocationMonthQuerySchema,
  AllocationStatusDtoSchema,
  AllocationTargetDtoSchema,
  AllocationTargetMetaSchema,
  AllocationTrendQuerySchema,
  apiResponse,
  UpsertAllocationTargetRequestSchema,
} from '@fineapp/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import {
  getAllocationStatus,
  getAllocationTarget,
  getAllocationTrend,
  listAllocationHistory,
  upsertAllocationTarget,
} from './allocation.service.js';

/**
 * Trasy rozkładu docelowego — `/api/v1/allocation`
 * ([04 §11](../../../../../../plans/04-api-spec.md#11-rozkład-docelowy--apiv1allocation),
 * `F5-3`, `F5-4`).
 */

/**
 * Rejestruje trasy rozkładu docelowego.
 *
 * Każda trasa wymaga zalogowania; `requireAuth` per trasa w fazie `onRequest` (ADR-027).
 *
 * @param app - Instancja Fastify z type providerem Zod.
 * @param options - Zależności modułu.
 * @param options.db - Uchwyt bazy.
 * @param options.config - Konfiguracja aplikacji.
 * @param options.clock - Źródło czasu.
 * @param done - Sygnał zakończenia rejestracji.
 */
export const allocationRoutes: FastifyPluginCallbackZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
}> = (app, options, done) => {
  const { db, clock } = options;
  const protectedRoute = { onRequest: requireAuth(options.config, clock) };

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/target',
    schema: {
      querystring: AllocationMonthQuerySchema,
      response: { 200: apiResponse(AllocationTargetDtoSchema.nullable()) },
    },
    handler: (request) => ({
      data: getAllocationTarget(db, clock, authContext(request).householdId, request.query),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PUT',
    url: '/target',
    schema: {
      body: UpsertAllocationTargetRequestSchema,
      response: { 200: apiResponse(AllocationTargetDtoSchema, AllocationTargetMetaSchema) },
    },
    handler: (request) =>
      upsertAllocationTarget(db, clock, authContext(request).householdId, request.body),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/history',
    schema: { response: { 200: apiResponse(AllocationTargetDtoSchema.array()) } },
    handler: (request) => ({
      data: listAllocationHistory(db, authContext(request).householdId),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/status',
    schema: {
      querystring: AllocationMonthQuerySchema,
      response: { 200: apiResponse(AllocationStatusDtoSchema) },
    },
    handler: (request) => ({
      data: getAllocationStatus(db, clock, authContext(request).householdId, request.query.month),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/trend',
    schema: {
      querystring: AllocationTrendQuerySchema,
      response: { 200: apiResponse(AllocationStatusDtoSchema.array()) },
    },
    handler: (request) => ({
      data: getAllocationTrend(db, clock, authContext(request).householdId, request.query),
    }),
  });

  done();
};
