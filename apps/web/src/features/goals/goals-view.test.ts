import { describe, expect, it } from 'vitest';

import { goalFixture } from '../../../test/goal-fixture.js';
import {
  deadlineWarning,
  goalIcon,
  goalMonthState,
  goalsOfKind,
  GOAL_PURPOSE_ICON,
  monthTotals,
  percentOneDecimal,
  percentWhole,
  projectionLine,
} from './goals-view.js';

/**
 * Testy reguł ekranu celów ([06 §3.5](../../../../../plans/06-ui-views.md#35-cele--goals)).
 */

describe('percentOneDecimal i percentWhole', () => {
  it('jedno miejsce po przecinku, polski przecinek, minus typograficzny', () => {
    expect(percentOneDecimal(1695)).toBe('17,0%');
    expect(percentOneDecimal(1250)).toBe('12,5%');
    expect(percentOneDecimal(-1271)).toBe('−12,7%');
    expect(percentOneDecimal(0)).toBe('0,0%');
  });

  it('procent paska bez miejsc po przecinku', () => {
    expect(percentWhole(3458)).toBe('35%');
    expect(percentWhole(15_000)).toBe('150%');
  });
});

describe('goalMonthState', () => {
  const plan = goalFixture().contribution;

  it('plan wykonany, częściowo, brak wpłaty', () => {
    expect(goalMonthState(plan)).toBe('met');
    expect(goalMonthState({ ...plan, contributedThisMonthMinor: 50_000 })).toBe('partial');
    expect(goalMonthState({ ...plan, contributedThisMonthMinor: 0 })).toBe('missing');
  });

  it('wypłata netto z celu — osobny stan, nie „brak wpłaty"', () => {
    expect(goalMonthState({ ...plan, contributedThisMonthMinor: -1 })).toBe('withdrawn');
  });

  it('bez planu albo z planem zerowym (brak wpływów) — bez ostrzeżenia', () => {
    const none = { ...plan, mode: 'none' as const, plannedAmountMinor: null };
    expect(goalMonthState({ ...none, contributedThisMonthMinor: 0 })).toBe('idle');
    expect(goalMonthState({ ...none, contributedThisMonthMinor: 100 })).toBe('free');
    expect(goalMonthState({ ...plan, plannedAmountMinor: 0, contributedThisMonthMinor: 0 })).toBe(
      'idle',
    );
  });
});

describe('projectionLine i deadlineWarning', () => {
  it('przykład z 04 §10: grudzień 2029, a na czerwiec 2028 potrzeba 3 714,29 zł', () => {
    const goal = goalFixture();
    expect(projectionLine(goal)).toEqual({ kind: 'pace', month: '2029-12' });
    expect(deadlineWarning(goal)).toEqual({ targetMonth: '2028-06', requiredMinor: 371_429 });
  });

  it('osiągnięty — bez ostrzeżeń', () => {
    const goal = goalFixture({ status: 'achieved', remainingMinor: 0 });
    expect(projectionLine(goal)).toEqual({ kind: 'achieved' });
    expect(deadlineWarning(goal)).toBeNull();
  });

  it('bez tempa — „nigdy"; bez kwoty docelowej — nic', () => {
    const base = goalFixture();
    const stalled = goalFixture({
      projection: { ...base.projection, projectedCompletionMonth: null },
    });
    expect(projectionLine(stalled)).toEqual({ kind: 'never' });
    expect(projectionLine(goalFixture({ remainingMinor: null }))).toEqual({ kind: 'none' });
  });

  it('w tempie albo bez terminu — bez ostrzeżenia', () => {
    const base = goalFixture();
    expect(
      deadlineWarning(goalFixture({ projection: { ...base.projection, isOnTrack: true } })),
    ).toBeNull();
    expect(deadlineWarning(goalFixture({ targetDate: null }))).toBeNull();
  });
});

describe('goalsOfKind i monthTotals', () => {
  it('rodzaj z zakładki; aktywne przed wstrzymanymi i osiągniętymi, priorytet zachowany', () => {
    const goals = [
      goalFixture({ id: 'a', status: 'achieved' }),
      goalFixture({ id: 'b' }),
      goalFixture({ id: 'c', kind: 'investment' }),
      goalFixture({ id: 'd', status: 'paused' }),
      goalFixture({ id: 'e' }),
    ];
    expect(goalsOfKind(goals, 'savings').map((goal) => goal.id)).toEqual(['b', 'e', 'd', 'a']);
    expect(goalsOfKind(goals, 'investment').map((goal) => goal.id)).toEqual(['c']);
  });

  it('„Zaplanowano · wpłacono" tylko z celów aktywnych', () => {
    const base = goalFixture();
    expect(
      monthTotals([
        base,
        goalFixture({
          contribution: {
            ...base.contribution,
            plannedAmountMinor: 118_000,
            contributedThisMonthMinor: 0,
          },
        }),
        goalFixture({ status: 'paused' }),
      ]),
    ).toEqual({ plannedMinor: 318_000, contributedMinor: 200_000 });
  });
});

describe('goalIcon', () => {
  it('z przeznaczenia albo tarcza celu', () => {
    expect(goalIcon({ purpose: 'car' })).toBe(GOAL_PURPOSE_ICON.car);
    expect(goalIcon({ purpose: null })).toBe(GOAL_PURPOSE_ICON.custom);
  });
});
