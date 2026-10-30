import { describe, expect, it } from 'vitest';

import {
  GOAL_PROJECTION_LIMIT_MONTHS,
  goalIssues,
  goalPace,
  goalProgress,
  goalTransferSign,
  normalizeGoalPlan,
  plannedContribution,
  projectGoal,
} from './goal.js';

/**
 * Testy postępu, planu i prognozy celu
 * ([07 §3](../../../../plans/07-domain-rules.md#3-przelicznik-kwoty-i-procentu),
 * [§4](../../../../plans/07-domain-rules.md#4-cele), ADR-052).
 */

describe('plannedContribution', () => {
  it('stała kwota: 2 000 zł z podstawy 11 800 zł to 16,95% (04 §10)', () => {
    expect(
      plannedContribution(
        {
          contributionMode: 'fixed',
          contributionAmountMinor: 200_000,
          contributionPercentBps: null,
        },
        1_180_000,
      ),
    ).toEqual({ plannedAmountMinor: 200_000, plannedPercentBps: 1695 });
  });

  it('procent wpływów: 20% z 11 800 zł to 2 360 zł', () => {
    expect(
      plannedContribution(
        {
          contributionMode: 'percent_of_income',
          contributionAmountMinor: null,
          contributionPercentBps: 2000,
        },
        1_180_000,
      ),
    ).toEqual({ plannedAmountMinor: 236_000, plannedPercentBps: 2000 });
  });

  it('zerowa podstawa: procent kwoty 0, kwota z procentu 0 — nigdy NaN', () => {
    expect(
      plannedContribution(
        {
          contributionMode: 'fixed',
          contributionAmountMinor: 200_000,
          contributionPercentBps: null,
        },
        0,
      ),
    ).toEqual({ plannedAmountMinor: 200_000, plannedPercentBps: 0 });
    expect(
      plannedContribution(
        {
          contributionMode: 'percent_of_income',
          contributionAmountMinor: null,
          contributionPercentBps: 1000,
        },
        0,
      ),
    ).toEqual({ plannedAmountMinor: 0, plannedPercentBps: 1000 });
  });

  it('procent ponad 1000% przycinany do granicy kontraktu', () => {
    expect(
      plannedContribution(
        {
          contributionMode: 'fixed',
          contributionAmountMinor: 200_000,
          contributionPercentBps: null,
        },
        100,
      ).plannedPercentBps,
    ).toBe(100_000);
  });

  it('tryb none — brak planu', () => {
    expect(
      plannedContribution(
        { contributionMode: 'none', contributionAmountMinor: 5, contributionPercentBps: 5 },
        1_000,
      ),
    ).toEqual({ plannedAmountMinor: null, plannedPercentBps: null });
  });
});

describe('normalizeGoalPlan', () => {
  it('zostawia wyłącznie pole trybu — druga strona przelicznika nie jest zapisywana', () => {
    const both = { contributionAmountMinor: 200_000, contributionPercentBps: 1695 };
    expect(normalizeGoalPlan({ contributionMode: 'fixed', ...both })).toEqual({
      contributionMode: 'fixed',
      contributionAmountMinor: 200_000,
      contributionPercentBps: null,
    });
    expect(normalizeGoalPlan({ contributionMode: 'percent_of_income', ...both })).toEqual({
      contributionMode: 'percent_of_income',
      contributionAmountMinor: null,
      contributionPercentBps: 1695,
    });
    expect(normalizeGoalPlan({ contributionMode: 'none', ...both })).toEqual({
      contributionMode: 'none',
      contributionAmountMinor: null,
      contributionPercentBps: null,
    });
  });
});

