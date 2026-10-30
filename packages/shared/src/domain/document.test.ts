import { describe, expect, it } from 'vitest';

import {
  checkDocumentTotal,
  collectCategoryProposals,
  documentItemsNetMinor,
  findDuplicates,
  groupItemsByCategory,
  type CategoryGroupSource,
  type DuplicateTarget,
} from './document.js';

/**
 * Testy reguł dokumentów (08 §10, §11; 06 §3.4).
 */

const out = (amountMinor: number, bookedOn: string | null = null) =>
  ({ amountMinor, direction: 'outflow', bookedOn }) as const;
const inc = (amountMinor: number, bookedOn: string | null = null) =>
  ({ amountMinor, direction: 'inflow', bookedOn }) as const;

describe('documentItemsNetMinor / checkDocumentTotal', () => {
  it('rabat pomniejsza sumę', () => {
    expect(documentItemsNetMinor([out(698), out(2499), inc(300)])).toBe(2897);
    expect(documentItemsNetMinor([])).toBe(0);
  });

  it('zgodna, niezgodna z różnicą, nieznana bez sumy albo pozycji', () => {
    expect(checkDocumentTotal(2897, [out(3197), inc(300)])).toEqual({ kind: 'match' });
    expect(checkDocumentTotal(3000, [out(2897)])).toEqual({
      kind: 'mismatch',
      differenceMinor: -103,
    });
    expect(checkDocumentTotal(null, [out(1)])).toEqual({ kind: 'unknown' });
    expect(checkDocumentTotal(100, [])).toEqual({ kind: 'unknown' });
  });
});

describe('findDuplicates', () => {
  const ACC = 'ACC';
  const tx = (
    id: string,
    bookedOn: string,
    amountMinor: number,
    overrides: Partial<DuplicateTarget> = {},
  ): DuplicateTarget => ({
    id,
    type: 'expense',
    bookedOn,
    amountMinor,
    accountId: ACC,
    counterAccountId: null,
    ...overrides,
  });

  it('kwota co do grosza i data ±3 dni — granica włącznie', () => {
    const candidates = [tx('a', '2026-09-13', 4999)];
    expect(findDuplicates([out(4999, '2026-09-10')], candidates, ACC)).toEqual(['a']);
    expect(findDuplicates([out(4999, '2026-09-09')], candidates, ACC)).toEqual([null]);
    expect(findDuplicates([out(5000, '2026-09-13')], candidates, ACC)).toEqual([null]);
  });

  it('inne konto albo kierunek — nie duplikat; bez konta dokumentu konto nie decyduje', () => {
    const other = [tx('a', '2026-09-10', 4999, { accountId: 'OTHER' })];
    expect(findDuplicates([out(4999, '2026-09-10')], other, ACC)).toEqual([null]);
    expect(findDuplicates([out(4999, '2026-09-10')], other, null)).toEqual(['a']);
    expect(findDuplicates([inc(4999, '2026-09-10')], [tx('b', '2026-09-10', 4999)], ACC)).toEqual([
      null,
    ]);
    expect(
      findDuplicates(
        [inc(4999, '2026-09-10')],
        [tx('c', '2026-09-10', 4999, { type: 'income' })],
        ACC,
      ),
    ).toEqual(['c']);
  });

  it('przelew: obciążenie z konta wyciągu, uznanie na nie', () => {
    const transfer = tx('t', '2026-09-10', 10_000, {
      type: 'transfer',
      accountId: ACC,
      counterAccountId: 'SAV',
    });
    expect(findDuplicates([out(10_000, '2026-09-10')], [transfer], ACC)).toEqual(['t']);
    expect(findDuplicates([inc(10_000, '2026-09-10')], [transfer], ACC)).toEqual([null]);
    expect(findDuplicates([inc(10_000, '2026-09-10')], [transfer], 'SAV')).toEqual(['t']);
    expect(findDuplicates([inc(10_000, '2026-09-10')], [transfer], null)).toEqual(['t']);
  });

  it('jedna transakcja — jeden duplikat; pozycja bierze najbliższą datą', () => {
    const candidates = [tx('far', '2026-09-08', 1200), tx('near', '2026-09-10', 1200)];
    expect(
      findDuplicates(
        [out(1200, '2026-09-10'), out(1200, '2026-09-10'), out(1200, '2026-09-11')],
        candidates,
        ACC,
      ),
    ).toEqual(['near', 'far', null]);
  });

  it('pozycja bez daty nie ma duplikatu', () => {
    expect(findDuplicates([out(1200)], [tx('a', '2026-09-10', 1200)], ACC)).toEqual([null]);
  });
});

describe('collectCategoryProposals', () => {
  it('grupuje po nazwie bez wielkości liter, pomija odrzucone i te z kategorią', () => {
    const item = (
      id: string,
      name: string | null,
      overrides: Partial<{
        direction: 'inflow' | 'outflow';
        suggestedCategoryId: string | null;
        reviewStatus: string;
      }> = {},
    ) => ({
      id,
      direction: 'outflow' as const,
      suggestedCategoryId: null,
      suggestedCategoryName: name,
      reviewStatus: 'pending',
      ...overrides,
    });
    expect(
      collectCategoryProposals([
        item('1', 'Elektronika'),
        item('2', ' elektronika '),
        item('3', 'Elektronika', { reviewStatus: 'rejected' }),
        item('4', 'Chemia', { suggestedCategoryId: 'X' }),
        item('5', null),
        item('6', 'Zwroty', { direction: 'inflow' }),
      ]),
    ).toEqual([
      { name: 'Elektronika', kind: 'expense', itemIds: ['1', '2'] },
      { name: 'Zwroty', kind: 'income', itemIds: ['6'] },
    ]);
  });
});

