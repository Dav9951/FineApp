import { describe, expect, it } from 'vitest';

import {
  firstInstallmentMonth,
  firstInstallmentOn,
  installmentsFor,
  liabilitySchedule,
  liabilityState,
  MAX_SCHEDULE_LENGTH,
  nextInstallmentOn,
  type LiabilityTerms,
} from './liability.js';

/**
 * Testy stanu i harmonogramu zobowiązań
 * ([07 §5](../../../../plans/07-domain-rules.md#5-zobowiązania), ADR-047).
 */

/** Przykład z 04 §8: hipoteka 320 000 zł, rata 1 850 zł 10. dnia, stan na koniec sierpnia. */
const MORTGAGE: LiabilityTerms = {
  openingBalanceMinor: 32_000_000,
  balanceAsOf: '2026-08-31',
  monthlyPaymentMinor: 185_000,
  paymentDay: 10,
  firstPaymentOn: null,
};

describe('installmentsFor', () => {
  it('zaokrągla w górę: niepełna ostatnia rata to nadal rata', () => {
    expect(installmentsFor(250_000, 50_000)).toBe(5);
    expect(installmentsFor(250_001, 50_000)).toBe(6);
    expect(installmentsFor(1, 50_000)).toBe(1);
  });

  it('spłacone i nadpłacone — zero rat', () => {
    expect(installmentsFor(0, 50_000)).toBe(0);
    expect(installmentsFor(-100, 50_000)).toBe(0);
  });
});

describe('liabilityState', () => {
  it('przykład z 04 §8: 18 500 zł spłacone, 163 raty, zapłacone we wrześniu', () => {
    const state = liabilityState(
      MORTGAGE,
      { paidSinceAsOfMinor: 1_850_000, paidThisMonth: true },
      '2026-09-23',
    );
    expect(state).toEqual({
      remainingMinor: 30_150_000,
      paidSoFarMinor: 1_850_000,
      progressBps: 578,
      installmentsRemaining: 163,
      nextDueOn: '2026-10-10',
      projectedFinalPaymentOn: '2040-04-10',
    });
  });

  it('nadpłata: pozostało zero, nigdy ujemnie; spłacone to 100%', () => {
    const state = liabilityState(
      { ...MORTGAGE, openingBalanceMinor: 100_000 },
      { paidSinceAsOfMinor: 120_000, paidThisMonth: true },
      '2026-09-23',
    );
    expect(state).toMatchObject({
      remainingMinor: 0,
      paidSoFarMinor: 100_000,
      progressBps: 10_000,
      installmentsRemaining: 0,
      nextDueOn: null,
      projectedFinalPaymentOn: null,
    });
  });

  it('korekta do zera (podstawa zerowa) — spłacone, bez NaN', () => {
    const state = liabilityState(
      { ...MORTGAGE, openingBalanceMinor: 0 },
      { paidSinceAsOfMinor: 0, paidThisMonth: false },
      '2026-09-23',
    );
    expect(state.progressBps).toBe(10_000);
    expect(state.installmentsRemaining).toBe(0);
  });

  it('nic nie spłacone — 0%', () => {
    const state = liabilityState(
      MORTGAGE,
      { paidSinceAsOfMinor: 0, paidThisMonth: false },
      '2026-09-23',
    );
    expect(state.progressBps).toBe(0);
    // Rata z 10 września niezapłacona — najbliższa to ta zaległa, nie październikowa.
    expect(state.nextDueOn).toBe('2026-09-10');
  });

  it('dzień płatności nieznany — bez prognozy daty', () => {
    const state = liabilityState(
      { ...MORTGAGE, paymentDay: null },
      { paidSinceAsOfMinor: 0, paidThisMonth: false },
      '2026-09-23',
    );
    expect(state).toMatchObject({ nextDueOn: null, projectedFinalPaymentOn: null });
    expect(state.installmentsRemaining).toBe(173);
  });

  it('31. dnia: ostatnia rata w lutym przycięta, liczona od dnia płatności', () => {
    const state = liabilityState(
      {
        openingBalanceMinor: 150_000,
        balanceAsOf: '2026-11-30',
        monthlyPaymentMinor: 50_000,
        paymentDay: 31,
        firstPaymentOn: null,
      },
      { paidSinceAsOfMinor: 0, paidThisMonth: true },
      '2026-12-15',
    );
    expect(state.nextDueOn).toBe('2027-01-31');
    expect(state.projectedFinalPaymentOn).toBe('2027-03-31');
  });
});

describe('nextInstallmentOn', () => {
  it('pierwsza rata w przyszłości wygrywa', () => {
    expect(
      nextInstallmentOn({ ...MORTGAGE, firstPaymentOn: '2027-01-10' }, '2026-09-23', false),
    ).toBe('2027-01-10');
  });

  it('dzień płatności z pierwszej raty, gdy nie podano go wprost', () => {
    expect(
      nextInstallmentOn(
        { ...MORTGAGE, paymentDay: null, firstPaymentOn: '2026-05-20' },
        '2026-09-23',
        true,
      ),
    ).toBe('2026-10-20');
  });

  it('luty w roku przestępnym', () => {
    expect(nextInstallmentOn({ ...MORTGAGE, paymentDay: 30 }, '2028-02-01', false)).toBe(
      '2028-02-29',
    );
  });
});

