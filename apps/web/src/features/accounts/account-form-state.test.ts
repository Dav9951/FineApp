import type { AccountDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  accountFormFrom,
  effectiveAllocationClass,
  emptyAccountForm,
  formErrorsFromRequest,
  toCreateRequest,
  toUpdateRequest,
  type AccountFormState,
} from './account-form-state.js';

/**
 * Testy formularza konta — składanie żądań i reguła puli z 07 §2.1.
 */

const TODAY = '2026-09-23';

/**
 * Formularz z nadpisanymi polami.
 *
 * @param overrides - Nadpisane pola.
 * @returns Stan formularza.
 */
function form(overrides: Partial<AccountFormState> = {}): AccountFormState {
  return { ...emptyAccountForm(TODAY), name: 'ROR', ...overrides };
}

/** Konto bieżące z domyślną pulą. */
const ROR: AccountDto = {
  id: '01JB0000000000000000000001',
  name: 'ROR',
  type: 'checking',
  allocationClass: 'spending',
  currency: 'PLN',
  openingBalanceMinor: 123_450,
  openingBalanceOn: '2026-09-01',
  institution: 'mBank',
  color: null,
  icon: null,
  includeInNetWorth: true,
  sortOrder: 0,
  isArchived: false,
  createdAt: 1,
  updatedAt: 1,
};

describe('toCreateRequest', () => {
  it('pusty formularz ma dzisiejszą datę i zero salda', () => {
    const result = toCreateRequest(form());
    expect(result).toEqual({
      ok: true,
      body: {
        name: 'ROR',
        type: 'checking',
        openingBalanceMinor: 0,
        openingBalanceOn: TODAY,
        institution: null,
        includeInNetWorth: true,
      },
    });
  });

  it('nie wysyła puli, dopóki nie wybrano jej ręcznie — serwer wyprowadzi ją z rodzaju', () => {
    const result = toCreateRequest(form({ type: 'savings' }));
    expect(result.ok && 'allocationClass' in result.body).toBe(false);
    const forced = toCreateRequest(form({ allocationOverride: 'savings' }));
    expect(forced.ok && forced.body.allocationClass).toBe('savings');
  });

  it.each([
    ['1 234,56', false, 123_456],
    ['12', false, 1_200],
    ['12.5', false, 1_250],
    ['850', true, -85_000],
  ])('saldo „%s" (ujemne: %s) → %i groszy', (text, negative, expected) => {
    const result = toCreateRequest(form({ openingBalanceText: text, negative }));
    expect(result.ok && result.body.openingBalanceMinor).toBe(expected);
  });

  it.each([
    ['abc', 'Wpisz kwotę, np. 1 250,00'],
    ['12,555', 'Wpisz kwotę, np. 1 250,00'],
    ['-12', 'Wpisz kwotę bez minusa — saldo ujemne ustawisz przełącznikiem'],
  ])('saldo „%s" jest odrzucane', (text, message) => {
    expect(toCreateRequest(form({ openingBalanceText: text }))).toEqual({
      ok: false,
      errors: { openingBalanceText: message },
    });
  });

  it('pusta nazwa i zbyt długa instytucja wracają jako błędy pól', () => {
    const result = toCreateRequest(form({ name: '   ', institution: 'x'.repeat(61) }));
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(['institution', 'name']);
  });

  it('błąd salda i nazwy naraz — oba widoczne', () => {
    const result = toCreateRequest(form({ name: '', openingBalanceText: 'x' }));
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(['name', 'openingBalanceText']);
  });
});

describe('accountFormFrom', () => {
  it('saldo ujemne rozkłada na tekst bez minusa i przełącznik', () => {
    const state = accountFormFrom({ ...ROR, openingBalanceMinor: -5_005 });
    expect(state.openingBalanceText).toBe('50,05');
    expect(state.negative).toBe(true);
  });

  it('pula równa domyślnej nie jest nadpisaniem, inna — jest', () => {
    expect(accountFormFrom(ROR).allocationOverride).toBeNull();
    expect(accountFormFrom({ ...ROR, allocationClass: 'savings' }).allocationOverride).toBe(
      'savings',
    );
  });
});

describe('effectiveAllocationClass — podgląd reguły 07 §2.1', () => {
  it('nowe konto: domyślna z rodzaju albo wybrana', () => {
    expect(effectiveAllocationClass(form({ type: 'investment' }))).toBe('investment');
    expect(effectiveAllocationClass(form({ allocationOverride: 'savings' }))).toBe('savings');
  });

  it('edycja: nienadpisana podąża za rodzajem, nadpisana zostaje', () => {
    expect(effectiveAllocationClass(form({ type: 'savings' }), ROR)).toBe('savings');
    const cushion = { ...ROR, allocationClass: 'savings' as const };
    expect(effectiveAllocationClass({ ...accountFormFrom(cushion), type: 'cash' }, cushion)).toBe(
      'savings',
    );
  });
});

describe('toUpdateRequest', () => {
  it('bez zmian — puste ciało', () => {
    expect(toUpdateRequest(ROR, accountFormFrom(ROR))).toEqual({ ok: true, body: {} });
  });

  it('wysyła tylko zmienione pola; pusta instytucja to `null`', () => {
    const state = { ...accountFormFrom(ROR), name: ' ROR mBank ', institution: '' };
    expect(toUpdateRequest(ROR, state)).toEqual({
      ok: true,
      body: { name: 'ROR mBank', institution: null },
    });
  });

  it('zmiana rodzaju bez ręcznej puli nie wysyła puli — przeliczy ją serwer', () => {
    const state = { ...accountFormFrom(ROR), type: 'savings' as const };
    expect(toUpdateRequest(ROR, state)).toEqual({ ok: true, body: { type: 'savings' } });
  });

  it('ręcznie wybrana pula idzie przy zmianie rodzaju, nawet gdy jest ta sama', () => {
    const state = {
      ...accountFormFrom(ROR),
      type: 'savings' as const,
      allocationOverride: 'spending' as const,
    };
    expect(toUpdateRequest(ROR, state)).toEqual({
      ok: true,
      body: { type: 'savings', allocationClass: 'spending' },
    });
  });

  it('zmiana salda na ujemne i przełącznika majątku', () => {
    const state = { ...accountFormFrom(ROR), negative: true, includeInNetWorth: false };
    expect(toUpdateRequest(ROR, state)).toEqual({
      ok: true,
      body: { openingBalanceMinor: -123_450, includeInNetWorth: false },
    });
  });

  it('błędny formularz nie daje ciała', () => {
    expect(toUpdateRequest(ROR, { ...accountFormFrom(ROR), name: '' }).ok).toBe(false);
  });
});

describe('formErrorsFromRequest', () => {
  it('tłumaczy pola żądania na pola formularza i pomija nieznane', () => {
    expect(
      formErrorsFromRequest({
        openingBalanceMinor: 'Kwota poza zakresem',
        allocationClass: 'Zła pula',
        color: 'Zły kolor',
      }),
    ).toEqual({ openingBalanceText: 'Kwota poza zakresem', allocationOverride: 'Zła pula' });
  });
});
