import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ForbiddenError } from '../../core/errors.js';

/**
 * Ochrona przed CSRF — nagłówek niestandardowy
 * ([09 §5](../../../../../plans/09-security-auth.md#5-ochrona-csrf)).
 *
 * To jest **druga z trzech warstw**. Pierwsza to `SameSite=Lax` na ciasteczku, trzecia —
 * ścieżka ciasteczka zawężona do `/api/v1/auth`. Klasyczny token CSRF byłby czwartą;
 * przy tych trzech uznajemy go za zbędny.
 *
 * Dlaczego akurat nagłówek: prosty formularz `<form method="post">` z obcej strony
 * **nie potrafi** ustawić własnego nagłówka, a `fetch`, który potrafi, musiałby najpierw
 * przejść kontrolę CORS — której nie przejdzie, bo lista dozwolonych pochodzeń jest jawna.
 */

/** Nazwa nagłówka wymaganego przy metodach zmieniających stan. */
export const CSRF_HEADER = 'x-requested-with';

/** Wartość nagłówka. */
export const CSRF_HEADER_VALUE = 'fineapp';

/** Metody, które nie zmieniają stanu, więc nie wymagają nagłówka. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Rejestruje kontrolę nagłówka CSRF.
 *
 * Hook siedzi na `onRequest`, czyli **przed** parsowaniem ciała: żądanie z obcej strony
 * ma zostać odbite, zanim serwer wykona na nim jakąkolwiek pracę.
 *
 * @param app - Instancja Fastify.
 */
export function registerCsrfGuard(app: FastifyInstance): void {
  app.addHook('onRequest', (request: FastifyRequest, _reply: FastifyReply, done) => {
    if (SAFE_METHODS.has(request.method)) {
      done();
      return;
    }

    if (request.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
      done(new ForbiddenError(`Żądanie musi nieść nagłówek ${CSRF_HEADER}: ${CSRF_HEADER_VALUE}.`));
      return;
    }

    done();
  });
}
