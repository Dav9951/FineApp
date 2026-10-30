import { describe, expect, it } from 'vitest';

import {
  formatDateOnly,
  formatDateShort,
  formatMinor,
  formatMonth,
  inMonth,
  transactionCountLabel,
} from './format.js';

describe('reeksporty z @fineapp/shared', () => {
  it('front formatuje kwoty tak samo jak backend', () => {
    // Własna kopia toFixed(2) w komponencie to najkrótsza droga do dwóch różnych
    // zapisów tej samej kwoty na jednym ekranie.
    expect(formatMinor(123_456)).toBe('1 234,56 zł');
    expect(formatMonth('2026-09')).toBe('wrzesień 2026');
  });
});

describe('formatDateOnly', () => {
  it('formatuje datę biznesową po polsku', () => {
    expect(formatDateOnly('2026-09-18')).toBe('18 września 2026');
  });

  it('nie cofa daty przez strefę lokalną', () => {
    // Data biznesowa nie ma strefy — formatowanie idzie w UTC.
    expect(formatDateOnly('2026-01-01')).toBe('1 stycznia 2026');
    expect(formatDateOnly('2026-12-31')).toBe('31 grudnia 2026');
  });
});

describe('formatDateShort', () => {
  it('skraca do dnia i miesiąca', () => {
    expect(formatDateShort('2026-09-18')).toBe('18 wrz');
  });
});

describe('transactionCountLabel', () => {
  it('odmienia jak po polsku', () => {
    const labels = [0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 104, 112, 1000].map(transactionCountLabel);
    expect(labels).toEqual([
      '0 transakcji',
      '1 transakcja',
      '2 transakcje',
      '4 transakcje',
      '5 transakcji',
      '11 transakcji',
      '12 transakcji',
      '14 transakcji',
      '21 transakcji',
      '22 transakcje',
      '104 transakcje',
      '112 transakcji',
      '1000 transakcji',
    ]);
  });
});

describe('inMonth', () => {
  it('miejscownik z przyimkiem — „we" tylko przed wrześniem', () => {
    expect(inMonth('2026-08')).toBe('w sierpniu');
    expect(inMonth('2026-09')).toBe('we wrześniu');
    expect(inMonth('2026-11')).toBe('w listopadzie');
    expect(inMonth('zły')).toBe('zły');
  });
});
