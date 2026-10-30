import type { AllocationClass, TransactionType } from '@fineapp/shared';

import { DomainRuleViolationError, NotFoundError } from '../../core/errors.js';
import type { DbHandle } from '../../db/client.js';
import { lookupAccount } from '../accounts/accounts.service.js';
import { lookupCategory } from '../categories/categories.service.js';
import { isGoalInHousehold } from '../goals/goals.external.js';
import { lookupIncomeSource } from '../income-sources/income-sources.service.js';
import { isLiabilityInHousehold } from '../liabilities/liabilities.external.js';

/**
 * Sprawdzenia odwołań zapisu, który tworzy albo opisuje transakcję — wspólne dla
 * transakcji (`F2-5`) i reguł cyklicznych (`F4-1`, ADR-043).
 *
 * Reguła cykliczna utworzy kiedyś transakcję z tymi samymi kontami, kategorią, źródłem,
 * celem i zobowiązaniem. Gdyby sprawdzała je inaczej, błąd wyszedłby dopiero przy
 * księgowaniu — miesiące po zapisie reguły. Plik importuje wyłącznie serwisy innych
 * modułów (02 §3), więc woła go i serwis transakcji, i serwis reguł, bez cyklu.
 */

/** Nazwa rodzaju kategorii w dopełniaczu — do komunikatu I-4. */
const KIND_GENITIVE: Readonly<Record<TransactionType, string>> = {
  expense: 'wydatków',
  income: 'przychodów',
  transfer: 'przelewów',
};

/**
 * Odwołania do innych bytów, które zapis ustawia albo zmienia.
 *
 * `undefined` = pole bez zmian (nie sprawdzamy), `null` = pole czyszczone (nie ma czego
 * sprawdzać), identyfikator = trzeba sprawdzić.
 */
export interface ReferenceChanges {
  readonly accountId?: string | null;
  readonly counterAccountId?: string | null;
  readonly categoryId?: string | null;
  readonly incomeSourceId?: string | null;
  readonly goalId?: string | null;
  readonly liabilityId?: string | null;
}

/** Klasy kont wskazanych w zapisie — materiał na migawki (I-6). */
export interface AccountClasses {
  source?: AllocationClass;
  target?: AllocationClass;
}

/**
 * Sprawdza konto wskazane w transakcji.
 *
 * Konto zarchiwizowane odrzucamy: archiwizacja znaczy „już tego nie używam", a lista
 * wyboru w formularzu go nie pokazuje. Transakcje, które już na nim są, zostają
 * nietknięte — sprawdzenie dotyczy tylko ustawianego odwołania (ADR-035).
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param accountId - Identyfikator konta.
 * @param path - Pole żądania, do podświetlenia w formularzu.
 * @returns Klasa alokacji konta.
 * @throws {NotFoundError} Gdy konta nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Gdy konto jest zarchiwizowane.
 */
function accountClass(
  handle: DbHandle,
  householdId: string,
  accountId: string,
  path: 'accountId' | 'counterAccountId',
): AllocationClass {
  const account = lookupAccount(handle, householdId, accountId);
  if (account === undefined) {
    throw new NotFoundError('Nie znaleziono konta.', [{ path, message: 'Nie znaleziono konta' }]);
  }
  if (account.isArchived) {
    throw new DomainRuleViolationError(
      `Konto „${account.name}” jest zarchiwizowane. Przywróć je, żeby na nim księgować.`,
      [{ path, message: 'Konto jest zarchiwizowane' }],
    );
  }
  return account.allocationClass;
}

/**
 * Sprawdza odwołania ustawiane przez zapis: istnienie w gospodarstwie, archiwum, I-4.
 *
 * Byt spoza gospodarstwa daje `404` — tak samo jak każdy cudzy zasób (09 §4); nie
 * zdradzamy, że identyfikator istnieje gdzie indziej.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param type - Typ transakcji.
 * @param refs - Ustawiane odwołania.
 * @returns Klasy wskazanych kont.
 * @throws {NotFoundError} Gdy wskazanego bytu nie ma w gospodarstwie.
 * @throws {DomainRuleViolationError} Gdy byt jest zarchiwizowany albo kategoria ma zły rodzaj.
 */
export function checkTransactionReferences(
  handle: DbHandle,
  householdId: string,
  type: TransactionType,
  refs: ReferenceChanges,
): AccountClasses {
  const classes: AccountClasses = {};
  if (refs.accountId) {
    classes.source = accountClass(handle, householdId, refs.accountId, 'accountId');
  }
  if (refs.counterAccountId) {
    classes.target = accountClass(handle, householdId, refs.counterAccountId, 'counterAccountId');
  }

  if (refs.categoryId) {
    const category = lookupCategory(handle, householdId, refs.categoryId);
    if (category === undefined) {
      throw new NotFoundError('Nie znaleziono kategorii.', [
        { path: 'categoryId', message: 'Nie znaleziono kategorii' },
      ]);
    }
    if (category.kind !== type) {
      throw new DomainRuleViolationError(
        `Kategoria „${category.name}” nie pasuje do typu transakcji — wybierz kategorię ${KIND_GENITIVE[type]}.`,
        [{ path: 'categoryId', message: 'Kategoria innego rodzaju' }],
      );
    }
    if (category.isArchived) {
      throw new DomainRuleViolationError(`Kategoria „${category.name}” jest zarchiwizowana.`, [
        { path: 'categoryId', message: 'Kategoria jest zarchiwizowana' },
      ]);
    }
  }

  if (refs.incomeSourceId) {
    const source = lookupIncomeSource(handle, householdId, refs.incomeSourceId);
    if (source === undefined) {
      throw new NotFoundError('Nie znaleziono źródła przychodu.', [
        { path: 'incomeSourceId', message: 'Nie znaleziono źródła przychodu' },
      ]);
    }
    if (source.isArchived) {
      throw new DomainRuleViolationError(`Źródło „${source.name}” jest zarchiwizowane.`, [
        { path: 'incomeSourceId', message: 'Źródło jest zarchiwizowane' },
      ]);
    }
  }

  if (refs.goalId && !isGoalInHousehold(handle, householdId, refs.goalId)) {
    throw new NotFoundError('Nie znaleziono celu.', [
      { path: 'goalId', message: 'Nie znaleziono celu' },
    ]);
  }
  if (refs.liabilityId && !isLiabilityInHousehold(handle, householdId, refs.liabilityId)) {
    throw new NotFoundError('Nie znaleziono zobowiązania.', [
      { path: 'liabilityId', message: 'Nie znaleziono zobowiązania' },
    ]);
  }

  return classes;
}
