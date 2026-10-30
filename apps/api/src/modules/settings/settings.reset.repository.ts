import type { ExportTable } from '@fineapp/shared';
import { and, eq, inArray } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import { accounts } from '../../db/schema/accounts.js';
import { allocationTargets } from '../../db/schema/allocation-targets.js';
import { budgetDraftGroups, budgetDraftLines, budgetDrafts } from '../../db/schema/budget.js';
import { categories } from '../../db/schema/categories.js';
import { documentItems, documents } from '../../db/schema/documents.js';
import { goals } from '../../db/schema/goals.js';
import { households } from '../../db/schema/households.js';
import { idempotencyKeys } from '../../db/schema/idempotency-keys.js';
import { incomeSources } from '../../db/schema/income-sources.js';
import { liabilities } from '../../db/schema/liabilities.js';
import { plannedExpenses } from '../../db/schema/planned-expenses.js';
import { recurringOccurrences, recurringRules } from '../../db/schema/recurring.js';
import { transactions } from '../../db/schema/transactions.js';

/**
 * Usunięcie wszystkich danych gospodarstwa — **trzeci świadomy wyjątek** od reguły 4
 * z 02 §3, obok `months` i eksportu
 * ([ADR-072](../../../../../../plans/14-decisions-log.md#adr-072)).
 *
 * To lustro eksportu: te same tabele, tym razem do skasowania. Złożenie tego z serwisów
 * dwunastu modułów nie dałoby się zrobić w jednej transakcji bazy, a połowiczne
 * usunięcie (konta tak, transakcje nie) to najgorszy możliwy wynik.
 *
 * Zostaje to, bez czego nie da się zalogować ani zacząć od nowa: gospodarstwo z jego
 * ustawieniami, domownicy, sesje, kategorie systemowe z seeda (I-9) i licznik kosztu AI
 * w `app_meta` — usunięcie danych nie może zerować limitu wydatków na OCR.
 */

/** Wynik usunięcia: liczby wierszy i ścieżki plików dokumentów do skasowania z dysku. */
export interface ResetRows {
  deleted: Record<ExportTable, number>;
  /** Ścieżki oryginałów (względem `UPLOAD_DIR`) — pliki usuwa serwis po zatwierdzeniu. */
  storagePaths: string[];
}

/**
 * Usuwa wszystkie dane gospodarstwa w jednej transakcji.
 *
 * Powiązania między tabelami są częściowo cykliczne (transakcja ↔ wystąpienie /
 * planowany wydatek / dokument, zobowiązanie ↔ reguła), a część kluczy ma `RESTRICT`.
 * Zamiast układać kolejność, która zepsuje się przy następnej kolumnie, sprawdzanie
 * kluczy obcych jest **odroczone do zatwierdzenia** (`defer_foreign_keys`, pragma
 * działa tylko do końca bieżącej transakcji). Na końcu nic nie wskazuje na usunięte
 * wiersze — poza `households.default_expense_account_id`, czyszczonym jawnie.
 *
 * Transakcje idą **razem z koszem** (bez filtra `deleted_at`): po usunięciu danych kosz
 * wskazywałby konta, których już nie ma.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param now - Znacznik systemowy do `households.updated_at`.
 * @returns Liczby usuniętych wierszy i ścieżki plików dokumentów.
 */
export function deleteHouseholdData(handle: DbHandle, householdId: string, now: number): ResetRows {
  const { db, sqlite } = handle;
  return sqlite.transaction((): ResetRows => {
    sqlite.pragma('defer_foreign_keys = ON');

    const documentRows = db
      .select({ id: documents.id, storagePath: documents.storagePath })
      .from(documents)
      .where(eq(documents.householdId, householdId))
      .all();
    const documentIds = documentRows.map((row) => row.id);

    const deleted: Record<ExportTable, number> = {
      // Linie liczone osobno, zanim kaskada ze szkicu usunie je bez licznika.
      budgetDraftLines: db
        .delete(budgetDraftLines)
        .where(eq(budgetDraftLines.householdId, householdId))
        .run().changes,
      // Grupy po liniach: linie z group_id przepinane na NULL byłyby zbędną pracą.
      budgetDraftGroups: db
        .delete(budgetDraftGroups)
        .where(eq(budgetDraftGroups.householdId, householdId))
        .run().changes,
      budgetDrafts: db.delete(budgetDrafts).where(eq(budgetDrafts.householdId, householdId)).run()
        .changes,
      transactions: db.delete(transactions).where(eq(transactions.householdId, householdId)).run()
        .changes,
      documentItems:
        documentIds.length === 0
          ? 0
          : db.delete(documentItems).where(inArray(documentItems.documentId, documentIds)).run()
              .changes,
      documents: db.delete(documents).where(eq(documents.householdId, householdId)).run().changes,
      recurringOccurrences: db
        .delete(recurringOccurrences)
        .where(eq(recurringOccurrences.householdId, householdId))
        .run().changes,
      recurringRules: db
        .delete(recurringRules)
        .where(eq(recurringRules.householdId, householdId))
        .run().changes,
      plannedExpenses: db
        .delete(plannedExpenses)
        .where(eq(plannedExpenses.householdId, householdId))
        .run().changes,
      liabilities: db.delete(liabilities).where(eq(liabilities.householdId, householdId)).run()
        .changes,
      goals: db.delete(goals).where(eq(goals.householdId, householdId)).run().changes,
      allocationTargets: db
        .delete(allocationTargets)
        .where(eq(allocationTargets.householdId, householdId))
        .run().changes,
      incomeSources: db
        .delete(incomeSources)
        .where(eq(incomeSources.householdId, householdId))
        .run().changes,
      accounts: db.delete(accounts).where(eq(accounts.householdId, householdId)).run().changes,
      // Kategorie systemowe zostają (I-9); znikają tylko własne. Dziecko systemowe pod
      // własnym rodzicem traci rodzica przez `ON DELETE SET NULL`.
      categories: db
        .delete(categories)
        .where(and(eq(categories.householdId, householdId), eq(categories.isSystem, false)))
        .run().changes,
    };

    // Klucze idempotencji pamiętają odpowiedzi z identyfikatorami usuniętych wierszy —
    // powtórzone żądanie oddałoby transakcję, której już nie ma.
    db.delete(idempotencyKeys).where(eq(idempotencyKeys.householdId, householdId)).run();
    db.update(households)
      .set({ defaultExpenseAccountId: null, updatedAt: now })
      .where(eq(households.id, householdId))
      .run();

    return { deleted, storagePaths: documentRows.map((row) => row.storagePath) };
  })();
}
