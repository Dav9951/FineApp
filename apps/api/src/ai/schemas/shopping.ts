import {
  MAX_QUANTITY_MILLI,
  ShoppingSectionSchema,
  ShoppingUnitSchema,
  tidyShoppingName,
  type ShoppingSection,
  type ShoppingUnit,
} from '@fineapp/shared';
import { z } from 'zod';

import type { JsonSchema } from './extraction.js';

/**
 * Schematy odpowiedzi modelu dla list zakupów
 * ([08 §17.2](../../../../../plans/08-ocr-ai-pipeline.md#172-schematy-odpowiedzi), ADR-094).
 *
 * Structured outputs (`output_config.format`) jak przy dokumentach (ADR-059): wszystkie
 * pola wymagane, brak to `null`, `additionalProperties: false`. Liczby od modelu są
 * dziesiętne w jednostce naturalnej — **tu i tylko tu** zamieniają się na tysięczne
 * (ADR-097 pkt 6); dalej wyłącznie liczby całkowite.
 */

/**
 * Pole, które może być `null`.
 *
 * @param schema - Schemat wartości niepustej.
 * @param description - Opis dla modelu.
 * @returns Schemat JSON.
 */
function nullable(schema: JsonSchema, description: string): JsonSchema {
  return { anyOf: [schema, { type: 'null' }], description };
}

/**
 * Obiekt ze wszystkimi polami wymaganymi.
 *
 * @param properties - Pola.
 * @returns Schemat JSON obiektu.
 */
function strictObject(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const SECTION: JsonSchema = {
  type: 'string',
  enum: [...ShoppingSectionSchema.options],
  description: 'Dział sklepu z listy DZIAŁY.',
};

const CONFIDENCE: JsonSchema = {
  type: 'number',
  description: 'Pewność odczytu tej pozycji, 0–1. Zaniżona jest użyteczna, zawyżona szkodliwa.',
};

/** Schemat odpowiedzi dla zdjęcia listy (`extract_shopping_list`). */
export const listPhotoSchema: JsonSchema = strictObject({
  items: {
    type: 'array',
    description: 'Pozycje listy zakupów, bez skreślonych i odhaczonych.',
    items: strictObject({
      name: {
        type: 'string',
        description: 'Nazwa w formie, w jakiej się kupuje, z wielkiej litery, np. „Jajka".',
      },
      sourceText: { type: 'string', description: 'Dokładnie to, co odczytano z kartki.' },
      quantity: nullable({ type: 'number' }, 'Ilość tylko, gdy jest napisana na kartce.'),
      unit: nullable(
        { type: 'string', enum: [...ShoppingUnitSchema.options] },
        'pcs = sztuki, pack = opakowania, kg, g, l, ml; null gdy brak ilości.',
      ),
      section: SECTION,
      confidence: CONFIDENCE,
    }),
  },
  notes: nullable({ type: 'string' }, 'Uwagi, np. „część tablicy nieczytelna".'),
});

/** Schemat odpowiedzi dla przepisu (`extract_recipe_ingredients`). */
export const recipeSchema: JsonSchema = strictObject({
  title: nullable({ type: 'string' }, 'Tytuł przepisu.'),
  baseServings: nullable(
    { type: 'integer' },
    'Liczba porcji z przepisu (np. „na 4 osoby", „12 kawałków"); null gdy nie podano.',
  ),
  ingredients: {
    type: 'array',
    items: strictObject({
      name: { type: 'string', description: 'Produkt, jak się go kupuje: „Czekolada gorzka".' },
      sourceText: { type: 'string', description: 'Fragment przepisu, np. „100 g czekolady".' },
      amount: nullable(
        { type: 'number' },
        'Ilość BAZOWA z przepisu, bez mnożenia i zaokrąglania; null = do smaku / szczypta.',
      ),
      unit: nullable(
        { type: 'string', enum: ['g', 'ml', 'pcs'] },
        'g, ml albo pcs (sztuki). Łyżki i szklanki przelicz na g albo ml.',
      ),
      packageAmount: nullable(
        { type: 'number' },
        'Typowe opakowanie w polskim sklepie, w tej samej jednostce; null gdy na sztuki lub wagę.',
      ),
      packageLabel: nullable({ type: 'string' }, 'np. „tabliczka", „kostka", „opak. 10 szt."'),
      pantryStaple: {
        type: 'boolean',
        description: 'Rzecz, którą ma prawie każdy dom (sól, pieprz, woda, olej).',
      },
      section: SECTION,
      confidence: CONFIDENCE,
    }),
  },
  notes: nullable({ type: 'string' }, 'Uwagi; gdy to nie jest przepis — powód.'),
});

/** Propozycja ze zdjęcia listy, po walidacji i przeliczeniu na tysięczne. */
export interface ParsedListItem {
  readonly name: string;
  readonly sourceText: string;
  readonly quantityMilli: number | null;
  readonly unit: ShoppingUnit | null;
  readonly section: ShoppingSection;
  readonly confidenceBps: number;
}

/** Składnik przepisu po walidacji i przeliczeniu na tysięczne. */
export interface ParsedIngredient {
  readonly name: string;
  readonly sourceText: string;
  readonly baseAmountMilli: number | null;
  readonly baseUnit: 'g' | 'ml' | 'pcs' | null;
  readonly packageAmountMilli: number | null;
  readonly packageLabel: string | null;
  readonly pantryStaple: boolean;
  readonly section: ShoppingSection;
  readonly confidenceBps: number;
}

/** Wynik parsowania odpowiedzi. */
export type ParsedShopping<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

const NullableText = z.string().nullable();

const ListResponse = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      sourceText: z.string(),
      quantity: z.number().nullable(),
      unit: ShoppingUnitSchema.nullable(),
      section: ShoppingSectionSchema,
      confidence: z.number(),
    }),
  ),
  notes: NullableText,
});

