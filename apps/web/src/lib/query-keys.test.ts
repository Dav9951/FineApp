import { describe, expect, it } from 'vitest';

import { qk } from './query-keys.js';

describe('qk', () => {
  it('klucz miesiąca zaczyna się od korzenia miesięcy', () => {
    // Dzięki temu invalidateQueries({ queryKey: qk.months() }) unieważnia wszystkie
    // miesiące naraz, a nie trzeba wyliczać ich po jednym.
    expect(qk.month('2026-09')).toEqual(['months', '2026-09']);
    expect(qk.month('2026-09').slice(0, 1)).toEqual(qk.months());
    expect(qk.monthCategories('2026-09').slice(0, 1)).toEqual(qk.months());
  });

  it('klucze zasobów zagnieżdżonych zaczynają się od korzenia zasobu', () => {
    expect(qk.transaction('x').slice(0, 1)).toEqual(qk.transactions());
    expect(qk.goal('x').slice(0, 1)).toEqual(qk.goals());
    expect(qk.goalList('2026-09').slice(0, 1)).toEqual(qk.goals());
    expect(qk.allocation('2026-09').slice(0, 1)).toEqual(qk.allocationAll());
    expect(qk.allocationTrend('2026-09').slice(0, 1)).toEqual(qk.allocationAll());
    expect(qk.liability('x').slice(0, 1)).toEqual(qk.liabilities());
    expect(qk.plannedExpense('x').slice(0, 1)).toEqual(qk.plannedExpenses());
    expect(qk.document('x').slice(0, 1)).toEqual(qk.documents());
    expect(qk.documentList().slice(0, 1)).toEqual(qk.documents());
    expect(qk.aiUsage().slice(0, 1)).toEqual(qk.settings());
  });

  it('filtry listy są częścią klucza — inne filtry to inny cache', () => {
    expect(qk.transactionList({ kind: 'expense' })).not.toEqual(
      qk.transactionList({ kind: 'income' }),
    );
  });

  it('korzenie są parami różne', () => {
    const roots = [
      qk.me(),
      qk.months(),
      qk.transactions(),
      qk.accounts(),
      qk.categories(),
      qk.incomeSources(),
      qk.goals(),
      qk.allocationAll(),
      qk.liabilities(),
      qk.recurring(),
      qk.plannedExpenses(),
      qk.documents(),
      qk.settings(),
      qk.sessions(),
    ].map((key) => key.join('/'));
    expect(new Set(roots).size).toBe(roots.length);
  });

  it('ten sam argument daje ten sam klucz', () => {
    expect(qk.month('2026-09')).toEqual(qk.month('2026-09'));
  });
});
