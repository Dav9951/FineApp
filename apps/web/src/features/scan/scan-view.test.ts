import { describe, expect, it } from 'vitest';

import {
  CHEMIA_ID,
  documentFixture,
  GROCERIES_ID,
  itemFixture,
  LIDL_ITEMS,
  listItemFixture,
  ROR_ID,
} from '../../../test/document-fixture.js';
import { jpegName } from './resize-image.js';
import {
  buildCommit,
  categoryGroups,
  confidenceLabel,
  defaultMode,
  defaultSelection,
  documentTitle,
  documentTotalCheck,
  dominantCategory,
  fitWithin,
  groupingKey,
  isUncertain,
  proposalAccepted,
  proposalNameOfKey,
  recentRow,
  selectionSummary,
} from './scan-view.js';

/**
 * Reguły ekranów skanu (06 §3.4, `F7-8`…`F7-10`).
 */

describe('recentRow / documentTitle', () => {
  it('tytuł z rodzajem i sprzedawcą; podpis ze stanem i liczbą pozycji', () => {
    expect(documentTitle('receipt', 'Lidl')).toBe('Paragon · Lidl');
    expect(documentTitle('bank_statement', null)).toBe('Wyciąg');
    expect(recentRow(listItemFixture())).toEqual({
      title: 'Paragon · Lidl',
      caption: 'do przejrzenia · 8 poz.',
      tone: 'neutral',
    });
    expect(recentRow(listItemFixture({ status: 'processing', merchant: null }))).toMatchObject({
      caption: 'przetwarzanie…',
      tone: 'progress',
    });
    expect(recentRow(listItemFixture({ status: 'failed' })).tone).toBe('danger');
    expect(recentRow(listItemFixture({ status: 'committed' })).tone).toBe('success');
  });
});

describe('pewność', () => {
  it('poniżej 60% to niepewne; brak pewności nie jest niepewny', () => {
    expect(isUncertain({ confidence: 0.59 })).toBe(true);
    expect(isUncertain({ confidence: 0.6 })).toBe(false);
    expect(isUncertain({ confidence: null })).toBe(false);
    expect(confidenceLabel(0.405)).toBe('41%');
    expect(confidenceLabel(null)).toBeNull();
  });
});

describe('zaznaczenie i tryb', () => {
  it('odrzucone (np. duplikat z wyciągu) startują odznaczone', () => {
    const items = [itemFixture({ id: 'a' }), itemFixture({ id: 'b', reviewStatus: 'rejected' })];
    expect([...defaultSelection(items)]).toEqual(['a']);
  });

  it('paragon jednej kategorii — całość, mieszany — kategorie, wyciąg — po pozycji', () => {
    const all = defaultSelection(LIDL_ITEMS);
    expect(defaultMode('receipt')).toBe('single');
    expect(defaultMode('receipt', LIDL_ITEMS, all)).toBe('by_category');
    expect(defaultMode('invoice', LIDL_ITEMS, all)).toBe('by_category');
    const foodOnly = new Set([LIDL_ITEMS[0]?.id ?? '', LIDL_ITEMS[3]?.id ?? '']);
    expect(defaultMode('receipt', LIDL_ITEMS, foodOnly)).toBe('single');
    expect(defaultMode('bank_statement', LIDL_ITEMS, all)).toBe('split');
  });

  it('podział po kategoriach: klucz z kategorii wydatku albo przyjętej propozycji (ADR-069)', () => {
    const all = defaultSelection(LIDL_ITEMS);
    const expense = (id: string): boolean => id === GROCERIES_ID || id === CHEMIA_ID;
    const accepted = [{ name: 'Elektronika', kind: 'expense' as const }];
    const batteries = LIDL_ITEMS[2] ?? itemFixture();
    expect(groupingKey(batteries, expense, [])).toBeNull();
    const key = groupingKey(batteries, expense, accepted);
    expect(key !== null && proposalNameOfKey(key)).toBe('Elektronika');
    expect(proposalNameOfKey(GROCERIES_ID)).toBeNull();
    expect(groupingKey(itemFixture({ suggestedCategoryId: 'INCOME' }), expense, [])).toBeNull();

    const groups = categoryGroups(LIDL_ITEMS, all, (item) => groupingKey(item, expense, accepted));
    expect(groups.map((group) => [group.categoryKey, group.amountMinor])).toEqual([
      [CHEMIA_ID, 2499],
      [key, 1250],
      [GROCERIES_ID, 698 + 420 - 300],
    ]);
    expect(categoryGroups(LIDL_ITEMS, new Set([LIDL_ITEMS[4]?.id ?? '']), () => null)).toEqual([]);
  });

  it('kategoria całości: najczęstsza wśród zaznaczonych obciążeń', () => {
    const all = defaultSelection(LIDL_ITEMS);
    expect(dominantCategory(LIDL_ITEMS, all)).toBe(GROCERIES_ID);
    expect(dominantCategory(LIDL_ITEMS, new Set([LIDL_ITEMS[1]?.id ?? '']))).toBe(CHEMIA_ID);
    expect(dominantCategory(LIDL_ITEMS, new Set())).toBeNull();
  });

  it('podsumowanie: rabat pomniejsza sumę netto', () => {
    const all = defaultSelection(LIDL_ITEMS);
    expect(selectionSummary(LIDL_ITEMS, all)).toEqual({
      selectedCount: 5,
      totalCount: 5,
      netMinor: 698 + 2499 + 1250 + 420 - 300,
    });
  });
});

