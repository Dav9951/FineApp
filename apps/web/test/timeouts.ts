/**
 * Limit oczekiwania na otwarcie arkusza transakcji w testach.
 *
 * Dlaczego dłuższy niż domyślne 1000 ms `findBy*`: pierwsze otwarcie arkusza w pliku
 * testów płaci jednorazowy koszt — leniwy `import()` modułu arkusza (ADR-037) plus
 * pierwszy montaż drzewa Radix `Dialog` i formularza na zimnym JIT. Lokalnie na jednym
 * rdzeniu to ok. 450 ms (kolejne otwarcia: ok. 50 ms); na obciążonym runnerze GitHub
 * Actions, gdzie cały plik trwa kilka razy dłużej, przekracza sekundę i test pada,
 * choć aplikacja działa (przebieg 43959667450).
 *
 * Limit dotyczy **wyłącznie** kroku otwarcia arkusza, nie asercji po nim: arkusz,
 * który się nie otworzy, dalej oblewa test — tylko po 5 s zamiast po 1 s. Wczytanie
 * modułu z góry w `beforeAll` sprawdzone i odrzucone: zdejmuje najwyżej ok. 150 ms,
 * bo większość kosztu to pierwszy render, nie import.
 */
export const SHEET_OPEN_TIMEOUT = { timeout: 5_000 } as const;
