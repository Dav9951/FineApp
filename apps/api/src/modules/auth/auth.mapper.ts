import type {
  ExportDto,
  HouseholdDto,
  HouseholdMemberDto,
  SessionDto,
  UserDto,
} from '@fineapp/shared';

import type { HouseholdRow } from '../../db/schema/households.js';
import type { UserRow } from '../../db/schema/users.js';
import type { LiveSessionRow } from './auth.repository.js';

/**
 * Mapowanie wierszy uwierzytelniania na DTO.
 *
 * Mapper jest **jedynym** miejscem, w którym `snake_case` bazy spotyka się z `camelCase`
 * kontraktu ([02 §8](../../../../../../plans/02-architecture.md)). Jest też ostatnią
 * barierą przed wyciekiem `pin_hash`: wiersz przepisujemy **pole po polu**, nigdy
 * rozrzuceniem `...row`, bo rozrzucenie przepuści każdą kolumnę dodaną w przyszłości.
 */

/**
 * Zamienia wiersz użytkownika na profil publiczny.
 *
 * @param row - Wiersz z bazy.
 * @returns Profil bez pól wrażliwych.
 */
export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarColor: row.avatarColor,
    lastLoginAt: row.lastLoginAt,
  };
}

/**
 * Zamienia wiersz gospodarstwa na DTO.
 *
 * @param row - Wiersz z bazy.
 * @returns Ustawienia gospodarstwa.
 */
export function toHouseholdDto(row: HouseholdRow): HouseholdDto {
  return {
    id: row.id,
    name: row.name,
    baseCurrency: row.baseCurrency,
    timezone: row.timezone,
    locale: row.locale,
    backPostingLimitMonths: row.backPostingLimitMonths,
    monthStartDay: row.monthStartDay,
    defaultExpenseAccountId: row.defaultExpenseAccountId,
  };
}

/**
 * Zamienia żywą sesję na pozycję listy urządzeń.
 *
 * `id` to **identyfikator rodziny**, nie wiersza: rotacja zmienia wiersz przy każdym
 * odświeżeniu, więc identyfikator wiersza nie nadaje się ani do pokazania, ani do
 * przekazania do `DELETE /auth/sessions/:id`.
 *
 * `createdAt` to moment **zalogowania urządzenia**, a nie ostatniej rotacji — inaczej
 * lista pokazywałaby, że każde urządzenie zalogowało się przed chwilą.
 *
 * @param row - Wiersz żywej sesji.
 * @param currentFamilyId - Rodzina, z której idzie bieżące żądanie.
 * @param currentIpHash - Hash adresu IP bieżącego żądania.
 * @returns Pozycja listy sesji.
 */
export function toSessionDto(
  row: LiveSessionRow,
  currentFamilyId: string,
  currentIpHash: string | null,
): SessionDto {
  return {
    id: row.familyId,
    deviceLabel: row.deviceLabel,
    current: row.familyId === currentFamilyId,
    // Z hasha IP nie da się odczytać miejsca — można go tylko porównać (09 §3.5).
    sameDevice: currentIpHash !== null && row.ipHash === currentIpHash,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.familyCreatedAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Zamienia wiersz użytkownika na pozycję listy domowników w ustawieniach.
 *
 * @param row - Wiersz z bazy.
 * @param currentUserId - Użytkownik z tokenu.
 * @returns Domownik bez pól wrażliwych.
 */
export function toMemberDto(row: UserRow, currentUserId: string): HouseholdMemberDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarColor: row.avatarColor,
    isCurrent: row.id === currentUserId,
    lastLoginAt: row.lastLoginAt,
  };
}

/**
 * Zamienia wiersz użytkownika na wpis eksportu — pole po polu, bez hasha PIN-u.
 *
 * @param row - Wiersz z bazy.
 * @returns Użytkownik w pliku eksportu.
 */
export function toExportUser(row: UserRow): ExportDto['users'][number] {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarColor: row.avatarColor,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}
