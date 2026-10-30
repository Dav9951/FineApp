import type { DocumentDto, DocumentItemDto, DocumentListItemDto } from '@fineapp/shared';

/**
 * Dane testowe dokumentów w kształcie z kontraktu (05 §12).
 */

/** Identyfikator dokumentu w testach. */
export const DOCUMENT_ID = '01JP0000000000000000000D01';
/** Konto ROR w testach. */
export const ROR_ID = '01JB0000000000000000000001';
/** Kategoria „Zakupy spożywcze". */
export const GROCERIES_ID = '01JC0000000000000000000001';
/** Kategoria „Chemia". */
export const CHEMIA_ID = '01JC0000000000000000000002';

/**
 * Pozycja dokumentu.
 *
 * @param overrides - Nadpisane pola.
 * @returns Pozycja.
 */
export function itemFixture(overrides: Partial<DocumentItemDto> = {}): DocumentItemDto {
  return {
    id: '01JQ0000000000000000000001',
    lineNo: 1,
    rawText: null,
    description: 'Mleko 3,2% 1L',
    quantity: null,
    unitPriceMinor: null,
    amountMinor: 698,
    direction: 'outflow',
    bookedOn: null,
    suggestedCategoryId: GROCERIES_ID,
    suggestedCategoryName: null,
    confidence: 0.97,
    reviewStatus: 'pending',
    transactionId: null,
    duplicateOfTransactionId: null,
    ...overrides,
  };
}

/** Pozycje paragonu Lidla: mleko, proszek, baterie (propozycja), chleb (41%), rabat. */
export const LIDL_ITEMS: DocumentItemDto[] = [
  itemFixture({ id: '01JQ0000000000000000000001', description: 'Mleko 3,2% 1L', quantity: 2 }),
  itemFixture({
    id: '01JQ0000000000000000000002',
    lineNo: 2,
    description: 'Proszek do prania',
    amountMinor: 2499,
    suggestedCategoryId: CHEMIA_ID,
    confidence: 0.88,
  }),
  itemFixture({
    id: '01JQ0000000000000000000003',
    lineNo: 3,
    description: 'Baterie AA',
    amountMinor: 1250,
    suggestedCategoryId: null,
    suggestedCategoryName: 'Elektronika',
    confidence: 0.4,
  }),
  itemFixture({
    id: '01JQ0000000000000000000004',
    lineNo: 4,
    description: 'Chleb żytni',
    amountMinor: 420,
    confidence: 0.41,
  }),
  itemFixture({
    id: '01JQ0000000000000000000005',
    lineNo: 5,
    description: 'Rabat',
    amountMinor: 300,
    direction: 'inflow',
    suggestedCategoryId: null,
    confidence: 0.62,
  }),
];

/**
 * Dokument po analizie — paragon Lidla z sumą zgodną z pozycjami (4567 gr).
 *
 * @param overrides - Nadpisane pola.
 * @returns Dokument.
 */
export function documentFixture(overrides: Partial<DocumentDto> = {}): DocumentDto {
  return {
    id: DOCUMENT_ID,
    kind: 'receipt',
    status: 'parsed',
    originalFilename: 'paragon.jpg',
    mimeType: 'image/jpeg',
    byteSize: 12_345,
    pageCount: 1,
    fileUrl: `/api/v1/documents/${DOCUMENT_ID}/file`,
    summary: {
      merchant: 'Lidl',
      bookedOn: '2026-09-18',
      totalMinor: 698 + 2499 + 1250 + 420 - 300,
      currency: 'PLN',
      confidence: 0.94,
      detectedMonthKey: '2026-09',
      notes: null,
      accountHint: null,
      periodFrom: null,
      periodTo: null,
    },
    suggestedAccountId: ROR_ID,
    items: LIDL_ITEMS,
    newCategoryProposals: [
      { name: 'Elektronika', kind: 'expense', itemIds: [LIDL_ITEMS[2]?.id ?? ''] },
    ],
    errorCode: null,
    errorMessage: null,
    ai: { model: 'claude-sonnet-5', costMinor: 4, processedAt: 1 },
    createdAt: 1,
    ...overrides,
  };
}

/**
 * Wiersz listy „Ostatnie".
 *
 * @param overrides - Nadpisane pola.
 * @returns Wiersz.
 */
export function listItemFixture(overrides: Partial<DocumentListItemDto> = {}): DocumentListItemDto {
  return {
    id: DOCUMENT_ID,
    kind: 'receipt',
    status: 'parsed',
    originalFilename: 'paragon.jpg',
    merchant: 'Lidl',
    bookedOn: '2026-09-18',
    totalMinor: 12_799,
    itemCount: 8,
    errorMessage: null,
    createdAt: 1,
    ...overrides,
  };
}
