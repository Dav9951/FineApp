import { z } from 'zod';

/**
 * Wskaźniki jakości importów list zakupów
 * ([17 §11](../../../../plans/17-shopping-lists.md#11-zadania), `F10-10`).
 *
 * Czyste funkcje — skrypt `evaluate-shopping.ts` woła prawdziwą usługę, tutaj jest tylko
 * rachunek, testowany bez sieci. Wzorem `ocr-metrics.ts`.
 */

/** Oczekiwany odczyt zdjęcia listy — `<nazwa>.expected.json` obok zdjęcia. */
export const ExpectedListSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().min(1),
      /** Ilość w tysięcznych; `null`/brak — bez ilości na kartce. */
      quantityMilli: z.number().int().positive().nullable().default(null),
    }),
  ),
});
/** Oczekiwany odczyt listy. */
export type ExpectedList = z.infer<typeof ExpectedListSchema>;

/** Oczekiwany odczyt przepisu. */
export const ExpectedRecipeSchema = z.object({
  baseServings: z.number().int().positive().nullable().default(null),
  ingredients: z.array(
    z.object({
      name: z.string().min(1),
      /** Ilość bazowa w tysięcznych `baseUnit`; `null` — „do smaku", „szczypta". */
      baseAmountMilli: z.number().int().positive().nullable().default(null),
      baseUnit: z.enum(['g', 'ml', 'pcs']).nullable().default(null),
      pantryStaple: z.boolean().default(false),
    }),
  ),
});
/** Oczekiwany odczyt przepisu. */
export type ExpectedRecipe = z.infer<typeof ExpectedRecipeSchema>;

/** Pozycja przewidziana przez model, sprowadzona do porównywalnej postaci. */
export interface PredictedEntry {
  readonly name: string;
  readonly amountMilli: number | null;
  readonly unit: string | null;
  readonly pantryStaple: boolean;
}

/** Wynik jednego zdjęcia albo przepisu. */
export interface EntryScore {
  readonly expected: number;
  /** Oczekiwane pozycje znalezione przez model. */
  readonly found: number;
  /** Pozycje modelu bez odpowiednika — do usunięcia przy przeglądzie. */
  readonly extra: number;
  /** Dopasowane pozycje z oczekiwaną ilością… */
  readonly amountChecked: number;
  /** …i z ilością trafioną (±10%, ta sama jednostka). */
  readonly amountCorrect: number;
  /** Dopasowane pozycje z trafną flagą „zawsze w domu" (tylko przepisy). */
  readonly stapleCorrect: number;
  /** Porcje bazowe trafione (`null` — nie dotyczy). */
  readonly servingsCorrect: boolean | null;
}

/** Tolerancja ilości: przeliczenia „1 szklanka" → ml bywają przybliżone. */
const AMOUNT_TOLERANCE = 0.1;

/**
 * Słowa nazwy: małe litery bez ogonków, co najmniej trzy znaki.
 *
 * @param name - Nazwa produktu.
 * @returns Słowa.
 */
export function nameWords(name: string): readonly string[] {
  const plain = name
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '');
  return [...new Set(plain.split(/[^a-z]+/u).filter((word) => word.length >= 3))];
}

/**
 * Czy dwa słowa to ta sama podstawa w innej odmianie: wspólny początek najwyżej trzy
 * znaki krótszy od krótszego słowa („gorzka" ~ „gorzkiej", „jajka" ~ „jajko").
 *
 * @param a - Słowo.
 * @param b - Słowo.
 * @returns `true` przy dopasowaniu.
 */
function wordsMatch(a: string, b: string): boolean {
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
  return common >= 3 && common >= Math.min(a.length, b.length) - 3;
}

/**
 * Czy nazwa modelu odpowiada oczekiwanej: każde słowo krótszej nazwy ma odpowiednik
 * w dłuższej („Mleko" ~ „Mleko 2%", „Żółty ser" ~ „ser żółty").
 *
 * @param expected - Nazwa oczekiwana.
 * @param predicted - Nazwa modelu.
 * @returns `true` przy dopasowaniu.
 */
