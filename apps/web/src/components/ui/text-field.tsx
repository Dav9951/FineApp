import { useId, type ChangeEvent, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Pole tekstowe z etykietą ([15 §4.10](../../../../../plans/15-design-system.md#410-pozostałe)).
 *
 * `<Field>` pokazuje wartość i otwiera arkusz; to pole przyjmuje tekst wpisywany
 * z klawiatury — nazwę konta, instytucję, notatkę. Dodane przy `F2-6`, bo formularz
 * konta był pierwszym miejscem, które go potrzebowało.
 *
 * Obramowanie z tokenu `--input`, nie `--border`: `--border` rozdziela sekcje i przy
 * polu dawałoby kontrast poniżej 3:1 wymaganego dla elementów interfejsu (15 §2.10).
 * Komunikat błędu jest powiązany z polem przez `aria-describedby`, więc czytnik ekranu
 * odczyta go razem z etykietą, a nie jako osobny, oderwany tekst.
 */

/** Właściwości pola tekstowego. */
export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Komunikat walidacji; obecność przełącza obramowanie na `--danger`. */
  error?: string;
  /** Podpis pod polem, gdy nie ma błędu. */
  hint?: string;
  /**
   * `month` — natywny wybór miesiąca (`YYYY-MM`), np. okres reguły cyklicznej;
   * `password` — pole maskowane (PIN w ustawieniach, `F8-1`).
   */
  type?: 'text' | 'date' | 'month' | 'password';
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
  autoFocus?: boolean;
  /**
   * Liczba wierszy — obecność zamienia pole w `<textarea>` (od `F2-9`: podpowiedzi
   * dla AI, lista nazw sklepów nie mieści się w jednej linii na 390 px).
   */
  rows?: number;
  className?: string;
}

/**
 * Pole tekstowe z etykietą nad nim.
 *
 * @param props - Właściwości komponentu.
 * @param props.label - Etykieta.
 * @param props.value - Wartość.
 * @param props.onChange - Zmiana wartości.
 * @param props.error - Komunikat walidacji.
 * @param props.hint - Podpis pod polem.
 * @param props.type - Rodzaj pola.
 * @param props.inputMode - Podpowiedź klawiatury ekranowej.
 * @param props.placeholder - Tekst zastępczy.
 * @param props.autoComplete - Podpowiedź autouzupełniania.
 * @param props.maxLength - Najwyższa długość.
 * @param props.autoFocus - Czy ustawić fokus po zamontowaniu.
 * @param props.rows - Liczba wierszy; obecność daje pole wielowierszowe.
 * @param props.className - Dodatkowe klasy.
 * @returns Element pola.
 */
export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  inputMode,
  placeholder,
  autoComplete = 'off',
  maxLength,
  autoFocus = false,
  rows,
  className,
}: TextFieldProps): ReactNode {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  // Wspólne dla `<input>` i `<textarea>` — obie wersje mają te same stany i opisy.
  const shared = {
    'aria-describedby': note === undefined ? undefined : noteId,
    'aria-invalid': error !== undefined,
    autoFocus,
    className: cn(
      'min-h-touch w-full rounded-sm border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      error === undefined ? 'border-input' : 'border-danger',
    ),
    id,
    maxLength,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(event.target.value);
    },
    placeholder,
    value,
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label className="text-sm text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      {rows === undefined ? (
        <input {...shared} autoComplete={autoComplete} inputMode={inputMode} type={type} />
      ) : (
        <textarea {...shared} className={cn(shared.className, 'py-2')} rows={rows} />
      )}
      {note === undefined ? null : (
        <p
          className={cn(
            'text-caption',
            error === undefined ? 'text-muted-foreground' : 'text-danger',
          )}
          id={noteId}
          role={error === undefined ? undefined : 'alert'}
        >
          {note}
        </p>
      )}
    </div>
  );
}
