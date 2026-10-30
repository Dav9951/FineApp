import type { CategoryDto, CategoryTreeDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  canMerge,
  draftOf,
  mergeTargets,
  parentOptions,
  splitTree,
  toCreateRequest,
  toUpdateRequest,
  usageLookup,
} from './categories-view.js';

/** Testy reguł ekranu kategorii: użycie z podkategoriami, archiwum, cele, formularz. */

const P1 = '01JC0000000000000000000001';
const C1 = '01JC0000000000000000000002';
const C2 = '01JC0000000000000000000003';
const P2 = '01JC0000000000000000000004';
const P3 = '01JC0000000000000000000005';

/**
 * Kategoria w kształcie z kontraktu.
 *
 * @param id - Identyfikator.
 * @param name - Nazwa.
 * @param overrides - Nadpisane pola.
 * @returns Kategoria.
 */
function category(id: string, name: string, overrides: Partial<CategoryDto> = {}): CategoryDto {
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
    ...overrides,
  };
}

/** Jedzenie (Kawa, Restauracje w archiwum), Transport, Stare (w archiwum, z dzieckiem). */
const TREE: CategoryTreeDto[] = [
  {
    ...category(P1, 'Jedzenie', { isSystem: true }),
    children: [
      category(C1, 'Kawa', { parentId: P1 }),
      category(C2, 'Restauracje', { parentId: P1, isArchived: true }),
    ],
  },
  { ...category(P2, 'Transport'), children: [] },
  {
    ...category(P3, 'Stare', { isArchived: true }),
    children: [
      category('01JC0000000000000000000006', 'Stare dziecko', { parentId: P3, isArchived: true }),
    ],
  },
];

describe('usageLookup', () => {
  it('rodzic sumuje siebie i podkategorie, dziecko pokazuje swoje', () => {
    const usage = usageLookup(TREE, [
      { categoryId: P1, transactionCount: 1, monthAmountMinor: 1_000 },
      { categoryId: C1, transactionCount: 4, monthAmountMinor: 12_000 },
      { categoryId: C2, transactionCount: 2, monthAmountMinor: 0 },
    ]);
    expect(usage(P1)).toEqual({ transactionCount: 7, monthAmountMinor: 13_000 });
    expect(usage(C1)).toEqual({ transactionCount: 4, monthAmountMinor: 12_000 });
    expect(usage(P2)).toEqual({ transactionCount: 0, monthAmountMinor: 0 });
    expect(usage('nieznana')).toEqual({ transactionCount: 0, monthAmountMinor: 0 });
  });
});

describe('splitTree', () => {
  it('aktywne bez dzieci z archiwum; archiwum płasko z nazwą rodzica', () => {
    const { active, archived } = splitTree(TREE);
    expect(active.map((root) => [root.name, root.children.map((c) => c.name)])).toEqual([
      ['Jedzenie', ['Kawa']],
      ['Transport', []],
    ]);
    expect(archived.map((entry) => [entry.category.name, entry.parentName])).toEqual([
      ['Restauracje', 'Jedzenie'],
      ['Stare', null],
      ['Stare dziecko', 'Stare'],
    ]);
    expect(archived[1]?.category).not.toHaveProperty('children');
  });
});

describe('parentOptions i mergeTargets', () => {
  const { active } = splitTree(TREE);

  it('rodzicem może być aktywna kategoria główna poza samą sobą', () => {
    expect(parentOptions(active).map((o) => o.label)).toEqual(['Jedzenie', 'Transport']);
    expect(parentOptions(active, category(P2, 'Transport')).map((o) => o.label)).toEqual([
      'Jedzenie',
    ]);
  });

  it('kategoria z podkategoriami nie może zostać podkategorią (04 §6)', () => {
    expect(parentOptions(active, category(P1, 'Jedzenie'))).toEqual([]);
  });

  it('cele scalenia: wszystkie aktywne poza źródłem, z pełną ścieżką', () => {
    expect(
      mergeTargets(active, category(C1, 'Kawa', { parentId: P1 })).map((o) => o.label),
    ).toEqual(['Jedzenie', 'Transport']);
    expect(mergeTargets(active, category(P2, 'Transport')).map((o) => o.label)).toEqual([
      'Jedzenie',
      'Jedzenie › Kawa',
    ]);
  });

  it('scalić można tylko własną, aktywną kategorię bez podkategorii', () => {
    expect(canMerge(category(C1, 'Kawa'), 0)).toBe(true);
    expect(canMerge(category(P1, 'Jedzenie', { isSystem: true }), 0)).toBe(false);
    expect(canMerge(category(P2, 'Transport'), 1)).toBe(false);
    expect(canMerge(category(C2, 'Restauracje', { isArchived: true }), 0)).toBe(false);
  });
});

describe('formularz', () => {
  it('nowa: nazwa przycięta, puste podpowiedzi jako brak, rodzic z przycisku', () => {
    expect(
      toCreateRequest({ ...draftOf(undefined, P1), name: '  Kawa ', aiHints: '  ' }, 'expense'),
    ).toEqual({
      ok: true,
      value: { name: 'Kawa', kind: 'expense', parentId: P1, aiHints: null },
    });
  });

  it('pusta albo za długa nazwa — błąd pola po polsku', () => {
    expect(toCreateRequest(draftOf(), 'income')).toEqual({
      ok: false,
      errors: { name: 'Nazwa jest wymagana' },
    });
    const long = toCreateRequest({ ...draftOf(), name: 'x'.repeat(51) }, 'income');
    expect(long.ok ? undefined : long.errors.name).toBe('Nazwa może mieć najwyżej 50 znaków');
  });

  it('edycja wysyła wyłącznie zmienione pola', () => {
    const original = category(C1, 'Kawa', { parentId: P1, aiHints: 'Starbucks' });
    expect(toUpdateRequest(original, draftOf(original))).toEqual({ ok: true, value: {} });
    expect(toUpdateRequest(original, { ...draftOf(original), name: 'Kawiarnie' })).toEqual({
      ok: true,
      value: { name: 'Kawiarnie' },
    });
    expect(
      toUpdateRequest(original, { ...draftOf(original), parentId: null, aiHints: '' }),
    ).toEqual({ ok: true, value: { parentId: null, aiHints: null } });
  });
});
