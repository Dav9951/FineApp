import multipart from '@fastify/multipart';
import {
  apiResponse,
  CommitShoppingImportResultSchema,
  CreateShoppingImportRequestSchema,
  IdempotencyKeySchema,
  IdSchema,
  ServingsFactorBpsSchema,
  ShoppingIdParamsSchema,
  ShoppingImportDtoSchema,
  ShoppingImportKindSchema,
  UpdateShoppingImportItemRequestSchema,
  UpdateShoppingImportRequestSchema,
} from '@fineapp/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { ShoppingExtractor } from '../../ai/shopping-extractor.js';
import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import { FileTooLargeError, ValidationError } from '../../core/errors.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import type { DocumentJobs } from '../documents/documents.jobs.js';
import { runIdempotent } from '../idempotency/idempotency.service.js';
import { removeImportFiles } from './shopping.files.js';
import {
  commitImport,
  createImageImport,
  createTextImport,
  discardImport,
  getImport,
  MAX_IMPORT_IMAGES,
  retryImport,
  updateImport,
  updateImportItem,
  type ImportImage,
  type ShoppingImportsDeps,
} from './shopping.imports.js';

/**
 * Trasy importów list zakupów przez AI — `/api/v1/shopping-imports`
 * ([04 §14b](../../../../../../plans/04-api-spec.md#14b-listy-zakupów--apiv1shopping-lists-shopping-items-shopping-products-shopping-imports),
 * `F10-8`, `F10-9`).
 *
 * `POST /` przyjmuje `multipart/form-data` (zdjęcia) albo JSON (link, tekst). Limit
 * 20 odczytów na godzinę na gospodarstwo — ochrona kosztów AI, jak przy dokumentach.
 * Zatwierdzenie wymaga `Idempotency-Key`: na słabym łączu powtórzone żądanie nie może
 * dopisać pozycji dwa razy.
 */

/** Odczyty na godzinę na gospodarstwo (04 §17). */
const IMPORT_RATE_LIMIT = 20;

const ItemParamsSchema = z.object({ id: IdSchema, itemId: IdSchema });
const CommitHeadersSchema = z.object({ 'idempotency-key': IdempotencyKeySchema }).passthrough();

/** Pola tekstowe formularza ze zdjęciami. */
const ImageFieldsSchema = z.object({
  listId: IdSchema,
  kind: ShoppingImportKindSchema,
  servingsFactorBps: z.coerce.number().pipe(ServingsFactorBpsSchema).optional(),
});

/**
 * Klucz limitu żądań: gospodarstwo z tokenu (`onRequest` już je ustawił).
 *
 * @param request - Żądanie.
 * @returns Klucz.
 */
function householdKey(request: FastifyRequest): string {
  return request.auth?.householdId ?? request.ip;
}

/**
 * Czyta formularz ze zdjęciami: pola tekstowe i do {@link MAX_IMPORT_IMAGES} plików
 * `image`. Nazwy plików od klienta są ignorowane (09 §7).
 *
 * @param request - Żądanie.
 * @returns Pola i obrazy.
 * @throws {FileTooLargeError} Gdy plik przekracza `UPLOAD_MAX_BYTES`.
 * @throws {ValidationError} Gdy brak zdjęć albo zły formularz.
 */
async function readImages(
  request: FastifyRequest,
): Promise<{ fields: Record<string, string>; images: ImportImage[] }> {
  const fields: Record<string, string> = {};
  const images: ImportImage[] = [];
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const bytes = await part.toBuffer();
        if (part.fieldname === 'image' && bytes.length > 0) images.push({ bytes });
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') throw new FileTooLargeError();
    if (code === 'FST_FILES_LIMIT') {
      throw new ValidationError(`Najwyżej ${String(MAX_IMPORT_IMAGES)} zdjęcia.`);
    }
    throw error;
  }
  if (images.length === 0) {
    throw new ValidationError('Dodaj zdjęcie.', [{ path: 'image', message: 'Brak zdjęcia.' }]);
  }
  return { fields, images };
}

/**
 * Zamienia błędy walidacji Zod na `400` z polami.
 *
 * @param issues - Błędy.
 * @returns Błąd do rzucenia.
 */
function invalid(issues: readonly z.core.$ZodIssue[]): ValidationError {
  return new ValidationError(
    'Żądanie zawiera nieprawidłowe dane.',
    issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  );
}

/**
 * Rejestruje trasy importów.
 *
 * @param app - Instancja Fastify z type providerem Zod.
 * @param options - Zależności modułu.
 * @param options.db - Uchwyt bazy.
 * @param options.config - Konfiguracja.
 * @param options.clock - Źródło czasu.
 * @param options.extractor - Ekstraktor list (`null` — AI wyłączone).
 * @param options.jobs - Rejestr zadań w tle.
 * @param options.fetchHtml - Pobieranie strony przepisu (testy).
 */
