import { describe, expect, it } from 'vitest';

import { allocationEffects, type AllocationSnapshot } from './allocation.js';
import type { AllocationClass } from './enums.js';

/**
 * Testy efektów alokacji
 * ([07 §2.2](../../../../plans/07-domain-rules.md#22-wpływ-przelewu-na-pule--ujęcie-netto),
 * [§2.2a](../../../../plans/07-domain-rules.md#22a-spłata-zobowiązań), I-7, I-7a).
 */

/**
 * Buduje przelew z podanymi klasami kont.
 *
 * @param source - Klasa konta źródłowego.
 * @param target - Klasa konta docelowego.
 * @param overrides - Nadpisane pola.
 * @returns Migawka przelewu.
 */
function transfer(
  source: AllocationClass,
  target: AllocationClass,
  overrides: Partial<AllocationSnapshot> = {},
): AllocationSnapshot {
  return {
    type: 'transfer',
    amountMinor: 200_000,
    sourceAllocationClass: source,
    targetAllocationClass: target,
    allocationOverride: null,
    liabilityId: null,
    ...overrides,
  };
}

describe('allocationEffects — przelewy (tabela 07 §2.2)', () => {
  it.each([
    ['spending', 'savings', [{ kind: 'savings', amountMinor: 200_000 }]],
    ['spending', 'investment', [{ kind: 'investment', amountMinor: 200_000 }]],
    ['savings', 'spending', [{ kind: 'savings', amountMinor: -200_000 }]],
    ['investment', 'spending', [{ kind: 'investment', amountMinor: -200_000 }]],
    [
      'savings',
      'investment',
      [
        { kind: 'investment', amountMinor: 200_000 },
        { kind: 'savings', amountMinor: -200_000 },
      ],
    ],
    [
      'investment',
      'savings',
      [
        { kind: 'savings', amountMinor: 200_000 },
        { kind: 'investment', amountMinor: -200_000 },
      ],
    ],
  ] as const)('%s → %s', (source, target, expected) => {
    expect(allocationEffects(transfer(source, target))).toEqual(expected);
  });

  it.each(['spending', 'savings', 'investment'] as const)(
    'I-7: przelew w obrębie klasy %s jest neutralny',
    (cls) => {
      expect(allocationEffects(transfer(cls, cls))).toEqual([]);
    },
  );

  it('nadpisanie `none` wyłącza oba efekty, także przelewu między pulami', () => {
    expect(
      allocationEffects(transfer('savings', 'investment', { allocationOverride: 'none' })),
    ).toEqual([]);
  });

  it('nadpisanie puli wymusza jeden efekt dodatni, nawet przy tej samej klasie', () => {
    expect(
      allocationEffects(transfer('spending', 'spending', { allocationOverride: 'savings' })),
    ).toEqual([{ kind: 'savings', amountMinor: 200_000 }]);
    expect(
      allocationEffects(transfer('savings', 'spending', { allocationOverride: 'investment' })),
    ).toEqual([{ kind: 'investment', amountMinor: 200_000 }]);
  });

  it('przelew bez migawek (łamie I-5) jest neutralny, a nie zgadywany', () => {
    expect(
      allocationEffects(transfer('spending', 'savings', { sourceAllocationClass: null })),
    ).toEqual([]);
  });

  it('powiązanie przelewu ze zobowiązaniem nie tworzy spłaty długu', () => {
    expect(allocationEffects(transfer('spending', 'spending', { liabilityId: 'L' }))).toEqual([]);
  });
});

describe('allocationEffects — wydatki i przychody (07 §2.2a)', () => {
  /** Wydatek bez migawek klas. */
  const expense: AllocationSnapshot = {
    type: 'expense',
    amountMinor: 150_000,
    sourceAllocationClass: null,
    targetAllocationClass: null,
    allocationOverride: null,
    liabilityId: null,
  };

  it('zwykły wydatek nie rusza żadnej puli', () => {
    expect(allocationEffects(expense)).toEqual([]);
  });

  it('rata zobowiązania liczy się do spłaty długu w pełnej, dodatniej kwocie', () => {
    expect(allocationEffects({ ...expense, liabilityId: 'L' })).toEqual([
      { kind: 'debt_repayment', amountMinor: 150_000 },
    ]);
  });

  it('I-7a: rata wyłączona przez `none` nie liczy się do spłaty', () => {
    expect(allocationEffects({ ...expense, liabilityId: 'L', allocationOverride: 'none' })).toEqual(
      [],
    );
  });

  it('przychód — także powiązany ze zobowiązaniem — nie jest spłatą', () => {
    expect(allocationEffects({ ...expense, type: 'income' })).toEqual([]);
    expect(allocationEffects({ ...expense, type: 'income', liabilityId: 'L' })).toEqual([]);
  });
});
