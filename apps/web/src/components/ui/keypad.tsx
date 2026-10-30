import { Delete } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Klawiatura numeryczna — wspólna dla kwoty i PIN-u
 * ([15 §4.2](../../../../../plans/15-design-system.md#42-amountinput),
 * [06 §3.13](../../../../../plans/06-ui-views.md#313-logowanie--login)).
 *
 * **Dlaczego własna, a nie systemowa.** Systemowa klawiatura numeryczna na iOS nie ma
 * przecinka, więc kwoty z groszami trzeba by wpisywać przez kropkę albo przełączanie
 * układu. Przy PIN-ie chodzi o co innego: pole `type="password"` z klawiaturą systemową
 * pokazuje nad nią podgląd wpisanego znaku, a układ liter i cyfr skacze między ekranami.
 *
 * Oba zastosowania dzielą siatkę 3 × 4, klawisz 52 px i odstęp 6 px, więc dzielą też
 * ten komponent. Różnią się **jednym klawiszem** w lewym dolnym rogu: kwota ma tam
 * przecinek, PIN — pustkę.
 */

/** Naciśnięty klawisz. */
export type KeypadKey =
  '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'extra' | 'backspace';

/** Cyfry w układzie telefonicznym: 1–9, potem 0 w dolnym rzędzie. */
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** Czas przytrzymania `⌫`, po którym zgłaszane jest czyszczenie całości. */
const HOLD_TO_CLEAR_MS = 600;

/** Właściwości klawiatury. */
export interface KeypadProps {
  /** Wywoływane przy naciśnięciu klawisza. */
  onPress: (key: KeypadKey) => void;
  /** Wywoływane po przytrzymaniu `⌫`; brak wyłącza przytrzymanie. */
  onClear?: () => void;
  /** Treść klawisza w lewym dolnym rogu; brak zostawia puste miejsce. */
  extraLabel?: ReactNode;
  /** Opis klawisza dodatkowego dla czytnika ekranu. */
  extraAriaLabel?: string;
  /** Blokuje całą klawiaturę, np. na czas wysyłania. */
  disabled?: boolean;
  className?: string;
}

/**
 * Siatka klawiszy 3 × 4.
 *
 * @param props - Właściwości komponentu.
 * @param props.onPress - Naciśnięcie klawisza.
 * @param props.onClear - Przytrzymanie `⌫`.
 * @param props.extraLabel - Treść klawisza w lewym dolnym rogu.
 * @param props.extraAriaLabel - Opis klawisza dodatkowego.
 * @param props.disabled - Czy klawiatura jest zablokowana.
 * @param props.className - Dodatkowe klasy.
 * @returns Element klawiatury.
 */
export function Keypad({
  onPress,
  onClear,
  extraLabel,
  extraAriaLabel,
  disabled = false,
  className,
}: KeypadProps): ReactNode {
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Przytrzymanie już wyczyściło całość — puszczenie palca nie może dokładać
  // jeszcze jednego cofnięcia.
  const clearedRef = useRef(false);

  useEffect(
    () => (): void => {
      clearTimeout(holdTimerRef.current);
    },
    [],
  );

  const keyClass = cn(
    'bg-muted/50 border-border font-numeric flex h-[52px] items-center justify-center',
    'rounded-md border text-lg active:bg-muted disabled:opacity-50',
    'focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:outline-none',
    'focus-visible:ring-2 focus-visible:ring-offset-2',
  );

  const press = (key: KeypadKey): void => {
    if (clearedRef.current) {
      clearedRef.current = false;
      return;
    }
    onPress(key);
  };

  return (
    <div className={cn('grid grid-cols-3 gap-1.5', className)}>
      {DIGITS.map((digit) => (
        <button
          className={keyClass}
          disabled={disabled}
          key={digit}
          onClick={() => press(digit)}
          type="button"
        >
          {digit}
        </button>
      ))}

      {extraLabel === undefined ? (
        // Puste miejsce, nie przycisk: pusty przycisk łapałby fokus i czytnik ekranu
        // zapowiadałby go jako „przycisk", nie mówiąc, co robi.
        <span aria-hidden="true" />
      ) : (
        <button
          aria-label={extraAriaLabel}
          className={keyClass}
          disabled={disabled}
          onClick={() => press('extra')}
          type="button"
        >
          {extraLabel}
        </button>
      )}

      <button className={keyClass} disabled={disabled} onClick={() => press('0')} type="button">
        0
      </button>

      <button
        aria-label="Usuń ostatnią cyfrę"
        className={keyClass}
        disabled={disabled}
        onClick={() => press('backspace')}
        onPointerCancel={() => clearTimeout(holdTimerRef.current)}
        onPointerDown={() => {
          if (onClear === undefined) return;
          clearedRef.current = false;
          holdTimerRef.current = setTimeout(() => {
            clearedRef.current = true;
            onClear();
          }, HOLD_TO_CLEAR_MS);
        }}
        onPointerLeave={() => clearTimeout(holdTimerRef.current)}
        onPointerUp={() => clearTimeout(holdTimerRef.current)}
        type="button"
      >
        {/* Ikona, NIE znak U+232B: ten nie istnieje w Spectral ani Source Sans
            i wypada na znak zastępczy wyglądający jak koperta (15 §4.2). */}
        <Delete aria-hidden="true" className="h-5 w-5" />
      </button>
    </div>
  );
}
