import { describe, expect, it } from 'vitest';

import {
  ExpectedRecipeSchema,
  namesMatch,
  scoreEntries,
  shoppingQualityReport,
  type PredictedEntry,
} from './shopping-metrics.js';

/**
 * Wskaźniki jakości importów list (`F10-10`).
 */

/**
 * Pozycja modelu.
 *
 * @param name - Nazwa.
 * @param amountMilli - Ilość.
 * @param unit - Jednostka.
 * @param pantryStaple - Zawsze w domu.
 * @returns Pozycja.
 */
function got(
  name: string,
  amountMilli: number | null = null,
  unit: string | null = null,
  pantryStaple = false,
): PredictedEntry {
  return { name, amountMilli, unit, pantryStaple };
}

describe('namesMatch', () => {
  it.each([
    ['czekolada gorzka', 'Czekolady gorzkiej'],
    ['Mleko', 'Mleko 2%'],
    ['jajka', 'Jajko'],
    ['masło', 'Masło extra'],
    ['Żółty ser', 'ser żółty'],
  ])('%s ~ %s', (a, b) => {
    expect(namesMatch(a, b)).toBe(true);
  });

  it.each([
    ['mleko', 'masło'],
    ['cukier puder', 'cukier'],
    ['', 'mleko'],
  ])('%s ≁ %s', (a, b) => {
    expect(namesMatch(a, b)).toBe(a === 'cukier puder');
  });
});

describe('scoreEntries', () => {
  it('liczy znalezione, nadmiarowe, ilości z tolerancją, flagę i porcje', () => {
    const expected = ExpectedRecipeSchema.parse({
      baseServings: 12,
      ingredients: [
        { name: 'czekolada', baseAmountMilli: 200_000, baseUnit: 'g' },
        { name: 'jajka', baseAmountMilli: 3000, baseUnit: 'pcs' },
        { name: 'sól', pantryStaple: true },
        { name: 'kakao', baseAmountMilli: 30_000, baseUnit: 'g' },
      ],
    });
    const score = scoreEntries(
      expected.ingredients.map((i) => ({
        name: i.name,
        amountMilli: i.baseAmountMilli,
        unit: i.baseUnit,
        pantryStaple: i.pantryStaple,
      })),
      [
        got('Czekolada gorzka', 190_000, 'g'),
        got('Jajka', 3000, 'g'),
        got('Sól', null, null, true),
        got('Orzechy'),
      ],
      { expected: 12, predicted: 12 },
    );
    expect(score).toEqual({
      expected: 4,
      found: 3,
      extra: 1,
      amountChecked: 2,
      amountCorrect: 1,
      stapleCorrect: 3,
      servingsCorrect: true,
    });
  });

  it('jedna pozycja modelu paruje się tylko raz', () => {
    const score = scoreEntries(
      [
        { name: 'mleko', amountMilli: null, unit: null, pantryStaple: false },
        { name: 'mleko', amountMilli: null, unit: null, pantryStaple: false },
      ],
      [got('Mleko')],
      null,
    );
    expect(score.found).toBe(1);
    expect(score.servingsCorrect).toBeNull();
  });
});

describe('shoppingQualityReport', () => {
  it('cele spełnione i niespełnione', () => {
    const perfect = scoreEntries(
      [{ name: 'mleko', amountMilli: 1000, unit: 'pcs', pantryStaple: false }],
      [got('Mleko', 1000, 'pcs')],
      null,
    );
    expect(shoppingQualityReport([perfect])).toMatchObject({
      samples: 1,
      recall: 1,
      extraRate: 0,
      amountAccuracy: 1,
      servingsAccuracy: null,
      meetsTargets: true,
    });
    const poor = scoreEntries(
      [{ name: 'mleko', amountMilli: null, unit: null, pantryStaple: false }],
      [got('Chleb')],
      null,
    );
    expect(shoppingQualityReport([poor]).meetsTargets).toBe(false);
    expect(shoppingQualityReport([]).recall).toBeNull();
  });
});
