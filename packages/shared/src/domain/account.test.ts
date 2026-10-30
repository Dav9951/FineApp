import { describe, expect, it } from 'vitest';

import { allocationClassAfterTypeChange, defaultAllocationClass } from './account.js';
import { AccountTypeSchema } from './enums.js';

/**
 * Testy klasyfikacji kont
 * ([07 §2.1](../../../../plans/07-domain-rules.md#21-klasyfikacja-kont)).
 */

describe('defaultAllocationClass', () => {
  it('odwzorowuje każdy rodzaj konta zgodnie z tabelą 07 §2.1', () => {
    expect(defaultAllocationClass('checking')).toBe('spending');
    expect(defaultAllocationClass('cash')).toBe('spending');
    expect(defaultAllocationClass('savings')).toBe('savings');
    expect(defaultAllocationClass('investment')).toBe('investment');
    expect(defaultAllocationClass('other')).toBe('spending');
  });

  it('ma odpowiedź dla każdego rodzaju z enuma', () => {
    for (const type of AccountTypeSchema.options) {
      expect(defaultAllocationClass(type)).toBeDefined();
    }
  });
});

describe('allocationClassAfterTypeChange', () => {
  it('klasa nienadpisana podąża za nowym rodzajem', () => {
    expect(allocationClassAfterTypeChange('checking', 'spending', 'savings')).toBe('savings');
    expect(allocationClassAfterTypeChange('savings', 'savings', 'investment')).toBe('investment');
  });

  it('klasa nadpisana zostaje, nawet gdy rodzaj się zmienia', () => {
    // Rachunek bieżący używany jako poduszka — zmiana na „gotówkę" nie cofa decyzji.
    expect(allocationClassAfterTypeChange('checking', 'savings', 'cash')).toBe('savings');
  });

  it('zmiana między rodzajami o tej samej klasie niczego nie zmienia', () => {
    expect(allocationClassAfterTypeChange('checking', 'spending', 'other')).toBe('spending');
  });
});
