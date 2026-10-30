import { describe, expect, it } from 'vitest';

import {
  ARGON2_OPTIONS,
  dummyPinHash,
  generatePin,
  hashPin,
  verifyPin,
  warmUpDummyPinHash,
} from './auth.pin.js';

/**
 * Testy haszowania PIN-u
 * ([09 §2.2](../../../../../../plans/09-security-auth.md#22-parametry-argon2id)).
 *
 * Testy są wolne z założenia: jedno haszowanie to ~50–100 ms i taki właśnie ma być
 * koszt dla atakującego. Obniżenie parametrów „żeby testy śmigały" zabrałoby jedyną
 * realną barierę przy sekrecie o milionie kombinacji.
 */

describe('ARGON2_OPTIONS', () => {
  it('trzyma parametry z 09 §2.2', () => {
    expect(ARGON2_OPTIONS.memoryCost).toBe(65_536);
    expect(ARGON2_OPTIONS.timeCost).toBe(3);
    expect(ARGON2_OPTIONS.parallelism).toBe(1);
  });
});

describe('hashPin i verifyPin', () => {
  it('hash zawiera sól i parametry, więc dwa razy ten sam PIN daje różne hashe', async () => {
    const [first, second] = await Promise.all([hashPin('483920'), hashPin('483920')]);

    expect(first).not.toBe(second);
    expect(first).toMatch(/^\$argon2id\$/);
    expect(first).toContain('m=65536');
    expect(first).toContain('t=3');
  });

  it('potwierdza poprawny PIN i odrzuca błędny', async () => {
    const hash = await hashPin('483920');

    await expect(verifyPin(hash, '483920')).resolves.toBe(true);
    await expect(verifyPin(hash, '483921')).resolves.toBe(false);
  });

  it('uszkodzony hash daje fałsz, nie wyjątek', async () => {
    // Wyjątek z tego miejsca wróciłby jako 500 i odróżniałby konto z popsutym hashem
    // od konta nieistniejącego — czyli zdradzałby, które adresy istnieją.
    await expect(verifyPin('to-nie-jest-hash', '483920')).resolves.toBe(false);
    await expect(verifyPin('', '483920')).resolves.toBe(false);
  });

  it('PIN-u nie widać w hashu', async () => {
    const hash = await hashPin('483920');
    expect(hash).not.toContain('483920');
  });
});

describe('dummyPinHash', () => {
  it('jest liczona raz i da się nią weryfikować', async () => {
    const [first, second] = await Promise.all([dummyPinHash(), dummyPinHash()]);

    expect(first).toBe(second);
    // Atrapa nie może przypadkiem pasować do PIN-u, który ktoś poda.
    await expect(verifyPin(first, '483920')).resolves.toBe(false);
  });
});

describe('warmUpDummyPinHash', () => {
  it('liczy atrapę z wyprzedzeniem, więc pierwsze żądanie nie płaci za nią czasem', async () => {
    await warmUpDummyPinHash();

    const started = performance.now();
    await dummyPinHash();
    expect(performance.now() - started).toBeLessThan(5);
  });
});

describe('generatePin', () => {
  it('losuje PIN o zadanej długości, złożony z samych cyfr', () => {
    for (let round = 0; round < 20; round += 1) {
      const pin = generatePin(6, 6, 8);
      expect(pin).toMatch(/^\d{6}$/);
    }
  });

  it('nie wypuszcza PIN-u łamiącego reguły z 09 §2.3', () => {
    const forbidden = new Set(['111111', '123456', '654321', '121212', '123123']);

    for (let round = 0; round < 200; round += 1) {
      expect(forbidden.has(generatePin(6, 6, 8))).toBe(false);
    }
  });

  it('losuje różne PIN-y', () => {
    const drawn = new Set(Array.from({ length: 30 }, () => generatePin(6, 6, 8)));
    expect(drawn.size).toBeGreaterThan(20);
  });

  it('odmawia, gdy żaden PIN o danej długości nie spełnia reguł', () => {
    // Długość poza zakresem konfiguracji: każda próba zostanie odrzucona,
    // więc pętla musi się poddać zamiast kręcić w nieskończoność.
    expect(() => generatePin(4, 6, 8)).toThrow(RangeError);
  });
});
