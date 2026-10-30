import { createHash } from 'node:crypto';

import {
  addDays,
  currentMonthKey,
  findDuplicates,
  monthKeyOf,
  shiftMonth,
  todayInTimezone,
  type AiUsageDto,
  type DocumentDto,
  type DocumentListItemDto,
  type DocumentQuery,
  type UpdateDocumentItemRequest,
  type UpdateDocumentRequest,
  type UploadDocumentFields,
  type UploadDocumentResponse,
} from '@fineapp/shared';
import type { Logger } from 'pino';

import { estimateCostMinor } from '../../ai/cost.js';
import {
  ExtractionError,
  type CategoryContextEntry,
  type DocumentExtractor,
  type ExtractionKind,
  type ExtractResult,
} from '../../ai/document-extractor.js';
import { prepareForVision } from '../../ai/prepare-for-vision.js';
import { CATEGORY_CONTEXT_LIMIT } from '../../ai/prompts/extraction-prompt.js';
import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import {
  AiBudgetExceededError,
  ConflictError,
  DomainRuleViolationError,
  ExternalServiceError,
  NotFoundError,
  UnsupportedMediaTypeError,
} from '../../core/errors.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import type { DocumentItemInsert, DocumentRow } from '../../db/schema/documents.js';
import { lookupAccount } from '../accounts/accounts.service.js';
import { getHousehold } from '../auth/auth.service.js';
import { listCategoriesFlat, lookupCategory } from '../categories/categories.service.js';
import { categoriesUsedSince, duplicateCandidates } from '../transactions/transactions.ledger.js';
import {
  normalizeUpload,
  readStoredFile,
  removeStoredFiles,
  sniffMediaType,
  storagePathFor,
  writeStoredFiles,
} from './documents.files.js';
import type { DocumentJobs } from './documents.jobs.js';
import {
  storedSummary,
  toDocumentDto,
  toDocumentListItemDto,
  type StoredSummary,
} from './documents.mapper.js';
import {
  addAiSpend,
  deleteDocumentRow,
  failStaleProcessing,
  findDocumentById,
  findDocumentBySha,
  findDocumentItems,
  findDocuments,
  insertDocument,
  patchDocument,
  patchDocumentItem,
  readAiSpend,
  replaceDocumentItems,
  sumAiUsage,
  transitionDocument,
} from './documents.repository.js';

/**
 * Serwis dokumentów i OCR ([08](../../../../../plans/08-ocr-ai-pipeline.md), `F7-1`…`F7-7`).
 *
 * **AI proponuje, człowiek zatwierdza.** Nic tutaj nie tworzy transakcji poza jawnym
 * commitem (`documents.commit.ts`). Analiza biegnie w tle po odpowiedzi `202`; jej wynik
 * to pozycje w `document_items` i nagłówek w `parsed_summary`.
 *
 * Każde wywołanie usługi AI — także nieudane, jeśli usługa zdążyła odpowiedzieć —
 * dolicza szacowany koszt do licznika miesiąca, który pilnuje `AI_MONTHLY_BUDGET_MINOR`.
 */

/** Zależności serwisu dokumentów. */
export interface DocumentsDeps {
  readonly db: DbHandle;
  readonly config: Config;
  readonly clock: Clock;
  /** `null`, gdy `AI_ENABLED=false` — pipeline wyłączony całkowicie (08 §9). */
  readonly extractor: DocumentExtractor | null;
  readonly jobs: DocumentJobs;
  readonly log: Pick<Logger, 'error' | 'warn' | 'info'>;
}

/** Komunikat dla dokumentu spoza gospodarstwa albo nieistniejącego — celowo ten sam. */
const NOT_FOUND = 'Nie znaleziono dokumentu.';

/** Co ile front ma pytać o wynik analizy (04 §13). */
export const POLL_AFTER_MS = 1500;

/** Dokument w stanie `processing` dłużej niż tyle przy starcie to przerwana analiza (08 §2). */
export const STALE_PROCESSING_MS = 10 * 60 * 1000;