const RecipeResponse = z.object({
  title: NullableText,
  baseServings: z.number().int().nullable(),
  ingredients: z.array(
    z.object({
      name: z.string(),
      sourceText: z.string(),
      amount: z.number().nullable(),
      unit: z.enum(['g', 'ml', 'pcs']).nullable(),
      packageAmount: z.number().nullable(),
      packageLabel: NullableText,
      pantryStaple: z.boolean(),
      section: ShoppingSectionSchema,
      confidence: z.number(),
    }),
  ),
  notes: NullableText,
});

/**
 * Liczba od modelu w tysięcznych — jedyne miejsce z ułamkiem (ADR-097 pkt 6). Zero,
 * ujemna, nieskończona albo ponad 1000 jednostek to „brak liczby".
 *
 * @param value - Liczba dziesiętna w jednostce naturalnej.
 * @returns Tysięczne albo `null`.
 */
export function toMilli(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const milli = Math.round(value * 1000);
  return milli > 0 && milli <= MAX_QUANTITY_MILLI ? milli : null;
}

/**
 * Pewność 0–1 w bps, przycięta do zakresu.
 *
 * @param value - Pewność od modelu.
 * @returns 0…10 000.
 */
function toBps(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(10_000, Math.max(0, Math.round(value * 10_000)));
}

/**
 * Nazwa i tekst źródłowy przycięte do limitów kolumn; pusta nazwa — pozycja pominięta.
 *
 * @param name - Nazwa od modelu.
 * @param sourceText - Tekst źródłowy.
 * @returns Uporządkowane pola albo `null`.
 */
function cleanNames(name: string, sourceText: string): { name: string; sourceText: string } | null {
  const tidy = tidyShoppingName(name).slice(0, 80);
  if (tidy === '') return null;
  return { name: tidy, sourceText: sourceText.trim().slice(0, 300) || tidy };
}

/**
 * Parsuje odpowiedź dla zdjęcia listy.
 *
 * @param text - JSON od modelu.
 * @returns Propozycje i uwagi albo przyczyna odrzucenia.
 */
export function parseListPhoto(
  text: string,
): ParsedShopping<{ items: ParsedListItem[]; notes: string | null }> {
  const json = safeJson(text);
  if (json === undefined) return { ok: false, reason: 'Odpowiedź nie jest poprawnym JSON-em.' };
  const parsed = ListResponse.safeParse(json);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'schemat' };
  const items = parsed.data.items.flatMap((item): ParsedListItem[] => {
    const names = cleanNames(item.name, item.sourceText);
    if (names === null) return [];
    const quantityMilli = toMilli(item.quantity);
    return [
      {
        ...names,
        // I-27: ilość i jednostka razem albo wcale; liczba bez jednostki to sztuki.
        quantityMilli,
        unit: quantityMilli === null ? null : (item.unit ?? 'pcs'),
        section: item.section,
        confidenceBps: toBps(item.confidence),
      },
    ];
  });
  return { ok: true, value: { items, notes: parsed.data.notes?.slice(0, 500) ?? null } };
}

/**
 * Parsuje odpowiedź dla przepisu.
 *
 * @param text - JSON od modelu.
 * @returns Składniki z tytułem i porcjami albo przyczyna odrzucenia.
 */
export function parseRecipe(text: string): ParsedShopping<{
  title: string | null;
  baseServings: number | null;
  ingredients: ParsedIngredient[];
  notes: string | null;
}> {
  const json = safeJson(text);
  if (json === undefined) return { ok: false, reason: 'Odpowiedź nie jest poprawnym JSON-em.' };
  const parsed = RecipeResponse.safeParse(json);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'schemat' };
  const ingredients = parsed.data.ingredients.flatMap((item): ParsedIngredient[] => {
    const names = cleanNames(item.name, item.sourceText);
    if (names === null) return [];
    const baseAmountMilli = toMilli(item.amount);
    return [
      {
        ...names,
        baseAmountMilli,
        // „3 jajka” — ilość bez jednostki to sztuki, nie „do smaku” (ADR-102).
        baseUnit: baseAmountMilli === null ? null : (item.unit ?? 'pcs'),
        packageAmountMilli: baseAmountMilli === null ? null : toMilli(item.packageAmount),
        packageLabel: item.packageLabel?.trim().slice(0, 60) || null,
        pantryStaple: item.pantryStaple,
        section: item.section,
        confidenceBps: toBps(item.confidence),
      },
    ];
  });
  const servings = parsed.data.baseServings;
  return {
    ok: true,
    value: {
      title: parsed.data.title?.trim().slice(0, 120) || null,
      baseServings: servings !== null && servings > 0 && servings <= 1000 ? servings : null,
      ingredients,
      notes: parsed.data.notes?.slice(0, 500) ?? null,
    },
  };
}

/**
 * JSON z tekstu albo `undefined`.
 *
 * @param text - Tekst.
 * @returns Wartość albo `undefined`.
 */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
