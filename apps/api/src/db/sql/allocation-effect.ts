import { sql, type SQL } from 'drizzle-orm';

/**
 * Efekt netto przelewu na pulę — SQL-owy odpowiednik `allocationEffects` z `shared`
 * ([07 §2.2](../../../../../plans/07-domain-rules.md#22-wpływ-przelewu-na-pule--ujęcie-netto)).
 * Dodatni przy wpłacie do puli, ujemny przy wypłacie, zero gdy przelew jej nie dotyczy.
 *
 * Wspólny fragment dla repozytoriów, które sumują pule: ekranu miesiąca (`months`,
 * `F3-1`) i księgi dla rozkładu i celów (`transactions`, `F5-3`). Jedno wyrażenie
 * w jednym miejscu — dwie kopie prędzej czy później by się rozjechały. Musi dawać ten
 * sam wynik co funkcja; test przechodzi wszystkie kombinacje klas i nadpisań.
 *
 * Wiersz transakcji musi być dostępny pod aliasem `t`.
 *
 * @param kind - Pula.
 * @returns Wyrażenie SQL z kwotą efektu jednego wiersza `t`.
 */
export function transferEffectSql(kind: 'savings' | 'investment'): SQL {
  return sql`CASE
    WHEN t.type <> 'transfer' THEN 0
    WHEN t.allocation_override = 'none' THEN 0
    WHEN t.allocation_override IS NOT NULL
      THEN CASE WHEN t.allocation_override = ${kind} THEN t.amount_minor ELSE 0 END
    WHEN t.source_allocation_class IS NULL OR t.target_allocation_class IS NULL
      OR t.source_allocation_class = t.target_allocation_class THEN 0
    WHEN t.target_allocation_class = ${kind} THEN t.amount_minor
    WHEN t.source_allocation_class = ${kind} THEN -t.amount_minor
    ELSE 0 END`;
}

/**
 * Spłata zobowiązania z jednego wiersza `t` (07 §2.2a): wydatek z `liability_id`, chyba
 * że wyłączony nadpisaniem `'none'`. Nigdy ujemna.
 *
 * @returns Wyrażenie SQL z kwotą spłaty jednego wiersza `t`.
 */
export function debtRepaymentSql(): SQL {
  return sql`CASE WHEN t.type = 'expense' AND t.liability_id IS NOT NULL
    AND (t.allocation_override IS NULL OR t.allocation_override <> 'none')
    THEN t.amount_minor ELSE 0 END`;
}

/**
 * Przychód wliczany do podstawy procentu (07 §2.3): bez źródła albo ze źródłem liczonym
 * do alokacji. Wymaga złączenia `income_sources` pod aliasem `s`.
 *
 * @returns Wyrażenie SQL z kwotą podstawy jednego wiersza `t`.
 */
export function incomeBaseSql(): SQL {
  return sql`CASE WHEN t.type = 'income'
    AND (s.id IS NULL OR s.counts_toward_allocation = 1)
    THEN t.amount_minor ELSE 0 END`;
}
