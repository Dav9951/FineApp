import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Przycisk akcji głównej ([15 §4.4](../../../../../plans/15-design-system.md#44-fab)).
 *
 * **Nie zachodzi na pasek zakładek.** Nachodząc, zasłaniałby zakładkę „Więcej", czyli
 * odbierałby dostęp do Kont, Zobowiązań i Ustawień. Pozycję liczy od paska:
 * `--tabbar-height` + bezpieczny margines urządzenia + 16 px odstępu.
 * `safe-area-inset-bottom` obsługuje **pasek**, nie FAB — dlatego FAB dolicza ją sam.
 *
 * Nie chowa się przy przewijaniu: to najczęstsza akcja w aplikacji, a znikający
 * przycisk zmusza do przewijania w górę tylko po to, żeby go odzyskać. Chowa go
 * jedynie ekran w trybie, w którym FAB zasłaniałby uchwyty — {@link useHideFab}
 * (tryb „Układaj" planera, ADR-081).
 */

/** Atrybut `<body>`, przy którym FAB znika (tryb zastępuje go własnym paskiem). */
const HIDE_ATTRIBUTE = 'data-fab-hidden';

/**
 * Chowa FAB, dopóki `hidden` jest prawdą — np. w trybie układania planera, gdzie FAB
 * zasłaniałby uchwyty przy prawej krawędzi, a ekran pokazuje własny pasek „Gotowe".
 *
 * @param hidden - Czy schować FAB.
 */
export function useHideFab(hidden: boolean): void {
  useEffect(() => {
    if (!hidden) return undefined;
    document.body.setAttribute(HIDE_ATTRIBUTE, '');
    return () => {
      document.body.removeAttribute(HIDE_ATTRIBUTE);
    };
  }, [hidden]);
}

/** Pozycja menu szybkich akcji. */
const LONG_PRESS_MS = 500;

/** Szybka akcja z menu pod długim przytrzymaniem. */
export interface FabAction {
  /** Etykieta pozycji menu. */
  label: string;
  /** Wywołanie po wyborze. */
  onSelect: () => void;
  /** Ikona po lewej. */
  icon?: ReactNode;
}

/** Właściwości przycisku akcji głównej. */
export interface FabProps {
  /** Opis akcji — ikona bez etykiety nie istnieje dla czytnika ekranu. */
  label: string;
  /** Dotknięcie; akcja kontekstowa bieżącego ekranu. */
  onClick: () => void;
  /** Menu szybkich akcji pod długim przytrzymaniem. */
  actions?: readonly FabAction[];
  /** Ikona, 26 px. */
  children: ReactNode;
  className?: string;
}

/**
 * Pływający przycisk akcji głównej.
 *
 * Długie przytrzymanie otwiera menu szybkich akcji. Menu jest **dodatkiem, nie jedyną
 * drogą** — każda z tych akcji jest też osiągalna z formularza otwieranego dotknięciem
 * ([15 §2.7](../../../../../plans/15-design-system.md#2-zasady-nienegocjowalne): gest
 * nigdy nie jest jedyną drogą do akcji).
 *
 * @param props - Właściwości komponentu.
 * @param props.label - Opis akcji dla czytnika ekranu.
 * @param props.onClick - Akcja kontekstowa.
 * @param props.actions - Menu szybkich akcji.
 * @param props.children - Ikona.
 * @param props.className - Dodatkowe klasy.
 * @returns Element przycisku.
 */
export function Fab({ label, onClick, actions, children, className }: FabProps): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Przytrzymanie otwiera menu; bez tej flagi puszczenie palca wywołałoby jeszcze akcję
  // kontekstową, czyli jedno przytrzymanie dałoby dwa skutki.
  const longPressRef = useRef(false);

  useEffect(
    () => (): void => {
      clearTimeout(timerRef.current);
    },
    [],
  );

  const hasMenu = actions !== undefined && actions.length > 0;

  const startPress = (): void => {
    if (!hasMenu) {
      return;
    }
    longPressRef.current = false;
    timerRef.current = setTimeout(() => {
      longPressRef.current = true;
      setMenuOpen(true);
    }, LONG_PRESS_MS);
  };

  const endPress = (): void => {
    clearTimeout(timerRef.current);
  };

  const handleClick = (): void => {
    if (longPressRef.current) {
      longPressRef.current = false;
      return;
    }
    onClick();
  };

  return (
    <>
      {menuOpen ? (
        <button
          aria-label="Zamknij menu szybkich akcji"
          className="fixed inset-0 z-40 bg-scrim/55"
          onClick={() => setMenuOpen(false)}
          type="button"
        />
      ) : null}

      {/* Od 768 px nie ma paska zakładek, więc FAB stoi 24 px od rogu.
          `+1px`: `--tabbar-height` to wysokość samego paska zakładek, a pasek dokłada
          nad sobą włosową linię `border-t`. Bez tego odstęp wychodzi 15 px zamiast
          16 px wymaganych przez `15 §4.4` — niewidoczne, ale zmierzone. */}
      <div className="fixed bottom-[calc(theme(spacing.tabbar)+1px+env(safe-area-inset-bottom)+1rem)] right-4 z-50 flex flex-col items-end gap-2 md:bottom-6 md:right-6 [body[data-fab-hidden]_&]:hidden">
        {menuOpen && hasMenu ? (
          <ul className="mb-1 w-48 overflow-hidden rounded-lg border border-border bg-card shadow-sheet">
            {actions.map((action) => (
              <li key={action.label} className="border-b border-border last:border-b-0">
                <button
                  className="flex min-h-touch w-full items-center gap-3 px-4 text-left text-sm hover:bg-muted/50 active:bg-muted"
                  onClick={() => {
                    setMenuOpen(false);
                    action.onSelect();
                  }}
                  type="button"
                >
                  {action.icon}
                  {action.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <button
          aria-haspopup={hasMenu ? 'menu' : undefined}
          aria-label={label}
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-fab',
            'focus-visible:outline-none focus-visible:ring-ring focus-visible:ring-offset-background',
            'focus-visible:ring-2 focus-visible:ring-offset-2 active:bg-primary/85',
            className,
          )}
          onClick={handleClick}
          onContextMenu={(event) => {
            // Długie przytrzymanie na telefonie wywołuje menu systemowe — zabiera nasze.
            // Na desktopie prawy przycisk myszy to naturalna droga do tego samego menu.
            if (hasMenu) {
              event.preventDefault();
              setMenuOpen(true);
            }
          }}
          onPointerCancel={endPress}
          onPointerDown={startPress}
          onPointerLeave={endPress}
          onPointerUp={endPress}
          type="button"
        >
          {children}
        </button>
      </div>
    </>
  );
}

/**
 * Zapas pod treścią, żeby FAB nie zasłaniał ostatniego wiersza listy.
 *
 * Wartość nie jest „ładnym" `pb-20`: to wysokość paska, bezpieczny margines, odstęp
 * 16 px, średnica FAB 56 px i jeszcze 16 px, żeby ostatni wiersz nie kończył się
 * dokładnie pod przyciskiem.
 */
export const FAB_CONTENT_PADDING =
  'pb-[calc(theme(spacing.tabbar)+1px+env(safe-area-inset-bottom)+6rem)]';
