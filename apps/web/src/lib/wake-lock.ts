import { useEffect, useRef, useState } from 'react';

/**
 * „Nie wygaszaj ekranu" w sklepie (06 §3.15) — Screen Wake Lock API.
 *
 * Blokada znika sama, gdy karta przestaje być widoczna, więc po powrocie trzeba ją wziąć
 * ponownie. Przeglądarka bez API (starsze Safari) — przełącznik się nie pokazuje.
 */

/** Minimalny kształt blokady, którego potrzebujemy. */
interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

/** `navigator.wakeLock` w zakresie, którego używamy. */
interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

/**
 * API blokady ekranu, jeśli przeglądarka je ma.
 *
 * @returns Obiekt API albo `null`.
 */
function wakeLockApi(): WakeLockLike | null {
  const candidate = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return candidate ?? null;
}

/** Stan i sterowanie blokadą ekranu. */
export interface WakeLockControls {
  readonly supported: boolean;
  readonly active: boolean;
  readonly toggle: () => void;
}

/**
 * Blokada wygaszania ekranu na czas życia komponentu.
 *
 * @returns Czy działa, czy włączona i przełącznik.
 */
export function useWakeLock(): WakeLockControls {
  const api = wakeLockApi();
  const [active, setActive] = useState(false);
  const sentinel = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!active || api === null) return undefined;
    // Flaga per przebieg efektu: blokada, która przyjdzie po wyłączeniu przełącznika
    // albo wyjściu z ekranu, jest zwalniana od razu, zamiast zostać na zawsze.
    let cancelled = false;
    const acquire = async (): Promise<void> => {
      try {
        const next = await api.request('screen');
        if (cancelled) {
          await next.release();
          return;
        }
        const previous = sentinel.current;
        sentinel.current = next;
        await previous?.release();
      } catch {
        // Odmowa (np. tryb oszczędzania baterii) — ekran po prostu zgaśnie jak zwykle.
        if (!cancelled) setActive(false);
      }
    };
    void acquire();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel.current?.release().catch(() => undefined);
      sentinel.current = null;
    };
  }, [active, api]);

  return {
    supported: api !== null,
    active,
    toggle: () => {
      setActive((value) => !value);
    },
  };
}
