# 17 — Listy zakupów

> **Stan:** plan potwierdzony przez właściciela 2026-11-22 (§9) — **Faza 10**, [11-roadmap.md](./11-roadmap.md).
> Decyzje: [ADR-093](./14-decisions-log.md#adr-093) … [ADR-096](./14-decisions-log.md#adr-096)
> (status: *przyjęta*). Wymaganie **#15** w [00 §4](./00-project-overview.md#4-zakres--mapowanie-wymagań).

Ten dokument opisuje funkcję w całości: po co jest, jak się z niej korzysta i jak łączy się
z resztą aplikacji. Jak przy planerze budżetu ([16](./16-budget-planner.md)), szczegóły
kontraktowe żyją w dokumentach 03–09 (przeniesione w `F10-1`) i to one są wiążące.

| Co | Gdzie |
|---|---|
| tabele `shopping_lists`, `shopping_items`, `shopping_products`, `shopping_imports`, `shopping_import_items`, niezmienniki I-26…I-31 | 03 §3.23–3.27 |
| endpointy `/api/v1/shopping-lists`, `/api/v1/shopping-imports`, `/api/v1/shopping-products` | 04 §14b |
| DTO `dto/shopping.ts` | 05 §13c |
| ekrany `/shopping`, `/shopping/:listId`, `/shopping/:listId/import/:importId` | 06 §3.15 |
| normalizacja nazw, scalanie, przeliczanie opakowań, szybkie dopisywanie, czyszczenie | 07 §14 |
| odczyt zdjęcia listy i przepisu przez AI | 08 §17 |
| pobieranie linku do przepisu (SSRF) | 09 §7a |

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

Schemat odpowiedzi modelu: [08 §17.2](./08-ocr-ai-pipeline.md#172-schematy-odpowiedzi).

Reguły promptu (szczegóły w 08 §17): pomijaj pozycje skreślone i odhaczone na kartce; nie
zgaduj nieczytelnych słów, tylko daj niską pewność i tekst źródłowy; „masło
i jajka" to dwie pozycje; podawaj nazwę ogólną („Jogurt naturalny"), bez marek, chyba że
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

Schemat odpowiedzi modelu: [08 §17.2](./08-ocr-ai-pipeline.md#172-schematy-odpowiedzi).

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

Skrót. Wiążący opis z czterema stanami każdego ekranu: [06 §3.15](./06-ui-views.md#315-listy-zakupów--shopping-shoppinglistid-shoppinglistidimportimportid).

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

`⋯ → Zawsze w domu`: lista produktów z flagą, wyszukiwarka, *+ Dodaj* (nowy produkt albo
istniejący ze słownika), usunięcie flagi. Flagę da się też przełączyć w arkuszu pozycji
i w przeglądzie importu („Zawsze mam / Nie zawsze mam"). Przy pierwszym wejściu słownik
dostaje zestaw startowy (P-4): sól, pieprz, cukier, mąka pszenna, olej, ocet, proszek
do pieczenia, soda oczyszczona, mleko, jajka, masło. To zwykłe wpisy słownika, bez
wyróżnienia: można je usunąć jak każdy inny.

### 5.6 Most do finansów

Jedyny: po „Wyczyść kupione" jednorazowa podpowiedź „Zeskanuj paragon?" → `/scan`. Lista
nie wie nic o kwotach i niczego nie księguje.

## 6. Model danych, API i reguły

Od `F10-1` kontrakt żyje w dokumentach kontraktowych — ten rozdział tylko wskazuje:

| Co | Gdzie |
|---|---|
| tabele `shopping_lists`, `shopping_products`, `shopping_items`, `shopping_imports`, `shopping_import_items`; `households.shopping_initialized_at`; zestaw startowy | [03 §3.23–3.27](./03-data-model.md#323-shopping_lists), [03 §5a](./03-data-model.md#5a-zestaw-startowy-list-zakupów) |
| niezmienniki I-26…I-31 | [03 §4](./03-data-model.md#4-niezmienniki-wymuszane-w-serwisach) |
| endpointy i kody błędów | [04 §14b](./04-api-spec.md#14b-listy-zakupów--apiv1shopping-lists-shopping-items-shopping-products-shopping-imports) |
| enumy i DTO | [05 §2](./05-dto-contracts.md#2-enumy--domainenumsts), [05 §13c](./05-dto-contracts.md#13c-listy-zakupów--dtoshoppingts) |
| normalizacja, opakowania, scalanie, szybkie dopisanie, słownik, czyszczenie, przypadki brzegowe | [07 §14](./07-domain-rules.md#14-listy-zakupów) |
| prompty, schematy odpowiedzi modelu, pobieranie przepisu, ocena jakości | [08 §17](./08-ocr-ai-pipeline.md#17-listy-zakupów-zdjęcie-listy-i-przepis) |
| ochrona przed SSRF | [09 §7a](./09-security-auth.md#7a-pobieranie-adresów-podanych-przez-użytkownika) |
| ekrany | [06 §3.15](./06-ui-views.md#315-listy-zakupów--shopping-shoppinglistid-shoppinglistidimportimportid) |

Uwaga do nazw: w bazie i w kontrakcie jednostki są angielskie (`pcs` = szt., `pack` = opak.,
`kg`, `g`, `l`, `ml`) i działy też (`dairy`, `bakery`…); polskie nazwy daje wyłącznie interfejs.

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

## 9. Pytania rozstrzygnięte

Wszystkie siedem **rozstrzygniętych przez właściciela 2026-11-22**.

| # | Pytanie | Rozstrzygnięcie |
|---|---|---|
| P-1 | Czy „Zakupy" mają być w dolnym pasku zakładek? | Na start nie: *Więcej*, pasek boczny, skrót z ikony aplikacji i FAB. Decyzja o pasku po miesiącu używania; jeśli wejdą, to zamiast „Cele" |
| P-2 | Pozycje z przepisu: opakowania czy dokładne ilości? | Opakowania na liście („Czekolada — 1 szt."), dokładna potrzeba jako dopisek: podpis w przeglądzie i notatka pozycji („100 g · Brownie") |
| P-3 | Czy obie osoby widzą wszystkie listy? | Tak, wszystkie listy są wspólne (jak szkic budżetu, ADR-075). Listy prywatne poza zakresem |
| P-4 | Startowy zestaw „zawsze w domu" | sól, pieprz, cukier, mąka pszenna, olej, ocet, proszek do pieczenia, soda oczyszczona, **mleko, jajka, masło**. Zestaw jest tylko startem: produkty „zawsze w domu" można dopisywać i usuwać (§5.5) |
| P-5 | Kolejność działów | Stała w v1; przeciąganie działów później |
| P-6 | Zapamiętywanie przepisów | Nie teraz. Import po zatwierdzeniu zostaje w bazie z tytułem, więc „Ostatnie przepisy" da się dołożyć później |
| P-7 | Czy lista zasila budżet? | Nie teraz. Jedynym mostem jest „Zeskanuj paragon" |

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
| F10-1 | ✅ Rozstrzygnięcie P-1…P-7; kontrakty w 01 / 02 / 03 / 04 / 05 / 06 / 07 / 08 / 09; zestaw startowy (03 §5a) — **zrobione 2026-11-22** |
| F10-2 | ✅ Schemat i migracja `0008` (pięć tabel), eksport, „Usuń wszystkie dane", sprzątanie plików przy starcie — **zrobione** |
| F10-3 | ✅ DTO `dto/shopping.ts` i `shared/domain/shopping.ts`: normalizacja, opakowania, scalanie, szybkie dopisanie, **100% pokrycia** — **zrobione** |
| F10-4 | ✅ Moduł `shopping`: listy, pozycje, słownik, czyszczenie z cofnięciem, `ETag`; testy tras — **zrobione** |
| F10-5 | ✅ Ekrany `/shopping` i `/shopping/:listId`: dopisywanie z podpowiedziami, odhaczanie, działy, kupione, arkusz pozycji, cztery stany, 390 px — **zrobione** |
| F10-6 | ✅ Odświeżanie co 15 s, migawka listy i kolejka zmian offline, baner, Wake Lock (ADR-099) — **zrobione** |
| F10-7 | ✅ Wejścia: *Więcej*, pasek boczny, FAB, skrót w manifeście, udostępnienie jako tekst; `share_target` przeniesiony do `F10-9` — **zrobione** |
| F10-8 | ✅ Import ze zdjęcia listy: `shopping_imports`, ekstraktor, prompt i schemat (08 §17), przegląd, scalanie, commit — **zrobione** |
| F10-9 | ✅ Import przepisu: `fetchRecipeSource` z ochroną SSRF i JSON-LD, wklejony tekst, zrzuty, mnożnik z przeliczeniem bez AI, sekcja „Już mam", `share_target` (z `F10-7`); ekran *Zawsze w domu* powstał w `F10-5` — **zrobione** |
| F10-10 | 🟡 Ocena jakości: 10 zdjęć tablicy i 10 przepisów (linki i zrzuty) z oczekiwanym wynikiem, jak `ocr:evaluate`; sprawdzenie przepływów na 390 px w obu motywach — skrypt `shopping:evaluate` i sprawdzenie 390 px **zrobione**; pomiar czeka na zdjęcia i przepisy właściciela (jak `F7-11`) |

`F10-2` → `F10-3` → `F10-4` → `F10-5` → (`F10-6`, `F10-7`, `F10-8`) → `F10-9` → `F10-10`.
Część bez AI (`F10-2`…`F10-7`) jest używalna sama i warto ją wdrożyć przed importami:
miesiąc używania pokaże, czy działy i podpowiedzi są trafione.

**Ukończone, gdy:** lista „Spożywcze" uzupełniana z dwóch telefonów, odhaczana w sklepie
bez zasięgu i czyszczona z kupionych; „Decathlon" powstaje, zostaje zużyta i trafia
do archiwum; zdjęcie tablicy daje listę do poprawienia przed dodaniem; link do przepisu
na ×0,5 daje „Do kupienia" w opakowaniach i „Już mam" z mąką i cukrem, a zmiana na ×1
przelicza ilości bez ponownego odczytu.
