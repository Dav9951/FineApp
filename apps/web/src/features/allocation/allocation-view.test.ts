import { describe, expect, it } from 'vitest';

import { allocationFixture } from '../../../test/goal-fixture.js';
import {
  lineVerdict,
  sharesChanged,
  sharesFrom,
  sharesPreview,
  topUpPreset,
  percentTick,
  trendChartPoints,
  trendPoints,
  withdrawalNotice,
} from './allocation-view.js';

/**
 * Testy reguł rozkładu docelowego
 * ([06 §3.6](../../../../../plans/06-ui-views.md#36-rozkład-docelowy--allocation)).
 */

const STATUS = allocationFixture();
const [SAVINGS_LINE, INVESTMENT_LINE] = STATUS.lines;

describe('sharesFrom i sharesPreview', () => {
  it('przykład z 06 §3.6: 20% + 10% = 30%, na życie zostaje 70% = 8 260 zł', () => {
    const shares = sharesFrom(STATUS);
    expect(shares).toEqual({
      savingsPercentBps: 2000,
      investmentPercentBps: 1000,
      debtPercentBps: 0,
    });
    expect(sharesPreview(shares, 1_180_000)).toEqual({
      savingsMinor: 236_000,
      investmentMinor: 118_000,
      debtMinor: 0,
      totalBps: 3000,
      totalMinor: 354_000,
      remainingBps: 7000,
      remainingMinor: 826_000,
    });
  });

  it('plan ponad 100% — reszta ujemna, nie obcięta', () => {
    const preview = sharesPreview(
      { savingsPercentBps: 8000, investmentPercentBps: 3000, debtPercentBps: 0 },
      100_000,
    );
    expect(preview.remainingBps).toBe(-1000);
    expect(preview.remainingMinor).toBe(-10_000);
  });

  it('zmiana któregokolwiek udziału', () => {
    const shares = sharesFrom(STATUS);
    expect(sharesChanged(shares, { ...shares })).toBe(false);
    expect(sharesChanged(shares, { ...shares, debtPercentBps: 50 })).toBe(true);
  });
});

describe('lineVerdict i withdrawalNotice', () => {
  it('statusy w słowach; ujemne i bez planu osobno', () => {
    expect(lineVerdict(SAVINGS_LINE!)).toEqual({ tone: 'muted', label: 'w tempie' });
    expect(lineVerdict(INVESTMENT_LINE!)).toEqual({ tone: 'success', label: 'plan wykonany' });
    expect(lineVerdict({ ...SAVINGS_LINE!, status: 'behind' }).tone).toBe('warning');
    expect(lineVerdict({ ...SAVINGS_LINE!, status: 'ahead' }).label).toBe('ponad plan');
    expect(lineVerdict({ ...SAVINGS_LINE!, actualAmountMinor: -1 }).label).toBe(
      'wypłaty ponad wpłaty',
    );
    expect(lineVerdict({ ...SAVINGS_LINE!, targetAmountMinor: 0 }).label).toBe('bez planu');
  });

  it('ubytek w puli — zdanie, nie sama liczba (15 §5)', () => {
    expect(withdrawalNotice(STATUS.lines)).toBeNull();
    expect(
      withdrawalNotice([
        { ...SAVINGS_LINE!, actualAmountMinor: -150_000 },
        { ...INVESTMENT_LINE!, actualAmountMinor: -1 },
      ]),
    ).toBe('Z oszczędności i inwestycji wypłacono więcej, niż wpłacono.');
  });
});

describe('trendPoints', () => {
  it('punkty trendu: łączny plan, wykonanie i realizacja', () => {
    expect(
      trendPoints([STATUS, allocationFixture({ month: '2026-10', incomeBaseMinor: 0 })]),
    ).toEqual([
      { month: '2026-09', targetBps: 3000, actualBps: 2695, fulfillmentBps: 8983, hasIncome: true },
      {
        month: '2026-10',
        targetBps: 3000,
        actualBps: 2695,
        fulfillmentBps: 8983,
        hasIncome: false,
      },
    ]);
  });
});

describe('topUpPreset', () => {
  const accounts = [
    { accountId: 'ror', allocationClass: 'spending' as const, isArchived: false },
    { accountId: 'old', allocationClass: 'savings' as const, isArchived: true },
    { accountId: 'home', allocationClass: 'savings' as const, isArchived: false },
    { accountId: 'ike', allocationClass: 'investment' as const, isArchived: false },
  ];

  it('cały niedobór na konto puli, której brakuje najwięcej', () => {
    expect(topUpPreset(STATUS, accounts)).toEqual({
      amountMinor: 36_000,
      counterAccountId: 'home',
    });
    const investmentWorse = allocationFixture({
      lines: [SAVINGS_LINE!, { ...INVESTMENT_LINE!, actualAmountMinor: 0 }],
    });
    expect(topUpPreset(investmentWorse, accounts).counterAccountId).toBe('ike');
  });

  it('bez konta puli albo bez niedoboru — konto do wyboru', () => {
    expect(topUpPreset(STATUS, [accounts[0]!]).counterAccountId).toBeNull();
    const met = allocationFixture({
      lines: STATUS.lines.map((line) => ({ ...line, actualAmountMinor: line.targetAmountMinor })),
    });
    expect(topUpPreset(met, accounts).counterAccountId).toBeNull();
  });
});

describe('trendChartPoints', () => {
  it('bez wpływów i bez planu — przerwa (null), nie zero', () => {
    expect(
      trendChartPoints([
        {
          month: '2026-09',
          targetBps: 3_000,
          actualBps: 2_700,
          fulfillmentBps: 9_000,
          hasIncome: true,
        },
        { month: '2026-10', targetBps: 0, actualBps: 0, fulfillmentBps: 0, hasIncome: false },
      ]),
    ).toEqual([
      { key: '2026-09', label: 'wrz', title: 'wrzesień 2026', actual: 2_700, plan: 3_000 },
      { key: '2026-10', label: 'paź', title: 'październik 2026', actual: null, plan: null },
    ]);
  });

  it('ujemne wykonanie zostaje ujemne', () => {
    const [point] = trendChartPoints([
      {
        month: '2026-05',
        targetBps: 1_000,
        actualBps: -400,
        fulfillmentBps: -4_000,
        hasIncome: true,
      },
    ]);
    expect(point?.actual).toBe(-400);
    expect(point?.label).toBe('maj');
  });
});

describe('percentTick', () => {
  it('pełne procenty, minus typograficzny, bez „−0%"', () => {
    expect(percentTick(3_000)).toBe('30%');
    expect(percentTick(-1_000)).toBe('−10%');
    expect(percentTick(0)).toBe('0%');
    expect(percentTick(-20)).toBe('0%');
  });
});
