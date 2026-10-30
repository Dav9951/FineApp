import { describe, expect, it } from 'vitest';

import {
  formatMinor,
  formatMinorCompact,
  formatMinorWhole,
  fromBps,
  parseAmountToMinor,
  roundHalfAwayFromZero,
  splitEvenly,
  sumMinor,
  toBps,
} from './money.js';

describe('roundHalfAwayFromZero', () => {
  it('zaokrągla połówki symetrycznie w obie strony', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(3.5)).toBe(4);
    expect(roundHalfAwayFromZero(-3.5)).toBe(-4);
  });

  it('różni się od Math.round dokładnie na ujemnych połówkach', () => {
    // Math.round(-2.5) === -2, przez co kwota i jej przeciwność przestają się znosić.
    expect(roundHalfAwayFromZero(-2.5)).not.toBe(Math.round(-2.5));
    expect(roundHalfAwayFromZero(-2.5)).toBe(-roundHalfAwayFromZero(2.5));
  });

  it('nie rusza liczb całkowitych i zera', () => {
    expect(roundHalfAwayFromZero(0)).toBe(0);
    expect(roundHalfAwayFromZero(7)).toBe(7);
    expect(roundHalfAwayFromZero(-7)).toBe(-7);
  });

  it('zaokrągla w stronę bliższej liczby całkowitej', () => {
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2);
    expect(roundHalfAwayFromZero(2.6)).toBe(3);
  });
});

describe('toBps', () => {
  it('liczy udział w punktach bazowych', () => {
    expect(toBps(200_000, 1_180_000)).toBe(1695); // 2000 zł z 11 800 zł ≈ 16,95%
    expect(toBps(50_000, 100_000)).toBe(5000); // połowa = 50%
    expect(toBps(100_000, 100_000)).toBe(10_000); // całość = 100%
  });

  it('zwraca 0 przy zerowej podstawie, nie NaN', () => {
    // Miesiąc bez wpływów jest normalnym stanem aplikacji, nie błędem.
    expect(toBps(100_000, 0)).toBe(0);
    expect(Number.isNaN(toBps(100_000, 0))).toBe(false);
  });

  it('zwraca 0 przy ujemnej podstawie', () => {
    expect(toBps(100_000, -1)).toBe(0);
  });

  it('obsługuje kwotę ujemną — wykonanie liczone netto (ADR-011)', () => {
    expect(toBps(-50_000, 100_000)).toBe(-5000);
  });

  it('zwraca 0 dla zerowej kwoty', () => {
    expect(toBps(0, 100_000)).toBe(0);
  });
});

describe('fromBps', () => {
  it('liczy kwotę z udziału', () => {
    expect(fromBps(5000, 100_000)).toBe(50_000);
    expect(fromBps(10_000, 123_456)).toBe(123_456);
    expect(fromBps(0, 100_000)).toBe(0);
  });

  it('zaokrągla symetrycznie na granicy grosza', () => {
    // 1 bps z 5000 groszy = 0,5 grosza.
    expect(fromBps(1, 5_000)).toBe(1);
    expect(fromBps(1, -5_000)).toBe(-1);
  });

  it('obsługuje udział ujemny', () => {
    expect(fromBps(-2500, 100_000)).toBe(-25_000);
  });

  it('przeliczenie w obie strony nie jest bijekcją — i to jest udokumentowane', () => {
    // 07 §3: 2000 zł z 11 800 zł to 1694,9152… bps → 1695 → z powrotem 2000,10 zł.
    const bps = toBps(200_000, 1_180_000);
    expect(bps).toBe(1695);
    expect(fromBps(bps, 1_180_000)).toBe(200_010);
  });
});

describe('splitEvenly', () => {
  it('rozdaje resztę po jednym groszu od pierwszej części', () => {
    expect(splitEvenly(10_000, 3)).toEqual([3334, 3333, 3333]);
  });

  it('suma części równa się dokładnie kwocie wejściowej', () => {
    for (const total of [0, 1, 7, 100, 9_999, 10_000, 123_457]) {
      for (const parts of [1, 2, 3, 7, 12]) {
        expect(sumMinor(splitEvenly(total, parts))).toBe(total);
      }
    }
  });

  it('dzieli bez reszty, gdy się dzieli', () => {
    expect(splitEvenly(9_000, 3)).toEqual([3000, 3000, 3000]);
  });

  it('obsługuje kwotę zerową', () => {
    expect(splitEvenly(0, 3)).toEqual([0, 0, 0]);
  });

  it('obsługuje jedną część', () => {
    expect(splitEvenly(1234, 1)).toEqual([1234]);
  });

  it('dla kwoty ujemnej suma nadal się zgadza', () => {
    expect(splitEvenly(-10_000, 3)).toEqual([-3334, -3333, -3333]);
    expect(sumMinor(splitEvenly(-10_000, 3))).toBe(-10_000);
  });

  it('rozdaje resztę mniejszą niż liczba części', () => {
    expect(splitEvenly(10, 4)).toEqual([3, 3, 2, 2]);
  });

  it('odrzuca kwotę niecałkowitą i złą liczbę części', () => {
    expect(() => splitEvenly(10.5, 2)).toThrow(TypeError);
    expect(() => splitEvenly(100, 0)).toThrow(TypeError);
    expect(() => splitEvenly(100, -1)).toThrow(TypeError);
    expect(() => splitEvenly(100, 1.5)).toThrow(TypeError);
  });
});

