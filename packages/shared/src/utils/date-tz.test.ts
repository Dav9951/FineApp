import { describe, expect, it } from 'vitest';

import { currentMonthKey, todayInTimezone } from './date-tz.js';

describe('todayInTimezone', () => {
  it('nie cofa daty o północy w Warszawie — pułapka toISOString', () => {
    // 00:30 czasu warszawskiego latem to 22:30 UTC dnia POPRZEDNIEGO.
    // `new Date().toISOString().slice(0,10)` dałby tu 17 września.
    const midnightWarsaw = new Date('2026-09-17T22:30:00.000Z');
    expect(midnightWarsaw.toISOString().slice(0, 10)).toBe('2026-09-17');
    expect(todayInTimezone('Europe/Warsaw', midnightWarsaw)).toBe('2026-09-18');
  });

  it('nie przenosi wydatku do poprzedniego miesiąca w nocy z 31 na 1', () => {
    // 1 września 00:30 w Warszawie = 31 sierpnia 22:30 UTC.
    const turnOfMonth = new Date('2026-08-31T22:30:00.000Z');
    expect(todayInTimezone('Europe/Warsaw', turnOfMonth)).toBe('2026-09-01');
  });

  it('uwzględnia czas zimowy', () => {
    // Zimą Warszawa to UTC+1, więc 23:30 UTC to już następny dzień.
    const winter = new Date('2026-01-15T23:30:00.000Z');
    expect(todayInTimezone('Europe/Warsaw', winter)).toBe('2026-01-16');
  });

  it('daje różne wyniki dla różnych stref w tej samej chwili', () => {
    const instant = new Date('2026-09-17T22:30:00.000Z');
    expect(todayInTimezone('Europe/Warsaw', instant)).toBe('2026-09-18');
    expect(todayInTimezone('UTC', instant)).toBe('2026-09-17');
    expect(todayInTimezone('America/New_York', instant)).toBe('2026-09-17');
  });

  it('zwraca format RRRR-MM-DD niezależnie od lokalizacji systemu', () => {
    expect(todayInTimezone('Europe/Warsaw')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('odrzuca nieznaną strefę', () => {
    expect(() => todayInTimezone('Nieistniejaca/Strefa')).toThrow(RangeError);
  });
});

describe('currentMonthKey', () => {
  it('wyznacza miesiąc w strefie gospodarstwa', () => {
    expect(currentMonthKey('Europe/Warsaw', new Date('2026-09-18T10:00:00.000Z'))).toBe('2026-09');
  });

  it('o północy na przełomie miesiąca daje już nowy miesiąc', () => {
    expect(currentMonthKey('Europe/Warsaw', new Date('2026-08-31T22:30:00.000Z'))).toBe('2026-09');
  });

  it('respektuje monthStartDay', () => {
    // Przy starcie 26. dnia data 2026-09-20 należy jeszcze do miesiąca sierpniowego.
    expect(currentMonthKey('Europe/Warsaw', new Date('2026-09-20T10:00:00.000Z'), 26)).toBe(
      '2026-08',
    );
  });
});
