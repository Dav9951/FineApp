import { describe, expect, it } from 'vitest';

import { goalFixture } from '../../../test/goal-fixture.js';
import {
  amountToText,
  convertedText,
  convertRequest,
  editConverter,
  emptyGoalForm,
  formErrorsFromApi,
  goalFormFrom,
  parsePercentToBps,
  percentToText,
  settleConverter,
  switchMode,
  toCreateRequest,
  toUpdateRequest,
} from './goal-form-state.js';

/**
 * Testy formularza celu z przelicznikiem
 * ([06 §3.5](../../../../../plans/06-ui-views.md#35-cele--goals), 07 §3).
 */

const RESPONSE = {
  month: '2026-09',
  incomeBaseMinor: 1_180_000,
  amountMinor: 200_000,
  percentBps: 1695,
  isPartialMonth: true,
  basedOnIncomeSoFar: true,
};

describe('teksty pól', () => {
  it('kwota i procent jak w polu: przecinek, bez zbędnych zer', () => {
    expect(amountToText(200_000)).toBe('2000');
    expect(amountToText(200_010)).toBe('2000,10');
    expect(percentToText(1695)).toBe('17');
    expect(percentToText(1250)).toBe('12,5');
  });

  it('procent: przecinek albo kropka, najwyżej dwa miejsca, opcjonalny znak %', () => {
    expect(parsePercentToBps('17')).toBe(1700);
    expect(parsePercentToBps('17,5')).toBe(1750);
    expect(parsePercentToBps('16.95 %')).toBe(1695);
    expect(parsePercentToBps('17,555')).toBeNull();
    expect(parsePercentToBps('abc')).toBeNull();
    expect(parsePercentToBps('')).toBeNull();
  });
});

describe('przelicznik', () => {
  it('żądanie z ostatnio edytowanego pola; puste — brak żądania', () => {
    const state = editConverter(emptyGoalForm('savings'), 'amount', '2000');
    expect(convertRequest(state, '2026-09')).toEqual({ month: '2026-09', amountMinor: 200_000 });
    const percent = editConverter(state, 'percent', '20');
    expect(convertRequest(percent, '2026-09')).toEqual({ month: '2026-09', percentBps: 2000 });
    expect(convertRequest(editConverter(state, 'amount', ''), '2026-09')).toBeNull();
    expect(convertRequest(editConverter(state, 'percent', '0'), '2026-09')).toBeNull();
  });

  it('pole wyliczane z odpowiedzi — tylko dla bieżącego wejścia', () => {
    const state = editConverter(emptyGoalForm('savings'), 'amount', '2000');
    const request = convertRequest(state, '2026-09');
    expect(convertedText(state, request, RESPONSE)).toBe('17');
    // Odpowiedź dla poprzedniej kwoty — nie pokazujemy.
    const later = editConverter(state, 'amount', '2500');
    expect(convertedText(later, convertRequest(later, '2026-09'), RESPONSE)).toBeNull();
    const percent = editConverter(state, 'percent', '16,95');
    expect(convertedText(percent, convertRequest(percent, '2026-09'), RESPONSE)).toBe('2000');
    expect(convertedText(state, null, RESPONSE)).toBeNull();
    expect(convertedText(state, request, undefined)).toBeNull();
  });

  it('przełączenie trybu przenosi wyliczoną wartość do pola trybu', () => {
    const state = editConverter(emptyGoalForm('savings'), 'amount', '2000');
    expect(switchMode(state, 'percent_of_income', '17')).toMatchObject({
      contributionMode: 'percent_of_income',
      percentText: '17',
      lastEdited: 'percent',
    });
    const percent = {
      ...editConverter(state, 'percent', '20'),
      contributionMode: 'percent_of_income' as const,
    };
    expect(switchMode(percent, 'fixed', '2360')).toMatchObject({
      contributionMode: 'fixed',
      amountText: '2360',
      lastEdited: 'amount',
    });
    expect(switchMode(state, 'none', '17').contributionMode).toBe('none');
    expect(switchMode(state, 'fixed', '17')).toBe(state);
    expect(switchMode(state, 'percent_of_income', null).percentText).toBe('');
  });
});

