import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Przyciski ([15 §4.3](../../../../../plans/15-design-system.md#43-button-i-iconbutton)).
 *
 * **Wysokość dotykowa nigdy nie schodzi poniżej 44 px**, nawet gdy przycisk wygląda na
 * mniejszy. Rozmiar `small` robi to na dwa sposoby: odnośnik (bez tła) ma `min-h-touch`
 * i ujemny margines, a przycisk z tłem ma tło 36 px i obszar dotyku dociągnięty do 44 px
 * przezroczystym pseudoelementem — tło 44 px z ujemnym marginesem wchodziło na linię
 * nad stopką karty i wyglądało na rozlane (ADR-073).
 *
 * Stany wspólne dla wszystkiego, co dotykalne (preambuła `15 §4`): fokus zawsze
 * widoczny (`ring-2`), stan wyłączony przez `opacity-50` **i** `aria-disabled`,
 * hover tylko na desktopie i nigdy jako jedyny nośnik informacji.
 */

/** Klasy wspólne dla elementów dotykalnych. */
export const TOUCHABLE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
  'disabled:opacity-50 disabled:pointer-events-none active:bg-muted';

const buttonVariants = cva(TOUCHABLE, {
  variants: {
    variant: {
      /** Jedna akcja główna na ekran: Zapisz, Zatwierdź, Zaksięguj. */
      primary: 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80',
      /** Akcja wewnątrz ostrzeżenia lub kafla — uwagę niesie już baner. */
      soft: 'bg-muted text-primary border border-border hover:bg-muted/70',
      /** Akcja odwracalna obok głównej: Pomiń, Wybierz inną. */
      ghost: 'border border-border text-foreground hover:bg-muted/50',
      /** Wyłącznie operacja nieodwracalna, zawsze z potwierdzeniem. */
      danger: 'bg-danger text-background hover:bg-danger/90',
      /** Akcja tekstowa w nagłówku sekcji. */
      link: 'text-primary underline-offset-4 hover:underline',
    },
    size: {
      /** Akcje w arkuszu. */
      large: 'min-h-touch w-full px-4 text-base',
      /** Domyślny. */
      medium: 'min-h-touch px-4 text-sm',
      /** W wierszu listy — wizualnie mniejszy, ale obszar dotyku pełny (`compoundVariants`). */
      small: 'text-sm',
    },
  },
  compoundVariants: [
    /** Odnośnik nie ma tła — pełna wysokość dotyku, ujemny margines chowa ją w układzie. */
    { variant: 'link', size: 'small', className: 'min-h-touch -my-2 px-2' },
    /**
     * Przycisk z tłem: tło 36 px, pseudoelement wystaje 4 px w górę i w dół → 44 px
     * dotyku. Układ widzi 36 px, więc przycisk nie nachodzi na sąsiednie linie.
     */
    {
      variant: ['primary', 'soft', 'ghost', 'danger'],
      size: 'small',
      className:
        "relative h-9 px-3 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
    },
  ],
  defaultVariants: { variant: 'primary', size: 'medium' },
});

/** Właściwości przycisku. */
export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Renderuje potomka zamiast `<button>` — np. `<Link>` z routera. */
  asChild?: boolean;
  /**
   * Stan ładowania.
   *
   * Tekst **zostaje na miejscu**, obok niego pojawia się wskaźnik — szerokość się nie
   * zmienia, żeby układ nie skakał w trakcie zapisu.
   */
  loading?: boolean;
}

/**
 * Przycisk.
 *
 * @param props - Właściwości komponentu.
 * @param props.className - Dodatkowe klasy.
 * @param props.variant - Wariant wizualny.
 * @param props.size - Rozmiar.
 * @param props.asChild - Renderuje potomka zamiast `<button>`.
 * @param props.loading - Stan ładowania.
 * @param props.disabled - Stan wyłączony.
 * @param props.children - Treść przycisku.
 * @returns Element przycisku.
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...rest
}: ButtonProps): ReactNode {
  const Component = asChild ? Slot : 'button';
  const isDisabled = disabled === true || loading;

  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      // Samo `disabled` znika dla czytnika ekranu — `aria-disabled` zostaje (15 §4).
      aria-disabled={isDisabled}
      aria-busy={loading}
      disabled={isDisabled}
      {...rest}
    >
      {/* Przy `asChild` Slot przyjmuje dokładnie jedno dziecko — nawet `null` obok
          niego wywraca renderowanie, więc wskaźnik ładowania istnieje tylko dla
          prawdziwego `<button>` (odnośnik nie ma stanu ładowania). */}
      {asChild ? (
        children
      ) : (
        <>
          {children}
          {loading ? (
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-current border-b-transparent"
            />
          ) : null}
        </>
      )}
    </Component>
  );
}

/** Właściwości przycisku ikonowego. */
export interface IconButtonProps extends Omit<ButtonProps, 'size' | 'children'> {
  /** Opis akcji — **wymagany**: ikona bez etykiety nie istnieje dla czytnika ekranu. */
  label: string;
  children: ReactNode;
}

/**
 * Przycisk z samą ikoną.
 *
 * @param props - Właściwości komponentu.
 * @param props.label - Opis akcji dla czytnika ekranu.
 * @param props.className - Dodatkowe klasy.
 * @param props.children - Ikona.
 * @returns Element przycisku.
 */
export function IconButton({ label, className, children, ...rest }: IconButtonProps): ReactNode {
  return (
    <Button
      aria-label={label}
      className={cn('min-h-touch w-touch shrink-0 px-0', className)}
      variant="ghost"
      {...rest}
    >
      {children}
    </Button>
  );
}
