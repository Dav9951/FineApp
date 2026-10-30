import { formatMinor } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import { budgetLineFixture, SUMMARY_FIXTURE } from '../../../test/budget-fixture.js';
import {
  allocationRow,
  averageForCategory,
  budgetSections,
  excludedLines,
  goalRows,
  groupProgress,
  lineCaption,
  lineKind,
  missingLineFor,
  progressByLine,
  progressText,
  sourceNote,
  sourceNoteText,
} from './budget-view.js';

/**
 * Testy reguł ekranu planera
 * ([06 §3.14](../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth), `F9-6`).
 */

describe('budgetSections', () => {
  it('trzy sekcje w kolejności 06 §3.14, sumy bez pominiętych, puste też', () => {
    const sections = budgetSections([
      budgetLineFixture({ id: 'a', flow: 'income', name: 'Pensja', amountMinor: 1_000_000 }),
      budgetLineFixture({ id: 'b' }),
      budgetLineFixture({ id: 'c', name: 'Netflix', amountMinor: 4_300, isExcluded: true }),
      budgetLineFixture({ id: 'd', flow: 'investment', name: 'IKE', amountMinor: 100_000 }),
      budgetLineFixture({ id: 'e', flow: 'savings', name: 'Z odłożonego', amountMinor: -50_000 }),
    ]);
    expect(sections.map((section) => [section.title, section.totalMinor, section.addFlow])).toEqual(
      [
        ['Wpływy', 1_000_000, 'income'],
        ['Wydatki', 185_000, 'expense'],
        ['Oszczędności i inwestycje', 50_000, 'savings'],
      ],
    );
    expect(sections[1]?.lines.map((line) => line.id)).toEqual(['b']);
    expect(budgetSections([]).every((section) => section.lines.length === 0)).toBe(true);
  });

  it('grupy w kolejności, „Bez grupy" na końcu; sekcja bez grup — pusta lista grup', () => {
    const groups = [
      { id: 'raty', section: 'expense' as const, name: 'Raty', sortOrder: 1 },
      { id: 'dom', section: 'expense' as const, name: 'Dom', sortOrder: 0 },
      { id: 'cele', section: 'pools' as const, name: 'Cele', sortOrder: 0 },
    ];
    const sections = budgetSections(
      [
        budgetLineFixture({ id: 'rata', groupId: 'raty', amountMinor: 90_000 }),
        budgetLineFixture({ id: 'czynsz', groupId: 'dom', amountMinor: 185_000 }),
        budgetLineFixture({ id: 'jedzenie', amountMinor: 190_000 }),
        budgetLineFixture({ id: 'netflix', groupId: 'dom', isExcluded: true }),
        budgetLineFixture({ id: 'pensja', flow: 'income', amountMinor: 1_000_000 }),
      ],
      groups,
    );
    const [income, expense, pools] = sections;
    expect(income?.groups).toEqual([]);
    expect(
      expense?.groups.map((view) => [
        view.group?.name ?? null,
        view.lines.map((line) => line.id),
        view.totalMinor,
      ]),
    ).toEqual([
      ['Dom', ['czynsz'], 185_000],
      ['Raty', ['rata'], 90_000],
      [null, ['jedzenie'], 190_000],
    ]);
    expect(expense?.lines.map((line) => line.id)).toEqual(['czynsz', 'rata', 'jedzenie']);
    // Pusta grupa sekcji też jest — widać ją w trybie układania.
    expect(pools?.groups.map((view) => [view.group?.name ?? null, view.lines.length])).toEqual([
      ['Cele', 0],
      [null, 0],
    ]);
  });

  it('pominięte osobno', () => {
    expect(
      excludedLines([budgetLineFixture(), budgetLineFixture({ id: 'x', isExcluded: true })]).map(
        (line) => line.id,
      ),
    ).toEqual(['x']);
  });
});

describe('lineKind i lineCaption', () => {
  it('pochodzenie; linia własna ze średniej ma swój rodzaj', () => {
    expect(lineKind(budgetLineFixture())).toBe('recurring');
    expect(lineKind(budgetLineFixture({ origin: 'manual' }))).toBe('manual');
    expect(lineKind(budgetLineFixture({ origin: 'manual', averageMonths: 3 }))).toBe('average');
  });

  it('podpis: kategoria i okno średniej', () => {
    expect(lineCaption(budgetLineFixture())).toBe('Mieszkanie');
    expect(lineCaption(budgetLineFixture({ categoryName: 'Jedzenie', averageMonths: 3 }))).toBe(
      'Jedzenie · średnia 3 mies.',
    );
    expect(lineCaption(budgetLineFixture({ categoryName: null }))).toBeNull();
  });
});

