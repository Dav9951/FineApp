import type { LiabilityDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  canPayNow,
  finalPaymentLabel,
  installmentsLabel,
  installmentStatus,
  liabilityTotals,
} from './liabilities-view.js';

/**
 * Testy reguł ekranu zobowiązań
 * ([06 §3.8](../../../../../plans/06-ui-views.md#38-zobowiązania--liabilities)).
 */

const TODAY = '2026-09-23';

/**
 * Zobowiązanie ze stanem — domyślnie hipoteka z 04 §8.
 *
 * @param overrides - Nadpisane pola.
 * @returns Zobowiązanie.
 */
function liability(overrides: Partial<LiabilityDto> = {}): LiabilityDto {
  return {
    id: '01JH0000000000000000000001',
    name: 'Kredyt hipoteczny',
    kind: 'mortgage',
    creditor: 'mBank',
    currency: 'PLN',
    openingBalanceMinor: 32_000_000,
    balanceAsOf: '2026-01-01',
    remainingMinor: 30_150_000,
    paidSoFarMinor: 1_850_000,
    monthlyPaymentMinor: 185_000,
    installmentsTotal: null,
    installmentsRemainingAtAsOf: null,
    installmentsRemaining: 163,
    nextDueOn: '2026-10-10',
    projectedFinalPaymentOn: '2040-04-10',
    interestRateBps: null,
    paymentDay: 10,
    firstPaymentOn: null,
    paymentAccountId: null,
    categoryId: null,
    recurringRuleId: null,
    progressBps: 578,
    paidThisMonth: true,
    lastPaymentOn: '2026-09-10',
    isActive: true,
    notes: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('liabilityTotals', () => {
  it('przykład z 06 §3.8: razem do spłaty i miesięcznie', () => {
    const totals = liabilityTotals([
      liability({ remainingMinor: 29_900_000 }),
      liability({ remainingMinor: 250_000, monthlyPaymentMinor: 50_000 }),
    ]);
    expect(totals).toEqual({ remainingMinor: 30_150_000, monthlyMinor: 235_000 });
  });

  it('zamknięte poza sumami; spłacone bez raty', () => {
    const totals = liabilityTotals([
      liability({ isActive: false }),
      liability({ remainingMinor: 0, monthlyPaymentMinor: 50_000 }),
    ]);
    expect(totals).toEqual({ remainingMinor: 0, monthlyMinor: 0 });
  });
});

describe('opisy', () => {
  it('liczba rat z odmianą', () => {
    expect(installmentsLabel(1)).toBe('1 rata');
    expect(installmentsLabel(3)).toBe('3 raty');
    expect(installmentsLabel(163)).toBe('163 raty');
    expect(installmentsLabel(5)).toBe('5 rat');
    expect(installmentsLabel(12)).toBe('12 rat');
  });

  it('ostatnia rata rzymskim miesiącem', () => {
    expect(finalPaymentLabel('2040-04-10')).toBe('do IV 2040');
    expect(finalPaymentLabel('2027-12-31')).toBe('do XII 2027');
    expect(finalPaymentLabel(null)).toBeNull();
  });
});

describe('installmentStatus', () => {
  it('zapłacone w tym miesiącu — z datą; bez „Zaksięguj"', () => {
    const status = installmentStatus(liability(), TODAY);
    expect(status).toEqual({ kind: 'paid', label: 'Zapłacono we wrześniu (10 wrz)' });
    expect(canPayNow(status)).toBe(false);
  });

  it('rata przed terminem i po terminie', () => {
    const due = installmentStatus(
      liability({ paidThisMonth: false, nextDueOn: '2026-09-25' }),
      TODAY,
    );
    expect(due).toEqual({ kind: 'due', label: 'Rata na 25 wrz' });
    const overdue = installmentStatus(
      liability({ paidThisMonth: false, nextDueOn: '2026-09-10' }),
      TODAY,
    );
    expect(overdue).toEqual({ kind: 'overdue', label: 'Rata po terminie — 10 wrz' });
    expect(canPayNow(due) && canPayNow(overdue)).toBe(true);
  });

  it('spłacone, zamknięte, bez dnia raty', () => {
    expect(installmentStatus(liability({ remainingMinor: 0 }), TODAY).kind).toBe('done');
    expect(installmentStatus(liability({ isActive: false }), TODAY).kind).toBe('closed');
    const unknown = installmentStatus(liability({ paidThisMonth: false, nextDueOn: null }), TODAY);
    expect(unknown.kind).toBe('unknown');
    expect(canPayNow(unknown)).toBe(true);
  });
});
