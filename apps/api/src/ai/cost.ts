import type { TokenUsage } from './document-extractor.js';

/**
 * Szacowanie kosztu wywołania ([08 §9](../../../../plans/08-ocr-ai-pipeline.md#9-kontrola-kosztów), `F7-7`).
 */

/** Stawki w groszach za milion tokenów. */
export interface TokenRates {
  readonly inputCostMinorPerMTok: number;
  readonly outputCostMinorPerMTok: number;
}

/** Tokenów w „milionie" stawki. */
const PER_MTOK = 1_000_000;

/**
 * Szacuje koszt wywołania na podstawie zużycia tokenów.
 *
 * Stawki są konfiguracją (mogą się zmienić), nie stałą w kodzie. Wynik służy do
 * pilnowania miesięcznego limitu i do pokazania zużycia w ustawieniach — nie do
 * rozliczeń. Zaokrąglenie **w górę** do grosza: licznik limitu ma raczej przeszacować,
 * niż przepuścić pętlę ponowień groszowymi krokami po zero.
 *
 * @param usage - Liczba tokenów wejściowych i wyjściowych.
 * @param rates - Stawki z konfiguracji.
 * @returns Szacowany koszt w groszach.
 */
export function estimateCostMinor(usage: TokenUsage, rates: TokenRates): number {
  const scaled =
    usage.inputTokens * rates.inputCostMinorPerMTok +
    usage.outputTokens * rates.outputCostMinorPerMTok;
  return Math.ceil(scaled / PER_MTOK);
}
