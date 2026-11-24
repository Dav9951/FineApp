import {
  findMergeTarget,
  formatShoppingQuantity,
  isAlreadyHave,
  NEEDS_REVIEW_BELOW_BPS,
  normalizeShoppingName,
  recipePurchase,
  todayInTimezone,
  type CommitShoppingImportResult,
  type ShoppingImportDto,
  type ShoppingImportItemDto,
  type UpdateShoppingImportItemRequest,
  type UpdateShoppingImportRequest,
} from '@fineapp/shared';
import type { FastifyBaseLogger } from 'fastify';

import { estimateCostMinor } from '../../ai/cost.js';
import { ExtractionError, type PreparedPart } from '../../ai/document-extractor.js';
import { errorDiagnostics } from '../../ai/diagnostics.js';
import { prepareForVision } from '../../ai/prepare-for-vision.js';
import type { ShoppingExtractor } from '../../ai/shopping-extractor.js';
import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import {
  AiBudgetExceededError,
  ConflictError,
  ExternalServiceError,
  NotFoundError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '../../core/errors.js';
import { newId } from '../../core/id.js';
import { safeFetchHtml, SafeFetchError } from '../../core/safe-fetch.js';
import type { DbHandle } from '../../db/client.js';
import type {
  ShoppingImportItemInsert,
  ShoppingImportItemRow,
  ShoppingImportRow,
} from '../../db/schema/shopping.js';
import { getHousehold } from '../auth/auth.service.js';
import {
  aiBudgetExhausted,
  householdAiModel,
  recordAiSpend,
  writeShoppingAiLog,
  type ShoppingAiLogEntry,
} from '../documents/documents.external.js';
import {
  normalizeUpload,
  readStoredFile,
  sniffMediaType,
  writeStoredFiles,
} from '../documents/documents.files.js';
import type { DocumentJobs } from '../documents/documents.jobs.js';
import { parseImportFilePaths } from './shopping.files.js';
import { recipeSourceFromHtml } from './shopping.recipe-source.js';
import {
  failAllProcessingImports,
  findImport,
  findImportItems,
  findList,
  findProductsByNames,
  findStapleProducts,
  findVisibleItems,
  insertImport,
  patchImportItem,
  replaceImportItems,
  touchList,
  transitionImport,
} from './shopping.repository.js';
import { addItemToList, requireEditableList } from './shopping.service.js';

/**
 * Importy list zakupów przez AI — zdjęcie listy i przepis
 * ([08 §17](../../../../../../plans/08-ocr-ai-pipeline.md#17-listy-zakupów-zdjęcie-listy-i-przepis),
 * `F10-8`, `F10-9`, ADR-094, ADR-095).
 *
 * **AI proponuje, człowiek zatwierdza** (08 §1): odczyt kończy się propozycjami
 * w `shopping_import_items`, a na listę trafiają wyłącznie przez commit (I-30). Analiza
 * biegnie w tle po odpowiedzi `202`, jak przy dokumentach. Koszt idzie do wspólnego
 * licznika miesiąca, model — z ustawień gospodarstwa.
 *
 * Pliki: `UPLOAD_DIR/shopping/RRRR/MM/<id>-<n>.jpg`, bez EXIF, usuwane po commit i discard
 * (wołający usuwa po zatwierdzeniu transakcji), najpóźniej po 7 dniach (I-31).
 */

/** Zależności importów. */
export interface ShoppingImportsDeps {
  readonly db: DbHandle;
  readonly config: Config;
  readonly clock: Clock;
  /** `null`, gdy `AI_ENABLED=false`. */
  readonly extractor: ShoppingExtractor | null;
  readonly jobs: DocumentJobs;
  readonly log: Pick<FastifyBaseLogger, 'warn' | 'error'>;
  /** Pobranie strony przepisu — podmieniane w testach (bez sieci). */
  readonly fetchHtml?: (url: string) => Promise<{ url: string; html: string }>;
}

/** Plik obrazu z formularza. */
export interface ImportImage {
  readonly bytes: Buffer;
}

/** Najwięcej obrazów w jednym imporcie (przepis na kilku ekranach, 06 §3.15). */
export const MAX_IMPORT_IMAGES = 3;

const NOT_FOUND = 'Nie znaleziono odczytu.';

/** Krócej nie ma czego czytać — nawet „2 jajka, mąka" ma kilkanaście znaków. */
const MIN_RECIPE_TEXT = 10;
const AI_DISABLED_MESSAGE = 'Odczyt przez AI jest wyłączony.';
const BUDGET_MESSAGE =
  'Wyczerpano miesięczny limit odczytów AI. Dopisz produkty ręcznie albo zwiększ limit w ustawieniach.';

/** Komunikaty dla kodów błędu importu — po polsku, z drogą dalej (06 §3.15). */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  RECIPE_FETCH_BLOCKED:
    'Tego adresu nie da się pobrać. Wklej treść przepisu albo zrób zrzut ekranu.',
  RECIPE_FETCH_FAILED: 'Nie udało się pobrać przepisu. Wklej jego treść albo zrób zrzut ekranu.',
  RECIPE_NOT_FOUND: 'Nie znalazłem składników. Sprawdź, czy to przepis, albo wklej jego treść.',
  AI_BUDGET_EXCEEDED: BUDGET_MESSAGE,
  AI_OUTPUT_TRUNCATED: 'Za dużo do odczytu naraz. Podziel przepis albo zdjęcie na mniejsze.',
  INTERRUPTED: 'Odczyt przerwany — spróbuj ponownie.',
};

