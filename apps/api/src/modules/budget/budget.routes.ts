import {
  apiResponse,
  ApplyToSourceResultSchema,
  BudgetDraftDtoSchema,
  BudgetDraftListDtoSchema,
  BudgetGroupParamsSchema,
  BudgetLineParamsSchema,
  CategoryAveragesDtoSchema,
  CategoryAveragesQuerySchema,
  CreateBudgetDraftRequestSchema,
  CreateBudgetGroupRequestSchema,
  CreateBudgetLineRequestSchema,
  GroupBudgetByOriginRequestSchema,
  IdempotencyKeySchema,
  MonthParamsSchema,
  PromoteBudgetLineRequestSchema,
  PromoteBudgetLineResultSchema,
  UpdateBudgetDraftRequestSchema,
  UpdateBudgetGroupRequestSchema,
  UpdateBudgetLayoutRequestSchema,
  UpdateBudgetLineRequestSchema,
} from '@fineapp/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import { runIdempotent } from '../idempotency/idempotency.service.js';
import {
  acceptBudgetLineSource,
  applyBudgetLineToSource,
  createBudgetDraft,
  createBudgetGroup,
  createBudgetLine,
  deleteBudgetDraft,
  deleteBudgetGroup,
  deleteBudgetLine,
  detachBudgetLine,
  getBudgetDraft,
  getCategoryAverages,
  groupBudgetByOrigin,
  listBudgetDrafts,
  promoteBudgetLine,
  refreshBudgetDraft,
  renameBudgetGroup,
  updateBudgetDraft,
  updateBudgetLayout,
  updateBudgetLine,
} from './budget.service.js';

/**
 * Trasy planera budżetu — `/api/v1/budget-drafts`
 * ([04 §14a](../../../../../../plans/04-api-spec.md#14a-planer-budżetu--apiv1budget-drafts)).
 *
 * Szkic jest adresowany miesiącem, nie identyfikatorem — w gospodarstwie jest najwyżej
 * jeden na miesiąc. `/averages` to ścieżka statyczna, dopasowana przed `/:monthKey`.
 * Odpowiedzią każdej zmiany jest cały szkic (ocena zależy od wszystkich linii).
 * Zamiana linii i „Zastosuj w źródle" wymagają `Idempotency-Key` (ADR-077): na słabym
 * łączu powtórzone żądanie nie może założyć drugiej reguły ani podzielić reguły dwa razy.
 * Grupy i układ (`/groups`, `/layout`, ADR-081) nie zmieniają sum — tylko kolejność.
 */

/** Nagłówki zamiany i zapisu w źródle: wymagany klucz idempotencji. */
const IdempotentHeadersSchema = z.object({ 'idempotency-key': IdempotencyKeySchema }).passthrough();

