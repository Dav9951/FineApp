import { describe, expect, it } from 'vitest';

import { IncomeSourceKindSchema } from './enums.js';
import { defaultCountsTowardAllocation } from './income-source.js';

/** Testy domyślnej podstawy celów procentowych (07 §2.3). */
describe('defaultCountsTowardAllocation', () => {
  it('zwrot podatku domyślnie nie zawyża podstawy', () => {
    expect(defaultCountsTowardAllocation('refund')).toBe(false);
  });

  it('każdy inny rodzaj domyślnie się liczy', () => {
    for (const kind of IncomeSourceKindSchema.options.filter((k) => k !== 'refund')) {
      expect(defaultCountsTowardAllocation(kind), kind).toBe(true);
    }
  });
});
