import { useId, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Wybór jednej opcji z kilku, jako siatka kafli z ikoną (06 §3.7: „typ — ikony do wyboru").
 * Powstał w `F2-6` przy formularzu konta; do `components/ui` trafił w `F2-7`, gdy
 * potrzebował go drugi ekran (rodzaj źródła przychodu).
 *
 * Pod spodem są **natywne** przyciski opcji: strzałki, `Tab` i odczyt „zaznaczono,
 * 2 z 5" działają bez własnej obsługi klawiatury. Zaznaczenie niesie grubsza ramka
 * i znak ✓, nie tylko kolor (15 §2.4).
 */

/** Opcja siatki. */
export interface OptionGridItem<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: ReactNode;
}

/** Właściwości siatki opcji. */
export interface OptionGridProps<T extends string> {
  /** Podpis grupy — widoczny i odczytywany przez czytnik ekranu. */
  legend: string;
  options: readonly OptionGridItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Siatka opcji jednokrotnego wyboru.
 *
 * @param props - Właściwości komponentu.
 * @param props.legend - Podpis grupy.
 * @param props.options - Opcje.
 * @param props.value - Wybrana wartość.
 * @param props.onChange - Zmiana wyboru.
 * @param props.className - Dodatkowe klasy.
 * @returns Element grupy opcji.
 */
export function OptionGrid<T extends string>({
  legend,
  options,
  value,
  onChange,
  className,
}: OptionGridProps<T>): ReactNode {
  const name = useId();
  return (
    <fieldset className={cn('flex flex-col gap-1', className)}>
      <legend className="mb-1 text-sm text-muted-foreground">{legend}</legend>
      {/* `auto-rows-fr` + `h-full`: każdy kafel ma wysokość najwyższego w siatce — etykieta
          w jednej linii nie robi kafla niższego od sąsiada z etykietą w dwóch. */}
      <div className="grid auto-rows-fr grid-cols-3 gap-2">
        {options.map((option) => (
          <label className="relative flex" key={option.value}>
            <input
              checked={option.value === value}
              className="peer sr-only"
              name={name}
              onChange={() => {
                onChange(option.value);
              }}
              type="radio"
              value={option.value}
            />
            <span
              className={cn(
                'flex h-full min-h-14 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-sm border px-1 py-2 text-center text-caption',
                'border-border text-foreground active:bg-muted',
                'peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:font-semibold peer-checked:text-primary peer-checked:ring-1 peer-checked:ring-primary',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
              )}
            >
              {option.icon}
              {option.label}
            </span>
            <span
              aria-hidden="true"
              className="absolute right-1.5 top-1 hidden text-caption text-primary peer-checked:block"
            >
              ✓
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
