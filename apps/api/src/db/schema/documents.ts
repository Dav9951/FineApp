import { DocumentKindSchema, DocumentStatusSchema, ReviewStatusSchema } from '@fineapp/shared';
import {
  check,
  index,
  integer,
  real,
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
import { households } from './households.js';
import { transactions } from './transactions.js';
import { users } from './users.js';

/** Kierunek pozycji z dokumentu. */
const ITEM_DIRECTIONS = ['inflow', 'outflow'] as const;

/**
 * Dokumenty wrzucone do odczytu — paragony, wyciągi, faktury (wymaganie #4).
 *
 * Kolumny `ai_*` istnieją po to, żeby dało się zdiagnozować zły odczyt **po fakcie**:
 * bez zapisanej surowej odpowiedzi i identyfikatora żądania nie da się odtworzyć,
 * co model zobaczył. `aiCostMinor` zasila licznik pilnujący `AI_MONTHLY_BUDGET_MINOR`.
 *
 * `sha256` wykrywa ponowne wrzucenie tego samego pliku — unikalny w obrębie gospodarstwa.
 */
export const documents = sqliteTable(
  'documents',
  {
    id: idColumn(),
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<'receipt' | 'bank_statement' | 'invoice' | 'other'>(),
    status: text('status')
      .notNull()
      .default('uploaded')
      .$type<'uploaded' | 'processing' | 'parsed' | 'failed' | 'committed' | 'discarded'>(),
    originalFilename: text('original_filename').notNull(),
    /** Ścieżka względem `UPLOAD_DIR`; katalog nigdy nie jest serwowany statycznie. */
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    pageCount: integer('page_count'),
    /**
     * Konto, z którego zapłacono — podpowiedź przy wrzuceniu albo korekta nagłówka.
     * Kontrakt (05 §12 `suggestedAccountId`, 04 §13 `PATCH`) go zakładał, a tabela
     * nie miała gdzie go trzymać (ADR-059).
     */
    accountId: text('account_id').references((): AnySQLiteColumn => accounts.id, {
      onDelete: 'set null',
    }),
    aiProvider: text('ai_provider'),
    aiModel: text('ai_model'),
    aiRequestId: text('ai_request_id'),
    aiInputTokens: integer('ai_input_tokens'),
    aiOutputTokens: integer('ai_output_tokens'),
    /** Szacunek kosztu wywołania, w groszach. */
    aiCostMinor: minorColumn('ai_cost_minor'),
    /** JSON — do diagnozy złych odczytów. */
    aiRawResponse: text('ai_raw_response'),
    /** JSON: sprzedawca, suma, data, pewność. */
    parsedSummary: text('parsed_summary'),
    detectedMonthKey: monthKeyColumn('detected_month_key'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    processedAt: timestampColumn('processed_at'),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references((): AnySQLiteColumn => users.id),
    ...timestamps,
  },
  (table) => [
    check('documents_kind_check', inEnum(table.kind, DocumentKindSchema.options)),
    check('documents_status_check', inEnum(table.status, DocumentStatusSchema.options)),
    uniqueIndex('uq_documents_sha').on(table.householdId, table.sha256),
    index('idx_documents_status').on(table.householdId, table.status, table.createdAt),
  ],
);

/**
 * Pozycje rozpoznane w dokumencie — jedna linia paragonu lub operacja z wyciągu.
 *
 * `quantity` i `confidence` to **jedyne** kolumny `REAL` w schemacie: pierwsza to ilość
 * sztuk, druga pewność modelu. Żadna z nich nie jest pieniądzem
 * ([07 §8.1](../../../../../plans/07-domain-rules.md#81-reprezentacja)).
 */
export const documentItems = sqliteTable(
  'document_items',
  {
    id: idColumn(),
    documentId: text('document_id')
      .notNull()
      .references((): AnySQLiteColumn => documents.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    /** Surowa linia z dokumentu — do weryfikacji przez człowieka. */
    rawText: text('raw_text'),
    description: text('description').notNull(),
    /** Ilość sztuk, nie pieniądz. */
    quantity: real('quantity'),
    unitPriceMinor: minorColumn('unit_price_minor'),
    amountMinor: minorColumn('amount_minor').notNull(),
    direction: text('direction').notNull().default('outflow').$type<'inflow' | 'outflow'>(),
    /** Dla wyciągów: data operacji. */
    bookedOn: dateOnlyColumn('booked_on'),
    suggestedCategoryId: text('suggested_category_id').references(
      (): AnySQLiteColumn => categories.id,
      {
        onDelete: 'set null',
      },
    ),
    /** Gdy AI proponuje kategorię spoza listy. */
    suggestedCategoryName: text('suggested_category_name'),
    /** Pewność modelu, 0..1. */
    confidence: real('confidence'),
    reviewStatus: text('review_status')
      .notNull()
      .default('pending')
      .$type<'pending' | 'accepted' | 'rejected' | 'merged'>(),
    transactionId: text('transaction_id').references((): AnySQLiteColumn => transactions.id, {
      onDelete: 'set null',
    }),
    duplicateOfTransactionId: text('duplicate_of_transaction_id').references(
      (): AnySQLiteColumn => transactions.id,
      { onDelete: 'set null' },
    ),
    ...timestamps,
  },
  (table) => [
    check('document_items_direction_check', inEnum(table.direction, ITEM_DIRECTIONS)),
    check(
      'document_items_review_status_check',
      inEnum(table.reviewStatus, ReviewStatusSchema.options),
    ),
    index('idx_document_items').on(table.documentId, table.lineNo),
  ],
);

/** Typ wiersza `documents` zwracany z bazy. */
export type DocumentRow = typeof documents.$inferSelect;
/** Typ wiersza `documents` przyjmowany przy zapisie. */
export type DocumentInsert = typeof documents.$inferInsert;
/** Typ wiersza `document_items` zwracany z bazy. */
export type DocumentItemRow = typeof documentItems.$inferSelect;
/** Typ wiersza `document_items` przyjmowany przy zapisie. */
export type DocumentItemInsert = typeof documentItems.$inferInsert;
