import {
  apiResponse,
  ConvertContributionRequestSchema,
  ConvertContributionResponseSchema,
  GoalContributionRequestSchema,
  GoalContributionResultDtoSchema,
  GoalDetailDtoSchema,
  GoalDtoSchema,
  GoalFieldsSchema,
  GoalMutationMetaSchema,
  GoalsListMetaSchema,
  IdempotencyKeySchema,
  IdSchema,
  ListGoalsQuerySchema,
  ReorderGoalsRequestSchema,
  UpdateGoalRequestSchema,
} from '@fineapp/shared';
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import { runIdempotent } from '../idempotency/idempotency.service.js';
import {
  completeGoal,
  contributeToGoal,
  convertContribution,
  createGoal,
  deleteGoal,
  getGoal,
  listGoals,
  reorderGoals,
  updateGoal,
} from './goals.service.js';

/**
 * Trasy celów — `/api/v1/goals`
 * ([04 §10](../../../../../../plans/04-api-spec.md#10-cele--apiv1goals), `F5-1`, `F5-2`).
 *
 * Ciało `POST` to pola **bez** walidacji krzyżowej — reguły między polami (I-14) sprawdza
 * serwis i odpowiada `422` (ADR-035). Wpłata na cel wymaga `Idempotency-Key`, jak rata
 * i księgowanie wystąpienia (ADR-046). Trasy stałe (`/convert`, `/order`) są rejestrowane
 * obok `/:id` — Fastify dopasowuje najpierw ścieżki statyczne.
 */

/** Parametr ścieżki z identyfikatorem celu. */
const GoalParamsSchema = z.object({ id: IdSchema });

/** Nagłówki wpłaty: wymagany klucz idempotencji. `passthrough` jak w transakcjach. */
const ContributionHeadersSchema = z
  .object({ 'idempotency-key': IdempotencyKeySchema })
  .passthrough();

/**
 * Rejestruje trasy celów.
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
export const goalsRoutes: FastifyPluginCallbackZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
}> = (app, options, done) => {
  const { db, clock } = options;
  const protectedRoute = { onRequest: requireAuth(options.config, clock) };
  const goalResponse = { 200: apiResponse(GoalDtoSchema) };

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/',
    schema: {
      querystring: ListGoalsQuerySchema,
      response: { 200: apiResponse(GoalDtoSchema.array(), GoalsListMetaSchema) },
    },
    handler: (request) => listGoals(db, clock, authContext(request).householdId, request.query),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/',
    schema: {
      body: GoalFieldsSchema,
      response: { 201: apiResponse(GoalDtoSchema) },
    },
    handler: (request, reply) => {
      const data = createGoal(db, clock, authContext(request).householdId, request.body);
      const collection = (request.url.split('?')[0] ?? '').replace(/\/$/, '');
      void reply.status(201).header('location', `${collection}/${data.id}`);
      return { data };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/convert',
    schema: {
      body: ConvertContributionRequestSchema,
      response: { 200: apiResponse(ConvertContributionResponseSchema) },
    },
    handler: (request) => ({
      data: convertContribution(db, clock, authContext(request).householdId, request.body),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/order',
    schema: {
      body: ReorderGoalsRequestSchema,
      response: { 200: apiResponse(GoalDtoSchema.array()) },
    },
    handler: (request) => ({
      data: reorderGoals(db, clock, authContext(request).householdId, request.body),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/:id',
    schema: {
      params: GoalParamsSchema,
      response: { 200: apiResponse(GoalDetailDtoSchema) },
    },
    handler: (request) => ({
      data: getGoal(db, clock, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:id',
    schema: {
      params: GoalParamsSchema,
      body: UpdateGoalRequestSchema,
      response: goalResponse,
    },
    handler: (request) => ({
      data: updateGoal(
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
    schema: { params: GoalParamsSchema },
    handler: async (request, reply) => {
      deleteGoal(db, authContext(request).householdId, request.params.id);
      await reply.status(204).send();
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/complete',
    schema: { params: GoalParamsSchema, response: goalResponse },
    handler: (request) => ({
      data: completeGoal(db, clock, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/contributions',
    schema: {
      params: GoalParamsSchema,
      headers: ContributionHeadersSchema,
      body: GoalContributionRequestSchema,
      response: {
        201: apiResponse(GoalContributionResultDtoSchema, GoalMutationMetaSchema),
      },
    },
    handler: (request, reply) => {
      const { householdId, userId } = authContext(request);
      const { id } = request.params;
      const result = runIdempotent(
        db,
        clock,
        householdId,
        `POST /goals/${id}/contributions`,
        request.headers['idempotency-key'],
        request.body,
        () => ({
          statusCode: 201,
          body: contributeToGoal(db, clock, householdId, userId, id, request.body),
        }),
      );
      void reply.status(201);
      if (result.replayed) void reply.header('idempotent-replayed', 'true');
      return result.body;
    },
  });

  done();
};
