import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { timestampColumn } from './_shared.js';

/**
 * Metadane aplikacji — prosty magazyn klucz/wartość.
 *
 * Używane klucze: `schema_version`, `seeded_at`, `last_recurring_generation`
 * oraz `ai_spend_<YYYY-MM>_minor` (licznik kosztów OCR pilnujący
 * `AI_MONTHLY_BUDGET_MINOR`).
 */
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

/** Typ wiersza `app_meta` zwracany z bazy. */
export type AppMetaRow = typeof appMeta.$inferSelect;
