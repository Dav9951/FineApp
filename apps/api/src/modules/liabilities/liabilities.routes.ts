import {
  apiResponse,
  IdempotencyKeySchema,
  IdSchema,
  LiabilityDetailDtoSchema,
  LiabilityDtoSchema,
  LiabilityFieldsSchema,
  LiabilityMutationMetaSchema,
  LiabilityPaymentRequestSchema,
  LiabilityPaymentResultDtoSchema,
  ListLiabilitiesQuerySchema,
  RebaseLiabilityRequestSchema,
  ScheduledInstallmentDtoSchema,
  UpdateLiabilityRequestSchema,
} from '@fineapp/shared';
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import { runIdempotent } from '../idempotency/idempotency.service.js';
import {
  createLiability,
  deleteLiability,
  getLiability,
  getLiabilitySchedule,
  listLiabilities,
  rebaseLiability,
  recordLiabilityPayment,
  updateLiability,
} from './liabilities.service.js';

/**
 * Trasy zobowiązań — `/api/v1/liabilities`
 * ([04 §8](../../../../../../plans/04-api-spec.md#8-zobowiązania--apiv1liabilities), `F4-4`).
 *
 * Ciało `POST` to pola **bez** walidacji krzyżowej — reguły między polami sprawdza serwis
 * i odpowiada `422` (ADR-035). Księgowanie raty wymaga `Idempotency-Key`, jak księgowanie
 * wystąpienia (ADR-046).
 */

/** Parametr ścieżki z identyfikatorem zobowiązania. */
const LiabilityParamsSchema = z.object({ id: IdSchema });

/** Nagłówki księgowania raty: wymagany klucz idempotencji. `passthrough` jak w transakcjach. */
const PaymentHeadersSchema = z.object({ 'idempotency-key': IdempotencyKeySchema }).passthrough();

/**
 * Rejestruje trasy zobowiązań.
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
export const liabilitiesRoutes: FastifyPluginCallbackZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
}> = (app, options, done) => {
  const { db, clock } = options;
  const protectedRoute = { onRequest: requireAuth(options.config, clock) };
  const liabilityResponse = { 200: apiResponse(LiabilityDtoSchema) };

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/',
    schema: {
      querystring: ListLiabilitiesQuerySchema,
      response: { 200: apiResponse(LiabilityDtoSchema.array()) },
    },
    handler: (request) => ({
      data: listLiabilities(db, clock, authContext(request).householdId, request.query),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/',
    schema: {
      body: LiabilityFieldsSchema,
      response: { 201: apiResponse(LiabilityDtoSchema) },
    },
    handler: (request, reply) => {
      const data = createLiability(db, clock, authContext(request).householdId, request.body);
      const collection = (request.url.split('?')[0] ?? '').replace(/\/$/, '');
      void reply.status(201).header('location', `${collection}/${data.id}`);
      return { data };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/:id',
    schema: {
      params: LiabilityParamsSchema,
      response: { 200: apiResponse(LiabilityDetailDtoSchema) },
    },
    handler: (request) => ({
      data: getLiability(db, clock, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:id',
    schema: {
      params: LiabilityParamsSchema,
      body: UpdateLiabilityRequestSchema,
      response: liabilityResponse,
    },
    handler: (request) => ({
      data: updateLiability(
        db,
        clock,
        authContext(request).householdId,
        request.params.id,
        request.body,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'DELETE',
    url: '/:id',
    schema: { params: LiabilityParamsSchema },
    handler: async (request, reply) => {
      deleteLiability(db, clock, authContext(request).householdId, request.params.id);
      await reply.status(204).send();
    },
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/:id/schedule',
    schema: {
      params: LiabilityParamsSchema,
      response: { 200: apiResponse(ScheduledInstallmentDtoSchema.array()) },
    },
    handler: (request) => ({
      data: getLiabilitySchedule(db, clock, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/rebase',
    schema: {
      params: LiabilityParamsSchema,
      body: RebaseLiabilityRequestSchema,
      response: liabilityResponse,
    },
    handler: (request) => ({
      data: rebaseLiability(
        db,
        clock,
        authContext(request).householdId,
        request.params.id,
        request.body,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/payments',
    schema: {
      params: LiabilityParamsSchema,
      headers: PaymentHeadersSchema,
      body: LiabilityPaymentRequestSchema.nullish(),
      response: {
        201: apiResponse(LiabilityPaymentResultDtoSchema, LiabilityMutationMetaSchema),
      },
    },
    handler: (request, reply) => {
      const { householdId, userId } = authContext(request);
      const { id } = request.params;
      // Puste ciało to „rata jak w warunkach" — ten sam odcisk co `{}`.
      const body = request.body ?? {};
      const result = runIdempotent(
        db,
        clock,
        householdId,
        `POST /liabilities/${id}/payments`,
        request.headers['idempotency-key'],
        body,
        () => ({
          statusCode: 201,
          body: recordLiabilityPayment(db, clock, householdId, userId, id, body),
        }),
      );
      void reply.status(201);
      if (result.replayed) void reply.header('idempotent-replayed', 'true');
      return result.body;
    },
  });

  done();
};
