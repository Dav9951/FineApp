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
**każdy** dokument w tym stanie jest oznaczany jako `failed` (zadania żyją w pamięci, więc
po restarcie żadne nie dobiegnie końca; [ADR-103](./14-decisions-log.md#adr-103))
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
| `model` | z ustawień gospodarstwa (`households.ai_model`: Haiku 5.5 / Sonnet 5.5), a bez wyboru `AI_MODEL` (domyślnie `claude-haiku-5-5`) — [ADR-085](./14-decisions-log.md#adr-085) | Haiku czyta typowy paragon ~20× taniej; Sonnet zostaje jednym kliknięciem na trudniejsze dokumenty |
| `max_tokens` | `AI_MAX_OUTPUT_TOKENS` (**16 000**) | Myślenie adaptacyjne liczy się do limitu; 4096 ucinało długie wyciągi (ADR-059) |
| `temperature` | **nie wysyłamy** | Sonnet 5 / 5.5 i Haiku 5.5 odrzucają niestandardowe parametry próbkowania (`400`) |
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

- Stawki: każdy model z katalogu `AI_MODELS` ma własne (Haiku 5.5: 40 / 200, Sonnet 5.5:
  800 / 4000 groszy za milion tokenów wejścia / wyjścia, kurs z zapasem ~4 zł/$);
  `AI_INPUT_COST_MINOR_PER_MTOK` i `AI_OUTPUT_COST_MINOR_PER_MTOK` obowiązują tylko model
  spoza katalogu ustawiony zmienną `AI_MODEL` (ADR-085). Koszt zaokrąglany w górę do
  grosza (ADR-059); liczony stawkami modelu, którym naprawdę czytano.
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

Do Anthropic trafia **wyłącznie obraz dokumentu i lista nazw kategorii** (listy zakupów: §17.5). Nie wysyłamy:
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

Nieudany odczyt, odczyt bez pozycji i odrzucony plik (poza duplikatem i wyłączonym OCR) zostawiają wpis w dzienniku odczytu (§16) z przyczyną techniczną.
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

## 16. Dziennik odczytu

> **Poza roadmapą** ([ADR-086](./14-decisions-log.md#adr-086)). Tabela `document_logs`
> (03 §3.22), `GET /documents/log` (04 §13), widok w Ustawieniach i na ekranie
> nieudanego dokumentu (06 §3.12, §3.4).

Każda analiza zostawia wpisy — po to, żeby przyczynę nieudanego odczytu dało się
odczytać w aplikacji, a nie zgadywać z „Spróbuj ponownie":

| Etap (`event`) | Waga | Szczegóły (`details`) |
|---|---|---|
| `started` | info | `model`, `kind`, `mimeType`, `byteSize`, `pageCount` |
| `prepared` | info; **warn**, gdy krótszy bok obrazu po skalowaniu < 500 px (`NARROW_IMAGE_PX`) | `sourceWidth`, `sourceHeight`, `width`, `height`, `sentKb`, `categoryCount` |
| `parsed` | info; **warn** przy zerze pozycji | `durationMs`, `stopReason`, `inputTokens`, `outputTokens`, `maxOutputTokens`, `itemCount`, `costMinor`, `requestId` |
| `failed` | error | Analiza przerwana restartem (oznaczana przy starcie): `errorCode: INTERRUPTED`. Pozostałe: `errorCode`, `durationMs`, `httpStatus`, `errorType` (np. `APIConnectionTimeoutError`), `apiMessage` (≤ 300 znaków), `timeoutMs`, `maxRetries`, `stopReason`, `reason` (schemat), `costMinor` |
| `upload_rejected` | warn | `errorCode` (`FILE_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `DOMAIN_RULE_VIOLATION` — tylko PDF ponad limit stron, `AI_BUDGET_EXCEEDED` — przy wrzuceniu i przy ponownej analizie), `maxBytes`, `maxPages`, `budgetMinor` |

Zasady:

- **Bez treści dokumentu.** Kwoty, sprzedawca i surowa odpowiedź zostają w `documents`;
  dziennik ma liczby i kody. Komunikat błędu usługi to typ i opis błędu API — bez
  danych finansowych i bez klucza.
- **Dziennik nie psuje analizy.** Błąd zapisu wpisu ląduje w logu procesu, odczyt idzie
  dalej.
- Błąd przed wywołaniem albo przy zapisie wyniku (plik, `sharp`, baza) → `failed`
  z `INTERNAL_ERROR` i klasą błędu.
- Duplikat pliku i wyłączone OCR nie trafiają do dziennika — ich komunikat na ekranie
  jest wystarczający.
- Wpisy żyją 90 dni; stare usuwa początek każdej analizy.
- Wymiary oryginału (`sourceWidth`, `sourceHeight`) uwzględniają orientację EXIF —
  orientacje 5–8 zamieniają boki.

Typowe odczyty dziennika: `AI_UNAVAILABLE` z `errorType: APIConnectionTimeoutError`
i `durationMs` ≈ 3 × 120 s — model nie zdążył (długi paragon, dużo myślenia);
`AI_OUTPUT_TRUNCATED` z `outputTokens` = `maxOutputTokens` — odpowiedź się nie zmieściła;
`prepared` z ostrzeżeniem o wąskim obrazie — paragon za długi na jedno zdjęcie.

## 17. Listy zakupów: zdjęcie listy i przepis

> **Faza 10 — plan** ([ADR-094](./14-decisions-log.md#adr-094),
> [ADR-095](./14-decisions-log.md#adr-095)). Tabele: 03 §3.26–3.27, endpointy: 04 §14b,
> reguły: 07 §14. Opis funkcji: [17](./17-shopping-lists.md).

Zasada z §1 obowiązuje bez zmian: **AI proponuje, człowiek zatwierdza**. Propozycje żyją
w `shopping_import_items`, na listę trafiają wyłącznie przez commit (I-30).

### 17.1 Co dzielimy z dokumentami, a co nie

| Wspólne z §2–§9 | Inne |
|---|---|
| `prepareForVision` (obrót, EXIF, 1568 px, JPEG q80), skalowanie i HEIC w przeglądarce | osobne tabele; brak SHA-256 i wykrywania ponownego wrzucenia |
| model z `households.ai_model` / `AI_MODEL`, structured outputs (`output_config.format`), `max_tokens`, timeout, ponowienia | do 3 obrazów na import (przepis na kilku ekranach) |
| licznik `ai_spend_<YYYY-MM>_minor`, `AI_MONTHLY_BUDGET_MINOR`, `AI_ENABLED`; limit 20 / godz. z osobnym licznikiem (ADR-101) | pliki w `UPLOAD_DIR/shopping/YYYY/MM/`, usuwane po commit / discard, najpóźniej po 7 dniach (I-31) |
| praca w tle, **każdy** `processing` → `failed` (`INTERRUPTED`) przy starcie — zadania żyją w pamięci (ADR-102) | wejście tekstowe (link, wklejony tekst) bez obrazu |
| błędy `AI_REFUSED`, `AI_OUTPUT_TRUNCATED`, `AI_UNAVAILABLE`, `AI_SCHEMA_MISMATCH` | — |
| **dziennik odczytu** (`document_logs`, §16) ze `source: 'shopping'` i **zużycie w Ustawieniach** (liczba odczytów, tokeny) — ADR-107 | etapy: `started` (`model`, `kind`, `input`, `imageCount`, `textChars` — `null` przy linku przed pobraniem, `servingsFactorBps`), `parsed` (diagnostyka jak §16, `inputTokens`, `outputTokens`, `itemCount`, `costMinor`), `failed` (`errorCode` — także `RECIPE_FETCH_*` z `host` i przyczyną, `RECIPE_NOT_FOUND`, `INTERRUPTED`), `upload_rejected` (`AI_BUDGET_EXCEEDED`, jak przy dokumentach); zużycie sumuje się po ponowieniach; bez treści listy, przepisu i pełnego adresu |

Ekstraktor to druga metoda obok `DocumentExtractor`: `ShoppingExtractor` z `extractList`
i `extractRecipe` w `apps/api/src/ai/`, prompty w `ai/prompts/shopping-*.ts`, schematy
w `ai/schemas/shopping.ts`. Moduł `shopping` woła go przez interfejs, jak `documents`.

### 17.2 Schematy odpowiedzi

Wszystkie pola wymagane (brak = `null`), `additionalProperties: false`, `section` to enum
`ShoppingSectionSchema` (05 §2). Liczby od modelu to liczby dziesiętne w jednostce
naturalnej; **serwer** przelicza je na tysięczne (`Math.round(x × 1000)` na wejściu jest
jedynym miejscem z ułamkiem i ma test), odrzuca ujemne i zerowe.

```ts
/** Zdjęcie listy (tablica, kartka). */
extract_shopping_list = {
  items: [{
    name: string,              // forma, w jakiej się kupuje: „Jajka", „Jogurt naturalny"
    sourceText: string,        // dokładnie to, co odczytano: „jogurt nat. x2"
    quantity: number | null,   // 2 — tylko gdy napisane na kartce
    unit: 'pcs' | 'pack' | 'kg' | 'g' | 'l' | 'ml' | null,
    section: ShoppingSection,
    confidence: number,        // 0–1
  }],
  notes: string | null,
}

/** Przepis (obrazy, tekst wklejony albo pobrany). */
extract_recipe_ingredients = {
  title: string | null,
  baseServings: integer | null,
  ingredients: [{
    name: string,              // „Czekolada gorzka"
    sourceText: string,        // „100 g gorzkiej czekolady"
    amount: number | null,     // ilość BAZOWA z przepisu w `unit`; null = do smaku / szczypta
    unit: 'g' | 'ml' | 'pcs' | null,
    packageAmount: number | null,  // typowe opakowanie w Polsce, w tej samej jednostce
    packageLabel: string | null,   // „tabliczka", „kostka", „opak. 10 szt."
    pantryStaple: boolean,         // rzecz, którą prawie każdy dom ma: sól, pieprz, woda, olej
    section: ShoppingSection,
    confidence: number,
  }],
  notes: string | null,
}
```

`confidence` → `confidence_bps = round(confidence × 10 000)`; `< 6000` daje w przeglądzie
plakietkę „Sprawdź" i tekst źródłowy pod nazwą.

### 17.3 Prompty

Wspólny wstęp: „Jesteś asystentem w aplikacji listy zakupów gospodarstwa domowego
w Polsce. Odpowiadasz wyłącznie w podanym formacie." Dalej:

**Zdjęcie listy**

1. Przepisz pozycje listy zakupów z obrazu. Pomiń pozycje **skreślone, przekreślone,
   odhaczone** albo wyraźnie oznaczone jako kupione — to rzeczy już załatwione.
2. Jedna pozycja = jeden produkt. „masło i jajka" to dwie pozycje.
3. Nazwa w formie, w jakiej produkt się kupuje, z wielkiej litery, bez marki, chyba że
   marka jest napisana wprost.
4. Ilość tylko wtedy, gdy jest na kartce. Nie wymyślaj ilości.
5. Słowa nieczytelne: podaj najlepszy odczyt, niską pewność i dokładny tekst
   w `sourceText`. Nie pomijaj pozycji tylko dlatego, że jest niewyraźna.
6. Pomijaj wszystko, co nie jest listą zakupów (magnesy, kartki z innymi notatkami,
   kalendarz) — jeśli na zdjęciu nie ma listy, zwróć pustą `items` i powód w `notes`.
7. Dział wybierz z podanej listy działów.

**Przepis**

1. Wypisz składniki potrzebne do przepisu. Pomiń kroki przygotowania, wartości odżywcze,
   reklamy i komentarze.
2. `amount` i `unit` to ilość **z przepisu, bez mnożenia i bez zaokrąglania**.
   Przelicz łyżki, łyżeczki i szklanki na g albo ml dla danego produktu
   (łyżka mąki ≈ 10 g, łyżka oleju ≈ 15 ml, szklanka mleka = 250 ml).
   Sztuki („3 jajka", „2 cebule") w `pcs`.
3. „do smaku", „szczypta", „opcjonalnie" → `amount: null`.
4. `packageAmount` i `packageLabel`: najczęstsze opakowanie w polskim sklepie, w tej samej
   jednostce (czekolada 100 g, masło 200 g, jajka 10 szt., mleko 1000 ml, mąka 1000 g).
   Gdy produkt sprzedaje się na sztuki lub na wagę bez opakowania (cebula, pomidory), daj
   `null`.
5. Ten sam produkt w kilku miejscach przepisu (ciasto i polewa) połącz w jedną pozycję
   z sumą ilości i oba fragmenty w `sourceText`.
6. `pantryStaple: true` tylko dla rzeczy, które ma prawie każdy dom; lista produktów
   „zawsze w domu" tego gospodarstwa jest w kontekście — nie musisz jej powtarzać,
   oceniasz resztę.
7. `baseServings` — liczba porcji z przepisu (z „na 4 osoby", „12 kawałków"); brak → `null`.
8. Jeśli to nie jest przepis, zwróć pustą `ingredients` i powód w `notes`
   (→ `RECIPE_NOT_FOUND`).

**Kontekst** (po stałym prompcie, żeby stały prefiks dało się buforować): nazwy działów
z opisem i lista nazw produktów „zawsze w domu". Nic więcej.

### 17.4 Pobranie przepisu z linku

`fetchRecipeSource(url)` w `apps/api/src/core/safe-fetch.ts` (pierwszy wychodzący
`fetch` aplikacji poza Anthropic; ochrona: [09 §7a](./09-security-auth.md#7a-pobieranie-adresów-podanych-przez-użytkownika)):

1. Pobierz stronę (10 s, 3 MB, `text/html`, max 3 przekierowania).
2. Szukaj `<script type="application/ld+json">` z `@type` `Recipe` (także w `@graph`
   i w tablicy typów). Jest → do modelu idzie tekst złożony z `name`, `recipeYield`
   i `recipeIngredient[]` — zwykle kilkaset tokenów.
3. Nie ma → widoczny tekst strony (bez `script`, `style`, `nav`, `header`, `footer`,
   `aside`), białe znaki zwinięte, ucięty do 30 000 znaków.
4. Tekst trafia do `shopping_imports.source_text` (diagnoza, ponowienie bez ponownego
   pobierania).

Odrzucone: narzędzie `web_fetch` po stronie Anthropic (ADR-095).

### 17.5 Prywatność

Do Anthropic trafia: obraz listy albo przepisu (bez EXIF), tekst przepisu (wklejony
albo pobrany) oraz nazwy działów i produktów „zawsze w domu". **Nie** trafiają: nazwy
list, inne pozycje list, dane domowników, nic finansowego. Adres przepisu wychodzi tylko
do serwisu z przepisem (pobranie przez nasz serwer). Uzupełnia §13.

### 17.6 Ocena jakości (`F10-10`)

Zestaw: 10 zdjęć tablicy / kartki (różne charaktery pisma, skreślenia) i 10 przepisów
(5 linków z JSON-LD, 2 bez, 3 zrzuty ekranu), pliki poza repozytorium jak w §15. Narzędzie
`shopping:evaluate` obok `ocr:evaluate`; `nazwa.expected.json` z oczekiwanymi nazwami
(po normalizacji), ilościami i — dla przepisów — liczbą opakowań przy ×1.

| Wskaźnik | Cel |
|---|---|
| Zdjęcie: odczytane pozycje (trafione / oczekiwane) | ≥ 90% |
| Zdjęcie: skreślone pominięte | 100% |
| Przepis: składniki znalezione | ≥ 95% |
| Przepis: liczba opakowań zgodna przy ×1 | ≥ 85% |
| Przepis: „Już mam" bez fałszywego „mam" dla produktu spoza słownika | ≥ 90% |
