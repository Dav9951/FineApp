import { z } from 'zod';

import type { ExtractedHeader, ExtractedItem, ExtractionKind } from '../document-extractor.js';

/**
 * Schematy odpowiedzi modelu ([08 §5, §6](../../../../../plans/08-ocr-ai-pipeline.md#5-schemat-narzędzia--paragon)).
 *
 * Plan wymuszał strukturę narzędziem (`tool_choice`). Obecne modele wymuszają ją
 * lepiej przez **structured outputs** (`output_config.format`) — odpowiedź jest JSON-em
 * zgodnym ze schematem, bez narzędzia, a wymuszony `tool_choice` na nowszych modelach
 * kończy się `400` (ADR-059). Pola i opisy są te same co w 08.
 *
 * Ograniczenia structured outputs: każdy obiekt ma `additionalProperties: false`,
 * wszystkie pola są wymagane (brak wartości to `null`), bez `minimum`/`maximum` — zakres
 * pewności pilnuje walidacja po naszej stronie.
 */

/** Schemat JSON — obiekt przekazywany do `output_config.format.schema`. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/**
 * Pole, które może być `null`.
 *
 * @param schema - Schemat wartości niepustej.
 * @param description - Opis dla modelu.
 * @returns Schemat JSON.
 */
function nullable(schema: JsonSchema, description?: string): JsonSchema {
  return {
    anyOf: [schema, { type: 'null' }],
    ...(description === undefined ? {} : { description }),
  };
}

/**
 * Pole `categoryId` — wyłącznie identyfikatory z listy albo `null`.
 *
 * Enum z prawdziwymi ULID-ami zamienia regułę z promptu („nie wymyślaj identyfikatorów")
 * w gwarancję: model **nie może** zwrócić kategorii spoza listy (08 §4).
 *
 * @param categoryIds - Identyfikatory widoczne dla modelu.
 * @returns Schemat JSON pola.
 */
function categoryIdField(categoryIds: readonly string[]): JsonSchema {
  const description =
    'Identyfikator kategorii z listy DOSTĘPNE KATEGORIE. null tylko gdy żadna nie pasuje.';
  return categoryIds.length === 0
    ? { type: 'null', description }
    : nullable({ type: 'string', enum: [...categoryIds] }, description);
}

/**
 * Pola dopasowania kategorii wspólne dla pozycji paragonu i operacji wyciągu.
 *
 * @param categoryIds - Identyfikatory kategorii z kontekstu.
 * @returns Schematy pól `categoryId`, `suggestedCategoryName`, `confidence`.
 */
function categoryFields(categoryIds: readonly string[]): Record<string, JsonSchema> {
  return {
    categoryId: categoryIdField(categoryIds),
    suggestedCategoryName: nullable(
      { type: 'string' },
      'Propozycja nazwy NOWEJ kategorii — wyłącznie gdy categoryId jest null.',
    ),
    confidence: { type: 'number', description: 'Pewność dopasowania kategorii, 0–1.' },
  };
}

/** Kierunek: pieniądz wychodzi albo wchodzi. */
const DIRECTION: JsonSchema = {
  type: 'string',
  enum: ['inflow', 'outflow'],
  description: 'outflow = zapłata/obciążenie, inflow = rabat, zwrot, kaucja, uznanie.',
};

/**
 * Buduje obiekt ze wszystkimi polami wymaganymi.
 *
 * @param properties - Pola obiektu.
 * @returns Schemat JSON obiektu.
 */
