import {
  allocationClassAfterTypeChange,
  defaultAllocationClass,
  todayInTimezone,
  type AccountBalanceDto,
  type AccountDetailDto,
  type AccountDto,
  type BalancesMeta,
  type BalancesQuery,
  type CreateAccountRequest,
  type ListAccountsQuery,
  type ReorderAccountsRequest,
  type UpdateAccountRequest,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import { ConflictError, NotFoundError } from '../../core/errors.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import { getHousehold } from '../auth/auth.service.js';
import { liabilitiesRemainingMinor } from '../liabilities/liabilities.external.js';
import { pauseRecurringRulesForAccount } from '../recurring/recurring.external.js';
import { accountFlows } from '../transactions/transactions.ledger.js';
import { accountBalance, buildBalances, resolveBalancePeriod } from './accounts.balances.js';
import { toAccountDto } from './accounts.mapper.js';
import {
  findAccountById,
  findAccounts,
  findMaxSortOrder,
  insertAccount,
  patchAccount,
  removeAccount,
  writeSortOrders,
  type AccountPatch,
} from './accounts.repository.js';

/**
 * Reguły zarządzania kontami — zadania `F2-1` i `F2-2`
 * ([04 §5](../../../../../../plans/04-api-spec.md#5-konta--apiv1accounts)).
 *
 * Serwis nie zwraca wierszy bazy — wyłącznie DTO
 * ([02 §3](../../../../../../plans/02-architecture.md#3-warstwy-i-kierunek-zależności)).
 * `householdId` przychodzi zawsze z tokenu; serwis przekazuje go do każdego zapytania.
 *
 * Arytmetyka sald mieszka w `accounts.balances.ts` (czyste funkcje); tutaj jest tylko
 * zebranie danych: konta, ruchy z modułu transakcji i „dziś" gospodarstwa.
 */

/** Komunikat dla konta spoza gospodarstwa albo nieistniejącego — celowo ten sam. */
const NOT_FOUND = 'Nie znaleziono konta.';

/**
 * Zwraca konta gospodarstwa w kolejności wyświetlania.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Parametry listy.
 * @returns Konta.
 */
export function listAccounts(
  handle: DbHandle,
  householdId: string,
  query: ListAccountsQuery,
): AccountDto[] {
  return findAccounts(handle, householdId, query.includeArchived).map(toAccountDto);
}

/**
 * Zwraca jedno konto gospodarstwa z saldem na dziś.
 *
 * „Dziś" liczymy w strefie gospodarstwa (07 §1.1), nie serwera — tuż po północy czasu
 * polskiego serwer w UTC wciąż jest we wczorajszym dniu.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param accountId - Identyfikator konta.
 * @returns Konto z saldem.
 * @throws {NotFoundError} Gdy konta nie ma albo należy do innego gospodarstwa.
 */
export function getAccount(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  accountId: string,
): AccountDetailDto {
  const row = findAccountById(handle, householdId, accountId);
  if (row === undefined) throw new NotFoundError(NOT_FOUND);

  const household = getHousehold(handle, householdId);
  const today = todayInTimezone(household.timezone, clock.now());
  const period = resolveBalancePeriod({}, today, household.monthStartDay);
  const flows = accountFlows(handle, householdId, period.monthStart, period.asOf);
  return {
    ...toAccountDto(row),
    balanceMinor: accountBalance(row, flows.get(row.id)).balanceMinor,
    balanceAsOf: period.asOf,
  };
}

/**
 * Zwraca konto gospodarstwa na potrzeby innego modułu — bez salda.
 *
 * Serwis transakcji sprawdza tędy konto z żądania i bierze z niego klasę alokacji do
 * migawki (I-6). O tym, czy brak konta to `404`, a archiwum `422`, decyduje wołający.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param accountId - Identyfikator konta.
 * @returns Konto albo `undefined`, także dla konta innego gospodarstwa.
 */
export function lookupAccount(
  handle: DbHandle,
  householdId: string,
  accountId: string,
): AccountDto | undefined {
  const row = findAccountById(handle, householdId, accountId);
  return row === undefined ? undefined : toAccountDto(row);
}

/**
 * Zwraca salda kont i podsumowanie majątku (07 §7).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu; potrzebny, gdy zapytanie nie podaje dnia ani miesiąca.
 * @param householdId - Gospodarstwo z tokenu.
 * @param query - Zwalidowane parametry: `asOf`, `month` albo nic.
 * @returns Salda w kolejności kont i podsumowanie.
 */
export function getAccountBalances(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  query: BalancesQuery,
): { data: AccountBalanceDto[]; meta: BalancesMeta } {
  const household = getHousehold(handle, householdId);
  const today = todayInTimezone(household.timezone, clock.now());
  const period = resolveBalancePeriod(query, today, household.monthStartDay);
  // Wszystkie konta, łącznie z zarchiwizowanymi — o tym, które pokazać, decyduje
  // `buildBalances` na podstawie salda, a nie flagi.
  const accounts = findAccounts(handle, householdId, true);
  const flows = accountFlows(handle, householdId, period.monthStart, period.asOf);
  // Zobowiązania na ten sam dzień co salda — majątek z sierpnia nie widzi raty z września.
  const liabilities = liabilitiesRemainingMinor(
    handle,
    householdId,
    period.monthStart.slice(0, 7),
    period.asOf,
  );
  return buildBalances(accounts, flows, period, liabilities);
}

/**
 * Zakłada konto.
 *
 * Pominięta `allocationClass` wynika z `type` (07 §2.1). Nowe konto trafia na koniec
 * listy — tam, gdzie użytkownik go szuka zaraz po dodaniu.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Zwalidowane dane konta.
 * @returns Założone konto.
 */
export function createAccount(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  input: CreateAccountRequest,
): AccountDto {
  const now = clock.now().getTime();
  // Odczyt pozycji i zapis w jednej transakcji: dwa konta dodane jednocześnie z dwóch
  // telefonów nie mogą dostać tego samego miejsca.
  const row = handle.sqlite.transaction(() =>
    insertAccount(handle, {
      id: newId(),
      householdId,
      name: input.name,
      type: input.type,
      allocationClass: input.allocationClass ?? defaultAllocationClass(input.type),
      openingBalanceMinor: input.openingBalanceMinor,
      openingBalanceOn: input.openingBalanceOn,
      institution: input.institution ?? null,
      color: input.color ?? null,
      icon: input.icon ?? null,
      includeInNetWorth: input.includeInNetWorth,
      sortOrder: findMaxSortOrder(handle, householdId) + 1,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    }),
  )();
  return toAccountDto(row);
}

/**
 * Zmienia konto.
 *
 * Zmiana `type` bez jawnej `allocationClass` przelicza klasę tylko wtedy, gdy nie była
 * nadpisana (`allocationClassAfterTypeChange`). Zmiana klasy **nie** dotyka historii:
 * transakcje niosą migawkę klas z chwili zapisu (niezmiennik I-6).
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param accountId - Identyfikator konta.
 * @param input - Zwalidowane zmiany; pominięte pola zostają bez zmian.
 * @returns Konto po zmianie.
 * @throws {NotFoundError} Gdy konta nie ma w gospodarstwie.
 */
export function updateAccount(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  accountId: string,
  input: UpdateAccountRequest,
): AccountDto {
  const current = findAccountById(handle, householdId, accountId);
  if (current === undefined) throw new NotFoundError(NOT_FOUND);

  const patch: AccountPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.type !== undefined) patch.type = input.type;
  if (input.allocationClass !== undefined) {
    patch.allocationClass = input.allocationClass;
  } else if (input.type !== undefined && input.type !== current.type) {
    patch.allocationClass = allocationClassAfterTypeChange(
      current.type,
      current.allocationClass,
      input.type,
    );
  }
  if (input.openingBalanceMinor !== undefined) {
    patch.openingBalanceMinor = input.openingBalanceMinor;
  }
  if (input.openingBalanceOn !== undefined) patch.openingBalanceOn = input.openingBalanceOn;
  // `null` czyści pole, `undefined` znaczy „nie przysłano" — dlatego porównanie
  // wyłącznie z `undefined`.
  if (input.institution !== undefined) patch.institution = input.institution;
  if (input.color !== undefined) patch.color = input.color;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.includeInNetWorth !== undefined) patch.includeInNetWorth = input.includeInNetWorth;

  // Puste PATCH nie jest zmianą — `updated_at` zostaje, bo nic się nie stało.
  if (Object.keys(patch).length === 0) return toAccountDto(current);

  return patchExisting(handle, householdId, accountId, patch, clock.now().getTime());
}

