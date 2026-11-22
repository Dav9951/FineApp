/**
 * Odzyskiwanie po wdrożeniu nowej wersji (ADR-090).
 *
 * Każdy build zmienia hashe w nazwach plików `assets/*.js`, a nowy obraz nie ma już
 * starych. Karta (albo service worker z poprzednią powłoką) wciąż wykonuje stary
 * `index-*.js` i przy pierwszym wejściu na ekran ładowany przez `lazy()` prosi o plik,
 * którego nie ma — serwer odpowiada 404, a import kończy się błędem. Odświeżenie
 * wczytuje nową powłokę i wszystko działa, więc robimy to za użytkownika.
 */

/** Klucz w `sessionStorage` z czasem ostatniego przeładowania z tego powodu. */
const RELOAD_AT_KEY = 'fineapp:stale-chunk-reload-at';

/**
 * Minimalny odstęp między przeładowaniami. Gdy plik naprawdę nie istnieje także
 * w nowej wersji, drugi błąd w tym oknie pokazuje zwykły ekran błędu zamiast pętli.
 */
export const STALE_CHUNK_RELOAD_COOLDOWN_MS = 10_000;

/**
 * Komunikaty błędu nieudanego dynamicznego importu — każda przeglądarka ma własny:
 * Chromium, Safari i Firefox, plus błąd wstępnego ładowania Vite.
 */
const STALE_CHUNK_PATTERN =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/iu;

/**
 * Czy błąd to brak pliku kodu po wdrożeniu nowej wersji.
 *
 * @param error - Dowolny przechwycony błąd.
 * @returns `true` dla nieudanego dynamicznego importu.
 */
export function isStaleChunkError(error: unknown): boolean {
  return error instanceof Error && STALE_CHUNK_PATTERN.test(error.message);
}

/** Zależności {@link reloadForStaleChunk} — podmieniane w testach. */
export interface StaleChunkReloadDeps {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  reload?: () => void;
  now?: number;
}

/**
 * Przeładowuje stronę, o ile nie zrobiliśmy tego przed chwilą.
 *
 * Bez `sessionStorage` (tryb prywatny, zablokowane dane witryny) nie da się
 * zabezpieczyć przed pętlą, więc nie przeładowujemy — zostaje ekran błędu
 * z przyciskiem.
 *
 * @param deps - Pamięć, funkcja przeładowania i bieżący czas.
 * @returns `true`, gdy przeładowanie zostało zlecone.
 */
export function reloadForStaleChunk(deps: StaleChunkReloadDeps = {}): boolean {
  const now = deps.now ?? Date.now();
  const reload = deps.reload ?? (() => window.location.reload());
  try {
    const storage = deps.storage ?? window.sessionStorage;
    const last = Number(storage.getItem(RELOAD_AT_KEY) ?? 0);
    if (Number.isFinite(last) && now - last < STALE_CHUNK_RELOAD_COOLDOWN_MS) return false;
    storage.setItem(RELOAD_AT_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

/**
 * Nasłuchuje `vite:preloadError` — Vite wysyła je, gdy import ekranu albo jego
 * zależności się nie powiedzie. Wołane raz, przy starcie aplikacji.
 *
 * `preventDefault` tłumi rzucenie błędu tylko wtedy, gdy przeładowanie ruszyło;
 * inaczej błąd idzie dalej, do granicy błędu trasy.
 */
export function installStaleChunkReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForStaleChunk()) event.preventDefault();
  });
}
