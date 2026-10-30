# 08 — Pipeline OCR / AI

Realizacja wymagań #4 (odczyt paragonu i wyciągu) oraz #5 (AI widzi wszystkie kategorie).

## 1. Zasada nadrzędna

> **AI proponuje, człowiek zatwierdza.**

Żadna transakcja nie powstaje z odczytu automatycznie. Model produkuje **propozycje**
zapisane w `document_items`; dopiero jawny commit użytkownika tworzy zapisy w księdze.
Powód jest prosty: błędny odczyt kwoty zafałszowałby budżet cicho, a zaufanie do narzędzia
finansowego buduje się na tym, że nie dopisuje nic samo.

## 2. Przepływ

```
 1. UPLOAD          POST /documents (multipart)
       │            • walidacja typu i rozmiaru
       │            • SHA-256 → wykrycie ponownego wrzucenia
       │            • zapis na dysk: uploads/YYYY/MM/<id>.<ext>
       │            • wiersz `documents` (status = uploaded)
       ▼            • odpowiedź 202 + id  ← użytkownik może zamknąć ekran
 2. PRZYGOTOWANIE   (w tle, po odpowiedzi)
       │            • sharp: auto-obrót z EXIF, skalowanie do 1568 px, JPEG q80
       │            • usunięcie metadanych EXIF (geolokalizacja!)
       │            • PDF: render stron do obrazów (max 5 stron)
       ▼            • status = processing
 3. KONTEKST        • pobranie WSZYSTKICH kategorii gospodarstwa + ai_hints
       │            • lista kont (podpowiedź konta docelowego)
       ▼            • waluta i strefa czasowa
 4. WYWOŁANIE AI    • Anthropic Messages API, model z AI_MODEL
       │            • obraz(y) + prompt systemowy + kontekst kategorii
       │            • tool_choice wymuszający jedno narzędzie
       ▼            • odpowiedź strukturalna (nie tekst do parsowania)
 5. UTRWALENIE      • walidacja Zod odpowiedzi narzędzia
       │            • zapis `documents.parsed_summary`, `ai_raw_response`, koszt
       │            • `document_items` — jedna pozycja na wiersz odczytu
       │            • wykrycie duplikatów względem istniejących transakcji
       ▼            • status = parsed | failed
 6. PRZEGLĄD        GET /documents/:id → ekran 3.4.C z 06-ui-views.md
       │            • korekty: PATCH items, akceptacja/odrzucenie
       ▼            • akceptacja propozycji nowych kategorii
 7. COMMIT          POST /documents/:id/commit
                    • jedna transakcja bazodanowa: kategorie → transakcje → status
                    • status = committed
```

Kroki 2–5 działają **w tle procesu Node**, bez kolejki zadań. Uzasadnienie: dwóch
użytkowników, kilka dokumentów miesięcznie, jeden kontener. Dołożenie brokera kolejek
byłoby kosztem bez pokrycia w skali. Konsekwencja do przyjęcia: restart kontenera
w trakcie analizy zostawia dokument w stanie `processing` — przy starcie aplikacji
dokumenty starsze niż 10 minut w tym stanie są oznaczane jako `failed`
z komunikatem „Przerwano — spróbuj ponownie" i przyciskiem ponowienia.

## 3. Przygotowanie obrazu

```ts
/**
 * Przygotowuje plik do analizy przez model.
 *
 * Skalowanie do 1568 px dłuższego boku jest świadome: powyżej tej wartości model
 * i tak przeskalowuje obraz, więc większy plik to wyłącznie wyższy koszt i dłuższy
 * czas odpowiedzi. Metadane EXIF są usuwane, bo zdjęcie paragonu z telefonu zawiera
 * współrzędne GPS, których nie chcemy wysyłać do usługi zewnętrznej.
 *
 * @param sourcePath - Ścieżka wrzuconego pliku.
 * @returns Obrazy w base64 gotowe do wysłania (jeden na stronę).
 */
export async function prepareForVision(sourcePath: string): Promise<PreparedImage[]>;
```

