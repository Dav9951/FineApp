import {
  apiResponse,
  GenerateOccurrencesRequestSchema,
  GenerateOccurrencesResultDtoSchema,
  IdempotencyKeySchema,
  IdSchema,
  ListOccurrencesQuerySchema,
  ListRecurringRulesQuerySchema,
  OccurrenceMutationMetaSchema,
  OccurrenceParamsSchema,
  PostOccurrenceRequestSchema,
  PostOccurrenceResultDtoSchema,
  RecurringOccurrenceDtoSchema,
  RecurringOccurrencesMetaSchema,
  RecurringRuleDetailDtoSchema,
  RecurringRuleDtoSchema,
  RecurringRuleFieldsSchema,
  SkipOccurrenceRequestSchema,
  UpdateRecurringRuleRequestSchema,
} from '@fineapp/shared';
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import { runIdempotent } from '../idempotency/idempotency.service.js';
import {
  createRecurringRule,
  deleteRecurringRule,
  generateOccurrences,
  getRecurringRule,
  listOccurrences,
  listRecurringRules,
  postOccurrence,
  setRecurringRuleActive,
  skipOccurrence,
  unpostOccurrence,
  updateRecurringRule,
} from './recurring.service.js';

/**
 * Trasy pozycji cyklicznych — `/api/v1/recurring`
 * ([04 §9](../../../../../../plans/04-api-spec.md#9-pozycje-cykliczne--apiv1recurring)).
 *
 * Reguły od `F4-1`; lista wystąpień i wymuszenie generacji od `F4-2`, księgowanie,
 * pomijanie i cofanie (`/occurrences/:id/...`) od `F4-3`. Księgowanie **wymaga**
 * nagłówka `Idempotency-Key` (04 §9) — to jedyna operacja tworząca pieniądze w księdze
 * jednym dotknięciem z listy, najczęściej na telefonie w słabym zasięgu.
 * Ciało `POST` to pola **bez** walidacji krzyżowej — kształt i terminarz sprawdza serwis
 * i odpowiada `422` (jak przy transakcjach, ADR-035).
 */

/** Parametr ścieżki z identyfikatorem reguły. */
const RuleParamsSchema = z.object({ id: IdSchema });

/**
 * Nagłówki księgowania: wymagany klucz idempotencji (04 §9). `passthrough`, bo Fastify
 * podmienia `request.headers` na wynik walidacji (jak przy `POST /transactions`).
 */
const PostHeadersSchema = z.object({ 'idempotency-key': IdempotencyKeySchema }).passthrough();

/**
 * Rejestruje trasy pozycji cyklicznych.
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
export const recurringRoutes: FastifyPluginCallbackZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
}> = (app, options, done) => {
  const { db, clock } = options;
  const protectedRoute = { onRequest: requireAuth(options.config, clock) };
  const ruleResponse = { 200: apiResponse(RecurringRuleDtoSchema) };

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/rules',
    schema: {
      querystring: ListRecurringRulesQuerySchema,
      response: { 200: apiResponse(RecurringRuleDtoSchema.array()) },
    },
    handler: (request) => ({
      data: listRecurringRules(db, clock, authContext(request).householdId, request.query),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/rules',
    schema: {
      body: RecurringRuleFieldsSchema,
      response: { 201: apiResponse(RecurringRuleDtoSchema) },
    },
    handler: (request, reply) => {
      const data = createRecurringRule(db, clock, authContext(request).householdId, request.body);
      const collection = (request.url.split('?')[0] ?? '').replace(/\/$/, '');
      void reply.status(201).header('location', `${collection}/${data.id}`);
      return { data };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/rules/:id',
    schema: {
      params: RuleParamsSchema,
      response: { 200: apiResponse(RecurringRuleDetailDtoSchema) },
    },
    handler: (request) => ({
      data: getRecurringRule(db, clock, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/rules/:id',
    schema: {
      params: RuleParamsSchema,
      body: UpdateRecurringRuleRequestSchema,
      response: ruleResponse,
    },
    handler: (request) => ({
      data: updateRecurringRule(
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
    url: '/rules/:id',
    schema: { params: RuleParamsSchema },
    handler: async (request, reply) => {
      deleteRecurringRule(db, authContext(request).householdId, request.params.id);
      await reply.status(204).send();
    },
  });

  for (const [action, isActive] of [
    ['pause', false],
    ['resume', true],
  ] as const) {
    app.route({
      ...protectedRoute,
      method: 'POST',
      url: `/rules/:id/${action}`,
      schema: { params: RuleParamsSchema, response: ruleResponse },
      handler: (request) => ({
        data: setRecurringRuleActive(
          db,
          clock,
          authContext(request).householdId,
          request.params.id,
          isActive,
        ),
      }),
    });
  }

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/occurrences',
    schema: {
      querystring: ListOccurrencesQuerySchema,
      response: {
        200: apiResponse(RecurringOccurrenceDtoSchema.array(), RecurringOccurrencesMetaSchema),
      },
    },
    handler: (request) => {
      const { householdId, userId } = authContext(request);
      return listOccurrences(db, clock, householdId, userId, request.query.month);
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/generate',
    schema: {
      body: GenerateOccurrencesRequestSchema,
      response: { 200: apiResponse(GenerateOccurrencesResultDtoSchema) },
    },
    handler: (request) => {
      const { householdId, userId } = authContext(request);
      return { data: generateOccurrences(db, clock, householdId, userId, request.body.month) };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/occurrences/:id/post',
    schema: {
      params: OccurrenceParamsSchema,
      headers: PostHeadersSchema,
      body: PostOccurrenceRequestSchema.nullish(),
      response: {
        201: apiResponse(PostOccurrenceResultDtoSchema, OccurrenceMutationMetaSchema),
      },
    },
    handler: (request, reply) => {
      const { householdId, userId } = authContext(request);
      const { id } = request.params;
      // Puste ciało to „zaksięguj jak w planie" — ten sam odcisk co `{}`.
      const body = request.body ?? {};
      // Zakres z identyfikatorem: ten sam klucz przy innym wystąpieniu to inna operacja.
      const result = runIdempotent(
        db,
        clock,
        householdId,
        `POST /recurring/occurrences/${id}/post`,
        request.headers['idempotency-key'],
        body,
        () => ({
          statusCode: 201,
          body: postOccurrence(db, clock, householdId, userId, id, body),
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
    url: '/occurrences/:id/skip',
    schema: {
      params: OccurrenceParamsSchema,
      body: SkipOccurrenceRequestSchema.nullish(),
      response: { 200: apiResponse(RecurringOccurrenceDtoSchema) },
    },
    handler: (request) => ({
      data: skipOccurrence(
        db,
        clock,
        authContext(request).householdId,
        request.params.id,
        request.body ?? { reason: null },
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/occurrences/:id/unpost',
    schema: {
      params: OccurrenceParamsSchema,
      response: {
        200: apiResponse(RecurringOccurrenceDtoSchema, OccurrenceMutationMetaSchema),
      },
    },
    handler: (request) =>
      unpostOccurrence(db, clock, authContext(request).householdId, request.params.id),
  });

  done();
};
