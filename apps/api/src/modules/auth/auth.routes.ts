import {
  apiResponse,
  AuthAckSchema,
  ChangePinRequestSchema,
  IdSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  MeResponseSchema,
  RefreshResponseSchema,
  SessionDtoSchema,
} from '@fineapp/shared';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { authContext, requireAuth } from '../../http/middleware/require-auth.js';
import { sha256Hex } from './auth.hash.js';
import { findSessionByTokenHash } from './auth.repository.js';
import {
  changePin,
  listSessions,
  logout,
  logoutOthers,
  login,
  me,
  refreshSession,
  revokeSessionFamily,
} from './auth.service.js';
import { UnauthorizedError } from '../../core/errors.js';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, refreshCookieOptions } from './auth.tokens.js';

/**
 * Trasy uwierzytelniania — `/api/v1/auth`
 * ([04 §4](../../../../../../plans/04-api-spec.md#4-auth--apiv1auth)).
 *
 * Trasa nie dotyka bazy: cała logika siedzi w serwisie
 * ([02 §3](../../../../../../plans/02-architecture.md#3-warstwy-i-kierunek-zależności)).
 * Tutaj zostaje to, co naprawdę należy do warstwy HTTP: schematy żądania i odpowiedzi,
 * odczyt adresu IP oraz nagłówka `User-Agent`, i ustawienie ciasteczka.
 */

/** Maksymalna długość `User-Agent` zapisywana w sesji. */
const USER_AGENT_LIMIT = 255;

/**
 * Rejestruje trasy uwierzytelniania.
 *
 * @param app - Instancja Fastify z type providerem Zod.
 * @param options - Zależności modułu.
 * @param options.db - Uchwyt bazy.
 * @param options.config - Konfiguracja aplikacji.
 * @param options.clock - Źródło czasu.
 * @param done - Sygnał zakończenia rejestracji.
 */
