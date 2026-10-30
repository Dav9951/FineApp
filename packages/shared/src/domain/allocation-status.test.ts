import { describe, expect, it } from 'vitest';

import {
  allocationExceedsIncome,
  allocationLineStatus,
  buildAllocationStatus,
  type AllocationSums,
  type AllocationTargetShares,
  type AllocationTiming,
} from './allocation-status.js';

/**
 * Testy porównania plan/wykonanie
 * ([07 §2.4–§2.7](../../../../plans/07-domain-rules.md#24-wykonanie), ADR-011, ADR-053).
 */

/** Rozkład z przykładu 04 §11: 20% oszczędności, 10% inwestycji. */
const TARGET: AllocationTargetShares = {
  effectiveFromMonth: '2026-01',
  savingsPercentBps: 2000,
  investmentPercentBps: 1000,
  debtPercentBps: 0,
};

/** 20 z 30 dni września. */
const PARTIAL: AllocationTiming = { isPartial: true, daysElapsed: 20, daysInMonth: 30 };
/** Miesiąc zamknięty. */
const CLOSED: AllocationTiming = { isPartial: false, daysElapsed: 30, daysInMonth: 30 };

/**
 * Sumy miesiąca.
 *
 * @param overrides - Nadpisane pola.
 * @returns Sumy.
 */
function sums(overrides: Partial<AllocationSums> = {}): AllocationSums {
  return {
    incomeBaseMinor: 1_180_000,
    savingsMinor: 200_000,
    investmentMinor: 118_000,
    debtRepaymentMinor: 0,
    ...overrides,
  };
}

describe('allocationLineStatus (07 §2.5)', () => {
  it('plan wykonany dokładnie — met; ponad plan — ahead', () => {
    expect(allocationLineStatus(1000, 1000, 0.5)).toBe('met');
    expect(allocationLineStatus(1001, 1000, 1)).toBe('ahead');
  });

  it('w trakcie miesiąca: proporcjonalnie do upływu dni', () => {
    // 5 września: 1/6 miesiąca → oczekiwane 167 z 1 000.
    expect(allocationLineStatus(167, 1000, 5 / 30)).toBe('on_track');
    expect(allocationLineStatus(166, 1000, 5 / 30)).toBe('behind');
  });

  it('miesiąc zamknięty — liczy się tylko pełne wykonanie', () => {
    expect(allocationLineStatus(999, 1000, 1)).toBe('behind');
  });

  it('miesiąc przyszły — nic nie jest spóźnione', () => {
    expect(allocationLineStatus(0, 1000, 0)).toBe('on_track');
  });

  it('zerowy plan: met, chyba że wypłacono (ujemne → behind)', () => {
    expect(allocationLineStatus(0, 0, 1)).toBe('met');
    expect(allocationLineStatus(500, 0, 1)).toBe('met');
    expect(allocationLineStatus(-1, 0, 1)).toBe('behind');
  });

  it('wykonanie ujemne zawsze behind', () => {
    expect(allocationLineStatus(-150_000, 236_000, 0)).toBe('behind');
  });
});

