import { describe, expect, it } from 'vitest';

import { AllocationTrendQuerySchema, UpsertAllocationTargetRequestSchema } from './allocation.js';

/**
 * Testy kontraktów rozkładu docelowego
 * ([05 §10](../../../../plans/05-dto-contracts.md#10-rozkład-docelowy--dtoallocationdtots)).
 */

describe('UpsertAllocationTargetRequestSchema', () => {
  it('spłata długu domyślnie 0%, pusta notatka to brak', () => {
    expect(
      UpsertAllocationTargetRequestSchema.parse({
        effectiveFromMonth: '2026-10',
        savingsPercentBps: 2000,
        investmentPercentBps: 1000,
        note: ' ',
      }),
    ).toEqual({
      effectiveFromMonth: '2026-10',
      savingsPercentBps: 2000,
      investmentPercentBps: 1000,
      debtPercentBps: 0,
      note: null,
    });
  });

  it('udział jednej puli najwyżej 100% — suma może więcej (ostrzeżenie, nie błąd)', () => {
    const body = { effectiveFromMonth: '2026-10', investmentPercentBps: 0 };
    expect(
      UpsertAllocationTargetRequestSchema.safeParse({ ...body, savingsPercentBps: 10_001 }).success,
    ).toBe(false);
    expect(
      UpsertAllocationTargetRequestSchema.safeParse({
        ...body,
        savingsPercentBps: 10_000,
        investmentPercentBps: 5000,
      }).success,
    ).toBe(true);
  });
});

describe('AllocationTrendQuerySchema', () => {
  it('zakres rosnący, najwyżej 24 miesiące', () => {
    expect(AllocationTrendQuerySchema.safeParse({ from: '2025-10', to: '2027-09' }).success).toBe(
      true,
    );
    expect(AllocationTrendQuerySchema.safeParse({ from: '2025-09', to: '2027-09' }).success).toBe(
      false,
    );
    expect(AllocationTrendQuerySchema.safeParse({ from: '2026-10', to: '2026-09' }).success).toBe(
      false,
    );
    expect(AllocationTrendQuerySchema.safeParse({}).success).toBe(true);
  });
});
