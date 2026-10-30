import { useCallback, useSyncExternalStore } from 'react';

/**
 * Motyw interfejsu ([15 §3.6](../../../../plans/15-design-system.md#36-mechanika-motywów),
 * [ADR-067](../../../../plans/14-decisions-log.md#adr-067)).
 *
 * Wybór jest **ustawieniem urządzenia**, nie gospodarstwa: ten sam domownik może chcieć
 * ciemnego telefonu i jasnego laptopa. Dlatego siedzi w `localStorage`, a nie w bazie.
 *
 * Pierwsze zastosowanie robi `public/theme-init.js` — synchronicznie w `<head>`, przed
 * pierwszym malowaniem, żeby użytkownik motywu jasnego nie zobaczył mignięcia ciemnego tła.
 * Skrypt jest plikiem, a nie wstawką, bo CSP ma `script-src 'self'` (09 §6). Klucz
 * i wartości muszą się zgadzać z tym plikiem.
 */

/** Wybór użytkownika: jawny motyw albo „jak w systemie". */
export type ThemePreference = 'dark' | 'light' | 'system';

/** Motyw faktycznie nałożony na stronę. */
export type ResolvedTheme = 'dark' | 'light';

/** Klucz w `localStorage` — ten sam co w `public/theme-init.js`. */
export const THEME_STORAGE_KEY = 'fineapp.theme';

/**
 * Kolor paska przeglądarki dla obu motywów — `--background` z `tokens.css`
 * przeliczone na hex, bo `<meta name="theme-color">` nie rozumie zmiennych CSS.
 */
export const THEME_COLORS: Readonly<Record<ResolvedTheme, string>> = {
  dark: '#1a1714',
  light: '#f8f6f2',
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Zawęża dowolną wartość do wyboru motywu.
 *
 * Brak wpisu i śmieci dają `dark`, bo ciemny jest domyślny (06 §1.5).
 *
 * @param value - Wartość z `localStorage`.
 * @returns Poprawny wybór motywu.
 */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'system' || value === 'dark' ? value : 'dark';
}

/**
 * Wyznacza motyw do nałożenia.
 *
 * @param preference - Wybór użytkownika.
 * @param systemDark - Czy system prosi o ciemny motyw.
 * @returns Motyw nałożony na stronę.
 */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') {
    return systemDark ? 'dark' : 'light';
  }
  return preference;
}

/**
 * Odczytuje zapisany wybór. `localStorage` potrafi rzucić (tryb prywatny, zablokowane
 * dane witryny) — wtedy obowiązuje domyślny.
 *
 * @returns Zapisany wybór motywu.
 */
function readPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

/**
 * Czy system prosi o ciemny motyw.
 *
 * @returns `true`, gdy `prefers-color-scheme: dark`.
 */
function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/**
 * Nakłada motyw na `<html>` i kolor paska przeglądarki.
 *
 * @param theme - Motyw do nałożenia.
 */
function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

let preference: ThemePreference | null = null;
const listeners = new Set<() => void>();

/**
 * Bieżący wybór — leniwie, żeby moduł dał się zaimportować bez `window` (testy).
 *
 * @returns Bieżący wybór motywu.
 */
function getPreference(): ThemePreference {
  preference ??= readPreference();
  return preference;
}

/**
 * Subskrypcja magazynu motywu. Przy wyborze „system" pilnuje też zmiany motywu systemu
 * — telefon przełączający się wieczorem na ciemny przełącza i aplikację.
 *
 * @param listener - Wywoływany po każdej zmianie.
 * @returns Funkcja rezygnacji z subskrypcji.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  const onSystemChange = (): void => {
    if (getPreference() === 'system') {
      applyTheme(resolveTheme('system', systemPrefersDark()));
      listener();
    }
  };
  media?.addEventListener('change', onSystemChange);
  return (): void => {
    listeners.delete(listener);
    media?.removeEventListener('change', onSystemChange);
  };
}

/**
 * Zapisuje i nakłada wybór motywu.
 *
 * @param next - Nowy wybór.
 */
export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Bez zapisu motyw obowiązuje do przeładowania — lepsze to niż błąd.
  }
  applyTheme(resolveTheme(next, systemPrefersDark()));
  listeners.forEach((listener) => {
    listener();
  });
}

/** Wynik `useTheme`. */
export interface UseThemeResult {
  /** Wybór użytkownika. */
  preference: ThemePreference;
  /** Motyw faktycznie nałożony. */
  resolved: ResolvedTheme;
  /** Zmiana wyboru. */
  setPreference: (next: ThemePreference) => void;
  /** Przełącza na przeciwny do nałożonego — szybki przełącznik w pasku bocznym. */
  toggle: () => void;
}

/**
 * Motyw interfejsu ze wspólnym stanem: przełącznik w pasku bocznym i wybór
 * w ustawieniach widzą tę samą wartość.
 *
 * @returns Wybór, motyw nałożony i funkcje zmiany.
 */
export function useTheme(): UseThemeResult {
  const current = useSyncExternalStore(subscribe, getPreference, () => 'dark' as const);
  const resolved = resolveTheme(current, systemPrefersDark());
  const toggle = useCallback((): void => {
    setThemePreference(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved]);
  return { preference: current, resolved, setPreference: setThemePreference, toggle };
}
