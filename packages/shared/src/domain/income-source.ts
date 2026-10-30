import type { IncomeSourceKind } from './enums.js';

/**
 * Reguły źródeł przychodu wspólne dla API i frontu
 * ([07 §2.3](../../../../plans/07-domain-rules.md#23-podstawa-procentu)).
 */

/**
 * Rodzaje źródeł, które domyślnie **nie** wchodzą do podstawy celów procentowych.
 *
 * Zwrot podatku to pieniądz już raz zarobiony i opodatkowany — wliczony do podstawy
 * sprawiłby, że w kwietniu „odłożyłem 20% wpływów" wymagałoby odłożenia także 20%
 * zwrotu, a w pozostałych miesiącach wskaźnik skakałby bez powodu. To jedyny rodzaj,
 * który plan wskazuje wprost (03 §3.7, 07 §2.3); reszta domyślnie się liczy, a
 * użytkownik może każde źródło przełączyć ręcznie.
 */
const EXCLUDED_BY_DEFAULT: ReadonlySet<IncomeSourceKind> = new Set(['refund']);

/**
 * Zwraca domyślną wartość `countsTowardAllocation` dla rodzaju źródła.
 *
 * @param kind - Rodzaj źródła przychodu.
 * @returns `false` dla zwrotów, `true` dla pozostałych.
 */
export function defaultCountsTowardAllocation(kind: IncomeSourceKind): boolean {
  return !EXCLUDED_BY_DEFAULT.has(kind);
}
