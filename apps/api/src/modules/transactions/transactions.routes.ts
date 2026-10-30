import {
  apiResponse,
  BulkCreateTransactionsRequestSchema,
  IdempotencyKeySchema,
  IdSchema,
  RecurringRuleDtoSchema,
  SaveAsRecurringRequestSchema,
  TransactionListMetaSchema,
  TransactionDtoSchema,
  TransactionFieldsSchema,
  TransactionListItemDtoSchema,
  TransactionMutationMetaSchema,
  TransactionQuerySchema,
  UpdateTransactionRequestSchema,
} from '@fineapp/shared';
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import { runIdempotent } from '../idempotency/idempotency.service.js';
import { saveTransactionAsRecurring } from '../recurring/recurring.service.js';
import {
  createTransaction,
  createTransactions,
  deleteTransaction,
  getTransaction,
  listTransactions,
  restoreTransaction,
  updateTransaction,
} from './transactions.service.js';

/**
 * Trasy transakcji — `/api/v1/transactions`
 * ([04 §7](../../../../../../plans/04-api-spec.md#7-transakcje--apiv1transactions)).
 *
 * `householdId` i autor wyłącznie z tokenu. `POST /transactions/bulk` (`F7-6`, ADR-035)
 * tworzy wiele transakcji naraz — wszystkie albo żadna. `POST /:id/save-as-recurring` (`F4-8`)
 * tworzy regułę przez serwis pozycji cyklicznych (ADR-051).
 *
 * `POST` przyjmuje nagłówek `Idempotency-Key` (ADR-037) — także „Zapisz jako wydatek
 * stały": ponowienie po zerwanym połączeniu nie może założyć drugiej reguły.
 *
 * Ciało `POST` to pola **bez** walidacji krzyżowej: naruszenie I-2, I-3, I-7a daje
 * `422`, nie `400` (04 §2), więc sprawdza je serwis.
 */

/** Parametr ścieżki z identyfikatorem transakcji. */
const TransactionParamsSchema = z.object({ id: IdSchema });

/**
 * Nagłówki `POST /transactions`: opcjonalny klucz idempotencji (ADR-037).
 *
 * `passthrough`, bo Fastify podmienia `request.headers` na wynik walidacji — bez tego
 * zniknęłyby wszystkie pozostałe nagłówki.
 */
const CreateHeadersSchema = z
  .object({ 'idempotency-key': IdempotencyKeySchema.optional() })
  .passthrough();

/** Operacja w tabeli kluczy idempotencji. */
const CREATE_SCOPE = 'POST /transactions';

/** Odpowiedź zapisu: transakcja i miesiące do unieważnienia. */
const MutationResponseSchema = apiResponse(TransactionDtoSchema, TransactionMutationMetaSchema);

/**
 * Rejestruje trasy transakcji.
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
export const transactionsRoutes: FastifyPluginCallbackZod<{
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
      querystring: TransactionQuerySchema,
      response: {
        200: apiResponse(TransactionListItemDtoSchema.array(), TransactionListMetaSchema),
      },
    },
    handler: (request) => listTransactions(db, authContext(request).householdId, request.query),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/',
    schema: {
      headers: CreateHeadersSchema,
      body: TransactionFieldsSchema,
      response: { 201: MutationResponseSchema },
    },
    handler: (request, reply) => {
      const { householdId, userId } = authContext(request);
      // Ponowienie z tym samym kluczem zwraca pierwszą odpowiedź zamiast drugiego wydatku.
      const result = runIdempotent(
        db,
        clock,
        householdId,
        CREATE_SCOPE,
        request.headers['idempotency-key'],
        request.body,
        () => ({
          statusCode: 201,
          body: createTransaction(db, clock, householdId, userId, request.body),
        }),
      );
      const collection = (request.url.split('?')[0] ?? '').replace(/\/$/, '');
      // Powtórka odtwarza zapisane `201` — ta trasa innego sukcesu nie zapisuje.
      void reply.status(201).header('location', `${collection}/${result.body.data.id}`);
      if (result.replayed) void reply.header('idempotent-replayed', 'true');
      return result.body;
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/bulk',
    schema: {
      headers: CreateHeadersSchema,
      body: BulkCreateTransactionsRequestSchema,
      response: { 201: apiResponse(TransactionDtoSchema.array(), TransactionMutationMetaSchema) },
    },
    handler: (request, reply) => {
      const { householdId, userId } = authContext(request);
      const result = runIdempotent(
        db,
        clock,
        householdId,
        'POST /transactions/bulk',
        request.headers['idempotency-key'],
        request.body,
        () => ({
          statusCode: 201,
          body: createTransactions(db, clock, householdId, userId, request.body.transactions),
        }),
      );
      void reply.status(201);
      if (result.replayed) void reply.header('idempotent-replayed', 'true');
      return result.body;
    },
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/:id',
    schema: {
      params: TransactionParamsSchema,
      response: { 200: apiResponse(TransactionListItemDtoSchema) },
    },
    handler: (request) => ({
      data: getTransaction(db, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:id',
    schema: {
      params: TransactionParamsSchema,
      body: UpdateTransactionRequestSchema,
      response: { 200: MutationResponseSchema },
    },
    handler: (request) =>
      updateTransaction(
        db,
        clock,
        authContext(request).householdId,
        request.params.id,
        request.body,
      ),
  });

  app.route({
    ...protectedRoute,
    method: 'DELETE',
    url: '/:id',
    schema: { params: TransactionParamsSchema },
    handler: async (request, reply) => {
      deleteTransaction(db, clock, authContext(request).householdId, request.params.id);
      await reply.status(204).send();
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/restore',
    schema: {
      params: TransactionParamsSchema,
      response: { 200: MutationResponseSchema },
    },
    handler: (request) =>
      restoreTransaction(db, clock, authContext(request).householdId, request.params.id),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/save-as-recurring',
    schema: {
      params: TransactionParamsSchema,
      headers: CreateHeadersSchema,
      body: SaveAsRecurringRequestSchema,
      response: { 201: apiResponse(RecurringRuleDtoSchema) },
    },
    handler: (request, reply) => {
      const { householdId } = authContext(request);
      // Zakres z identyfikatorem: ten sam klucz przy innej transakcji to inna operacja.
      const result = runIdempotent(
        db,
        clock,
        householdId,
        `POST /transactions/${request.params.id}/save-as-recurring`,
        request.headers['idempotency-key'],
        request.body,
        () => ({
          statusCode: 201,
          body: {
            data: saveTransactionAsRecurring(
              db,
              clock,
              householdId,
              request.params.id,
              request.body,
            ),
          },
        }),
      );
      void reply.status(201).header('location', `/api/v1/recurring/rules/${result.body.data.id}`);
      if (result.replayed) void reply.header('idempotent-replayed', 'true');
      return result.body;
    },
  });

  done();
};
