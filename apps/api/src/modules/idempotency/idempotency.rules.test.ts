import { describe, expect, it } from 'vitest';

import { canonicalJson, requestHash } from './idempotency.rules.js';

/** Testy odcisku ciała żądania (ADR-037). */

describe('canonicalJson', () => {
  it('kolejność kluczy nie ma znaczenia, także w zagnieżdżeniu', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }),
    );
  });

  it('pole `undefined` to brak pola, ale `null` to wartość', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson({ a: 1, b: null })).not.toBe(canonicalJson({ a: 1 }));
  });

  it('kolejność elementów tablicy ma znaczenie', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('wartości proste i znaki specjalne w kluczach', () => {
    expect(canonicalJson('ż"')).toBe('"ż\\""');
    expect(canonicalJson({ 'a"b': true })).toBe('{"a\\"b":true}');
    expect(canonicalJson(undefined)).toBe('null');
  });
});

describe('requestHash', () => {
  it('ten sam odcisk dla tych samych danych, inny dla innej kwoty', () => {
    const body = { type: 'expense', amountMinor: 12_799 };
    expect(requestHash(body)).toBe(requestHash({ amountMinor: 12_799, type: 'expense' }));
    expect(requestHash(body)).not.toBe(requestHash({ ...body, amountMinor: 12_800 }));
    expect(requestHash(body)).toMatch(/^[0-9a-f]{64}$/);
  });
});
