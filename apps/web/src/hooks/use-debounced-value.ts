import { useEffect, useState } from 'react';

/**
 * Wartość opóźniona o `delayMs` od ostatniej zmiany.
 *
 * Do pól, które pytają serwer w trakcie pisania (przelicznik % ↔ kwota, 06 §3.5 —
 * „z opóźnieniem 300 ms"): żądanie na każdy znak to wyścig odpowiedzi i zbędny ruch
 * na łączu komórkowym.
 *
 * @param value - Wartość bieżąca.
 * @param delayMs - Opóźnienie w milisekundach.
 * @returns Wartość sprzed ostatnich `delayMs` bez zmian.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return (): void => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return debounced;
}
