import { pino, type Logger, type LoggerOptions } from 'pino';

import type { Config } from './config.js';

/**
 * Logger aplikacji (pino), z listą pól, które nigdy nie trafiają do logu.
 *
 * [02 §7](../../../../plans/02-architecture.md#7-obsługa-błędów) zabrania logowania
 * PIN-ów, hashy, tokenów, treści dokumentów i jawnych adresów e-mail przy nieudanym
 * logowaniu. Lista `redact` niżej jest wykonawczą wersją tego zdania: zakaz oparty
 * wyłącznie na dyscyplinie autora przestaje działać przy pierwszym
 * `log.info({ user })` w pośpiechu.
 *
 * Czego ta lista **nie** załatwia: adresów e-mail. Pole `email` bywa potrzebne
 * w logu (utworzenie użytkownika), a zabronione gdzie indziej (nieudane logowanie —
 * tam wyłącznie hash z solą `IP_HASH_SALT`). Odpowiada za to moduł `auth`, nie logger.
 */

/**
 * Ścieżki wycinane z każdego wpisu.
 *
 * `*.` na początku oznacza „na dowolnym poziomie zagnieżdżenia" — dzięki temu
 * `log.info({ session: { refreshToken } })` jest równie bezpieczne jak
 * `log.info({ refreshToken })`.
 */
const REDACTED_PATHS = [
  'pin',
  '*.pin',
  'pinHash',
  '*.pinHash',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'jwtSecret',
  '*.jwtSecret',
  'apiKey',
  '*.apiKey',
  'password',
  '*.password',
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

/** Znacznik wstawiany w miejsce wyciętej wartości. */
const CENSOR = '[usunięte]';

/**
 * Tworzy logger na podstawie konfiguracji.
 *
 * W trybie innym niż produkcyjny wpina `pino-pretty`, żeby log w terminalu dało się
 * czytać. W produkcji zostaje JSON w jednej linii — tego oczekuje rotacja
 * `json-file` w Dockerze ([10](../../../../plans/10-deployment.md)).
 *
 * @param config - Konfiguracja aplikacji.
 * @returns Opcje pino gotowe do przekazania Fastify albo do `pino()`.
 */
export function loggerOptions(config: Config): LoggerOptions {
  const options: LoggerOptions = {
    level: config.server.logLevel,
    redact: { paths: REDACTED_PATHS, censor: CENSOR },
    // Domyślnie pino wypisuje `level: 30`; nazwa jest czytelna dla człowieka,
    // a `docker compose logs` czyta człowiek.
    formatters: {
      level: (label) => ({ level: label }),
    },
    base: undefined,
  };

  if (config.isProduction) return options;

  return {
    ...options,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
    },
  };
}

/**
 * Tworzy logger na podstawie konfiguracji.
 *
 * Używany poza HTTP — przez runner migracji i seed. Serwer dostaje same **opcje**
 * ({@link loggerOptions}) i buduje pino sam: Fastify 5 przyjmuje gotową instancję pod
 * `loggerInstance`, ale wtedy parametryzuje swój typ konkretnym loggerem, przez co
 * każda funkcja przyjmująca `FastifyInstance` przestaje pasować.
 *
 * @param config - Konfiguracja aplikacji.
 * @returns Instancja loggera.
 */
export function createLogger(config: Config): Logger {
  return pino(loggerOptions(config));
}

/**
 * Tworzy logger, który niczego nie wypisuje — do testów.
 *
 * @returns Instancja loggera na poziomie `silent`.
 */
export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}

export type { Logger };
