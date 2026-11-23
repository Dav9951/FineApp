import { describe, expect, it } from 'vitest';

import {
  SHOPPING_SECTION_KEYWORDS,
  SHOPPING_SECTION_LABELS,
  SHOPPING_UNIT_LABELS,
  STARTER_STAPLES,
} from '../constants/shopping.js';
import { ShoppingSectionSchema, ShoppingUnitSchema } from './enums.js';
import {
  findMergeTarget,
  formatShoppingQuantity,
  isAlreadyHave,
  MAX_QUANTITY_MILLI,
  mergeNotes,
  mergeQuantities,
  nextDefaultList,
  normalizeShoppingName,
  parseQuickAdd,
  recipePurchase,
  sortShoppingItems,
  suggestShoppingSection,
  tidyShoppingName,
  type MergeCandidate,
} from './shopping.js';

describe('normalizeShoppingName (07 §14.1)', () => {
  it.each([
    ['  Mąka   PSZENNA.', 'maka pszenna'],
    ['Łosoś', 'losos'],
    ['\uFB01let', 'filet'],
    ['ＭＬＥＫＯ', 'mleko'],
    ['żółć', 'zolc'],
    ['Mleko,;', 'mleko'],
    ['jajka', 'jajka'],
    ['   ', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizeShoppingName(input)).toBe(expected);
  });

  it('nie skleja liczby mnogiej z pojedynczą — bez stemmingu w v1', () => {
    expect(normalizeShoppingName('jajko')).not.toBe(normalizeShoppingName('jajka'));
  });
});

describe('tidyShoppingName', () => {
  it('przycina, skleja spacje i podnosi pierwszą literę', () => {
    expect(tidyShoppingName('  łosoś   wędzony ')).toBe('Łosoś wędzony');
    expect(tidyShoppingName('')).toBe('');
  });
});

describe('recipePurchase (07 §14.2)', () => {
  const choc = (base: number, pkg: number | null = 100_000) => ({
    baseAmountMilli: base,
    baseUnit: 'g' as const,
    packageAmountMilli: pkg,
  });

  it.each([
    [100_000, 1000],
    [105_000, 1000],
    [110_000, 1000],
    [111_000, 2000],
    [200_000, 2000],
    [210_000, 2000],
    [211_000, 3000],
  ])('%i milli g przy tabliczce 100 g → %i milli szt.', (base, expected) => {
    expect(recipePurchase(choc(base), 10_000)).toEqual({
      quantityMilli: expected,
      unit: 'pcs',
      neededAmountMilli: base,
    });
  });

  it('125 g masła ×0,5 przy kostce 200 g → 1 szt., potrzeba 62,5 g', () => {
    expect(recipePurchase(choc(125_000, 200_000), 5_000)).toEqual({
      quantityMilli: 1000,
      unit: 'pcs',
      neededAmountMilli: 62_500,
    });
  });

  it('zaokrągla potrzebę połową w górę, w liczbach całkowitych', () => {
    // 1 g × 0,25 = 0,25 g → 250 milli; 3 milli × 0,5 = 1,5 → 2.
    expect(recipePurchase(choc(1_000, 100_000), 2_500).neededAmountMilli).toBe(250);
    expect(recipePurchase(choc(3, 100_000), 5_000).neededAmountMilli).toBe(2);
    // Najmniejsza potrzeba to 1 milli — zero nie jest składnikiem.
    expect(recipePurchase(choc(1, 100_000), 2_500).neededAmountMilli).toBe(1);
  });

  it('×4 mnoży bez utraty dokładności', () => {
    expect(recipePurchase(choc(100_000), 40_000)).toEqual({
      quantityMilli: 4000,
      unit: 'pcs',
      neededAmountMilli: 400_000,
    });
  });

  const eggs = (count: number, pkg: number | null) => ({
    baseAmountMilli: count * 1000,
    baseUnit: 'pcs' as const,
    packageAmountMilli: pkg,
  });

  it('3 jajka ×1,5 przy opakowaniu 10 szt. → 1 opak.', () => {
    expect(recipePurchase(eggs(3, 10_000), 15_000)).toEqual({
      quantityMilli: 1000,
      unit: 'pack',
      neededAmountMilli: 4_500,
    });
  });

  it('12 jajek przy opakowaniu 10 szt. → 2 opak.', () => {
    expect(recipePurchase(eggs(12, 10_000), 10_000)).toMatchObject({
      quantityMilli: 2000,
      unit: 'pack',
    });
  });

  it('jajka bez opakowania → liczba sztuk w górę', () => {
    expect(recipePurchase(eggs(2, null), 10_000)).toMatchObject({
      quantityMilli: 2000,
      unit: 'pcs',
    });
    expect(recipePurchase(eggs(3, null), 15_000)).toMatchObject({
      quantityMilli: 5000,
      unit: 'pcs',
    });
  });

  it('sztuki w opakowaniu jednosztukowym to sztuki, nie opakowania', () => {
    expect(recipePurchase(eggs(2, 1000), 10_000)).toMatchObject({
      quantityMilli: 2000,
      unit: 'pcs',
    });
  });

  it('gram bez opakowania (cebula na wagę) → 1 szt.', () => {
    expect(recipePurchase(choc(300_000, null), 10_000)).toEqual({
      quantityMilli: 1000,
      unit: 'pcs',
      neededAmountMilli: 300_000,
    });
  });

  it('„do smaku" — bez ilości bazowej albo jednostki → 1 szt. bez potrzeby', () => {
    const expected = { quantityMilli: 1000, unit: 'pcs', neededAmountMilli: null };
    expect(
      recipePurchase({ baseAmountMilli: null, baseUnit: 'g', packageAmountMilli: 1000 }, 10_000),
    ).toEqual(expected);
    expect(
      recipePurchase({ baseAmountMilli: 5000, baseUnit: null, packageAmountMilli: null }, 10_000),
    ).toEqual(expected);
  });
});