/**
 * Komunikat dla kodu błędu importu.
 *
 * @param code - Kod z `shopping_imports.error_code`.
 * @returns Komunikat albo `null`.
 */
export function importErrorMessage(code: string | null): string | null {
  if (code === null) return null;
  return ERROR_MESSAGES[code] ?? 'Nie udało się odczytać. Spróbuj ponownie.';
}

/**
 * Wymaga włączonego AI.
 *
 * @param deps - Zależności.
 * @returns Ekstraktor.
 * @throws {ExternalServiceError} Gdy `AI_ENABLED=false`.
 */
function requireExtractor(deps: ShoppingImportsDeps): ShoppingExtractor {
  if (deps.extractor === null) throw new ExternalServiceError(AI_DISABLED_MESSAGE);
  return deps.extractor;
}

/**
 * Import gospodarstwa albo 404.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Import.
 * @returns Wiersz importu.
 * @throws {NotFoundError} Gdy importu nie ma w gospodarstwie.
 */
function requireImport(handle: DbHandle, householdId: string, id: string): ShoppingImportRow {
  const row = findImport(handle, householdId, id);
  if (!row) throw new NotFoundError(NOT_FOUND);
  return row;
}

/**
 * Sprawdza limit i — gdy wyczerpany — zapisuje import jako nieudany i rzuca `402`.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo.
 * @param id - Import.
 * @throws {AiBudgetExceededError} Gdy limit wyczerpany (import zostaje, da się go ponowić).
 */
function assertBudget(deps: ShoppingImportsDeps, householdId: string, id: string): void {
  const { month } = householdAiModel(deps.db, deps.config.ai, deps.clock, householdId);
  if (!aiBudgetExhausted(deps.db, deps.config.ai, month)) return;
  const row = transitionImport(deps.db, householdId, id, ['processing'], {
    status: 'failed',
    errorCode: 'AI_BUDGET_EXCEEDED',
    updatedAt: deps.clock.now().getTime(),
  });
  if (row !== undefined) {
    logImport(deps, householdId, row, {
      level: 'warn',
      event: 'upload_rejected',
      message: FAILURE_EXPLANATION.AI_BUDGET_EXCEEDED ?? 'AI_BUDGET_EXCEEDED',
      details: { errorCode: 'AI_BUDGET_EXCEEDED', budgetMinor: deps.config.ai.monthlyBudgetMinor },
    });
  }
  throw new AiBudgetExceededError(BUDGET_MESSAGE, [{ path: 'importId', message: id }]);
}

/**
 * Przyjmuje zdjęcia (lista albo przepis) i uruchamia odczyt w tle.
 *
 * Każdy obraz przechodzi przez tę samą normalizację co paragony: typ po zawartości, obrót
 * z EXIF, JPEG bez metadanych (GPS!). PDF nie jest przyjmowany.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor z tokenu.
 * @param input - Lista, rodzaj, mnożnik, obrazy.
 * @param input.listId - Lista docelowa.
 * @param input.kind - Zdjęcie listy albo przepis.
 * @param input.servingsFactorBps - Mnożnik (przepis).
 * @param input.images - 1…3 obrazy.
 * @returns Import w stanie `processing`.
 */
export async function createImageImport(
  deps: ShoppingImportsDeps,
  householdId: string,
  userId: string,
  input: {
    listId: string;
    kind: 'list_photo' | 'recipe';
    servingsFactorBps: number | null;
    images: readonly ImportImage[];
  },
): Promise<ShoppingImportDto> {
  requireExtractor(deps);
  requireEditableList(deps.db, householdId, input.listId);
  if (input.images.length === 0 || input.images.length > MAX_IMPORT_IMAGES) {
    throw new ValidationError(`Dodaj od 1 do ${String(MAX_IMPORT_IMAGES)} zdjęć.`, [
      { path: 'image', message: 'Liczba zdjęć' },
    ]);
  }
  const normalized = [];
  for (const image of input.images) {
    const mediaType = sniffMediaType(image.bytes.subarray(0, 16));
    if (mediaType === null || mediaType === 'application/pdf') {
      throw new UnsupportedMediaTypeError('Obsługujemy zdjęcia (JPG, PNG, WebP, HEIC).');
    }
    normalized.push(await normalizeUpload(image.bytes, mediaType));
  }

  const now = deps.clock.now();
  const id = newId();
  // Katalog z dnia w strefie gospodarstwa (zasada 3 z CONTRIBUTING), jak przy dokumentach.
  const day = todayInTimezone(getHousehold(deps.db, householdId).timezone, now);
  const paths = normalized.map(
    (_, index) => `shopping/${day.slice(0, 4)}/${day.slice(5, 7)}/${id}-${String(index + 1)}.jpg`,
  );
  for (const [index, file] of normalized.entries()) {
    await writeStoredFiles(deps.config.uploads.dir, paths[index] as string, file);
  }
  insertImport(deps.db, {
    id,
    householdId,
    listId: input.listId,
    kind: input.kind,
    input: 'image',
    status: 'processing',
    filePaths: JSON.stringify(paths),
    servingsFactorBps: input.kind === 'recipe' ? (input.servingsFactorBps ?? 10_000) : null,
    createdBy: userId,
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
  });
  assertBudget(deps, householdId, id);
  deps.jobs.schedule(() => analyzeImport(deps, householdId, id));
  return getImport(deps.db, householdId, id);
}

