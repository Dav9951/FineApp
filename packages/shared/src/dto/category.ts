import { z } from 'zod';

import { CategoryKindSchema } from '../domain/enums.js';
import {
  HexColorSchema,
  IdSchema,
  MonthKeySchema,
  NonNegativeAmountMinorSchema,
} from '../domain/primitives.js';

/**
 * Kontrakty kategorii
 * ([05 §6](../../../../plans/05-dto-contracts.md#6-kategorie--dtocategorydtots)).
 */

/** Kategoria wydatku, przychodu lub transferu. */
export const CategoryDtoSchema = z.object({
  id: IdSchema,
  parentId: IdSchema.nullable(),
  name: z.string(),
  /** Stały identyfikator tekstowy; nie zmienia się przy zmianie nazwy (ADR-033). */
  slug: z.string(),
  kind: CategoryKindSchema,
  icon: z.string().nullable(),
  color: HexColorSchema.nullable(),
  /** Słowa kluczowe i nazwy sprzedawców pomagające AI dopasować kategorię. */
  aiHints: z.string().nullable(),
  isSystem: z.boolean(),
  isArchived: z.boolean(),
  sortOrder: z.number().int(),
});
/** Kategoria. */
export type CategoryDto = z.infer<typeof CategoryDtoSchema>;

/** Kategoria wraz z podkategoriami (maks. jeden poziom zagnieżdżenia). */
export const CategoryTreeDtoSchema = CategoryDtoSchema.extend({
  children: z.array(CategoryDtoSchema),
});
/** Kategoria główna z podkategoriami. */
export type CategoryTreeDto = z.infer<typeof CategoryTreeDtoSchema>;

/** Nazwa kategorii — przycięta, niepusta; wspólna dla formularza i kategorii zakładanych przy commicie dokumentu. */
export const CategoryNameSchema = z
  .string()
  .trim()
  .min(1, 'Nazwa jest wymagana')
  .max(50, 'Nazwa może mieć najwyżej 50 znaków');

/** Podpowiedzi dla AI — lista po przecinku. */
const AiHintsSchema = z
  .string()
  .trim()
  .max(500, 'Podpowiedzi mogą mieć najwyżej 500 znaków')
  .nullish();

/** Dane nowej kategorii; podkategoria przez `parentId`. */
export const CreateCategoryRequestSchema = z.object({
  name: CategoryNameSchema,
  kind: CategoryKindSchema,
  parentId: IdSchema.nullish(),
  icon: z.string().max(40).nullish(),
  color: HexColorSchema.nullish(),
  aiHints: AiHintsSchema,
});
/** Dane nowej kategorii po walidacji. */
export type CreateCategoryRequest = z.infer<typeof CreateCategoryRequestSchema>;

/**
 * Zmiana kategorii — każde pole opcjonalne, `null` czyści pole.
 *
 * **Bez `kind`.** Zmiana rodzaju kategorii z przypisanymi transakcjami złamałaby
 * niezmiennik I-4 (wydatek z kategorią przychodową). Kto chce przenieść transakcje
 * do kategorii innego rodzaju, zmienia typ samych transakcji.
 *
 * `parentId: null` przenosi podkategorię na poziom główny; identyfikator — pod inną
 * kategorię główną tego samego rodzaju (I-11).
 */
export const UpdateCategoryRequestSchema = z.object({
  name: CategoryNameSchema.optional(),
  parentId: IdSchema.nullish(),
  icon: z.string().max(40).nullish(),
  color: HexColorSchema.nullish(),
  aiHints: AiHintsSchema,
});
/** Zmiana kategorii po walidacji. */
export type UpdateCategoryRequest = z.infer<typeof UpdateCategoryRequestSchema>;

/**
 * Parametry list kategorii (`/categories` i `/categories/flat`).
 *
 * `includeArchived` przyjmuje wyłącznie `"true"`/`"false"` — `z.coerce.boolean()`
 * zamieniłoby napis `"false"` na `true` (ADR-031).
 */
export const ListCategoriesQuerySchema = z.object({
  kind: CategoryKindSchema.optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
/** Parametry list kategorii po walidacji. */
export type ListCategoriesQuery = z.infer<typeof ListCategoriesQuerySchema>;

/** Scalenie kategorii w inną (07 §9.3). */
export const MergeCategoryRequestSchema = z.object({
  targetCategoryId: IdSchema,
});
/** Scalenie kategorii po walidacji. */
export type MergeCategoryRequest = z.infer<typeof MergeCategoryRequestSchema>;

/** Wynik scalenia: kategoria docelowa po zmianie i liczba przepiętych transakcji. */
export const MergeCategoryResponseSchema = z.object({
  target: CategoryDtoSchema,
  transactionsMoved: z.number().int().nonnegative(),
});
/** Wynik scalenia. */
export type MergeCategoryResponse = z.infer<typeof MergeCategoryResponseSchema>;

/** Parametry `GET /categories/usage` (ADR-038). */
export const CategoryUsageQuerySchema = z.object({
  /** Miesiąc, dla którego liczona jest suma kwot. */
  month: MonthKeySchema,
});
/** Parametry statystyki użycia kategorii po walidacji. */
export type CategoryUsageQuery = z.infer<typeof CategoryUsageQuerySchema>;

/**
 * Użycie jednej kategorii — do ekranu `/settings/categories` (06 §3.11, ADR-038).
 *
 * Wyłącznie kategorie z co najmniej jedną transakcją; brak wiersza znaczy „zero".
 * Liczby dotyczą **samej** kategorii, bez podkategorii — sumę dla rodzica składa front,
 * bo to on wie, które podkategorie pokazuje.
 */
export const CategoryUsageDtoSchema = z.object({
  categoryId: IdSchema,
  /** Liczba transakcji w księdze (bez kosza), ze wszystkich miesięcy. */
  transactionCount: z.number().int().nonnegative(),
  /** Suma kwot zaksięgowanych transakcji w podanym miesiącu; dodatnia. */
  monthAmountMinor: NonNegativeAmountMinorSchema,
});
/** Użycie kategorii. */
export type CategoryUsageDto = z.infer<typeof CategoryUsageDtoSchema>;