describe('findMergeTarget (07 §14.3, I-29)', () => {
  const item = (over: Partial<MergeCandidate> & { id: string }): MergeCandidate => ({
    normalizedName: 'mleko',
    quantityMilli: null,
    unit: null,
    checked: false,
    createdAt: 1,
    ...over,
  });

  it('nic do scalenia → null', () => {
    expect(findMergeTarget([], 'mleko', 'pcs')).toBeNull();
    expect(findMergeTarget([item({ id: 'a', normalizedName: 'maslo' })], 'mleko', null)).toBeNull();
  });

  it('ta sama jednostka wygrywa', () => {
    const a = item({ id: 'a', unit: null });
    const b = item({ id: 'b', unit: 'pcs', quantityMilli: 2000, createdAt: 2 });
    expect(findMergeTarget([a, b], 'mleko', 'pcs')).toBe(b);
    expect(findMergeTarget([a, b], 'mleko', null)).toBe(a);
  });

  it('dopisywane bez ilości łączy się z najstarszą, także z ilością', () => {
    const a = item({ id: 'b', unit: 'kg', quantityMilli: 1000, createdAt: 5 });
    const b = item({ id: 'a', unit: 'pcs', quantityMilli: 1000, createdAt: 5 });
    expect(findMergeTarget([a, b], 'mleko', null)).toBe(b);
  });

  it('dopisywane z ilością łączy się z pozycją bez ilości', () => {
    const a = item({ id: 'a', unit: null });
    expect(findMergeTarget([a], 'mleko', 'pcs')).toBe(a);
  });

  it('różne jednostki zostają osobno', () => {
    expect(
      findMergeTarget([item({ id: 'a', unit: 'kg', quantityMilli: 1000 })], 'mleko', 'pcs'),
    ).toBeNull();
  });

  it('kupione nie są celem scalania', () => {
    expect(findMergeTarget([item({ id: 'a', checked: true })], 'mleko', null)).toBeNull();
  });
});

describe('mergeQuantities', () => {
  const q = (quantityMilli: number | null, unit: 'pcs' | 'kg' | null) => ({ quantityMilli, unit });

  it.each([
    [q(2000, 'pcs'), q(1000, 'pcs'), q(3000, 'pcs')],
    [q(null, null), q(null, null), q(null, null)],
    [q(null, null), q(2000, 'pcs'), q(2000, 'pcs')],
    [q(2000, 'pcs'), q(null, null), q(2000, 'pcs')],
    [q(MAX_QUANTITY_MILLI, 'kg'), q(1000, 'kg'), q(MAX_QUANTITY_MILLI, 'kg')],
  ])('%j + %j → %j', (existing, incoming, expected) => {
    expect(mergeQuantities(existing, incoming)).toEqual(expected);
  });
});

