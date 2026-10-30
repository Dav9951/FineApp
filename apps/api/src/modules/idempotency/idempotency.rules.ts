import { createHash } from 'node:crypto';

/**
 * Czyste reguły idempotencji: odcisk ciała żądania.
 */

/**
 * Zapisuje wartość jako JSON z kluczami obiektów w stałej kolejności.
 *
 * `JSON.stringify` zachowuje kolejność wstawienia kluczy, więc `{a, b}` i `{b, a}` —
 * to samo żądanie — dałyby dwa różne odciski i fałszywy konflikt klucza.
 *
 * @param value - Wartość z ciała żądania (po walidacji).
 * @returns JSON o stałej kolejności kluczy.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Odcisk ciała żądania — SHA-256 z postaci kanonicznej.
 *
 * @param value - Ciało żądania.
 * @returns Skrót szesnastkowy.
 */
export function requestHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
