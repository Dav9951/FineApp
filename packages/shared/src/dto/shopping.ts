import { z } from 'zod';

import {
  ShoppingImportInputSchema,
  ShoppingImportKindSchema,
  ShoppingImportStatusSchema,
  ShoppingItemSourceSchema,
  ShoppingSectionSchema,
  ShoppingUnitSchema,
} from '../domain/enums.js';
import {
  BpsSchema,
  IdSchema,
  optionalText,
  OptionalFlagSchema,
  TimestampSchema,
} from '../domain/primitives.js';
import {
  MAX_QUANTITY_MILLI,
  SERVINGS_FACTOR_MAX_BPS,
  SERVINGS_FACTOR_MIN_BPS,
} from '../domain/shopping.js';

/**
 * Kontrakty list zakupów
 * ([05 §13c](../../../../plans/05-dto-contracts.md#13c-listy-zakupów--dtoshoppingts),
 * Faza 10, ADR-093…097). Reguły: `domain/shopping.ts` (07 §14).
 */

/** Ilość w tysięcznych częściach jednostki: 1,5 kg = 1500 (ADR-093). */
export const QuantityMilliSchema = z
  .number()
  .int('Ilość w tysięcznych musi być liczbą całkowitą')
  .positive('Ilość musi być większa od zera')
  .max(MAX_QUANTITY_MILLI, 'Ilość może mieć najwyżej 1000 jednostek');

/** Mnożnik porcji przepisu w bps: ×1 = 10 000, zakres ×0,25…×4. */
export const ServingsFactorBpsSchema = z
  .number()
  .int()
  .min(SERVINGS_FACTOR_MIN_BPS, 'Najmniejszy mnożnik to ×0,25')
  .max(SERVINGS_FACTOR_MAX_BPS, 'Największy mnożnik to ×4');

const ShoppingNameSchema = z
  .string()
  .trim()
  .min(1, 'Podaj nazwę')
  .max(80, 'Nazwa może mieć najwyżej 80 znaków');
const ShoppingListNameSchema = z
  .string()
  .trim()
  .min(1, 'Podaj nazwę listy')
  .max(60, 'Nazwa listy może mieć najwyżej 60 znaków');

/**
 * Spójność ilości i jednostki w zmianie (I-27, 05 §13c): obie wartości razem, albo `null`
 * w jednej z nich — co czyści obie. Sama liczba albo sama jednostka bez pary to błąd.
 *
 * @param value - Pola żądania.
 * @param value.quantityMilli - Ilość, `null` albo pominięta.
 * @param value.unit - Jednostka, `null` albo pominięta.
 * @returns `true`, gdy zmiana jest spójna.
 */
function quantityPairValid(value: {
  quantityMilli?: number | null | undefined;
  unit?: string | null | undefined;
}): boolean {
  if (value.quantityMilli === null || value.unit === null) {
    return value.quantityMilli == null && value.unit == null;
  }
  return (value.quantityMilli === undefined) === (value.unit === undefined);
}

const quantityPairIssue = { message: 'Ilość i jednostkę podaje się razem', path: ['unit'] };

/** Lista zakupów z licznikami (`GET /shopping-lists`). */
export const ShoppingListDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  isDefault: z.boolean(),
  archived: z.boolean(),
  sortOrder: z.number().int(),
  toBuyCount: z.number().int().nonnegative(),
  checkedCount: z.number().int().nonnegative(),
  lastActivityAt: TimestampSchema.nullable(),
  /** Imię domownika, który ostatnio coś zmienił. */
  lastActivityBy: z.string().nullable(),
  /** Importy `processing` / `parsed` tej listy — kafel „Odczyt gotowy do przejrzenia". */
  pendingImports: z.array(
    z.object({ id: IdSchema, status: ShoppingImportStatusSchema, kind: ShoppingImportKindSchema }),
  ),
});
/** Lista zakupów z licznikami. */
export type ShoppingListDto = z.infer<typeof ShoppingListDtoSchema>;

