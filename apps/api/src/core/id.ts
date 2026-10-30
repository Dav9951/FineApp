import { randomFillSync } from 'node:crypto';

import { systemClock, type Clock } from './clock.js';

/**
 * Generator identyfikatorów głównych — 26 znaków, sortowalny czasowo (ULID).
 *
 * Klucze główne są `TEXT` i powstają w aplikacji, nie w bazie
 * ([03](../../../../plans/03-data-model.md)). Wybór ULID-a zamiast UUID-a v4 ma jeden
 * konkretny powód: **identyfikator sortuje się tak jak czas powstania**. Dzięki temu
 * `ORDER BY id` na liście transakcji daje kolejność chronologiczną bez dodatkowego
 * indeksu po znaczniku, a klucz wstawiany do indeksu B-drzewa rośnie monotonicznie,
 * zamiast trafiać w losowe miejsce.
 *
 * Budowa (zgodnie ze specyfikacją ULID):
 * ```
 * 01JB2X9K7T  QW3R5Y7U9I1O3P5A
 * └ 48 bitów ┘└─── 80 bitów ───┘
 *   czas ms      losowość
 * ```
 *
 * Alfabet to Crockford Base32 — bez `I`, `L`, `O` i `U`, więc identyfikatora
 * przepisanego ręcznie z ekranu nie da się pomylić przez `1`/`I` ani `0`/`O`.
 */

/** Crockford Base32 — 32 znaki bez `I`, `L`, `O`, `U`. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Liczba znaków części czasowej (48 bitów zapisane w 50 bitach). */
const TIME_LENGTH = 10;

/** Liczba znaków części losowej (80 bitów). */
const RANDOM_LENGTH = 16;

/** Pełna długość identyfikatora. */
export const ID_LENGTH = TIME_LENGTH + RANDOM_LENGTH;

/** Największy znacznik czasu mieszczący się w 48 bitach (rok 10889). */
const MAX_TIME = 281_474_976_710_655;

/**
 * Wypełnia bufor losowymi indeksami alfabetu.
 *
 * `byte % 32` nie wprowadza obciążenia, bo 256 dzieli się przez 32 bez reszty —
 * każdy z 32 znaków wypada dokładnie w ośmiu ze 256 wartości bajtu.
 *
 * @param target - Bufor do wypełnienia w miejscu.
 */
function fillRandom(target: Uint8Array): void {
  randomFillSync(target);
  for (let i = 0; i < target.length; i += 1) {
    target[i] = (target[i] ?? 0) % 32;
  }
}

/**
 * Zwiększa część losową o jeden, z przeniesieniem w lewo.
 *
 * Wywoływane tylko wtedy, gdy w tej samej milisekundzie powstaje kolejny
 * identyfikator — bez tego dwa rekordy z jednej milisekundy miałyby nieokreśloną
 * kolejność, a to psuje właśnie tę własność, dla której wybrano ULID.
 *
 * @param target - Bufor indeksów do zwiększenia w miejscu.
 * @throws {Error} Gdy wszystkie 80 bitów jest wykorzystane (nieosiągalne w praktyce).
 */
function incrementRandom(target: Uint8Array): void {
  for (let i = target.length - 1; i >= 0; i -= 1) {
    const current = target[i] ?? 0;
    if (current < 31) {
      target[i] = current + 1;
      return;
    }
    target[i] = 0;
  }
  throw new Error('id: wyczerpana przestrzeń losowa w obrębie jednej milisekundy');
}

/**
 * Koduje znacznik czasu na `TIME_LENGTH` znaków alfabetu.
 *
 * @param ms - Znacznik w milisekundach od epoki.
 * @returns Dziesięcioznakowy prefiks identyfikatora.
 */
function encodeTime(ms: number): string {
  let rest = ms;
  let out = '';
  for (let i = 0; i < TIME_LENGTH; i += 1) {
    const digit = rest % 32;
    out = ALPHABET[digit] + out;
    rest = (rest - digit) / 32;
  }
  return out;
}