describe('mergeNotes', () => {
  it('łączy, pomija puste i powtórzenia (bez względu na wielkość liter)', () => {
    expect(mergeNotes(null, null)).toBeNull();
    expect(mergeNotes('  ', '')).toBeNull();
    expect(mergeNotes('100 g · Brownie', 'brownie')).toBe('100 g · Brownie');
    expect(mergeNotes('bez laktozy', '1 l · Naleśniki')).toBe('bez laktozy · 1 l · Naleśniki');
  });

  it('ucina do 120 znaków', () => {
    expect(mergeNotes('a'.repeat(100), 'b'.repeat(100))).toHaveLength(120);
  });
});

describe('parseQuickAdd (07 §14.4)', () => {
  it.each([
    ['2 mleko', 'Mleko', 2000, 'pcs'],
    ['mleko 2', 'Mleko', 2000, 'pcs'],
    ['2x mleko', 'Mleko', 2000, 'pcs'],
    ['2 × mleko', 'Mleko', 2000, 'pcs'],
    ['mleko x2', 'Mleko', 2000, 'pcs'],
    ['mleko ×2', 'Mleko', 2000, 'pcs'],
    ['jajka 10', 'Jajka', 10_000, 'pcs'],
    ['mąka 1kg', 'Mąka', 1000, 'kg'],
    ['mąka 1 KG', 'Mąka', 1000, 'kg'],
    ['1kg mąka', 'Mąka', 1000, 'kg'],
    ['1,5 kg ziemniaki', 'Ziemniaki', 1500, 'kg'],
    ['ziemniaki 1.5kg', 'Ziemniaki', 1500, 'kg'],
    ['woda 6 l', 'Woda', 6000, 'l'],
    ['śmietana 200ml', 'Śmietana', 200_000, 'ml'],
    ['szynka 30 dag', 'Szynka', 300_000, 'g'],
    ['ser 0,25 kg', 'Ser', 250, 'kg'],
    ['ser 0,12345 kg', 'Ser', 123, 'kg'],
    ['jajka 2 opak', 'Jajka', 2000, 'pack'],
    ['2 op. jajka', 'Jajka', 2000, 'pack'],
    ['chleb 1 szt.', 'Chleb', 1000, 'pcs'],
    ['coca cola 0,5 l', 'Coca cola', 500, 'l'],
  ])('%j → %s · %i %s', (input, name, quantityMilli, unit) => {
    expect(parseQuickAdd(input)).toEqual({ name, quantityMilli, unit });
  });

  it.each([
    ['Mleko 3,2%', 'Mleko 3,2%'],
    ['Pepsi 0,5', 'Pepsi 0,5'],
    ['  chleb   razowy ', 'Chleb razowy'],
    ['mleko 0', 'Mleko 0'],
    ['mleko 0 l', 'Mleko 0 l'],
    ['woda 2000 l', 'Woda 2000 l'],
    ['mleko x0', 'Mleko x0'],
    ['mleko 100', 'Mleko 100'],
  ])('%j → nazwa bez ilości %j', (input, name) => {
    expect(parseQuickAdd(input)).toEqual({ name, quantityMilli: null, unit: null });
  });

  it.each(['', '   ', '3', '1,5'])('%j → brak nazwy', (input) => {
    expect(parseQuickAdd(input)).toBeNull();
  });
});

describe('suggestShoppingSection (07 §14.5)', () => {
  it('słownik gospodarstwa, potem słowa kluczowe, w ostateczności „Inne"', () => {
    expect(suggestShoppingSection('mleko', 'home')).toBe('home');
    expect(suggestShoppingSection('mleko owsiane', null)).toBe('dairy');
    expect(suggestShoppingSection('papier toaletowy', null)).toBe('hygiene');
    expect(suggestShoppingSection('klej', null)).toBe('other');
    expect(suggestShoppingSection('', null)).toBe('other');
  });

  it('słowa kluczowe są znormalizowane i wskazują istniejące działy', () => {
    for (const [word, section] of Object.entries(SHOPPING_SECTION_KEYWORDS)) {
      expect(normalizeShoppingName(word)).toBe(word);
      expect(ShoppingSectionSchema.options).toContain(section);
    }
  });
});

