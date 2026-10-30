import { PlannedExpensePrioritySchema, PlannedExpenseStatusSchema } from '@fineapp/shared';
import { check, index, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

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
import { accounts } from './accounts.js';
import { categories } from './categories.js';
import { goals } from './goals.js';
import { households } from './households.js';
import { liabilities } from './liabilities.js';
import { transactions } from './transactions.js';

/**
 * Planowane wydatki — wymaganie #13: OC samochodu, przegląd, wakacje, podatek roczny.
 *
 * **Osobny byt, nie reguła cykliczna z częstotliwością roczną** (ADR-009). Różnią się
 * trzema rzeczami, z których najważniejsza jest ostatnia: planowany wydatek wymaga
 * **odkładania i ostrzeżenia o płynności**, czego reguła cykliczna nie robi i robić
 * nie powinna.
 *
 * **Rata odkładania nie jest przechowywana.** `ceil(pozostało / miesięcy do terminu)`
 * zmienia się co miesiąc — po pominięciu jednej wpłaty rośnie. Przechowywanie dawałoby
 * wartość nieaktualną tuż po zapisie ([07 §6.5](../../../../../plans/07-domain-rules.md)).
 */
export const plannedExpenses = sqliteTable(
  'planned_expenses',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Z natury szacunkowa — ile wyniesie OC za rok, nie wie nikt. */
    estimatedAmountMinor: minorColumn('estimated_amount_minor').notNull(),
    amountIsEstimate: boolColumn('amount_is_estimate').notNull().default(true),
    currency: text('currency').notNull().default('PLN'),
    /** Miesiąc jest wymagany (służy do planowania), dokładny dzień bywa nieznany. */
    dueMonth: monthKeyColumn('due_month').notNull(),
    dueOn: dateOnlyColumn('due_on'),
    categoryId: text('category_id').references((): AnySQLiteColumn => categories.id, {
      onDelete: 'set null',
    }),
    accountId: text('account_id').references((): AnySQLiteColumn => accounts.id, {
      onDelete: 'set null',
    }),
    liabilityId: text('liability_id').references((): AnySQLiteColumn => liabilities.id, {
      onDelete: 'set null',
    }),
    /** `must` = konieczny (OC), `should` = planowany, `nice` = opcjonalny. */
    priority: text('priority').notNull().default('should').$type<'must' | 'should' | 'nice'>(),
    status: text('status')
      .notNull()
      .default('planned')
      .$type<'planned' | 'funding' | 'ready' | 'posted' | 'deferred' | 'cancelled'>(),
    setAsideEnabled: boolColumn('set_aside_enabled').notNull().default(false),
    setAsideAccountId: text('set_aside_account_id').references((): AnySQLiteColumn => accounts.id, {
      onDelete: 'set null',
    }),
    setAsideGoalId: text('set_aside_goal_id').references((): AnySQLiteColumn => goals.id, {
      onDelete: 'set null',
    }),
    /** Domyślnie miesiąc utworzenia. */
    setAsideStartMonth: monthKeyColumn('set_aside_start_month'),
    /** Kwota zebrana poza aplikacją. */
    alreadySetAsideMinor: minorColumn('already_set_aside_minor').notNull().default(0),
    /** Gdy wydatek powtarza się co rok, po zaksięgowaniu powstaje kolejny na przyszły rok. */
    repeatsYearly: boolColumn('repeats_yearly').notNull().default(false),
    previousInstanceId: text('previous_instance_id').references(
      (): AnySQLiteColumn => plannedExpenses.id,
      { onDelete: 'set null' },
    ),
    transactionId: text('transaction_id').references((): AnySQLiteColumn => transactions.id, {
      onDelete: 'set null',
    }),
    postedAmountMinor: minorColumn('posted_amount_minor'),
    postedAt: timestampColumn('posted_at'),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => [
    check(
      'planned_expenses_priority_check',
      inEnum(table.priority, PlannedExpensePrioritySchema.options),
    ),
    check(
      'planned_expenses_status_check',
      inEnum(table.status, PlannedExpenseStatusSchema.options),
    ),
    index('idx_planned_due').on(table.householdId, table.status, table.dueMonth),
    index('idx_planned_active')
      .on(table.householdId, table.dueMonth)
      .where(sql`${table.status} IN ('planned', 'funding', 'ready')`),
  ],
);

/** Typ wiersza `planned_expenses` zwracany z bazy. */
export type PlannedExpenseRow = typeof plannedExpenses.$inferSelect;
/** Typ wiersza `planned_expenses` przyjmowany przy zapisie. */
export type PlannedExpenseInsert = typeof plannedExpenses.$inferInsert;
