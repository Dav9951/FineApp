import { z } from 'zod';

/**
 * Wskaźniki jakości OCR ([08 §15](../../../../plans/08-ocr-ai-pipeline.md#15-ocena-jakości), `F7-11`).
 *
 * Czyste funkcje — skrypt `evaluate-ocr.ts` woła prawdziwą usługę, a tutaj jest tylko
 * rachunek, testowany bez sieci.
 */

/** Oczekiwany odczyt paragonu — plik `<nazwa>.expected.json` obok zdjęcia. */
export const ExpectedReceiptSchema = z.object({
  totalMinor: z.number().int().nullable(),
  bookedOn: z.string().nullable(),
  /** Pozycje: kwota w groszach i `slug` kategorii (stały, ADR-033). */
  items: z
    .array(z.object({ amountMinor: z.number().int().positive(), category: z.string().nullable() }))
    .default([]),
});
/** Oczekiwany odczyt. */
export type ExpectedReceipt = z.infer<typeof ExpectedReceiptSchema>;

/** Odczyt modelu sprowadzony do porównywalnej postaci. */
export interface PredictedReceipt {
  readonly totalMinor: number | null;
  readonly bookedOn: string | null;
  readonly items: readonly {
    readonly amountMinor: number;
    /** `slug` kategorii albo `null`. */
    readonly category: string | null;
    readonly confidence: number | null;
  }[];
}

/** Wynik jednego paragonu. */
export interface ReceiptScore {
  readonly totalCorrect: boolean;
  readonly dateCorrect: boolean;
  /** Pozycje dopasowane kwotą, z pewnością ≥ 0,8. */
  readonly confidentItems: number;
  /** …z trafną kategorią. */
  readonly confidentCorrect: number;
  readonly expectedItems: number;
  /** Pozycje do ręcznej poprawki: brakujące, nadmiarowe, ze złą kategorią. */
  readonly corrections: number;
}

/** Próg pewności liczony do trafności kategorii (08 §15). */
export const CONFIDENT = 0.8;

/**
 * Ocenia jeden paragon.
 *
 * Pozycje paruje kwota co do grosza (każda przewidziana raz) — opisy z paragonu bywają
 * skrócone inaczej niż w pliku oczekiwań, a kwota jest tym, co ostatecznie trafia do księgi.
 *
 * @param expected - Oczekiwany odczyt.
 * @param predicted - Odczyt modelu.
 * @returns Wynik paragonu.
 */
export function scoreReceipt(expected: ExpectedReceipt, predicted: PredictedReceipt): ReceiptScore {
  const unused = [...predicted.items];
  let confidentItems = 0;
  let confidentCorrect = 0;
  let corrections = 0;
  for (const item of expected.items) {
    const index = unused.findIndex((candidate) => candidate.amountMinor === item.amountMinor);
    if (index === -1) {
      corrections += 1;
      continue;
    }
    const [match] = unused.splice(index, 1);
    if (match === undefined) continue;
    const correct = match.category === item.category;
    if (!correct) corrections += 1;
    if (match.confidence !== null && match.confidence >= CONFIDENT) {
      confidentItems += 1;
      if (correct) confidentCorrect += 1;
    }
  }
  corrections += unused.length;
  return {
    totalCorrect: expected.totalMinor === predicted.totalMinor,
    dateCorrect: expected.bookedOn === predicted.bookedOn,
    confidentItems,
    confidentCorrect,
    expectedItems: expected.items.length,
    corrections,
  };
}

/** Wskaźniki zbioru z celami z 08 §15. */
export interface QualityReport {
  readonly receipts: number;
  /** Trafność sumy, cel ≥ 95%. */
  readonly totalAccuracy: number;
  /** Trafność daty, cel ≥ 90%. */
  readonly dateAccuracy: number;
  /** Trafność kategorii przy pewności ≥ 0,8, cel ≥ 85%; `null` bez takich pozycji. */
  readonly categoryAccuracy: number | null;
  /** Odsetek pozycji do poprawki, cel ≤ 20%; `null` bez pozycji w oczekiwaniach. */
  readonly correctionRate: number | null;
  readonly meetsTargets: boolean;
}

/**
 * Składa wskaźniki zbioru.
 *
 * @param scores - Wyniki paragonów.
 * @returns Wskaźniki i informacja, czy spełniają cele.
 */
export function qualityReport(scores: readonly ReceiptScore[]): QualityReport {
  const count = scores.length;
  const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);
  const sum = (pick: (score: ReceiptScore) => number): number =>
    scores.reduce((total, score) => total + pick(score), 0);
  const totalAccuracy =
    ratio(
      sum((score) => (score.totalCorrect ? 1 : 0)),
      count,
    ) ?? 0;
  const dateAccuracy =
    ratio(
      sum((score) => (score.dateCorrect ? 1 : 0)),
      count,
    ) ?? 0;
  const categoryAccuracy = ratio(
    sum((score) => score.confidentCorrect),
    sum((score) => score.confidentItems),
  );
  const correctionRate = ratio(
    sum((score) => score.corrections),
    sum((score) => score.expectedItems),
  );
  return {
    receipts: count,
    totalAccuracy,
    dateAccuracy,
    categoryAccuracy,
    correctionRate,
    meetsTargets:
      count > 0 &&
      totalAccuracy >= 0.95 &&
      dateAccuracy >= 0.9 &&
      (categoryAccuracy === null || categoryAccuracy >= 0.85) &&
      (correctionRate === null || correctionRate <= 0.2),
  };
}
