import { ApiErrorSchema, type ApiErrorCode, type ApiErrorDetail } from '@fineapp/shared';

/**
 * Klient HTTP aplikacji.
 *
 * Jedno miejsce, w którym odpowiedź serwera zamienia się w dane albo w wyjątek. Dzięki
 * temu hooki `features/*` nie powtarzają obsługi kopert, nagłówków i błędów, a komunikat
 * pokazywany użytkownikowi pochodzi **z serwera** — jest po polsku i dotyczy konkretnej
 * sytuacji, zamiast być ogólnikiem dopisanym na froncie
 * ([04 §3](../../../../plans/04-api-spec.md#3-format-błędów)).
 */

/** Bazowy prefiks API; w dev Vite proxuje go na backend. */
const API_PREFIX = '/api/v1';

/**
 * Błąd zwrócony przez API, z kodem domenowym i szczegółami pól.
 *
 * Niesie `requestId` — ten sam, który jest w logu serwera. Pokazany w komunikacie
 * pozwala odnaleźć konkretne żądanie bez zgadywania.
 */
export class ApiRequestError extends Error {
  /**
   * @param code - Kod domenowy z kontraktu API.
   * @param message - Komunikat po polsku, gotowy dla użytkownika.
   * @param status - Status HTTP odpowiedzi.
   * @param requestId - Identyfikator żądania.
   * @param details - Szczegóły wskazujące pola formularza.
   */
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly requestId: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /**
   * Zamienia szczegóły błędu na mapę `pole → komunikat`.
   *
   * W tej postaci wchodzą wprost do `setError` z `react-hook-form`.
   *
   * @returns Mapa komunikatów po nazwach pól.
   */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((detail) => [detail.path, detail.message]));
  }
}

/** Błąd sieci — serwer nie odpowiedział albo odpowiedź nie jest JSON-em. */
export class NetworkError extends Error {
  /**
   * @param message - Komunikat po polsku.
   * @param cause - Pierwotna przyczyna.
   */
  constructor(message = 'Brak połączenia z serwerem.', cause?: unknown) {
    // `cause` trafia do wbudowanego pola `Error.cause` (ES2022) — własne pole o tej
    // nazwie przesłaniałoby je i gubiło pierwotny stos.
    super(message, { cause });
    this.name = 'NetworkError';
  }
}

/** Opcje pojedynczego żądania. */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Ciało żądania; serializowane do JSON. */
  body?: unknown;
  /**
   * Ciało `multipart/form-data` (wrzucenie dokumentu). `Content-Type` z granicą części
   * ustawia przeglądarka — ustawiony ręcznie nie miałby `boundary` i serwer nie
   * rozebrałby treści.
   */
  formData?: FormData;
  /**
   * Parametry zapytania; pominięte, gdy wartość to `undefined` albo `null`.
   * Tablica daje parametr powtórzony (`?type=expense&type=income`) — tak API przyjmuje
   * filtry wielokrotne (04 §7).
   */
  query?: Readonly<
    Record<string, string | number | boolean | readonly string[] | undefined | null>
  >;
  /** Token dostępu; trzymany w pamięci aplikacji, nigdy w `localStorage` (09 §4). */
  accessToken?: string;
  /** Klucz idempotencji dla operacji o skutkach ubocznych (04 §1). */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * Składa adres z prefiksem i parametrami zapytania.
 *
 * @param path - Ścieżka względem `/api/v1`, np. `/accounts`.
 * @param query - Parametry zapytania.
 * @returns Pełny adres żądania.
 */
export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      for (const item of value) params.append(key, item);
      continue;
    }
    params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

/**
 * Zamienia odpowiedź błędu na {@link ApiRequestError}.
 *
 * Gdy ciało nie jest kopertą błędu z kontraktu (np. serwer pośredniczący zwrócił HTML),
 * powstaje błąd ogólny — ale wciąż ze statusem, więc wołający może odróżnić 401 od 500.
 *
 * @param response - Odpowiedź o statusie błędu.
 * @returns Błąd gotowy do rzucenia.
 */
async function toError(response: Response): Promise<ApiRequestError> {
  const requestId = response.headers.get('x-request-id') ?? '';
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  const parsed = ApiErrorSchema.safeParse(payload);
  if (parsed.success) {
    const { code, message, details, requestId: bodyRequestId } = parsed.data.error;
    return new ApiRequestError(code, message, response.status, bodyRequestId || requestId, details);
  }

  return new ApiRequestError(
    'INTERNAL_ERROR',
    'Serwer zwrócił nieoczekiwaną odpowiedź.',
    response.status,
    requestId,
  );
}