/** Pozycja listy zakupów. */
export const ShoppingItemDtoSchema = z.object({
  id: IdSchema,
  listId: IdSchema,
  productId: IdSchema.nullable(),
  name: z.string(),
  quantityMilli: QuantityMilliSchema.nullable(),
  unit: ShoppingUnitSchema.nullable(),
  note: z.string().nullable(),
  section: ShoppingSectionSchema,
  source: ShoppingItemSourceSchema,
  checked: z.boolean(),
  checkedAt: TimestampSchema.nullable(),
  /** Inicjały domownika, który odhaczył (17 §8). */
  checkedByInitials: z.string().nullable(),
  /** Produkt ze słownika ma flagę „zawsze w domu". */
  isStaple: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
/** Pozycja listy zakupów. */
export type ShoppingItemDto = z.infer<typeof ShoppingItemDtoSchema>;

/** Pozycje listy (`GET /shopping-lists/:id/items`) — bez wyczyszczonych, w kolejności ekranu. */
export const ShoppingItemsDtoSchema = z.object({
  list: ShoppingListDtoSchema,
  items: z.array(ShoppingItemDtoSchema),
});
/** Pozycje listy. */
export type ShoppingItemsDto = z.infer<typeof ShoppingItemsDtoSchema>;

/** Identyfikator w ścieżce (`/shopping-lists/:id`, `/shopping-items/:id`…). */
export const ShoppingIdParamsSchema = z.object({ id: IdSchema });

/** `POST /shopping-lists`. */
export const CreateShoppingListRequestSchema = z.object({ name: ShoppingListNameSchema });
/** Nowa lista. */
export type CreateShoppingListRequest = z.infer<typeof CreateShoppingListRequestSchema>;

/** `PATCH /shopping-lists/:id` — domyślną zmienia się, ustawiając inną (`isDefault: true`). */
export const UpdateShoppingListRequestSchema = z.object({
  name: ShoppingListNameSchema.optional(),
  isDefault: z.literal(true).optional(),
  archived: z.boolean().optional(),
});
/** Zmiana listy. */
export type UpdateShoppingListRequest = z.infer<typeof UpdateShoppingListRequestSchema>;

/** `POST /shopping-lists/:id/duplicate`. */
export const DuplicateShoppingListRequestSchema = z.object({ name: ShoppingListNameSchema });
/** Kopia listy. */
export type DuplicateShoppingListRequest = z.infer<typeof DuplicateShoppingListRequestSchema>;

/** `PATCH /shopping-lists/order`. */
export const ReorderShoppingListsRequestSchema = z.object({
  listIds: z.array(IdSchema).min(1).max(200),
});
/** Kolejność list. */
export type ReorderShoppingListsRequest = z.infer<typeof ReorderShoppingListsRequestSchema>;

/** `POST /shopping-lists/:id/items`. */
export const CreateShoppingItemRequestSchema = z
  .object({
    /** ULID od klienta przy dopisaniu offline — ponowienie nie dubluje pozycji (ADR-096). */
    id: IdSchema.optional(),
    name: ShoppingNameSchema,
    quantityMilli: QuantityMilliSchema.nullish(),
    unit: ShoppingUnitSchema.nullish(),
    note: optionalText(120),
    section: ShoppingSectionSchema.optional(),
  })
  .refine((value) => (value.quantityMilli == null) === (value.unit == null), quantityPairIssue);
/** Nowa pozycja. */
export type CreateShoppingItemRequest = z.infer<typeof CreateShoppingItemRequestSchema>;

/** `PATCH /shopping-items/:id` — pominięte pole to „bez zmian". */
export const UpdateShoppingItemRequestSchema = z
  .object({
    name: ShoppingNameSchema.optional(),
    quantityMilli: QuantityMilliSchema.nullable().optional(),
    unit: ShoppingUnitSchema.nullable().optional(),
    note: optionalText(120),
    section: ShoppingSectionSchema.optional(),
    checked: z.boolean().optional(),
    /** Przeniesienie na inną listę (ze scalaniem, 07 §14.3). */
    listId: IdSchema.optional(),
  })
  .refine(quantityPairValid, quantityPairIssue);
/** Zmiana pozycji. */
export type UpdateShoppingItemRequest = z.infer<typeof UpdateShoppingItemRequestSchema>;

/** Odpowiedź na dopisanie: pozycja i czy scaliła się z istniejącą. */
export const CreateShoppingItemResultSchema = z.object({
  item: ShoppingItemDtoSchema,
  merged: z.boolean(),
});
/** Wynik dopisania. */
export type CreateShoppingItemResult = z.infer<typeof CreateShoppingItemResultSchema>;

/** `POST /shopping-lists/:id/clear-checked`. */
export const ClearCheckedResultSchema = z.object({
  clearedIds: z.array(IdSchema),
  /** Nic nie zostało do kupienia — front proponuje archiwizację. */
  listEmpty: z.boolean(),
});
/** Wynik czyszczenia. */
export type ClearCheckedResult = z.infer<typeof ClearCheckedResultSchema>;

/** `POST /shopping-lists/:id/restore-cleared`. */
export const RestoreClearedRequestSchema = z.object({ itemIds: z.array(IdSchema).min(1).max(500) });
/** Cofnięcie czyszczenia. */
export type RestoreClearedRequest = z.infer<typeof RestoreClearedRequestSchema>;

/** Wynik cofnięcia — pozycje starsze niż 24 h albo już usunięte są pomijane. */
export const RestoreClearedResultSchema = z.object({ restoredIds: z.array(IdSchema) });
/** Wynik cofnięcia czyszczenia. */
export type RestoreClearedResult = z.infer<typeof RestoreClearedResultSchema>;

/** Produkt ze słownika gospodarstwa. */
export const ShoppingProductDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  section: ShoppingSectionSchema,
  isStaple: z.boolean(),
  useCount: z.number().int().nonnegative(),
  lastUsedAt: TimestampSchema.nullable(),
});
/** Produkt ze słownika. */
export type ShoppingProductDto = z.infer<typeof ShoppingProductDtoSchema>;

