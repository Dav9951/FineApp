import {
  AccountBalanceDtoSchema,
  AccountDetailDtoSchema,
  AccountDtoSchema,
  apiResponse,
  BalancesMetaSchema,
  BalancesQuerySchema,
  CreateAccountRequestSchema,
  IdSchema,
  ListAccountsQuerySchema,
  ReorderAccountsRequestSchema,
  UpdateAccountRequestSchema,
} from '@fineapp/shared';
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import {
  createAccount,
  deleteAccount,
  getAccount,
  getAccountBalances,
  listAccounts,
  reorderAccounts,
  setAccountArchived,
  updateAccount,
} from './accounts.service.js';

/**
 * Trasy kont — `/api/v1/accounts`
 * ([04 §5](../../../../../../plans/04-api-spec.md#5-konta--apiv1accounts)).
 *
 * Trasa nie dotyka bazy: cała logika siedzi w serwisie
 * ([02 §3](../../../../../../plans/02-architecture.md#3-warstwy-i-kierunek-zależności)).
 * `householdId` pochodzi wyłącznie z tokenu (`authContext`), nigdy z ciała ani ścieżki.
 */

/** Parametr ścieżki z identyfikatorem konta. */
const AccountParamsSchema = z.object({ id: IdSchema });

/**
 * Rejestruje trasy kont.
 *
 * Każda trasa wymaga zalogowania; `requireAuth` jest podpinane per trasa
 * (ADR-027) w fazie `onRequest` (ADR-031), tak samo jak w module `auth`.
 *
 * @param app - Instancja Fastify z type providerem Zod.
 * @param options - Zależności modułu.
 * @param options.db - Uchwyt bazy.
 * @param options.config - Konfiguracja aplikacji.
 * @param options.clock - Źródło czasu.
 * @param done - Sygnał zakończenia rejestracji.
 */
export const accountsRoutes: FastifyPluginCallbackZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
}> = (app, options, done) => {
  const { db, clock } = options;
  // `onRequest`, a nie `preHandler`: walidacja ciała biegnie przed `preHandler`, więc
  // żądanie bez tokenu z błędnym ciałem dostałoby `400` zamiast `401` — i to po
  // sparsowaniu ciała, którego nieuwierzytelniony klient nie powinien móc nam wcisnąć.
  const protectedRoute = { onRequest: requireAuth(options.config, clock) };

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/',
    schema: {
      querystring: ListAccountsQuerySchema,
      response: { 200: apiResponse(AccountDtoSchema.array()) },
    },
    handler: (request) => ({
      data: listAccounts(db, authContext(request).householdId, request.query),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/',
    schema: {
      body: CreateAccountRequestSchema,
      response: { 201: apiResponse(AccountDtoSchema) },
    },
    handler: (request, reply) => {
      const account = createAccount(db, clock, authContext(request).householdId, request.body);
      // Ścieżka bez ciągu zapytania i bez końcowego ukośnika — `Location` wskazuje zasób.
      const collection = (request.url.split('?')[0] ?? '').replace(/\/$/, '');
      void reply.status(201).header('location', `${collection}/${account.id}`);
      return { data: account };
    },
  });

  // Ścieżka statyczna `/order` ma w routerze Fastify pierwszeństwo przed `/:id`,
  // więc „order" nie zostanie potraktowane jak identyfikator konta.
  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/order',
    schema: {
      body: ReorderAccountsRequestSchema,
      response: { 200: apiResponse(AccountDtoSchema.array()) },
    },
    handler: (request) => ({
      data: reorderAccounts(db, clock, authContext(request).householdId, request.body),
    }),
  });

  // Tak jak `/order`: ścieżka statyczna wygrywa z `/:id`.
  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/balances',
    schema: {
      querystring: BalancesQuerySchema,
      response: { 200: apiResponse(AccountBalanceDtoSchema.array(), BalancesMetaSchema) },
    },
    handler: (request) =>
      getAccountBalances(db, clock, authContext(request).householdId, request.query),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/:id',
    schema: {
      params: AccountParamsSchema,
      response: { 200: apiResponse(AccountDetailDtoSchema) },
    },
    handler: (request) => ({
      data: getAccount(db, clock, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:id',
    schema: {
      params: AccountParamsSchema,
      body: UpdateAccountRequestSchema,
      response: { 200: apiResponse(AccountDtoSchema) },
    },
    handler: (request) => ({
      data: updateAccount(
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
    schema: {
      params: AccountParamsSchema,
      response: { 200: apiResponse(AccountDtoSchema) },
    },
    handler: (request) => ({
      data: setAccountArchived(
        db,
        clock,
        authContext(request).householdId,
        request.params.id,
        true,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/unarchive',
    schema: {
      params: AccountParamsSchema,
      response: { 200: apiResponse(AccountDtoSchema) },
    },
    handler: (request) => ({
      data: setAccountArchived(
        db,
        clock,
        authContext(request).householdId,
        request.params.id,
        false,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'DELETE',
    url: '/:id',
    schema: { params: AccountParamsSchema },
    handler: async (request, reply) => {
      deleteAccount(db, clock, authContext(request).householdId, request.params.id);
      await reply.status(204).send();
    },
  });

  done();
};
