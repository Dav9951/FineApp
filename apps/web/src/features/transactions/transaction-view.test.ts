import type { CategoryTreeDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import { categoryLabel, filterCategoryTree } from './transaction-view.js';

/** Testy wyszukiwania kategorii w formularzu transakcji. */

/**
 * Kategoria z drzewa.
 *
 * @param id - Identyfikator.
 * @param name - Nazwa.
 * @param children - Podkategorie.
 * @returns Kategoria.
 */
function node(id: string, name: string, children: CategoryTreeDto[] = []): CategoryTreeDto {
  return {
    id,
    parentId: null,
    name,
    slug: id,
    kind: 'expense',
    icon: null,
    color: null,
    aiHints: null,
    isSystem: false,
    isArchived: false,
    sortOrder: 0,
    children,
  };
}

const TREE = [
  node('J', 'Jedzenie', [node('K', 'Kawa'), node('R', 'Restauracje')]),
  node('T', 'Transport', [node('P', 'Paliwo'), node('U', 'Ubezpieczenie OC/AC')]),
  node('Z', 'Zdrowie', [node('L', 'Leki')]),
];

describe('filterCategoryTree', () => {
  it('pusty tekst — całe drzewo', () => {
    expect(filterCategoryTree(TREE, '  ')).toEqual(TREE);
  });

  it('trafienie w rodzica zostawia wszystkie dzieci', () => {
    const result = filterCategoryTree(TREE, 'JEDZ');
    expect(result.map((item) => [item.name, item.children.length])).toEqual([['Jedzenie', 2]]);
  });

  it('trafienie w dziecko zostawia je pod rodzicem, bez ogonków i wielkości liter', () => {
    const result = filterCategoryTree(TREE, 'kawa');
    expect(result.map((item) => [item.name, item.children.map((c) => c.name)])).toEqual([
      ['Jedzenie', ['Kawa']],
    ]);
    expect(filterCategoryTree(TREE, 'ubezp')[0]?.children.map((c) => c.name)).toEqual([
      'Ubezpieczenie OC/AC',
    ]);
    expect(filterCategoryTree(TREE, 'zdrow')).toHaveLength(1);
  });

  it('brak trafień — pusto', () => {
    expect(filterCategoryTree(TREE, 'xyz')).toEqual([]);
  });
});

describe('categoryLabel', () => {
  it('podkategoria z rodzicem, główna sama, nieznana — brak', () => {
    expect(categoryLabel(TREE, 'K')).toBe('Jedzenie › Kawa');
    expect(categoryLabel(TREE, 'T')).toBe('Transport');
    expect(categoryLabel(TREE, 'X')).toBeUndefined();
  });
});
