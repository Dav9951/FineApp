import {
  defaultAnchorDate,
  earliestPostableDate,
  formatDateOnly,
  formatMonth,
  normalizeSchedule,
  occurrenceDatesForMonth,
  recurringRuleFromRequest,
  recurringRuleFromTransaction,
  recurringRuleShapeIssues,
  sourcePaymentDueOn,
  todayInTimezone,
  upcomingDueDates,
  type CreateRecurringRuleRequest,
  type GenerateOccurrencesResultDto,
  type ListRecurringRulesQuery,
  type MonthKey,
  type MonthRecurringSectionDto,
  type OccurrenceMutationMeta,
  type OccurrenceStatus,
  type PostOccurrenceRequest,
  type PostOccurrenceResultDto,
  type RecurringOccurrenceDto,
  type RecurringOccurrencesMeta,
  type RecurringRuleShape,
  type RecurringRuleDetailDto,
  type RecurringRuleDto,
  type SaveAsRecurringRequest,
  type SkipOccurrenceRequest,
  type TransactionListItemDto,
  type UpdateRecurringRuleRequest,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import {
  AppError,
  ConflictError,
  DomainRuleViolationError,
  NotFoundError,
} from '../../core/errors.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import type { RecurringOccurrenceRow, RecurringRuleRow } from '../../db/schema/recurring.js';
import { getHousehold } from '../auth/auth.service.js';
import { adoptLiabilityRule, liabilityRuleId } from '../liabilities/liabilities.external.js';
import { linkTransactionToOccurrence } from '../transactions/transactions.ledger.js';
import {
  checkTransactionReferences,
  type ReferenceChanges,
} from '../transactions/transactions.references.js';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
} from '../transactions/transactions.service.js';
import { toOccurrenceDto, toRecurringRuleDto } from './recurring.mapper.js';
import {
  deletePlannedOccurrences,
  findActiveRulesWithRefs,
  findAutoPostCandidates,
  findFirstPlannedForLiability,
  findOccurrenceById,
  findOccurrenceDates,
  findOccurrencesInMonth,
  findRecurringRuleById,
  findRecurringRules,
  insertOccurrences,
  insertRecurringRule,
  markRecurringGeneration,
  patchRecurringRule,
  removeRecurringRule,
  setOccurrenceStatus,
  updatePlannedAmount,
  type ExistingOccurrence,
  type OccurrenceWithRule,
  type RecurringRulePatch,
} from './recurring.repository.js';
import {
  generationWindow,
  isOverdue,
  missingDueDates,
  occurrenceTotals,
  scheduleChanged,
  type GenerationWindow,
} from './recurring.rules.js';

/**
 * Reguły cykliczne (`F4-1`) i ich wystąpienia (`F4-2`)
 * ([04 §9](../../../../../../plans/04-api-spec.md#9-pozycje-cykliczne--apiv1recurring),
 * [07 §6](../../../../../../plans/07-domain-rules.md#6-pozycje-cykliczne)).
 *
 * Reguła opisuje transakcję, którą kiedyś utworzy, więc sprawdzamy ją **tymi samymi**
 * regułami co transakcję: kształt (`recurringRuleShapeIssues` z `shared`) i odwołania
 * (`transactions.references.ts`, ADR-043). Błąd reguły wychodzi przy jej zapisie,
 * a nie przy księgowaniu miesiące później.
 *
 * Wystąpienia powstają leniwie — przy odczycie miesiąca, w oknie od pierwszego otwartego
 * do bieżącego miesiąca (07 §6.2, ADR-045). Przyszłość to podgląd wyliczany z reguł, bez
 * zapisu. Księgowanie tworzy transakcję przez serwis transakcji — te same niezmienniki
 * i okno księgowania co formularz (07 §6.5, `F4-3`); cofnięcie to usunięcie tej
 * transakcji (07 §6.7).
 */

/** Komunikat dla reguły spoza gospodarstwa albo nieistniejącej — celowo ten sam. */
const NOT_FOUND = 'Nie znaleziono pozycji cyklicznej.';

/** Powód pominięcia terminów z czasu wstrzymania, zapisywany przy wznowieniu. */
const PAUSED_REASON = 'Reguła była wstrzymana';

/** Ile najbliższych terminów pokazują szczegóły reguły. */
const UPCOMING_COUNT = 6;

/**
 * Dzisiejsza data biznesowa gospodarstwa (07 §1.1).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Data `YYYY-MM-DD`.
 */
function todayOf(handle: DbHandle, clock: Clock, householdId: string): string {
  return todayInTimezone(getHousehold(handle, householdId).timezone, clock.now());
}

/** „Dziś" gospodarstwa razem z oknem generowania. */
interface HouseholdCalendar {
  readonly today: string;
  readonly window: GenerationWindow;
  readonly backPostingLimitMonths: number;
}

/**
 * Dzisiejsza data i okno generowania gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Kalendarz gospodarstwa.
 */
function calendarOf(handle: DbHandle, clock: Clock, householdId: string): HouseholdCalendar {
  const household = getHousehold(handle, householdId);
  const today = todayInTimezone(household.timezone, clock.now());
  return {
    today,
    window: generationWindow(today, household.backPostingLimitMonths, household.monthStartDay),
    backPostingLimitMonths: household.backPostingLimitMonths,
  };
}

