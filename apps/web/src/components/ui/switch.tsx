import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Przełącznik ([15 §4.10](../../../../../plans/15-design-system.md#410-pozostałe)).
 *
 * 44 × 24 px. **Stan niesie także pozycja uchwytu, nie tylko kolor** — wymóg z `15 §2.4`:
 * przy dichromatyzmie sam kolor nie wystarcza, a przełącznik bez widocznej pozycji
 * uchwytu staje się zgadywanką.
 */

/** Właściwości przełącznika. */
export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Opis dla czytnika ekranu, gdy przełącznik stoi bez widocznej etykiety. */
  label?: string;
  className?: string;
}

/**
 * Przełącznik dwustanowy.
 *
 * @param props - Właściwości komponentu.
 * @param props.checked - Stan włączenia.
 * @param props.onCheckedChange - Wywoływane przy zmianie.
 * @param props.disabled - Stan wyłączony.
 * @param props.label - Opis dla czytnika ekranu.
 * @param props.className - Dodatkowe klasy.
 * @returns Element przełącznika.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  label,
  className,
}: SwitchProps): ReactNode {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-disabled={disabled}
      {...(label ? { 'aria-label': label } : {})}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        // Przełącznik ma 44 × 24 px (15 §4.10), ale cel dotykowy nie schodzi poniżej
        // 44 px w OBU wymiarach (15 §2.6). Pseudoelement powiększa obszar kliknięcia
        // bez dokładania wypełnienia, które pomalowałoby się tłem stanu.
        "after:absolute after:inset-x-0 after:top-1/2 after:h-touch after:-translate-y-1/2 after:content-['']",
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted',
        disabled ? 'opacity-50' : '',
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block h-5 w-5 rounded-full bg-card shadow transition-transform',
          'data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0.5',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
