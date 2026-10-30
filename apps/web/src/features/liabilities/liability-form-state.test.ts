import type { LiabilityDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  derivedField,
  editLinked,
  emptyLiabilityForm,
  formErrorsFromRequest,
  installmentBreakdown,
  liabilityFormFrom,
  linkedValues,
  toCreateRequest,
  toUpdateRequest,
  type LiabilityFormState,
} from './liability-form-state.js';

/**
 * Testy formularza zobowiązania — „dwa z trzech" i żądania
 * ([06 §3.8](../../../../../plans/06-ui-views.md#38-zobowiązania--liabilities)).
 */

const TODAY = '2026-09-23';
const ROR = '01JB0000000000000000000001';

/**
 * Formularz z wpisanymi polami powiązanymi w podanej kolejności.
 *
 * @param edits - Pary pole → tekst, od najstarszej.
 * @returns Stan.
 */
function typed(...edits: [Parameters<typeof editLinked>[1], string][]): LiabilityFormState {
  return edits.reduce((state, [field, text]) => editLinked(state, field, text), {
    ...emptyLiabilityForm(TODAY),
    name: 'Telefon',
  });
}

describe('dwa z trzech', () => {
  it('kwota i rata → liczba rat (w górę)', () => {
    const state = typed(['remaining', '2500'], ['monthly', '500']);
    expect(derivedField(state)).toBe('installments');
    expect(linkedValues(state)).toMatchObject({ installments: 5, derivedText: '5' });
    expect(linkedValues(typed(['remaining', '2500,01'], ['monthly', '500'])).installments).toBe(6);
  });

  it('kwota i liczba rat → rata (w górę, w groszach)', () => {
    const state = typed(['remaining', '1000'], ['installments', '3']);
    expect(derivedField(state)).toBe('monthly');
    expect(linkedValues(state)).toMatchObject({ monthlyMinor: 33_334, derivedText: '333,34' });
  });

  it('rata i liczba rat → kwota', () => {
    const state = typed(['monthly', '1850'], ['installments', '163']);
    expect(derivedField(state)).toBe('remaining');
    expect(linkedValues(state)).toMatchObject({
      remainingMinor: 30_155_000,
      derivedText: '301550',
    });
  });

  it('edycja pola wyliczanego: rola przechodzi na najdawniej dotknięte', () => {
    const state = typed(['remaining', '2500'], ['monthly', '500']);
    // Liczba rat była wyliczana (5); użytkownik wpisuje 4 — najdawniej dotknięta była
    // kwota, więc teraz ona jest wyliczana: 4 × 500 zł.
    const next = editLinked(state, 'installments', '4');
    expect(derivedField(next)).toBe('remaining');
    expect(linkedValues(next).remainingMinor).toBe(200_000);
  });

  it('niepełne dane — puste pole wyliczane, bez NaN', () => {
    expect(linkedValues(typed(['remaining', '2500'])).derivedText).toBe('');
    expect(linkedValues(typed(['remaining', 'abc'], ['monthly', '500'])).installments).toBeNull();
  });
});

