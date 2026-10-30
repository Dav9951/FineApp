import { AccountTypeSchema, AllocationClassSchema } from '@fineapp/shared';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import {
  boolColumn,
  dateOnlyColumn,
  idColumn,
  inEnum,
  minorColumn,
  timestamps,
} from './_shared.js';
import { households } from './households.js';

/**
 * Konta — bankowe, gotówkowe, oszczędnościowe, inwestycyjne.
 *
 * **Saldo nie jest przechowywane.** Wyliczamy je z `openingBalanceMinor` i sumy
 * transakcji. Materializacja przy dwóch użytkownikach i kilku tysiącach wierszy nie jest
 * potrzebna, a niesie realne ryzyko rozjechania się z księgą
 * ([03 §3.5](../../../../../plans/03-data-model.md#35-accounts)).
 */
export const accounts = sqliteTable(
  'accounts',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull().$type<'checking' | 'cash' | 'savings' | 'investment' | 'other'>(),
    /**
     * Decyduje, czy przelew na to konto liczy się jako oszczędzanie lub inwestowanie.
     *
     * Domyślnie wynika z `type`, ale bywa nadpisywana — np. rachunek bieżący używany
     * jako poduszka finansowa. To jest pole, z którego bierze się migawka
     * `source_allocation_class` / `target_allocation_class` na transakcji (07 §2.1).
     */
    allocationClass: text('allocation_class')
      .notNull()
      .$type<'spending' | 'savings' | 'investment'>(),
    currency: text('currency').notNull().default('PLN'),
    /** Saldo startowe; saldo bieżące = to plus suma transakcji od `openingBalanceOn`. */
    openingBalanceMinor: minorColumn('opening_balance_minor').notNull().default(0),
    openingBalanceOn: dateOnlyColumn('opening_balance_on').notNull(),
    /** Nazwa banku lub brokera — informacyjnie. */
    institution: text('institution'),
    color: text('color'),
    icon: text('icon'),
    includeInNetWorth: boolColumn('include_in_net_worth').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    isArchived: boolColumn('is_archived').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    check('accounts_type_check', inEnum(table.type, AccountTypeSchema.options)),
    check(
      'accounts_allocation_class_check',
      inEnum(table.allocationClass, AllocationClassSchema.options),
    ),
    index('idx_accounts_household').on(table.householdId, table.isArchived, table.sortOrder),
  ],
);

/** Typ wiersza `accounts` zwracany z bazy. */
export type AccountRow = typeof accounts.$inferSelect;
/** Typ wiersza `accounts` przyjmowany przy zapisie. */
export type AccountInsert = typeof accounts.$inferInsert;
