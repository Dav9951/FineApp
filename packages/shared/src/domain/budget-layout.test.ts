import { describe, expect, it } from 'vitest';

import {
  budgetLayoutKeys,
  budgetSectionOf,
  groupsByOrigin,
  inheritBudgetLayout,
  normalizeBudgetName,
  sortBudgetLines,
  type BudgetLayoutGroup,
  type BudgetLayoutLine,
} from './budget-layout.js';

/**
 * Linia do testów — domyślnie wydatek własny bez grupy.
 *
 * @param id - Identyfikator.
 * @param fields - Nadpisane pola.
 * @returns Linia.
 */
function line(id: string, fields: Partial<BudgetLayoutLine> = {}): BudgetLayoutLine {
  return {
    id,
    flow: 'expense',
    name: id,
    origin: 'manual',
    categoryId: null,
    recurringRuleId: null,
    plannedExpenseId: null,
    goalId: null,
    liabilityId: null,
    groupId: null,
    sortOrder: 0,
    ...fields,
  };
}

/**
 * Grupa do testów.
 *
 * @param id - Identyfikator.
 * @param name - Nazwa.
 * @param sortOrder - Pozycja.
 * @param section - Sekcja.
 * @returns Grupa.
 */
function group(
  id: string,
  name: string,
  sortOrder: number,
  section: BudgetLayoutGroup['section'] = 'expense',
): BudgetLayoutGroup {
  return { id, name, sortOrder, section };
}

describe('budgetSectionOf', () => {
  it('oszczędności i inwestycje dzielą sekcję pul', () => {
    expect(budgetSectionOf('income')).toBe('income');
    expect(budgetSectionOf('expense')).toBe('expense');
    expect(budgetSectionOf('savings')).toBe('pools');
    expect(budgetSectionOf('investment')).toBe('pools');
  });
});

describe('normalizeBudgetName', () => {
  it('przycina i zmniejsza litery po polsku', () => {
    expect(normalizeBudgetName('  ŻYWNOŚĆ ')).toBe('żywność');
    expect(normalizeBudgetName('Raty')).toBe(normalizeBudgetName('raty'));
  });
});

describe('sortBudgetLines', () => {
  it('sekcje po kolei, grupy w kolejności, linie bez grupy na końcu sekcji', () => {
    const groups = [group('g2', 'Raty', 1), group('g1', 'Dom', 0), group('p1', 'Cele', 0, 'pools')];
    const lines = [
      line('loose', { sortOrder: 0 }),
      line('rata', { groupId: 'g2', sortOrder: 5 }),
      line('czynsz', { groupId: 'g1', sortOrder: 9 }),
      line('prad', { groupId: 'g1', sortOrder: 2 }),
      line('ike', { flow: 'investment', groupId: 'p1', sortOrder: 0 }),
      line('pensja', { flow: 'income', sortOrder: 3 }),
      line('poduszka', { flow: 'savings', sortOrder: 1 }),
    ];
    expect(sortBudgetLines(groups, lines).map((item) => item.id)).toEqual([
      'pensja',
      'prad',
      'czynsz',
      'rata',
      'loose',
      'ike',
      'poduszka',
    ]);
  });

  it('remis kolejności rozstrzyga identyfikator; grupa z innej sekcji — „Bez grupy"', () => {
    const groups = [group('p1', 'Cele', 0, 'pools')];
    const lines = [
      line('b'),
      line('a'),
      line('obca', { groupId: 'p1' }),
      line('znikla', { groupId: 'x' }),
    ];
    expect(sortBudgetLines(groups, lines).map((item) => item.id)).toEqual([
      'a',
      'b',
      'obca',
      'znikla',
    ]);
  });
});

it('ta sama linia dwa razy — kolejność stabilna', () => {
  const same = line('a');
  expect(sortBudgetLines([], [same, same])).toEqual([same, same]);
});