describe('toCreateRequest', () => {
  it('stała kwota: zapisuje tylko kwotę (07 §3)', () => {
    const state = {
      ...editConverter(emptyGoalForm('savings'), 'amount', '2000'),
      name: ' Wkład własny ',
      percentText: '17',
      targetText: '120 000',
      targetDate: '2028-06-30',
      startingText: '42000',
    };
    const result = toCreateRequest(state);
    expect(result).toEqual({
      ok: true,
      body: {
        name: 'Wkład własny',
        kind: 'savings',
        purpose: null,
        targetAmountMinor: 12_000_000,
        targetDate: '2028-06-30',
        startingAmountMinor: 4_200_000,
        linkedAccountId: null,
        progressSource: 'contributions',
        contributionMode: 'fixed',
        contributionAmountMinor: 200_000,
        contributionPercentBps: null,
      },
    });
  });

  it('procent: zapisuje tylko procent; ponad 100% — błąd', () => {
    const state = {
      ...emptyGoalForm('investment'),
      name: 'IKE',
      contributionMode: 'percent_of_income' as const,
      percentText: '10',
      amountText: '1180',
    };
    const result = toCreateRequest(state);
    expect(result.ok && result.body.contributionAmountMinor).toBeNull();
    expect(result.ok && result.body.contributionPercentBps).toBe(1000);
    expect(toCreateRequest({ ...state, percentText: '120' })).toEqual({
      ok: false,
      errors: { percentText: 'Wpłata nie może przekraczać 100% wpływów' },
    });
  });

  it('błędy pól: pusta nazwa, zła kwota docelowa, brak wpłaty, saldo bez konta', () => {
    const result = toCreateRequest({
      ...emptyGoalForm('savings'),
      targetText: 'dużo',
    });
    expect(result.ok ? {} : result.errors).toEqual({
      targetText: 'Wpisz kwotę większą od zera',
      amountText: 'Podaj kwotę miesięcznej wpłaty',
    });
    const noName = toCreateRequest({ ...emptyGoalForm('savings'), contributionMode: 'none' });
    expect(noName.ok ? {} : Object.keys(noName.errors)).toEqual(['name']);
    const noAccount = toCreateRequest({
      ...emptyGoalForm('savings'),
      name: 'Poduszka',
      contributionMode: 'none',
      progressSource: 'account_balance',
    });
    expect(noAccount.ok ? {} : noAccount.errors).toEqual({
      linkedAccountId: 'Śledzenie po saldzie wymaga wskazania konta',
    });
    const badStart = toCreateRequest({
      ...emptyGoalForm('savings'),
      name: 'X',
      contributionMode: 'none',
      startingText: 'abc',
    });
    expect(badStart.ok ? {} : badStart.errors).toEqual({ startingText: 'Wpisz kwotę, np. 18 000' });
  });

  it('błędy z API trafiają pod pola formularza', () => {
    expect(
      formErrorsFromApi({ contributionPercentBps: 'Za dużo', linkedAccountId: 'Brak', other: 'x' }),
    ).toEqual({ percentText: 'Za dużo', linkedAccountId: 'Brak' });
  });
});

describe('goalFormFrom i toUpdateRequest', () => {
  it('bez zmian — puste ciało; zmiana trybu — tryb i obie strony', () => {
    const goal = goalFixture();
    const state = goalFormFrom(goal);
    expect(state).toMatchObject({
      amountText: '2000',
      percentText: '17',
      targetText: '120000',
      startingText: '40000',
      lastEdited: 'amount',
    });
    expect(toUpdateRequest(goal, state)).toEqual({ ok: true, body: {} });

    const switched = switchMode(state, 'percent_of_income', '17');
    expect(toUpdateRequest(goal, switched)).toEqual({
      ok: true,
      body: {
        contributionMode: 'percent_of_income',
        contributionAmountMinor: null,
        contributionPercentBps: 1700,
      },
    });
  });

  it('zmiana nazwy, terminu, konta; błąd przechodzi dalej', () => {
    const goal = goalFixture({ startingAmountMinor: 0, purpose: null });
    const state = {
      ...goalFormFrom(goal),
      name: 'Mieszkanie',
      targetDate: '',
      targetText: '',
      linkedAccountId: '01JB0000000000000000000009',
      purpose: 'down_payment' as const,
      kind: 'investment' as const,
      progressSource: 'account_balance' as const,
      startingText: '10',
    };
    expect(toUpdateRequest(goal, state)).toEqual({
      ok: true,
      body: {
        name: 'Mieszkanie',
        kind: 'investment',
        purpose: 'down_payment',
        targetAmountMinor: null,
        targetDate: null,
        startingAmountMinor: 1000,
        linkedAccountId: '01JB0000000000000000000009',
        progressSource: 'account_balance',
      },
    });
    expect(toUpdateRequest(goal, { ...state, amountText: '' }).ok).toBe(false);
  });

  it('cel bez planu i bez kwot — puste pola', () => {
    const base = goalFixture();
    const state = goalFormFrom(
      goalFixture({
        targetAmountMinor: null,
        targetDate: null,
        contribution: {
          ...base.contribution,
          mode: 'percent_of_income',
          plannedAmountMinor: null,
          plannedPercentBps: null,
        },
      }),
    );
    expect(state).toMatchObject({
      targetText: '',
      amountText: '',
      percentText: '',
      lastEdited: 'percent',
    });
  });
});

describe('settleConverter', () => {
  it('zapisuje to, co widać: pole trybu z przelicznika, gdy edytowano drugie', () => {
    const fixed = editConverter(emptyGoalForm('savings'), 'percent', '20');
    expect(settleConverter(fixed, '2360').amountText).toBe('2360');
    const percent = {
      ...editConverter(emptyGoalForm('savings'), 'amount', '2000'),
      contributionMode: 'percent_of_income' as const,
    };
    expect(settleConverter(percent, '17').percentText).toBe('17');
    const same = editConverter(emptyGoalForm('savings'), 'amount', '2000');
    expect(settleConverter(same, '17')).toBe(same);
    expect(settleConverter(fixed, null)).toBe(fixed);
  });
});
