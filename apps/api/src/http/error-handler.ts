import type { ApiErrorDetail } from '@fineapp/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';

import { isAppError, RateLimitError, type ErrorCode } from '../core/errors.js';
import { sendSpaShell, wantsSpaShell } from './spa.js';

/**
 * Zamiana błędu na kontrakt odpowiedzi z [04 §3](../../../../plans/04-api-spec.md#3-format-błędów).
 *
 * Jedno miejsce, w którym błąd staje się JSON-em. Dzięki temu trasa rzuca
 * `NotFoundError('Nie znaleziono konta.')` i nie musi wiedzieć nic o kształcie
 * odpowiedzi ani o statusie HTTP.
 *
 * **Błąd nierozpoznany nigdy nie wynosi szczegółów na zewnątrz.** Komunikat jest
 * ogólny, a pełny stos trafia wyłącznie do logu
 * ([02 §7](../../../../plans/02-architecture.md#7-obsługa-błędów)) — inaczej pierwszy
 * nieobsłużony wyjątek zdradziłby ścieżki na dysku albo fragment zapytania SQL.
 */

/** Kształt ciała odpowiedzi błędu. */
interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: readonly ApiErrorDetail[];
    retryAfterSeconds?: number;
    requestId: string;
  };
}

/**
 * Składa ciało odpowiedzi błędu.
 *
 * @param code - Kod domenowy.
 * @param message - Komunikat po polsku.
 * @param requestId - Identyfikator żądania.
 * @param details - Szczegóły do podświetlenia pól formularza.
 * @param retryAfterSeconds - Ile sekund czekać; wyłącznie przy `RATE_LIMITED`.
 * @returns Ciało zgodne z kontraktem.
 */
function body(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: readonly ApiErrorDetail[],
  retryAfterSeconds?: number,
): ErrorBody {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details ? { details } : {}),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  };
}

/**
 * Zamienia problemy walidacji Zoda na listę wskazującą pola formularza.
 *
 * Ścieżka jest przycinana z przedrostka, który dokłada Fastify (`body/`, `querystring/`),
 * bo front podświetla pole po jego nazwie w formularzu, a nie po miejscu w żądaniu.
 *
 * @param error - Błąd walidacji z type providera.
 * @returns Lista `{ path, message }`.
 */
function toDetails(error: FastifyError): ApiErrorDetail[] {
  if (!hasZodFastifySchemaValidationErrors(error)) return [];
  return error.validation.map((issue) => ({
    path: issue.params.issue.path.join('.') || issue.instancePath.replace(/^\//, ''),
    message: issue.params.issue.message,
  }));
}

/**
 * Rejestruje globalną obsługę błędów i odpowiedzi 404.
 *
 * @param app - Instancja Fastify.
 * @param options - Opcje obsługi.
 * @param options.spa - Czy nieznane adresy aplikacji dostają `index.html`.
 */
export function registerErrorHandler(app: FastifyInstance, options: { spa?: boolean } = {}): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    // Odświeżenie strony na `/m/2026-09` to żądanie adresu, którego serwer nie zna —
    // trasy zna tylko router frontu, więc dostaje powłokę aplikacji (`F8-7`).
    if (options.spa === true && wantsSpaShell(request)) {
      void sendSpaShell(reply);
      return;
    }
    void reply.status(404).send(body('NOT_FOUND', 'Nie znaleziono zasobu.', request.id));
  });

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // 1. Błędy aplikacyjne — kod, status i komunikat już są, wystarczy je przepisać.
    if (isAppError(error)) {
      request.log.info({ code: error.code, statusCode: error.statusCode }, 'Błąd aplikacyjny');
      if (error instanceof RateLimitError && error.retryAfterSeconds !== undefined) {
        // Nagłówek `Retry-After` jest standardem HTTP i czytają go pośredniki;
        // to samo ląduje w ciele, bo front czyta odpowiedź, nie nagłówki (04 §4).
        void reply.header('retry-after', String(error.retryAfterSeconds));
      }
      void reply
        .status(error.statusCode)
        .send(
          body(
            error.code,
            error.message,
            request.id,
            error.details,
            error instanceof RateLimitError ? error.retryAfterSeconds : undefined,
          ),
        );
      return;
    }

    // 2. Walidacja wejścia przez schemat Zod.
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = toDetails(error);
      request.log.info({ details }, 'Błąd walidacji żądania');
      void reply
        .status(400)
        .send(body('VALIDATION_ERROR', 'Żądanie zawiera nieprawidłowe dane.', request.id, details));
      return;
    }

    // 3. Odpowiedź niezgodna z własnym schematem. To jest błąd serwera, nie klienta —
    //    i to taki, który bez tego rozgałęzienia wyglądałby jak zwykła awaria.
    if (isResponseSerializationError(error)) {
      request.log.error(
        { err: error, route: error.method, url: error.url },
        'Odpowiedź niezgodna ze schematem',
      );
      void reply
        .status(500)
        .send(body('INTERNAL_ERROR', 'Wystąpił nieoczekiwany błąd.', request.id));
      return;
    }

    // 4. Błędy rzucane przez wtyczki Fastify niosą własny status — uszanujmy go,
    //    ale komunikat i tak podajemy swój, po polsku.
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode === 429) {
      // `@fastify/rate-limit` ustawia standardowy nagłówek `Retry-After`; to samo
      // przepisujemy do ciała, bo front czyta odpowiedź, a nie nagłówki (04 §4).
      const header = reply.getHeader('retry-after');
      const retryAfterSeconds = typeof header === 'string' ? Number(header) : header;
      request.log.warn({ url: request.url }, 'Przekroczony limit żądań');
      void reply
        .status(429)
        .send(
          body(
            'RATE_LIMITED',
            'Zbyt wiele żądań. Spróbuj za chwilę.',
            request.id,
            undefined,
            typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds)
              ? Math.max(0, Math.round(retryAfterSeconds))
              : undefined,
          ),
        );
      return;
    }
    if (statusCode >= 400 && statusCode < 500) {
      request.log.info({ statusCode, code: error.code }, 'Błędne żądanie');
      void reply
        .status(statusCode)
        .send(body('VALIDATION_ERROR', 'Żądanie zawiera nieprawidłowe dane.', request.id));
      return;
    }

    // 5. Cokolwiek innego. Pełny stos do logu, na zewnątrz wyłącznie `requestId`.
    request.log.error({ err: error }, 'Nieobsłużony błąd');
    void reply.status(500).send(body('INTERNAL_ERROR', 'Wystąpił nieoczekiwany błąd.', request.id));
  });
}
