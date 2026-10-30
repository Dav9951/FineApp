import { describe, expect, it } from 'vitest';

import {
  addDays,
  clampDayToMonth,
  daysBetween,
  daysInMonth,
  earliestPostableDate,
  formatDateOnly,
  formatMonth,
  isLeapYear,
  isValidDateOnly,
  isValidMonthKey,
  latestPostableDate,
  monthKeyOf,
  monthRange,
  monthsBetween,
  monthsDiff,
  monthTiming,
  shiftMonth,
} from './month.js';

describe('isLeapYear', () => {
  it('stosuje pełną regułę gregoriańską, nie samo „podzielne przez 4"', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false); // podzielny przez 100, nie przez 400
    expect(isLeapYear(2000)).toBe(true); // podzielny przez 400
    expect(isLeapYear(2100)).toBe(false);
  });
});

describe('daysInMonth', () => {
  it('zna długość każdego miesiąca', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('rozstrzyga luty przez rok przestępny', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it('zwraca wartość zastępczą dla miesiąca spoza zakresu', () => {
    expect(daysInMonth(2026, 13)).toBe(30);
    expect(daysInMonth(2026, 0)).toBe(30);
  });
});

describe('isValidDateOnly', () => {
  it('przyjmuje istniejące daty', () => {
    expect(isValidDateOnly('2026-09-18')).toBe(true);
    expect(isValidDateOnly('2024-02-29')).toBe(true);
    expect(isValidDateOnly('2026-12-31')).toBe(true);
    expect(isValidDateOnly('2026-01-01')).toBe(true);
  });

  it('odrzuca daty, które przepuszcza Date.parse', () => {
    // Date.parse('2026-02-31T00:00:00Z') NIE zwraca NaN — przewija na 3 marca.
    expect(isValidDateOnly('2026-02-31')).toBe(false);
    expect(isValidDateOnly('2026-02-29')).toBe(false); // 2026 nie jest przestępny
    expect(isValidDateOnly('2026-04-31')).toBe(false);
    expect(isValidDateOnly('2026-09-31')).toBe(false);
  });

  it('odrzuca zły miesiąc, dzień i kształt', () => {
    expect(isValidDateOnly('2026-13-01')).toBe(false);
    expect(isValidDateOnly('2026-00-10')).toBe(false);
    expect(isValidDateOnly('2026-09-00')).toBe(false);
    expect(isValidDateOnly('2026-9-18')).toBe(false);
    expect(isValidDateOnly('18-09-2026')).toBe(false);
    expect(isValidDateOnly('')).toBe(false);
  });
});

describe('isValidMonthKey', () => {
  it('przyjmuje poprawne klucze i odrzuca resztę', () => {
    expect(isValidMonthKey('2026-09')).toBe(true);
    expect(isValidMonthKey('2026-01')).toBe(true);
    expect(isValidMonthKey('2026-12')).toBe(true);
    expect(isValidMonthKey('2026-13')).toBe(false);
    expect(isValidMonthKey('2026-00')).toBe(false);
    expect(isValidMonthKey('2026-9')).toBe(false);
    expect(isValidMonthKey('2026-09-01')).toBe(false);
  });
});

describe('shiftMonth', () => {
  it('przesuwa w przód i w tył', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10');
    expect(shiftMonth('2026-09', -1)).toBe('2026-08');
    expect(shiftMonth('2026-09', 0)).toBe('2026-09');
  });

  it('przechodzi przez granicę roku w obie strony', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-01', -12)).toBe('2025-01');
    expect(shiftMonth('2026-06', 18)).toBe('2027-12');
    expect(shiftMonth('2026-06', -18)).toBe('2024-12');
  });

  it('odrzuca nieprawidłowy klucz', () => {
    expect(() => shiftMonth('2026-13', 1)).toThrow(TypeError);
  });
});

describe('monthKeyOf', () => {
  it('przy monthStartDay = 1 bierze miesiąc kalendarzowy', () => {
    expect(monthKeyOf('2026-09-18')).toBe('2026-09');
    expect(monthKeyOf('2026-09-01')).toBe('2026-09');
    expect(monthKeyOf('2026-08-31')).toBe('2026-08');
  });

  it('wydatek z 31 sierpnia należy do sierpnia, nie do września', () => {
    expect(monthKeyOf('2026-08-31')).toBe('2026-08');
  });

  it('przy monthStartDay > 1 nazywa miesiąc od tego, w którym się zaczyna', () => {
    // Przykład z 07 §1.2: okres 26.09 – 25.10 to miesiąc 2026-09.
    expect(monthKeyOf('2026-09-28', 26)).toBe('2026-09');
    expect(monthKeyOf('2026-09-20', 26)).toBe('2026-08');
    expect(monthKeyOf('2026-09-26', 26)).toBe('2026-09');
    expect(monthKeyOf('2026-09-25', 26)).toBe('2026-08');
  });

  it('przy monthStartDay > 1 przechodzi przez granicę roku', () => {
    expect(monthKeyOf('2026-01-10', 26)).toBe('2025-12');
  });

  it('odrzuca nieistniejącą datę', () => {
    expect(() => monthKeyOf('2026-02-31')).toThrow(TypeError);
  });
});

