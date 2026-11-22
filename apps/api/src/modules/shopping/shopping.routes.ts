import {
  apiResponse,
  ClearCheckedResultSchema,
  CreateShoppingItemRequestSchema,
  CreateShoppingItemResultSchema,
  CreateShoppingListRequestSchema,
  DuplicateShoppingListRequestSchema,
  FrequentProductsQuerySchema,
  OptionalFlagSchema,
  ReorderShoppingListsRequestSchema,
  RestoreClearedRequestSchema,
  RestoreClearedResultSchema,
  ShoppingIdParamsSchema,
  ShoppingItemDtoSchema,
  ShoppingItemsDtoSchema,
  ShoppingListDtoSchema,
  ShoppingProductDtoSchema,
  ShoppingProductsQuerySchema,
  UpdateShoppingItemRequestSchema,
  UpdateShoppingListRequestSchema,
  UpdateShoppingProductRequestSchema,
  UpsertShoppingProductRequestSchema,
} from '@fineapp/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import {
  clearCheckedShoppingItems,
  createShoppingItem,
  createShoppingList,
  deleteShoppingItem,
  deleteShoppingList,
  deleteShoppingProduct,
  duplicateShoppingList,
  frequentShoppingProducts,
  getShoppingItems,
  listShoppingLists,
  listShoppingProducts,
  reorderShoppingLists,
  restoreClearedShoppingItems,
  shoppingListVersion,
  updateShoppingItem,
  updateShoppingList,
  updateShoppingProduct,
  upsertShoppingProduct,
} from './shopping.service.js';

/**
 * Trasy list zakupów — `/api/v1/shopping-lists`, `/shopping-items`, `/shopping-products`
 * ([04 §14b](../../../../../../plans/04-api-spec.md#14b-listy-zakupów--apiv1shopping-lists-shopping-items-shopping-products-shopping-imports)).
 *
 * Importy przez AI (`/shopping-imports`) dochodzą w `F10-8`. Ścieżki statyczne
 * (`/order`, `/frequent`) są dopasowywane przed `/:id`.
 *
 * Odpytywanie listy (06 §3.15, co 15 s) idzie przez `ETag`: wersją jest `updated_at`
 * listy, które rośnie przy każdej zmianie pozycji, więc niezmieniona lista kosztuje
 * jedno zapytanie i odpowiedź `304` bez treści.
 */

const ListsQuerySchema = z.object({ archived: OptionalFlagSchema });

/**
 * `ETag` wersji listy — słaby, bo treść zależy też od imion domowników.
 *
 * @param version - Znacznik zmiany listy.
 * @returns Wartość nagłówka.
 */
function listEtag(version: number): string {
  return `W/"${String(version)}"`;
}

