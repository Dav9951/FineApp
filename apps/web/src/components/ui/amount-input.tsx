import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { Keypad, type KeypadKey } from './keypad.js';

/**
 * Pole kwoty z własną klawiaturą numeryczną
 * ([15 §4.2](../../../../../plans/15-design-system.md#42-amountinput)).
 *
 * **Wyróżnik tej aplikacji.** Systemowa klawiatura numeryczna na iOS nie ma przecinka,
 * więc `inputMode="decimal"` na polu tekstowym nie wystarcza — kwoty z groszami trzeba
 * byłoby wpisywać przez kropkę albo przełączanie układu. Własna klawiatura daje
 * przecinek na stałe i kontrolę nad tym, co w ogóle da się wpisać.
 *
 * Bufor wpisywania jest **osobny od kwoty**: `12,` to stan poprawny w trakcie pisania,
 * ale nie jest liczbą. Dlatego stan trzyma tekst, a `onChange` dostaje już grosze.
 */

/** Separator dziesiętny — przecinek, zgodnie z zapisem polskim. */
const DECIMAL = ',';

/** Maksymalna liczba cyfr części całkowitej: 999 999 999,99 zł. */
const MAX_INTEGER_DIGITS = 9;

/** Maksymalna liczba cyfr części groszowej. */
const MAX_FRACTION_DIGITS = 2;

/** Spacja niełamliwa — separator tysięcy (15 §2.5). */
const NBSP = ' ';

/** Klawisz klawiatury kwoty. */
export type AmountKey =
  '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | ',' | 'backspace' | 'clear';

/**
 * Stosuje naciśnięcie klawisza do bufora wpisywania.
 *
 * Funkcja jest czysta i wyeksportowana osobno, bo to w niej siedzi cała mechanika,
 * którą łatwo zepsuć: brak drugiego przecinka, trzecia cyfra groszy, wiodące zero.
 *
 * @param draft - Bieżący bufor, np. `12,3`.
 * @param key - Naciśnięty klawisz.
 * @returns Nowy bufor.
 */
export function pressAmountKey(draft: string, key: AmountKey): string {
  if (key === 'clear') return '';
  if (key === 'backspace') return draft.slice(0, -1);

  if (key === DECIMAL) {
    if (draft.includes(DECIMAL)) return draft;
    // Przecinek jako pierwszy znak znaczy „zero i grosze" — bez tego powstałby bufor
    // `,50`, którego nie da się odczytać jako liczby.
    return draft.length === 0 ? `0${DECIMAL}` : `${draft}${DECIMAL}`;
  }

  const separatorAt = draft.indexOf(DECIMAL);
  if (separatorAt >= 0) {
    const fraction = draft.slice(separatorAt + 1);
    // Druga cyfra po przecinku kończy wpisywanie części groszowej.
    return fraction.length >= MAX_FRACTION_DIGITS ? draft : `${draft}${key}`;
  }

  // Wiodące zero znika: `0` + `5` to `5`, a nie `05`.
  if (draft === '0') return key;
  if (draft.length >= MAX_INTEGER_DIGITS) return draft;
  return `${draft}${key}`;
}

/**
 * Przelicza bufor na grosze.
 *
 * @param draft - Bufor wpisywania.
 * @returns Kwota w groszach; pusty bufor i sam przecinek dają `0`.
 */
export function draftToMinor(draft: string): number {
  const [whole = '', fraction = ''] = draft.split(DECIMAL);
  const wholeMinor = (whole.length === 0 ? 0 : Number(whole)) * 100;
  return wholeMinor + Number(fraction.padEnd(MAX_FRACTION_DIGITS, '0').slice(0, 2) || '0');
}

/**
 * Zamienia grosze na bufor wpisywania.
 *
 * Grosze równe zeru **nie** trafiają do bufora: `1500` to `15`, a nie `15,00` —
 * inaczej kursor od razu stałby za groszami i nie dałoby się dopisać cyfry złotówek.
 *
 * @param amountMinor - Kwota w groszach.
 * @returns Bufor wpisywania.
 */
export function minorToDraft(amountMinor: number): string {
  const whole = Math.trunc(Math.abs(amountMinor) / 100);
  const fraction = Math.abs(amountMinor) % 100;
  if (fraction === 0) return whole === 0 ? '' : String(whole);
  return `${whole}${DECIMAL}${String(fraction).padStart(2, '0')}`;
}

/**
 * Formatuje bufor do wyświetlenia — grupuje tysiące, zostawiając wpisane grosze.
 *
 * Nie używa `formatMinor`, bo ten domyka grosze do dwóch cyfr i tekst skakałby
 * w trakcie pisania: po wpisaniu `1` pod przecinkiem pojawiłoby się `10`.
 *
 * @param draft - Bufor wpisywania.
 * @returns Tekst do wyświetlenia.
 */
