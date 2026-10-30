import { sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { bpsColumn, idColumn, monthKeyColumn, timestamps } from './_shared.js';
import { households } from './households.js';

/**
 * Rozkład docelowy procentów — wymaganie #8.
 *
 * Wersjonowany od miesiąca: zmiana założeń w listopadzie **nie fałszuje** tego, co było
 * planem w sierpniu. Rozkład obowiązujący dla miesiąca M to wiersz o największym
 * `effectiveFromMonth <= M`.
 *
 * Suma procentów **nie musi** wynosić 100% — to cele odkładania, nie pełny podział
 * budżetu. Serwis ostrzega, ale nie blokuje, gdy suma przekracza 10 000 bps.
 */
export const allocationTargets = sqliteTable(
  'allocation_targets',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    effectiveFromMonth: monthKeyColumn('effective_from_month').notNull(),
    savingsPercentBps: bpsColumn('savings_percent_bps').notNull().default(0),
    investmentPercentBps: bpsColumn('investment_percent_bps').notNull().default(0),
    debtPercentBps: bpsColumn('debt_percent_bps').notNull().default(0),
    note: text('note'),
    ...timestamps,
  },
  (table) => [uniqueIndex('uq_allocation_month').on(table.householdId, table.effectiveFromMonth)],
);

/** Typ wiersza `allocation_targets` zwracany z bazy. */
export type AllocationTargetRow = typeof allocationTargets.$inferSelect;
/** Typ wiersza `allocation_targets` przyjmowany przy zapisie. */
export type AllocationTargetInsert = typeof allocationTargets.$inferInsert;