/**
 * Zapisuje brakujące wystąpienia aktywnych reguł w oknie (07 §6.2, kroki 1–3 i 5).
 *
 * Kwota planowana to **migawka** bieżącej kwoty reguły (07 §6.3). Zapis idempotentny:
 * brakujące terminy wylicza `missingDueDates`, a unikalny `(rule_id, due_on)` z `ON CONFLICT
 * DO NOTHING` łapie wyścig dwóch równoległych odczytów.
 *
 * Z `skipped` — wznowienie reguły: terminy z czasu wstrzymania zapisują się jako pominięte,
 * żeby ich nie dogenerować później jako zaległych.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param months - Miesiące do wygenerowania (okno albo jego część).
 * @param now - Chwila zapisu, epoch ms.
 * @param options - Zawężenie do jednej reguły i status zapisywanych wystąpień.
 * @param options.ruleId - Tylko ta reguła (po jej edycji albo wznowieniu).
 * @param options.skippedReason - Zapisz jako pominięte, z tym powodem.
 * @returns Liczba zapisanych wystąpień.
 */
function generateInWindow(
  handle: DbHandle,
  householdId: string,
  months: readonly MonthKey[],
  now: number,
  options: { ruleId?: string; skippedReason?: string } = {},
): number {
  return handle.sqlite.transaction(() => {
    const rules = findActiveRulesWithRefs(handle, householdId, options.ruleId);
    if (rules.length === 0 || months.length === 0) return 0;

    const existing = new Map<string, ExistingOccurrence[]>();
    for (const row of findOccurrenceDates(handle, householdId, months)) {
      existing.set(row.ruleId, [...(existing.get(row.ruleId) ?? []), row]);
    }
    const status: OccurrenceStatus = options.skippedReason === undefined ? 'planned' : 'skipped';
    const rows = rules.flatMap(({ rule }) =>
      missingDueDates(rule, months, existing.get(rule.id) ?? []).map((due) => ({
        id: newId(),
        householdId,
        ruleId: rule.id,
        dueOn: due.dueOn,
        monthKey: due.monthKey,
        plannedAmountMinor: rule.amountMinor,
        status,
        skippedReason: options.skippedReason ?? null,
        createdAt: now,
        updatedAt: now,
      })),
    );
    const created = insertOccurrences(handle, rows);
    if (created > 0) markRecurringGeneration(handle, now);
    return created;
  })();
}

/**
 * Auto-księguje czekające wystąpienia reguł z `autoPost`, których termin nadszedł
 * (07 §6.2, krok 4; ADR-046).
 *
 * Każde w osobnej transakcji bazodanowej: wystąpienie, którego zaksięgować się nie da
 * (konto z archiwum, miesiąc poza oknem), zostaje `planned` i trafia do „Do zrobienia",
 * a pozostałe księgują się normalnie — odczyt dashboardu nie może paść przez jedną regułę.
 * Autorem transakcji jest osoba, której odczyt wyzwolił księgowanie.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor tworzonych transakcji.
 * @param calendar - „Dziś" i okno generowania.
 * @returns Liczba zaksięgowanych.
 */
function autoPostDue(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  calendar: HouseholdCalendar,
): number {
  let posted = 0;
  for (const occurrence of findAutoPostCandidates(
    handle,
    householdId,
    calendar.window.months,
    calendar.today,
  )) {
    try {
      handle.sqlite.transaction(() => {
        const found = findOccurrenceById(handle, householdId, occurrence.id);
        if (found !== undefined) postFound(handle, clock, householdId, userId, found, {});
      })();
      posted += 1;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }
  return posted;
}

/**
 * Doprowadza wystąpienia gospodarstwa do stanu na dziś: generuje brakujące w oknie
 * i auto-księguje te, których termin nadszedł (07 §6.2).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor transakcji z auto-księgowania.
 * @param calendar - „Dziś" i okno generowania.
 * @returns Liczba zapisanych wystąpień.
 */
function syncOccurrences(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  calendar: HouseholdCalendar,
): number {
  const created = generateInWindow(
    handle,
    householdId,
    calendar.window.months,
    clock.now().getTime(),
  );
  autoPostDue(handle, clock, householdId, userId, calendar);
  return created;
}

/**
 * Wystąpienia miesiąca z sumami — `GET /recurring/occurrences` (04 §9).
 *
 * - Miesiąc bieżący i wcześniejsze: najpierw generowanie okna i auto-księgowanie,
 *   potem odczyt z bazy.
 *   Miesiąc zamknięty pokazuje to, co w nim zostało zapisane — nic nowego nie dochodzi.
 * - Miesiąc przyszły: podgląd wyliczony z aktywnych reguł, bez zapisu (07 §6.2) —
 *   wystąpienia mają `id: null`, a kwota to bieżąca kwota reguły.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Osoba z tokenu — autor transakcji z auto-księgowania.
 * @param month - Oglądany miesiąc.
 * @returns Wystąpienia rosnąco po terminie i metadane z sumami.
 */
export function listOccurrences(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  month: MonthKey,
): { data: RecurringOccurrenceDto[]; meta: RecurringOccurrencesMeta } {
  const calendar = calendarOf(handle, clock, householdId);
  const { today, window } = calendar;
  const isPreview = month > window.currentMonth;

  let data: RecurringOccurrenceDto[];
  if (isPreview) {
    data = findActiveRulesWithRefs(handle, householdId)
      .flatMap((ref) =>
        occurrenceDatesForMonth(ref.rule, month).map((dueOn) =>
          toOccurrenceDto(
            {
              id: null,
              dueOn,
              monthKey: month,
              plannedAmountMinor: ref.rule.amountMinor,
              status: 'planned',
              postedAmountMinor: null,
              transactionId: null,
            },
            ref,
            false,
          ),
        ),
      )
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.ruleName.localeCompare(b.ruleName));
  } else {
    syncOccurrences(handle, clock, householdId, userId, calendar);
    data = findOccurrencesInMonth(handle, householdId, month).map(({ occurrence, ...ref }) =>
      toOccurrenceDto(occurrence, ref, isOverdue(occurrence.status, occurrence.dueOn, today)),
    );
  }
  return { data, meta: { month, isPreview, ...occurrenceTotals(data) } };
}

