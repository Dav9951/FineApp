import {
  AllocationClassSchema,
  AllocationOverrideSchema,
  TransactionSourceSchema,
  TransactionStatusSchema,
  TransactionTypeSchema,
} from '@fineapp/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import {
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
import { documents } from './documents.js';
import { goals } from './goals.js';
import { households } from './households.js';
import { incomeSources } from './income-sources.js';
import { liabilities } from './liabilities.js';
import { plannedExpenses } from './planned-expenses.js';
import { recurringOccurrences } from './recurring.js';
import { users } from './users.js';

/**
 * Transakcje — **centralna księga** aplikacji.
 *
 * Wszystkie liczby na ekranie miesiąca (wpływy, wydatki, oszczędności, inwestycje,
 * postęp celów, stany kont) są wyliczane z tej tabeli. Żadna z nich nie jest
 * przechowywana redundantnie.
 *
 * **Kwota jest zawsze dodatnia**; kierunek wynika z `type`, nie ze znaku. Dzięki temu
 * nie da się zapisać „wydatku na minus", który w sumie zachowałby się jak przychód.
 *
 * **Przelew to jeden wiersz**, nie dwa zapisy księgowe (ADR-003). Pełna podwójna
 * księgowość jest poprawniejsza rachunkowo, ale wymusza obsługę par wierszy w każdym
 * zapytaniu i każdej edycji; przy budżecie prowadzonym przez dwie osoby koszt tej
 * poprawności przewyższa zysk.
 *
 * **Usunięcie jest miękkie** (`deletedAt`). Każde zapytanie o transakcje musi mieć
 * `deleted_at IS NULL` — bez tego skasowane wiersze wracają do sum.
 */
export const transactions = sqliteTable(
  'transactions',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    type: text('type').notNull().$type<'expense' | 'income' | 'transfer'>(),
    status: text('status').notNull().default('posted').$type<'posted' | 'pending' | 'void'>(),
    /** Data zdarzenia — bez strefy czasowej. */
    bookedOn: dateOnlyColumn('booked_on').notNull(),
    /** Wyliczany przy zapisie z `bookedOn` i `monthStartDay` (niezmiennik I-1). */
    monthKey: monthKeyColumn('month_key').notNull(),
    amountMinor: minorColumn('amount_minor').notNull(),
    currency: text('currency').notNull().default('PLN'),
    /** `expense`: konto źródłowe · `income`: docelowe · `transfer`: źródłowe. */
    accountId: text('account_id').references((): AnySQLiteColumn => accounts.id, {
      onDelete: 'restrict',
    }),
    /** Wyłącznie dla `transfer`: konto docelowe (niezmienniki I-2, I-3). */
    counterAccountId: text('counter_account_id').references((): AnySQLiteColumn => accounts.id, {
      onDelete: 'restrict',
    }),
    categoryId: text('category_id').references((): AnySQLiteColumn => categories.id, {
      onDelete: 'set null',
    }),
    incomeSourceId: text('income_source_id').references((): AnySQLiteColumn => incomeSources.id, {
      onDelete: 'set null',
    }),
    liabilityId: text('liability_id').references((): AnySQLiteColumn => liabilities.id, {
      onDelete: 'set null',
    }),
    goalId: text('goal_id').references((): AnySQLiteColumn => goals.id, { onDelete: 'set null' }),
    /**
     * Migawka klasy konta źródłowego w chwili zapisu.
     *
     * **Migawka, bo zmiana klasy konta nie może przepisywać wyników zamkniętych
     * miesięcy** (niezmiennik I-6). Gdyby efekt alokacji liczyć z bieżącej klasy konta,
     * przełączenie rachunku na „oszczędnościowy" zmieniłoby historię wstecz.
     */
    sourceAllocationClass: text('source_allocation_class').$type<
      'spending' | 'savings' | 'investment'
    >(),
    /** Migawka klasy konta docelowego — jak wyżej. */
    targetAllocationClass: text('target_allocation_class').$type<
      'spending' | 'savings' | 'investment'
    >(),
    /**
     * Nadpisanie przez użytkownika. `NULL` = wylicz z migawek klas.
     *
     * `'none'` = nie licz wcale; `'savings'` / `'investment'` = wymuś zaliczenie do puli.
     */
    allocationOverride: text('allocation_override').$type<'none' | 'savings' | 'investment'>(),
    description: text('description'),
    merchant: text('merchant'),
    notes: text('notes'),
    source: text('source')
      .notNull()
      .default('manual')
      .$type<'manual' | 'ocr' | 'recurring' | 'planned' | 'import'>(),
    sourceDocumentId: text('source_document_id').references((): AnySQLiteColumn => documents.id, {
      onDelete: 'set null',
    }),
    recurringOccurrenceId: text('recurring_occurrence_id').references(
      (): AnySQLiteColumn => recurringOccurrences.id,
      { onDelete: 'set null' },
    ),
    plannedExpenseId: text('planned_expense_id').references(
      (): AnySQLiteColumn => plannedExpenses.id,
      {
        onDelete: 'set null',
      },
    ),
    /** Odcisk operacji bankowej — klucz deduplikacji przy imporcie z wyciągu. */
    externalRef: text('external_ref'),
    createdBy: text('created_by')
      .notNull()
      .references((): AnySQLiteColumn => users.id),
    ...timestamps,
    /** Miękkie usunięcie; przywracalne przez 30 dni. */
    deletedAt: timestampColumn('deleted_at'),
  },
  (table) => [
    check('transactions_type_check', inEnum(table.type, TransactionTypeSchema.options)),
    check('transactions_status_check', inEnum(table.status, TransactionStatusSchema.options)),
    check('transactions_amount_positive_check', sql`${table.amountMinor} > 0`),
    check(
      'transactions_source_allocation_class_check',
      inEnum(table.sourceAllocationClass, AllocationClassSchema.options),
    ),
    check(
      'transactions_target_allocation_class_check',
      inEnum(table.targetAllocationClass, AllocationClassSchema.options),
    ),
    check(
      'transactions_allocation_override_check',
      inEnum(table.allocationOverride, AllocationOverrideSchema.options),
    ),
    check('transactions_source_check', inEnum(table.source, TransactionSourceSchema.options)),
    index('idx_tx_month').on(table.householdId, table.monthKey, table.bookedOn),
    index('idx_tx_account').on(table.accountId, table.bookedOn),
    index('idx_tx_counter').on(table.counterAccountId, table.bookedOn),
    index('idx_tx_category').on(table.categoryId, table.monthKey),
    // Alokacje: indeks częściowy tylko po przelewach, bo tylko one tworzą efekty w pulach.
    index('idx_tx_allocation')
      .on(
        table.householdId,
        table.monthKey,
        table.targetAllocationClass,
        table.sourceAllocationClass,
      )
      .where(sql`${table.type} = 'transfer' AND ${table.deletedAt} IS NULL`),
    index('idx_tx_goal').on(table.goalId, table.monthKey),
    index('idx_tx_liability').on(table.liabilityId, table.bookedOn),
    // Deduplikacja importu; indeks częściowy, bo `external_ref` jest zwykle NULL.
    uniqueIndex('uq_tx_external')
      .on(table.householdId, table.externalRef)
      .where(sql`${table.externalRef} IS NOT NULL`),
  ],
);

/** Typ wiersza `transactions` zwracany z bazy. */
export type TransactionRow = typeof transactions.$inferSelect;
/** Typ wiersza `transactions` przyjmowany przy zapisie. */
export type TransactionInsert = typeof transactions.$inferInsert;
