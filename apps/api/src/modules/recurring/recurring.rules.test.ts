import type { RecurringSchedule } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  generationWindow,
  isOncePerMonth,
  isOverdue,
  missingDueDates,
  occurrenceTotals,
  scheduleChanged,
  type OccurrenceAmounts,
} from './recurring.rules.js';

/**
 * Testy czystych reguł wystąpień cyklicznych
 * ([07 §6.2–§6.6](../../../../../../plans/07-domain-rules.md#62-generowanie-wystąpień),
 * ADR-045).
 */

/** Czynsz 10. dnia każdego miesiąca od sierpnia 2026. */
const MONTHLY: RecurringSchedule = {
  frequency: 'monthly',
  intervalCount: 1,
  dayOfMonth: 10,
  weekday: null,
  monthOfYear: null,
  anchorDate: '2026-08-01',
  startMonth: '2026-08',
  endMonth: null,
};

/** Trening w każdy poniedziałek. */
const WEEKLY: RecurringSchedule = {
  ...MONTHLY,
  frequency: 'weekly',
  dayOfMonth: null,
  weekday: 1,
};

describe('generationWindow', () => {
  it('limit 1: od poprzedniego do bieżącego miesiąca', () => {
    expect(generationWindow('2026-09-23', 1)).toEqual({
      fromMonth: '2026-08',
      currentMonth: '2026-09',
      months: ['2026-08', '2026-09'],
    });
  });

  it('limit 0: tylko bieżący miesiąc', () => {
    expect(generationWindow('2026-09-01', 0).months).toEqual(['2026-09']);
  });

  it('przez granicę roku', () => {
    expect(generationWindow('2027-01-15', 2).months).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('isOncePerMonth', () => {
  it('częstotliwości miesięczne — tak, tygodniowe — nie', () => {
    const monthBased = ['monthly', 'every_n_months', 'quarterly', 'yearly'] as const;
    expect(monthBased.every((frequency) => isOncePerMonth(frequency))).toBe(true);
    expect(isOncePerMonth('weekly')).toBe(false);
    expect(isOncePerMonth('biweekly')).toBe(false);
  });
});

describe('missingDueDates', () => {
  it('pusta baza: jeden termin w każdym miesiącu okna', () => {
    expect(missingDueDates(MONTHLY, ['2026-08', '2026-09'], [])).toEqual([
      { dueOn: '2026-08-10', monthKey: '2026-08' },
      { dueOn: '2026-09-10', monthKey: '2026-09' },
    ]);
  });

  it('istniejący termin nie jest generowany drugi raz — idempotencja', () => {
    const existing = [{ dueOn: '2026-08-10', monthKey: '2026-08' }];
    expect(missingDueDates(MONTHLY, ['2026-08', '2026-09'], existing)).toEqual([
      { dueOn: '2026-09-10', monthKey: '2026-09' },
    ]);
  });

  it('31. dnia: luty zwykły 28, luty przestępny 29, kwiecień 30 — nigdy następny miesiąc', () => {
    const last = { ...MONTHLY, dayOfMonth: 31, startMonth: '2027-01' };
    expect(missingDueDates(last, ['2027-02', '2027-04'], [])).toEqual([
      { dueOn: '2027-02-28', monthKey: '2027-02' },
      { dueOn: '2027-04-30', monthKey: '2027-04' },
    ]);
    expect(missingDueDates({ ...last, startMonth: '2028-01' }, ['2028-02'], [])).toEqual([
      { dueOn: '2028-02-29', monthKey: '2028-02' },
    ]);
  });

  it('29. i 30. w lutym też przycinane do ostatniego dnia', () => {
    for (const day of [29, 30]) {
      const rule = { ...MONTHLY, dayOfMonth: day, startMonth: '2027-01' };
      expect(missingDueDates(rule, ['2027-02'], [])).toEqual([
        { dueOn: '2027-02-28', monthKey: '2027-02' },
      ]);
    }
  });

  it('reguła miesięczna z wystąpieniem w innym dniu miesiąca — miesiąc pominięty', () => {
    // Czynsz zapłacony 10., reguła przestawiona na 15. — drugiego czynszu we wrześniu nie ma.
    const moved = { ...MONTHLY, dayOfMonth: 15 };
    const existing = [{ dueOn: '2026-09-10', monthKey: '2026-09' }];
    expect(missingDueDates(moved, ['2026-09', '2026-10'], existing)).toEqual([
      { dueOn: '2026-10-15', monthKey: '2026-10' },
    ]);
  });

  it('reguła tygodniowa: brakujące poniedziałki obok istniejących', () => {
    const existing = [{ dueOn: '2026-09-07', monthKey: '2026-09' }];
    expect(missingDueDates(WEEKLY, ['2026-09'], existing).map((due) => due.dueOn)).toEqual([
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
    ]);
  });

  it('poza okresem reguły — nic', () => {
    expect(missingDueDates({ ...MONTHLY, startMonth: '2026-10' }, ['2026-09'], [])).toEqual([]);
    expect(missingDueDates({ ...MONTHLY, endMonth: '2026-08' }, ['2026-09'], [])).toEqual([]);
  });
});

describe('scheduleChanged', () => {
  it('wykrywa zmianę każdego pola terminarza', () => {
    expect(scheduleChanged(MONTHLY, { ...MONTHLY })).toBe(false);
    expect(scheduleChanged(MONTHLY, { ...MONTHLY, dayOfMonth: 15 })).toBe(true);
    expect(scheduleChanged(MONTHLY, { ...MONTHLY, endMonth: '2026-12' })).toBe(true);
    expect(scheduleChanged(MONTHLY, { ...MONTHLY, startMonth: '2026-09' })).toBe(true);
    expect(scheduleChanged(MONTHLY, WEEKLY)).toBe(true);
  });
});

describe('isOverdue', () => {
  it('czekające po terminie — tak; w dniu terminu — nie', () => {
    expect(isOverdue('planned', '2026-09-10', '2026-09-11')).toBe(true);
    expect(isOverdue('planned', '2026-09-10', '2026-09-10')).toBe(false);
  });

  it('zaksięgowane i pominięte nigdy nie są zaległe', () => {
    expect(isOverdue('posted', '2026-08-10', '2026-09-11')).toBe(false);
    expect(isOverdue('skipped', '2026-08-10', '2026-09-11')).toBe(false);
  });
});

describe('occurrenceTotals', () => {
  it('przykład z 04 §9: plan, wykonanie, zostało', () => {
    const items: OccurrenceAmounts[] = [
      {
        flow: 'expense',
        status: 'posted',
        plannedAmountMinor: 185_000,
        postedAmountMinor: 185_000,
      },
      {
        flow: 'expense',
        status: 'posted',
        plannedAmountMinor: 260_000,
        postedAmountMinor: 260_000,
      },
      { flow: 'transfer', status: 'planned', plannedAmountMinor: 200_000, postedAmountMinor: null },
    ];
    expect(occurrenceTotals(items)).toEqual({
      plannedTotalMinor: 645_000,
      postedTotalMinor: 445_000,
      remainingTotalMinor: 200_000,
      byFlow: {
        expense: { plannedMinor: 445_000, postedMinor: 445_000 },
        transfer: { plannedMinor: 200_000, postedMinor: 0 },
        income: { plannedMinor: 0, postedMinor: 0 },
      },
    });
  });

  it('pominięte poza planem; kwota zaksięgowana inna niż planowana', () => {
    const items: OccurrenceAmounts[] = [
      { flow: 'expense', status: 'posted', plannedAmountMinor: 28_000, postedAmountMinor: 31_200 },
      { flow: 'expense', status: 'skipped', plannedAmountMinor: 12_000, postedAmountMinor: null },
    ];
    expect(occurrenceTotals(items)).toMatchObject({
      plannedTotalMinor: 28_000,
      postedTotalMinor: 31_200,
      remainingTotalMinor: 0,
    });
  });

  it('pusta lista — zera, nie NaN', () => {
    expect(occurrenceTotals([])).toMatchObject({
      plannedTotalMinor: 0,
      postedTotalMinor: 0,
      remainingTotalMinor: 0,
    });
  });
});