/** Komunikat przy wyłączonym OCR (08 §14). */
const AI_DISABLED_MESSAGE = 'Odczyt dokumentów jest wyłączony. Dodaj wydatek ręcznie.';

/** Komunikat przy wyczerpanym limicie (08 §9). */
const BUDGET_MESSAGE =
  'Wyczerpano miesięczny limit OCR. Dodaj wydatek ręcznie albo zwiększ limit w ustawieniach.';

/**
 * Zwraca dokument gospodarstwa albo rzuca `404`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator dokumentu.
 * @returns Wiersz dokumentu.
 * @throws {NotFoundError} Gdy dokumentu nie ma w gospodarstwie.
 */
export function requireDocument(handle: DbHandle, householdId: string, id: string): DocumentRow {
  const row = findDocumentById(handle, householdId, id);
  if (row === undefined) throw new NotFoundError(NOT_FOUND);
  return row;
}

/**
 * Dokument z pozycjami jako DTO.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Wiersz dokumentu.
 * @returns DTO dokumentu.
 */
function documentDto(handle: DbHandle, row: DocumentRow): DocumentDto {
  return toDocumentDto(row, findDocumentItems(handle, row.id));
}

/**
 * Miesiąc limitu kosztów — bieżący w strefie gospodarstwa.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo.
 * @returns Klucz miesiąca.
 */
function budgetMonth(deps: DocumentsDeps, householdId: string): string {
  return currentMonthKey(getHousehold(deps.db, householdId).timezone, deps.clock.now());
}

/**
 * Sprawdza miesięczny limit kosztów OCR.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo.
 * @returns `true`, gdy limit jest wyczerpany (`0` = bez limitu).
 */
function budgetExhausted(deps: DocumentsDeps, householdId: string): boolean {
  const budget = deps.config.ai.monthlyBudgetMinor;
  if (budget === 0) return false;
  return readAiSpend(deps.db, budgetMonth(deps, householdId)) >= budget;
}

/**
 * Wymaga włączonego OCR.
 *
 * @param deps - Zależności.
 * @returns Ekstraktor.
 * @throws {ExternalServiceError} Gdy `AI_ENABLED=false`.
 */
function requireExtractor(deps: DocumentsDeps): DocumentExtractor {
  if (deps.extractor === null) throw new ExternalServiceError(AI_DISABLED_MESSAGE);
  return deps.extractor;
}

/**
 * Sprawdza konto wskazane przez klienta.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo.
 * @param accountId - Konto albo `null`.
 * @throws {NotFoundError} Gdy konto nie należy do gospodarstwa.
 * @throws {DomainRuleViolationError} Gdy konto jest zarchiwizowane.
 */
function assertAccount(handle: DbHandle, householdId: string, accountId: string | null): void {
  if (accountId === null) return;
  const account = lookupAccount(handle, householdId, accountId);
  if (account === undefined) {
    throw new NotFoundError('Nie znaleziono konta.', [
      { path: 'accountId', message: 'Nie ma takiego konta.' },
    ]);
  }
  if (account.isArchived) {
    throw new DomainRuleViolationError('Konto jest zarchiwizowane.', [
      { path: 'accountId', message: 'Konto jest zarchiwizowane.' },
    ]);
  }
}

/** Plik z żądania `multipart`. */
export interface UploadedFile {
  readonly bytes: Buffer;
  readonly filename: string;
}

/**
 * Przyjmuje dokument i uruchamia analizę w tle (`POST /documents`, `F7-1`).
 *
 * Kolejność ma znaczenie: tanie odrzucenia (wyłączone OCR, zły typ, duplikat, cudze
 * konto) przed pracą na obrazie, zapis pliku przed wierszem, limit kosztów po zapisie —
 * dokument ma zostać wrzucony, żeby dało się go przeanalizować po zmianie limitu (08 §9).
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor z tokenu.
 * @param file - Plik.
 * @param fields - Pola formularza.
 * @returns Identyfikator, status i podpowiedź odpytywania.
 * @throws {ExternalServiceError} Gdy OCR jest wyłączony.
 * @throws {UnsupportedMediaTypeError} Gdy zawartość nie jest obsługiwanym typem.
 * @throws {ConflictError} Gdy ten sam plik już jest (`details` z `existingDocumentId`).
 * @throws {AiBudgetExceededError} Gdy limit miesiąca jest wyczerpany (dokument zostaje).
 */
