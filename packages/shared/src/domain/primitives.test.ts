import { describe, expect, it } from 'vitest';

import {
  AmountMinorSchema,
  BpsSchema,
  CurrencySchema,
  DateOnlySchema,
  HexColorSchema,
  IdSchema,
  MAX_AMOUNT_MINOR,
  MonthKeySchema,
  MonthStartDaySchema,
  NonNegativeAmountMinorSchema,
  PositiveAmountMinorSchema,
  SignedBpsSchema,
  TimestampSchema,
} from './primitives.js';

describe('IdSchema', () => {
  it('przyjmuje 26-znakowy ULID', () => {
    expect(IdSchema.safeParse('01M3262VP3TXER35FX4X8QWQ75').success).toBe(true);
  });

  it('odrzuca znaki wyłączone z alfabetu Crockforda', () => {
    expect(IdSchema.safeParse('01M3262VP3TXER35FX4X8QWQ7I').success).toBe(false);
    expect(IdSchema.safeParse('01M3262VP3TXER35FX4X8QWQ7L').success).toBe(false);
    expect(IdSchema.safeParse('01M3262VP3TXER35FX4X8QWQ7O').success).toBe(false);
    expect(IdSchema.safeParse('01M3262VP3TXER35FX4X8QWQ7U').success).toBe(false);
  });

  it('odrzuca złą długość i małe litery', () => {
    expect(IdSchema.safeParse('01M3262VP3').success).toBe(false);
    expect(IdSchema.safeParse('01m3262vp3txer35fx4x8qwq75').success).toBe(false);
  });
});

describe('AmountMinorSchema', () => {
  it('przyjmuje grosze jako liczby całkowite, także ujemne', () => {
    expect(AmountMinorSchema.safeParse(123_456).success).toBe(true);
    expect(AmountMinorSchema.safeParse(0).success).toBe(true);
    expect(AmountMinorSchema.safeParse(-123_456).success).toBe(true);
  });

  it('odrzuca ułamki groszy', () => {
    expect(AmountMinorSchema.safeParse(12.5).success).toBe(false);
  });

  it('pilnuje zakresu w obie strony', () => {
    expect(AmountMinorSchema.safeParse(MAX_AMOUNT_MINOR).success).toBe(true);
    expect(AmountMinorSchema.safeParse(MAX_AMOUNT_MINOR + 1).success).toBe(false);
    expect(AmountMinorSchema.safeParse(-MAX_AMOUNT_MINOR - 1).success).toBe(false);
  });

  it('ma komunikat po polsku', () => {
    const result = AmountMinorSchema.safeParse(12.5);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Kwota musi być liczbą całkowitą groszy');
    }
  });
});

describe('PositiveAmountMinorSchema / NonNegativeAmountMinorSchema', () => {
  it('kwota transakcji musi być dodatnia', () => {
    expect(PositiveAmountMinorSchema.safeParse(1).success).toBe(true);
    expect(PositiveAmountMinorSchema.safeParse(0).success).toBe(false);
    expect(PositiveAmountMinorSchema.safeParse(-1).success).toBe(false);
  });

  it('kwota nieujemna dopuszcza zero', () => {
    expect(NonNegativeAmountMinorSchema.safeParse(0).success).toBe(true);
    expect(NonNegativeAmountMinorSchema.safeParse(-1).success).toBe(false);
  });
});

describe('BpsSchema / SignedBpsSchema', () => {
  it('plan jest nieujemny', () => {
    expect(BpsSchema.safeParse(0).success).toBe(true);
    expect(BpsSchema.safeParse(10_000).success).toBe(true);
    expect(BpsSchema.safeParse(100_000).success).toBe(true);
    expect(BpsSchema.safeParse(-1).success).toBe(false);
    expect(BpsSchema.safeParse(100_001).success).toBe(false);
    expect(BpsSchema.safeParse(1.5).success).toBe(false);
  });

  it('wykonanie liczone netto może być ujemne (ADR-011)', () => {
    expect(SignedBpsSchema.safeParse(-5000).success).toBe(true);
    expect(SignedBpsSchema.safeParse(-100_001).success).toBe(false);
  });
});

describe('DateOnlySchema', () => {
  it('przyjmuje istniejące daty', () => {
    expect(DateOnlySchema.safeParse('2026-09-18').success).toBe(true);
    expect(DateOnlySchema.safeParse('2024-02-29').success).toBe(true);
  });

  it('odrzuca daty nieistniejące, które przepuszcza Date.parse', () => {
    expect(DateOnlySchema.safeParse('2026-02-31').success).toBe(false);
    expect(DateOnlySchema.safeParse('2026-02-29').success).toBe(false);
    expect(DateOnlySchema.safeParse('2026-09-31').success).toBe(false);
  });

  it('odrzuca zły format', () => {
    expect(DateOnlySchema.safeParse('18.09.2026').success).toBe(false);
    expect(DateOnlySchema.safeParse('2026-9-18').success).toBe(false);
  });
});

describe('MonthKeySchema', () => {
  it('przyjmuje RRRR-MM z miesiącem 01–12', () => {
    expect(MonthKeySchema.safeParse('2026-09').success).toBe(true);
    expect(MonthKeySchema.safeParse('2026-13').success).toBe(false);
    expect(MonthKeySchema.safeParse('2026-00').success).toBe(false);
    expect(MonthKeySchema.safeParse('2026-09-01').success).toBe(false);
  });
});

describe('pozostałe prymitywy', () => {
  it('znacznik czasu jest nieujemną liczbą całkowitą', () => {
    expect(TimestampSchema.safeParse(1_789_689_600_000).success).toBe(true);
    expect(TimestampSchema.safeParse(-1).success).toBe(false);
    expect(TimestampSchema.safeParse(1.5).success).toBe(false);
  });

  it('waluta domyślnie PLN i zawsze trzyznakowa', () => {
    expect(CurrencySchema.parse(undefined)).toBe('PLN');
    expect(CurrencySchema.safeParse('EUR').success).toBe(true);
    expect(CurrencySchema.safeParse('PLNN').success).toBe(false);
  });

  it('kolor w zapisie #rrggbb', () => {
    expect(HexColorSchema.safeParse('#22c55e').success).toBe(true);
    expect(HexColorSchema.safeParse('#22C55E').success).toBe(true);
    expect(HexColorSchema.safeParse('#fff').success).toBe(false);
    expect(HexColorSchema.safeParse('22c55e').success).toBe(false);
  });

  it('dzień startu miesiąca mieści się w 1–28 i domyślnie wynosi 1', () => {
    // Ograniczenie do 28 gwarantuje, że dzień istnieje w każdym miesiącu.
    expect(MonthStartDaySchema.parse(undefined)).toBe(1);
    expect(MonthStartDaySchema.safeParse(28).success).toBe(true);
    expect(MonthStartDaySchema.safeParse(29).success).toBe(false);
    expect(MonthStartDaySchema.safeParse(0).success).toBe(false);
  });
});
