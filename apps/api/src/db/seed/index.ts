import type { CategoryKind } from '@fineapp/shared';
import { and, eq, sql } from 'drizzle-orm';

import { loadConfig, type Config } from '../../core/config.js';
import { isEntryPoint } from '../../core/entry-point.js';
import { loadEnvFile } from '../../core/env-file.js';
import { newId } from '../../core/id.js';
import { createLogger } from '../../core/logger.js';
import { openDatabase, type DbHandle } from '../client.js';
import { appMeta, categories, households } from '../schema/index.js';
import {
  childSlug,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  slugify,
  TRANSFER_CATEGORIES,
  type SeedCategory,
} from './categories.js';

/**
 * Seed: gospodarstwo i kategorie domyślne.
 *
 * **Idempotentny tak samo jak migracje** — wołany ponownie nie tworzy duplikatów ani nie
 * nadpisuje niczego, co użytkownik zdążył zmienić. To nie jest ozdoba: seed bywa
 * uruchamiany ręcznie po aktualizacji, a kategoria z przypisanymi transakcjami, którą
 * seed by „naprawił", zabrałaby ze sobą historię.
 *
 * Kategorie wstawiane są z `is_system = 1`: nie da się ich usunąć (niezmiennik I-9),
 * można je zarchiwizować.
 */

/** Klucz w `app_meta` znaczący, że seed już przebiegł. */
const SEEDED_AT_KEY = 'seeded_at';

/** Nazwa gospodarstwa tworzonego przy pierwszym uruchomieniu. */
const DEFAULT_HOUSEHOLD_NAME = 'Dom';

/** Wynik przebiegu seeda. */
export interface SeedResult {
  /** Identyfikator gospodarstwa — istniejącego albo właśnie utworzonego. */
  readonly householdId: string;
  /** Czy gospodarstwo powstało w tym przebiegu. */
  readonly householdCreated: boolean;
  /** Liczba wstawionych kategorii; `0` przy powtórnym przebiegu. */
  readonly categoriesInserted: number;
}

/**
 * Zwraca gospodarstwo albo tworzy je, gdy jeszcze nie istnieje.
 *
 * W v1 istnieje dokładnie jeden wiersz ([03 §3.1](../../../../../plans/03-data-model.md#31-households)).
 *
 * @param handle - Uchwyt bazy.
 * @param config - Konfiguracja aplikacji; z niej biorą się strefa, waluta i lokalizacja.
 * @param now - Znacznik systemowy zapisywany w `created_at` / `updated_at`.
 * @returns Identyfikator gospodarstwa i informacja, czy je utworzono.
 */
