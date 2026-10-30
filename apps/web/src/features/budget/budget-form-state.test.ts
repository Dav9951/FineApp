import { describe, expect, it } from 'vitest';

import { budgetLineFixture } from '../../../test/budget-fixture.js';
import {
  applyPreview,
  lineFormFrom,
  promoteFormFrom,
  toCreateDraftRequest,
  toCreateLineRequest,
  toPromoteRequest,
  toUpdateLineRequest,
} from './budget-form-state.js';

/**
 * Testy stanu formularzy planera
 * ([06 §3.14](../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth), `F9-7`).
 */

const MONTH = '2026-11';
const ROR = '01JB0000000000000000000001';
const SAVINGS = '01JB0000000000000000000002';
const own = budgetLineFixture({
  origin: 'manual',
  name: 'Siłownia',
  amountMinor: 14_900,
  dueOn: '2026-11-05',
  recurringRuleId: null,
  sourceAmountMinor: null,
  sourceState: null,
  canPromote: ['recurring', 'planned'],
  canApplyToSource: false,
});

describe('arkusz linii', () => {
  it('nowa linia: pusta, ze stroną bilansu z sekcji', () => {
    expect(lineFormFrom(null, 'savings')).toEqual({
      flow: 'savings',
      name: '',
      amountMinor: 0,
      categoryId: null,
      goalId: null,
      dueOn: '',
      averageMonths: null,
      groupId: null,
    });
    expect(lineFormFrom(null, 'expense', 'g-raty').groupId).toBe('g-raty');
  });

  it('nowa linia: przycięta nazwa, kategoria tylko poza pulami, cel tylko w pulach', () => {
    const expense = toCreateLineRequest(
      {
        ...lineFormFrom(null, 'expense'),
        name: ' Prezent ',
        amountMinor: 30_000,
        categoryId: 'c',
        goalId: 'g',
        dueOn: '2026-11-20',
      },
      MONTH,
    );
    expect(expense).toEqual({
      ok: true,
      body: {
        flow: 'expense',
        name: 'Prezent',
        amountMinor: 30_000,
        categoryId: 'c',
        goalId: null,
        dueOn: '2026-11-20',
        averageMonths: null,
        notes: null,
        groupId: null,
      },
    });
    const pool = toCreateLineRequest(
      { ...lineFormFrom(null, 'investment'), name: 'IKE', categoryId: 'c', goalId: 'g' },
      MONTH,
    );
    expect(pool.ok && pool.body).toMatchObject({ categoryId: null, goalId: 'g', dueOn: null });
  });

  it('bez nazwy i z datą spoza miesiąca — błędy pól', () => {
    expect(
      toCreateLineRequest({ ...lineFormFrom(null, 'expense'), dueOn: '2026-12-01' }, MONTH),
    ).toEqual({
      ok: false,
      errors: { name: 'Nazwa jest wymagana', dueOn: 'Data musi mieścić się w miesiącu planu' },
    });
  });

  it('zmiana linii: tylko zmienione pola; średnia wysyłana, gdy wybrana', () => {
    const line = budgetLineFixture();
    expect(toUpdateLineRequest(line, lineFormFrom(line, 'expense'), MONTH)).toEqual({
      ok: true,
      body: {},
    });
    expect(
      toUpdateLineRequest(
        line,
        {
          ...lineFormFrom(line, 'expense'),
          name: 'Czynsz i media',
          amountMinor: 190_000,
          dueOn: '',
          categoryId: null,
          goalId: 'g',
          averageMonths: 6,
        },
        MONTH,
      ),
    ).toEqual({
      ok: true,
      body: {
        name: 'Czynsz i media',
        amountMinor: 190_000,
        categoryId: null,
        goalId: 'g',
        dueOn: null,
        averageMonths: 6,
      },
    });
    expect(
      toUpdateLineRequest(line, { ...lineFormFrom(line, 'expense'), name: '' }, MONTH).ok,
    ).toBe(false);
  });

  it('zmiana grupy wysyła groupId — także powrót do „Bez grupy" (07 §13.10)', () => {
    const line = budgetLineFixture({ groupId: 'g-dom' });
    expect(
      toUpdateLineRequest(line, { ...lineFormFrom(line, 'expense'), groupId: null }, MONTH),
    ).toEqual({
      ok: true,
      body: { groupId: null },
    });
    expect(
      toUpdateLineRequest(line, { ...lineFormFrom(line, 'expense'), groupId: 'g-raty' }, MONTH),
    ).toEqual({ ok: true, body: { groupId: 'g-raty' } });
  });
});

