import type { FastifyBaseLogger } from 'fastify';

import type { Clock } from '../../core/clock.js';
import type { DbHandle } from '../../db/client.js';
import { removeStoredFiles } from '../documents/documents.files.js';
import { clearImportFiles, findStaleImportFiles } from './shopping.repository.js';

/**
 * Pliki importów list zakupów (ADR-094): zdjęcie tablicy z lodówki nie jest dowodem
 * zakupu, więc nie trzymamy go dłużej, niż trzeba do przeglądu.
 */

/** Po tylu dniach od zakończenia importu jego pliki znikają z dysku (I-31). */
export const IMPORT_FILE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Logger w zakresie potrzebnym do zgłoszenia nieudanego usunięcia. */
export type WarnLogger = Pick<FastifyBaseLogger, 'warn'>;

/** Zależności sprzątania. */
export interface ImportFilesDeps {
  readonly db: DbHandle;
  readonly clock: Clock;
  /** Katalog uploadów (`UPLOAD_DIR`). */
  readonly uploadDir: string;
  readonly log: WarnLogger;
}

/**
 * Ścieżki z kolumny JSON `file_paths`; uszkodzona wartość to brak plików.
 *
 * @param json - Wartość kolumny.
 * @returns Ścieżki względem `UPLOAD_DIR`.
 */
export function parseImportFilePaths(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Usuwa pliki z dysku, **nie przerywając** pracy przy pojedynczym błędzie — ścieżka spoza
 * `UPLOAD_DIR` albo `EACCES` trafia do logu (tylko liczby, bez ścieżek).
 *
 * @param uploadDir - Katalog uploadów.
 * @param paths - Ścieżki względem `UPLOAD_DIR`.
 * @param log - Logger.
 * @returns `true`, gdy usunięto wszystkie.
 */
export async function removeImportFiles(
  uploadDir: string,
  paths: readonly string[],
  log: WarnLogger,
): Promise<boolean> {
  const results = await Promise.allSettled(paths.map((path) => removeStoredFiles(uploadDir, path)));
  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed > 0) {
    log.warn(
      { failed, total: paths.length },
      'Nie udało się usunąć części plików importów list zakupów',
    );
  }
  return failed === 0;
}

/**
 * Usuwa pliki importów zakończonych dawniej niż 7 dni — wołane przy starcie procesu.
 *
 * Importy zatwierdzone i odrzucone tracą pliki od razu (`F10-8`); to sprzątanie łapie
 * resztę: odczyty nieudane i przerwane restartem w trakcie usuwania. Błąd przy jednym
 * imporcie nie zatrzymuje startu serwera — import zostaje z plikami do następnej próby.
 *
 * @param deps - Baza, zegar, katalog uploadów, logger.
 * @returns Liczba importów, z których usunięto pliki.
 */
export async function purgeStaleImportFiles(deps: ImportFilesDeps): Promise<number> {
  const stale = findStaleImportFiles(
    deps.db,
    deps.clock.now().getTime() - IMPORT_FILE_RETENTION_MS,
  );
  let purged = 0;
  for (const row of stale) {
    const removed = await removeImportFiles(
      deps.uploadDir,
      parseImportFilePaths(row.filePaths),
      deps.log,
    );
    if (!removed) continue;
    clearImportFiles(deps.db, row.householdId, row.id);
    purged += 1;
  }
  return purged;
}
