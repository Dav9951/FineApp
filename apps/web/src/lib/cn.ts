import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Składa klasy Tailwinda, rozstrzygając konflikty na rzecz ostatniej.
 *
 * Bez `twMerge` zapis `cn('p-2', props.className)` z `className="p-4"` dawałby obie
 * klasy naraz, a wynik zależałby od kolejności w arkuszu — czyli od czegoś, czego
 * autor komponentu nie kontroluje.
 *
 * ## Dlaczego `twMerge` trzeba tu douczyć
 *
 * `twMerge` zna **domyślną** skalę Tailwinda, a nie naszą. Skala stopni pisma z
 * [15 §3.3](../../../../plans/15-design-system.md#33-typografia) dokłada własne nazwy
 * (`text-caption`, `text-meta`, `text-amount`, `text-hero`), których nie ma w domyślnej
 * skali. Nierozpoznany `text-*` trafia domyślnie do grupy **koloru tekstu** — a wtedy
 * `cn('text-hero', 'text-expense')` zjada rozmiar i kwota w nagłówku renderuje się
 * w 16 px zamiast 40 px.
 *
 * Błąd jest cichy: nic nie protestuje, po prostu typografia przestaje działać tam,
 * gdzie rozmiar stoi obok koloru — czyli w `<Money>`, czyli wszędzie. Dlatego własne
 * stopnie pisma są tu wymienione jawnie.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // Własne stopnie pisma z 15 §3.3; `sm`, `base`, `lg` i `xl` zna już Tailwind.
      'font-size': [{ text: ['caption', 'meta', 'amount', 'hero'] }],
    },
  },
});

/**
 * Składa klasy, rozstrzygając konflikty na rzecz ostatniej.
 *
 * @param inputs - Klasy, tablice klas albo mapy warunkowe.
 * @returns Pojedynczy napis klas.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
