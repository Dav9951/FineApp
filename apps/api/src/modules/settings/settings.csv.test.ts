import { describe, expect, it } from 'vitest';

import {
  buildTransactionsCsv,
  categoryPath,
  csvAmount,
  csvText,
  signedAmountMinor,
  type CsvNames,
  type CsvTransaction,
} from './settings.csv.js';

/**
 * Testy budowy pliku CSV — `F8-2`
 * ([04 §15](../../../../../../plans/04-api-spec.md#15-ustawienia--apiv1settings)).
 */

const NAMES: CsvNames = {
  accounts: new Map([['a1', 'ROR']]),
  categories: new Map([
    ['c1', { name: 'Jedzenie', parentId: null }],
    ['c2', { name: 'Piekarnia', parentId: 'c1' }],
    ['c3', { name: 'Sierota', parentId: 'zniknął' }],
  ]),
  incomeSources: new Map(),
};

/**
 * Transakcja z wartościami domyślnymi.
 *
 * @param overrides - Nadpisane pola.
 * @returns Transakcja do CSV.
 */
function tx(overrides: Partial<CsvTransaction> = {}): CsvTransaction {
  return {
    id: 'T1',
    type: 'expense',
    status: 'posted',
    bookedOn: '2026-09-01',
    monthKey: '2026-09',
    amountMinor: 100,
    currency: 'PLN',
    accountId: 'a1',
    counterAccountId: null,
    categoryId: null,
    incomeSourceId: null,
    description: null,
    merchant: null,
    notes: null,
    source: 'manual',
    ...overrides,
  };
}

describe('csvAmount', () => {
  it('grosze na liczbę z przecinkiem, bez separatora tysięcy', () => {
    expect(csvAmount(0)).toBe('0,00');
    expect(csvAmount(1)).toBe('0,01');
    expect(csvAmount(99)).toBe('0,99');
    expect(csvAmount(100)).toBe('1,00');
    expect(csvAmount(1_234_567_89)).toBe('1234567,89');
    expect(csvAmount(-5)).toBe('-0,05');
    expect(csvAmount(-123_45)).toBe('-123,45');
  });
});

describe('signedAmountMinor', () => {
  it('wydatek ujemny, przychód i przelew dodatnie', () => {
    expect(signedAmountMinor('expense', 500)).toBe(-500);
    expect(signedAmountMinor('income', 500)).toBe(500);
    expect(signedAmountMinor('transfer', 500)).toBe(500);
  });
});

describe('csvText', () => {
  it('pusta komórka dla braku wartości', () => {
    expect(csvText(null)).toBe('');
    expect(csvText('')).toBe('');
  });

  it('cudzysłów przy separatorze, cudzysłowie i nowej linii', () => {
    expect(csvText('zwykły tekst')).toBe('zwykły tekst');
    expect(csvText('a;b')).toBe('"a;b"');
    expect(csvText('powiedział "tak"')).toBe('"powiedział ""tak"""');
    expect(csvText('dwie\nlinie')).toBe('"dwie\nlinie"');
  });

  it('neutralizuje formuły (CSV injection)', () => {
    expect(csvText('=1+1')).toBe("'=1+1");
    expect(csvText('+48 600')).toBe("'+48 600");
    expect(csvText('-rabat')).toBe("'-rabat");
    expect(csvText('@SUMA(A1)')).toBe("'@SUMA(A1)");
    expect(csvText('\tukryte')).toBe("'\tukryte");
    expect(csvText('=A1;B1')).toBe('"\'=A1;B1"');
  });
});

describe('categoryPath', () => {
  it('kategoria główna, podkategoria, brak i osierocona', () => {
    expect(categoryPath('c1', NAMES.categories)).toBe('Jedzenie');
    expect(categoryPath('c2', NAMES.categories)).toBe('Jedzenie / Piekarnia');
    expect(categoryPath(null, NAMES.categories)).toBeNull();
    expect(categoryPath('nie-ma', NAMES.categories)).toBeNull();
    expect(categoryPath('c3', NAMES.categories)).toBe('Sierota');
  });
});

describe('buildTransactionsCsv', () => {
  it('BOM, nagłówek i CRLF — także przy braku transakcji', () => {
    const csv = buildTransactionsCsv([], NAMES);
    expect(csv.startsWith('﻿Data;Miesiąc;Typ;Kwota')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('wiersz ma tyle kolumn, co nagłówek, a nieznane statusy przechodzą bez zmian', () => {
    const csv = buildTransactionsCsv(
      [tx({ status: 'void', source: 'ocr', categoryId: 'c2', notes: 'x' })],
      NAMES,
    );
    const [header, row] = csv.slice(1).split('\r\n');
    expect(row?.split(';')).toHaveLength(header?.split(';').length ?? 0);
    expect(row).toBe(
      '2026-09-01;2026-09;Wydatek;-1,00;PLN;ROR;;Jedzenie / Piekarnia;;;;x;anulowana;dokument;T1',
    );
    expect(buildTransactionsCsv([tx({ status: 'nowy', source: 'inne' })], NAMES)).toContain(
      ';nowy;inne;T1',
    );
  });

  it('konto spoza słownika — pusta komórka, nie identyfikator', () => {
    const csv = buildTransactionsCsv([tx({ accountId: 'usunięte' })], NAMES);
    expect(csv).not.toContain('usunięte');
  });
});