describe('monthRange', () => {
  it('przy monthStartDay = 1 zwraca cały miesiąc kalendarzowy', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2026-01')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('zna długość lutego w roku zwykłym i przestępnym', () => {
    expect(monthRange('2026-02').to).toBe('2026-02-28');
    expect(monthRange('2024-02').to).toBe('2024-02-29');
  });

  it('przy monthStartDay > 1 kończy się dzień przed startem kolejnego', () => {
    expect(monthRange('2026-09', 26)).toEqual({ from: '2026-09-26', to: '2026-10-25' });
  });

  it('przycina koniec do długości kolejnego miesiąca', () => {
    // Start 28 w styczniu → koniec 27 lutego; luty jest krótszy, ale 27 się mieści.
    expect(monthRange('2026-01', 28)).toEqual({ from: '2026-01-28', to: '2026-02-27' });
  });

  it('odrzuca nieprawidłowy klucz', () => {
    expect(() => monthRange('2026-13')).toThrow(TypeError);
  });
});

describe('monthsBetween', () => {
  it('zwraca krańce włącznie', () => {
    expect(monthsBetween('2026-09', '2026-12')).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
  });

  it('dla jednego miesiąca zwraca listę jednoelementową', () => {
    expect(monthsBetween('2026-09', '2026-09')).toEqual(['2026-09']);
  });

  it('przechodzi przez granicę roku', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('zwraca pustą listę dla odwróconego zakresu', () => {
    expect(monthsBetween('2026-12', '2026-09')).toEqual([]);
  });

  it('odrzuca nieprawidłowy zakres', () => {
    expect(() => monthsBetween('2026-13', '2026-09')).toThrow(TypeError);
    expect(() => monthsBetween('2026-09', 'zły')).toThrow(TypeError);
  });
});

describe('monthsDiff', () => {
  it('liczy różnicę w miesiącach ze znakiem', () => {
    expect(monthsDiff('2026-09', '2026-12')).toBe(3);
    expect(monthsDiff('2026-12', '2026-09')).toBe(-3);
    expect(monthsDiff('2026-09', '2026-09')).toBe(0);
    expect(monthsDiff('2025-12', '2026-01')).toBe(1);
  });

  it('odrzuca nieprawidłowy zakres', () => {
    expect(() => monthsDiff('zły', '2026-09')).toThrow(TypeError);
  });
});

describe('earliestPostableDate', () => {
  it('liczy od początku miesiąca, nie „30 dni wstecz"', () => {
    // 07 §1.3: przy limicie 1 przez cały wrzesień wolno księgować od 1 sierpnia.
    expect(earliestPostableDate('2026-09-30', 1)).toBe('2026-08-01');
    expect(earliestPostableDate('2026-09-01', 1)).toBe('2026-08-01');
  });

  it('przy limicie 0 pozwala tylko na bieżący miesiąc', () => {
    expect(earliestPostableDate('2026-09-18', 0)).toBe('2026-09-01');
  });

  it('przechodzi przez granicę roku', () => {
    expect(earliestPostableDate('2026-01-15', 2)).toBe('2025-11-01');
  });

  it('odrzuca nieprawidłową datę i ujemny limit', () => {
    expect(() => earliestPostableDate('2026-02-31', 1)).toThrow(TypeError);
    expect(() => earliestPostableDate('2026-09-18', -1)).toThrow(TypeError);
    expect(() => earliestPostableDate('2026-09-18', 1.5)).toThrow(TypeError);
  });
});

describe('latestPostableDate', () => {
  it('to koniec bieżącego miesiąca, nie „dziś"', () => {
    expect(latestPostableDate('2026-09-01')).toBe('2026-09-30');
    expect(latestPostableDate('2026-09-30')).toBe('2026-09-30');
  });

  it('zna luty w roku przestępnym i zwykłym', () => {
    expect(latestPostableDate('2028-02-10')).toBe('2028-02-29');
    expect(latestPostableDate('2026-02-10')).toBe('2026-02-28');
  });

  it('przy przesuniętym starcie miesiąca kończy się dzień przed kolejnym startem', () => {
    expect(latestPostableDate('2026-09-28', 26)).toBe('2026-10-25');
    expect(latestPostableDate('2026-09-20', 26)).toBe('2026-09-25');
  });

  it('odrzuca nieprawidłową datę', () => {
    expect(() => latestPostableDate('2026-02-31')).toThrow(TypeError);
  });
});

describe('clampDayToMonth', () => {
  it('przycina 31. dzień do długości miesiąca', () => {
    // Reguła „31. dnia miesiąca" w lutym to 28 albo 29 — bez przycięcia powstałby
    // termin, którego nie ma w kalendarzu.
    expect(clampDayToMonth('2026-02', 31)).toBe('2026-02-28');
    expect(clampDayToMonth('2024-02', 31)).toBe('2024-02-29');
    expect(clampDayToMonth('2026-04', 31)).toBe('2026-04-30');
    expect(clampDayToMonth('2026-01', 31)).toBe('2026-01-31');
  });

  it('nie rusza dnia, który się mieści', () => {
    expect(clampDayToMonth('2026-09', 15)).toBe('2026-09-15');
    expect(clampDayToMonth('2026-09', 1)).toBe('2026-09-01');
  });

  it('zwraca zawsze istniejącą datę', () => {
    for (let day = 1; day <= 31; day += 1) {
      expect(isValidDateOnly(clampDayToMonth('2026-02', day))).toBe(true);
    }
  });

  it('odrzuca zły klucz i dzień spoza zakresu', () => {
    expect(() => clampDayToMonth('2026-13', 1)).toThrow(TypeError);
    expect(() => clampDayToMonth('2026-09', 0)).toThrow(TypeError);
    expect(() => clampDayToMonth('2026-09', 32)).toThrow(TypeError);
    expect(() => clampDayToMonth('2026-09', 1.5)).toThrow(TypeError);
  });
});

describe('formatMonth', () => {
  it('formatuje po polsku', () => {
    expect(formatMonth('2026-09')).toBe('wrzesień 2026');
    expect(formatMonth('2026-01')).toBe('styczeń 2026');
    expect(formatMonth('2026-12')).toBe('grudzień 2026');
  });

  it('nie gubi miesiąca przez strefę czasową', () => {
    // Formatowanie w strefie lokalnej mogłoby cofnąć datę o dzień i pokazać sierpień.
    expect(formatMonth('2026-09')).toContain('wrzesień');
  });

  it('odrzuca nieprawidłowy klucz', () => {
    expect(() => formatMonth('2026-13')).toThrow(TypeError);
  });
});

describe('formatDateOnly', () => {
  it('podaje miesiąc w dopełniaczu, bez zera wiodącego', () => {
    expect(formatDateOnly('2026-08-01')).toBe('1 sierpnia 2026');
    expect(formatDateOnly('2026-12-31')).toBe('31 grudnia 2026');
  });

  it('odrzuca nieistniejącą datę', () => {
    expect(() => formatDateOnly('2026-02-30')).toThrow(TypeError);
  });
});

describe('monthTiming', () => {
  it('miesiąc bieżący: dzisiejszy dzień liczy się jako miniony', () => {
    expect(monthTiming('2026-09', '2026-09-01')).toEqual({
      range: { from: '2026-09-01', to: '2026-09-30' },
      isCurrent: true,
      isPartial: true,
      isFuture: false,
      daysElapsed: 1,
      daysInMonth: 30,
    });
    expect(monthTiming('2026-09', '2026-09-30').daysElapsed).toBe(30);
  });

  it('miesiąc przeszły jest pełny, przyszły — nierozpoczęty', () => {
    expect(monthTiming('2026-08', '2026-09-23')).toMatchObject({
      isCurrent: false,
      isPartial: false,
      isFuture: false,
      daysElapsed: 31,
      daysInMonth: 31,
    });
    expect(monthTiming('2026-10', '2026-09-23')).toMatchObject({
      isFuture: true,
      daysElapsed: 0,
      daysInMonth: 31,
    });
  });

  it('luty w roku przestępnym i zwykłym', () => {
    expect(monthTiming('2028-02', '2028-03-01').daysInMonth).toBe(29);
    expect(monthTiming('2027-02', '2027-03-01').daysInMonth).toBe(28);
  });

  it('zmiana czasu w październiku nie gubi ani nie dokłada dnia', () => {
    // 25 października 2026 — powrót do czasu zimowego w Europie.
    expect(monthTiming('2026-10', '2026-10-31').daysElapsed).toBe(31);
    expect(monthTiming('2026-03', '2026-03-31').daysElapsed).toBe(31);
  });

  it('miesiąc budżetowy od 26. dnia', () => {
    const timing = monthTiming('2026-09', '2026-10-01', 26);
    expect(timing.range).toEqual({ from: '2026-09-26', to: '2026-10-25' });
    expect(timing.isCurrent).toBe(true);
    expect(timing.daysElapsed).toBe(6);
    expect(timing.daysInMonth).toBe(30);
  });
});

describe('addDays / daysBetween', () => {
  it('przechodzi przez granice miesiąca, roku i 29 lutego', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-29', 0)).toBe('2026-03-29');
  });

  it('różnica dni ze znakiem, także przez zmianę czasu', () => {
    expect(daysBetween('2026-09-18', '2026-09-21')).toBe(3);
    expect(daysBetween('2026-09-21', '2026-09-18')).toBe(-3);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });
});