/**
 * Koduje bufor indeksów na znaki alfabetu.
 *
 * @param source - Bufor indeksów 0–31.
 * @returns Napis o długości bufora.
 */
function encodeRandom(source: Uint8Array): string {
  let out = '';
  for (const index of source) {
    out += ALPHABET[index];
  }
  return out;
}

/** Generator identyfikatorów z własnym stanem monotoniczności. */
export interface IdGenerator {
  /** @returns Kolejny identyfikator o długości {@link ID_LENGTH}. */
  next(): string;
}

/**
 * Tworzy generator identyfikatorów.
 *
 * Stan monotoniczności (ostatni znacznik i ostatnia część losowa) należy do
 * **instancji**, nie do modułu. Gdyby siedział w module, dwa testy używające jawnych
 * znaczników wpływałyby na siebie przez kolejność wykonania — a to jest dokładnie ten
 * rodzaj ukrytego stanu, dla którego w tym projekcie wstrzykuje się `Clock`
 * ([02 §5](../../../../plans/02-architecture.md#5-serwisy--wstrzykiwanie-zależności)).
 *
 * @param clock - Źródło czasu; domyślnie zegar systemowy.
 * @returns Generator z metodą `next`.
 */
export function createIdGenerator(clock: Clock = systemClock): IdGenerator {
  let lastTime = -1;
  let lastRandom = new Uint8Array(RANDOM_LENGTH);

  return {
    next(): string {
      const now = clock.now().getTime();
      if (!Number.isInteger(now) || now < 0 || now > MAX_TIME) {
        throw new RangeError(`id: znacznik czasu poza zakresem: ${String(now)}`);
      }

      if (now > lastTime) {
        lastTime = now;
        lastRandom = new Uint8Array(RANDOM_LENGTH);
        fillRandom(lastRandom);
      } else {
        // Ta sama milisekunda albo zegar cofnięty (NTP, zmiana czasu). W obu
        // przypadkach zostajemy przy ostatnim znaczniku i zwiększamy część losową —
        // identyfikator mniejszy od poprzedniego zepsułby porządek, dla którego
        // wybrano ULID.
        incrementRandom(lastRandom);
      }

      return encodeTime(lastTime) + encodeRandom(lastRandom);
    },
  };
}

/** Domyślny generator aplikacji, oparty na zegarze systemowym. */
const defaultGenerator = createIdGenerator();

/**
 * Generuje nowy identyfikator domyślnym generatorem.
 *
 * @returns Identyfikator o długości {@link ID_LENGTH}.
 */
export function newId(): string {
  return defaultGenerator.next();
}

/**
 * Sprawdza, czy napis wygląda na identyfikator z tego generatora.
 *
 * Używane przy walidacji parametrów tras — odrzuca śmieci, zanim pójdą do bazy.
 *
 * @param value - Napis do sprawdzenia.
 * @returns `true`, gdy ma poprawną długość i wyłącznie znaki alfabetu.
 */
export function isId(value: string): boolean {
  if (value.length !== ID_LENGTH) return false;
  for (const char of value) {
    if (!ALPHABET.includes(char)) return false;
  }
  return true;
}

/**
 * Odczytuje znacznik czasu zapisany w identyfikatorze.
 *
 * Przydatne w diagnostyce („kiedy powstał ten rekord") bez sięgania do bazy.
 *
 * @param id - Identyfikator z tego generatora.
 * @returns Chwila powstania identyfikatora.
 * @throws {TypeError} Gdy napis nie jest poprawnym identyfikatorem.
 */
export function idTimestamp(id: string): Date {
  if (!isId(id)) {
    throw new TypeError(`id: nieprawidłowy identyfikator: ${id}`);
  }
  let ms = 0;
  for (let i = 0; i < TIME_LENGTH; i += 1) {
    ms = ms * 32 + ALPHABET.indexOf(id[i] as string);
  }
  return new Date(ms);
}