/** `GET /shopping-products?q=&staple=&limit=`. */
export const ShoppingProductsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  staple: OptionalFlagSchema,
  limit: z.coerce.number().int().min(1).max(200).default(10),
});
/** Zapytanie o słownik. */
export type ShoppingProductsQuery = z.infer<typeof ShoppingProductsQuerySchema>;

/** `GET /shopping-products/frequent?listId=`. */
export const FrequentProductsQuerySchema = z.object({ listId: IdSchema });
/** Zapytanie o „często kupowane". */
export type FrequentProductsQuery = z.infer<typeof FrequentProductsQuerySchema>;

/** `POST /shopping-products` — ręczne dopisanie albo zmiana flagi istniejącego. */
export const UpsertShoppingProductRequestSchema = z.object({
  name: ShoppingNameSchema,
  section: ShoppingSectionSchema.optional(),
  isStaple: z.boolean(),
});
/** Dopisanie produktu. */
export type UpsertShoppingProductRequest = z.infer<typeof UpsertShoppingProductRequestSchema>;

/** `PATCH /shopping-products/:id`. */
export const UpdateShoppingProductRequestSchema = z.object({
  name: ShoppingNameSchema.optional(),
  section: ShoppingSectionSchema.optional(),
  isStaple: z.boolean().optional(),
});
/** Zmiana produktu. */
export type UpdateShoppingProductRequest = z.infer<typeof UpdateShoppingProductRequestSchema>;