export const shoppingImportsRoutes: FastifyPluginAsyncZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
  extractor: ShoppingExtractor | null;
  jobs: DocumentJobs;
  fetchHtml?: ShoppingImportsDeps['fetchHtml'];
}> = async (app, options) => {
  const { db, config, clock } = options;
  const deps: ShoppingImportsDeps = {
    db,
    config,
    clock,
    extractor: options.extractor,
    jobs: options.jobs,
    log: app.log,
    ...(options.fetchHtml === undefined ? {} : { fetchHtml: options.fetchHtml }),
  };
  const protectedRoute = { onRequest: requireAuth(config, clock) };
  const importResponse = { 200: apiResponse(ShoppingImportDtoSchema) };

  await app.register(multipart, {
    limits: { fileSize: config.uploads.maxBytes, files: MAX_IMPORT_IMAGES, fields: 5, parts: 8 },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/',
    config: {
      rateLimit: {
        max: IMPORT_RATE_LIMIT,
        timeWindow: '1 hour',
        hook: 'preHandler',
        keyGenerator: householdKey,
      },
    },
    schema: { response: { 202: apiResponse(ShoppingImportDtoSchema) } },
    handler: async (request, reply) => {
      const { householdId, userId } = authContext(request);
      let data;
      if (request.isMultipart()) {
        const { fields, images } = await readImages(request);
        const parsed = ImageFieldsSchema.safeParse(fields);
        if (!parsed.success) throw invalid(parsed.error.issues);
        data = await createImageImport(deps, householdId, userId, {
          listId: parsed.data.listId,
          kind: parsed.data.kind,
          servingsFactorBps: parsed.data.servingsFactorBps ?? null,
          images,
        });
      } else {
        const parsed = CreateShoppingImportRequestSchema.safeParse(request.body);
        if (!parsed.success) throw invalid(parsed.error.issues);
        const body = parsed.data;
        data = createTextImport(deps, householdId, userId, {
          listId: body.listId,
          servingsFactorBps: body.servingsFactorBps,
          ...(body.input === 'url' ? { url: body.url } : { text: body.text }),
        });
      }
      void reply.status(202).header('location', `/api/v1/shopping-imports/${data.id}`);
      return { data };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/:id',
    schema: { params: ShoppingIdParamsSchema, response: importResponse },
    handler: (request) => ({
      data: getImport(db, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:id',
    schema: {
      params: ShoppingIdParamsSchema,
      body: UpdateShoppingImportRequestSchema,
      response: importResponse,
    },
    handler: (request) => ({
      data: updateImport(deps, authContext(request).householdId, request.params.id, request.body),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:id/items/:itemId',
    schema: {
      params: ItemParamsSchema,
      body: UpdateShoppingImportItemRequestSchema,
      response: importResponse,
    },
    handler: (request) => ({
      data: updateImportItem(
        deps,
        authContext(request).householdId,
        request.params.id,
        request.params.itemId,
        request.body,
      ),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/commit',
    schema: {
      params: ShoppingIdParamsSchema,
      headers: CommitHeadersSchema,
      response: { 200: apiResponse(CommitShoppingImportResultSchema) },
    },
    handler: async (request, reply) => {
      const { householdId, userId } = authContext(request);
      let files: string[] = [];
      const result = runIdempotent(
        db,
        clock,
        householdId,
        `POST /shopping-imports/${request.params.id}/commit`,
        request.headers['idempotency-key'],
        {},
        () => {
          const committed = commitImport(deps, householdId, userId, request.params.id);
          files = committed.files;
          return { statusCode: 200, body: { data: committed.result } };
        },
      );
      // Pliki po zatwierdzeniu transakcji: plik bez wiersza to mniejsze zło niż odwrotnie.
      await removeImportFiles(config.uploads.dir, files, request.log);
      if (result.replayed) void reply.header('idempotent-replayed', 'true');
      void reply.status(result.statusCode as 200);
      return result.body;
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/discard',
    schema: { params: ShoppingIdParamsSchema },
    handler: async (request, reply) => {
      const files = discardImport(deps, authContext(request).householdId, request.params.id);
      await removeImportFiles(config.uploads.dir, files, request.log);
      await reply.status(204).send();
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/retry',
    config: {
      rateLimit: {
        max: IMPORT_RATE_LIMIT,
        timeWindow: '1 hour',
        hook: 'preHandler',
        keyGenerator: householdKey,
      },
    },
    schema: {
      params: ShoppingIdParamsSchema,
      response: { 202: apiResponse(ShoppingImportDtoSchema) },
    },
    handler: (request, reply) => {
      const data = retryImport(deps, authContext(request).householdId, request.params.id);
      void reply.status(202);
      return { data };
    },
  });
};
