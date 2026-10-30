import { describe, expect, it } from 'vitest';

import {
  CreateIncomeSourceRequestSchema,
  IncomeSourceDtoSchema,
  ListIncomeSourcesQuerySchema,
  UpdateIncomeSourceRequestSchema,
} from './income-source.js';

/** Testy kontraktów źródeł przychodu (05 §6a). */

const ID = '01J9ZQK8WQ0000000000000000';

describe('CreateIncomeSourceRequestSchema', () => {
  it('przycina nazwę i nie zgaduje flagi podstawy', () => {
    expect(CreateIncomeSourceRequestSchema.parse({ name: ' Pensja ', kind: 'salary' })).toEqual({
      name: 'Pensja',
      kind: 'salary',
    });
  });

  it('odrzuca pustą nazwę i nieznany rodzaj', () => {
    const result = CreateIncomeSourceRequestSchema.safeParse({ name: '', kind: 'lottery' });
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['name', 'kind']));
  });
});

describe('UpdateIncomeSourceRequestSchema', () => {
  it('null oznacza źródło wspólne', () => {
    expect(UpdateIncomeSourceRequestSchema.parse({ ownerUserId: null })).toEqual({
      ownerUserId: null,
    });
  });
});

describe('ListIncomeSourcesQuerySchema i DTO', () => {
  it('domyślnie bez zarchiwizowanych', () => {
    expect(ListIncomeSourcesQuerySchema.parse({})).toEqual({ includeArchived: false });
    expect(ListIncomeSourcesQuerySchema.parse({ includeArchived: 'true' })).toEqual({
      includeArchived: true,
    });
  });

  it('DTO przyjmuje pełne źródło', () => {
    expect(
      IncomeSourceDtoSchema.safeParse({
        id: ID,
        name: 'Pensja',
        kind: 'salary',
        ownerUserId: ID,
        countsTowardAllocation: true,
        isArchived: false,
        sortOrder: 0,
      }).success,
    ).toBe(true);
  });
});
