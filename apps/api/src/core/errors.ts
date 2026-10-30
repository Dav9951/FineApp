import type { ApiErrorDetail } from '@fineapp/shared';

/**
 * Jedna hierarchia błędów aplikacyjnych.
 *
 * Każdy błąd niesie trzy rzeczy: kod domenowy z kontraktu API
 * ([04 §3](../../../../plans/04-api-spec.md#3-format-błędów)), status HTTP oraz
 * komunikat **po polsku, gotowy do pokazania użytkownikowi**. Dzięki temu
 * `http/error-handler.ts` nie musi niczego tłumaczyć ani zgadywać — przepisuje pola
 * jeden do jednego.
 *
 * Warstwa repozytoriów tych błędów **nie rzuca** — nie zna HTTP
 * ([02 §3](../../../../plans/02-architecture.md#3-warstwy-i-kierunek-zależności)).
 */

/** Kody błędów z kontraktu API. Zamknięty zbiór — front rozgałęzia się po nich. */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'DOMAIN_RULE_VIOLATION'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'AI_BUDGET_EXCEEDED'
  | 'INTERNAL_ERROR';

/**
 * Bazowy błąd aplikacyjny z kodem domenowym i statusem HTTP.
 *
 * Podklasy ustalają `code` i `statusCode` na sztywno, więc miejsce rzucenia podaje
 * wyłącznie to, co naprawdę zależy od sytuacji: komunikat i opcjonalne szczegóły.
 * Gdyby kod i status trzeba było podawać przy każdym rzuceniu, prędzej czy później
 * pojawiłby się `NotFoundError` ze statusem 400.
 */
