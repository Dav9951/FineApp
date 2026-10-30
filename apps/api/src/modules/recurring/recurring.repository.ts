import type { AllocationClass } from '@fineapp/shared';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  notExists,
  or,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import type { DbHandle } from '../../db/client.js';
import { accounts } from '../../db/schema/accounts.js';
import { appMeta } from '../../db/schema/app-meta.js';
import { categories } from '../../db/schema/categories.js';
import {
  recurringOccurrences,
  recurringRules,
  type RecurringOccurrenceInsert,
  type RecurringOccurrenceRow,
  type RecurringRuleInsert,
  type RecurringRuleRow,
} from '../../db/schema/recurring.js';
import { transactions } from '../../db/schema/transactions.js';

/**
 * Zapytania reguł cyklicznych (`F4-1`) i ich wystąpień (`F4-2`).
 *
 * `householdId` jest pierwszym argumentem po uchwycie (reguła 4 z `CLAUDE.md`). Nazwy
 * kategorii i klasy kont są dołączane złączeniem po tabelach — bez importu repozytoriów
 * innych modułów (02 §3), jak w repozytorium transakcji.
 */

/** Konto docelowe reguły — drugie złączenie tej samej tabeli. */
const counterAccounts = alias(accounts, 'counter_accounts');

/** Filtry listy reguł; pominięte pole — bez filtra. */
export interface RecurringRuleFilter {
  readonly flow?: 'expense' | 'income' | 'transfer';
  readonly isFixedExpense?: boolean;
  readonly isActive?: boolean;
}

/**
 * Zwraca reguły gospodarstwa.
 *
 * Kolejność: aktywne przed wstrzymanymi, potem po nazwie — lista na ekranie i tak
 * grupuje się po rodzaju (06 §3.9), a w grupie szuka się po nazwie.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param filter - Filtry.
 * @returns Reguły.
 */
export function findRecurringRules(
  handle: DbHandle,
  householdId: string,
  filter: RecurringRuleFilter,
): RecurringRuleRow[] {
  const conditions: SQL[] = [eq(recurringRules.householdId, householdId)];
  if (filter.flow !== undefined) conditions.push(eq(recurringRules.flow, filter.flow));
  if (filter.isFixedExpense !== undefined) {
    conditions.push(eq(recurringRules.isFixedExpense, filter.isFixedExpense));
  }
  if (filter.isActive !== undefined) conditions.push(eq(recurringRules.isActive, filter.isActive));
  return handle.db
    .select()
    .from(recurringRules)
    .where(and(...conditions))
    .orderBy(desc(recurringRules.isActive), asc(recurringRules.name), asc(recurringRules.id))
    .all();
}

/**
 * Znajduje regułę gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param ruleId - Identyfikator reguły.
 * @returns Wiersz albo `undefined`, także dla reguły innego gospodarstwa.
 */
export function findRecurringRuleById(
  handle: DbHandle,
  householdId: string,
  ruleId: string,
): RecurringRuleRow | undefined {
  return handle.db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.householdId, householdId), eq(recurringRules.id, ruleId)))
    .get();
}

/**
 * Zapisuje nową regułę.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Kompletny wiersz; reguły sprawdził serwis.
 * @returns Zapisany wiersz.
 */
export function insertRecurringRule(handle: DbHandle, row: RecurringRuleInsert): RecurringRuleRow {
  return handle.db.insert(recurringRules).values(row).returning().get();
}

/** Pola reguły, które wolno zmienić. `flow`, gospodarstwo i znaczniki są niezmienne. */
export type RecurringRulePatch = Partial<
  Omit<RecurringRuleInsert, 'id' | 'householdId' | 'flow' | 'createdAt' | 'updatedAt'>
>;

/**
 * Zmienia pola reguły gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param ruleId - Identyfikator reguły.
 * @param patch - Zmieniane pola.
 * @param now - Znacznik `updated_at`.
 * @returns Wiersz po zmianie albo `undefined`.
 */
export function patchRecurringRule(
  handle: DbHandle,
  householdId: string,
  ruleId: string,
  patch: RecurringRulePatch,
  now: number,
): RecurringRuleRow | undefined {
  return handle.db
    .update(recurringRules)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(recurringRules.householdId, householdId), eq(recurringRules.id, ruleId)))
    .returning()
    .get();
}

