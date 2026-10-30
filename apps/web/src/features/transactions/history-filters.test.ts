import { describe, expect, it } from 'vitest';

import {
  hasAnyFilter,
  historyFiltersToParams,
  historyQuery,
  NO_FILTERS,
  panelFilterCount,
  parseAmountBound,
  parseHistoryFilters,
  toggleCategory,
} from './history-filters.js';

/** Testy filtrów historii — odczyt z adresu, zapis do adresu i zapytanie do API. */

const A = '01JB0000000000000000000001';
const B = '01JB0000000000000000000002';
const C = '01JC0000000000000000000001';

describe('parseHistoryFilters', () => {
  it('pusty adres — brak filtrów', () => {
    expect(parseHistoryFilters(new URLSearchParams())).toEqual(NO_FILTERS);
  });

  it('czyta każdy filtr, w tym powtórzone parametry', () => {
    const params = new URLSearchParams(
      `type=income&q=+Lidl+&accountId=${A}&accountId=${B}&categoryId=${C}` +
        `&incomeSourceId=${A}&minAmountMinor=1000&maxAmountMinor=5000&includeDeleted=true`,
    );
    expect(parseHistoryFilters(params)).toEqual({
      type: 'income',
      q: 'Lidl',
      accountIds: [A, B],
      categoryIds: [C],
      incomeSourceIds: [A],
      minAmountMinor: 1000,
      maxAmountMinor: 5000,
      includeDeleted: true,
    });
  });

  it('śmieć z adresu znika zamiast psuć zapytanie', () => {
    const params = new URLSearchParams(
      `type=wszystko&accountId=nie-id&accountId=${A}&accountId=${A}` +
        '&minAmountMinor=-5&maxAmountMinor=12,50&q=%20%20&includeDeleted=1',
    );
    expect(parseHistoryFilters(params)).toEqual({ ...NO_FILTERS, accountIds: [A] });
  });

  it('odwrócony zakres kwot jest zamieniany miejscami', () => {
    const params = new URLSearchParams('minAmountMinor=9000&maxAmountMinor=100');
    expect(parseHistoryFilters(params)).toMatchObject({
      minAmountMinor: 100,
      maxAmountMinor: 9000,
    });
  });

  it('zero jest poprawną kwotą, a tekst jest przycinany do 100 znaków', () => {
    const params = new URLSearchParams(`minAmountMinor=0&q=${'x'.repeat(150)}`);
    const filters = parseHistoryFilters(params);
    expect(filters.minAmountMinor).toBe(0);
    expect(filters.q).toHaveLength(100);
  });
});

describe('filtr „bez kategorii" (Z-18)', () => {
  it('czyta się z adresu, zapisuje z powrotem i trafia do zapytania', () => {
    const filters = parseHistoryFilters(new URLSearchParams('uncategorized=true'));
    expect(filters.uncategorized).toBe(true);
    expect(historyFiltersToParams(filters).toString()).toBe('uncategorized=true');
    expect(historyQuery('2026-09', filters)).toEqual({ month: '2026-09', uncategorized: 'true' });
    expect(panelFilterCount(filters)).toBe(1);
  });

  it('jawnie wybrana kategoria wygrywa — oba naraz dałyby 400', () => {
    const filters = parseHistoryFilters(
      new URLSearchParams('uncategorized=true&categoryId=01JB0000000000000000000011'),
    );
    expect(filters.uncategorized).toBeUndefined();
    expect(filters.categoryIds).toHaveLength(1);
  });
});

describe('historyFiltersToParams', () => {
  it('jest odwrotnością odczytu', () => {
    const filters = {
      type: 'expense' as const,
      q: 'żabka',
      accountIds: [A],
      categoryIds: [C, A],
      incomeSourceIds: [],
      minAmountMinor: 0,
      maxAmountMinor: 100_00,
      includeDeleted: true as const,
    };
    expect(parseHistoryFilters(historyFiltersToParams(filters))).toEqual(filters);
  });

  it('puste filtry nie zostawiają śladu w adresie', () => {
    expect(historyFiltersToParams(NO_FILTERS).toString()).toBe('');
  });
});

describe('historyQuery', () => {
  it('miesiąc zawsze; pozostałe pola tylko ustawione', () => {
    expect(historyQuery('2026-09', NO_FILTERS)).toEqual({ month: '2026-09' });
    expect(
      historyQuery('2026-09', {
        ...NO_FILTERS,
        type: 'transfer',
        categoryIds: [C],
        maxAmountMinor: 0,
      }),
    ).toEqual({ month: '2026-09', type: 'transfer', categoryId: [C], maxAmountMinor: 0 });
    expect(historyQuery('2026-09', { ...NO_FILTERS, includeDeleted: true })).toEqual({
      month: '2026-09',
      includeDeleted: 'true',
    });
  });
});

describe('liczniki filtrów', () => {
  it('szybki filtr i tekst nie liczą się do panelu, ale zawężają listę', () => {
    const quick = { ...NO_FILTERS, type: 'expense' as const, q: 'x' };
    expect(panelFilterCount(quick)).toBe(0);
    expect(hasAnyFilter(quick)).toBe(true);
    expect(hasAnyFilter(NO_FILTERS)).toBe(false);
  });

  it('zakres kwot to jeden filtr', () => {
    expect(
      panelFilterCount({
        ...NO_FILTERS,
        accountIds: [A],
        categoryIds: [C],
        incomeSourceIds: [B],
        minAmountMinor: 1,
        maxAmountMinor: 2,
        includeDeleted: true,
      }),
    ).toBe(5);
    expect(panelFilterCount({ ...NO_FILTERS, maxAmountMinor: 2 })).toBe(1);
  });
});

describe('parseAmountBound', () => {
  it('puste pole — brak krańca; kwota po polsku — grosze', () => {
    expect(parseAmountBound('  ')).toEqual({ ok: true });
    expect(parseAmountBound('1 250,5')).toEqual({ ok: true, minor: 125_050 });
    expect(parseAmountBound('0')).toEqual({ ok: true, minor: 0 });
  });

  it('ujemna albo nieczytelna kwota to błąd', () => {
    expect(parseAmountBound('-5')).toEqual({ ok: false });
    expect(parseAmountBound('dużo')).toEqual({ ok: false });
    expect(parseAmountBound('10,999')).toEqual({ ok: false });
  });
});

describe('toggleCategory', () => {
  const food = { id: 'J', children: [{ id: 'K' }, { id: 'R' }] };

  it('rodzic zaznacza i odznacza razem z dziećmi', () => {
    const on = toggleCategory([], food);
    expect([...on].sort()).toEqual(['J', 'K', 'R']);
    expect(toggleCategory(on, food)).toEqual([]);
  });

  it('dziecko przełącza się samo, nie ruszając rodzica ani rodzeństwa', () => {
    const on = toggleCategory(['J', 'K', 'R'], { id: 'K', children: [] });
    expect([...on].sort()).toEqual(['J', 'R']);
    expect([...toggleCategory(['X'], { id: 'K', children: [] })].sort()).toEqual(['K', 'X']);
  });
});
