import { AiLogEventSchema, AiLogLevelSchema } from '@fineapp/shared';
import { check, index, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { idColumn, inEnum, timestampColumn } from './_shared.js';
import { documents } from './documents.js';
import { households } from './households.js';

/**
 * Dziennik odczytu dokumentów — co się działo z każdą analizą (ADR-086).
 *
 * Powstał, bo nieudany odczyt zostawiał w dokumencie tylko `error_code` i ogólny
 * komunikat „Spróbuj ponownie" — bez czasu, statusu HTTP, liczby tokenów i wymiarów
 * obrazu nie dało się odróżnić przekroczenia czasu od uciętej odpowiedzi.
 *
 * `details` to JSON z **liczbami i kodami**, nigdy z treścią dokumentu: kwoty, sprzedawca
 * i surowa odpowiedź modelu zostają w `documents` (reguła 12 z CONTRIBUTING). Usunięcie
 * dokumentu nie kasuje wpisów (`set null`), bo dziennik ma pokazać także dokument, który
 * ktoś usunął po nieudanym odczycie — nazwa pliku zostaje w `document_name`.
 *
 * Wpisy starsze niż 90 dni są sprzątane przy każdym zapisie (`LOG_RETENTION_MS`).
 */
export const documentLogs = sqliteTable(
  'document_logs',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    documentId: text('document_id').references((): AnySQLiteColumn => documents.id, {
      onDelete: 'set null',
    }),
    documentName: text('document_name'),
    level: text('level').notNull().$type<'info' | 'warn' | 'error'>(),
    event: text('event').notNull(),
    message: text('message').notNull(),
    /** JSON obiektu `{ klucz: liczba | napis | boolean | null }`. */
    details: text('details').notNull().default('{}'),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    check('document_logs_level_check', inEnum(table.level, AiLogLevelSchema.options)),
    check('document_logs_event_check', inEnum(table.event, AiLogEventSchema.options)),
    index('idx_document_logs_household').on(table.householdId, table.createdAt),
    index('idx_document_logs_document').on(table.documentId, table.createdAt),
  ],
);

/** Typ wiersza `document_logs` zwracany z bazy. */
export type DocumentLogRow = typeof documentLogs.$inferSelect;
/** Typ wiersza `document_logs` przyjmowany przy zapisie. */
export type DocumentLogInsert = typeof documentLogs.$inferInsert;
