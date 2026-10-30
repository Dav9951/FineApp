import { describe, expect, it } from 'vitest';

import { formatMinor } from '../utils/money.js';
import { shiftMonth } from '../utils/month.js';
import {
  budgetActuals,
  averageWindow,
  budgetLineIssues,
  budgetMonthRange,
  budgetPromoteTargets,
  budgetSourceKey,
  budgetSourceStatus,
  buildBudgetSourceLines,
  canApplyBudgetLineToSource,
  canCreateBudgetDraft,
  categoryAverages,
  ceilToZloty,
  evaluateBudget,
  isBudgetDraftEditable,
  liabilityInstallmentForMonth,
  ruleAmountForMonth,
  ruleApplyKind,
  setAsideAmountForMonth,
  setAsidePool,
  isNearBudgetMonthEnd,
  suggestedBudgetMonth,
  transferBudgetFlow,
  type AverageCategory,
  type BudgetActualLine,
  type BudgetLedgerRow,
  type BudgetEvaluationInput,
  type BudgetEvaluationLine,
  type BudgetGoalSource,
  type BudgetLiabilityInput,
  type BudgetPlannedSource,
  type BudgetRuleSource,
  type BudgetSourceLine,
  type BudgetSources,
} from './budget.js';
import { occurrenceDatesForMonth, type RecurringSchedule } from './recurring.js';

/**
 * Testy planera budżetu
 * ([07 §13](../../../../plans/07-domain-rules.md#13-planer-budżetu), `F9-2`).
 * Przypadki brzegowe z 07 §13.9, które da się sprawdzić bez bazy, mają tu swój test.
 */

const CURRENT = '2026-10';
const NOVEMBER = '2026-11';

/** Czynsz 10. dnia każdego miesiąca od września 2026. */
const MONTHLY: RecurringSchedule = {
  frequency: 'monthly',
  intervalCount: 1,
  dayOfMonth: 10,
  weekday: null,
  monthOfYear: null,
  anchorDate: '2026-09-10',
  startMonth: '2026-09',
  endMonth: null,
};

/**
 * Reguła z rozsądnymi wartościami domyślnymi — wydatek „Czynsz" 1 850 zł.
 *
 * @param overrides - Nadpisane pola.
 * @returns Reguła.
 */
function rule(overrides: Partial<BudgetRuleSource> = {}): BudgetRuleSource {
  return {
    id: 'rule-rent',
    name: 'Czynsz',
    flow: 'expense',
    amountMinor: 1_850_00,
    isActive: true,
    schedule: MONTHLY,
    occurrences: [],
    categoryId: 'cat-flat',
    incomeSourceId: null,
    goalId: null,
    liabilityId: null,
    sourceAllocationClass: null,
    targetAllocationClass: null,
    allocationOverride: null,
    ...overrides,
  };
}

/**
 * Planowany wydatek — OC 2 400 zł na marzec 2027 z odkładaniem na oszczędności.
 *
 * @param overrides - Nadpisane pola.
 * @returns Wydatek.
 */
function planned(overrides: Partial<BudgetPlannedSource> = {}): BudgetPlannedSource {
  return {
    id: 'pe-oc',
    name: 'OC',
    status: 'funding',
    estimatedAmountMinor: 2_400_00,
    dueMonth: '2027-03',
    dueOn: null,
    postedAmountMinor: null,
    categoryId: 'cat-car',
    liabilityId: null,
    setAsideEnabled: true,
    setAsidePool: 'savings',
    accumulatedMinor: 800_00,
    monthlyRequiredMinor: 266_67,
    ...overrides,
  };
}

/**
 * Cel z planem wpłat 2 000 zł.
 *
 * @param overrides - Nadpisane pola.
 * @returns Cel.
 */
function goal(overrides: Partial<BudgetGoalSource> = {}): BudgetGoalSource {
  return {
    id: 'goal-flat',
    name: 'Wkład własny',
    kind: 'savings',
    status: 'active',
    plan: {
      contributionMode: 'fixed',
      contributionAmountMinor: 2_000_00,
      contributionPercentBps: null,
    },
    ...overrides,
  };
}

/** Puste źródła — testy dokładają tylko to, co je interesuje. */
const NO_SOURCES: BudgetSources = {
  rules: [],
  liabilities: [],
  plannedExpenses: [],
  goals: [],
  nonCountingIncomeSourceIds: new Set(),
};

describe('zakres miesięcy (07 §13.1, I-20)', () => {
  it('szkic można założyć od bieżącego do +12', () => {
    expect(budgetMonthRange(CURRENT)).toEqual({ from: '2026-10', to: '2027-10' });
    expect(canCreateBudgetDraft('2026-10', CURRENT)).toBe(true);
    expect(canCreateBudgetDraft('2027-10', CURRENT)).toBe(true);
    expect(canCreateBudgetDraft('2027-11', CURRENT)).toBe(false);
    expect(canCreateBudgetDraft('2026-09', CURRENT)).toBe(false);
  });

  it('miniony szkic jest tylko do odczytu', () => {
    expect(isBudgetDraftEditable('2026-09', CURRENT)).toBe(false);
    expect(isBudgetDraftEditable('2026-10', CURRENT)).toBe(true);
    expect(isBudgetDraftEditable('2027-02', CURRENT)).toBe(true);
  });
});

describe('ruleAmountForMonth (07 §13.2, kroki 1–3)', () => {
  it('miesiąc przyszły bez wystąpień — kwota reguły', () => {
    expect(ruleAmountForMonth(MONTHLY, 1_850_00, NOVEMBER, [])).toBe(1_850_00);
  });

  it('istniejące wystąpienie — migawka kwoty, nie bieżąca kwota reguły (07 §6.3)', () => {
    const occurrences = [
      { dueOn: '2026-10-10', status: 'posted' as const, plannedAmountMinor: 1_800_00 },
    ];
    expect(ruleAmountForMonth(MONTHLY, 1_850_00, CURRENT, occurrences)).toBe(1_800_00);
  });

  it('wystąpienie pominięte liczy się jako 0', () => {
    const occurrences = [
      { dueOn: '2026-10-10', status: 'skipped' as const, plannedAmountMinor: 1_850_00 },
    ];
    expect(ruleAmountForMonth(MONTHLY, 1_850_00, CURRENT, occurrences)).toBe(0);
  });

  it('reguła miesięczna ze zmienionym dniem — liczy się zapisane wystąpienie, raz (ADR-045)', () => {
    // Czynsz zapłacony 8. przy starym dniu; reguła ma teraz dzień 10.
    const occurrences = [
      { dueOn: '2026-10-08', status: 'posted' as const, plannedAmountMinor: 1_800_00 },
    ];
    expect(ruleAmountForMonth(MONTHLY, 1_850_00, CURRENT, occurrences)).toBe(1_800_00);
    const skipped = [{ dueOn: '2026-10-08', status: 'skipped' as const, plannedAmountMinor: 1 }];
    expect(ruleAmountForMonth(MONTHLY, 1_850_00, CURRENT, skipped)).toBe(0);
  });

  it('reguła bez terminu w miesiącu — null', () => {
    const yearly: RecurringSchedule = { ...MONTHLY, frequency: 'yearly', monthOfYear: 3 };
    expect(ruleAmountForMonth(yearly, 500_00, NOVEMBER, [])).toBeNull();
  });

  it('reguła tygodniowa — jedna kwota, liczba terminów × kwota', () => {
    const weekly: RecurringSchedule = {
      ...MONTHLY,
      frequency: 'weekly',
      dayOfMonth: null,
      weekday: 3,
    };
    const dates = occurrenceDatesForMonth(weekly, '2026-12');
    expect(dates).toHaveLength(5);
    expect(ruleAmountForMonth(weekly, 149_00, '2026-12', [])).toBe(5 * 149_00);
    // Tygodniowa liczy każdy termin osobno: migawka, pominięty, reszta z reguły.
    const recorded = [
      { dueOn: dates[0] ?? '', status: 'posted' as const, plannedAmountMinor: 139_00 },
      { dueOn: dates[1] ?? '', status: 'skipped' as const, plannedAmountMinor: 149_00 },
    ];
    expect(ruleAmountForMonth(weekly, 149_00, '2026-12', recorded)).toBe(139_00 + 3 * 149_00);
  });
});

