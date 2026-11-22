import { describe, expect, it } from 'vitest';

import {
  CreateShoppingImportRequestSchema,
  CreateShoppingItemRequestSchema,
  CreateShoppingListRequestSchema,
  QuantityMilliSchema,
  ServingsFactorBpsSchema,
  ShoppingProductsQuerySchema,
  UpdateShoppingImportItemRequestSchema,
  UpdateShoppingItemRequestSchema,
  UpdateShoppingListRequestSchema,
  UpdateShoppingProductRequestSchema,
} from './shopping.js';

const ID = '01JC7K0000000000000000000A';

describe('ilość i mnożnik', () => {
  it('ilość: całkowita, dodatnia, najwyżej 1000 jednostek', () => {
    expect(QuantityMilliSchema.safeParse(1).success).toBe(true);
    expect(QuantityMilliSchema.safeParse(1_000_000).success).toBe(true);
    expect(QuantityMilliSchema.safeParse(1_000_001).success).toBe(false);
    expect(QuantityMilliSchema.safeParse(0).success).toBe(false);
    expect(QuantityMilliSchema.safeParse(1.5).success).toBe(false);
  });

  it('mnożnik ×0,25…×4', () => {
    expect(ServingsFactorBpsSchema.safeParse(2_500).success).toBe(true);
    expect(ServingsFactorBpsSchema.safeParse(40_000).success).toBe(true);
    expect(ServingsFactorBpsSchema.safeParse(2_499).success).toBe(false);
    expect(ServingsFactorBpsSchema.safeParse(40_001).success).toBe(false);
  });
});

describe('listy', () => {
  it('nazwa przycięta, 1–60 znaków', () => {
    expect(CreateShoppingListRequestSchema.parse({ name: '  Decathlon ' }).name).toBe('Decathlon');
    expect(CreateShoppingListRequestSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(CreateShoppingListRequestSchema.safeParse({ name: 'a'.repeat(61) }).success).toBe(false);
  });

  it('zmiana: domyślnej nie zdejmuje się wprost', () => {
    expect(UpdateShoppingListRequestSchema.safeParse({}).success).toBe(true);
    expect(UpdateShoppingListRequestSchema.safeParse({ isDefault: false }).success).toBe(false);
    expect(UpdateShoppingListRequestSchema.safeParse({ isDefault: true }).success).toBe(true);
    expect(UpdateShoppingListRequestSchema.safeParse({ archived: false }).success).toBe(true);
  });
});

describe('pozycje (I-27)', () => {
  it('nowa: ilość z jednostką albo bez obu', () => {
    expect(CreateShoppingItemRequestSchema.safeParse({ name: 'Mleko' }).success).toBe(true);
    expect(
      CreateShoppingItemRequestSchema.safeParse({ name: 'Mleko', quantityMilli: 2000, unit: 'pcs' })
        .success,
    ).toBe(true);
    expect(
      CreateShoppingItemRequestSchema.safeParse({ name: 'Mleko', quantityMilli: null, unit: null })
        .success,
    ).toBe(true);
    expect(
      CreateShoppingItemRequestSchema.safeParse({ name: 'Mleko', quantityMilli: 2000 }).success,
    ).toBe(false);
    expect(CreateShoppingItemRequestSchema.safeParse({ name: 'Mleko', unit: 'pcs' }).success).toBe(
      false,
    );
  });

  it('nowa: pusta notatka to brak notatki, identyfikator od klienta', () => {
    expect(CreateShoppingItemRequestSchema.parse({ id: ID, name: 'Mleko', note: '  ' })).toEqual({
      id: ID,
      name: 'Mleko',
      note: null,
    });
    expect(CreateShoppingItemRequestSchema.safeParse({ id: 'zly', name: 'Mleko' }).success).toBe(
      false,
    );
  });

  it.each([
    [{}, true],
    [{ checked: true }, true],
    [{ quantityMilli: 1500, unit: 'kg' }, true],
    [{ quantityMilli: null, unit: null }, true],
    [{ quantityMilli: 1500 }, false],
    [{ unit: 'kg' }, false],
    [{ quantityMilli: null, unit: 'kg' }, false],
    [{ quantityMilli: 1500, unit: null }, false],
  ])('zmiana %j → %s', (body, ok) => {
    expect(UpdateShoppingItemRequestSchema.safeParse(body).success).toBe(ok);
    expect(UpdateShoppingImportItemRequestSchema.safeParse(body).success).toBe(ok);
  });
});

describe('słownik', () => {
  it('zapytanie: domyślny limit, flaga tak/nie', () => {
    expect(ShoppingProductsQuerySchema.parse({})).toEqual({ limit: 10 });
    expect(ShoppingProductsQuerySchema.parse({ staple: 'true', limit: '50' })).toEqual({
      staple: true,
      limit: 50,
    });
  });

  it('zmiana produktu: pusta zmiana jest dozwolona', () => {
    expect(UpdateShoppingProductRequestSchema.safeParse({}).success).toBe(true);
    expect(UpdateShoppingProductRequestSchema.safeParse({ isStaple: false }).success).toBe(true);
  });
});

describe('importy', () => {
  it('link tylko http(s), tekst co najmniej 20 znaków', () => {
    const base = { listId: ID, kind: 'recipe', servingsFactorBps: 10_000 };
    expect(
      CreateShoppingImportRequestSchema.safeParse({ ...base, input: 'url', url: 'https://x.pl/p' })
        .success,
    ).toBe(true);
    expect(
      CreateShoppingImportRequestSchema.safeParse({
        ...base,
        input: 'url',
        url: 'file:///etc/passwd',
      }).success,
    ).toBe(false);
    expect(
      CreateShoppingImportRequestSchema.safeParse({ ...base, input: 'text', text: 'za krótko' })
        .success,
    ).toBe(false);
    expect(
      CreateShoppingImportRequestSchema.safeParse({ ...base, input: 'text', text: 'a'.repeat(20) })
        .success,
    ).toBe(true);
  });
});
