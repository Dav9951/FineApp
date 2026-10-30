import { ChevronDown, ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { matchPath, NavLink, useLocation } from 'react-router-dom';

import { cn } from '../../lib/cn.js';
import { LogoutButton, ProfileBadge, ThemeSwitch } from './account-controls.js';
import type { NavItem } from './nav-items.js';

/**
 * Lewy pasek boczny ([06 §2](../../../../../plans/06-ui-views.md#2-nawigacja)).
 *
 * Szerokość 248 px, te same pozycje co pasek zakładek **plus rozwinięte podsekcje
 * z „Więcej"**: na desktopie nie ma powodu chować pięciu ekranów za jednym wejściem,
 * skoro miejsce jest. Od ADR-082: profil u góry, grupy „Miesiąc" i „Planowanie",
 * Kategorie i Ustawienia w klastrze na dole, pod nimi przełącznik motywu i „Wyloguj".
 *
 * Pasek da się **zwinąć** do wąskiej szyny 76 px z samymi ikonami (ADR-067) — przy
 * szerokich tabelach historii 176 px treści więcej robi różnicę. Szyna, a nie całkowite
 * ukrycie: nawigacja zostaje o jedno kliknięcie, a przycisk rozwinięcia ma stałe miejsce.
 * Stan jest ustawieniem urządzenia (`localStorage`).
 */

/** Klucz w `localStorage` stanu zwinięcia paska. */
export const SIDEBAR_STORAGE_KEY = 'fineapp.sidebar';

/** Wynik `useSidebarCollapsed`. */
export interface UseSidebarCollapsedResult {
  /** Czy pasek jest zwinięty do szyny ikon. */
  collapsed: boolean;
  /** Przełącza zwinięcie i zapamiętuje je na urządzeniu. */
  toggle: () => void;
}

/**
 * Stan zwinięcia paska bocznego, zapamiętany na urządzeniu.
 *
 * @returns Stan i przełącznik.
 */
export function useSidebarCollapsed(): UseSidebarCollapsedResult {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggle = (): void => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? 'collapsed' : 'expanded');
      } catch {
        // Bez zapisu stan obowiązuje do przeładowania.
      }
      return next;
    });
  };
  return { collapsed, toggle };
}

/** Klucz w `localStorage` złożonych grup paska — po nazwie nagłówka. */
export const SIDEBAR_FOLDED_KEY = 'fineapp.sidebar.folded';

/** Wynik `useFoldedGroups`. */
interface FoldedGroups {
  readonly isFolded: (title: string) => boolean;
  readonly toggle: (title: string) => void;
}

/**
 * Złożone grupy paska, zapamiętane na urządzeniu.
 *
 * @returns Odczyt i przełącznik.
 */
function useFoldedGroups(): FoldedGroups {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => {
    try {
      const parsed: unknown = JSON.parse(window.localStorage.getItem(SIDEBAR_FOLDED_KEY) ?? '[]');
      return new Set(Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : []);
    } catch {
      return new Set<string>();
    }
  });
  return {
    isFolded: (title) => folded.has(title),
    toggle: (title) => {
      setFolded((current) => {
        const next = new Set(current);
        if (next.has(title)) next.delete(title);
        else next.add(title);
        try {
          window.localStorage.setItem(SIDEBAR_FOLDED_KEY, JSON.stringify([...next]));
        } catch {
          // Bez pamięci złożenie obowiązuje do przeładowania.
        }
        return next;
      });
    },
  };
}

/** Wynik `useMoreBelow`. */
interface MoreBelow {
  readonly ref: (element: HTMLDivElement | null) => void;
  readonly update: () => void;
  /** Czy pod widocznym fragmentem jest jeszcze treść. */
  readonly more: boolean;
}

/**
 * Czy obszar przewijany ma treść poniżej widocznego fragmentu — do cieniowania na dole,
 * gdy pasek przewijania jest schowany.
 *
 * @param deps - Zmiany, po których trzeba przeliczyć (zwinięcie, trasa).
 * @returns Odnośnik do obszaru, przeliczenie i wynik.
 */
function useMoreBelow(deps: readonly unknown[]): MoreBelow {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);
  const update = useCallback((): void => {
    if (element === null) return;
    setMore(element.scrollHeight - element.scrollTop - element.clientHeight > 1);
  }, [element]);
  useEffect(() => {
    if (element === null) return undefined;
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => {
      observer.disconnect();
    };
    // `deps` zmienia zawartość obszaru (zwinięcie paska, trasa) — przelicz po nich.
  }, [element, update, ...deps]);
  return { ref: setElement, update, more };
}

/** Właściwości paska bocznego. */
export interface SidebarProps {
  /** Pozycje główne; bez „Więcej", które na desktopie nie ma sensu. */
  primary: readonly NavItem[];
  /** Grupa „Planowanie" — podsekcje z „Więcej". */
  planning: readonly NavItem[];
  /** Kategorie i Ustawienia — klaster na dole, bez nagłówka (ADR-082). */
  settings: readonly NavItem[];
  /** Zwinięty do szyny ikon. */
  collapsed?: boolean;
  /** Przełącza zwinięcie. */
  onToggleCollapsed?: () => void;
  className?: string;
}

/**
 * Pasek boczny widoczny od 768 px.
 *
 * @param props - Właściwości komponentu.
 * @param props.primary - Pozycje główne.
 * @param props.planning - Grupa „Planowanie".
 * @param props.settings - Kategorie i Ustawienia.
 * @param props.collapsed - Czy pasek jest zwinięty.
 * @param props.onToggleCollapsed - Przełącza zwinięcie.
 * @param props.className - Dodatkowe klasy.
 * @returns Element paska bocznego.
 */
