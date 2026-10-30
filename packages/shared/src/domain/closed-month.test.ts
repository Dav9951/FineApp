import { describe, expect, it } from 'vitest';

import { closedMonthMessage, frozenFieldChanges, isInClosedMonth } from './closed-month.js';

/**
 * Testy zamkniętych miesięcy
 * ([07 §1.4](../../../../plans/07-domain-rules.md#14-zamknięte-miesiące)).
 */

describe('isInClosedMonth', () => {
  it('limit 1 we wrześniu: sierpień otwarty, lipiec zamknięty', () => {
    expect(isInClosedMonth('2026-08-01', '2026-09-23', 1)).toBe(false);
    expect(isInClosedMonth('2026-07-31', '2026-09-23', 1)).toBe(true);
  });

  it('limit 0: zamknięty już poprzedni miesiąc', () => {
    expect(isInClosedMonth('2026-08-31', '2026-09-01', 0)).toBe(true);
    expect(isInClosedMonth('2026-09-01', '2026-09-01', 0)).toBe(false);
  });

  it('pierwszy dzień miesiąca przesuwa granicę — 1 października zamyka sierpień', () => {
    expect(isInClosedMonth('2026-08-31', '2026-09-30', 1)).toBe(false);
    expect(isInClosedMonth('2026-08-31', '2026-10-01', 1)).toBe(true);
  });

  it('bieżący i przyszły dzień nigdy nie są zamknięte', () => {
    expect(isInClosedMonth('2026-09-30', '2026-09-23', 0)).toBe(false);
  });
});

describe('closedMonthMessage', () => {
  it('mówi, co wolno, i wskazuje ustawienia', () => {
    expect(closedMonthMessage('edit', '2026-09-23', 1)).toBe(
      'Transakcja należy do zamkniętego miesiąca — można poprawić tylko opis, sprzedawcę i notatki. Zmiany są możliwe od 1 sierpnia 2026 — zmień limit w ustawieniach.',
    );
    expect(closedMonthMessage('delete', '2026-09-23', 1)).toMatch(/^Nie można usunąć/);
    expect(closedMonthMessage('restore', '2026-09-23', 1)).toMatch(/^Nie można przywrócić/);
  });
});

describe('frozenFieldChanges', () => {
  it('przepuszcza opisy, zatrzymuje wszystko, co zmienia liczby', () => {
    expect(frozenFieldChanges(['description', 'merchant', 'notes'])).toEqual([]);
    expect(frozenFieldChanges(['notes', 'amountMinor', 'categoryId'])).toEqual([
      'amountMinor',
      'categoryId',
    ]);
    expect(frozenFieldChanges([])).toEqual([]);
  });
});
