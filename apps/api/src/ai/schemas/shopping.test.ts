import { describe, expect, it } from 'vitest';

import { listPhotoSchema, parseListPhoto, parseRecipe, recipeSchema, toMilli } from './shopping.js';

/** Odpowiedzi modelu dla list zakupów (08 §17.2). */

describe('toMilli', () => {
  it.each([
    [null, null],
    [2, 2000],
    [1.5, 1500],
    [0.0004, null],
    [0, null],
    [-1, null],
    [Number.POSITIVE_INFINITY, null],
    [1000, 1_000_000],
    [1000.5, null],
  ])('%s → %s', (value, milli) => {
    expect(toMilli(value)).toBe(milli);
  });
});

describe('parseListPhoto', () => {
  it('nazwy uporządkowane, ilość z jednostką albo wcale, pewność w bps', () => {
    const text = JSON.stringify({
      items: [
        {
          name: 'mleko',
          sourceText: 'mlko x2',
          quantity: 2,
          unit: null,
          section: 'dairy',
          confidence: 0.55,
        },
        {
          name: 'Chleb',
          sourceText: '',
          quantity: null,
          unit: 'pcs',
          section: 'bakery',
          confidence: 1.4,
        },
        {
          name: '   ',
          sourceText: '?',
          quantity: null,
          unit: null,
          section: 'other',
          confidence: 0.1,
        },
      ],
      notes: 'część nieczytelna',
    });
    expect(parseListPhoto(text)).toEqual({
      ok: true,
      value: {
        items: [
          {
            name: 'Mleko',
            sourceText: 'mlko x2',
            quantityMilli: 2000,
            unit: 'pcs',
            section: 'dairy',
            confidenceBps: 5500,
          },
          {
            name: 'Chleb',
            sourceText: 'Chleb',
            quantityMilli: null,
            unit: null,
            section: 'bakery',
            confidenceBps: 10_000,
          },
        ],
        notes: 'część nieczytelna',
      },
    });
  });

  it('zły JSON i zły kształt to odrzucenie', () => {
    expect(parseListPhoto('{')).toEqual({
      ok: false,
      reason: 'Odpowiedź nie jest poprawnym JSON-em.',
    });
    expect(parseListPhoto(JSON.stringify({ items: [{ name: 1 }] })).ok).toBe(false);
  });
});

describe('parseRecipe', () => {
  it('ilość bez jednostki („3 jajka") to sztuki, nie „do smaku" (ADR-102)', () => {
    const result = parseRecipe(
      JSON.stringify({
        title: null,
        baseServings: null,
        notes: null,
        ingredients: [
          {
            name: 'Jajka',
            sourceText: '3 jajka',
            amount: 3,
            unit: null,
            packageAmount: null,
            packageLabel: null,
            pantryStaple: false,
            section: 'dairy',
            confidence: 0.9,
          },
        ],
      }),
    );
    expect(result.ok && result.value.ingredients[0]).toMatchObject({
      baseAmountMilli: 3000,
      baseUnit: 'pcs',
    });
  });

  it('ilości bazowe w tysięcznych; „do smaku" bez ilości i opakowania', () => {
    const text = JSON.stringify({
      title: '  Brownie ',
      baseServings: 12,
      ingredients: [
        {
          name: 'czekolada gorzka',
          sourceText: '100 g czekolady',
          amount: 100,
          unit: 'g',
          packageAmount: 100,
          packageLabel: 'tabliczka',
          pantryStaple: false,
          section: 'dry_goods',
          confidence: 0.9,
        },
        {
          name: 'Sól',
          sourceText: 'szczypta soli',
          amount: null,
          unit: 'g',
          packageAmount: 1000,
          packageLabel: ' ',
          pantryStaple: true,
          section: 'dry_goods',
          confidence: 0.95,
        },
      ],
      notes: null,
    });
    expect(parseRecipe(text)).toEqual({
      ok: true,
      value: {
        title: 'Brownie',
        baseServings: 12,
        ingredients: [
          {
            name: 'Czekolada gorzka',
            sourceText: '100 g czekolady',
            baseAmountMilli: 100_000,
            baseUnit: 'g',
            packageAmountMilli: 100_000,
            packageLabel: 'tabliczka',
            pantryStaple: false,
            section: 'dry_goods',
            confidenceBps: 9000,
          },
          {
            name: 'Sól',
            sourceText: 'szczypta soli',
            baseAmountMilli: null,
            baseUnit: null,
            packageAmountMilli: null,
            packageLabel: null,
            pantryStaple: true,
            section: 'dry_goods',
            confidenceBps: 9500,
          },
        ],
        notes: null,
      },
    });
  });

  it('niedorzeczne porcje to brak porcji; zły JSON to odrzucenie', () => {
    const base = { title: null, ingredients: [], notes: 'to nie przepis' };
    expect(parseRecipe(JSON.stringify({ ...base, baseServings: 0 }))).toMatchObject({
      ok: true,
      value: { baseServings: null },
    });
    expect(parseRecipe('x')).toMatchObject({ ok: false });
    expect(parseRecipe(JSON.stringify({ ...base, baseServings: 'dwie' })).ok).toBe(false);
  });

  it('schematy są ścisłe — każdy obiekt bez dodatkowych pól', () => {
    for (const schema of [listPhotoSchema, recipeSchema]) {
      expect(JSON.stringify(schema)).toContain('"additionalProperties":false');
    }
  });
});