describe('sourceNote (07 §13.5)', () => {
  it('zmiana w źródle — z kwotą do „Przyjmij"', () => {
    const note = sourceNote(
      budgetLineFixture({ sourceState: 'source_changed', sourceCurrentAmountMinor: 195_000 }),
    );
    expect(note).toEqual({ kind: 'changed', amountMinor: 195_000 });
    expect(sourceNoteText(note ?? { kind: 'missing' }, 'recurring')).toBe(
      `W regule teraz ${formatMinor(195_000)}`,
    );
    expect(sourceNoteText({ kind: 'changed', amountMinor: 1 }, 'planned')).toBe(
      `W źródle teraz ${formatMinor(1)}`,
    );
  });

  it('edycja w szkicu — kwota źródła jako podpis; zgodna — bez notki', () => {
    expect(sourceNote(budgetLineFixture({ amountMinor: 190_000 }))).toEqual({
      kind: 'edited',
      amountMinor: 185_000,
    });
    expect(sourceNoteText({ kind: 'edited', amountMinor: 185_000 }, 'recurring')).toBe(
      `w regule ${formatMinor(185_000)}`,
    );
    expect(sourceNote(budgetLineFixture())).toBeNull();
  });

  it('źródło bez terminu, usunięte, linia własna, szkic tylko do odczytu', () => {
    expect(sourceNote(budgetLineFixture({ sourceState: 'not_in_month' }))).toEqual({
      kind: 'not_in_month',
    });
    expect(sourceNoteText({ kind: 'not_in_month' }, 'recurring')).toBe('Nie wypada w tym miesiącu');
    expect(sourceNote(budgetLineFixture({ sourceState: 'missing' }))).toEqual({ kind: 'missing' });
    expect(sourceNoteText({ kind: 'missing' }, 'goal')).toBe('Źródło usunięto');
    expect(sourceNote(budgetLineFixture({ sourceState: null }))).toBeNull();
    expect(
      sourceNote(
        budgetLineFixture({ sourceState: 'source_changed', sourceCurrentAmountMinor: null }),
      ),
    ).toBeNull();
  });
});

describe('podsumowanie', () => {
  it('wiersz rozkładu: procent planu z celu i wypełnienie paska', () => {
    expect(allocationRow(SUMMARY_FIXTURE.allocation[0] ?? SUMMARY_FIXTURE.allocation[1]!)).toEqual({
      label: 'Oszczędności 18,4% z 20,0%',
      fulfillmentBps: 9_195,
    });
    expect(
      allocationRow({ ...SUMMARY_FIXTURE.allocation[1]!, kind: 'debt', targetMinor: 0 })
        .fulfillmentBps,
    ).toBe(10_000);
  });

  it('„Dodaj brakujące": niedobór puli i celu; reszta bez przycisku', () => {
    const [allocationWarning] = SUMMARY_FIXTURE.warnings;
    expect(missingLineFor(allocationWarning!, SUMMARY_FIXTURE)).toEqual({
      flow: 'savings',
      name: 'Uzupełnienie oszczędności',
      amountMinor: 19_000,
      notes: null,
    });
    expect(
      missingLineFor(
        { ...allocationWarning!, target: { kind: 'investment', id: null } },
        SUMMARY_FIXTURE,
      )?.name,
    ).toBe('Uzupełnienie inwestycji');
    expect(
      missingLineFor(
        {
          code: 'GOAL_SHORT',
          message: '',
          amountMinor: 30_000,
          target: { kind: 'goal', id: '01JG0000000000000000000001' },
        },
        SUMMARY_FIXTURE,
      ),
    ).toEqual({
      flow: 'savings',
      name: 'Wpłata: Poduszka',
      amountMinor: 30_000,
      goalId: '01JG0000000000000000000001',
      notes: null,
    });
    for (const warning of [
      { ...allocationWarning!, target: { kind: 'debt' as const, id: null } },
      { ...allocationWarning!, amountMinor: null },
      { ...allocationWarning!, target: null },
      {
        code: 'GOAL_SHORT' as const,
        message: '',
        amountMinor: 1,
        target: { kind: 'goal' as const, id: 'nie-ma' },
      },
      {
        code: 'SET_ASIDE_SHORT' as const,
        message: '',
        amountMinor: 1,
        target: { kind: 'planned_expense' as const, id: 'p' },
      },
    ]) {
      expect(missingLineFor(warning, SUMMARY_FIXTURE)).toBeNull();
    }
  });

  it('cele z wymaganiem i odkładanie', () => {
    expect(
      goalRows({
        ...SUMMARY_FIXTURE,
        goals: [
          ...SUMMARY_FIXTURE.goals,
          {
            ...SUMMARY_FIXTURE.goals[0]!,
            goalId: 'g2',
            requiredMinor: null,
            status: 'no_requirement',
          },
        ],
        setAside: [
          {
            plannedExpenseId: 'p',
            name: 'OC',
            dueMonth: '2027-03',
            requiredMinor: 17_000,
            plannedMinor: 17_000,
            status: 'met',
          },
        ],
      }),
    ).toEqual([
      {
        key: 'goal:01JG0000000000000000000001',
        name: 'Poduszka',
        plannedMinor: 0,
        requiredMinor: 30_000,
        met: false,
      },
      {
        key: 'set_aside:p',
        name: 'Odkładanie: OC',
        plannedMinor: 17_000,
        requiredMinor: 17_000,
        met: true,
      },
    ]);
  });
});

