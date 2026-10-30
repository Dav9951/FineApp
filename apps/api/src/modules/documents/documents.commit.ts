import {
  CreateCategoryRequestSchema,
  documentItemsNetMinor,
  groupItemsByCategory,
  type CommitDocumentRequest,
  type CreateTransactionRequest,
  type DocumentDto,
  type TransactionDto,
  type TransactionMutationMeta,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import { ConflictError, DomainRuleViolationError } from '../../core/errors.js';
import type { DbHandle } from '../../db/client.js';
import type { DocumentItemRow } from '../../db/schema/documents.js';
import { createCategory, lookupCategory } from '../categories/categories.service.js';
import { createTransactions } from '../transactions/transactions.service.js';
import { storedSummary, toDocumentDto } from './documents.mapper.js';
import {
  findDocumentItems,
  patchDocumentItem,
  transitionDocument,
} from './documents.repository.js';
import { requireDocument } from './documents.service.js';

/**
 * Zatwierdzenie dokumentu ([08 §11](../../../../../plans/08-ocr-ai-pipeline.md#11-commit), `F7-6`).
 */

/** Wynik commitu. */
export interface CommitResult {
  readonly data: { readonly document: DocumentDto; readonly transactions: TransactionDto[] };
  readonly meta: TransactionMutationMeta;
}

/**
 * Klucz nazwy kategorii: rodzaj i nazwa bez wielkości liter.
 *
 * @param kind - Rodzaj kategorii.
 * @param name - Nazwa.
 * @returns Klucz mapy.
 */
function nameKey(kind: string, name: string): string {
  return `${kind}:${name.trim().toLocaleLowerCase('pl-PL')}`;
}

/**
 * Kategoria pozycji w trybie `split` — wybrana, nowa z propozycji albo żadna.
 *
 * Kategoria innego rodzaju niż kierunek pozycji (np. rabat z kategorią wydatku od modelu)
 * nie przechodzi do transakcji: przychód z kategorią wydatku łamałby I-4, a pozycja bez
 * kategorii trafia do „bez kategorii" i da się ją poprawić później.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo.
 * @param item - Pozycja.
 * @param created - Nowe kategorie po kluczu nazwy.
 * @returns Identyfikator kategorii albo `null`.
 */
function splitCategory(
  handle: DbHandle,
  householdId: string,
  item: DocumentItemRow,
  created: ReadonlyMap<string, string>,
): string | null {
  const kind = item.direction === 'inflow' ? 'income' : 'expense';
  if (item.suggestedCategoryId !== null) {
    const category = lookupCategory(handle, householdId, item.suggestedCategoryId);
    return category !== undefined && category.kind === kind && !category.isArchived
      ? category.id
      : null;
  }
  if (item.suggestedCategoryName === null) return null;
  return created.get(nameKey(kind, item.suggestedCategoryName)) ?? null;
}

/**
 * Kategoria wydatku pozycji w trybie `by_category` — klucz jej grupy (07 §9.4).
 *
 * W odróżnieniu od {@link splitCategory} liczy się rodzaj **kategorii**, nie kierunek
 * pozycji: rabat na worki z kategorią „Dom" pomniejsza grupę „Dom", zamiast lądować
 * w dominującej. Kategoria przychodu, zarchiwizowana albo brak → `null`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo.
 * @param item - Pozycja.
 * @param created - Nowe kategorie po kluczu nazwy.
 * @returns Identyfikator kategorii wydatku albo `null`.
 */
function groupCategory(
  handle: DbHandle,
  householdId: string,
  item: DocumentItemRow,
  created: ReadonlyMap<string, string>,
): string | null {
  if (item.suggestedCategoryId !== null) {
    const category = lookupCategory(handle, householdId, item.suggestedCategoryId);
    return category !== undefined && category.kind === 'expense' && !category.isArchived
      ? category.id
      : null;
  }
  if (item.suggestedCategoryName === null) return null;
  return created.get(nameKey('expense', item.suggestedCategoryName)) ?? null;
}

/**
 * Zawęża wynik wyszukania pozycji po identyfikatorze.
 *
 * @param row - Pozycja albo `undefined`.
 * @returns `true`, gdy pozycja istnieje.
 */
function isRow(row: DocumentItemRow | undefined): row is DocumentItemRow {
  return row !== undefined;
}

/** Najdłuższa notatka transakcji (05 §4). */
const NOTES_MAX = 1000;

/**
 * Notatka transakcji grupy: opisy pozycji po przecinku, przycięte do limitu pola.
 *
 * @param items - Pozycje grupy.
 * @returns Notatka.
 */
function groupNotes(items: readonly DocumentItemRow[]): string {
  const text = items.map((item) => item.description).join(', ');
  return text.length <= NOTES_MAX ? text : `${text.slice(0, NOTES_MAX - 1)}…`;
}

/**
 * Zatwierdza dokument, tworząc transakcje z zaakceptowanych pozycji.
 *
 * Wykonywane w jednej transakcji bazodanowej: albo powstaną wszystkie zapisy
 * (łącznie z nowymi kategoriami), albo żaden. Dokument zatwierdzony częściowo
 * byłby gorszy niż niezatwierdzony — użytkownik nie wiedziałby, co już jest w księdze.
 *
 * Kolejność (08 §11): kategorie z `createCategories` → transakcje (`single`: jedna na
 * sumę netto zaznaczonych pozycji, opis = sprzedawca; `by_category`: jedna na kategorię
 * wydatku, opis = sprzedawca, notatka = opisy pozycji; `split`: po jednej na pozycję,
 * opis = opis pozycji) → pozycje `accepted` z `transaction_id`, pozostałe `rejected`
 * (I-13) → dokument `committed`. Transakcje mają `source = 'ocr'` i odnośnik do
 * dokumentu.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor z tokenu.
 * @param documentId - Identyfikator dokumentu w stanie `parsed`.
 * @param input - Tryb, konto, data i lista akceptowanych pozycji.
 * @returns Utworzone transakcje i zaktualizowany dokument.
 * @throws {ConflictError} Gdy dokument nie jest w stanie `parsed`.
 * @throws {DomainRuleViolationError} Gdy pozycja nie należy do dokumentu, suma netto
 *   nie jest dodatnia albo kategoria całości nie istnieje.
 */
export function commitDocument(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  documentId: string,
  input: CommitDocumentRequest,
): CommitResult {
  return handle.sqlite.transaction((): CommitResult => {
    const document = requireDocument(handle, householdId, documentId);
    if (document.status !== 'parsed') {
      throw new ConflictError(
        document.status === 'committed'
          ? 'Dokument jest już zatwierdzony.'
          : 'Dokument nie jest gotowy do zatwierdzenia.',
      );
    }
    const items = findDocumentItems(handle, documentId);
    const byId = new Map(items.map((item) => [item.id, item]));
    const unknown = input.itemIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      throw new DomainRuleViolationError('Pozycja nie należy do dokumentu.', [
        { path: 'itemIds', message: unknown.join(', ') },
      ]);
    }
    const selectedIds = new Set(input.itemIds);
    const selected = items.filter((item) => selectedIds.has(item.id));

    const created = new Map<string, string>();
    for (const proposal of input.createCategories) {
      const category = createCategory(
        handle,
        clock,
        householdId,
        CreateCategoryRequestSchema.parse(proposal),
      );
      created.set(nameKey(category.kind, category.name), category.id);
    }

    const summary = storedSummary(document);
    const merchant = input.merchant ?? summary?.merchant ?? null;
    let requests: CreateTransactionRequest[];
    let itemTransaction: (index: number, item: DocumentItemRow) => number;

    if (input.mode === 'single') {
      const amountMinor = documentItemsNetMinor(selected);
      if (amountMinor <= 0) {
        throw new DomainRuleViolationError('Suma zaznaczonych pozycji musi być dodatnia.', [
          { path: 'itemIds', message: 'Zaznacz pozycje, za które zapłacono.' },
        ]);
      }
      const categoryId =
        input.categoryId ??
        (input.categoryName ? created.get(nameKey('expense', input.categoryName)) : undefined);
      if (categoryId === undefined) {
        throw new DomainRuleViolationError('Nowej kategorii nie ma w createCategories.', [
          { path: 'categoryName', message: 'Dodaj tę kategorię do createCategories.' },
        ]);
      }
      requests = [
        {
          type: 'expense',
          bookedOn: input.bookedOn,
          amountMinor,
          accountId: input.accountId,
          categoryId,
          description: merchant ?? (document.kind === 'invoice' ? 'Faktura' : 'Paragon'),
          merchant,
          notes: null,
        },
      ];
      itemTransaction = () => 0;
    } else if (input.mode === 'by_category') {
      const grouping = groupItemsByCategory(
        selected.map((item) => ({
          id: item.id,
          amountMinor: item.amountMinor,
          direction: item.direction,
          categoryKey: groupCategory(handle, householdId, item, created),
        })),
      );
      if (!grouping.ok) {
        throw new DomainRuleViolationError('Suma zaznaczonych pozycji musi być dodatnia.', [
          { path: 'itemIds', message: 'Zaznacz pozycje, za które zapłacono.' },
        ]);
      }
      const description = merchant ?? (document.kind === 'invoice' ? 'Faktura' : 'Paragon');
      const groupOf = new Map<string, number>();
      requests = grouping.groups.map((group, index) => {
        for (const id of group.itemIds) groupOf.set(id, index);
        return {
          type: 'expense',
          bookedOn: input.bookedOn,
          amountMinor: group.amountMinor,
          accountId: input.accountId,
          categoryId: group.categoryKey,
          description,
          merchant,
          notes: groupNotes(group.itemIds.map((id) => byId.get(id)).filter(isRow)),
        };
      });
      itemTransaction = (_index, item) => groupOf.get(item.id) ?? 0;
    } else {
      requests = selected.map((item) => ({
        type: item.direction === 'inflow' ? 'income' : 'expense',
        bookedOn: item.bookedOn ?? input.bookedOn,
        amountMinor: item.amountMinor,
        accountId: input.accountId,
        categoryId: splitCategory(handle, householdId, item, created),
        description: item.description,
        merchant: document.kind === 'bank_statement' ? item.rawText : merchant,
        notes: null,
      }));
      itemTransaction = (index) => index;
    }

    const result = createTransactions(handle, clock, householdId, userId, requests, {
      source: 'ocr',
      sourceDocumentId: documentId,
    });

    const now = clock.now().getTime();
    selected.forEach((item, index) => {
      patchDocumentItem(handle, documentId, item.id, {
        reviewStatus: 'accepted',
        transactionId: result.data[itemTransaction(index, item)]?.id ?? null,
        updatedAt: now,
      });
    });
    for (const item of items) {
      if (!selectedIds.has(item.id)) {
        patchDocumentItem(handle, documentId, item.id, {
          reviewStatus: 'rejected',
          updatedAt: now,
        });
      }
    }
    const committed = transitionDocument(handle, householdId, documentId, ['parsed'], {
      status: 'committed',
      accountId: input.accountId,
      updatedAt: now,
    });
    if (committed === undefined) throw new ConflictError('Dokument zmienił się w trakcie zapisu.');

    return {
      data: {
        document: toDocumentDto(committed, findDocumentItems(handle, documentId)),
        transactions: result.data,
      },
      meta: result.meta,
    };
  })();
}