export async function uploadDocument(
  deps: DocumentsDeps,
  householdId: string,
  userId: string,
  file: UploadedFile,
  fields: UploadDocumentFields,
): Promise<UploadDocumentResponse> {
  const extractor = requireExtractor(deps);
  const mediaType = sniffMediaType(file.bytes.subarray(0, 16));
  if (mediaType === null) throw new UnsupportedMediaTypeError();

  const sha256 = createHash('sha256').update(file.bytes).digest('hex');
  const existing = findDocumentBySha(deps.db, householdId, sha256);
  if (existing !== undefined) {
    throw new ConflictError('Ten dokument już jest w systemie.', [
      { path: 'existingDocumentId', message: existing.id },
    ]);
  }
  assertAccount(deps.db, householdId, fields.accountId);

  const normalized = await normalizeUpload(file.bytes, mediaType);
  const household = getHousehold(deps.db, householdId);
  const now = deps.clock.now();
  const id = newId();
  const storagePath = storagePathFor(
    id,
    todayInTimezone(household.timezone, now),
    normalized.mimeType,
  );
  await writeStoredFiles(deps.config.uploads.dir, storagePath, normalized);

  try {
    insertDocument(deps.db, {
      id,
      householdId,
      kind: fields.kind,
      status: 'uploaded',
      // Nazwa od klienta służy tylko do wyświetlenia — nigdy jako ścieżka (09 §7).
      originalFilename: file.filename.slice(0, 200) || 'dokument',
      storagePath,
      mimeType: normalized.mimeType,
      byteSize: normalized.bytes.length,
      sha256,
      pageCount: normalized.pageCount,
      accountId: fields.accountId,
      detectedMonthKey: fields.monthHint,
      uploadedBy: userId,
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    });
  } catch (error) {
    // Dwa równoległe wrzucenia tego samego pliku: drugi przegrywa na unikalnym skrócie.
    await removeStoredFiles(deps.config.uploads.dir, storagePath);
    const winner = findDocumentBySha(deps.db, householdId, sha256);
    if (winner !== undefined) {
      throw new ConflictError('Ten dokument już jest w systemie.', [
        { path: 'existingDocumentId', message: winner.id },
      ]);
    }
    throw error;
  }

  if (budgetExhausted(deps, householdId)) {
    patchDocument(deps.db, householdId, id, {
      status: 'failed',
      errorCode: 'AI_BUDGET_EXCEEDED',
      errorMessage: BUDGET_MESSAGE,
      updatedAt: now.getTime(),
    });
    throw new AiBudgetExceededError(BUDGET_MESSAGE, [{ path: 'documentId', message: id }]);
  }

  startAnalysis(deps, extractor, householdId, id, ['uploaded']);
  return { id, status: 'processing', pollAfterMs: POLL_AFTER_MS };
}

/**
 * Ponawia analizę (`POST /documents/:id/analyze`) — np. po dodaniu kategorii.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator dokumentu.
 * @returns Status i podpowiedź odpytywania.
 * @throws {ConflictError} Gdy dokument jest analizowany, zatwierdzony albo odrzucony.
 * @throws {AiBudgetExceededError} Gdy limit miesiąca jest wyczerpany.
 */
export function reanalyzeDocument(
  deps: DocumentsDeps,
  householdId: string,
  id: string,
): UploadDocumentResponse {
  const extractor = requireExtractor(deps);
  requireDocument(deps.db, householdId, id);
  if (budgetExhausted(deps, householdId)) throw new AiBudgetExceededError(BUDGET_MESSAGE);
  startAnalysis(deps, extractor, householdId, id, ['uploaded', 'parsed', 'failed']);
  return { id, status: 'processing', pollAfterMs: POLL_AFTER_MS };
}