describe('transferBudgetFlow (07 §13.2, krok 3)', () => {
  it('na oszczędności — wpłata, z oszczędności — wypłata', () => {
    expect(
      transferBudgetFlow({
        sourceAllocationClass: 'spending',
        targetAllocationClass: 'savings',
        allocationOverride: null,
      }),
    ).toEqual({ flow: 'savings', sign: 1 });
    expect(
      transferBudgetFlow({
        sourceAllocationClass: 'savings',
        targetAllocationClass: 'spending',
        allocationOverride: null,
      }),
    ).toEqual({ flow: 'savings', sign: -1 });
  });

  it('nadpisanie wymusza pulę', () => {
    expect(
      transferBudgetFlow({
        sourceAllocationClass: 'spending',
        targetAllocationClass: 'spending',
        allocationOverride: 'investment',
      }),
    ).toEqual({ flow: 'investment', sign: 1 });
  });

  it('bez efektu albo z dwoma efektami — brak linii', () => {
    expect(
      transferBudgetFlow({
        sourceAllocationClass: 'spending',
        targetAllocationClass: 'spending',
        allocationOverride: null,
      }),
    ).toBeNull();
    expect(
      transferBudgetFlow({
        sourceAllocationClass: 'savings',
        targetAllocationClass: 'investment',
        allocationOverride: null,
      }),
    ).toBeNull();
    expect(
      transferBudgetFlow({
        sourceAllocationClass: 'spending',
        targetAllocationClass: 'savings',
        allocationOverride: 'none',
      }),
    ).toBeNull();
  });
});

describe('setAsidePool', () => {
  it('konto wydatkowe — brak puli; inne klasy i cele — ich pula', () => {
    expect(setAsidePool('spending', null)).toBeNull();
    expect(setAsidePool('savings', null)).toBe('savings');
    expect(setAsidePool('investment', null)).toBe('investment');
    expect(setAsidePool(null, 'investment')).toBe('investment');
    expect(setAsidePool(null, null)).toBeNull();
  });
});

describe('setAsideAmountForMonth (07 §13.2, krok 6)', () => {
  const OC = {
    estimatedAmountMinor: 2_400_00,
    dueMonth: '2027-03',
    accumulatedMinor: 800_00,
    monthlyRequiredMinor: 320_00,
  };

  it('przed terminem — rata na dziś', () => {
    expect(setAsideAmountForMonth(OC, NOVEMBER, CURRENT)).toBe(320_00);
  });

  it('przed terminem bez raty (pokryte) — brak linii', () => {
    expect(
      setAsideAmountForMonth({ ...OC, monthlyRequiredMinor: 0 }, NOVEMBER, CURRENT),
    ).toBeNull();
  });

  it('w miesiącu terminu — wypłata odłożonego wraz z ratami do tego miesiąca', () => {
    // 800 + 320 × 5 (paź–lut) = 2 400 — całość.
    expect(setAsideAmountForMonth(OC, '2027-03', CURRENT)).toBe(-2_400_00);
    // Termin w bieżącym miesiącu: tylko to, co już zebrane.
    expect(setAsideAmountForMonth({ ...OC, dueMonth: CURRENT }, CURRENT, CURRENT)).toBe(-800_00);
  });

  it('wypłata nie przekracza szacunku', () => {
    expect(setAsideAmountForMonth({ ...OC, accumulatedMinor: 3_000_00 }, '2027-03', CURRENT)).toBe(
      -2_400_00,
    );
  });

  it('w miesiącu terminu bez niczego odłożonego — brak linii', () => {
    expect(
      setAsideAmountForMonth(
        { ...OC, dueMonth: CURRENT, accumulatedMinor: 0, monthlyRequiredMinor: 2_400_00 },
        CURRENT,
        CURRENT,
      ),
    ).toBeNull();
  });

  it('po terminie — brak linii', () => {
    expect(setAsideAmountForMonth(OC, '2027-04', CURRENT)).toBeNull();
  });
});

describe('budgetSourceKey', () => {
  const refs = { recurringRuleId: 'r', plannedExpenseId: 'p', goalId: 'g', liabilityId: 'l' };

  it('klucz wg pochodzenia — jak unikalne indeksy 03 §3.20', () => {
    expect(budgetSourceKey({ ...refs, origin: 'recurring' })).toBe('recurring:r');
    expect(budgetSourceKey({ ...refs, origin: 'planned' })).toBe('planned:p');
    expect(budgetSourceKey({ ...refs, origin: 'set_aside' })).toBe('set_aside:p');
    expect(budgetSourceKey({ ...refs, origin: 'goal' })).toBe('goal:g');
    expect(budgetSourceKey({ ...refs, origin: 'liability' })).toBe('liability:l');
    expect(budgetSourceKey({ ...refs, origin: 'manual' })).toBeNull();
  });

  it('osierocona linia (wskaźnik pusty) — brak klucza', () => {
    const none = { recurringRuleId: null, plannedExpenseId: null, goalId: null, liabilityId: null };
    for (const origin of ['recurring', 'planned', 'set_aside', 'goal', 'liability'] as const) {
      expect(budgetSourceKey({ ...none, origin })).toBeNull();
    }
  });
});