describe('toCreateRequest', () => {
  it('ciało z reguły na ratę: kwota, rata, okres, dzień, konto', () => {
    const state = {
      ...typed(['remaining', '2 500,00'], ['monthly', '500']),
      paymentDayText: '20',
      paymentAccountId: ROR,
    };
    const result = toCreateRequest(state);
    expect(result.ok && result.body).toMatchObject({
      name: 'Telefon',
      openingBalanceMinor: 250_000,
      monthlyPaymentMinor: 50_000,
      installmentsRemainingAtAsOf: 5,
      balanceAsOf: TODAY,
      paymentDay: 20,
      paymentAccountId: ROR,
      createRecurringRule: true,
    });
  });

  it('reguła bez konta i dnia — te same błędy co serwer', () => {
    const result = toCreateRequest(typed(['remaining', '2500'], ['monthly', '500']));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(['paymentAccountId', 'paymentDayText']);
  });

  it('najbliższa rata: puste — brak, data — wysłana; przed „Na dzień" — błąd pola (ADR-068)', () => {
    const base = {
      ...typed(['remaining', '2500'], ['monthly', '500']),
      createRecurringRule: false,
    };
    const none = toCreateRequest(base);
    expect(none.ok && none.body.firstPaymentOn).toBeNull();
    const later = toCreateRequest({ ...base, firstPaymentOn: '2026-11-10' });
    expect(later.ok && later.body.firstPaymentOn).toBe('2026-11-10');
    const before = toCreateRequest({ ...base, firstPaymentOn: '2026-01-10' });
    expect(before.ok).toBe(false);
    if (before.ok) return;
    expect(Object.keys(before.errors)).toEqual(['firstPaymentOn']);
  });

  it('brak kwot i zły dzień — własne komunikaty', () => {
    const result = toCreateRequest({
      ...emptyLiabilityForm(TODAY),
      name: 'X',
      createRecurringRule: false,
      paymentDayText: '40',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject({
      remainingText: 'Wpisz pozostałą kwotę, np. 2 500,00',
      monthlyText: 'Wpisz ratę albo liczbę rat',
      paymentDayText: 'Dzień miesiąca od 1 do 31',
    });
  });
});

describe('toUpdateRequest', () => {
  /** Zobowiązanie z API. */
  const ORIGINAL = {
    id: '01JH0000000000000000000001',
    name: 'Telefon',
    kind: 'installment',
    creditor: 'Play',
    openingBalanceMinor: 250_000,
    balanceAsOf: '2026-09-01',
    monthlyPaymentMinor: 50_000,
    installmentsRemainingAtAsOf: 5,
    paymentDay: 20,
    paymentAccountId: ROR,
    categoryId: null,
    notes: null,
  } as LiabilityDto;

  it('bez zmian — puste ciało; zmiana raty — tylko ona', () => {
    const state = liabilityFormFrom(ORIGINAL);
    expect(toUpdateRequest(ORIGINAL, state)).toEqual({ ok: true, body: {} });
    const changed = editLinked(state, 'monthly', '625');
    expect(toUpdateRequest(ORIGINAL, changed)).toEqual({
      ok: true,
      body: { monthlyPaymentMinor: 62_500 },
    });
  });

  it('najbliższa rata: ustawiona i wyczyszczona', () => {
    const state = { ...liabilityFormFrom(ORIGINAL), firstPaymentOn: '2026-11-20' };
    expect(toUpdateRequest(ORIGINAL, state)).toEqual({
      ok: true,
      body: { firstPaymentOn: '2026-11-20' },
    });
    const withDate = { ...ORIGINAL, firstPaymentOn: '2026-11-20' };
    expect(liabilityFormFrom(withDate).firstPaymentOn).toBe('2026-11-20');
    expect(
      toUpdateRequest(withDate, { ...liabilityFormFrom(withDate), firstPaymentOn: '' }),
    ).toEqual({ ok: true, body: { firstPaymentOn: null } });
  });

  it('wyczyszczony wierzyciel i dzień', () => {
    const state = { ...liabilityFormFrom(ORIGINAL), creditor: ' ', paymentDayText: '' };
    expect(toUpdateRequest(ORIGINAL, state)).toEqual({
      ok: true,
      body: { creditor: null, paymentDay: null },
    });
  });
});

describe('formErrorsFromRequest', () => {
  it('mapuje pola żądania na pola formularza', () => {
    expect(
      formErrorsFromRequest({
        openingBalanceMinor: 'a',
        paymentDay: 'b',
        paymentAccountId: 'c',
        cokolwiek: 'd',
      }),
    ).toEqual({ remainingText: 'a', paymentDayText: 'b', paymentAccountId: 'c' });
  });
});

describe('installmentBreakdown', () => {
  it('pokazuje niepełną ostatnią ratę (979 zł po 97 zł → 11 rat)', () => {
    const linked = linkedValues(typed(['remaining', '979'], ['monthly', '97']));
    expect(linked.installments).toBe(11);
    expect(installmentBreakdown(linked)?.replace(/\s/gu, ' ')).toBe(
      '10 × 97,00 zł, ostatnia 9,00 zł',
    );
  });

  it('przy wyliczonej racie też rozpisuje resztę (1000 zł na 3 raty)', () => {
    const linked = linkedValues(typed(['remaining', '1000'], ['installments', '3']));
    expect(installmentBreakdown(linked)?.replace(/\s/gu, ' ')).toBe(
      '2 × 333,34 zł, ostatnia 333,32 zł',
    );
  });

  it('milczy, gdy raty są równe albo danych brakuje', () => {
    expect(
      installmentBreakdown(linkedValues(typed(['remaining', '2500'], ['monthly', '500']))),
    ).toBeNull();
    expect(
      installmentBreakdown(linkedValues(typed(['monthly', '97'], ['installments', '11']))),
    ).toBeNull();
    expect(
      installmentBreakdown(linkedValues(typed(['remaining', '50'], ['monthly', '97']))),
    ).toBeNull();
    expect(installmentBreakdown(linkedValues(typed(['remaining', '979'])))).toBeNull();
  });
});
