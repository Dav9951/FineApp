import { describe, expect, it } from 'vitest';

import {
  CreateTransactionRequestSchema,
  TransactionDtoSchema,
  TransactionFieldsSchema,
  TransactionListMetaSchema,
  TransactionQuerySchema,
  UpdateTransactionRequestSchema,
} from './transaction.js';

/**
 * Testy kontraktowe transakcji — przykłady z 04 §7 i pułapki parametrów zapytania
 * ([05 §7](../../../../plans/05-dto-contracts.md#7-transakcje--dtotransactiondtots)).
 */

const ACCOUNT = '01JB0000000000000000000001';
const SAVINGS = '01JF0000000000000000000001';
const CATEGORY = '01JC0000000000000000000001';

describe('ciało POST /transactions — przykłady z 04 §7', () => {
  it('wydatek', () => {
    const parsed = CreateTransactionRequestSchema.parse({
      type: 'expense',
      bookedOn: '2026-09-18',
      amountMinor: 12_799,
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      description: 'Zakupy tygodniowe',
      merchant: 'Lidl',
      notes: null,
    });
    expect(parsed.amountMinor).toBe(12_799);
    expect(parsed.notes).toBeNull();
  });

  it('przelew na cel z `allocationOverride: null`', () => {
    const parsed = CreateTransactionRequestSchema.parse({
      type: 'transfer',
      bookedOn: '2026-09-11',
      amountMinor: 200_000,
      accountId: ACCOUNT,
      counterAccountId: SAVINGS,
      goalId: '01JG0000000000000000000001',
      allocationOverride: null,
      description: 'Wkład własny — wrzesień',
    });
    expect(parsed.allocationOverride).toBeNull();
  });
});

describe('pola tekstowe', () => {
  it('są przycinane, a puste zapisywane jako brak', () => {
    const parsed = TransactionFieldsSchema.parse({
      type: 'expense',
      bookedOn: '2026-09-18',
      amountMinor: 100,
      accountId: ACCOUNT,
      description: '  Chleb  ',
      merchant: '   ',
    });
    expect(parsed.description).toBe('Chleb');
    expect(parsed.merchant).toBeNull();
    expect(parsed.notes).toBeUndefined();
  });

  it('dłuższe niż limit są odrzucane', () => {
    const result = TransactionFieldsSchema.safeParse({
      type: 'expense',
      bookedOn: '2026-09-18',
      amountMinor: 100,
      accountId: ACCOUNT,
      merchant: 'x'.repeat(121),
    });
    expect(result.success).toBe(false);
  });
});

describe('kwota', () => {
  it.each([0, -100, 12.5])('%s jest odrzucane', (amountMinor) => {
    const result = TransactionFieldsSchema.safeParse({
      type: 'expense',
      bookedOn: '2026-09-18',
      amountMinor,
      accountId: ACCOUNT,
    });
    expect(result.success).toBe(false);
  });
});