export function Sidebar({
  primary,
  planning,
  settings,
  collapsed = false,
  onToggleCollapsed,
  className,
}: SidebarProps): ReactNode {
  const location = useLocation();
  const folding = useFoldedGroups();
  const fade = useMoreBelow([collapsed, location.pathname]);

  /**
   * Renderuje grupę pozycji. Grupa z nagłówkiem da się złożyć (ADR-082, uzupełnienie):
   * złożona pokazuje tylko pozycję bieżącej strony, jeśli należy do grupy — pasek
   * mieści się wtedy bez przewijania, a miejsce, w którym jesteś, zostaje widoczne.
   * W szynie grupy są zawsze rozłożone — nagłówek jest tam tylko linią.
   *
   * @param items - Pozycje do wypisania.
   * @param title - Nagłówek grupy; brak pomija nagłówek.
   * @returns Element grupy.
   */
  const group = (items: readonly NavItem[], title?: string): ReactNode => {
    const folded = title !== undefined && !collapsed && folding.isFolded(title);
    const shown = folded
      ? items.filter(
          (item) =>
            matchPath({ path: item.to, end: item.nested !== true }, location.pathname) !== null,
        )
      : items;
    return (
      <>
        {title === undefined ? null : collapsed ? (
          // Zwinięty: nagłówek grupy zastępuje linia — napis nie mieści się w szynie.
          <hr className="mx-2 my-3 border-border" />
        ) : (
          <h2 className="mt-2">
            <button
              aria-expanded={!folded}
              className="flex min-h-touch w-full items-center justify-between rounded-md px-3 text-[11px] font-semibold uppercase tracking-[.12em] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                folding.toggle(title);
              }}
              title={folded ? `Pokaż: ${title}` : `Złóż: ${title}`}
              type="button"
            >
              {title}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'h-4 w-4 transition-transform motion-reduce:transition-none',
                  folded && '-rotate-90',
                )}
                strokeWidth={1.5}
              />
            </button>
          </h2>
        )}
        <ul>
          {shown.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-touch items-center gap-3 rounded-md px-3 text-sm transition-colors',
                      collapsed && 'justify-center px-0',
                      'focus-visible:ring-ring focus-visible:ring-offset-background',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                      isActive
                        ? 'bg-muted font-semibold text-primary'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )
                  }
                  end={item.nested !== true}
                  title={collapsed ? item.label : undefined}
                  to={item.to}
                >
                  <Icon aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={1.5} />
                  <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </>
    );
  };

  const toggleLabel = collapsed ? 'Rozwiń pasek boczny' : 'Zwiń pasek boczny';
  return (
    // `<nav>`, nie `<aside>`: całą zawartość stanowi nawigacja, a `<aside>` ma rolę
    // `complementary` — czytnik ekranu zapowiadałby to jako treść poboczną i pasek
    // nie trafiłby na listę punktów orientacyjnych nawigacyjnych.
    <nav
      aria-label="Nawigacja główna"
      className={cn(
        'fixed inset-y-0 left-0 z-30 hidden shrink-0 flex-col border-r border-border bg-background py-4 md:flex',
        collapsed ? 'w-[76px] px-3' : 'w-[248px] px-4',
        className,
      )}
    >
      {onToggleCollapsed === undefined ? null : (
        // Okrągły przycisk na krawędzi: 28 px widoczne, 44 px dotyku (pseudoelement).
        <button
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          className={cn(
            'absolute -right-3.5 top-8 z-10 grid h-7 w-7 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm',
            "after:absolute after:-inset-2 after:content-[''] hover:text-foreground",
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          onClick={onToggleCollapsed}
          title={toggleLabel}
          type="button"
        >
          <ChevronLeft
            aria-hidden="true"
            className={cn('h-4 w-4', collapsed && 'rotate-180')}
            strokeWidth={1.5}
          />
        </button>
      )}

      <ProfileBadge compact={collapsed} />
      <hr className="my-3 border-border" />

      {/* Przewija się tylko nawigacja — profil i dół paska zostają na miejscu. */}
      {/* Pasek przewijania niewidoczny, dopóki kursor nie stoi nad paskiem — bez skoku
          układu, bo szerokość paska przewijania się nie zmienia, tylko kolor. */}
      <div className="relative -mx-1 flex min-h-0 flex-1 flex-col">
        <div
          className="min-h-0 flex-1 overflow-y-auto px-1 [scrollbar-color:transparent_transparent] [scrollbar-width:thin] hover:[scrollbar-color:hsl(var(--border))_transparent]"
          onScroll={fade.update}
          ref={fade.ref}
        >
          {/* W szynie linia pod profilem już oddziela pierwszą grupę — bez drugiej linii. */}
          {group(primary, collapsed ? undefined : 'Miesiąc')}
          {group(planning, 'Planowanie')}
        </div>
        {/* Bez widocznego paska przewijania to cieniowanie mówi, że niżej jest coś jeszcze. */}
        {fade.more ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent"
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1 pt-1">
        <hr className="mb-1 border-border" />
        {group(settings)}
        <hr className="my-1 border-border" />
        {collapsed ? (
          <>
            <ThemeSwitch variant="single" />
            <LogoutButton compact />
          </>
        ) : (
          // Jeden rząd: „Wyloguj" i motyw obok siebie — pasek mieści się bez przewijania
          // na niższych ekranach (ADR-082, uzupełnienie).
          <div className="flex items-center justify-between gap-2">
            <LogoutButton className="w-auto flex-1" />
            <ThemeSwitch variant="icons" />
          </div>
        )}
      </div>
    </nav>
  );
}
