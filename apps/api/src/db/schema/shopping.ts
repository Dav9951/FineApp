import {
  ShoppingImportInputSchema,
  ShoppingImportKindSchema,
  ShoppingImportStatusSchema,
  ShoppingItemSourceSchema,
  ShoppingSectionSchema,
  ShoppingUnitSchema,
  type ShoppingImportInput,
  type ShoppingImportKind,
  type ShoppingImportStatus,
  type ShoppingItemSource,
  type ShoppingSection,
  type ShoppingUnit,
} from '@fineapp/shared';
import { sql } from 'drizzle-orm';
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
  bpsColumn,
  idColumn,
  inEnum,
  minorColumn,
  timestampColumn,
  timestamps,
} from './_shared.js';
import { households } from './households.js';
import { users } from './users.js';

/**
 * Listy zakupów — wymaganie #15, Faza 10
 * ([03 §3.23–3.27](../../../../../plans/03-data-model.md#323-shopping_lists), ADR-093…097).
 *
 * Bez kwot: jedyna kolumna `_minor` to koszt odczytu AI w `shopping_imports`. Ilości są
 * liczbami całkowitymi w tysięcznych częściach jednostki (`_milli`), z tego samego powodu
 * co grosze — `REAL` w bazie zaokrągla po cichu.
 */

/**
 * Ilość w tysięcznych częściach jednostki: 1,5 kg = 1500 (ADR-093).
 *
 * @param name - Nazwa kolumny w bazie; zawsze z sufiksem `_milli`.
 * @returns Builder kolumny całkowitoliczbowej.
 */
function milliColumn<TName extends string>(name: TName) {
  return integer(name, { mode: 'number' });
}

/**
 * Lista zakupów gospodarstwa, wspólna dla obu domowników (03 §3.23).
 *
 * Najwyżej jedna domyślna — pilnuje tego indeks częściowy, a przeniesienie flagi przy
 * archiwizacji i usunięciu serwis (I-26).
 */
export const shoppingLists = sqliteTable(
  'shopping_lists',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolColumn('is_default').notNull().default(false),
    sortOrder: integer('sort_order', { mode: 'number' }).notNull().default(0),
    archivedAt: timestampColumn('archived_at'),
    createdBy: text('created_by').references((): AnySQLiteColumn => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    check('shopping_lists_name_check', sql`length(${table.name}) BETWEEN 1 AND 60`),
    uniqueIndex('uq_shopping_lists_default')
      .on(table.householdId)
      .where(sql`${table.isDefault} = 1`),
    index('idx_shopping_lists_household').on(table.householdId, table.archivedAt, table.sortOrder),
  ],
);

/**
 * Słownik produktów gospodarstwa: podpowiedzi, zapamiętany dział, „zawsze w domu"
 * (03 §3.24). Wiersz powstaje sam przy dopisaniu pozycji (07 §14.5).
 */
export const shoppingProducts = sqliteTable(
  'shopping_products',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Klucz porównań (07 §14.1) — unikalny w gospodarstwie. */
    normalizedName: text('normalized_name').notNull(),
    section: text('section').notNull().$type<ShoppingSection>(),
    isStaple: boolColumn('is_staple').notNull().default(false),
    useCount: integer('use_count', { mode: 'number' }).notNull().default(0),
    lastUsedAt: timestampColumn('last_used_at'),
    ...timestamps,
  },
  (table) => [
    check('shopping_products_name_check', sql`length(${table.name}) BETWEEN 1 AND 80`),
    check('shopping_products_section_check', inEnum(table.section, ShoppingSectionSchema.options)),
    uniqueIndex('uq_shopping_products_name').on(table.householdId, table.normalizedName),
    index('idx_shopping_products_usage').on(table.householdId, table.lastUsedAt),
  ],
);

/**
 * Odczyt przez AI — zdjęcie listy albo przepis (03 §3.26, ADR-094). Nie jest dokumentem
 * finansowym: bez SHA-256 i bez powiązania z `documents`.
 */
