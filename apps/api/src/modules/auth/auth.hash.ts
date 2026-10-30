import { createHash } from 'node:crypto';

/**
 * Hashowanie identyfikatorów, których nie wolno zapisywać jawnie.
 *
 * Tabela `auth_attempts` trzyma **hash adresu e-mail i hash IP**, nigdy wartości jawnych
 * ([03 §3.4](../../../../../../plans/03-data-model.md#34-auth_attempts)). Powód jest
 * praktyczny: limit prób musi działać także dla adresów, **które nie istnieją** — inaczej
 * sam fakt, że dla jednego adresu pojawia się blokada, a dla drugiego nie, zdradza,
 * które konta są prawdziwe. Skoro i tak zapisujemy próby dla nieistniejących adresów,
 * to nie ma powodu trzymać tam cudzych e-maili w postaci czytelnej.
 *
 * `IP_HASH_SALT` **nie jest rotowana** — rotacja unieważniłaby całą historię prób,
 * czyli skasowałaby blokady w trakcie trwającego ataku ([09 §9](../../../../../../plans/09-security-auth.md)).
 */

/**
 * Liczy SHA-256 z wartości i soli.
 *
 * Sól jest doklejana, a nie użyta jako klucz HMAC, bo to jest kontrakt zapisany
 * w `03 §3.4` (`SHA-256(email + IP_HASH_SALT)`) i musi się zgadzać z tym, co już
 * leży w bazie.
 *
 * @param value - Wartość do zahashowania.
 * @param salt - Sól z konfiguracji.
 * @returns Hash w zapisie szesnastkowym.
 */
export function hashWithSalt(value: string, salt: string): string {
  return createHash('sha256').update(`${value}${salt}`).digest('hex');
}

/**
 * Liczy SHA-256 z samej wartości.
 *
 * Używane dla tokenu odświeżającego: token ma już 256 bitów entropii, więc sól niczego
 * nie dokłada, a zwykły SHA-256 pozwala wyszukać sesję jednym zapytaniem po indeksie
 * ([03 §3.3](../../../../../../plans/03-data-model.md#33-auth_sessions)).
 *
 * @param value - Wartość do zahashowania.
 * @returns Hash w zapisie szesnastkowym.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
