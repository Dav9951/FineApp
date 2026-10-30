import { CategoryKindSchema } from '@fineapp/shared';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { boolColumn, idColumn, inEnum, timestamps } from './_shared.js';
import { households } from './households.js';

/**
 * Kategorie wydatków, przychodów i przelewów.
 *
 * Hierarchia jest **jednopoziomowa**: kategoria z `parentId` nie może mieć własnych
 * dzieci (niezmiennik I-11, walidowany w serwisie — SQLite nie wyrazi tego
 * deklaratywnie). Głębsze drzewo komplikuje każdy raport, a w budżecie domowym nie daje
 * nic w zamian.
 */
export const categories = sqliteTable(
  'categories',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => categories.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    kind: text('kind').notNull().$type<'expense' | 'income' | 'transfer'>(),
    icon: text('icon'),
    color: text('color'),
    /**
     * Podpowiedzi dla AI: nazwy sklepów, słowa kluczowe z paragonów, po przecinku.
     *
     * Wymaganie #5 — model widzi **wszystkie** kategorie wraz z tymi podpowiedziami.
     * To pole decyduje o jakości automatycznej kategoryzacji bardziej niż sam prompt.
     */
    aiHints: text('ai_hints'),
    /** Z seeda; nie da się usunąć (I-9), można zarchiwizować. */
    isSystem: boolColumn('is_system').notNull().default(false),
    isArchived: boolColumn('is_archived').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    check('categories_kind_check', inEnum(table.kind, CategoryKindSchema.options)),
    uniqueIndex('uq_categories_slug').on(table.householdId, table.kind, table.slug),
    index('idx_categories_parent').on(table.householdId, table.parentId, table.sortOrder),
  ],
);

/** Typ wiersza `categories` zwracany z bazy. */
export type CategoryRow = typeof categories.$inferSelect;
/** Typ wiersza `categories` przyjmowany przy zapisie. */
export type CategoryInsert = typeof categories.$inferInsert;
