import type { HouseholdDto, SessionDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  backPostingLabel,
  backPostingOptions,
  householdFormFrom,
  limitChangeNote,
  pinFormErrors,
  postingFromLabel,
  sessionCaption,
  sessionName,
  toHouseholdPatch,
} from './settings-view.js';

/**
 * Testy reguł ekranu ustawień — `F8-1`
 * ([06 §3.12](../../../../../plans/06-ui-views.md#312-ustawienia--settings)).
 */

const HOUSEHOLD: HouseholdDto = {
  id: '01J9ZQK8WQ1111111111111111',
  name: 'Dom',
  baseCurrency: 'PLN',
  timezone: 'Europe/Warsaw',
  locale: 'pl-PL',
  backPostingLimitMonths: 1,
  monthStartDay: 1,
  defaultExpenseAccountId: null,
};

describe('backPostingOptions', () => {
  it('typowe wartości', () => {
    expect(backPostingOptions(1)).toEqual([0, 1, 2, 3, 6, 12]);
  });

  it('dokłada nietypową bieżącą wartość na swoim miejscu', () => {
    expect(backPostingOptions(4)).toEqual([0, 1, 2, 3, 4, 6, 12]);
  });
});

describe('backPostingLabel', () => {
  it('polska odmiana i przypadek zera', () => {
    expect(backPostingLabel(0)).toBe('tylko bieżący miesiąc');
    expect(backPostingLabel(1)).toBe('1 miesiąc wstecz');
    expect(backPostingLabel(3)).toBe('3 miesiące wstecz');
    expect(backPostingLabel(6)).toBe('6 miesięcy wstecz');
    expect(backPostingLabel(12)).toBe('12 miesięcy wstecz');
  });
});

describe('postingFromLabel', () => {
  it('liczy od pierwszego dnia miesiąca, także na przełomie roku', () => {
    expect(postingFromLabel('2026-09-25', 1)).toBe('od 1 sierpnia 2026');
    expect(postingFromLabel('2026-09-25', 0)).toBe('od 1 września 2026');
    expect(postingFromLabel('2026-01-31', 2)).toBe('od 1 listopada 2025');
  });
});

describe('limitChangeNote', () => {
  it('bez zmiany — brak komunikatu', () => {
    expect(limitChangeNote('2026-09-25', 1, 1)).toBeUndefined();
  });

  it('obniżenie ostrzega o zamknięciu z datą granicy', () => {
    expect(limitChangeNote('2026-09-25', 3, 0)).toBe(
      'Transakcji sprzed 1 września 2026 nie da się już zmienić ani usunąć — ich miesiące zostaną zamknięte.',
    );
  });

  it('podniesienie mówi, od kiedy znów można poprawiać', () => {
    expect(limitChangeNote('2026-09-25', 1, 6)).toBe(
      'Znów da się dopisywać i poprawiać transakcje od 1 marca 2026.',
    );
  });
});

describe('toHouseholdPatch', () => {
  it('bez zmian — puste ciało', () => {
    expect(toHouseholdPatch(HOUSEHOLD, householdFormFrom(HOUSEHOLD))).toEqual({
      ok: true,
      body: {},
    });
  });

  it('tylko zmienione pola, nazwa przycięta', () => {
    expect(
      toHouseholdPatch(HOUSEHOLD, {
        name: '  Dom na Woli ',
        timezone: 'Europe/Warsaw',
        backPostingLimitMonths: 3,
      }),
    ).toEqual({ ok: true, body: { name: 'Dom na Woli', backPostingLimitMonths: 3 } });
  });

  it('nazwa z samych spacji — ta sama po przycięciu nie jest zmianą', () => {
    expect(toHouseholdPatch(HOUSEHOLD, { ...householdFormFrom(HOUSEHOLD), name: ' Dom ' })).toEqual(
      { ok: true, body: {} },
    );
  });

  it('błędy przy polach — komunikaty ze schematu serwera', () => {
    expect(
      toHouseholdPatch(HOUSEHOLD, {
        name: '',
        timezone: 'Mars/Olympus',
        backPostingLimitMonths: 1,
      }),
    ).toEqual({
      ok: false,
      errors: { name: 'Nazwa jest wymagana', timezone: 'Nieznana strefa czasowa' },
    });
  });
});

describe('pinFormErrors', () => {
  const valid = { currentPin: '482915', newPin: '739164', confirmPin: '739164' };

  it('poprawny formularz — brak błędów', () => {
    expect(pinFormErrors(valid)).toEqual({});
  });

  it('obecny PIN za krótki', () => {
    expect(pinFormErrors({ ...valid, currentPin: '12' })).toEqual({
      currentPin: 'Wpisz obecny PIN (6–8 cyfr).',
    });
  });

  it('słaby nowy PIN — reguły z 09 §2.3', () => {
    expect(pinFormErrors({ ...valid, newPin: '123456', confirmPin: '123456' }).newPin).toBe(
      'PIN nie może być ciągiem kolejnych cyfr.',
    );
    expect(pinFormErrors({ ...valid, newPin: '111111', confirmPin: '111111' }).newPin).toBe(
      'PIN nie może składać się z jednej powtórzonej cyfry.',
    );
    expect(pinFormErrors({ ...valid, newPin: '12345', confirmPin: '12345' }).newPin).toBe(
      'PIN musi mieć co najmniej 6 cyfr.',
    );
  });

  it('nowy taki sam jak obecny', () => {
    expect(pinFormErrors({ ...valid, newPin: '482915', confirmPin: '482915' }).newPin).toBe(
      'Nowy PIN musi różnić się od obecnego.',
    );
  });

  it('powtórzenie się różni — błąd tylko przy powtórzeniu', () => {
    expect(pinFormErrors({ ...valid, confirmPin: '739165' })).toEqual({
      confirmPin: 'PIN-y się różnią.',
    });
  });
});

describe('sessionCaption i sessionName', () => {
  const session: SessionDto = {
    id: '01J9ZQK8WQ2222222222222222',
    deviceLabel: 'iPhone — Safari',
    current: false,
    sameDevice: false,
    lastUsedAt: Date.UTC(2026, 8, 25, 12, 2),
    createdAt: Date.UTC(2026, 8, 1),
    expiresAt: Date.UTC(2026, 9, 25),
  };

  it('bieżące urządzenie', () => {
    expect(sessionCaption({ ...session, current: true })).toBe('to urządzenie');
  });

  it('ostatnie użycie, a przy tym samym IP — „ta sama sieć”', () => {
    expect(sessionCaption(session)).toMatch(/^ostatnio 25 wrz/);
    expect(sessionCaption({ ...session, sameDevice: true })).toMatch(/ · ta sama sieć$/);
  });

  it('bez ostatniego użycia — chwila zalogowania', () => {
    expect(sessionCaption({ ...session, lastUsedAt: null })).toMatch(/^ostatnio 1 wrz/);
  });

  it('nazwa zastępcza bez etykiety', () => {
    expect(sessionName(session)).toBe('iPhone — Safari');
    expect(sessionName({ ...session, deviceLabel: null })).toBe('Nieznane urządzenie');
  });
});