describe('buildBudgetSourceLines (07 §13.2)', () => {
  /**
   * Linie po kluczu — wygodniej sprawdzać niż po kolejności.
   *
   * @param lines - Linie ze źródeł.
   * @returns Mapa klucz → linia.
   */
  function byKey(lines: BudgetSourceLine[]): Map<string, BudgetSourceLine> {
    return new Map(lines.map((line) => [line.key, line]));
  }

  it('kolejność kroków: wpływy, wydatki, pule z reguł, raty, planowane, odkładanie, cele', () => {
    const lines = buildBudgetSourceLines(
      {
        ...NO_SOURCES,
        rules: [
          rule({
            id: 'ike',
            name: 'IKE',
            flow: 'transfer',
            amountMinor: 1_000_00,
            categoryId: null,
            sourceAllocationClass: 'spending',
            targetAllocationClass: 'investment',
          }),
          rule(),
          rule({
            id: 'salary',
            name: 'Pensja',
            flow: 'income',
            amountMinor: 9_800_00,
            categoryId: 'cat-salary',
            incomeSourceId: 'src-job',
          }),
        ],
        liabilities: [
          { id: 'loan', name: 'Pożyczka', installmentMinor: 500_00, dueOn: '2026-11-15' },
        ],
        plannedExpenses: [
          planned(),
          planned({
            id: 'pe-car',
            name: 'Przegląd',
            dueMonth: NOVEMBER,
            setAsideEnabled: false,
            estimatedAmountMinor: 800_00,
          }),
        ],
        goals: [goal()],
      },
      NOVEMBER,
      CURRENT,
    );
    expect(lines.map((line) => line.key)).toEqual([
      'recurring:salary',
      'recurring:rule-rent',
      'recurring:ike',
      'liability:loan',
      'planned:pe-car',
      'set_aside:pe-oc',
      'goal:goal-flat',
    ]);
    // Klucz linii ze źródła = klucz liczony z jej wskaźników (stan źródła, 07 §13.5).
    for (const line of lines) expect(budgetSourceKey(line)).toBe(line.key);
    const map = byKey(lines);
    expect(map.get('recurring:salary')).toMatchObject({
      origin: 'recurring',
      flow: 'income',
      amountMinor: 9_800_00,
      incomeSourceId: 'src-job',
      categoryId: 'cat-salary',
      dueOn: '2026-11-10',
    });
    expect(map.get('recurring:ike')).toMatchObject({ flow: 'investment', amountMinor: 1_000_00 });
    expect(map.get('liability:loan')).toMatchObject({
      origin: 'liability',
      flow: 'expense',
      liabilityId: 'loan',
      dueOn: '2026-11-15',
    });
    expect(map.get('planned:pe-car')).toMatchObject({
      origin: 'planned',
      flow: 'expense',
      amountMinor: 800_00,
      plannedExpenseId: 'pe-car',
      categoryId: 'cat-car',
    });
    expect(map.get('set_aside:pe-oc')).toMatchObject({
      origin: 'set_aside',
      flow: 'savings',
      name: 'Odkładanie: OC',
      amountMinor: 266_67,
      goalId: null,
    });
    expect(map.get('goal:goal-flat')).toMatchObject({ flow: 'savings', amountMinor: 2_000_00 });
  });

  it('reguła wydatku z ratą niesie zobowiązanie; przelew z wypłatą — kwotę ujemną z celem', () => {
    const map = byKey(
      buildBudgetSourceLines(
        {
          ...NO_SOURCES,
          rules: [
            rule({ id: 'mortgage', liabilityId: 'liab' }),
            rule({
              id: 'back',
              flow: 'transfer',
              goalId: 'goal-x',
              sourceAllocationClass: 'savings',
              targetAllocationClass: 'spending',
            }),
          ],
        },
        NOVEMBER,
        CURRENT,
      ),
    );
    expect(map.get('recurring:mortgage')?.liabilityId).toBe('liab');
    expect(map.get('recurring:back')).toMatchObject({
      flow: 'savings',
      amountMinor: -1_850_00,
      goalId: 'goal-x',
    });
  });

  it('pomija: regułę wstrzymaną, bez terminu w miesiącu i przelew bez puli', () => {
    const lines = buildBudgetSourceLines(
      {
        ...NO_SOURCES,
        rules: [
          rule({ id: 'paused', isActive: false }),
          rule({ id: 'ended', schedule: { ...MONTHLY, endMonth: CURRENT } }),
          rule({
            id: 'between',
            flow: 'transfer',
            sourceAllocationClass: 'savings',
            targetAllocationClass: 'investment',
          }),
        ],
      },
      NOVEMBER,
      CURRENT,
    );
    expect(lines).toEqual([]);
  });

  it('pomija ratę zerową, odwołany wydatek i odkładanie bez puli', () => {
    const lines = buildBudgetSourceLines(
      {
        ...NO_SOURCES,
        liabilities: [{ id: 'paid-off', name: 'Spłacone', installmentMinor: 0, dueOn: null }],
        plannedExpenses: [
          planned({ id: 'cancelled', status: 'cancelled', dueMonth: NOVEMBER }),
          planned({ id: 'spending-pool', setAsidePool: null }),
          planned({ id: 'covered', monthlyRequiredMinor: 0 }),
        ],
      },
      NOVEMBER,
      CURRENT,
    );
    expect(lines).toEqual([]);
  });

  it('wydatek w miesiącu terminu z odkładaniem — całość + wypłata odłożonego', () => {
    const map = byKey(
      buildBudgetSourceLines(
        { ...NO_SOURCES, plannedExpenses: [planned({ monthlyRequiredMinor: 320_00 })] },
        '2027-03',
        CURRENT,
      ),
    );
    expect(map.get('planned:pe-oc')?.amountMinor).toBe(2_400_00);
    expect(map.get('set_aside:pe-oc')).toMatchObject({
      name: 'Z odłożonego: OC',
      amountMinor: -2_400_00,
    });
  });

  it('zapłacony wydatek: kwota zapłacona, bez odkładania; bez kwoty zapłaty — szacunek', () => {
    const paid = byKey(
      buildBudgetSourceLines(
        {
          ...NO_SOURCES,
          plannedExpenses: [
            planned({
              id: 'paid',
              status: 'posted',
              dueMonth: CURRENT,
              postedAmountMinor: 2_550_00,
            }),
            planned({ id: 'odd', status: 'posted', dueMonth: CURRENT, postedAmountMinor: null }),
          ],
        },
        CURRENT,
        CURRENT,
      ),
    );
    expect(paid.get('planned:paid')?.amountMinor).toBe(2_550_00);
    expect(paid.get('planned:odd')?.amountMinor).toBe(2_400_00);
    expect(paid.has('set_aside:paid')).toBe(false);
  });

  it('cel procentowy liczy się od wpływów liczonych do podstawy', () => {
    const lines = buildBudgetSourceLines(
      {
        ...NO_SOURCES,
        rules: [
          rule({ id: 'salary', flow: 'income', amountMinor: 10_000_00, categoryId: null }),
          rule({
            id: 'refund',
            flow: 'income',
            amountMinor: 5_000_00,
            categoryId: null,
            incomeSourceId: 'src-refund',
          }),
        ],
        goals: [
          goal({
            plan: {
              contributionMode: 'percent_of_income',
              contributionAmountMinor: null,
              contributionPercentBps: 2_000,
            },
          }),
        ],
        nonCountingIncomeSourceIds: new Set(['src-refund']),
      },
      NOVEMBER,
      CURRENT,
    );
    expect(byKey(lines).get('goal:goal-flat')?.amountMinor).toBe(2_000_00);
  });

  it('cel pomijany: z regułą przelewu, nieaktywny, bez planu, procent przy zerowych wpływach', () => {
    const lines = buildBudgetSourceLines(
      {
        ...NO_SOURCES,
        rules: [
          rule({
            id: 'to-goal',
            flow: 'transfer',
            goalId: 'goal-flat',
            sourceAllocationClass: 'spending',
            targetAllocationClass: 'savings',
          }),
        ],
        goals: [
          goal(),
          goal({ id: 'paused', status: 'paused' }),
          goal({
            id: 'none',
            plan: {
              contributionMode: 'none',
              contributionAmountMinor: null,
              contributionPercentBps: null,
            },
          }),
          goal({
            id: 'percent',
            plan: {
              contributionMode: 'percent_of_income',
              contributionAmountMinor: null,
              contributionPercentBps: 1_000,
            },
          }),
        ],
      },
      NOVEMBER,
      CURRENT,
    );
    expect(lines.map((line) => line.key)).toEqual(['recurring:to-goal']);
  });
});

