import {
  ContributionModeSchema,
  GoalKindSchema,
  GoalStatusSchema,
  ProgressSourceSchema,
} from '@fineapp/shared';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import {
  bpsColumn,
  dateOnlyColumn,
  idColumn,
  inEnum,
  minorColumn,
  timestampColumn,
  timestamps,
} from './_shared.js';
import { accounts } from './accounts.js';
import { households } from './households.js';

/** Dozwolone przeznaczenia celu — lista zamknięta, bez odpowiednika w `05 §2`. */
const GOAL_PURPOSES = [
  'down_payment',
  'emergency_fund',
  'vacation',
  'car',
  'renovation',
  'retirement',
  'education',
  'custom',
] as const;

/**
 * Cele oszczędnościowe i inwestycyjne — wymagania #6 i #7.
 *
 * `contributionAmountMinor` i `contributionPercentBps` to dwie strony przelicznika
 * z [07 §3](../../../../../plans/07-domain-rules.md#3-przelicznik-kwoty-i-procentu).
 * Zapisana jest **zawsze tylko jedna**, zgodna z `contributionMode`; druga liczona jest
 * na żądanie i oznaczana jako pochodna — przeliczenie w obie strony nie jest bijekcją.
 *
 * Niezmiennik I-14 (`mode = 'fixed'` ⇒ kwota niepusta, `'percent_of_income'` ⇒ procent
 * niepusty) walidujemy w Zod i serwisie, nie `CHECK`-iem: komunikat z bazy byłby
 * nieczytelny dla użytkownika.
 */
export const goals = sqliteTable(
  'goals',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull().$type<'savings' | 'investment'>(),
    purpose: text('purpose').$type<(typeof GOAL_PURPOSES)[number]>(),
    /** `NULL` = cel bezterminowy, np. rosnąca poduszka finansowa. */
    targetAmountMinor: minorColumn('target_amount_minor'),
    targetDate: dateOnlyColumn('target_date'),
    /** Kwota zgromadzona **przed** wdrożeniem aplikacji. */
    startingAmountMinor: minorColumn('starting_amount_minor').notNull().default(0),
    linkedAccountId: text('linked_account_id').references((): AnySQLiteColumn => accounts.id, {
      onDelete: 'set null',
    }),
    /** Skąd bierzemy postęp: z wpłat oznaczonych celem czy z salda konta. */
    progressSource: text('progress_source')
      .notNull()
      .default('contributions')
      .$type<'contributions' | 'account_balance'>(),
    contributionMode: text('contribution_mode')
      .notNull()
      .default('fixed')
      .$type<'fixed' | 'percent_of_income' | 'none'>(),
    /** Wymagane, gdy `contributionMode = 'fixed'`. */
    contributionAmountMinor: minorColumn('contribution_amount_minor'),
    /** Wymagane, gdy `contributionMode = 'percent_of_income'`. */
    contributionPercentBps: bpsColumn('contribution_percent_bps'),
    priority: integer('priority').notNull().default(0),
    color: text('color'),
    icon: text('icon'),
    status: text('status')
      .notNull()
      .default('active')
      .$type<'active' | 'paused' | 'achieved' | 'archived'>(),
    achievedAt: timestampColumn('achieved_at'),
    ...timestamps,
  },
  (table) => [
    check('goals_kind_check', inEnum(table.kind, GoalKindSchema.options)),
    check('goals_purpose_check', inEnum(table.purpose, GOAL_PURPOSES)),
    check(
      'goals_progress_source_check',
      inEnum(table.progressSource, ProgressSourceSchema.options),
    ),
    check(
      'goals_contribution_mode_check',
      inEnum(table.contributionMode, ContributionModeSchema.options),
    ),
    check('goals_status_check', inEnum(table.status, GoalStatusSchema.options)),
    index('idx_goals_household').on(table.householdId, table.status, table.priority),
  ],
);

/** Typ wiersza `goals` zwracany z bazy. */
export type GoalRow = typeof goals.$inferSelect;
/** Typ wiersza `goals` przyjmowany przy zapisie. */
export type GoalInsert = typeof goals.$inferInsert;