export class AppError extends Error {
  /**
   * @param code - Kod domenowy z kontraktu API.
   * @param message - Komunikat po polsku, gotowy dla użytkownika.
   * @param statusCode - Status HTTP odpowiedzi.
   * @param details - Szczegóły do podświetlenia pól formularza; trafiają do odpowiedzi.
   */
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly statusCode: number,
    // Typ bierze się wprost z koperty odpowiedzi (`ApiErrorSchema` w `shared`), a nie
    // z `unknown`: przy `unknown` obsługa błędów musiała sprawdzać kształt w locie
    // i rzutować, czyli kontrakt pilnował się sam dopiero w czasie wykonania.
    readonly details?: readonly ApiErrorDetail[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Żądanie ma poprawny kształt, ale nie przeszło walidacji. HTTP 400. */
export class ValidationError extends AppError {
  /**
   * @param message - Komunikat po polsku.
   * @param details - Lista `{ path, message }` do podświetlenia pól.
   */
  constructor(message: string, details?: readonly ApiErrorDetail[]) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

/** Brak uwierzytelnienia albo token nie do przyjęcia. HTTP 401. */
export class UnauthorizedError extends AppError {
  /**
   * @param message - Komunikat po polsku.
   * @param details - Szczegóły dla klienta.
   */
  constructor(message = 'Nieprawidłowy e-mail lub PIN.', details?: readonly ApiErrorDetail[]) {
    super('UNAUTHORIZED', message, 401, details);
  }
}

/** Użytkownik uwierzytelniony, ale zasób należy do innego gospodarstwa. HTTP 403. */
export class ForbiddenError extends AppError {
  /**
   * @param message - Komunikat po polsku.
   * @param details - Szczegóły dla klienta.
   */
  constructor(message = 'Brak uprawnień do tego zasobu.', details?: readonly ApiErrorDetail[]) {
    super('FORBIDDEN', message, 403, details);
  }
}

/** Zasób nie istnieje albo jest poza gospodarstwem pytającego. HTTP 404. */
export class NotFoundError extends AppError {
  /**
   * @param message - Komunikat po polsku.
   * @param details - Szczegóły dla klienta.
   */
  constructor(message = 'Nie znaleziono zasobu.', details?: readonly ApiErrorDetail[]) {
    super('NOT_FOUND', message, 404, details);
  }
}

/** Konflikt stanu — naruszony warunek unikalności albo równoległa zmiana. HTTP 409. */
export class ConflictError extends AppError {
  /**
   * @param message - Komunikat po polsku.
   * @param details - Szczegóły dla klienta.
   */
  constructor(message: string, details?: readonly ApiErrorDetail[]) {
    super('CONFLICT', message, 409, details);
  }
}

/**
 * Przekroczony limit żądań lub prób logowania. HTTP 429.
 *
 * Czas oczekiwania jest **własnym polem**, nie elementem `details`: `details` to
 * jednorodna lista `{ path, message }`, z której front buduje mapę błędów pól
 * (`ApiRequestError.fieldErrors()`), a liczba sekund zepsułaby ją dla wszystkich
 * formularzy naraz ([04 §4](../../../../plans/04-api-spec.md#4-auth--apiv1auth)).
 */
export class RateLimitError extends AppError {
  /**
   * @param message - Komunikat po polsku.
   * @param retryAfterSeconds - Ile sekund czekać; trafia do ciała i do nagłówka `Retry-After`.
   * @param details - Szczegóły dla klienta.
   */
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
    details?: readonly ApiErrorDetail[],
  ) {
    super('RATE_LIMITED', message, 429, details);
  }
}

/**
 * Żądanie ma poprawny kształt, ale łamie niezmiennik domenowy. HTTP 422.
 *
 * To jest granica między walidacją a domeną: „kwota nie jest liczbą" to
 * `ValidationError`, a „przelew wymaga konta docelowego" — ten błąd.
 */
export class DomainRuleViolationError extends AppError {
  /**
   * @param message - Komunikat po polsku, nazywający złamaną regułę.
   * @param details - Szczegóły dla klienta.
   */
  constructor(message: string, details?: readonly ApiErrorDetail[]) {
    super('DOMAIN_RULE_VIOLATION', message, 422, details);
  }
}

/** Przesłany plik przekracza `UPLOAD_MAX_BYTES`. HTTP 413. */
export class FileTooLargeError extends AppError {
  /**
   * @param message - Komunikat po polsku.
   * @param details - Szczegóły dla klienta.
   */
  constructor(
    message = 'Plik jest za duży (max 10 MB). Zrób zdjęcie w niższej jakości.',
    details?: readonly ApiErrorDetail[],
  ) {
    super('FILE_TOO_LARGE', message, 413, details);
  }
}

/** Typ przesłanego pliku nie jest obsługiwany. HTTP 415. */
export class UnsupportedMediaTypeError extends AppError {
  /**
   * @param message - Komunikat po polsku.
   * @param details - Szczegóły dla klienta.
   */
  constructor(
    message = 'Obsługujemy zdjęcia (JPG, PNG, WebP, HEIC) i PDF.',
    details?: readonly ApiErrorDetail[],
  ) {
    super('UNSUPPORTED_MEDIA_TYPE', message, 415, details);
  }
}

/** Usługa zewnętrzna (Anthropic) odmówiła albo nie odpowiedziała. HTTP 502. */
export class ExternalServiceError extends AppError {
  /**
   * @param message - Komunikat po polsku.
   * @param details - Szczegóły dla klienta; **bez** treści odpowiedzi usługi.
   */
  constructor(message: string, details?: readonly ApiErrorDetail[]) {
    super('EXTERNAL_SERVICE_ERROR', message, 502, details);
  }
}

/**
 * Wyczerpany miesięczny limit kosztów OCR (`AI_MONTHLY_BUDGET_MINOR`). HTTP 402.
 *
 * Status 402 zamiast 429, bo to nie jest ograniczenie tempa — ponowienie za minutę
 * nic nie da ([08 §…](../../../../plans/08-ocr-ai-pipeline.md)).
 */
export class AiBudgetExceededError extends AppError {
  /**
   * @param message - Komunikat po polsku.
   * @param details - Szczegóły dla klienta.
   */
  constructor(message = 'Wyczerpano miesięczny limit OCR.', details?: readonly ApiErrorDetail[]) {
    super('AI_BUDGET_EXCEEDED', message, 402, details);
  }
}

/**
 * Błąd, którego nie przewidziano. HTTP 500.
 *
 * Komunikat jest celowo ogólny — szczegóły idą do logu, nie do odpowiedzi
 * ([02 §7](../../../../plans/02-architecture.md#7-obsługa-błędów)).
 */
export class InternalError extends AppError {
  /**
   * @param message - Komunikat po polsku, bez szczegółów technicznych.
   * @param details - Szczegóły dla klienta; zwykle pomijane.
   */
  constructor(message = 'Wystąpił nieoczekiwany błąd.', details?: readonly ApiErrorDetail[]) {
    super('INTERNAL_ERROR', message, 500, details);
  }
}

/**
 * Sprawdza, czy błąd pochodzi z naszej hierarchii.
 *
 * `instanceof AppError` wystarcza w jednym procesie, ale zawężenie `unknown` w bloku
 * `catch` (wymuszone przez `useUnknownInCatchVariables`) czyta się lepiej przez tę
 * funkcję niż przez rzutowanie.
 *
 * @param error - Wartość złapana w `catch`.
 * @returns `true`, gdy to błąd aplikacyjny z kodem i statusem.
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