export function namesMatch(expected: string, predicted: string): boolean {
  const a = nameWords(expected);
  const b = nameWords(predicted);
  if (a.length === 0 || b.length === 0) return false;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  return small.every((word) => big.some((other) => wordsMatch(word, other)));
}

/**
 * Ocenia jeden odczyt. Pozycje paruje nazwa (każda przewidziana raz, w kolejności).
 *
 * @param expected - Oczekiwane pozycje.
 * @param predicted - Pozycje modelu.
 * @param servings - Porcje oczekiwane i odczytane (przepisy) albo `null`.
 * @returns Wynik.
 */
export function scoreEntries(
  expected: readonly {
    name: string;
    amountMilli: number | null;
    unit: string | null;
    pantryStaple: boolean;
  }[],
  predicted: readonly PredictedEntry[],
  servings: { expected: number | null; predicted: number | null } | null,
): EntryScore {
  const used = new Set<number>();
  let found = 0;
  let amountChecked = 0;
  let amountCorrect = 0;
  let stapleCorrect = 0;
  for (const want of expected) {
    const index = predicted.findIndex(
      (entry, i) => !used.has(i) && namesMatch(want.name, entry.name),
    );
    if (index < 0) continue;
    used.add(index);
    found += 1;
    const got = predicted[index] as PredictedEntry;
    if (got.pantryStaple === want.pantryStaple) stapleCorrect += 1;
    if (want.amountMilli === null) continue;
    amountChecked += 1;
    if (
      got.amountMilli !== null &&
      (want.unit === null || got.unit === want.unit) &&
      Math.abs(got.amountMilli - want.amountMilli) <= want.amountMilli * AMOUNT_TOLERANCE
    ) {
      amountCorrect += 1;
    }
  }
  return {
    expected: expected.length,
    found,
    extra: predicted.length - used.size,
    amountChecked,
    amountCorrect,
    stapleCorrect,
    servingsCorrect:
      servings === null || servings.expected === null
        ? null
        : servings.expected === servings.predicted,
  };
}

/** Wskaźniki zbioru. */
export interface ShoppingQualityReport {
  readonly samples: number;
  /** Znalezione / oczekiwane. */
  readonly recall: number | null;
  /** Nadmiarowe / wszystkie przewidziane. */
  readonly extraRate: number | null;
  /** Trafione ilości / sprawdzane. */
  readonly amountAccuracy: number | null;
  /** Trafne porcje / przepisy z porcjami. */
  readonly servingsAccuracy: number | null;
  readonly meetsTargets: boolean;
}

/** Cele jakości (17 §11, `F10-10`). */
export const SHOPPING_TARGETS = {
  recall: 0.9,
  extraRate: 0.1,
  amountAccuracy: 0.85,
} as const;

/**
 * Iloraz albo `null` przy zerowym mianowniku.
 *
 * @param numerator - Licznik.
 * @param denominator - Mianownik.
 * @returns Ułamek albo `null`.
 */
function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Składa wyniki w wskaźniki zbioru.
 *
 * @param scores - Wyniki pojedynczych odczytów.
 * @returns Raport.
 */
export function shoppingQualityReport(scores: readonly EntryScore[]): ShoppingQualityReport {
  const sum = (pick: (score: EntryScore) => number): number =>
    scores.reduce((total, score) => total + pick(score), 0);
  const predicted = sum((s) => s.found + s.extra);
  const withServings = scores.filter((s) => s.servingsCorrect !== null);
  const recall = ratio(
    sum((s) => s.found),
    sum((s) => s.expected),
  );
  const extraRate = ratio(
    sum((s) => s.extra),
    predicted,
  );
  const amountAccuracy = ratio(
    sum((s) => s.amountCorrect),
    sum((s) => s.amountChecked),
  );
  return {
    samples: scores.length,
    recall,
    extraRate,
    amountAccuracy,
    servingsAccuracy: ratio(
      withServings.filter((s) => s.servingsCorrect === true).length,
      withServings.length,
    ),
    meetsTargets:
      recall !== null &&
      recall >= SHOPPING_TARGETS.recall &&
      (extraRate ?? 0) <= SHOPPING_TARGETS.extraRate &&
      (amountAccuracy ?? 1) >= SHOPPING_TARGETS.amountAccuracy,
  };
}
