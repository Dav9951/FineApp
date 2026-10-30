import multipart from '@fastify/multipart';
import {
  apiResponse,
  CommitDocumentRequestSchema,
  CommitDocumentResponseSchema,
  DocumentDtoSchema,
  DocumentListItemDtoSchema,
  DocumentQuerySchema,
  IdempotencyKeySchema,
  IdSchema,
  TransactionMutationMetaSchema,
  UpdateDocumentItemRequestSchema,
  UpdateDocumentRequestSchema,
  UploadDocumentFieldsSchema,
  UploadDocumentResponseSchema,
} from '@fineapp/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import { FileTooLargeError, ValidationError } from '../../core/errors.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import type { DocumentExtractor } from '../../ai/document-extractor.js';
import { runIdempotent } from '../idempotency/idempotency.service.js';
import { commitDocument } from './documents.commit.js';
import type { DocumentJobs } from './documents.jobs.js';
import {
  deleteDocument,
  discardDocument,
  getDocument,
  getDocumentFile,
  listDocuments,
  reanalyzeDocument,
  updateDocument,
  updateDocumentItem,
  uploadDocument,
  type DocumentsDeps,
  type UploadedFile,
} from './documents.service.js';

/**
 * Trasy dokumentów — `/api/v1/documents`
 * ([04 §13](../../../../../../plans/04-api-spec.md#13-dokumenty--ocr--apiv1documents), Faza 7).
 *
 * Upload to jedyna trasa `multipart/form-data` w API. Limit rozmiaru pilnuje
 * `@fastify/multipart` (przerwanie strumienia po `UPLOAD_MAX_BYTES`), typ — serwis po
 * zawartości. Pliki wychodzą wyłącznie przez `GET /:id/file` po sprawdzeniu gospodarstwa;
 * katalog uploadów nigdy nie jest serwowany statycznie (09 §7).
 */

/** Parametr ścieżki z identyfikatorem dokumentu. */
const DocumentParamsSchema = z.object({ id: IdSchema });

/** Parametry ścieżki pozycji. */
const ItemParamsSchema = z.object({ id: IdSchema, itemId: IdSchema });

/** Wariant pliku. */
const FileQuerySchema = z.object({ variant: z.enum(['original', 'thumb']).default('original') });

/** Nagłówki commitu — `Idempotency-Key` wymagany (04 §13). */
const CommitHeadersSchema = z.object({ 'idempotency-key': IdempotencyKeySchema }).passthrough();

/** Limit wrzuceń: 20 na godzinę na gospodarstwo — ochrona kosztów AI (04 §17). */
const UPLOAD_RATE_LIMIT = 20;

/** Limit ponownych analiz: 5 na godzinę na dokument (04 §17). */
const ANALYZE_RATE_LIMIT = 5;

/**
 * Klucz limitu po gospodarstwie z tokenu.
 *
 * Limit biegnie w `preHandler`, czyli po `requireAuth` — dopiero wtedy `request.auth`
 * istnieje. W `onRequest` wszystkie gospodarstwa za jednym proxy dzieliłyby licznik IP.
 *
 * @param request - Żądanie.
 * @returns Klucz licznika.
 */
function householdKey(request: FastifyRequest): string {
  return request.auth?.householdId ?? request.ip;
}

/**
 * Czyta żądanie `multipart`: jeden plik w polu `file` i pola tekstowe.
 *
 * @param request - Żądanie.
 * @returns Plik i pola.
 * @throws {FileTooLargeError} Gdy plik przekracza `UPLOAD_MAX_BYTES`.
 * @throws {ValidationError} Gdy żądanie nie jest `multipart` albo nie ma pliku.
 */
async function readUpload(
  request: FastifyRequest,
): Promise<{ file: UploadedFile; fields: Record<string, string> }> {
  const fields: Record<string, string> = {};
  let file: UploadedFile | undefined;
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const bytes = await part.toBuffer();
        if (part.fieldname === 'file' && file === undefined) {
          file = { bytes, filename: part.filename };
        }
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') throw new FileTooLargeError();
    if (code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      throw new ValidationError('Wyślij plik jako multipart/form-data.');
    }
    throw error;
  }
  if (file === undefined || file.bytes.length === 0) {
    throw new ValidationError('Wybierz plik do wrzucenia.', [
      { path: 'file', message: 'Brak pliku.' },
    ]);
  }
  return { file, fields };
}

/**
 * Rejestruje trasy dokumentów.
 *
 * @param app - Instancja Fastify z type providerem Zod.
 * @param options - Zależności modułu.
 * @param options.db - Uchwyt bazy.
 * @param options.config - Konfiguracja aplikacji.
 * @param options.clock - Źródło czasu.
 * @param options.extractor - Ekstraktor; `null` przy `AI_ENABLED=false`.
 * @param options.jobs - Rejestr zadań w tle.
 */