describe('goalIssues (I-14)', () => {
  const base = { progressSource: 'contributions' as const };

  it('tryb kwotowy wymaga kwoty, procentowy — procentu', () => {
    expect(goalIssues({ ...base, contributionMode: 'fixed' })).toEqual([
      { path: 'contributionAmountMinor', message: 'Podaj kwotę miesięcznej wpłaty' },
    ]);
    expect(goalIssues({ ...base, contributionMode: 'percent_of_income' })).toEqual([
      { path: 'contributionPercentBps', message: 'Podaj procent wpływów' },
    ]);
    expect(goalIssues({ ...base, contributionMode: 'none' })).toEqual([]);
  });

  it('procent: większy od zera i najwyżej 100% wpływów', () => {
    const issue = (bps: number) =>
      goalIssues({ ...base, contributionMode: 'percent_of_income', contributionPercentBps: bps });
    expect(issue(0)[0]?.message).toBe('Procent musi być większy od zera');
    expect(issue(10_001)[0]?.message).toBe('Wpłata nie może przekraczać 100% wpływów');
    expect(issue(10_000)).toEqual([]);
  });

  it('śledzenie po saldzie wymaga konta', () => {
    expect(
      goalIssues({ contributionMode: 'none', progressSource: 'account_balance' }).map(
        (i) => i.path,
      ),
    ).toEqual(['linkedAccountId']);
    expect(
      goalIssues({
        contributionMode: 'none',
        progressSource: 'account_balance',
        linkedAccountId: 'A',
      }),
    ).toEqual([]);
  });
});

describe('goalTransferSign', () => {
  const noLink = { kind: 'savings' as const, linkedAccountId: null };
  const transfer = (source: 'spending' | 'savings' | 'investment', target: typeof source) => ({
    accountId: 'SRC',
    counterAccountId: 'DST',
    sourceAllocationClass: source,
    targetAllocationClass: target,
  });

  it('z konta bieżącego na oszczędnościowe — wpłata', () => {
    expect(goalTransferSign(noLink, transfer('spending', 'savings'))).toBe(1);
  });

  it('z oszczędnościowego na bieżące — wypłata z celu (netto, ADR-011)', () => {
    expect(goalTransferSign(noLink, transfer('savings', 'spending'))).toBe(-1);
  });

  it('między dwoma kontami klasy celu — wpłata (dla rozkładu neutralny, dla celu nie)', () => {
    expect(goalTransferSign(noLink, transfer('savings', 'savings'))).toBe(1);
  });

  it('cel inwestycyjny: z maklerskiego na oszczędnościowe — wypłata', () => {
    expect(
      goalTransferSign(
        { kind: 'investment', linkedAccountId: null },
        transfer('investment', 'savings'),
      ),
    ).toBe(-1);
  });

  it('powiązane konto rozstrzyga kierunek przed klasami', () => {
    const linked = { kind: 'savings' as const, linkedAccountId: 'SRC' };
    expect(goalTransferSign(linked, transfer('spending', 'savings'))).toBe(-1);
    expect(
      goalTransferSign({ ...linked, linkedAccountId: 'DST' }, transfer('savings', 'spending')),
    ).toBe(1);
    // Przelew nie dotyczy konta celu — decydują klasy.
    expect(
      goalTransferSign({ ...linked, linkedAccountId: 'OTHER' }, transfer('savings', 'spending')),
    ).toBe(-1);
  });
});

describe('goalProgress', () => {
  it('przykład z 04 §10: 42 000 z 120 000 zł to 35%, brakuje 78 000 zł', () => {
    expect(goalProgress(4_200_000, 12_000_000)).toEqual({
      currentAmountMinor: 4_200_000,
      progressBps: 3500,
      remainingMinor: 7_800_000,
    });
  });

  it('cel bez kwoty docelowej — bez procentu i reszty', () => {
    expect(goalProgress(500, null)).toEqual({
      currentAmountMinor: 500,
      progressBps: null,
      remainingMinor: null,
    });
  });

  it('wypłaty ponad wpłaty nie dają ujemnej kwoty na celu', () => {
    expect(goalProgress(-3_000, 10_000)).toEqual({
      currentAmountMinor: 0,
      progressBps: 0,
      remainingMinor: 10_000,
    });
  });

  it('nadwyżka: ponad 100%, reszta zero', () => {
    expect(goalProgress(15_000, 10_000)).toEqual({
      currentAmountMinor: 15_000,
      progressBps: 15_000,
      remainingMinor: 0,
    });
  });
});

