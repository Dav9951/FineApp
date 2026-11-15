import Anthropic from '@anthropic-ai/sdk';

import type { Config } from '../core/config.js';
import {
  ExtractionError,
  type DocumentExtractor,
  type ExtractionDiagnostics,
  type ExtractInput,
  type ExtractResult,
  type PreparedPart,
  type TokenUsage,
} from './document-extractor.js';
import { API_MESSAGE_MAX, errorDiagnostics } from './diagnostics.js';
import { EXTRACTION_SYSTEM_PROMPT, extractionUserText } from './prompts/extraction-prompt.js';
import { extractionSchema, parseExtraction } from './schemas/extraction.js';

/**
 * Ekstraktor oparty o Anthropic Messages API ([08 §8](../../../../plans/08-ocr-ai-pipeline.md#8-wywołanie-modelu), `F7-3`).
 *
 * Odstępstwa od tabeli parametrów z 08 §8 (ADR-059):
 *
 * - **structured outputs zamiast `tool_choice`** — wymuszone narzędzie zwraca `400`
 *   na nowszych modelach, a `AI_MODEL` jest konfiguracją;
 * - **bez `temperature: 0`** — Sonnet 5 i 5.5 odrzucają parametry próbkowania (`400`);
 *   determinizm odczytu daje schemat i prompt, nie temperatura;
 * - **timeout 120 s** — model myśli adaptacyjnie, a wyciąg z kilkudziesięcioma
 *   operacjami potrafi przekroczyć 60 s.
 *
 * Ponowienia robi SDK: dwie próby przy `408/409/429/5xx` i zerwanym połączeniu,
 * z wykładniczym opóźnieniem. Błąd walidacji odpowiedzi nie jest ponawiany.
 */

/** Czas na jedną próbę. */
const REQUEST_TIMEOUT_MS = 120_000;

/** Ponowienia przy błędach przejściowych (08 §8). */
const MAX_RETRIES = 2;

/** Komunikat dla użytkownika przy awarii usługi (08 §14). */
const UNAVAILABLE_MESSAGE = 'Nie udało się odczytać dokumentu. Spróbuj ponownie.';

/**
 * Zamienia część dokumentu na blok treści wiadomości.
 *
 * @param part - Obraz albo PDF.
 * @returns Blok dla Messages API.
 */
function toContentBlock(part: PreparedPart): Anthropic.ContentBlockParam {
  if (part.kind === 'pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: part.base64 },
    };
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: part.mediaType, data: part.base64 },
  };
}

/**
 * Zużycie tokenów z odpowiedzi — łącznie z tokenami z cache, bo też są płatne.
 *
 * @param usage - Pole `usage` odpowiedzi.
 * @returns Zużycie wejścia i wyjścia.
 */
function tokenUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens:
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
  };
}

/**
 * Status HTTP błędu usługi; `null`, gdy odpowiedzi nie było (timeout, zerwane połączenie).
 *
 * @param error - Błąd rzucony przez SDK.
 * @returns Status albo `null`.
 */
function httpStatusOf(error: unknown): number | null {
  if (!(error instanceof Anthropic.APIError)) return null;
  const status: unknown = error.status;
  return typeof status === 'number' ? status : null;
}

/**
 * Diagnostyka błędu wywołania — do dziennika odczytu (ADR-086).
 *
 * Komunikat błędu z SDK zawiera typ i opis błędu usługi (np. `overloaded_error`,
 * „Request timed out"), nigdy treść dokumentu ani klucz — dlatego może trafić do
 * dziennika. Klasa błędu odróżnia przekroczenie czasu od zerwanego połączenia i od
 * odpowiedzi `4xx/5xx`.
 *
 * @param error - Błąd rzucony przez SDK.
 * @param durationMs - Czas od wysłania do błędu, razem z ponowieniami.
 * @returns Szczegóły do dziennika.
 */
function failureDiagnostics(error: unknown, durationMs: number): ExtractionDiagnostics {
  return {
    durationMs,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
    httpStatus: httpStatusOf(error),
    ...errorDiagnostics(error),
  };
}

/**
 * Tworzy ekstraktor Anthropic.
 *
 * @param config - Konfiguracja AI (klucz, model domyślny, limit tokenów wyjścia).
 * @param client - Klient SDK; testy mogą podstawić własny.
 * @returns Ekstraktor dokumentów.
 */
export function createAnthropicExtractor(
  config: Config['ai'],
  client: Anthropic = new Anthropic({
    apiKey: config.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  }),
): DocumentExtractor {
  return {
    provider: 'anthropic',
    model: config.model,
    async extract(input: ExtractInput): Promise<ExtractResult> {
      const categoryIds = input.categories.map((category) => category.id);
      const startedAt = Date.now();
      let message: Anthropic.Message & { _request_id?: string | null };
      try {
        message = await client.messages.create({
          model: input.model,
          max_tokens: config.maxOutputTokens,
          system: EXTRACTION_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                ...input.parts.map(toContentBlock),
                {
                  type: 'text',
                  text: extractionUserText(input.kind, input.categories, input.currency),
                },
              ],
            },
          ],
          output_config: {
            format: {
              type: 'json_schema',
              schema: { ...extractionSchema(input.kind, categoryIds) },
            },
          },
        });
      } catch (error) {
        // Klucz, limit, 5xx po ponowieniach, timeout — dla użytkownika to jedno: spróbuj
        // ponownie. Szczegół (status) zostaje w komunikacie błędu do logu.
        const status = error instanceof Anthropic.APIError ? String(error.status) : 'brak';
        throw new ExtractionError('AI_UNAVAILABLE', UNAVAILABLE_MESSAGE, {
          rawResponse: `status: ${status}`,
          diagnostics: failureDiagnostics(error, Date.now() - startedAt),
        });
      }

      const usage = tokenUsage(message.usage);
      const diagnostics: ExtractionDiagnostics = {
        durationMs: Date.now() - startedAt,
        stopReason: message.stop_reason,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        maxOutputTokens: config.maxOutputTokens,
      };
      const requestId = message._request_id ?? null;
      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (message.stop_reason === 'refusal') {
        throw new ExtractionError('AI_REFUSED', UNAVAILABLE_MESSAGE, {
          usage,
          rawResponse: text,
          requestId,
          diagnostics,
        });
      }
      if (message.stop_reason === 'max_tokens') {
        // Ucięty JSON bywa poprawnym, ale niepełnym obiektem — nie wolno go przyjąć.
        throw new ExtractionError(
          'AI_OUTPUT_TRUNCATED',
          'Dokument jest za długi do odczytu naraz. Podziel go na mniejsze części.',
          { usage, rawResponse: text, requestId, diagnostics },
        );
      }

      const parsed = parseExtraction(input.kind, text, new Set(categoryIds));
      if (!parsed.ok) {
        throw new ExtractionError('AI_SCHEMA_MISMATCH', UNAVAILABLE_MESSAGE, {
          usage,
          rawResponse: text,
          requestId,
          diagnostics: { ...diagnostics, reason: parsed.reason.slice(0, API_MESSAGE_MAX) },
        });
      }

      return {
        header: parsed.header,
        items: parsed.items,
        usage,
        provider: 'anthropic',
        model: message.model,
        requestId,
        rawResponse: text,
        diagnostics,
      };
    },
  };
}