/**
 * Wymuszenie generacji — `POST /recurring/generate` (04 §9).
 *
 * Generuje całe okno, tak jak każdy odczyt. Miesiąc spoza okna to błąd, a nie cisza:
 * przyszłość nie jest zapisywana (07 §6.2), a zamkniętego miesiąca nie wolno zmieniać
 * (07 §1.4) — wywołujący powinien wiedzieć, że nic się nie stało.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Osoba z tokenu — autor transakcji z auto-księgowania.
 * @param month - Miesiąc, o który prosi wywołujący.
 * @returns Liczba wystąpień zapisanych w oknie.
 * @throws {DomainRuleViolationError} Dla miesiąca przyszłego albo zamkniętego.
 */
export function generateOccurrences(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  month: MonthKey,
): GenerateOccurrencesResultDto {
  const calendar = calendarOf(handle, clock, householdId);
  const { today, window, backPostingLimitMonths } = calendar;
  if (month > window.currentMonth) {
    throw new DomainRuleViolationError(
      `${capitalize(formatMonth(month))} to miesiąc przyszły — jego pozycje cykliczne są wyliczane z reguł, bez zapisu.`,
      [{ path: 'month', message: 'Miesiąc przyszły' }],
    );
  }
  if (month < window.fromMonth) {
    const earliest = formatDateOnly(earliestPostableDate(today, backPostingLimitMonths));
    throw new DomainRuleViolationError(
      `${capitalize(formatMonth(month))} jest zamknięty — nowe pozycje cykliczne powstają od ${earliest}. Zmień limit w ustawieniach.`,
      [{ path: 'month', message: 'Miesiąc zamknięty' }],
    );
  }
  return { month, createdCount: syncOccurrences(handle, clock, householdId, userId, calendar) };
}

/**
 * Wielka litera na początku zdania („wrzesień 2026" → „Wrzesień 2026").
 *
 * @param text - Tekst.
 * @returns Tekst z wielką pierwszą literą.
 */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Najbliższe terminy reguły od dziś. Wstrzymana nie ma terminów — nie powstaną.
 *
 * @param row - Wiersz reguły.
 * @param today - Dzisiejsza data.
 * @param count - Ile terminów.
 * @returns Daty rosnąco.
 */
function upcoming(row: RecurringRuleRow, today: string, count: number): string[] {
  return row.isActive ? upcomingDueDates(row, today, count) : [];
}

/**
 * Wiersz na DTO z najbliższym terminem.
 *
 * @param row - Wiersz reguły.
 * @param today - Dzisiejsza data.
 * @returns DTO.
 */
function toDto(row: RecurringRuleRow, today: string): RecurringRuleDto {
  return toRecurringRuleDto(row, upcoming(row, today, 1)[0] ?? null);
}

/**
 * Zwraca regułę albo rzuca `404`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param ruleId - Identyfikator reguły.
 * @returns Wiersz.
 * @throws {NotFoundError} Gdy reguły nie ma w gospodarstwie.
 */
function requireRule(handle: DbHandle, householdId: string, ruleId: string): RecurringRuleRow {
  const row = findRecurringRuleById(handle, householdId, ruleId);
  if (row === undefined) throw new NotFoundError(NOT_FOUND);
  return row;
}

/**
 * Sprawdza kształt reguły po scaleniu i rzuca `422` z listą problemów.
 *
 * @param rule - Reguła w pełnym kształcie.
 * @throws {DomainRuleViolationError} Gdy reguła łamie I-2, I-3, I-7a albo terminarz.
 */
function assertShape(rule: RecurringRuleShape): void {
  const issues = recurringRuleShapeIssues(rule);
  const [first] = issues;
  if (first !== undefined) throw new DomainRuleViolationError(`${first.message}.`, issues);
}

/**
 * Lista reguł gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu (najbliższy termin).
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Filtry.
 * @returns Reguły: aktywne przed wstrzymanymi, po nazwie.
 */
export function listRecurringRules(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  query: ListRecurringRulesQuery,
): RecurringRuleDto[] {
  const today = todayOf(handle, clock, householdId);
  return findRecurringRules(handle, householdId, query).map((row) => toDto(row, today));
}

/**
 * Szczegóły reguły z podglądem najbliższych terminów (04 §9).
 *
 * Terminy są wyliczane z terminarza, nie czytane z wystąpień — podgląd przyszłości
 * nie zapisuje niczego do bazy (07 §6.2).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param ruleId - Identyfikator reguły.
 * @returns Reguła z najbliższymi terminami.
 * @throws {NotFoundError} Gdy reguły nie ma w gospodarstwie.
 */