describe('isAlreadyHave (07 §14.5)', () => {
  it('słownik wygrywa z oceną modelu', () => {
    expect(isAlreadyHave(null, true)).toBe(true);
    expect(isAlreadyHave(null, false)).toBe(false);
    expect(isAlreadyHave({ isStaple: true }, false)).toBe(true);
    expect(isAlreadyHave({ isStaple: false }, true)).toBe(false);
  });
});

describe('sortShoppingItems (07 §14.6)', () => {
  it('do kupienia według działów i czasu, kupione na końcu od ostatnio odhaczonych', () => {
    const items = [
      { id: 'k1', section: 'produce' as const, checkedAt: 10, createdAt: 1 },
      { id: 'd2', section: 'dairy' as const, checkedAt: null, createdAt: 3 },
      { id: 'p1', section: 'produce' as const, checkedAt: null, createdAt: 5 },
      { id: 'k2', section: 'dairy' as const, checkedAt: 20, createdAt: 1 },
      { id: 'd1', section: 'dairy' as const, checkedAt: null, createdAt: 2 },
      { id: 'k3', section: 'other' as const, checkedAt: 20, createdAt: 0 },
      { id: 'b', section: 'other' as const, checkedAt: null, createdAt: 9 },
      { id: 'a', section: 'other' as const, checkedAt: null, createdAt: 9 },
      { id: 'a', section: 'other' as const, checkedAt: null, createdAt: 9 },
    ];
    expect(sortShoppingItems(items).map((item) => item.id)).toEqual([
      'p1',
      'd1',
      'd2',
      'a',
      'a',
      'b',
      'k3',
      'k2',
      'k1',
    ]);
  });
});

describe('nextDefaultList (I-26)', () => {
  it('pierwsza niezarchiwizowana według kolejności, potem czasu założenia', () => {
    expect(nextDefaultList([])).toBeNull();
    expect(nextDefaultList([{ id: 'a', archivedAt: 1, sortOrder: 0, createdAt: 1 }])).toBeNull();
    expect(
      nextDefaultList([
        { id: 'a', archivedAt: null, sortOrder: 2, createdAt: 1 },
        { id: 'b', archivedAt: null, sortOrder: 1, createdAt: 5 },
        { id: 'c', archivedAt: null, sortOrder: 1, createdAt: 3 },
      ])?.id,
    ).toBe('c');
  });
});

describe('formatShoppingQuantity', () => {
  it.each([
    [{ quantityMilli: 1500, unit: 'kg' as const }, '1,5 kg'],
    [{ quantityMilli: 2000, unit: 'pcs' as const }, '2 szt.'],
    [{ quantityMilli: 1000, unit: 'pack' as const }, '1 opak.'],
    [{ quantityMilli: 250, unit: 'l' as const }, '0,25 l'],
    [{ quantityMilli: 62_500, unit: 'g' as const }, '62,5 g'],
    [{ quantityMilli: 1, unit: 'ml' as const }, '0,001 ml'],
    [{ quantityMilli: null, unit: null }, ''],
  ])('%j → %j', (quantity, expected) => {
    expect(formatShoppingQuantity(quantity)).toBe(expected);
  });
});

describe('stałe list zakupów (03 §5a)', () => {
  it('zestaw startowy ma mleko, jajka i masło (P-4) i unikalne nazwy', () => {
    const names = STARTER_STAPLES.map((staple) => staple.name);
    expect(names).toEqual(expect.arrayContaining(['Mleko', 'Jajka', 'Masło', 'Sól']));
    expect(new Set(names.map(normalizeShoppingName)).size).toBe(names.length);
  });

  it('każdy dział i jednostka ma polską nazwę', () => {
    expect(Object.keys(SHOPPING_SECTION_LABELS).sort()).toEqual(
      [...ShoppingSectionSchema.options].sort(),
    );
    expect(Object.keys(SHOPPING_UNIT_LABELS).sort()).toEqual(
      [...ShoppingUnitSchema.options].sort(),
    );
  });
});