describe('budgetSourceStatus (07 §13.5)', () => {
  const source = (amountMinor: number): BudgetSourceLine => ({
    key: 'recurring:r',
    origin: 'recurring',
    flow: 'expense',
    name: 'Czynsz',
    amountMinor,
    categoryId: null,
    incomeSourceId: null,
    goalId: null,
    liabilityId: null,
    recurringRuleId: 'r',
    plannedExpenseId: null,
    dueOn: null,
  });
  const line = {
    origin: 'recurring' as const,
    recurringRuleId: 'r',
    plannedExpenseId: null,
    goalId: null,
    liabilityId: null,
    sourceAmountMinor: 1_850_00,
  };

  it('linia własna — bez stanu', () => {
    expect(budgetSourceStatus({ ...line, origin: 'manual' }, new Map())).toEqual({
      state: null,
      currentAmountMinor: null,
    });
  });

  it('źródło usunięte — missing; nie daje nic w miesiącu — not_in_month', () => {
    expect(budgetSourceStatus({ ...line, recurringRuleId: null }, new Map()).state).toBe('missing');
    expect(budgetSourceStatus(line, new Map()).state).toBe('not_in_month');
  });

  it('kwota źródła bez zmian — in_sync; zmieniona — source_changed z bieżącą kwotą', () => {
    expect(budgetSourceStatus(line, new Map([['recurring:r', source(1_850_00)]]))).toEqual({
      state: 'in_sync',
      currentAmountMinor: null,
    });
    expect(budgetSourceStatus(line, new Map([['recurring:r', source(1_950_00)]]))).toEqual({
      state: 'source_changed',
      currentAmountMinor: 1_950_00,
    });
  });
});

describe('budgetPromoteTargets (07 §13.6)', () => {
  const own = {
    origin: 'manual' as const,
    flow: 'expense' as const,
    amountMinor: 300_00,
    isExcluded: false,
  };

  it('wydatek własny — reguła albo planowany wydatek; wpływ i pula — tylko reguła', () => {
    expect(budgetPromoteTargets(own, true)).toEqual(['recurring', 'planned']);
    expect(budgetPromoteTargets({ ...own, flow: 'income' }, true)).toEqual(['recurring']);
    expect(budgetPromoteTargets({ ...own, flow: 'savings' }, true)).toEqual(['recurring']);
  });

  it('nic: szkic tylko do odczytu, linia powiązana, wykluczona albo z kwotą 0', () => {
    expect(budgetPromoteTargets(own, false)).toEqual([]);
    expect(budgetPromoteTargets({ ...own, origin: 'recurring' }, true)).toEqual([]);
    expect(budgetPromoteTargets({ ...own, isExcluded: true }, true)).toEqual([]);
    expect(budgetPromoteTargets({ ...own, amountMinor: 0 }, true)).toEqual([]);
  });
});

describe('canApplyBudgetLineToSource (07 §13.7)', () => {
  const ref = {
    origin: 'recurring' as const,
    recurringRuleId: 'r',
    plannedExpenseId: 'p',
    goalId: 'g',
    liabilityId: 'l',
    isExcluded: false,
  };
  const ctx = { isLiabilityRule: false, isWeeklyRule: false, goalContributionMode: null };

  it('reguła, planowany wydatek i cel kwotowy — tak', () => {
    expect(canApplyBudgetLineToSource(ref, true, ctx)).toBe(true);
    expect(canApplyBudgetLineToSource({ ...ref, origin: 'planned' }, true, ctx)).toBe(true);
    expect(
      canApplyBudgetLineToSource({ ...ref, origin: 'goal' }, true, {
        ...ctx,
        goalContributionMode: 'fixed',
      }),
    ).toBe(true);
  });

  it('nie: reguła raty, tygodniowa, cel procentowy, odkładanie, rata bez reguły, linia własna', () => {
    expect(canApplyBudgetLineToSource(ref, true, { ...ctx, isLiabilityRule: true })).toBe(false);
    expect(canApplyBudgetLineToSource(ref, true, { ...ctx, isWeeklyRule: true })).toBe(false);
    expect(
      canApplyBudgetLineToSource({ ...ref, origin: 'goal' }, true, {
        ...ctx,
        goalContributionMode: 'percent_of_income',
      }),
    ).toBe(false);
    expect(canApplyBudgetLineToSource({ ...ref, origin: 'set_aside' }, true, ctx)).toBe(false);
    expect(canApplyBudgetLineToSource({ ...ref, origin: 'liability' }, true, ctx)).toBe(false);
    expect(canApplyBudgetLineToSource({ ...ref, origin: 'manual' }, true, ctx)).toBe(false);
  });

  it('nie: szkic tylko do odczytu, linia wykluczona albo osierocona', () => {
    expect(canApplyBudgetLineToSource(ref, false, ctx)).toBe(false);
    expect(canApplyBudgetLineToSource({ ...ref, isExcluded: true }, true, ctx)).toBe(false);
    expect(canApplyBudgetLineToSource({ ...ref, recurringRuleId: null }, true, ctx)).toBe(false);
  });
});

describe('ruleApplyKind (07 §13.7)', () => {
  it('miesiąc bieżący albo start reguły — zmiana kwoty; późniejszy — podział', () => {
    expect(ruleApplyKind(CURRENT, CURRENT, '2026-09')).toBe('rule_updated');
    expect(ruleApplyKind('2026-12', CURRENT, '2026-12')).toBe('rule_updated');
    expect(ruleApplyKind('2026-12', CURRENT, '2026-09')).toBe('rule_split');
  });
});

