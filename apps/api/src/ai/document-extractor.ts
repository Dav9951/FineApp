/**
 * Kontrakt ekstraktora dokumentów ([08 §8](../../../../plans/08-ocr-ai-pipeline.md#8-wywołanie-modelu)).
 *
 * Wydzielony, żeby podmiana dostawcy AI albo dołożenie trybu offline wymagała jednej nowej
 * implementacji, bez zmian w module `documents`. Testy podstawiają atrapę — żaden test
 * nie woła prawdziwej usługi.
 */

/** Rodzaj odczytu: paragon i faktura mają pozycje, wyciąg — operacje z datami. */
export type ExtractionKind = 'receipt' | 'bank_statement';

/** Część dokumentu gotowa do wysłania. */
export type PreparedPart =
  | {
      readonly kind: 'image';
      readonly mediaType: 'image/jpeg';
      readonly base64: string;
      /** Wymiary wysłanego obrazu i oryginału — do dziennika odczytu (ADR-086). */
      readonly width: number;
      readonly height: number;
      readonly sourceWidth: number;
      readonly sourceHeight: number;
    }
  | { readonly kind: 'pdf'; readonly base64: string };

/** Kategoria widoczna dla modelu (08 §4). */
export interface CategoryContextEntry {
  readonly id: string;
  /** Ścieżka `Rodzic > Dziecko`. */
  readonly path: string;
  readonly kind: 'expense' | 'income';
  /** Podpowiedzi użytkownika (`ai_hints`) — główne pokrętło jakości. */
  readonly hints: string | null;
}

/** Wejście ekstraktora. */
export interface ExtractInput {
  /** Model do tego odczytu — z ustawień gospodarstwa albo `AI_MODEL` (ADR-085). */
  readonly model: string;
  readonly kind: ExtractionKind;
  readonly parts: readonly PreparedPart[];
  readonly categories: readonly CategoryContextEntry[];
  /** Strefa gospodarstwa — model wie, jakiego formatu dat się spodziewać. */
  readonly timezone: string;
  readonly currency: string;
}

/** Pozycja odczytana z dokumentu, po walidacji. */
export interface ExtractedItem {
  readonly description: string;
  readonly quantity: number | null;
  readonly unitPriceMinor: number | null;
  /** Zawsze dodatnia; kierunek osobno (08 §7 pkt 3). */
  readonly amountMinor: number;
  readonly direction: 'inflow' | 'outflow';
  /** Wyciąg: data operacji. */
  readonly bookedOn: string | null;
  readonly counterparty: string | null;
  readonly categoryId: string | null;
  readonly suggestedCategoryName: string | null;
  readonly confidence: number | null;
}

/** Nagłówek dokumentu po walidacji. */
export interface ExtractedHeader {
  readonly merchant: string | null;
  readonly bookedOn: string | null;
  readonly totalMinor: number | null;
  readonly currency: string | null;
  readonly confidence: number | null;
  readonly notes: string | null;
  readonly accountHint: string | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
}

/** Zużycie tokenów jednego wywołania. */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Szczegóły do dziennika odczytu (ADR-086) — liczby i kody, nigdy treść dokumentu.
 *
 * Klucze są stabilne, bo czyta je człowiek w dzienniku: `durationMs`, `httpStatus`,
 * `errorType`, `apiMessage`, `stopReason`, `outputTokens`, `maxOutputTokens`, `reason`.
 */
export type ExtractionDiagnostics = Readonly<Record<string, string | number | boolean | null>>;

/** Wynik ekstrakcji. */
export interface ExtractResult {
  readonly header: ExtractedHeader;
  readonly items: readonly ExtractedItem[];
  readonly usage: TokenUsage;
  readonly provider: string;
  readonly model: string;
  readonly requestId: string | null;
  /** Surowa odpowiedź modelu — do diagnozy złego odczytu (`ai_raw_response`). */
  readonly rawResponse: string;
  /** Czas wywołania razem z ponowieniami SDK, `stop_reason` itd. */
  readonly diagnostics: ExtractionDiagnostics;
}

/** Przyczyna nieudanej ekstrakcji — zapisywana w `documents.error_code`. */
export type ExtractionErrorCode =
  'AI_UNAVAILABLE' | 'AI_SCHEMA_MISMATCH' | 'AI_OUTPUT_TRUNCATED' | 'AI_REFUSED';

/**
 * Błąd ekstrakcji z kodem do zapisania przy dokumencie.
 *
 * Niesie zużycie i surową odpowiedź, jeśli usługa zdążyła odpowiedzieć — nieudany odczyt
 * też kosztuje i też liczy się do limitu (08 §9).
 */
export class ExtractionError extends Error {
  /**
   * @param code - Przyczyna.
   * @param message - Komunikat dla użytkownika, po polsku.
   * @param details - Zużycie i surowa odpowiedź, o ile są.
   * @param details.usage - Zużycie tokenów.
   * @param details.rawResponse - Surowa odpowiedź.
   * @param details.requestId - Identyfikator żądania u dostawcy.
   * @param details.diagnostics - Szczegóły do dziennika odczytu.
   */
  constructor(
    readonly code: ExtractionErrorCode,
    message: string,
    readonly details: {
      readonly usage?: TokenUsage;
      readonly rawResponse?: string;
      readonly requestId?: string | null;
      readonly diagnostics?: ExtractionDiagnostics;
    } = {},
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

/** Interfejs ekstraktora dokumentów. */
export interface DocumentExtractor {
  /** Dostawca zapisywany w `documents.ai_provider`. */
  readonly provider: string;
  /** Model domyślny (`AI_MODEL`); właściwy model każdego odczytu idzie w `ExtractInput`. */
  readonly model: string;
  /**
   * Odczytuje dokument i zwraca propozycje pozycji.
   *
   * @param input - Obrazy, rodzaj dokumentu i kontekst kategorii.
   * @returns Odczytane dane wraz z informacją o zużyciu tokenów.
   * @throws {ExtractionError} Gdy usługa zwróci błąd lub odpowiedź nie przejdzie walidacji.
   */
  extract(input: ExtractInput): Promise<ExtractResult>;
}
