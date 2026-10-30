import type { AccountDto, RecurringRuleDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  groupRules,
  isSavingTransfer,
  monthlyEquivalentMinor,
  monthlySummary,
  scheduleLabel,
} from './recurring-view.js';

/**
 * Testy reguł ekranu pozycji cyklicznych
 * ([06 §3.9](../../../../../plans/06-ui-views.md#39-pozycje-cykliczne--recurring)).
 */

const ROR = '01J9ZQK8WQ0000000000000000';
const SAVINGS = '01J9ZQK8WQ0000000000000001';
const BROKER = '01J9ZQK8WQ0000000000000002';

/**
 * Konto do mapy klas.
 *
 * @param id - Identyfikator.
 * @param allocationClass - Pula.
 * @returns Konto.
 */
function account(id: string, allocationClass: AccountDto['allocationClass']): AccountDto {
  return { id, allocationClass } as AccountDto;
}

const ACCOUNTS = [
  account(ROR, 'spending'),
  account(SAVINGS, 'savings'),
  account(BROKER, 'investment'),
];

/**
 * Reguła z wartościami domyślnymi — czynsz 1 850 zł 10. dnia.
 *
 * @param overrides - Nadpisane pola.
 * @returns Reguła.
 */
function rule(overrides: Partial<RecurringRuleDto> = {}): RecurringRuleDto {
  return {
    id: ROR,
    name: 'Czynsz',
    flow: 'expense',
    amountMinor: 185_000,
    amountIsEstimate: false,
    currency: 'PLN',
    accountId: ROR,
    counterAccountId: null,
    categoryId: null,
    incomeSourceId: null,
    goalId: null,
    liabilityId: null,
    allocationOverride: null,
    frequency: 'monthly',
    intervalCount: 1,
    dayOfMonth: 10,
    weekday: null,
    monthOfYear: null,
    anchorDate: '2026-10-01',
    startMonth: '2026-10',
    endMonth: null,
    autoPost: false,
    isFixedExpense: true,
    isActive: true,
    notes: null,
    nextDueOn: '2026-10-10',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('monthlyEquivalentMinor', () => {
  it('miesięczna bez zmian; kwartał, rok i co N — podzielone', () => {
    expect(monthlyEquivalentMinor(rule())).toBe(185_000);
    expect(monthlyEquivalentMinor(rule({ frequency: 'quarterly', amountMinor: 30_000 }))).toBe(
      10_000,
    );
    expect(monthlyEquivalentMinor(rule({ frequency: 'yearly', amountMinor: 240_000 }))).toBe(
      20_000,
    );
    expect(
      monthlyEquivalentMinor(
        rule({ frequency: 'every_n_months', intervalCount: 2, amountMinor: 9_000 }),
      ),
    ).toBe(4_500);
  });

  it('tygodniowa ×52/12, co dwa tygodnie ×26/12 — zaokrąglenie połówki od zera', () => {
    expect(monthlyEquivalentMinor(rule({ frequency: 'weekly', amountMinor: 3_000 }))).toBe(13_000);
    // 100 × 26 / 12 = 216,67 → 217
    expect(monthlyEquivalentMinor(rule({ frequency: 'biweekly', amountMinor: 100 }))).toBe(217);
    // 1 × 1/12 = 0,083 → 0 — grosz rocznie nie robi miesięcznej sumy
    expect(monthlyEquivalentMinor(rule({ frequency: 'yearly', amountMinor: 1 }))).toBe(0);
  });
});

describe('isSavingTransfer', () => {
  const classes = new Map(ACCOUNTS.map((a) => [a.id, a.allocationClass]));

  it('przelew na oszczędności albo inwestycje — tak; między bieżącymi — nie', () => {
    expect(
      isSavingTransfer(
        { flow: 'transfer', counterAccountId: SAVINGS, allocationOverride: null },
        classes,
      ),
    ).toBe(true);
    expect(
      isSavingTransfer(
        { flow: 'transfer', counterAccountId: BROKER, allocationOverride: null },
        classes,
      ),
    ).toBe(true);
    expect(
      isSavingTransfer(
        { flow: 'transfer', counterAccountId: ROR, allocationOverride: null },
        classes,
      ),
    ).toBe(false);
  });

  it('nadpisanie wygrywa z klasą konta; wydatek nigdy', () => {
    expect(
      isSavingTransfer(
        { flow: 'transfer', counterAccountId: SAVINGS, allocationOverride: 'none' },
        classes,
      ),
    ).toBe(false);
    expect(
      isSavingTransfer(
        { flow: 'transfer', counterAccountId: ROR, allocationOverride: 'savings' },
        classes,
      ),
    ).toBe(true);
    expect(
      isSavingTransfer(
        { flow: 'expense', counterAccountId: null, allocationOverride: null },
        classes,
      ),
    ).toBe(false);
  });
});

describe('groupRules i monthlySummary', () => {
  const rules = [
    rule({ name: 'Czynsz' }),
    rule({ name: 'Kino', isFixedExpense: false, amountMinor: 5_000 }),
    rule({
      name: 'IKE',
      flow: 'transfer',
      counterAccountId: BROKER,
      amountMinor: 100_000,
      isFixedExpense: false,
    }),
    rule({
      name: 'Na ROR żony',
      flow: 'transfer',
      counterAccountId: ROR,
      amountMinor: 20_000,
      isFixedExpense: false,
    }),
    rule({ name: 'Pensja', flow: 'income', amountMinor: 980_000, isFixedExpense: false }),
    rule({ name: 'Siłownia', isActive: false, amountMinor: 12_000 }),
    rule({ name: 'OC', frequency: 'yearly', monthOfYear: 3, amountMinor: 120_000 }),
  ];

  it('grupy w stałej kolejności, wstrzymane osobno i bez sumy', () => {
    const groups = groupRules(rules, ACCOUNTS);
    expect(groups.map((g) => [g.key, g.rules.map((r) => r.name), g.monthlyMinor])).toEqual([
      ['fixed', ['Czynsz', 'OC'], 195_000],
      ['expense', ['Kino'], 5_000],
      ['saving', ['IKE'], 100_000],
      ['transfer', ['Na ROR żony'], 20_000],
      ['income', ['Pensja'], 980_000],
      ['paused', ['Siłownia'], null],
    ]);
  });

  it('podsumowanie: wydatki, wpływy, odkładanie; średnia przy regule rocznej', () => {
    const groups = groupRules(rules, ACCOUNTS);
    expect(monthlySummary(groups, rules)).toEqual({
      expenseMinor: 200_000,
      incomeMinor: 980_000,
      savingMinor: 100_000,
      isAverage: true,
    });
  });

  it('pusta lista — brak grup, zera', () => {
    expect(groupRules([], ACCOUNTS)).toEqual([]);
    expect(monthlySummary([], [])).toEqual({
      expenseMinor: 0,
      incomeMinor: 0,
      savingMinor: 0,
      isAverage: false,
    });
  });
});

describe('scheduleLabel', () => {
  it('opisuje każdą częstotliwość', () => {
    expect(scheduleLabel(rule())).toBe('10. dnia');
    expect(scheduleLabel(rule({ frequency: 'quarterly' }))).toBe('co kwartał, 10. dnia');
    expect(scheduleLabel(rule({ frequency: 'every_n_months', intervalCount: 2 }))).toBe(
      'co 2 mies., 10. dnia',
    );
    expect(scheduleLabel(rule({ frequency: 'yearly', dayOfMonth: 15, monthOfYear: 3 }))).toBe(
      'co roku, 15 marca',
    );
    expect(scheduleLabel(rule({ frequency: 'weekly', dayOfMonth: null, weekday: 2 }))).toBe(
      'co tydzień, we wtorek',
    );
    expect(scheduleLabel(rule({ frequency: 'biweekly', dayOfMonth: null, weekday: 5 }))).toBe(
      'co 2 tygodnie, w piątek',
    );
  });
});
