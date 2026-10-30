import { sql } from 'drizzle-orm';

import type { DbHandle } from '../../db/client.js';
import {
  debtRepaymentSql,
  incomeBaseSql,
  transferEffectSql,
} from '../../db/sql/allocation-effect.js';

/**
 * Zapytania agregujące ekranu miesiąca — zadania `F3-1` i `F3-2`.
 *
 * > **Świadomy wyjątek od 02 §3, reguła 4.** To jedyne repozytorium, które czyta tabele
 * > innych modułów (`transactions`, `income_sources`, `categories`) bezpośrednio.
 * > `GET /months/:key/summary` zasila główny ekran aplikacji; złożenie go z wywołań
 * > serwisów dałoby kaskadę zapytań na łączu komórkowym
 * > ([02 §3](../../../../../../plans/02-architecture.md#moduł-months--świadomy-wyjątek)).
 * > Przywilej dotyczy **odczytu** — zapisy zawsze idą przez serwis właściciela.
 *
 * Każde zapytanie o sumy: `status = 'posted'` i `deleted_at IS NULL` (reguła 5
 * z `CLAUDE.md`) — `pending` jeszcze nie ruszyło pieniędzy, `void` nigdy nie ruszy.
 * `householdId` jest pierwszym argumentem po uchwycie (reguła 4 z `CLAUDE.md`).
 */

/** Sumy jednego miesiąca, zanim serwis wyliczy wynik netto. */
export interface MonthTotalsRow {
  /** Czy w miesiącu jest jakakolwiek transakcja w księdze, niezależnie od statusu. */
  readonly transactionCount: number;
  readonly incomeMinor: number;
  readonly incomeBaseMinor: number;
  readonly expenseMinor: number;
  readonly savingsMinor: number;
  readonly investmentMinor: number;
  readonly debtRepaymentMinor: number;
}

/**
 * Sumuje strumienie pieniądza w miesiącu jednym przebiegiem.
 *
 * - **podstawa procentu** (07 §2.3): przychody bez źródła albo ze źródłem liczonym do
 *   alokacji — flaga źródła nie jest migawką, więc jej zmiana działa wstecz (ADR-034);
 * - **oszczędności / inwestycje**: efekty netto przelewów (07 §2.4) — mogą być ujemne;
 * - **spłata zobowiązań** (07 §2.2a): wydatki z `liability_id`, chyba że wyłączone `'none'`.
 *
 * Jedno zapytanie, a nie po jednym na strumień: dwa odczyty mogłyby zobaczyć różny stan
 * bazy, gdyby drugi użytkownik coś zaksięgował pomiędzy — sumy by się nie zgadzały.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param monthKey - Klucz miesiąca.
 * @returns Sumy miesiąca; zera, gdy transakcji nie ma.
 */
export function sumMonthTotals(
  handle: DbHandle,
  householdId: string,
  monthKey: string,
): MonthTotalsRow {
  const posted = sql`t.status = 'posted'`;
  const row = handle.db.get<MonthTotalsRow>(sql`
    SELECT count(*) AS transactionCount,
           coalesce(sum(CASE WHEN ${posted} AND t.type = 'income'
             THEN t.amount_minor ELSE 0 END), 0) AS incomeMinor,
           coalesce(sum(CASE WHEN ${posted} THEN ${incomeBaseSql()} ELSE 0 END), 0)
             AS incomeBaseMinor,
           coalesce(sum(CASE WHEN ${posted} AND t.type = 'expense'
             THEN t.amount_minor ELSE 0 END), 0) AS expenseMinor,
           coalesce(sum(CASE WHEN ${posted} THEN ${transferEffectSql('savings')} ELSE 0 END), 0)
             AS savingsMinor,
           coalesce(sum(CASE WHEN ${posted} THEN ${transferEffectSql('investment')} ELSE 0 END), 0)
             AS investmentMinor,
           coalesce(sum(CASE WHEN ${posted} THEN ${debtRepaymentSql()} ELSE 0 END), 0)
             AS debtRepaymentMinor
      FROM transactions t
      LEFT JOIN income_sources s ON s.id = t.income_source_id
     WHERE t.household_id = ${householdId}
       AND t.month_key = ${monthKey}
       AND t.deleted_at IS NULL
  `);
  return (
    row ?? {
      transactionCount: 0,
      incomeMinor: 0,
      incomeBaseMinor: 0,
      expenseMinor: 0,
      savingsMinor: 0,
      investmentMinor: 0,
      debtRepaymentMinor: 0,
    }
  );
}

