import { describe, expect, it } from 'vitest';

import {
  defaultAnchorDate,
  dueDatesAfterSource,
  normalizeSchedule,
  occurrenceDatesForMonth,
  recurringRuleShapeIssues,
  recurringScheduleIssues,
  sourcePaymentDueOn,
  upcomingDueDates,
  weekdayOf,
  type RecurringRuleShape,
  type RecurringSchedule,
} from './recurring.js';

/**
 * Testy terminów pozycji cyklicznych
 * ([07 §6.1](../../../../plans/07-domain-rules.md#61-wyznaczanie-terminów)).
 */

/** Czynsz 10. dnia każdego miesiąca od stycznia 2026. */
const MONTHLY: RecurringSchedule = {
  frequency: 'monthly',
  intervalCount: 1,
  dayOfMonth: 10,
  weekday: null,
  monthOfYear: null,
  anchorDate: '2026-01-01',
  startMonth: '2026-01',
  endMonth: null,
};

/**
 * Terminarz z nadpisanymi polami.
 *
 * @param overrides - Nadpisane pola.
 * @returns Terminarz.
 */
function rule(overrides: Partial<RecurringSchedule>): RecurringSchedule {
  return { ...MONTHLY, ...overrides };
}

describe('occurrenceDatesForMonth — co miesiąc', () => {
  it('dzień miesiąca w każdym miesiącu', () => {
    expect(occurrenceDatesForMonth(MONTHLY, '2026-09')).toEqual(['2026-09-10']);
  });

  it('31. przycinany do końca miesiąca, nigdy przenoszony dalej', () => {
    const last = rule({ dayOfMonth: 31 });
    expect(occurrenceDatesForMonth(last, '2026-04')).toEqual(['2026-04-30']);
    expect(occurrenceDatesForMonth(last, '2026-02')).toEqual(['2026-02-28']);
    expect(occurrenceDatesForMonth(last, '2028-02')).toEqual(['2028-02-29']);
    expect(occurrenceDatesForMonth(last, '2026-05')).toEqual(['2026-05-31']);
  });

  it('29. i 30. w lutym zwykłym i przestępnym', () => {
    expect(occurrenceDatesForMonth(rule({ dayOfMonth: 29 }), '2027-02')).toEqual(['2027-02-28']);
    expect(occurrenceDatesForMonth(rule({ dayOfMonth: 30 }), '2028-02')).toEqual(['2028-02-29']);
  });

  it('poza zakresem startu i końca — brak terminów, krańce włącznie', () => {
    const bounded = rule({ startMonth: '2026-03', endMonth: '2026-06' });
    expect(occurrenceDatesForMonth(bounded, '2026-02')).toEqual([]);
    expect(occurrenceDatesForMonth(bounded, '2026-03')).toEqual(['2026-03-10']);
    expect(occurrenceDatesForMonth(bounded, '2026-06')).toEqual(['2026-06-10']);
    expect(occurrenceDatesForMonth(bounded, '2026-07')).toEqual([]);
  });
});

describe('occurrenceDatesForMonth — co N miesięcy, kwartalnie, rocznie', () => {
  it('co 2 miesiące licząc od miesiąca startu, także przez granicę roku', () => {
    const everyTwo = rule({ frequency: 'every_n_months', intervalCount: 2, startMonth: '2026-11' });
    expect(occurrenceDatesForMonth(everyTwo, '2026-11')).toEqual(['2026-11-10']);
    expect(occurrenceDatesForMonth(everyTwo, '2026-12')).toEqual([]);
    expect(occurrenceDatesForMonth(everyTwo, '2027-01')).toEqual(['2027-01-10']);
  });

  it('kwartalnie od startu', () => {
    const quarterly = rule({ frequency: 'quarterly', startMonth: '2026-02' });
    expect(
      ['2026-02', '2026-03', '2026-04', '2026-05'].map(
        (m) => occurrenceDatesForMonth(quarterly, m).length,
      ),
    ).toEqual([1, 0, 0, 1]);
  });

  it('rocznie tylko w swoim miesiącu, z przycięciem dnia', () => {
    const yearly = rule({ frequency: 'yearly', monthOfYear: 2, dayOfMonth: 29 });
    expect(occurrenceDatesForMonth(yearly, '2027-02')).toEqual(['2027-02-28']);
    expect(occurrenceDatesForMonth(yearly, '2028-02')).toEqual(['2028-02-29']);
    expect(occurrenceDatesForMonth(yearly, '2028-03')).toEqual([]);
  });
});

