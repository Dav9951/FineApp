import { describe, expect, it } from 'vitest';

import { integerToWordsPl, minorToWordsPl, pluralPl } from './money-words.js';

describe('pluralPl', () => {
  it('stosuje trzy przypadki polskiej odmiany', () => {
    const forms = ['złoty', 'złote', 'złotych'] as const;
    expect(pluralPl(1, forms)).toBe('złoty');
    expect(pluralPl(2, forms)).toBe('złote');
    expect(pluralPl(4, forms)).toBe('złote');
    expect(pluralPl(5, forms)).toBe('złotych');
    expect(pluralPl(0, forms)).toBe('złotych');
  });

  it('liczby 12–14 biorą formę daleką mimo końcówki 2–4', () => {
    const forms = ['złoty', 'złote', 'złotych'] as const;
    expect(pluralPl(12, forms)).toBe('złotych');
    expect(pluralPl(13, forms)).toBe('złotych');
    expect(pluralPl(14, forms)).toBe('złotych');
    // Ale 112 też — decyduje końcówka dwucyfrowa.
    expect(pluralPl(112, forms)).toBe('złotych');
    expect(pluralPl(22, forms)).toBe('złote');
  });
});

describe('integerToWordsPl', () => {
  it('zapisuje jedności, nastki i dziesiątki', () => {
    expect(integerToWordsPl(0)).toBe('zero');
    expect(integerToWordsPl(7)).toBe('siedem');
    expect(integerToWordsPl(11)).toBe('jedenaście');
    expect(integerToWordsPl(19)).toBe('dziewiętnaście');
    expect(integerToWordsPl(20)).toBe('dwadzieścia');
    expect(integerToWordsPl(27)).toBe('dwadzieścia siedem');
  });

  it('zapisuje setki', () => {
    expect(integerToWordsPl(100)).toBe('sto');
    expect(integerToWordsPl(127)).toBe('sto dwadzieścia siedem');
    expect(integerToWordsPl(900)).toBe('dziewięćset');
    expect(integerToWordsPl(999)).toBe('dziewięćset dziewięćdziesiąt dziewięć');
  });

  it('nie mówi „jeden tysiąc"', () => {
    expect(integerToWordsPl(1000)).toBe('tysiąc');
    expect(integerToWordsPl(1_000_000)).toBe('milion');
  });

  it('odmienia skale', () => {
    expect(integerToWordsPl(2000)).toBe('dwa tysiące');
    expect(integerToWordsPl(5000)).toBe('pięć tysięcy');
    expect(integerToWordsPl(12_000)).toBe('dwanaście tysięcy');
    expect(integerToWordsPl(22_000)).toBe('dwadzieścia dwa tysiące');
  });

  it('pomija puste grupy', () => {
    expect(integerToWordsPl(1_000_007)).toBe('milion siedem');
    expect(integerToWordsPl(1_002_000)).toBe('milion dwa tysiące');
  });

  it('odrzuca wejście spoza zakresu', () => {
    expect(() => integerToWordsPl(-1)).toThrow(RangeError);
    expect(() => integerToWordsPl(1.5)).toThrow(RangeError);
    expect(() => integerToWordsPl(1e15)).toThrow(RangeError);
  });
});

describe('minorToWordsPl', () => {
  it('odczytuje przykład z 15 §4.1', () => {
    expect(minorToWordsPl(-12_799)).toBe(
      'minus sto dwadzieścia siedem złotych dziewięćdziesiąt dziewięć groszy',
    );
  });

  it('odmienia złote i grosze niezależnie', () => {
    expect(minorToWordsPl(101)).toBe('jeden złoty jeden grosz');
    expect(minorToWordsPl(202)).toBe('dwa złote dwa grosze');
    expect(minorToWordsPl(505)).toBe('pięć złotych pięć groszy');
    expect(minorToWordsPl(1202)).toBe('dwanaście złotych dwa grosze');
  });

  it('wymienia grosze także przy pełnych złotówkach', () => {
    // „sto złotych" i „sto złotych zero groszy" to w finansach różnica między
    // „około" a „dokładnie".
    expect(minorToWordsPl(10_000)).toBe('sto złotych zero groszy');
  });

  it('zero nie dostaje znaku', () => {
    expect(minorToWordsPl(0)).toBe('zero złotych zero groszy');
    expect(minorToWordsPl(0)).not.toContain('minus');
  });

  it('czyta duże kwoty', () => {
    expect(minorToWordsPl(123_456_789)).toBe(
      'milion dwieście trzydzieści cztery tysiące pięćset sześćdziesiąt siedem złotych osiemdziesiąt dziewięć groszy',
    );
  });

  it('odrzuca kwotę niecałkowitą', () => {
    expect(() => minorToWordsPl(10.5)).toThrow(RangeError);
  });
});
