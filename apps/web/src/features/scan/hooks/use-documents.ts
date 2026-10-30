import type {
  AiUsageDto,
  CommitDocumentRequest,
  DocumentDto,
  DocumentListItemDto,
  UpdateDocumentItemRequest,
  UpdateDocumentRequest,
  UploadDocumentResponse,
} from '@fineapp/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { qk } from '../../../lib/query-keys.js';
import { requireToken, useAccessToken } from '../../auth/use-token.js';
import { invalidateAfterWrite } from '../../transactions/hooks/use-transactions.js';
import * as documentsApi from '../api.js';
import { isInFlight } from '../scan-view.js';

/**
 * Stan serwerowy dokumentów — TanStack Query
 * ([02 §10](../../../../../../plans/02-architecture.md#10-frontend--wzorce), `F7-8`).
 *
 * Analiza biegnie w tle serwera, więc dokument „w drodze" jest odpytywany co 1,5 s
 * (04 §13 `pollAfterMs`) — i tylko wtedy: po `parsed` odpytywanie gaśnie samo.
 */

/** Odstęp odpytywania o wynik analizy. */
export const POLL_INTERVAL_MS = 1500;

/**
 * Unieważnia listę i jeden dokument.
 *
 * @param client - Klient zapytań.
 * @param id - Dokument.
 * @returns Obietnica spełniona po unieważnieniu.
 */
async function invalidateDocument(client: QueryClient, id: string): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.documentList() }),
    client.invalidateQueries({ queryKey: qk.document(id) }),
  ]);
}

/**
 * Ostatnie dokumenty — odpytywane, dopóki któryś jest analizowany.
 *
 * @returns Wynik zapytania.
 */
export function useDocuments(): UseQueryResult<DocumentListItemDto[]> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.documentList(),
    queryFn: () => documentsApi.fetchDocuments(requireToken(accessToken)),
    enabled: accessToken !== null,
    refetchInterval: (query) =>
      query.state.data?.some((item) => isInFlight(item.status)) ? POLL_INTERVAL_MS : false,
  });
}

/**
 * Dokument z pozycjami — odpytywany co 1,5 s, dopóki trwa analiza.
 *
 * @param id - Identyfikator.
 * @returns Wynik zapytania.
 */
export function useDocument(id: string): UseQueryResult<DocumentDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.document(id),
    queryFn: () => documentsApi.fetchDocument(requireToken(accessToken), id),
    enabled: accessToken !== null,
    refetchInterval: (query) =>
      query.state.data !== undefined && isInFlight(query.state.data.status)
        ? POLL_INTERVAL_MS
        : false,
  });
}

/**
 * Zużycie OCR i flaga `enabled` — zakładka *Skan* znika, gdy OCR jest wyłączony.
 *
 * Zmienia się rzadko, więc bez odświeżania przy powrocie do karty.
 *
 * @returns Wynik zapytania.
 */
export function useAiUsage(): UseQueryResult<AiUsageDto> {
  const accessToken = useAccessToken();
  return useQuery({
    queryKey: qk.aiUsage(),
    queryFn: () => documentsApi.fetchAiUsage(requireToken(accessToken)),
    enabled: accessToken !== null,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Czy OCR jest włączony. Do czasu odpowiedzi — tak, żeby zakładka nie mrugała
 * u wszystkich, którzy OCR mają.
 *
 * @returns `false` tylko wtedy, gdy serwer powiedział, że OCR jest wyłączony.
 */
export function useAiEnabled(): boolean {
  return useAiUsage().data?.enabled ?? true;
}

/**
 * Wrzucenie dokumentu. Unieważnia: `qk.documentList()`, `qk.aiUsage()`.
 *
 * @returns Mutacja.
 */
export function useUploadDocument(): UseMutationResult<
  UploadDocumentResponse,
  Error,
  documentsApi.UploadInput
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input) => documentsApi.uploadDocument(requireToken(accessToken), input),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: qk.documentList() }),
        client.invalidateQueries({ queryKey: qk.aiUsage() }),
      ]),
  });
}

/**
 * Korekta nagłówka. Unieważnia: `qk.documentList()`; dokument podmienia odpowiedzią.
 *
 * @param id - Dokument.
 * @returns Mutacja.
 */
export function useUpdateDocument(
  id: string,
): UseMutationResult<DocumentDto, Error, UpdateDocumentRequest> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => documentsApi.updateDocument(requireToken(accessToken), id, body),
    onSuccess: async (document) => {
      client.setQueryData(qk.document(id), document);
      await client.invalidateQueries({ queryKey: qk.documentList() });
    },
  });
}