export function getRecurringRule(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  ruleId: string,
): RecurringRuleDetailDto {
  const row = requireRule(handle, householdId, ruleId);
  const today = todayOf(handle, clock, householdId);
  const dates = upcoming(row, today, UPCOMING_COUNT);
  return { ...toRecurringRuleDto(row, dates[0] ?? null), upcomingDueDates: dates };
}

/**
 * Zakłada regułę.
 *
 * Kolejność sprawdzeń jak przy transakcji: najpierw kształt (`422`), potem odwołania
 * (`404` dla cudzych, `422` dla archiwum i złego rodzaju kategorii).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Pola nowej reguły.
 * @returns Zapisana reguła.
 * @throws {DomainRuleViolationError} Przy naruszeniu kształtu, terminarza albo odwołań.
 * @throws {NotFoundError} Gdy wskazany byt nie należy do gospodarstwa.
 */
export function createRecurringRule(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  input: CreateRecurringRuleRequest,
): RecurringRuleDto {
  const row = insertCheckedRule(handle, householdId, input, clock.now().getTime());
  return toDto(row, todayOf(handle, clock, householdId));
}

/**
 * Sprawdza i zapisuje regułę — wspólne dla `POST /recurring/rules` i „Zapisz jako wydatek
 * stały".
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Pola nowej reguły.
 * @param now - Chwila zapisu, epoch ms.
 * @returns Zapisany wiersz.
 * @throws {DomainRuleViolationError} Przy naruszeniu kształtu, terminarza albo odwołań.
 * @throws {NotFoundError} Gdy wskazany byt nie należy do gospodarstwa.
 */
function insertCheckedRule(
  handle: DbHandle,
  householdId: string,
  input: CreateRecurringRuleRequest,
  now: number,
): RecurringRuleRow {
  const rule = recurringRuleFromRequest(input);
  assertShape(rule);
  checkTransactionReferences(handle, householdId, rule.flow, rule);
  return insertRecurringRule(handle, {
    id: newId(),
    householdId,
    ...rule,
    createdAt: now,
    updatedAt: now,
  });
}

/** Powód pominięcia terminów sprzed płatności, z której powstała reguła. */
const BEFORE_SOURCE_REASON = 'Przed zapisaniem pozycji cyklicznej';

/**
 * Zalicza transakcję źródłową jako zaksięgowanie wystąpienia jej miesiąca (ADR-051).
 *
 * Bez tego czynsz zapisany jako stały 10 września pokazałby się od razu w „Do zrobienia"
 * — do zapłacenia drugi raz. Wystąpienie to termin miesiąca najbliższy dacie transakcji
 * (`sourcePaymentDueOn`, ten sam co podgląd w formularzu);
 * przy regule tygodniowej wcześniejsze terminy tego miesiąca zapisują się jako pominięte
 * (reguły wtedy jeszcze nie było), późniejsze generują się zwyczajnie. Miesiąc zamknięty
 * — nic: tam wystąpienia nie powstają (ADR-045).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param rule - Nowa reguła.
 * @param tx - Transakcja źródłowa.
 * @param now - Chwila zapisu, epoch ms.
 */
function linkSourcePayment(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  rule: RecurringRuleRow,
  tx: TransactionListItemDto,
  now: number,
): void {
  const { window } = calendarOf(handle, clock, householdId);
  if (!window.months.includes(tx.monthKey)) return;
  const paidOn = sourcePaymentDueOn(rule, tx.monthKey, tx.bookedOn);
  if (paidOn === undefined) return;

  const occurrenceId = newId();
  const base = {
    householdId,
    ruleId: rule.id,
    monthKey: tx.monthKey,
    plannedAmountMinor: rule.amountMinor,
    createdAt: now,
    updatedAt: now,
  };
  insertOccurrences(handle, [
    ...occurrenceDatesForMonth(rule, tx.monthKey)
      .filter((dueOn) => dueOn < paidOn)
      .map((dueOn) => ({
        ...base,
        id: newId(),
        dueOn,
        status: 'skipped' as const,
        skippedReason: BEFORE_SOURCE_REASON,
      })),
    {
      ...base,
      id: occurrenceId,
      dueOn: paidOn,
      status: 'posted',
      transactionId: tx.id,
      postedAmountMinor: tx.amountMinor,
      postedAt: now,
    },
  ]);
  linkTransactionToOccurrence(handle, householdId, tx.id, occurrenceId, now);
}

/**
 * „Zapisz jako wydatek stały" — reguła z istniejącej transakcji
 * (`POST /transactions/:id/save-as-recurring`, wymaganie #3, `F4-8`, ADR-051).
 *
 * Kwota, konta, kategoria, źródło, cel i zobowiązanie pochodzą z transakcji; terminarz —
 * z żądania albo z daty transakcji (`recurringRuleFromTransaction`). Reguła przechodzi te
 * same sprawdzenia co `POST /recurring/rules`. Transakcja staje się zaksięgowaniem
 * wystąpienia swojego miesiąca, a rata zobowiązania bez reguły — jego regułą raty
 * (ADR-047). Wszystko w jednej transakcji bazodanowej.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param transactionId - Transakcja źródłowa.
 * @param input - Terminarz i ustawienia reguły.
 * @returns Nowa reguła.
 * @throws {NotFoundError} Gdy transakcji nie ma w gospodarstwie.
 * @throws {ConflictError} Transakcja w koszu, już z reguły, albo rata zobowiązania, które
 *   ma regułę.
 * @throws {DomainRuleViolationError} Przy naruszeniu kształtu, terminarza albo odwołań.
 */