describe('parseAmountToMinor', () => {
  it('przyjmuje przykłady z 07 §8.2', () => {
    expect(parseAmountToMinor('1234,56')).toBe(123_456);
    expect(parseAmountToMinor('1 234.56')).toBe(123_456);
    expect(parseAmountToMinor('12')).toBe(1200);
    expect(parseAmountToMinor('12,5')).toBe(1250);
    expect(parseAmountToMinor('12,555')).toBeNull();
    expect(parseAmountToMinor('abc')).toBeNull();
  });

  it('odrzuca trzecią cyfrę po przecinku zamiast ją uciąć', () => {
    // Cichy zapis 10,999 zł jako 10,99 zł byłby gorszy od komunikatu o błędzie.
    expect(parseAmountToMinor('10,999')).toBeNull();
  });

  it('znosi spacje zwykłe, niełamliwe i wąskie oraz sufiks waluty', () => {
    expect(parseAmountToMinor('1 234,56 zł')).toBe(123_456);
    expect(parseAmountToMinor('1 234,56 PLN')).toBe(123_456);
    expect(parseAmountToMinor('  99,99  zł ')).toBe(9999);
  });

  it('przyjmuje kwoty ujemne, także z minusem typograficznym', () => {
    expect(parseAmountToMinor('-12,34')).toBe(-1234);
    expect(parseAmountToMinor('−12,34')).toBe(-1234);
  });

  it('odrzuca wejście puste i bezsensowne', () => {
    expect(parseAmountToMinor('')).toBeNull();
    expect(parseAmountToMinor('   ')).toBeNull();
    expect(parseAmountToMinor('zł')).toBeNull();
    expect(parseAmountToMinor('1,2,3')).toBeNull();
    expect(parseAmountToMinor('--5')).toBeNull();
    expect(parseAmountToMinor(',5')).toBeNull();
    expect(parseAmountToMinor('5-')).toBeNull();
  });

  it('odrzuca kwotę poza bezpiecznym zakresem liczb całkowitych', () => {
    expect(parseAmountToMinor('999999999999999999')).toBeNull();
  });

  it('odrzuca wejście, które nie jest napisem', () => {
    expect(parseAmountToMinor(undefined as unknown as string)).toBeNull();
  });

  it('jest odwrotnością formatowania dla typowych kwot', () => {
    for (const minor of [0, 1, 99, 100, 123_456, -12_799]) {
      expect(parseAmountToMinor(formatMinor(minor))).toBe(minor);
    }
  });
});

describe('formatMinor', () => {
  it('formatuje zgodnie z 07 §8.5', () => {
    expect(formatMinor(123_456)).toBe('1 234,56 zł');
    expect(formatMinor(-12_799)).toBe('−127,99 zł');
    expect(formatMinor(0)).toBe('0,00 zł');
  });

  it('używa minusa typograficznego, nie łącznika', () => {
    // W kroju o cyfrach tabelarycznych łącznik ma inną szerokość i rozjeżdża kolumnę.
    expect(formatMinor(-100)).toContain('−');
    expect(formatMinor(-100)).not.toContain('-');
  });

  it('grupuje także kwoty czterocyfrowe', () => {
    // Intl samo z siebie tego nie robi — daje „1234,56 zł".
    expect(formatMinor(123_456)).toContain(' 234');
  });

  it('zawsze pokazuje dwie cyfry po przecinku', () => {
    expect(formatMinor(100)).toBe('1,00 zł');
    expect(formatMinor(110)).toBe('1,10 zł');
  });
});

describe('formatMinorCompact', () => {
  it('skraca duże kwoty', () => {
    expect(formatMinorCompact(1_234_567)).toBe(`12,3${' '}tys.${' '}zł`);
  });

  it('zachowuje minus typograficzny', () => {
    expect(formatMinorCompact(-1_234_567)).toContain('−');
  });

  it('obsługuje inną walutę', () => {
    expect(formatMinorCompact(1_234_567, 'EUR')).toContain('EUR');
  });
});

describe('formatMinorWhole', () => {
  const NBSP = '\u00A0';

  it('ucina grosze, zostawiając pełną liczbę', () => {
    expect(formatMinorWhole(236_000)).toBe(`2${NBSP}360${NBSP}zł`);
    expect(formatMinorWhole(200_000)).toBe(`2${NBSP}000${NBSP}zł`);
  });

  it('zaokrągla, a nie ucina — inaczej 999,99 zł pokazałoby mniej, niż jest', () => {
    expect(formatMinorWhole(99_999)).toBe(`1${NBSP}000${NBSP}zł`);
    expect(formatMinorWhole(99_949)).toBe(`999${NBSP}zł`);
  });

  it('zaokrągla symetrycznie wokół zera', () => {
    expect(formatMinorWhole(50)).toBe(`1${NBSP}zł`);
    expect(formatMinorWhole(-50)).toBe(`−1${NBSP}zł`);
  });

  it('zachowuje minus typograficzny', () => {
    expect(formatMinorWhole(-236_000)).toBe(`−2${NBSP}360${NBSP}zł`);
  });

  it('zero nie dostaje znaku', () => {
    expect(formatMinorWhole(0)).toBe(`0${NBSP}zł`);
  });

  it('obsługuje inną walutę tak samo jak formatMinor — symbolem', () => {
    expect(formatMinorWhole(236_000, 'EUR')).toBe(`2${NBSP}360${NBSP}€`);
  });
});

describe('sumMinor', () => {
  it('sumuje kwoty', () => {
    expect(sumMinor([100, 200, 300])).toBe(600);
    expect(sumMinor([])).toBe(0);
    expect(sumMinor([-100, 100])).toBe(0);
  });

  it('odrzuca kwotę niecałkowitą', () => {
    expect(() => sumMinor([100, 0.5])).toThrow(TypeError);
  });
});
