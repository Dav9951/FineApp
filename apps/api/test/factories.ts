import type { Config } from '../src/core/config.js';
import { newId } from '../src/core/id.js';
import type { DbHandle } from '../src/db/client.js';
import { accounts, type AccountInsert } from '../src/db/schema/accounts.js';
import {
  budgetDraftGroups,
  budgetDraftLines,
  budgetDrafts,
  type BudgetDraftGroupInsert,
  type BudgetDraftLineInsert,
} from '../src/db/schema/budget.js';
import { categories, type CategoryInsert } from '../src/db/schema/categories.js';
import { goals } from '../src/db/schema/goals.js';
import { households } from '../src/db/schema/households.js';
import { incomeSources, type IncomeSourceInsert } from '../src/db/schema/income-sources.js';
import { liabilities } from '../src/db/schema/liabilities.js';
import { transactions, type TransactionInsert } from '../src/db/schema/transactions.js';
import { users } from '../src/db/schema/users.js';
import { signAccessToken } from '../src/modules/auth/auth.tokens.js';

/**
 * Fabryki danych testowych dla modułów domenowych
 * ([02 §9](../../../plans/02-architecture.md#9-testy)).
 *
 * Wiersze są wstawiane **wprost do bazy**, z pominięciem serwisów innych modułów:
 * test modułu kont nie może się wywrócić, bo zmieniła się walidacja transakcji.
 * Token dostępu jest podpisywany bezpośrednio — logowanie przez `/auth/login`
 * kosztuje prawdziwe haszowanie argon2 i jest już pokryte testami modułu `auth`.
 */

/** Gospodarstwo z jednym użytkownikiem i gotowym nagłówkiem autoryzacji. */
export interface HouseholdFixture {
  readonly householdId: string;
  readonly userId: string;
  /** Nagłówki żądania: `Authorization` i nagłówek CSRF. */
  readonly headers: Readonly<Record<string, string>>;
}

/** Nagłówek wymagany przez strażnika CSRF przy metodach zmieniających stan. */
export const CSRF_HEADER = { 'x-requested-with': 'fineapp' } as const;

/**
 * Zakłada gospodarstwo z jednym użytkownikiem i podpisuje dla niego token dostępu.
 *
 * Dwa wywołania dają dwa rozłączne gospodarstwa — tak testujemy, że zasób cudzego
 * gospodarstwa jest niewidoczny (`404`, nie `403`).
 *
 * @param handle - Uchwyt bazy.
 * @param config - Konfiguracja (sekret podpisu tokenu).
 * @param now - Chwila wystawienia tokenu; musi zgadzać się z zegarem aplikacji.
 * @returns Identyfikatory i nagłówki żądania.
 */
export async function householdFixture(
  handle: DbHandle,
  config: Config,
  now: Date,
): Promise<HouseholdFixture> {
  const at = now.getTime();
  const householdId = newId();
  const userId = newId();
  handle.db
    .insert(households)
    .values({ id: householdId, name: 'Dom', createdAt: at, updatedAt: at })
    .run();
  handle.db
    .insert(users)
    .values({
      id: userId,
      householdId,
      email: `${userId.toLowerCase()}@example.com`,
      displayName: 'Test',
      // Hash nie musi być prawdziwy: ten użytkownik nigdy się nie loguje.
      pinHash: 'nie-jest-hashem',
      pinUpdatedAt: at,
      createdAt: at,
      updatedAt: at,
    })
    .run();

  const token = await signAccessToken(config, { sub: userId, hid: householdId, sid: newId() }, now);
  return {
    householdId,
    userId,
    headers: { authorization: `Bearer ${token}`, ...CSRF_HEADER },
  };
}

/**
 * Wstawia transakcję z rozsądnymi wartościami domyślnymi.
 *
 * Omija serwis transakcji celowo — patrz opis modułu. Wartości domyślne opisują
 * zwykły wydatek; test nadpisuje tylko to, co go interesuje.
 *
 * @param handle - Uchwyt bazy.
 * @param fixture - Gospodarstwo i autor transakcji.
 * @param overrides - Nadpisane kolumny.
 * @returns Identyfikator wstawionej transakcji.
 */
export function insertTransaction(
  handle: DbHandle,
  fixture: Pick<HouseholdFixture, 'householdId' | 'userId'>,
  overrides: Partial<TransactionInsert> = {},
): string {
  const id = newId();
  const at = Date.now();
  handle.db
    .insert(transactions)
    .values({
      id,
      householdId: fixture.householdId,
      type: 'expense',
      bookedOn: '2026-09-10',
      monthKey: '2026-09',
      amountMinor: 1_000,
      source: 'manual',
      createdBy: fixture.userId,
      createdAt: at,
      updatedAt: at,
      ...overrides,
    })
    .run();
  return id;
}

/** Gospodarstwo, w którym powstaje wiersz. */
type Owner = Pick<HouseholdFixture, 'householdId'>;

/**
 * Wstawia konto — domyślnie aktywne konto bieżące z saldem 0 od 1 stycznia 2026.
 *
 * @param handle - Uchwyt bazy.
 * @param owner - Gospodarstwo.
 * @param overrides - Nadpisane kolumny.
 * @returns Identyfikator konta.
 */
export function insertAccount(
  handle: DbHandle,
  owner: Owner,
  overrides: Partial<AccountInsert> = {},
): string {
  const id = newId();
  const at = Date.now();
  handle.db
    .insert(accounts)
    .values({
      id,
      householdId: owner.householdId,
      name: 'ROR',
      type: 'checking',
      allocationClass: 'spending',
      openingBalanceOn: '2026-01-01',
      createdAt: at,
      updatedAt: at,
      ...overrides,
    })
    .run();
  return id;
}

