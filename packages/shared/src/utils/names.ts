/**
 * Porównywanie nazw nadawanych przez użytkownika (kategorie, źródła przychodu).
 */

/**
 * Porównuje dwie nazwy tak, jak porównuje je człowiek.
 *
 * Wielkość liter i białe znaki na brzegach nie mają znaczenia; polskie znaki — owszem
 * („Łódź" ≠ „Lodz"), bo to różne słowa. `toLocaleLowerCase('pl')`, a nie SQL-owe
 * `lower()`, które w SQLite zna wyłącznie ASCII i nie zrównałoby „Żabka" z „żabka".
 *
 * @param a - Pierwsza nazwa.
 * @param b - Druga nazwa.
 * @returns `true`, gdy nazwy są dla użytkownika tym samym.
 */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase('pl') === b.trim().toLocaleLowerCase('pl');
}

/**
 * Sprowadza tekst do postaci porównywanej przy **wyszukiwaniu**.
 *
 * Inaczej niż {@link sameName} zrównuje litery z ogonkiem z literami bez: na telefonie
 * bez polskiej klawiatury „zabka" ma znaleźć „Żabkę". Przy nazwach to byłby błąd
 * („Łódź" i „Lodz" to dwie różne kategorie), przy szukaniu — oczekiwane zachowanie.
 *
 * „ł" nie ma rozkładu kanonicznego (to osobna litera, nie „l" z kreską), więc zamiana
 * jest jawna; pozostałe polskie znaki rozkłada `NFD`.
 *
 * @param text - Tekst do porównania.
 * @returns Tekst małymi literami, bez znaków diakrytycznych.
 */
export function foldForSearch(text: string): string {
  return text.toLocaleLowerCase('pl').normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');
}