/**
 * Rejestruje trasy planera budżetu.
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
export const budgetRoutes: FastifyPluginCallbackZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
}> = (app, options, done) => {
  const { db, clock } = options;
  const protectedRoute = { onRequest: requireAuth(options.config, clock) };
  const draftResponse = { 200: apiResponse(BudgetDraftDtoSchema) };

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/',
    schema: { response: { 200: apiResponse(BudgetDraftListDtoSchema) } },
    handler: (request) => ({
      data: listBudgetDrafts(db, clock, authContext(request).householdId),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/averages',
    schema: {
      querystring: CategoryAveragesQuerySchema,
      response: { 200: apiResponse(CategoryAveragesDtoSchema) },
    },
    handler: (request) => ({
      data: getCategoryAverages(db, clock, authContext(request).householdId, request.query.months),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/:monthKey',
    schema: { params: MonthParamsSchema, response: draftResponse },
    handler: (request) => ({
      data: getBudgetDraft(db, clock, authContext(request).householdId, request.params.monthKey),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:monthKey',
    schema: {
      params: MonthParamsSchema,
      body: CreateBudgetDraftRequestSchema,
      response: { 201: apiResponse(BudgetDraftDtoSchema) },
    },
    handler: (request, reply) => {
      const { householdId, userId } = authContext(request);
      const data = createBudgetDraft(
        db,
        clock,
        householdId,
        userId,
        request.params.monthKey,
        request.body,
      );
      void reply.status(201);
      return { data };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:monthKey',
    schema: {
      params: MonthParamsSchema,
      body: UpdateBudgetDraftRequestSchema,
      response: draftResponse,
    },
    handler: (request) => ({
      data: updateBudgetDraft(
        db,
        clock,
        authContext(request).householdId,
        request.params.monthKey,
        request.body.notes,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'DELETE',
    url: '/:monthKey',
    schema: { params: MonthParamsSchema },
    handler: async (request, reply) => {
      deleteBudgetDraft(db, authContext(request).householdId, request.params.monthKey);
      await reply.status(204).send();
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:monthKey/refresh',
    schema: { params: MonthParamsSchema, response: draftResponse },
    handler: (request) => ({
      data: refreshBudgetDraft(
        db,
        clock,
        authContext(request).householdId,
        request.params.monthKey,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:monthKey/lines',
    schema: {
      params: MonthParamsSchema,
      body: CreateBudgetLineRequestSchema,
      response: { 201: apiResponse(BudgetDraftDtoSchema) },
    },
    handler: (request, reply) => {
      const data = createBudgetLine(
        db,
        clock,
        authContext(request).householdId,
        request.params.monthKey,
        request.body,
      );
      void reply.status(201);
      return { data };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:monthKey/lines/:lineId',
    schema: {
      params: BudgetLineParamsSchema,
      body: UpdateBudgetLineRequestSchema,
      response: draftResponse,
    },
    handler: (request) => ({
      data: updateBudgetLine(
        db,
        clock,
        authContext(request).householdId,
        request.params.monthKey,
        request.params.lineId,
        request.body,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'DELETE',
    url: '/:monthKey/lines/:lineId',
    schema: { params: BudgetLineParamsSchema, response: draftResponse },
    handler: (request) => ({
      data: deleteBudgetLine(
        db,
        clock,
        authContext(request).householdId,
        request.params.monthKey,
        request.params.lineId,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:monthKey/lines/:lineId/accept-source',
    schema: { params: BudgetLineParamsSchema, response: draftResponse },
    handler: (request) => ({
      data: acceptBudgetLineSource(
        db,
        clock,
        authContext(request).householdId,
        request.params.monthKey,
        request.params.lineId,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:monthKey/lines/:lineId/detach',
    schema: { params: BudgetLineParamsSchema, response: draftResponse },
    handler: (request) => ({
      data: detachBudgetLine(
        db,
        clock,
        authContext(request).householdId,
        request.params.monthKey,
        request.params.lineId,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:monthKey/lines/:lineId/promote',
    schema: {
      params: BudgetLineParamsSchema,
      headers: IdempotentHeadersSchema,
      body: PromoteBudgetLineRequestSchema,
      response: { 200: apiResponse(PromoteBudgetLineResultSchema) },
    },
    handler: (request, reply) => {
      const { householdId } = authContext(request);
      const { monthKey, lineId } = request.params;
      const result = runIdempotent(
        db,
        clock,
        householdId,
        `POST /budget-drafts/${monthKey}/lines/${lineId}/promote`,
        request.headers['idempotency-key'],
        request.body,
        () => ({
          statusCode: 200,
          body: {
            data: promoteBudgetLine(db, clock, householdId, monthKey, lineId, request.body),
          },
        }),
      );
      if (result.replayed) void reply.header('idempotent-replayed', 'true');
      return result.body;
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:monthKey/lines/:lineId/apply-to-source',
    schema: {
      params: BudgetLineParamsSchema,
      headers: IdempotentHeadersSchema,
      response: { 200: apiResponse(ApplyToSourceResultSchema) },
    },
    handler: (request, reply) => {
      const { householdId } = authContext(request);
      const { monthKey, lineId } = request.params;
      const result = runIdempotent(
        db,
        clock,
        householdId,
        `POST /budget-drafts/${monthKey}/lines/${lineId}/apply-to-source`,
        request.headers['idempotency-key'],
        {},
        () => ({
          statusCode: 200,
          body: { data: applyBudgetLineToSource(db, clock, householdId, monthKey, lineId) },
        }),
      );
      if (result.replayed) void reply.header('idempotent-replayed', 'true');
      return result.body;
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:monthKey/groups',
    schema: {
      params: MonthParamsSchema,
      body: CreateBudgetGroupRequestSchema,
      response: { 201: apiResponse(BudgetDraftDtoSchema) },
    },
    handler: (request, reply) => {
      const data = createBudgetGroup(
        db,
        clock,
        authContext(request).householdId,
        request.params.monthKey,
        request.body,
      );
      void reply.status(201);
      return { data };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:monthKey/groups/by-origin',
    schema: {
      params: MonthParamsSchema,
      body: GroupBudgetByOriginRequestSchema,
      response: { 201: apiResponse(BudgetDraftDtoSchema) },
    },
    handler: (request, reply) => {
      const data = groupBudgetByOrigin(
        db,
        clock,
        authContext(request).householdId,
        request.params.monthKey,
        request.body.section,
      );
      void reply.status(201);
      return { data };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:monthKey/groups/:groupId',
    schema: {
      params: BudgetGroupParamsSchema,
      body: UpdateBudgetGroupRequestSchema,
      response: draftResponse,
    },
    handler: (request) => ({
      data: renameBudgetGroup(
        db,
        clock,
        authContext(request).householdId,
        request.params.monthKey,
        request.params.groupId,
        request.body.name,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'DELETE',
    url: '/:monthKey/groups/:groupId',
    schema: { params: BudgetGroupParamsSchema, response: draftResponse },
    handler: (request) => ({
      data: deleteBudgetGroup(
        db,
        clock,
        authContext(request).householdId,
        request.params.monthKey,
        request.params.groupId,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:monthKey/layout',
    schema: {
      params: MonthParamsSchema,
      body: UpdateBudgetLayoutRequestSchema,
      response: draftResponse,
    },
    handler: (request) => ({
      data: updateBudgetLayout(
        db,
        clock,
        authContext(request).householdId,
        request.params.monthKey,
        request.body,
      ),
    }),
  });

  done();
};
