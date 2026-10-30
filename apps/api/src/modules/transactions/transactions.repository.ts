import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import { SEARCH_FOLD_FUNCTION, type DbHandle } from '../../db/client.js';
import {
  debtRepaymentSql,
  incomeBaseSql,
  transferEffectSql,
} from '../../db/sql/allocation-effect.js';
import { accounts } from '../../db/schema/accounts.js';
import { categories } from '../../db/schema/categories.js';
import { goals } from '../../db/schema/goals.js';
import { incomeSources } from '../../db/schema/income-sources.js';
import { liabilities } from '../../db/schema/liabilities.js';
import {
  transactions,
  type TransactionInsert,
  type TransactionRow,
} from '../../db/schema/transactions.js';
import { users } from '../../db/schema/users.js';
import type { TransactionListFilter, TransactionListItemRow } from './transactions.types.js';

/**
 * Zapytania modułu transakcji: CRUD i lista (`F2-5`), agregat sald (`F2-2`),
 * sprawdzenia referencji (`F2-3`, `F2-4`).
 *
 * ## Kiedy **bez** `deleted_at IS NULL`
 *
 * Reguła 5 z `CLAUDE.md` chroni **sumy**: transakcja miękko usunięta nie może ruszyć
 * żadnej liczby. Funkcje sprawdzające i przepinające referencje celowo jej nie stosują, bo nie liczą
 * pieniędzy, tylko pilnują **referencji** — a transakcję miękko usuniętą można przez
 * 30 dni przywrócić (07 §10). Przywrócona musi wrócić z kategorią, która istnieje
 * (ADR-033).
 *
 * `householdId` jest pierwszym argumentem po uchwycie (reguła 4 z `CLAUDE.md`).
 */

/** Suma ruchów na jednym koncie w dwóch przekrojach czasu. */
export interface AccountFlowRow {
  readonly accountId: string;
  /** Ruch netto przed pierwszym dniem miesiąca (`booked_on < monthStart`). */
  readonly beforeMonthMinor: number;
  /** Ruch netto do dnia `asOf` włącznie. */
  readonly throughAsOfMinor: number;
}

/**
 * Sumuje ruch netto na każdym koncie gospodarstwa, które go miało.
 *
 * Każda transakcja rozkłada się na „nogi" — po jednej na każde konto, którego dotyka
 * ([07 §7](../../../../../../plans/07-domain-rules.md#7-salda-kont)):
 *
 * | typ | `account_id` | `counter_account_id` |
 * |---|---|---|
 * | `income` | `+amount` | — |
 * | `expense` | `−amount` | — |
 * | `transfer` | `−amount` (wypływ) | `+amount` (wpływ) |
 *
 * Liczą się wyłącznie transakcje `posted` i nieusunięte (reguła 5 z `CLAUDE.md`) —
 * `pending` jeszcze nie ruszyło pieniędzy, `void` nigdy nie ruszy. Nogi sprzed
 * `accounts.opening_balance_on` są pomijane: saldo początkowe już je zawiera, a liczenie
 * ich drugi raz podwoiłoby historię sprzed założenia konta w aplikacji.
 *
 * Oba przekroje liczymy w **jednym** przebiegu (`CASE` wewnątrz `SUM`) — dwa zapytania
 * mogłyby zobaczyć różny stan bazy, gdyby między nimi drugi użytkownik coś zaksięgował.
 *
 * Połączenie z `accounts` jest tu potrzebne tylko dla `opening_balance_on` i zawężenia
 * do gospodarstwa; moduł nie importuje repozytorium kont (02 §3, reguła 4).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param monthStart - Pierwszy dzień miesiąca `YYYY-MM-DD` (granica wyłącznie).
 * @param asOf - Dzień, na który liczymy saldo `YYYY-MM-DD` (granica włącznie).
 * @returns Po jednym wierszu na konto z choćby jedną nogą; konta bez ruchu są pominięte.
 */
export function sumAccountFlows(
  handle: DbHandle,
  householdId: string,
  monthStart: string,
  asOf: string,
): AccountFlowRow[] {
  return handle.db.all<AccountFlowRow>(sql`
    WITH legs AS (
      SELECT t.account_id AS account_id,
             CASE WHEN t.type = 'income' THEN t.amount_minor ELSE -t.amount_minor END AS delta,
             t.booked_on AS booked_on
        FROM transactions t
       WHERE t.household_id = ${householdId}
         AND t.status = 'posted'
         AND t.deleted_at IS NULL
         AND t.account_id IS NOT NULL
      UNION ALL
      SELECT t.counter_account_id, t.amount_minor, t.booked_on
        FROM transactions t
       WHERE t.household_id = ${householdId}
         AND t.status = 'posted'
         AND t.deleted_at IS NULL
         AND t.type = 'transfer'
         AND t.counter_account_id IS NOT NULL
    )
    SELECT l.account_id AS accountId,
           COALESCE(SUM(CASE WHEN l.booked_on < ${monthStart} THEN l.delta END), 0)
             AS beforeMonthMinor,
           COALESCE(SUM(CASE WHEN l.booked_on <= ${asOf} THEN l.delta END), 0)
             AS throughAsOfMinor
      FROM legs l
      JOIN accounts a ON a.id = l.account_id AND a.household_id = ${householdId}
     WHERE l.booked_on >= a.opening_balance_on
     GROUP BY l.account_id
  `);
}

