import {
  AccountTypeSchema,
  AllocationClassSchema,
  AllocationOverrideSchema,
  BudgetLineFlowSchema,
  BudgetLineOriginSchema,
  BudgetSectionSchema,
  CategoryKindSchema,
  DocumentStatusSchema,
  FrequencySchema,
  GoalStatusSchema,
  LiabilityKindSchema,
  OccurrenceStatusSchema,
  PlannedExpenseStatusSchema,
  TransactionSourceSchema,
  TransactionStatusSchema,
  TransactionTypeSchema,
} from '@fineapp/shared';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';

import * as schema from './index.js';

/**
 * Sprawdza, czy wartość jest tabelą Drizzle.
 *
 * @param value - Dowolny eksport ze schematu.
 * @returns `true`, gdy `getTableConfig` potrafi ją opisać.
 */
function isTable(value: unknown): value is SQLiteTable {
  try {
    getTableConfig(value as SQLiteTable);
    return true;
  } catch {
    return false;
  }
}

/** Wszystkie tabele wyeksportowane ze schematu, po nazwie w bazie. */
const tables = new Map<string, SQLiteTable>(
  (Object.values(schema) as unknown[])
    .filter(isTable)
    .map((table) => [getTableConfig(table).name, table] as const),
);

/**
 * Zwraca nazwy kolumn tabeli.
 *
 * @param name - Nazwa tabeli w bazie.
 * @returns Zbiór nazw kolumn.
 */
function columnsOf(name: string): Set<string> {
  const table = tables.get(name);
  if (!table) throw new Error(`brak tabeli ${name}`);
  return new Set(getTableConfig(table).columns.map((column) => column.name));
}

/**
 * Zwraca treść warunków CHECK tabeli jako jeden napis.
 *
 * @param name - Nazwa tabeli w bazie.
 * @returns Nazwy warunków połączone spacją.
 */
function checkNamesOf(name: string): string[] {
  const table = tables.get(name);
  if (!table) throw new Error(`brak tabeli ${name}`);
  return getTableConfig(table).checks.map((c) => c.name);
}

describe('komplet tabel z 03 §3', () => {
  it('schemat ma dokładnie 21 tabel opisanych w dokumencie', () => {
    expect([...tables.keys()].sort()).toEqual(
      [
        'accounts',
        'allocation_targets',
        'app_meta',
        'auth_attempts',
        'auth_sessions',
        'budget_draft_groups',
        'budget_draft_lines',
        'budget_drafts',
        'categories',
        'document_items',
        'documents',
        'goals',
        'households',
        'idempotency_keys',
        'income_sources',
        'liabilities',
        'planned_expenses',
        'recurring_occurrences',
        'recurring_rules',
        'transactions',
        'users',
      ].sort(),
    );
  });
});

