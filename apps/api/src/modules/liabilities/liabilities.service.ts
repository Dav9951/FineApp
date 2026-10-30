import {
  firstInstallmentMonth,
  firstInstallmentOn,
  formatDateOnly,
  liabilityIssues,
  liabilitySchedule,
  liabilityState,
  monthKeyOf,
  monthsDiff,
  shiftMonth,
  todayInTimezone,
  type CreateLiabilityRequest,
  type LiabilityDetailDto,
  type LiabilityDto,
  type LiabilityPaymentRequest,
  type LiabilityPaymentResultDto,
  type LiabilityTerms,
  type ListLiabilitiesQuery,
  type MonthKey,
  type MonthLiabilitiesSectionDto,
  type RebaseLiabilityRequest,
  type ScheduledInstallmentDto,
  type TransactionMutationMeta,
  type UpdateLiabilityRequest,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import { ConflictError, DomainRuleViolationError, NotFoundError } from '../../core/errors.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import type { LiabilityRow } from '../../db/schema/liabilities.js';
import { lookupAccount } from '../accounts/accounts.service.js';
import { getHousehold } from '../auth/auth.service.js';
import { pauseRecurringRulesForLiability } from '../recurring/recurring.external.js';
import {
  createRecurringRule,
  getRecurringRule,
  postNextLiabilityOccurrence,
  updateRecurringRule,
} from '../recurring/recurring.service.js';
import { liabilityPayments, type LiabilityPayments } from '../transactions/transactions.ledger.js';
import { checkTransactionReferences } from '../transactions/transactions.references.js';
import { createTransaction, listTransactions } from '../transactions/transactions.service.js';
import { toLiabilityDto } from './liabilities.mapper.js';
import {
  findLiabilities,
  findLiabilityById,
  insertLiability,
  patchLiability,
  removeLiability,
  type LiabilityPatch,
} from './liabilities.repository.js';

/**
 * Zobowiązania — zadanie `F4-4`
 * ([04 §8](../../../../../../plans/04-api-spec.md#8-zobowiązania--apiv1liabilities),
 * [07 §5](../../../../../../plans/07-domain-rules.md#5-zobowiązania), ADR-047).
 *
 * Stan nie jest zapisywany: `liabilityState` z `shared` liczy go przy każdym odczycie
 * z punktu odniesienia i rat w księdze (07 §5.1). Rata to zwykły wydatek z `liabilityId`,
 * tworzony przez serwis transakcji — te same niezmienniki i okno księgowania.
 */

/** Komunikat dla zobowiązania spoza gospodarstwa albo nieistniejącego — celowo ten sam. */
const NOT_FOUND = 'Nie znaleziono zobowiązania.';

/** Ile ostatnich rat pokazują szczegóły. */
const PAYMENTS_LIMIT = 24;

/** Brak rat — dla zobowiązania bez żadnej płatności. */
const NO_PAYMENTS: LiabilityPayments = {
  liabilityId: '',
  paidSinceAsOfMinor: 0,
  paidInMonth: 0,
  paidInMonthMinor: 0,
  lastPaymentOn: null,
};

/** Koniec zakresu dat — stan „na dziś" liczy wszystkie raty z księgi. */
const ALL_DATES = '9999-12-31';

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

/**
 * Warunki zobowiązania z wiersza.
 *
 * @param row - Wiersz zobowiązania albo jego DTO.
 * @returns Warunki dla funkcji stanu.
 */
function termsOf(
  row: Pick<
    LiabilityRow,
    'openingBalanceMinor' | 'balanceAsOf' | 'monthlyPaymentMinor' | 'paymentDay' | 'firstPaymentOn'
  >,
): LiabilityTerms {
  return {
    openingBalanceMinor: row.openingBalanceMinor,
    balanceAsOf: row.balanceAsOf,
    monthlyPaymentMinor: row.monthlyPaymentMinor,
    paymentDay: row.paymentDay,
    firstPaymentOn: row.firstPaymentOn,
  };
}

/**
 * Płatności wszystkich zobowiązań gospodarstwa — jednym zapytaniem.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param today - Dzisiejsza data („zapłacono w tym miesiącu").
 * @returns Mapa zobowiązanie → płatności.
 */
function paymentsOf(
  handle: DbHandle,
  householdId: string,
  today: string,
): ReadonlyMap<string, LiabilityPayments> {
  return liabilityPayments(handle, householdId, monthKeyOf(today), ALL_DATES);
}

/**
 * Wiersz na DTO ze stanem.
 *
 * @param row - Wiersz zobowiązania.
 * @param payments - Płatności gospodarstwa.
 * @param today - Dzisiejsza data.
 * @returns DTO.
 */
function toDto(
  row: LiabilityRow,
  payments: ReadonlyMap<string, LiabilityPayments>,
  today: string,
): LiabilityDto {
  const paid = payments.get(row.id) ?? NO_PAYMENTS;
  const paidThisMonth = paid.paidInMonth === 1;
  const state = liabilityState(
    termsOf(row),
    { paidSinceAsOfMinor: paid.paidSinceAsOfMinor, paidThisMonth },
    today,
  );
  return toLiabilityDto(row, state, paidThisMonth, paid.lastPaymentOn);
}

/**
 * Jedno zobowiązanie jako DTO, prosto z bazy.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param row - Wiersz zobowiązania.
 * @returns DTO.
 */
function dtoOf(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  row: LiabilityRow,
): LiabilityDto {
  const today = todayOf(handle, clock, householdId);
  return toDto(row, paymentsOf(handle, householdId, today), today);
}

/**
 * Zwraca zobowiązanie albo rzuca `404`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param liabilityId - Identyfikator zobowiązania.
 * @returns Wiersz.
 * @throws {NotFoundError} Gdy zobowiązania nie ma w gospodarstwie.
 */
function requireLiability(
  handle: DbHandle,
  householdId: string,
  liabilityId: string,
): LiabilityRow {
  const row = findLiabilityById(handle, householdId, liabilityId);
  if (row === undefined) throw new NotFoundError(NOT_FOUND);
  return row;
}

/**
 * Sprawdza reguły między polami (`liabilityIssues`) i rzuca `422` z listą problemów.
 *
 * @param value - Pola zobowiązania (przy edycji — po scaleniu).
 * @throws {DomainRuleViolationError} Gdy pola się wykluczają.
 */
function assertIssues(value: Parameters<typeof liabilityIssues>[0]): void {
  const issues = liabilityIssues(value);
  const [first] = issues;
  if (first !== undefined) throw new DomainRuleViolationError(`${first.message}.`, issues);
}

/**
 * Sprawdza konto płatności i kategorię raty.
 *
 * Kategoria — tymi samymi regułami co w transakcji (musi być kategorią wydatków, spoza
 * archiwum): rata z niej powstanie. Konto — jak w transakcji, ale z polem
 * `paymentAccountId`, żeby formularz podświetlił właściwe pole.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param refs - Zmieniane odwołania; `undefined` i `null` nie są sprawdzane.
 * @param refs.paymentAccountId - Konto płatności.
 * @param refs.categoryId - Kategoria raty.
 * @throws {NotFoundError} Gdy konta albo kategorii nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Przy archiwum albo kategorii innego rodzaju.
 */
function checkReferences(
  handle: DbHandle,
  householdId: string,
  refs: { paymentAccountId?: string | null; categoryId?: string | null },
): void {
  if (refs.paymentAccountId) {
    const account = lookupAccount(handle, householdId, refs.paymentAccountId);
    if (account === undefined) {
      throw new NotFoundError('Nie znaleziono konta.', [
        { path: 'paymentAccountId', message: 'Nie znaleziono konta' },
      ]);
    }
    if (account.isArchived) {
      throw new DomainRuleViolationError(`Konto „${account.name}” jest zarchiwizowane.`, [
        { path: 'paymentAccountId', message: 'Konto jest zarchiwizowane' },
      ]);
    }
  }
  if (refs.categoryId) {
    checkTransactionReferences(handle, householdId, 'expense', { categoryId: refs.categoryId });
  }
}

/**
 * Lista zobowiązań ze stanem (04 §8).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Filtry.
 * @returns Zobowiązania: aktywne przed zamkniętymi, po nazwie.
 */
export function listLiabilities(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  query: ListLiabilitiesQuery,
): LiabilityDto[] {
  const today = todayOf(handle, clock, householdId);
  const payments = paymentsOf(handle, householdId, today);
  return findLiabilities(handle, householdId, query.isActive).map((row) =>
    toDto(row, payments, today),
  );
}

/**
 * Szczegóły zobowiązania z historią płatności (04 §8).
 *
 * Historia to transakcje z `liabilityId` — z listy transakcji, więc te same wiersze,
 * nazwy i filtr kosza co w historii.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param liabilityId - Identyfikator zobowiązania.
 * @returns Zobowiązanie z płatnościami, od najnowszej.
 * @throws {NotFoundError} Gdy zobowiązania nie ma w gospodarstwie.
 */
export function getLiability(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  liabilityId: string,
): LiabilityDetailDto {
  const row = requireLiability(handle, householdId, liabilityId);
  const payments = listTransactions(handle, householdId, {
    liabilityId: [liabilityId],
    type: ['expense'],
    limit: PAYMENTS_LIMIT,
    sort: 'bookedOn:desc',
    uncategorized: false,
    includeDeleted: false,
  });
  return { ...dtoOf(handle, clock, householdId, row), payments: payments.data };
}

/**
 * Zakłada zobowiązanie, opcjonalnie z regułą cykliczną na ratę (06 §3.8).
 *
 * Reguła: wydatek stały, miesięczny, z konta płatności, z kategorią i powiązaniem ze
 * zobowiązaniem (rata liczy się do `debt_repayment`, 07 §2.2a). Start — pierwsza rata
 * **po** dniu punktu odniesienia (`firstInstallmentMonth`): raty do tego dnia są już
 * w podanej kwocie. Koniec — miesiąc ostatniej raty z prognozy. Wszystko w jednej
 * transakcji bazodanowej: nieudana reguła cofa zobowiązanie.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Pola zobowiązania.
 * @returns Założone zobowiązanie.
 * @throws {DomainRuleViolationError} Przy wykluczających się polach albo odwołaniu do archiwum.
 * @throws {NotFoundError} Gdy konto albo kategoria nie należy do gospodarstwa.
 */
export function createLiability(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  input: CreateLiabilityRequest,
): LiabilityDto {
  const now = clock.now().getTime();
  const row = handle.sqlite.transaction(() => {
    assertIssues(input);
    checkReferences(handle, householdId, input);
    const created = insertLiability(handle, {
      id: newId(),
      householdId,
      name: input.name,
      kind: input.kind,
      creditor: input.creditor ?? null,
      openingBalanceMinor: input.openingBalanceMinor,
      balanceAsOf: input.balanceAsOf,
      monthlyPaymentMinor: input.monthlyPaymentMinor,
      installmentsTotal: input.installmentsTotal ?? null,
      installmentsRemainingAtAsOf: input.installmentsRemainingAtAsOf ?? null,
      interestRateBps: input.interestRateBps ?? null,
      paymentDay: input.paymentDay ?? null,
      firstPaymentOn: input.firstPaymentOn ?? null,
      paymentAccountId: input.paymentAccountId ?? null,
      categoryId: input.categoryId ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    });
    if (!input.createRecurringRule || !input.paymentAccountId || input.paymentDay == null) {
      return created;
    }

    const startMonth = firstInstallmentMonth(
      input.balanceAsOf,
      input.paymentDay,
      input.firstPaymentOn ?? null,
    );
    // Prognoza od pierwszej raty reguły: nic jeszcze nie zapłacono po punkcie odniesienia.
    const final = liabilityState(
      termsOf(created),
      { paidSinceAsOfMinor: 0, paidThisMonth: false },
      `${startMonth}-01`,
    ).projectedFinalPaymentOn;
    const rule = createRecurringRule(handle, clock, householdId, {
      name: input.name,
      flow: 'expense',
      amountMinor: input.monthlyPaymentMinor,
      amountIsEstimate: false,
      accountId: input.paymentAccountId,
      categoryId: input.categoryId ?? null,
      liabilityId: created.id,
      frequency: 'monthly',
      intervalCount: 1,
      dayOfMonth: input.paymentDay,
      startMonth,
      endMonth: final?.slice(0, 7) ?? null,
      autoPost: false,
      isFixedExpense: true,
      notes: null,
    });
    const linked = patchLiability(
      handle,
      householdId,
      created.id,
      { recurringRuleId: rule.id },
      now,
    );
    if (linked === undefined) throw new NotFoundError(NOT_FOUND);
    return linked;
  })();
  return dtoOf(handle, clock, householdId, row);
}

/** Pola, które edycja może zmienić — w kolejności z kontraktu. */
const EDITABLE_FIELDS = [
  'name',
  'kind',
  'creditor',
  'openingBalanceMinor',
  'balanceAsOf',
  'monthlyPaymentMinor',
  'installmentsTotal',
  'installmentsRemainingAtAsOf',
  'interestRateBps',
  'paymentDay',
  'firstPaymentOn',
  'paymentAccountId',
  'categoryId',
  'notes',
  'isActive',
] as const satisfies readonly (keyof UpdateLiabilityRequest & keyof LiabilityRow)[];

/**
 * Zmienia zobowiązanie.
 *
 * Zmieniane są wyłącznie pola, które się różnią; reguły między polami — po scaleniu.
 * Zamknięcie (`isActive: false`) wstrzymuje reguły spłacające zobowiązanie (ADR-047);
 * ponowne otwarcie ich nie wznawia — to decyzja o przyszłych płatnościach (jak ADR-044).
 * Reguła raty jest osobnym bytem: zmiana raty tutaj nie zmienia kwoty reguły.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param liabilityId - Identyfikator zobowiązania.
 * @param input - Zmiany.
 * @returns Zobowiązanie po zmianie.
 * @throws {NotFoundError} Gdy zobowiązania, konta albo kategorii nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Przy wykluczających się polach albo archiwum.
 */
export function updateLiability(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  liabilityId: string,
  input: UpdateLiabilityRequest,
): LiabilityDto {
  const now = clock.now().getTime();
  const row = handle.sqlite.transaction(() => {
    const current = requireLiability(handle, householdId, liabilityId);
    const patch: LiabilityPatch = {};
    for (const field of EDITABLE_FIELDS) {
      const value = input[field];
      if (value !== undefined && value !== current[field]) Object.assign(patch, { [field]: value });
    }
    if (Object.keys(patch).length === 0) return current;

    assertIssues({ ...current, ...patch });
    checkReferences(handle, householdId, patch);
    if (patch.isActive === false) {
      pauseRecurringRulesForLiability(handle, householdId, liabilityId, now);
    }
    const updated = patchLiability(handle, householdId, liabilityId, patch, now);
    if (updated === undefined) throw new NotFoundError(NOT_FOUND);
    if (patch.firstPaymentOn !== undefined) moveRuleStart(handle, clock, householdId, updated);
    return updated;
  })();
  return dtoOf(handle, clock, householdId, row);
}

/**
 * Przesuwa start reguły raty za zmienioną najbliższą ratą zobowiązania (ADR-068).
 *
 * Bez tego zobowiązanie przestawione na „od listopada" nadal miałoby w „Do zrobienia"
 * październikową ratę z reguły. Start liczy {@link firstInstallmentMonth} — ta sama
 * funkcja co przy zakładaniu, z dniem płatności reguły. Wystąpienia przed nowym startem
 * (od bieżącego miesiąca) usuwa, a brakujące dogenerowuje serwis reguł (07 §6.4). Koniec
 * reguły przesuwa się o tyle samo miesięcy — inaczej ucięłaby ostatnią ratę.
 * Reguła bez dnia miesiąca (nie miesięczna) zostaje bez zmian — to już świadoma
 * konfiguracja użytkownika na ekranie pozycji cyklicznych.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param liability - Zobowiązanie po zmianie.
 */
function moveRuleStart(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  liability: LiabilityRow,
): void {
  if (liability.recurringRuleId === null) return;
  const rule = getRecurringRule(handle, clock, householdId, liability.recurringRuleId);
  if (rule.dayOfMonth === null) return;
  const startMonth = firstInstallmentMonth(
    liability.balanceAsOf,
    rule.dayOfMonth,
    liability.firstPaymentOn,
  );
  if (startMonth === rule.startMonth) return;
  // Koniec przesuwa się o tyle samo: liczba rat się nie zmienia, zmienia się tylko start.
  const shift = monthsDiff(rule.startMonth, startMonth);
  updateRecurringRule(handle, clock, householdId, rule.id, {
    startMonth,
    ...(rule.endMonth === null ? {} : { endMonth: shiftMonth(rule.endMonth, shift) }),
  });
}

/**
 * Usuwa zobowiązanie. Raty zostają w księdze jako zwykłe wydatki (07 §10); reguły
 * spłacające je są wstrzymywane w tej samej transakcji bazodanowej (ADR-047).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param liabilityId - Identyfikator zobowiązania.
 * @throws {NotFoundError} Gdy zobowiązania nie ma w gospodarstwie.
 */
export function deleteLiability(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  liabilityId: string,
): void {
  handle.sqlite.transaction(() => {
    requireLiability(handle, householdId, liabilityId);
    pauseRecurringRulesForLiability(handle, householdId, liabilityId, clock.now().getTime());
    if (!removeLiability(handle, householdId, liabilityId)) throw new NotFoundError(NOT_FOUND);
  })();
}

/**
 * Korekta stanu z wyciągu — nowy punkt odniesienia bez ruszania historii (07 §5.2).
 *
 * Okres spłaty podany przy założeniu dotyczył starego punktu odniesienia, więc jest
 * czyszczony. Notatka korekty trafia na koniec notatek zobowiązania z datą wyciągu.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param liabilityId - Identyfikator zobowiązania.
 * @param input - Kwota z wyciągu i jej dzień.
 * @returns Zobowiązanie po korekcie.
 * @throws {NotFoundError} Gdy zobowiązania nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Gdy dzień wyciągu jest w przyszłości.
 */
export function rebaseLiability(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  liabilityId: string,
  input: RebaseLiabilityRequest,
): LiabilityDto {
  const today = todayOf(handle, clock, householdId);
  if (input.asOf > today) {
    throw new DomainRuleViolationError('Stan z wyciągu nie może dotyczyć przyszłego dnia.', [
      { path: 'asOf', message: 'Data w przyszłości' },
    ]);
  }
  const row = handle.sqlite.transaction(() => {
    const current = requireLiability(handle, householdId, liabilityId);
    const noteLine =
      input.note == null
        ? null
        : `Korekta z wyciągu (${formatDateOnly(input.asOf)}): ${input.note}`;
    const notes =
      noteLine === null ? current.notes : [current.notes, noteLine].filter(Boolean).join('\n');
    const updated = patchLiability(
      handle,
      householdId,
      liabilityId,
      {
        openingBalanceMinor: input.remainingMinor,
        balanceAsOf: input.asOf,
        installmentsRemainingAtAsOf: null,
        notes,
      },
      clock.now().getTime(),
    );
    if (updated === undefined) throw new NotFoundError(NOT_FOUND);
    return updated;
  })();
  return dtoOf(handle, clock, householdId, row);
}

/**
 * Prognozowany harmonogram spłaty od najbliższej raty (04 §8, 07 §5.1).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param liabilityId - Identyfikator zobowiązania.
 * @returns Raty rosnąco; pusta lista dla spłaconego albo bez dnia płatności.
 * @throws {NotFoundError} Gdy zobowiązania nie ma w gospodarstwie.
 */
export function getLiabilitySchedule(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  liabilityId: string,
): ScheduledInstallmentDto[] {
  const row = requireLiability(handle, householdId, liabilityId);
  const dto = dtoOf(handle, clock, householdId, row);
  return liabilitySchedule(termsOf(row), dto);
}

/**
 * Księguje ratę — `POST /liabilities/:id/payments` (04 §8, ADR-047).
 *
 * Gdy regułą spłacającą zobowiązanie czeka rata w oknie generowania — księgowane jest to
 * wystąpienie (inaczej ta sama rata byłaby do zapłaty drugi raz w „Do zrobienia").
 * W przeciwnym razie powstaje wydatek z `liabilityId`: rata z warunków, dziś, z konta
 * płatności. Idempotencję względem `Idempotency-Key` zapewnia trasa.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor transakcji z tokenu.
 * @param liabilityId - Identyfikator zobowiązania.
 * @param input - Kwota, data, konto i notatka, gdy różnią się od warunków.
 * @returns Zobowiązanie po racie, transakcja i miesiące do unieważnienia.
 * @throws {NotFoundError} Gdy zobowiązania albo konta nie ma w gospodarstwie.
 * @throws {ConflictError} Gdy zobowiązanie jest zamknięte.
 * @throws {DomainRuleViolationError} Gdy brak konta albo transakcja łamie niezmienniki.
 */
export function recordLiabilityPayment(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  liabilityId: string,
  input: LiabilityPaymentRequest,
): { data: LiabilityPaymentResultDto; meta: TransactionMutationMeta } {
  const { row, transaction, months } = handle.sqlite.transaction(() => {
    const current = requireLiability(handle, householdId, liabilityId);
    if (!current.isActive) {
      throw new ConflictError('Zobowiązanie jest zamknięte — otwórz je, żeby zaksięgować ratę.');
    }
    const viaRule = postNextLiabilityOccurrence(
      handle,
      clock,
      householdId,
      userId,
      liabilityId,
      input,
    );
    if (viaRule !== null) {
      return {
        row: current,
        transaction: viaRule.transaction,
        months: [viaRule.occurrence.monthKey, viaRule.transaction.monthKey],
      };
    }

    const accountId = input.accountId ?? current.paymentAccountId;
    if (accountId === null) {
      throw new DomainRuleViolationError(
        'Zobowiązanie nie ma konta płatności — wskaż konto, z którego zapłacono ratę.',
        [{ path: 'accountId', message: 'Wybierz konto' }],
      );
    }
    const { data } = createTransaction(handle, clock, householdId, userId, {
      type: 'expense',
      bookedOn: input.bookedOn ?? todayOf(handle, clock, householdId),
      amountMinor: input.amountMinor ?? current.monthlyPaymentMinor,
      accountId,
      categoryId: current.categoryId,
      liabilityId,
      description: current.name,
      notes: input.notes ?? null,
    });
    return { row: current, transaction: data, months: [data.monthKey] };
  })();
  return {
    data: { liability: dtoOf(handle, clock, householdId, row), transaction },
    meta: { affectedMonths: [...new Set(months)].sort() },
  };
}

/**
 * Sekcja zobowiązań na dashboardzie miesiąca (`F4-7`, ADR-050).
 *
 * Stan zobowiązań (pozostało, najbliższa rata) jest na **dziś** — to liczba, którą widać
 * na ekranie zobowiązań. Z oglądanym miesiącem związane są tylko raty w nim zaksięgowane
 * i licznik niezapłaconych: przy przeglądaniu sierpnia widać, czy sierpniowe raty poszły.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Oglądany miesiąc.
 * @returns Sekcja zobowiązań.
 */
export function liabilitiesSectionForMonth(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  month: MonthKey,
): MonthLiabilitiesSectionDto {
  const items = listLiabilities(handle, clock, householdId, { isActive: true });
  const inMonth = liabilityPayments(handle, householdId, month, ALL_DATES);
  const paidIn = (id: string): number => inMonth.get(id)?.paidInMonthMinor ?? 0;
  const owing = items.filter((item) => item.remainingMinor > 0);
  // Niezapłacona może być tylko rata, która w tym miesiącu już przypada — zobowiązanie
  // spłacane od listopada nie ma zaległości we wrześniu (ADR-068).
  const dueBy = (item: LiabilityDto): boolean => {
    const first = firstInstallmentOn(termsOf(item));
    return first === null || first.slice(0, 7) <= month;
  };
  return {
    totalRemainingMinor: items.reduce((sum, item) => sum + item.remainingMinor, 0),
    monthlyPaymentTotalMinor: owing.reduce((sum, item) => sum + item.monthlyPaymentMinor, 0),
    paidThisMonthMinor: items.reduce((sum, item) => sum + paidIn(item.id), 0),
    unpaidCount: owing.filter((item) => dueBy(item) && paidIn(item.id) === 0).length,
    items,
  };
}