describe('goalPace', () => {
  it('średnia z miesięcy z wpłatą — przerwa nie zaniża tempa', () => {
    expect(goalPace([200_000, 0, 0, 100_000, 0, 300_000], 50_000)).toBe(200_000);
  });

  it('mniej niż dwa miesiące z wpłatą — tempem jest plan', () => {
    expect(goalPace([0, 0, 500_000], 200_000)).toBe(200_000);
    expect(goalPace([], null)).toBeNull();
  });

  it('wypłata netto obniża tempo; zaokrąglenie połówek od zera', () => {
    expect(goalPace([300, -100], null)).toBe(100);
    expect(goalPace([1, 2], null)).toBe(2);
  });
});

describe('projectGoal', () => {
  it('przykład z 04 §10: 2 000 zł/mies., brakuje 78 000 → 39 mies., grudzień 2029', () => {
    expect(projectGoal(7_800_000, '2028-06-30', 200_000, '2026-09')).toEqual({
      paceMonthlyMinor: 200_000,
      monthsToTargetAtCurrentPace: 39,
      projectedCompletionMonth: '2029-12',
      requiredMonthlyToHitTargetDateMinor: 371_429,
      isOnTrack: false,
    });
  });

  it('tempo wystarcza — na czas', () => {
    expect(projectGoal(1_000_000, '2027-09-30', 100_000, '2026-09').isOnTrack).toBe(true);
  });

  it('bez terminu — bez wymaganej wpłaty i oceny', () => {
    const result = projectGoal(1_000_000, null, 100_000, '2026-09');
    expect(result.requiredMonthlyToHitTargetDateMinor).toBeNull();
    expect(result.isOnTrack).toBeNull();
    expect(result.monthsToTargetAtCurrentPace).toBe(10);
  });

  it('bez tempa — bez prognozy daty; niepełny ostatni miesiąc się liczy', () => {
    expect(projectGoal(1_000, null, null, '2026-09').monthsToTargetAtCurrentPace).toBeNull();
    expect(projectGoal(1_000, null, 0, '2026-09').monthsToTargetAtCurrentPace).toBeNull();
    expect(projectGoal(1_001, null, 500, '2026-09').monthsToTargetAtCurrentPace).toBe(3);
  });

  it('termin w tym miesiącu albo miniony — cała reszta teraz', () => {
    expect(
      projectGoal(90_000, '2026-09-30', 10_000, '2026-09').requiredMonthlyToHitTargetDateMinor,
    ).toBe(90_000);
    expect(
      projectGoal(90_000, '2025-01-31', 10_000, '2026-09').requiredMonthlyToHitTargetDateMinor,
    ).toBe(90_000);
  });

  it('cel osiągnięty — zero miesięcy, na czas', () => {
    expect(projectGoal(0, '2028-06-30', null, '2026-09')).toEqual({
      paceMonthlyMinor: null,
      monthsToTargetAtCurrentPace: 0,
      projectedCompletionMonth: '2026-09',
      requiredMonthlyToHitTargetDateMinor: 0,
      isOnTrack: true,
    });
  });

  it('prognoza ponad sto lat — „nigdy", bez daty spoza zakresu klucza miesiąca', () => {
    const result = projectGoal(GOAL_PROJECTION_LIMIT_MONTHS + 1, null, 1, '2026-09');
    expect(result.monthsToTargetAtCurrentPace).toBeNull();
    expect(result.projectedCompletionMonth).toBeNull();
  });

  it('cel bez kwoty docelowej — wszystko null poza tempem', () => {
    expect(projectGoal(null, '2028-06-30', 100, '2026-09')).toEqual({
      paceMonthlyMinor: 100,
      monthsToTargetAtCurrentPace: null,
      projectedCompletionMonth: null,
      requiredMonthlyToHitTargetDateMinor: null,
      isOnTrack: null,
    });
  });
});