function strictObject(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

/**
 * Schemat odczytu paragonu (i faktury).
 *
 * Względem 08 §5 pozycja ma `direction`: reguła 6 promptu każe ujmować rabaty i kaucje
 * jako osobne pozycje „ze stosownym kierunkiem", a schemat z planu nie miał gdzie go
 * zapisać.
 *
 * @param categoryIds - Identyfikatory kategorii z kontekstu.
 * @returns Schemat JSON.
 */
export function receiptSchema(categoryIds: readonly string[]): JsonSchema {
  return strictObject({
    merchant: nullable(
      { type: 'string' },
      'Nazwa sklepu tak, jak na paragonie. null gdy nieczytelna.',
    ),
    bookedOn: nullable(
      { type: 'string' },
      'Data zakupu w formacie YYYY-MM-DD. null gdy nieczytelna.',
    ),
    totalMinor: nullable(
      { type: 'integer' },
      'Suma do zapłaty w GROSZACH (np. 127,99 zł = 12799).',
    ),
    currency: { type: 'string', description: 'Kod ISO 4217, domyślnie PLN.' },
    confidence: { type: 'number', description: 'Pewność odczytu nagłówka, 0–1.' },
    notes: nullable(
      { type: 'string' },
      'Uwagi o odczycie, np. rozdarty paragon, nieczytelna sekcja, niezgodna suma.',
    ),
    items: {
      type: 'array',
      description: 'Pozycje z paragonu w kolejności występowania.',
      items: strictObject({
        description: { type: 'string', description: 'Nazwa produktu z paragonu.' },
        quantity: nullable({ type: 'number' }),
        unitPriceMinor: nullable({ type: 'integer' }),
        amountMinor: { type: 'integer', description: 'Wartość pozycji w groszach, dodatnia.' },
        direction: DIRECTION,
        ...categoryFields(categoryIds),
      }),
    },
  });
}

/**
 * Schemat odczytu wyciągu bankowego (08 §6).
 *
 * @param categoryIds - Identyfikatory kategorii z kontekstu.
 * @returns Schemat JSON.
 */
export function statementSchema(categoryIds: readonly string[]): JsonSchema {
  return strictObject({
    accountHint: nullable({ type: 'string' }, 'Numer lub nazwa konta z nagłówka wyciągu.'),
    periodFrom: nullable({ type: 'string' }, 'YYYY-MM-DD'),
    periodTo: nullable({ type: 'string' }, 'YYYY-MM-DD'),
    confidence: { type: 'number', description: 'Pewność odczytu wyciągu, 0–1.' },
    notes: nullable({ type: 'string' }, 'Uwagi o odczycie.'),
    operations: {
      type: 'array',
      items: strictObject({
        bookedOn: { type: 'string', description: 'Data operacji YYYY-MM-DD.' },
        description: { type: 'string', description: 'Tytuł/opis operacji.' },
        counterparty: nullable({ type: 'string' }, 'Odbiorca lub nadawca.'),
        amountMinor: {
          type: 'integer',
          description: 'Kwota w groszach, zawsze DODATNIA. Kierunek w polu direction.',
        },
        direction: DIRECTION,
        ...categoryFields(categoryIds),
      }),
    },
  });
}

/**
 * Schemat dla rodzaju dokumentu.
 *
 * @param kind - Rodzaj odczytu.
 * @param categoryIds - Identyfikatory kategorii z kontekstu.
 * @returns Schemat JSON.
 */
export function extractionSchema(kind: ExtractionKind, categoryIds: readonly string[]): JsonSchema {
  return kind === 'bank_statement' ? statementSchema(categoryIds) : receiptSchema(categoryIds);
}

// ─── Walidacja odpowiedzi ────────────────────────────────────────────────────────────

/** Pewność: liczba przycięta do 0–1 — `1.02` to zaokrąglenie modelu, nie powód do porażki. */
const Confidence = z
  .number()
  .finite()
  .transform((value) => Math.min(1, Math.max(0, value)));

/** Kategoria i propozycja — wspólne. */
const CategoryPart = {
  categoryId: z.string().nullable(),
  suggestedCategoryName: z.string().nullable(),
  confidence: Confidence,
};

const ReceiptResponse = z.object({
  merchant: z.string().nullable(),
  bookedOn: z.string().nullable(),
  totalMinor: z.number().int().nullable(),
  currency: z.string(),
  confidence: Confidence,
  notes: z.string().nullable(),
  items: z.array(
    z.object({
      description: z.string(),
      quantity: z.number().finite().nullable(),
      unitPriceMinor: z.number().int().nullable(),
      amountMinor: z.number().int(),
      direction: z.enum(['inflow', 'outflow']),
      ...CategoryPart,
    }),
  ),
});

const StatementResponse = z.object({
  accountHint: z.string().nullable(),
  periodFrom: z.string().nullable(),
  periodTo: z.string().nullable(),
  confidence: Confidence,
  notes: z.string().nullable(),
  operations: z.array(
    z.object({
      bookedOn: z.string(),
      description: z.string(),
      counterparty: z.string().nullable(),
      amountMinor: z.number().int(),
      direction: z.enum(['inflow', 'outflow']),
      ...CategoryPart,
    }),
  ),
});

/**
 * Data `YYYY-MM-DD`, która istnieje w kalendarzu — inaczej `null`.
 *
 * „2026-02-30" od modelu to nieczytelna data, a nie powód, żeby odrzucić cały paragon.
 *
 * @param value - Tekst od modelu.
 * @returns Data albo `null`.
 */
export function validDateOrNull(value: string | null): string | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : null;
}

/**
 * Tekst przycięty; pusty to `null`.
 *
 * @param value - Tekst od modelu.
 * @param max - Najwięcej znaków.
 * @returns Tekst albo `null`.
 */
function cleanText(value: string | null, max: number): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