describe('zamiana linii (07 §13.6)', () => {
  it('stan: dzień z daty linii, termin w miesiącu planu, konto domyślne', () => {
    expect(promoteFormFrom(own, 'recurring', MONTH, ROR)).toMatchObject({
      target: 'recurring',
      frequency: 'monthly',
      dayOfMonthText: '5',
      monthOfYear: 11,
      accountId: ROR,
      dueMonth: MONTH,
      knowsDate: true,
      dueOn: '2026-11-05',
    });
    expect(promoteFormFrom({ ...own, dueOn: null }, 'planned', MONTH, null)).toMatchObject({
      dayOfMonthText: '',
      knowsDate: false,
      dueOn: '',
      accountId: null,
    });
  });

  it('pozycja cykliczna: terminarz z pól, wydatek jako stały', () => {
    expect(toPromoteRequest(promoteFormFrom(own, 'recurring', MONTH, ROR), own)).toEqual({
      ok: true,
      body: {
        target: 'recurring',
        frequency: 'monthly',
        intervalCount: 1,
        dayOfMonth: 5,
        weekday: null,
        monthOfYear: null,
        accountId: ROR,
        counterAccountId: null,
        autoPost: false,
        amountIsEstimate: false,
        isFixedExpense: true,
      },
    });
  });

  it('pozycja cykliczna: brak konta, brak dnia; linia puli wymaga konta docelowego', () => {
    const missing = toPromoteRequest(
      { ...promoteFormFrom(own, 'recurring', MONTH, null), dayOfMonthText: '' },
      own,
    );
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.errors).toMatchObject({
      accountId: 'Wybierz konto',
      dayOfMonthText: 'Dzień miesiąca od 1 do 31',
    });
    const pool = { ...own, flow: 'savings' as const };
    const noTarget = toPromoteRequest(promoteFormFrom(pool, 'recurring', MONTH, ROR), pool);
    expect(!noTarget.ok && noTarget.errors).toEqual({
      counterAccountId: 'Wybierz konto, na które idzie przelew',
    });
    const ok = toPromoteRequest(
      { ...promoteFormFrom(pool, 'recurring', MONTH, ROR), counterAccountId: SAVINGS },
      pool,
    );
    expect(ok.ok && ok.body).toMatchObject({ counterAccountId: SAVINGS, isFixedExpense: false });
    const noSource = toPromoteRequest(promoteFormFrom(pool, 'recurring', MONTH, null), pool);
    expect(!noSource.ok && noSource.errors.accountId).toBe(
      'Wybierz konto, z którego idzie przelew',
    );
  });

  it('planowany wydatek: data tylko gdy znana i w wybranym miesiącu', () => {
    const state = promoteFormFrom(own, 'planned', MONTH, null);
    expect(toPromoteRequest({ ...state, dueMonth: '2027-02', dueOn: '2027-02-14' }, own)).toEqual({
      ok: true,
      body: {
        target: 'planned',
        dueMonth: '2027-02',
        dueOn: '2027-02-14',
        priority: 'should',
        amountIsEstimate: true,
        setAsideEnabled: false,
        alreadySetAsideMinor: 0,
        repeatsYearly: false,
      },
    });
    expect(toPromoteRequest({ ...state, dueMonth: '2027-02' }, own)).toEqual({
      ok: false,
      errors: { dueOn: 'Data musi mieścić się w wybranym miesiącu' },
    });
    const noDate = toPromoteRequest({ ...state, knowsDate: false }, own);
    expect(noDate.ok && noDate.body).toMatchObject({ dueOn: null });
  });
});

describe('applyPreview (07 §13.7)', () => {
  const rent = budgetLineFixture({ amountMinor: 195_000 });

  it('reguła: przyszły miesiąc — od M nowa kwota, do M−1 stara; bieżący — zmiana kwoty', () => {
    expect(applyPreview(rent, '2026-12', '2026-10')).toEqual({
      kind: 'rule_split',
      fromMonth: '2026-12',
      untilMonth: '2026-11',
      newMinor: 195_000,
      oldMinor: 185_000,
    });
    expect(applyPreview(rent, '2026-10', '2026-10')).toEqual({
      kind: 'rule_updated',
      newMinor: 195_000,
    });
  });

  it('kwota zmieniona w źródle w międzyczasie — stara to bieżąca kwota źródła; wypłata z puli — bez znaku', () => {
    expect(
      applyPreview(
        { ...rent, sourceState: 'source_changed', sourceCurrentAmountMinor: 190_000 },
        '2026-12',
        '2026-10',
      ),
    ).toMatchObject({ oldMinor: 190_000 });
    expect(
      applyPreview(
        { ...rent, flow: 'savings', amountMinor: -50_000, sourceAmountMinor: -40_000 },
        '2026-12',
        '2026-10',
      ),
    ).toMatchObject({ newMinor: 50_000, oldMinor: 40_000 });
  });

  it('planowany wydatek i cel; linia bez prawa zapisu — brak podglądu', () => {
    expect(applyPreview({ ...rent, origin: 'planned' }, '2026-11', '2026-10')).toEqual({
      kind: 'planned_updated',
      newMinor: 195_000,
      oldMinor: 185_000,
    });
    expect(
      applyPreview({ ...rent, origin: 'goal', sourceAmountMinor: null }, '2026-11', '2026-10'),
    ).toEqual({
      kind: 'goal_updated',
      newMinor: 195_000,
      oldMinor: 0,
    });
    expect(applyPreview({ ...rent, canApplyToSource: false }, '2026-11', '2026-10')).toBeNull();
  });
});

describe('toCreateDraftRequest', () => {
  it('jedno okno średniej dla wszystkich zaznaczonych kategorii; kopia opcjonalna', () => {
    expect(
      toCreateDraftRequest({
        fillFromSources: false,
        months: 6,
        categoryIds: ['a', 'b'],
        copyManualFrom: '2026-10',
      }),
    ).toEqual({
      fillFromSources: false,
      copyManualFrom: '2026-10',
      averageLines: [
        { categoryId: 'a', months: 6 },
        { categoryId: 'b', months: 6 },
      ],
      notes: null,
    });
  });
});
