import { IncomeSourceKindSchema } from '@fineapp/shared';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { boolColumn, idColumn, inEnum, timestamps } from './_shared.js';
import { households } from './households.js';
import { users } from './users.js';

/**
 * Źródła przychodu — wymaganie #10.
 *
 * Kluczowe jest `countsTowardAllocation`: zwrot podatku nie powinien zawyżać podstawy
 * i psuć zdania „odłożyłem tylko 12% wpływów" (07 §2.3).
 */
export const incomeSources = sqliteTable(
  'income_sources',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind')
      .notNull()
      .$type<
        | 'salary'
        | 'business'
        | 'freelance'
        | 'benefit'
        | 'rental'
        | 'investment'
        | 'refund'
        | 'gift'
        | 'sale'
        | 'other'
      >(),
    ownerUserId: text('owner_user_id').references((): AnySQLiteColumn => users.id, {
      onDelete: 'set null',
    }),
    /** Czy ten przychód wchodzi do podstawy wyliczania celów procentowych. */
    countsTowardAllocation: boolColumn('counts_toward_allocation').notNull().default(true),
    isArchived: boolColumn('is_archived').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    check('income_sources_kind_check', inEnum(table.kind, IncomeSourceKindSchema.options)),
    index('idx_income_sources_household').on(table.householdId, table.isArchived),
  ],
);

/** Typ wiersza `income_sources` zwracany z bazy. */
export type IncomeSourceRow = typeof incomeSources.$inferSelect;
/** Typ wiersza `income_sources` przyjmowany przy zapisie. */
export type IncomeSourceInsert = typeof incomeSources.$inferInsert;