/**
 * Rejestruje trasy list zakupów.
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
export const shoppingRoutes: FastifyPluginCallbackZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
}> = (app, options, done) => {
  const { db, clock } = options;
  const protectedRoute = { onRequest: requireAuth(options.config, clock) };
  const listResponse = { 200: apiResponse(ShoppingListDtoSchema) };

  // ── Listy ────────────────────────────────────────────────────────────────────────

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/shopping-lists',
    schema: {
      querystring: ListsQuerySchema,
      response: { 200: apiResponse(z.array(ShoppingListDtoSchema)) },
    },
    handler: (request) => {
      const { householdId, userId } = authContext(request);
      return {
        data: listShoppingLists(db, clock, householdId, userId, request.query.archived ?? false),
      };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/shopping-lists',
    schema: {
      body: CreateShoppingListRequestSchema,
      response: { 201: apiResponse(ShoppingListDtoSchema) },
    },
    handler: (request, reply) => {
      const { householdId, userId } = authContext(request);
      const data = createShoppingList(db, clock, householdId, userId, request.body);
      void reply.status(201);
      return { data };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/shopping-lists/order',
    schema: {
      body: ReorderShoppingListsRequestSchema,
      response: { 200: apiResponse(z.array(ShoppingListDtoSchema)) },
    },
    handler: (request) => ({
      data: reorderShoppingLists(db, authContext(request).householdId, request.body.listIds),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/shopping-lists/:id',
    schema: {
      params: ShoppingIdParamsSchema,
      body: UpdateShoppingListRequestSchema,
      response: listResponse,
    },
    handler: (request) => ({
      data: updateShoppingList(
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
    url: '/shopping-lists/:id',
    schema: { params: ShoppingIdParamsSchema },
    handler: async (request, reply) => {
      deleteShoppingList(db, clock, authContext(request).householdId, request.params.id);
      await reply.status(204).send();
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/shopping-lists/:id/duplicate',
    schema: {
      params: ShoppingIdParamsSchema,
      body: DuplicateShoppingListRequestSchema,
      response: { 201: apiResponse(ShoppingListDtoSchema) },
    },
    handler: (request, reply) => {
      const { householdId, userId } = authContext(request);
      const data = duplicateShoppingList(
        db,
        clock,
        householdId,
        userId,
        request.params.id,
        request.body.name,
      );
      void reply.status(201);
      return { data };
    },
  });

  // ── Pozycje ──────────────────────────────────────────────────────────────────────

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/shopping-lists/:id/items',
    schema: {
      params: ShoppingIdParamsSchema,
      // 304 bez treści — klient bierze dane z pamięci podręcznej TanStack Query.
      response: { 200: apiResponse(ShoppingItemsDtoSchema), 304: z.null() },
    },
    handler: async (request, reply) => {
      const { householdId } = authContext(request);
      const etag = listEtag(shoppingListVersion(db, householdId, request.params.id));
      void reply.header('etag', etag).header('cache-control', 'no-cache');
      if (request.headers['if-none-match'] === etag) {
        await reply.status(304).send(null);
        return reply;
      }
      return { data: getShoppingItems(db, householdId, request.params.id) };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/shopping-lists/:id/items',
    schema: {
      params: ShoppingIdParamsSchema,
      body: CreateShoppingItemRequestSchema,
      response: {
        200: apiResponse(CreateShoppingItemResultSchema),
        201: apiResponse(CreateShoppingItemResultSchema),
      },
    },
    handler: (request, reply) => {
      const { householdId, userId } = authContext(request);
      const outcome = createShoppingItem(
        db,
        clock,
        householdId,
        userId,
        request.params.id,
        request.body,
      );
      void reply.status(outcome.kind === 'created' ? 201 : 200);
      return { data: { item: outcome.item, merged: outcome.kind === 'merged' } };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/shopping-lists/:id/clear-checked',
    schema: {
      params: ShoppingIdParamsSchema,
      response: { 200: apiResponse(ClearCheckedResultSchema) },
    },
    handler: (request) => ({
      data: clearCheckedShoppingItems(
        db,
        clock,
        authContext(request).householdId,
        request.params.id,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/shopping-lists/:id/restore-cleared',
    schema: {
      params: ShoppingIdParamsSchema,
      body: RestoreClearedRequestSchema,
      response: { 200: apiResponse(RestoreClearedResultSchema) },
    },
    handler: (request) => ({
      data: {
        restoredIds: restoreClearedShoppingItems(
          db,
          clock,
          authContext(request).householdId,
          request.params.id,
          request.body.itemIds,
        ),
      },
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/shopping-items/:id',
    schema: {
      params: ShoppingIdParamsSchema,
      body: UpdateShoppingItemRequestSchema,
      response: { 200: apiResponse(ShoppingItemDtoSchema) },
    },
    handler: (request) => {
      const { householdId, userId } = authContext(request);
      return {
        data: updateShoppingItem(db, clock, householdId, userId, request.params.id, request.body),
      };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'DELETE',
    url: '/shopping-items/:id',
    schema: { params: ShoppingIdParamsSchema },
    handler: async (request, reply) => {
      deleteShoppingItem(db, clock, authContext(request).householdId, request.params.id);
      await reply.status(204).send();
    },
  });

  // ── Słownik ──────────────────────────────────────────────────────────────────────

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/shopping-products',
    schema: {
      querystring: ShoppingProductsQuerySchema,
      response: { 200: apiResponse(z.array(ShoppingProductDtoSchema)) },
    },
    handler: (request) => ({
      data: listShoppingProducts(db, authContext(request).householdId, request.query),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/shopping-products/frequent',
    schema: {
      querystring: FrequentProductsQuerySchema,
      response: { 200: apiResponse(z.array(ShoppingProductDtoSchema)) },
    },
    handler: (request) => ({
      data: frequentShoppingProducts(
        db,
        clock,
        authContext(request).householdId,
        request.query.listId,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/shopping-products',
    schema: {
      body: UpsertShoppingProductRequestSchema,
      response: {
        200: apiResponse(ShoppingProductDtoSchema),
        201: apiResponse(ShoppingProductDtoSchema),
      },
    },
    handler: (request, reply) => {
      const outcome = upsertShoppingProduct(
        db,
        clock,
        authContext(request).householdId,
        request.body,
      );
      void reply.status(outcome.created ? 201 : 200);
      return { data: outcome.product };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/shopping-products/:id',
    schema: {
      params: ShoppingIdParamsSchema,
      body: UpdateShoppingProductRequestSchema,
      response: { 200: apiResponse(ShoppingProductDtoSchema) },
    },
    handler: (request) => ({
      data: updateShoppingProduct(
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
    url: '/shopping-products/:id',
    schema: { params: ShoppingIdParamsSchema },
    handler: async (request, reply) => {
      deleteShoppingProduct(db, authContext(request).householdId, request.params.id);
      await reply.status(204).send();
    },
  });

  done();
};
