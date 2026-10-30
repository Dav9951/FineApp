import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { timestampColumn } from './_shared.js';
import { households } from './households.js';

/**
 * Klucze idempotencji — zapamiętane odpowiedzi operacji z nagłówkiem `Idempotency-Key`
 * ([04 §1](../../../../../plans/04-api-spec.md#1-zasady-ogólne), ADR-037).
 *
 * Telefon na słabym łączu wysyła „Zapisz", odpowiedź ginie po drodze, a przeglądarka
 * albo użytkownik ponawia. Bez tej tabeli drugie żądanie tworzy drugi wydatek. Z nią —
 * dostaje odpowiedź pierwszego.
 *
 * **Zapamiętywane są tylko odpowiedzi udane.** Żądanie odrzucone (`422`) niczego nie
 * zapisało, więc poprawione i ponowione z tym samym kluczem ma prawo się wykonać.
 *
 * Wpisy żyją 24 godziny (`IDEMPOTENCY_TTL_MS`) — dłużej nikt nie ponawia żądania,
 * a tabela nie rośnie w nieskończoność. Brak `updated_at`: wiersz nigdy się nie zmienia.
 */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    householdId: text('household_id')
      .notNull()
      .references((): AnySQLiteColumn => households.id, { onDelete: 'cascade' }),
    /** Operacja, np. `POST /transactions` — ten sam klucz w innej operacji to inny wpis. */
    scope: text('scope').notNull(),
    /** Wartość nagłówka `Idempotency-Key` nadana przez klienta. */
    key: text('key').notNull(),
    /**
     * SHA-256 znormalizowanego ciała żądania.
     *
     * Ten sam klucz z innym ciałem to błąd klienta (albo ponowienie po edycji formularza,
     * którego pierwsza wersja już się zapisała) — odpowiadamy `409` zamiast po cichu
     * zwrócić wynik dla innych danych.
     */
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code').notNull(),
    /** Ciało odpowiedzi w postaci JSON — zwracane bez zmian przy powtórzeniu. */
    responseJson: text('response_json').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.scope, table.key] }),
    // Sprzątanie po wieku wpisu.
    index('idx_idempotency_created').on(table.createdAt),
  ],
);

/** Typ wiersza `idempotency_keys` zwracany z bazy. */
export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
/** Typ wiersza `idempotency_keys` przyjmowany przy zapisie. */
export type IdempotencyKeyInsert = typeof idempotencyKeys.$inferInsert;
