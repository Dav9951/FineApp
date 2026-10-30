import type { CategorySpendingDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  categoryTrend,
  deltaLabel,
  isFirstRun,
  monthGenitive,
  monthNotice,
  monthProgress,
  percentLabel,
  swipeDirection,
  uncategorizedLabel,
} from './month-view.js';

/**
 * Testy czystych reguł ekranu miesiąca
 * ([06 §3.1](../../../../../plans/06-ui-views.md#31-miesiąc-dashboard--mmonth)).
 */

describe('nazwy miesięcy', () => {
  it('dopełniacz', () => {
    expect(monthGenitive('2026-08')).toBe('sierpnia');
    expect(monthGenitive('2027-02')).toBe('lutego');
  });
});

describe('percentLabel', () => {
  it('zaokrągla do całego procenta i gubi znak — niesie go strzałka', () => {
    expect(percentLabel(602)).toBe('6%');
    expect(percentLabel(-649)).toBe('6%');
    expect(percentLabel(0)).toBe('0%');
  });
});

describe('deltaLabel', () => {
  it('mniej wydane niż w sierpniu', () => {
    expect(deltaLabel(-41_200, -603, true, '2026-08')).toEqual({
      text: '↓ 6% do sierpnia',
      label: 'o 6% mniej niż w sierpniu',
    });
  });

  it('więcej, a przy zerowej podstawie bez procentu', () => {
    expect(deltaLabel(5_000, 0, true, '2026-08')).toEqual({
      text: '↑ do sierpnia',
      label: 'więcej niż w sierpniu',
    });
  });

  it('bez zmian', () => {
    expect(deltaLabel(0, 0, true, '2026-08')?.text).toBe('→ do sierpnia');
  });

  it('bez danych z poprzedniego miesiąca nie ma porównania', () => {
    expect(deltaLabel(5_000, 0, false, '2026-08')).toBeNull();
  });
});

describe('categoryTrend', () => {
  /**
   * Kategoria z kwotami.
   *
   * @param amountMinor - Kwota w miesiącu.
   * @param previousMonthAmountMinor - Kwota miesiąc wcześniej.
   * @returns Pozycja rozbicia.
   */
  function item(amountMinor: number, previousMonthAmountMinor: number | null): CategorySpendingDto {
    return {
      categoryId: null,
      name: 'Jedzenie',
      color: null,
      icon: null,
      amountMinor,
      shareBps: 0,
      transactionCount: 1,
      previousMonthAmountMinor,
    };
  }

  it('więcej, mniej i „tyle samo" poniżej 5% różnicy', () => {
    expect(categoryTrend(item(20_000, 10_000))?.arrow).toBe('↑');
    expect(categoryTrend(item(10_000, 20_000))?.arrow).toBe('↓');
    expect(categoryTrend(item(10_400, 10_000))?.arrow).toBe('→');
    expect(categoryTrend(item(10_000, 0))?.arrow).toBe('↑');
  });

  it('bez poprzedniego miesiąca — brak strzałki', () => {
    expect(categoryTrend(item(10_000, null))).toBeNull();
  });
});

describe('monthProgress', () => {
  it('trwający miesiąc: dni i odmiana', () => {
    expect(
      monthProgress({ isCurrent: true, daysElapsed: 20, daysInMonth: 30, month: '2026-09' }),
    ).toEqual({
      valueBps: 6667,
      elapsed: '20 z 30 dni',
      remaining: 'do 1 października zostało 10 dni',
    });
    expect(
      monthProgress({ isCurrent: true, daysElapsed: 29, daysInMonth: 30, month: '2026-09' })
        ?.remaining,
    ).toBe('do 1 października został 1 dzień');
    expect(
      monthProgress({ isCurrent: true, daysElapsed: 27, daysInMonth: 30, month: '2026-09' })
        ?.remaining,
    ).toBe('do 1 października zostały 3 dni');
    expect(
      monthProgress({ isCurrent: true, daysElapsed: 31, daysInMonth: 31, month: '2026-12' })
        ?.remaining,
    ).toBe('ostatni dzień miesiąca');
  });

  it('miesiąc zamknięty albo przyszły — bez paska', () => {
    expect(
      monthProgress({ isCurrent: false, daysElapsed: 31, daysInMonth: 31, month: '2026-08' }),
    ).toBeNull();
  });
});

describe('monthNotice', () => {
  it('przyszły — podgląd; sprzed okna — zamknięty; w oknie — nic', () => {
    const range = { from: '2026-10-01', to: '2026-10-31' };
    expect(monthNotice({ isFuture: true, range, canPostBackTo: '2026-08-01' })).toEqual({
      kind: 'future',
    });
    expect(
      monthNotice({
        isFuture: false,
        range: { from: '2026-07-01', to: '2026-07-31' },
        canPostBackTo: '2026-08-01',
      }),
    ).toEqual({ kind: 'closed', from: '1 sierpnia 2026' });
    expect(
      monthNotice({
        isFuture: false,
        range: { from: '2026-08-01', to: '2026-08-31' },
        canPostBackTo: '2026-08-01',
      }),
    ).toBeNull();
  });
});

describe('uncategorizedLabel', () => {
  it('odmienia', () => {
    expect(uncategorizedLabel(1)).toBe('1 wydatek bez kategorii');
    expect(uncategorizedLabel(3)).toBe('3 wydatki bez kategorii');
    expect(uncategorizedLabel(12)).toBe('12 wydatków bez kategorii');
  });
});

describe('isFirstRun', () => {
  it('tylko bez kont i bez transakcji', () => {
    expect(isFirstRun({ accounts: [], recentTransactions: [] })).toBe(true);
    expect(
      isFirstRun({
        accounts: [
          {
            accountId: '01JB0000000000000000000001',
            name: 'ROR',
            type: 'checking',
            allocationClass: 'spending',
            color: null,
            icon: null,
            isArchived: false,
            balanceMinor: 0,
            balanceAtMonthStartMinor: 0,
            changeInMonthMinor: 0,
          },
        ],
        recentTransactions: [],
      }),
    ).toBe(false);
  });
});

describe('swipeDirection', () => {
  it('palec w lewo — następny, w prawo — poprzedni', () => {
    expect(swipeDirection(-80, 10)).toBe('next');
    expect(swipeDirection(80, -10)).toBe('previous');
  });

  it('drgnięcie i ruch po skosie to nie gest', () => {
    expect(swipeDirection(-40, 0)).toBeNull();
    expect(swipeDirection(-80, 50)).toBeNull();
  });
});