/** Płatności na jedno zobowiązanie. */
export interface LiabilityPaymentRow {
  readonly liabilityId: string;
  /** Suma rat po `balance_as_of` zobowiązania, do dnia `asOf` włącznie (07 §5.1). */
  readonly paidSinceAsOfMinor: number;
  /** `1`, gdy w miesiącu `monthKey` jest rata. */
  readonly paidInMonth: number;
  /** Suma rat zaksięgowanych w miesiącu `monthKey`. */
  readonly paidInMonthMinor: number;
  readonly lastPaymentOn: string | null;
}

/**
 * Sumuje raty zobowiązań gospodarstwa (07 §5.1): wydatki z `liability_id`, zaksięgowane,
 * poza koszem. Złączenie z `liabilities` daje każdemu zobowiązaniu jego własny punkt
 * odniesienia w jednym zapytaniu — tak jak `sumAccountFlows` bierze `opening_balance_on`.
 *
 * Tylko wydatki: zaciągnięcie długu to przychód, nie ujemna rata (07 §2.2a).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param monthKey - Miesiąc, dla którego sprawdzamy „zapłacono w tym miesiącu".
 * @param asOf - Ostatni dzień liczonych rat (włącznie).
 * @returns Po jednym wierszu na zobowiązanie z choćby jedną ratą.
 */
export function sumLiabilityPayments(
  handle: DbHandle,
  householdId: string,
  monthKey: string,
  asOf: string,
): LiabilityPaymentRow[] {
  return handle.db.all<LiabilityPaymentRow>(sql`
    SELECT t.liability_id AS liabilityId,
           COALESCE(SUM(CASE WHEN t.booked_on > l.balance_as_of AND t.booked_on <= ${asOf}
                             THEN t.amount_minor END), 0) AS paidSinceAsOfMinor,
           MAX(CASE WHEN t.month_key = ${monthKey} THEN 1 ELSE 0 END) AS paidInMonth,
           COALESCE(SUM(CASE WHEN t.month_key = ${monthKey} THEN t.amount_minor END), 0)
             AS paidInMonthMinor,
           MAX(t.booked_on) AS lastPaymentOn
      FROM transactions t
      JOIN liabilities l ON l.id = t.liability_id AND l.household_id = ${householdId}
     WHERE t.household_id = ${householdId}
       AND t.type = 'expense'
       AND t.status = 'posted'
       AND t.deleted_at IS NULL
     GROUP BY t.liability_id
  `);
}

/**
 * Liczy transakcje gospodarstwa przypisane do kategorii — **łącznie z miękko usuniętymi**.
 *
 * To sprawdzenie referencji przed usunięciem kategorii (I-10), nie suma pieniędzy,
 * dlatego bez filtra `deleted_at` (patrz opis modułu). `transactions.category_id` ma
 * `ON DELETE SET NULL`, więc bez tego zliczenia baza po cichu odebrałaby kategorię
 * wszystkim transakcjom.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param categoryId - Identyfikator kategorii.
 * @returns Liczba transakcji z tą kategorią.
 */
export function countTransactionsInCategory(
  handle: DbHandle,
  householdId: string,
  categoryId: string,
): number {
  const row = handle.db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), eq(transactions.categoryId, categoryId)))
    .get();
  return row?.count ?? 0;
}

/**
 * Przepina transakcje z jednej kategorii na drugą — **łącznie z miękko usuniętymi**.
 *
 * Scalenie (07 §9.3) archiwizuje kategorię źródłową; transakcja przywrócona z kosza
 * z kategorią zarchiwizowaną wypadłaby z każdego raportu, który ją pomija.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param fromCategoryId - Kategoria źródłowa.
 * @param toCategoryId - Kategoria docelowa.
 * @param now - Znacznik `updated_at`.
 * @returns Liczba przepiętych transakcji.
 */
export function reassignTransactionsCategory(
  handle: DbHandle,
  householdId: string,
  fromCategoryId: string,
  toCategoryId: string,
  now: number,
): number {
  return handle.db
    .update(transactions)
    .set({ categoryId: toCategoryId, updatedAt: now })
    .where(
      and(eq(transactions.householdId, householdId), eq(transactions.categoryId, fromCategoryId)),
    )
    .run().changes;
}

/**
 * Liczy transakcje gospodarstwa przypisane do źródła przychodu — **łącznie z miękko
 * usuniętymi** (sprawdzenie referencji, nie suma — patrz opis modułu).
 *
 * `transactions.income_source_id` ma `ON DELETE SET NULL`, więc bez tego zliczenia
 * usunięcie źródła po cichu odebrałoby je historycznym przychodom (I-10).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param incomeSourceId - Identyfikator źródła.
 * @returns Liczba transakcji z tym źródłem.
 */
export function countTransactionsFromIncomeSource(
  handle: DbHandle,
  householdId: string,
  incomeSourceId: string,
): number {
  const row = handle.db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.incomeSourceId, incomeSourceId),
      ),
    )
    .get();
  return row?.count ?? 0;
}

