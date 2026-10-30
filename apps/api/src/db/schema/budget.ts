import { BudgetLineFlowSchema, BudgetLineOriginSchema, BudgetSectionSchema } from '@fineapp/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import {
  boolColumn,
  dateOnlyColumn,
  idColumn,
  inEnum,
  minorColumn,
  monthKeyColumn,
  timestampColumn,
  timestamps,
} from './_shared.js';
import { categories } from './categories.js';
import { goals } from './goals.js';
import { households } from './households.js';
import { incomeSources } from './income-sources.js';
import { liabilities } from './liabilities.js';
import { plannedExpenses } from './planned-expenses.js';
import { recurringRules } from './recurring.js';
import { users } from './users.js';

/**
 * Szkic budżetu jednego miesiąca — wymaganie #14, planer budżetu
 * ([03 §3.19](../../../../../plans/03-data-model.md#319-budget_drafts), ADR-075).
 *
 * Najwyżej jeden na miesiąc gospodarstwa, wspólny dla obu domowników. Sumy i ocena
 * **nie są przechowywane** — odczyt wylicza je z linii (07 §13.4), tak jak salda z księgi.
 */
export const budgetDrafts = sqliteTable(
  'budget_drafts',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    monthKey: monthKeyColumn('month_key').notNull(),
    notes: text('notes'),
    /** Kiedy ostatnio dociągnięto linie ze źródeł (wypełnienie albo „Odśwież"). */
    lastFilledAt: timestampColumn('last_filled_at'),
    createdBy: text('created_by')
      .notNull()
      .references((): AnySQLiteColumn => users.id),
    ...timestamps,
  },
  (table) => [uniqueIndex('uq_budget_draft_month').on(table.householdId, table.monthKey)],
);

/**
 * Grupy linii w sekcji szkicu ([03 §3.21](../../../../../plans/03-data-model.md#321-budget_draft_groups),
 * ADR-081).
 *
 * **Tylko układ** — sumy, ocena i wykonanie liczą się z linii bez względu na grupy.
 * Per szkic, nie per gospodarstwo: przy zakładaniu szkicu układ kopiuje się z planu
 * źródłowego (07 §13.10), więc zmiana w grudniu nie psuje listopada. Unikalność nazwy
 * w sekcji (bez względu na wielkość liter) pilnuje serwis — I-25.
 */
export const budgetDraftGroups = sqliteTable(
  'budget_draft_groups',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    draftId: text('draft_id')
      .notNull()
      .references((): AnySQLiteColumn => budgetDrafts.id, { onDelete: 'cascade' }),
    /** Sekcja ekranu, nie strona bilansu: `pools` łączy oszczędności i inwestycje. */
    section: text('section').notNull().$type<'income' | 'expense' | 'pools'>(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order', { mode: 'number' }).notNull().default(0),
    ...timestamps,
  },
  (table) => [
    check('budget_draft_groups_section_check', inEnum(table.section, BudgetSectionSchema.options)),
    index('idx_budget_groups_draft').on(table.draftId, table.section, table.sortOrder),
  ],
);

/**
 * Linie szkicu budżetu ([03 §3.20](../../../../../plans/03-data-model.md#320-budget_draft_lines)).
 *
 * **Zapisane, nie wyliczane ze źródeł.** Szkic ma sens dlatego, że różni się od źródeł
 * („Netflix wyłączam w listopadzie"); wersja wyliczana i tak potrzebowałaby tabeli
 * nadpisań i wykluczeń.
 *
 * `sourceAmountMinor` to kwota źródła z chwili wypełnienia — bez niej nie da się
 * odróżnić „użytkownik zmienił kwotę w szkicu" (decyzja) od „zmieniła się reguła"
 * (informacja do pokazania), ADR-076.
 *
 * Źródła mają `ON DELETE SET NULL`: usunięcie reguły nie znaczy „i wykreśl z planu",
 * więc linia zostaje osierocona.
 */
