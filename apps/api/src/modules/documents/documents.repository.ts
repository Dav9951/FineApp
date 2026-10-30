import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import { appMeta } from '../../db/schema/app-meta.js';
import {
  documentItems,
  documents,
  type DocumentInsert,
  type DocumentItemInsert,
  type DocumentItemRow,
  type DocumentRow,
} from '../../db/schema/documents.js';

/**
 * Zapytania modułu `documents` — zadania `F7-1`…`F7-7`.
 *
 * `householdId` jest pierwszym argumentem po uchwycie (reguła 4 z `CLAUDE.md`). Pozycje
 * nie mają własnej kolumny gospodarstwa — należą do dokumentu, więc każde zapytanie
 * o pozycje przechodzi przez dokument sprawdzony wcześniej po gospodarstwie.
 */

/**
 * Znajduje dokument gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param id - Identyfikator dokumentu.
 * @returns Wiersz albo `undefined`, także dla cudzego dokumentu.
 */
export function findDocumentById(
  handle: DbHandle,
  householdId: string,
  id: string,
): DocumentRow | undefined {
  return handle.db
    .select()
    .from(documents)
    .where(and(eq(documents.householdId, householdId), eq(documents.id, id)))
    .get();
}

/**
 * Znajduje dokument gospodarstwa po skrócie zawartości — ponowne wrzucenie pliku.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param sha256 - Skrót SHA-256 zawartości.
 * @returns Wiersz albo `undefined`.
 */
export function findDocumentBySha(
  handle: DbHandle,
  householdId: string,
  sha256: string,
): DocumentRow | undefined {
  return handle.db
    .select()
    .from(documents)
    .where(and(eq(documents.householdId, householdId), eq(documents.sha256, sha256)))
    .get();
}

/** Wiersz listy dokumentów z liczbą pozycji — wszystkich, jak w nagłówku przeglądu. */
export interface DocumentListRow extends DocumentRow {
  readonly itemCount: number;
}

/**
 * Lista dokumentów gospodarstwa od najnowszych.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param filter - Status, miesiąc dokumentu, limit.
 * @param filter.status - Tylko ten status.
 * @param filter.monthKey - Tylko dokumenty tego miesiąca (`detected_month_key`).
 * @param filter.limit - Najwięcej wierszy.
 * @returns Wiersze z liczbą pozycji.
 */
export function findDocuments(
  handle: DbHandle,
  householdId: string,
  filter: {
    readonly status?: DocumentRow['status'];
    readonly monthKey?: string;
    readonly limit: number;
  },
): DocumentListRow[] {
  const conditions: SQL[] = [eq(documents.householdId, householdId)];
  if (filter.status !== undefined) conditions.push(eq(documents.status, filter.status));
  if (filter.monthKey !== undefined) {
    conditions.push(eq(documents.detectedMonthKey, filter.monthKey));
  }
  return handle.db
    .select({
      ...getTableColumns(documents),
      // Tabela i kolumna nazwane wprost: Drizzle wstawia `${documents.id}` w podzapytaniu
      // bez nazwy tabeli, a wtedy `id` wskazywałoby na `document_items.id`.
      itemCount: sql<number>`(select count(*) from "document_items" as di where di."document_id" = "documents"."id")`,
    })
    .from(documents)
    .where(and(...conditions))
    .orderBy(desc(documents.createdAt), desc(documents.id))
    .limit(filter.limit)
    .all();
}

/**
 * Wstawia dokument.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Wiersz do zapisania.
 * @returns Zapisany wiersz.
 */
export function insertDocument(handle: DbHandle, row: DocumentInsert): DocumentRow {
  return handle.db.insert(documents).values(row).returning().get();
}

/**
 * Zmienia dokument gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param id - Identyfikator dokumentu.
 * @param patch - Zmieniane kolumny.
 * @returns Wiersz po zmianie albo `undefined`.
 */
