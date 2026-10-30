import { z } from 'zod';

/**
 * Koperta odpowiedzi API — identyczna dla wszystkich endpointów
 * ([05 §3](../../../../plans/05-dto-contracts.md#3-koperta-odpowiedzi--dtoenvelopets)).
 *
 * Sukces to zawsze `{ data }` albo `{ data, meta }`, błąd zawsze `{ error }`. Front może
 * dzięki temu rozgałęziać się po obecności jednego klucza, zamiast zgadywać kształt
 * odpowiedzi osobno dla każdej trasy.
 */

/**
 * Opakowuje schemat danych w standardową kopertę odpowiedzi.
 *
 * @param dataSchema - Schemat ładunku.
 * @param metaSchema - Opcjonalny schemat metadanych.
 * @returns Schemat pełnej odpowiedzi API.
 */
export function apiResponse<TData extends z.ZodTypeAny, TMeta extends z.ZodTypeAny>(
  dataSchema: TData,
  metaSchema?: TMeta,
): z.ZodObject<{ data: TData }> | z.ZodObject<{ data: TData; meta: TMeta }> {
  return metaSchema
    ? z.object({ data: dataSchema, meta: metaSchema })
    : z.object({ data: dataSchema });
}

/** Pojedynczy problem walidacyjny wskazujący pole formularza. */
export const ApiErrorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
});
/** Problem walidacyjny wskazujący pole formularza. */
export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;

/** Kody błędów zwracane przez API ([04 §3](../../../../plans/04-api-spec.md#3-format-błędów)). */
export const ApiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'DOMAIN_RULE_VIOLATION',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'EXTERNAL_SERVICE_ERROR',
  'AI_BUDGET_EXCEEDED',
  'INTERNAL_ERROR',
]);
/** Kod błędu z kontraktu API. */
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** Kontrakt odpowiedzi błędu — identyczny dla wszystkich endpointów. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    /** Komunikat po polsku, gotowy do pokazania użytkownikowi. */
    message: z.string(),
    /** Szczegóły do podświetlenia pól formularza. */
    details: z.array(ApiErrorDetailSchema).optional(),
    /**
     * Ile sekund czekać przed ponowieniem; wyłącznie przy `RATE_LIMITED`.
     *
     * Stoi **obok** `details`, a nie w środku: `details` jest jednorodną listą
     * `{ path, message }`, z której front buduje mapę błędów pól
     * (`ApiRequestError.fieldErrors()`). Liczba sekund wciśnięta do tej listy
     * zepsułaby ją dla wszystkich formularzy naraz.
     */
    retryAfterSeconds: z.number().int().nonnegative().optional(),
    /** Identyfikator żądania — ten sam, co w nagłówku `X-Request-Id`. */
    requestId: z.string(),
  }),
});
/** Odpowiedź błędu API. */
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Parametry paginacji kursorowej. */
export const CursorPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
/** Parametry paginacji kursorowej. */
export type CursorPagination = z.infer<typeof CursorPaginationSchema>;

/** Metadane paginacji zwracane z listą. */
export const PaginationMetaSchema = z.object({
  /** `null` oznacza koniec listy. */
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  totalCount: z.number().int().optional(),
});
/** Metadane paginacji. */
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/** Odpowiedź `GET /api/v1/health` ([10 §8](../../../../plans/10-deployment.md)). */
export const HealthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  /** Czy zapytanie kontrolne do bazy się powiodło. */
  dbOk: z.boolean(),
  uptimeSeconds: z.number().int().nonnegative(),
});
/** Odpowiedź endpointu zdrowia. */
export type Health = z.infer<typeof HealthSchema>;

/**
 * Wartość nagłówka `Idempotency-Key` (04 §1): 8–128 znaków `A–Z a–z 0–9 _ -`.
 *
 * Mieści UUID z `crypto.randomUUID()`, a wyklucza spacje i znaki, które pośrednik
 * mógłby przepisać po drodze — klucz, który dojdzie zmieniony, nie chroni przed niczym.
 */
export const IdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, 'Nieprawidłowy klucz idempotencji');