export function saveTransactionAsRecurring(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  transactionId: string,
  input: SaveAsRecurringRequest,
): RecurringRuleDto {
  const now = clock.now().getTime();
  const row = handle.sqlite.transaction(() => {
    const tx = getTransaction(handle, householdId, transactionId);
    if (tx.deletedAt !== null) {
      throw new ConflictError(
        'Transakcja jest w koszu. Przywróć ją, zanim zapiszesz ją jako stałą.',
      );
    }
    if (tx.recurringOccurrenceId !== null) {
      throw new ConflictError('Ta transakcja już pochodzi z pozycji cyklicznej.');
    }
    const liabilityId = tx.liabilityId;
    if (liabilityId !== null && liabilityRuleId(handle, householdId, liabilityId) != null) {
      // Druga reguła dawałaby dwie raty do zapłacenia w każdym miesiącu.
      throw new ConflictError(
        'To zobowiązanie ma już pozycję cykliczną na ratę — zmień ją w pozycjach cyklicznych.',
      );
    }

    const rule = insertCheckedRule(
      handle,
      householdId,
      recurringRuleFromTransaction(tx, input),
      now,
    );
    if (liabilityId !== null) adoptLiabilityRule(handle, householdId, liabilityId, rule.id, now);
    linkSourcePayment(handle, clock, householdId, rule, tx, now);
    return rule;
  })();
  return toDto(row, todayOf(handle, clock, householdId));
}

/** Pola odwołań — sprawdzane tylko wtedy, gdy edycja je zmienia. */
const REFERENCE_FIELDS = [
  'accountId',
  'counterAccountId',
  'categoryId',
  'incomeSourceId',
  'goalId',
  'liabilityId',
] as const;

/**
 * Przenosi edycję reguły na jej czekające wystąpienia (07 §6.4, ADR-045).
 *
 * - Terminarz (częstotliwość, dzień, okres…): wystąpienia `planned` od bieżącego miesiąca
 *   i spoza nowego okresu obowiązywania są usuwane, okno generowane na nowo.
 * - Kwota: czekające od bieżącego miesiąca dostają nową kwotę. Zaległe z wcześniejszych
 *   miesięcy zachowują migawkę (07 §6.3) — tamten czynsz był w tamtej wysokości.
 * - Kategoria, konta, nazwa: nic do zrobienia — wystąpienie ich nie przechowuje,
 *   bierze z reguły; zaksięgowane mają je we własnej transakcji.
 *
 * Zaksięgowane i pominięte zostają nietknięte.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param before - Reguła przed zmianą.
 * @param after - Reguła po zmianie.
 */
function applyRuleChangeToOccurrences(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  before: RecurringRuleRow,
  after: RecurringRuleRow,
): void {
  const { window } = calendarOf(handle, clock, householdId);
  const now = clock.now().getTime();
  if (after.amountMinor !== before.amountMinor) {
    updatePlannedAmount(handle, householdId, after.id, window.currentMonth, after.amountMinor, now);
  }
  if (scheduleChanged(before, after)) {
    deletePlannedOccurrences(handle, householdId, after.id, {
      fromMonth: window.currentMonth,
      beforeMonth: after.startMonth,
      afterMonth: after.endMonth,
    });
    generateInWindow(handle, householdId, window.months, now, { ruleId: after.id });
  }
}

/**
 * Zmienia regułę.
 *
 * Reguła jest sprawdzana **po scaleniu** z bieżącym stanem — sam `PATCH` nie zna `flow`.
 * Zmiana częstotliwości, dnia tygodnia albo miesiąca startu bez podanej kotwicy wylicza
 * ją na nowo (`defaultAnchorDate`): stara kotwica `biweekly` wypadałaby w inny dzień
 * tygodnia niż nowy. Zmieniane są wyłącznie pola, które się różnią. Skutki dla
 * wystąpień (07 §6.4) — w tej samej transakcji bazodanowej.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param ruleId - Identyfikator reguły.
 * @param input - Zmiany.
 * @returns Reguła po zmianie.
 * @throws {NotFoundError} Gdy reguły albo wskazanego bytu nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Przy naruszeniu kształtu, terminarza albo odwołań.
 */
export function updateRecurringRule(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  ruleId: string,
  input: UpdateRecurringRuleRequest,
): RecurringRuleDto {
  const now = clock.now().getTime();
  const updated = handle.sqlite.transaction(() => {
    const current = requireRule(handle, householdId, ruleId);
    const defined = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as UpdateRecurringRuleRequest;

    const merged = { ...current, ...defined };
    const scheduleChanged =
      merged.frequency !== current.frequency ||
      merged.weekday !== current.weekday ||
      merged.startMonth !== current.startMonth;
    const next = normalizeSchedule({
      ...merged,
      anchorDate:
        defined.anchorDate ?? (scheduleChanged ? defaultAnchorDate(merged) : current.anchorDate),
    });
    assertShape(next);

    const patch: RecurringRulePatch = {};
    const refs: { -readonly [K in keyof ReferenceChanges]: ReferenceChanges[K] } = {};
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      if (key === 'flow' || !(key in current)) continue;
      const value = next[key];
      if (value === current[key as keyof RecurringRuleRow]) continue;
      Object.assign(patch, { [key]: value });
      if ((REFERENCE_FIELDS as readonly string[]).includes(key)) {
        Object.assign(refs, { [key]: value });
      }
    }
    if (Object.keys(patch).length === 0) return current;

    checkTransactionReferences(handle, householdId, current.flow, refs);
    const row = patchRecurringRule(handle, householdId, ruleId, patch, now);
    if (row === undefined) throw new NotFoundError(NOT_FOUND);
    applyRuleChangeToOccurrences(handle, clock, householdId, current, row);
    return row;
  })();
  return toDto(updated, todayOf(handle, clock, householdId));
}

