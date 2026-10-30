/**
 * Wstrzykiwalne „teraz".
 *
 * Każdy serwis zależny od bieżącego czasu dostaje `Clock` w zależnościach
 * ([02 §5](../../../../plans/02-architecture.md#5-serwisy--wstrzykiwanie-zależności)).
 * Bez tego reguły miesięczne, terminy pozycji cyklicznych i limit księgowania wstecz
 * są nietestowalne — nie da się napisać testu „31 stycznia" ani „29 lutego",
 * nie przestawiając zegara maszyny.
 *
 * `Clock` zwraca **znacznik systemowy** (`Date`). Zamiana go na datę biznesową
 * `YYYY-MM-DD` zawsze przechodzi przez strefę gospodarstwa — patrz
 * [07 §1.1](../../../../plans/07-domain-rules.md#11-trzy-różne-pojęcia-czasu).
 */

/** Źródło bieżącego czasu. */
export interface Clock {
  /** @returns Chwila bieżąca jako znacznik systemowy. */
  now(): Date;
}

/** Zegar produkcyjny — czyta czas systemowy. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * Zegar zatrzymany na wskazanej chwili — do testów.
 *
 * @param instant - Chwila do zwracania; `Date` albo napis ISO 8601.
 * @returns Zegar zwracający zawsze tę samą chwilę.
 */
export function fixedClock(instant: Date | string): Clock {
  const frozen = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(frozen.getTime())) {
    throw new TypeError(`fixedClock: nieprawidłowa chwila: ${String(instant)}`);
  }
  // Kopia, żeby wołający nie mógł przesunąć zegara, mutując przekazany obiekt.
  const ms = frozen.getTime();
  return { now: () => new Date(ms) };
}

/** Zegar testowy, który da się przesuwać — do reguł zależnych od upływu czasu. */
export interface MutableClock extends Clock {
  /**
   * Przesuwa zegar do przodu.
   *
   * @param ms - Liczba milisekund do dodania.
   */
  advance(ms: number): void;
}

/**
 * Zegar testowy startujący od wskazanej chwili i przesuwany ręcznie.
 *
 * Potrzebny tam, gdzie test sprawdza *upływ* czasu — blokada po nieudanych próbach
 * logowania, ważność tokenu odświeżającego — a nie pojedynczą datę.
 *
 * @param start - Chwila początkowa; `Date` albo napis ISO 8601.
 * @returns Zegar z metodą `advance`.
 */
export function mutableClock(start: Date | string): MutableClock {
  let ms = (typeof start === 'string' ? new Date(start) : start).getTime();
  if (Number.isNaN(ms)) {
    throw new TypeError(`mutableClock: nieprawidłowa chwila: ${String(start)}`);
  }
  return {
    now: () => new Date(ms),
    advance: (delta: number) => {
      ms += delta;
    },
  };
}