/**
 * Archiwizuje konto albo je przywraca.
 *
 * Archiwizacja jest odwracalna i nie dotyka historii: konto znika z list wyboru,
 * ale jego transakcje dalej liczą się w miesiącach, w których zaszły. Operacja jest
 * idempotentna — ponowna archiwizacja zwraca konto bez zmian.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param accountId - Identyfikator konta.
 * @param archived - `true` archiwizuje, `false` przywraca.
 * @returns Konto po zmianie.
 * @throws {NotFoundError} Gdy konta nie ma w gospodarstwie.
 */
export function setAccountArchived(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  accountId: string,
  archived: boolean,
): AccountDto {
  const current = findAccountById(handle, householdId, accountId);
  if (current === undefined) throw new NotFoundError(NOT_FOUND);
  if (current.isArchived === archived) return toAccountDto(current);
  const now = clock.now().getTime();
  return handle.sqlite.transaction(() => {
    // Na konto z archiwum nie da się księgować, więc reguły na nim — wstrzymane (ADR-044).
    // Przywrócenie konta ich nie wznawia: to decyzja o przyszłych płatnościach.
    if (archived) pauseRecurringRulesForAccount(handle, householdId, accountId, now);
    return patchExisting(handle, householdId, accountId, { isArchived: archived }, now);
  })();
}