/**
 * Wstrzymuje albo wznawia regułę. Idempotentne.
 *
 * Wstrzymana reguła nie tworzy nowych wystąpień; istniejące `planned` zostają (07 §6.4).
 * Przy wznowieniu brakujące terminy **wcześniejszych** miesięcy okna zapisują się jako
 * pominięte (ADR-045): siłownia wstrzymana na sierpień i wznowiona 5 września nie może
 * pokazać zaległej opłaty za sierpień. Bieżący miesiąc generuje się zwyczajnie.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param ruleId - Identyfikator reguły.
 * @param isActive - `false` — wstrzymaj, `true` — wznów.
 * @returns Reguła po zmianie.
 * @throws {NotFoundError} Gdy reguły nie ma w gospodarstwie.
 */
export function setRecurringRuleActive(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  ruleId: string,
  isActive: boolean,
): RecurringRuleDto {
  const now = clock.now().getTime();
  const row = handle.sqlite.transaction(() => {
    const current = requireRule(handle, householdId, ruleId);
    if (current.isActive === isActive) return current;
    const patched = patchRecurringRule(handle, householdId, ruleId, { isActive }, now);
    if (patched !== undefined && isActive) {
      const { window } = calendarOf(handle, clock, householdId);
      generateInWindow(
        handle,
        householdId,
        window.months.filter((month) => month < window.currentMonth),
        now,
        { ruleId, skippedReason: PAUSED_REASON },
      );
    }
    return patched;
  })();
  if (row === undefined) throw new NotFoundError(NOT_FOUND);
  return toDto(row, todayOf(handle, clock, householdId));
}

/**
 * Usuwa regułę razem z wystąpieniami. Zaksięgowane transakcje zostają w księdze jako
 * zwykłe (07 §6.4, §10).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param ruleId - Identyfikator reguły.
 * @throws {NotFoundError} Gdy reguły nie ma w gospodarstwie.
 */
export function deleteRecurringRule(handle: DbHandle, householdId: string, ruleId: string): void {
  if (!removeRecurringRule(handle, householdId, ruleId)) throw new NotFoundError(NOT_FOUND);
}

/** Komunikat dla wystąpienia spoza gospodarstwa albo nieistniejącego — celowo ten sam. */
const OCCURRENCE_NOT_FOUND = 'Nie znaleziono pozycji do zaksięgowania.';

/**
 * Zwraca wystąpienie z regułą albo rzuca `404`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param occurrenceId - Identyfikator wystąpienia.
 * @returns Wystąpienie z regułą.
 * @throws {NotFoundError} Gdy wystąpienia nie ma w gospodarstwie.
 */
function requireOccurrence(
  handle: DbHandle,
  householdId: string,
  occurrenceId: string,
): OccurrenceWithRule {
  const found = findOccurrenceById(handle, householdId, occurrenceId);
  if (found === undefined) throw new NotFoundError(OCCURRENCE_NOT_FOUND);
  return found;
}

/**
 * DTO wystąpienia prosto z bazy — po zmianie, z nazwą kategorii i klasami kont.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu (zaległość).
 * @param householdId - Gospodarstwo z tokenu.
 * @param occurrenceId - Identyfikator wystąpienia.
 * @returns Wystąpienie.
 * @throws {NotFoundError} Gdy wystąpienie zniknęło (reguła usunięta w międzyczasie).
 */
function occurrenceDto(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  occurrenceId: string,
): RecurringOccurrenceDto {
  const { occurrence, ...ref } = requireOccurrence(handle, householdId, occurrenceId);
  const today = todayOf(handle, clock, householdId);
  return toOccurrenceDto(occurrence, ref, isOverdue(occurrence.status, occurrence.dueOn, today));
}

/**
 * Miesiące do unieważnienia po zmianie wystąpienia: jego miesiąc i miesiąc transakcji.
 *
 * @param months - Klucze miesięcy, mogą się powtarzać.
 * @returns Klucze bez powtórzeń, rosnąco.
 */
function uniqueMonths(...months: string[]): string[] {
  return [...new Set(months)].sort();
}

