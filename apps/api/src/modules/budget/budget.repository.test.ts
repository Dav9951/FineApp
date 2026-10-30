import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { testConfig, testDb } from '../../../test/build-app.js';
import {
  householdFixture,
  insertBudgetDraft,
  insertBudgetLine,
  insertCategory,
} from '../../../test/factories.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import { budgetDraftLines, budgetDrafts } from '../../db/schema/budget.js';
import { recurringRules } from '../../db/schema/recurring.js';
import { reassignBudgetLinesCategory } from './budget.repository.js';

/**
 * Testy tabel planera budżetu na prawdziwym SQLite — `F9-1`
 * ([03 §3.19–3.20](../../../../../plans/03-data-model.md#319-budget_drafts)).
 *
 * Moduł `budget` nie ma jeszcze tras (`F9-4`), więc to, co wymusza baza — unikalny
 * szkic na miesiąc, jedna linia na źródło, losy linii po usunięciu źródła — sprawdzamy
 * tutaj, wstawiając wiersze wprost.
 */

const NOW = new Date('2026-10-27T10:00:00.000Z');

let handle: DbHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

/**
 * Wstawia minimalną regułę cykliczną wydatku.
 *
 * @param db - Uchwyt bazy.
 * @param householdId - Gospodarstwo.
 * @returns Identyfikator reguły.
 */
function insertRule(db: DbHandle, householdId: string): string {
  const id = newId();
  db.db
    .insert(recurringRules)
    .values({
      id,
      householdId,
      name: 'Czynsz',
      flow: 'expense',
      amountMinor: 1_850_00,
      frequency: 'monthly',
      dayOfMonth: 10,
      anchorDate: '2026-09-10',
      startMonth: '2026-09',
      createdAt: NOW.getTime(),
      updatedAt: NOW.getTime(),
    })
    .run();
  return id;
}

describe('tabele szkicu budżetu', () => {
  it('drugi szkic na ten sam miesiąc gospodarstwa łamie unikalność (03 §3.19)', async () => {
    handle = testDb();
    const home = await householdFixture(handle, testConfig(), NOW);
    insertBudgetDraft(handle, home, '2026-11');
    expect(() => insertBudgetDraft(handle as DbHandle, home, '2026-11')).toThrow(/UNIQUE/);
    // Inny miesiąc i inne gospodarstwo — bez konfliktu.
    insertBudgetDraft(handle, home, '2026-12');
    const other = await householdFixture(handle, testConfig(), NOW);
    insertBudgetDraft(handle, other, '2026-11');
    expect(handle.db.select().from(budgetDrafts).all()).toHaveLength(3);
  });

  it('jedna reguła daje najwyżej jedną linię w szkicu, także wykluczoną (07 §13.2)', async () => {
    handle = testDb();
    const home = await householdFixture(handle, testConfig(), NOW);
    const ruleId = insertRule(handle, home.householdId);
    const november = insertBudgetDraft(handle, home, '2026-11');
    insertBudgetLine(handle, home, november, {
      origin: 'recurring',
      recurringRuleId: ruleId,
      isExcluded: true,
    });

    expect(() =>
      insertBudgetLine(handle as DbHandle, home, november, {
        origin: 'recurring',
        recurringRuleId: ruleId,
      }),
    ).toThrow(/UNIQUE/);

    // Ta sama reguła w szkicu innego miesiąca jest w porządku.
    const december = insertBudgetDraft(handle, home, '2026-12');
    insertBudgetLine(handle, home, december, { origin: 'recurring', recurringRuleId: ruleId });
  });

  it('linie własne bez źródła nie podlegają unikalności', async () => {
    handle = testDb();
    const home = await householdFixture(handle, testConfig(), NOW);
    const draftId = insertBudgetDraft(handle, home, '2026-11');
    insertBudgetLine(handle, home, draftId, { name: 'Prezent' });
    insertBudgetLine(handle, home, draftId, { name: 'Prezent' });
    expect(handle.db.select().from(budgetDraftLines).all()).toHaveLength(2);
  });

  it('usunięcie reguły zostawia linię osieroconą, a usunięcie szkicu kasuje linie (03 §3.20)', async () => {
    handle = testDb();
    const home = await householdFixture(handle, testConfig(), NOW);
    const ruleId = insertRule(handle, home.householdId);
    const draftId = insertBudgetDraft(handle, home, '2026-11');
    const lineId = insertBudgetLine(handle, home, draftId, {
      origin: 'recurring',
      recurringRuleId: ruleId,
      amountMinor: 1_850_00,
    });

    handle.db.delete(recurringRules).where(eq(recurringRules.id, ruleId)).run();
    const orphan = handle.db
      .select()
      .from(budgetDraftLines)
      .where(eq(budgetDraftLines.id, lineId))
      .get();
    expect(orphan).toMatchObject({
      origin: 'recurring',
      recurringRuleId: null,
      amountMinor: 1_850_00,
    });

    handle.db.delete(budgetDrafts).where(eq(budgetDrafts.id, draftId)).run();
    expect(handle.db.select().from(budgetDraftLines).all()).toEqual([]);
  });

  it('CHECK odrzuca nieznaną stronę bilansu, pochodzenie i okno średniej', async () => {
    handle = testDb();
    const home = await householdFixture(handle, testConfig(), NOW);
    const draftId = insertBudgetDraft(handle, home, '2026-11');
    const db = handle;
    expect(() => insertBudgetLine(db, home, draftId, { flow: 'transfer' as 'expense' })).toThrow(
      /CHECK/,
    );
    expect(() => insertBudgetLine(db, home, draftId, { origin: 'import' as 'manual' })).toThrow(
      /CHECK/,
    );
    expect(() => insertBudgetLine(db, home, draftId, { averageMonths: 4 as 3 })).toThrow(/CHECK/);
    insertBudgetLine(db, home, draftId, { averageMonths: 6 });
  });
});

describe('reassignBudgetLinesCategory', () => {
  it('przepina tylko linie z tej kategorii i tego gospodarstwa', async () => {
    handle = testDb();
    const home = await householdFixture(handle, testConfig(), NOW);
    const other = await householdFixture(handle, testConfig(), NOW);
    const from = insertCategory(handle, home, { name: 'Kawa' });
    const to = insertCategory(handle, home, { name: 'Restauracje' });
    const foreignCategory = insertCategory(handle, other, { name: 'Kawa' });

    const draftId = insertBudgetDraft(handle, home, '2026-11');
    const moved = insertBudgetLine(handle, home, draftId, { categoryId: from });
    const untouched = insertBudgetLine(handle, home, draftId, { categoryId: to });
    const foreignDraft = insertBudgetDraft(handle, other, '2026-11');
    const foreign = insertBudgetLine(handle, other, foreignDraft, { categoryId: foreignCategory });

    const later = NOW.getTime() + 1_000;
    expect(reassignBudgetLinesCategory(handle, home.householdId, from, to, later)).toBe(1);

    const rowOf = (id: string) =>
      (handle as DbHandle).db
        .select()
        .from(budgetDraftLines)
        .where(eq(budgetDraftLines.id, id))
        .get();
    expect(rowOf(moved)).toMatchObject({ categoryId: to, updatedAt: later });
    expect(rowOf(untouched)?.categoryId).toBe(to);
    expect(rowOf(foreign)?.categoryId).toBe(foreignCategory);
  });
});