/**
 * Przełącza dokument w `processing` i planuje analizę.
 *
 * @param deps - Zależności.
 * @param extractor - Ekstraktor.
 * @param householdId - Gospodarstwo.
 * @param id - Identyfikator dokumentu.
 * @param from - Statusy, z których wolno zacząć.
 * @throws {ConflictError} Gdy dokument jest w innym statusie.
 */
function startAnalysis(
  deps: DocumentsDeps,
  extractor: DocumentExtractor,
  householdId: string,
  id: string,
  from: readonly DocumentRow['status'][],
): void {
  const started = transitionDocument(deps.db, householdId, id, from, {
    status: 'processing',
    errorCode: null,
    errorMessage: null,
    updatedAt: deps.clock.now().getTime(),
  });
  if (started === undefined) {
    throw new ConflictError('Tego dokumentu nie można teraz analizować.');
  }
  deps.jobs.schedule(() => analyzeDocument(deps, extractor, householdId, id));
}

/**
 * Buduje kontekst kategorii dla modelu (08 §4, `F7-4`).
 *
 * Wszystkie niezarchiwizowane kategorie ze ścieżką `Rodzic > Dziecko` i podpowiedziami.
 * Paragon widzi tylko wydatkowe; wyciąg — wydatkowe i przychodowe (uznania). Przy ponad
 * 120 kategoriach zostają używane w ostatnich 6 miesiącach i systemowe.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo.
 * @param kind - Rodzaj odczytu.
 * @param today - Dzisiejsza data w strefie gospodarstwa.
 * @returns Kategorie dla modelu.
 */
export function buildCategoryContext(
  handle: DbHandle,
  householdId: string,
  kind: ExtractionKind,
  today: string,
): CategoryContextEntry[] {
  const all = listCategoriesFlat(handle, householdId, { includeArchived: false });
  const names = new Map(all.map((category) => [category.id, category.name]));
  const wanted = all.filter(
    (category) =>
      category.kind === 'expense' || (kind === 'bank_statement' && category.kind === 'income'),
  );
  let visible = wanted;
  if (wanted.length > CATEGORY_CONTEXT_LIMIT) {
    const used = categoriesUsedSince(
      handle,
      householdId,
      `${shiftMonth(today.slice(0, 7), -6)}-01`,
    );
    visible = wanted.filter((category) => category.isSystem || used.has(category.id));
  }
  return visible.map((category) => {
    const parent = category.parentId === null ? undefined : names.get(category.parentId);
    return {
      id: category.id,
      path: parent === undefined ? category.name : `${parent} > ${category.name}`,
      kind: category.kind === 'income' ? 'income' : 'expense',
      hints: category.aiHints,
    };
  });
}

/**
 * Pozycje do zapisu z wyniku ekstrakcji — z duplikatami dla wyciągu (08 §10, `F7-5`).
 *
 * Duplikat jest **domyślnie odznaczony** (`rejected`), ale zostaje na liście z plakietką:
 * automatyczne pominięcie ukryłoby realne, powtarzające się płatności.
 *
 * @param deps - Zależności.
 * @param row - Dokument.
 * @param result - Wynik ekstrakcji.
 * @returns Wiersze pozycji.
 */
