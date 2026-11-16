import { z } from 'zod';

/**
 * Modele AI do odczytu dokumentów, między którymi przełącza panel ustawień (ADR-085).
 *
 * Lista jest zamknięta: przełącznik nie przyjmuje dowolnego napisu, bo każdy model ma
 * inne stawki, a licznik limitu kosztów musi wiedzieć, ile liczyć. Model spoza listy da
 * się ustawić tylko zmienną `AI_MODEL` — wtedy obowiązują stawki z konfiguracji.
 */

/** Identyfikatory modeli z przełącznika. */
export const AiModelIdSchema = z.enum(['claude-haiku-5-5', 'claude-sonnet-5-5'], {
  error: 'Nieznany model AI',
});
/** Identyfikator modelu z przełącznika. */
export type AiModelId = z.infer<typeof AiModelIdSchema>;

/** Opis modelu w przełączniku. */
export interface AiModelOption {
  readonly id: AiModelId;
  /** Nazwa w interfejsie. */
  readonly label: string;
  /** Jedno zdanie pod przełącznikiem. */
  readonly description: string;
  /**
   * Stawka za milion tokenów wejścia, w groszach. Cena dostawcy po kursie z zapasem
   * ~4 zł/$ — licznik ma raczej przeszacować niż przepuścić limit.
   */
  readonly inputCostMinorPerMTok: number;
  /** Stawka za milion tokenów wyjścia, w groszach. */
  readonly outputCostMinorPerMTok: number;
}

/**
 * Katalog modeli. Kolejność = kolejność w przełączniku.
 *
 * Haiku 5.5: $0,10 / $0,50 za MTok (prompt do 100 tys. tokenów — paragon ma kilka tysięcy).
 * Sonnet 5.5: $2 / $10 za MTok.
 */
export const AI_MODELS: readonly AiModelOption[] = [
  {
    id: 'claude-haiku-5-5',
    label: 'Haiku 5.5',
    description: 'Szybki i ok. 20× tańszy. Wystarcza na typowe paragony.',
    inputCostMinorPerMTok: 40,
    outputCostMinorPerMTok: 200,
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Sonnet 5.5',
    description: 'Dokładniejszy przy nieczytelnych zdjęciach i długich wyciągach.',
    inputCostMinorPerMTok: 800,
    outputCostMinorPerMTok: 4_000,
  },
];

/**
 * Opis modelu z katalogu.
 *
 * @param model - Identyfikator modelu (może pochodzić z `AI_MODEL`, więc dowolny napis).
 * @returns Opis albo `undefined`, gdy modelu nie ma w katalogu.
 */
export function findAiModel(model: string): AiModelOption | undefined {
  return AI_MODELS.find((option) => option.id === model);
}