export function patchDocument(
  handle: DbHandle,
  householdId: string,
  id: string,
  patch: Partial<DocumentInsert>,
): DocumentRow | undefined {
  return handle.db
    .update(documents)
    .set(patch)
    .where(and(eq(documents.householdId, householdId), eq(documents.id, id)))
    .returning()
    .get();
}

/**
 * Zmienia status dokumentu tylko wtedy, gdy jest w jednym z oczekiwanych — warunek
 * i zapis w jednym `UPDATE`, więc dwa równoległe żądania nie zaczną analizy dwa razy.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param id - Identyfikator dokumentu.
 * @param from - Dozwolone statusy wyjściowe.
 * @param patch - Nowy status i inne kolumny.
 * @returns Wiersz po zmianie albo `undefined`, gdy status był inny.
 */
export function transitionDocument(
  handle: DbHandle,
  householdId: string,
  id: string,
  from: readonly DocumentRow['status'][],
  patch: Partial<DocumentInsert>,
): DocumentRow | undefined {
  return handle.db
    .update(documents)
    .set(patch)
    .where(
      and(
        eq(documents.householdId, householdId),
        eq(documents.id, id),
        inArray(documents.status, [...from]),
      ),
    )
    .returning()
    .get();
}

/**
 * Usuwa dokument (pozycje kaskadowo).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param id - Identyfikator dokumentu.
 */
export function deleteDocumentRow(handle: DbHandle, householdId: string, id: string): void {
  handle.db
    .delete(documents)
    .where(and(eq(documents.householdId, householdId), eq(documents.id, id)))
    .run();
}

/**
 * Oznacza zawieszone analizy jako nieudane — po restarcie kontenera (08 §2).
 *
 * Dotyczy wszystkich gospodarstw: wołane przy starcie aplikacji, zanim jakiekolwiek
 * żądanie istnieje.
 *
 * @param handle - Uchwyt bazy.
 * @param olderThan - Granica `updated_at` (epoch ms).
 * @param now - Chwila zapisu.
 * @returns Liczba oznaczonych dokumentów.
 */
export function failStaleProcessing(handle: DbHandle, olderThan: number, now: number): number {
  return handle.db
    .update(documents)
    .set({
      status: 'failed',
      errorCode: 'INTERRUPTED',
      errorMessage: 'Przerwano — spróbuj ponownie.',
      updatedAt: now,
    })
    .where(and(eq(documents.status, 'processing'), lt(documents.updatedAt, olderThan)))
    .run().changes;
}

/**
 * Pozycje dokumentu w kolejności z dokumentu.
 *
 * @param handle - Uchwyt bazy.
 * @param documentId - Identyfikator dokumentu (sprawdzonego po gospodarstwie).
 * @returns Wiersze pozycji.
 */
export function findDocumentItems(handle: DbHandle, documentId: string): DocumentItemRow[] {
  return handle.db
    .select()
    .from(documentItems)
    .where(eq(documentItems.documentId, documentId))
    .orderBy(asc(documentItems.lineNo), asc(documentItems.id))
    .all();
}

/**
 * Zastępuje pozycje dokumentu nowym odczytem.
 *
 * @param handle - Uchwyt bazy.
 * @param documentId - Identyfikator dokumentu.
 * @param rows - Nowe pozycje.
 */
export function replaceDocumentItems(
  handle: DbHandle,
  documentId: string,
  rows: readonly DocumentItemInsert[],
): void {
  handle.db.delete(documentItems).where(eq(documentItems.documentId, documentId)).run();
  if (rows.length > 0)
    handle.db
      .insert(documentItems)
      .values([...rows])
      .run();
}

/**
 * Zmienia pozycję dokumentu.
 *
 * @param handle - Uchwyt bazy.
 * @param documentId - Identyfikator dokumentu (sprawdzonego po gospodarstwie).
 * @param itemId - Identyfikator pozycji.
 * @param patch - Zmieniane kolumny.
 * @returns Wiersz po zmianie albo `undefined`, gdy pozycja nie należy do dokumentu.
 */