describe('evaluateBudget (07 §13.4)', () => {
  /**
   * Linia do oceny — domyślnie wydatek własny.
   *
   * @param overrides - Nadpisane pola.
   * @returns Linia.
   */
  function line(overrides: Partial<BudgetEvaluationLine> = {}): BudgetEvaluationLine {
    return {
      flow: 'expense',
      origin: 'manual',
      amountMinor: 0,
      isExcluded: false,
      incomeSourceId: null,
      goalId: null,
      liabilityId: null,
      plannedExpenseId: null,
      sourceState: null,
      ...overrides,
    };
  }

  const BASE: BudgetEvaluationInput = {
    month: NOVEMBER,
    lines: [],
    nonCountingIncomeSourceIds: new Set(),
    targets: { savingsBps: 0, investmentBps: 0, debtBps: 0 },
    goals: [],
    setAside: [],
  };

  it('bilans jak net(M) z 07 §12.1 — wykluczone się nie liczą', () => {
    const summary = evaluateBudget({
      ...BASE,
      lines: [
        line({ flow: 'income', amountMinor: 11_800_00 }),
        line({ flow: 'income', amountMinor: 500_00, incomeSourceId: 'refund' }),
        line({ amountMinor: 6_000_00 }),
        line({ amountMinor: 1_850_00, liabilityId: 'loan' }),
        line({ amountMinor: 43_00, isExcluded: true }),
        line({ flow: 'savings', amountMinor: 2_170_00 }),
        line({ flow: 'savings', amountMinor: -400_00, origin: 'set_aside' }),
        line({ flow: 'investment', amountMinor: 1_180_00 }),
      ],
      nonCountingIncomeSourceIds: new Set(['refund']),
    });
    expect(summary).toMatchObject({
      incomeMinor: 12_300_00,
      incomeBaseMinor: 11_800_00,
      hasIncomeBase: true,
      expenseMinor: 7_850_00,
      savingsMinor: 1_770_00,
      investmentMinor: 1_180_00,
      debtRepaymentMinor: 1_850_00,
      leftoverMinor: 1_500_00,
      warnings: [],
    });
  });

  it('plan na minusie — liczba ujemna, nie obcięta, i ostrzeżenie', () => {
    const summary = evaluateBudget({
      ...BASE,
      lines: [line({ flow: 'income', amountMinor: 1_000_00 }), line({ amountMinor: 1_200_00 })],
    });
    expect(summary.leftoverMinor).toBe(-200_00);
    expect(summary.warnings).toEqual([
      {
        code: 'NEGATIVE_LEFTOVER',
        message: `Plan jest na minusie o ${formatMinor(200_00)}.`,
        amountMinor: -200_00,
        target: null,
      },
    ]);
  });

  it('wydatki bez wpływów — NO_INCOME', () => {
    const codes = evaluateBudget({ ...BASE, lines: [line({ amountMinor: 100_00 })] }).warnings.map(
      (warning) => warning.code,
    );
    expect(codes).toEqual(['NEGATIVE_LEFTOVER', 'NO_INCOME']);
  });

  it('rozkład: niedobór oszczędności, inwestycje wykonane, dług; linie z celem 0% pomijane', () => {
    const summary = evaluateBudget({
      ...BASE,
      lines: [
        line({ flow: 'income', amountMinor: 11_800_00 }),
        line({ flow: 'savings', amountMinor: 2_170_00 }),
        line({ flow: 'investment', amountMinor: 1_180_00 }),
        line({ amountMinor: 1_850_00, liabilityId: 'loan' }),
      ],
      targets: { savingsBps: 2_000, investmentBps: 1_000, debtBps: 0 },
    });
    expect(summary.allocation).toEqual([
      {
        kind: 'savings',
        targetBps: 2_000,
        targetMinor: 2_360_00,
        plannedMinor: 2_170_00,
        plannedBps: 1_839,
        status: 'short',
        shortfallMinor: 190_00,
      },
      {
        kind: 'investment',
        targetBps: 1_000,
        targetMinor: 1_180_00,
        plannedMinor: 1_180_00,
        plannedBps: 1_000,
        status: 'met',
        shortfallMinor: 0,
      },
    ]);
    expect(summary.warnings).toEqual([
      {
        code: 'ALLOCATION_SHORT',
        message: `Do planu oszczędności brakuje ${formatMinor(190_00)}.`,
        amountMinor: 190_00,
        target: { kind: 'savings', id: null },
      },
    ]);
  });

  it('linia długu liczy wydatki ze zobowiązaniem', () => {
    const [debt] = evaluateBudget({
      ...BASE,
      lines: [
        line({ flow: 'income', amountMinor: 10_000_00 }),
        line({ amountMinor: 500_00, liabilityId: 'loan' }),
      ],
      targets: { savingsBps: 0, investmentBps: 0, debtBps: 1_000 },
    }).allocation;
    expect(debt).toMatchObject({ kind: 'debt', plannedMinor: 500_00, shortfallMinor: 500_00 });
  });

  it('zerowe wpływy — udział 0 i flaga, bez NaN; skrajny udział przycięty do granicy', () => {
    const zero = evaluateBudget({
      ...BASE,
      lines: [line({ flow: 'savings', amountMinor: 100_00 })],
      targets: { savingsBps: 2_000, investmentBps: 0, debtBps: 0 },
    });
    expect(zero.hasIncomeBase).toBe(false);
    expect(zero.allocation[0]).toMatchObject({ plannedBps: 0, targetMinor: 0, status: 'met' });

    const tiny = evaluateBudget({
      ...BASE,
      lines: [
        line({ flow: 'income', amountMinor: 1 }),
        line({ flow: 'savings', amountMinor: 1_000_000_00 }),
        line({ flow: 'investment', amountMinor: -1_000_000_00 }),
      ],
      targets: { savingsBps: 100, investmentBps: 100, debtBps: 0 },
    });
    expect(tiny.allocation.map((item) => item.plannedBps)).toEqual([100_000, -100_000]);
  });

  it('cele: wymaganie z terminu, z planu wpłat i brak wymagania; odkładanie się nie liczy', () => {
    const summary = evaluateBudget({
      ...BASE,
      lines: [
        line({ flow: 'income', amountMinor: 10_000_00 }),
        line({ flow: 'savings', amountMinor: 2_000_00, goalId: 'flat' }),
        line({ flow: 'savings', amountMinor: 500_00, goalId: 'cushion' }),
        line({ flow: 'savings', amountMinor: 300_00, goalId: 'cushion', origin: 'set_aside' }),
      ],
      goals: [
        {
          id: 'flat',
          name: 'Wkład własny',
          kind: 'savings',
          requiredMonthlyMinor: 1_500_00,
          plan: {
            contributionMode: 'none',
            contributionAmountMinor: null,
            contributionPercentBps: null,
          },
        },
        {
          id: 'cushion',
          name: 'Poduszka',
          kind: 'savings',
          requiredMonthlyMinor: null,
          plan: {
            contributionMode: 'percent_of_income',
            contributionAmountMinor: null,
            contributionPercentBps: 800,
          },
        },
        {
          id: 'trip',
          name: 'Wakacje',
          kind: 'savings',
          requiredMonthlyMinor: null,
          plan: {
            contributionMode: 'none',
            contributionAmountMinor: null,
            contributionPercentBps: null,
          },
        },
      ],
    });
    expect(summary.goals).toEqual([
      {
        goalId: 'flat',
        name: 'Wkład własny',
        kind: 'savings',
        plannedMinor: 2_000_00,
        requiredMinor: 1_500_00,
        requirementBasis: 'target_date',
        status: 'met',
        shortfallMinor: 0,
      },
      {
        goalId: 'cushion',
        name: 'Poduszka',
        kind: 'savings',
        plannedMinor: 500_00,
        requiredMinor: 800_00,
        requirementBasis: 'contribution_plan',
        status: 'short',
        shortfallMinor: 300_00,
      },
      {
        goalId: 'trip',
        name: 'Wakacje',
        kind: 'savings',
        plannedMinor: 0,
        requiredMinor: null,
        requirementBasis: null,
        status: 'no_requirement',
        shortfallMinor: 0,
      },
    ]);
    expect(summary.warnings).toEqual([
      {
        code: 'GOAL_SHORT',
        message: `„Poduszka” — do wymaganej wpłaty brakuje ${formatMinor(300_00)}.`,
        amountMinor: 300_00,
        target: { kind: 'goal', id: 'cushion' },
      },
    ]);
  });

  it('odkładanie: tylko wydatki z terminem po miesiącu planu; niedobór z ostrzeżeniem', () => {
    const summary = evaluateBudget({
      ...BASE,
      lines: [
        line({ flow: 'income', amountMinor: 10_000_00 }),
        line({ flow: 'savings', amountMinor: 200_00, origin: 'set_aside', plannedExpenseId: 'oc' }),
        line({ flow: 'savings', amountMinor: 150_00, origin: 'set_aside', plannedExpenseId: 'tv' }),
      ],
      setAside: [
        { plannedExpenseId: 'oc', name: 'OC', dueMonth: '2027-03', requiredMinor: 266_67 },
        { plannedExpenseId: 'tv', name: 'Telewizor', dueMonth: '2027-01', requiredMinor: 150_00 },
        { plannedExpenseId: 'now', name: 'Przegląd', dueMonth: NOVEMBER, requiredMinor: 800_00 },
      ],
    });
    expect(summary.setAside).toEqual([
      {
        plannedExpenseId: 'oc',
        name: 'OC',
        dueMonth: '2027-03',
        requiredMinor: 266_67,
        plannedMinor: 200_00,
        status: 'short',
      },
      {
        plannedExpenseId: 'tv',
        name: 'Telewizor',
        dueMonth: '2027-01',
        requiredMinor: 150_00,
        plannedMinor: 150_00,
        status: 'met',
      },
    ]);
    expect(summary.warnings).toEqual([
      {
        code: 'SET_ASIDE_SHORT',
        message: `„OC” — na odkładanie brakuje ${formatMinor(66_67)}.`,
        amountMinor: 66_67,
        target: { kind: 'planned_expense', id: 'oc' },
      },
    ]);
  });

  it('linie bez źródła — ORPHAN_LINES, także wykluczone', () => {
    const one = evaluateBudget({
      ...BASE,
      lines: [line({ sourceState: 'missing', origin: 'recurring' })],
    });
    expect(one.warnings.map((warning) => warning.message)).toEqual([
      'Jedna pozycja planu straciła źródło — zostaw ją jako własną albo usuń.',
    ]);
    const two = evaluateBudget({
      ...BASE,
      lines: [
        line({ sourceState: 'missing', origin: 'recurring' }),
        line({ sourceState: 'missing', origin: 'goal', flow: 'savings', isExcluded: true }),
      ],
    });
    expect(two.warnings).toEqual([
      {
        code: 'ORPHAN_LINES',
        message: 'Pozycje planu bez źródła: 2 — zostaw je jako własne albo usuń.',
        amountMinor: null,
        target: null,
      },
    ]);
  });
});

