import { describe, expect, it } from 'vitest';

import { fixedClock, mutableClock, systemClock } from './clock.js';

describe('systemClock', () => {
  it('zwraca czas bliski bieżącemu', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1_000);
  });
});

describe('fixedClock', () => {
  it('zwraca wciąż tę samą chwilę', () => {
    const clock = fixedClock('2026-09-21T10:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-09-21T10:00:00.000Z');
    expect(clock.now().getTime()).toBe(clock.now().getTime());
  });

  it('nie daje się przesunąć przez mutację przekazanej daty', () => {
    const source = new Date('2026-09-21T10:00:00.000Z');
    const clock = fixedClock(source);
    source.setFullYear(2030);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('nie daje się przesunąć przez mutację zwróconej daty', () => {
    const clock = fixedClock('2026-09-21T10:00:00.000Z');
    clock.now().setFullYear(2030);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('odrzuca nieprawidłową chwilę', () => {
    expect(() => fixedClock('nie-data')).toThrow(TypeError);
  });
});

describe('mutableClock', () => {
  it('przesuwa się dokładnie o podaną liczbę milisekund', () => {
    const clock = mutableClock('2026-09-21T10:00:00.000Z');
    clock.advance(15 * 60 * 1000);
    expect(clock.now().toISOString()).toBe('2026-09-21T10:15:00.000Z');
  });

  it('kumuluje kolejne przesunięcia', () => {
    const clock = mutableClock('2026-09-21T10:00:00.000Z');
    clock.advance(1_000);
    clock.advance(2_000);
    expect(clock.now().toISOString()).toBe('2026-09-21T10:00:03.000Z');
  });
});
