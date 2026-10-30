import { describe, expect, it } from 'vitest';

import { plannedFixture, SET_ASIDE_ACCOUNT_ID } from '../../../test/planned-fixture.js';
import {
  emptyPlannedForm,
  formErrorsFromApi,
  nextInstanceMonth,
  nextMonthOfYear,
  plannedFormFrom,
  setAsidePreview,
  toCreateRequest,
  toUpdateRequest,
} from './planned-form-state.js';

/**
 * Testy formularza planowanego wydatku — przede wszystkim rata na żywo (06 §3.10,
 * 07 §6.5): ta sama liczba, którą potem pokaże karta.
 */

const SEPTEMBER = '2026-09';

describe('setAsidePreview — „Trzeba odkładać X przez N mies."', () => {
  it('przykład z makiety: 2 400 zł na marzec, 800 zł już jest → 228,58 zł przez 7 mies.', () => {
    const state = { amountMinor: 240_000, dueMonth: '2027-03', alreadyText: '800' };
    expect(setAsidePreview(state, SEPTEMBER)).toEqual({
      monthlyMinor: 22_858,
      monthsLeft: 7,
      remainingMinor: 160_000,
    });
  });

  it('przelicza się przy zmianie kwoty i terminu', () => {
    expect(
      setAsidePreview({ amountMinor: 240_000, dueMonth: '2027-08', alreadyText: '' }, SEPTEMBER)
        ?.monthlyMinor,
    ).toBe(20_000);
    expect(
      setAsidePreview({ amountMinor: 120_000, dueMonth: '2027-08', alreadyText: '' }, SEPTEMBER)
        ?.monthlyMinor,
    ).toBe(10_000);
  });

  it('przy edycji liczy wpłaty zrobione w aplikacji', () => {
    const state = { amountMinor: 300_000, dueMonth: '2027-03', alreadyText: '' };
    expect(setAsidePreview(state, SEPTEMBER, 90_000)?.remainingMinor).toBe(210_000);
  });

  it('termin w tym miesiącu albo miniony — cała reszta teraz; pokryte — zero', () => {
    const due = { amountMinor: 50_000, dueMonth: '2026-08', alreadyText: '' };
    expect(setAsidePreview(due, SEPTEMBER)).toMatchObject({ monthlyMinor: 50_000, monthsLeft: 1 });
    const full = { amountMinor: 50_000, dueMonth: '2027-01', alreadyText: '600' };
    expect(setAsidePreview(full, SEPTEMBER)?.monthlyMinor).toBe(0);
  });

  it('„Już mam" z przecinkiem; niepoprawny tekst — bez podglądu i z błędem pola', () => {
    const state = { amountMinor: 240_000, dueMonth: '2027-03', alreadyText: '800,50' };
    expect(setAsidePreview(state, SEPTEMBER)?.remainingMinor).toBe(159_950);
    expect(setAsidePreview({ ...state, alreadyText: 'dużo' }, SEPTEMBER)).toBeNull();
    const result = toCreateRequest({
      ...emptyPlannedForm(SEPTEMBER),
      name: 'OC',
      amountMinor: 240_000,
      setAsideEnabled: false,
      alreadyText: 'dużo',
    });
    expect(result.ok ? null : result.errors.alreadyText).toBe('Wpisz kwotę, np. 800');
  });

  it('bez kwoty albo terminu — nic do pokazania', () => {
    expect(
      setAsidePreview({ amountMinor: 0, dueMonth: '2027-03', alreadyText: '' }, SEPTEMBER),
    ).toBeNull();
    expect(
      setAsidePreview({ amountMinor: 1_000, dueMonth: '', alreadyText: '' }, SEPTEMBER),
    ).toBeNull();
  });
});

