import { describe, expect, it } from 'vitest';

import { evaluateBudget, type BudgetSourceState } from '../domain/budget.js';
import {
  BudgetDraftDtoSchema,
  BudgetLineParamsSchema,
  BudgetSourceStateSchema,
  CategoryAveragesQuerySchema,
  CreateBudgetDraftRequestSchema,
  CreateBudgetGroupRequestSchema,
  CreateBudgetLineRequestSchema,
  GroupBudgetByOriginRequestSchema,
  PromoteBudgetLineRequestSchema,
  UpdateBudgetDraftRequestSchema,
  UpdateBudgetGroupRequestSchema,
  UpdateBudgetLayoutRequestSchema,
  UpdateBudgetLineRequestSchema,
} from './budget.js';

/**
 * Testy kontraktów planera budżetu
 * ([05 §13b](../../../../plans/05-dto-contracts.md#13b-planer-budżetu--dtobudgetts), `F9-2`).
 */

const ID = '01J9ZQK8WQ0000000000000000';

describe('CreateBudgetDraftRequestSchema', () => {
  it('domyślnie: wypełnienie ze źródeł, bez kopii i średnich', () => {
    expect(CreateBudgetDraftRequestSchema.parse({})).toEqual({
      fillFromSources: true,
      averageLines: [],
    });
  });

  it('średnia domyślnie z 3 miesięcy; okno spoza 3/6/12 odrzucone', () => {
    expect(
      CreateBudgetDraftRequestSchema.parse({ averageLines: [{ categoryId: ID }] }).averageLines,
    ).toEqual([{ categoryId: ID, months: 3 }]);
    expect(
      CreateBudgetDraftRequestSchema.safeParse({ averageLines: [{ categoryId: ID, months: 4 }] })
        .success,
    ).toBe(false);
  });

  it('pusta notatka zapisywana jako brak', () => {
    expect(CreateBudgetDraftRequestSchema.parse({ notes: '  ' }).notes).toBeNull();
    expect(UpdateBudgetDraftRequestSchema.parse({ notes: 'Grudzień z prezentami' }).notes).toBe(
      'Grudzień z prezentami',
    );
  });
});

describe('CreateBudgetLineRequestSchema', () => {
  it('przyjmuje wydatek własny i wypłatę z oszczędności', () => {
    expect(
      CreateBudgetLineRequestSchema.safeParse({
        flow: 'expense',
        name: ' Prezent dla mamy ',
        amountMinor: 300_00,
        categoryId: ID,
      }).data?.name,
    ).toBe('Prezent dla mamy');
    expect(
      CreateBudgetLineRequestSchema.safeParse({
        flow: 'savings',
        name: 'Z poduszki',
        amountMinor: -500_00,
      }).success,
    ).toBe(true);
  });

  it('I-21 i I-23 z komunikatem przy polu', () => {
    const negative = CreateBudgetLineRequestSchema.safeParse({
      flow: 'expense',
      name: 'Zwrot',
      amountMinor: -1,
    });
    expect(negative.error?.issues[0]).toMatchObject({
      path: ['amountMinor'],
      message: 'Kwota ujemna jest dozwolona tylko dla oszczędności i inwestycji',
    });
    const categoryOnPool = CreateBudgetLineRequestSchema.safeParse({
      flow: 'investment',
      name: 'IKE',
      amountMinor: 100_00,
      categoryId: ID,
    });
    expect(categoryOnPool.error?.issues[0]?.path).toEqual(['categoryId']);
  });

  it('nazwa wymagana', () => {
    expect(
      CreateBudgetLineRequestSchema.safeParse({ flow: 'expense', name: ' ', amountMinor: 1 })
        .success,
    ).toBe(false);
  });
});

describe('UpdateBudgetLineRequestSchema', () => {
  it('każde pole opcjonalne, flow niezmienny, wykluczenie i kolejność', () => {
    expect(UpdateBudgetLineRequestSchema.parse({})).toEqual({});
    expect(UpdateBudgetLineRequestSchema.parse({ isExcluded: true, sortOrder: 3 })).toEqual({
      isExcluded: true,
      sortOrder: 3,
    });
    expect(UpdateBudgetLineRequestSchema.parse({ flow: 'income' })).toEqual({});
  });
});

describe('PromoteBudgetLineRequestSchema', () => {
  it('reguła: domyślnie co miesiąc, bez auto-księgowania, jako wydatek stały; konto wymagane', () => {
    expect(
      PromoteBudgetLineRequestSchema.parse({ target: 'recurring', dayOfMonth: 5, accountId: ID }),
    ).toEqual({
      target: 'recurring',
      frequency: 'monthly',
      intervalCount: 1,
      dayOfMonth: 5,
      accountId: ID,
      autoPost: false,
      amountIsEstimate: false,
      isFixedExpense: true,
    });
    expect(PromoteBudgetLineRequestSchema.safeParse({ target: 'recurring' }).success).toBe(false);
  });

  it('planowany wydatek: szacunek, bez odkładania, priorytet „planowane"', () => {
    expect(
      PromoteBudgetLineRequestSchema.parse({
        target: 'planned',
        dueMonth: '2027-02',
        dueOn: '2027-02-14',
      }),
    ).toEqual({
      target: 'planned',
      dueMonth: '2027-02',
      dueOn: '2027-02-14',
      priority: 'should',
      amountIsEstimate: true,
      setAsideEnabled: false,
      alreadySetAsideMinor: 0,
      repeatsYearly: false,
    });
  });

  it('nieznany cel zamiany odrzucony', () => {
    expect(PromoteBudgetLineRequestSchema.safeParse({ target: 'goal' }).success).toBe(false);
  });
});

