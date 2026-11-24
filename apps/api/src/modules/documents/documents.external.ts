import { currentMonthKey, findAiModel } from '@fineapp/shared';

import type { TokenRates } from '../../ai/cost.js';
import type { Clock } from '../../core/clock.js';
import type { Config } from '../../core/config.js';
import type { DbHandle } from '../../db/client.js';
import { getHouseholdWithAiModel } from '../auth/auth.service.js';
import type { AiLogEvent, AiLogLevel } from '@fineapp/shared';

import { newId } from '../../core/id.js';
import {
  addAiSpend,
  insertDocumentLog,
  LOG_RETENTION_MS,
  pruneDocumentLogs,
  readAiSpend,
  reassignItemsCategory,
  unlinkShoppingImportLogs,
} from './documents.repository.js';

/**
 * Wejście do dokumentów dla **innych modułów** — przepinanie przy scalaniu kategorii
 * (07 §9.3, `Z-13`).
 *
 * Osobny plik z tego samego powodu co `planned-expenses.external.ts` (ADR-035): serwis
 * dokumentów woła serwis kategorii (commit zakłada nowe), więc kategorie nie mogą
 * importować serwisu dokumentów. Ten plik importuje wyłącznie repozytorium.
 */

/**
 * Przepina propozycje kategorii w pozycjach dokumentów na kategorię docelową scalenia.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo z tokenu.
 * @param fromCategoryId - Kategoria scalana (sprawdzona w gospodarstwie).
 * @param toCategoryId - Kategoria docelowa.
 * @param now - Znacznik `updated_at`.
 */
export function moveDocumentItemsToCategory(
  handle: DbHandle,
  householdId: string,
  fromCategoryId: string,
  toCategoryId: string,
  now: number,
): void {
  reassignItemsCategory(handle, householdId, fromCategoryId, toCategoryId, now);
}

/** Model i jego stawki dla odczytu gospodarstwa. */
export interface HouseholdAiModel {
  readonly model: string;
  readonly rates: TokenRates;
  /** Bieżący miesiąc gospodarstwa — klucz licznika kosztów. */
  readonly month: string;
}

/**
 * Model odczytu gospodarstwa (ADR-085) i miesiąc licznika kosztów — wspólne dla dokumentów
 * i importów list zakupów (ADR-094: jeden model z ustawień, jeden limit kosztów).
 *
 * @param handle - Uchwyt bazy.
 * @param config - Konfiguracja AI.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @returns Model, stawki, miesiąc.
 */
export function householdAiModel(
  handle: DbHandle,
  config: Config['ai'],
  clock: Clock,
  householdId: string,
): HouseholdAiModel {
  const { household, aiModel } = getHouseholdWithAiModel(handle, householdId);
  const model = aiModel ?? config.model;
  return {
    model,
    rates: findAiModel(model) ?? config,
    month: currentMonthKey(household.timezone, clock.now()),
  };
}

/**
 * Czy miesięczny limit kosztów AI jest wyczerpany (08 §9) — wspólny dla dokumentów
 * i importów list zakupów.
 *
 * @param handle - Uchwyt bazy.
 * @param config - Konfiguracja AI.
 * @param month - Miesiąc licznika.
 * @returns `true`, gdy limit wyczerpany (`0` = bez limitu).
 */
export function aiBudgetExhausted(handle: DbHandle, config: Config['ai'], month: string): boolean {
  return config.monthlyBudgetMinor !== 0 && readAiSpend(handle, month) >= config.monthlyBudgetMinor;
}

/**
 * Dolicza koszt odczytu do wspólnego licznika miesiąca.
 *
 * @param handle - Uchwyt bazy.
 * @param month - Miesiąc licznika.
 * @param costMinor - Koszt w groszach.
 * @param now - Znacznik systemowy.
 */
export function recordAiSpend(
  handle: DbHandle,
  month: string,
  costMinor: number,
  now: number,
): void {
  if (costMinor > 0) addAiSpend(handle, month, costMinor, now);
}

/** Wpis dziennika odczytu importu listy zakupów (ADR-107). */
export interface ShoppingAiLogEntry {
  /** Import i jego nazwa w dzienniku („Zdjęcie listy", „Przepis — przepisy.pl"). */
  readonly importRef: { readonly id: string; readonly name: string };
  readonly level: AiLogLevel;
  readonly event: AiLogEvent;
  readonly message: string;
  /** Liczby i kody — nigdy treść listy, przepisu ani pełny adres. */
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * Zapisuje wpis dziennika odczytu dla importu listy zakupów — ta sama tabela i retencja
 * co dokumenty (ADR-086, ADR-107). Nigdy nie rzuca: dziennik nie może przerwać odczytu.
 *
 * @param deps - Baza, zegar i log procesu.
 * @param deps.db - Uchwyt bazy.
 * @param deps.clock - Źródło czasu.
 * @param deps.log - Log procesu (błąd zapisu).
 * @param deps.log.warn - Ostrzeżenie.
 * @param householdId - Gospodarstwo.
 * @param entry - Wpis.
 */
export function writeShoppingAiLog(
  deps: {
    readonly db: DbHandle;
    readonly clock: Clock;
    readonly log: { warn: (object: object, message: string) => void };
  },
  householdId: string,
  entry: ShoppingAiLogEntry,
): void {
  const now = deps.clock.now().getTime();
  try {
    if (entry.event === 'started') {
      pruneDocumentLogs(deps.db, householdId, now - LOG_RETENTION_MS);
    }
    insertDocumentLog(deps.db, householdId, {
      id: newId(),
      source: 'shopping',
      shoppingImportId: entry.importRef.id,
      documentId: null,
      documentName: entry.importRef.name,
      level: entry.level,
      event: entry.event,
      message: entry.message,
      details: JSON.stringify(entry.details ?? {}),
      createdAt: now,
    });
  } catch (error) {
    deps.log.warn({ err: error, event: entry.event }, 'Nie udało się zapisać dziennika odczytu');
  }
}

/**
 * Odpina wpisy dziennika od zatwierdzonego albo odrzuconego importu (ADR-107). Woła
 * serwis list w swojej transakcji.
 *
 * @param handle - Uchwyt bazy.
 * @param householdId - Gospodarstwo.
 * @param importId - Import.
 */
export function unlinkShoppingAiLog(handle: DbHandle, householdId: string, importId: string): void {
  unlinkShoppingImportLogs(handle, householdId, importId);
}
