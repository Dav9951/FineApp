import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { boolColumn, idColumn, timestampColumn, timestamps } from './_shared.js';
import { households } from './households.js';

/**
 * Użytkownicy gospodarstwa — najwyżej dwóch aktywnych (decyzja produktowa, 09 §10).
 *
 * Licznik nieudanych prób i blokada **nie są** tutaj, tylko w {@link authAttempts}.
 * Dzięki temu limitowanie działa również dla adresów, które nie istnieją, i nie zdradza,
 * które konta są prawdziwe ([09](../../../../../plans/09-security-auth.md)).
 */
export const users = sqliteTable('users', {
  id: idColumn(),
  householdId: text('household_id')
    .notNull()
    .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
  /** Zawsze zapisywany małymi literami i przycięty (niezmiennik I-15). */
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  /** argon2id — zawiera sól i parametry. Nigdy nie trafia do logu ani do odpowiedzi. */
  pinHash: text('pin_hash').notNull(),
  pinUpdatedAt: timestampColumn('pin_updated_at').notNull(),
  /** Do odróżnienia autorów transakcji w UI. */
  avatarColor: text('avatar_color'),
  lastLoginAt: timestampColumn('last_login_at'),
  isActive: boolColumn('is_active').notNull().default(true),
  ...timestamps,
});

/**
 * Sesje odświeżające — **wiersz to token, `family_id` to urządzenie**
 * ([03 §3.3](../../../../../plans/03-data-model.md#33-auth_sessions)).
 *
 * Przechowywany jest **hash** tokenu; surowy token żyje wyłącznie w ciasteczku.
 * Dzięki temu wyciek bazy nie daje napastnikowi ważnych sesji.
 *
 * Rotacja dokłada nowy wiersz i unieważnia poprzedni, zamiast nadpisywać hash
 * w miejscu — bo **wykrycie ponownego użycia wymaga pamiętania tokenów zużytych**.
 * Wylogowanie natomiast wiersze **usuwa**, żeby karta zostawiona otwarta w tle
 * nie została po wylogowaniu wzięta za kradzież.
 */
export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: idColumn(),
    userId: text('user_id')
      .notNull()
      .references((): AnySQLiteColumn => users.id, { onDelete: 'cascade' }),
    /** Urządzenie; pierwszy wiersz rodziny ma `family_id` równe własnemu `id`. */
    familyId: text('family_id').notNull(),
    /** SHA-256 tokenu odświeżającego. */
    refreshTokenHash: text('refresh_token_hash').notNull(),
    /** Np. „iPhone — Safari". */
    deviceLabel: text('device_label'),
    userAgent: text('user_agent'),
    /** SHA-256(ip + `IP_HASH_SALT`) — jawnego adresu nie zapisujemy. */
    ipHash: text('ip_hash'),
    expiresAt: timestampColumn('expires_at').notNull(),
    revokedAt: timestampColumn('revoked_at'),
    lastUsedAt: timestampColumn('last_used_at'),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('idx_auth_sessions_user').on(table.userId, table.expiresAt),
    index('idx_auth_sessions_family').on(table.familyId),
    uniqueIndex('uq_auth_sessions_token').on(table.refreshTokenHash),
  ],
);

/**
 * Próby logowania — podstawa blokady wykładniczej.
 *
 * Klucz główny jest `INTEGER AUTOINCREMENT`, nie ULID: to jedyna tabela czysto
 * techniczna, czyszczona hurtem, i nie ma odbiorcy w API
 * ([03 §3.4](../../../../../plans/03-data-model.md#34-auth_attempts)).
 * Wiersze starsze niż 30 dni są usuwane przy starcie aplikacji.
 */
export const authAttempts = sqliteTable(
  'auth_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** SHA-256(email + `IP_HASH_SALT`) — jawnego adresu nie zapisujemy. */
    emailHash: text('email_hash').notNull(),
    ipHash: text('ip_hash'),
    succeeded: boolColumn('succeeded').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('idx_auth_attempts_email').on(table.emailHash, table.createdAt),
    index('idx_auth_attempts_ip').on(table.ipHash, table.createdAt),
  ],
);

/** Typ wiersza `users` zwracany z bazy. */
export type UserRow = typeof users.$inferSelect;
/** Typ wiersza `users` przyjmowany przy zapisie. */
export type UserInsert = typeof users.$inferInsert;
/** Typ wiersza `auth_sessions` zwracany z bazy. */
export type AuthSessionRow = typeof authSessions.$inferSelect;
/** Typ wiersza `auth_attempts` zwracany z bazy. */
export type AuthAttemptRow = typeof authAttempts.$inferSelect;