/**
 * Usuwa regułę gospodarstwa.
 *
 * Wystąpienia znikają razem z nią (`ON DELETE CASCADE`), a transakcje z zaksięgowanych
 * zostają w księdze i tracą tylko powiązanie (`recurring_occurrence_id` → `NULL`) —
 * „posted zostają jako zwykłe transakcje" (07 §6.4, §10).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param ruleId - Identyfikator reguły.
 * @returns `true`, gdy wiersz usunięto.
 */
export function removeRecurringRule(
  handle: DbHandle,
  householdId: string,
  ruleId: string,
): boolean {
  return (
    handle.db
      .delete(recurringRules)
      .where(and(eq(recurringRules.householdId, householdId), eq(recurringRules.id, ruleId)))
      .run().changes > 0
  );
}

/**
 * Przepina reguły gospodarstwa z jednej kategorii na drugą — scalanie kategorii (07 §9.3).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param fromCategoryId - Kategoria źródłowa.
 * @param toCategoryId - Kategoria docelowa.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba przepiętych reguł.
 */
export function reassignRulesCategory(
  handle: DbHandle,
  householdId: string,
  fromCategoryId: string,
  toCategoryId: string,
  now: number,
): number {
  return handle.db
    .update(recurringRules)
    .set({ categoryId: toCategoryId, updatedAt: now })
    .where(
      and(
        eq(recurringRules.householdId, householdId),
        eq(recurringRules.categoryId, fromCategoryId),
      ),
    )
    .run().changes;
}

/**
 * Wstrzymuje aktywne reguły gospodarstwa, które księgują na koncie albo z niego.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param accountId - Konto źródłowe albo docelowe reguły.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba wstrzymanych reguł.
 */
export function pauseRulesUsingAccount(
  handle: DbHandle,
  householdId: string,
  accountId: string,
  now: number,
): number {
  return handle.db
    .update(recurringRules)
    .set({ isActive: false, updatedAt: now })
    .where(
      and(
        eq(recurringRules.householdId, householdId),
        eq(recurringRules.isActive, true),
        or(eq(recurringRules.accountId, accountId), eq(recurringRules.counterAccountId, accountId)),
      ),
    )
    .run().changes;
}

/**
 * Reguła z tym, czego potrzebuje wystąpienie: nazwą kategorii i **bieżącymi** klasami
 * kont (przewidywany efekt alokacji, 05 §11).
 */
export interface RuleWithRefs {
  readonly rule: RecurringRuleRow;
  readonly categoryName: string | null;
  readonly sourceClass: AllocationClass | null;
  readonly targetClass: AllocationClass | null;
}

/** Wystąpienie z regułą, do której należy. */
export interface OccurrenceWithRule extends RuleWithRefs {
  readonly occurrence: RecurringOccurrenceRow;
}

/**
 * Pola reguły i złączeń wspólne dla obu zapytań poniżej.
 *
 * @returns Kolumny zapytania.
 */
function ruleRefColumns(): {
  rule: typeof recurringRules;
  categoryName: typeof categories.name;
  sourceClass: typeof accounts.allocationClass;
  targetClass: typeof counterAccounts.allocationClass;
} {
  return {
    rule: recurringRules,
    categoryName: categories.name,
    sourceClass: accounts.allocationClass,
    targetClass: counterAccounts.allocationClass,
  };
}

/**
 * Zwraca aktywne reguły gospodarstwa z odwołaniami — materiał na generowanie
 * i podgląd miesiąca przyszłego. Wstrzymane nie tworzą wystąpień (07 §6.4).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param ruleId - Opcjonalnie tylko jedna reguła (po edycji).
 * @returns Reguły po nazwie.
 */
export function findActiveRulesWithRefs(
  handle: DbHandle,
  householdId: string,
  ruleId?: string,
): RuleWithRefs[] {
  const conditions: SQL[] = [
    eq(recurringRules.householdId, householdId),
    eq(recurringRules.isActive, true),
  ];
  if (ruleId !== undefined) conditions.push(eq(recurringRules.id, ruleId));
  return handle.db
    .select(ruleRefColumns())
    .from(recurringRules)
    .leftJoin(categories, eq(categories.id, recurringRules.categoryId))
    .leftJoin(accounts, eq(accounts.id, recurringRules.accountId))
    .leftJoin(counterAccounts, eq(counterAccounts.id, recurringRules.counterAccountId))
    .where(and(...conditions))
    .orderBy(asc(recurringRules.name), asc(recurringRules.id))
    .all();
}