/**
 * Przyjmuje przepis z linku albo wklejony tekst i uruchamia odczyt w tle. Strona jest
 * pobierana w tle (09 §7a), więc zły link kończy się importem `failed`, a nie błędem
 * żądania.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor z tokenu.
 * @param input - Lista, mnożnik, link albo tekst.
 * @param input.listId - Lista docelowa.
 * @param input.servingsFactorBps - Mnożnik.
 * @param input.url - Link (gdy `input='url'`).
 * @param input.text - Tekst (gdy `input='text'`).
 * @returns Import w stanie `processing`.
 */
export function createTextImport(
  deps: ShoppingImportsDeps,
  householdId: string,
  userId: string,
  input: { listId: string; servingsFactorBps: number; url?: string; text?: string },
): ShoppingImportDto {
  requireExtractor(deps);
  requireEditableList(deps.db, householdId, input.listId);
  const now = deps.clock.now().getTime();
  const id = newId();
  insertImport(deps.db, {
    id,
    householdId,
    listId: input.listId,
    kind: 'recipe',
    input: input.url === undefined ? 'text' : 'url',
    status: 'processing',
    sourceUrl: input.url ?? null,
    sourceText: input.text ?? null,
    servingsFactorBps: input.servingsFactorBps,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  assertBudget(deps, householdId, id);
  deps.jobs.schedule(() => analyzeImport(deps, householdId, id));
  return getImport(deps.db, householdId, id);
}

/**
 * Obrazy importu przygotowane do wysłania (skalowanie, bez EXIF).
 *
 * @param deps - Zależności.
 * @param row - Import.
 * @returns Części dla modelu.
 */
async function preparedImages(
  deps: ShoppingImportsDeps,
  row: ShoppingImportRow,
): Promise<PreparedPart[]> {
  const parts: PreparedPart[] = [];
  for (const path of parseImportFilePaths(row.filePaths)) {
    const bytes = await readStoredFile(deps.config.uploads.dir, path);
    parts.push(...(await prepareForVision(bytes, 'image/jpeg')));
  }
  return parts;
}

/**
 * Wiersze propozycji z odczytu — „Już mam" z flagi produktu albo oceny modelu (07 §14.5),
 * ilości z przepisu przeliczone na opakowania (07 §14.2), scalenie z listą (07 §14.3).
 *
 * @param deps - Zależności.
 * @param row - Import.
 * @param proposals - Propozycje w kształcie wspólnym dla obu rodzajów.
 * @param now - Znacznik systemowy.
 * @returns Wiersze do zapisu.
 */
function proposalRows(
  deps: ShoppingImportsDeps,
  row: ShoppingImportRow,
  proposals: readonly Omit<
    ShoppingImportItemInsert,
    'id' | 'householdId' | 'importId' | 'sortOrder' | 'createdAt' | 'updatedAt'
  >[],
  now: number,
): ShoppingImportItemInsert[] {
  const products = new Map(
    findProductsByNames(
      deps.db,
      row.householdId,
      proposals.map((proposal) => normalizeShoppingName(proposal.name)),
    ).map((product) => [product.normalizedName, product]),
  );
  const listItems = findVisibleItems(deps.db, row.householdId, row.listId).map((item) => ({
    ...item,
    checked: item.checkedAt !== null,
  }));
  return proposals.map((proposal, index) => {
    const product = products.get(normalizeShoppingName(proposal.name)) ?? null;
    const alreadyHave =
      row.kind === 'recipe' && isAlreadyHave(product, proposal.pantryStaple ?? false);
    const target = findMergeTarget(
      listItems,
      normalizeShoppingName(proposal.name),
      proposal.unit ?? null,
    );
    return {
      ...proposal,
      id: newId(),
      householdId: row.householdId,
      importId: row.id,
      sortOrder: index,
      // Dział ze słownika wygrywa ze zgadywaniem modelu (07 §14.5) — inaczej zatwierdzenie
      // nadpisałoby dział, którego słownik się nauczył (ADR-102).
      section: product?.section ?? proposal.section,
      alreadyHave,
      selected: !alreadyHave,
      mergeIntoItemId: target?.id ?? null,
      createdAt: now,
      updatedAt: now,
    };
  });
}

/**
 * Ilość do kupienia składnika przy mnożniku (07 §14.2).
 *
 * @param item - Dane bazowe składnika.
 * @param item.baseAmountMilli - Ilość bazowa.
 * @param item.baseUnit - Jednostka bazowa.
 * @param item.packageAmountMilli - Opakowanie.
 * @param factorBps - Mnożnik.
 * @returns Ilość i jednostka.
 */
function purchaseFor(
  item: Pick<ShoppingImportItemRow, 'baseAmountMilli' | 'baseUnit' | 'packageAmountMilli'>,
  factorBps: number,
): ReturnType<typeof recipePurchase> {
  return recipePurchase(
    {
      baseAmountMilli: item.baseAmountMilli,
      baseUnit: item.baseUnit,
      packageAmountMilli: item.packageAmountMilli,
    },
    factorBps,
  );
}

/**
 * Nazwa odczytu w dzienniku (ADR-107) — bez treści i pełnego adresu, sam host.
 *
 * @param row - Import.
 * @param row.kind - Rodzaj.
 * @param row.input - Wejście.
 * @param row.sourceUrl - Link przepisu.
 * @returns Np. „Zdjęcie listy", „Przepis — przepisy.pl".
 */
export function importLogName(row: {
  readonly kind: ShoppingImportRow['kind'];
  readonly input: ShoppingImportRow['input'];
  readonly sourceUrl: string | null;
}): string {
  if (row.kind === 'list_photo') return 'Zdjęcie listy';
  if (row.input === 'image') return 'Przepis — zrzut ekranu';
  if (row.input === 'text') return 'Przepis — wklejony tekst';
  try {
    return `Przepis — ${new URL(row.sourceUrl ?? '').hostname}`;
  } catch {
    return 'Przepis — link';
  }
}

/** Wyjaśnienie przyczyny w dzienniku — dokładniejsze niż komunikat dla użytkownika. */
const FAILURE_EXPLANATION: Readonly<Record<string, string>> = {
  AI_UNAVAILABLE:
    'Usługa AI nie odpowiedziała poprawnie (błąd HTTP, przekroczony czas albo zerwane połączenie) — po ponowieniach.',
  AI_SCHEMA_MISMATCH: 'Odpowiedź modelu nie pasuje do schematu odczytu.',
  AI_OUTPUT_TRUNCATED: 'Odpowiedź ucięta na limicie tokenów wyjścia (AI_MAX_OUTPUT_TOKENS).',
  AI_REFUSED: 'Model odmówił odczytu.',
  RECIPE_FETCH_BLOCKED:
    'Adres przepisu niedozwolony (sieć prywatna, port, schemat) — bez wywołania modelu.',
  RECIPE_FETCH_FAILED: 'Nie udało się pobrać strony przepisu — bez wywołania modelu.',
  RECIPE_NOT_FOUND: 'Nie znaleziono składników przepisu.',
  AI_BUDGET_EXCEEDED: 'Wyczerpany miesięczny limit kosztów AI — odczyt nie wystartował.',
  INTERRUPTED: 'Odczyt przerwany restartem serwera.',
  INTERNAL_ERROR: 'Błąd aplikacji przed wywołaniem albo przy zapisie wyniku.',
};

/**
 * Wpis dziennika odczytu importu. Nigdy nie rzuca.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo.
 * @param row - Import.
 * @param entry - Wpis bez odnośnika do importu.
 */
function logImport(
  deps: Pick<ShoppingImportsDeps, 'db' | 'clock' | 'log'>,
  householdId: string,
  row: Pick<ShoppingImportRow, 'id' | 'kind' | 'input' | 'sourceUrl'>,
  entry: Omit<ShoppingAiLogEntry, 'importRef'>,
): void {
  writeShoppingAiLog(deps, householdId, {
    importRef: { id: row.id, name: importLogName(row) },
    ...entry,
  });
}

/**
 * Odczyt w tle: obrazy albo tekst → model → propozycje. Nigdy nie rzuca — błąd kończy
 * import jako `failed` z kodem (08 §17.1). Koszt, jeśli usługa odpowiedziała, trafia do
 * licznika miesiąca także przy błędzie.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo.
 * @param id - Import.
 */
export async function analyzeImport(
  deps: ShoppingImportsDeps,
  householdId: string,
  id: string,
): Promise<void> {
  const row = findImport(deps.db, householdId, id);
  if (row?.status !== 'processing' || deps.extractor === null) return;
  const extractor = deps.extractor;
  const ai = householdAiModel(deps.db, deps.config.ai, deps.clock, householdId);
  const log = (entry: Omit<ShoppingAiLogEntry, 'importRef'>): void => {
    logImport(deps, householdId, row, entry);
  };
  const fail = (code: string, extra: Partial<ShoppingImportRow> = {}): void => {
    transitionImport(deps.db, householdId, id, ['processing'], {
      status: 'failed',
      errorCode: code,
      ...extra,
      updatedAt: deps.clock.now().getTime(),
    });
  };
  log({
    level: 'info',
    event: 'started',
    message: `Odczyt rozpoczęty — model ${ai.model}.`,
    details: {
      model: ai.model,
      kind: row.kind,
      input: row.input,
      imageCount: parseImportFilePaths(row.filePaths).length,
      servingsFactorBps: row.servingsFactorBps,
    },
  });

  try {
    let sourceText = row.sourceText;
    if (row.input === 'url' && sourceText === null && row.sourceUrl !== null) {
      const fetchHtml = deps.fetchHtml ?? ((url: string) => safeFetchHtml(url));
      try {
        sourceText = recipeSourceFromHtml((await fetchHtml(row.sourceUrl)).html).text;
      } catch (error) {
        const code = error instanceof SafeFetchError ? error.code : 'RECIPE_FETCH_FAILED';
        // Do logu tylko host i przyczyna — bez treści strony i bez pełnego adresu.
        deps.log.warn(
          {
            importId: id,
            code,
            host: new URL(row.sourceUrl).hostname,
            reason: (error as Error).message,
          },
          'Nie udało się pobrać przepisu',
        );
        fail(code);
        log({
          level: 'error',
          event: 'failed',
          message: FAILURE_EXPLANATION[code] ?? code,
          details: {
            errorCode: code,
            host: new URL(row.sourceUrl).hostname,
            reason: (error as Error).message.slice(0, 300),
          },
        });
        return;
      }
      transitionImport(deps.db, householdId, id, ['processing'], { sourceText });
    }
    // Strona bez widocznego tekstu (np. renderowana przez JS) — bez płatnego wywołania
    // modelu, które i tak skończyłoby się `RECIPE_NOT_FOUND` (ADR-101 pkt 4, ADR-102).
    if (row.input !== 'image' && (sourceText ?? '').trim().length < MIN_RECIPE_TEXT) {
      fail('RECIPE_NOT_FOUND');
      log({
        level: 'error',
        event: 'failed',
        message:
          'Strona bez widocznego tekstu przepisu (np. renderowana skryptem) — bez wywołania modelu.',
        details: { errorCode: 'RECIPE_NOT_FOUND', textChars: (sourceText ?? '').trim().length },
      });
      return;
    }

    const now = (): number => deps.clock.now().getTime();
    if (row.kind === 'list_photo') {
      const result = await extractor.extractList({
        model: ai.model,
        parts: await preparedImages(deps, row),
      });
      const cost = estimateCostMinor(result.usage, ai.rates);
      deps.db.sqlite.transaction(() => {
        const saved = transitionImport(deps.db, householdId, id, ['processing'], {
          status: 'parsed',
          notes: result.notes,
          aiModel: result.model,
          aiRawResponse: result.rawResponse,
          aiInputTokens: result.usage.inputTokens,
          aiOutputTokens: result.usage.outputTokens,
          processedAt: now(),
          costMinor: cost,
          errorCode: null,
          updatedAt: now(),
        });
        if (saved) {
          replaceImportItems(
            deps.db,
            householdId,
            id,
            proposalRows(
              deps,
              saved,
              result.items.map((item) => ({
                name: item.name,
                sourceText: item.sourceText,
                quantityMilli: item.quantityMilli,
                unit: item.unit,
                section: item.section,
                confidenceBps: item.confidenceBps,
              })),
              now(),
            ),
          );
        }
        recordAiSpend(deps.db, ai.month, cost, now());
      })();
      log({
        level: result.items.length === 0 ? 'warn' : 'info',
        event: 'parsed',
        message:
          result.items.length === 0
            ? 'Model odpowiedział, ale nie odczytał żadnej pozycji.'
            : `Odczytano pozycji: ${String(result.items.length)}.`,
        details: {
          ...result.diagnostics,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          itemCount: result.items.length,
          costMinor: cost,
          requestId: result.requestId,
        },
      });
      return;
    }

    const parts = row.input === 'image' ? await preparedImages(deps, row) : [];
    const result = await extractor.extractRecipe({
      model: ai.model,
      parts,
      text: row.input === 'image' ? null : sourceText,
      staples: findStapleProducts(deps.db, householdId).map((product) => product.name),
    });
    const cost = estimateCostMinor(result.usage, ai.rates);
    const factor = row.servingsFactorBps ?? 10_000;
    deps.db.sqlite.transaction(() => {
      if (result.ingredients.length === 0) {
        transitionImport(deps.db, householdId, id, ['processing'], {
          status: 'failed',
          errorCode: 'RECIPE_NOT_FOUND',
          notes: result.notes,
          aiModel: result.model,
          aiRawResponse: result.rawResponse,
          aiInputTokens: result.usage.inputTokens,
          aiOutputTokens: result.usage.outputTokens,
          processedAt: now(),
          costMinor: cost,
          updatedAt: now(),
        });
      } else {
        const saved = transitionImport(deps.db, householdId, id, ['processing'], {
          status: 'parsed',
          recipeTitle: result.title,
          baseServings: result.baseServings,
          notes: result.notes,
          aiModel: result.model,
          aiRawResponse: result.rawResponse,
          aiInputTokens: result.usage.inputTokens,
          aiOutputTokens: result.usage.outputTokens,
          processedAt: now(),
          costMinor: cost,
          errorCode: null,
          updatedAt: now(),
        });
        if (saved) {
          replaceImportItems(
            deps.db,
            householdId,
            id,
            proposalRows(
              deps,
              saved,
              result.ingredients.map((item) => {
                const purchase = purchaseFor(item, factor);
                return {
                  name: item.name,
                  sourceText: item.sourceText,
                  quantityMilli: purchase.quantityMilli,
                  unit: purchase.unit,
                  baseAmountMilli: item.baseAmountMilli,
                  baseUnit: item.baseUnit,
                  packageAmountMilli: item.packageAmountMilli,
                  packageLabel: item.packageLabel,
                  pantryStaple: item.pantryStaple,
                  section: item.section,
                  confidenceBps: item.confidenceBps,
                };
              }),
              now(),
            ),
          );
        }
      }
      recordAiSpend(deps.db, ai.month, cost, now());
    })();
    log(
      result.ingredients.length === 0
        ? {
            level: 'error',
            event: 'failed',
            message: FAILURE_EXPLANATION.RECIPE_NOT_FOUND ?? 'RECIPE_NOT_FOUND',
            details: {
              errorCode: 'RECIPE_NOT_FOUND',
              ...result.diagnostics,
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              costMinor: cost,
              requestId: result.requestId,
            },
          }
        : {
            level: 'info',
            event: 'parsed',
            message: `Odczytano składników: ${String(result.ingredients.length)}.`,
            details: {
              ...result.diagnostics,
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              itemCount: result.ingredients.length,
              costMinor: cost,
              requestId: result.requestId,
            },
          },
    );
  } catch (error) {
    const extraction = error instanceof ExtractionError ? error : null;
    const usage = extraction?.details.usage;
    const cost = usage === undefined ? 0 : estimateCostMinor(usage, ai.rates);
    if (extraction === null) {
      deps.log.error({ err: error, importId: id }, 'Odczyt importu listy zakupów nie powiódł się');
    } else {
      deps.log.warn(
        { importId: id, code: extraction.code, ...extraction.details.diagnostics },
        'Odczyt importu listy zakupów odrzucony',
      );
    }
    deps.db.sqlite.transaction(() => {
      fail(extraction?.code ?? 'INTERNAL_ERROR', {
        aiRawResponse: extraction?.details.rawResponse ?? null,
        aiInputTokens: usage?.inputTokens ?? null,
        aiOutputTokens: usage?.outputTokens ?? null,
        processedAt: usage === undefined ? null : deps.clock.now().getTime(),
        costMinor: cost,
      });
      recordAiSpend(deps.db, ai.month, cost, deps.clock.now().getTime());
    })();
    const code = extraction?.code ?? 'INTERNAL_ERROR';
    log({
      level: 'error',
      event: 'failed',
      message: FAILURE_EXPLANATION[code] ?? code,
      details: {
        errorCode: code,
        ...(extraction === null ? errorDiagnostics(error) : extraction.details.diagnostics),
        ...(usage === undefined
          ? {}
          : { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costMinor: cost }),
        requestId: extraction?.details.requestId ?? null,
      },
    });
  }
}

/**
 * Import jako DTO: propozycje z wyliczoną potrzebą (dopisek P-2), flagą „zawsze w domu"
 * i scaleniem z **bieżącym** stanem listy.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Import.
 * @returns DTO importu.
 */
export function getImport(handle: DbHandle, householdId: string, id: string): ShoppingImportDto {
  const row = requireImport(handle, householdId, id);
  const items = findImportItems(handle, householdId, id);
  const products = new Map(
    findProductsByNames(
      handle,
      householdId,
      items.map((item) => normalizeShoppingName(item.name)),
    ).map((product) => [product.normalizedName, product]),
  );
  const listItems = findVisibleItems(handle, householdId, row.listId).map((item) => ({
    ...item,
    checked: item.checkedAt !== null,
  }));
  const factor = row.servingsFactorBps ?? 10_000;
  return {
    id: row.id,
    listId: row.listId,
    kind: row.kind,
    input: row.input,
    status: row.status,
    sourceUrl: row.sourceUrl,
    servingsFactorBps: row.servingsFactorBps,
    recipeTitle: row.recipeTitle,
    baseServings: row.baseServings,
    notes: row.notes,
    errorCode: row.errorCode,
    errorMessage: importErrorMessage(row.errorCode),
    createdAt: row.createdAt,
    items: items.map((item): ShoppingImportItemDto => {
      const target = findMergeTarget(listItems, normalizeShoppingName(item.name), item.unit);
      return {
        id: item.id,
        name: item.name,
        sourceText: item.sourceText,
        quantityMilli: item.quantityMilli,
        unit: item.unit,
        quantityOverridden: item.quantityOverridden,
        neededAmountMilli:
          row.kind === 'recipe' ? purchaseFor(item, factor).neededAmountMilli : null,
        baseUnit: item.baseUnit,
        packageAmountMilli: item.packageAmountMilli,
        packageLabel: item.packageLabel,
        section: item.section,
        confidenceBps: item.confidenceBps,
        needsReview: item.confidenceBps < NEEDS_REVIEW_BELOW_BPS,
        alreadyHave: item.alreadyHave,
        isStaple: products.get(normalizeShoppingName(item.name))?.isStaple ?? false,
        selected: item.selected,
        mergeInto:
          target === null
            ? null
            : { itemId: target.id, quantityMilli: target.quantityMilli, unit: target.unit },
      };
    }),
  };
}

/**
 * Import w stanie `parsed` albo `409`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Import.
 * @returns Wiersz.
 * @throws {ConflictError} Gdy import nie czeka na przegląd.
 */
function requireParsed(handle: DbHandle, householdId: string, id: string): ShoppingImportRow {
  const row = requireImport(handle, householdId, id);
  if (row.status !== 'parsed') throw new ConflictError('Ten odczyt nie czeka już na przegląd.');
  return row;
}

/**
 * Zmiana mnożnika albo listy docelowej — przeliczenie bez AI (07 §14.2). Ilości
 * poprawione ręcznie zostają.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Import.
 * @param request - Mnożnik i/lub lista.
 * @returns Import po zmianie.
 */
export function updateImport(
  deps: Pick<ShoppingImportsDeps, 'db' | 'clock'>,
  householdId: string,
  id: string,
  request: UpdateShoppingImportRequest,
): ShoppingImportDto {
  deps.db.sqlite.transaction(() => {
    const row = requireParsed(deps.db, householdId, id);
    const now = deps.clock.now().getTime();
    if (request.listId !== undefined) requireEditableList(deps.db, householdId, request.listId);
    if (request.servingsFactorBps !== undefined && row.kind !== 'recipe') {
      throw new ValidationError('Mnożnik dotyczy tylko przepisu.', [
        { path: 'servingsFactorBps', message: 'Tylko przepis' },
      ]);
    }
    transitionImport(deps.db, householdId, id, ['parsed'], {
      listId: request.listId ?? row.listId,
      servingsFactorBps: request.servingsFactorBps ?? row.servingsFactorBps,
      updatedAt: now,
    });
    if (request.servingsFactorBps !== undefined) {
      for (const item of findImportItems(deps.db, householdId, id)) {
        if (item.quantityOverridden) continue;
        const purchase = purchaseFor(item, request.servingsFactorBps);
        patchImportItem(deps.db, householdId, item.id, {
          quantityMilli: purchase.quantityMilli,
          unit: purchase.unit,
          updatedAt: now,
        });
      }
    }
  })();
  return getImport(deps.db, householdId, id);
}

/**
 * Korekta propozycji: nazwa, ilość (ustawia „poprawione ręcznie"), dział, wybór,
 * „Już mam".
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Import.
 * @param itemId - Propozycja.
 * @param request - Zmiany.
 * @returns Import po zmianie.
 */
export function updateImportItem(
  deps: Pick<ShoppingImportsDeps, 'db' | 'clock'>,
  householdId: string,
  id: string,
  itemId: string,
  request: UpdateShoppingImportItemRequest,
): ShoppingImportDto {
  deps.db.sqlite.transaction(() => {
    requireParsed(deps.db, householdId, id);
    const item = findImportItems(deps.db, householdId, id).find((row) => row.id === itemId);
    if (!item) throw new NotFoundError('Nie znaleziono propozycji.');
    const clear = request.quantityMilli === null || request.unit === null;
    const set = request.quantityMilli != null && request.unit != null;
    patchImportItem(deps.db, householdId, itemId, {
      ...(request.name === undefined ? {} : { name: request.name.trim() }),
      ...(clear ? { quantityMilli: null, unit: null, quantityOverridden: true } : {}),
      ...(set
        ? { quantityMilli: request.quantityMilli, unit: request.unit, quantityOverridden: true }
        : {}),
      ...(request.section === undefined ? {} : { section: request.section }),
      ...(request.selected === undefined ? {} : { selected: request.selected }),
      ...(request.alreadyHave === undefined ? {} : { alreadyHave: request.alreadyHave }),
      updatedAt: deps.clock.now().getTime(),
    });
  })();
  return getImport(deps.db, householdId, id);
}

/**
 * Notatka pozycji z przepisu: potrzeba po mnożniku i tytuł („100 g · Brownie", P-2).
 *
 * @param row - Import.
 * @param item - Propozycja.
 * @returns Notatka albo `null`.
 */
function recipeNote(row: ShoppingImportRow, item: ShoppingImportItemRow): string | null {
  if (row.kind !== 'recipe') return null;
  const needed = purchaseFor(item, row.servingsFactorBps ?? 10_000).neededAmountMilli;
  const amount =
    needed === null
      ? 'do smaku'
      : item.baseUnit === null
        ? null
        : formatShoppingQuantity({ quantityMilli: needed, unit: item.baseUnit });
  return (
    [amount, row.recipeTitle]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · ')
      .slice(0, 120) || null
  );
}

/**
 * Zatwierdza import: zaznaczone propozycje trafiają na listę ze scalaniem (I-29),
 * w jednej transakcji z przejściem w `committed` (I-30). Pliki usuwa wołający po
 * zatwierdzeniu (I-31).
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Kto zatwierdza.
 * @param id - Import.
 * @returns Wynik i ścieżki plików do usunięcia.
 * @throws {ConflictError} Gdy import nie jest w stanie `parsed`.
 * @throws {DomainRuleViolationError} Gdy nic nie zaznaczono.
 */
export function commitImport(
  deps: Pick<ShoppingImportsDeps, 'db' | 'clock'>,
  householdId: string,
  userId: string,
  id: string,
): { result: CommitShoppingImportResult; files: string[] } {
  return deps.db.sqlite.transaction(() => {
    const row = requireParsed(deps.db, householdId, id);
    requireEditableList(deps.db, householdId, row.listId);
    const chosen = findImportItems(deps.db, householdId, id).filter((item) => item.selected);
    if (chosen.length === 0) {
      throw new ConflictError('Zaznacz co najmniej jedną pozycję albo odrzuć odczyt.');
    }
    const now = deps.clock.now().getTime();
    let added = 0;
    let merged = 0;
    for (const item of chosen) {
      const outcome = addItemToList(deps.db, householdId, userId, row.listId, {
        id: undefined,
        name: item.name,
        quantityMilli: item.quantityMilli,
        unit: item.unit,
        note: recipeNote(row, item),
        section: item.section,
        source: row.kind,
        importId: id,
        now,
      });
      if (outcome.merged) merged += 1;
      else added += 1;
    }
    transitionImport(deps.db, householdId, id, ['parsed'], {
      status: 'committed',
      aiRawResponse: null,
      sourceText: null,
      filePaths: '[]',
      updatedAt: now,
    });
    touchList(deps.db, householdId, row.listId, now);
    return {
      result: { listId: row.listId, addedCount: added, mergedCount: merged },
      files: parseImportFilePaths(row.filePaths),
    };
  })();
}

/**
 * Odrzuca import (`processing`, `parsed` albo `failed`) — pliki usuwa wołający.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Import.
 * @returns Ścieżki plików do usunięcia.
 * @throws {ConflictError} Gdy import jest już zatwierdzony albo odrzucony.
 */
export function discardImport(
  deps: Pick<ShoppingImportsDeps, 'db' | 'clock'>,
  householdId: string,
  id: string,
): string[] {
  const row = requireImport(deps.db, householdId, id);
  const saved = transitionImport(deps.db, householdId, id, ['processing', 'parsed', 'failed'], {
    status: 'discarded',
    aiRawResponse: null,
    sourceText: null,
    filePaths: '[]',
    updatedAt: deps.clock.now().getTime(),
  });
  if (!saved) throw new ConflictError('Ten odczyt jest już zamknięty.');
  return parseImportFilePaths(row.filePaths);
}

/**
 * Ponawia nieudany odczyt — z tych samych plików albo tego samego linku / tekstu.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param id - Import.
 * @returns Import w stanie `processing`.
 * @throws {ConflictError} Gdy import nie jest w stanie `failed` albo nie ma już źródła.
 */
export function retryImport(
  deps: ShoppingImportsDeps,
  householdId: string,
  id: string,
): ShoppingImportDto {
  requireExtractor(deps);
  const row = requireImport(deps.db, householdId, id);
  const hasSource =
    parseImportFilePaths(row.filePaths).length > 0 ||
    row.sourceUrl !== null ||
    row.sourceText !== null;
  // Pusty odczyt zdjęcia (`parsed` bez propozycji) też da się ponowić (ADR-101 pkt 3, ADR-102).
  const emptyParsed =
    row.status === 'parsed' && findImportItems(deps.db, householdId, id).length === 0;
  if ((row.status !== 'failed' && !emptyParsed) || !hasSource) {
    throw new ConflictError('Tego odczytu nie da się ponowić — zacznij od nowa.');
  }
  if (findList(deps.db, householdId, row.listId)?.archivedAt != null) {
    throw new ConflictError('Lista jest w archiwum. Przywróć ją, żeby coś zmienić.');
  }
  transitionImport(deps.db, householdId, id, [row.status], {
    status: 'processing',
    errorCode: null,
    // Link pobieramy od nowa — strona mogła się zmienić albo odblokować.
    ...(row.input === 'url' ? { sourceText: null } : {}),
    updatedAt: deps.clock.now().getTime(),
  });
  assertBudget(deps, householdId, id);
  deps.jobs.schedule(() => analyzeImport(deps, householdId, id));
  return getImport(deps.db, householdId, id);
}

/**
 * Oznacza przerwane odczyty przy starcie procesu: **każdy** `processing` — zadania żyją
 * w pamięci, więc po restarcie żaden nie dobiegnie końca (ADR-102; próg 10 min zostawiał
 * świeżo przerwany import w „Czytam…" bez możliwości ponowienia).
 *
 * @param deps - Baza i zegar.
 * @param deps.db - Uchwyt bazy.
 * @param deps.clock - Źródło czasu.
 * @param deps.log - Log procesu — gdy jest, każdy przerwany dostaje wpis w dzienniku.
 * @returns Liczba oznaczonych.
 */
export function failInterruptedImports(deps: {
  db: DbHandle;
  clock: Clock;
  log?: ShoppingImportsDeps['log'];
}): number {
  const now = deps.clock.now().getTime();
  const failed = failAllProcessingImports(deps.db, now);
  const { log } = deps;
  if (log !== undefined) {
    for (const row of failed) {
      logImport({ db: deps.db, clock: deps.clock, log }, row.householdId, row, {
        level: 'error',
        event: 'failed',
        message: FAILURE_EXPLANATION.INTERRUPTED ?? 'INTERRUPTED',
        details: { errorCode: 'INTERRUPTED' },
      });
    }
  }
  return failed.length;
}
