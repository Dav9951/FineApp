import { describe, expect, it } from 'vitest';

import {
  checkPin,
  isPinAcceptable,
  PIN_ABSOLUTE_MAX_LENGTH,
  PIN_ABSOLUTE_MIN_LENGTH,
  type PinRejection,
} from './pin.js';

/**
 * Testy reguł PIN-u ([09 §2.3](../../../../plans/09-security-auth.md#23-wymagania-wobec-pinu)).
 *
 * PIN sześciocyfrowy to milion kombinacji, a lista popularnych wzorców zbija tę liczbę
 * do kilkudziesięciu — dlatego każdą regułę sprawdzamy osobno, łącznie z tym,
 * że **nie** odrzuca PIN-ów poprawnych.
 */

/**
 * Zwraca powód odrzucenia albo `null`, gdy PIN przeszedł.
 *
 * Wynik `checkPin` to unia rozłączna, więc `reason` nie istnieje na wariancie zgody —
 * ten helper zawęża typ raz, zamiast rozsypywać asercje po całym pliku.
 *
 * @param pin - PIN do sprawdzenia.
 * @param minLength - Minimalna długość.
 * @param maxLength - Maksymalna długość.
 * @returns Powód odrzucenia albo `null`.
 */
function reasonOf(pin: string, minLength = 6, maxLength = 8): PinRejection | null {
  const result = checkPin(pin, minLength, maxLength);
  return result.ok ? null : result.reason;
}

describe('checkPin', () => {
  it('przepuszcza PIN bez wzorca', () => {
    expect(checkPin('483920')).toEqual({ ok: true });
    expect(checkPin('7391', 4, 8)).toEqual({ ok: true });
    expect(checkPin('9048372', 6, 8)).toEqual({ ok: true });
  });

  it('odrzuca wszystko, co nie jest cyframi', () => {
    for (const pin of ['12a456', '12 456', '', '−123456', '12.456']) {
      expect(reasonOf(pin)).toBe('not-digits');
    }
  });

  it('pilnuje długości z konfiguracji i mówi, ile brakuje', () => {
    const short = checkPin('4839', 6, 8);
    expect(short).toMatchObject({ reason: 'too-short' });
    expect(short.ok ? '' : short.message).toContain('6');

    const long = checkPin('483920174', 6, 8);
    expect(long).toMatchObject({ reason: 'too-long' });
    expect(long.ok ? '' : long.message).toContain('8');
  });

  it('odrzuca jedną powtórzoną cyfrę', () => {
    for (const pin of ['111111', '000000', '77777777']) {
      expect(reasonOf(pin)).toBe('same-digit');
    }
  });

  it('odrzuca ciągi rosnące i malejące', () => {
    for (const pin of ['123456', '654321', '456789', '987654', '3456', '65432']) {
      expect(reasonOf(pin, 4, 8)).toBe('sequence');
    }
  });

  it('ciąg o kroku innym niż jeden nie jest ciągiem', () => {
    // `135790` jest odrzucane, ale jako PIN popularny, nie jako ciąg — reguły się
    // nie nakładają i komunikat mówi prawdę o powodzie.
    expect(reasonOf('135790')).toBe('common');
  });

  it('odrzuca popularne wzorce klawiaturowe', () => {
    for (const pin of ['121212', '123123', '112233', '159753', '789456', '696969']) {
      expect(reasonOf(pin)).toBe('common');
    }
  });

  it('komunikat jest po polsku i nadaje się wprost do interfejsu', () => {
    const result = checkPin('111111');
    expect(result.ok ? '' : result.message).toBe(
      'PIN nie może składać się z jednej powtórzonej cyfry.',
    );
  });

  it('domyślny zakres to 6–8 cyfr', () => {
    expect(reasonOf('48392')).toBe('too-short');
    expect(reasonOf('483920174')).toBe('too-long');
  });

  it('granice kontraktu są sensowne', () => {
    expect(PIN_ABSOLUTE_MIN_LENGTH).toBe(4);
    expect(PIN_ABSOLUTE_MAX_LENGTH).toBe(12);
  });
});

describe('isPinAcceptable', () => {
  it('sprowadza wynik do odpowiedzi tak/nie', () => {
    expect(isPinAcceptable('483920')).toBe(true);
    expect(isPinAcceptable('123456')).toBe(false);
  });
});