describe('budgetLayoutKeys', () => {
  it('klucz źródła według pochodzenia, zapasowy według strony i nazwy', () => {
    expect(
      budgetLayoutKeys(line('a', { origin: 'recurring', recurringRuleId: 'r1', name: ' Czynsz' })),
    ).toEqual({
      source: 'rule:r1',
      fallback: 'expense:czynsz',
    });
    expect(budgetLayoutKeys(line('a', { origin: 'planned', plannedExpenseId: 'p1' })).source).toBe(
      'planned:p1',
    );
    expect(
      budgetLayoutKeys(line('a', { origin: 'set_aside', plannedExpenseId: 'p1' })).source,
    ).toBe('set_aside:p1');
    expect(budgetLayoutKeys(line('a', { origin: 'goal', goalId: 'c1' })).source).toBe('goal:c1');
    expect(budgetLayoutKeys(line('a', { origin: 'liability', liabilityId: 'l1' })).source).toBe(
      'liability:l1',
    );
    expect(budgetLayoutKeys(line('a', { categoryId: 'k1', name: 'Jedzenie' })).source).toBe(
      'manual:expense:k1:jedzenie',
    );
    expect(budgetLayoutKeys(line('a', { name: 'Prezent' })).source).toBe('manual:expense::prezent');
  });

  it('linia osierocona nie ma klucza źródła', () => {
    for (const origin of ['recurring', 'planned', 'set_aside', 'goal', 'liability'] as const) {
      expect(budgetLayoutKeys(line('a', { origin })).source).toBeNull();
    }
  });
});

