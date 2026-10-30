import { describe, expect, it } from 'vitest';

import { testConfig } from '../../../test/build-app.js';
import {
  attemptRules,
  checkLoginAllowed,
  longestWindowSeconds,
  type AttemptRecord,
} from './auth.attempts.js';

/**
 * Testy limitu prób ([09 §2.5](../../../../../../plans/09-security-auth.md#25-limitowanie-prób)).
 *
 * To jest druga z trzech warstw chroniących sześciocyfrowy PIN. Błąd tutaj nie objawia
 * się awarią — objawia się tym, że zgadywanie znowu zaczyna być opłacalne.
 */

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const RULES = attemptRules(testConfig());

/**
 * Buduje ciąg nieudanych prób cofających się od wskazanej chwili.
 *
 * @param count - Liczba prób.
 * @param spacingMs - Odstęp między próbami.
 * @param endAt - Chwila ostatniej próby.
 * @returns Lista prób.
 */
function failures(count: number, spacingMs = MINUTE, endAt = NOW): AttemptRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    succeeded: false,
    createdAt: endAt - index * spacingMs,
  }));
}

describe('attemptRules', () => {
  it('pierwszy próg bierze z konfiguracji, dalsze są stałe', () => {
    const rules = attemptRules(testConfig());

    expect(rules[0]).toMatchObject({ scope: 'email', threshold: 5, blockSeconds: 900 });
    expect(rules[1]).toMatchObject({ scope: 'email', threshold: 10, blockSeconds: 3600 });
    expect(rules[2]).toMatchObject({ scope: 'email', threshold: 20, blockSeconds: 86_400 });
    expect(rules[3]).toMatchObject({ scope: 'ip', threshold: 20 });
  });

  it('pierwszy próg da się zestroić konfiguracją', () => {
    const rules = attemptRules(
      testConfig({ auth: { ...testConfig().auth, maxFailedAttempts: 3, lockoutSeconds: 60 } }),
    );
    expect(rules[0]).toMatchObject({ threshold: 3, blockSeconds: 60 });
  });

  it('najdłuższe okno to doba — tyle historii trzeba pobrać', () => {
    expect(longestWindowSeconds(RULES)).toBe(86_400);
  });
});

describe('checkLoginAllowed', () => {
  it('przepuszcza, gdy nie było prób', () => {
    expect(checkLoginAllowed(RULES, [], [], NOW)).toEqual({ allowed: true });
  });

  it('przepuszcza cztery nieudane próby, blokuje po piątej', () => {
    expect(checkLoginAllowed(RULES, failures(4), [], NOW).allowed).toBe(true);

    const gate = checkLoginAllowed(RULES, failures(5), [], NOW);
    expect(gate.allowed).toBe(false);
    expect(gate.allowed ? 0 : gate.rule.threshold).toBe(5);
  });

  it('blokada biegnie od ostatniej próby, nie od pierwszej', () => {
    // Pięć prób co minutę, ostatnia dwie minuty temu → zostaje 13 minut z 15.
    const gate = checkLoginAllowed(RULES, failures(5, MINUTE, NOW - 2 * MINUTE), [], NOW);
    expect(gate.allowed ? 0 : gate.retryAfterSeconds).toBe(13 * 60);
  });

  it('po wygaśnięciu blokady znowu przepuszcza', () => {
    const gate = checkLoginAllowed(RULES, failures(5, MINUTE, NOW - 16 * MINUTE), [], NOW);
    expect(gate.allowed).toBe(true);
  });

  it('próby spoza okna nie liczą się wcale', () => {
    const old = failures(5, MINUTE, NOW - 2 * HOUR);
    expect(checkLoginAllowed(RULES, old, [], NOW).allowed).toBe(true);
  });

  it('udane logowanie kasuje bieżącą blokadę adresu', () => {
    // Cztery pomyłki, potem trafiony PIN: licznik nie może stać na czwórce.
    const attempts: AttemptRecord[] = [
      ...failures(4, MINUTE, NOW - 5 * MINUTE),
      { succeeded: true, createdAt: NOW - 4 * MINUTE },
      { succeeded: false, createdAt: NOW - MINUTE },
    ];
    expect(checkLoginAllowed(RULES, attempts, [], NOW).allowed).toBe(true);
  });

  it('udane logowanie NIE kasuje licznika dla adresu IP', () => {
    // Atakujący zgadł PIN do jednego konta — to nie może wyzerować mu licznika,
    // z którym dobija się do drugiego (09 §2.5).
    // Odstęp 30 s, żeby wszystkie dwadzieścia zmieściło się w oknie 15 minut.
    const ipAttempts: AttemptRecord[] = [
      ...failures(20, MINUTE / 2, NOW - 2 * MINUTE),
      { succeeded: true, createdAt: NOW - MINUTE },
    ];
    const gate = checkLoginAllowed(RULES, [], ipAttempts, NOW);
    expect(gate.allowed).toBe(false);
    expect(gate.allowed ? '' : gate.rule.scope).toBe('ip');
  });

  it('dziesięć prób w godzinie blokuje na godzinę', () => {
    // Rozrzucone co 4 minuty i zakończone 16 minut temu: w oknie 15 minut nie ma
    // żadnej, w oknie godzinnym jest cała dziesiątka — decyduje próg 10/1 h.
    const attempts = failures(10, 4 * MINUTE, NOW - 16 * MINUTE);
    const gate = checkLoginAllowed(RULES, attempts, [], NOW);

    expect(gate.allowed).toBe(false);
    expect(gate.allowed ? 0 : gate.rule.blockSeconds).toBe(3600);
  });

  it('z kilku reguł wygrywa ta, która każe czekać najdłużej', () => {
    const attempts = failures(20, MINUTE / 2, NOW);
    const gate = checkLoginAllowed(RULES, attempts, [], NOW);

    expect(gate.allowed).toBe(false);
    // 5/15 min każe czekać 15 minut, 20/24 h — całą dobę.
    expect(gate.allowed ? 0 : gate.retryAfterSeconds).toBe(86_400);
  });

  it('kolejność prób na wejściu nie ma znaczenia', () => {
    const attempts = failures(5, MINUTE, NOW - 2 * MINUTE);
    const forward = checkLoginAllowed(RULES, attempts, [], NOW);
    const reversed = checkLoginAllowed(RULES, [...attempts].reverse(), [], NOW);

    expect(forward).toEqual(reversed);
  });
});