/**
 * Księguje znalezione wystąpienie — wspólne dla `POST /:id/post` i auto-księgowania.
 *
 * Transakcja dziedziczy z reguły konta, kategorię, źródło, cel, zobowiązanie
 * i nadpisanie alokacji; opisem jest nazwa reguły (07 §6.5). Powstaje przez
 * `createTransaction` — te same niezmienniki, odwołania i okno księgowania co wpisana
 * ręcznie. Wystąpienie pominięte też można zaksięgować: „jednak zapłaciłem" (ADR-046).
 * Nie otwiera transakcji bazodanowej — granicę wyznacza wołający.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor transakcji.
 * @param found - Wystąpienie z regułą.
 * @param input - Kwota, data, konto i notatka, gdy różnią się od planu.
 * @returns Wystąpienie po zmianie i utworzona transakcja z miesiącem.
 * @throws {ConflictError} Gdy wystąpienie jest już zaksięgowane.
 * @throws {DomainRuleViolationError} Gdy reguła nie ma konta albo transakcja łamie niezmienniki.
 * @throws {NotFoundError} Gdy wskazane konto nie należy do gospodarstwa.
 */
function postFound(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  found: OccurrenceWithRule,
  input: PostOccurrenceRequest,
): { occurrence: RecurringOccurrenceRow; transaction: PostOccurrenceResultDto['transaction'] } {
  const { occurrence, rule } = found;
  if (occurrence.status === 'posted') {
    throw new ConflictError(
      'Ta pozycja jest już zaksięgowana. Cofnij zaksięgowanie, jeśli chcesz ją zmienić.',
    );
  }
  const accountId = input.accountId ?? rule.accountId;
  if (accountId === null) {
    // Reguła sprzed ADR-044, której konto usunięto: nie ma skąd zapłacić.
    throw new DomainRuleViolationError(
      'Pozycja cykliczna nie ma konta — wskaż konto przy księgowaniu albo w regule.',
      [{ path: 'accountId', message: 'Wybierz konto' }],
    );
  }
  const now = clock.now().getTime();
  const { data: transaction } = createTransaction(
    handle,
    clock,
    householdId,
    userId,
    {
      type: rule.flow,
      bookedOn: input.bookedOn ?? occurrence.dueOn,
      amountMinor: input.amountMinor ?? occurrence.plannedAmountMinor,
      accountId,
      counterAccountId: rule.counterAccountId,
      categoryId: rule.categoryId,
      incomeSourceId: rule.incomeSourceId,
      liabilityId: rule.liabilityId,
      goalId: rule.goalId,
      allocationOverride: rule.allocationOverride,
      description: rule.name,
      merchant: null,
      notes: input.notes ?? null,
    },
    { source: 'recurring', recurringOccurrenceId: occurrence.id },
  );
  const updated = setOccurrenceStatus(
    handle,
    householdId,
    occurrence.id,
    {
      status: 'posted',
      transactionId: transaction.id,
      postedAmountMinor: transaction.amountMinor,
      postedAt: now,
      skippedReason: null,
    },
    now,
  );
  if (updated === undefined) throw new NotFoundError(OCCURRENCE_NOT_FOUND);
  return { occurrence: updated, transaction };
}

/**
 * Księguje wystąpienie — `POST /recurring/occurrences/:id/post` (07 §6.5).
 *
 * Idempotencję względem `Idempotency-Key` zapewnia trasa (`runIdempotent`); drugie
 * zaksięgowanie bez klucza kończy się `409`, nie drugą transakcją.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor transakcji z tokenu.
 * @param occurrenceId - Identyfikator wystąpienia.
 * @param input - Kwota, data, konto i notatka, gdy różnią się od planu.
 * @returns Wystąpienie, transakcja i miesiące do unieważnienia.
 * @throws {NotFoundError} Gdy wystąpienia albo wskazanego konta nie ma w gospodarstwie.
 * @throws {ConflictError} Gdy wystąpienie jest już zaksięgowane.
 * @throws {DomainRuleViolationError} Gdy transakcja łamie niezmienniki albo okno księgowania.
 */
export function postOccurrence(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  occurrenceId: string,
  input: PostOccurrenceRequest,
): { data: PostOccurrenceResultDto; meta: OccurrenceMutationMeta } {
  const { occurrence, transaction } = handle.sqlite.transaction(() =>
    postFound(
      handle,
      clock,
      householdId,
      userId,
      requireOccurrence(handle, householdId, occurrenceId),
      input,
    ),
  )();
  return {
    data: {
      occurrence: occurrenceDto(handle, clock, householdId, occurrence.id),
      transaction,
    },
    meta: { affectedMonths: uniqueMonths(occurrence.monthKey, transaction.monthKey) },
  };
}

/**
 * Pomija wystąpienie w tym miesiącu — `POST /recurring/occurrences/:id/skip`.
 *
 * Idempotentne. Zaksięgowanego pominąć nie można — najpierw trzeba cofnąć zaksięgowanie,
 * inaczej płatność zostałaby w księdze przy pozycji oznaczonej „nie było".
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param occurrenceId - Identyfikator wystąpienia.
 * @param input - Opcjonalny powód.
 * @returns Wystąpienie po zmianie.
 * @throws {NotFoundError} Gdy wystąpienia nie ma w gospodarstwie.
 * @throws {ConflictError} Gdy wystąpienie jest zaksięgowane.
 */
export function skipOccurrence(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  occurrenceId: string,
  input: SkipOccurrenceRequest,
): RecurringOccurrenceDto {
  handle.sqlite.transaction(() => {
    const { occurrence } = requireOccurrence(handle, householdId, occurrenceId);
    if (occurrence.status === 'posted') {
      throw new ConflictError('Ta pozycja jest zaksięgowana — najpierw cofnij zaksięgowanie.');
    }
    if (occurrence.status === 'skipped') return;
    setOccurrenceStatus(
      handle,
      householdId,
      occurrenceId,
      {
        status: 'skipped',
        transactionId: null,
        postedAmountMinor: null,
        postedAt: null,
        skippedReason: input.reason ?? null,
      },
      clock.now().getTime(),
    );
  })();
  return occurrenceDto(handle, clock, householdId, occurrenceId);
}

