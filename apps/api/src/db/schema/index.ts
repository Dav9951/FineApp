/**
 * Barrel schematu bazy.
 *
 * Kolejność eksportów odpowiada zależnościom kluczy obcych z
 * [03 §3](../../../../../plans/03-data-model.md#3-ddl). Część powiązań jest **cykliczna**
 * (zobowiązanie ↔ reguła cykliczna, transakcja ↔ wystąpienie / planowany wydatek /
 * dokument) — Drizzle rozwiązuje je leniwie, przez `references(() => ...)`, więc import
 * cykliczny między modułami nie stanowi problemu w czasie wykonania.
 *
 * `_shared.ts` celowo **nie** jest tu re-eksportowany: buildery kolumn są wewnętrzną
 * hydrauliką schematu, a ich obecność w tej przestrzeni nazw psuje `Object.values(schema)`
 * — wynik przestaje być zbiorem samych tabel.
 */
export * from './households.js';
export * from './users.js';
export * from './accounts.js';
export * from './categories.js';
export * from './income-sources.js';
export * from './goals.js';
export * from './liabilities.js';
export * from './allocation-targets.js';
export * from './recurring.js';
export * from './planned-expenses.js';
export * from './documents.js';
export * from './budget.js';
export * from './transactions.js';
export * from './app-meta.js';
export * from './idempotency-keys.js';