/** Wydatki jednej kategorii (albo „bez kategorii") w dwóch miesiącach. */
export interface CategoryExpenseRow {
  /** `null` — wydatki bez kategorii. */
  readonly categoryId: string | null;
  readonly amountMinor: number;
  readonly transactionCount: number;
  readonly previousAmountMinor: number;
}

/**
 * Sumuje zaksięgowane wydatki per kategoria w miesiącu i miesiącu poprzednim.
 *
 * Grupowanie po kategorii **transakcji** (także podkategorii); zwinięcie do kategorii
 * głównej robi serwis, bo potrzebuje drzewa kategorii. Wiersz jest, gdy kategoria ma
 * wydatek w którymkolwiek z dwóch miesięcy — spadek do zera też jest informacją.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @param monthKey - Miesiąc oglądany.
 * @param previousMonthKey - Miesiąc poprzedni.
 * @returns Wiersze w nieokreślonej kolejności.
 */
export function sumCategoryExpenses(
  handle: DbHandle,
  householdId: string,
  monthKey: string,
  previousMonthKey: string,
): CategoryExpenseRow[] {
  return handle.db.all<CategoryExpenseRow>(sql`
    SELECT t.category_id AS categoryId,
           coalesce(sum(CASE WHEN t.month_key = ${monthKey} THEN t.amount_minor END), 0)
             AS amountMinor,
           count(CASE WHEN t.month_key = ${monthKey} THEN 1 END) AS transactionCount,
           coalesce(sum(CASE WHEN t.month_key = ${previousMonthKey} THEN t.amount_minor END), 0)
             AS previousAmountMinor
      FROM transactions t
     WHERE t.household_id = ${householdId}
       AND t.month_key IN (${monthKey}, ${previousMonthKey})
       AND t.type = 'expense'
       AND t.status = 'posted'
       AND t.deleted_at IS NULL
     GROUP BY t.category_id
  `);
}

/** Kategoria wydatków potrzebna do zwinięcia sum do kategorii głównych. */
export interface ExpenseCategoryRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly sortOrder: number;
}

/**
 * Zwraca wszystkie kategorie wydatków gospodarstwa — **łącznie z zarchiwizowanymi**.
 *
 * Archiwum jest potrzebne: transakcja z marca może wskazywać kategorię zarchiwizowaną
 * w listopadzie, a jej kwota nie może zniknąć z rozbicia marca (07 §10).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Kategorie w kolejności wyświetlania.
 */
export function findExpenseCategories(handle: DbHandle, householdId: string): ExpenseCategoryRow[] {
  return handle.db.all<ExpenseCategoryRow>(sql`
    SELECT c.id AS id, c.parent_id AS parentId, c.name AS name, c.color AS color,
           c.icon AS icon, c.sort_order AS sortOrder
      FROM categories c
     WHERE c.household_id = ${householdId}
       AND c.kind = 'expense'
     ORDER BY c.sort_order, c.name
  `);
}

/**
 * Zwraca miesiące, w których gospodarstwo ma choć jedną transakcję w księdze.
 *
 * Z każdym statusem — miesiąc z samą transakcją `pending` też „ma dane" dla nawigatora.
 * `DISTINCT` po indeksie `(household_id, month_key, booked_on)`, bez czytania wierszy.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Identyfikator gospodarstwa.
 * @returns Klucze miesięcy rosnąco.
 */
export function findMonthsWithTransactions(handle: DbHandle, householdId: string): string[] {
  return handle.db
    .all<{ monthKey: string }>(
      sql`
      SELECT DISTINCT t.month_key AS monthKey
        FROM transactions t
       WHERE t.household_id = ${householdId}
         AND t.deleted_at IS NULL
       ORDER BY t.month_key
    `,
    )
    .map((row) => row.monthKey);
}