/** Pola transakcji, które wolno zmienić edycją. Typ i autor są niezmienne. */
export type TransactionPatch = Partial<
  Pick<
    TransactionInsert,
    | 'bookedOn'
    | 'monthKey'
    | 'amountMinor'
    | 'accountId'
    | 'counterAccountId'
    | 'categoryId'
    | 'incomeSourceId'
    | 'liabilityId'
    | 'goalId'
    | 'sourceAllocationClass'
    | 'targetAllocationClass'
    | 'allocationOverride'
    | 'description'
    | 'merchant'
    | 'notes'
  >
>;

/**
 * Zapisuje nową transakcję.
 *
 * @param handle - Uchwyt bazy.
 * @param row - Kompletny wiersz; niezmienniki sprawdził serwis.
 * @returns Zapisany wiersz.
 */
export function insertTransactionRow(handle: DbHandle, row: TransactionInsert): TransactionRow {
  return handle.db.insert(transactions).values(row).returning().get();
}

/**
 * Znajduje transakcję gospodarstwa po identyfikatorze — **także z kosza**.
 *
 * Bez filtra `deleted_at`, bo to odczyt pojedynczego rekordu, nie suma: przywrócenie
 * i szczegóły transakcji z kosza muszą ją widzieć (opis modułu).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param transactionId - Identyfikator transakcji.
 * @returns Wiersz albo `undefined`, także dla transakcji innego gospodarstwa.
 */
export function findTransactionById(
  handle: DbHandle,
  householdId: string,
  transactionId: string,
): TransactionRow | undefined {
  return handle.db
    .select()
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), eq(transactions.id, transactionId)))
    .get();
}

/**
 * Zmienia pola transakcji gospodarstwa.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param transactionId - Identyfikator transakcji.
 * @param patch - Zmieniane pola, w tym `deletedAt` przy usuwaniu i przywracaniu oraz
 *   zerwanie powiązania z wystąpieniem, gdy przywrócona wraca jako zwykła (07 §6.7).
 * @param now - Znacznik `updated_at`.
 * @returns Wiersz po zmianie albo `undefined`.
 */
export function patchTransaction(
  handle: DbHandle,
  householdId: string,
  transactionId: string,
  patch: TransactionPatch & { deletedAt?: number | null; recurringOccurrenceId?: null },
  now: number,
): TransactionRow | undefined {
  return handle.db
    .update(transactions)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(transactions.householdId, householdId), eq(transactions.id, transactionId)))
    .returning()
    .get();
}

/**
 * Wiąże istniejącą transakcję z wystąpieniem reguły, które ona sama opłaca — „Zapisz jako
 * wydatek stały" (`F4-8`, ADR-051). Transakcja z koszem albo już powiązana nie zmienia się.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param transactionId - Identyfikator transakcji.
 * @param occurrenceId - Wystąpienie zaksięgowane tą transakcją.
 * @param now - Znacznik `updated_at`.
 * @returns `true`, gdy powiązanie zapisano.
 */
export function setTransactionOccurrence(
  handle: DbHandle,
  householdId: string,
  transactionId: string,
  occurrenceId: string,
  now: number,
): boolean {
  return (
    handle.db
      .update(transactions)
      .set({ recurringOccurrenceId: occurrenceId, updatedAt: now })
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.id, transactionId),
          isNull(transactions.deletedAt),
          isNull(transactions.recurringOccurrenceId),
        ),
      )
      .run().changes > 0
  );
}

/** Konto docelowe przelewu — ta sama tabela co konto źródłowe, więc potrzebny alias. */
const counterAccounts = alias(accounts, 'counter_accounts');

/**
 * Zapytanie o transakcje z nazwami powiązanych bytów.
 *
 * Złączenia zamiast osobnych zapytań per wiersz: lista miesiąca to kilkadziesiąt pozycji,
 * a N+1 na głównym ekranie aplikacji byłoby odczuwalne (02 §3). To odczyt nazw, nie
 * sięganie po reguły innych modułów, więc repozytoria tych modułów nie są importowane —
 * tak jak przy `sumAccountFlows`.
 *
 * @param handle - Uchwyt bazy.
 * @returns Zapytanie gotowe do dopisania warunków.
 */