export const budgetDraftLines = sqliteTable(
  'budget_draft_lines',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    draftId: text('draft_id')
      .notNull()
      .references((): AnySQLiteColumn => budgetDrafts.id, { onDelete: 'cascade' }),
    flow: text('flow').notNull().$type<'income' | 'expense' | 'savings' | 'investment'>(),
    name: text('name').notNull(),
    /** Grosze. Ujemne wyłącznie dla `savings`/`investment` — wypłata z odłożonego (I-21). */
    amountMinor: minorColumn('amount_minor').notNull(),
    categoryId: text('category_id').references((): AnySQLiteColumn => categories.id, {
      onDelete: 'set null',
    }),
    incomeSourceId: text('income_source_id').references((): AnySQLiteColumn => incomeSources.id, {
      onDelete: 'set null',
    }),
    goalId: text('goal_id').references((): AnySQLiteColumn => goals.id, {
      onDelete: 'set null',
    }),
    liabilityId: text('liability_id').references((): AnySQLiteColumn => liabilities.id, {
      onDelete: 'set null',
    }),
    /** Opcjonalny dzień w miesiącu — podpowiedź terminu przy zamianie w byt. */
    dueOn: dateOnlyColumn('due_on'),
    origin: text('origin')
      .notNull()
      .default('manual')
      .$type<'manual' | 'recurring' | 'planned' | 'set_aside' | 'goal' | 'liability'>(),
    recurringRuleId: text('recurring_rule_id').references(
      (): AnySQLiteColumn => recurringRules.id,
      { onDelete: 'set null' },
    ),
    plannedExpenseId: text('planned_expense_id').references(
      (): AnySQLiteColumn => plannedExpenses.id,
      { onDelete: 'set null' },
    ),
    sourceAmountMinor: minorColumn('source_amount_minor'),
    /** Pamiątka, że kwota przyszła ze średniej z N miesięcy (07 §13.3). */
    averageMonths: integer('average_months', { mode: 'number' }).$type<3 | 6 | 12>(),
    /** Linia powiązana „usunięta" ze szkicu — zostaje, żeby odświeżenie jej nie wskrzesiło. */
    isExcluded: boolColumn('is_excluded').notNull().default(false),
    /** Grupa w sekcji (I-25); `null` — „Bez grupy", na końcu sekcji. */
    groupId: text('group_id').references((): AnySQLiteColumn => budgetDraftGroups.id, {
      onDelete: 'set null',
    }),
    sortOrder: integer('sort_order', { mode: 'number' }).notNull().default(0),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => [
    check('budget_draft_lines_flow_check', inEnum(table.flow, BudgetLineFlowSchema.options)),
    check('budget_draft_lines_origin_check', inEnum(table.origin, BudgetLineOriginSchema.options)),
    check('budget_draft_lines_average_months_check', sql`${table.averageMonths} IN (3, 6, 12)`),
    index('idx_budget_lines_draft').on(table.draftId, table.flow, table.sortOrder),
    // Jedno źródło = jedna linia w szkicu; odświeżanie idzie przez ON CONFLICT DO NOTHING.
    uniqueIndex('uq_budget_line_rule')
      .on(table.draftId, table.recurringRuleId)
      .where(sql`${table.recurringRuleId} IS NOT NULL`),
    uniqueIndex('uq_budget_line_planned')
      .on(table.draftId, table.plannedExpenseId, table.origin)
      .where(sql`${table.plannedExpenseId} IS NOT NULL`),
    uniqueIndex('uq_budget_line_goal')
      .on(table.draftId, table.goalId)
      .where(sql`${table.origin} = 'goal'`),
    uniqueIndex('uq_budget_line_liability')
      .on(table.draftId, table.liabilityId)
      .where(sql`${table.origin} = 'liability'`),
  ],
);

/** Typ wiersza `budget_drafts` zwracany z bazy. */
export type BudgetDraftRow = typeof budgetDrafts.$inferSelect;
/** Typ wiersza `budget_drafts` przyjmowany przy zapisie. */
export type BudgetDraftInsert = typeof budgetDrafts.$inferInsert;
/** Typ wiersza `budget_draft_groups` zwracany z bazy. */
export type BudgetDraftGroupRow = typeof budgetDraftGroups.$inferSelect;
/** Typ wiersza `budget_draft_groups` przyjmowany przy zapisie. */
export type BudgetDraftGroupInsert = typeof budgetDraftGroups.$inferInsert;
/** Typ wiersza `budget_draft_lines` zwracany z bazy. */
export type BudgetDraftLineRow = typeof budgetDraftLines.$inferSelect;
/** Typ wiersza `budget_draft_lines` przyjmowany przy zapisie. */
export type BudgetDraftLineInsert = typeof budgetDraftLines.$inferInsert;
