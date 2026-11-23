/**
 * Identyfikator nadawany w przeglądarce — w formacie ULID, jak identyfikatory serwera
 * (Crockford Base32, 10 znaków czasu + 16 losowych).
 *
 * Jedyny odbiorca to dopisywanie pozycji listy zakupów offline (ADR-096): pozycja ma
 * identyfikator, zanim serwer ją zobaczy, więc ponowienie z kolejki jej nie dubluje.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Nowy identyfikator w formacie ULID.
 *
 * @param now - Chwila w ms (do testów).
 * @returns 26 znaków.
 */
export function newClientId(now: number = Date.now()): string {
  let time = '';
  let value = now;
  for (let index = 0; index < 10; index += 1) {
    time = ALPHABET.charAt(value % 32) + time;
    value = Math.floor(value / 32);
  }
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  return time + Array.from(random, (byte) => ALPHABET.charAt(byte % 32)).join('');
}
