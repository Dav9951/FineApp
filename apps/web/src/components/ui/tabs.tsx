import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Zakładki segmentowe ([15 §4.10](../../../../../plans/15-design-system.md#410-pozostałe)).
 *
 * `bg-muted p-1 rounded-md`, aktywna zakładka na `bg-card` z cieniem. Role ARIA
 * dokłada Radix, więc nawigacja strzałkami działa bez dopisywania obsługi klawiatury.
 */

/** Pojedyncza zakładka. */
export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
}

/** Właściwości zakładek. */
export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

/**
 * Zakładki segmentowe.
 *
 * @param props - Właściwości komponentu.
 * @param props.items - Lista zakładek.
 * @param props.value - Wartość aktywnej zakładki.
 * @param props.onValueChange - Wywoływane przy zmianie.
 * @param props.className - Dodatkowe klasy.
 * @returns Element zakładek.
 */
export function Tabs({ items, value, onValueChange, className }: TabsProps): ReactNode {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={className}>
      <TabsPrimitive.List className="flex gap-1 rounded-md bg-muted p-1">
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              'min-h-touch flex-1 rounded-md px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'data-[state=active]:bg-card data-[state=active]:shadow-sheet',
              'data-[state=inactive]:text-muted-foreground',
            )}
          >
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((item) => (
        <TabsPrimitive.Content key={item.value} value={item.value} className="pt-4">
          {item.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