describe('CategoryAveragesQuerySchema', () => {
  it('okno z zapytania jako liczba, domyślnie 3', () => {
    expect(CategoryAveragesQuerySchema.parse({})).toEqual({ months: 3 });
    expect(CategoryAveragesQuerySchema.parse({ months: '12' })).toEqual({ months: 12 });
    expect(CategoryAveragesQuerySchema.safeParse({ months: '5' }).success).toBe(false);
  });
});

describe('BudgetLineParamsSchema', () => {
  it('miesiąc i identyfikator linii', () => {
    expect(BudgetLineParamsSchema.safeParse({ monthKey: '2026-11', lineId: ID }).success).toBe(
      true,
    );
    expect(BudgetLineParamsSchema.safeParse({ monthKey: '2026-13', lineId: ID }).success).toBe(
      false,
    );
  });
});

describe('BudgetDraftDtoSchema', () => {
  it('stany źródła w DTO = stany z wyliczeń', () => {
    const states: readonly BudgetSourceState[] = BudgetSourceStateSchema.options;
    expect(states).toEqual(['in_sync', 'source_changed', 'not_in_month', 'missing']);
  });

  it('przyjmuje ocenę z evaluateBudget bez przeróbek', () => {
    const summary = evaluateBudget({
      month: '2026-11',
      lines: [
        {
          flow: 'income',
          origin: 'recurring',
          amountMinor: 1_000_00,
          isExcluded: false,
          incomeSourceId: null,
          goalId: null,
          liabilityId: null,
          plannedExpenseId: null,
          sourceState: 'in_sync',
        },
        {
          flow: 'expense',
          origin: 'manual',
          amountMinor: 1_200_00,
          isExcluded: false,
          incomeSourceId: null,
          goalId: null,
          liabilityId: null,
          plannedExpenseId: null,
          sourceState: null,
        },
      ],
      nonCountingIncomeSourceIds: new Set(),
      targets: { savingsBps: 2_000, investmentBps: 0, debtBps: 0 },
      goals: [],
      setAside: [],
    });
    const result = BudgetDraftDtoSchema.safeParse({
      id: ID,
      month: '2026-11',
      isEditable: true,
      notes: null,
      lastFilledAt: null,
      lines: [],
      groups: [{ id: ID, section: 'pools', name: 'Cele', sortOrder: 0 }],
      summary,
      actuals: null,
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });
});

describe('grupy i układ (07 §13.10, ADR-081)', () => {
  it('nowa grupa: nazwa przycięta, domyślnie bez linii i na końcu', () => {
    expect(CreateBudgetGroupRequestSchema.parse({ section: 'expense', name: '  Raty ' })).toEqual({
      section: 'expense',
      name: 'Raty',
      lineIds: [],
    });
    expect(
      CreateBudgetGroupRequestSchema.parse({
        section: 'pools',
        name: 'Cele',
        lineIds: [ID],
        position: 0,
      }),
    ).toEqual({ section: 'pools', name: 'Cele', lineIds: [ID], position: 0 });
  });

  it('nazwa pusta albo dłuższa niż 40 znaków odrzucona; sekcja spoza listy też', () => {
    expect(UpdateBudgetGroupRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(UpdateBudgetGroupRequestSchema.safeParse({ name: 'x'.repeat(41) }).success).toBe(false);
    expect(UpdateBudgetGroupRequestSchema.safeParse({ name: 'x'.repeat(40) }).success).toBe(true);
    expect(GroupBudgetByOriginRequestSchema.safeParse({ section: 'savings' }).success).toBe(false);
    expect(
      CreateBudgetGroupRequestSchema.safeParse({ section: 'expense', name: 'A', position: -1 })
        .success,
    ).toBe(false);
  });

  it('układ sekcji: grupy z liniami i linie bez grupy', () => {
    const body = { section: 'income', groups: [{ id: ID, lineIds: [ID] }], ungroupedLineIds: [] };
    expect(UpdateBudgetLayoutRequestSchema.parse(body)).toEqual(body);
    expect(
      UpdateBudgetLayoutRequestSchema.safeParse({ section: 'income', groups: [] }).success,
    ).toBe(false);
  });

  it('linia przyjmuje grupę albo jej brak', () => {
    expect(UpdateBudgetLineRequestSchema.parse({ groupId: null })).toEqual({ groupId: null });
    expect(UpdateBudgetLineRequestSchema.parse({ groupId: ID })).toEqual({ groupId: ID });
  });
});