/**
 * Wykonuje żądanie i zwraca surowe ciało odpowiedzi (`undefined` przy `204`).
 *
 * @param path - Ścieżka względem `/api/v1`.
 * @param options - Opcje żądania.
 * @returns Ciało odpowiedzi.
 * @throws {ApiRequestError} Gdy serwer zwrócił status błędu.
 * @throws {NetworkError} Gdy nie udało się nawiązać połączenia.
 */
async function send(path: string, options: RequestOptions): Promise<unknown> {
  const response = await fetchResponse(path, options);
  if (response.status === 204) return undefined;
  return (await response.json()) as unknown;
}

/**
 * Wykonuje żądanie i zwraca odpowiedź o statusie sukcesu.
 *
 * @param path - Ścieżka względem `/api/v1`.
 * @param options - Opcje żądania.
 * @returns Odpowiedź `2xx`.
 * @throws {ApiRequestError} Gdy serwer zwrócił status błędu.
 * @throws {NetworkError} Gdy nie udało się nawiązać połączenia.
 */
async function fetchResponse(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', body, formData, query, accessToken, idempotencyKey, signal } = options;

  const headers: Record<string, string> = {
    // Nagłówek niestandardowy jest jedną z trzech warstw ochrony przed CSRF (09 §5):
    // prosty formularz z obcej strony nie potrafi go ustawić bez zgody CORS.
    'X-Requested-With': 'fineapp',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      // Ciasteczko z tokenem odświeżającym musi dojść przy odświeżaniu sesji.
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(formData !== undefined ? { body: formData } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new NetworkError(undefined, cause);
  }

  if (!response.ok) throw await toError(response);
  return response;
}

/**
 * Pobiera plik z API jako `Blob` — z tokenem w nagłówku.
 *
 * Zdjęcia paragonów są dostępne wyłącznie po uwierzytelnieniu (08 §12), a `<img src>`
 * nie wyśle nagłówka `Authorization`. Ekran pobiera więc plik sam i pokazuje go przez
 * `URL.createObjectURL`.
 *
 * @param path - Ścieżka względem `/api/v1`.
 * @param options - Opcje żądania.
 * @returns Zawartość pliku.
 * @throws {ApiRequestError} Gdy serwer zwrócił status błędu.
 * @throws {NetworkError} Gdy nie udało się nawiązać połączenia.
 */
export async function apiBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  return (await fetchResponse(path, options)).blob();
}

/**
 * Wykonuje żądanie do API i zwraca zawartość koperty `data`.
 *
 * @param path - Ścieżka względem `/api/v1`.
 * @param options - Opcje żądania.
 * @returns Zawartość pola `data` z odpowiedzi.
 * @throws {ApiRequestError} Gdy serwer zwrócił status błędu.
 * @throws {NetworkError} Gdy nie udało się nawiązać połączenia.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const payload = await send(path, options);
  if (typeof payload === 'object' && payload !== null && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

/**
 * Wykonuje żądanie i zwraca całą kopertę `{ data, meta }`.
 *
 * Dla tras, których metadane niosą treść, a nie tylko techniczne dodatki: podsumowanie
 * majątku przy saldach, kursor listy transakcji, miesiące do unieważnienia po zapisie.
 *
 * @param path - Ścieżka względem `/api/v1`.
 * @param options - Opcje żądania.
 * @returns Dane i metadane odpowiedzi.
 * @throws {ApiRequestError} Gdy serwer zwrócił status błędu.
 * @throws {NetworkError} Gdy nie udało się nawiązać połączenia.
 */
export async function apiRequestWithMeta<T, M>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta: M }> {
  return (await send(path, options)) as { data: T; meta: M };
}

/**
 * Szczegóły techniczne błędu do rozwinięcia w stanie błędu ekranu.
 *
 * @param error - Błąd zapytania.
 * @returns Kod i identyfikator żądania albo komunikat.
 */
export function errorDetails(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return `${error.code} · HTTP ${String(error.status)} · żądanie ${error.requestId || '—'}`;
  }
  return error instanceof Error ? error.message : String(error);
}
