/**
 * Reguły PIN-u ([09 §2.3](../../../../plans/09-security-auth.md#23-wymagania-wobec-pinu)).
 *
 * Moduł jest izomorficzny: tych samych reguł używa skrypt zakładający użytkownika
 * i ekran zmiany PIN-u. Gdyby front miał własną kopię, prędzej czy później
 * rozjechałaby się z serwerem i użytkownik zobaczyłby „PIN poprawny" tuż przed
 * odrzuceniem go przez API.
 *
 * **Reguły obowiązują przy zakładaniu i zmianie, nigdy przy logowaniu.** Sprawdzanie
 * ich w trakcie logowania nic nie wnosi (PIN i tak jest już ustalony), a zdradza
 * napastnikowi, które kombinacje można pominąć.
 */

/** Minimalna długość dopuszczana przez kontrakt; konfiguracja może ją tylko zawęzić. */
export const PIN_ABSOLUTE_MIN_LENGTH = 4;

/** Maksymalna długość dopuszczana przez kontrakt. */
export const PIN_ABSOLUTE_MAX_LENGTH = 12;

/**
 * Najpopularniejsze PIN-y, których nie łapią pozostałe reguły.
 *
 * Ciągi rosnące, malejące i powtórzenia jednej cyfry mają własne sprawdzenia, więc
 * nie ma ich na liście — byłaby dwa razy dłuższa i nikt by nie wiedział, co ją trzyma.
 * Zostają wzorce „klawiaturowe": naprzemienne pary, przekątne klawiatury numerycznej
 * i daty zapisane jako `DDMMRR`.
 */
const COMMON_PINS: ReadonlySet<string> = new Set([
  '121212',
  '123123',
  '112233',
  '101010',
  '696969',
  '159753',
  '147258',
  '789456',
  '456123',
  '142536',
  '135790',
  '246810',
  '010203',
  '123321',
  '102030',
  '1234567',
  '7654321',
  '12345678',
  '87654321',
  '11223344',
]);

/** Powód odrzucenia PIN-u. */
export type PinRejection =
  'not-digits' | 'too-short' | 'too-long' | 'same-digit' | 'sequence' | 'common';

/** Wynik sprawdzenia PIN-u. */
export type PinCheck = { ok: true } | { ok: false; reason: PinRejection; message: string };

/** Komunikaty po polsku — trafiają wprost do interfejsu i na wyjście skryptu. */
const MESSAGES: Record<PinRejection, string> = {
  'not-digits': 'PIN może zawierać wyłącznie cyfry.',
  'too-short': 'PIN jest za krótki.',
  'too-long': 'PIN jest za długi.',
  'same-digit': 'PIN nie może składać się z jednej powtórzonej cyfry.',
  sequence: 'PIN nie może być ciągiem kolejnych cyfr.',
  common: 'Ten PIN jest zbyt popularny — zgadywarki sprawdzają go na początku.',
};

/** Cyfry po kolei — każdy ciąg rosnący jest tu podciągiem. */
const ASCENDING = '0123456789';

/** To samo w drugą stronę. */
const DESCENDING = '9876543210';

/**
 * Sprawdza, czy PIN jest ciągiem kolejnych cyfr.
 *
 * Zamiast porównywać kolejne cyfry parami wystarczy zapytać, czy PIN jest podciągiem
 * `0123456789` albo `9876543210` — to jest dokładnie definicja „kroku ±1". Wersja
 * pętlowa wymagała trzech sprawdzeń na `undefined`, z których żadne nie mogło się
 * wydarzyć (PIN jest tu już zwalidowany co do cyfr i długości), więc były to trzy
 * gałęzie nie do pokrycia testem.
 *
 * @param pin - PIN złożony z samych cyfr.
 * @returns `true`, gdy każda kolejna cyfra jest o jeden większa albo mniejsza.
 */
function isRunOfConsecutiveDigits(pin: string): boolean {
  return ASCENDING.includes(pin) || DESCENDING.includes(pin);
}

/**
 * Sprawdza PIN wobec reguł z `09 §2.3`.
 *
 * Kolejność sprawdzeń jest ustalona od najbardziej podstawowego do najbardziej
 * szczegółowego, żeby komunikat mówił o **pierwszej** rzeczy, którą trzeba poprawić.
 *
 * @param pin - PIN do sprawdzenia.
 * @param minLength - Minimalna długość z konfiguracji.
 * @param maxLength - Maksymalna długość z konfiguracji.
 * @returns Zgoda albo powód odrzucenia wraz z komunikatem po polsku.
 */
export function checkPin(pin: string, minLength = 6, maxLength = 8): PinCheck {
  if (!/^\d+$/.test(pin)) return reject('not-digits');
  if (pin.length < minLength) {
    return reject('too-short', `PIN musi mieć co najmniej ${String(minLength)} cyfr.`);
  }
  if (pin.length > maxLength) {
    return reject('too-long', `PIN może mieć najwyżej ${String(maxLength)} cyfr.`);
  }
  if (new Set(pin).size === 1) return reject('same-digit');
  if (isRunOfConsecutiveDigits(pin)) return reject('sequence');
  if (COMMON_PINS.has(pin)) return reject('common');
  return { ok: true };
}

/**
 * Buduje wynik odrzucenia.
 *
 * @param reason - Powód odrzucenia.
 * @param message - Komunikat; domyślnie stały tekst dla danego powodu.
 * @returns Wynik sprawdzenia.
 */
function reject(reason: PinRejection, message: string = MESSAGES[reason]): PinCheck {
  return { ok: false, reason, message };
}

/**
 * Sprawdza PIN i zwraca samą odpowiedź `tak/nie`.
 *
 * @param pin - PIN do sprawdzenia.
 * @param minLength - Minimalna długość.
 * @param maxLength - Maksymalna długość.
 * @returns `true`, gdy PIN spełnia wszystkie reguły.
 */
export function isPinAcceptable(pin: string, minLength = 6, maxLength = 8): boolean {
  return checkPin(pin, minLength, maxLength).ok;
}