/**
 * Zwraca wystąpienia miesiąca z regułami — lista `GET /recurring/occurrences`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param month - Klucz miesiąca.
 * @returns Wystąpienia rosnąco po terminie, potem po nazwie reguły.
 */
export function findOccurrencesInMonth(
  handle: DbHandle,
  householdId: string,
  month: string,
): OccurrenceWithRule[] {
  return handle.db
    .select({ occurrence: recurringOccurrences, ...ruleRefColumns() })
    .from(recurringOccurrences)
    .innerJoin(recurringRules, eq(recurringRules.id, recurringOccurrences.ruleId))
    .leftJoin(categories, eq(categories.id, recurringRules.categoryId))
    .leftJoin(accounts, eq(accounts.id, recurringRules.accountId))
    .leftJoin(counterAccounts, eq(counterAccounts.id, recurringRules.counterAccountId))
    .where(
      and(
        eq(recurringOccurrences.householdId, householdId),
        eq(recurringOccurrences.monthKey, month),
      ),
    )
    .orderBy(
      asc(recurringOccurrences.dueOn),
      asc(recurringRules.name),
      asc(recurringOccurrences.id),
    )
    .all();
}

/** Istniejący termin reguły — do wyliczenia brakujących. */
export interface ExistingOccurrence {
  readonly ruleId: string;
  readonly dueOn: string;
  readonly monthKey: string;
}

/**
 * Zwraca terminy wystąpień gospodarstwa w miesiącach (każdy status).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param months - Klucze miesięcy.
 * @returns Istniejące terminy.
 */
export function findOccurrenceDates(
  handle: DbHandle,
  householdId: string,
  months: readonly string[],
): ExistingOccurrence[] {
  if (months.length === 0) return [];
  return handle.db
    .select({
      ruleId: recurringOccurrences.ruleId,
      dueOn: recurringOccurrences.dueOn,
      monthKey: recurringOccurrences.monthKey,
    })
    .from(recurringOccurrences)
    .where(
      and(
        eq(recurringOccurrences.householdId, householdId),
        inArray(recurringOccurrences.monthKey, [...months]),
      ),
    )
    .all();
}

/**
 * Zapisuje wystąpienia, pomijając już istniejące.
 *
 * `ON CONFLICT (rule_id, due_on) DO NOTHING` — dwa równoległe odświeżenia ekranu nie
 * utworzą duplikatu, nawet gdy oba wyliczyły ten sam brakujący termin (07 §6.2).
 *
 * @param handle - Uchwyt bazy.
 * @param rows - Nowe wystąpienia.
 * @returns Liczba faktycznie zapisanych.
 */
export function insertOccurrences(
  handle: DbHandle,
  rows: readonly RecurringOccurrenceInsert[],
): number {
  if (rows.length === 0) return 0;
  return handle.db
    .insert(recurringOccurrences)
    .values([...rows])
    .onConflictDoNothing({ target: [recurringOccurrences.ruleId, recurringOccurrences.dueOn] })
    .run().changes;
}

/** Które czekające wystąpienia reguły usunąć po zmianie terminarza (07 §6.4). */
export interface PlannedOccurrenceScope {
  /** Od tego miesiąca włącznie — terminy do wygenerowania na nowo. */
  readonly fromMonth: string;
  /** Przed tym miesiącem — reguła jeszcze nie obowiązuje. */
  readonly beforeMonth: string;
  /** Po tym miesiącu — reguła już się skończyła; `null` = bezterminowa. */
  readonly afterMonth: string | null;
}

/**
 * Usuwa czekające (`planned`) wystąpienia reguły: od miesiąca `fromMonth` oraz poza
 * okresem obowiązywania reguły. Zaksięgowane i pominięte zostają nietknięte.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param ruleId - Identyfikator reguły.
 * @param scope - Zakres usuwania.
 * @returns Liczba usuniętych.
 */
export function deletePlannedOccurrences(
  handle: DbHandle,
  householdId: string,
  ruleId: string,
  scope: PlannedOccurrenceScope,
): number {
  const outside: SQL[] = [
    gte(recurringOccurrences.monthKey, scope.fromMonth),
    lt(recurringOccurrences.monthKey, scope.beforeMonth),
  ];
  if (scope.afterMonth !== null) outside.push(gt(recurringOccurrences.monthKey, scope.afterMonth));
  return handle.db
    .delete(recurringOccurrences)
    .where(
      and(
        eq(recurringOccurrences.householdId, householdId),
        eq(recurringOccurrences.ruleId, ruleId),
        eq(recurringOccurrences.status, 'planned'),
        or(...outside),
      ),
    )
    .run().changes;
}