export const documentsRoutes: FastifyPluginAsyncZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
  extractor: DocumentExtractor | null;
  jobs: DocumentJobs;
}> = async (app, options) => {
  const { db, config, clock } = options;
  const deps: DocumentsDeps = {
    db,
    config,
    clock,
    extractor: options.extractor,
    jobs: options.jobs,
    log: app.log,
  };
  const protectedRoute = { onRequest: requireAuth(config, clock) };

  await app.register(multipart, {
    limits: { fileSize: config.uploads.maxBytes, files: 1, fields: 5, parts: 6 },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/',
    config: {
      rateLimit: {
        max: UPLOAD_RATE_LIMIT,
        timeWindow: '1 hour',
        hook: 'preHandler',
        keyGenerator: householdKey,
      },
    },
    schema: { response: { 202: apiResponse(UploadDocumentResponseSchema) } },
    handler: async (request, reply) => {
      const { householdId, userId } = authContext(request);
      const { file, fields } = await readUpload(request);
      const parsed = UploadDocumentFieldsSchema.safeParse(fields);
      if (!parsed.success) {
        throw new ValidationError(
          'Żądanie zawiera nieprawidłowe dane.',
          parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        );
      }
      const result = await uploadDocument(deps, householdId, userId, file, parsed.data);
      void reply.status(202).header('location', `/api/v1/documents/${result.id}`);
      return { data: result };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/',
    schema: {
      querystring: DocumentQuerySchema,
      response: { 200: apiResponse(DocumentListItemDtoSchema.array()) },
    },
    handler: (request) => ({
      data: listDocuments(db, authContext(request).householdId, request.query),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/:id',
    schema: {
      params: DocumentParamsSchema,
      response: { 200: apiResponse(DocumentDtoSchema) },
    },
    handler: (request) => ({
      data: getDocument(db, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/:id/analyze',
    config: {
      rateLimit: {
        max: ANALYZE_RATE_LIMIT,
        timeWindow: '1 hour',
        hook: 'preHandler',
        keyGenerator: (request: FastifyRequest) =>
          `${householdKey(request)}:${(request.params as { id?: string }).id ?? ''}`,
      },
    },
    schema: {
      params: DocumentParamsSchema,
      response: { 202: apiResponse(UploadDocumentResponseSchema) },
    },
    handler: (request, reply) => {
      const result = reanalyzeDocument(deps, authContext(request).householdId, request.params.id);
      void reply.status(202);
      return { data: result };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:id',
    schema: {
      params: DocumentParamsSchema,
      body: UpdateDocumentRequestSchema,
      response: { 200: apiResponse(DocumentDtoSchema) },
    },
    handler: (request) => ({
      data: updateDocument(deps, authContext(request).householdId, request.params.id, request.body),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/:id/items/:itemId',
    schema: {
      params: ItemParamsSchema,
      body: UpdateDocumentItemRequestSchema,
      response: { 200: apiResponse(DocumentDtoSchema) },
    },
    handler: (request) => ({
      data: updateDocumentItem(
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
      params: DocumentParamsSchema,
      headers: CommitHeadersSchema,
      body: CommitDocumentRequestSchema,
      response: { 201: apiResponse(CommitDocumentResponseSchema, TransactionMutationMetaSchema) },
    },
    handler: (request, reply) => {
      const { householdId, userId } = authContext(request);
      const result = runIdempotent(
        db,
        clock,
        householdId,
        `POST /documents/${request.params.id}/commit`,
        request.headers['idempotency-key'],
        request.body,
        () => ({
          statusCode: 201,
          body: commitDocument(db, clock, householdId, userId, request.params.id, request.body),
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
    url: '/:id/discard',
    schema: {
      params: DocumentParamsSchema,
      response: { 200: apiResponse(DocumentDtoSchema) },
    },
    handler: (request) => ({
      data: discardDocument(deps, authContext(request).householdId, request.params.id),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'DELETE',
    url: '/:id',
    schema: { params: DocumentParamsSchema },
    handler: async (request, reply) => {
      await deleteDocument(deps, authContext(request).householdId, request.params.id);
      await reply.status(204).send();
    },
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/:id/file',
    schema: { params: DocumentParamsSchema, querystring: FileQuerySchema },
    handler: async (request, reply) => {
      const file = await getDocumentFile(
        deps,
        authContext(request).householdId,
        request.params.id,
        request.query.variant,
      );
      // PDF jako załącznik: przeglądarkowy czytnik PDF-ów pod naszym pochodzeniem to
      // zbędne ryzyko, a wyciąg i tak otwiera się w osobnej aplikacji.
      const disposition = file.mimeType === 'application/pdf' ? 'attachment' : 'inline';
      return reply
        .header('content-type', file.mimeType)
        .header('content-disposition', `${disposition}; filename="${file.filename}"`)
        .header('cache-control', 'private, max-age=3600')
        .send(file.bytes);
    },
  });
};
