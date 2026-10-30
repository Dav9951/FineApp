import type {
  AiUsageDto,
  CommitDocumentRequest,
  CommitDocumentResponse,
  DocumentDto,
  DocumentListItemDto,
  TransactionMutationMeta,
  UpdateDocumentItemRequest,
  UpdateDocumentRequest,
  UploadDocumentKind,
  UploadDocumentResponse,
} from '@fineapp/shared';

import { apiBlob, apiRequest, apiRequestWithMeta } from '../../lib/api-client.js';

/**
 * Wywołania API dokumentów i OCR
 * ([04 §13](../../../../../plans/04-api-spec.md#13-dokumenty--ocr--apiv1documents)).
 *
 * Funkcje są cienkie: ścieżka, metoda, ciało. Stan, cache i odpytywanie mieszkają
 * w hookach (`hooks/use-documents.ts`).
 */

/** Wrzucenie dokumentu. */
export interface UploadInput {
  readonly file: Blob;
  readonly filename: string;
  readonly kind: UploadDocumentKind;
  readonly accountId?: string | null;
}

/**
 * Wrzuca dokument (`multipart/form-data`). Pola tekstowe idą **przed** plikiem —
 * serwer czyta treść strumieniem.
 *
 * @param accessToken - Token dostępu.
 * @param input - Plik i pola.
 * @returns Identyfikator i status analizy.
 */
export function uploadDocument(
  accessToken: string,
  input: UploadInput,
): Promise<UploadDocumentResponse> {
  const form = new FormData();
  form.append('kind', input.kind);
  if (input.accountId) form.append('accountId', input.accountId);
  form.append('file', input.file, input.filename);
  return apiRequest<UploadDocumentResponse>('/documents', {
    method: 'POST',
    accessToken,
    formData: form,
  });
}

/**
 * Ostatnie dokumenty.
 *
 * @param accessToken - Token dostępu.
 * @param limit - Ile wierszy.
 * @returns Lista od najnowszych.
 */
export function fetchDocuments(accessToken: string, limit = 10): Promise<DocumentListItemDto[]> {
  return apiRequest<DocumentListItemDto[]>('/documents', { accessToken, query: { limit } });
}

/**
 * Dokument z pozycjami.
 *
 * @param accessToken - Token dostępu.
 * @param id - Identyfikator.
 * @returns Dokument.
 */
export function fetchDocument(accessToken: string, id: string): Promise<DocumentDto> {
  return apiRequest<DocumentDto>(`/documents/${id}`, { accessToken });
}

/**
 * Plik dokumentu — oryginał albo miniatura.
 *
 * @param accessToken - Token dostępu.
 * @param id - Identyfikator.
 * @param variant - Wariant.
 * @returns Zawartość.
 */
export function fetchDocumentFile(
  accessToken: string,
  id: string,
  variant: 'original' | 'thumb',
): Promise<Blob> {
  return apiBlob(`/documents/${id}/file`, { accessToken, query: { variant } });
}

/**
 * Korekta nagłówka.
 *
 * @param accessToken - Token dostępu.
 * @param id - Identyfikator.
 * @param body - Zmiany.
 * @returns Dokument po zmianie.
 */
export function updateDocument(
  accessToken: string,
  id: string,
  body: UpdateDocumentRequest,
): Promise<DocumentDto> {
  return apiRequest<DocumentDto>(`/documents/${id}`, { method: 'PATCH', accessToken, body });
}

/**
 * Korekta pozycji.
 *
 * @param accessToken - Token dostępu.
 * @param id - Dokument.
 * @param itemId - Pozycja.
 * @param body - Zmiany.
 * @returns Dokument po zmianie.
 */
export function updateDocumentItem(
  accessToken: string,
  id: string,
  itemId: string,
  body: UpdateDocumentItemRequest,
): Promise<DocumentDto> {
  return apiRequest<DocumentDto>(`/documents/${id}/items/${itemId}`, {
    method: 'PATCH',
    accessToken,
    body,
  });
}

/** Wynik commitu z miesiącami do unieważnienia. */
export interface CommitResult {
  readonly data: CommitDocumentResponse;
  readonly meta: TransactionMutationMeta;
}

/**
 * Zatwierdza dokument.
 *
 * @param accessToken - Token dostępu.
 * @param id - Dokument.
 * @param body - Tryb, konto, data, pozycje.
 * @param idempotencyKey - Klucz — jeden na otwarcie przeglądu.
 * @returns Dokument i utworzone transakcje.
 */
export function commitDocument(
  accessToken: string,
  id: string,
  body: CommitDocumentRequest,
  idempotencyKey: string,
): Promise<CommitResult> {
  return apiRequestWithMeta<CommitDocumentResponse, TransactionMutationMeta>(
    `/documents/${id}/commit`,
    { method: 'POST', accessToken, body, idempotencyKey },
  );
}

/**
 * Ponawia analizę.
 *
 * @param accessToken - Token dostępu.
 * @param id - Dokument.
 * @returns Status analizy.
 */
export function reanalyzeDocument(
  accessToken: string,
  id: string,
): Promise<UploadDocumentResponse> {
  return apiRequest<UploadDocumentResponse>(`/documents/${id}/analyze`, {
    method: 'POST',
    accessToken,
  });
}

/**
 * Odrzuca dokument w całości.
 *
 * @param accessToken - Token dostępu.
 * @param id - Dokument.
 * @returns Dokument po zmianie.
 */
export function discardDocument(accessToken: string, id: string): Promise<DocumentDto> {
  return apiRequest<DocumentDto>(`/documents/${id}/discard`, { method: 'POST', accessToken });
}

/**
 * Usuwa dokument z plikiem.
 *
 * @param accessToken - Token dostępu.
 * @param id - Dokument.
 * @returns Obietnica spełniona po usunięciu.
 */
export async function deleteDocument(accessToken: string, id: string): Promise<void> {
  await apiRequest<undefined>(`/documents/${id}`, { method: 'DELETE', accessToken });
}

/**
 * Zużycie OCR w bieżącym miesiącu — także flaga `enabled` (zakładka *Skan*).
 *
 * @param accessToken - Token dostępu.
 * @returns Zużycie.
 */
export function fetchAiUsage(accessToken: string): Promise<AiUsageDto> {
  return apiRequest<AiUsageDto>('/settings/ai-usage', { accessToken });
}