describe('averageForCategory (07 §13.3)', () => {
  const averages = {
    months: 3 as const,
    window: { from: '2026-07', to: '2026-09' },
    monthsWithData: 3,
    items: [
      { categoryId: 'food', name: 'Jedzenie', icon: null, averageMinor: 187_400, byMonth: [] },
    ],
  };
  const tree = [
    {
      id: 'food',
      parentId: null,
      name: 'Jedzenie',
      slug: 'jedzenie',
      kind: 'expense' as const,
      icon: null,
      color: null,
      aiHints: null,
      isSystem: true,
      isArchived: false,
      sortOrder: 0,
      children: [
        {
          id: 'grocery',
          parentId: 'food',
          name: 'Zakupy',
          slug: 'zakupy',
          kind: 'expense' as const,
          icon: null,
          color: null,
          aiHints: null,
          isSystem: true,
          isArchived: false,
          sortOrder: 0,
        },
      ],
    },
  ] as Parameters<typeof averageForCategory>[1];

  it('kategoria główna i jej podkategoria mają średnią głównej', () => {
    expect(averageForCategory(averages, tree, 'food')).toBe(187_400);
    expect(averageForCategory(averages, tree, 'grocery')).toBe(187_400);
  });

  it('bez danych, bez kategorii, kategoria bez wydatków — null', () => {
    expect(averageForCategory(undefined, tree, 'food')).toBeNull();
    expect(averageForCategory(averages, tree, null)).toBeNull();
    expect(averageForCategory(averages, tree, 'other')).toBeNull();
  });
});

describe('progressByLine i progressText (07 §13.8, F9-9)', () => {
  const totals = {
    incomeMinor: 0,
    expenseMinor: 0,
    savingsMinor: 0,
    investmentMinor: 0,
    netMinor: 0,
  };
  const rent = budgetLineFixture({ id: 'rent' });
  const home = budgetLineFixture({
    id: 'home',
    origin: 'manual',
    name: 'Jedzenie — dom',
    amountMinor: 150_000,
  });
  const out = budgetLineFixture({
    id: 'out',
    origin: 'manual',
    name: 'Jedzenie — miasto',
    amountMinor: 40_000,
  });
  const pay = budgetLineFixture({ id: 'pay', flow: 'income', amountMinor: 1_000_000 });
  const aside = budgetLineFixture({
    id: 'aside',
    flow: 'savings',
    origin: 'set_aside',
    amountMinor: -50_000,
  });

  it('miesiąc przyszły — nic', () => {
    expect(progressByLine(null, [rent]).size).toBe(0);
  });

  it('linia powiązana osobno; grupa pod ostatnią linią z podpisem „razem"', () => {
    const map = progressByLine(
      {
        lines: { rent: 185_000, pay: 900_000, aside: -50_000 },
        groups: [
          {
            kind: 'category',
            id: 'food',
            name: 'Jedzenie',
            lineIds: ['out', 'home'],
            plannedMinor: 190_000,
            actualMinor: 202_000,
          },
          {
            kind: 'category',
            id: 'x',
            name: 'X',
            lineIds: ['nieznana'],
            plannedMinor: 1,
            actualMinor: 0,
          },
        ],
        totals,
        unplannedMinor: 0,
      },
      [rent, home, out, pay, aside],
    );
    expect(map.get('rent')).toMatchObject({
      remainingMinor: 0,
      overMinor: 0,
      fulfillmentBps: 10_000,
      label: null,
    });
    expect(map.has('home')).toBe(false);
    const food = map.get('out');
    expect(food).toMatchObject({ label: 'Jedzenie razem', overMinor: 12_000, overIsWarning: true });
    expect(progressText(food ?? map.get('rent')!)).toEqual({
      verb: 'wydano',
      rest: { label: 'ponad plan', amountMinor: 12_000 },
    });
    const income = map.get('pay');
    expect(income).toMatchObject({ remainingMinor: 100_000, overIsWarning: false });
    expect(progressText(income!)).toEqual({
      verb: 'wpłynęło',
      rest: { label: 'brakuje', amountMinor: 100_000 },
    });
    // Plan ujemny (odkładanie w miesiącu terminu) — bez „zostało" i bez NaN.
    const pool = map.get('aside');
    expect(pool).toMatchObject({ remainingMinor: 0, overMinor: 0, fulfillmentBps: 0 });
    expect(progressText(pool!)).toEqual({ verb: 'odłożono', rest: null });
  });

  it('wydatek w trakcie — „zostało"', () => {
    const map = progressByLine(
      { lines: { rent: 100_000 }, groups: [], totals, unplannedMinor: 0 },
      [rent],
    );
    expect(progressText(map.get('rent')!)).toEqual({
      verb: 'wydano',
      rest: { label: 'zostało', amountMinor: 85_000 },
    });
  });
});