describe('inheritBudgetLayout', () => {
  const groups = [
    group('g-dom', 'Mieszkanie', 0),
    group('g-raty', 'Raty', 1),
    group('g-pusta', 'Pusta', 2),
  ];
  const previous = [
    line('o-czynsz', {
      origin: 'recurring',
      recurringRuleId: 'r-czynsz',
      name: 'Czynsz',
      groupId: 'g-dom',
      sortOrder: 1,
    }),
    line('o-prad', {
      origin: 'recurring',
      recurringRuleId: 'r-prad',
      name: 'Prąd',
      groupId: 'g-dom',
      sortOrder: 0,
    }),
    line('o-rata', {
      origin: 'liability',
      liabilityId: 'l1',
      name: 'Rata',
      groupId: 'g-raty',
      sortOrder: 2,
    }),
    line('o-jedzenie', { categoryId: 'k-jedz', name: 'Jedzenie', sortOrder: 3 }),
  ];

  it('kopiuje grupy (także puste) i przenosi linie do odpowiedników', () => {
    const next = [
      line('n-rata', { origin: 'liability', liabilityId: 'l1', name: 'Rata' }),
      line('n-czynsz', { origin: 'recurring', recurringRuleId: 'r-czynsz', name: 'Czynsz' }),
      line('n-nowa', { origin: 'recurring', recurringRuleId: 'r-nowa', name: 'Siłownia' }),
      line('n-prad', { origin: 'recurring', recurringRuleId: 'r-prad', name: 'Prąd' }),
      line('n-jedzenie', { categoryId: 'k-jedz', name: 'jedzenie ' }),
    ];
    const result = inheritBudgetLayout({ groups, lines: previous }, next);
    expect(result.groups.map((item) => [item.sourceGroupId, item.name, item.sortOrder])).toEqual([
      ['g-dom', 'Mieszkanie', 0],
      ['g-raty', 'Raty', 1],
      ['g-pusta', 'Pusta', 2],
    ]);
    // Kolejność źródła: prąd, czynsz (Mieszkanie), rata (Raty), jedzenie (bez grupy).
    expect(result.placements).toEqual([
      { sourceGroupId: 'g-raty', sortOrder: 2 },
      { sourceGroupId: 'g-dom', sortOrder: 1 },
      { sourceGroupId: null, sortOrder: 4 },
      { sourceGroupId: 'g-dom', sortOrder: 0 },
      { sourceGroupId: null, sortOrder: 3 },
    ]);
  });

  it('reguła z nowym identyfikatorem trafia po nazwie; każdy odpowiednik raz', () => {
    const next = [
      line('n1', { origin: 'recurring', recurringRuleId: 'r-czynsz-2', name: 'CZYNSZ' }),
      line('n2', { origin: 'recurring', recurringRuleId: 'r-czynsz-3', name: 'Czynsz' }),
    ];
    expect(inheritBudgetLayout({ groups, lines: previous }, next).placements).toEqual([
      { sourceGroupId: 'g-dom', sortOrder: 1 },
      { sourceGroupId: null, sortOrder: 4 },
    ]);
  });

  it('dopasowanie po kluczu źródła wygrywa z dopasowaniem po nazwie innej linii', () => {
    const next = [
      line('n-imienna', { origin: 'recurring', recurringRuleId: 'r-inna', name: 'Prąd' }),
      line('n-prad', { origin: 'recurring', recurringRuleId: 'r-prad', name: 'Prąd' }),
    ];
    expect(inheritBudgetLayout({ groups, lines: previous }, next).placements).toEqual([
      { sourceGroupId: null, sortOrder: 4 },
      { sourceGroupId: 'g-dom', sortOrder: 0 },
    ]);
  });

  it('odpowiednik z innej sekcji albo z nieznaną grupą — bez grupy', () => {
    const prev = [
      line('o-wplata', {
        flow: 'savings',
        origin: 'goal',
        goalId: 'c1',
        name: 'Poduszka',
        groupId: 'g-dom',
      }),
      line('o-sierota', { name: 'Sierota', groupId: 'g-nieznana' }),
    ];
    const next = [
      line('n-wplata', { flow: 'expense', origin: 'goal', goalId: 'c1', name: 'Poduszka' }),
      line('n-sierota', { name: 'Sierota' }),
    ];
    expect(
      inheritBudgetLayout({ groups, lines: prev }, next).placements.map(
        (item) => item.sourceGroupId,
      ),
    ).toEqual([null, null]);
  });

  it('linia osierocona w źródle dopasowuje się po nazwie', () => {
    const prev = [line('o', { origin: 'recurring', name: 'Siłownia', groupId: 'g-dom' })];
    const next = [
      line('n', { origin: 'recurring', recurringRuleId: 'r-nowa', name: 'Siłownia' }),
      line('sierota', { origin: 'recurring', name: 'Czynsz' }),
    ];
    expect(inheritBudgetLayout({ groups, lines: [...prev, ...previous] }, next).placements).toEqual(
      [
        { sourceGroupId: 'g-dom', sortOrder: 0 },
        { sourceGroupId: 'g-dom', sortOrder: 2 },
      ],
    );
  });

  it('bez szkicu źródłowego — bez grup, kolejność wejścia', () => {
    const result = inheritBudgetLayout({ groups: [], lines: [] }, [line('a'), line('b')]);
    expect(result).toEqual({
      groups: [],
      placements: [
        { sourceGroupId: null, sortOrder: 0 },
        { sourceGroupId: null, sortOrder: 1 },
      ],
    });
  });

  it('grupy sekcji po kolei: wpływy, wydatki, pule', () => {
    const result = inheritBudgetLayout(
      {
        groups: [
          group('p', 'Cele', 0, 'pools'),
          group('e', 'Dom', 0),
          group('i', 'Pensje', 0, 'income'),
        ],
        lines: [],
      },
      [],
    );
    expect(result.groups.map((item) => item.sourceGroupId)).toEqual(['i', 'e', 'p']);
    expect(result.groups.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
  });
});

describe('groupsByOrigin', () => {
  it('Stałe, Planowane, Zmienne — bez pustych, z zachowaną kolejnością', () => {
    expect(
      groupsByOrigin([
        { id: 'jedzenie', origin: 'manual' },
        { id: 'czynsz', origin: 'recurring' },
        { id: 'rata', origin: 'liability' },
        { id: 'cel', origin: 'goal' },
      ]),
    ).toEqual([
      { name: 'Stałe', lineIds: ['czynsz', 'rata'] },
      { name: 'Zmienne', lineIds: ['jedzenie', 'cel'] },
    ]);
    expect(
      groupsByOrigin([
        { id: 'opony', origin: 'planned' },
        { id: 'oc', origin: 'set_aside' },
      ]),
    ).toEqual([{ name: 'Planowane', lineIds: ['opony', 'oc'] }]);
    expect(groupsByOrigin([])).toEqual([]);
  });
});