/**
 * Usuwa konto bez historii (niezmiennik I-10, 07 §10).
 *
 * Reguły cykliczne na tym koncie są wstrzymywane w tej samej transakcji bazodanowej —
 * `ON DELETE SET NULL` zostawiłby je bez konta, a takiej reguły nie da się zaksięgować
 * (`Z-28`, ADR-044). Gdy usunięcie się nie uda, wstrzymanie jest cofane.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu (`updated_at` wstrzymanych reguł).
 * @param householdId - Gospodarstwo z tokenu.
 * @param accountId - Identyfikator konta.
 * @throws {NotFoundError} Gdy konta nie ma w gospodarstwie.
 * @throws {ConflictError} Gdy konto ma transakcje — wtedy wolno je tylko zarchiwizować.
 */
export function deleteAccount(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  accountId: string,
): void {
  handle.sqlite.transaction(() => {
    pauseRecurringRulesForAccount(handle, householdId, accountId, clock.now().getTime());
    const result = removeAccount(handle, householdId, accountId);
    if (result === 'not_found') throw new NotFoundError(NOT_FOUND);
    if (result === 'in_use') {
      throw new ConflictError(
        'Konto ma transakcje, więc nie można go usunąć. Możesz je zarchiwizować.',
      );
    }
  })();
}

/**
 * Ustawia kolejność kont.
 *
 * Wymienione konta dostają pozycje `0…n−1` w kolejności listy, pozostałe trafiają za
 * nie z zachowaniem dotychczasowej kolejności. Lista może więc obejmować tylko konta
 * widoczne na ekranie (aktywne), a mimo to żadne dwa konta nie dzielą miejsca.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Zwalidowana lista identyfikatorów (bez powtórzeń).
 * @returns Wszystkie konta gospodarstwa, łącznie z zarchiwizowanymi, w nowej kolejności.
 * @throws {NotFoundError} Gdy któryś identyfikator nie należy do gospodarstwa.
 */
export function reorderAccounts(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  input: ReorderAccountsRequest,
): AccountDto[] {
  const now = clock.now().getTime();
  return handle.sqlite.transaction(() => {
    const current = findAccounts(handle, householdId, true);
    const known = new Set(current.map((row) => row.id));
    if (input.ids.some((id) => !known.has(id))) throw new NotFoundError(NOT_FOUND);

    const listed = new Set(input.ids);
    const order = [...input.ids, ...current.map((row) => row.id).filter((id) => !listed.has(id))];
    const byId = new Map(current.map((row) => [row.id, row]));
    // Zapisujemy tylko to, co się zmieniło — `updated_at` konta, które zostało na
    // swoim miejscu, nie powinien sugerować edycji.
    const changed = order
      .map((id, sortOrder) => ({ id, sortOrder }))
      .filter(({ id, sortOrder }) => byId.get(id)?.sortOrder !== sortOrder);
    writeSortOrders(handle, householdId, changed, now);

    return findAccounts(handle, householdId, true).map(toAccountDto);
  })();
}

/**
 * Zapisuje zmianę konta, o którym wiadomo, że istnieje.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param accountId - Identyfikator konta.
 * @param patch - Zmieniane pola.
 * @param now - Znacznik `updated_at`.
 * @returns Konto po zmianie.
 * @throws {NotFoundError} Gdy konto zniknęło między odczytem a zapisem.
 */
function patchExisting(
  handle: DbHandle,
  householdId: string,
  accountId: string,
  patch: AccountPatch,
  now: number,
): AccountDto {
  const row = patchAccount(handle, householdId, accountId, patch, now);
  // Drugi użytkownik mógł usunąć konto w międzyczasie — lepiej 404 niż 500.
  if (row === undefined) throw new NotFoundError(NOT_FOUND);
  return toAccountDto(row);
}