describe('walidacja krzyżowa formularza', () => {
  it('zgłasza problem pod polem, którego dotyczy', () => {
    const result = CreateTransactionRequestSchema.safeParse({
      type: 'transfer',
      bookedOn: '2026-09-11',
      amountMinor: 100,
      accountId: ACCOUNT,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['counterAccountId']);
  });

  it('pola bez walidacji krzyżowej przepuszczają ten sam przelew — sprawdza go serwis', () => {
    expect(
      TransactionFieldsSchema.safeParse({
        type: 'transfer',
        bookedOn: '2026-09-11',
        amountMinor: 100,
        accountId: ACCOUNT,
      }).success,
    ).toBe(true);
  });
});

describe('PATCH', () => {
  it('każde pole jest opcjonalne, puste ciało jest poprawne', () => {
    expect(UpdateTransactionRequestSchema.parse({})).toEqual({});
  });

  it('typ transakcji nie przechodzi — jest niezmienny', () => {
    expect(UpdateTransactionRequestSchema.parse({ type: 'income' })).toEqual({});
  });

  it('`null` czyści pole opcjonalne, ale nie konto źródłowe', () => {
    expect(UpdateTransactionRequestSchema.parse({ categoryId: null })).toEqual({
      categoryId: null,
    });
    expect(UpdateTransactionRequestSchema.safeParse({ accountId: null }).success).toBe(false);
  });
});

describe('TransactionQuerySchema', () => {
  it('wartości domyślne', () => {
    expect(TransactionQuerySchema.parse({})).toEqual({
      limit: 50,
      uncategorized: false,
      includeDeleted: false,
      sort: 'bookedOn:desc',
    });
  });

  it('`uncategorized` — literały i wykluczenie z `categoryId` (Z-18)', () => {
    expect(TransactionQuerySchema.parse({ uncategorized: 'true' }).uncategorized).toBe(true);
    expect(TransactionQuerySchema.safeParse({ uncategorized: 'yes' }).success).toBe(false);
    expect(
      TransactionQuerySchema.safeParse({
        uncategorized: 'true',
        categoryId: '01J9ZQK8WQ0000000000000000',
      }).success,
    ).toBe(false);
  });

  it('`includeDeleted=false` to fałsz — pułapka `z.coerce.boolean()`', () => {
    expect(TransactionQuerySchema.parse({ includeDeleted: 'false' }).includeDeleted).toBe(false);
    expect(TransactionQuerySchema.parse({ includeDeleted: 'true' }).includeDeleted).toBe(true);
    expect(TransactionQuerySchema.safeParse({ includeDeleted: '1' }).success).toBe(false);
  });

  it('filtr pojedynczy i powtórzony dają tablicę', () => {
    expect(TransactionQuerySchema.parse({ type: 'expense' }).type).toEqual(['expense']);
    expect(TransactionQuerySchema.parse({ type: ['expense', 'income'] }).type).toEqual([
      'expense',
      'income',
    ]);
    expect(TransactionQuerySchema.parse({ goalId: ACCOUNT }).goalId).toEqual([ACCOUNT]);
    expect(TransactionQuerySchema.safeParse({ type: 'loan' }).success).toBe(false);
    expect(TransactionQuerySchema.safeParse({ accountId: 'nie-id' }).success).toBe(false);
  });

  it('za dużo wartości jednego filtra jest odrzucane', () => {
    const ids = Array.from({ length: 51 }, () => ACCOUNT);
    expect(TransactionQuerySchema.safeParse({ accountId: ids }).success).toBe(false);
  });

  it('kwoty przychodzą tekstem i są zamieniane na liczby', () => {
    const parsed = TransactionQuerySchema.parse({ minAmountMinor: '100', maxAmountMinor: '5000' });
    expect(parsed.minAmountMinor).toBe(100);
    expect(parsed.maxAmountMinor).toBe(5000);
    expect(TransactionQuerySchema.safeParse({ minAmountMinor: 'abc' }).success).toBe(false);
    expect(TransactionQuerySchema.safeParse({ minAmountMinor: '-1' }).success).toBe(false);
    expect(TransactionQuerySchema.safeParse({ minAmountMinor: '1.5' }).success).toBe(false);
  });

  it('miesiąc wyklucza zakres dat', () => {
    const result = TransactionQuerySchema.safeParse({ month: '2026-09', from: '2026-09-01' });
    expect(result.error?.issues[0]?.path).toEqual(['month']);
    const withEnd = TransactionQuerySchema.safeParse({ month: '2026-09', to: '2026-09-30' });
    expect(withEnd.error?.issues[0]?.path).toEqual(['month']);
  });

  it('zakres dat odwrócony jest odrzucany, jednodniowy przyjmowany', () => {
    expect(
      TransactionQuerySchema.safeParse({ from: '2026-09-10', to: '2026-09-01' }).error?.issues[0]
        ?.path,
    ).toEqual(['to']);
    expect(TransactionQuerySchema.safeParse({ from: '2026-09-10', to: '2026-09-10' }).success).toBe(
      true,
    );
  });

  it('kwota maksymalna mniejsza niż minimalna jest odrzucana', () => {
    expect(
      TransactionQuerySchema.safeParse({ minAmountMinor: '500', maxAmountMinor: '100' }).error
        ?.issues[0]?.path,
    ).toEqual(['maxAmountMinor']);
  });

  it('limit poza 1–200 i nieznane sortowanie są odrzucane', () => {
    expect(TransactionQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(TransactionQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(TransactionQuerySchema.safeParse({ sort: 'amount' }).success).toBe(false);
  });
});

describe('TransactionDtoSchema', () => {
  it('przyjmuje ujemny efekt alokacji — wypłatę z puli (ADR-011)', () => {
    const result = TransactionDtoSchema.safeParse({
      id: ACCOUNT,
      type: 'transfer',
      status: 'posted',
      bookedOn: '2026-09-11',
      monthKey: '2026-09',
      amountMinor: 150_000,
      currency: 'PLN',
      accountId: SAVINGS,
      counterAccountId: ACCOUNT,
      categoryId: null,
      incomeSourceId: null,
      liabilityId: null,
      goalId: null,
      sourceAllocationClass: 'savings',
      targetAllocationClass: 'spending',
      allocationOverride: null,
      allocationEffects: [{ kind: 'savings', amountMinor: -150_000 }],
      description: null,
      merchant: null,
      notes: null,
      source: 'manual',
      sourceDocumentId: null,
      recurringOccurrenceId: null,
      plannedExpenseId: null,
      createdBy: ACCOUNT,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('metadane listy z podsumowaniem (ADR-038)', () => {
  const summary = {
    count: 2,
    expenseMinor: 12799,
    incomeMinor: 0,
    transferMinor: 0,
    days: [{ bookedOn: '2026-09-18', expenseMinor: 12799, incomeMinor: 0 }],
  };

  it('podsumowanie jest opcjonalne — kolejne strony go nie niosą', () => {
    expect(TransactionListMetaSchema.safeParse({ nextCursor: null, hasMore: false }).success).toBe(
      true,
    );
    expect(
      TransactionListMetaSchema.safeParse({ nextCursor: 'x', hasMore: true, summary }).success,
    ).toBe(true);
  });

  it('odrzuca ujemne sumy i nieistniejącą datę dnia', () => {
    const meta = { nextCursor: null, hasMore: false };
    expect(
      TransactionListMetaSchema.safeParse({ ...meta, summary: { ...summary, expenseMinor: -1 } })
        .success,
    ).toBe(false);
    expect(
      TransactionListMetaSchema.safeParse({
        ...meta,
        summary: {
          ...summary,
          days: [{ bookedOn: '2026-02-30', expenseMinor: 0, incomeMinor: 0 }],
        },
      }).success,
    ).toBe(false);
  });
});