describe('budgetLineIssues (I-21, I-23)', () => {
  const valid = {
    flow: 'expense' as const,
    amountMinor: 300_00,
    categoryId: 'cat',
    incomeSourceId: null,
    goalId: null,
    dueOn: '2026-11-05',
  };

  it('poprawna linia — bez problemów', () => {
    expect(budgetLineIssues(valid, NOVEMBER)).toEqual([]);
    expect(
      budgetLineIssues(
        { ...valid, flow: 'savings', amountMinor: -400_00, categoryId: null, goalId: 'g' },
        null,
      ),
    ).toEqual([]);
    expect(budgetLineIssues({ ...valid, flow: 'income', incomeSourceId: 'src' }, null)).toEqual([]);
  });

  it('kwota ujemna poza pulami, kategoria przy puli, źródło poza wpływem, cel poza pulą', () => {
    expect(budgetLineIssues({ ...valid, amountMinor: -1 }, null).map((i) => i.path)).toEqual([
      'amountMinor',
    ]);
    expect(budgetLineIssues({ ...valid, flow: 'investment' }, null).map((i) => i.path)).toEqual([
      'categoryId',
    ]);
    expect(budgetLineIssues({ ...valid, incomeSourceId: 'src' }, null).map((i) => i.path)).toEqual([
      'incomeSourceId',
    ]);
    expect(budgetLineIssues({ ...valid, goalId: 'g' }, null).map((i) => i.path)).toEqual([
      'goalId',
    ]);
  });

  it('data spoza miesiąca planu — tylko gdy miesiąc znany', () => {
    expect(
      budgetLineIssues({ ...valid, dueOn: '2026-12-01' }, NOVEMBER).map((i) => i.path),
    ).toEqual(['dueOn']);
    expect(budgetLineIssues({ ...valid, dueOn: '2026-12-01' }, null)).toEqual([]);
    expect(budgetLineIssues({ ...valid, dueOn: null }, NOVEMBER)).toEqual([]);
  });
});

