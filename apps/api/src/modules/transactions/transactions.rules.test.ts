import { describe, expect, it } from 'vitest';

import { isAppError } from '../../core/errors.js';
import {
  affectedMonths,
  decodeCursor,
  encodeCursor,
  postingWindowViolation,
} from './transactions.rules.js';

/**
 * Testy czystych reguł transakcji: okno księgowania (I-8), kursor, miesiące do
 * unieważnienia.
 */

describe('postingWindowViolation — I-8 (07 §1.3)', () => {
  it('limit 1: przez cały wrzesień wolno od 1 sierpnia do 30 września włącznie', () => {
    expect(postingWindowViolation('2026-08-01', '2026-09-30', 1, 1)).toBeNull();
    expect(postingWindowViolation('2026-09-30', '2026-09-01', 1, 1)).toBeNull();
  });

  it('dzień przed granicą dolną jest odrzucany z komunikatem z 07 §1.3', () => {
    expect(postingWindowViolation('2026-07-31', '2026-09-23', 1, 1)).toBe(
      'Nie można księgować przed 1 sierpnia 2026. Zmień limit w ustawieniach.',
    );
  });

  it('dzień po końcu bieżącego miesiąca jest odrzucany', () => {
    expect(postingWindowViolation('2026-10-01', '2026-09-23', 1, 1)).toBe(
      'Nie można księgować po 30 września 2026 — przyszłe płatności zaplanuj jako pozycję cykliczną.',
    );
  });

  it('limit 0: tylko bieżący miesiąc', () => {
    expect(postingWindowViolation('2026-09-01', '2026-09-23', 0, 1)).toBeNull();
    expect(postingWindowViolation('2026-08-31', '2026-09-23', 0, 1)).not.toBeNull();
  });

  it('granica roku i luty przestępny', () => {
    expect(postingWindowViolation('2025-12-01', '2026-01-15', 1, 1)).toBeNull();
    expect(postingWindowViolation('2025-11-30', '2026-01-15', 1, 1)).not.toBeNull();
    expect(postingWindowViolation('2028-02-29', '2028-02-01', 1, 1)).toBeNull();
    expect(postingWindowViolation('2028-03-01', '2028-02-29', 1, 1)).not.toBeNull();
  });
});

describe('affectedMonths', () => {
  it('bez powtórzeń i rosnąco', () => {
    expect(affectedMonths('2026-09', '2026-09')).toEqual(['2026-09']);
    expect(affectedMonths('2026-09', '2026-08')).toEqual(['2026-08', '2026-09']);
  });
});

describe('kursor', () => {
  const row = {
    id: '01JB0000000000000000000001',
    bookedOn: '2026-09-18',
    amountMinor: 12_799,
    createdAt: 1_789_660_800_000,
  };

  it.each([
    ['bookedOn:desc', '2026-09-18'],
    ['bookedOn:asc', '2026-09-18'],
    ['amount:desc', 12_799],
    ['amount:asc', 12_799],
    ['createdAt:desc', 1_789_660_800_000],
  ] as const)('%s — koduje i odczytuje tę samą pozycję', (sort, value) => {
    expect(decodeCursor(encodeCursor(sort, row), sort)).toEqual({ value, id: row.id });
  });

  /**
   * Zwraca błąd rzucony przez odczyt kursora.
   *
   * @param cursor - Kursor.
   * @returns Złapany błąd.
   */
  function failure(cursor: string): unknown {
    try {
      decodeCursor(cursor, 'bookedOn:desc');
    } catch (error) {
      return error;
    }
    return undefined;
  }

  /**
   * Koduje dowolny ładunek tak jak prawdziwy kursor.
   *
   * @param payload - Ładunek.
   * @returns Kursor.
   */
  function forge(payload: unknown): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  it.each([
    ['śmieci', 'to-nie-jest-kursor'],
    ['JSON, ale nie obiekt', forge(42)],
    ['null', forge(null)],
    ['inne sortowanie', encodeCursor('amount:desc', row)],
    ['zła wartość daty', forge({ s: 'bookedOn:desc', v: '2026-02-31', i: row.id })],
    ['liczba zamiast daty', forge({ s: 'bookedOn:desc', v: 5, i: row.id })],
    ['zły identyfikator', forge({ s: 'bookedOn:desc', v: '2026-09-18', i: 'x' })],
  ])('odrzuca: %s → 400', (_label, cursor) => {
    const error = failure(cursor);
    expect(isAppError(error) && error.statusCode).toBe(400);
  });

  it('kwota w kursorze musi być liczbą całkowitą', () => {
    const cursor = forge({ s: 'amount:desc', v: '100', i: row.id });
    expect(() => decodeCursor(cursor, 'amount:desc')).toThrow();
  });
});
