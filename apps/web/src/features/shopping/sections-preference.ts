import { useCallback, useSyncExternalStore } from 'react';

/**
 * „Lista zakupów: podział na działy" — **ustawienie urządzenia**, jak motyw (ADR-067,
 * ADR-104): lista jest wspólna, ale każdy domownik ma swój telefon i swój nawyk.
 * Domyślnie lista jest płaska, bez nagłówków działów.
 */

/** Klucz w `localStorage`. */
export const SECTIONS_STORAGE_KEY = 'fineapp.shopping.sections';

const listeners = new Set<() => void>();
let value: boolean | null = null;

/**
 * Odczyt zapisanego wyboru. `localStorage` potrafi rzucić (tryb prywatny) — wtedy
 * obowiązuje domyślny widok płaski.
 *
 * @returns `true` — widok z działami.
 */
function read(): boolean {
  try {
    return window.localStorage.getItem(SECTIONS_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * Bieżący wybór — leniwie, żeby moduł dał się zaimportować bez `window`.
 *
 * @returns `true` — widok z działami.
 */
function get(): boolean {
  value ??= read();
  return value;
}

/**
 * Subskrypcja zmian.
 *
 * @param listener - Wywoływany po zmianie.
 * @returns Rezygnacja z subskrypcji.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

/**
 * Zapisuje wybór.
 *
 * @param next - `true` — widok z działami.
 */
export function setShoppingSections(next: boolean): void {
  value = next;
  try {
    window.localStorage.setItem(SECTIONS_STORAGE_KEY, next ? 'on' : 'off');
  } catch {
    // Bez trwałego zapisu wybór działa do przeładowania.
  }
  for (const listener of listeners) listener();
}

/** Do testów: zapomina wybór z pamięci modułu. */
export function resetShoppingSectionsForTests(): void {
  value = null;
}

/**
 * Widok listy zakupów na tym urządzeniu.
 *
 * @returns Czy pokazywać działy i funkcja zmiany.
 */
export function useShoppingSections(): {
  readonly bySection: boolean;
  readonly setBySection: (next: boolean) => void;
} {
  const bySection = useSyncExternalStore(subscribe, get, () => false);
  const setBySection = useCallback((next: boolean) => {
    setShoppingSections(next);
  }, []);
  return { bySection, setBySection };
}