function selectListItems(handle: DbHandle) {
  return handle.db
    .select({
      ...getTableColumns(transactions),
      accountName: accounts.name,
      counterAccountName: counterAccounts.name,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      incomeSourceName: incomeSources.name,
      goalName: goals.name,
      liabilityName: liabilities.name,
      createdByName: users.displayName,
    })
    .from(transactions)
    .innerJoin(users, eq(users.id, transactions.createdBy))
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(counterAccounts, eq(counterAccounts.id, transactions.counterAccountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(incomeSources, eq(incomeSources.id, transactions.incomeSourceId))
    .leftJoin(goals, eq(goals.id, transactions.goalId))
    .leftJoin(liabilities, eq(liabilities.id, transactions.liabilityId));
}

/**
 * Znajduje transakcję z nazwami powiązanych bytów — także z kosza.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param transactionId - Identyfikator transakcji.
 * @returns Wiersz albo `undefined`.
 */
export function findTransactionListItem(
  handle: DbHandle,
  householdId: string,
  transactionId: string,
): TransactionListItemRow | undefined {
  return selectListItems(handle)
    .where(and(eq(transactions.householdId, householdId), eq(transactions.id, transactionId)))
    .get();
}

/**
 * Warunek „transakcja ma efekt alokacji w puli `kind`" — odpowiednik SQL funkcji
 * `allocationEffects` z `shared` (07 §2.2, §2.2a).
 *
 * Musi dawać dokładnie ten sam wynik co funkcja, bo lista przefiltrowana po puli
 * i `allocationEffects` w DTO tej listy nie mogą sobie przeczyć — pilnuje tego test
 * zgodności ze wszystkimi kombinacjami klas i nadpisań.
 *
 * @param kind - Pula.
 * @returns Warunek SQL.
 */
function hasAllocationEffect(kind: 'savings' | 'investment' | 'debt_repayment'): SQL {
  if (kind === 'debt_repayment') {
    return sql`(${transactions.type} = 'expense'
      AND ${transactions.liabilityId} IS NOT NULL
      AND (${transactions.allocationOverride} IS NULL OR ${transactions.allocationOverride} <> 'none'))`;
  }
  return sql`(${transactions.type} = 'transfer' AND (
      ${transactions.allocationOverride} = ${kind}
      OR (${transactions.allocationOverride} IS NULL
          AND ${transactions.sourceAllocationClass} <> ${transactions.targetAllocationClass}
          AND (${transactions.sourceAllocationClass} = ${kind}
               OR ${transactions.targetAllocationClass} = ${kind}))))`;
}

/** Kolumna sortowania dla każdego wariantu `sort`. */
const SORT_COLUMNS = {
  bookedOn: transactions.bookedOn,
  amount: transactions.amountMinor,
  createdAt: transactions.createdAt,
} as const;

/**
 * Warunki filtrów listy — wspólne dla strony i podsumowania, żeby suma w nagłówku
 * nigdy nie liczyła innego zestawu niż lista pod nią (ADR-038). Bez kursora i sortowania.
 *
 * @param householdId - Identyfikator gospodarstwa.
 * @param filter - Znormalizowane filtry.
 * @returns Warunki do złączenia przez `and`.
 */
function listConditions(
  householdId: string,
  filter: Omit<TransactionListFilter, 'sort' | 'after' | 'take'>,
): (SQL | undefined)[] {
  const conditions: (SQL | undefined)[] = [eq(transactions.householdId, householdId)];

  if (!filter.includeDeleted) conditions.push(isNull(transactions.deletedAt));
  if (filter.monthKey !== undefined) conditions.push(eq(transactions.monthKey, filter.monthKey));
  if (filter.from !== undefined) conditions.push(gte(transactions.bookedOn, filter.from));
  if (filter.to !== undefined) conditions.push(lte(transactions.bookedOn, filter.to));
  if (filter.types) conditions.push(inArray(transactions.type, [...filter.types]));
  if (filter.accountIds) {
    conditions.push(
      or(
        inArray(transactions.accountId, [...filter.accountIds]),
        inArray(transactions.counterAccountId, [...filter.accountIds]),
      ),
    );
  }
  if (filter.categoryIds)
    conditions.push(inArray(transactions.categoryId, [...filter.categoryIds]));
  if (filter.uncategorized) conditions.push(isNull(transactions.categoryId));
  if (filter.goalIds) conditions.push(inArray(transactions.goalId, [...filter.goalIds]));
  if (filter.plannedExpenseIds) {
    conditions.push(inArray(transactions.plannedExpenseId, [...filter.plannedExpenseIds]));
  }
  if (filter.liabilityIds) {
    conditions.push(inArray(transactions.liabilityId, [...filter.liabilityIds]));
  }
  if (filter.incomeSourceIds) {
    conditions.push(inArray(transactions.incomeSourceId, [...filter.incomeSourceIds]));
  }
  if (filter.sources) conditions.push(inArray(transactions.source, [...filter.sources]));
  if (filter.allocationKinds) {
    conditions.push(or(...filter.allocationKinds.map(hasAllocationEffect)));
  }
  if (filter.search !== undefined) {
    // `instr` zamiast `LIKE`: wpisany `%` albo `_` nie staje się symbolem wieloznacznym.
    const fold = sql.raw(SEARCH_FOLD_FUNCTION);
    conditions.push(
      sql`(instr(${fold}(${transactions.description}), ${filter.search}) > 0
        OR instr(${fold}(${transactions.merchant}), ${filter.search}) > 0
        OR instr(${fold}(${transactions.notes}), ${filter.search}) > 0)`,
    );
  }
  if (filter.minAmountMinor !== undefined) {
    conditions.push(gte(transactions.amountMinor, filter.minAmountMinor));
  }
  if (filter.maxAmountMinor !== undefined) {
    conditions.push(lte(transactions.amountMinor, filter.maxAmountMinor));
  }
  return conditions;
}

/**
 * Zwraca stronę listy transakcji gospodarstwa.
 *
 * **Paginacja kursorowa** po parze (kolumna sortowania, `id`): identyfikator rozstrzyga
 * remisy, więc dwie transakcje z tego samego dnia nie zgubią się ani nie powtórzą na
 * granicy stron — co przy `OFFSET` zdarza się, gdy drugi użytkownik doda coś w trakcie
 * przewijania.
 *
 * Transakcje z kosza są pomijane, chyba że filtr mówi inaczej (reguła 5 z `CLAUDE.md`).
 * Filtr konta łapie obie strony przelewu — wpływ na konto jest częścią jego historii.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param filter - Znormalizowane filtry, sortowanie, kursor i liczba wierszy.
 * @returns Wiersze w kolejności sortowania; co najwyżej `filter.take`.
 */
export function findTransactionPage(
  handle: DbHandle,
  householdId: string,
  filter: TransactionListFilter,
): TransactionListItemRow[] {
  const conditions = listConditions(householdId, filter);

  const [key, direction] = filter.sort.split(':') as [keyof typeof SORT_COLUMNS, 'asc' | 'desc'];
  const column = SORT_COLUMNS[key];
  if (filter.after !== undefined) {
    const beyond = direction === 'desc' ? lt : gt;
    conditions.push(
      or(
        beyond(column, filter.after.value),
        and(eq(column, filter.after.value), beyond(transactions.id, filter.after.id)),
      ),
    );
  }

  const order = direction === 'desc' ? desc : asc;
  return selectListItems(handle)
    .where(and(...conditions))
    .orderBy(order(column), order(transactions.id))
    .limit(filter.take)
    .all();
}

/** Sumy jednego dnia listy. */
export interface DayTotalRow {
  readonly bookedOn: string;
  readonly expenseMinor: number;
  readonly incomeMinor: number;
}

/** Podsumowanie listy transakcji. */
export interface ListSummaryRow {
  readonly count: number;
  readonly expenseMinor: number;
  readonly incomeMinor: number;
  readonly transferMinor: number;
  readonly days: readonly DayTotalRow[];
}

/**
 * Liczy podsumowanie listy dla tych samych filtrów co {@link findTransactionPage}.
 *
 * `count` obejmuje każdy pasujący wiersz — to liczba pozycji, które ekran pokaże po
 * przewinięciu do końca. Sumy biorą wyłącznie zaksięgowane i nieusunięte (reguła 5
 * z `CLAUDE.md`): lista z koszem pokazuje usunięty wydatek, ale nie może go doliczyć.
 * Dwa zapytania agregujące po indeksie `(household_id, month_key)` — bez pobierania
 * wierszy do pamięci.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param filter - Znormalizowane filtry (kursor, sortowanie i limit są pomijane).
 * @returns Liczba, sumy per typ i sumy dni od najnowszego.
 */
export function summarizeTransactionList(
  handle: DbHandle,
  householdId: string,
  filter: Omit<TransactionListFilter, 'sort' | 'after' | 'take'>,
): ListSummaryRow {
  const where = and(...listConditions(householdId, filter));
  const counted = sql`(${transactions.status} = 'posted' AND ${transactions.deletedAt} IS NULL)`;
  const sumOf = (type: 'expense' | 'income' | 'transfer'): SQL<number> =>
    sql<number>`coalesce(sum(CASE WHEN ${counted} AND ${transactions.type} = ${type}
      THEN ${transactions.amountMinor} ELSE 0 END), 0)`;

  const totals = handle.db
    .select({
      count: sql<number>`count(*)`,
      expenseMinor: sumOf('expense'),
      incomeMinor: sumOf('income'),
      transferMinor: sumOf('transfer'),
    })
    .from(transactions)
    .where(where)
    .get();

  const days = handle.db
    .select({
      bookedOn: transactions.bookedOn,
      expenseMinor: sumOf('expense'),
      incomeMinor: sumOf('income'),
    })
    .from(transactions)
    .where(where)
    .groupBy(transactions.bookedOn)
    .orderBy(desc(transactions.bookedOn))
    .all();

  return {
    count: totals?.count ?? 0,
    expenseMinor: totals?.expenseMinor ?? 0,
    incomeMinor: totals?.incomeMinor ?? 0,
    transferMinor: totals?.transferMinor ?? 0,
    days,
  };
}

/** Użycie jednej kategorii. */
export interface CategoryUsageRow {
  readonly categoryId: string;
  readonly transactionCount: number;
  readonly monthAmountMinor: number;
}

/**
 * Liczy użycie kategorii gospodarstwa: transakcje w księdze i sumę w miesiącu.
 *
 * Bez kosza w obu liczbach — to statystyka, nie sprawdzenie referencji (opis modułu).
 * Dlatego licznik może pokazać `0` przy kategorii, której mimo to nie da się usunąć:
 * blokuje ją transakcja w koszu (I-10). Ekran mówi o tym w komunikacie `409`.
 * Suma w miesiącu tylko z `posted` — jak salda (07 §7).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param monthKey - Miesiąc sumy.
 * @returns Wiersze wyłącznie dla kategorii z co najmniej jedną transakcją.
 */
export function sumCategoryUsage(
  handle: DbHandle,
  householdId: string,
  monthKey: string,
): CategoryUsageRow[] {
  return handle.db
    .select({
      categoryId: sql<string>`${transactions.categoryId}`,
      transactionCount: sql<number>`count(*)`,
      monthAmountMinor: sql<number>`coalesce(sum(CASE WHEN ${transactions.status} = 'posted'
        AND ${transactions.monthKey} = ${monthKey} THEN ${transactions.amountMinor} ELSE 0 END), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
        isNotNull(transactions.categoryId),
      ),
    )
    .groupBy(transactions.categoryId)
    .all();
}

/** Sumy pul jednego miesiąca — podstawa rozkładu i celów (07 §2.3, §2.4, §2.2a). */
export interface AllocationMonthRow {
  readonly monthKey: string;
  readonly incomeBaseMinor: number;
  readonly savingsMinor: number;
  readonly investmentMinor: number;
  readonly debtRepaymentMinor: number;
}

/**
 * Sumuje podstawę procentu i efekty netto pul w miesiącach `[fromMonth, toMonth]`.
 *
 * Te same wyrażenia co sumy ekranu miesiąca (`db/sql/allocation-effect.ts`), więc kafel
 * na dashboardzie, ekran rozkładu i trend pokazują te same liczby. Jeden przebieg
 * grupowany po miesiącu — trend dwunastu miesięcy to jedno zapytanie, nie dwanaście.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param fromMonth - Pierwszy miesiąc (włącznie).
 * @param toMonth - Ostatni miesiąc (włącznie).
 * @returns Wiersze tylko dla miesięcy z transakcjami; brak wiersza = same zera.
 */
export function sumAllocationByMonth(
  handle: DbHandle,
  householdId: string,
  fromMonth: string,
  toMonth: string,
): AllocationMonthRow[] {
  return handle.db.all<AllocationMonthRow>(sql`
    SELECT t.month_key AS monthKey,
           COALESCE(SUM(${incomeBaseSql()}), 0) AS incomeBaseMinor,
           COALESCE(SUM(${transferEffectSql('savings')}), 0) AS savingsMinor,
           COALESCE(SUM(${transferEffectSql('investment')}), 0) AS investmentMinor,
           COALESCE(SUM(${debtRepaymentSql()}), 0) AS debtRepaymentMinor
      FROM transactions t
      LEFT JOIN income_sources s ON s.id = t.income_source_id
     WHERE t.household_id = ${householdId}
       AND t.month_key BETWEEN ${fromMonth} AND ${toMonth}
       AND t.status = 'posted'
       AND t.deleted_at IS NULL
     GROUP BY t.month_key
  `);
}

/** Przelew oznaczony celem — surowiec postępu celu (07 §4.1). */
export interface GoalTransferRow {
  readonly goalId: string;
  readonly monthKey: string;
  readonly amountMinor: number;
  readonly accountId: string | null;
  readonly counterAccountId: string | null;
  readonly sourceAllocationClass: 'spending' | 'savings' | 'investment' | null;
  readonly targetAllocationClass: 'spending' | 'savings' | 'investment' | null;
}

/**
 * Zwraca zaksięgowane przelewy oznaczone celem.
 *
 * Wiersze, nie sumy: kierunek wpłaty (wpłata czy wypłata z celu) zależy od konta celu
 * i klas kont — liczy go `goalTransferSign` z `shared`, jedno źródło tej reguły.
 * W gospodarstwie dwóch osób to najwyżej setki wierszy.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Przelewy z `goal_id`, poza koszem.
 */
export function findGoalTransfers(handle: DbHandle, householdId: string): GoalTransferRow[] {
  return handle.db.all<GoalTransferRow>(sql`
    SELECT t.goal_id AS goalId, t.month_key AS monthKey, t.amount_minor AS amountMinor,
           t.account_id AS accountId, t.counter_account_id AS counterAccountId,
           t.source_allocation_class AS sourceAllocationClass,
           t.target_allocation_class AS targetAllocationClass
      FROM transactions t
     WHERE t.household_id = ${householdId}
       AND t.goal_id IS NOT NULL
       AND t.type = 'transfer'
       AND t.status = 'posted'
       AND t.deleted_at IS NULL
  `);
}

/** Ruch netto na koncie w jednym miesiącu. */
export interface AccountMonthNetRow {
  readonly accountId: string;
  readonly monthKey: string;
  readonly netMinor: number;
}

/**
 * Ruch netto na kontach miesiąc po miesiącu — tempo celu śledzonego saldem konta
 * (07 §4.1, tryb `account_balance`). Nogi jak w `sumAccountFlows`, z pominięciem tych
 * sprzed `opening_balance_on`.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param accountIds - Konta; pusta lista — pusty wynik bez zapytania.
 * @param fromMonth - Pierwszy miesiąc (włącznie).
 * @param toMonth - Ostatni miesiąc (włącznie).
 * @returns Wiersze dla par konto–miesiąc z ruchem.
 */
export function sumAccountNetByMonth(
  handle: DbHandle,
  householdId: string,
  accountIds: readonly string[],
  fromMonth: string,
  toMonth: string,
): AccountMonthNetRow[] {
  if (accountIds.length === 0) return [];
  const ids = sql.join(
    accountIds.map((id) => sql`${id}`),
    sql`, `,
  );
  return handle.db.all<AccountMonthNetRow>(sql`
    WITH legs AS (
      SELECT t.account_id AS account_id, t.month_key AS month_key, t.booked_on AS booked_on,
             CASE WHEN t.type = 'income' THEN t.amount_minor ELSE -t.amount_minor END AS delta
        FROM transactions t
       WHERE t.household_id = ${householdId}
         AND t.status = 'posted'
         AND t.deleted_at IS NULL
         AND t.account_id IN (${ids})
         AND t.month_key BETWEEN ${fromMonth} AND ${toMonth}
      UNION ALL
      SELECT t.counter_account_id, t.month_key, t.booked_on, t.amount_minor
        FROM transactions t
       WHERE t.household_id = ${householdId}
         AND t.status = 'posted'
         AND t.deleted_at IS NULL
         AND t.type = 'transfer'
         AND t.counter_account_id IN (${ids})
         AND t.month_key BETWEEN ${fromMonth} AND ${toMonth}
    )
    SELECT l.account_id AS accountId, l.month_key AS monthKey, SUM(l.delta) AS netMinor
      FROM legs l
      JOIN accounts a ON a.id = l.account_id AND a.household_id = ${householdId}
     WHERE l.booked_on >= a.opening_balance_on
     GROUP BY l.account_id, l.month_key
  `);
}

/** Wpłaty na odkładanie jednego planowanego wydatku. */
export interface PlannedSetAsideRow {
  readonly plannedExpenseId: string;
  /** Suma przelewów oznaczonych wydatkiem. */
  readonly contributedMinor: number;
  /** Suma takich przelewów w miesiącu `monthKey`. */
  readonly inMonthMinor: number;
}

/**
 * Sumuje przelewy odkładania na planowane wydatki (07 §6.5 — zebrana kwota).
 *
 * Tylko przelewy: zapłata wydatku to wydatek z tym samym `planned_expense_id`
 * i nie jest odkładaniem.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param monthKey - Miesiąc „wpłacono w tym miesiącu".
 * @returns Wiersze dla wydatków z choćby jedną wpłatą.
 */
export function sumPlannedSetAside(
  handle: DbHandle,
  householdId: string,
  monthKey: string,
): PlannedSetAsideRow[] {
  return handle.db.all<PlannedSetAsideRow>(sql`
    SELECT t.planned_expense_id AS plannedExpenseId,
           COALESCE(SUM(t.amount_minor), 0) AS contributedMinor,
           COALESCE(SUM(CASE WHEN t.month_key = ${monthKey} THEN t.amount_minor END), 0)
             AS inMonthMinor
      FROM transactions t
     WHERE t.household_id = ${householdId}
       AND t.planned_expense_id IS NOT NULL
       AND t.type = 'transfer'
       AND t.status = 'posted'
       AND t.deleted_at IS NULL
     GROUP BY t.planned_expense_id
  `);
}

/** Transakcja-kandydat na duplikat pozycji dokumentu (08 §10). */
export interface DuplicateCandidateRow {
  readonly id: string;
  readonly type: 'expense' | 'income' | 'transfer';
  readonly bookedOn: string;
  readonly amountMinor: number;
  readonly accountId: string | null;
  readonly counterAccountId: string | null;
  readonly description: string | null;
  readonly merchant: string | null;
}

/**
 * Transakcje o jednej z podanych kwot w zakresie dat — kandydaci na duplikat.
 *
 * Tylko zaksięgowane i spoza kosza (reguła 5 z `CLAUDE.md`): wpis usunięty nie jest
 * duplikatem, bo nie liczy się do sum.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param from - Pierwszy dzień zakresu (włącznie).
 * @param to - Ostatni dzień zakresu (włącznie).
 * @param amounts - Kwoty w groszach.
 * @returns Wiersze rosnąco po dacie.
 */
export function findDuplicateCandidates(
  handle: DbHandle,
  householdId: string,
  from: string,
  to: string,
  amounts: readonly number[],
): DuplicateCandidateRow[] {
  if (amounts.length === 0) return [];
  return handle.db
    .select({
      id: transactions.id,
      type: transactions.type,
      bookedOn: transactions.bookedOn,
      amountMinor: transactions.amountMinor,
      accountId: transactions.accountId,
      counterAccountId: transactions.counterAccountId,
      description: transactions.description,
      merchant: transactions.merchant,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
        eq(transactions.status, 'posted'),
        gte(transactions.bookedOn, from),
        lte(transactions.bookedOn, to),
        inArray(transactions.amountMinor, [...new Set(amounts)]),
      ),
    )
    .orderBy(asc(transactions.bookedOn), asc(transactions.id))
    .all();
}

/**
 * Kategorie użyte od podanego dnia — do skracania kontekstu AI (08 §4).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param from - Pierwszy dzień (włącznie).
 * @returns Identyfikatory kategorii.
 */
export function findCategoryIdsUsedSince(
  handle: DbHandle,
  householdId: string,
  from: string,
): string[] {
  return handle.db
    .selectDistinct({ categoryId: transactions.categoryId })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
        isNotNull(transactions.categoryId),
        gte(transactions.bookedOn, from),
      ),
    )
    .all()
    .map((row) => row.categoryId)
    .filter((id): id is string => id !== null);
}

/** Wydatek zmienny kategorii w jednym miesiącu. */
export interface CategoryMonthSpendRow {
  readonly categoryId: string;
  readonly monthKey: string;
  readonly amountMinor: number;
}

/**
 * Sumuje wydatki **zmienne** po kategorii i miesiącu — podstawa średniej do planera
 * budżetu (07 §13.3, ADR-078).
 *
 * Bez transakcji powiązanych z wystąpieniem cyklicznym, planowanym wydatkiem albo
 * zobowiązaniem: te są w szkicu osobnymi liniami, więc w średniej liczyłyby się drugi
 * raz (czynsz z reguły podbijałby „Mieszkanie"). Tylko `posted`, bez kosza.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param fromMonth - Pierwszy miesiąc (włącznie).
 * @param toMonth - Ostatni miesiąc (włącznie).
 * @returns Wiersze tylko dla par kategoria–miesiąc z wydatkiem.
 */
export function sumCategorySpendByMonth(
  handle: DbHandle,
  householdId: string,
  fromMonth: string,
  toMonth: string,
): CategoryMonthSpendRow[] {
  return handle.db
    .select({
      categoryId: sql<string>`${transactions.categoryId}`,
      monthKey: transactions.monthKey,
      amountMinor: sql<number>`sum(${transactions.amountMinor})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.type, 'expense'),
        eq(transactions.status, 'posted'),
        isNull(transactions.deletedAt),
        isNotNull(transactions.categoryId),
        isNull(transactions.recurringOccurrenceId),
        isNull(transactions.plannedExpenseId),
        isNull(transactions.liabilityId),
        gte(transactions.monthKey, fromMonth),
        lte(transactions.monthKey, toMonth),
      ),
    )
    .groupBy(transactions.categoryId, transactions.monthKey)
    .all();
}

/**
 * Miesiąc najwcześniejszej transakcji gospodarstwa poza koszem — początek historii,
 * od którego liczy się mianownik średniej (07 §13.3).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Klucz miesiąca albo `null`, gdy gospodarstwo nie ma transakcji.
 */
export function findFirstTransactionMonth(handle: DbHandle, householdId: string): string | null {
  const row = handle.db
    .select({ monthKey: sql<string | null>`min(${transactions.monthKey})` })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), isNull(transactions.deletedAt)))
    .get();
  return row?.monthKey ?? null;
}

