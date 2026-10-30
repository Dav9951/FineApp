import type { FastifyRequest } from 'fastify';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import { UnauthorizedError } from '../../core/errors.js';
import { verifyAccessToken } from '../../modules/auth/auth.tokens.js';

/**
 * Uwierzytelnienie żądania i kontekst gospodarstwa
 * ([09 §4](../../../../../plans/09-security-auth.md#4-autoryzacja)).
 *
 * Jedna reguła: **każde żądanie poza `/auth/login`, `/auth/refresh` i `/health` wymaga
 * ważnego access tokenu.**
 *
 * Po wykonaniu `request.auth` niesie identyfikatory użytkownika, gospodarstwa i sesji.
 * `householdId` pochodzi **wyłącznie stąd**, czyli z podpisanego tokenu — nigdy z ciała
 * żądania ani z parametru trasy. Nawet gdyby klient je przysłał, jest ignorowane
 * (reguła 4 z `CLAUDE.md`).
 *
 * Brak ról i uprawnień per zasób: zakres danych wynika w całości z `hid` w tokenie.
 * Zasób cudzego gospodarstwa zwraca `404`, nie `403` — nie potwierdzamy istnienia
 * cudzych danych.
 */

/** Kontekst uwierzytelnionego żądania. */
export interface AuthContext {
  /** Identyfikator użytkownika (`sub`). */
  readonly userId: string;
  /** Identyfikator gospodarstwa (`hid`) — zakres wszystkich zapytań. */
  readonly householdId: string;
  /** Identyfikator rodziny sesji (`sid`). */
  readonly sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Kontekst uwierzytelnienia; obecny dopiero po `requireAuth`. */
    auth?: AuthContext;
  }
}

/** Prefiks schematu uwierzytelnienia w nagłówku `Authorization`. */
const BEARER = 'Bearer ';

/**
 * Wyciąga token z nagłówka `Authorization`.
 *
 * @param request - Żądanie Fastify.
 * @returns Token albo `undefined`.
 */
function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith(BEARER)) return undefined;
  const token = header.slice(BEARER.length).trim();
  return token.length === 0 ? undefined : token;
}

/**
 * Buduje funkcję sprawdzającą uwierzytelnienie.
 *
 * Zwracaną funkcję podpina się jako `onRequest` trasy (ADR-027, ADR-031). Faza ma
 * znaczenie: `onRequest` biegnie **przed** parsowaniem i walidacją ciała, więc żądanie
 * bez tokenu dostaje `401`, a nie `400` za kształt ciała, którego i tak nie wolno mu
 * było wysłać.
 *
 * @param config - Konfiguracja aplikacji (sekret podpisu).
 * @param clock - Źródło czasu; decyduje o tym, czy token wygasł.
 * @returns Hook `onRequest` ustawiający `request.auth`.
 */
export function requireAuth(
  config: Config,
  clock: Clock,
): (request: FastifyRequest) => Promise<void> {
  return async (request: FastifyRequest): Promise<void> => {
    const token = bearerToken(request);
    if (token === undefined) {
      throw new UnauthorizedError('Brak tokenu dostępu. Zaloguj się.');
    }

    const claims = await verifyAccessToken(config, token, clock.now());
    request.auth = {
      userId: claims.sub,
      householdId: claims.hid,
      sessionId: claims.sid,
    };
  };
}

/**
 * Zwraca kontekst uwierzytelnienia albo rzuca.
 *
 * Istnieje po to, żeby obsługa trasy nie musiała zawężać `request.auth` z `undefined`
 * przy każdym użyciu. Rzucenie tutaj znaczy, że trasa zapomniała o `requireAuth` —
 * jest to **błąd programisty**, ale lepiej, żeby skończył się odmową dostępu niż
 * zapytaniem bez ograniczenia do gospodarstwa.
 *
 * @param request - Żądanie Fastify.
 * @returns Kontekst uwierzytelnienia.
 * @throws {UnauthorizedError} Gdy trasa nie przeszła przez `requireAuth`.
 */
export function authContext(request: FastifyRequest): AuthContext {
  if (request.auth === undefined) {
    request.log.error({ url: request.url }, 'Trasa bez requireAuth sięgnęła po kontekst');
    throw new UnauthorizedError('Brak tokenu dostępu. Zaloguj się.');
  }
  return request.auth;
}