describe('konwencje z 03 §1', () => {
  it.each([...tables.keys()])('%s używa snake_case w nazwach kolumn', (name) => {
    for (const column of columnsOf(name)) {
      expect(column).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('każda tabela domenowa ma household_id', () => {
    // Wyjątki: households (jest korzeniem), tabele techniczne i te zakresowane przez rodzica.
    const withoutHousehold = ['households', 'users', 'app_meta', 'auth_attempts'];
    const scopedByParent = ['auth_sessions', 'document_items'];
    for (const name of tables.keys()) {
      if (withoutHousehold.includes(name) || scopedByParent.includes(name)) continue;
      expect(columnsOf(name), `${name} bez household_id`).toContain('household_id');
    }
  });

  it('każda tabela domenowa ma created_at i updated_at', () => {
    const withoutUpdatedAt = ['auth_sessions', 'auth_attempts', 'idempotency_keys'];
    for (const name of tables.keys()) {
      if (name === 'app_meta') continue;
      expect(columnsOf(name)).toContain('created_at');
      if (!withoutUpdatedAt.includes(name)) {
        expect(columnsOf(name), `${name} bez updated_at`).toContain('updated_at');
      }
    }
  });

  it('kolumny kwotowe mają sufiks _minor, a udziały _bps', () => {
    // Reguła krytyczna z 02 §8: nazwa niesie jednostkę, więc nie da się pomylić
    // 20 (procent) z 2000 (bps) ani 100 (złotówki) z 10000 (grosze).
    //
    // Sprawdzamy wyłącznie kolumny liczbowe: `balance_as_of` i `first_payment_on`
    // brzmią jak pieniądz, ale są datami biznesowymi (TEXT).
    const moneyLike = /(amount|balance|price|cost|payment)/;
    const shareLike = /(percent|rate)/;
    /** Kolumny liczbowe, które mimo nazwy nie niosą kwoty ani udziału. */
    const notAUnit = new Set(['payment_day', 'installments_total']);

    for (const [name, table] of tables) {
      for (const column of getTableConfig(table).columns) {
        if (column.getSQLType() !== 'integer') continue;
        if (column.name.endsWith('_at') || notAUnit.has(column.name)) continue;
        if (moneyLike.test(column.name) && !column.name.includes('is_estimate')) {
          expect(column.name, `${name}.${column.name}`).toMatch(/_minor$/);
        }
        if (shareLike.test(column.name)) {
          expect(column.name, `${name}.${column.name}`).toMatch(/_bps$/);
        }
      }
    }
  });

  it('jedyne kolumny REAL to quantity i confidence w document_items', () => {
    // 07 §8.1: pieniądz nigdy nie jest REAL.
    for (const [name, table] of tables) {
      for (const column of getTableConfig(table).columns) {
        if (column.getSQLType() === 'real') {
          expect([name, column.name]).toEqual(['document_items', expect.any(String)]);
          expect(['quantity', 'confidence']).toContain(column.name);
        }
      }
    }
  });
});

describe('CHECK-i pochodzą z enumów w @fineapp/shared', () => {
  it.each([
    ['accounts', 'accounts_type_check', AccountTypeSchema],
    ['accounts', 'accounts_allocation_class_check', AllocationClassSchema],
    ['categories', 'categories_kind_check', CategoryKindSchema],
    ['liabilities', 'liabilities_kind_check', LiabilityKindSchema],
    ['goals', 'goals_status_check', GoalStatusSchema],
    ['recurring_rules', 'recurring_rules_frequency_check', FrequencySchema],
    ['recurring_occurrences', 'recurring_occurrences_status_check', OccurrenceStatusSchema],
    ['planned_expenses', 'planned_expenses_status_check', PlannedExpenseStatusSchema],
    ['documents', 'documents_status_check', DocumentStatusSchema],
    ['transactions', 'transactions_type_check', TransactionTypeSchema],
    ['transactions', 'transactions_status_check', TransactionStatusSchema],
    ['transactions', 'transactions_source_check', TransactionSourceSchema],
    ['transactions', 'transactions_allocation_override_check', AllocationOverrideSchema],
    ['budget_draft_lines', 'budget_draft_lines_flow_check', BudgetLineFlowSchema],
    ['budget_draft_lines', 'budget_draft_lines_origin_check', BudgetLineOriginSchema],
    ['budget_draft_groups', 'budget_draft_groups_section_check', BudgetSectionSchema],
  ])('%s ma warunek %s', (table, checkName, enumSchema) => {
    expect(checkNamesOf(table)).toContain(checkName);
    expect(enumSchema.options.length).toBeGreaterThan(0);
  });

  it('transakcja pilnuje dodatniej kwoty', () => {
    // Kierunek wynika z `type`, nie ze znaku — „wydatek na minus" nie może powstać.
    expect(checkNamesOf('transactions')).toContain('transactions_amount_positive_check');
  });
});

describe('niezmienniki widoczne w strukturze', () => {
  it('transakcje mają miękkie usunięcie', () => {
    expect(columnsOf('transactions')).toContain('deleted_at');
  });

  it('migawki klas alokacji są osobnymi kolumnami (I-6)', () => {
    // Gdyby efekt liczyć z bieżącej klasy konta, przełączenie rachunku na
    // „oszczędnościowy" zmieniłoby wyniki zamkniętych miesięcy.
    const columns = columnsOf('transactions');
    expect(columns).toContain('source_allocation_class');
    expect(columns).toContain('target_allocation_class');
    expect(columns).toContain('allocation_override');
  });

  it('wystąpienie cykliczne ma klucz idempotencji (rule_id, due_on)', () => {
    const config = getTableConfig(tables.get('recurring_occurrences')!);
    const unique = config.indexes.find((i) => i.config.name === 'uq_occurrence_rule_due');
    expect(unique?.config.unique).toBe(true);
  });

  it('planowany wydatek nie przechowuje raty odkładania', () => {
    // ceil(pozostało / miesięcy) zmienia się co miesiąc — przechowywana byłaby
    // nieaktualna tuż po zapisie (03 §3.13).
    const columns = [...columnsOf('planned_expenses')];
    expect(columns.filter((c) => c.includes('set_aside'))).not.toContain('set_aside_monthly_minor');
  });

  it('szkic budżetu jest jeden na miesiąc gospodarstwa (03 §3.19)', () => {
    const config = getTableConfig(tables.get('budget_drafts')!);
    const unique = config.indexes.find((i) => i.config.name === 'uq_budget_draft_month');
    expect(unique?.config.unique).toBe(true);
  });

  it('jedno źródło daje najwyżej jedną linię szkicu (07 §13.2)', () => {
    // Odświeżanie idzie przez ON CONFLICT DO NOTHING — bez tych indeksów każde
    // „Odśwież" dokładałoby czynsz drugi raz, a wykluczona linia by wracała.
    const config = getTableConfig(tables.get('budget_draft_lines')!);
    for (const name of [
      'uq_budget_line_rule',
      'uq_budget_line_planned',
      'uq_budget_line_goal',
      'uq_budget_line_liability',
    ]) {
      const index = config.indexes.find((i) => i.config.name === name);
      expect(index?.config.unique, name).toBe(true);
    }
  });

  it('usunięcie grupy nie kasuje linii — klucz obcy SET NULL (03 §3.20, ADR-081)', () => {
    const config = getTableConfig(tables.get('budget_draft_lines')!);
    const fk = config.foreignKeys.find((key) => key.reference().columns[0]?.name === 'group_id');
    expect(fk?.onDelete).toBe('set null');
  });

  it('szkic nie przechowuje sum ani oceny (03 §3.19)', () => {
    // Ocena zależy od wszystkich linii i od źródeł — zapisana byłaby nieaktualna.
    for (const column of columnsOf('budget_drafts')) {
      expect(column).not.toMatch(/_minor$|_bps$/);
    }
  });

  it('konta nie przechowują salda', () => {
    const columns = [...columnsOf('accounts')];
    expect(columns).toContain('opening_balance_minor');
    expect(columns).not.toContain('balance_minor');
    expect(columns).not.toContain('current_balance_minor');
  });
});
