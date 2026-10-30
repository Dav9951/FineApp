import { describe, expect, it } from 'vitest';

import * as enums from './enums.js';

/** Minimalny kształt schematu enumu, którego dotyczą te testy. */
interface EnumSchema {
  readonly options: readonly string[];
}

/** Wszystkie schematy enumów wyeksportowane z modułu. */
const schemas: [string, EnumSchema][] = Object.entries(
  enums as unknown as Record<string, EnumSchema>,
).filter(([, schema]) => Array.isArray(schema.options));

describe('enumy domenowe', () => {
  it('eksportuje komplet schematów z 05 §2', () => {
    expect(schemas.length).toBe(25);
  });

  it.each(schemas)('%s ma niepuste, unikalne wartości', (_name, schema) => {
    expect(schema.options.length).toBeGreaterThan(0);
    expect(new Set(schema.options).size).toBe(schema.options.length);
  });

  it.each(schemas)('%s używa snake_case, bo te same napisy idą do CHECK w DDL', (_name, schema) => {
    for (const option of schema.options) {
      expect(option).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('klasa alokacji pokrywa trzy pule z 07 §2.1', () => {
    expect(enums.AllocationClassSchema.options).toEqual(['spending', 'savings', 'investment']);
  });

  it('rodzaj kategorii pokrywa się z typem transakcji (niezmiennik I-4)', () => {
    expect([...enums.CategoryKindSchema.options]).toEqual([...enums.TransactionTypeSchema.options]);
  });

  it('pula alokacji obejmuje spłatę zobowiązań (ADR-011)', () => {
    expect(enums.AllocationKindSchema.options).toContain('debt_repayment');
  });

  it('linia budżetu ma cztery strony bilansu z 07 §13.4', () => {
    expect(enums.BudgetLineFlowSchema.options).toEqual([
      'income',
      'expense',
      'savings',
      'investment',
    ]);
  });

  it('sekcja szkicu łączy oszczędności i inwestycje w pule (ADR-081)', () => {
    expect(enums.BudgetSectionSchema.options).toEqual(['income', 'expense', 'pools']);
  });

  it('pochodzenie linii budżetu obejmuje linię własną i pięć źródeł z 07 §13.2', () => {
    expect(enums.BudgetLineOriginSchema.options).toEqual([
      'manual',
      'recurring',
      'planned',
      'set_aside',
      'goal',
      'liability',
    ]);
  });

  it('odrzuca wartość spoza zbioru', () => {
    expect(enums.AccountTypeSchema.safeParse('kredytowe').success).toBe(false);
    expect(enums.TransactionTypeSchema.safeParse('Expense').success).toBe(false);
  });
});