describe('occurrenceDatesForMonth — tygodniowo', () => {
  it('każdy piątek miesiąca — cztery albo pięć', () => {
    const fridays = rule({ frequency: 'weekly', weekday: 5, dayOfMonth: null });
    expect(occurrenceDatesForMonth(fridays, '2026-10')).toEqual([
      '2026-10-02',
      '2026-10-09',
      '2026-10-16',
      '2026-10-23',
      '2026-10-30',
    ]);
    expect(occurrenceDatesForMonth(fridays, '2026-09')).toHaveLength(4);
  });

  it('co dwa tygodnie od kotwicy, przez granicę miesiąca i zmianę czasu', () => {
    const biweekly = rule({
      frequency: 'biweekly',
      weekday: 5,
      dayOfMonth: null,
      anchorDate: '2026-10-09',
      startMonth: '2026-10',
    });
    expect(occurrenceDatesForMonth(biweekly, '2026-10')).toEqual(['2026-10-09', '2026-10-23']);
    // 25 października — zmiana czasu; odstęp nadal 14 dni.
    expect(occurrenceDatesForMonth(biweekly, '2026-11')).toEqual(['2026-11-06', '2026-11-20']);
  });
});

describe('upcomingDueDates', () => {
  it('od dziś włącznie, przez kolejne miesiące', () => {
    expect(upcomingDueDates(MONTHLY, '2026-09-10', 3)).toEqual([
      '2026-09-10',
      '2026-10-10',
      '2026-11-10',
    ]);
    expect(upcomingDueDates(MONTHLY, '2026-09-11', 1)).toEqual(['2026-10-10']);
  });

  it('reguła, która dopiero się zacznie, i reguła zakończona', () => {
    expect(upcomingDueDates(rule({ startMonth: '2027-01' }), '2026-09-23', 1)).toEqual([
      '2027-01-10',
    ]);
    expect(upcomingDueDates(rule({ endMonth: '2026-08' }), '2026-09-01', 3)).toEqual([]);
  });

  it('roczna — termin w ciągu roku', () => {
    const yearly = rule({ frequency: 'yearly', monthOfYear: 3, dayOfMonth: 14 });
    expect(upcomingDueDates(yearly, '2026-09-23', 2)).toEqual(['2027-03-14', '2028-03-14']);
  });
});

describe('defaultAnchorDate', () => {
  it('co dwa tygodnie — pierwszy wybrany dzień tygodnia miesiąca startu', () => {
    const anchor = defaultAnchorDate({ frequency: 'biweekly', weekday: 5, startMonth: '2026-10' });
    expect(anchor).toBe('2026-10-02');
    expect(weekdayOf(anchor)).toBe(5);
  });

  it('pozostałe — pierwszy dzień miesiąca startu', () => {
    expect(defaultAnchorDate({ frequency: 'monthly', weekday: null, startMonth: '2026-10' })).toBe(
      '2026-10-01',
    );
  });
});

describe('normalizeSchedule', () => {
  it('czyści pola bez znaczenia dla częstotliwości', () => {
    expect(
      normalizeSchedule(
        rule({ frequency: 'weekly', weekday: 1, dayOfMonth: 10, intervalCount: 4 }),
      ),
    ).toMatchObject({ dayOfMonth: null, weekday: 1, monthOfYear: null, intervalCount: 1 });
    expect(normalizeSchedule(rule({ monthOfYear: 5, weekday: 3 }))).toMatchObject({
      dayOfMonth: 10,
      weekday: null,
      monthOfYear: null,
    });
  });
});

describe('recurringScheduleIssues', () => {
  it('wymagane pola każdej częstotliwości', () => {
    expect(recurringScheduleIssues(rule({ dayOfMonth: null })).map((i) => i.path)).toEqual([
      'dayOfMonth',
    ]);
    expect(
      recurringScheduleIssues(rule({ frequency: 'weekly', weekday: null })).map((i) => i.path),
    ).toEqual(['weekday']);
    expect(
      recurringScheduleIssues(rule({ frequency: 'yearly', monthOfYear: null })).map((i) => i.path),
    ).toEqual(['monthOfYear']);
    expect(
      recurringScheduleIssues(rule({ frequency: 'every_n_months', intervalCount: 1 })).map(
        (i) => i.path,
      ),
    ).toEqual(['intervalCount']);
  });

  it('koniec przed startem i kotwica niezgodna z dniem tygodnia', () => {
    expect(recurringScheduleIssues(rule({ endMonth: '2025-12' }))[0]?.path).toBe('endMonth');
    const biweekly = rule({ frequency: 'biweekly', weekday: 5, anchorDate: '2026-10-08' });
    expect(recurringScheduleIssues(biweekly)[0]?.path).toBe('anchorDate');
  });

  it('poprawny terminarz — brak problemów', () => {
    expect(recurringScheduleIssues(MONTHLY)).toEqual([]);
  });
});