/** Surowa pozycja przed normalizacją. */
interface RawItem {
  readonly description: string;
  readonly quantity?: number | null;
  readonly unitPriceMinor?: number | null;
  readonly amountMinor: number;
  readonly direction: 'inflow' | 'outflow';
  readonly bookedOn?: string;
  readonly counterparty?: string | null;
  readonly categoryId: string | null;
  readonly suggestedCategoryName: string | null;
  readonly confidence: number;
}

/**
 * Normalizuje pozycję: kwota dodatnia z kierunkiem, kategoria tylko z listy.
 *
 * Kwota ujemna mimo instrukcji to rabat zapisany znakiem — odwracamy kierunek zamiast
 * odrzucać odczyt. Pozycja zerowa (np. darmowa torba) nie niesie pieniędzy i znika.
 *
 * @param raw - Pozycja z odpowiedzi.
 * @param knownCategoryIds - Kategorie z kontekstu.
 * @returns Pozycja albo `null`, gdy jest zerowa.
 */
function normalizeItem(raw: RawItem, knownCategoryIds: ReadonlySet<string>): ExtractedItem | null {
  if (raw.amountMinor === 0) return null;
  const negative = raw.amountMinor < 0;
  const direction = negative ? (raw.direction === 'outflow' ? 'inflow' : 'outflow') : raw.direction;
  const categoryId =
    raw.categoryId !== null && knownCategoryIds.has(raw.categoryId) ? raw.categoryId : null;
  return {
    description: cleanText(raw.description, 200) ?? cleanText(raw.counterparty ?? null, 200) ?? '—',
    quantity: raw.quantity ?? null,
    unitPriceMinor:
      raw.unitPriceMinor === null || raw.unitPriceMinor === undefined
        ? null
        : Math.abs(raw.unitPriceMinor),
    amountMinor: Math.abs(raw.amountMinor),
    direction,
    bookedOn: validDateOrNull(raw.bookedOn ?? null),
    counterparty: cleanText(raw.counterparty ?? null, 120),
    categoryId,
    // Propozycja nowej kategorii ma sens tylko wtedy, gdy nie wybrano istniejącej.
    suggestedCategoryName: categoryId === null ? cleanText(raw.suggestedCategoryName, 50) : null,
    confidence: raw.confidence,
  };
}

/** Wynik walidacji odpowiedzi. */
export type ParsedExtraction =
  | { readonly ok: true; readonly header: ExtractedHeader; readonly items: ExtractedItem[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Waliduje i normalizuje odpowiedź modelu.
 *
 * Błąd walidacji **nie jest ponawiany** (08 §8) — wołający zapisuje surową odpowiedź
 * i oznacza dokument jako `failed` z kodem `AI_SCHEMA_MISMATCH`.
 *
 * @param kind - Rodzaj odczytu.
 * @param text - Tekst odpowiedzi (JSON).
 * @param knownCategoryIds - Kategorie z kontekstu — inne identyfikatory są zerowane.
 * @returns Nagłówek i pozycje albo przyczyna odrzucenia.
 */
export function parseExtraction(
  kind: ExtractionKind,
  text: string,
  knownCategoryIds: ReadonlySet<string>,
): ParsedExtraction {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'Odpowiedź nie jest poprawnym JSON-em.' };
  }

  if (kind === 'bank_statement') {
    const parsed = StatementResponse.safeParse(json);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'schemat' };
    const value = parsed.data;
    return {
      ok: true,
      header: {
        merchant: null,
        bookedOn: validDateOrNull(value.periodTo),
        totalMinor: null,
        currency: 'PLN',
        confidence: value.confidence,
        notes: cleanText(value.notes, 500),
        accountHint: cleanText(value.accountHint, 120),
        periodFrom: validDateOrNull(value.periodFrom),
        periodTo: validDateOrNull(value.periodTo),
      },
      items: value.operations
        .map((operation) => normalizeItem(operation, knownCategoryIds))
        .filter((item): item is ExtractedItem => item !== null),
    };
  }

  const parsed = ReceiptResponse.safeParse(json);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'schemat' };
  const value = parsed.data;
  return {
    ok: true,
    header: {
      merchant: cleanText(value.merchant, 120),
      bookedOn: validDateOrNull(value.bookedOn),
      totalMinor: value.totalMinor === null ? null : Math.abs(value.totalMinor),
      currency: /^[A-Z]{3}$/u.test(value.currency) ? value.currency : 'PLN',
      confidence: value.confidence,
      notes: cleanText(value.notes, 500),
      accountHint: null,
      periodFrom: null,
      periodTo: null,
    },
    items: value.items
      .map((item) => normalizeItem(item, knownCategoryIds))
      .filter((item): item is ExtractedItem => item !== null),
  };
}
