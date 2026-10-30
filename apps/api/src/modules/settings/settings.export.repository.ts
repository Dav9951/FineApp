import type { ExportTable } from '@fineapp/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import { accounts } from '../../db/schema/accounts.js';
import { allocationTargets } from '../../db/schema/allocation-targets.js';
import { budgetDraftGroups, budgetDraftLines, budgetDrafts } from '../../db/schema/budget.js';
import { categories } from '../../db/schema/categories.js';
import { documentItems, documents } from '../../db/schema/documents.js';
import { goals } from '../../db/schema/goals.js';
import { incomeSources } from '../../db/schema/income-sources.js';
import { liabilities } from '../../db/schema/liabilities.js';
import { plannedExpenses } from '../../db/schema/planned-expenses.js';
import { recurringOccurrences, recurringRules } from '../../db/schema/recurring.js';
import { transactions, type TransactionRow } from '../../db/schema/transactions.js';

/**
 * Zapytania eksportu — **drugi świadomy wyjątek** od reguły 4 z 02 §3 (pierwszy to
 * moduł `months`), [ADR-061](../../../../../../plans/14-decisions-log.md#adr-061).
 *
 * Eksport to z definicji odczyt wszystkich tabel gospodarstwa naraz. Złożenie go z
 * serwisów dwunastu modułów dałoby dwanaście różnych kształtów DTO, z polami
 * wyliczanymi (salda, postęp) zamiast zapisanych — a kopia ma oddawać **to, co jest
 * w bazie**, żeby dało się ją kiedyś wczytać z powrotem. Stąd jedno repozytorium,
 * które czyta tabele wprost, tylko do odczytu.
 *
 * Czego tu nie ma, celowo: `users` (idzie przez serwis `auth`, pole po polu, bez hasha
 * PIN-u), `auth_sessions`, `auth_attempts`, `idempotency_keys`, `app_meta`.
 */

/** Wiersz tabeli w postaci ogólnej — kolumny w `camelCase`, jak zwraca je Drizzle. */
export type ExportRow = Readonly<Record<string, unknown>>;

/**
 * Czyta wszystkie tabele gospodarstwa do eksportu JSON.
 *
 * Każde zapytanie jest zawężone do `householdId`; pozycje dokumentów — przez dokumenty
 * gospodarstwa, bo same nie mają tej kolumny. Transakcje z kosza są pominięte
 * (`deleted_at IS NULL`, reguła 5 z `CLAUDE.md`). Porządek po `id` — ULID rośnie
 * z czasem założenia, więc plik czyta się chronologicznie.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Wiersze tabel, w kolejności z `EXPORT_TABLES`.
 */
export function readExportTables(
  handle: DbHandle,
  householdId: string,
): Record<ExportTable, ExportRow[]> {
  const { db } = handle;
  const documentRows = db
    .select()
    .from(documents)
    .where(eq(documents.householdId, householdId))
    .orderBy(asc(documents.id))
    .all();
  const documentIds = documentRows.map((row) => row.id);

  return {
    accounts: db
      .select()
      .from(accounts)
      .where(eq(accounts.householdId, householdId))
      .orderBy(asc(accounts.id))
      .all(),
    categories: db
      .select()
      .from(categories)
      .where(eq(categories.householdId, householdId))
      .orderBy(asc(categories.id))
      .all(),
    incomeSources: db
      .select()
      .from(incomeSources)
      .where(eq(incomeSources.householdId, householdId))
      .orderBy(asc(incomeSources.id))
      .all(),
    goals: db
      .select()
      .from(goals)
      .where(eq(goals.householdId, householdId))
      .orderBy(asc(goals.id))
      .all(),
    liabilities: db
      .select()
      .from(liabilities)
      .where(eq(liabilities.householdId, householdId))
      .orderBy(asc(liabilities.id))
      .all(),
    allocationTargets: db
      .select()
      .from(allocationTargets)
      .where(eq(allocationTargets.householdId, householdId))
      .orderBy(asc(allocationTargets.id))
      .all(),
    recurringRules: db
      .select()
      .from(recurringRules)
      .where(eq(recurringRules.householdId, householdId))
      .orderBy(asc(recurringRules.id))
      .all(),
    recurringOccurrences: db
      .select()
      .from(recurringOccurrences)
      .where(eq(recurringOccurrences.householdId, householdId))
      .orderBy(asc(recurringOccurrences.id))
      .all(),
    plannedExpenses: db
      .select()
      .from(plannedExpenses)
      .where(eq(plannedExpenses.householdId, householdId))
      .orderBy(asc(plannedExpenses.id))
      .all(),
    documents: documentRows,
    documentItems:
      documentIds.length === 0
        ? []
        : db
            .select()
            .from(documentItems)
            .where(inArray(documentItems.documentId, documentIds))
            .orderBy(asc(documentItems.documentId), asc(documentItems.lineNo))
            .all(),
    budgetDrafts: db
      .select()
      .from(budgetDrafts)
      .where(eq(budgetDrafts.householdId, householdId))
      .orderBy(asc(budgetDrafts.id))
      .all(),
    budgetDraftGroups: db
      .select()
      .from(budgetDraftGroups)
      .where(eq(budgetDraftGroups.householdId, householdId))
      .orderBy(asc(budgetDraftGroups.draftId), asc(budgetDraftGroups.id))
      .all(),
    budgetDraftLines: db
      .select()
      .from(budgetDraftLines)
      .where(eq(budgetDraftLines.householdId, householdId))
      .orderBy(asc(budgetDraftLines.draftId), asc(budgetDraftLines.id))
      .all(),
    transactions: db
      .select()
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), isNull(transactions.deletedAt)))
      .orderBy(asc(transactions.id))
      .all(),
  };
}

/** Nazwy potrzebne do czytelnego CSV — słowniki identyfikator → nazwa. */
export interface CsvLookups {
  accounts: ReadonlyMap<string, string>;
  categories: ReadonlyMap<string, { name: string; parentId: string | null }>;
  incomeSources: ReadonlyMap<string, string>;
}

/**
 * Czyta nazwy kont, kategorii i źródeł gospodarstwa — także zarchiwizowanych, bo
 * stara transakcja może wskazywać konto, którego już nikt nie używa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Słowniki nazw.
 */
export function readCsvLookups(handle: DbHandle, householdId: string): CsvLookups {
  const { db } = handle;
  return {
    accounts: new Map(
      db
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(eq(accounts.householdId, householdId))
        .all()
        .map((row) => [row.id, row.name]),
    ),
    categories: new Map(
      db
        .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
        .from(categories)
        .where(eq(categories.householdId, householdId))
        .all()
        .map((row) => [row.id, { name: row.name, parentId: row.parentId }]),
    ),
    incomeSources: new Map(
      db
        .select({ id: incomeSources.id, name: incomeSources.name })
        .from(incomeSources)
        .where(eq(incomeSources.householdId, householdId))
        .all()
        .map((row) => [row.id, row.name]),
    ),
  };
}

/**
 * Czyta transakcje do CSV — z jednego miesiąca albo wszystkie, bez kosza.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param monthKey - Miesiąc; `undefined` — wszystkie.
 * @returns Transakcje od najstarszej.
 */
export function readCsvTransactions(
  handle: DbHandle,
  householdId: string,
  monthKey: string | undefined,
): TransactionRow[] {
  return handle.db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
        monthKey === undefined ? undefined : eq(transactions.monthKey, monthKey),
      ),
    )
    .orderBy(asc(transactions.bookedOn), asc(transactions.createdAt), asc(transactions.id))
    .all();
}
