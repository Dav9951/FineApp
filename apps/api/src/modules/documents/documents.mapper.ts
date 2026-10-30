import {
  collectCategoryProposals,
  DocumentSummaryDtoSchema,
  type DocumentDto,
  type DocumentItemDto,
  type DocumentListItemDto,
  type DocumentSummaryDto,
} from '@fineapp/shared';

import type { DocumentItemRow, DocumentRow } from '../../db/schema/documents.js';
import type { DocumentListRow } from './documents.repository.js';

/**
 * Mapowanie wierszy dokumentów na DTO — `snake_case` → `camelCase` tylko tutaj.
 *
 * `parsed_summary` to JSON zapisany przez nas samych, ale czytamy go przez schemat:
 * wiersz sprzed zmiany kształtu nie może wysadzić odczytu całego dokumentu.
 */

/** Nagłówek w `parsed_summary` — DTO bez miesiąca, który ma własną kolumnę. */
const StoredSummarySchema = DocumentSummaryDtoSchema.omit({ detectedMonthKey: true });

/** Zapisywany kształt nagłówka. */
export type StoredSummary = Omit<DocumentSummaryDto, 'detectedMonthKey'>;

/**
 * Odczytuje nagłówek z kolumny `parsed_summary`.
 *
 * @param row - Wiersz dokumentu.
 * @returns Nagłówek albo `null`, gdy go nie ma lub jest nieczytelny.
 */
export function storedSummary(row: DocumentRow): StoredSummary | null {
  if (row.parsedSummary === null) return null;
  try {
    const parsed = StoredSummarySchema.safeParse(JSON.parse(row.parsedSummary));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Adres pliku dokumentu — wyłącznie przez uwierzytelnioną trasę (08 §12).
 *
 * @param documentId - Identyfikator dokumentu.
 * @returns Ścieżka API.
 */
export function documentFileUrl(documentId: string): string {
  return `/api/v1/documents/${documentId}/file`;
}

/**
 * Pozycja dokumentu → DTO.
 *
 * @param row - Wiersz pozycji.
 * @returns DTO pozycji.
 */
export function toDocumentItemDto(row: DocumentItemRow): DocumentItemDto {
  return {
    id: row.id,
    lineNo: row.lineNo,
    rawText: row.rawText,
    description: row.description,
    quantity: row.quantity,
    unitPriceMinor: row.unitPriceMinor,
    amountMinor: row.amountMinor,
    direction: row.direction,
    bookedOn: row.bookedOn,
    suggestedCategoryId: row.suggestedCategoryId,
    suggestedCategoryName: row.suggestedCategoryName,
    confidence: row.confidence,
    reviewStatus: row.reviewStatus,
    transactionId: row.transactionId,
    duplicateOfTransactionId: row.duplicateOfTransactionId,
  };
}

/**
 * Dokument z pozycjami → DTO.
 *
 * @param row - Wiersz dokumentu.
 * @param items - Wiersze pozycji.
 * @returns DTO dokumentu.
 */
export function toDocumentDto(row: DocumentRow, items: readonly DocumentItemRow[]): DocumentDto {
  const summary = storedSummary(row);
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    pageCount: row.pageCount,
    fileUrl: documentFileUrl(row.id),
    summary: summary === null ? null : { ...summary, detectedMonthKey: row.detectedMonthKey },
    suggestedAccountId: row.accountId,
    items: items.map(toDocumentItemDto),
    newCategoryProposals: collectCategoryProposals(items),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    ai:
      row.aiModel !== null && row.processedAt !== null
        ? { model: row.aiModel, costMinor: row.aiCostMinor ?? 0, processedAt: row.processedAt }
        : null,
    createdAt: row.createdAt,
  };
}

/**
 * Wiersz listy → DTO.
 *
 * @param row - Wiersz z liczbą pozycji.
 * @returns DTO wiersza listy.
 */
export function toDocumentListItemDto(row: DocumentListRow): DocumentListItemDto {
  const summary = storedSummary(row);
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    originalFilename: row.originalFilename,
    merchant: summary?.merchant ?? null,
    bookedOn: summary?.bookedOn ?? null,
    totalMinor: summary?.totalMinor ?? null,
    itemCount: row.itemCount,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
  };
}
