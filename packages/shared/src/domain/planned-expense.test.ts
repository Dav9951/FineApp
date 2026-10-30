import { describe, expect, it } from 'vitest';

import {
  derivedPlannedStatus,
  detectLiquidityWarnings,
  monthlySetAsideMinor,
  monthsLeftUntil,
  nextYearlyInstance,
  plannedExpenseIssues,
  setAsideState,
  type LiquidityExpense,
  type SetAsideInput,
} from './planned-expense.js';

/**
 * Testy planowanych wydatków
 * ([07 §6.5](../../../../plans/07-domain-rules.md#65-planowane-wydatki), ADR-055).
 */

/** OC 2 400 zł na marzec 2027, odkładane od października 2026. */
const OC: SetAsideInput = {
  estimatedAmountMinor: 240_000,
  setAsideEnabled: true,
  alreadySetAsideMinor: 0,
  contributedMinor: 80_000,
  paidThisMonth: false,
  setAsideStartMonth: '2026-10',
  dueMonth: '2027-03',
};

describe('plannedExpenseIssues', () => {
  it('I-16: data w miesiącu terminu', () => {
    expect(plannedExpenseIssues({ dueMonth: '2027-03', dueOn: '2027-04-01' })[0]?.path).toBe(
      'dueOn',
    );
    expect(plannedExpenseIssues({ dueMonth: '2027-03', dueOn: '2027-03-14' })).toEqual([]);
  });

  it('I-17: odkładanie wymaga konta albo celu', () => {
    expect(plannedExpenseIssues({ dueMonth: '2027-03', setAsideEnabled: true })[0]?.path).toBe(
      'setAsideAccountId',
    );
    expect(
      plannedExpenseIssues({ dueMonth: '2027-03', setAsideEnabled: true, setAsideGoalId: 'G' }),
    ).toEqual([]);
  });

  it('I-19: start odkładania nie po terminie', () => {
    expect(
      plannedExpenseIssues({ dueMonth: '2027-03', setAsideStartMonth: '2027-04' })[0]?.path,
    ).toBe('setAsideStartMonth');
    expect(plannedExpenseIssues({ dueMonth: '2027-03', setAsideStartMonth: '2027-03' })).toEqual(
      [],
    );
  });
});

describe('monthlySetAsideMinor i monthsLeftUntil', () => {
  it('zaokrąglenie w górę — lepiej grosz za dużo', () => {
    expect(monthlySetAsideMinor(160_000, 6)).toBe(26_667);
    expect(monthlySetAsideMinor(240_000, 6)).toBe(40_000);
    expect(monthlySetAsideMinor(0, 6)).toBe(0);
    expect(monthlySetAsideMinor(100, 0)).toBe(100);
  });

  it('miesiące do terminu z bieżącym; zaległy i bieżący — 1', () => {
    expect(monthsLeftUntil('2026-10', '2027-03')).toBe(6);
    expect(monthsLeftUntil('2026-10', '2026-10')).toBe(1);
    expect(monthsLeftUntil('2026-10', '2026-08')).toBe(1);
  });
});

describe('setAsideState', () => {
  it('przykład z 04 §9a: 800 z 2 400 zł, 26 667 gr miesięcznie przez 6 miesięcy', () => {
    expect(setAsideState(OC, '2026-10')).toEqual({
      accumulatedMinor: 80_000,
      remainingMinor: 160_000,
      coverageBps: 3333,
      monthlyRequiredMinor: 26_667,
      paidThisMonth: false,
      isOnTrack: true,
      expectedByNowMinor: 0,
    });
  });

  it('w tempie: oczekiwane z pełnych miesięcy od startu', () => {
    // Styczeń: trzy pełne miesiące z sześciu → 1 200 zł; zebrane 800 zł — spóźnione.
    const january = setAsideState(OC, '2027-01');
    expect(january.expectedByNowMinor).toBe(120_000);
    expect(january.isOnTrack).toBe(false);
    expect(january.monthlyRequiredMinor).toBe(53_334);
  });

  it('kwota zebrana poza aplikacją, nadwyżka, zaległy termin', () => {
    const full = setAsideState({ ...OC, alreadySetAsideMinor: 200_000 }, '2026-10');
    expect(full).toMatchObject({
      accumulatedMinor: 280_000,
      remainingMinor: 0,
      coverageBps: 11_667,
    });
    expect(setAsideState(OC, '2027-05').monthlyRequiredMinor).toBe(160_000);
  });

  it('bez odkładania zawsze w tempie; zero szacunku nie daje NaN', () => {
    expect(setAsideState({ ...OC, setAsideEnabled: false }, '2027-02').isOnTrack).toBe(true);
    expect(setAsideState({ ...OC, estimatedAmountMinor: 0 }, '2026-10').coverageBps).toBe(0);
  });
});

