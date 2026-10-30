import { LiabilityKindSchema } from '@fineapp/shared';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import {
  between,
  boolColumn,
  bpsColumn,
  dateOnlyColumn,
  idColumn,
  inEnum,
  minorColumn,
  timestamps,
} from './_shared.js';
import { accounts } from './accounts.js';
import { categories } from './categories.js';
import { households } from './households.js';
import { recurringRules } from './recurring.js';

/**
 * Zobowiązania — wymaganie #2: kwota, rata, okres spłaty.
 *
 * **Nie rozdzielamy raty na kapitał i odsetki** (ADR-004). „Pozostała kwota" to całość
 * do zapłaty, a każda rata ją pomniejsza. Odpowiada to temu, jak ludzie myślą o swoich
 * zobowiązaniach („zostało 24 raty × 1500 zł"). Konsekwencja: przy kredycie hipotecznym
 * liczba nie zgadza się z saldem kapitału w banku. `interestRateBps` zostaje na
 * przyszłość i jest wyłącznie informacyjne.
 *
 * Stan bieżący = `openingBalanceMinor` − suma płatności zaksięgowanych po `balanceAsOf`.
 */
export const liabilities = sqliteTable(
  'liabilities',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind')
      .notNull()
      .$type<
        | 'mortgage'
        | 'cash_loan'
        | 'car_loan'
        | 'installment'
        | 'credit_card'
        | 'bnpl'
        | 'private'
        | 'other'
      >(),
    creditor: text('creditor'),
    currency: text('currency').notNull().default('PLN'),
    /** Punkt odniesienia: ile zostało do spłaty na dzień `balanceAsOf`. */
    openingBalanceMinor: minorColumn('opening_balance_minor').notNull(),
    balanceAsOf: dateOnlyColumn('balance_as_of').notNull(),
    monthlyPaymentMinor: minorColumn('monthly_payment_minor').notNull(),
    /** Pełna liczba rat, jeśli znana. */
    installmentsTotal: integer('installments_total'),
    /** Okres spłaty pozostały na dzień `balanceAsOf`. */
    installmentsRemainingAtAsOf: integer('installments_remaining_at_as_of'),
    /** Informacyjnie — harmonogramu odsetek nie liczymy (ADR-004). */
    interestRateBps: bpsColumn('interest_rate_bps'),
    paymentDay: integer('payment_day'),
    firstPaymentOn: dateOnlyColumn('first_payment_on'),
    finalPaymentOn: dateOnlyColumn('final_payment_on'),
    paymentAccountId: text('payment_account_id').references((): AnySQLiteColumn => accounts.id, {
      onDelete: 'set null',
    }),
    categoryId: text('category_id').references((): AnySQLiteColumn => categories.id, {
      onDelete: 'set null',
    }),
    recurringRuleId: text('recurring_rule_id').references(
      (): AnySQLiteColumn => recurringRules.id,
      {
        onDelete: 'set null',
      },
    ),
    isActive: boolColumn('is_active').notNull().default(true),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => [
    check('liabilities_kind_check', inEnum(table.kind, LiabilityKindSchema.options)),
    check('liabilities_payment_day_check', between(table.paymentDay, 1, 31)),
    index('idx_liabilities_household').on(table.householdId, table.isActive),
  ],
);

/** Typ wiersza `liabilities` zwracany z bazy. */
export type LiabilityRow = typeof liabilities.$inferSelect;
/** Typ wiersza `liabilities` przyjmowany przy zapisie. */
export type LiabilityInsert = typeof liabilities.$inferInsert;
