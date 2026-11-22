# 17 — Listy zakupów

> **Stan:** plan do potwierdzenia przez właściciela — **Faza 10**, [11-roadmap.md](./11-roadmap.md).
> Decyzje: [ADR-093](./14-decisions-log.md#adr-093) … [ADR-096](./14-decisions-log.md#adr-096)
> (status: *proponowana*). Wymaganie **#15** w [00 §4](./00-project-overview.md#4-zakres--mapowanie-wymagań).

Ten dokument opisuje funkcję w całości: po co jest, jak się z niej korzysta i jak łączy się
z resztą aplikacji. Jak przy planerze budżetu ([16](./16-budget-planner.md)), szczegóły
kontraktowe trafią do dokumentów 03–07 w zadaniu `F10-1`, **po** rozstrzygnięciu pytań
z §9. Do tego czasu kontraktem jest szkic w §6–§7 poniżej.

| Co | Gdzie (po `F10-1`) |
|---|---|
| tabele `shopping_lists`, `shopping_items`, `shopping_products`, `shopping_imports`, `shopping_import_items`, niezmienniki I-26…I-31 | 03 §3.23–3.27 |
| endpointy `/api/v1/shopping-lists`, `/api/v1/shopping-imports`, `/api/v1/shopping-products` | 04 §14b |
| DTO `dto/shopping.ts` | 05 §13c |
| ekrany `/shopping`, `/shopping/:listId`, `/shopping/:listId/import/:importId` | 06 §3.15 |
| normalizacja nazw, scalanie, przeliczanie opakowań, szybkie dopisywanie, czyszczenie | 07 §14 |
| odczyt zdjęcia listy i przepisu przez AI | 08 §17 |

---

## 1. Po co

Dziś lista zakupów żyje na tablicy na lodówce, w głowie i w trzech komunikatorach. W sklepie
trzeba zrobić zdjęcie tablicy, a i tak nie da się odhaczyć tego, co już leży w koszyku.
Gotowanie z przepisu kończy się przepisywaniem składników i zgadywaniem, czego brakuje.

Lista zakupów w FineApp to:

1. **jedna żywa lista na co dzień** („Spożywcze" albo „Zakupy — dom, chemia"), którą oboje
   uzupełniają na bieżąco i której nigdy się nie zamyka,
2. **listy okazjonalne** („Decathlon", „Urodziny Zosi"), które powstają na jedną okazję
   i po niej idą do archiwum,
3. **odhaczanie w sklepie** jednym dotknięciem, także przy słabym zasięgu,
4. **„Wyczyść kupione"**: kupione znikają, niekupione zostają na następny raz,
5. **dopisywanie ze zdjęcia** (tablica na lodówce, kartka) i **z przepisu** (zrzut ekranu,
   link, wklejony tekst) z mnożnikiem porcji. AI proponuje pozycje, człowiek je poprawia
   i zatwierdza.

**Bez kwot.** Lista nie zna cen, nie tworzy transakcji i nie wpływa na budżet. Jedyny
pomost do finansów to skrót „Zeskanuj paragon” po zakupach (§5.6), który prowadzi
do istniejącego ekranu *Skan*.

## 2. Pojęcia

| Pojęcie | Znaczenie |
|---|---|
| **Lista** (`shopping_lists`) | Nazwana lista gospodarstwa, wspólna dla obu domowników. Jedna jest **domyślna**: do niej trafia szybkie dopisanie z FAB i z udostępnienia. |
| **Pozycja** (`shopping_items`) | Produkt na liście: nazwa, opcjonalnie ilość z jednostką, notatka i dział sklepu. Stan: *do kupienia* albo *kupione*. |
| **Kupione** | Pozycja odhaczona (`checked_at`). Zostaje na liście (przekreślona, na dole) do czasu „Wyczyść kupione". |
| **Wyczyść kupione** | Usuwa z listy wszystkie kupione pozycje. Niekupione zostają. Można to cofnąć przez kilka sekund. |
| **Dział** (`section`) | Część sklepu: warzywa i owoce, pieczywo, nabiał, mięso i ryby, suche i sypkie, mrożonki, napoje, chemia, higiena, dom, inne. Lista w sklepie jest posortowana według działów. Zbiór działów jest stały (stała w `shared/constants`). |
| **Produkt** (`shopping_products`) | Wpis w słowniku gospodarstwa: nazwa, dział, flaga „zawsze w domu", licznik użyć. Słownik zasila podpowiedzi przy dopisywaniu i pamięta dział. Powstaje sam, gdy coś trafia na listę. |
| **Zawsze w domu** (`is_staple`) | Produkt podstawowy (mąka, cukier, sól, olej, mleko…). Przy imporcie z przepisu domyślnie trafia do „Już mam". |
| **Import** (`shopping_imports`) | Jeden odczyt przez AI: zdjęcie listy, zrzut przepisu, link do przepisu albo wklejony tekst. Ma stan (`processing` → `parsed` → `committed` / `discarded` / `failed`) i propozycje. |
| **Propozycja** (`shopping_import_items`) | Pozycja odczytana przez AI, czekająca na przegląd. Do momentu zatwierdzenia **nic nie trafia na listę** (zasada z 08 §1: AI proponuje, człowiek zatwierdza). |
| **Mnożnik porcji** (`servingsFactorBps`) | Ile przepisu robimy: ×0,5 / ×0,75 / ×1 / ×1,5 / ×2 albo dowolny w zakresie ×0,25…×4. Zapisany w bps (×1 = 10 000), zgodnie z twardą zasadą 2. |
| **Opakowanie** | Jednostka zakupu: „czekolada 50 g" z przepisu to „Czekolada — 1 szt." na liście. Liczbę opakowań wylicza **serwer**, nie model (§4.3). |

**Ilość jest opcjonalna** i nie jest kwotą. Zapisujemy ją jako liczbę całkowitą w tysięcznych
częściach jednostki (`quantityMilli`: 1,5 kg = 1500, 2 szt. = 2000) z jednostką
`szt | opak | kg | g | l | ml`. Bez liczb zmiennoprzecinkowych w bazie, z tego samego
powodu co przy groszach ([ADR-093](./14-decisions-log.md#adr-093)).

## 3. Scenariusze

### 3.1 Na co dzień: jedna lista, którą uzupełniamy

1. Kończy się masło. *Więcej → Zakupy* (albo skrót z ikony aplikacji, §5.1) otwiera listę
   domyślną „Spożywcze". Pole „Dodaj produkt…" jest **na dole ekranu**, w zasięgu kciuka.
2. Wpisuję „mas", podpowiedź „Masło · Nabiał" (ze słownika), Enter. Pozycja trafia do działu
   *Nabiał*, a pole zostaje aktywne na następną.
3. „2 mleko" → „Mleko · 2 szt.". „mąka 1kg" → „Mąka · 1 kg". Ilość jest rozpoznawana
   z początku albo końca wpisu (07 §14.4). Jeśli jej nie ma, to nie ma: „Chleb".
4. Druga osoba widzi nowe pozycje po kilkunastu sekundach albo od razu po wejściu na ekran.

### 3.2 W sklepie

1. Otwieram listę. Pozycje są pogrupowane według działów w kolejności przejścia przez sklep.
   Kupione spadają na dół do zwiniętej sekcji „Kupione (4)".
2. Dotknięcie wiersza (cały wiersz, nie tylko pole wyboru, ≥ 44 px) odhacza pozycję. Na dole
   pojawia się „Odhaczono Masło · Cofnij".
3. W piwnicy marketu nie ma zasięgu: odhaczenia działają dalej, pasek u góry mówi
   „Brak połączenia — odhaczenia wyślę, gdy wróci sieć" ([ADR-096](./14-decisions-log.md#adr-096)).
4. Opcjonalnie „Nie wygaszaj ekranu" w menu listy (Wake Lock API, tylko gdy przeglądarka
   go wspiera).
5. Przy kasie: *Wyczyść kupione (12)* → kupione znikają, „Wyczyszczono 12 · Cofnij".
   Zostają trzy pozycje, których nie było. Lista żyje dalej.
6. Po wyczyszczeniu: „Zeskanuj paragon?" (raz, do zamknięcia). Prowadzi do *Skanu*.

### 3.3 Lista okazjonalna: Decathlon

1. *Zakupy → + Nowa lista* → „Decathlon". Dopisuję pięć rzeczy z notatkami
   („buty do biegania — rozm. 43").
2. Po zakupach *Wyczyść kupione* zostawia pustą listę i proponuje: „Lista jest pusta.
   Zarchiwizować?". Archiwum da się otworzyć i przywrócić listę, np. przed następnym
   wyjazdem. *Duplikuj listę* robi z niej szablon (wszystkie pozycje jako do kupienia).

### 3.4 Zdjęcie tablicy z lodówki

1. Na liście „Spożywcze" *+ → Ze zdjęcia*. Aparat albo galeria. Zdjęcie jest skalowane
   w przeglądarce jak paragon (08 §3), a serwer usuwa EXIF.
2. „Czytam listę…" (zwykle kilka sekund). Ekran można zamknąć, bo import żyje na serwerze
   i wraca na liście jako „Odczyt gotowy do przejrzenia".
3. Przegląd: każda propozycja ma pole wyboru (domyślnie zaznaczone), nazwę, ilość i dział,
   wszystko do poprawienia w miejscu. Pozycje niepewne (`confidence < 0.6`) mają plakietkę
   „Sprawdź" i pokazują pod spodem odczytany tekst („mlko?"). Pozycje **skreślone na
   tablicy** model pomija (reguła promptu, 08 §17).
4. Propozycja, która **już jest na liście** jako do kupienia, ma oznaczenie
   „Już na liście (1 szt.)" i jest scalana zamiast dublowana (07 §14.3).
5. *Dodaj 9 pozycji* → pozycje trafiają na listę, import przechodzi w `committed`,
   zdjęcie jest usuwane z dysku.

### 3.5 Przepis: brownie na pół blachy

1. *+ → Z przepisu*. Trzy drogi w jednym arkuszu: **Zrzut ekranu** (do 3 obrazów, bo przepis
   często nie mieści się na jednym ekranie), **Link** i **Wklej tekst**. Do tego mnożnik:
   `×0,5 · ×0,75 · ×1 · ×1,5 · ×2 · inny`.
2. Wybieram link i ×0,5. Serwer pobiera stronę. Jeśli ma ona dane strukturalne przepisu
   (`schema.org/Recipe` w JSON-LD, co ma większość serwisów kulinarnych), do AI idzie sama
   lista składników i liczba porcji. Jeśli nie ma, idzie oczyszczony tekst strony (§4.2).
3. Przegląd ma dwie sekcje:

   ```
   Brownie · przepis na 12 porcji · ×0,5 = 6 porcji      [ ×0,5 ▾ ]

   DO KUPIENIA (3)
   ☑ Czekolada gorzka      2 szt.    potrzeba 100 g · tabliczka 100 g
   ☑ Masło                 1 szt.    potrzeba 125 g · kostka 200 g
   ☑ Orzechy włoskie       1 opak.   potrzeba 50 g · opak. 100 g

   JUŻ MAM (4)                                        ← domyślnie odznaczone
   ☐ Mąka pszenna          · zawsze w domu
   ☐ Cukier                · zawsze w domu
   ☐ Jajka                 1 opak.   potrzeba 2 szt.
   ☐ Kakao                 1 szt.    · zawsze w domu
   ```

4. Zmiana mnożnika na ×1 **przelicza ilości natychmiast, bez ponownego wywołania AI**:
   model zwraca ilości bazowe przepisu i typowe opakowanie, a opakowania liczy wspólna
   funkcja `shared/domain/shopping.ts` (07 §14.2). Ilości poprawione ręcznie nie są
   nadpisywane przez zmianę mnożnika.
5. Przesuwam „Jajka" do „Do kupienia" (dotknięcie pola wyboru przenosi wiersz między
   sekcjami). Przy „Kakao" wybieram *Nie zawsze mam* → produkt traci flagę i trafia
   do „Do kupienia". Przy „Orzechach" mogę wybrać *Zawsze mam* na przyszłość.
6. *Dodaj 4 pozycje do „Spożywcze"* (listę docelową da się zmienić w nagłówku przeglądu).
   Pozycje dostają notatkę „Brownie" (nazwa przepisu), żeby w sklepie było wiadomo, po co
   są orzechy.

### 3.6 Udostępnienie linku z przeglądarki (Android)

Aplikacja zainstalowana jako PWA rejestruje się jako cel udostępniania (`share_target`
w manifeście). „Udostępnij → FineApp" na stronie przepisu otwiera arkusz „Z przepisu"
z wpisanym linkiem. Na iOS Safari tego nie obsługuje, więc zostaje wklejenie linku.

## 4. AI: jak czytamy zdjęcia i przepisy

Pipeline jest **bratem** pipeline'u dokumentów (08), a nie jego częścią
([ADR-094](./14-decisions-log.md#adr-094)). Wspólne: `prepareForVision` (skalowanie, EXIF),
model z ustawień gospodarstwa (`households.ai_model`), structured outputs
(`output_config.format`), **wspólny miesięczny limit kosztów** (`ai_spend_<YYYY-MM>_minor`)
i limit 20 odczytów na godzinę, praca w tle z oznaczaniem przerwanych jako `failed` przy
starcie. Inne: osobne tabele (import nie jest dokumentem finansowym, nie ma SHA-256, nie
tworzy transakcji) i plik **usuwany po zatwierdzeniu albo odrzuceniu** (najpóźniej po 7
dniach), bo tablica z lodówki nie jest dowodem zakupu.

### 4.1 Zdjęcie listy

Schemat odpowiedzi (`extract_shopping_list`), wszystkie pola wymagane, brak = `null`:

```ts
{
  items: Array<{
    name: string;                 // „Mleko" — forma mianownika, z wielkiej litery
    sourceText: string;           // dokładnie to, co odczytano („mlko 2x")
    quantity: number | null;      // 2 — liczba z kartki, null gdy brak
    unit: 'szt' | 'opak' | 'kg' | 'g' | 'l' | 'ml' | null;
    section: ShoppingSection;     // enum działów
    confidence: number;           // 0–1
  }>;
  notes: string | null;           // „część tablicy nieczytelna"
}
```

Reguły promptu (szczegóły w 08 §17): pomijaj pozycje skreślone i odhaczone na kartce; nie
zgaduj nieczytelnych słów, tylko daj niską pewność i tekst źródłowy; nie dziel „masło
i jajka" na jedną pozycję; podawaj nazwę ogólną („Jogurt naturalny"), bez marek, chyba że
marka jest napisana wprost.

### 4.2 Przepis

Wejście to obrazy, tekst wklejony albo tekst pobrany z linku. Serwer pobiera link sam
(`fetchRecipeSource`), z ochroną przed SSRF ([ADR-095](./14-decisions-log.md#adr-095)):

- tylko `http`/`https` na portach 80/443; adres po rozwiązaniu DNS nie może być prywatny,
  pętlą zwrotną, link-local ani ULA (IPv4 i IPv6); każde przekierowanie (max 3) jest
  sprawdzane od nowa,
- limit 10 s i 3 MB, tylko `text/html`, bez ciasteczek, ogólny `User-Agent`,
- najpierw JSON-LD `@type: Recipe` (`name`, `recipeYield`, `recipeIngredient[]`). Gdy go nie
  ma, widoczny tekst strony bez skryptów i nawigacji, ucięty do ~30 tys. znaków,
- porażka (blokada, logowanie, Instagram) daje komunikat „Nie udało się pobrać przepisu.
  Wklej jego treść albo zrób zrzut ekranu." i arkusz zostaje otwarty z tymi opcjami.

Rozważane i odrzucone: narzędzie `web_fetch` po stronie Anthropic. Zdejmuje SSRF z naszego
serwera, ale wysyła do modelu całą stronę (koszt), nie każdy model z katalogu `AI_MODELS`
je obsługuje, a JSON-LD i tak trzeba by wyłuskać. Wraca do rozważenia, jeśli własne
pobieranie okaże się zawodne.

Schemat odpowiedzi (`extract_recipe_ingredients`):

```ts
{
  title: string | null;           // „Brownie"
  baseServings: number | null;    // 12 — z przepisu, null gdy nie podano
  ingredients: Array<{
    name: string;                 // „Czekolada gorzka"
    sourceText: string;           // „100 g gorzkiej czekolady"
    amount: number | null;        // ilość BAZOWA z przepisu w unit; null = „do smaku", „szczypta"
    unit: 'g' | 'ml' | 'szt' | null; // łyżki, szklanki → przeliczone na g/ml przez model
    packageAmount: number | null; // typowe opakowanie w PL w tej samej jednostce: 100 (g)
    packageLabel: string | null;  // „tabliczka", „kostka", „opak. 10 szt."
    pantryStaple: boolean;        // ocena modelu: sól, pieprz, woda, olej…
    section: ShoppingSection;
    confidence: number;
  }>;
  notes: string | null;
}
```

**Model nie mnoży i nie zaokrągla.** Dostaje przepis, nie mnożnik. Ilości bazowe i typowe
opakowanie to fakty, które umie odczytać i ocenić. Liczba opakowań to arytmetyka, którą
robimy deterministycznie i testujemy (07 §14.2). To ta sama filozofia co „nie licz nic
w pamięci" z 08 §7.

### 4.3 Kontekst wysyłany do modelu

Lista produktów „zawsze w domu" gospodarstwa (same nazwy) i nazwy działów. Bez nazw list,
bez innych pozycji, bez jakichkolwiek danych finansowych. „Już mam” ustala serwer: produkt
ze słownika z `is_staple` **albo** `pantryStaple` od modelu dla rzeczy oczywistych (sól,
woda). Do modelu nie trafia też nazwa gospodarstwa ani dane domowników (08 §13 obowiązuje
w całości).

## 5. Interfejs

Szkic. Pełny opis z czterema stanami każdego ekranu trafi do 06 §3.15 w `F10-1`.

### 5.1 Wejścia

| Wejście | Uwagi |
|---|---|
| *Więcej → Zakupy* i pasek boczny (grupa „Planowanie", nad „Budżet") | zawsze |
| skrót w manifeście PWA (długie przytrzymanie ikony aplikacji → „Lista zakupów") | otwiera listę domyślną, kosztuje jedną linijkę w manifeście |
| menu szybkich akcji FAB (długie przytrzymanie): **Do listy zakupów** | arkusz szybkiego dopisania do listy domyślnej z dowolnego ekranu |
| dolny pasek zakładek | **pytanie P-1** (§9): czy „Zakupy" zastępują którąś z pięciu zakładek |

### 5.2 `/shopping`: listy

```
┌──────────────────────────────────────┐
│ Zakupy                          ⋯    │  ⋯ → Archiwum · Zawsze w domu
├──────────────────────────────────────┤
│ ★ Spożywcze                 7 do kupienia │
│   ostatnio: Ania, 12 min temu        │
│ ⏳ Odczyt gotowy do przejrzenia  ›   │  ← import w stanie parsed
├──────────────────────────────────────┤
│   Decathlon                 3 do kupienia │
├──────────────────────────────────────┤
│   + Nowa lista                       │
└──────────────────────────────────────┘
```

Przy jednej liście ekran od razu otwiera tę listę (strzałka wstecz wraca do przeglądu list).
★ oznacza listę domyślną (zmiana w menu listy).

### 5.3 `/shopping/:listId`: lista

```
┌──────────────────────────────────────┐
│ ‹  Spożywcze                ⋯        │  ⋯ → Zmień nazwę · Ustaw jako domyślną ·
│                                      │     Duplikuj · Udostępnij jako tekst ·
│ WARZYWA I OWOCE                      │     Nie wygaszaj ekranu · Archiwizuj · Usuń
│ ○ Pomidory            1 kg           │
│ ○ Cebula                             │
│ NABIAŁ                               │
│ ○ Masło                              │
│ ○ Mleko               2 szt.         │
│ ○ Orzechy włoskie     1 opak.        │
│   Brownie                            │  ← notatka
│ ▸ Kupione (4)       Wyczyść kupione  │
├──────────────────────────────────────┤
│ [ Dodaj produkt…            ] [📷][+]│  ← dół ekranu; 📷 → arkusz importu
└──────────────────────────────────────┘
```

- Dotknięcie wiersza odhacza; przytrzymanie albo `⋯` w wierszu otwiera arkusz pozycji
  (nazwa, ilość ze stepperem i jednostką, notatka, dział, *Przenieś na inną listę*, *Usuń*).
- Pole dodawania podpowiada z słownika (prefiks i bez polskich znaków: „mas" → „Masło",
  „maka" → „Mąka"). Pusty wpis z fokusem pokazuje „Często kupowane" jako żetony
  (najczęściej używane produkty, których nie ma teraz na liście): po wyczyszczeniu listy
  dopisanie typowych zakupów to kilka dotknięć.
- Dział nowej pozycji: ze słownika, w drugiej kolejności ze stałego słownika słów
  kluczowych w `shared/constants` (mleko → nabiał), w ostateczności „Inne". Zmiana działu
  w arkuszu pozycji zapamiętuje się w słowniku.
- Cztery stany: ładowanie (szkielet wierszy), pusto („Lista jest pusta. Dopisz pierwszy
  produkt albo zrób zdjęcie listy z lodówki."), błąd, treść.

### 5.4 Arkusz importu i `/shopping/:listId/import/:importId`: przegląd

Arkusz „Dodaj z…": **Zdjęcie listy** · **Przepis** (zrzut / link / tekst + mnożnik).
Przegląd jak w §3.4 i §3.5: lista docelowa w nagłówku, sekcje „Do kupienia" / „Już mam"
(tylko przepis), edycja w miejscu, plakietki „Sprawdź" i „Już na liście", przycisk
*Dodaj N pozycji* przyklejony na dole i *Odrzuć* w menu. Stan przeglądu (zaznaczenia,
poprawki) zapisuje się na serwerze na bieżąco (`PATCH` propozycji), więc odświeżenie
strony albo druga osoba widzą to samo. To celowo inaczej niż w przeglądzie paragonu (Z-40).

### 5.5 Słownik: *Zawsze w domu*

`⋯ → Zawsze w domu`: lista produktów z flagą, wyszukiwarka, *+ Dodaj*, usunięcie flagi.
Przy pierwszym użyciu słownik ma kilka wpisów startowych (sól, pieprz, cukier, mąka
pszenna, olej, ocet, proszek do pieczenia, soda oczyszczona) do potwierdzenia jednym
przyciskiem. **Pytanie P-4.**

### 5.6 Most do finansów

Jedyny: po „Wyczyść kupione" jednorazowa podpowiedź „Zeskanuj paragon?" → `/scan`. Lista
nie wie nic o kwotach i niczego nie księguje.

## 6. Szkic modelu danych

> Przenosi się do 03 w `F10-1`; migracja `0008`. Wszystkie tabele mają `household_id`
> jako pierwszą kolumnę filtrującą (twarda zasada 4). Eksport JSON i „Usuń wszystkie dane"
> obejmują nowe tabele; pliki importów są usuwane razem z resetem.

```sql
CREATE TABLE shopping_lists (
  id            TEXT PRIMARY KEY,                 -- ULID
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  position      INTEGER NOT NULL DEFAULT 0,
  archived_at   TEXT,                             -- ISO UTC
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_shopping_lists_default
  ON shopping_lists(household_id) WHERE is_default = 1;

CREATE TABLE shopping_products (
  id               TEXT PRIMARY KEY,
  household_id     TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,                 -- forma wyświetlana: „Mąka pszenna"
  normalized_name  TEXT NOT NULL,                 -- 07 §14.1: „maka pszenna"
  section          TEXT NOT NULL,                 -- enum działów
  is_staple        INTEGER NOT NULL DEFAULT 0 CHECK (is_staple IN (0,1)),
  use_count        INTEGER NOT NULL DEFAULT 0,
  last_used_at     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_shopping_products_name
  ON shopping_products(household_id, normalized_name);

CREATE TABLE shopping_items (
  id               TEXT PRIMARY KEY,
  household_id     TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  list_id          TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  product_id       TEXT REFERENCES shopping_products(id) ON DELETE SET NULL,
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  normalized_name  TEXT NOT NULL,
  quantity_milli   INTEGER CHECK (quantity_milli IS NULL OR quantity_milli > 0),
  unit             TEXT CHECK (unit IN ('szt','opak','kg','g','l','ml')),
  note             TEXT CHECK (note IS NULL OR length(note) <= 120),
  section          TEXT NOT NULL,
  source           TEXT NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','photo','recipe')),
  import_id        TEXT REFERENCES shopping_imports(id) ON DELETE SET NULL,
  checked_at       TEXT,
  checked_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  cleared_at       TEXT,                          -- „Wyczyść kupione" (miękko, dla Cofnij)
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_shopping_items_list
  ON shopping_items(household_id, list_id, cleared_at, checked_at);

CREATE TABLE shopping_imports (
  id                   TEXT PRIMARY KEY,
  household_id         TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  list_id              TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL CHECK (kind IN ('list_photo','recipe')),
  input                TEXT NOT NULL CHECK (input IN ('image','url','text')),
  status               TEXT NOT NULL
                         CHECK (status IN ('processing','parsed','committed','discarded','failed')),
  source_url           TEXT,
  file_paths           TEXT,                      -- JSON, usuwane po committed/discarded
  servings_factor_bps  INTEGER CHECK (servings_factor_bps BETWEEN 2500 AND 40000),
  recipe_title         TEXT,
  base_servings        INTEGER,
  ai_model             TEXT,
  cost_minor           INTEGER NOT NULL DEFAULT 0,
  error_code           TEXT,
  created_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE shopping_import_items (
  id                   TEXT PRIMARY KEY,
  household_id         TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  import_id            TEXT NOT NULL REFERENCES shopping_imports(id) ON DELETE CASCADE,
  position             INTEGER NOT NULL,
  name                 TEXT NOT NULL,
  source_text          TEXT NOT NULL,
  -- ilość na listę (zdjęcie: z kartki; przepis: wyliczona z 07 §14.2 albo poprawiona)
  quantity_milli       INTEGER,
  unit                 TEXT CHECK (unit IN ('szt','opak','kg','g','l','ml')),
  quantity_overridden  INTEGER NOT NULL DEFAULT 0, -- poprawiona ręcznie: mnożnik jej nie zmienia
  -- tylko przepis: dane bazowe od modelu
  base_amount_milli    INTEGER,
  base_unit            TEXT CHECK (base_unit IN ('g','ml','szt')),
  package_amount_milli INTEGER,
  package_label        TEXT,
  section              TEXT NOT NULL,
  confidence_bps       INTEGER NOT NULL,          -- 0–10000
  already_have         INTEGER NOT NULL DEFAULT 0, -- sekcja „Już mam"
  selected             INTEGER NOT NULL DEFAULT 1,
  merge_into_item_id   TEXT REFERENCES shopping_items(id) ON DELETE SET NULL
);
```

Niezmienniki (numeracja robocza):

| # | Niezmiennik |
|---|---|
| I-26 | Gospodarstwo ma dokładnie jedną listę domyślną, jeśli ma jakąkolwiek niezarchiwizowaną. Archiwizacja domyślnej przenosi flagę na pierwszą pozostałą. Pierwsza lista powstaje sama („Spożywcze") przy pierwszym wejściu. |
| I-27 | `quantity_milli` i `unit` są oba `NULL` albo oba ustawione. |
| I-28 | `cleared_at IS NOT NULL` ⇒ `checked_at IS NOT NULL`. Wyczyszczone pozycje nie są zwracane w liście ani liczone; fizycznie usuwa je następne czyszczenie, jeśli są starsze niż 24 h. |
| I-29 | Na jednej liście najwyżej jedna pozycja *do kupienia* o danym `normalized_name` i jednostce. Dopisanie istniejącej scala ilości (07 §14.3). |
| I-30 | Propozycje importu nie trafiają na listę inaczej niż przez `commit`; `commit` w jednej transakcji bazy: pozycje, słownik, status `committed`. |
| I-31 | Import `committed` / `discarded` nie ma plików na dysku; zadanie przy starcie usuwa pliki importów starszych niż 7 dni. |

## 7. Szkic API i reguł

**API** (`/api/v1`, wszystko z `householdId` z tokenu):

| Metoda i ścieżka | Co robi |
|---|---|
| `GET /shopping-lists` | listy z licznikami (`toBuyCount`, `checkedCount`), ostatnią zmianą i importami do przejrzenia; `?archived=true` |
| `POST /shopping-lists` · `PATCH /:id` · `DELETE /:id` | utworzenie, nazwa / domyślna / archiwizacja / kolejność, usunięcie |
| `POST /shopping-lists/:id/duplicate` | kopia z pozycjami jako *do kupienia* |
| `GET /shopping-lists/:id/items` | pozycje (bez wyczyszczonych), `ETag` po `max(updated_at)` → `304` przy odpytywaniu |
| `POST /shopping-lists/:id/items` | dopisanie, ze scalaniem (I-29); odpowiedź mówi `merged: true` |
| `PATCH /shopping-items/:id` | nazwa, ilość, notatka, dział, `checked: boolean`, `listId` (przeniesienie). Idempotentny: drugi raz „checked: true" nic nie zmienia |
| `DELETE /shopping-items/:id` | usunięcie pozycji |
| `POST /shopping-lists/:id/clear-checked` | ustawia `cleared_at` kupionym; zwraca `clearedIds` |
| `POST /shopping-lists/:id/restore-cleared` | `{ itemIds }` → cofnięcie czyszczenia (do 24 h) |
| `GET /shopping-products?q=&limit=` | podpowiedzi ze słownika; `?staple=true`; `?frequent=true&listId=` dla żetonów |
| `PATCH /shopping-products/:id` · `POST` · `DELETE` | słownik i flaga „zawsze w domu" |
| `POST /shopping-imports` | multipart (obrazy) albo JSON (`url` / `text`), `listId`, `kind`, `servingsFactorBps` → `202` + id |
| `GET /shopping-imports/:id` | stan i propozycje |
| `PATCH /shopping-imports/:id` | `servingsFactorBps`, `listId` (przeliczenie propozycji bez AI) |
| `PATCH /shopping-imports/:id/items/:itemId` | korekta propozycji |
| `POST /shopping-imports/:id/commit` · `/discard` · `/retry` | zatwierdzenie (`Idempotency-Key`), odrzucenie, ponowienie po `failed` |

**Reguły domenowe** (07 §14, czyste funkcje w `shared/domain/shopping.ts`, każda z testami):

1. **Normalizacja nazwy** (§14.1): przycięcie, pojedyncze spacje, małe litery, bez polskich
   znaków i bez kropki na końcu („Mąka  pszenna." → „maka pszenna"). Służy do scalania,
   słownika i podpowiedzi. Bez stemmingu w v1 („jajko" ≠ „jajka"), a model podaje
   mianownik liczby mnogiej tam, gdzie to naturalne.
2. **Opakowania z przepisu** (§14.2):
   `potrzeba = base × factorBps / 10 000`;
   `opakowania = max(1, ceil((potrzeba − 10% × opakowanie) / opakowanie))`.
   Tolerancja 10% sprawia, że 105 g przy tabliczce 100 g to 1 tabliczka, a nie 2. Brak
   `amount` albo opakowania daje 1 szt. z dopiskiem „ilość: do smaku". Wynik zawsze w `szt`
   albo `opak`. Liczby całkowite w tysięcznych, bez floatów; przypadki brzegowe: ×0,25,
   ×4, potrzeba równa opakowaniu, potrzeba tuż ponad tolerancją, `amount = null`.
3. **Scalanie** (§14.3): ta sama `normalized_name` + ta sama jednostka → suma ilości;
   ta sama nazwa, jedna bez ilości → zostaje ta z ilością; różne jednostki (1 kg i 2 szt.)
   → osobne pozycje (I-29 obejmuje jednostkę). Pozycje *kupione* nie są celem scalania:
   kupione mleko i nowe mleko to dwie pozycje.
4. **Szybkie dopisanie** (§14.4): `"2 mleko"`, `"mleko 2"`, `"mleko x2"`, `"2x mleko"` →
   2 szt.; `"mąka 1kg"`, `"1,5 kg ziemniaki"` → kg; liczba bez jednostki → szt. Liczba
   w środku nazwy nie jest ilością („Mleko 3,2%", „7 Days"): rozpoznajemy tylko na początku
   albo końcu i tylko z jednostką lub `x`, albo samą liczbę do 99 na początku.
5. **Słownik** (§14.5): dopisanie pozycji robi upsert produktu (`use_count + 1`,
   `last_used_at`), zmiana działu pozycji aktualizuje dział produktu. „Często kupowane" to
   top 12 po `use_count` z ostatnich 90 dni, bez tych, które są na liście do kupienia.

## 8. Współdzielenie i praca bez sieci

- **Odświeżanie:** ekran listy odpytuje `GET …/items` co 15 s, gdy jest widoczny
  (`refetchInterval` + `ETag` → `304`, więc koszt jest pomijalny), i przy powrocie
  do karty. Bez WebSocketów: dwie osoby, rzadkie równoczesne zmiany.
- **Kto odhaczył:** wiersz kupiony pokazuje inicjały (`checked_by`), żeby w dwóch sklepach
  naraz było widać, co już jest.
- **Bez sieci** ([ADR-096](./14-decisions-log.md#adr-096), wyjątek od 06 §5 „dane zawsze
  z sieci"): **tylko** zapytania list zakupów są utrwalane w IndexedDB, a mutacje pozycji
  (odhacz, dopisz, usuń, wyczyść) czekają w kolejce i wysyłają się po powrocie sieci
  (TanStack Query: `networkMode: 'offlineFirst'`, utrwalone wstrzymane mutacje). Dopisanie
  offline ma identyfikator nadany przez klienta (ULID), więc ponowione żądanie nie
  dubluje pozycji. Konflikty: ostatni zapis wygrywa. Odhaczenie jest idempotentne, więc
  przypadek „oboje odhaczyli mleko" jest nieszkodliwy. Import z AI wymaga sieci i offline
  jest wyszarzony.
- Kwoty i reszta aplikacji **nie** zmieniają zachowania: baner offline z 06 §5 zostaje,
  na ekranie listy ma inną treść.

## 9. Pytania do rozstrzygnięcia przez właściciela

| # | Pytanie | Propozycja |
|---|---|---|
| P-1 | Czy „Zakupy" mają być w dolnym pasku zakładek (zastępując np. „Cele" albo „Historię")? | Najpierw *Więcej* + skrót z ikony + FAB; po miesiącu używania decyzja o pasku. Jeśli od razu, to zamiast „Cele" (cele ogląda się rzadko i są też w kaflu dashboardu) |
| P-2 | Pozycje z przepisu: opakowania („Czekolada — 1 szt.") czy dokładne ilości („Czekolada 100 g")? | Opakowania na liście, dokładna potrzeba jako podpis w przeglądzie i w notatce pozycji („100 g · Brownie") |
| P-3 | Czy obie osoby zawsze widzą wszystkie listy (bez list prywatnych)? | Tak, jak szkic budżetu (ADR-075). Listy prywatne poza zakresem |
| P-4 | Startowy zestaw „zawsze w domu" | sól, pieprz, cukier, mąka pszenna, olej, ocet, proszek do pieczenia, soda. Mleko, jajka i masło dopisujecie sami, bo to sprawa domu |
| P-5 | Kolejność działów: stała czy ustawiana pod swój sklep? | Stała w v1 (warzywa → pieczywo → nabiał → mięso → suche → mrożonki → napoje → chemia → higiena → dom → inne); przeciąganie działów później |
| P-6 | Czy zapamiętywać przepisy („zrób ten sam znowu")? | Nie w v1. Import po zatwierdzeniu zostaje w bazie z tytułem i propozycjami, więc dołożenie „Ostatnie przepisy" później jest tanie |
| P-7 | Czy zakupy z listy mają zasilać budżet (np. kategoria pozycji)? | Nie. Lista jest bez kwot, mostem jest tylko „Zeskanuj paragon" |

## 10. Zakres

**W zakresie (Faza 10):** wiele list z domyślną i archiwum, pozycje z opcjonalną ilością,
notatką i działem, odhaczanie z cofnięciem, „Wyczyść kupione" z cofnięciem, słownik
z podpowiedziami, „często kupowane" i „zawsze w domu", szybkie dopisanie z rozpoznawaniem
ilości, przenoszenie i duplikowanie, import ze zdjęcia listy, import przepisu (zrzuty, link,
tekst) z mnożnikiem i sekcją „Już mam", praca offline listy, odświeżanie między
domownikami, skróty (manifest, FAB, `share_target`), udostępnienie listy jako tekst,
eksport i „Usuń wszystkie dane".

**Poza zakresem:**

- ceny, budżet zakupów, powiązanie pozycji z kategoriami i transakcjami,
- stan spiżarni i daty ważności (lista nie wie, co jest w domu, poza flagą „zawsze w domu"),
- skanowanie kodów kreskowych, listy per sklep, kolejność działów per sklep,
- powiadomienia push („Ania dopisała 3 pozycje"), czyli ten sam temat co w 11 „Po v1",
- listy prywatne, przypisywanie pozycji do osoby,
- zapamiętane przepisy i planowanie posiłków na tydzień (P-6).

## 11. Kolejność prac

| ID | Zadanie |
|---|---|
| F10-1 | Rozstrzygnięcie P-1…P-7; przeniesienie §6–§8 do 03 / 04 / 05 / 06 / 07 / 08; ADR-093…096 → *przyjęta* |
| F10-2 | Schemat i migracja `0008` (pięć tabel), eksport, „Usuń wszystkie dane", sprzątanie plików przy starcie |
| F10-3 | DTO `dto/shopping.ts` i `shared/domain/shopping.ts`: normalizacja, opakowania, scalanie, szybkie dopisanie, **100% pokrycia** |
| F10-4 | Moduł `shopping`: listy, pozycje, słownik, czyszczenie z cofnięciem, `ETag`; testy tras |
| F10-5 | Ekrany `/shopping` i `/shopping/:listId`: dopisywanie z podpowiedziami, odhaczanie, działy, kupione, arkusz pozycji, cztery stany, 390 px |
| F10-6 | Odświeżanie co 15 s, utrwalenie zapytań i kolejka mutacji offline, baner, Wake Lock |
| F10-7 | Wejścia: *Więcej*, pasek boczny, FAB, skrót w manifeście, `share_target`, udostępnienie jako tekst |
| F10-8 | Import ze zdjęcia listy: `shopping_imports`, ekstraktor, prompt i schemat (08 §17), przegląd, scalanie, commit |
| F10-9 | Import przepisu: `fetchRecipeSource` z ochroną SSRF i JSON-LD, wklejony tekst, zrzuty, mnożnik z przeliczeniem bez AI, sekcja „Już mam", ekran *Zawsze w domu* |
| F10-10 | Ocena jakości: 10 zdjęć tablicy i 10 przepisów (linki i zrzuty) z oczekiwanym wynikiem, jak `ocr:evaluate`; sprawdzenie przepływów na 390 px w obu motywach |

`F10-2` → `F10-3` → `F10-4` → `F10-5` → (`F10-6`, `F10-7`, `F10-8`) → `F10-9` → `F10-10`.
Część bez AI (`F10-2`…`F10-7`) jest używalna sama i warto ją wdrożyć przed importami:
miesiąc używania pokaże, czy działy i podpowiedzi są trafione.

**Ukończone, gdy:** lista „Spożywcze" uzupełniana z dwóch telefonów, odhaczana w sklepie
bez zasięgu i czyszczona z kupionych; „Decathlon" powstaje, zostaje zużyta i trafia
do archiwum; zdjęcie tablicy daje listę do poprawienia przed dodaniem; link do przepisu
na ×0,5 daje „Do kupienia" w opakowaniach i „Już mam" z mąką i cukrem, a zmiana na ×1
przelicza ilości bez ponownego odczytu.
