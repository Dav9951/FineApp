import { describe, expect, it } from 'vitest';

import { transactionItem } from '../../../test/transaction-fixture.js';
import {
  captionParts,
  dayHeading,
  groupByDay,
  initials,
  transactionTitle,
} from './history-view.js';

/** Testy reguł ekranu historii: grupy dni, tytuł i podpis wiersza. */

describe('groupByDay', () => {
  it('grupuje w kolejności listy, a sumę dnia bierze z podsumowania serwera', () => {
    const items = [
      transactionItem({ id: 'a', bookedOn: '2026-09-18', amountMinor: 12_799 }),
      transactionItem({ id: 'b', bookedOn: '2026-09-18', amountMinor: 9_999 }),
      transactionItem({ id: 'c', bookedOn: '2026-09-15', amountMinor: 185_000 }),
    ];
    // Serwer zna jeszcze jedną transakcję z 15 września — z niewczytanej strony.
    const days = [
      { bookedOn: '2026-09-18', expenseMinor: 22_798, incomeMinor: 0 },
      { bookedOn: '2026-09-15', expenseMinor: 190_000, incomeMinor: 980_000 },
    ];
    const groups = groupByDay(items, days);
    expect(groups.map((g) => [g.bookedOn, g.netMinor, g.items.map((i) => i.id)])).toEqual([
      ['2026-09-18', -22_798, ['a', 'b']],
      ['2026-09-15', 790_000, ['c']],
    ]);
  });

  it('bez podsumowania liczy wczytane: przelew, kosz i niezaksięgowane nie wchodzą', () => {
    const items = [
      transactionItem({ id: 'a', amountMinor: 1_000 }),
      transactionItem({ id: 'b', type: 'income', amountMinor: 5_000 }),
      transactionItem({ id: 'c', type: 'transfer', amountMinor: 70_000 }),
      transactionItem({ id: 'd', amountMinor: 3_000, deletedAt: 1 }),
      transactionItem({ id: 'e', amountMinor: 3_000, status: 'pending' }),
    ];
    expect(groupByDay(items)[0]?.netMinor).toBe(4_000);
  });

  it('pusta lista — brak grup', () => {
    expect(groupByDay([], [])).toEqual([]);
  });
});

describe('dayHeading', () => {
  it('dzień tygodnia, dzień i miesiąc w dopełniaczu — bez przesunięcia strefy', () => {
    expect(dayHeading('2026-09-18')).toBe('piątek, 18 września');
    expect(dayHeading('2024-02-29')).toBe('czwartek, 29 lutego');
  });
});

describe('initials', () => {
  it('pierwsza litera imienia i nazwiska, wielkie, z polskimi znakami', () => {
    expect(initials('Adam Kowalski')).toBe('AK');
    expect(initials('  łucja   maria  żak ')).toBe('ŁŻ');
    expect(initials('Basia')).toBe('B');
    expect(initials('   ')).toBe('');
  });
});

describe('tytuł i podpis wiersza', () => {
  it('sprzedawca w tytule, kategoria · konto · autor w podpisie', () => {
    const item = transactionItem({ merchant: 'Lidl', description: 'Zakupy tygodniowe' });
    expect(transactionTitle(item)).toBe('Lidl');
    expect(captionParts(item)).toEqual(['Restauracje', 'ROR', 'AK']);
  });

  it('bez sprzedawcy i opisu tytułem jest kategoria — i nie powtarza się w podpisie', () => {
    const item = transactionItem();
    expect(transactionTitle(item)).toBe('Restauracje');
    expect(captionParts(item)).toEqual(['ROR', 'AK']);
  });

  it('bez niczego — nazwa typu', () => {
    const item = transactionItem({ type: 'income', categoryName: null, accountName: null });
    expect(transactionTitle(item)).toBe('Przychód');
    expect(captionParts(item)).toEqual(['AK']);
  });

  it('przychód pokazuje źródło', () => {
    const item = transactionItem({
      type: 'income',
      description: 'Wypłata',
      categoryName: 'Wynagrodzenie',
      incomeSourceName: 'Etat Adam',
    });
    expect(captionParts(item)).toEqual(['Wynagrodzenie', 'Etat Adam', 'ROR', 'AK']);
  });

  it('przelew: kierunek w tytule albo w podpisie, nigdy dwa razy', () => {
    const bare = transactionItem({
      type: 'transfer',
      categoryName: null,
      counterAccountName: 'Oszczędności',
    });
    expect(transactionTitle(bare)).toBe('ROR → Oszczędności');
    expect(captionParts(bare)).toEqual(['AK']);

    const described = { ...bare, description: 'Wkład własny' };
    expect(transactionTitle(described)).toBe('Wkład własny');
    expect(captionParts(described)).toEqual(['ROR → Oszczędności', 'AK']);
  });
});