export function formatDraft(draft: string): string {
  const [whole = '', fraction] = draft.split(DECIMAL);
  const grouped = (whole.length === 0 ? '0' : whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return fraction === undefined ? grouped : `${grouped}${DECIMAL}${fraction}`;
}

/** Właściwości pola kwoty. */
export interface AmountInputProps {
  /** Kwota początkowa w groszach. */
  defaultValueMinor?: number;
  /** Wywoływane po każdej zmianie; kwota w groszach. */
  onChange?: (amountMinor: number) => void;
  /** Komunikat walidacji pod kreską; obecność przełącza kreskę na `--danger`. */
  error?: string;
  /** Jednostka obok kwoty. */
  unit?: string;
  /** Etykieta pola dla czytnika ekranu. */
  label?: string;
  /** Pole dostaje fokus od razu po otwarciu arkusza. */
  autoFocus?: boolean;
  className?: string;
}

/**
 * Pole kwoty z klawiaturą numeryczną.
 *
 * @param props - Właściwości komponentu.
 * @param props.defaultValueMinor - Kwota początkowa w groszach.
 * @param props.onChange - Zmiana kwoty.
 * @param props.error - Komunikat walidacji.
 * @param props.unit - Jednostka obok kwoty.
 * @param props.label - Etykieta dla czytnika ekranu.
 * @param props.autoFocus - Czy ustawić fokus po zamontowaniu.
 * @param props.className - Dodatkowe klasy.
 * @returns Element pola kwoty.
 */
export function AmountInput({
  defaultValueMinor = 0,
  onChange,
  error,
  unit = 'zł',
  label = 'Kwota',
  autoFocus = true,
  className,
}: AmountInputProps): ReactNode {
  const [draft, setDraft] = useState(() => minorToDraft(defaultValueMinor));
  const displayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) displayRef.current?.focus();
  }, [autoFocus]);

  // Bieżący bufor w referencji: `onChange` rodzica nie może iść z wnętrza funkcji
  // aktualizującej `setDraft` — React wywołuje ją w trakcie renderowania, a zmiana stanu
  // rodzica w tej chwili to błąd „setState w trakcie renderowania innego komponentu".
  const draftRef = useRef(draft);

  const apply = (key: AmountKey): void => {
    const current = draftRef.current;
    const next = pressAmountKey(current, key);
    if (next === current) return;
    draftRef.current = next;
    setDraft(next);
    onChange?.(draftToMinor(next));
  };

  /**
   * Tłumaczy klawisz wspólnej klawiatury na klawisz bufora kwoty.
   *
   * @param key - Klawisz z `<Keypad>`.
   */
  const handleKeypad = (key: KeypadKey): void => {
    apply(key === 'extra' ? DECIMAL : key);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Klawiatura sprzętowa: kropka i przecinek dają ten sam separator (15 §4.2).
    const { key } = event;
    if (/^\d$/.test(key)) {
      event.preventDefault();
      apply(key as AmountKey);
    } else if (key === ',' || key === '.') {
      event.preventDefault();
      apply(DECIMAL);
    } else if (key === 'Backspace') {
      event.preventDefault();
      apply('backspace');
    }
  };

  const invalid = error !== undefined;

  return (
    <div className={cn('flex flex-col', className)}>
      <div
        aria-invalid={invalid}
        aria-label={label}
        className={cn(
          'flex items-baseline justify-center gap-1.5 py-2 font-numeric text-hero font-semibold tabular-nums',
          'focus-visible:outline-none',
          invalid ? 'text-danger' : 'text-foreground',
        )}
        onKeyDown={handleKeyDown}
        ref={displayRef}
        role="textbox"
        tabIndex={0}
      >
        <span>{formatDraft(draft)}</span>
        <span className="text-lg font-normal text-muted-foreground">{unit}</span>
      </div>

      {/* Kreska pod kwotą: --primary przy fokusie, --danger przy błędzie. */}
      <div aria-hidden="true" className={cn('h-px w-full', invalid ? 'bg-danger' : 'bg-primary')} />

      <p
        className={cn(
          'mt-2 min-h-4 text-center text-caption text-danger',
          invalid ? '' : 'sr-only',
        )}
        role={invalid ? 'alert' : undefined}
      >
        {error ?? ''}
      </p>

      <Keypad
        className="mt-4"
        extraAriaLabel="Przecinek"
        extraLabel={DECIMAL}
        onClear={() => {
          apply('clear');
        }}
        onPress={handleKeypad}
      />
    </div>
  );
}