export const shoppingImports = sqliteTable(
  'shopping_imports',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    listId: text('list_id')
      .notNull()
      .references((): AnySQLiteColumn => shoppingLists.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<ShoppingImportKind>(),
    input: text('input').notNull().$type<ShoppingImportInput>(),
    status: text('status').notNull().default('processing').$type<ShoppingImportStatus>(),
    sourceUrl: text('source_url'),
    /** Tekst wklejony albo pobrany z linku (≤ 30 tys. znaków). */
    sourceText: text('source_text'),
    /** JSON: ścieżki obrazów względem `UPLOAD_DIR`; pusta tablica po commit / discard (I-31). */
    filePaths: text('file_paths').notNull().default('[]'),
    /** Tylko przepis. ×1 = 10 000. */
    servingsFactorBps: bpsColumn('servings_factor_bps'),
    recipeTitle: text('recipe_title'),
    baseServings: integer('base_servings', { mode: 'number' }),
    notes: text('notes'),
    aiModel: text('ai_model'),
    aiRawResponse: text('ai_raw_response'),
    /** Zużycie odczytu (ADR-107); `null`, gdy model nie odpowiedział. */
    aiInputTokens: integer('ai_input_tokens', { mode: 'number' }),
    aiOutputTokens: integer('ai_output_tokens', { mode: 'number' }),
    /** Chwila odczytu z odpowiedzią modelu — miesiąc w zużyciu (ADR-107). */
    processedAt: timestampColumn('processed_at'),
    costMinor: minorColumn('cost_minor').notNull().default(0),
    errorCode: text('error_code'),
    createdBy: text('created_by')
      .notNull()
      .references((): AnySQLiteColumn => users.id),
    ...timestamps,
  },
  (table) => [
    check('shopping_imports_kind_check', inEnum(table.kind, ShoppingImportKindSchema.options)),
    check('shopping_imports_input_check', inEnum(table.input, ShoppingImportInputSchema.options)),
    check(
      'shopping_imports_status_check',
      inEnum(table.status, ShoppingImportStatusSchema.options),
    ),
    check(
      'shopping_imports_factor_check',
      sql`${table.servingsFactorBps} IS NULL OR ${between(table.servingsFactorBps, 2500, 40000)}`,
    ),
    index('idx_shopping_imports_status').on(table.householdId, table.status, table.createdAt),
  ],
);

/**
 * Pozycja listy zakupów (03 §3.25).
 *
 * Identyfikator może przyjść od klienta — dopisanie offline ponawiane z kolejki nie
 * może zdublować pozycji (ADR-096). „Wyczyść kupione" jest miękkie (`cleared_at`),
 * żeby działało „Cofnij" (I-28).
 */
