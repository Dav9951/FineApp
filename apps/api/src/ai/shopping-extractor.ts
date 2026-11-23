import Anthropic from '@anthropic-ai/sdk';

import type { Config } from '../core/config.js';
import { API_MESSAGE_MAX, errorDiagnostics } from './diagnostics.js';
import {
  ExtractionError,
  type ExtractionDiagnostics,
  type PreparedPart,
  type TokenUsage,
} from './document-extractor.js';
import {
  LIST_PHOTO_SYSTEM_PROMPT,
  listPhotoUserText,
  RECIPE_SYSTEM_PROMPT,
  recipeUserText,
} from './prompts/shopping-prompts.js';
import type { JsonSchema } from './schemas/extraction.js';
import {
  listPhotoSchema,
  parseListPhoto,
  parseRecipe,
  recipeSchema,
  type ParsedIngredient,
  type ParsedListItem,
} from './schemas/shopping.js';

/**
 * Ekstraktor list zakupów ([08 §17](../../../../plans/08-ocr-ai-pipeline.md#17-listy-zakupów-zdjęcie-listy-i-przepis), ADR-094).
 *
 * Brat `DocumentExtractor`, nie jego część: inne wejście (tekst przepisu bez obrazu),
 * inne schematy, ten sam kontrakt błędów (`ExtractionError`), ten sam model z ustawień
 * gospodarstwa i ta sama droga kosztów. Moduł `shopping` woła go przez interfejs —
 * testy podstawiają atrapę, żaden test nie woła prawdziwej usługi.
 */

/** Wspólne pola wyniku odczytu. */
interface ShoppingExtractionMeta {
  readonly usage: TokenUsage;
  readonly model: string;
  readonly requestId: string | null;
  readonly rawResponse: string;
  readonly diagnostics: ExtractionDiagnostics;
}

/** Wynik odczytu zdjęcia listy. */
export interface ListExtraction extends ShoppingExtractionMeta {
  readonly items: readonly ParsedListItem[];
  readonly notes: string | null;
}

/** Wynik odczytu przepisu. */
export interface RecipeExtraction extends ShoppingExtractionMeta {
  readonly title: string | null;
  readonly baseServings: number | null;
  readonly ingredients: readonly ParsedIngredient[];
  readonly notes: string | null;
}

/** Wejście odczytu przepisu: obrazy albo tekst (wklejony lub pobrany z linku). */
export interface RecipeInput {
  readonly model: string;
  readonly parts: readonly PreparedPart[];
  readonly text: string | null;
  /** Nazwy produktów „zawsze w domu" — jedyny kontekst gospodarstwa wysyłany do modelu. */
  readonly staples: readonly string[];
}

/** Interfejs ekstraktora list zakupów. */
export interface ShoppingExtractor {
  /**
   * Odczytuje listę zakupów ze zdjęcia.
   *
   * @param input - Model i obrazy.
   * @param input.model - Model z ustawień gospodarstwa.
   * @param input.parts - Obrazy przygotowane przez `prepareForVision`.
   * @returns Propozycje pozycji.
   * @throws {ExtractionError} Gdy usługa zawiedzie albo odpowiedź nie przejdzie walidacji.
   */
  extractList(input: {
    readonly model: string;
    readonly parts: readonly PreparedPart[];
  }): Promise<ListExtraction>;
  /**
   * Odczytuje składniki przepisu.
   *
   * @param input - Model, obrazy albo tekst, produkty „zawsze w domu".
   * @returns Składniki z ilościami bazowymi.
   * @throws {ExtractionError} Gdy usługa zawiedzie albo odpowiedź nie przejdzie walidacji.
   */
  extractRecipe(input: RecipeInput): Promise<RecipeExtraction>;
}

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;
const UNAVAILABLE_MESSAGE = 'Nie udało się odczytać. Spróbuj ponownie.';

/**
 * Zużycie tokenów z odpowiedzi — z tokenami z cache.
 *
 * @param usage - Pole `usage`.
 * @returns Zużycie.
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
 * Obraz jako blok wiadomości (przepisy i listy to zawsze obrazy, nie PDF).
 *
 * @param part - Przygotowany obraz.
 * @returns Blok treści albo `null` dla PDF.
 */
