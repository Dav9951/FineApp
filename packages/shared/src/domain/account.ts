import type { AccountType, AllocationClass } from './enums.js';

/**
 * Reguły kont wspólne dla API i frontu
 * ([07 §2.1](../../../../plans/07-domain-rules.md#21-klasyfikacja-kont)).
 *
 * Funkcja żyje w `shared`, bo tej samej odpowiedzi potrzebują obie strony: serwer
 * uzupełnia pominiętą klasę przy zapisie, a formularz podpowiada ją, zanim użytkownik
 * cokolwiek wyśle. Dwie kopie tabeli rozjechałyby się przy pierwszym nowym typie konta.
 */

/** Domyślna klasa alokacji dla każdego rodzaju konta. */
const DEFAULT_ALLOCATION_CLASS: Readonly<Record<AccountType, AllocationClass>> = {
  checking: 'spending',
  cash: 'spending',
  savings: 'savings',
  investment: 'investment',
  // „Inne" to najczęściej karta przedpłacona albo portfel w aplikacji — pieniądze
  // do wydania, nie odłożone. Traktowanie ich jako oszczędności zawyżałoby cele.
  other: 'spending',
};

/**
 * Zwraca klasę alokacji, którą konto dostaje, gdy użytkownik jej nie nadpisze.
 *
 * @param type - Rodzaj konta.
 * @returns Domyślna klasa alokacji.
 */
export function defaultAllocationClass(type: AccountType): AllocationClass {
  return DEFAULT_ALLOCATION_CLASS[type];
}

/**
 * Wyznacza klasę alokacji po zmianie rodzaju konta.
 *
 * Klasa jest przeliczana z nowego rodzaju **tylko wtedy, gdy nie była nadpisana** —
 * czyli gdy równa się domyślnej dla dotychczasowego rodzaju. Nadpisanie jest świadomą
 * decyzją użytkownika (rachunek bieżący jako poduszka finansowa) i zmiana ikonki
 * rodzaju nie może go po cichu cofnąć. Z kolei klasa, której nikt nie ruszał, ma
 * podążać za rodzajem — inaczej zmiana „bieżące → oszczędnościowe" zostawiłaby konto
 * poza pulą oszczędności i cele procentowe przestałyby je widzieć.
 *
 * Zmiana klasy nie przelicza historii: transakcje niosą migawkę klas z chwili zapisu
 * (niezmiennik I-6).
 *
 * @param previousType - Rodzaj konta przed zmianą.
 * @param previousClass - Klasa konta przed zmianą.
 * @param nextType - Nowy rodzaj konta.
 * @returns Klasa, którą konto powinno mieć po zmianie rodzaju.
 */
export function allocationClassAfterTypeChange(
  previousType: AccountType,
  previousClass: AllocationClass,
  nextType: AccountType,
): AllocationClass {
  const wasOverridden = previousClass !== defaultAllocationClass(previousType);
  return wasOverridden ? previousClass : defaultAllocationClass(nextType);
}