function ensureHousehold(
  handle: DbHandle,
  config: Config,
  now: number,
): { householdId: string; created: boolean } {
  const existing = handle.db.select({ id: households.id }).from(households).limit(1).all();
  const first = existing[0];
  if (first) return { householdId: first.id, created: false };

  const householdId = newId();
  handle.db
    .insert(households)
    .values({
      id: householdId,
      name: DEFAULT_HOUSEHOLD_NAME,
      baseCurrency: config.defaults.currency,
      timezone: config.defaults.timezone,
      locale: config.defaults.locale,
      backPostingLimitMonths: 1,
      monthStartDay: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { householdId, created: true };
}

/** Wiersz kategorii przygotowany do wstawienia. */
interface CategoryRowToInsert {
  id: string;
  householdId: string;
  parentId: string | null;
  name: string;
  slug: string;
  kind: CategoryKind;
  aiHints: string | null;
  isSystem: boolean;
  isArchived: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Buduje wiersz kategorii.
 *
 * @param input - Dane kategorii i jej umiejscowienie.
 * @param input.householdId - Gospodarstwo, do którego należy kategoria.
 * @param input.parentId - Kategoria nadrzędna albo `null` dla kategorii głównej.
 * @param input.category - Dane kategorii z seeda.
 * @param input.slug - Gotowy identyfikator tekstowy.
 * @param input.kind - Rodzaj kategorii.
 * @param input.sortOrder - Pozycja na liście.
 * @param input.now - Znacznik systemowy.
 * @returns Wiersz gotowy do wstawienia.
 */
function toRow(input: {
  householdId: string;
  parentId: string | null;
  category: SeedCategory;
  slug: string;
  kind: CategoryKind;
  sortOrder: number;
  now: number;
}): CategoryRowToInsert {
  return {
    id: newId(),
    householdId: input.householdId,
    parentId: input.parentId,
    name: input.category.name,
    slug: input.slug,
    kind: input.kind,
    aiHints: input.category.aiHints ?? null,
    isSystem: true,
    isArchived: false,
    sortOrder: input.sortOrder,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Wstawia kategorie jednego rodzaju: najpierw rodziców, potem dzieci.
 *
 * Identyfikatory rodziców są **odczytywane z bazy** po wstawieniu, a nie brane
 * z wygenerowanych wierszy. Bez tego powtórny przebieg wywraca się na kluczu obcym:
 * rodzic zostaje pominięty przez `ON CONFLICT DO NOTHING` (jego slug już istnieje),
 * ale dziecko niesie świeżo wylosowany identyfikator rodzica, którego w bazie nie ma.
 * Błąd ujawnia się dopiero wtedy, gdy brakuje samego dziecka — czyli przy dopisaniu
 * nowej kategorii domyślnej w kolejnej wersji aplikacji.
 *
 * @param handle - Uchwyt bazy.
 * @param tree - Kategorie danego rodzaju.
 * @param kind - Rodzaj kategorii.
 * @param householdId - Gospodarstwo docelowe.
 * @param now - Znacznik systemowy.
 */
function insertKind(
  handle: DbHandle,
  tree: readonly SeedCategory[],
  kind: CategoryKind,
  householdId: string,
  now: number,
): void {
  tree.forEach((parent, parentIndex) => {
    handle.db
      .insert(categories)
      .values(
        toRow({
          householdId,
          parentId: null,
          category: parent,
          slug: slugify(parent.name),
          kind,
          sortOrder: parentIndex * 100,
          now,
        }),
      )
      .onConflictDoNothing()
      .run();
  });

  const parentIdBySlug = new Map(
    handle.db
      .select({ id: categories.id, slug: categories.slug })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), eq(categories.kind, kind)))
      .all()
      .map((row) => [row.slug, row.id] as const),
  );

  tree.forEach((parent, parentIndex) => {
    const parentId = parentIdBySlug.get(slugify(parent.name));
    if (!parentId) {
      throw new Error(`seed: brak kategorii nadrzędnej ${parent.name} (${kind})`);
    }
    parent.children?.forEach((child, childIndex) => {
      handle.db
        .insert(categories)
        .values(
          toRow({
            householdId,
            parentId,
            category: child,
            slug: childSlug(parent.name, child.name),
            kind,
            sortOrder: parentIndex * 100 + childIndex + 1,
            now,
          }),
        )
        .onConflictDoNothing()
        .run();
    });
  });
}

/**
 * Wstawia kategorie domyślne, pomijając te, które już istnieją.
 *
 * Pominięcie opiera się na `uq_categories_slug` i `ON CONFLICT DO NOTHING`, a nie na
 * sprawdzeniu „czy tabela jest pusta": dzięki temu dopisanie nowej kategorii domyślnej
 * w kolejnej wersji aplikacji wnosi **tylko ją**, nie ruszając istniejących.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo docelowe.
 * @param now - Znacznik systemowy.
 * @returns Liczba faktycznie wstawionych wierszy.
 */
function insertDefaultCategories(handle: DbHandle, householdId: string, now: number): number {
  const total = () =>
    Number(
      handle.db
        .select({ count: sql<number>`count(*)` })
        .from(categories)
        .where(eq(categories.householdId, householdId))
        .all()[0]?.count ?? 0,
    );

  const before = total();

  // Jedna transakcja: albo wchodzi komplet, albo nic. Połowicznie zaseedowana baza
  // z brakującym rodzicem byłaby gorsza niż brak seeda.
  handle.sqlite.transaction(() => {
    insertKind(handle, EXPENSE_CATEGORIES, 'expense', householdId, now);
    insertKind(handle, INCOME_CATEGORIES, 'income', householdId, now);
    insertKind(handle, TRANSFER_CATEGORIES, 'transfer', householdId, now);
  })();

  return total() - before;
}

/**
 * Uruchamia seed na wskazanej bazie.
 *
 * @param handle - Uchwyt otwartej bazy.
 * @param config - Konfiguracja aplikacji.
 * @param now - Znacznik systemowy; wstrzykiwany w testach.
 * @returns Podsumowanie przebiegu.
 */
export function seedDatabase(handle: DbHandle, config: Config, now = Date.now()): SeedResult {
  const { householdId, created } = ensureHousehold(handle, config, now);
  const inserted = insertDefaultCategories(handle, householdId, now);

  handle.db
    .insert(appMeta)
    .values({ key: SEEDED_AT_KEY, value: String(now), updatedAt: now })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: String(now), updatedAt: now } })
    .run();

  return { householdId, householdCreated: created, categoriesInserted: inserted };
}

/**
 * Otwiera bazę z konfiguracji i uruchamia seed.
 *
 * @param config - Konfiguracja aplikacji.
 * @returns Podsumowanie przebiegu.
 */
export function runSeed(config: Config): SeedResult {
  const logger = createLogger(config);
  const handle = openDatabase(config.db.path);
  try {
    const result = seedDatabase(handle, config);
    logger.info(
      {
        householdId: result.householdId,
        householdCreated: result.householdCreated,
        categoriesInserted: result.categoriesInserted,
      },
      result.categoriesInserted > 0 ? 'Seed zakończony' : 'Seed: nic do dodania',
    );
    return result;
  } finally {
    handle.close();
  }
}

/** Punkt wejścia `pnpm db:seed`. */
function main(): void {
  try {
    loadEnvFile();
    runSeed(loadConfig());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (isEntryPoint(import.meta.url)) {
  main();
}
