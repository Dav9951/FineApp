import {
  AiUsageDtoSchema,
  apiResponse,
  ExportCsvQuerySchema,
  ExportDtoSchema,
  HouseholdDtoSchema,
  ResetDataRequestSchema,
  ResetDataResultSchema,
  SettingsDtoSchema,
  UpdateHouseholdRequestSchema,
  UpdateProfileRequestSchema,
  UserDtoSchema,
} from '@fineapp/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import { getAiUsage } from '../documents/documents.service.js';
import {
  changeHousehold,
  changeProfile,
  exportCsv,
  exportJson,
  getSettings,
  resetData,
  type SettingsDeps,
} from './settings.service.js';

/**
 * Nagłówek `Content-Disposition` pliku do pobrania.
 *
 * Nazwa pliku składa się wyłącznie z ASCII (`fineapp-2026-09.csv`), więc wystarcza
 * zwykły parametr `filename` bez wariantu `filename*` dla UTF-8.
 *
 * @param fileName - Nazwa pliku.
 * @returns Wartość nagłówka.
 */
function attachment(fileName: string): string {
  return `attachment; filename="${fileName}"`;
}

/**
 * Trasy ustawień — `/api/v1/settings`
 * ([04 §15](../../../../../../plans/04-api-spec.md#15-ustawienia--apiv1settings)).
 *
 * Eksporty idą **bez koperty `{ data }`**: odpowiedź jest plikiem, który użytkownik
 * zapisuje na dysku, więc ma wyglądać jak plik, a nie jak odpowiedź API. Nie trafiają
 * też do pamięci podręcznej (`no-store`) — zawierają pełny obraz finansów.
 *
 * @param app - Instancja Fastify z type providerem Zod.
 * @param options - Zależności modułu.
 * @param options.db - Uchwyt bazy.
 * @param options.config - Konfiguracja aplikacji.
 * @param options.clock - Źródło czasu.
 * @param options.version - Wersja aplikacji (sekcja „O aplikacji", plik eksportu).
 * @param done - Sygnał zakończenia rejestracji.
 */
export const settingsRoutes: FastifyPluginCallbackZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
  version: string;
}> = (app, options, done) => {
  const { db, config, clock, version } = options;
  const deps: SettingsDeps = { db, clock, version, uploadDir: config.uploads.dir };
  const protectedRoute = { onRequest: requireAuth(config, clock) };

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/',
    schema: { response: { 200: apiResponse(SettingsDtoSchema) } },
    handler: (request) => ({ data: getSettings(deps, authContext(request)) }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/household',
    schema: {
      body: UpdateHouseholdRequestSchema,
      response: { 200: apiResponse(HouseholdDtoSchema) },
    },
    handler: (request) => ({
      data: changeHousehold(deps, authContext(request).householdId, request.body),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/profile',
    schema: {
      body: UpdateProfileRequestSchema,
      response: { 200: apiResponse(UserDtoSchema) },
    },
    handler: (request) => ({
      data: changeProfile(deps, authContext(request), request.body),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/export',
    schema: { response: { 200: ExportDtoSchema } },
    handler: (request, reply) => {
      const file = exportJson(deps, authContext(request).householdId);
      void reply
        .header('content-disposition', attachment(file.fileName))
        .header('cache-control', 'no-store');
      return file.body;
    },
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/export.csv',
    schema: { querystring: ExportCsvQuerySchema },
    handler: (request, reply) => {
      const file = exportCsv(deps, authContext(request).householdId, request.query.month);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', attachment(file.fileName))
        .header('cache-control', 'no-store')
        .send(file.body);
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/reset',
    schema: {
      body: ResetDataRequestSchema,
      response: { 200: apiResponse(ResetDataResultSchema) },
    },
    handler: async (request) => ({
      data: await resetData(deps, authContext(request), request.body),
    }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/ai-usage',
    schema: { response: { 200: apiResponse(AiUsageDtoSchema) } },
    handler: (request) => ({
      data: getAiUsage({ db, config, clock }, authContext(request).householdId),
    }),
  });

  done();
};
