import { describe, expect, it } from 'vitest';

import {
  changeRepeat,
  followDate,
  repeatFromDate,
  repeatLabel,
  repeatPreview,
  toSaveAsRecurringRequest,
} from './repeat-state.js';
import { emptyTransactionForm } from './transaction-form-state.js';

/**
 * Testy „Zapisz jako wydatek stały" w formularzu transakcji (`F4-8`, ADR-051).
 */

/** Czynsz zapłacony 10 września 2026 (czwartek). */
const RENT = {
  ...emptyTransactionForm('expense', '2026-09-10', '01J9ZQK8WQ0000000000000000'),
  amountMinor: 185_000,
  description: 'Czynsz',
};

describe('repeatFromDate i followDate', () => {
  it('co miesiąc, dnia transakcji', () => {
    expect(repeatFromDate('2026-09-10')).toEqual({
      frequency: 'monthly',
      intervalText: '2',
      dayOfMonthText: '10',
      weekday: 4,
      monthOfYear: 9,
      followsDate: true,
    });
  });

  it('zmiana daty przesuwa terminarz, dopóki użytkownik go nie ruszył', () => {
    const weekly = changeRepeat(repeatFromDate('2026-09-10'), { frequency: 'weekly' });
    expect(weekly.followsDate).toBe(true);
    expect(followDate(weekly, '2026-09-14')).toMatchObject({
      frequency: 'weekly',
      weekday: 1,
      dayOfMonthText: '14',
    });

    const fixedDay = changeRepeat(repeatFromDate('2026-09-10'), { dayOfMonthText: '1' });
    expect(fixedDay.followsDate).toBe(false);
    expect(followDate(fixedDay, '2026-09-14')).toBe(fixedDay);
    expect(followDate(null, '2026-09-14')).toBeNull();
  });
});

describe('toSaveAsRecurringRequest', () => {
  it('tylko pola używane przez częstotliwość', () => {
    expect(toSaveAsRecurringRequest(repeatFromDate('2026-09-10'))).toEqual({
      ok: true,
      body: {
        frequency: 'monthly',
        intervalCount: 1,
        dayOfMonth: 10,
        weekday: null,
        monthOfYear: null,
      },
    });
  });

  it('błędny dzień — błąd pod polem', () => {
    const result = toSaveAsRecurringRequest(
      changeRepeat(repeatFromDate('2026-09-10'), { dayOfMonthText: '32' }),
    );
    expect(result).toEqual({ ok: false, errors: { dayOfMonthText: 'Dzień miesiąca od 1 do 31' } });
  });
});

describe('repeatPreview', () => {
  it('co miesiąc — od następnego miesiąca: wrześniowy opłaca ta transakcja', () => {
    expect(repeatPreview(RENT, repeatFromDate(RENT.bookedOn), 1)).toEqual([
      '2026-10-10',
      '2026-11-10',
      '2026-12-10',
    ]);
  });

  it('co tydzień — kolejne tygodnie po transakcji', () => {
    const weekly = changeRepeat(repeatFromDate(RENT.bookedOn), { frequency: 'weekly' });
    expect(repeatPreview(RENT, weekly, 1, 2)).toEqual(['2026-09-17', '2026-09-24']);
  });

  it('niepoprawny terminarz — brak podglądu', () => {
    const broken = changeRepeat(repeatFromDate(RENT.bookedOn), { dayOfMonthText: '' });
    expect(repeatPreview(RENT, broken, 1)).toEqual([]);
  });
});

describe('repeatLabel', () => {
  it('słowo z wymagania #3 przy wydatku', () => {
    expect(repeatLabel('expense')).toBe('Zapisz jako wydatek stały');
    expect(repeatLabel('income')).toBe('Zapisz jako stały przychód');
  });
});