describe('terminy pomocnicze', () => {
  it('wpis na kolejny rok', () => {
    expect(nextInstanceMonth('2027-03')).toBe('2028-03');
    expect(nextInstanceMonth('')).toBeNull();
  });

  it('najbliższy miesiąc roku — z rocznej pozycji cyklicznej (F6-9)', () => {
    expect(nextMonthOfYear(SEPTEMBER, 3)).toBe('2027-03');
    expect(nextMonthOfYear(SEPTEMBER, 9)).toBe('2026-09');
    expect(nextMonthOfYear(SEPTEMBER, 12)).toBe('2026-12');
  });
});

describe('toCreateRequest', () => {
  it('nowy formularz: termin za 3 miesiące, odkładanie włączone, wartości z góry', () => {
    const state = emptyPlannedForm(SEPTEMBER, { name: 'OC', amountMinor: 240_000 });
    expect(state).toMatchObject({
      name: 'OC',
      amountMinor: 240_000,
      dueMonth: '2026-12',
      setAsideEnabled: true,
    });
  });

  it('odkładanie bez konta i celu → I-17 przy polu konta', () => {
    const state = { ...emptyPlannedForm(SEPTEMBER), name: 'OC', amountMinor: 240_000 };
    const result = toCreateRequest(state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.setAsideAccountId).toBe('Wskaż konto lub cel, na którym odkładasz');
    }
  });

  it('data spoza miesiąca → I-16 przy dacie; zaznaczone „znam datę" bez daty', () => {
    const base = {
      ...emptyPlannedForm(SEPTEMBER),
      name: 'OC',
      amountMinor: 240_000,
      setAsideEnabled: false,
      knowsDate: true,
    };
    const empty = toCreateRequest(base);
    expect(empty.ok ? null : empty.errors.dueOn).toBe('Wybierz datę albo odznacz');
    const outside = toCreateRequest({ ...base, dueMonth: '2027-03', dueOn: '2027-04-14' });
    expect(outside.ok ? null : outside.errors.dueOn).toBe(
      'Data musi mieścić się w wybranym miesiącu',
    );
  });

  it('bez kwoty i nazwy — błędy pól', () => {
    const result = toCreateRequest({ ...emptyPlannedForm(SEPTEMBER), setAsideEnabled: false });
    expect(result.ok ? null : result.errors).toMatchObject({
      name: 'Nazwa jest wymagana',
      amountMinor: 'Wpisz szacowaną kwotę',
    });
  });

  it('wyłączone odkładanie nie wysyła miejsca odkładania', () => {
    const result = toCreateRequest({
      ...emptyPlannedForm(SEPTEMBER),
      name: 'Wakacje',
      amountMinor: 200_000,
      setAsideEnabled: false,
      setAsideAccountId: SET_ASIDE_ACCOUNT_ID,
    });
    expect(result.ok ? result.body : null).toMatchObject({
      setAsideEnabled: false,
      setAsideAccountId: null,
      dueOn: null,
    });
  });
});

describe('toUpdateRequest', () => {
  it('bez zmian — puste ciało; zmiana kwoty i daty — tylko one', () => {
    const item = plannedFixture();
    const state = plannedFormFrom(item);
    expect(toUpdateRequest(item, state)).toEqual({ ok: true, body: {} });
    const changed = toUpdateRequest(item, {
      ...state,
      amountMinor: 260_000,
      knowsDate: false,
    });
    expect(changed).toEqual({ ok: true, body: { estimatedAmountMinor: 260_000, dueOn: null } });
  });
});

describe('formErrorsFromApi', () => {
  it('ścieżki kontraktu na pola formularza', () => {
    expect(
      formErrorsFromApi({
        estimatedAmountMinor: 'Kwota musi być dodatnia',
        setAsideGoalId: 'Nie ma takiego celu',
        setAsideStartMonth: 'Odkładanie nie może zaczynać się po terminie wydatku',
      }),
    ).toEqual({
      amountMinor: 'Kwota musi być dodatnia',
      setAsideAccountId: 'Nie ma takiego celu',
      dueMonth: 'Odkładanie nie może zaczynać się po terminie wydatku',
    });
  });
});
