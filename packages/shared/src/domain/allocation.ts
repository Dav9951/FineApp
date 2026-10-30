import type {
  AllocationClass,
  AllocationKind,
  AllocationOverride,
  TransactionType,
} from './enums.js';

/**
 * Wpływ transakcji na pule celów procentowych
 * ([07 §2.2](../../../../plans/07-domain-rules.md#22-wpływ-przelewu-na-pule--ujęcie-netto),
 * [§2.2a](../../../../plans/07-domain-rules.md#22a-spłata-zobowiązań)).
 *
 * Funkcja żyje w `shared`, bo tę samą odpowiedź potrzebują obie strony: API zwraca
 * `allocationEffects` w każdym DTO transakcji, a formularz przelewu pokazuje plakietkę
 * „Liczy się jako oszczędności +2 000,00" **zanim** użytkownik zapisze (07 §2.2).
 */

/** Pojedynczy efekt: pula i kwota netto. Dodatnia = wpłata do puli, ujemna = wypłata. */
export interface AllocationEffect {
  readonly kind: AllocationKind;
  readonly amountMinor: number;
}

/** Pola transakcji, z których wynika efekt alokacji. */
export interface AllocationSnapshot {
  readonly type: TransactionType;
  /** Zawsze dodatnia; kierunek wynika z `type`. */
  readonly amountMinor: number;
  /** Migawka klasy konta źródłowego; `null` poza przelewami (I-5). */
  readonly sourceAllocationClass: AllocationClass | null;
  /** Migawka klasy konta docelowego; `null` poza przelewami (I-5). */
  readonly targetAllocationClass: AllocationClass | null;
  readonly allocationOverride: AllocationOverride | null;
  /** Zobowiązanie, które spłaca wydatek — źródło efektu `debt_repayment`. */
  readonly liabilityId: string | null;
}

/**
 * Wylicza wpływ przelewu na pule — ujęcie **netto** (ADR-011).
 *
 * Zwraca listę, bo jeden przelew potrafi dotknąć dwóch pul naraz: przesunięcie
 * 5 000 zł z konta oszczędnościowego na maklerskie to jednocześnie −5 000 oszczędności
 * i +5 000 inwestycji. Przelew między kontami tej samej klasy daje listę pustą
 * (niezmiennik I-7) — inaczej dałoby się zawyżyć wykonanie, przelewając tam i z powrotem.
 *
 * @param tx - Przelew z migawkami klas i ewentualnym nadpisaniem.
 * @returns Efekty; pusta lista, gdy przelew jest neutralny albo wyłączony (`'none'`).
 */
function transferEffects(tx: AllocationSnapshot): AllocationEffect[] {
  if (tx.allocationOverride === 'none') return [];
  if (tx.allocationOverride !== null) {
    return [{ kind: tx.allocationOverride, amountMinor: tx.amountMinor }];
  }

  const { sourceAllocationClass: source, targetAllocationClass: target, amountMinor } = tx;
  // Przelew bez migawek łamie I-5; neutralność jest tu bezpieczniejsza niż zgadywanie puli.
  if (source === null || target === null || source === target) return [];

  const effects: AllocationEffect[] = [];
  if (target !== 'spending') effects.push({ kind: target, amountMinor });
  if (source !== 'spending') effects.push({ kind: source, amountMinor: -amountMinor });
  return effects;
}

/**
 * Wylicza wpływ dowolnej transakcji na pule celów procentowych.
 *
 * - **Przelew** — efekty z migawek klas obu kont albo z nadpisania (07 §2.2).
 * - **Wydatek powiązany ze zobowiązaniem** — rata to spłata długu, więc liczy się do
 *   puli `debt_repayment` w pełnej kwocie, chyba że użytkownik ją wyłączył (`'none'`,
 *   I-7a). Spłata nigdy nie jest ujemna — zaciągnięcie długu to przychód, nie ujemna
 *   rata (07 §2.2a).
 * - Pozostałe (przychód, zwykły wydatek) — nie ruszają żadnej puli.
 *
 * @param tx - Pola transakcji istotne dla alokacji.
 * @returns Efekty alokacji; pusta lista = operacja neutralna.
 */
export function allocationEffects(tx: AllocationSnapshot): AllocationEffect[] {
  if (tx.type === 'transfer') return transferEffects(tx);
  if (tx.type === 'expense' && tx.liabilityId !== null && tx.allocationOverride !== 'none') {
    return [{ kind: 'debt_repayment', amountMinor: tx.amountMinor }];
  }
  return [];
}
