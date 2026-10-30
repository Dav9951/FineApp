import { describe, expect, it } from 'vitest';

import { transactionShapeIssues } from './transaction.js';

/**
 * Testy niezmienników kształtu transakcji — I-2, I-3, I-7a
 * ([03 §4](../../../../plans/03-data-model.md#4-niezmienniki-wymuszane-w-serwisach)).
 */

const A = '01JB0000000000000000000001';
const B = '01JB0000000000000000000002';
const L = '01JB0000000000000000000003';
const S = '01JB0000000000000000000004';

/**
 * Zwraca same ścieżki problemów.
 *
 * @param issues - Problemy.
 * @returns Ścieżki w kolejności zgłoszenia.
 */
function paths(issues: readonly { path: string }[]): string[] {
  return issues.map((issue) => issue.path);
}

describe('I-2 — przelew', () => {
  it('poprawny przelew nie ma problemów', () => {
    expect(transactionShapeIssues({ type: 'transfer', accountId: A, counterAccountId: B })).toEqual(
      [],
    );
  });

  it('bez konta docelowego', () => {
    const issues = transactionShapeIssues({
      type: 'transfer',
      accountId: A,
      counterAccountId: null,
    });
    expect(issues).toEqual([
      { path: 'counterAccountId', message: 'Przelew wymaga konta docelowego' },
    ]);
  });

  it('na to samo konto', () => {
    const issues = transactionShapeIssues({ type: 'transfer', accountId: A, counterAccountId: A });
    expect(issues[0]?.message).toBe('Konto docelowe musi być inne niż źródłowe');
  });
});

describe('I-3 — wydatek i przychód', () => {
  it.each(['expense', 'income'] as const)('%s z kontem docelowym', (type) => {
    expect(paths(transactionShapeIssues({ type, accountId: A, counterAccountId: B }))).toEqual([
      'counterAccountId',
    ]);
  });

  it.each(['expense', 'income'] as const)('%s bez konta docelowego jest poprawny', (type) => {
    expect(transactionShapeIssues({ type, accountId: A, counterAccountId: null })).toEqual([]);
  });
});

describe('I-7a — nadpisanie alokacji', () => {
  it.each(['none', 'savings', 'investment'] as const)('przelew przyjmuje %s', (override) => {
    expect(
      transactionShapeIssues({
        type: 'transfer',
        accountId: A,
        counterAccountId: B,
        allocationOverride: override,
      }),
    ).toEqual([]);
  });

  it('wydatek-rata przyjmuje wyłącznie `none`', () => {
    expect(
      transactionShapeIssues({ type: 'expense', liabilityId: L, allocationOverride: 'none' }),
    ).toEqual([]);
    expect(
      transactionShapeIssues({ type: 'expense', liabilityId: L, allocationOverride: 'savings' }),
    ).toEqual([
      {
        path: 'allocationOverride',
        message: 'Ratę zobowiązania można tylko wyłączyć z rozliczenia',
      },
    ]);
  });

  it('wydatek bez zobowiązania nie przyjmuje nawet `none`', () => {
    expect(paths(transactionShapeIssues({ type: 'expense', allocationOverride: 'none' }))).toEqual([
      'allocationOverride',
    ]);
  });

  it('przychód nie przyjmuje nadpisania, także ze zobowiązaniem', () => {
    const issues = transactionShapeIssues({
      type: 'income',
      liabilityId: L,
      allocationOverride: 'none',
    });
    expect(issues).toEqual([
      { path: 'allocationOverride', message: 'Alokację można ustawić tylko dla przelewu' },
    ]);
  });
});

describe('źródło przychodu', () => {
  it('dozwolone przy przychodzie', () => {
    expect(transactionShapeIssues({ type: 'income', incomeSourceId: S })).toEqual([]);
  });

  it.each(['expense', 'transfer'] as const)('odrzucone przy %s', (type) => {
    const issues = transactionShapeIssues({
      type,
      accountId: A,
      counterAccountId: type === 'transfer' ? B : null,
      incomeSourceId: S,
    });
    expect(paths(issues)).toEqual(['incomeSourceId']);
  });
});

it('zgłasza wszystkie problemy naraz, nie tylko pierwszy', () => {
  const issues = transactionShapeIssues({
    type: 'expense',
    accountId: A,
    counterAccountId: B,
    allocationOverride: 'savings',
    incomeSourceId: S,
  });
  expect(paths(issues)).toEqual(['counterAccountId', 'allocationOverride', 'incomeSourceId']);
});
