import { check, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { between, idColumn, timestamps } from './_shared.js';
import { accounts } from './accounts.js';

/**
 * Gospodarstwo domowe — korzeń zakresu danych.
 *
 * W v1 istnieje dokładnie **jeden** wiersz, tworzony przez seed. Tabela istnieje mimo to,
 * bo `household_id` w każdej tabeli domenowej wymusza zakres danych strukturalnie:
 * nie da się przypadkiem pokazać cudzych danych, a ewentualne drugie gospodarstwo nie
 * wymaga przepisywania każdego zapytania
 * ([03 §1](../../../../../plans/03-data-model.md#1-konwencje)).
 */
export const households = sqliteTable(
  'households',
  {
    id: idColumn(),
    name: text('name').notNull(),
    baseCurrency: text('base_currency').notNull().default('PLN'),
    timezone: text('timezone').notNull().default('Europe/Warsaw'),
    locale: text('locale').notNull().default('pl-PL'),
    /** Ile miesięcy wstecz wolno księgować transakcje (wymaganie #12). 1 = poprzedni miesiąc. */
    backPostingLimitMonths: integer('back_posting_limit_months').notNull().default(1),
    /** Dzień rozpoczęcia miesiąca budżetowego. 1 = kalendarzowy (ADR-006). */
    monthStartDay: integer('month_start_day').notNull().default(1),
    /**
     * Konto proponowane przy wydatkach i skanie (ADR-070). Usunięcie konta czyści pole —
     * podpowiedź nie może blokować usunięcia.
     */
    defaultExpenseAccountId: text('default_expense_account_id').references(
      (): AnySQLiteColumn => accounts.id,
      { onDelete: 'set null' },
    ),
    ...timestamps,
  },
  (table) => [check('households_month_start_day_check', between(table.monthStartDay, 1, 28))],
);

/** Typ wiersza `households` zwracany z bazy. */
export type HouseholdRow = typeof households.$inferSelect;

/** Typ wiersza `households` przyjmowany przy zapisie. */
export type HouseholdInsert = typeof households.$inferInsert;