/** Propozycja z odczytu AI (`F10-8`). */
export const ShoppingImportItemDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  sourceText: z.string(),
  quantityMilli: QuantityMilliSchema.nullable(),
  unit: ShoppingUnitSchema.nullable(),
  quantityOverridden: z.boolean(),
  /** Tylko przepis: potrzeba po mnożniku, do dopisku „potrzeba 100 g" (P-2). */
  neededAmountMilli: z.number().int().positive().nullable(),
  baseUnit: z.enum(['g', 'ml', 'pcs']).nullable(),
  packageAmountMilli: z.number().int().positive().nullable(),
  packageLabel: z.string().nullable(),
  section: ShoppingSectionSchema,
  confidenceBps: BpsSchema,
  /** `confidenceBps < 6000` — plakietka „Sprawdź". */
  needsReview: z.boolean(),
  alreadyHave: z.boolean(),
  isStaple: z.boolean(),
  selected: z.boolean(),
  mergeInto: z
    .object({
      itemId: IdSchema,
      quantityMilli: QuantityMilliSchema.nullable(),
      unit: ShoppingUnitSchema.nullable(),
    })
    .nullable(),
});
/** Propozycja z odczytu. */
export type ShoppingImportItemDto = z.infer<typeof ShoppingImportItemDtoSchema>;

/** Import przez AI (`F10-8`, 04 §14b). */
export const ShoppingImportDtoSchema = z.object({
  id: IdSchema,
  listId: IdSchema,
  kind: ShoppingImportKindSchema,
  input: ShoppingImportInputSchema,
  status: ShoppingImportStatusSchema,
  sourceUrl: z.string().nullable(),
  servingsFactorBps: ServingsFactorBpsSchema.nullable(),
  recipeTitle: z.string().nullable(),
  baseServings: z.number().int().positive().nullable(),
  notes: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  items: z.array(ShoppingImportItemDtoSchema),
  createdAt: TimestampSchema,
});
/** Import przez AI. */
export type ShoppingImportDto = z.infer<typeof ShoppingImportDtoSchema>;

/** JSON-owa odmiana `POST /shopping-imports` (multipart ma te same pola tekstowe). */
export const CreateShoppingImportRequestSchema = z.discriminatedUnion('input', [
  z.object({
    input: z.literal('url'),
    listId: IdSchema,
    kind: z.literal('recipe'),
    url: z.url({ protocol: /^https?$/, error: 'Podaj adres strony z przepisem' }).max(2000),
    servingsFactorBps: ServingsFactorBpsSchema,
  }),
  z.object({
    input: z.literal('text'),
    listId: IdSchema,
    kind: z.literal('recipe'),
    text: z.string().trim().min(20, 'Wklej cały przepis').max(30_000),
    servingsFactorBps: ServingsFactorBpsSchema,
  }),
]);
/** Nowy import z linku albo tekstu. */
export type CreateShoppingImportRequest = z.infer<typeof CreateShoppingImportRequestSchema>;

/** `PATCH /shopping-imports/:id` — przeliczenie bez AI. */
export const UpdateShoppingImportRequestSchema = z.object({
  servingsFactorBps: ServingsFactorBpsSchema.optional(),
  listId: IdSchema.optional(),
});
/** Zmiana importu. */
export type UpdateShoppingImportRequest = z.infer<typeof UpdateShoppingImportRequestSchema>;

/** `PATCH /shopping-imports/:id/items/:itemId`. */
export const UpdateShoppingImportItemRequestSchema = z
  .object({
    name: ShoppingNameSchema.optional(),
    quantityMilli: QuantityMilliSchema.nullable().optional(),
    unit: ShoppingUnitSchema.nullable().optional(),
    section: ShoppingSectionSchema.optional(),
    selected: z.boolean().optional(),
    alreadyHave: z.boolean().optional(),
  })
  .refine(quantityPairValid, quantityPairIssue);
/** Korekta propozycji. */
export type UpdateShoppingImportItemRequest = z.infer<typeof UpdateShoppingImportItemRequestSchema>;

/** Wynik zatwierdzenia importu. */
export const CommitShoppingImportResultSchema = z.object({
  listId: IdSchema,
  addedCount: z.number().int().nonnegative(),
  mergedCount: z.number().int().nonnegative(),
});
/** Wynik zatwierdzenia importu. */
export type CommitShoppingImportResult = z.infer<typeof CommitShoppingImportResultSchema>;