function imageBlock(part: PreparedPart): Anthropic.ContentBlockParam | null {
  if (part.kind !== 'image') return null;
  return {
    type: 'image',
    source: { type: 'base64', media_type: part.mediaType, data: part.base64 },
  };
}

/**
 * Tworzy ekstraktor list zakupów na Anthropic Messages API.
 *
 * @param config - Konfiguracja AI.
 * @param client - Klient SDK; testy mogą podstawić własny.
 * @returns Ekstraktor.
 */
export function createAnthropicShoppingExtractor(
  config: Config['ai'],
  client: Anthropic = new Anthropic({
    apiKey: config.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  }),
): ShoppingExtractor {
  /**
   * Wywołuje model i zwraca tekst odpowiedzi z metadanymi albo rzuca `ExtractionError`.
   *
   * @param model - Model.
   * @param system - Prompt systemowy.
   * @param content - Treść wiadomości.
   * @param schema - Schemat odpowiedzi.
   * @returns Tekst i metadane.
   */
  async function call(
    model: string,
    system: string,
    content: Anthropic.ContentBlockParam[],
    schema: JsonSchema,
  ): Promise<{ text: string } & Omit<ShoppingExtractionMeta, 'rawResponse'>> {
    const startedAt = Date.now();
    let message: Anthropic.Message & { _request_id?: string | null };
    try {
      message = await client.messages.create({
        model,
        max_tokens: config.maxOutputTokens,
        system,
        messages: [{ role: 'user', content }],
        output_config: { format: { type: 'json_schema', schema: { ...schema } } },
      });
    } catch (error) {
      throw new ExtractionError('AI_UNAVAILABLE', UNAVAILABLE_MESSAGE, {
        diagnostics: {
          durationMs: Date.now() - startedAt,
          timeoutMs: REQUEST_TIMEOUT_MS,
          maxRetries: MAX_RETRIES,
          ...errorDiagnostics(error),
        },
      });
    }
    const usage = tokenUsage(message.usage);
    const diagnostics: ExtractionDiagnostics = {
      durationMs: Date.now() - startedAt,
      stopReason: message.stop_reason,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
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
      throw new ExtractionError('AI_OUTPUT_TRUNCATED', 'Za dużo do odczytu naraz.', {
        usage,
        rawResponse: text,
        requestId,
        diagnostics,
      });
    }
    return { text, usage, model: message.model, requestId, diagnostics };
  }

  /**
   * Błąd niezgodności ze schematem.
   *
   * @param meta - Odpowiedź modelu.
   * @param meta.text - Surowy tekst.
   * @param meta.usage - Zużycie.
   * @param meta.requestId - Identyfikator żądania.
   * @param meta.diagnostics - Diagnostyka.
   * @param reason - Przyczyna.
   * @returns Błąd do rzucenia.
   */
  function mismatch(
    meta: {
      text: string;
      usage: TokenUsage;
      requestId: string | null;
      diagnostics: ExtractionDiagnostics;
    },
    reason: string,
  ): ExtractionError {
    return new ExtractionError('AI_SCHEMA_MISMATCH', UNAVAILABLE_MESSAGE, {
      usage: meta.usage,
      rawResponse: meta.text,
      requestId: meta.requestId,
      diagnostics: { ...meta.diagnostics, reason: reason.slice(0, API_MESSAGE_MAX) },
    });
  }

  return {
    async extractList(input) {
      const content = input.parts.flatMap((part) => imageBlock(part) ?? []);
      const result = await call(
        input.model,
        LIST_PHOTO_SYSTEM_PROMPT,
        [...content, { type: 'text', text: listPhotoUserText() }],
        listPhotoSchema,
      );
      const parsed = parseListPhoto(result.text);
      if (!parsed.ok) throw mismatch(result, parsed.reason);
      return { ...result, rawResponse: result.text, ...parsed.value };
    },
    async extractRecipe(input) {
      const content = input.parts.flatMap((part) => imageBlock(part) ?? []);
      const result = await call(
        input.model,
        RECIPE_SYSTEM_PROMPT,
        [...content, { type: 'text', text: recipeUserText(input.staples, input.text) }],
        recipeSchema,
      );
      const parsed = parseRecipe(result.text);
      if (!parsed.ok) throw mismatch(result, parsed.reason);
      return { ...result, rawResponse: result.text, ...parsed.value };
    },
  };
}