describe('średnia kategorii (07 §13.3, ADR-078)', () => {
  const FOOD: AverageCategory = {
    id: 'food',
    name: 'Jedzenie',
    icon: null,
    childIds: ['grocery', 'cafe'],
  };
  const BARBER: AverageCategory = { id: 'barber', name: 'Fryzjer', icon: 'scissors', childIds: [] };
  const EMPTY: AverageCategory = { id: 'pets', name: 'Zwierzęta', icon: null, childIds: [] };

  it('okno: N pełnych miesięcy przed bieżącym, także przez granicę roku', () => {
    expect(averageWindow(CURRENT, 3)).toEqual({ from: '2026-07', to: '2026-09' });
    expect(averageWindow('2027-02', 6)).toEqual({ from: '2026-08', to: '2027-01' });
  });

  it('zaokrąglenie w górę do złotówki: 1 873,40 → 1 874,00; pełne złote bez zmian', () => {
    expect(ceilToZloty(1_873_40)).toBe(1_874_00);
    expect(ceilToZloty(1_874_00)).toBe(1_874_00);
    expect(ceilToZloty(0)).toBe(0);
  });

  it('podkategorie do kategorii głównej, miesiące bez wydatku jako 0, malejąco', () => {
    const result = categoryAverages(
      CURRENT,
      3,
      '2026-01',
      [BARBER, EMPTY, FOOD],
      [
        { categoryId: 'grocery', monthKey: '2026-07', amountMinor: 1_200_00 },
        { categoryId: 'cafe', monthKey: '2026-07', amountMinor: 250_00 },
        { categoryId: 'food', monthKey: '2026-08', amountMinor: 2_210_00 },
        { categoryId: 'grocery', monthKey: '2026-09', amountMinor: 1_960_00 },
        { categoryId: 'barber', monthKey: '2026-08', amountMinor: 90_00 },
        // Poza oknem i poza drzewem — nie liczą się.
        { categoryId: 'grocery', monthKey: '2026-06', amountMinor: 9_999_00 },
        { categoryId: 'foreign', monthKey: '2026-08', amountMinor: 500_00 },
      ],
    );
    expect(result.window).toEqual({ from: '2026-07', to: '2026-09' });
    expect(result.monthsWithData).toBe(3);
    expect(result.items).toEqual([
      {
        categoryId: 'food',
        name: 'Jedzenie',
        icon: null,
        // (1 450 + 2 210 + 1 960) / 3 = 1 873,33 → 1 874
        averageMinor: 1_874_00,
        byMonth: [
          { month: '2026-07', amountMinor: 1_450_00 },
          { month: '2026-08', amountMinor: 2_210_00 },
          { month: '2026-09', amountMinor: 1_960_00 },
        ],
      },
      {
        categoryId: 'barber',
        name: 'Fryzjer',
        icon: 'scissors',
        // Fryzjer raz na trzy miesiące rozkłada się, a nie liczy pełną kwotą.
        averageMinor: 30_00,
        byMonth: [
          { month: '2026-07', amountMinor: 0 },
          { month: '2026-08', amountMinor: 90_00 },
          { month: '2026-09', amountMinor: 0 },
        ],
      },
    ]);
  });

  it('krótka historia: okno 6, dwa miesiące danych — dzielone przez 2', () => {
    const result = categoryAverages(
      CURRENT,
      6,
      '2026-08',
      [FOOD],
      [
        { categoryId: 'food', monthKey: '2026-08', amountMinor: 1_000_00 },
        { categoryId: 'food', monthKey: '2026-09', amountMinor: 2_000_00 },
      ],
    );
    expect(result.monthsWithData).toBe(2);
    expect(result.items[0]?.averageMinor).toBe(1_500_00);
    expect(result.items[0]?.byMonth.map((item) => item.month)).toEqual(['2026-08', '2026-09']);
  });

  it('bez historii albo z historią dopiero w bieżącym miesiącu — brak średnich', () => {
    expect(categoryAverages(CURRENT, 3, null, [FOOD], [])).toEqual({
      window: { from: '2026-07', to: '2026-09' },
      monthsWithData: 0,
      items: [],
    });
    expect(categoryAverages(CURRENT, 3, CURRENT, [FOOD], []).monthsWithData).toBe(0);
  });

  it('równe średnie — po nazwie; kategoria z sumą 0 pominięta', () => {
    const result = categoryAverages(
      CURRENT,
      3,
      '2026-01',
      [FOOD, BARBER, EMPTY],
      [
        { categoryId: 'food', monthKey: '2026-07', amountMinor: 300_00 },
        { categoryId: 'barber', monthKey: '2026-07', amountMinor: 300_00 },
        { categoryId: 'pets', monthKey: '2026-07', amountMinor: 0 },
      ],
    );
    expect(result.items.map((item) => item.name)).toEqual(['Fryzjer', 'Jedzenie']);
  });
});

describe('isNearBudgetMonthEnd (06 §3.14)', () => {
  it('ostatnie 7 dni miesiąca — tak; wcześniej — nie', () => {
    expect(isNearBudgetMonthEnd('2026-10-24', CURRENT)).toBe(false);
    expect(isNearBudgetMonthEnd('2026-10-25', CURRENT)).toBe(true);
    expect(isNearBudgetMonthEnd('2026-10-31', CURRENT)).toBe(true);
    expect(isNearBudgetMonthEnd('2026-02-22', '2026-02')).toBe(true);
    expect(isNearBudgetMonthEnd('2026-02-21', '2026-02')).toBe(false);
  });
});

describe('suggestedBudgetMonth (06 §3.14)', () => {
  it('w trakcie miesiąca — bieżący; w ostatnim tygodniu — następny', () => {
    expect(suggestedBudgetMonth('2026-10-24', CURRENT, new Set())).toBe('2026-10');
    expect(suggestedBudgetMonth('2026-10-25', CURRENT, new Set())).toBe('2026-11');
    expect(suggestedBudgetMonth('2026-10-31', CURRENT, new Set())).toBe('2026-11');
  });

  it('pierwszy miesiąc bez szkicu; cały zakres zaplanowany — null', () => {
    expect(suggestedBudgetMonth('2026-10-27', CURRENT, new Set(['2026-11', '2026-12']))).toBe(
      '2027-01',
    );
    const range = new Set<string>();
    for (let i = 0; i <= 12; i += 1) range.add(shiftMonth(CURRENT, i));
    expect(suggestedBudgetMonth('2026-10-05', CURRENT, range)).toBeNull();
  });
});

describe('liabilityInstallmentForMonth (07 §13.2, krok 4)', () => {
  const LOAN: BudgetLiabilityInput = {
    id: 'loan',
    name: 'Pożyczka',
    isActive: true,
    recurringRuleId: null,
    openingBalanceMinor: 1_000_00,
    balanceAsOf: '2026-10-01',
    monthlyPaymentMinor: 400_00,
    paymentDay: 15,
    firstPaymentOn: null,
    remainingMinor: 1_000_00,
    nextDueOn: '2026-10-15',
    paidThisMonth: false,
    lastPaymentOn: null,
  };

  it('rata z harmonogramu w miesiącu — ostatnia jest resztą; po spłacie brak', () => {
    expect(liabilityInstallmentForMonth(LOAN, NOVEMBER, CURRENT)).toEqual({
      id: 'loan',
      name: 'Pożyczka',
      installmentMinor: 400_00,
      dueOn: '2026-11-15',
    });
    expect(liabilityInstallmentForMonth(LOAN, '2026-12', CURRENT)?.installmentMinor).toBe(200_00);
    expect(liabilityInstallmentForMonth(LOAN, '2027-01', CURRENT)).toBeNull();
  });

  it('rata bieżącego miesiąca już zapłacona — nadal w planie, z dniem płatności', () => {
    expect(
      liabilityInstallmentForMonth(
        { ...LOAN, paidThisMonth: true, nextDueOn: '2026-11-15', lastPaymentOn: '2026-10-14' },
        CURRENT,
        CURRENT,
      ),
    ).toEqual({ id: 'loan', name: 'Pożyczka', installmentMinor: 400_00, dueOn: '2026-10-14' });
  });

  it('zobowiązanie z regułą raty albo nieaktywne — brak (rata jest w kroku 2)', () => {
    expect(
      liabilityInstallmentForMonth({ ...LOAN, recurringRuleId: 'r' }, NOVEMBER, CURRENT),
    ).toBeNull();
    expect(
      liabilityInstallmentForMonth({ ...LOAN, isActive: false }, NOVEMBER, CURRENT),
    ).toBeNull();
  });
});

