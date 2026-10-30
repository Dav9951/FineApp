import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Sprawdza, czy moduł został uruchomiony jako skrypt, a nie zaimportowany.
 *
 * Skrypty operacyjne (`migrate`, `seed`, `create-user`) eksportują funkcje dla testów
 * i jednocześnie mają `main()`. Porównanie `import.meta.url` z `` `file://${argv[1]}` ``
 * nie działa na Windowsie (`C:\…` kontra `file:///C:/…`) ani przy spacjach w ścieżce —
 * skrypt kończył się wtedy **po cichu z kodem 0**, a `entrypoint.sh` szedłby dalej
 * z niezmigrowaną bazą. `pathToFileURL` koduje ścieżkę tak samo jak loader ESM,
 * a `realpathSync` wyrównuje dowiązania symboliczne, które loader rozwiązuje sam
 * (ADR-057).
 *
 * @param moduleUrl - `import.meta.url` sprawdzanego modułu.
 * @param scriptPath - Ścieżka uruchomionego skryptu; domyślnie `process.argv[1]`.
 * @returns `true`, gdy moduł jest punktem wejścia procesu.
 */
export function isEntryPoint(
  moduleUrl: string,
  scriptPath: string | undefined = process.argv[1],
): boolean {
  if (!scriptPath) return false;
  if (pathToFileURL(scriptPath).href === moduleUrl) return true;
  try {
    return pathToFileURL(realpathSync(scriptPath)).href === moduleUrl;
  } catch {
    // Nieistniejąca ścieżka (np. `node -e`) to na pewno nie ten moduł.
    return false;
  }
}