describe('groupItemsByCategory (07 §9.4, ADR-069)', () => {
  const item = (
    id: string,
    amountMinor: number,
    categoryKey: string | null,
    direction: 'inflow' | 'outflow' = 'outflow',
  ): CategoryGroupSource => ({ id, amountMinor, categoryKey, direction });

  it('jedzenie i worki na śmieci — dwie grupy, malejąco po kwocie', () => {
    const result = groupItemsByCategory([
      item('mleko', 698, 'FOOD'),
      item('worki', 1299, 'HOME'),
      item('chleb', 420, 'FOOD'),
      item('ser', 1590, 'FOOD'),
    ]);
    expect(result).toEqual({
      ok: true,
      groups: [
        { categoryKey: 'FOOD', amountMinor: 2708, itemIds: ['mleko', 'chleb', 'ser'] },
        { categoryKey: 'HOME', amountMinor: 1299, itemIds: ['worki'] },
      ],
    });
  });

  it('pozycja bez kategorii trafia do grupy dominującej (najwięcej pozycji, nie kwota)', () => {
    const result = groupItemsByCategory([
      item('patelnia', 8999, 'HOME'),
      item('mleko', 698, 'FOOD'),
      item('ser', 1590, 'FOOD'),
      item('coś', 300, null),
    ]);
    expect(result).toEqual({
      ok: true,
      groups: [
        { categoryKey: 'HOME', amountMinor: 8999, itemIds: ['patelnia'] },
        { categoryKey: 'FOOD', amountMinor: 2588, itemIds: ['mleko', 'ser', 'coś'] },
      ],
    });
  });

  it('remis liczby pozycji — dominująca jest pierwsza na paragonie', () => {
    const result = groupItemsByCategory([
      item('a', 400, 'A'),
      item('b', 500, 'B'),
      item('x', 100, null),
    ]);
    expect(result.ok && result.groups.find((group) => group.categoryKey === 'A')).toEqual({
      categoryKey: 'A',
      amountMinor: 500,
      itemIds: ['a', 'x'],
    });
  });

  it('rabat z kategorią pomniejsza swoją grupę, bez kategorii — dominującą', () => {
    const result = groupItemsByCategory([
      item('ser', 2000, 'FOOD'),
      item('worki', 1000, 'HOME'),
      item('rabat-worki', 200, 'HOME', 'inflow'),
      item('rabat', 100, null, 'inflow'),
      item('kaucja', 50, 'INCOME_ONLY', 'inflow'),
    ]);
    expect(result).toEqual({
      ok: true,
      groups: [
        { categoryKey: 'FOOD', amountMinor: 1850, itemIds: ['ser', 'rabat', 'kaucja'] },
        { categoryKey: 'HOME', amountMinor: 800, itemIds: ['worki', 'rabat-worki'] },
      ],
    });
  });

  it('grupa z niedodatnią sumą wchodzi do dominującej', () => {
    const result = groupItemsByCategory([
      item('ser', 2000, 'FOOD'),
      item('worki', 300, 'HOME'),
      item('rabat-worki', 300, 'HOME', 'inflow'),
    ]);
    expect(result).toEqual({
      ok: true,
      groups: [
        { categoryKey: 'FOOD', amountMinor: 2000, itemIds: ['ser', 'worki', 'rabat-worki'] },
      ],
    });
  });

  it('dominująca bez dodatniej sumy — wszystko w jedną grupę', () => {
    const result = groupItemsByCategory([
      item('ser', 2000, 'FOOD'),
      item('rabat-ser', 2500, 'FOOD', 'inflow'),
      item('worki', 1000, 'HOME'),
    ]);
    expect(result).toEqual({
      ok: true,
      groups: [{ categoryKey: 'FOOD', amountMinor: 500, itemIds: ['ser', 'rabat-ser', 'worki'] }],
    });
  });

  it('żadna pozycja bez kategorii — jedna grupa bez klucza', () => {
    expect(groupItemsByCategory([item('a', 100, null), item('b', 250, null)])).toEqual({
      ok: true,
      groups: [{ categoryKey: null, amountMinor: 350, itemIds: ['a', 'b'] }],
    });
  });

  it('suma netto niedodatnia albo brak pozycji — błąd', () => {
    expect(groupItemsByCategory([])).toEqual({ ok: false, reason: 'non_positive_total' });
    expect(groupItemsByCategory([item('a', 100, 'A'), item('r', 100, null, 'inflow')])).toEqual({
      ok: false,
      reason: 'non_positive_total',
    });
  });

  it('suma grup równa się sumie netto pozycji', () => {
    const items = [
      item('a', 1234, 'A'),
      item('b', 999, 'B'),
      item('c', 1, null),
      item('r', 77, 'B', 'inflow'),
      item('d', 4321, 'C'),
    ];
    const result = groupItemsByCategory(items);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups.reduce((sum, group) => sum + group.amountMinor, 0)).toBe(
      documentItemsNetMinor(items),
    );
    expect(result.groups.flatMap((group) => group.itemIds).sort()).toEqual(
      items.map((entry) => entry.id).sort(),
    );
  });
});