/** Zaksięgowana transakcja miesiąca w kształcie wejścia wykonania planu (07 §13.8). */
export interface MonthLedgerRow {
  readonly type: 'expense' | 'income' | 'transfer';
  readonly amountMinor: number;
  readonly categoryId: string | null;
  readonly incomeSourceId: string | null;
  readonly ruleId: string | null;
  readonly plannedExpenseId: string | null;
  readonly liabilityId: string | null;
  readonly goalId: string | null;
  readonly accountId: string | null;
  readonly counterAccountId: string | null;
  readonly sourceAllocationClass: 'spending' | 'savings' | 'investment' | null;
  readonly targetAllocationClass: 'spending' | 'savings' | 'investment' | null;
  readonly allocationOverride: 'none' | 'savings' | 'investment' | null;
}

/**
 * Zaksięgowane transakcje miesiąca spoza kosza z regułą opłacanego wystąpienia —
 * surowiec planu kontra wykonanie (07 §13.8, `F9-9`).
 *
 * Wiersze, nie sumy: przypisanie do linii szkicu (reguła, planowany wydatek, cel,
 * grupa kategorii) i efekty w pulach liczy `budgetActuals` z `shared` — jedno źródło
 * tych reguł. Miesiąc dwóch osób to najwyżej kilkaset wierszy.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param monthKey - Miesiąc szkicu.
 * @returns Transakcje miesiąca.
 */
export function findMonthLedger(
  handle: DbHandle,
  householdId: string,
  monthKey: string,
): MonthLedgerRow[] {
  return handle.db.all<MonthLedgerRow>(sql`
    SELECT t.type AS type, t.amount_minor AS amountMinor, t.category_id AS categoryId,
           t.income_source_id AS incomeSourceId, o.rule_id AS ruleId,
           t.planned_expense_id AS plannedExpenseId, t.liability_id AS liabilityId,
           t.goal_id AS goalId, t.account_id AS accountId,
           t.counter_account_id AS counterAccountId,
           t.source_allocation_class AS sourceAllocationClass,
           t.target_allocation_class AS targetAllocationClass,
           t.allocation_override AS allocationOverride
      FROM transactions t
      LEFT JOIN recurring_occurrences o ON o.id = t.recurring_occurrence_id
     WHERE t.household_id = ${householdId}
       AND t.month_key = ${monthKey}
       AND t.status = 'posted'
       AND t.deleted_at IS NULL
  `);
}