describe('budgetActuals (07 §13.8)', () => {
  /**
   * Transakcja miesiąca — domyślnie zwykły wydatek 100 zł bez powiązań.
   *
   * @param overrides - Nadpisane pola.
   * @returns Transakcja.
   */
  const tx = (overrides: Partial<BudgetLedgerRow> = {}): BudgetLedgerRow => ({
    type: 'expense',
    amountMinor: 10_000,
    mainCategoryId: null,
    incomeSourceId: null,
    ruleId: null,
    plannedExpenseId: null,
    liabilityId: null,
    goalId: null,
    accountId: 'ror',
    counterAccountId: null,
    sourceAllocationClass: null,
    targetAllocationClass: null,
    allocationOverride: null,
    ...overrides,
  });
  /**
   * Linia szkicu — domyślnie własny wydatek bez kategorii.
   *
   * @param overrides - Nadpisane pola.
   * @returns Linia.
   */
  const line = (overrides: Partial<BudgetActualLine> = {}): BudgetActualLine => ({
    id: 'l',
    flow: 'expense',
    origin: 'manual',
    amountMinor: 10_000,
    isExcluded: false,
    mainCategoryId: null,
    incomeSourceId: null,
    goalId: null,
    liabilityId: null,
    plannedExpenseId: null,
    recurringRuleId: null,
    ...overrides,
  });
  const toSavings = {
    type: 'transfer' as const,
    sourceAllocationClass: 'spending' as const,
    targetAllocationClass: 'savings' as const,
    counterAccountId: 'sav',
  };
  const run = (lines: BudgetActualLine[], ledger: BudgetLedgerRow[]) =>
    budgetActuals({
      lines,
      ledger,
      goals: new Map([['g', { kind: 'savings' as const, linkedAccountId: null }]]),
      names: new Map([
        ['food', 'Jedzenie'],
        ['salary', 'Pensja'],
      ]),
    });

  it('linie powiązane: reguła, planowany, rata bez reguły, odkładanie', () => {
    const result = run(
      [
        line({ id: 'rent', origin: 'recurring', recurringRuleId: 'r1' }),
        line({ id: 'pay', origin: 'recurring', flow: 'income', recurringRuleId: 'r2' }),
        line({ id: 'move', origin: 'recurring', flow: 'savings', recurringRuleId: 'r3' }),
        line({ id: 'oc', origin: 'planned', plannedExpenseId: 'p1' }),
        line({ id: 'loan', origin: 'liability', liabilityId: 'd1' }),
        line({ id: 'aside', origin: 'set_aside', flow: 'savings', plannedExpenseId: 'p2' }),
      ],
      [
        tx({ ruleId: 'r1', amountMinor: 185_000 }),
        tx({ ruleId: 'r2', type: 'income', amountMinor: 1_180_000 }),
        tx({ ruleId: 'r3', amountMinor: 50_000, ...toSavings }),
        tx({ plannedExpenseId: 'p1', amountMinor: 240_000 }),
        // Rata z reguły nie liczy się do linii raty bez reguły.
        tx({ liabilityId: 'd1', amountMinor: 30_000 }),
        tx({ liabilityId: 'd1', ruleId: 'r9', amountMinor: 99_000 }),
        tx({ plannedExpenseId: 'p2', amountMinor: 20_000, ...toSavings }),
        // Wypłata z odkładania — netto.
        tx({
          plannedExpenseId: 'p2',
          amountMinor: 5_000,
          type: 'transfer',
          sourceAllocationClass: 'savings',
          targetAllocationClass: 'spending',
        }),
      ],
    );
    expect(result.lines).toEqual({
      rent: 185_000,
      pay: 1_180_000,
      move: 50_000,
      oc: 240_000,
      loan: 30_000,
      aside: 15_000,
    });
    // Wydatki 554 000, przypisane liniom 185 000 + 240 000 + 30 000; rata z reguły r9
    // bez linii — poza planem.
    expect(result.unplannedMinor).toBe(99_000);
    expect(result.totals).toEqual({
      incomeMinor: 1_180_000,
      expenseMinor: 554_000,
      savingsMinor: 65_000,
      investmentMinor: 0,
      netMinor: 1_180_000 - 554_000 - 65_000,
    });
  });

  it('cel: wpłaty netto bez przelewów z reguł, które mają własną linię', () => {
    const result = run(
      [
        line({ id: 'goal', origin: 'goal', flow: 'savings', goalId: 'g' }),
        line({ id: 'auto', origin: 'recurring', flow: 'savings', recurringRuleId: 'r1' }),
        line({ id: 'lost', origin: 'goal', flow: 'savings', goalId: 'nieznany' }),
        line({ id: 'none', origin: 'goal', flow: 'savings', goalId: null }),
      ],
      [
        tx({ goalId: 'g', amountMinor: 30_000, ...toSavings }),
        tx({ goalId: 'g', ruleId: 'r1', amountMinor: 50_000, ...toSavings }),
        // Reguła bez linii w szkicu — jej przelew liczy się do celu.
        tx({ goalId: 'g', ruleId: 'r2', amountMinor: 10_000, ...toSavings }),
        tx({
          goalId: 'g',
          amountMinor: 5_000,
          type: 'transfer',
          sourceAllocationClass: 'savings',
          targetAllocationClass: 'spending',
        }),
      ],
    );
    expect(result.lines).toEqual({ goal: 35_000, auto: 50_000, lost: 0, none: 0 });
  });

  it('linie własne: grupa kategorii z jednym wykonaniem, źródło przychodu, bez kategorii — brak', () => {
    const result = run(
      [
        line({ id: 'home', mainCategoryId: 'food', amountMinor: 150_000 }),
        line({ id: 'out', mainCategoryId: 'food', amountMinor: 40_000 }),
        line({ id: 'bonus', flow: 'income', incomeSourceId: 'salary', amountMinor: 50_000 }),
        line({ id: 'gift', flow: 'income', mainCategoryId: 'food', amountMinor: 1 }),
        line({ id: 'misc' }),
        line({ id: 'pool', flow: 'savings', mainCategoryId: 'food' }),
        line({ id: 'skip', mainCategoryId: 'cars', isExcluded: true }),
      ],
      [
        tx({ mainCategoryId: 'food', amountMinor: 120_000 }),
        tx({ mainCategoryId: 'food', amountMinor: 80_000 }),
        // Wydatek stały w tej kategorii — nie do grupy (ma własną linię albo jest poza planem).
        tx({ mainCategoryId: 'food', ruleId: 'r1', amountMinor: 7_000 }),
        tx({ type: 'income', incomeSourceId: 'salary', amountMinor: 60_000 }),
        tx({ type: 'income', incomeSourceId: 'salary', ruleId: 'r2', amountMinor: 1 }),
        tx({ mainCategoryId: 'cars', amountMinor: 30_000 }),
      ],
    );
    expect(result.lines).toEqual({});
    expect(result.groups).toEqual([
      {
        kind: 'category',
        id: 'food',
        name: 'Jedzenie',
        lineIds: ['home', 'out'],
        plannedMinor: 190_000,
        actualMinor: 200_000,
      },
      {
        kind: 'income_source',
        id: 'salary',
        name: 'Pensja',
        lineIds: ['bonus'],
        plannedMinor: 50_000,
        actualMinor: 60_000,
      },
      {
        kind: 'category',
        id: 'food',
        name: 'Jedzenie',
        lineIds: ['gift'],
        plannedMinor: 1,
        actualMinor: 0,
      },
    ]);
    // 237 000 wydatków − 200 000 w grupie „Jedzenie" = stały 7 000 + pominięte „Auto" 30 000.
    expect(result.unplannedMinor).toBe(37_000);
  });

  it('grupa bez nazwy i plan większy niż wydatki — poza planem nie jest ujemne', () => {
    const result = run(
      [line({ id: 'x', mainCategoryId: 'brak', amountMinor: 50_000 })],
      [tx({ mainCategoryId: 'brak', amountMinor: 1_000 })],
    );
    expect(result.groups[0]?.name).toBe('');
    expect(result.unplannedMinor).toBe(0);
    expect(run([], []).totals.netMinor).toBe(0);
  });
});