/**
 * Cofa zaksięgowanie — `POST /recurring/occurrences/:id/unpost` (07 §6.7, ADR-042).
 *
 * To **usunięcie transakcji** z zaksięgowania: kosz (z „Cofnij") i wystąpienie z powrotem
 * `planned` robi `deleteTransaction`, tą samą drogą co usunięcie z listy transakcji.
 * Zamknięty miesiąc blokuje usunięcie, więc blokuje też cofnięcie (`422`). Wystąpienie
 * niezaksięgowane — bez zmian (idempotentne).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param occurrenceId - Identyfikator wystąpienia.
 * @returns Wystąpienie po zmianie i miesiące do unieważnienia.
 * @throws {NotFoundError} Gdy wystąpienia nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Gdy transakcja leży w zamkniętym miesiącu.
 */
export function unpostOccurrence(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  occurrenceId: string,
): { data: RecurringOccurrenceDto; meta: OccurrenceMutationMeta } {
  const months = handle.sqlite.transaction(() => {
    const { occurrence } = requireOccurrence(handle, householdId, occurrenceId);
    if (occurrence.status !== 'posted' || occurrence.transactionId === null) {
      return [occurrence.monthKey];
    }
    const { monthKey } = getTransaction(handle, householdId, occurrence.transactionId);
    deleteTransaction(handle, clock, householdId, occurrence.transactionId);
    return uniqueMonths(occurrence.monthKey, monthKey);
  })();
  return {
    data: occurrenceDto(handle, clock, householdId, occurrenceId),
    meta: { affectedMonths: months },
  };
}

/**
 * Księguje najbliższą czekającą ratę zobowiązania z reguły cyklicznej — wejście dla
 * `POST /liabilities/:id/payments` (ADR-047).
 *
 * Bez tego rata zapłacona z ekranu zobowiązań dawała transakcję obok czekającego
 * wystąpienia tej samej raty — i drugi raz do zapłaty w „Do zrobienia". Najpierw
 * generowanie okna (wystąpienie mogło jeszcze nie powstać), potem najwcześniejsze
 * czekające. Nie otwiera transakcji bazodanowej — granicę wyznacza wołający.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor transakcji.
 * @param liabilityId - Zobowiązanie.
 * @param input - Kwota, data, konto i notatka, gdy różnią się od planu.
 * @returns Zaksięgowane wystąpienie z transakcją albo `null`, gdy żadne nie czeka.
 */
export function postNextLiabilityOccurrence(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  liabilityId: string,
  input: PostOccurrenceRequest,
): {
  occurrence: RecurringOccurrenceRow;
  transaction: PostOccurrenceResultDto['transaction'];
} | null {
  const { window } = calendarOf(handle, clock, householdId);
  generateInWindow(handle, householdId, window.months, clock.now().getTime());
  const id = findFirstPlannedForLiability(handle, householdId, liabilityId, window.months);
  if (id === undefined) return null;
  return postFound(
    handle,
    clock,
    householdId,
    userId,
    requireOccurrence(handle, householdId, id),
    input,
  );
}

/**
 * Sekcja pozycji cyklicznych na dashboardzie — „Do zrobienia" (`F4-7`, 07 §6.6, ADR-050).
 *
 * Sumy planu i wykonania — z listy wystąpień oglądanego miesiąca (ten sam kod co
 * `GET /recurring/occurrences`, więc generuje i auto-księguje). Do zrobienia — czekające
 * wystąpienia miesiąca, a w miesiącu **bieżącym** także zaległe z wcześniejszych miesięcy
 * okna: niezapłacony sierpniowy czynsz nie może zniknąć z pola widzenia po przejściu na
 * wrzesień. Zaległości spoza okna (miesiące zamknięte) nie trafiają tu — tamtych liczb
 * nie wolno już zmieniać (07 §1.4).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Osoba z tokenu — autor transakcji z auto-księgowania.
 * @param month - Oglądany miesiąc.
 * @returns Sekcja pozycji cyklicznych.
 */
export function recurringSectionForMonth(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  month: MonthKey,
): MonthRecurringSectionDto {
  const { data, meta } = listOccurrences(handle, clock, householdId, userId, month);
  const calendar = calendarOf(handle, clock, householdId);
  const earlier =
    month === calendar.window.currentMonth
      ? calendar.window.months
          .filter((key) => key < month)
          .flatMap((key) => findOccurrencesInMonth(handle, householdId, key))
          .filter(({ occurrence }) => occurrence.status === 'planned')
          .map(({ occurrence, ...ref }) =>
            toOccurrenceDto(
              occurrence,
              ref,
              isOverdue(occurrence.status, occurrence.dueOn, calendar.today),
            ),
          )
      : [];
  const items = [...earlier, ...data.filter((item) => item.status === 'planned')];
  return {
    plannedTotalMinor: meta.plannedTotalMinor,
    postedTotalMinor: meta.postedTotalMinor,
    pendingCount: items.length,
    overdueCount: items.filter((item) => item.isOverdue).length,
    items,
  };
}
