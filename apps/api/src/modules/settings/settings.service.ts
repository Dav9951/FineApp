import {
  EXPORT_FORMAT,
  EXPORT_TABLES,
  EXPORT_VERSION,
  exportFileName,
  todayInTimezone,
  type ExportDto,
  type ExportTable,
  type HouseholdDto,
  type MonthKey,
  type ResetDataRequest,
  type ResetDataResult,
  type SettingsDto,
  type UpdateHouseholdRequest,
  type UpdateProfileRequest,
  type UserDto,
} from '@fineapp/shared';

import type { Clock } from '../../core/clock.js';
import { DomainRuleViolationError, NotFoundError } from '../../core/errors.js';
import type { DbHandle } from '../../db/client.js';
import { lookupAccount } from '../accounts/accounts.service.js';
import {
  confirmPin,
  getHousehold,
  listExportUsers,
  listMembers,
  updateHouseholdSettings,
  updateProfile,
} from '../auth/auth.service.js';
import { removeStoredFiles } from '../documents/documents.files.js';
import { buildTransactionsCsv } from './settings.csv.js';
import {
  readCsvLookups,
  readCsvTransactions,
  readExportTables,
} from './settings.export.repository.js';
import { deleteHouseholdData } from './settings.reset.repository.js';

/**
 * Reguły modułu ustawień ([04 §15](../../../../../../plans/04-api-spec.md#15-ustawienia--apiv1settings)).
 *
 * Gospodarstwo i domownicy należą do modułu `auth` — ten moduł tylko je składa
 * i wystawia; eksport czyta tabele wprost przez własne repozytorium (ADR-061).
 */

/** Zależności serwisu. */
export interface SettingsDeps {
  db: DbHandle;
  clock: Clock;
  /** Katalog uploadów — usunięcie danych kasuje też zdjęcia dokumentów. */
  uploadDir: string;
  /** Wersja aplikacji — ta sama, co w `/health`. */
  version: string;
}

/** Kontekst z tokenu. */
export interface SettingsContext {
  householdId: string;
  userId: string;
}

/**
 * Ustawienia gospodarstwa z domownikami — `GET /settings`.
 *
 * @param deps - Zależności.
 * @param context - Kontekst z tokenu.
 * @returns Ustawienia.
 */
export function getSettings(deps: SettingsDeps, context: SettingsContext): SettingsDto {
  return {
    household: getHousehold(deps.db, context.householdId),
    users: listMembers(deps.db, context.householdId, context.userId),
    appVersion: deps.version,
  };
}

/**
 * Zmienia ustawienia gospodarstwa — `PATCH /settings/household`.
 *
 * Domyślne konto wydatków (ADR-070) musi być aktywnym kontem tego gospodarstwa: konto
 * z archiwum proponowane w każdym formularzu kończyłoby się `422` przy zapisie wydatku.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Zwalidowane zmiany.
 * @returns Ustawienia gospodarstwa po zmianie.
 * @throws {NotFoundError} Gdy konto nie należy do gospodarstwa.
 * @throws {DomainRuleViolationError} Gdy konto jest zarchiwizowane.
 */
export function changeHousehold(
  deps: SettingsDeps,
  householdId: string,
  input: UpdateHouseholdRequest,
): HouseholdDto {
  const accountId = input.defaultExpenseAccountId;
  if (accountId !== undefined && accountId !== null) {
    const account = lookupAccount(deps.db, householdId, accountId);
    if (account === undefined) {
      throw new NotFoundError('Nie znaleziono konta.', [
        { path: 'defaultExpenseAccountId', message: 'Nie ma takiego konta.' },
      ]);
    }
    if (account.isArchived) {
      throw new DomainRuleViolationError('Konto jest zarchiwizowane.', [
        { path: 'defaultExpenseAccountId', message: 'Konto jest zarchiwizowane.' },
      ]);
    }
  }
  return updateHouseholdSettings(deps.db, deps.clock, householdId, input);
}

