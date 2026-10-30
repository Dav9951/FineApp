import { useSyncExternalStore } from 'react';

/**
 * Stan PWA widziany przez interfejs: połączenie z siecią i możliwość instalacji
 * ([06 §5](../../../../plans/06-ui-views.md#5-zachowanie-mobilne--szczegóły), `F8-3`).
 *
 * Oba stany żyją poza Reactem (zdarzenia `window`), więc czytamy je przez
 * `useSyncExternalStore` — bez efektu, który przy pierwszym renderze pokazałby stan
 * nieaktualny.
 */

/** Zdarzenie `beforeinstallprompt` — Chromium; w typach DOM go nie ma. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Subskrypcja zmian połączenia.
 *
 * @param notify - Wywoływane przy zmianie.
 * @returns Funkcja odpinająca.
 */
function subscribeOnline(notify: () => void): () => void {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}

/**
 * Czy przeglądarka ma połączenie z siecią.
 *
 * `navigator.onLine === true` nie gwarantuje, że serwer odpowie (np. sieć hotelowa),
 * ale `false` zawsze znaczy „brak sieci" — i tylko o tym mówi baner. Błąd serwera przy
 * włączonej sieci pokazuje stan błędu ekranu.
 *
 * @returns `true`, gdy jest połączenie.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

let deferredPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

/** Powiadamia subskrybentów o zmianie możliwości instalacji. */
function emitInstall(): void {
  for (const listener of installListeners) listener();
}

/**
 * Zaczyna nasłuchiwać `beforeinstallprompt` — wołane raz, przy starcie aplikacji.
 *
 * Zdarzenie przychodzi **raz**, zwykle zanim ekran ustawień się zamontuje; bez
 * zapamiętania go na starcie przycisk „Zainstaluj" nigdy by się nie pojawił.
 */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Bez `preventDefault` Chrome pokazałby własny pasek w przypadkowym momencie.
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    emitInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    emitInstall();
  });
}

/**
 * Subskrypcja możliwości instalacji.
 *
 * @param notify - Wywoływane przy zmianie.
 * @returns Funkcja odpinająca.
 */
function subscribeInstall(notify: () => void): () => void {
  installListeners.add(notify);
  return () => {
    installListeners.delete(notify);
  };
}

/**
 * Czy aplikacja działa już jako zainstalowana (tryb `standalone`).
 *
 * @returns `true` w oknie zainstalowanej aplikacji.
 */
export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  // `matchMedia` nie istnieje w części środowisk bez okna (jsdom, stare WebView).
  if (iosStandalone) return true;
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  );
}

/**
 * Czy to Safari na iPhonie/iPadzie — tam instaluje się ręcznie, z menu „Udostępnij".
 *
 * @param userAgent - Nagłówek przeglądarki.
 * @returns `true` dla iOS.
 */
export function isIos(userAgent: string = navigator.userAgent): boolean {
  return /iPhone|iPad|iPod/u.test(userAgent);
}

/** Sposób instalacji dostępny na tym urządzeniu. */
export type InstallOption =
  | { kind: 'installed' }
  | { kind: 'prompt'; install: () => Promise<boolean> }
  | { kind: 'ios' }
  | { kind: 'unavailable' };

/**
 * Jak zainstalować aplikację na tym urządzeniu.
 *
 * @returns Opcja instalacji.
 */
export function useInstallOption(): InstallOption {
  const prompt = useSyncExternalStore(
    subscribeInstall,
    () => deferredPrompt,
    () => null,
  );
  if (isStandalone()) return { kind: 'installed' };
  if (prompt !== null) {
    return {
      kind: 'prompt',
      install: async () => {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        // Zdarzenia nie da się użyć drugi raz — przycisk znika niezależnie od wyboru.
        deferredPrompt = null;
        emitInstall();
        return choice.outcome === 'accepted';
      },
    };
  }
  return isIos() ? { kind: 'ios' } : { kind: 'unavailable' };
}