/**
 * Korekta pozycji. Dokument podmienia odpowiedzią.
 *
 * @param id - Dokument.
 * @returns Mutacja.
 */
export function useUpdateDocumentItem(
  id: string,
): UseMutationResult<DocumentDto, Error, { itemId: string; body: UpdateDocumentItemRequest }> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, body }) =>
      documentsApi.updateDocumentItem(requireToken(accessToken), id, itemId, body),
    onSuccess: (document) => {
      client.setQueryData(qk.document(id), document);
    },
  });
}

/**
 * Zatwierdzenie dokumentu. Unieważnia to samo co zapis transakcji w księdze
 * (`invalidateAfterWrite`: historia, salda, miesiące z odpowiedzi, cele, rozkład…),
 * plus `qk.documents()` i `qk.categories()` (nowe kategorie z propozycji).
 *
 * @param id - Dokument.
 * @returns Mutacja.
 */
export function useCommitDocument(
  id: string,
): UseMutationResult<
  documentsApi.CommitResult,
  Error,
  { body: CommitDocumentRequest; idempotencyKey: string }
> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }) =>
      documentsApi.commitDocument(requireToken(accessToken), id, body, idempotencyKey),
    onSuccess: async (result) => {
      client.setQueryData(qk.document(id), result.data.document);
      await Promise.all([
        invalidateAfterWrite(client, result.meta.affectedMonths),
        client.invalidateQueries({ queryKey: qk.documentList() }),
        client.invalidateQueries({ queryKey: qk.categories() }),
      ]);
    },
  });
}

/**
 * Ponowna analiza. Unieważnia: dokument, `qk.documentList()`, `qk.aiUsage()`.
 *
 * @param id - Dokument.
 * @returns Mutacja.
 */
export function useReanalyzeDocument(
  id: string,
): UseMutationResult<UploadDocumentResponse, Error, void> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => documentsApi.reanalyzeDocument(requireToken(accessToken), id),
    onSettled: () =>
      Promise.all([
        invalidateDocument(client, id),
        client.invalidateQueries({ queryKey: qk.aiUsage() }),
      ]),
  });
}

/**
 * Odrzucenie dokumentu. Unieważnia: dokument i `qk.documentList()`.
 *
 * @param id - Dokument.
 * @returns Mutacja.
 */
export function useDiscardDocument(id: string): UseMutationResult<DocumentDto, Error, void> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => documentsApi.discardDocument(requireToken(accessToken), id),
    onSuccess: () => invalidateDocument(client, id),
  });
}

/**
 * Usunięcie dokumentu z plikiem. Unieważnia: `qk.documentList()`; dokument usuwa z cache.
 *
 * @param id - Dokument.
 * @returns Mutacja.
 */
export function useDeleteDocument(id: string): UseMutationResult<void, Error, void> {
  const accessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => documentsApi.deleteDocument(requireToken(accessToken), id),
    onSuccess: async () => {
      client.removeQueries({ queryKey: qk.document(id) });
      await client.invalidateQueries({ queryKey: qk.documentList() });
    },
  });
}

/** Obraz dokumentu jako adres `blob:`. */
export interface DocumentImage {
  readonly url: string | null;
  readonly failed: boolean;
}

/**
 * Pobiera obraz dokumentu z tokenem i zamienia na adres `blob:` (CSP dopuszcza `blob:`
 * w `img-src`). Adres jest zwalniany przy zmianie i odmontowaniu.
 *
 * @param id - Dokument.
 * @param variant - Oryginał albo miniatura.
 * @param enabled - Czy pobierać (PDF nie ma miniatury).
 * @returns Adres obrazu albo informacja o błędzie.
 */
export function useDocumentImage(
  id: string,
  variant: 'original' | 'thumb',
  enabled = true,
): DocumentImage {
  const accessToken = useAccessToken();
  const [state, setState] = useState<DocumentImage>({ url: null, failed: false });
  useEffect(() => {
    if (!enabled || accessToken === null) return undefined;
    let url: string | null = null;
    let cancelled = false;
    documentsApi
      .fetchDocumentFile(accessToken, id, variant)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ url, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, failed: true });
      });
    return () => {
      cancelled = true;
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [accessToken, id, variant, enabled]);
  return state;
}
