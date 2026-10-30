import { HealthSchema } from '@fineapp/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { DbHandle } from '../db/client.js';

/**
 * Trasa zdrowia — `GET /api/v1/health`, bez autoryzacji.
 *
 * Używana przez `HEALTHCHECK` Dockera i przez zewnętrzny monitor
 * ([10 §8](../../../../plans/10-deployment.md)). `dbOk` jest tu najważniejsze: kontener,
 * który wstał, ale nie widzi bazy, jest bezużyteczny, a bez tego pola wyglądałby
 * na zdrowy.
 *
 * @param app - Instancja Fastify z type providerem Zod.
 * @param options - Zależności trasy.
 * @param options.db - Uchwyt bazy.
 * @param options.version - Wersja aplikacji.
 * @param options.startedAt - Znacznik startu procesu, do wyliczenia czasu działania.
 * @param done - Sygnał zakończenia rejestracji.
 *
 * Wariant synchroniczny (`Callback`, nie `Async`), bo rejestracja niczego nie czeka —
 * `02 §8` zabrania opakowywania w `Promise` na zapas. Moduły wykonujące przy starcie
 * I/O używają wariantu `Async`.
 */
export const healthRoutes: FastifyPluginCallbackZod<{
  db: DbHandle;
  version: string;
  startedAt: number;
}> = (app, options, done) => {
  app.route({
    method: 'GET',
    url: '/',
    schema: { response: { 200: HealthSchema } },
    handler: () => {
      let dbOk = false;
      try {
        // Najtańsze możliwe zapytanie, które naprawdę dotyka pliku bazy.
        options.db.sqlite.prepare('SELECT 1').get();
        dbOk = true;
      } catch (error) {
        app.log.error({ err: error }, 'Zapytanie kontrolne do bazy nie powiodło się');
      }

      return {
        status: 'ok' as const,
        version: options.version,
        dbOk,
        uptimeSeconds: Math.floor((Date.now() - options.startedAt) / 1000),
      };
    },
  });

  done();
};