/**
 * Zmienia własny profil — `PATCH /settings/profile`.
 *
 * @param deps - Zależności.
 * @param context - Kontekst z tokenu.
 * @param input - Zwalidowane zmiany.
 * @returns Profil po zmianie.
 */
export function changeProfile(
  deps: SettingsDeps,
  context: SettingsContext,
  input: UpdateProfileRequest,
): UserDto {
  return updateProfile(deps.db, deps.clock, context, input);
}

/** Plik do pobrania: treść i nazwa. */
export interface ExportFile<T> {
  body: T;
  fileName: string;
}

/**
 * Pełny eksport gospodarstwa do JSON — `GET /settings/export`.
 *
 * Wiersze tabel przechodzą **w całości**: to kopia tego, co jest w bazie, a nie widok
 * dla ekranu. Pola wrażliwe nie mogą się tu dostać, bo tabele, które je mają
 * (`users`, `auth_*`), albo idą przez mapper pole po polu, albo nie są czytane wcale.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Treść i nazwa pliku z dzisiejszą datą gospodarstwa.
 */
export function exportJson(deps: SettingsDeps, householdId: string): ExportFile<ExportDto> {
  const household = getHousehold(deps.db, householdId);
  const now = deps.clock.now();
  const rows = readExportTables(deps.db, householdId);
  const tables = Object.fromEntries(
    EXPORT_TABLES.map((table) => [table, rows[table].map((row) => ({ ...row }))]),
  ) as Record<ExportTable, Record<string, unknown>[]>;

  return {
    body: {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now.getTime(),
      appVersion: deps.version,
      household,
      users: listExportUsers(deps.db, householdId),
      tables,
    },
    fileName: exportFileName('json', todayInTimezone(household.timezone, now)),
  };
}

/**
 * Eksport transakcji do CSV — `GET /settings/export.csv?month=`.
 *
 * @param deps - Zależności.
 * @param householdId - Gospodarstwo z tokenu.
 * @param month - Miesiąc; pominięty — wszystkie transakcje.
 * @returns Treść i nazwa pliku (z miesiącem albo z dzisiejszą datą).
 */
export function exportCsv(
  deps: SettingsDeps,
  householdId: string,
  month: MonthKey | undefined,
): ExportFile<string> {
  const household = getHousehold(deps.db, householdId);
  const body = buildTransactionsCsv(
    readCsvTransactions(deps.db, householdId, month),
    readCsvLookups(deps.db, householdId),
  );
  const stamp = month ?? todayInTimezone(household.timezone, deps.clock.now());
  return { body, fileName: exportFileName('csv', stamp) };
}

/**
 * Usuwa wszystkie dane gospodarstwa — `POST /settings/reset` (ADR-072).
 *
 * Kolejność: PIN → baza w jednej transakcji → pliki. Pliki idą **po** zatwierdzeniu:
 * odwrotnie, błąd bazy zostawiłby dokumenty bez zdjęć. Plik, którego nie udało się
 * usunąć, zostaje sierotą na dysku — nikt go już nie wskaże, a dane w bazie są spójne.
 *
 * @param deps - Zależności.
 * @param context - Kontekst z tokenu.
 * @param input - PIN potwierdzający.
 * @returns Liczby usuniętych wierszy.
 * @throws {UnauthorizedError} Gdy PIN się nie zgadza.
 */
export async function resetData(
  deps: SettingsDeps,
  context: SettingsContext,
  input: ResetDataRequest,
): Promise<ResetDataResult> {
  await confirmPin(deps.db, context.userId, input.pin);
  const { deleted, storagePaths } = deleteHouseholdData(
    deps.db,
    context.householdId,
    deps.clock.now().getTime(),
  );
  await Promise.allSettled(
    storagePaths.map((storagePath) => removeStoredFiles(deps.uploadDir, storagePath)),
  );
  return { deleted };
}