| Wejście | Postępowanie |
|---|---|
| JPEG / PNG / WebP | auto-obrót z EXIF → skalowanie → JPEG q80 → usunięcie metadanych |
| HEIC | konwersja do JPEG **w przeglądarce** przy skalowaniu (`F7-9`); serwer bez dekodera HEVC odpowiada `415` z podpowiedzią (ADR-059) |
| PDF ≤ 5 stron | wysyłany natywnie jako blok `document` — bez renderowania stron (ADR-059) |
| PDF > 5 stron | `422` — „Wyciąg ma więcej niż 5 stron. Podziel plik." (liczba z `/Count`; nieznana — przepuszczamy) |

Zdjęcie jest przekodowywane już **przy zapisie** (obrót z EXIF, JPEG q85 bez metadanych,
miniatura 320 px) — na dysk i do modelu nie trafia GPS. `prepareForVision` skaluje zapisany
JPEG do 1568 px (q80).

Skalowanie odbywa się **również po stronie klienta** przed wysyłką (patrz
[06 §6](./06-ui-views.md#6-wydajność)) — oszczędza transfer na łączu komórkowym.
Serwer i tak skaluje ponownie, bo nie ufa wejściu.

## 4. Kontekst kategorii

Wymaganie #5 mówi wprost: *AI powinien widzieć wszystkie kategorie*. Do promptu trafia
pełna, płaska lista z identyfikatorami i podpowiedziami:

```
DOSTĘPNE KATEGORIE WYDATKÓW:
01JC7K...  Jedzenie > Zakupy spożywcze
           podpowiedzi: Biedronka, Lidl, Żabka, Kaufland, Auchan, Carrefour
01JC7L...  Jedzenie > Restauracje
           podpowiedzi: restauracja, pizzeria, Glovo, Uber Eats, Pyszne
01JC7M...  Dom > Chemia i higiena
           podpowiedzi: Rossmann, Hebe, proszek, płyn, papier toaletowy
...
```

Reguły budowy kontekstu:

- Kategorie **zarchiwizowane są pomijane** — model nie powinien proponować martwych pozycji.
- Podawana jest ścieżka `Rodzic > Dziecko`, bo sama nazwa „Paliwo" bywa niejednoznaczna.
- Identyfikatory są prawdziwymi ULID-ami — model zwraca `categoryId`, więc nie ma
  etapu dopasowywania nazw po stronie serwera i nie da się trafić w nieistniejącą kategorię.
- Przy ponad 120 kategoriach lista jest skracana: zostają wszystkie używane w ostatnich
  6 miesiącach plus wszystkie systemowe. Limit chroni przed rozdęciem promptu; przy
  normalnym użyciu nigdy nie jest osiągany.

**Podpowiedzi (`ai_hints`) są głównym pokrętłem jakości.** Użytkownik, który dopisze
„Stokrotka, Dino" do kategorii spożywczej, natychmiast poprawia trafność — i dlatego
pole to jest wyeksponowane w UI z wyjaśnieniem ([06 §3.10](./06-ui-views.md#311-kategorie--settingscategories)).

## 5. Schemat narzędzia — paragon

> **Od `F7-3` ([ADR-059](./14-decisions-log.md#adr-059)):** strukturę wymusza
> **structured outputs** (`output_config.format`, `json_schema`), nie narzędzie —
> `tool_choice` wymuszone zwraca `400` na nowszych modelach. Pola i opisy poniżej zostają;
> różnice: wszystkie pola wymagane (brak = `null`), `categoryId` to enum identyfikatorów
> z kontekstu, pozycja paragonu ma `direction` (reguła 6 promptu), obiekty mają
> `additionalProperties: false`. Kod: `apps/api/src/ai/schemas/extraction.ts`.

Struktura wymuszana przez `tool_choice: { type: 'tool', name: 'extract_receipt' }`.

```ts
/**
 * Schemat wejścia narzędzia odczytu paragonu.
 *
 * Wymuszenie narzędzia zamiast proszenia o JSON w tekście eliminuje całą klasę
 * problemów: bloki markdown wokół odpowiedzi, komentarze modelu przed JSON-em,
 * niedomknięte nawiasy przy długich paragonach.
 */
export const extractReceiptTool = {
  name: 'extract_receipt',
  description: 'Zapisuje dane odczytane z paragonu zakupowego.',
  input_schema: {
    type: 'object',
    required: ['merchant', 'bookedOn', 'totalMinor', 'currency', 'confidence', 'items'],
    properties: {
      merchant: {
        type: ['string', 'null'],
        description: 'Nazwa sklepu tak, jak na paragonie. null gdy nieczytelna.',
      },
      bookedOn: {
        type: ['string', 'null'],
        description: 'Data zakupu w formacie YYYY-MM-DD. null gdy nieczytelna.',
      },
      totalMinor: {
        type: ['integer', 'null'],
        description: 'Suma do zapłaty w GROSZACH (np. 127,99 zł = 12799).',
      },
      currency: { type: 'string', description: 'Kod ISO 4217, domyślnie PLN.' },
      confidence: {
        type: 'number',
        description: 'Pewność odczytu nagłówka, 0–1.',
      },
      items: {
        type: 'array',
        description: 'Pozycje z paragonu w kolejności występowania.',
        items: {
          type: 'object',
          required: ['description', 'amountMinor', 'confidence'],
          properties: {
            description: { type: 'string', description: 'Nazwa produktu z paragonu.' },
            quantity: { type: ['number', 'null'] },
            unitPriceMinor: { type: ['integer', 'null'] },
            amountMinor: { type: 'integer', description: 'Wartość pozycji w groszach.' },
            categoryId: {
              type: ['string', 'null'],
              description:
                'Identyfikator kategorii z listy DOSTĘPNE KATEGORIE. ' +
                'null tylko gdy żadna nie pasuje.',
            },
            suggestedCategoryName: {
              type: ['string', 'null'],
              description:
                'Propozycja nazwy NOWEJ kategorii — wyłącznie gdy categoryId jest null.',
            },
            confidence: { type: 'number', description: 'Pewność dopasowania kategorii, 0–1.' },
          },
        },
      },
      notes: {
        type: ['string', 'null'],
        description: 'Uwagi o odczycie, np. rozdarty paragon, nieczytelna sekcja.',
      },
    },
  },
} as const;
```

## 6. Schemat narzędzia — wyciąg bankowy

```ts
export const extractStatementTool = {
  name: 'extract_bank_statement',
  description: 'Zapisuje operacje odczytane z wyciągu bankowego.',
  input_schema: {
    type: 'object',
    required: ['operations', 'confidence'],
    properties: {
      accountHint: {
        type: ['string', 'null'],
        description: 'Numer lub nazwa konta z nagłówka wyciągu.',
      },
      periodFrom: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      periodTo: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      confidence: { type: 'number' },
      operations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['bookedOn', 'description', 'amountMinor', 'direction', 'confidence'],
          properties: {
            bookedOn: { type: 'string', description: 'Data operacji YYYY-MM-DD.' },
            description: { type: 'string', description: 'Tytuł/opis operacji.' },
            counterparty: { type: ['string', 'null'], description: 'Odbiorca lub nadawca.' },
            amountMinor: {
              type: 'integer',
              description: 'Kwota w groszach, zawsze DODATNIA. Kierunek w polu direction.',
            },
            direction: {
              type: 'string',
              enum: ['inflow', 'outflow'],
              description: 'inflow = uznanie, outflow = obciążenie.',
            },
            categoryId: { type: ['string', 'null'] },
            suggestedCategoryName: { type: ['string', 'null'] },
            confidence: { type: 'number' },
          },
        },
      },
    },
  },
} as const;
```

## 7. Prompt systemowy

```
Jesteś asystentem księgowym w aplikacji do budżetu domowego prowadzonego w Polsce.
Twoim zadaniem jest dokładne odczytanie załączonego dokumentu i przypisanie pozycji
do kategorii z podanej listy.

ZASADY ODCZYTU

1. Wszystkie kwoty podawaj w GROSZACH jako liczby całkowite.
   „127,99 zł" → 12799.  „1 234,00" → 123400.
2. Nie licz nic w pamięci. Przepisuj kwoty dokładnie tak, jak widnieją na dokumencie.
   Jeśli suma pozycji nie zgadza się z sumą na dokumencie, zostaw tę rozbieżność —
   zgłoś ją w polu `notes`. Nie „poprawiaj" pozycji, żeby się zgadzały.
3. Kwota zawsze dodatnia. Kierunek przepływu wyrażaj osobnym polem, nie znakiem minus.
4. Daty w formacie YYYY-MM-DD. Polski zapis 18.09.2026 to 2026-09-18.
   Nigdy nie interpretuj 03.04.2026 jako 3 kwietnia bez pewności — w razie wątpliwości
   kieruj się formatem dzień.miesiąc.rok, standardowym w polskich dokumentach.
5. Pomijaj wiersze, które nie są pozycjami: numer kasy, NIP, kod fiskalny, podziękowania,
   informacje o programie lojalnościowym, dane karty płatniczej.
6. Rabaty i kaucje ujmuj jako osobne pozycje ze stosownym znakiem kierunku.
7. Jeśli czegoś nie da się odczytać, wpisz null. NIE ZGADUJ.
   Zły odczyt kwoty jest znacznie gorszy niż brak odczytu.

ZASADY KATEGORYZACJI

8. Wybieraj `categoryId` WYŁĄCZNIE z listy DOSTĘPNE KATEGORIE. Nie wymyślaj identyfikatorów.
9. Korzystaj z podpowiedzi przy kategoriach — zawierają nazwy sklepów i typowe słowa.
10. Kontekst sklepu jest istotny: „baterie" w markecie spożywczym to zwykle zakupy
    codzienne, a w sklepie elektronicznym — elektronika.
11. Gdy żadna kategoria nie pasuje sensownie, ustaw categoryId na null i zaproponuj
    nazwę nowej w `suggestedCategoryName`. Rób to oszczędnie — użytkownik ma
    rozbudowaną listę i nowe kategorie powinny być wyjątkiem.
12. Pole `confidence` wypełniaj uczciwie. 0.95+ gdy dopasowanie jest oczywiste,
    0.5–0.7 gdy zgadujesz z kontekstu, poniżej 0.5 gdy naprawdę nie wiesz.
    Zaniżona pewność jest użyteczna — zawyżona jest szkodliwa.

Odpowiedz wyłącznie przez wywołanie narzędzia.
```

Punkty 2, 7 i 12 są celowo stanowcze: w narzędziu finansowym **cicha halucynacja
kwoty jest najkosztowniejszym możliwym błędem**. Wolimy pustą wartość i pytanie
do użytkownika niż prawdopodobnie poprawną liczbę.

## 8. Wywołanie modelu

```ts
/**
 * Interfejs ekstraktora dokumentów.
 *
 * Wydzielony, żeby podmiana dostawcy AI albo dołożenie trybu offline (tesseract)
 * wymagała jednej nowej implementacji, bez zmian w module `documents`.
 */
export interface DocumentExtractor {
  /**
   * Odczytuje dokument i zwraca propozycje pozycji.
   *
   * @param input - Obrazy, rodzaj dokumentu i kontekst kategorii.
   * @returns Odczytane dane wraz z informacją o zużyciu tokenów.
   * @throws {ExternalServiceError} Gdy usługa zwróci błąd lub odpowiedź nie przejdzie walidacji.
   */
  extract(input: ExtractInput): Promise<ExtractResult>;
}
```

Parametry wywołania:

| Parametr | Wartość | Uzasadnienie |
|---|---|---|
| `model` | `AI_MODEL` (domyślnie `claude-sonnet-5-5`, ADR-071) | Dobry odczyt obrazu przy rozsądnym koszcie |
| `max_tokens` | `AI_MAX_OUTPUT_TOKENS` (**16 000**) | Myślenie adaptacyjne liczy się do limitu; 4096 ucinało długie wyciągi (ADR-059) |
| `temperature` | **nie wysyłamy** | modele Sonnet 5 / 5.5 odrzucają niestandardowe parametry próbkowania (`400`) |
| `output_config.format` | `json_schema` z §5/§6 | Wymusza strukturę odpowiedzi bez narzędzia (ADR-059) |
| `timeout` | **120 s** | Wyciąg z kilkudziesięcioma operacjami potrafi przekroczyć 60 s |

Odmowa modelu (`stop_reason: refusal`) → `AI_REFUSED`; ucięta odpowiedź (`max_tokens`) →
`AI_OUTPUT_TRUNCATED` z komunikatem „Dokument jest za długi do odczytu naraz"; awaria
usługi po ponowieniach → `AI_UNAVAILABLE`.

Ponowienia: 2 próby przy `429` i `5xx`, opóźnienie wykładnicze (1 s, 4 s).
Błąd walidacji odpowiedzi **nie jest ponawiany** — zapisujemy surową odpowiedź
w `ai_raw_response` i oznaczamy dokument jako `failed` z kodem `AI_SCHEMA_MISMATCH`,
żeby dało się zdiagnozować przyczynę.

## 9. Kontrola kosztów

```ts
/**
 * Szacuje koszt wywołania na podstawie zużycia tokenów.
 *
 * Stawki są konfiguracją (mogą się zmienić), nie stałą w kodzie. Wynik służy do
 * pilnowania miesięcznego limitu i do pokazania zużycia w ustawieniach —
 * nie do rozliczeń.
 *
 * @param usage - Liczba tokenów wejściowych i wyjściowych.
 * @returns Szacowany koszt w groszach.
 */
export function estimateCostMinor(usage: TokenUsage): number;
```

- Stawki: `AI_INPUT_COST_MINOR_PER_MTOK` (800) i `AI_OUTPUT_COST_MINOR_PER_MTOK` (4000) —
  grosze za milion tokenów; koszt zaokrąglany w górę do grosza (ADR-059).
- Suma kosztów miesiąca w `app_meta` pod kluczem `ai_spend_<YYYY-MM>_minor` (miesiąc
  w strefie gospodarstwa); nieudany odczyt, na który usługa odpowiedziała, też się liczy.
- Przekroczenie `AI_MONTHLY_BUDGET_MINOR` → `402`-podobny błąd `AI_BUDGET_EXCEEDED`
  z komunikatem „Wyczerpano miesięczny limit OCR. Dodaj wydatek ręcznie albo
  zwiększ limit w ustawieniach.". Dokument zostaje wrzucony — da się go przeanalizować
  po zmianie limitu.
- `AI_ENABLED=false` wyłącza pipeline całkowicie; UI ukrywa zakładkę *Skan*.
- Limit żądań: 20 uploadów na godzinę na gospodarstwo.

Rząd wielkości: jeden paragon to ok. 1,5–2 tys. tokenów wejścia i ok. 500 wyjścia.
Przy kilkudziesięciu paragonach miesięcznie koszt pozostaje groszowy — limit jest
zabezpieczeniem przed pomyłką (np. pętlą ponowień), nie realnym ograniczeniem.

## 10. Wykrywanie duplikatów

Istotne przy wyciągach: operacje z wyciągu często są już wpisane ręcznie.

```ts
/**
 * Szuka istniejącej transakcji odpowiadającej odczytanej pozycji.
 *
 * Dopasowanie wymaga zgodności kwoty co do grosza oraz daty w oknie ±3 dni
 * (data księgowania w banku bywa inna niż data zakupu). Podobieństwo opisu jest
 * dodatkowym sygnałem, nie warunkiem — wyciągi mają inne opisy niż wpisy ręczne.
 *
 * @param item - Odczytana pozycja.
 * @param candidates - Transakcje z okolicy daty.
 * @returns Najlepsze dopasowanie albo null.
 */
export function findDuplicate(item: DocumentItem, candidates: Transaction[]): Transaction | null;
```

Od `F7-5` duplikaty sprawdzamy **tylko dla wyciągów** (ADR-059); jedna transakcja może być
duplikatem jednej pozycji. Warunki: `amountMinor` identyczne **i** `|bookedOn − candidate.bookedOn| <= 3 dni`
**i** to samo konto (gdy znane). Znalezione dopasowanie zapisujemy w
`duplicate_of_transaction_id`; UI oznacza pozycję plakietką **„Możliwy duplikat"**
i **domyślnie ją odznacza**. Decyzja należy do użytkownika — automatyczne pomijanie
ukryłoby realne, powtarzające się płatności o tej samej kwocie.

## 11. Commit

```ts
/**
 * Zatwierdza dokument, tworząc transakcje z zaakceptowanych pozycji.
 *
 * Wykonywane w jednej transakcji bazodanowej: albo powstaną wszystkie zapisy
 * (łącznie z nowymi kategoriami), albo żaden. Dokument zatwierdzony częściowo
 * byłby gorszy niż niezatwierdzony — użytkownik nie wiedziałby, co już jest w księdze.
 *
 * @param documentId - Identyfikator dokumentu w stanie `parsed`.
 * @param input - Tryb, konto, data i lista akceptowanych pozycji.
 * @returns Utworzone transakcje i zaktualizowany dokument.
 * @throws {ConflictError} Gdy dokument nie jest w stanie `parsed`.
 */
export function commitDocument(documentId: string, input: CommitDocumentInput): CommitResult;
```

Kolejność w transakcji bazodanowej:

1. Utwórz kategorie z `createCategories` (jeśli są) i podmień odwołania w pozycjach.
2. `mode = 'single'` → jedna transakcja na sumę zaakceptowanych pozycji, z kategorią
   z żądania, opisem = nazwa sprzedawcy; pozycje pozostają jako szczegół dokumentu.
3. `mode = 'split'` → osobna transakcja na każdą zaakceptowaną pozycję, każda ze swoją
   kategorią; opis = opis pozycji.
3a. `mode = 'by_category'` → jedna transakcja wydatku na grupę pozycji o tej samej
   kategorii (07 §9.4); opis = sprzedawca, notatka = opisy pozycji grupy
   ([ADR-069](./14-decisions-log.md#adr-069)).
4. Ustaw `document_items.transaction_id` i `review_status = 'accepted'`;
   pozycje spoza `itemIds` → `rejected`.
5. `documents.status = 'committed'`.

Transakcje dostają `source = 'ocr'` i `source_document_id`, dzięki czemu na liście widać
plakietkę `📷`, a z transakcji da się wrócić do oryginalnego zdjęcia.

**Tryb domyślny to `single`** — przy zakupach spożywczych podział na 30 pozycji
zaśmieciłby historię, a wartość informacyjna jest znikoma. `split` ma sens przy wyciągu.
Paragon mieszany (spożywcze + chemia w jednym markecie) otwiera się w trybie
`by_category` — dwie transakcje zamiast jednej źle skategoryzowanej albo trzydziestu
(ADR-069).

## 12. Przechowywanie plików

```
UPLOAD_DIR/
  2026/
    09/
      01JP7K3M2N8Q4R5S6T7V8W9X.jpg          # oryginał (po usunięciu EXIF)
      01JP7K3M2N8Q4R5S6T7V8W9X.thumb.jpg    # miniatura 320 px
```

- Nazwa pliku = identyfikator dokumentu; katalog = rok/miesiąc wrzucenia.
- Oryginały zostają **bezterminowo** — możliwość wglądu w paragon sprzed roku to
  realna wartość przy reklamacji czy rozliczeniu gwarancji.
- Dostęp do pliku wyłącznie przez uwierzytelniony `GET /documents/:id/file`.
  **Nigdy** przez `@fastify/static` — katalog uploadów nie jest publicznie serwowany.
- Usunięcie dokumentu kasuje plik i miniaturę.
- Uploady wchodzą do kopii zapasowej wolumenu (patrz [10](./10-deployment.md#5-kopie-zapasowe)).

## 13. Prywatność

Do Anthropic trafia **wyłącznie obraz dokumentu i lista nazw kategorii**. Nie wysyłamy:
sald kont, historii transakcji, celów, danych użytkowników ani nazwy gospodarstwa.

Metadane EXIF (w tym współrzędne GPS zdjęcia zrobionego w sklepie) są usuwane przed
wysłaniem — to nie jest szczegół implementacyjny, tylko wymóg.

Wysyłka następuje **tylko** po jawnym wrzuceniu pliku przez użytkownika. Aplikacja
nie wykonuje żadnych wywołań do usług zewnętrznych w tle.

## 14. Obsługa błędów

| Sytuacja | Kod | Komunikat dla użytkownika |
|---|---|---|
| Plik > 10 MB | `FILE_TOO_LARGE` | „Plik jest za duży (max 10 MB). Zrób zdjęcie w niższej jakości." |
| Nieobsługiwany typ | `UNSUPPORTED_MEDIA_TYPE` | „Obsługujemy zdjęcia (JPG, PNG, WebP, HEIC) i PDF." |
| Ten sam plik już wrzucony | `CONFLICT` | „Ten dokument już jest w systemie." + odnośnik |
| Brak klucza API | `EXTERNAL_SERVICE_ERROR` | „Odczyt dokumentów jest wyłączony. Dodaj wydatek ręcznie." |
| Timeout / 5xx po ponowieniach | `EXTERNAL_SERVICE_ERROR` | „Nie udało się odczytać dokumentu. Spróbuj ponownie." |
| Odpowiedź niezgodna ze schematem | `EXTERNAL_SERVICE_ERROR` (`AI_SCHEMA_MISMATCH`) | jak wyżej + log z surową odpowiedzią |
| Przekroczony limit kosztów | `AI_BUDGET_EXCEEDED` | „Wyczerpano miesięczny limit OCR." |
| Zero odczytanych pozycji | — (status `parsed`) | „Nie rozpoznano pozycji. Wpisz kwotę ręcznie." + formularz z podglądem zdjęcia |

Ostatni przypadek jest istotny dla UX: nieudany odczyt **nie może być ślepym zaułkiem**.
Użytkownik trafia do zwykłego formularza wydatku z podglądem zdjęcia obok, więc może
przepisać kwotę i nie stracić wrzuconego paragonu.

## 15. Ocena jakości

Implementacja tego modułu musi zebrać **20 rzeczywistych paragonów**
(różne sieci, różny stan zachowania) jako zestaw testowy w `apps/api/test/fixtures/receipts/`
(pliki nie trafiają do repozytorium — `.gitignore`).

Mierzone wskaźniki:

| Wskaźnik | Cel |
|---|---|
| Trafność odczytu sumy | ≥ 95% |
| Trafność odczytu daty | ≥ 90% |
| Trafność kategorii (pozycje z `confidence ≥ 0.8`) | ≥ 85% |
| Odsetek pozycji wymagających ręcznej korekty | ≤ 20% |

Wskaźniki poniżej celu oznaczają pracę nad promptem i podpowiedziami kategorii,
nie zmianę modelu. Wyniki zapisujemy w [13-progress.md](./13-progress.md).

**Narzędzie (`F7-11`):** `pnpm --filter @fineapp/api ocr:evaluate [katalog]`. Obok każdego
zdjęcia `nazwa.expected.json`: `{ "totalMinor", "bookedOn", "items": [{ "amountMinor",
"category": "<slug>" }] }`. Skrypt zakłada bazę w pamięci z kategoriami domyślnymi, woła
prawdziwą usługę (koszt!) i wypisuje tabelę czterech wskaźników do wklejenia w 13.
Pozycje paruje kwota co do grosza; rabaty (`inflow`) nie są oceniane.
