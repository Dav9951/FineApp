import { sql, type IsPrimaryKey, type NotNull, type SQL } from 'drizzle-orm';
import {
  integer,
  text,
  type AnySQLiteColumn,
  type SQLiteBooleanBuilderInitial,
  type SQLiteIntegerBuilderInitial,
  type SQLiteTextBuilderInitial,
} from 'drizzle-orm/sqlite-core';

/**
 * Cegiełki powtarzające się w każdej tabeli.
 *
 * Schemat musi odpowiadać [03](../../../../../plans/03-data-model.md) **1:1**, a definicje
 * kolumn przepisywane ręcznie rozjeżdżają się przy pierwszej zmianie. Tutaj są raz.
 *
 * Nazwy niosą jednostkę (`minorColumn`, `bpsColumn`), bo w tym projekcie pomylenie
 * groszy ze złotówkami jest najdroższym możliwym błędem — a `integer('x')` samo z siebie
 * nie mówi nic.
 *
 * Ten moduł **nie** jest re-eksportowany przez barrel: to hydraulika schematu, nie jego
 * część.
 */

/** Builder kolumny tekstowej bez ograniczeń wartości. */
type TextColumn<
  TName extends string,
  TLength extends number | undefined = undefined,
> = SQLiteTextBuilderInitial<TName, [string, ...string[]], TLength>;

/**
 * Buduje warunek `CHECK (kolumna IN (...))` z listy dozwolonych wartości.
 *
 * Lista pochodzi z enumów w `@fineapp/shared`, więc ta sama stała trafia do `CHECK`
 * w bazie, do walidacji Zod i do `<Select>` na froncie
 * ([03 §1](../../../../../plans/03-data-model.md#1-konwencje)). Gdyby listy były
 * przepisywane ręcznie, rozjechałyby się przy pierwszym dopisanym wariancie.
 *
 * Wartości są wstawiane jako literały SQL, nie parametry — `CHECK` jest częścią DDL
 * i parametru nie przyjmie. Enumy przechodzą w testach przez wzorzec
 * `^[a-z][a-z0-9_]*$`, więc nie ma czego cytować poza apostrofami.
 *
 * @param column - Kolumna, której dotyczy warunek.
 * @param values - Dozwolone wartości.
 * @returns Fragment SQL do użycia w `check()`.
 */
export function inEnum(column: AnySQLiteColumn, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value}'`).join(', ');
  return sql`${column} IN (${sql.raw(list)})`;
}

/**
 * Buduje warunek `CHECK (kolumna BETWEEN min AND max)`.
 *
 * @param column - Kolumna, której dotyczy warunek.
 * @param min - Dolna granica włącznie.
 * @param max - Górna granica włącznie.
 * @returns Fragment SQL do użycia w `check()`.
 */
export function between(column: AnySQLiteColumn, min: number, max: number): SQL {
  return sql`${column} BETWEEN ${sql.raw(String(min))} AND ${sql.raw(String(max))}`;
}

/**
 * Klucz główny: 26-znakowy ULID generowany w aplikacji, nie w bazie.
 *
 * @returns Builder kolumny `id`.
 */
export function idColumn(): IsPrimaryKey<NotNull<TextColumn<'id', number | undefined>>> {
  return text('id').primaryKey();
}

/**
 * Znacznik systemowy — epoch w milisekundach UTC.
 *
 * Celowo `INTEGER`, a nie tekst ISO: sortowanie jest tanie, a pomyłka z datą biznesową
 * (`TEXT YYYY-MM-DD`) staje się niemożliwa już na poziomie typu
 * ([03 §1](../../../../../plans/03-data-model.md#1-konwencje)).
 *
 * @param name - Nazwa kolumny w bazie.
 * @returns Builder kolumny całkowitoliczbowej.
 */
export function timestampColumn<TName extends string>(
  name: TName,
): SQLiteIntegerBuilderInitial<TName> {
  return integer(name, { mode: 'number' });
}

/** Para `created_at` / `updated_at` obecna w każdej tabeli domenowej. */
export const timestamps = {
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
};

/**
 * Wartość logiczna — SQLite nie ma typu boolean, więc `INTEGER` 0/1.
 *
 * @param name - Nazwa kolumny w bazie.
 * @returns Builder kolumny logicznej.
 */
export function boolColumn<TName extends string>(name: TName): SQLiteBooleanBuilderInitial<TName> {
  return integer(name, { mode: 'boolean' });
}

/**
 * Kwota w groszach. Nigdy `REAL`.
 *
 * @param name - Nazwa kolumny w bazie; zawsze z sufiksem `_minor`.
 * @returns Builder kolumny całkowitoliczbowej.
 */
export function minorColumn<TName extends string>(name: TName): SQLiteIntegerBuilderInitial<TName> {
  return integer(name, { mode: 'number' });
}

/**
 * Udział w punktach bazowych (1% = 100).
 *
 * @param name - Nazwa kolumny w bazie; zawsze z sufiksem `_bps`.
 * @returns Builder kolumny całkowitoliczbowej.
 */
export function bpsColumn<TName extends string>(name: TName): SQLiteIntegerBuilderInitial<TName> {
  return integer(name, { mode: 'number' });
}

/**
 * Data biznesowa `YYYY-MM-DD` — bez strefy czasowej.
 *
 * @param name - Nazwa kolumny w bazie.
 * @returns Builder kolumny tekstowej.
 */
export function dateOnlyColumn<TName extends string>(name: TName): TextColumn<TName> {
  return text(name);
}

/**
 * Klucz miesiąca `YYYY-MM`.
 *
 * @param name - Nazwa kolumny w bazie.
 * @returns Builder kolumny tekstowej.
 */
export function monthKeyColumn<TName extends string>(name: TName): TextColumn<TName> {
  return text(name);
}
