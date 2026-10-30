import { describe, expect, it } from 'vitest';

import {
  CategoryTreeDtoSchema,
  CategoryUsageDtoSchema,
  CategoryUsageQuerySchema,
  CreateCategoryRequestSchema,
  ListCategoriesQuerySchema,
  MergeCategoryRequestSchema,
  MergeCategoryResponseSchema,
  UpdateCategoryRequestSchema,
} from './category.js';

/**
 * Testy kontraktów kategorii
 * ([05 §6](../../../../plans/05-dto-contracts.md#6-kategorie--dtocategorydtots)).
 */

const ID = '01J9ZQK8WQ0000000000000000';

/** Pełna kategoria do wypełniania przykładów. */
const CATEGORY = {
  id: ID,
  parentId: null,
  name: 'Jedzenie',
  slug: 'jedzenie',
  kind: 'expense',
  icon: null,
  color: null,
  aiHints: 'Biedronka, Lidl',
  isSystem: true,
  isArchived: false,
  sortOrder: 0,
} as const;

describe('CreateCategoryRequestSchema', () => {
  it('przyjmuje przykład z 04 §6', () => {
    const parsed = CreateCategoryRequestSchema.parse({
      name: 'Kawa na mieście',
      kind: 'expense',
      parentId: ID,
      icon: 'coffee',
      color: '#a16207',
      aiHints: 'Starbucks, Costa, kawiarnia, espresso',
    });
    expect(parsed.name).toBe('Kawa na mieście');
  });

  it('przycina nazwę i podpowiedzi', () => {
    const parsed = CreateCategoryRequestSchema.parse({
      name: '  Kawa ',
      kind: 'expense',
      aiHints: ' Costa ',
    });
    expect(parsed).toMatchObject({ name: 'Kawa', aiHints: 'Costa' });
  });

  it('odrzuca pustą nazwę, zbyt długie podpowiedzi i nieznany rodzaj', () => {
    const result = CreateCategoryRequestSchema.safeParse({
      name: ' ',
      kind: 'saving',
      aiHints: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['name', 'kind', 'aiHints']));
  });
});

describe('UpdateCategoryRequestSchema', () => {
  it('nie przyjmuje zmiany rodzaju — pole jest odrzucane', () => {
    expect(UpdateCategoryRequestSchema.parse({ kind: 'income', name: 'X' })).toEqual({
      name: 'X',
    });
  });

  it('null przenosi na poziom główny i czyści pola', () => {
    expect(UpdateCategoryRequestSchema.parse({ parentId: null, aiHints: null })).toEqual({
      parentId: null,
      aiHints: null,
    });
  });
});

describe('ListCategoriesQuerySchema', () => {
  it('domyślnie bez zarchiwizowanych i bez filtra rodzaju', () => {
    expect(ListCategoriesQuerySchema.parse({})).toEqual({ includeArchived: false });
  });

  it('czyta rodzaj i "true"', () => {
    expect(ListCategoriesQuerySchema.parse({ kind: 'income', includeArchived: 'true' })).toEqual({
      kind: 'income',
      includeArchived: true,
    });
  });
});

describe('scalanie i drzewo', () => {
  it('scalanie wymaga identyfikatora celu', () => {
    expect(MergeCategoryRequestSchema.safeParse({}).success).toBe(false);
    expect(MergeCategoryRequestSchema.parse({ targetCategoryId: ID })).toEqual({
      targetCategoryId: ID,
    });
  });

  it('odpowiedź scalenia i drzewo przyjmują pełne kategorie', () => {
    expect(
      MergeCategoryResponseSchema.safeParse({ target: CATEGORY, transactionsMoved: 3 }).success,
    ).toBe(true);
    expect(
      CategoryTreeDtoSchema.safeParse({
        ...CATEGORY,
        children: [{ ...CATEGORY, parentId: ID, slug: 'jedzenie-kawa' }],
      }).success,
    ).toBe(true);
  });
});

describe('użycie kategorii (ADR-038)', () => {
  it('parametr wymaga poprawnego miesiąca', () => {
    expect(CategoryUsageQuerySchema.safeParse({}).success).toBe(false);
    expect(CategoryUsageQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(CategoryUsageQuerySchema.parse({ month: '2026-09' })).toEqual({ month: '2026-09' });
  });

  it('liczba i suma nie mogą być ujemne', () => {
    const usage = { categoryId: ID, transactionCount: 3, monthAmountMinor: 12799 };
    expect(CategoryUsageDtoSchema.safeParse(usage).success).toBe(true);
    expect(CategoryUsageDtoSchema.safeParse({ ...usage, transactionCount: -1 }).success).toBe(
      false,
    );
    expect(CategoryUsageDtoSchema.safeParse({ ...usage, monthAmountMinor: -1 }).success).toBe(
      false,
    );
  });
});
