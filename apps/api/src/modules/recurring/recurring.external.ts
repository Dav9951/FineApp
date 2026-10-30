import {
  occurrenceDatesForMonth,
  type BudgetOccurrence,
  type BudgetRuleSource,
  type MonthKey,
} from '@fineapp/shared';

import type { DbHandle } from '../../db/client.js';
import { isOncePerMonth } from './recurring.rules.js';
import {
  findActiveRulesWithRefs,
  findOccurrenceById,
  findOccurrencesInMonth,
  pauseRulesForLiability,
  pauseRulesUsingAccount,
  reassignRulesCategory,
  setOccurrenceStatus,
  setPostedAmountByTransaction,
} from './recurring.repository.js';

/**
 * Wejście do reguł cyklicznych dla **innych modułów**: przepinanie przy scalaniu
 * kategorii (07 §9.3, `Z-13`), wstrzymanie przy usunięciu albo archiwizacji konta
 * (07 §10, `Z-28`, ADR-044) albo zamknięciu i usunięciu zobowiązania (ADR-047) i druga
 * strona zaksięgowania — usunięcie, przywrócenie
 * i zmiana kwoty transakcji z wystąpienia (07 §6.7, ADR-042, `F4-3`).
 *
 * Osobny plik z tego samego powodu co `transactions.ledger.ts` (ADR-035): serwis reguł
 * woła serwisy kont, kategorii i transakcji, więc gdyby one wołały serwis reguł,
 * powstałby cykl. Ten plik importuje wyłącznie repozytorium. Żadna funkcja nie otwiera
 * transakcji bazodanowej — granicę wyznacza wołający.
 */

/**
 * Przepina reguły cykliczne z kategorii źródłowej na docelową.
 *
 * Nie otwiera transakcji bazodanowej — granicę scalenia wyznacza serwis kategorii.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param fromCategoryId - Kategoria źródłowa.
 * @param toCategoryId - Kategoria docelowa.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba przepiętych reguł.
 */
export function moveRecurringRulesToCategory(
  handle: DbHandle,
  householdId: string,
  fromCategoryId: string,
  toCategoryId: string,
  now: number,
): number {
  return reassignRulesCategory(handle, householdId, fromCategoryId, toCategoryId, now);
}

/**
 * Wstrzymuje reguły, które księgują na koncie albo z niego — przed jego usunięciem
 * albo archiwizacją (`Z-28`, ADR-044).
 *
 * Reguła bez konta albo z kontem z archiwum nie da się zaksięgować (ADR-035 §4), więc
 * zostawiona aktywna produkowałaby wystąpienia, których nie można potwierdzić. Wstrzymana
 * zostaje z całą konfiguracją i historią; wznowić ją można po wskazaniu innego konta.
 * Nie otwiera transakcji bazodanowej — granicę wyznacza serwis kont.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param accountId - Usuwane albo archiwizowane konto.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba wstrzymanych reguł.
 */
export function pauseRecurringRulesForAccount(
  handle: DbHandle,
  householdId: string,
  accountId: string,
  now: number,
): number {
  return pauseRulesUsingAccount(handle, householdId, accountId, now);
}

/**
 * Cofa zaksięgowanie wystąpienia, którego transakcja trafia do kosza (07 §6.7, I-12).
 *
 * Wystąpienie wraca do `planned` tylko wtedy, gdy wskazuje **tę** transakcję — przywrócona
 * wcześniej jako zwykła (bo wystąpienie zaksięgowano inną) nie może cofnąć cudzego
 * zaksięgowania. Powiązanie `transactions.recurring_occurrence_id` zostaje: po nim
 * przywrócenie z kosza wiąże ponownie, a auto-księgowanie wie, że cofnięto świadomie.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param occurrenceId - Wystąpienie wskazywane przez transakcję.
 * @param transactionId - Usuwana transakcja.
 * @param now - Znacznik `updated_at`.
 * @returns `true`, gdy zaksięgowanie cofnięto.
 */
export function unpostOccurrenceOfTransaction(
  handle: DbHandle,
  householdId: string,
  occurrenceId: string,
  transactionId: string,
  now: number,
): boolean {
  const found = findOccurrenceById(handle, householdId, occurrenceId);
  if (found?.occurrence.status !== 'posted') return false;
  if (found.occurrence.transactionId !== transactionId) return false;
  setOccurrenceStatus(
    handle,
    householdId,
    occurrenceId,
    {
      status: 'planned',
      transactionId: null,
      postedAmountMinor: null,
      postedAt: null,
      skippedReason: null,
    },
    now,
  );
  return true;
}

/**
 * Wiąże przywróconą z kosza transakcję z jej wystąpieniem — o ile ono nadal czeka
 * (07 §6.7). Zaksięgowane w międzyczasie inną transakcją albo pominięte — nie.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param occurrenceId - Wystąpienie wskazywane przez transakcję.
 * @param transaction - Przywracana transakcja: identyfikator i kwota.
 * @param transaction.id - Identyfikator transakcji.
 * @param transaction.amountMinor - Kwota transakcji.
 * @param now - Znacznik `updated_at` i `posted_at`.
 * @returns `true`, gdy wystąpienie znów jest zaksięgowane tą transakcją; `false` —
 *   transakcja wraca jako zwykła i wołający czyści jej powiązanie.
 */
