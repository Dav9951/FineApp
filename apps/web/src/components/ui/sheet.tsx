import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { IconButton } from './button.js';

/**
 * Arkusz ([15 §4.6](../../../../../plans/15-design-system.md#46-sheet)).
 *
 * Na telefonie wjeżdża od dołu, od 768 px jest wyśrodkowanym modalem 520 px.
 * Radix daje pułapkę fokusa, `Esc`, blokadę przewijania tła i poprawne role ARIA;
 * ten komponent dokłada wygląd oraz **przechwycenie przycisku „wstecz"**.
 *
 * > **Dlaczego „wstecz" musi zamykać arkusz.** Na telefonie arkusz wygląda jak nowy
 * > ekran, więc pierwszym odruchem jest gest cofnięcia. Bez przechwycenia `popstate`
 * > ten gest wyrzuca z aplikacji, gubiąc wypełniony formularz. Otwarcie dokłada wpis
 * > do historii, zamknięcie go zdejmuje — dzięki temu „wstecz" zamyka arkusz, a nie
 * > wychodzi z aplikacji.
 *
 * Przyciemnienie używa **własnego tokenu `--scrim`**, nigdy `--foreground`: w motywie
 * ciemnym tekst podstawowy jest prawie biały, więc nakładka z niego **rozjaśniałaby**
 * ekran zamiast go przygasić.
 */

/** Właściwości arkusza. */
export interface SheetProps {
  /** Czy arkusz jest otwarty. */
  open: boolean;
  /** Zmiana stanu otwarcia. */
  onOpenChange: (open: boolean) => void;
  /** Tytuł na środku nagłówka — **wymagany**, niesie nazwę dla czytnika ekranu. */
  title: string;
  /** Opis dla czytnika ekranu, gdy sam tytuł nie wystarcza. */
  description?: string;
  /** Akcja po prawej stronie nagłówka, np. „Zapisz". */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Dokłada wpis do historii na czas otwarcia arkusza.
 *
 * Wpis znika przy zamknięciu z wnętrza arkusza (✕, `Esc`, akcja), a `popstate`
 * zamyka arkusz, gdy użytkownik cofnie się przyciskiem przeglądarki. Bez `pushedRef`
 * zamknięcie wywołane przez `popstate` zdejmowałoby **cudzy** wpis historii.
 *
 * @param open - Czy arkusz jest otwarty.
 * @param onOpenChange - Zmiana stanu otwarcia.
 */
function useBackButtonClose(open: boolean, onOpenChange: (open: boolean) => void): void {
  const pushedRef = useRef(false);
  // Najświeższa funkcja w refie, nie w zależnościach efektu: rodzic podający funkcję
  // strzałkową tworzy ją przy każdym renderze, a każde ponowne uruchomienie efektu
  // cofało historię i dokładało wpis od nowa. Asynchroniczny `popstate` z tego cofnięcia
  // zamykał arkusz, a przy kolejnym przebiegu zdejmował już wpis ekranu — arkusz na
  // `/settings` wyrzucał na dashboard (`F8-1`).
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) {
      return;
    }

    window.history.pushState({ fineappSheet: true }, '');
    pushedRef.current = true;

    const handlePopState = (): void => {
      // Wpis został już zdjęty przez przeglądarkę — nie wolno go zdejmować drugi raz.
      pushedRef.current = false;
      onOpenChangeRef.current(false);
    };

    window.addEventListener('popstate', handlePopState);

    return (): void => {
      window.removeEventListener('popstate', handlePopState);
      if (pushedRef.current) {
        pushedRef.current = false;
        window.history.back();
      }
    };
  }, [open]);
}

/**
 * Arkusz od dołu (telefon) albo modal (desktop).
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.title - Tytuł nagłówka.
 * @param props.description - Opis dla czytnika ekranu.
 * @param props.action - Akcja po prawej stronie nagłówka.
 * @param props.children - Treść arkusza.
 * @param props.className - Dodatkowe klasy treści.
 * @returns Element arkusza.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  action,
  children,
  className,
}: SheetProps): ReactNode {
  // Wpis historii dopiero po zamontowaniu. Arkusz ładowany leniwie montuje się już
  // otwarty, a tryb ścisły Reacta odpala wtedy efekt dwa razy: wpis → cofnięcie → wpis.
  // Cofnięcie w przeglądarce jest asynchroniczne, więc jego `popstate` dochodzi po
  // drugim wpisie i zamyka świeżo otwarty arkusz. Po zamontowaniu efekt rusza raz.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  useBackButtonClose(open && mounted, onOpenChange);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim/55 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in motion-reduce:animate-none" />
        <Dialog.Content
          className={cn(
            'fixed z-50 flex flex-col bg-card text-card-foreground shadow-sheet',
            // Telefon: arkusz od dołu, nigdy wyżej niż 97% ekranu.
            'inset-x-0 bottom-0 max-h-[97%] rounded-t-lg',
            // Desktop: wyśrodkowany modal 520 px.
            'md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[520px] md:max-w-[calc(100vw-2rem)]',
            'md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:border-border',
            'data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none',
            'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
            'md:data-[state=closed]:slide-out-to-bottom-0 md:data-[state=open]:slide-in-from-bottom-0',
          )}
        >
          {/* Uchwyt 36 × 4 px — sygnał, że arkusz da się zsunąć w dół. */}
          <div
            aria-hidden="true"
            className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/45 md:hidden"
          />

          {/* Nagłówek jest przyklejony: przewija się treść, nie tytuł z akcją. */}
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2">
            <Dialog.Close asChild>
              <IconButton label="Zamknij">
                <X aria-hidden="true" className="h-5 w-5" />
              </IconButton>
            </Dialog.Close>
            <Dialog.Title className="flex-1 truncate text-center text-base font-medium">
              {title}
            </Dialog.Title>
            <div className="flex min-w-touch justify-end">{action}</div>
          </header>

          {description === undefined ? (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{description}</Dialog.Description>
          )}

          {/* Dół = 16 px + bezpieczny margines urządzenia. Samo `pb-safe-bottom` nadpisywało
              `p-4`, więc tam, gdzie margines jest zerowy (desktop), ostatni przycisk
              przyklejał się do krawędzi modala. */}
          <div
            className={cn(
              'overflow-y-auto overscroll-contain p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]',
              className,
            )}
          >
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