/**
 * Wstawia kategorię — domyślnie kategorię wydatków.
 *
 * @param handle - Uchwyt bazy.
 * @param owner - Gospodarstwo.
 * @param overrides - Nadpisane kolumny.
 * @returns Identyfikator kategorii.
 */
export function insertCategory(
  handle: DbHandle,
  owner: Owner,
  overrides: Partial<CategoryInsert> = {},
): string {
  const id = newId();
  const at = Date.now();
  handle.db
    .insert(categories)
    .values({
      id,
      householdId: owner.householdId,
      name: `Kategoria ${id.slice(-4)}`,
      slug: `kategoria-${id.toLowerCase()}`,
      kind: 'expense',
      createdAt: at,
      updatedAt: at,
      ...overrides,
    })
    .run();
  return id;
}

/**
 * Wstawia źródło przychodu — domyślnie pensję.
 *
 * @param handle - Uchwyt bazy.
 * @param owner - Gospodarstwo.
 * @param overrides - Nadpisane kolumny.
 * @returns Identyfikator źródła.
 */
export function insertIncomeSource(
  handle: DbHandle,
  owner: Owner,
  overrides: Partial<IncomeSourceInsert> = {},
): string {
  const id = newId();
  const at = Date.now();
  handle.db
    .insert(incomeSources)
    .values({
      id,
      householdId: owner.householdId,
      name: `Pensja ${id.slice(-4)}`,
      kind: 'salary',
      createdAt: at,
      updatedAt: at,
      ...overrides,
    })
    .run();
  return id;
}

/**
 * Wstawia cel oszczędnościowy bez planu wpłat.
 *
 * Moduł celów powstaje w Fazie 5; do tego czasu cel da się założyć tylko tak.
 *
 * @param handle - Uchwyt bazy.
 * @param owner - Gospodarstwo.
 * @param name - Nazwa celu.
 * @returns Identyfikator celu.
 */
export function insertGoal(handle: DbHandle, owner: Owner, name = 'Mieszkanie'): string {
  const id = newId();
  const at = Date.now();
  handle.db
    .insert(goals)
    .values({
      id,
      householdId: owner.householdId,
      name,
      kind: 'savings',
      contributionMode: 'none',
      createdAt: at,
      updatedAt: at,
    })
    .run();
  return id;
}

/**
 * Wstawia zobowiązanie.
 *
 * Moduł zobowiązań powstaje w `F4-4`; do tego czasu zobowiązanie da się założyć tylko tak.
 *
 * @param handle - Uchwyt bazy.
 * @param owner - Gospodarstwo.
 * @param name - Nazwa zobowiązania.
 * @returns Identyfikator zobowiązania.
 */
export function insertLiability(handle: DbHandle, owner: Owner, name = 'Hipoteka'): string {
  const id = newId();
  const at = Date.now();
  handle.db
    .insert(liabilities)
    .values({
      id,
      householdId: owner.householdId,
      name,
      kind: 'mortgage',
      openingBalanceMinor: 30_000_000,
      balanceAsOf: '2026-01-01',
      monthlyPaymentMinor: 250_000,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  return id;
}

/**
 * Wstawia szkic budżetu miesiąca.
 *
 * Moduł `budget` powstaje w `F9-4`; do tego czasu szkic da się założyć tylko tak.
 *
 * @param handle - Uchwyt bazy.
 * @param fixture - Gospodarstwo i autor szkicu.
 * @param monthKey - Miesiąc planu.
 * @returns Identyfikator szkicu.
 */
export function insertBudgetDraft(
  handle: DbHandle,
  fixture: HouseholdFixture,
  monthKey = '2026-10',
): string {
  const id = newId();
  const at = Date.now();
  handle.db
    .insert(budgetDrafts)
    .values({
      id,
      householdId: fixture.householdId,
      monthKey,
      createdBy: fixture.userId,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  return id;
}

/**
 * Wstawia linię szkicu budżetu — domyślnie własny wydatek 100,00 zł.
 *
 * @param handle - Uchwyt bazy.
 * @param owner - Gospodarstwo.
 * @param draftId - Szkic, do którego należy linia.
 * @param overrides - Nadpisane kolumny.
 * @returns Identyfikator linii.
 */
export function insertBudgetLine(
  handle: DbHandle,
  owner: Owner,
  draftId: string,
  overrides: Partial<BudgetDraftLineInsert> = {},
): string {
  const id = newId();
  const at = Date.now();
  handle.db
    .insert(budgetDraftLines)
    .values({
      id,
      householdId: owner.householdId,
      draftId,
      flow: 'expense',
      name: 'Prezent',
      amountMinor: 100_00,
      createdAt: at,
      updatedAt: at,
      ...overrides,
    })
    .run();
  return id;
}

/**
 * Wstawia grupę szkicu budżetu (03 §3.21) — domyślnie „Raty" w wydatkach.
 *
 * @param handle - Uchwyt bazy.
 * @param owner - Gospodarstwo.
 * @param draftId - Szkic, do którego należy grupa.
 * @param overrides - Nadpisane kolumny.
 * @returns Identyfikator grupy.
 */
export function insertBudgetGroup(
  handle: DbHandle,
  owner: Owner,
  draftId: string,
  overrides: Partial<BudgetDraftGroupInsert> = {},
): string {
  const id = newId();
  const at = Date.now();
  handle.db
    .insert(budgetDraftGroups)
    .values({
      id,
      householdId: owner.householdId,
      draftId,
      section: 'expense',
      name: 'Raty',
      createdAt: at,
      updatedAt: at,
      ...overrides,
    })
    .run();
  return id;
}