describe('buildAllocationStatus', () => {
  it('przykład z 04 §11: brakuje 360 zł w oszczędnościach, inwestycje wykonane', () => {
    const status = buildAllocationStatus('2026-09', TARGET, sums(), PARTIAL);
    expect(status.lines).toEqual([
      {
        kind: 'savings',
        targetPercentBps: 2000,
        targetAmountMinor: 236_000,
        actualAmountMinor: 200_000,
        actualPercentBps: 1695,
        deltaAmountMinor: -36_000,
        deltaPercentBps: -305,
        fulfillmentBps: 8475,
        status: 'on_track',
      },
      {
        kind: 'investment',
        targetPercentBps: 1000,
        targetAmountMinor: 118_000,
        actualAmountMinor: 118_000,
        actualPercentBps: 1000,
        deltaAmountMinor: 0,
        deltaPercentBps: 0,
        fulfillmentBps: 10_000,
        status: 'met',
      },
    ]);
    expect(status.totals).toEqual({
      targetPercentBps: 3000,
      actualPercentBps: 2695,
      targetAmountMinor: 354_000,
      actualAmountMinor: 318_000,
      shortfallMinor: 36_000,
    });
    expect(status.effectiveFromMonth).toBe('2026-01');
    expect(status.isPartialMonth).toBe(true);
  });

  it('wykonanie ujemne (04 §11): kwota, procent i realizacja ze znakiem minus', () => {
    const status = buildAllocationStatus(
      '2026-09',
      TARGET,
      sums({ savingsMinor: -150_000 }),
      CLOSED,
    );
    expect(status.lines[0]).toEqual({
      kind: 'savings',
      targetPercentBps: 2000,
      targetAmountMinor: 236_000,
      actualAmountMinor: -150_000,
      actualPercentBps: -1271,
      deltaAmountMinor: -386_000,
      deltaPercentBps: -3271,
      fulfillmentBps: -6356,
      status: 'behind',
    });
    // Niedobór to pełna różnica — minus nie jest obcinany do zera.
    expect(status.totals.shortfallMinor).toBe(386_000);
  });

  it('nadwyżka jednej linii nie kompensuje niedoboru drugiej (07 §2.6)', () => {
    const status = buildAllocationStatus(
      '2026-09',
      TARGET,
      sums({ savingsMinor: 500_000, investmentMinor: 0 }),
      CLOSED,
    );
    expect(status.totals.shortfallMinor).toBe(118_000);
    expect(status.lines.map((line) => line.status)).toEqual(['ahead', 'behind']);
  });

  it('brak rozkładu: cele 0%, status met, bez niedoboru (07 §2.7)', () => {
    const status = buildAllocationStatus('2026-09', null, sums(), CLOSED);
    expect(status.effectiveFromMonth).toBeNull();
    expect(status.lines.map((line) => [line.kind, line.targetAmountMinor, line.status])).toEqual([
      ['savings', 0, 'met'],
      ['investment', 0, 'met'],
    ]);
    expect(status.totals.shortfallMinor).toBe(0);
  });

  it('wypłata przy zerowym planie — behind mimo braku planu', () => {
    const status = buildAllocationStatus('2026-09', null, sums({ savingsMinor: -10_000 }), CLOSED);
    expect(status.lines[0]?.status).toBe('behind');
    expect(status.totals.shortfallMinor).toBe(10_000);
  });

  it('zerowe wpływy: procenty 0 i isPartialMonth, nie NaN (07 §2.7)', () => {
    const status = buildAllocationStatus(
      '2026-08',
      TARGET,
      sums({ incomeBaseMinor: 0, savingsMinor: 50_000 }),
      CLOSED,
    );
    expect(status.isPartialMonth).toBe(true);
    expect(status.lines[0]).toMatchObject({
      targetAmountMinor: 0,
      actualPercentBps: 0,
      fulfillmentBps: 0,
      status: 'met',
    });
    expect(status.totals.actualPercentBps).toBe(0);
  });

  it('linia spłaty długu — tylko gdy rozkład ją planuje', () => {
    const withDebt = buildAllocationStatus(
      '2026-09',
      { ...TARGET, debtPercentBps: 1500 },
      sums({ debtRepaymentMinor: 185_000 }),
      CLOSED,
    );
    expect(withDebt.lines.map((line) => line.kind)).toEqual([
      'savings',
      'investment',
      'debt_repayment',
    ]);
    expect(withDebt.lines[2]).toMatchObject({ targetAmountMinor: 177_000, status: 'ahead' });
    expect(withDebt.totals.targetPercentBps).toBe(4500);

    const without = buildAllocationStatus(
      '2026-09',
      TARGET,
      sums({ debtRepaymentMinor: 185_000 }),
      CLOSED,
    );
    expect(without.lines).toHaveLength(2);
    expect(without.totals.actualAmountMinor).toBe(318_000);
  });

  it('miesiąc przyszły: nic nie jest spóźnione', () => {
    const status = buildAllocationStatus(
      '2026-10',
      TARGET,
      sums({ incomeBaseMinor: 1_000_000, savingsMinor: 0, investmentMinor: 0 }),
      { isPartial: false, daysElapsed: 0, daysInMonth: 31 },
    );
    expect(status.lines.map((line) => line.status)).toEqual(['on_track', 'on_track']);
  });
});

describe('allocationExceedsIncome', () => {
  it('ponad 100% — ostrzeżenie; równo 100% — nie', () => {
    expect(
      allocationExceedsIncome({
        savingsPercentBps: 6000,
        investmentPercentBps: 4000,
        debtPercentBps: 1,
      }),
    ).toBe(true);
    expect(
      allocationExceedsIncome({
        savingsPercentBps: 6000,
        investmentPercentBps: 4000,
        debtPercentBps: 0,
      }),
    ).toBe(false);
  });
});