describe('groupProgress (07 §13.10)', () => {
  const totals = {
    incomeMinor: 0,
    expenseMinor: 0,
    savingsMinor: 0,
    investmentMinor: 0,
    netMinor: 0,
  };
  const groupOf = (id: string, name: string) => ({
    id,
    section: 'expense' as const,
    name,
    sortOrder: 0,
  });
  const home = budgetLineFixture({
    id: 'home',
    origin: 'manual',
    amountMinor: 150_000,
    groupId: 'a',
  });
  const rent = budgetLineFixture({ id: 'rent', amountMinor: 185_000, groupId: 'a' });
  const out = budgetLineFixture({ id: 'out', origin: 'manual', amountMinor: 40_000, groupId: 'b' });
  const sections = (lines: ReturnType<typeof budgetLineFixture>[]) =>
    budgetSections(lines, [groupOf('a', 'Dom'), groupOf('b', 'Miasto')])[1]?.groups ?? [];

  it('suma wykonań linii i wspólnych wykonań kategorii leżących w grupie', () => {
    const [dom] = sections([home, rent, { ...out, groupId: 'a' }]);
    const actuals = {
      lines: { rent: 185_000 },
      groups: [
        {
          kind: 'category' as const,
          id: 'food',
          name: 'Jedzenie',
          lineIds: ['home', 'out'],
          plannedMinor: 190_000,
          actualMinor: 120_000,
        },
      ],
      totals,
      unplannedMinor: 0,
    };
    expect(dom === undefined ? null : groupProgress(actuals, dom)).toMatchObject({
      plannedMinor: 375_000,
      actualMinor: 305_000,
      remainingMinor: 70_000,
      label: null,
      flow: 'expense',
    });
  });

  it('wspólne wykonanie dzieli grupy — sam plan; bez wykonania i w przyszłości — nic', () => {
    const [dom, miasto, loose] = sections([home, rent, out]);
    const actuals = {
      lines: { rent: 185_000 },
      groups: [
        {
          kind: 'category' as const,
          id: 'food',
          name: 'Jedzenie',
          lineIds: ['home', 'out'],
          plannedMinor: 190_000,
          actualMinor: 120_000,
        },
      ],
      totals,
      unplannedMinor: 0,
    };
    expect(dom === undefined ? 'x' : groupProgress(actuals, dom)).toBeNull();
    expect(miasto === undefined ? 'x' : groupProgress(actuals, miasto)).toBeNull();
    expect(loose === undefined ? 'x' : groupProgress(actuals, loose)).toBeNull();
    expect(dom === undefined ? 'x' : groupProgress(null, dom)).toBeNull();
    const noActual = { lines: {}, groups: [], totals, unplannedMinor: 0 };
    expect(miasto === undefined ? 'x' : groupProgress(noActual, miasto)).toBeNull();
  });

  it('grupa mieszająca oszczędności z inwestycjami i pusta — bez wykonania', () => {
    const pools =
      budgetSections(
        [
          budgetLineFixture({ id: 's', flow: 'savings', groupId: 'p' }),
          budgetLineFixture({ id: 'i', flow: 'investment', groupId: 'p' }),
        ],
        [
          { id: 'p', section: 'pools', name: 'Pule', sortOrder: 0 },
          { id: 'e', section: 'pools', name: 'Pusta', sortOrder: 1 },
        ],
      )[2]?.groups ?? [];
    const actuals = { lines: { s: 1, i: 1 }, groups: [], totals, unplannedMinor: 0 };
    expect(pools.map((view) => groupProgress(actuals, view))).toEqual([null, null, null]);
  });
});
