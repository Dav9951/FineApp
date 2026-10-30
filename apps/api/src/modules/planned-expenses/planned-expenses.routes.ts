import {
  apiResponse,
  DeferPlannedExpenseRequestSchema,
  IdempotencyKeySchema,
  IdSchema,
  ListPlannedExpensesQuerySchema,
  PlannedExpenseDetailDtoSchema,
  PlannedExpenseDtoSchema,
  PlannedExpenseFieldsSchema,
  PlannedExpenseMutationMetaSchema,
  PostPlannedExpenseRequestSchema,
  PostPlannedExpenseResultDtoSchema,
  SetAsideContributionRequestSchema,
  SetAsideResultDtoSchema,
  UpcomingExpensesMetaSchema,
  UpcomingPlannedExpensesQuerySchema,
  UpdatePlannedExpenseRequestSchema,
} from '@fineapp/shared';
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import { runIdempotent } from '../idempotency/idempotency.service.js';
import {
  cancelPlannedExpense,
  createPlannedExpense,
  deferPlannedExpense,
  deletePlannedExpense,
  getPlannedExpense,
  listPlannedExpenses,
  postPlannedExpense,
  setAsideForPlannedExpense,
  upcomingPlannedExpenses,
  updatePlannedExpense,
} from './planned-expenses.service.js';

/**
 * Trasy planowanych wydatków — `/api/v1/planned-expenses`
 * ([04 §9a](../../../../../../plans/04-api-spec.md#9a-planowane-wydatki--apiv1planned-expenses),
 * `F6-1`…`F6-5`).
 *
 * Ciało `POST` to pola bez walidacji krzyżowej (ADR-035). Wpłata na odkładanie i zapłata
 * wymagają `Idempotency-Key` (ADR-046) — obie tworzą transakcję.
 */

/** Parametr ścieżki z identyfikatorem wydatku. */
const ParamsSchema = z.object({ id: IdSchema });

/** Nagłówki z wymaganym kluczem idempotencji. */
const IdempotentHeadersSchema = z.object({ 'idempotency-key': IdempotencyKeySchema }).passthrough();

/**
 * Rejestruje trasy planowanych wydatków.
 *
 * @param app - Instancja Fastify z type providerem Zod.
 * @param options - Zależności modułu.
 * @param options.db - Uchwyt bazy.
 * @param options.config - Konfiguracja aplikacji.
 * @param options.clock - Źródło czasu.
 * @param done - Sygnał zakończenia rejestracji.
 */
export const plannedExpensesRoutes: FastifyPluginCallbackZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
}> = (app, options, done) => {
  const { db, clock } = options;
  const protectedRoute = { onRequest: requireAuth(options.config, clock) };
  const expenseResponse = { 200: apiResponse(PlannedExpenseDtoSchema) };

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/',
    schema: {
      querystring: ListPlannedExpensesQuerySchema,
      response: { 200: apiResponse(PlannedExpenseDtoSchema.array()) },
    },
    handler: (request) => ({
      data: listPlannedExpenses(db, clock, authContext(request).householdId, request.query),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/upcoming',
    schema: {
      querystring: UpcomingPlannedExpensesQuerySchema,
      response: {
        200: apiResponse(PlannedExpenseDtoSchema.array(), UpcomingExpensesMetaSchema),
      },
    },
    handler: (request) =>
      upcomingPlannedExpenses(db, clock, authContext(request).householdId, request.query.months),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/',
    schema: {
      body: PlannedExpenseFieldsSchema,
      response: { 201: apiResponse(PlannedExpenseDtoSchema) },
    },
    handler: (request, reply) => {
      const data = createPlannedExpense(db, clock, authContext(request).householdId, request.body);
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
      params: ParamsSchema,
      response: { 200: apiResponse(PlannedExpenseDetailDtoSchema) },
    },
    handler: (request) => ({
      data: getPlannedExpense(db, clock, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:id',
    schema: {
      params: ParamsSchema,
      body: UpdatePlannedExpenseRequestSchema,
      response: expenseResponse,
    },
    handler: (request) => ({
      data: updatePlannedExpense(
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
    schema: { params: ParamsSchema },
    handler: async (request, reply) => {
      deletePlannedExpense(db, authContext(request).householdId, request.params.id);
      await reply.status(204).send();
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/defer',
    schema: {
      params: ParamsSchema,
      body: DeferPlannedExpenseRequestSchema,
      response: expenseResponse,
    },
    handler: (request) => ({
      data: deferPlannedExpense(
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
    url: '/:id/cancel',
    schema: { params: ParamsSchema, response: expenseResponse },
    handler: (request) => ({
      data: cancelPlannedExpense(db, clock, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/set-aside',
    schema: {
      params: ParamsSchema,
      headers: IdempotentHeadersSchema,
      body: SetAsideContributionRequestSchema.nullish(),
      response: { 201: apiResponse(SetAsideResultDtoSchema, PlannedExpenseMutationMetaSchema) },
    },
    handler: (request, reply) => {
      const { householdId, userId } = authContext(request);
      const { id } = request.params;
      // Puste ciało to „rata wyliczona, dziś" — ten sam odcisk co `{}`.
      const body = request.body ?? {};
      const result = runIdempotent(
        db,
        clock,
        householdId,
        `POST /planned-expenses/${id}/set-aside`,
        request.headers['idempotency-key'],
        body,
        () => ({
          statusCode: 201,
          body: setAsideForPlannedExpense(db, clock, householdId, userId, id, body),
        }),
      );
      void reply.status(201);
      if (result.replayed) void reply.header('idempotent-replayed', 'true');
      return result.body;
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/post',
    schema: {
      params: ParamsSchema,
      headers: IdempotentHeadersSchema,
      body: PostPlannedExpenseRequestSchema.nullish(),
      response: {
        201: apiResponse(PostPlannedExpenseResultDtoSchema, PlannedExpenseMutationMetaSchema),
      },
    },
    handler: (request, reply) => {
      const { householdId, userId } = authContext(request);
      const { id } = request.params;
      const body = request.body ?? {};
      const result = runIdempotent(
        db,
        clock,
        householdId,
        `POST /planned-expenses/${id}/post`,
        request.headers['idempotency-key'],
        body,
        () => ({
          statusCode: 201,
          body: postPlannedExpense(db, clock, householdId, userId, id, body),
        }),
      );
      void reply.status(201);
      if (result.replayed) void reply.header('idempotent-replayed', 'true');
      return result.body;
    },
  });

  done();
};