function itemRows(
  deps: DocumentsDeps,
  row: DocumentRow,
  result: ExtractResult,
): DocumentItemInsert[] {
  const now = deps.clock.now().getTime();
  let duplicates: (string | null)[] = result.items.map(() => null);
  if (row.kind === 'bank_statement') {
    const dates = result.items
      .map((item) => item.bookedOn)
      .filter((date): date is string => date !== null)
      .sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (first !== undefined && last !== undefined) {
      const candidates = duplicateCandidates(
        deps.db,
        row.householdId,
        addDays(first, -3),
        addDays(last, 3),
        result.items.map((item) => item.amountMinor),
      );
      duplicates = findDuplicates(result.items, candidates, row.accountId);
    }
  }
  return result.items.map((item, index) => ({
    id: newId(),
    documentId: row.id,
    lineNo: index + 1,
    rawText: item.counterparty,
    description: item.description,
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    amountMinor: item.amountMinor,
    direction: item.direction,
    bookedOn: item.bookedOn,
    suggestedCategoryId: item.categoryId,
    suggestedCategoryName: item.suggestedCategoryName,
    confidence: item.confidence,
    reviewStatus: duplicates[index] === null ? 'pending' : 'rejected',
    duplicateOfTransactionId: duplicates[index] ?? null,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Analiza dokumentu w tle: plik → model → pozycje (08 §2, kroki 2–5).
 *
 * Zapis wyniku idzie przez `transitionDocument` z warunkiem `processing` — jeśli ktoś
 * w międzyczasie usunął dokument, wynik przepada zamiast wskrzeszać wiersz.
 *
 * @param deps - Zależności.
 * @param extractor - Ekstraktor.
 * @param householdId - Gospodarstwo.
 * @param id - Identyfikator dokumentu.
 */
async function analyzeDocument(
  deps: DocumentsDeps,
  extractor: DocumentExtractor,
  householdId: string,
  id: string,
): Promise<void> {
  const row = findDocumentById(deps.db, householdId, id);
  if (row?.status !== 'processing') return;
  const household = getHousehold(deps.db, householdId);
  const today = todayInTimezone(household.timezone, deps.clock.now());
  const kind: ExtractionKind = row.kind === 'bank_statement' ? 'bank_statement' : 'receipt';
  const month = budgetMonth(deps, householdId);

  try {
    const bytes = await readStoredFile(deps.config.uploads.dir, row.storagePath);
    const result = await extractor.extract({
      kind,
      parts: await prepareForVision(bytes, row.mimeType),
      categories: buildCategoryContext(deps.db, householdId, kind, today),
      timezone: household.timezone,
      currency: household.baseCurrency,
    });
    const costMinor = estimateCostMinor(result.usage, deps.config.ai);
    const now = deps.clock.now().getTime();
    const summary: StoredSummary = { ...result.header };
    const detectedMonthKey =
      result.header.bookedOn === null
        ? row.detectedMonthKey
        : monthKeyOf(result.header.bookedOn, household.monthStartDay);

    deps.db.sqlite.transaction(() => {
      const saved = transitionDocument(deps.db, householdId, id, ['processing'], {
        status: 'parsed',
        aiProvider: result.provider,
        aiModel: result.model,
        aiRequestId: result.requestId,
        aiInputTokens: result.usage.inputTokens,
        aiOutputTokens: result.usage.outputTokens,
        aiCostMinor: costMinor,
        aiRawResponse: result.rawResponse,
        parsedSummary: JSON.stringify(summary),
        detectedMonthKey,
        errorCode: null,
        errorMessage: null,
        processedAt: now,
        updatedAt: now,
      });
      if (saved !== undefined) replaceDocumentItems(deps.db, id, itemRows(deps, saved, result));
      addAiSpend(deps.db, month, costMinor, now);
    })();
  } catch (error) {
    const now = deps.clock.now().getTime();
    const extraction = error instanceof ExtractionError ? error : null;
    const usage = extraction?.details.usage;
    const costMinor = usage === undefined ? 0 : estimateCostMinor(usage, deps.config.ai);
    if (extraction === null) {
      deps.log.error({ err: error, documentId: id }, 'Analiza dokumentu nie powiodła się');
    } else {
      // Bez treści odpowiedzi — surowa odpowiedź jest w bazie, log nie ma danych finansowych.
      deps.log.warn({ documentId: id, code: extraction.code }, 'Odczyt dokumentu odrzucony');
    }
    deps.db.sqlite.transaction(() => {
      transitionDocument(deps.db, householdId, id, ['processing'], {
        status: 'failed',
        errorCode: extraction?.code ?? 'INTERNAL_ERROR',
        errorMessage: extraction?.message ?? 'Nie udało się odczytać dokumentu. Spróbuj ponownie.',
        aiRawResponse: extraction?.details.rawResponse ?? null,
        aiRequestId: extraction?.details.requestId ?? null,
        aiInputTokens: usage?.inputTokens ?? null,
        aiOutputTokens: usage?.outputTokens ?? null,
        aiCostMinor: usage === undefined ? null : costMinor,
        aiModel: usage === undefined ? null : extractor.model,
        aiProvider: usage === undefined ? null : extractor.provider,
        processedAt: usage === undefined ? null : now,
        updatedAt: now,
      });
      if (costMinor > 0) addAiSpend(deps.db, month, costMinor, now);
    })();
  }
}

/**
 * Oznacza przerwane analizy jako nieudane — wołane przy starcie (08 §2).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @returns Liczba oznaczonych dokumentów.
 */
export function failInterruptedDocuments(handle: DbHandle, clock: Clock): number {
  const now = clock.now().getTime();
  return failStaleProcessing(handle, now - STALE_PROCESSING_MS, now);
}

/**
 * Dokument ze stanem analizy i pozycjami.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator dokumentu.
 * @returns DTO dokumentu.
 */
export function getDocument(handle: DbHandle, householdId: string, id: string): DocumentDto {
  return documentDto(handle, requireDocument(handle, householdId, id));
}

/**
 * Lista dokumentów od najnowszych.
 *
 * `month` filtruje po miesiącu dokumentu (z daty odczytanej z paragonu albo podpowiedzi
 * przy wrzuceniu), nie po dniu wrzucenia — paragon z sierpnia wrzucony we wrześniu
 * należy do sierpnia.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Filtry.
 * @returns Wiersze listy.
 */
export function listDocuments(
  handle: DbHandle,
  householdId: string,
  query: DocumentQuery,
): DocumentListItemDto[] {
  return findDocuments(handle, householdId, {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.month === undefined ? {} : { monthKey: query.month }),
    limit: query.limit,
  }).map(toDocumentListItemDto);
}

/**
 * Wymaga dokumentu po analizie — korekty mają sens tylko na odczytanych danych.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo.
 * @param id - Identyfikator dokumentu.
 * @returns Wiersz dokumentu.
 * @throws {ConflictError} Gdy dokument nie jest w stanie `parsed`.
 */
function requireParsed(handle: DbHandle, householdId: string, id: string): DocumentRow {
  const row = requireDocument(handle, householdId, id);
  if (row.status !== 'parsed') {
    throw new ConflictError(
      row.status === 'committed'
        ? 'Dokument jest już zatwierdzony.'
        : 'Dokument nie jest gotowy do przeglądu.',
    );
  }
  return row;
}

/**
 * Korekta nagłówka (`PATCH /documents/:id`).
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator dokumentu.
 * @param input - Zmiany.
 * @returns Dokument po zmianie.
 */
export function updateDocument(
  deps: Pick<DocumentsDeps, 'db' | 'clock'>,
  householdId: string,
  id: string,
  input: UpdateDocumentRequest,
): DocumentDto {
  const { db } = deps;
  const row = db.sqlite.transaction(() => {
    const current = requireParsed(db, householdId, id);
    if (input.accountId !== undefined) assertAccount(db, householdId, input.accountId);
    const summary = storedSummary(current);
    const nextSummary: StoredSummary | null =
      summary === null
        ? null
        : {
            ...summary,
            ...(input.merchant === undefined ? {} : { merchant: input.merchant || null }),
            ...(input.bookedOn === undefined ? {} : { bookedOn: input.bookedOn }),
          };
    const monthStartDay = getHousehold(db, householdId).monthStartDay;
    return patchDocument(db, householdId, id, {
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
      ...(nextSummary === null ? {} : { parsedSummary: JSON.stringify(nextSummary) }),
      ...(input.bookedOn ? { detectedMonthKey: monthKeyOf(input.bookedOn, monthStartDay) } : {}),
      updatedAt: deps.clock.now().getTime(),
    });
  })();
  if (row === undefined) throw new NotFoundError(NOT_FOUND);
  return documentDto(db, row);
}

/**
 * Korekta pozycji (`PATCH /documents/:id/items/:itemId`).
 *
 * Kategoria musi pasować do kierunku pozycji: obciążenie — kategoria wydatku, uznanie —
 * przychodu (I-4 w chwili commitu `split`).
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator dokumentu.
 * @param itemId - Identyfikator pozycji.
 * @param input - Zmiany.
 * @returns Dokument po zmianie.
 * @throws {NotFoundError} Gdy pozycji albo kategorii nie ma.
 * @throws {DomainRuleViolationError} Gdy kategoria jest zarchiwizowana albo innego rodzaju.
 */
export function updateDocumentItem(
  deps: Pick<DocumentsDeps, 'db' | 'clock'>,
  householdId: string,
  id: string,
  itemId: string,
  input: UpdateDocumentItemRequest,
): DocumentDto {
  const { db } = deps;
  return db.sqlite.transaction(() => {
    const row = requireParsed(db, householdId, id);
    const item = findDocumentItems(db, id).find((candidate) => candidate.id === itemId);
    if (item === undefined) throw new NotFoundError('Nie znaleziono pozycji dokumentu.');
    const direction = input.direction ?? item.direction;
    const categoryId =
      input.suggestedCategoryId === undefined
        ? item.suggestedCategoryId
        : input.suggestedCategoryId;
    if (categoryId !== null) {
      const category = lookupCategory(db, householdId, categoryId);
      if (category === undefined) {
        throw new NotFoundError('Nie znaleziono kategorii.', [
          { path: 'suggestedCategoryId', message: 'Nie ma takiej kategorii.' },
        ]);
      }
      if (category.isArchived) {
        throw new DomainRuleViolationError('Kategoria jest zarchiwizowana.', [
          { path: 'suggestedCategoryId', message: 'Kategoria jest zarchiwizowana.' },
        ]);
      }
      const expected = direction === 'inflow' ? 'income' : 'expense';
      if (category.kind !== expected) {
        throw new DomainRuleViolationError(
          direction === 'inflow'
            ? 'Uznanie wymaga kategorii przychodu.'
            : 'Obciążenie wymaga kategorii wydatku.',
          [{ path: 'suggestedCategoryId', message: 'Kategoria innego rodzaju.' }],
        );
      }
    }
    patchDocumentItem(db, id, itemId, {
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.amountMinor === undefined ? {} : { amountMinor: input.amountMinor }),
      ...(input.direction === undefined ? {} : { direction: input.direction }),
      ...(input.bookedOn === undefined ? {} : { bookedOn: input.bookedOn }),
      ...(input.reviewStatus === undefined ? {} : { reviewStatus: input.reviewStatus }),
      ...(input.suggestedCategoryId === undefined
        ? {}
        : {
            suggestedCategoryId: input.suggestedCategoryId,
            // Wybór istniejącej kategorii kończy propozycję nowej.
            ...(input.suggestedCategoryId === null ? {} : { suggestedCategoryName: null }),
          }),
      updatedAt: deps.clock.now().getTime(),
    });
    return documentDto(db, row);
  })();
}

/**
 * Odrzuca dokument w całości (`POST /documents/:id/discard`).
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator dokumentu.
 * @returns Dokument po zmianie.
 * @throws {ConflictError} Gdy dokument jest analizowany albo zatwierdzony.
 */
export function discardDocument(
  deps: Pick<DocumentsDeps, 'db' | 'clock'>,
  householdId: string,
  id: string,
): DocumentDto {
  const { db } = deps;
  return db.sqlite.transaction(() => {
    requireDocument(db, householdId, id);
    const now = deps.clock.now().getTime();
    const row = transitionDocument(
      db,
      householdId,
      id,
      ['uploaded', 'parsed', 'failed', 'discarded'],
      {
        status: 'discarded',
        updatedAt: now,
      },
    );
    if (row === undefined) throw new ConflictError('Tego dokumentu nie można odrzucić.');
    for (const item of findDocumentItems(db, id)) {
      if (item.reviewStatus === 'pending') {
        patchDocumentItem(db, id, item.id, { reviewStatus: 'rejected', updatedAt: now });
      }
    }
    return documentDto(db, row);
  })();
}

/**
 * Usuwa dokument z plikiem i miniaturą (`DELETE /documents/:id`).
 *
 * Transakcje z zatwierdzonego dokumentu zostają — tracą tylko odnośnik do zdjęcia
 * (`ON DELETE SET NULL`). Analizowanego dokumentu nie usuwamy: wynik wróciłby do
 * nieistniejącego wiersza.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator dokumentu.
 * @throws {ConflictError} Gdy trwa analiza.
 */
export async function deleteDocument(
  deps: Pick<DocumentsDeps, 'db' | 'config'>,
  householdId: string,
  id: string,
): Promise<void> {
  const row = requireDocument(deps.db, householdId, id);
  if (row.status === 'processing') {
    throw new ConflictError('Dokument jest właśnie analizowany. Spróbuj za chwilę.');
  }
  deleteDocumentRow(deps.db, householdId, id);
  await removeStoredFiles(deps.config.uploads.dir, row.storagePath);
}

/** Plik dokumentu do wysłania. */
export interface DocumentFile {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly filename: string;
}

/**
 * Oryginał albo miniatura (`GET /documents/:id/file`).
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Identyfikator dokumentu.
 * @param variant - `original` albo `thumb`.
 * @returns Zawartość i typ.
 * @throws {NotFoundError} Gdy dokumentu albo pliku nie ma (PDF nie ma miniatury).
 */
export async function getDocumentFile(
  deps: Pick<DocumentsDeps, 'db' | 'config'>,
  householdId: string,
  id: string,
  variant: 'original' | 'thumb',
): Promise<DocumentFile> {
  const row = requireDocument(deps.db, householdId, id);
  if (variant === 'thumb' && row.mimeType === 'application/pdf') {
    throw new NotFoundError('PDF nie ma miniatury.');
  }
  try {
    const bytes = await readStoredFile(deps.config.uploads.dir, row.storagePath, variant);
    return {
      bytes,
      mimeType: variant === 'thumb' ? 'image/jpeg' : row.mimeType,
      filename: row.mimeType === 'application/pdf' ? `${row.id}.pdf` : `${row.id}.jpg`,
    };
  } catch {
    throw new NotFoundError('Plik dokumentu nie istnieje.');
  }
}

/**
 * Zużycie OCR w bieżącym miesiącu (`GET /settings/ai-usage`, `F7-7`).
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Zużycie, koszt i limit.
 */
export function getAiUsage(
  deps: Pick<DocumentsDeps, 'db' | 'config' | 'clock'>,
  householdId: string,
): AiUsageDto {
  const household = getHousehold(deps.db, householdId);
  const now = deps.clock.now();
  const monthKey = currentMonthKey(household.timezone, now);
  const spentMinor = readAiSpend(deps.db, monthKey);
  const budgetMinor = deps.config.ai.monthlyBudgetMinor;
  // Granice miesiąca w UTC ±1 dzień byłyby nieprecyzyjne — liczymy dokumenty po
  // miesiącu przetworzenia w strefie gospodarstwa przez zakres epoch ms tego miesiąca.
  const range = monthEpochRange(monthKey, household.timezone);
  return {
    enabled: deps.config.ai.enabled,
    model: deps.config.ai.model,
    monthKey,
    ...sumAiUsage(deps.db, householdId, range.from, range.to),
    spentMinor,
    budgetMinor,
    remainingMinor: budgetMinor === 0 ? null : Math.max(0, budgetMinor - spentMinor),
  };
}

/**
 * Zakres chwil (epoch ms) miesiąca w strefie gospodarstwa.
 *
 * Północ w strefie wyznaczamy przesunięciem strefy w tej chwili — `Intl` podaje godzinę
 * „ściennego zegara", różnica od UTC to przesunięcie (także przy czasie letnim).
 *
 * @param monthKey - Miesiąc `YYYY-MM`.
 * @param timezone - Strefa IANA.
 * @returns Początek (włącznie) i koniec (wyłącznie).
 */
export function monthEpochRange(monthKey: string, timezone: string): { from: number; to: number } {
  const midnight = (dateOnly: string): number => {
    const utc = Date.parse(`${dateOnly}T00:00:00Z`);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(utc));
    const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
    const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    return utc - (wall - utc);
  };
  return { from: midnight(`${monthKey}-01`), to: midnight(`${shiftMonth(monthKey, 1)}-01`) };
}
