import { IdSchema } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import { newClientId } from './client-id.js';

describe('newClientId', () => {
  it('daje identyfikator przyjmowany przez kontrakt, rosnący z czasem', () => {
    const a = newClientId(1_795_341_600_000);
    const b = newClientId(1_795_341_600_001);
    expect(IdSchema.safeParse(a).success).toBe(true);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
    expect(newClientId()).not.toBe(newClientId());
  });
});
