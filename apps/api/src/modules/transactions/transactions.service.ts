import {
  closedMonthMessage,
  foldForSearch,
  frozenFieldChanges,
  isInClosedMonth,
  monthKeyOf,
  todayInTimezone,
  transactionShapeIssues,
  type ClosedMonthOperation,
  type CreateTransactionRequest,
  type TransactionListMeta,
  type TransactionDto,
  type TransactionListItemDto,
  type TransactionMutationMeta,
  type TransactionQuery,
  type TransactionShape,
  type UpdateTransactionRequest,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import {
  AppError,
  ConflictError,
  DomainRuleViolationError,
  isAppError,
  NotFoundError,
} from '../../core/errors.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import type { TransactionRow } from '../../db/schema/transactions.js';
import { getHousehold } from '../auth/auth.service.js';
import {
  relinkOccurrenceOfTransaction,
  syncPostedAmount,
  unpostOccurrenceOfTransaction,
} from '../recurring/recurring.external.js';
import {
  relinkPlannedOfTransaction,
  syncPlannedPostedAmount,
  unpostPlannedOfTransaction,
} from '../planned-expenses/planned-expenses.external.js';
import { checkTransactionReferences } from './transactions.references.js';
import {
  toTransactionDto,
  toTransactionListItemDto,
  toTransactionListSummaryDto,
} from './transactions.mapper.js';
import {
  findTransactionById,
  findTransactionListItem,
  findTransactionPage,
  summarizeTransactionList,
  insertTransactionRow,
  patchTransaction,
  type TransactionPatch,
} from './transactions.repository.js';
import {
  affectedMonths,
  decodeCursor,
  encodeCursor,
  postingWindowViolation,
} from './transactions.rules.js';

/**
 * Reguły transakcji — zadanie `F2-5`
 * ([04 §7](../../../../../../plans/04-api-spec.md#7-transakcje--apiv1transactions)).
 *
 * Pilnowane tutaj niezmienniki z [03 §4](../../../../../../plans/03-data-model.md):
 *
 * - **I-1** — `monthKey` wyliczany z `bookedOn` przy każdym zapisie daty;
 * - **I-2, I-3, I-7a** — kształt (`transactionShapeIssues` z `shared`), sprawdzany na
 *   transakcji **po scaleniu** z edycją — sam `PATCH` nie zna typu transakcji;
 * - **I-4** — rodzaj kategorii zgodny z typem (`transactions.references.ts`, wspólne z regułami cyklicznymi);
 * - **I-5, I-6** — migawki klas kont tylko przy przelewie, brane z kont w chwili zapisu;
 *   zmiana klasy konta ich nie rusza, zmiana **konta** transakcji — tak (ADR-035);
 * - **I-7** — wynika z `allocationEffects` w mapperze;
 * - **I-8** — okno księgowania przy każdym zapisie daty, a w zamkniętym miesiącu
 *   (sprzed okna) także blokada zmian liczb, usunięcia i przywrócenia (07 §1.4, ADR-040).
 *
 * - **I-12** — transakcja z zaksięgowania wystąpienia: usunięcie cofa zaksięgowanie,
 *   przywrócenie wiąże ponownie, zmiana kwoty przechodzi na wystąpienie — w tej samej
 *   transakcji bazodanowej (07 §6.7, ADR-042), przez `recurring.external.ts`.
 *
 * Inne moduły sięgają po dane transakcji przez `transactions.ledger.ts`, nie tutaj.
 */

/** Komunikat dla transakcji spoza gospodarstwa albo nieistniejącej — celowo ten sam. */
const NOT_FOUND = 'Nie znaleziono transakcji.';

/**
 * Pochodzenie transakcji tworzonej przez inny przepływ niż formularz — zaksięgowanie
 * wystąpienia cyklicznego (`F4-3`), wpłata na odkładanie i zapłata planowanego wydatku
 * (`F6-3`), zatwierdzenie dokumentu (`F7-6`: plakietka 📷 i powrót do zdjęcia).
 */
export type TransactionOrigin =
  | { readonly source: 'recurring'; readonly recurringOccurrenceId: string }
  | { readonly source: 'planned'; readonly plannedExpenseId: string }
  | { readonly source: 'ocr'; readonly sourceDocumentId: string };

/** Wynik zapisu: transakcja i miesiące do unieważnienia w cache frontu. */
export interface TransactionMutationResult {
  readonly data: TransactionDto;
  readonly meta: TransactionMutationMeta;
}

/**
 * Zwraca transakcję gospodarstwa (także z kosza) albo rzuca `404`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param transactionId - Identyfikator transakcji.
 * @returns Wiersz transakcji.
 * @throws {NotFoundError} Gdy transakcji nie ma w gospodarstwie.
 */
function requireTransaction(
  handle: DbHandle,
  householdId: string,
  transactionId: string,
): TransactionRow {
  const row = findTransactionById(handle, householdId, transactionId);
  if (row === undefined) throw new NotFoundError(NOT_FOUND);
  return row;
}

/**
 * Sprawdza niezmienniki kształtu I-2, I-3, I-7a.
 *
 * @param tx - Transakcja w całości (przy edycji — po scaleniu).
 * @throws {DomainRuleViolationError} Z listą wszystkich problemów w `details`.
 */
function assertShape(tx: TransactionShape): void {
  const issues = transactionShapeIssues(tx);
  const [first] = issues;
  if (first !== undefined) throw new DomainRuleViolationError(`${first.message}.`, issues);
}

/**
 * Sprawdza okno księgowania (I-8) i wyznacza miesiąc budżetowy daty (I-1).
 *
 * „Dziś" w strefie gospodarstwa (07 §1.1) — tuż po północy czasu polskiego serwer
 * w UTC jest jeszcze we wczorajszym dniu, a 1. dnia miesiąca w poprzednim miesiącu.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param bookedOn - Data transakcji.
 * @returns Klucz miesiąca budżetowego.
 * @throws {DomainRuleViolationError} Gdy data jest poza oknem księgowania.
 */
function postableMonthKey(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  bookedOn: string,
): string {
  const household = getHousehold(handle, householdId);
  const today = todayInTimezone(household.timezone, clock.now());
  const violation = postingWindowViolation(
    bookedOn,
    today,
    household.backPostingLimitMonths,
    household.monthStartDay,
  );
  if (violation !== null) {
    throw new DomainRuleViolationError(violation, [{ path: 'bookedOn', message: violation }]);
  }
  return monthKeyOf(bookedOn, household.monthStartDay);
}

/**
 * Pilnuje zamkniętego miesiąca: liczb transakcji sprzed okna księgowania nie wolno
 * zmieniać, usuwać ani przywracać (07 §1.4, ADR-040, `Z-17`).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param bookedOn - Obecna data transakcji.
 * @param operation - Operacja, którą blokujemy.
 * @param fields - Pola wskazywane w `details`; domyślnie `bookedOn`.
 * @throws {DomainRuleViolationError} Gdy transakcja leży w zamkniętym miesiącu.
 */
function assertOpenMonth(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  bookedOn: string,
  operation: ClosedMonthOperation,
  fields: readonly string[] = ['bookedOn'],
): void {
  const household = getHousehold(handle, householdId);
  const today = todayInTimezone(household.timezone, clock.now());
  if (!isInClosedMonth(bookedOn, today, household.backPostingLimitMonths)) return;
  const message = closedMonthMessage(operation, today, household.backPostingLimitMonths);
  throw new DomainRuleViolationError(
    message,
    fields.map((path) => ({ path, message })),
  );
}

/**
 * Zwraca stronę listy transakcji (04 §7).
 *
 * Pobiera jeden wiersz więcej, niż prosi klient — jego obecność mówi, że jest kolejna
 * strona, bez osobnego `COUNT(*)`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Zwalidowane filtry.
 * @returns Pozycje listy i metadane paginacji.
 * @throws {ValidationError} Gdy kursor jest nieprawidłowy.
 */
export function listTransactions(
  handle: DbHandle,
  householdId: string,
  query: TransactionQuery,
): { data: TransactionListItemDto[]; meta: TransactionListMeta } {
  const search = query.q ? foldForSearch(query.q) : undefined;
  const filter = {
    monthKey: query.month,
    from: query.from,
    to: query.to,
    types: query.type,
    accountIds: query.accountId,
    categoryIds: query.categoryId,
    uncategorized: query.uncategorized,
    goalIds: query.goalId,
    plannedExpenseIds: query.plannedExpenseId,
    liabilityIds: query.liabilityId,
    incomeSourceIds: query.incomeSourceId,
    allocationKinds: query.allocationKind,
    sources: query.source,
    search,
    minAmountMinor: query.minAmountMinor,
    maxAmountMinor: query.maxAmountMinor,
    includeDeleted: query.includeDeleted,
  };
  const rows = findTransactionPage(handle, householdId, {
    ...filter,
    sort: query.sort,
    after: query.cursor === undefined ? undefined : decodeCursor(query.cursor, query.sort),
    take: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page.at(-1);
  return {
    data: page.map(toTransactionListItemDto),
    meta: {
      nextCursor: hasMore && last !== undefined ? encodeCursor(query.sort, last) : null,
      hasMore,
      // Podsumowanie tylko na pierwszej stronie — kolejne doczytują wiersze tej samej
      // listy, której sumy się nie zmieniły (ADR-038).
      ...(query.cursor === undefined
        ? {
            summary: toTransactionListSummaryDto(
              summarizeTransactionList(handle, householdId, filter),
            ),
          }
        : {}),
    },
  };
}

/**
 * Zwraca transakcję z nazwami powiązanych bytów — także z kosza (pole `deletedAt`).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param transactionId - Identyfikator transakcji.
 * @returns Transakcja.
 * @throws {NotFoundError} Gdy transakcji nie ma w gospodarstwie.
 */
export function getTransaction(
  handle: DbHandle,
  householdId: string,
  transactionId: string,
): TransactionListItemDto {
  const row = findTransactionListItem(handle, householdId, transactionId);
  if (row === undefined) throw new NotFoundError(NOT_FOUND);
  return toTransactionListItemDto(row);
}

/**
 * Zapisuje nową transakcję.
 *
 * Wszystkie sprawdzenia i zapis w jednej transakcji bazodanowej — drugi użytkownik nie
 * zdąży zarchiwizować konta między sprawdzeniem a zapisem. Status `posted`, źródło
 * `manual` — chyba że transakcję tworzy inny przepływ (`origin`): wtedy te same
 * sprawdzenia, a źródło i powiązanie z przepływu.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor z tokenu.
 * @param input - Zwalidowane pola transakcji.
 * @param origin - Przepływ tworzący transakcję; pominięty — formularz (`manual`).
 * @returns Transakcja i miesiące do unieważnienia.
 * @throws {DomainRuleViolationError} Przy naruszeniu I-2…I-8 albo odwołaniu do archiwum.
 * @throws {NotFoundError} Gdy wskazany byt nie należy do gospodarstwa.
 */
export function createTransaction(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  input: CreateTransactionRequest,
  origin?: TransactionOrigin,
): TransactionMutationResult {
  const now = clock.now().getTime();
  const row = handle.sqlite.transaction(() => {
    assertShape(input);
    const monthKey = postableMonthKey(handle, clock, householdId, input.bookedOn);
    const classes = checkTransactionReferences(handle, householdId, input.type, input);
    const isTransfer = input.type === 'transfer';
    return insertTransactionRow(handle, {
      id: newId(),
      householdId,
      type: input.type,
      status: 'posted',
      bookedOn: input.bookedOn,
      monthKey,
      amountMinor: input.amountMinor,
      accountId: input.accountId,
      counterAccountId: input.counterAccountId ?? null,
      categoryId: input.categoryId ?? null,
      incomeSourceId: input.incomeSourceId ?? null,
      liabilityId: input.liabilityId ?? null,
      goalId: input.goalId ?? null,
      // I-5: migawki wyłącznie przy przelewie; I-6: z kont w chwili zapisu.
      sourceAllocationClass: isTransfer ? (classes.source ?? null) : null,
      targetAllocationClass: isTransfer ? (classes.target ?? null) : null,
      allocationOverride: input.allocationOverride ?? null,
      description: input.description ?? null,
      merchant: input.merchant ?? null,
      notes: input.notes ?? null,
      source: origin?.source ?? 'manual',
      recurringOccurrenceId: origin?.source === 'recurring' ? origin.recurringOccurrenceId : null,
      plannedExpenseId: origin?.source === 'planned' ? origin.plannedExpenseId : null,
      sourceDocumentId: origin?.source === 'ocr' ? origin.sourceDocumentId : null,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
  })();
  return { data: toTransactionDto(row), meta: { affectedMonths: [row.monthKey] } };
}

/**
 * Tworzy wiele transakcji naraz — wszystkie albo żadna (`POST /transactions/bulk`, `F7-6`).
 *
 * Każda przechodzi te same sprawdzenia co pojedyncza (`createTransaction` w punkcie
 * zapisu `SAVEPOINT`), a błąd dowolnej wycofuje całość. Ścieżki w `details` dostają
 * przedrostek `transactions.<indeks>.`, żeby klient wiedział, która pozycja zawiodła.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param userId - Autor z tokenu.
 * @param inputs - Zwalidowane pola transakcji.
 * @param origin - Wspólne pochodzenie; pominięte — `manual`.
 * @returns Utworzone transakcje i suma miesięcy do unieważnienia.
 * @throws {AppError} Pierwszy błąd pozycji, ze ścieżką wskazującą indeks.
 */
export function createTransactions(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  userId: string,
  inputs: readonly CreateTransactionRequest[],
  origin?: TransactionOrigin,
): { data: TransactionDto[]; meta: TransactionMutationMeta } {
  const created = handle.sqlite.transaction(() =>
    inputs.map((input, index) => {
      try {
        return createTransaction(handle, clock, householdId, userId, input, origin).data;
      } catch (error) {
        if (!isAppError(error)) throw error;
        const prefix = `transactions.${String(index)}`;
        throw new AppError(
          error.code,
          error.message,
          error.statusCode,
          (error.details ?? [{ path: '', message: error.message }]).map((detail) => ({
            ...detail,
            path: detail.path === '' ? prefix : `${prefix}.${detail.path}`,
          })),
        );
      }
    }),
  )();
  return {
    data: created,
    meta: { affectedMonths: [...new Set(created.map((row) => row.monthKey))].sort() },
  };
}

/** Pola, które edycja może zmienić — w kolejności z kontraktu. */
const EDITABLE_FIELDS = [
  'bookedOn',
  'amountMinor',
  'accountId',
  'counterAccountId',
  'categoryId',
  'incomeSourceId',
  'liabilityId',
  'goalId',
  'allocationOverride',
  'description',
  'merchant',
  'notes',
] as const satisfies readonly (keyof UpdateTransactionRequest & keyof TransactionRow)[];

/**
 * Zmienia transakcję.
 *
 * Zmieniane są wyłącznie przysłane pola, które faktycznie się różnią — puste albo
 * niczego niezmieniające ciało nie rusza nawet `updatedAt`. Kształt (I-2, I-3, I-7a)
 * sprawdzamy na transakcji **po scaleniu**: przelew bez konta docelowego może powstać
 * także przez `PATCH { counterAccountId: null }`.
 *
 * Zmiana konta w przelewie bierze migawkę klasy z **nowego** konta — stara opisywała
 * konto, którego transakcja już nie dotyczy. Klasy drugiej strony nie ruszamy (I-6).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param transactionId - Identyfikator transakcji.
 * @param input - Zwalidowane zmiany.
 * @returns Transakcja po zmianie i miesiące do unieważnienia (stary i nowy).
 * @throws {NotFoundError} Gdy transakcji albo wskazanego bytu nie ma w gospodarstwie.
 * @throws {ConflictError} Gdy transakcja jest w koszu.
 * @throws {DomainRuleViolationError} Przy naruszeniu niezmienników.
 */
export function updateTransaction(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  transactionId: string,
  input: UpdateTransactionRequest,
): TransactionMutationResult {
  const now = clock.now().getTime();
  const { before, after } = handle.sqlite.transaction(() => {
    const current = requireTransaction(handle, householdId, transactionId);
    if (current.deletedAt !== null) {
      throw new ConflictError('Transakcja jest w koszu — przywróć ją, zanim ją zmienisz.');
    }

    const patch: TransactionPatch = {};
    for (const field of EDITABLE_FIELDS) {
      const value = input[field];
      if (value !== undefined && value !== current[field]) Object.assign(patch, { [field]: value });
    }
    if (Object.keys(patch).length === 0) return { before: current, after: current };

    // Najpierw zamknięty miesiąc: przeniesienie wydatku z lipca na wrzesień też zmienia lipiec.
    const frozen = frozenFieldChanges(Object.keys(patch));
    if (frozen.length > 0) {
      assertOpenMonth(handle, clock, householdId, current.bookedOn, 'edit', frozen);
    }
    assertShape({ ...current, ...patch });
    if (patch.bookedOn !== undefined) {
      patch.monthKey = postableMonthKey(handle, clock, householdId, patch.bookedOn);
    }
    const classes = checkTransactionReferences(handle, householdId, current.type, patch);
    if (current.type === 'transfer') {
      if (classes.source !== undefined) patch.sourceAllocationClass = classes.source;
      if (classes.target !== undefined) patch.targetAllocationClass = classes.target;
    }

    const updated = patchTransaction(handle, householdId, transactionId, patch, now);
    // Drugi użytkownik mógł ją usunąć w międzyczasie — lepiej 404 niż 500.
    if (updated === undefined) throw new NotFoundError(NOT_FOUND);
    if (patch.amountMinor !== undefined && current.recurringOccurrenceId !== null) {
      syncPostedAmount(handle, householdId, transactionId, patch.amountMinor, now);
    }
    if (patch.amountMinor !== undefined && current.plannedExpenseId !== null) {
      syncPlannedPostedAmount(
        handle,
        householdId,
        current.plannedExpenseId,
        transactionId,
        patch.amountMinor,
        now,
      );
    }
    return { before: current, after: updated };
  })();
  return {
    data: toTransactionDto(after),
    meta: { affectedMonths: affectedMonths(before.monthKey, after.monthKey) },
  };
}

/**
 * Przenosi transakcję do kosza (miękkie usunięcie, 07 §10). Idempotentne.
 *
 * Transakcja z zaksięgowania wystąpienia cofa je w tej samej transakcji bazodanowej —
 * to ta sama operacja co `POST /recurring/occurrences/:id/unpost` (07 §6.7, ADR-042).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param transactionId - Identyfikator transakcji.
 * @throws {NotFoundError} Gdy transakcji nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Gdy transakcja leży w zamkniętym miesiącu (07 §1.4).
 */
export function deleteTransaction(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  transactionId: string,
): void {
  handle.sqlite.transaction(() => {
    const current = requireTransaction(handle, householdId, transactionId);
    if (current.deletedAt !== null) return;
    assertOpenMonth(handle, clock, householdId, current.bookedOn, 'delete');
    const now = clock.now().getTime();
    patchTransaction(handle, householdId, transactionId, { deletedAt: now }, now);
    if (current.recurringOccurrenceId !== null) {
      unpostOccurrenceOfTransaction(
        handle,
        householdId,
        current.recurringOccurrenceId,
        transactionId,
        now,
      );
    }
    if (current.plannedExpenseId !== null) {
      unpostPlannedOfTransaction(handle, householdId, current.plannedExpenseId, transactionId, now);
    }
  })();
}

/**
 * Przywraca transakcję z kosza. Idempotentne.
 *
 * Odwołań nie sprawdzamy ponownie: przywrócenie cofa usunięcie, a nie zapisuje nowej
 * operacji — transakcja wraca dokładnie taka, jaka była (kategorię scalenie przepięło
 * także w koszu, ADR-033).
 *
 * Transakcja z zaksięgowania wystąpienia wiąże je ponownie, o ile ono nadal czeka;
 * zaksięgowane w międzyczasie inaczej albo pominięte — transakcja wraca jako zwykła,
 * bez powiązania (07 §6.7).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param transactionId - Identyfikator transakcji.
 * @returns Transakcja i miesiąc do unieważnienia.
 * @throws {NotFoundError} Gdy transakcji nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Gdy transakcja leży w zamkniętym miesiącu (07 §1.4).
 */
export function restoreTransaction(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  transactionId: string,
): TransactionMutationResult {
  const row = handle.sqlite.transaction(() => {
    const current = requireTransaction(handle, householdId, transactionId);
    if (current.deletedAt === null) return current;
    assertOpenMonth(handle, clock, householdId, current.bookedOn, 'restore');
    const now = clock.now().getTime();
    const occurrenceId = current.recurringOccurrenceId;
    const relinked =
      occurrenceId !== null &&
      relinkOccurrenceOfTransaction(handle, householdId, occurrenceId, current, now);
    // Zapłata planowanego wydatku (wydatek, nie przelew odkładania) wiąże się ponownie
    // albo wraca jako zwykła — tak samo jak wystąpienie (07 §6.7, I-18).
    const plannedId = current.type === 'expense' ? current.plannedExpenseId : null;
    const plannedRelinked =
      plannedId !== null &&
      relinkPlannedOfTransaction(handle, householdId, plannedId, current, now);
    const restored = patchTransaction(
      handle,
      householdId,
      transactionId,
      {
        deletedAt: null,
        ...(occurrenceId === null || relinked ? {} : { recurringOccurrenceId: null }),
        ...(plannedId === null || plannedRelinked ? {} : { plannedExpenseId: null }),
      },
      now,
    );
    if (restored === undefined) throw new NotFoundError(NOT_FOUND);
    return restored;
  })();
  return { data: toTransactionDto(row), meta: { affectedMonths: [row.monthKey] } };
}