describe('nextInstallmentOn — punkt odniesienia i wskazana rata (ADR-068)', () => {
  it('rata sprzed dnia „na dzień" jest już w kwocie — nie jest zaległa', () => {
    const today = { ...MORTGAGE, balanceAsOf: '2026-09-28' };
    expect(nextInstallmentOn(today, '2026-09-28', false)).toBe('2026-10-10');
    // Rata z dnia punktu odniesienia też jest w kwocie.
    expect(nextInstallmentOn({ ...today, paymentDay: 28 }, '2026-09-28', false)).toBe('2026-10-28');
  });

  it('rata po dniu „na dzień" w tym samym miesiącu — nadal ten miesiąc', () => {
    expect(
      nextInstallmentOn(
        { ...MORTGAGE, balanceAsOf: '2026-09-28', paymentDay: 30 },
        '2026-09-28',
        false,
      ),
    ).toBe('2026-09-30');
  });

  it('po miesiącu zaległość wraca: październikowa rata niezapłacona 15 października', () => {
    expect(nextInstallmentOn({ ...MORTGAGE, balanceAsOf: '2026-09-28' }, '2026-10-15', false)).toBe(
      '2026-10-10',
    );
  });

  it('spłata od listopada: we wrześniu i październiku najbliższa to listopadowa', () => {
    const later = { ...MORTGAGE, balanceAsOf: '2026-09-28', firstPaymentOn: '2026-11-10' };
    expect(nextInstallmentOn(later, '2026-09-28', false)).toBe('2026-11-10');
    expect(nextInstallmentOn(later, '2026-10-20', false)).toBe('2026-11-10');
    expect(nextInstallmentOn(later, '2026-11-15', true)).toBe('2026-12-10');
  });

  it('ratę z tego miesiąca już zapłacono — wskazana najbliższa rata wygrywa', () => {
    const paidEarly = {
      ...MORTGAGE,
      balanceAsOf: '2026-09-28',
      paymentDay: 30,
      firstPaymentOn: '2026-10-30',
    };
    expect(nextInstallmentOn(paidEarly, '2026-09-28', false)).toBe('2026-10-30');
  });
});

describe('firstInstallmentOn', () => {
  it('wskazana wprost wygrywa, także w dniu punktu odniesienia', () => {
    expect(
      firstInstallmentOn({ ...MORTGAGE, balanceAsOf: '2026-09-28', firstPaymentOn: '2026-09-28' }),
    ).toBe('2026-09-28');
  });

  it('bez dnia płatności i bez wskazanej raty — nieznana', () => {
    expect(firstInstallmentOn({ ...MORTGAGE, paymentDay: null })).toBeNull();
  });
});

describe('liabilitySchedule', () => {
  it('pełne raty i reszta w ostatniej', () => {
    const terms = { ...MORTGAGE, monthlyPaymentMinor: 50_000 };
    const schedule = liabilitySchedule(terms, {
      remainingMinor: 120_000,
      nextDueOn: '2026-12-10',
    });
    expect(schedule).toEqual([
      { number: 1, dueOn: '2026-12-10', amountMinor: 50_000, remainingAfterMinor: 70_000 },
      { number: 2, dueOn: '2027-01-10', amountMinor: 50_000, remainingAfterMinor: 20_000 },
      { number: 3, dueOn: '2027-02-10', amountMinor: 20_000, remainingAfterMinor: 0 },
    ]);
  });

  it('suma rat równa pozostałej kwocie', () => {
    const schedule = liabilitySchedule(MORTGAGE, {
      remainingMinor: 30_150_000,
      nextDueOn: '2026-10-10',
    });
    expect(schedule).toHaveLength(163);
    expect(schedule.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(30_150_000);
    expect(schedule.at(-1)?.dueOn).toBe('2040-04-10');
  });

  it('spłacone albo bez daty — pusto; absurdalnie długi — ucięty', () => {
    expect(liabilitySchedule(MORTGAGE, { remainingMinor: 0, nextDueOn: null })).toEqual([]);
    const long = liabilitySchedule(
      { ...MORTGAGE, monthlyPaymentMinor: 1 },
      { remainingMinor: 1_000_000, nextDueOn: '2026-10-10' },
    );
    expect(long).toHaveLength(MAX_SCHEDULE_LENGTH);
  });
});

describe('firstInstallmentMonth', () => {
  it('rata przed dniem punktu odniesienia — od następnego miesiąca', () => {
    expect(firstInstallmentMonth('2026-09-23', 10, null)).toBe('2026-10');
    expect(firstInstallmentMonth('2026-09-10', 10, null)).toBe('2026-10');
  });

  it('rata po dniu punktu odniesienia — jeszcze w tym miesiącu', () => {
    expect(firstInstallmentMonth('2026-09-23', 25, null)).toBe('2026-09');
  });

  it('31. we wrześniu to 30.; pierwsza rata później wygrywa', () => {
    expect(firstInstallmentMonth('2026-09-29', 31, null)).toBe('2026-09');
    expect(firstInstallmentMonth('2026-09-23', 10, '2027-01-10')).toBe('2027-01');
  });

  it('wskazana pierwsza rata wygrywa także wtedy, gdy wypada wcześniej niż wyliczona', () => {
    expect(firstInstallmentMonth('2026-09-23', 10, '2026-09-23')).toBe('2026-09');
  });
});
