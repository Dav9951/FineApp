import { randomBytes, randomInt } from 'node:crypto';

import { isPinAcceptable } from '@fineapp/shared';
import argon2 from 'argon2';

/**
 * Haszowanie i generowanie PIN-ów
 * ([09 §2.2](../../../../../../plans/09-security-auth.md#22-parametry-argon2id)).
 *
 * Sześciocyfrowy PIN to milion kombinacji — bez kosztownej funkcji skrótu
 * zautomatyzowany atak przechodzi go w minuty. Koszt jednego sprawdzenia jest tu
 * **główną barierą**, więc nie obniżamy go „dla wygody": jedno logowanie dziennie
 * może kosztować 100 ms.
 */

/**
 * Parametry argon2id.
 *
 * Dobrane tak, żeby pojedyncze sprawdzenie zajmowało ~50–100 ms na typowym VPS.
 * Wartości trzeba zweryfikować na maszynie docelowej przed wdrożeniem
 * ([09 §11](../../../../../../plans/09-security-auth.md#11-lista-kontrolna-przed-wdrożeniem),
 * obserwacja `Z-2` w `13-progress.md`).
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

/**
 * Liczy hash PIN-u.
 *
 * Wynik zawiera sól i parametry, więc w bazie siedzi jedna kolumna i nic poza nią
 * nie trzeba wersjonować przy zmianie kosztu.
 *
 * @param pin - PIN w postaci jawnej; nie wolno go nigdzie zalogować.
 * @returns Hash w formacie PHC.
 */
export async function hashPin(pin: string): Promise<string> {
  return argon2.hash(pin, ARGON2_OPTIONS);
}

/**
 * Sprawdza PIN wobec hasha.
 *
 * Parametrów **nie podajemy** — siedzą w samym hashu. Dzięki temu podniesienie kosztu
 * w `ARGON2_OPTIONS` nie unieważnia PIN-ów zapisanych wcześniej: stare hashe weryfikują
 * się swoimi parametrami, nowe dostają nowe.
 *
 * Nie rzuca przy uszkodzonym hashu — zwraca `false`. Wyjątek z tego miejsca wyciekłby
 * do odpowiedzi jako 500 i odróżniałby konto z popsutym hashem od konta nieistniejącego.
 *
 * @param hash - Hash z bazy.
 * @param pin - PIN podany przy logowaniu.
 * @returns `true`, gdy PIN pasuje.
 */
export async function verifyPin(hash: string, pin: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pin);
  } catch {
    return false;
  }
}

/**
 * Hash-atrapa do porównania, gdy użytkownika nie ma
 * ([09 §2.4](../../../../../../plans/09-security-auth.md#24-przepływ-logowania), krok 4).
 *
 * Bez niego odpowiedź dla nieistniejącego adresu wracałaby natychmiast, a dla
 * istniejącego po ~50 ms — czyli **po czasie odpowiedzi dałoby się wyliczyć, które
 * konta istnieją**. Atrapa jest liczona raz, leniwie, i od tej pory każda nieudana
 * próba kosztuje tyle samo co udana.
 */
let dummyHash: Promise<string> | undefined;

/**
 * Zwraca hash-atrapę, licząc go przy pierwszym użyciu.
 *
 * Warto wywołać ją **przy starcie aplikacji** ({@link warmUpDummyPinHash}): policzenie
 * atrapy kosztuje jedno haszowanie, a gdyby wypadło na pierwsze żądanie, to właśnie
 * ono byłoby zauważalnie wolniejsze — czyli sam mechanizm chroniący przed pomiarem
 * czasu dawałby jeden pomiar do odczytania.
 *
 * @returns Hash losowego, nieosiągalnego PIN-u.
 */
export function dummyPinHash(): Promise<string> {
  // Losowy sekret, a nie stała: stały hash w kodzie to stała, którą ktoś kiedyś
  // potraktuje jak prawdziwy PIN testowy.
  dummyHash ??= hashPin(`atrapa-${randomBytes(32).toString('hex')}`);
  return dummyHash;
}

/**
 * Losuje PIN spełniający reguły z `09 §2.3`.
 *
 * Losowanie idzie z `randomInt` (CSPRNG), a nie z `Math.random` — PIN wygenerowany
 * słabym generatorem da się odtworzyć ze znajomości czasu uruchomienia skryptu.
 * Wynik jest sprawdzany tymi samymi regułami co PIN podany ręcznie, więc skrypt
 * nie wygeneruje `123456`.
 *
 * @param length - Długość PIN-u.
 * @param minLength - Minimalna długość z konfiguracji.
 * @param maxLength - Maksymalna długość z konfiguracji.
 * @returns PIN złożony z cyfr.
 * @throws {RangeError} Gdy po wielu próbach nie udało się trafić poprawnego PIN-u.
 */
export function generatePin(length = 6, minLength = 6, maxLength = 8): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let pin = '';
    for (let digit = 0; digit < length; digit += 1) {
      pin += String(randomInt(0, 10));
    }
    if (isPinAcceptable(pin, minLength, maxLength)) return pin;
  }
  throw new RangeError(
    `auth: nie udało się wylosować PIN-u o długości ${String(length)} spełniającego reguły`,
  );
}

/**
 * Liczy hash-atrapę z wyprzedzeniem.
 *
 * @returns Obietnica spełniona, gdy atrapa jest gotowa.
 */
export async function warmUpDummyPinHash(): Promise<void> {
  await dummyPinHash();
}
