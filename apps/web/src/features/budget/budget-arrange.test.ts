import { describe, expect, it } from 'vitest';

import { budgetLineFixture } from '../../../test/budget-fixture.js';
import {
  arrangeItems,
  dropArrangeItem,
  layoutRequest,
  moveGroupBy,
  NO_GROUP_ITEM,
} from './budget-arrange.js';
import { budgetSections } from './budget-view.js';

/**
 * Testy trybu „Układaj"
 * ([06 §3.14](../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth),
 * 07 §13.10, ADR-081).
 */

/** Dom (czynsz, prąd), Raty (rata), bez grupy: jedzenie. */
const ITEMS = ['g:dom', 'l:czynsz', 'l:prad', 'g:raty', 'l:rata', NO_GROUP_ITEM, 'l:jedzenie'];

describe('arrangeItems', () => {
  it('sekcja bez grup — same wiersze; z grupami — nagłówki i „Bez grupy" na końcu', () => {
    const lines = [
      budgetLineFixture({ id: 'czynsz', groupId: 'dom', sortOrder: 0 }),
      budgetLineFixture({ id: 'jedzenie', sortOrder: 1 }),
      budgetLineFixture({ id: 'rata', groupId: 'raty', sortOrder: 2 }),
      budgetLineFixture({ id: 'prad', groupId: 'dom', sortOrder: 3 }),
    ];
    const groups = [
      { id: 'dom', section: 'expense' as const, name: 'Dom', sortOrder: 0 },
      { id: 'raty', section: 'expense' as const, name: 'Raty', sortOrder: 1 },
    ];
    const [, expense] = budgetSections(lines, groups);
    expect(expense === undefined ? [] : arrangeItems(expense)).toEqual(ITEMS);
    const [, plain] = budgetSections(lines.map((line) => ({ ...line, groupId: null })));
    expect(plain === undefined ? [] : arrangeItems(plain)).toEqual([
      'l:czynsz',
      'l:jedzenie',
      'l:rata',
      'l:prad',
    ]);
  });
});

describe('dropArrangeItem', () => {
  it('wiersz do innej grupy — grupą staje się nagłówek nad nim', () => {
    expect(dropArrangeItem(ITEMS, ITEMS, 'l:prad', 'l:rata')).toEqual([
      'g:dom',
      'l:czynsz',
      'g:raty',
      'l:rata',
      'l:prad',
      NO_GROUP_ITEM,
      'l:jedzenie',
    ]);
    // Na „Bez grupy" od góry — pierwszy bez grupy.
    expect(dropArrangeItem(ITEMS, ITEMS, 'l:rata', NO_GROUP_ITEM)).toEqual([
      'g:dom',
      'l:czynsz',
      'l:prad',
      'g:raty',
      NO_GROUP_ITEM,
      'l:rata',
      'l:jedzenie',
    ]);
  });

  it('wiersz nad pierwszy nagłówek — zostaje w pierwszej grupie', () => {
    expect(dropArrangeItem(ITEMS, ITEMS, 'l:jedzenie', 'g:dom')).toEqual([
      'g:dom',
      'l:jedzenie',
      'l:czynsz',
      'l:prad',
      'g:raty',
      'l:rata',
      NO_GROUP_ITEM,
    ]);
  });

  it('nagłówek grupy jedzie z wierszami; „Bez grupy" zostaje na końcu', () => {
    expect(dropArrangeItem(ITEMS, ITEMS, 'g:raty', 'g:dom')).toEqual([
      'g:raty',
      'l:rata',
      'g:dom',
      'l:czynsz',
      'l:prad',
      NO_GROUP_ITEM,
      'l:jedzenie',
    ]);
    expect(dropArrangeItem(ITEMS, ITEMS, 'g:dom', 'l:jedzenie')).toEqual([
      'g:raty',
      'l:rata',
      'g:dom',
      'l:czynsz',
      'l:prad',
      NO_GROUP_ITEM,
      'l:jedzenie',
    ]);
  });

  it('wiersze zwiniętej grupy zostają pod jej nagłówkiem', () => {
    const visible = ['g:dom', 'g:raty', 'l:rata', NO_GROUP_ITEM, 'l:jedzenie'];
    expect(dropArrangeItem(ITEMS, visible, 'l:jedzenie', 'l:rata')).toEqual([
      'g:dom',
      'l:czynsz',
      'l:prad',
      'g:raty',
      'l:jedzenie',
      'l:rata',
      NO_GROUP_ITEM,
    ]);
  });

  it('bez zmiany: ten sam element, nieznany element, „Bez grupy" jako przeciągany', () => {
    expect(dropArrangeItem(ITEMS, ITEMS, 'l:prad', 'l:prad')).toEqual(ITEMS);
    expect(dropArrangeItem(ITEMS, ITEMS, 'l:x', 'l:prad')).toEqual(ITEMS);
    expect(dropArrangeItem(ITEMS, ITEMS, NO_GROUP_ITEM, 'g:dom')).toEqual(ITEMS);
  });

  it('sekcja bez grup — zwykła zmiana kolejności', () => {
    expect(dropArrangeItem(['l:a', 'l:b', 'l:c'], ['l:a', 'l:b', 'l:c'], 'l:c', 'l:a')).toEqual([
      'l:c',
      'l:a',
      'l:b',
    ]);
  });
});

describe('moveGroupBy', () => {
  it('wyżej i niżej o jedno miejsce; na brzegu bez zmian', () => {
    expect(moveGroupBy(ITEMS, 'raty', -1)).toEqual([
      'g:raty',
      'l:rata',
      'g:dom',
      'l:czynsz',
      'l:prad',
      NO_GROUP_ITEM,
      'l:jedzenie',
    ]);
    expect(moveGroupBy(ITEMS, 'dom', -1)).toEqual(ITEMS);
    expect(moveGroupBy(ITEMS, 'raty', 1)).toEqual(ITEMS);
    expect(moveGroupBy(ITEMS, 'nieznana', 1)).toEqual(ITEMS);
  });
});

describe('layoutRequest', () => {
  it('grupy z wierszami i wiersze bez grupy', () => {
    expect(layoutRequest('expense', ITEMS)).toEqual({
      section: 'expense',
      groups: [
        { id: 'dom', lineIds: ['czynsz', 'prad'] },
        { id: 'raty', lineIds: ['rata'] },
      ],
      ungroupedLineIds: ['jedzenie'],
    });
    expect(layoutRequest('income', ['l:a', 'l:b'])).toEqual({
      section: 'income',
      groups: [],
      ungroupedLineIds: ['a', 'b'],
    });
  });
});
