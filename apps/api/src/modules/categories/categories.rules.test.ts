import type { CategoryDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  buildCategoryTree,
  flattenCategoryTree,
  mergeAiHints,
  slugCandidates,
} from './categories.rules.js';

/**
 * Testy czystych reguł kategorii
 * ([07 §9](../../../../../../plans/07-domain-rules.md#9-kategoryzacja)).
 */

/**
 * Buduje kategorię z domyślnymi polami.
 *
 * @param id - Identyfikator.
 * @param parentId - Rodzic.
 * @returns Kategoria.
 */
function cat(id: string, parentId: string | null = null): CategoryDto {
  return {
    id,
    parentId,
    name: id,
    slug: id,
    kind: 'expense',
    icon: null,
    color: null,
    aiHints: null,
    isSystem: false,
    isArchived: false,
    sortOrder: 0,
  };
}

describe('buildCategoryTree / flattenCategoryTree', () => {
  it('zachowuje kolejność rodziców i dzieci', () => {
    const tree = buildCategoryTree([
      cat('B'),
      cat('b2', 'B'),
      cat('A'),
      cat('b1', 'B'),
      cat('a1', 'A'),
    ]);
    expect(tree.map((node) => [node.id, node.children.map((child) => child.id)])).toEqual([
      ['B', ['b2', 'b1']],
      ['A', ['a1']],
    ]);
    expect(flattenCategoryTree(tree).map((row) => row.id)).toEqual(['B', 'b2', 'b1', 'A', 'a1']);
  });

  it('dziecko bez rodzica na liście trafia na poziom główny', () => {
    const tree = buildCategoryTree([cat('orphan', 'GONE')]);
    expect(tree).toEqual([{ ...cat('orphan', 'GONE'), children: [] }]);
  });

  it('pusta lista daje puste drzewo', () => {
    expect(buildCategoryTree([])).toEqual([]);
  });
});

describe('mergeAiHints', () => {
  it('cel pierwszy, bez duplikatów bez względu na wielkość liter', () => {
    expect(mergeAiHints('Costa, Starbucks', 'starbucks, Żabka Café,  ')).toBe(
      'Costa, Starbucks, Żabka Café',
    );
  });

  it('jedna strona pusta — zostaje druga', () => {
    expect(mergeAiHints(null, 'Lidl')).toBe('Lidl');
    expect(mergeAiHints('Lidl', null)).toBe('Lidl');
  });

  it('obie puste — null, nie pusty napis', () => {
    expect(mergeAiHints(null, null)).toBeNull();
    expect(mergeAiHints(' , ', '')).toBeNull();
  });
});

describe('slugCandidates', () => {
  /**
   * Pobiera pierwsze kandydatki.
   *
   * @param name - Nazwa.
   * @param parentSlug - Slug rodzica.
   * @param count - Ile wziąć.
   * @returns Kandydatki.
   */
  function take(name: string, parentSlug: string | null, count: number): string[] {
    const result: string[] = [];
    for (const slug of slugCandidates(name, parentSlug)) {
      result.push(slug);
      if (result.length === count) break;
    }
    return result;
  }

  it('transliteruje i dokłada przyrostki', () => {
    expect(take('Kawa na mieście', null, 3)).toEqual([
      'kawa-na-miescie',
      'kawa-na-miescie-2',
      'kawa-na-miescie-3',
    ]);
  });

  it('podkategoria dostaje prefiks rodzica (ADR-020)', () => {
    expect(take('Kawa', 'jedzenie', 1)).toEqual(['jedzenie-kawa']);
  });

  it('nazwa bez liter i cyfr dostaje slug zastępczy', () => {
    expect(take('☕☕', null, 2)).toEqual(['kategoria', 'kategoria-2']);
  });
});