/**
 * Ustawia nową kwotę planowaną czekającym wystąpieniom reguły od miesiąca `fromMonth`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param ruleId - Identyfikator reguły.
 * @param fromMonth - Pierwszy miesiąc objęty zmianą.
 * @param amountMinor - Nowa kwota.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba zmienionych.
 */
export function updatePlannedAmount(
  handle: DbHandle,
  householdId: string,
  ruleId: string,
  fromMonth: string,
  amountMinor: number,
  now: number,
): number {
  return handle.db
    .update(recurringOccurrences)
    .set({ plannedAmountMinor: amountMinor, updatedAt: now })
    .where(
      and(
        eq(recurringOccurrences.householdId, householdId),
        eq(recurringOccurrences.ruleId, ruleId),
        eq(recurringOccurrences.status, 'planned'),
        gte(recurringOccurrences.monthKey, fromMonth),
      ),
    )
    .run().changes;
}

/** Klucz `app_meta` ze znacznikiem ostatniego generowania (03 §3.17). */
const LAST_GENERATION_KEY = 'last_recurring_generation';

/**
 * Zapisuje znacznik ostatniego generowania, które utworzyło wystąpienia (07 §6.2, krok 5).
 *
 * @param handle - Uchwyt bazy.
 * @param now - Chwila generowania, epoch ms.
 */
export function markRecurringGeneration(handle: DbHandle, now: number): void {
  handle.db
    .insert(appMeta)
    .values({ key: LAST_GENERATION_KEY, value: String(now), updatedAt: now })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: String(now), updatedAt: now } })
    .run();
}

/**
 * Znajduje wystąpienie gospodarstwa razem z regułą.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param occurrenceId - Identyfikator wystąpienia.
 * @returns Wystąpienie z regułą albo `undefined`, także dla cudzego gospodarstwa.
 */
export function findOccurrenceById(
  handle: DbHandle,
  householdId: string,
  occurrenceId: string,
): OccurrenceWithRule | undefined {
  return handle.db
    .select({ occurrence: recurringOccurrences, ...ruleRefColumns() })
    .from(recurringOccurrences)
    .innerJoin(recurringRules, eq(recurringRules.id, recurringOccurrences.ruleId))
    .leftJoin(categories, eq(categories.id, recurringRules.categoryId))
    .leftJoin(accounts, eq(accounts.id, recurringRules.accountId))
    .leftJoin(counterAccounts, eq(counterAccounts.id, recurringRules.counterAccountId))
    .where(
      and(
        eq(recurringOccurrences.householdId, householdId),
        eq(recurringOccurrences.id, occurrenceId),
      ),
    )
    .get();
}

/** Zmiana statusu wystąpienia — pola zaksięgowania i pominięcia. */
export interface OccurrenceStatusPatch {
  readonly status: 'planned' | 'posted' | 'skipped';
  readonly transactionId: string | null;
  readonly postedAmountMinor: number | null;
  readonly postedAt: number | null;
  readonly skippedReason: string | null;
}

/**
 * Ustawia status wystąpienia wraz z polami, które od niego zależą (I-12).
 *
 * Zawsze komplet pól: `planned` czyści zaksięgowanie i powód pominięcia, `posted`
 * czyści powód — żaden stan nie zostawia śladów poprzedniego.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param occurrenceId - Identyfikator wystąpienia.
 * @param patch - Nowy status i pola zależne.
 * @param now - Znacznik `updated_at`.
 * @returns Wiersz po zmianie albo `undefined`.
 */
export function setOccurrenceStatus(
  handle: DbHandle,
  householdId: string,
  occurrenceId: string,
  patch: OccurrenceStatusPatch,
  now: number,
): RecurringOccurrenceRow | undefined {
  return handle.db
    .update(recurringOccurrences)
    .set({ ...patch, updatedAt: now })
    .where(
      and(
        eq(recurringOccurrences.householdId, householdId),
        eq(recurringOccurrences.id, occurrenceId),
      ),
    )
    .returning()
    .get();
}