export function relinkOccurrenceOfTransaction(
  handle: DbHandle,
  householdId: string,
  occurrenceId: string,
  transaction: { readonly id: string; readonly amountMinor: number },
  now: number,
): boolean {
  const found = findOccurrenceById(handle, householdId, occurrenceId);
  if (found?.occurrence.status !== 'planned') return false;
  setOccurrenceStatus(
    handle,
    householdId,
    occurrenceId,
    {
      status: 'posted',
      transactionId: transaction.id,
      postedAmountMinor: transaction.amountMinor,
      postedAt: now,
      skippedReason: null,
    },
    now,
  );
  return true;
}

/**
 * Przenosi zmianę kwoty transakcji na zaksięgowane nią wystąpienie — kwota zaksięgowana
 * to kopia, a sumy listy wystąpień nie mogą rozjechać się z księgą.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param transactionId - Zmieniona transakcja.
 * @param amountMinor - Nowa kwota.
 * @param now - Znacznik `updated_at`.
 */
export function syncPostedAmount(
  handle: DbHandle,
  householdId: string,
  transactionId: string,
  amountMinor: number,
  now: number,
): void {
  setPostedAmountByTransaction(handle, householdId, transactionId, amountMinor, now);
}

/**
 * Wstrzymuje reguły spłacające zobowiązanie — przy jego zamknięciu albo usunięciu
 * (ADR-047). Spłacony kredyt nie może dalej produkować rat do zapłaty; reguła zostaje
 * z konfiguracją i historią, jak przy archiwizacji konta (ADR-044).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param liabilityId - Zamykane albo usuwane zobowiązanie.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba wstrzymanych reguł.
 */
export function pauseRecurringRulesForLiability(
  handle: DbHandle,
  householdId: string,
  liabilityId: string,
  now: number,
): number {
  return pauseRulesForLiability(handle, householdId, liabilityId, now);
}

/**
 * Przepływ czekających pozycji cyklicznych w miesiącu — **bez zapisu** (prognoza płynności
 * planowanych wydatków, 07 §6.5, `F6-5`).
 *
 * Wpływy dodatnie, wydatki ujemne, przelewy pominięte (nie zmieniają sumy kont na wydatki
 * w sposób, który prognoza umie przewidzieć). Liczą się wystąpienia zapisane jako
 * `planned` oraz terminy reguł aktywnych, dla których wystąpienia jeszcze nie ma —
 * podgląd przyszłości nie może generować wystąpień (07 §6.2). Reguła liczona w miesiącach
 * z jakimkolwiek wystąpieniem w miesiącu nie dokłada kolejnego (ADR-045).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc prognozy.
 * @returns Przepływ netto w groszach.
 */
export function pendingRecurringNet(
  handle: DbHandle,
  householdId: string,
  month: MonthKey,
): number {
  const signed = (flow: string, amount: number): number =>
    flow === 'income' ? amount : flow === 'expense' ? -amount : 0;
  const existing = findOccurrencesInMonth(handle, householdId, month);
  const seen = new Set(
    existing.map(({ occurrence }) => `${occurrence.ruleId}|${occurrence.dueOn}`),
  );
  const rulesInMonth = new Set(existing.map(({ occurrence }) => occurrence.ruleId));
  let net = existing
    .filter(({ occurrence }) => occurrence.status === 'planned')
    .reduce(
      (sum, { occurrence, rule }) => sum + signed(rule.flow, occurrence.plannedAmountMinor),
      0,
    );
  for (const { rule } of findActiveRulesWithRefs(handle, householdId)) {
    if (isOncePerMonth(rule.frequency) && rulesInMonth.has(rule.id)) continue;
    for (const dueOn of occurrenceDatesForMonth(rule, month)) {
      if (!seen.has(`${rule.id}|${dueOn}`)) net += signed(rule.flow, rule.amountMinor);
    }
  }
  return net;
}

/**
 * Aktywne reguły z wystąpieniami miesiąca — źródło linii planera budżetu
 * (07 §13.2, kroki 1–3, `F9-4`).
 *
 * Tylko odczyt: nie generuje wystąpień (miesiące przyszłe ich nie mają, 07 §6.2,
 * a brakujące w bieżącym liczą się kwotą reguły tak samo). Klasy kont dochodzą
 * ze złączeń, bo przelew trafia do linii puli wg `allocationEffects`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc szkicu.
 * @returns Reguły w kształcie wejścia `buildBudgetSourceLines`.
 */
export function budgetRuleSources(
  handle: DbHandle,
  householdId: string,
  month: MonthKey,
): BudgetRuleSource[] {
  const byRule = new Map<string, BudgetOccurrence[]>();
  for (const { occurrence } of findOccurrencesInMonth(handle, householdId, month)) {
    const list = byRule.get(occurrence.ruleId) ?? [];
    list.push({
      dueOn: occurrence.dueOn,
      status: occurrence.status,
      plannedAmountMinor: occurrence.plannedAmountMinor,
    });
    byRule.set(occurrence.ruleId, list);
  }
  return findActiveRulesWithRefs(handle, householdId).map(({ rule, sourceClass, targetClass }) => ({
    id: rule.id,
    name: rule.name,
    flow: rule.flow,
    amountMinor: rule.amountMinor,
    isActive: rule.isActive,
    schedule: rule,
    occurrences: byRule.get(rule.id) ?? [],
    categoryId: rule.categoryId,
    incomeSourceId: rule.incomeSourceId,
    goalId: rule.goalId,
    liabilityId: rule.liabilityId,
    sourceAllocationClass: sourceClass,
    targetAllocationClass: targetClass,
    allocationOverride: rule.allocationOverride,
  }));
}
