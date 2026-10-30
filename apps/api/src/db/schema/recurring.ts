import {
  AllocationOverrideSchema,
  FrequencySchema,
  OccurrenceStatusSchema,
  TransactionTypeSchema,
} from '@fineapp/shared';
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
  between,
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
import { incomeSources } from './income-sources.js';
import { liabilities } from './liabilities.js';
import { transactions } from './transactions.js';

/**
 * Reguły cykliczne — jeden mechanizm dla wydatków stałych (#3) oraz cyklicznych wpłat
 * i wydatków (#9).
 *
 * `amountIsEstimate` istnieje, bo rachunki bywają zmienne: kwota z reguły jest planem,
 * a przy księgowaniu podaje się realną.
 */
export const recurringRules = sqliteTable(
  'recurring_rules',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    flow: text('flow').notNull().$type<'expense' | 'income' | 'transfer'>(),
    amountMinor: minorColumn('amount_minor').notNull(),
    amountIsEstimate: boolColumn('amount_is_estimate').notNull().default(false),
    currency: text('currency').notNull().default('PLN'),
    accountId: text('account_id').references((): AnySQLiteColumn => accounts.id, {
      onDelete: 'set null',
    }),
    counterAccountId: text('counter_account_id').references((): AnySQLiteColumn => accounts.id, {
      onDelete: 'set null',
    }),
    categoryId: text('category_id').references((): AnySQLiteColumn => categories.id, {
      onDelete: 'set null',
    }),
    incomeSourceId: text('income_source_id').references((): AnySQLiteColumn => incomeSources.id, {
      onDelete: 'set null',
    }),
    goalId: text('goal_id').references((): AnySQLiteColumn => goals.id, { onDelete: 'set null' }),
    liabilityId: text('liability_id').references((): AnySQLiteColumn => liabilities.id, {
      onDelete: 'set null',
    }),
    /**
     * Wyłącznie ewentualne nadpisanie alokacji, dziedziczone przez tworzone transakcje.
     * Sama alokacja wynika z klas kont i jest wyliczana przy księgowaniu wystąpienia.
     */
    allocationOverride: text('allocation_override').$type<'none' | 'savings' | 'investment'>(),
    frequency: text('frequency')
      .notNull()
      .$type<'monthly' | 'weekly' | 'biweekly' | 'quarterly' | 'yearly' | 'every_n_months'>(),
    intervalCount: integer('interval_count').notNull().default(1),
    dayOfMonth: integer('day_of_month'),
    /** 0 = niedziela. */
    weekday: integer('weekday'),
    monthOfYear: integer('month_of_year'),
    /** Punkt odniesienia dla `biweekly` i `every_n_months`. */
    anchorDate: dateOnlyColumn('anchor_date').notNull(),
    startMonth: monthKeyColumn('start_month').notNull(),
    /** `NULL` = bezterminowo. */
    endMonth: monthKeyColumn('end_month'),
    /** 0: wystąpienie czeka na potwierdzenie. 1: transakcja powstaje w dniu terminu. */
    autoPost: boolColumn('auto_post').notNull().default(false),
    /** Oznaczenie „to jest wydatek stały" — steruje grupowaniem w UI (wymaganie #3). */
    isFixedExpense: boolColumn('is_fixed_expense').notNull().default(false),
    notes: text('notes'),
    isActive: boolColumn('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    check('recurring_rules_flow_check', inEnum(table.flow, TransactionTypeSchema.options)),
    check(
      'recurring_rules_allocation_override_check',
      inEnum(table.allocationOverride, AllocationOverrideSchema.options),
    ),
    check('recurring_rules_frequency_check', inEnum(table.frequency, FrequencySchema.options)),
    check('recurring_rules_day_of_month_check', between(table.dayOfMonth, 1, 31)),
    check('recurring_rules_weekday_check', between(table.weekday, 0, 6)),
    check('recurring_rules_month_of_year_check', between(table.monthOfYear, 1, 12)),
    index('idx_recurring_rules_household').on(table.householdId, table.isActive, table.flow),
  ],
);

/**
 * Wystąpienia reguł cyklicznych — po jednym na termin.
 *
 * `plannedAmountMinor` jest **migawką** kwoty z reguły w chwili wygenerowania:
 * podniesienie czynszu w listopadzie nie zmienia wstecz planu z sierpnia. Bez tego
 * historia „plan kontra wykonanie" traci sens.
 *
 * Unikalny `(rule_id, due_on)` jest kluczem idempotencji — ponowne generowanie miesiąca
 * nie tworzy duplikatów (12 §6).
 */
export const recurringOccurrences = sqliteTable(
  'recurring_occurrences',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id')
      .notNull()
      .references((): AnySQLiteColumn => recurringRules.id, { onDelete: 'cascade' }),
    dueOn: dateOnlyColumn('due_on').notNull(),
    monthKey: monthKeyColumn('month_key').notNull(),
    plannedAmountMinor: minorColumn('planned_amount_minor').notNull(),
    status: text('status').notNull().default('planned').$type<'planned' | 'posted' | 'skipped'>(),
    transactionId: text('transaction_id').references((): AnySQLiteColumn => transactions.id, {
      onDelete: 'set null',
    }),
    postedAmountMinor: minorColumn('posted_amount_minor'),
    postedAt: timestampColumn('posted_at'),
    skippedReason: text('skipped_reason'),
    ...timestamps,
  },
  (table) => [
    check(
      'recurring_occurrences_status_check',
      inEnum(table.status, OccurrenceStatusSchema.options),
    ),
    uniqueIndex('uq_occurrence_rule_due').on(table.ruleId, table.dueOn),
    index('idx_occurrence_month').on(table.householdId, table.monthKey, table.status),
  ],
);

/** Typ wiersza `recurring_rules` zwracany z bazy. */
export type RecurringRuleRow = typeof recurringRules.$inferSelect;
/** Typ wiersza `recurring_rules` przyjmowany przy zapisie. */
export type RecurringRuleInsert = typeof recurringRules.$inferInsert;
/** Typ wiersza `recurring_occurrences` zwracany z bazy. */
export type RecurringOccurrenceRow = typeof recurringOccurrences.$inferSelect;
/** Typ wiersza `recurring_occurrences` przyjmowany przy zapisie. */
export type RecurringOccurrenceInsert = typeof recurringOccurrences.$inferInsert;
