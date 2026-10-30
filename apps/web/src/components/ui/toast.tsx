import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Toast ([15 §4.10](../../../../../plans/15-design-system.md#410-pozostałe)) — krótki
 * komunikat nad paskiem zakładek, 4 s, z akcją „Cofnij" przy operacjach odwracalnych.
 *
 * **Stan powłoki, nie ekranu.** Usunięcie z arkusza zamyka arkusz, a przesunięcie wiersza
 * może go wyrzucić z listy — toast pokazany przez komponent, który zaraz znika,
 * zniknąłby razem z nim, zabierając „Cofnij". Dlatego provider siedzi w powłoce, a ekrany
 * tylko wołają `show`.
 *
 * Jeden naraz: nowy zastępuje poprzedni. Kolejka toastów o usuwaniu kolejnych wierszy
 * pokazywałaby „Cofnij" przy transakcji, której już nie widać.
 */

/** Akcja toastu. */
export interface ToastAction {
  readonly label: string;
  readonly onAction: () => void;
}

/** Treść toastu. */
export interface ToastOptions {
  readonly message: string;
  readonly action?: ToastAction;
}

/** Sterowanie toastem. */
export interface ToastControls {
  /** Pokazuje toast; zastępuje bieżący. */
  show: (options: ToastOptions) => void;
}

/** Czas wyświetlania (15 §4.10). */
export const TOAST_DURATION_MS = 4000;

const ToastContext = createContext<ToastControls | undefined>(undefined);

/**
 * Sterowanie toastem.
 *
 * @returns Funkcja pokazująca toast.
 * @throws {Error} Poza {@link ToastProvider}.
 */
export function useToast(): ToastControls {
  const value = useContext(ToastContext);
  if (value === undefined) {
    throw new Error('useToast: komponent musi być wewnątrz <ToastProvider>');
  }
  return value;
}

/** Toast na ekranie — z kluczem, żeby ten sam tekst pokazany drugi raz odświeżył czas. */
interface ShownToast extends ToastOptions {
  readonly key: number;
}

/**
 * Provider toastów.
 *
 * Odliczanie stoi, dopóki wskaźnik albo fokus jest na toaście: kto sięga po „Cofnij",
 * nie może go stracić w połowie ruchu (WCAG 2.2.1 — regulowany limit czasu).
 *
 * @param props - Właściwości komponentu.
 * @param props.children - Treść aplikacji.
 * @returns Drzewo z miejscem na toast.
 */
export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toast, setToast] = useState<ShownToast | null>(null);
  const [paused, setPaused] = useState(false);
  const nextKey = useRef(0);

  const show = useCallback((options: ToastOptions) => {
    nextKey.current += 1;
    setToast({ ...options, key: nextKey.current });
  }, []);

  const dismiss = useCallback(() => {
    setToast(null);
    setPaused(false);
  }, []);

  useEffect(() => {
    if (toast === null || paused) return;
    const timer = setTimeout(dismiss, TOAST_DURATION_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [toast, paused, dismiss]);

  const controls = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={controls}>
      {children}
      {/* Region istnieje zawsze: czytnik ekranu ogłasza tylko zmianę treści regionu,
          który już był w drzewie — region wstawiony razem z tekstem bywa przemilczany. */}
      <div
        aria-live="polite"
        className={cn(
          'pointer-events-none fixed z-50',
          // Nad paskiem zakładek, obok FAB-a (56 px + 16 px marginesu), nie pod nim.
          'bottom-[calc(theme(spacing.tabbar)+1px+env(safe-area-inset-bottom)+1rem)] left-4 right-[5.5rem]',
          'md:bottom-6 md:left-auto md:right-6 md:w-96',
        )}
        role="status"
      >
        {toast === null ? null : (
          <div
            className={cn(
              'pointer-events-auto flex min-h-touch bg-foreground text-background shadow-sheet',
              'items-center gap-3 rounded-md py-1 pl-4 pr-1',
              'duration-200 ease-out animate-in fade-in slide-in-from-bottom-2',
            )}
            key={toast.key}
            onBlur={() => {
              setPaused(false);
            }}
            onFocus={() => {
              setPaused(true);
            }}
            onPointerEnter={() => {
              setPaused(true);
            }}
            onPointerLeave={() => {
              setPaused(false);
            }}
          >
            <span className="flex-1 text-sm">{toast.message}</span>
            {toast.action ? (
              <button
                className={cn(
                  'min-h-touch rounded-md px-3 text-sm font-semibold',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
                onClick={() => {
                  toast.action?.onAction();
                  dismiss();
                }}
                type="button"
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
