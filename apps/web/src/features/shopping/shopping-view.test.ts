import type { ShoppingItemDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  checkedItems,
  factorLabel,
  groupToBuy,
  initialsOf,
  parseFactorInput,
  parseQuantityInput,
  quantityInputValue,
  relativeTime,
  sharedRecipe,
  shareText,
  toBuyLabel,
} from './shopping-view.js';

/**
 * Pozycja testowa.
 *
 * @param over - Nadpisane pola.
 * @returns Pozycja.
 */
function item(over: Partial<ShoppingItemDto> & { id: string; name: string }): ShoppingItemDto {
  return {
    listId: 'L',
    productId: null,
    quantityMilli: null,
    unit: null,
    note: null,
    section: 'other',
    source: 'manual',
    checked: false,
    checkedAt: null,
    checkedByInitials: null,
    isStaple: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('shopping-view', () => {
  const items = [
    item({ id: '1', name: 'Mydło', section: 'hygiene' }),
    item({ id: '2', name: 'Chleb', section: 'bakery' }),
    item({
      id: '3',
      name: 'Mleko',
      section: 'dairy',
      quantityMilli: 2000,
      unit: 'pcs',
      note: 'bez laktozy',
    }),
    item({ id: '4', name: 'Masło', section: 'dairy', checked: true, checkedAt: 5 }),
    item({ id: '5', name: 'Ser', section: 'dairy', checked: true, checkedAt: 9 }),
  ];

  it('grupuje do kupienia działami w kolejności sklepu', () => {
    expect(groupToBuy(items).map((group) => [group.label, group.items.map((i) => i.name)])).toEqual(
      [
        ['Pieczywo', ['Chleb']],
        ['Nabiał i jaja', ['Mleko']],
        ['Higiena', ['Mydło']],
      ],
    );
  });

  it('kupione od ostatnio odhaczonych', () => {
    expect(checkedItems(items).map((i) => i.name)).toEqual(['Ser', 'Masło']);
  });

  it('tekst do udostępnienia: tylko do kupienia, z ilością i notatką', () => {
    expect(shareText('Spożywcze', items)).toBe(
      [
        'Spożywcze',
        '',
        'PIECZYWO',
        '• Chleb',
        '',
        'NABIAŁ I JAJA',
        '• Mleko — 2 szt. (bez laktozy)',
        '',
        'HIGIENA',
        '• Mydło',
      ].join('\n'),
    );
  });

  it.each([
    [0, 'przed chwilą'],
    [59_000, 'przed chwilą'],
    [12 * 60_000, '12 min temu'],
    [3 * 3_600_000, '3 godz. temu'],
    [25 * 3_600_000, 'wczoraj'],
    [5 * 86_400_000, '5 dni temu'],
    [-5_000, 'przed chwilą'],
  ])('%i ms temu → %s', (ago, label) => {
    expect(relativeTime(1_000_000_000 - ago, 1_000_000_000)).toBe(label);
  });

  it('inicjały i podpis karty', () => {
    expect(initialsOf('  adam kowalski nowak ')).toBe('AK');
    expect(initialsOf('Ania')).toBe('A');
    expect(toBuyLabel(0)).toBe('nic do kupienia');
    expect(toBuyLabel(7)).toBe('7 do kupienia');
  });
});

describe('pole ilości w arkuszu', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['2', 2000],
    ['1,5', 1500],
    ['0.25', 250],
    ['1000', 1_000_000],
    ['1001', undefined],
    ['0', undefined],
    ['1,2345', undefined],
    ['abc', undefined],
  ])('%j → %s', (text, milli) => {
    expect(parseQuantityInput(text)).toBe(milli);
  });

  it('z tysięcznych do pola i z powrotem', () => {
    expect(quantityInputValue(null)).toBe('');
    expect(quantityInputValue(2000)).toBe('2');
    expect(quantityInputValue(1500)).toBe('1,5');
    expect(quantityInputValue(250)).toBe('0,25');
    expect(parseQuantityInput(quantityInputValue(62_500))).toBe(62_500);
  });
});

describe('mnożnik porcji', () => {
  it.each([
    [5_000, '×0,5'],
    [7_500, '×0,75'],
    [10_000, '×1'],
    [12_500, '×1,25'],
    [40_000, '×4'],
  ])('%i → %s', (bps, label) => {
    expect(factorLabel(bps)).toBe(label);
  });

  it.each([
    ['1,25', 12_500],
    ['0.5', 5_000],
    [' 2 ', 20_000],
    ['0,25', 2_500],
    ['0,2', undefined],
    ['4,5', undefined],
    ['abc', undefined],
    ['', undefined],
  ])('%j → %s', (text, bps) => {
    expect(parseFactorInput(text)).toBe(bps);
  });
});

describe('sharedRecipe (share_target)', () => {
  it.each([
    ['https://przepisy.pl/a', null, { url: 'https://przepisy.pl/a' }],
    [null, 'Zobacz! https://przepisy.pl/b?x=1 super', { url: 'https://przepisy.pl/b?x=1' }],
    [null, '200 g czekolady, 4 jajka', { text: '200 g czekolady, 4 jajka' }],
    ['javascript:alert(1)', null, {}],
    [null, null, {}],
    [`https://a.pl/${'x'.repeat(2100)}`, null, {}],
  ])('url %j, text %j → %j', (url, text, expected) => {
    expect(sharedRecipe(url, text)).toEqual(expected);
  });
});