export function patchDocumentItem(
  handle: DbHandle,
  documentId: string,
  itemId: string,
  patch: Partial<DocumentItemInsert>,
): DocumentItemRow | undefined {
  return handle.db
    .update(documentItems)
    .set(patch)
    .where(and(eq(documentItems.documentId, documentId), eq(documentItems.id, itemId)))
    .returning()
    .get();
}

/**
 * Zużycie AI gospodarstwa od podanej chwili — liczba dokumentów i tokenów.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param from - Początek okresu (epoch ms, `processed_at`).
 * @param to - Koniec okresu (wyłącznie).
 * @returns Liczniki.
 */
export function sumAiUsage(
  handle: DbHandle,
  householdId: string,
  from: number,
  to: number,
): { documentCount: number; inputTokens: number; outputTokens: number } {
  const row = handle.db
    .select({
      documentCount: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${documents.aiInputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${documents.aiOutputTokens}), 0)`,
    })
    .from(documents)
    .where(
      and(
        eq(documents.householdId, householdId),
        isNotNull(documents.aiModel),
        gte(documents.processedAt, from),
        lt(documents.processedAt, to),
      ),
    )
    .get();
  return {
    documentCount: row?.documentCount ?? 0,
    inputTokens: row?.inputTokens ?? 0,
    outputTokens: row?.outputTokens ?? 0,
  };
}

/**
 * Klucz licznika kosztów miesiąca w `app_meta` (03 §3.17, 08 §9).
 *
 * @param monthKey - Miesiąc `YYYY-MM`.
 * @returns Klucz.
 */
function spendKey(monthKey: string): string {
  return `ai_spend_${monthKey}_minor`;
}

/**
 * Wydane w miesiącu na OCR, w groszach.
 *
 * @param handle - Uchwyt bazy.
 * @param monthKey - Miesiąc.
 * @returns Suma kosztów; brak wpisu to `0`.
 */
export function readAiSpend(handle: DbHandle, monthKey: string): number {
  const row = handle.db
    .select()
    .from(appMeta)
    .where(eq(appMeta.key, spendKey(monthKey)))
    .get();
  return row === undefined ? 0 : Number(row.value);
}

/**
 * Dolicza koszt wywołania do licznika miesiąca — atomowo, w jednym `UPSERT`.
 *
 * @param handle - Uchwyt bazy.
 * @param monthKey - Miesiąc.
 * @param costMinor - Koszt w groszach.
 * @param now - Chwila zapisu.
 */
export function addAiSpend(
  handle: DbHandle,
  monthKey: string,
  costMinor: number,
  now: number,
): void {
  handle.db
    .insert(appMeta)
    .values({ key: spendKey(monthKey), value: String(costMinor), updatedAt: now })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: {
        value: sql`cast(cast(${appMeta.value} as integer) + ${costMinor} as text)`,
        updatedAt: now,
      },
    })
    .run();
}

/**
 * Przepina propozycje kategorii w pozycjach dokumentów gospodarstwa.
 *
 * Pozycje nie mają `household_id`, więc zakres wyznacza dokument — podzapytanie po
 * `documents.household_id`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param fromCategoryId - Kategoria źródłowa.
 * @param toCategoryId - Kategoria docelowa.
 * @param now - Znacznik `updated_at`.
 */
export function reassignItemsCategory(
  handle: DbHandle,
  householdId: string,
  fromCategoryId: string,
  toCategoryId: string,
  now: number,
): void {
  handle.db
    .update(documentItems)
    .set({ suggestedCategoryId: toCategoryId, updatedAt: now })
    .where(
      and(
        eq(documentItems.suggestedCategoryId, fromCategoryId),
        inArray(
          documentItems.documentId,
          handle.db
            .select({ id: documents.id })
            .from(documents)
            .where(eq(documents.householdId, householdId)),
        ),
      ),
    )
    .run();
}