describe('recurringRuleShapeIssues', () => {
  const EXPENSE: RecurringRuleShape = {
    ...MONTHLY,
    flow: 'expense',
    accountId: 'a',
    counterAccountId: null,
    incomeSourceId: null,
    liabilityId: null,
    allocationOverride: null,
  };

  it('te same niezmienniki co transakcja (I-2, I-3, I-7a) plus terminarz', () => {
    expect(recurringRuleShapeIssues(EXPENSE)).toEqual([]);
    expect(recurringRuleShapeIssues({ ...EXPENSE, flow: 'transfer' }).map((i) => i.path)).toEqual([
      'counterAccountId',
    ]);
    expect(
      recurringRuleShapeIssues({ ...EXPENSE, incomeSourceId: 's', dayOfMonth: null }).map(
        (i) => i.path,
      ),
    ).toEqual(['incomeSourceId', 'dayOfMonth']);
  });
});

describe('sourcePaymentDueOn i dueDatesAfterSource (ADR-051)', () => {
  /** Co środę od września 2026. */
  const WEDNESDAYS = rule({
    frequency: 'weekly',
    dayOfMonth: null,
    weekday: 3,
    startMonth: '2026-09',
  });

  it('co miesiąc: jedyny termin miesiąca, także gdy zapłacono przed nim', () => {
    expect(sourcePaymentDueOn(MONTHLY, '2026-09', '2026-09-08')).toBe('2026-09-10');
    expect(dueDatesAfterSource(MONTHLY, '2026-09', '2026-09-08', 3)).toEqual([
      '2026-10-10',
      '2026-11-10',
      '2026-12-10',
    ]);
  });

  it('co tydzień: najbliższy termin; przy remisie wcześniejszy', () => {
    expect(sourcePaymentDueOn(WEDNESDAYS, '2026-09', '2026-09-23')).toBe('2026-09-23');
    // Sobota 19.: środa 16. i 23. są o 3 i 4 dni — wygrywa 16.
    expect(sourcePaymentDueOn(WEDNESDAYS, '2026-09', '2026-09-19')).toBe('2026-09-16');
    // Niedziela 20.: 16. i 23. — o 4 i 3 dni.
    expect(sourcePaymentDueOn(WEDNESDAYS, '2026-09', '2026-09-20')).toBe('2026-09-23');
    expect(dueDatesAfterSource(WEDNESDAYS, '2026-09', '2026-09-23', 2)).toEqual([
      '2026-09-30',
      '2026-10-07',
    ]);
  });

  it('bez terminu w miesiącu transakcji — nic opłaconego, podgląd od najbliższego', () => {
    const yearly = rule({ frequency: 'yearly', monthOfYear: 3, startMonth: '2026-09' });
    expect(sourcePaymentDueOn(yearly, '2026-09', '2026-09-10')).toBeUndefined();
    expect(dueDatesAfterSource(yearly, '2026-09', '2026-09-10', 1)).toEqual(['2027-03-10']);
  });
});

describe('kalendarz — testy brzegowe F4-9', () => {
  it('co 2 tygodnie przez Nowy Rok i 29 lutego: dokładnie 14 dni, dzień przestępny liczony', () => {
    const biweekly = rule({
      frequency: 'biweekly',
      dayOfMonth: null,
      weekday: 5,
      anchorDate: '2027-12-24',
      startMonth: '2027-12',
    });
    expect(upcomingDueDates(biweekly, '2027-12-01', 7)).toEqual([
      '2027-12-24',
      '2028-01-07',
      '2028-01-21',
      '2028-02-04',
      '2028-02-18',
      // 18.02 + 14 dni przez 29.02 to 3 marca, nie 4.
      '2028-03-03',
      '2028-03-17',
    ]);
  });

  it('kwartalnie 31. dnia: przycięcie w lutym nie przesuwa kolejnych terminów', () => {
    const quarterly = rule({ frequency: 'quarterly', dayOfMonth: 31, startMonth: '2027-11' });
    expect(upcomingDueDates(quarterly, '2027-11-01', 4)).toEqual([
      '2027-11-30',
      '2028-02-29',
      '2028-05-31',
      '2028-08-31',
    ]);
  });

  it('co roku 29 lutego: w latach zwykłych 28., w przestępnych znowu 29.', () => {
    const leapDay = rule({
      frequency: 'yearly',
      dayOfMonth: 29,
      monthOfYear: 2,
      startMonth: '2028-01',
    });
    expect(upcomingDueDates(leapDay, '2028-01-01', 5)).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('30. dnia: luty 28/29, pozostałe miesiące bez przycięcia', () => {
    const thirtieth = rule({ dayOfMonth: 30, startMonth: '2027-12' });
    expect(upcomingDueDates(thirtieth, '2027-12-01', 4)).toEqual([
      '2027-12-30',
      '2028-01-30',
      '2028-02-29',
      '2028-03-30',
    ]);
    expect(occurrenceDatesForMonth(thirtieth, '2029-02')).toEqual(['2029-02-28']);
  });
});