/**
 * Ustawia kwotę zaksięgowaną wystąpienia — po zmianie kwoty jego transakcji.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param transactionId - Transakcja, którą zaksięgowano wystąpienie.
 * @param amountMinor - Nowa kwota.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba zmienionych wystąpień (0 albo 1).
 */
export function setPostedAmountByTransaction(
  handle: DbHandle,
  householdId: string,
  transactionId: string,
  amountMinor: number,
  now: number,
): number {
  return handle.db
    .update(recurringOccurrences)
    .set({ postedAmountMinor: amountMinor, updatedAt: now })
    .where(
      and(
        eq(recurringOccurrences.householdId, householdId),
        eq(recurringOccurrences.transactionId, transactionId),
        eq(recurringOccurrences.status, 'posted'),
      ),
    )
    .run().changes;
}

/**
 * Wystąpienia do auto-księgowania (07 §6.2, krok 4): czekające, w terminie albo po nim,
 * w miesiącach okna, z aktywnej reguły z `auto_post` i kwotą pewną.
 *
 * Pomija wystąpienia, do których prowadzi **jakakolwiek** transakcja, także z kosza:
 * cofnięte zaksięgowanie zostawia transakcję w koszu z powiązaniem (07 §6.7), a to znaczy
 * „ktoś świadomie to cofnął" — ponowne auto-księgowanie przy następnym odświeżeniu
 * zrobiłoby z cofnięcia operację bez skutku (ADR-046).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param months - Miesiące okna generowania.
 * @param today - Dzisiejsza data biznesowa.
 * @returns Wystąpienia rosnąco po terminie.
 */
export function findAutoPostCandidates(
  handle: DbHandle,
  householdId: string,
  months: readonly string[],
  today: string,
): RecurringOccurrenceRow[] {
  if (months.length === 0) return [];
  return handle.db
    .select({ occurrence: recurringOccurrences })
    .from(recurringOccurrences)
    .innerJoin(recurringRules, eq(recurringRules.id, recurringOccurrences.ruleId))
    .where(
      and(
        eq(recurringOccurrences.householdId, householdId),
        eq(recurringOccurrences.status, 'planned'),
        inArray(recurringOccurrences.monthKey, [...months]),
        lte(recurringOccurrences.dueOn, today),
        eq(recurringRules.isActive, true),
        eq(recurringRules.autoPost, true),
        eq(recurringRules.amountIsEstimate, false),
        notExists(
          handle.db
            .select({ id: transactions.id })
            .from(transactions)
            .where(eq(transactions.recurringOccurrenceId, recurringOccurrences.id)),
        ),
      ),
    )
    .orderBy(asc(recurringOccurrences.dueOn), asc(recurringOccurrences.id))
    .all()
    .map((row) => row.occurrence);
}

/**
 * Wstrzymuje aktywne reguły gospodarstwa, które spłacają zobowiązanie.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param liabilityId - Zobowiązanie.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba wstrzymanych reguł.
 */
export function pauseRulesForLiability(
  handle: DbHandle,
  householdId: string,
  liabilityId: string,
  now: number,
): number {
  return handle.db
    .update(recurringRules)
    .set({ isActive: false, updatedAt: now })
    .where(
      and(
        eq(recurringRules.householdId, householdId),
        eq(recurringRules.isActive, true),
        eq(recurringRules.liabilityId, liabilityId),
      ),
    )
    .run().changes;
}

/**
 * Najwcześniejsze czekające wystąpienie reguł spłacających zobowiązanie, w miesiącach okna.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param liabilityId - Zobowiązanie.
 * @param months - Miesiące okna generowania.
 * @returns Identyfikator wystąpienia albo `undefined`.
 */
export function findFirstPlannedForLiability(
  handle: DbHandle,
  householdId: string,
  liabilityId: string,
  months: readonly string[],
): string | undefined {
  if (months.length === 0) return undefined;
  return handle.db
    .select({ id: recurringOccurrences.id })
    .from(recurringOccurrences)
    .innerJoin(recurringRules, eq(recurringRules.id, recurringOccurrences.ruleId))
    .where(
      and(
        eq(recurringOccurrences.householdId, householdId),
        eq(recurringOccurrences.status, 'planned'),
        inArray(recurringOccurrences.monthKey, [...months]),
        eq(recurringRules.liabilityId, liabilityId),
      ),
    )
    .orderBy(asc(recurringOccurrences.dueOn), asc(recurringOccurrences.id))
    .get()?.id;
}
