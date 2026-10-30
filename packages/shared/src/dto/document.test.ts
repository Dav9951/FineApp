import { describe, expect, it } from 'vitest';

import {
  AiUsageDtoSchema,
  CommitDocumentRequestSchema,
  UpdateDocumentItemRequestSchema,
  UploadDocumentFieldsSchema,
} from './document.js';
import { BulkCreateTransactionsRequestSchema } from './transaction.js';

/**
 * Testy kontraktów dokumentów
 * ([05 §12](../../../../plans/05-dto-contracts.md#12-dokumenty--ocr--dtodocumentdtots)).
 */

const ID = '01JP7K3M2N8Q4R5S6T7V8W9X0A';

describe('UploadDocumentFieldsSchema', () => {
  it('domyślnie paragon; puste pola formularza to brak', () => {
    expect(UploadDocumentFieldsSchema.parse({ accountId: '', monthHint: '' })).toEqual({
      kind: 'receipt',
      accountId: null,
      monthHint: null,
    });
  });

  it('przyjmuje konto i miesiąc; odrzuca rodzaj spoza listy', () => {
    expect(
      UploadDocumentFieldsSchema.parse({
        kind: 'bank_statement',
        accountId: ID,
        monthHint: '2026-09',
      }),
    ).toEqual({ kind: 'bank_statement', accountId: ID, monthHint: '2026-09' });
    expect(UploadDocumentFieldsSchema.safeParse({ kind: 'other' }).success).toBe(false);
  });
});

describe('CommitDocumentRequestSchema', () => {
  const base = { accountId: ID, bookedOn: '2026-09-18', itemIds: [ID] };

  it('single wymaga kategorii całości — istniejącej albo nowej po nazwie', () => {
    const missing = CommitDocumentRequestSchema.safeParse({ ...base, mode: 'single' });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.path).toEqual(['categoryId']);

    expect(
      CommitDocumentRequestSchema.safeParse({
        ...base,
        mode: 'single',
        categoryName: 'Chemia',
        createCategories: [{ name: 'Chemia', kind: 'expense' }],
      }).success,
    ).toBe(true);
  });

  it('split bez kategorii całości; createCategories domyślnie puste', () => {
    expect(CommitDocumentRequestSchema.parse({ ...base, mode: 'split' }).createCategories).toEqual(
      [],
    );
  });

  it('co najmniej jedna pozycja', () => {
    expect(
      CommitDocumentRequestSchema.safeParse({ ...base, mode: 'split', itemIds: [] }).success,
    ).toBe(false);
  });
});

describe('UpdateDocumentItemRequestSchema', () => {
  it('kwota dodatnia, status bez „merged"', () => {
    expect(UpdateDocumentItemRequestSchema.safeParse({ amountMinor: 0 }).success).toBe(false);
    expect(UpdateDocumentItemRequestSchema.safeParse({ reviewStatus: 'merged' }).success).toBe(
      false,
    );
    expect(UpdateDocumentItemRequestSchema.parse({ suggestedCategoryId: null })).toEqual({
      suggestedCategoryId: null,
    });
  });
});

describe('AiUsageDtoSchema', () => {
  it('brak limitu to remainingMinor = null', () => {
    expect(
      AiUsageDtoSchema.safeParse({
        enabled: true,
        model: 'claude-sonnet-5',
        monthKey: '2026-09',
        documentCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        spentMinor: 0,
        budgetMinor: 0,
        remainingMinor: null,
      }).success,
    ).toBe(true);
  });
});

describe('BulkCreateTransactionsRequestSchema', () => {
  it('od 1 do 100 transakcji', () => {
    const one = { type: 'expense', bookedOn: '2026-09-18', amountMinor: 100, accountId: ID };
    expect(BulkCreateTransactionsRequestSchema.safeParse({ transactions: [] }).success).toBe(false);
    expect(BulkCreateTransactionsRequestSchema.safeParse({ transactions: [one] }).success).toBe(
      true,
    );
    expect(
      BulkCreateTransactionsRequestSchema.safeParse({
        transactions: Array.from({ length: 101 }, () => one),
      }).success,
    ).toBe(false);
  });
});
