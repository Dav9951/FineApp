import {
  apiResponse,
  CategoryDtoSchema,
  CategoryTreeDtoSchema,
  CategoryUsageDtoSchema,
  CategoryUsageQuerySchema,
  CreateCategoryRequestSchema,
  IdSchema,
  ListCategoriesQuerySchema,
  MergeCategoryRequestSchema,
  MergeCategoryResponseSchema,
  UpdateCategoryRequestSchema,
} from '@fineapp/shared';
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import {
  archiveCategory,
  createCategory,
  deleteCategory,
  listCategoriesFlat,
  listCategoryTree,
  listCategoryUsage,
  mergeCategory,
  unarchiveCategory,
  updateCategory,
} from './categories.service.js';

/**
 * Trasy kategorii — `/api/v1/categories`
 * ([04 §6](../../../../../../plans/04-api-spec.md#6-kategorie--apiv1categories)).
 *
 * `householdId` wyłącznie z tokenu. Raport wydatków po kategoriach to
 * `GET /months/:key/categories` — `/categories/spending` nie powstaje (ADR-039);
 * `GET /categories/usage` to statystyka ekranu ustawień, nie raport (ADR-038).
 */

/** Parametr ścieżki z identyfikatorem kategorii. */
const CategoryParamsSchema = z.object({ id: IdSchema });

/**
 * Rejestruje trasy kategorii.
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
export const categoriesRoutes: FastifyPluginCallbackZod<{
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
      querystring: ListCategoriesQuerySchema,
      response: { 200: apiResponse(CategoryTreeDtoSchema.array()) },
    },
    handler: (request) => ({
      data: listCategoryTree(db, authContext(request).householdId, request.query),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/flat',
    schema: {
      querystring: ListCategoriesQuerySchema,
      response: { 200: apiResponse(CategoryDtoSchema.array()) },
    },
    handler: (request) => ({
      data: listCategoriesFlat(db, authContext(request).householdId, request.query),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/usage',
    schema: {
      querystring: CategoryUsageQuerySchema,
      response: { 200: apiResponse(CategoryUsageDtoSchema.array()) },
    },
    handler: (request) => ({
      data: listCategoryUsage(db, authContext(request).householdId, request.query),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/',
    schema: {
      body: CreateCategoryRequestSchema,
      response: { 201: apiResponse(CategoryDtoSchema) },
    },
    handler: (request, reply) => {
      const category = createCategory(db, clock, authContext(request).householdId, request.body);
      const collection = (request.url.split('?')[0] ?? '').replace(/\/$/, '');
      void reply.status(201).header('location', `${collection}/${category.id}`);
      return { data: category };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:id',
    schema: {
      params: CategoryParamsSchema,
      body: UpdateCategoryRequestSchema,
      response: { 200: apiResponse(CategoryDtoSchema) },
    },
    handler: (request) => ({
      data: updateCategory(
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
    url: '/:id/archive',
    schema: { params: CategoryParamsSchema, response: { 200: apiResponse(CategoryDtoSchema) } },
    handler: (request) => ({
      data: archiveCategory(db, clock, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/unarchive',
    schema: { params: CategoryParamsSchema, response: { 200: apiResponse(CategoryDtoSchema) } },
    handler: (request) => ({
      data: unarchiveCategory(db, clock, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/merge',
    schema: {
      params: CategoryParamsSchema,
      body: MergeCategoryRequestSchema,
      response: { 200: apiResponse(MergeCategoryResponseSchema) },
    },
    handler: (request) => ({
      data: mergeCategory(
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
    schema: { params: CategoryParamsSchema },
    handler: async (request, reply) => {
      deleteCategory(db, authContext(request).householdId, request.params.id);
      await reply.status(204).send();
    },
  });

  done();
};