export const shoppingItems = sqliteTable(
  'shopping_items',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    listId: text('list_id')
      .notNull()
      .references((): AnySQLiteColumn => shoppingLists.id, { onDelete: 'cascade' }),
    productId: text('product_id').references((): AnySQLiteColumn => shoppingProducts.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    quantityMilli: milliColumn('quantity_milli'),
    unit: text('unit').$type<ShoppingUnit>(),
    note: text('note'),
    section: text('section').notNull().$type<ShoppingSection>(),
    /** Kolejność na liście, ustawiana przeciąganiem (ADR-104); nowa = max na liście + 1. */
    sortOrder: integer('sort_order', { mode: 'number' }).notNull().default(0),
    source: text('source').notNull().default('manual').$type<ShoppingItemSource>(),
    importId: text('import_id').references((): AnySQLiteColumn => shoppingImports.id, {
      onDelete: 'set null',
    }),
    checkedAt: timestampColumn('checked_at'),
    checkedBy: text('checked_by').references((): AnySQLiteColumn => users.id, {
      onDelete: 'set null',
    }),
    clearedAt: timestampColumn('cleared_at'),
    createdBy: text('created_by').references((): AnySQLiteColumn => users.id, {
      onDelete: 'set null',
    }),
    /** Kto ostatnio zmienił pozycję — „Ania · 12 min temu" na karcie listy (06 §3.15). */
    updatedBy: text('updated_by').references((): AnySQLiteColumn => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    check('shopping_items_name_check', sql`length(${table.name}) BETWEEN 1 AND 80`),
    check(
      'shopping_items_quantity_check',
      sql`${table.quantityMilli} IS NULL OR ${table.quantityMilli} > 0`,
    ),
    check('shopping_items_unit_check', inEnum(table.unit, ShoppingUnitSchema.options)),
    // I-27 — ilość i jednostka razem albo wcale.
    check(
      'shopping_items_quantity_unit_check',
      sql`(${table.quantityMilli} IS NULL) = (${table.unit} IS NULL)`,
    ),
    check('shopping_items_note_check', sql`${table.note} IS NULL OR length(${table.note}) <= 120`),
    check('shopping_items_section_check', inEnum(table.section, ShoppingSectionSchema.options)),
    check('shopping_items_source_check', inEnum(table.source, ShoppingItemSourceSchema.options)),
    // I-28 — wyczyścić można tylko kupioną.
    check(
      'shopping_items_cleared_check',
      sql`${table.clearedAt} IS NULL OR ${table.checkedAt} IS NOT NULL`,
    ),
    index('idx_shopping_items_list').on(
      table.householdId,
      table.listId,
      table.clearedAt,
      table.checkedAt,
    ),
    index('idx_shopping_items_name').on(table.householdId, table.listId, table.normalizedName),
  ],
);

/** Propozycja z odczytu AI, czekająca na przegląd (03 §3.27, I-30). */
export const shoppingImportItems = sqliteTable(
  'shopping_import_items',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    importId: text('import_id')
      .notNull()
      .references((): AnySQLiteColumn => shoppingImports.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order', { mode: 'number' }).notNull(),
    name: text('name').notNull(),
    sourceText: text('source_text').notNull(),
    quantityMilli: milliColumn('quantity_milli'),
    unit: text('unit').$type<ShoppingUnit>(),
    quantityOverridden: boolColumn('quantity_overridden').notNull().default(false),
    baseAmountMilli: milliColumn('base_amount_milli'),
    baseUnit: text('base_unit').$type<'g' | 'ml' | 'pcs'>(),
    packageAmountMilli: milliColumn('package_amount_milli'),
    packageLabel: text('package_label'),
    pantryStaple: boolColumn('pantry_staple').notNull().default(false),
    section: text('section').notNull().$type<ShoppingSection>(),
    confidenceBps: bpsColumn('confidence_bps').notNull(),
    alreadyHave: boolColumn('already_have').notNull().default(false),
    selected: boolColumn('selected').notNull().default(true),
    mergeIntoItemId: text('merge_into_item_id').references(
      (): AnySQLiteColumn => shoppingItems.id,
      { onDelete: 'set null' },
    ),
    ...timestamps,
  },
  (table) => [
    check('shopping_import_items_name_check', sql`length(${table.name}) BETWEEN 1 AND 80`),
    check(
      'shopping_import_items_quantity_check',
      sql`${table.quantityMilli} IS NULL OR ${table.quantityMilli} > 0`,
    ),
    check('shopping_import_items_unit_check', inEnum(table.unit, ShoppingUnitSchema.options)),
    check(
      'shopping_import_items_quantity_unit_check',
      sql`(${table.quantityMilli} IS NULL) = (${table.unit} IS NULL)`,
    ),
    check('shopping_import_items_base_unit_check', inEnum(table.baseUnit, ['g', 'ml', 'pcs'])),
    check(
      'shopping_import_items_amounts_check',
      sql`(${table.baseAmountMilli} IS NULL OR ${table.baseAmountMilli} > 0) AND (${table.packageAmountMilli} IS NULL OR ${table.packageAmountMilli} > 0)`,
    ),
    check(
      'shopping_import_items_section_check',
      inEnum(table.section, ShoppingSectionSchema.options),
    ),
    check('shopping_import_items_confidence_check', between(table.confidenceBps, 0, 10000)),
    index('idx_shopping_import_items_import').on(table.importId, table.sortOrder),
  ],
);

/** Typ wiersza `shopping_lists` zwracany z bazy. */
export type ShoppingListRow = typeof shoppingLists.$inferSelect;
/** Typ wiersza `shopping_lists` przyjmowany przy zapisie. */
export type ShoppingListInsert = typeof shoppingLists.$inferInsert;
/** Typ wiersza `shopping_products` zwracany z bazy. */
export type ShoppingProductRow = typeof shoppingProducts.$inferSelect;
/** Typ wiersza `shopping_products` przyjmowany przy zapisie. */
export type ShoppingProductInsert = typeof shoppingProducts.$inferInsert;
/** Typ wiersza `shopping_items` zwracany z bazy. */
export type ShoppingItemRow = typeof shoppingItems.$inferSelect;
/** Typ wiersza `shopping_items` przyjmowany przy zapisie. */
export type ShoppingItemInsert = typeof shoppingItems.$inferInsert;
/** Typ wiersza `shopping_imports` zwracany z bazy. */
export type ShoppingImportRow = typeof shoppingImports.$inferSelect;
/** Typ wiersza `shopping_imports` przyjmowany przy zapisie. */
export type ShoppingImportInsert = typeof shoppingImports.$inferInsert;
/** Typ wiersza `shopping_import_items` zwracany z bazy. */
export type ShoppingImportItemRow = typeof shoppingImportItems.$inferSelect;
/** Typ wiersza `shopping_import_items` przyjmowany przy zapisie. */
export type ShoppingImportItemInsert = typeof shoppingImportItems.$inferInsert;
