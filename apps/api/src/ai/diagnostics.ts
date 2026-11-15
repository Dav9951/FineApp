import type { ExtractionDiagnostics } from './document-extractor.js';

/**
 * Opis błędu do dziennika odczytu (ADR-086) — wspólny dla ekstraktora i modułu dokumentów.
 */

/** Najdłuższy fragment komunikatu błędu zapisywany w dzienniku. */
export const API_MESSAGE_MAX = 300;

/**
 * Klasa i komunikat błędu, bez stosu.
 *
 * Klasa odróżnia przekroczenie czasu (`APIConnectionTimeoutError`) od zerwanego
 * połączenia i od odpowiedzi `4xx/5xx`; komunikat jest przycięty, bo czyta go człowiek
 * w dzienniku, a nie parser. Ani komunikat błędu SDK, ani błędu aplikacji nie niesie
 * treści dokumentu ani klucza.
 *
 * @param error - Dowolny rzucony błąd.
 * @returns `errorType` i `apiMessage`.
 */
export function errorDiagnostics(error: unknown): ExtractionDiagnostics {
  return {
    errorType: error instanceof Error ? error.constructor.name : typeof error,
    apiMessage: (error instanceof Error ? error.message : String(error)).slice(0, API_MESSAGE_MAX),
  };
}
