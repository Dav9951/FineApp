import type { CategoryContextEntry, ExtractionKind } from '../document-extractor.js';

/**
 * Prompt odczytu dokumentu ([08 §7](../../../../../plans/08-ocr-ai-pipeline.md#7-prompt-systemowy))
 * i kontekst kategorii ([08 §4](../../../../../plans/08-ocr-ai-pipeline.md#4-kontekst-kategorii), `F7-4`).
 *
 * Treść reguł jest ta sama co w planie. Zmieniło się tylko zakończenie: zamiast
 * „odpowiedz wyłącznie przez wywołanie narzędzia" — JSON zgodny ze schematem, bo
 * strukturę wymusza `output_config.format` (ADR-059).
 *
 * Punkty 2, 7 i 12 są celowo stanowcze: w narzędziu finansowym cicha halucynacja kwoty
 * jest najkosztowniejszym możliwym błędem.
 */

/** Prompt systemowy — stały, żeby dało się go kiedyś cache'ować. */
export const EXTRACTION_SYSTEM_PROMPT = `Jesteś asystentem księgowym w aplikacji do budżetu domowego prowadzonego w Polsce.
Twoim zadaniem jest dokładne odczytanie załączonego dokumentu i przypisanie pozycji
do kategorii z podanej listy.

ZASADY ODCZYTU

1. Wszystkie kwoty podawaj w GROSZACH jako liczby całkowite.
   „127,99 zł" → 12799.  „1 234,00" → 123400.
2. Nie licz nic w pamięci. Przepisuj kwoty dokładnie tak, jak widnieją na dokumencie.
   Jeśli suma pozycji nie zgadza się z sumą na dokumencie, zostaw tę rozbieżność —
   zgłoś ją w polu notes. Nie „poprawiaj" pozycji, żeby się zgadzały.
3. Kwota zawsze dodatnia. Kierunek przepływu wyrażaj polem direction, nie znakiem minus.
4. Daty w formacie YYYY-MM-DD. Polski zapis 18.09.2026 to 2026-09-18.
   Nigdy nie interpretuj 03.04.2026 jako 3 kwietnia bez pewności — w razie wątpliwości
   kieruj się formatem dzień.miesiąc.rok, standardowym w polskich dokumentach.
5. Pomijaj wiersze, które nie są pozycjami: numer kasy, NIP, kod fiskalny, podziękowania,
   informacje o programie lojalnościowym, dane karty płatniczej.
6. Rabaty i kaucje ujmuj jako osobne pozycje z kierunkiem inflow (rabat, zwrot kaucji)
   albo outflow (pobrana kaucja).
7. Jeśli czegoś nie da się odczytać, wpisz null. NIE ZGADUJ.
   Zły odczyt kwoty jest znacznie gorszy niż brak odczytu.

ZASADY KATEGORYZACJI

8. Wybieraj categoryId WYŁĄCZNIE z listy DOSTĘPNE KATEGORIE. Nie wymyślaj identyfikatorów.
9. Korzystaj z podpowiedzi przy kategoriach — zawierają nazwy sklepów i typowe słowa.
10. Kontekst sklepu jest istotny: „baterie" w markecie spożywczym to zwykle zakupy
    codzienne, a w sklepie elektronicznym — elektronika.
11. Gdy żadna kategoria nie pasuje sensownie, ustaw categoryId na null i zaproponuj
    nazwę nowej w suggestedCategoryName. Rób to oszczędnie — użytkownik ma
    rozbudowaną listę i nowe kategorie powinny być wyjątkiem.
12. Pole confidence wypełniaj uczciwie. 0.95+ gdy dopasowanie jest oczywiste,
    0.5–0.7 gdy zgadujesz z kontekstu, poniżej 0.5 gdy naprawdę nie wiesz.
    Zaniżona pewność jest użyteczna — zawyżona jest szkodliwa.

Odpowiedz wyłącznie obiektem JSON zgodnym z podanym schematem.`;

/** Kategorie w kontekście, gdy lista jest długa (08 §4). */
export const CATEGORY_CONTEXT_LIMIT = 120;

/**
 * Formatuje listę kategorii tak, jak w 08 §4.
 *
 * Wydatkowe i przychodowe są osobnymi blokami: przy wyciągu model widzi obie, przy
 * paragonie — tylko wydatkowe (wołający przekazuje już przefiltrowaną listę).
 *
 * @param categories - Kategorie do pokazania modelowi.
 * @returns Tekst kontekstu.
 */
export function formatCategoryContext(categories: readonly CategoryContextEntry[]): string {
  const block = (kind: 'expense' | 'income', title: string): string | null => {
    const entries = categories.filter((category) => category.kind === kind);
    if (entries.length === 0) return null;
    const lines = entries.map((category) => {
      const head = `${category.id}  ${category.path}`;
      return category.hints === null || category.hints.trim() === ''
        ? head
        : `${head}\n           podpowiedzi: ${category.hints.trim()}`;
    });
    return `${title}:\n${lines.join('\n')}`;
  };
  return [
    block('expense', 'DOSTĘPNE KATEGORIE WYDATKÓW'),
    block('income', 'DOSTĘPNE KATEGORIE PRZYCHODÓW'),
  ]
    .filter((part): part is string => part !== null)
    .join('\n\n');
}

/**
 * Treść wiadomości użytkownika: co to za dokument i jakie są kategorie.
 *
 * @param kind - Rodzaj dokumentu.
 * @param categories - Kategorie do pokazania.
 * @param currency - Waluta gospodarstwa.
 * @returns Tekst wiadomości.
 */
export function extractionUserText(
  kind: ExtractionKind,
  categories: readonly CategoryContextEntry[],
  currency: string,
): string {
  const what =
    kind === 'bank_statement'
      ? 'Załączony dokument to wyciąg bankowy. Odczytaj wszystkie operacje z datami.'
      : 'Załączony dokument to paragon albo faktura zakupowa. Odczytaj nagłówek i pozycje.';
  const context = formatCategoryContext(categories);
  return [
    what,
    `Waluta gospodarstwa: ${currency}.`,
    context === '' ? 'Brak kategorii na liście — categoryId zawsze null.' : context,
  ].join('\n\n');
}
