import { describe, expect, it } from 'vitest';

import { plannedFixture } from '../../../test/planned-fixture.js';
import {
  canSetAsideNow,
  coveragePercent,
  dueCaption,
  dueDistanceLabel,
  fundingState,
  groupByDueMonth,
  monthName,
  plannedSummary,
  warningAction,
} from './planned-view.js';

/**
 * Testy reguł ekranu planowanych wydatków
 * ([06 §3.10](../../../../../plans/06-ui-views.md#310-planowane-wydatki--planned)).
 */

describe('groupByDueMonth', () => {
  it('grupy po miesiącu terminu rosnąco, z sumą miesiąca', () => {
    const groups = groupByDueMonth([
      plannedFixture({ id: 'a', dueMonth: '2027-03', estimatedAmountMinor: 240_000 }),
      plannedFixture({ id: 'b', dueMonth: '2026-11', estimatedAmountMinor: 80_000 }),
      plannedFixture({ id: 'c', dueMonth: '2027-03', estimatedAmountMinor: 10_000 }),
    ]);
    expect(groups.map((group) => [group.month, group.totalMinor])).toEqual([
      ['2026-11', 80_000],
      ['2027-03', 250_000],
    ]);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('bez wydatków — bez grup', () => {
    expect(groupByDueMonth([])).toEqual([]);
  });
});

describe('podpisy terminu', () => {
  it('odległość słowami', () => {
    expect(dueDistanceLabel(-1)).toBe('po terminie');
    expect(dueDistanceLabel(0)).toBe('w tym miesiącu');
    expect(dueDistanceLabel(1)).toBe('za miesiąc');
    expect(dueDistanceLabel(6)).toBe('za 6 mies.');
  });

  it('dzień, gdy znany; zaległy — „po terminie" zamiast daty', () => {
    expect(dueCaption({ dueOn: '2027-03-14', monthsUntilDue: 6 })).toMatch(/^14 mar/u);
    expect(dueCaption({ dueOn: null, monthsUntilDue: 2 })).toBe('za 2 mies.');
    expect(dueCaption({ dueOn: '2026-08-14', monthsUntilDue: -1 })).toBe('po terminie');
  });

  it('nazwa miesiąca bez roku', () => {
    expect(monthName('2026-09')).toBe('wrzesień');
  });
});

describe('fundingState i canSetAsideNow', () => {
  it('pokryte w całości — nawet bez włączonego odkładania', () => {
    const base = plannedFixture();
    const covered = { ...base.setAside, enabled: false, coverageBps: 10_000, remainingMinor: 0 };
    expect(fundingState({ setAside: covered })).toBe('covered');
    expect(fundingState(base)).toBe('funding');
    expect(fundingState({ setAside: { ...base.setAside, enabled: false } })).toBe('off');
  });

  it('„Odłóż teraz" tylko przy włączonym odkładaniu, reszcie i braku wpłaty w miesiącu', () => {
    const base = plannedFixture();
    expect(canSetAsideNow(base)).toBe(true);
    expect(canSetAsideNow({ ...base, setAside: { ...base.setAside, paidThisMonth: true } })).toBe(
      false,
    );
    expect(canSetAsideNow({ ...base, setAside: { ...base.setAside, remainingMinor: 0 } })).toBe(
      false,
    );
    expect(canSetAsideNow({ ...base, setAside: { ...base.setAside, enabled: false } })).toBe(false);
    expect(canSetAsideNow({ ...base, status: 'posted' })).toBe(false);
  });
});

describe('plannedSummary', () => {
  it('pokrycie horyzontu w dół; bez wydatków — 0, nie NaN', () => {
    expect(
      plannedSummary({
        totalUpcomingMinor: 520_000,
        totalSetAsideMinor: 130_000,
        monthlySetAsideRequiredMinor: 64_500,
      }),
    ).toEqual({
      upcomingMinor: 520_000,
      setAsideMinor: 130_000,
      monthlyMinor: 64_500,
      coverageBps: 2500,
    });
    expect(
      plannedSummary({
        totalUpcomingMinor: 0,
        totalSetAsideMinor: 0,
        monthlySetAsideRequiredMinor: 0,
      }).coverageBps,
    ).toBe(0);
    expect(coveragePercent(9_999)).toBe('99%');
  });
});

describe('warningAction', () => {
  it('spóźnione — odłóż; konieczny bez planu — włącz; brak salda — nic', () => {
    expect(warningAction({ code: 'SET_ASIDE_BEHIND' })).toBe('set-aside');
    expect(warningAction({ code: 'UNFUNDED_MUST_EXPENSE' })).toBe('enable');
    expect(warningAction({ code: 'INSUFFICIENT_PROJECTED_BALANCE' })).toBeNull();
  });
});
