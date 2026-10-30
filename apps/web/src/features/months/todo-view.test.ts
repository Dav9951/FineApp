import type { LiabilityDto, MonthSummaryDto, RecurringOccurrenceDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import { plannedFixture, plannedSectionFixture } from '../../../test/planned-fixture.js';

import { showTodo, todoRows } from './todo-view.js';

/**
 * Testy sekcji „Do zrobienia"
 * ([07 §6.6](../../../../../plans/07-domain-rules.md#66-zaległości), ADR-050).
 */

const TODAY = '2026-09-23';

/**
 * Wystąpienie — domyślnie wrześniowy czynsz 10. dnia, zaległy.
 *
 * @param overrides - Nadpisane pola.
 * @returns Wystąpienie.
 */
function occurrence(overrides: Partial<RecurringOccurrenceDto> = {}): RecurringOccurrenceDto {
  return {
    id: '01JK0000000000000000000001',
    ruleId: '01JL0000000000000000000001',
    ruleName: 'Czynsz',
    flow: 'expense',
    dueOn: '2026-09-10',
    monthKey: '2026-09',
    plannedAmountMinor: 185_000,
    status: 'planned',
    postedAmountMinor: null,
    transactionId: null,
    categoryId: null,
    categoryName: null,
    allocationEffects: [],
    isFixedExpense: true,
    isOverdue: true,
    amountIsEstimate: false,
    ...overrides,
  };
}

/**
 * Zobowiązanie bez reguły, niezapłacone.
 *
 * @param overrides - Nadpisane pola.
 * @returns Zobowiązanie.
 */
function liability(overrides: Partial<LiabilityDto> = {}): LiabilityDto {
  return {
    id: '01JH0000000000000000000001',
    name: 'Pożyczka',
    remainingMinor: 100_000,
    monthlyPaymentMinor: 20_000,
    recurringRuleId: null,
    paidThisMonth: false,
    nextDueOn: '2026-09-28',
    ...overrides,
  } as LiabilityDto;
}

/**
 * Podsumowanie września z sekcjami.
 *
 * @param items - Wystąpienia.
 * @param liabilities - Zobowiązania.
 * @param overrides - Nadpisane pola.
 * @returns Podsumowanie.
 */
function summary(
  items: RecurringOccurrenceDto[],
  liabilities: LiabilityDto[] = [],
  overrides: Partial<MonthSummaryDto> = {},
): MonthSummaryDto {
  return {
    month: '2026-09',
    isCurrent: true,
    isFuture: false,
    recurring: {
      plannedTotalMinor: 0,
      postedTotalMinor: 0,
      pendingCount: items.length,
      overdueCount: 0,
      items,
    },
    liabilities: {
      totalRemainingMinor: 0,
      monthlyPaymentTotalMinor: 0,
      paidThisMonthMinor: 0,
      unpaidCount: 0,
      items: liabilities,
    },
    plannedExpenses: plannedSectionFixture(),
    ...overrides,
  } as MonthSummaryDto;
}

describe('todoRows', () => {
  it('zaległe najpierw, z podpisem miesiąca; potem po terminie', () => {
    const rows = todoRows(
      summary([
        occurrence({ ruleName: 'Internet', dueOn: '2026-09-25', isOverdue: false }),
        occurrence(),
        occurrence({ dueOn: '2026-08-10', monthKey: '2026-08', id: '01JK0000000000000000000002' }),
      ]),
      TODAY,
    );
    expect(rows.map((row) => [row.name, row.caption])).toEqual([
      ['Czynsz', '10 sie · zaległe za sierpień 2026'],
      ['Czynsz', '10 wrz · po terminie'],
      ['Internet', '25 wrz'],
    ]);
  });

  it('kwota szacunkowa w podpisie', () => {
    const [row] = todoRows(
      summary([occurrence({ amountIsEstimate: true, isOverdue: false, dueOn: '2026-09-25' })]),
      TODAY,
    );
    expect(row?.caption).toBe('25 wrz · kwota szacunkowa');
  });

  it('raty zobowiązań bez reguły — tylko w bieżącym miesiącu i tylko niezapłacone', () => {
    const items = [
      liability(),
      liability({
        id: '01JH0000000000000000000002',
        name: 'Z regułą',
        recurringRuleId: '01JL0000000000000000000009',
      }),
      liability({ id: '01JH0000000000000000000003', name: 'Zapłacona', paidThisMonth: true }),
      liability({ id: '01JH0000000000000000000004', name: 'Spłacona', remainingMinor: 0 }),
      liability({ id: '01JH0000000000000000000005', name: 'Bez dnia', nextDueOn: null }),
      // Spłata od listopada (ADR-068) — we wrześniu nie ma czego płacić.
      liability({
        id: '01JH0000000000000000000006',
        name: 'Od listopada',
        nextDueOn: '2026-11-10',
      }),
    ];
    const rows = todoRows(summary([], items), TODAY);
    expect(rows.map((row) => [row.name, row.caption])).toEqual([
      ['Pożyczka', 'rata · 28 wrz'],
      ['Bez dnia', 'rata'],
    ]);
    expect(todoRows(summary([], items, { isCurrent: false }), TODAY)).toEqual([]);
  });

  it('podgląd przyszłości — bez przycisków', () => {
    const [row] = todoRows(
      summary([occurrence({ id: null, isOverdue: false })], [], {
        isFuture: true,
        isCurrent: false,
      }),
      TODAY,
    );
    expect(row?.actionable).toBe(false);
  });
});

describe('todoRows — planowane wydatki (F6-8)', () => {
  it('gotowe do zapłaty — „Zapłacone" z szacunkiem; zaległy — na górze', () => {
    const due = plannedFixture({
      id: 'p1',
      name: 'Wymiana okien',
      dueMonth: '2026-09',
      dueOn: null,
      monthsUntilDue: 0,
      estimatedAmountMinor: 50_000,
      status: 'ready',
    });
    const late = plannedFixture({
      id: 'p2',
      name: 'Przegląd',
      dueMonth: '2026-08',
      dueOn: '2026-08-20',
      monthsUntilDue: -1,
      amountIsEstimate: false,
      status: 'ready',
    });
    const rows = todoRows(
      summary([occurrence({ isOverdue: false, dueOn: '2026-09-25' })], [], {
        plannedExpenses: plannedSectionFixture({ readyToPay: [due, late] }),
      }),
      TODAY,
    );
    expect(rows.map((row) => [row.kind, row.name, row.caption])).toEqual([
      ['planned', 'Przegląd', 'planowany wydatek · 20 sie · zaległe za sierpień 2026'],
      ['occurrence', 'Czynsz', '25 wrz'],
      ['planned', 'Wymiana okien', 'planowany wydatek · kwota szacunkowa'],
    ]);
    expect(rows[2]).toMatchObject({ amountMinor: 50_000, actionable: true });
  });
});

describe('showTodo', () => {
  it('pusta sekcja znika; wszystko zrobione — zostaje', () => {
    expect(showTodo(summary([]), [])).toBe(false);
    const done = summary([]);
    expect(
      showTodo({ ...done, recurring: { ...done.recurring, plannedTotalMinor: 185_000 } }, []),
    ).toBe(true);
  });
});
