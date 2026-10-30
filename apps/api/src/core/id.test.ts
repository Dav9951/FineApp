import { describe, expect, it } from 'vitest';

import { fixedClock, mutableClock } from './clock.js';
import { createIdGenerator, ID_LENGTH, idTimestamp, isId, newId } from './id.js';

/**
 * Generator z zegarem zatrzymanym na wskazanej chwili.
 *
 * @param ms - Znacznik w milisekundach od epoki.
 * @returns Generator o stanie niezależnym od pozostałych testów.
 */
const atTime = (ms: number) => createIdGenerator(fixedClock(new Date(ms)));

describe('createIdGenerator', () => {
  it('zwraca 26 znaków z alfabetu Crockforda', () => {
    const id = newId();
    expect(id).toHaveLength(ID_LENGTH);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('nie używa znaków mylących przy przepisywaniu z ekranu', () => {
    // I, L, O, U są wyłączone — to cały powód wyboru tego alfabetu.
    const gen = createIdGenerator();
    const ids = Array.from({ length: 200 }, () => gen.next()).join('');
    expect(ids).not.toMatch(/[ILOU]/);
  });

  it('sortuje się leksykograficznie zgodnie z czasem powstania', () => {
    const early = atTime(1_700_000_000_000).next();
    const late = atTime(1_800_000_000_000).next();
    expect([late, early].sort()).toEqual([early, late]);
  });

  it('zachowuje kolejność wywołań w obrębie jednej milisekundy', () => {
    const gen = atTime(1_750_000_000_000);
    const ids = Array.from({ length: 50 }, () => gen.next());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('nie cofa się, gdy zegar systemowy cofnie się w tył', () => {
    // NTP albo zmiana czasu potrafi cofnąć zegar. Identyfikator mniejszy od
    // poprzedniego zepsułby porządek, dla którego wybrano ULID.
    const clock = mutableClock(new Date(1_760_000_000_000));
    const gen = createIdGenerator(clock);
    const first = gen.next();
    clock.advance(-1_000_000_000);
    expect(gen.next() > first).toBe(true);
  });

  it('wraca do losowania, gdy zegar znów ruszy naprzód', () => {
    const clock = mutableClock(new Date(1_760_000_000_000));
    const gen = createIdGenerator(clock);
    const first = gen.next();
    clock.advance(5);
    const second = gen.next();
    expect(second > first).toBe(true);
    expect(idTimestamp(second).getTime()).toBe(1_760_000_000_005);
  });

  it('ma stan własny, nie wspólny z innymi generatorami', () => {
    const late = atTime(1_800_000_000_000);
    late.next();
    // Gdyby stan był modułowy, ten generator zostałby zaciągnięty do roku 2027.
    expect(idTimestamp(atTime(1_700_000_000_000).next()).getTime()).toBe(1_700_000_000_000);
  });

  it('nie powtarza się przy dużej liczbie wywołań', () => {
    const gen = createIdGenerator();
    const ids = new Set(Array.from({ length: 10_000 }, () => gen.next()));
    expect(ids.size).toBe(10_000);
  });

  it('odrzuca znacznik spoza zakresu 48 bitów', () => {
    expect(() => atTime(-1).next()).toThrow(RangeError);
    expect(() => atTime(281_474_976_710_656).next()).toThrow(RangeError);
  });
});

describe('isId', () => {
  it('przyjmuje własny wynik generatora', () => {
    expect(isId(newId())).toBe(true);
  });

  it('odrzuca złą długość i znaki spoza alfabetu', () => {
    expect(isId('')).toBe(false);
    expect(isId('01JB2X9K7T')).toBe(false);
    expect(isId('0'.repeat(27))).toBe(false);
    expect(isId('I'.repeat(26))).toBe(false);
    expect(isId('01JB2X9K7T-QW3R5Y7U9I1O3P')).toBe(false);
  });
});

describe('idTimestamp', () => {
  it('odczytuje znacznik zapisany w identyfikatorze', () => {
    const when = 1_758_412_800_000;
    expect(idTimestamp(atTime(when).next()).getTime()).toBe(when);
  });

  it('odrzuca napis, który nie jest identyfikatorem', () => {
    expect(() => idTimestamp('nie-identyfikator')).toThrow(TypeError);
  });
});
