/**
 * Mały magazyn danych na urządzeniu — **wyłącznie** dla list zakupów
 * ([ADR-096](../../../../plans/14-decisions-log.md#adr-096), 06 §5).
 *
 * Reszta aplikacji trzyma dane tylko w pamięci (dane finansowe zawsze z sieci). Lista
 * zakupów jest wyjątkiem, bo odhacza się ją w piwnicy marketu, bez zasięgu. Klucze mają
 * wspólny prefiks, więc wylogowanie usuwa wszystko jednym wywołaniem.
 *
 * `localStorage` bywa niedostępny (tryb prywatny, zablokowane dane witryny) — każda
 * operacja jest więc w `try/catch`, a brak magazynu znaczy po prostu „bez pracy offline".
 */

/** Prefiks wszystkich kluczy magazynu. */
export const OFFLINE_PREFIX = 'fineapp.offline.';

/**
 * Czyta wartość zapisaną pod kluczem.
 *
 * @param key - Klucz bez prefiksu.
 * @returns Wartość albo `undefined`, gdy jej nie ma albo magazyn jest niedostępny.
 */
export function readOffline(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(OFFLINE_PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

/**
 * Zapisuje wartość pod kluczem. Brak miejsca albo magazynu nie jest błędem aplikacji.
 *
 * @param key - Klucz bez prefiksu.
 * @param value - Wartość serializowalna do JSON.
 */
export function writeOffline(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(OFFLINE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Pełny albo zablokowany magazyn — praca offline po prostu nie zadziała.
  }
}

/**
 * Usuwa wartość spod klucza.
 *
 * @param key - Klucz bez prefiksu.
 */
export function removeOffline(key: string): void {
  try {
    window.localStorage.removeItem(OFFLINE_PREFIX + key);
  } catch {
    // Jak wyżej.
  }
}

/** Usuwa wszystkie dane magazynu — przy wylogowaniu, żeby lista nie została na urządzeniu. */
export function clearOfflineStore(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(OFFLINE_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Jak wyżej.
  }
}