export const authRoutes: FastifyPluginCallbackZod<{
  db: DbHandle;
  config: Config;
  clock: Clock;
}> = (app, options, done) => {
  app.route({
    method: 'POST',
    url: '/login',
    schema: {
      body: LoginRequestSchema,
      response: { 200: apiResponse(LoginResponseSchema) },
    },
    handler: async (request, reply) => {
      const userAgent = request.headers['user-agent'];

      const { response, refreshToken } = await login(options.db, options.config, options.clock, {
        email: request.body.email,
        pin: request.body.pin,
        ...(request.body.deviceLabel === undefined
          ? {}
          : { deviceLabel: request.body.deviceLabel }),
        // `request.ip` respektuje `trustProxy`, które w produkcji jest włączone —
        // bez tego limit na adres widziałby jeden adres reverse proxy dla wszystkich.
        ip: request.ip,
        ...(userAgent === undefined ? {} : { userAgent: userAgent.slice(0, USER_AGENT_LIMIT) }),
      });

      // Token odświeżający wychodzi **wyłącznie** w ciasteczku `httpOnly`; w ciele
      // odpowiedzi go nie ma, więc skrypt na stronie go nie odczyta (09 §3.1).
      void reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(options.config));
      return { data: response };
    },
  });

  app.route({
    method: 'POST',
    url: '/refresh',
    config: {
      // 60 odświeżeń na godzinę **na sesję** ([04 §12](../../../../../../plans/04-api-spec.md)).
      // Access token żyje 15 minut, więc normalne użycie to cztery odświeżenia na godzinę;
      // sześćdziesiąt zostawia zapas na kilka kart naraz i nadal zatrzymuje pętlę, która
      // próbowałaby mielić tokeny w kółko.
      rateLimit: {
        max: 60,
        timeWindow: '1 hour',
        // Kluczem jest **rodzina**, nie token: rotacja zmienia token przy każdym
        // odświeżeniu, więc licznik po hashu tokenu nigdy by się nie zsumował
        // i limit nie działałby wcale. Odczyt idzie po indeksie `uq_auth_sessions_token`
        // — ten sam, którego użyje zaraz obsługa trasy.
        //
        // Gdy tokenu nie ma albo jest nieznany, kluczem zostaje adres IP: inaczej
        // wszystkie nieudane próby zlałyby się w jeden licznik.
        keyGenerator: (request: FastifyRequest) => {
          const presented = request.cookies[REFRESH_COOKIE_NAME];
          if (presented === undefined) return request.ip;
          const session = findSessionByTokenHash(options.db, sha256Hex(presented));
          return session?.familyId ?? request.ip;
        },
      },
    },
    schema: { response: { 200: apiResponse(RefreshResponseSchema) } },
    handler: async (request, reply) => {
      const presented = request.cookies[REFRESH_COOKIE_NAME];
      if (presented === undefined) {
        throw new UnauthorizedError('Sesja wygasła. Zaloguj się ponownie.');
      }

      const userAgent = request.headers['user-agent'];
      const { response, refreshToken } = await refreshSession(
        options.db,
        options.config,
        options.clock,
        {
          refreshToken: presented,
          ip: request.ip,
          ...(userAgent === undefined ? {} : { userAgent: userAgent.slice(0, USER_AGENT_LIMIT) }),
        },
        (event) => {
          // Zdarzenie idzie do logu jako ostrzeżenie: to jedyny ślad po kradzieży
          // ciasteczka, jaki zostaje. Bez identyfikatorów osobowych — same ULID-y.
          request.log.warn(event, 'Ponowne użycie tokenu odświeżającego — sesje unieważnione');
        },
      );

      // Pusty token znaczy „to był wyścig dwóch kart" — ciasteczka nie ruszamy,
      // bo zwycięzca wyścigu zdążył już zapisać w nim swój (09 §3.3).
      if (refreshToken !== '') {
        void reply.setCookie(
          REFRESH_COOKIE_NAME,
          refreshToken,
          refreshCookieOptions(options.config),
        );
      }
      return { data: response };
    },
  });

  app.route({
    method: 'POST',
    url: '/logout',
    schema: { response: { 200: apiResponse(z.object({ loggedOut: z.boolean() })) } },
    handler: (request, reply) => {
      logout(options.db, request.cookies[REFRESH_COOKIE_NAME]);
      // Ciasteczko kasujemy zawsze, także gdy sesji już nie było — wylogowanie ma być
      // idempotentne i nie może zostawić klienta z nieważnym ciasteczkiem w kieszeni.
      void reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      return { data: { loggedOut: true } };
    },
  });

  // ==== Trasy wymagające zalogowania ====
  //
  // `requireAuth` jest podpinane **per trasa**, a nie hookiem całego pluginu: `/login`,
  // `/refresh` i `/logout` są jedynymi trasami aplikacji, które tokenu nie mają
  // (09 §4), więc to one byłyby wyjątkiem od hooka — a wyjątek od reguły
  // bezpieczeństwa łatwiej przeoczyć niż jej jawne włączenie.
  //
  // Faza `onRequest`, nie `preHandler` (ADR-031): walidacja ciała biegnie przed
  // `preHandler`, więc `PATCH /pin` bez tokenu i ze złym ciałem dostawało `400`
  // zamiast `401`.
  const protectedRoute = { onRequest: requireAuth(options.config, options.clock) };

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/me',
    schema: { response: { 200: apiResponse(MeResponseSchema) } },
    handler: (request) => ({ data: me(options.db, authContext(request).userId) }),
  });

  app.route({
    ...protectedRoute,
    method: 'GET',
    url: '/sessions',
    schema: { response: { 200: apiResponse(SessionDtoSchema.array()) } },
    handler: (request) => {
      const auth = authContext(request);
      return {
        data: listSessions(options.db, options.config, options.clock, {
          userId: auth.userId,
          sessionId: auth.sessionId,
          ip: request.ip,
        }),
      };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'DELETE',
    url: '/sessions/:id',
    schema: {
      params: z.object({ id: IdSchema }),
      response: { 200: apiResponse(AuthAckSchema) },
    },
    handler: (request, reply) => {
      const auth = authContext(request);
      const affected = revokeSessionFamily(
        options.db,
        options.clock,
        auth.userId,
        request.params.id,
      );

      // Wylogowanie samego siebie z listy urządzeń musi też zabrać ciasteczko —
      // inaczej przeglądarka zostałaby z tokenem, którego nie ma już w bazie.
      if (request.params.id === auth.sessionId) {
        void reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      }
      return { data: { affected } };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'POST',
    url: '/logout-all',
    schema: { response: { 200: apiResponse(AuthAckSchema) } },
    handler: (request, reply) => {
      const affected = logoutOthers(options.db, authContext(request).userId);
      void reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      return { data: { affected } };
    },
  });

  app.route({
    ...protectedRoute,
    method: 'PATCH',
    url: '/pin',
    schema: {
      body: ChangePinRequestSchema,
      response: { 200: apiResponse(AuthAckSchema) },
    },
    handler: async (request) => {
      const auth = authContext(request);
      const affected = await changePin(
        options.db,
        options.config,
        options.clock,
        { userId: auth.userId, sessionId: auth.sessionId },
        request.body,
      );
      return { data: { affected } };
    },
  });

  done();
};
