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

/** Zależności sprzątania. */
export interface ImportFilesDeps {
  readonly db: DbHandle;
  readonly clock: Clock;
  /** Katalog uploadów (`UPLOAD_DIR`). */
  readonly uploadDir: string;
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
 * Usuwa pliki importów zakończonych dawniej niż 7 dni — wołane przy starcie procesu.
 *
 * Importy zatwierdzone i odrzucone tracą pliki od razu (`F10-8`); to sprzątanie łapie
 * resztę: odczyty nieudane i przerwane restartem w trakcie usuwania.
 *
 * @param deps - Baza, zegar, katalog uploadów.
 * @returns Liczba importów, z których usunięto pliki.
 */
export async function purgeStaleImportFiles(deps: ImportFilesDeps): Promise<number> {
  const stale = findStaleImportFiles(
    deps.db,
    deps.clock.now().getTime() - IMPORT_FILE_RETENTION_MS,
  );
  for (const row of stale) {
    await Promise.all(
      parseImportFilePaths(row.filePaths).map((path) => removeStoredFiles(deps.uploadDir, path)),
    );
    clearImportFiles(deps.db, row.householdId, row.id);
  }
  return stale.length;
}
