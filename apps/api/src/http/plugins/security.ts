import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

import type { Config } from '../../core/config.js';

/**
 * Wtyczki bezpieczeństwa: nagłówki, CORS, ciasteczka, limit żądań.
 *
 * Polityka CSP pochodzi z [09 §6](../../../../../plans/09-security-auth.md#6-nagłówki-bezpieczeństwa).
 * Warto zwrócić uwagę na `connectSrc: ['self']` — front nie odwołuje się nigdzie poza
 * własne pochodzenie. Wywołania do Anthropic wychodzą z backendu, co jest jednym
 * z powodów, dla których klucz API nigdy nie trafia do przeglądarki.
 */

/** Polityka bezpieczeństwa treści ([09 §6](../../../../../plans/09-security-auth.md)). */
export const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  // Wymagane przez style inline Tailwinda.
  styleSrc: ["'self'", "'unsafe-inline'"],
  // `blob:` i `data:` — podgląd zdjęcia paragonu przed wysyłką.
  imgSrc: ["'self'", 'data:', 'blob:'],
  connectSrc: ["'self'"],
  fontSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
} as const;

/** Domyślny limit żądań spoza ścieżek uwierzytelniania ([04 §17](../../../../../plans/04-api-spec.md)). */
const DEFAULT_RATE_LIMIT = { max: 300, timeWindow: '1 minute' } as const;

/**
 * Rejestruje wtyczki bezpieczeństwa.
 *
 * @param app - Instancja Fastify.
 * @param config - Konfiguracja aplikacji.
 */
export async function registerSecurity(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { ...CSP_DIRECTIVES } },
    // HSTS ma sens wyłącznie przy HTTPS; w dev wysłałby nagłówek, który zablokowałby
    // localhost po HTTP na czas jego ważności.
    hsts: config.isProduction,
    referrerPolicy: { policy: 'same-origin' },
    frameguard: { action: 'deny' },
    noSniff: true,
  });

  await app.register(cors, {
    // Front i API stoją pod tym samym adresem w produkcji; w dev Vite proxuje `/api`.
    // Jawna lista zamiast `true` — `credentials` z dowolnym pochodzeniem to zaproszenie
    // do kradzieży ciasteczka sesji.
    origin: [config.server.appUrl],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key'],
  });

  await app.register(cookie, {
    secret: config.auth.jwtSecret,
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.auth.cookieSecure,
      ...(config.auth.cookieDomain ? { domain: config.auth.cookieDomain } : {}),
    },
  });

  await app.register(rateLimit, {
    ...DEFAULT_RATE_LIMIT,
    // `/health` odpytuje healthcheck Dockera co 30 s — limitowanie go nie ma sensu,
    // a wyczerpanie limitu ubiłoby kontener.
    allowList: (request) => request.url.startsWith('/api/v1/health'),
  });
}