describe('derivedPlannedStatus', () => {
  const none = { accumulatedMinor: 0, coverageBps: 0 };
  it('planned → funding → ready; końcowe zostają', () => {
    expect(derivedPlannedStatus('planned', none, '2027-03', '2026-10')).toBe('planned');
    expect(
      derivedPlannedStatus(
        'planned',
        { accumulatedMinor: 1, coverageBps: 1 },
        '2027-03',
        '2026-10',
      ),
    ).toBe('funding');
    expect(
      derivedPlannedStatus(
        'funding',
        { accumulatedMinor: 9, coverageBps: 10_000 },
        '2027-03',
        '2026-10',
      ),
    ).toBe('ready');
    expect(derivedPlannedStatus('funding', none, '2026-10', '2026-10')).toBe('ready');
    expect(derivedPlannedStatus('deferred', none, '2027-03', '2026-10')).toBe('planned');
    expect(derivedPlannedStatus('posted', none, '2026-10', '2026-10')).toBe('posted');
    expect(derivedPlannedStatus('cancelled', none, '2026-10', '2026-10')).toBe('cancelled');
  });
});

describe('nextYearlyInstance', () => {
  it('kwota zapłacona, termin rok później, odkładanie od miesiąca po zapłacie', () => {
    expect(nextYearlyInstance('2027-03', '2027-03-14', 251_300, '2027-03')).toEqual({
      dueMonth: '2028-03',
      dueOn: '2028-03-14',
      estimatedAmountMinor: 251_300,
      setAsideStartMonth: '2027-04',
    });
  });

  it('29 lutego → 28 lutego, a w roku przestępnym zostaje', () => {
    expect(nextYearlyInstance('2028-02', '2028-02-29', 1, '2028-02').dueOn).toBe('2029-02-28');
    expect(nextYearlyInstance('2027-02', '2027-02-28', 1, '2027-02').dueOn).toBe('2028-02-28');
    expect(nextYearlyInstance('2031-02', '2031-02-29', 1, '2031-02').dueOn).toBe('2032-02-29');
    expect(nextYearlyInstance('2027-03', null, 1, '2027-03').dueOn).toBeNull();
  });

  it('zapłata z dużym opóźnieniem — start nie po nowym terminie (I-19)', () => {
    expect(nextYearlyInstance('2027-03', null, 1, '2028-05').setAsideStartMonth).toBe('2028-03');
  });
});

describe('detectLiquidityWarnings', () => {
  const expense = (overrides: Partial<LiquidityExpense> = {}): LiquidityExpense => ({
    id: 'OC',
    dueMonth: '2027-01',
    priority: 'should',
    setAsideEnabled: true,
    remainingMinor: 240_000,
    isOnTrack: true,
    expectedByNowMinor: 0,
    accumulatedMinor: 0,
    ...overrides,
  });
  const flows = ['2026-10', '2026-11', '2026-12', '2027-01'].map((month) => ({
    month,
    netMinor: 10_000,
  }));

  it('niepokryta część ponad prognozowane saldo → INSUFFICIENT_PROJECTED_BALANCE', () => {
    // 150 000 + 4 × 10 000 = 190 000 < 240 000.
    expect(detectLiquidityWarnings([expense()], 150_000, flows, '2026-10')).toEqual([
      {
        month: '2027-01',
        code: 'INSUFFICIENT_PROJECTED_BALANCE',
        plannedExpenseId: null,
        gapMinor: 50_000,
      },
    ]);
    expect(detectLiquidityWarnings([expense()], 200_000, flows, '2026-10')).toEqual([]);
  });

  it('saldo narastająco: zapłacony wcześniej wydatek zmniejsza zapas na kolejny', () => {
    const warnings = detectLiquidityWarnings(
      [
        expense({ id: 'A', dueMonth: '2026-11', remainingMinor: 100_000 }),
        expense({ id: 'B', remainingMinor: 100_000 }),
      ],
      150_000,
      flows,
      '2026-10',
    );
    expect(warnings).toEqual([
      {
        month: '2027-01',
        code: 'INSUFFICIENT_PROJECTED_BALANCE',
        plannedExpenseId: null,
        gapMinor: 10_000,
      },
    ]);
  });

  it('konieczny bez odkładania do 3 miesięcy; odkładanie spóźnione; zaległy liczony teraz', () => {
    const warnings = detectLiquidityWarnings(
      [
        expense({ id: 'MUST', priority: 'must', setAsideEnabled: false, remainingMinor: 1_000 }),
        expense({
          id: 'LATE',
          dueMonth: '2026-12',
          remainingMinor: 1_000,
          isOnTrack: false,
          expectedByNowMinor: 800,
          accumulatedMinor: 300,
        }),
        expense({
          id: 'FAR',
          dueMonth: '2027-06',
          priority: 'must',
          setAsideEnabled: false,
          remainingMinor: 1_000,
        }),
        expense({
          id: 'OLD',
          dueMonth: '2026-08',
          priority: 'must',
          setAsideEnabled: false,
          remainingMinor: 500,
        }),
      ],
      1_000_000,
      flows,
      '2026-10',
    );
    expect(warnings.map((w) => [w.month, w.code, w.plannedExpenseId, w.gapMinor])).toEqual([
      ['2026-10', 'UNFUNDED_MUST_EXPENSE', 'OLD', 500],
      ['2026-12', 'SET_ASIDE_BEHIND', 'LATE', 500],
      ['2027-01', 'UNFUNDED_MUST_EXPENSE', 'MUST', 1_000],
    ]);
  });

  it('pokryty w całości — bez ostrzeżeń, nawet przy ujemnym saldzie', () => {
    expect(
      detectLiquidityWarnings(
        [expense({ remainingMinor: 0, priority: 'must', setAsideEnabled: false })],
        -500,
        flows,
        '2026-10',
      ),
    ).toEqual([]);
  });
});