describe('documentTotalCheck', () => {
  it('zgodna, niezgodna (odznaczenie nie zmienia kontroli), wyciąg bez kontroli', () => {
    expect(documentTotalCheck(documentFixture())).toEqual({ kind: 'match' });
    const off = documentFixture({
      summary: { ...documentFixture().summary!, totalMinor: 5000 },
    });
    expect(documentTotalCheck(off)).toEqual({ kind: 'mismatch', differenceMinor: 4567 - 5000 });
    expect(documentTotalCheck(documentFixture({ kind: 'bank_statement' }))).toEqual({
      kind: 'unknown',
    });
  });
});

describe('buildCommit', () => {
  const draft = {
    mode: 'single' as const,
    accountId: ROR_ID,
    bookedOn: '2026-09-18',
    categoryId: GROCERIES_ID,
    selected: defaultSelection(LIDL_ITEMS),
    acceptedProposals: [],
  };

  it('single: kategoria całości, wszystkie zaznaczone', () => {
    const built = buildCommit(draft, selectionSummary(LIDL_ITEMS, draft.selected));
    expect(built).toMatchObject({
      ok: true,
      body: { mode: 'single', categoryId: GROCERIES_ID, createCategories: [] },
    });
    expect(built.ok && built.body.itemIds).toHaveLength(5);
  });

  it('czego brakuje: konto, pozycje, kategoria, dodatnia suma', () => {
    const summary = selectionSummary(LIDL_ITEMS, draft.selected);
    expect(buildCommit({ ...draft, accountId: null }, summary)).toEqual({
      ok: false,
      message: 'Wybierz konto.',
    });
    expect(buildCommit({ ...draft, categoryId: null }, summary)).toMatchObject({ ok: false });
    const onlyDiscount = new Set([LIDL_ITEMS[4]?.id ?? '']);
    expect(
      buildCommit({ ...draft, selected: onlyDiscount }, selectionSummary(LIDL_ITEMS, onlyDiscount)),
    ).toEqual({ ok: false, message: 'Suma zaznaczonych pozycji musi być dodatnia.' });
    expect(
      buildCommit({ ...draft, selected: new Set() }, selectionSummary(LIDL_ITEMS, new Set())),
    ).toMatchObject({ ok: false });
  });

  it('by_category: bez kategorii całości; suma ≤ 0 zatrzymana przed wysłaniem', () => {
    const built = buildCommit(
      { ...draft, mode: 'by_category', categoryId: null },
      selectionSummary(LIDL_ITEMS, draft.selected),
    );
    expect(built).toMatchObject({ ok: true, body: { mode: 'by_category', categoryId: null } });
    const onlyDiscount = new Set([LIDL_ITEMS[4]?.id ?? '']);
    expect(
      buildCommit(
        { ...draft, mode: 'by_category', selected: onlyDiscount },
        selectionSummary(LIDL_ITEMS, onlyDiscount),
      ),
    ).toEqual({ ok: false, message: 'Suma zaznaczonych pozycji musi być dodatnia.' });
  });

  it('split: bez kategorii całości, z przyjętymi propozycjami', () => {
    const accepted = [{ name: 'Elektronika', kind: 'expense' as const }];
    const built = buildCommit(
      { ...draft, mode: 'split', categoryId: null, acceptedProposals: accepted },
      selectionSummary(LIDL_ITEMS, draft.selected),
    );
    expect(built).toMatchObject({
      ok: true,
      body: { mode: 'split', categoryId: null, createCategories: accepted },
    });
    expect(proposalAccepted(accepted, LIDL_ITEMS[2] ?? itemFixture())).toBe(true);
    expect(proposalAccepted(accepted, itemFixture({ suggestedCategoryName: 'Inne' }))).toBe(false);
    expect(
      proposalAccepted(
        accepted,
        itemFixture({ suggestedCategoryName: 'elektronika', direction: 'inflow' }),
      ),
    ).toBe(false);
  });
});

describe('skalowanie przed wysyłką (F7-9)', () => {
  it('dłuższy bok do 1568 px, proporcje zachowane, bez powiększania', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1568, height: 1176, scaled: true });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1176, height: 1568, scaled: true });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
    expect(fitWithin(1568, 10)).toEqual({ width: 1568, height: 10, scaled: false });
  });

  it('nazwa pliku z rozszerzeniem .jpg', () => {
    expect(jpegName('IMG_1234.HEIC')).toBe('IMG_1234.jpg');
    expect(jpegName('paragon')).toBe('paragon.jpg');
    expect(jpegName('.heic')).toBe('zdjecie.jpg');
  });
});
