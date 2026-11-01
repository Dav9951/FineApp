# 06 — Widoki i interfejs

Dokument opisuje **co znajduje się na każdym ekranie, w jakim układzie i dlaczego**.
Nie zawiera kodu komponentów — te powstaną w kolejnych zadaniach według tego planu.

## 1. Założenia projektowe

1. **Mobile-first, nie mobile-also.** Projektujemy dla ekranu 390 × 844 px trzymanego
   jedną ręką. Desktop to ten sam układ rozlany na szerszą siatkę, nie osobny projekt.
2. **Zasada kciuka.** Wszystko, co wykonuje się często (dodanie wydatku, potwierdzenie raty,
   przełączenie miesiąca), musi być w dolnej połowie ekranu.
3. **Dwa dotknięcia do wydatku.** FAB → formularz z sensownymi wartościami domyślnymi.
   To najczęstsza czynność w aplikacji i wyznacza priorytet całego UX.
4. **Liczba zawsze z kontekstem.** Kwota bez porównania (plan, poprzedni miesiąc, cel)
   nie niesie informacji. Każdy kafel pokazuje wartość *i* jej odniesienie.
5. **Ciemny motyw domyślny**, jasny dostępny. Aplikacja jest używana wieczorem.
   Wybór (Ciemny / Jasny / Systemowy) w Ustawieniach → „Wygląd" i przełącznikiem ☀/☾
   na dole paska bocznego; zapamiętany na urządzeniu ([ADR-067](./14-decisions-log.md#adr-067)).
6. **Polski interfejs**, format `pl-PL`, waluta `PLN`, tydzień od poniedziałku.

## 2. Nawigacja

> Treść tras siedzi w kontenerze z `overflow-x-clip` — żaden ekran nie
> poszerza strony, więc pasek zakładek i FAB zawsze mieszczą się na ekranie
> ([ADR-074](./14-decisions-log.md#adr-074)).

### Mobile (< 768 px)

Dolny pasek zakładek — pięć pozycji, stały, z `safe-area-inset-bottom`:

```
┌───────────────────────────────────────────────┐
│                                               │
│               treść ekranu                    │
│                                               │
│                                    ╭─────╮    │
│                                    │  +  │ ← FAB nad paskiem
│                                    ╰─────╯    │
├───────────────────────────────────────────────┤
│  📅        📋        🎯        📷        ☰   │
│ Miesiąc  Historia   Cele     Skan    Więcej  │
└───────────────────────────────────────────────┘
```

FAB jest kontekstowy: na *Miesiącu* i *Historii* otwiera formularz transakcji,
na *Celach* — wpłatę na cel, na *Skanie* — aparat.

Długie przytrzymanie FAB otwiera menu szybkich akcji: **Wydatek / Przychód / Przelew / Paragon**.

Ekran „Więcej" (`/more`, od `F2-6`) to lista podsekcji z `planningNav()` i `settingsNav()` —
tych samych, z których buduje się pasek boczny desktopu. Na telefonie to jedyne wejście do
Kont. Od ADR-082: na górze profil (inicjały, nazwa gospodarstwa nad imieniem, kółko
drugiego domownika), pod nim „Planowanie", potem Kategorie i Ustawienia, na dole
przełącznik motywu i „Wyloguj".

### Desktop (≥ 768 px)

Lewy pasek boczny z tymi samymi pozycjami plus rozwinięte podsekcje
z „Więcej" (układ niżej). Treść wyśrodkowana,
max 1200 px. FAB zostaje pływający w prawym dolnym rogu (24 px od krawędzi); menu
szybkich akcji otwiera też prawy przycisk myszy. Przycisk „Dodaj" w nagłówku usunięty —
stał tuż nad „+" ekranu (np. „Nowy cel") i dwa plusy myliły ([ADR-058](./14-decisions-log.md#adr-058)).
Pasek zwija się do szyny z samymi ikonami; stan zapamiętany na urządzeniu
([ADR-067](./14-decisions-log.md#adr-067)).

**Układ paska od [ADR-082](./14-decisions-log.md#adr-082)** (makieta
[`design/mockups/sidebar.html`](../design/mockups/sidebar.html), wzór: plik Figma
„Sidebar Dashboard"):

```
┌──────────────────────────┐
│ (AK)b  DOM               │ ← profil → /settings; „e" = kółko drugiego domownika
│        Adam           (‹)│ ← okrągły przycisk zwijania na krawędzi (28 px, dotyk 44 px)
│ ──────────────────────── │
│ MIESIĄC                  │
│  Miesiąc · Historia · Cele · Skan
│ PLANOWANIE               │
│  Konta · Zobowiązania · Cykliczne · Planowane · Budżet · Rozkład docelowy
│            …             │
│ ──────────────────────── │
│  Kategorie               │ ← bez nagłówka — oddziela je miejsce, nie napis
│  Ustawienia              │
│ ──────────────────────── │
│  ⇥ Wyloguj     [ ☀ | ☾ ] │ ← `--danger` bez potwierdzenia · motyw z przesuwanym podkładem
└──────────────────────────┘
```

Nagłówki grup „Miesiąc" i „Planowanie" składają grupę (złożona pokazuje tylko bieżącą
stronę, stan zapamiętany). „Wyloguj" i przełącznik motywu (same ikony) w jednym rzędzie.
Przy braku miejsca środek się przewija, ale pasek przewijania widać dopiero po najechaniu,
a na dole jest cieniowanie (ADR-082, uzupełnienie).

Szerokość 248 px, szyna 76 px: nagłówki grup zamieniają się w linie, nazwy w dymki
(`title`), przełącznik motywu w jeden przycisk słońce / księżyc. „Rozkład docelowy" ma
ikonę wykresu kołowego (wcześniej tarcza jak „Cele"). Nazwa „FineApp" znika z paska —
miejsce marki zajmuje profil.

### Struktura tras

| Ścieżka | Ekran | Uwagi |
|---|---|---|
| `/login` | Logowanie | Bez powłoki aplikacji |
| `/` | przekierowanie → `/m/<bieżący miesiąc>` | |
| `/m/:month` | **Miesiąc (dashboard)** | Domyślny widok (wymaganie #12) |
| `/m/:month/transactions` | Historia transakcji | Filtry w URL |
| `/m/:month/categories` | Rozbicie po kategoriach | |
| `/t/new` `/t/:id` | Formularz transakcji | Arkusz nad bieżącym ekranem |
| `/goals` `/goals/:id` | Cele | |
| `/allocation` | Rozkład docelowy % | |
| `/accounts` `/accounts/:id` | Konta | |
| `/liabilities` `/liabilities/:id` | Zobowiązania | |
| `/recurring` `/recurring/:id` | Pozycje cykliczne | |
| `/planned` `/planned/:id` | Planowane wydatki | Wymaganie #13 |
| `/scan` `/scan/:documentId` | Skanowanie i przegląd | |
| `/budget` `/budget/:month` | Planer budżetu | Wymaganie #14, Faza 9 (plan) |
| `/settings` `/settings/*` | Ustawienia, kategorie, źródła przychodu | |

**Miesiąc jest w URL.** Dzięki temu przycisk „wstecz" w przeglądarce cofa do poprzednio
oglądanego miesiąca, a link da się wysłać drugiej osobie w domu.

## 3. Ekrany

### 3.1 Miesiąc (dashboard) — `/m/:month`

Najważniejszy ekran aplikacji. Zasilany **jednym** żądaniem `GET /months/:month/summary`.

```
┌─────────────────────────────────────────────┐
│ ‹  wrzesień 2026  ›              [AK] [BN]  │ ← przyklejony nagłówek
├─────────────────────────────────────────────┤
│ KONTA                          majątek netto│
│ ┌────────┐┌────────┐┌────────┐┌────────┐   │
│ │ ROR    ││Oszczęd.││ IKE    ││Gotówka │ → │ ← przewijany poziomo
│ │8 432,10││42 000  ││18 000  ││  340   │   │
│ │ +3 312 ││ +2 000 ││ +1 000 ││  −120  │   │
│ └────────┘└────────┘└────────┘└────────┘   │
├─────────────────────────────────────────────┤
│ WRZESIEŃ                                    │
│  Wpływy     11 800,00    ↑ 0%               │
│  Wydatki     6 423,00    ↓ 6% do sierpnia   │
│  ─────────────────────────────              │
│  Zostaje     2 197,00                       │
│  [████████████░░░░░░] 20 z 30 dni           │
├─────────────────────────────────────────────┤
│ CELE PROCENTOWE                    [ustaw]  │
│      ╭───────╮         ╭───────╮            │
│      │  17%  │         │  10%  │            │
│      │ ○ 20% │         │ ● 10% │            │
│      ╰───────╯         ╰───────╯            │
│    Oszczędności       Inwestycje            │
│    2 000 / 2 360      1 180 / 1 180  ✓      │
│                                             │
│  ⚠ Brakuje 360,00 zł do planu miesiąca      │
│                          [Uzupełnij →]      │
│  ⓘ Wykonanie netto: wpłaty minus wypłaty    │
├─────────────────────────────────────────────┤
│ CELE                             [wszystkie]│
│  🏠 Wkład własny      42 000/120 000   35%  │
│     [███████░░░░░░░░░░░░]  ✓ wrzesień       │
│  🛡 Poduszka          18 000/30 000    60%  │
│     [████████████░░░░░░░]  ⚠ brak wpłaty    │
├─────────────────────────────────────────────┤
│ DO ZROBIENIA W TYM MIESIĄCU            1    │
│  ○ Wpłata na IKE      1 000,00   5 wrz  ›   │
│     [Zaksięguj]  [Pomiń]                    │
├─────────────────────────────────────────────┤
│ NADCHODZĄCE                      [wszystkie]│
│  🚗 OC samochód      2 400,00   za 6 mies.  │
│     odłożone 33% · odkładaj 266,67/mies.    │
│     ○ Wrzesień          [Odłóż 266,67]      │
│  🔧 Przegląd           800,00   za 2 mies.  │
│     odłożone 100%                     ✓     │
│  ⚠ W marcu zabraknie 500,00 zł              │
├─────────────────────────────────────────────┤
│ NA CO IDĄ PIENIĄDZE            [szczegóły]  │
│  🍔 Jedzenie        1 874,00  29%  ↓        │
│  🏠 Mieszkanie      1 850,00  29%  →        │
│  🚗 Transport         642,00  10%  ↑        │
├─────────────────────────────────────────────┤
│ OSTATNIE                       [historia]   │
│  18 wrz  Lidl            −127,99   Jedzenie │
│  15 wrz  Czynsz        −1 850,00   Mieszk.  │
│  11 wrz  → Mieszkaniowe −2 000,00  Cel      │
│  10 wrz  Wynagrodzenie +9 800,00   Pensja   │
└─────────────────────────────────────────────┘
```

**Kolejność sekcji nie jest przypadkowa.** Od góry: *ile mam* → *co się działo* →
*czy trzymam plan* → *co muszę zrobić teraz* → *co mnie czeka* → *szczegóły*.
Odpowiada to kolejności pytań, które zadaje sobie osoba otwierająca aplikację.

**Przełącznik miesiąca** (`‹ wrzesień 2026 ›`):
- strzałki przesuwają o miesiąc,
- dotknięcie nazwy otwiera siatkę 12 miesięcy × wybór roku,
- gest przesunięcia w bok na treści zmienia miesiąc,
- miesiące bez danych są wyszarzone, ale klikalne,
- miesiąc przyszły dostępny tylko w trybie podglądu planu (bez możliwości księgowania).

**Kafel „Cele procentowe"** to bezpośrednia realizacja wymagania #8. Pierścień pokazuje
wykonanie, znacznik `○`/`●` — cel. Kolor: zielony (zrealizowane), bursztynowy
(w trakcie, tempo OK), czerwony (poniżej tempa przy końcu miesiąca). Przycisk
**„Uzupełnij"** otwiera formularz przelewu z **wpisaną z góry brakującą kwotą** —
tak, żeby domknięcie planu było jednym dotknięciem.

**Stan pusty (pierwsze uruchomienie):** zamiast kafli — lista kroków startowych:
„1. Dodaj konta → 2. Ustaw wydatki stałe → 3. Określ cele → 4. Wpisz pierwszy przychód".

**Ustalenia z `F3-4`…`F3-6`** ([ADR-041](./14-decisions-log.md#adr-041)):

- Sekcje w Fazie 3: *Konta* (kafle 124 px przewijane poziomo **bez widocznego paska
  przewijania** — ADR-073, saldo bez `zł`, ruch
  w miesiącu ze znakiem; dotknięcie → szczegóły konta; majątek netto w nagłówku),
  *{miesiąc}* (Wpływy i Wydatki z porównaniem „↓ 6% do sierpnia", wiersze „Na / Z
  oszczędności" i „Na / Z inwestycji" tylko gdy ≠ 0 — bez nich „Zostaje" nie zgadza
  się z rachunkiem; „Zostaje" = `netMinor`, na minusie „Na minusie"; pasek „20 z 30 dni"
  tylko w bieżącym miesiącu), *Na co idą pieniądze* (do pięciu kategorii głównych,
  udział, strzałka trendu — „→" przy różnicy < 5%; link „N wydatków bez kategorii —
  uzupełnij" do historii z `uncategorized=true`), *Ostatnie* (10, dotknięcie → arkusz
  edycji). Cele procentowe, cele, „Do zrobienia" i „Nadchodzące" dochodzą z Fazami 4–6.
- Porównanie bez danych z poprzedniego miesiąca — bez strzałki i procentu; przy zerowej
  podstawie sama strzałka. Kierunek w tekście dla czytnika ekranu („o 6% mniej niż
  w sierpniu"). Wzrost na sufitcie 100 000 bps — „↑ >1000% do sierpnia", dla czytnika
  „o ponad 1000% więcej niż w sierpniu" (07 §12.3, ADR-084).
- Baner nad treścią: miesiąc przyszły („Podgląd…") i zamknięty („Miesiąc zamknięty —
  księgowanie… od 1 sierpnia 2026"); w obu brak „Dodaj wydatek".
- Kroki startowe tylko przy pierwszym uruchomieniu (brak kont i transakcji); pusty
  miesiąc u kogoś, kto ma konta, to zwykły dashboard z zerami.
- Przełącznik: strzałki, dotknięcie nazwy → arkusz „Wybierz miesiąc" (rok ‹ ›, siatka
  4 × 3; bez danych — wyszarzone, bieżący — kropka, oglądany — ramka), gest w bok na
  treści (≥ 60 px, wyraźnie poziomo; nie na kaflach kont). Sąsiednie miesiące pobierane
  w tle po wczytaniu bieżącego. W trakcie wczytywania przełącznik przygaszony.
- Historia: panel filtrów dostał „Tylko transakcje bez kategorii" (`uncategorized`).

**Ustalenia z `F4-7` — „Do zrobienia"** ([ADR-050](./14-decisions-log.md#adr-050)):

- Między podsumowaniem miesiąca a „Na co idą pieniądze". Nagłówek z liczbą pozycji;
  „zaksięgowano X z planu Y". Bez pozycji cyklicznych i zobowiązań sekcji nie ma; wszystko
  zrobione — „✓ Wszystko na ten miesiąc zrobione.".
- Wiersz: znacznik (⚠ po terminie, ○ czeka), nazwa, termin z podpisem „zaległe za sierpień
  2026" / „po terminie" / „kwota szacunkowa", kwota ze znakiem rodzaju; pod spodem
  [Pomiń] [Zaksięguj]. Zaległe najpierw.
- „Zaksięguj" przy kwocie pewnej — jednym dotknięciem, toast z „Cofnij" (cofnięcie
  zaksięgowania). Przy **szacunkowej** — arkusz z klawiaturą kwoty i planem obok (07 §6.5).
  „Pomiń" — od razu, toast bez „Cofnij" (pominięte można potem zaksięgować przez API).
- Raty zobowiązań bez reguły — tylko [Zaksięguj] (jak na karcie zobowiązania).
- Miesiąc przyszły: „Zaplanowane — listopad 2026", bez przycisków; odnośnik „Wszystkie
  pozycje cykliczne" → `/recurring`.
- Jeszcze nie ma: awatarów domowników w nagłówku (`Z-15`), odświeżenia gestem (`Z-24`).

**Ustalenia z `F5-8` — cele procentowe i cele** ([ADR-054](./14-decisions-log.md#adr-054)):

- Po sekcji miesiąca: „Cele procentowe" (pierścień na pulę; liczba w środku = realizacja
  planu, pod spodem `2 000 / 2 360 zł` i „17,0% z 20,0% wpływów"; bez rozkładu — zachęta
  z „ustaw"), potem „Cele" (do trzech aktywnych: kwota / docelowa, %, pasek puli, „✓
  wpłacono we wrześniu" / „⚠ brak wpłaty"; bez celów sekcji nie ma).
- „Uzupełnij" (tylko miesiąc bieżący) otwiera przelew z całym niedoborem i kontem puli,
  której brakuje najwięcej. Wypłata ponad wpłaty — zdanie „Z oszczędności wypłacono
  więcej, niż wpłacono.", nie sama liczba.

**Rozbicie po kategoriach** — `/m/:month/categories` (od `F3-2`): suma wydatków,
kategorie główne malejąco z paskiem udziału w kolorze wydatku i kwotą z poprzedniego
miesiąca, podkategorie po rozwinięciu. Bez wykresu kołowego — posortowane paski są
właściwą formą do porównania wielkości ([ADR-063](./14-decisions-log.md#adr-063)).

### 3.2 Historia transakcji — `/m/:month/transactions`

```
┌─────────────────────────────────────────────┐
│ ‹ wrzesień 2026 ›              🔍  ⚙ Filtry │
├─────────────────────────────────────────────┤
│ [Wszystko][Wydatki][Wpływy][Przelewy]       │ ← szybkie filtry
├─────────────────────────────────────────────┤
│ 47 transakcji · wydatki 6 423,00 zł         │
├─────────────────────────────────────────────┤
│ CZWARTEK, 18 WRZEŚNIA            −227,98    │
│  🍔 Lidl                          −127,99   │
│     Zakupy tygodniowe · ROR · AK            │
│  ⛽ Orlen                          −99,99   │
│     Paliwo · ROR · BN           📷          │
├─────────────────────────────────────────────┤
│ PONIEDZIAŁEK, 15 WRZEŚNIA      −1 850,00    │
│  🏠 Czynsz                      −1 850,00   │
│     Mieszkanie · ROR · 🔁 cykliczne         │
└─────────────────────────────────────────────┘
```

- Grupowanie **po dniach**, z sumą dnia po prawej — pozwala wyłapać „drogie dni".
- Ikony pochodzenia: `📷` z paragonu, `🔁` z reguły cyklicznej.
- Inicjały autora (`AK`/`BN`) — przy dwóch użytkownikach to istotny kontekst.
- **Gesty na mobile:** przesunięcie w lewo → Usuń, w prawo → Edytuj.
- Przewijanie nieskończone w obrębie miesiąca; na końcu przycisk
  „Pokaż sierpień" zamiast automatycznego przeskoku.
- Panel filtrów: konto, kategoria (wielokrotny wybór), zakres kwot, źródło, tekst.
  Aktywne filtry są w URL, więc dają się zapisać w zakładce.

**Ustalone przy `F2-8`** ([ADR-038](./14-decisions-log.md#adr-038)):

- Suma dnia i linia podsumowania pochodzą z `meta.summary` (04 §7), nie z wczytanych
  wierszy. Suma dnia = wpływy − wydatki; przelewy nie wchodzą; zero się nie pokazuje.
- Filtry w adresie pod tymi samymi nazwami co w API (`type`, `q`, `accountId`,
  `categoryId`, `incomeSourceId`, `minAmountMinor`, `maxAmountMinor`, `includeDeleted`);
  strzałki miesiąca i „Pokaż sierpień" przenoszą filtry. Tekst wyszukiwarki trafia do
  adresu po 300 ms bez pisania.
- „Źródło" w panelu to **źródło przychodu**. Kategoria główna zaznacza się razem
  z podkategoriami. Panel ma też „Pokaż usunięte transakcje" (kosz) — wiersz z kosza
  ma plakietkę, nie reaguje na gest, a dotknięcie otwiera arkusz z „Przywróć".
- Gest w lewo przenosi do kosza **bez pytania**, z toastem „Cofnij" (15 §4.10);
  alternatywą bez gestu jest „Usuń transakcję" w arkuszu edycji (15 §2.7).
- Na 390 px „Filtry" to sama ikona z plakietką liczby filtrów — napis zabierał miejsce
  nazwie miesiąca. Zamiast emoji: ikony typu transakcji z lucide (kategorie nie mają
  jeszcze ikon, `Z-22`), aparat i strzałki cyklu jako ikony z etykietą.
- Przewijanie doczytuje kolejną stronę na 400 px przed końcem; obok zawsze jest
  „Wczytaj więcej". Odświeżenie gestem (§5) — jeszcze nie (`Z-24`).

### 3.3 Formularz transakcji — `/t/new`, `/t/:id`

Arkusz wysuwany od dołu (mobile) / modal (desktop). Otwiera się nad bieżącym ekranem,
żeby nie tracić kontekstu.

```
┌─────────────────────────────────────────────┐
│ ✕            Nowy wydatek           Zapisz  │
├─────────────────────────────────────────────┤
│ [Wydatek] [Przychód] [Przelew]              │
├─────────────────────────────────────────────┤
│                                             │
│              127,99 zł                      │ ← duże, fokus na starcie
│              ┌───┬───┬───┐                  │
│              │ 1 │ 2 │ 3 │                  │ ← klawiatura numeryczna
│              ├───┼───┼───┤                  │
│              │ 4 │ 5 │ 6 │                  │
│              ├───┼───┼───┤                  │
│              │ 7 │ 8 │ 9 │                  │
│              ├───┼───┼───┤                  │
│              │ , │ 0 │ ⌫ │                  │
│              └───┴───┴───┘                  │
├─────────────────────────────────────────────┤
│ Kategoria   🍔 Jedzenie                   › │
│ Konto       ROR                           › │
│ Data        dziś, 18 września             › │
│ Opis        Zakupy tygodniowe               │
│ ▸ Więcej (sprzedawca, notatka)              │
├─────────────────────────────────────────────┤
│ ☐ Zapisz jako wydatek stały                 │ ← wymaganie #3
└─────────────────────────────────────────────┘
```

- **Kwota ma fokus od razu** i własną klawiaturę numeryczną (nie systemową — na iOS
  systemowa klawiatura numeryczna nie ma przecinka).
- Kategoria: arkusz z siatką ikon + wyszukiwarka + sekcja „Ostatnio używane" na górze.
- Data: domyślnie dziś; skróty „wczoraj" i „przedwczoraj"; kalendarz z **wyszarzonymi
  datami poza dozwolonym oknem** księgowania wstecz (wymaganie #12).
- Checkbox **„Zapisz jako wydatek stały"** rozwija pola cykliczności (częstotliwość,
  dzień) i po zapisie tworzy regułę — to realizacja „łatwego dodawania kolejnych
  wydatków i zapisywania ich jako stałe".
- Wariant **Przelew**: zamiast kategorii pola *Z konta* → *Na konto*, opcjonalnie
  *Na cel*. Pod polami kont pojawia się plakietka z **wyliczonym efektem netto**
  i możliwością wyłączenia — użytkownik widzi wpływ operacji na cele **zanim** zapisze:
  „Liczy się jako oszczędności **+2 000,00**" przy wpłacie,
  „**Zmniejsza** oszczędności o **1 500,00**" przy wypłacie z poduszki,
  a przy przesunięciu oszczędności na konto maklerskie — obie linie naraz
  (patrz [07 §2.2](./07-domain-rules.md#22-wpływ-przelewu-na-pule--ujęcie-netto)).
- Wariant **Przychód**: pole *Źródło przychodu* (wymaganie #10) z listą i szybkim
  dodaniem nowego źródła.

**Stan po `F2-7`** ([ADR-037](./14-decisions-log.md#adr-037))

- Arkusz jest stanem powłoki: FAB (Wydatek / Przychód / Przelew) i „Dodaj" na
  desktopie otwierają go nad bieżącym ekranem. `/t/new?type=…` i `/t/:id` przekierowują
  na bieżący miesiąc i otwierają arkusz nad nim.
- Kwota z `<AmountInput>` i fokusem na starcie; zakładki typu tylko przy nowej
  transakcji. Pola: *Źródło* (przychód), *Kategoria* (wydatek, przychód), *Z konta* /
  *Na konto*, *Data* (skróty Dziś / Wczoraj / Przedwczoraj + kalendarz ograniczony do
  okna), *Opis*, „Więcej (sprzedawca, notatka)".
- Wybory to widoki w tym samym arkuszu z „Wróć", nie arkusze jeden na drugim.
  Kategoria: wyszukiwarka, „Bez kategorii", lista z podkategoriami (bez ikon i bez
  „Ostatnio używanych" — `Z-22`). Źródło: lista, „Bez źródła", „Nowe źródło" z nazwą
  i rodzajem (`<OptionGrid>`), od razu wybrane.
- Przelew: plakietka „Liczy się do celów" z wyłącznikiem i liniami „Zwiększa /
  Zmniejsza {pulę} o {kwotę}" z `allocationEffects`; przy przelewie w obrębie jednej
  puli — zdanie, że cele się nie zmienią. Wyłączenie wysyła `allocationOverride: none`.
- „Zapisz" przyklejony na dole arkusza. Nowa transakcja niesie `Idempotency-Key`
  (jeden na otwarcie arkusza); edycja wysyła `PATCH` tylko ze zmienionymi polami,
  a bez zmian po prostu zamyka arkusz.
- Edycja: szkielet przy wczytywaniu, stan „Nie ma takiej transakcji" (404), błąd
  z ponowieniem, „Transakcja jest w koszu".
- Transakcja z **zamkniętego miesiąca** (07 §1.4, od `F3-3`): notka „Miesiąc jest
  zamknięty…", kwota, kategoria, źródło, konta i data jako wiersze tylko do odczytu,
  bez plakietki celów i bez „Usuń transakcję"; w koszu — bez „Przywróć". Opis,
  sprzedawca i notatka dalej edytowalne.
- Jeszcze nie ma: pola „Na cel" (`Z-23`).

**Stan po `F4-8`** ([ADR-051](./14-decisions-log.md#adr-051))

- Nowa transakcja kończy się polem wyboru „Zapisz jako wydatek stały" (przychód: „…stały
  przychód", przelew: „…stały przelew"). Zaznaczenie rozwija te same pola terminarza co
  formularz reguły (`ScheduleFields`: jak często, dzień miesiąca / tygodnia, miesiąc roku),
  podpowiedziane z daty transakcji, i podgląd „Kolejne terminy: 25 paź · 25 lis · 25 gru"
  — **po** tej transakcji, bo bieżący termin ona opłaca (07 §6.8).
- Zmiana daty przesuwa terminarz, dopóki użytkownik go nie ruszył. Nazwa, kwota i konta —
  z transakcji; resztę (auto-księgowanie, kwota szacunkowa, koniec) zmienia się
  w pozycjach cyklicznych.
- Po zapisie transakcji formularz woła `save-as-recurring` z własnym kluczem idempotencji.
  Sukces — toast „Zapisano „Siłownia" — następny termin 25 paź"; błąd reguły — toast
  „Transakcja zapisana, ale pozycji cyklicznej nie: …" i arkusz się zamyka (transakcja
  już jest). Błędny dzień blokuje zapis **przed** wysłaniem transakcji.
- Edycja istniejącej transakcji pola nie ma.

**Od `F5-5`** (`Z-23`, ADR-054): przelew ma pole **„Na cel"** — wybór celu aktywnego albo
wstrzymanego; cel z kontem podpowiada konto docelowe. Arkusz przyjmuje wartości z góry
(`TransactionPreset`: kwota, konto docelowe, cel) — używa ich „Uzupełnij".

### 3.4 Skanowanie — `/scan`

Trzy stany na jednej trasie.

**A. Wybór źródła**

```
┌─────────────────────────────────────────────┐
│              Wrzuć dokument                 │
│                                             │
│         ┌───────────────────────┐           │
│         │         📷            │           │
│         │    Zrób zdjęcie       │           │
│         └───────────────────────┘           │
│         ┌───────────────────────┐           │
│         │         📁            │           │
│         │     Wybierz plik      │           │
│         └───────────────────────┘           │
│                                             │
│  Rodzaj:  [Paragon] [Wyciąg] [Faktura]      │
│                                             │
│  OSTATNIE                                   │
│   ✓ Lidl · 18 wrz · 127,99 zł               │
│   ⏳ Wyciąg mBank · przetwarzanie…          │
└─────────────────────────────────────────────┘
```

**B. Przetwarzanie** — podgląd wrzuconego zdjęcia z nakładką postępu i uczciwym
komunikatem („Odczytuję pozycje… zwykle 5–15 sekund"). Odpytywanie `GET /documents/:id`
co 1,5 s. Ekran da się opuścić — wynik czeka na liście.

**C. Przegląd i zatwierdzenie** — `/scan/:documentId`

```
┌─────────────────────────────────────────────┐
│ ✕     Paragon · Lidl          [Zatwierdź]   │
├─────────────────────────────────────────────┤
│  [miniatura zdjęcia — dotknij, by powiększyć]│
├─────────────────────────────────────────────┤
│ Sprzedawca  Lidl                          › │
│ Data        18 września 2026               ›│
│ Konto       ROR                           › │
│ Suma        127,99 zł          ✓ zgadza się │
├─────────────────────────────────────────────┤
│ [Całość] [Kategorie] [Pozycje]              │
├─────────────────────────────────────────────┤
│ POZYCJE (8)                    [zaznacz ↕]  │
│  ☑ Mleko 3,2% 1L × 2          6,98          │
│     🍔 Zakupy spożywcze              97%    │
│  ☑ Proszek do prania         24,99          │
│     🧴 Chemia i higiena              88%    │
│  ☑ Baterie AA                 12,50         │
│     ⚠ Nowa kategoria: „Elektronika"         │
│        [Dodaj]  [Wybierz inną]              │
│  ☑ Chleb                       4,20         │
│     ❓ Niepewne dopasowanie          41%    │
│        🍔 Zakupy spożywcze        [zmień]   │
├─────────────────────────────────────────────┤
│ Zaznaczono 8 z 8 · 127,99 zł                │
└─────────────────────────────────────────────┘
```

Kluczowe decyzje projektowe:

- **Kontrola sumy.** Jeśli pozycje nie sumują się do odczytanej kwoty, wyświetlamy
  różnicę na czerwono i nie blokujemy zapisu — paragony mają rabaty i kaucje, których
  model może nie zinterpretować. Użytkownik rozstrzyga.
- **Pewność widoczna, nie ukryta.** Poniżej 60% pozycja dostaje znacznik `❓`
  i wyróżnione tło. Zaufanie do OCR buduje się przez pokazywanie, gdzie model się waha.
- **Propozycje nowych kategorii** są jednym dotknięciem od akceptacji (wymaganie #5) —
  a pominięcie propozycji nie blokuje zapisu.
- **Oryginał zawsze dostępny** — miniatura otwiera pełne zdjęcie z zoomem, żeby dało się
  zweryfikować odczyt bez sięgania po papier.
- Tryb **wyciągu bankowego** różni się listą: zamiast pozycji paragonu są operacje z datami,
  a te zbieżne z istniejącymi transakcjami mają plakietkę **„Możliwy duplikat"**
  i są domyślnie **odznaczone**.

**Stan po implementacji** (`F7-8`…`F7-10`, [ADR-060](./14-decisions-log.md#adr-060)):

- A: kafle „Zrób zdjęcie" (`capture="environment"`) i „Wybierz plik" (przy wyciągu
  i fakturze także PDF), rodzaj jako siatka opcji, „Ostatnie" — tytuł „Paragon · Lidl",
  data, stan („do przejrzenia · 8 poz.", „przetwarzanie…"), suma. Błąd wrzucenia pod
  kaflami; przy duplikacie „Otwórz dokument". `AI_ENABLED=false` — stan „Odczyt
  dokumentów jest wyłączony" z „Dodaj wydatek ręcznie", zakładka *Skan* ukryta.
- Zdjęcie skalowane w przeglądarce do 1568 px i kodowane jako JPEG przed wysyłką.
- B: `/scan/:id` z miniaturą i plakietką „Odczytuję pozycje…", tekst „zwykle 5–15
  sekund. Możesz wyjść…", „Wróć do skanu".
- C: nagłówek ✕ · tytuł · „Zatwierdź"; pola Sprzedawca / Data / Konto / Suma (z „zgadza
  się" albo „różnica") i — w trybie jednej transakcji — Kategoria; baner niezgodnej sumy;
  przełącznik „Jedna transakcja / Podziel na pozycje" (tylko paragon i faktura); lista
  z polami wyboru, „odznacz/zaznacz wszystkie", stopka „Zaznaczono X z Y" z sumą netto
  i „Odrzuć dokument". Linia kategorii pod pozycją otwiera arkusz korekty (opis, kwota,
  kategoria).
- Wyciąg: „Okres" zamiast sprzedawcy, „Data zapisu" (dla operacji bez daty), podpis
  operacji „11 wrz · NETFLIX.COM", plakietka „Możliwy duplikat" i odznaczenie.
- Nieudany odczyt: komunikat, „Spróbuj ponownie" (bez niego przy wyczerpanym limicie),
  „Dodaj wydatek ręcznie", „Usuń dokument". Zero pozycji: „Nie rozpoznano pozycji"
  z miniaturą i „Wpisz kwotę ręcznie". Zapisany / odrzucony — stan z „Wróć do skanu".
- Po zatwierdzeniu: toast „Zapisano: N transakcji" i przejście do miesiąca daty zapisu.

**Zmiany po wdrożeniu** ([ADR-069](./14-decisions-log.md#adr-069),
[ADR-070](./14-decisions-log.md#adr-070)):

- Przełącznik ma trzy opcje: „Całość" (`single`), „Kategorie" (`by_category`),
  „Pozycje" (`split`). Paragon z pozycjami w co najmniej dwóch kategoriach otwiera się
  w trybie „Kategorie"; pod przełącznikiem podgląd transakcji: kategoria i kwota każdej
  (07 §9.4). Zmiana kategorii pozycji od razu przelicza podgląd.
- Konto: wskazane w dokumencie → domyślne konto wydatków gospodarstwa → jedyne konto
  „na życie".
- Błąd przy „Zatwierdź" pokazuje się **pod nagłówkiem** (a nie na dole listy); brak
  konta dodatkowo otwiera wybór konta.

### 3.5 Cele — `/goals`

```
┌─────────────────────────────────────────────┐
│ Cele                                    [+] │
├─────────────────────────────────────────────┤
│ [Oszczędności] [Inwestycje]                 │
├─────────────────────────────────────────────┤
│ W TYM MIESIĄCU                              │
│  Zaplanowano 3 180  ·  wpłacono 3 180  ✓    │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ 🏠 Wkład własny                         │ │
│ │ 42 000,00 z 120 000,00 zł          35%  │ │
│ │ [███████░░░░░░░░░░░░░░]                 │ │
│ │ Plan: 2 000 zł/mies. = 17% wpływów      │ │
│ │ ✓ Wpłacono we wrześniu                  │ │
│ │ Przy tym tempie: grudzień 2029          │ │
│ │ ⚠ Cel na czerwiec 2028 → potrzeba 3 714 │ │
│ └─────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────┐ │
│ │ 🛡 Poduszka bezpieczeństwa              │ │
│ │ 18 000,00 z 30 000,00 zł           60%  │ │
│ │ [████████████░░░░░░░░]                  │ │
│ │ Plan: 10% wpływów = 1 180 zł            │ │
│ │ ⚠ Brak wpłaty we wrześniu   [Wpłać]     │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

**Przelicznik % ↔ kwota (wymaganie #6)** — sedno formularza celu:

```
┌─────────────────────────────────────────────┐
│ Miesięczna wpłata                           │
│                                             │
│   ┌──────────────────┐  ┌────────────────┐  │
│   │   2 000,00 zł    │⇄ │      17,0 %    │  │
│   └──────────────────┘  └────────────────┘  │
│        kwota                 wpływów        │
│                                             │
│   Podstawa: 11 800,00 zł (wrzesień)         │
│   ⓘ Miesiąc trwa — kwota może się zmienić   │
│                                             │
│   Tryb:  ◉ stała kwota   ○ procent wpływów  │
│                                             │
│   [1%] [5%] [10%] [15%] [20%] [25%]         │
└─────────────────────────────────────────────┘
```

Oba pola są edytowalne i przeliczają się nawzajem w locie (`POST /goals/convert`,
z opóźnieniem 300 ms). **Przełącznik trybu decyduje, co zostaje zapisane** i co jest
wyliczane w kolejnych miesiącach:

- *stała kwota* — co miesiąc 2 000 zł, procent zmienia się wraz z wpływami;
- *procent wpływów* — co miesiąc 17%, kwota zmienia się wraz z wpływami.

To rozróżnienie musi być widoczne, bo z niego wynika całe zachowanie celu w czasie.

**Ustalenia z `F5-5`, `F5-6`** ([ADR-054](./14-decisions-log.md#adr-054)):

- Zakładki „Oszczędności" / „Inwestycje"; „W tym miesiącu: zaplanowano · wpłacono" z celów
  aktywnych zakładki; karty w kolejności: aktywne, wstrzymane, osiągnięte.
- Karta: nazwa (otwiera arkusz edycji), kwota z docelowej i %, pasek puli, linia planu
  w obu stronach przelicznika, stan wpłaty w miesiącu, „Przy tym tempie: grudzień 2029",
  „⚠ Cel na czerwiec 2028 → potrzeba 3 714 zł/mies.", [Wpłać] — arkusz wpłaty z brakującą
  częścią planu, kontem na wydatki i kontem celu.
- Formularz: nazwa, rodzaj, kwota docelowa i termin, **miesięczna wpłata** (przelicznik,
  podstawa miesiąca, szybkie procenty, „Co zapisać"), postęp (wpłaty / saldo konta), konto
  celu, zebrane na start, przeznaczenie; przy edycji „Oznacz jako osiągnięty" i „Usuń cel".
  `/goals/:id` → lista z otwartym arkuszem.

### 3.6 Rozkład docelowy — `/allocation`

Realizacja wymagania #8 w pełnej postaci (na dashboardzie jest skrót).

```
┌─────────────────────────────────────────────┐
│ Rozkład docelowy                            │
├─────────────────────────────────────────────┤
│ ZAŁOŻENIA          obowiązują od: wrzesień  │
│                                             │
│  Oszczędności    [────●──────]  20%  2 360  │
│  Inwestycje      [──●────────]  10%  1 180  │
│  Spłata długu    [●──────────]   0%      0  │
│  ───────────────────────────────────────    │
│  Razem                          30%  3 540  │
│  Na życie zostaje               70%  8 260  │
│                                [Zapisz]     │
├─────────────────────────────────────────────┤
│ WRZESIEŃ — WYKONANIE                        │
│                                             │
│  Oszczędności   plan 2 360 · jest 2 000     │
│  [██████████████████░░░]  85%    −360       │
│                                             │
│  Inwestycje     plan 1 180 · jest 1 180     │
│  [████████████████████]  100%      ✓        │
│                                             │
│  ⚠ Do domknięcia planu brakuje 360,00 zł    │
│                            [Przelej teraz]  │
├─────────────────────────────────────────────┤
│ TREND                        [6 mies. ▾]    │
│   30%┤          ○   ●   ○   ●   ●           │
│   20%┤  ●   ●                               │
│   10%┤                                      │
│      └───┬───┬───┬───┬───┬───┬              │
│         kwi maj cze lip sie wrz             │
│      ● wykonanie   ○ plan                   │
└─────────────────────────────────────────────┘
```

Suwaki i pola procentowe są dwukierunkowe (procent ↔ kwota), tak jak przy celach.
Wiersz „Na życie zostaje" jest **wyliczany automatycznie** — pokazuje realny skutek
podniesienia celu i powstrzymuje przed ustawieniem 60% oszczędności „bo ładnie wygląda".

Zmiana rozkładu zapisuje się z datą `effectiveFromMonth`, więc historia poprzednich
miesięcy nie ulega zafałszowaniu.

**Ustalenia z `F5-7`** ([ADR-054](./14-decisions-log.md#adr-054)): suwaki natywne co 0,5%
z kwotą z bieżących wpływów; „Obowiązuje od" — bieżący albo następny miesiąc; „Zapisz"
aktywne po zmianie (albo gdy rozkładu nie ma). Wykonanie z paskiem realizacji, udziałem
we wpływach (`—` bez wpływów) i oceną słowną; „Przelej teraz" jak „Uzupełnij". Trend —
lista sześciu miesięcy („27,0% z 30,0%", „bez planu"); wykres liniowy w `F8-5`.

**Wykres trendu (`F8-5`, [ADR-063](./14-decisions-log.md#adr-063)):** wykonanie (linia
ciągła ze znacznikami) na tle planu (przerywana), przerwa w miesiącu bez wpływów, oś pod
zero przy wypłatach ponad wpłaty; wiersz nad wykresem pokazuje dotknięty miesiąc
(domyślnie bieżący), legenda i podpisy końców linii. Lista miesięcy zostaje pod
„Miesiąc po miesiącu" jako widok tabeli.

### 3.7 Konta — `/accounts`

```
┌─────────────────────────────────────────────┐
│ Konta                                   [+] │
├─────────────────────────────────────────────┤
│ MAJĄTEK NETTO              68 432,10 zł     │
│ aktywa 100 432,10 − zobowiązania 32 000,00  │
├─────────────────────────────────────────────┤
│ NA BIEŻĄCE WYDATKI                8 772,10  │
│  💳 ROR mBank                     8 432,10 ›│
│  💵 Gotówka                         340,00 ›│
├─────────────────────────────────────────────┤
│ OSZCZĘDNOŚCI                     60 000,00  │
│  🏠 Konto mieszkaniowe           42 000,00 ›│
│  🛡 Poduszka                     18 000,00 ›│
├─────────────────────────────────────────────┤
│ INWESTYCJE                       31 660,00  │
│  📈 IKE                          18 000,00 ›│
│  📊 Konto maklerskie             13 660,00 ›│
└─────────────────────────────────────────────┘
```

Grupowanie po `allocationClass`, nie po `type` — bo to klasa decyduje o celach
procentowych i to ona jest istotna przy podejmowaniu decyzji.

Szczegóły konta (`/accounts/:id`): saldo, wykres zmian w 12 miesiącach, historia
transakcji konta, edycja, archiwizacja.

Formularz nowego konta jest krótki: nazwa, typ (ikony do wyboru), saldo początkowe,
data. `allocationClass` podpowiada się z typu; pole do nadpisania jest w sekcji
„Zaawansowane" z wyjaśnieniem, do czego służy.

**Stan po `F2-6`** ([ADR-036](./14-decisions-log.md#adr-036))

- Lista: majątek netto (`aktywa − zobowiązania` pod spodem), grupy po puli z sumą
  z `totalsByClass`, puste grupy pominięte. Wiersz: ikona rodzaju, nazwa, podpis
  (instytucja · ruch w bieżącym miesiącu ze znakiem · plakietka „w archiwum"), saldo.
- Konto z archiwum z saldem ≠ 0 zostaje w swojej grupie z plakietką (wciąż wchodzi do
  majątku, 07 §7); z zerowym — w sekcji „Archiwum" na dole. Każde konto jest raz.
- Cztery stany: szkielet, pusto („Dodaj konto"), błąd z ponowieniem, treść.
- Formularz w arkuszu: nazwa, rodzaj (siatka 3 × 2), saldo początkowe jako tekst
  z przecinkiem + przełącznik „Saldo ujemne" (klawiatura dziesiętna iOS nie ma minusa),
  data. „Zaawansowane": pula (podgląd reguły 07 §2.1 na żywo), bank, udział w majątku.
  Pula idzie do API tylko wybrana ręcznie. Po zapisie zostajemy na liście.
- Nazwy rodzajów to przymiotniki („Oszczędnościowe", „Inwestycyjne"), nazwy pul —
  rzeczowniki („Oszczędności", „Inwestycje"); to dwie różne rzeczy.
- Szczegóły `/accounts/:id`: saldo na dziś, dane konta, Edytuj / Archiwizuj (Przywróć) /
  Usuń. Usunięcie z potwierdzeniem w treści ekranu, nie w arkuszu; `409` (konto ma
  transakcje) pokazuje komunikat serwera.
- **Jeszcze nie ma:** wykres zmian w 12 miesiącach (brak trasy API — `Z-19`) i historii
  transakcji konta (dojdzie z listą w `F2-8` jako `?accountId=`).

### 3.8 Zobowiązania — `/liabilities`

```
┌─────────────────────────────────────────────┐
│ Zobowiązania                            [+] │
├─────────────────────────────────────────────┤
│ RAZEM DO SPŁATY                 301 500,00  │
│ Miesięcznie                       2 350,00  │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ 🏠 Kredyt hipoteczny · mBank            │ │
│ │ Zostało        301 500,00 zł            │ │
│ │ [█░░░░░░░░░░░░░░░░░░░]  5,8% spłacone   │ │
│ │ Rata 1 850,00 · 163 raty · do IV 2040   │ │
│ │ ✓ Zapłacono we wrześniu (10 wrz)        │ │
│ └─────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────┐ │
│ │ 📱 Telefon na raty · Play               │ │
│ │ Zostało          2 500,00 zł            │ │
│ │ [████████████░░░░░░░░]  58% spłacone    │ │
│ │ Rata 500,00 · 5 rat · do II 2027        │ │
│ │ ⚠ Rata na 20 wrz       [Zaksięguj]      │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

Formularz odpowiada wprost wymaganiu #2: **nazwa, pozostała kwota, miesięczna rata,
okres spłaty**. Trzy ostatnie są powiązane — wpisanie dwóch wylicza trzecie:

```
│ Pozostało do spłaty    [ 301 500,00 ]       │
│ Miesięczna rata        [   1 850,00 ]       │
│ Liczba rat             [ 163 ]  ⓘ wyliczone │
│ Dzień płatności        [ 10 ]               │
│ ☑ Utwórz pozycję cykliczną na ratę          │
```

Checkbox tworzący regułę cykliczną jest domyślnie zaznaczony — rata to modelowy
przykład wydatku stałego i nie ma powodu wpisywać jej dwa razy.

**Ustalenia z `F4-6`** ([ADR-049](./14-decisions-log.md#adr-049)):

- Lista: „Razem do spłaty" (kolor długu) i „miesięcznie"; sekcja *Spłacane* z kartami
  i *Zamknięte* jako zwykłe wiersze. Karta: nazwa · wierzyciel (odnośnik do szczegółów),
  „Zostało", pasek spłaty w kolorze długu z „N% spłacone" pod spodem, „Rata … · N rat ·
  do IV 2040", linia stanu raty: „✓ Zapłacono we wrześniu (10 wrz)", „Rata na 20 wrz",
  „⚠ Rata po terminie — 10 wrz", „Dzień raty nieznany", „Spłacone — możesz je zamknąć".
- **„Zaksięguj" jednym dotknięciem** (bez arkusza): rata z warunków, dziś, konto płatności —
  albo czekające wystąpienie reguły raty (ADR-047). Toast z „Cofnij", które usuwa
  transakcję. Klucz `Idempotency-Key` na każde dotknięcie.
- Formularz „dwa z trzech": pole wyliczane ma podpis „ⓘ wyliczone…" i wartość z dwóch
  pozostałych; wpisanie w nie przenosi wyliczanie na pole dotknięte najdawniej. Gdy
  ostatnia rata jest niepełna, podpis ją rozpisuje („ⓘ 10 × 97,00 zł, ostatnia 9,00 zł") —
  samo „11" przy 979 / 97 wyglądało na błąd rachunku. Dalej:
  „Na dzień", dzień płatności, **„Najbliższa rata"** (opcjonalna data — spłata od
  listopada albo rata z tego miesiąca już zapłacona; puste — pierwszy dzień płatności po
  „Na dzień", [ADR-068](./14-decisions-log.md#adr-068)), konto płatności, kategoria raty,
  przełącznik reguły (tylko przy zakładaniu), notatka.
- Szczegóły `/liabilities/:id`: zostało, pasek, stan raty z „Zaksięguj ratę"; *Warunki*
  (z odnośnikiem do pozycji cyklicznej raty); *Zaksięgowane raty* (do 24, dotknięcie →
  transakcja); *Harmonogram* — sześć rat i „i N rat dalej"; *Działania*: Edytuj,
  „Zaktualizuj stan z wyciągu" (arkusz: kwota, dzień, notatka), „Zamknij — spłacone" /
  „Otwórz ponownie", usunięcie z potwierdzeniem.

### 3.9 Pozycje cykliczne — `/recurring`

```
┌─────────────────────────────────────────────┐
│ Cykliczne                               [+] │
├─────────────────────────────────────────────┤
│ Miesięcznie: −6 450 wydatki · +9 800 wpływy │
│              −3 000 odkładane               │
├─────────────────────────────────────────────┤
│ WYDATKI STAŁE                    4 950,00   │
│  🏠 Czynsz            1 850,00  10. dnia ●  │
│  ⚡ Prąd (szac.)        280,00  15. dnia ●  │
│  📶 Internet            89,00   20. dnia ●  │
│  🎬 Netflix             43,00    8. dnia ●  │
├─────────────────────────────────────────────┤
│ ODKŁADANIE                       3 000,00   │
│  🏠 → Mieszkaniowe    2 000,00  11. dnia ●  │
│  📈 → IKE             1 000,00   5. dnia ●  │
│      auto-księgowanie                       │
├─────────────────────────────────────────────┤
│ WPŁYWY                           9 800,00   │
│  💰 Wynagrodzenie     9 800,00  10. dnia ●  │
├─────────────────────────────────────────────┤
│ WSTRZYMANE                                  │
│  🏋 Siłownia            120,00           ○  │
└─────────────────────────────────────────────┘
```

Przełącznik `●`/`○` wstrzymuje regułę bez usuwania. Sekcja „Odkładanie" grupuje reguły
przelewające pieniądze na konta oszczędnościowe i inwestycyjne — to one realizują
wymaganie #9 w części dotyczącej oszczędności i inwestycji.

Plakietka „szac." przy kwocie oznacza `amountIsEstimate` — przy księgowaniu aplikacja
zapyta o rzeczywistą kwotę zamiast przyjąć planowaną.

**Ustalenia z `F4-5`** ([ADR-048](./14-decisions-log.md#adr-048)):

- Grupy: *Wydatki stałe*, *Inne wydatki* (wydatek bez „stały"), *Odkładanie* (przelew na
  konto oszczędnościowe albo inwestycyjne, albo z nadpisaniem alokacji na te pule),
  *Przelewy* (pozostałe), *Wpływy*, *Wstrzymane*. Puste grupy są pomijane.
- „Miesięcznie" i sumy grup to **miesięczne odpowiedniki**: tydzień × 52/12, dwa tygodnie
  × 26/12, kwartał / 3, rok / 12, co N / N — zaokrąglone per reguła. Gdy któraś aktywna
  reguła nie jest miesięczna, nagłówek brzmi „Miesięcznie (średnio)" z wyjaśnieniem.
  Wstrzymane nie mają sumy.
- Wiersz: ikona rodzaju, nazwa, podpis z terminarzem („10. dnia", „co roku, 14 marca",
  „co tydzień, we wtorek") i „auto-księgowanie", kwota z plakietką „szac.", przełącznik
  **obok** przycisku wiersza (nie w nim). Przełącznik działa od razu (optymistycznie),
  błąd przywraca stan i pokazuje toast.
- Dotknięcie wiersza i `[+]` otwierają arkusz formularza: zakładki rodzaju (tylko nowa),
  nazwa, kwota z klawiaturą, „Kwota szacunkowa", pola wyboru z formularza transakcji
  (kategoria, źródło, konta), częstotliwość, pola terminarza zależne od niej, okres
  „Od miesiąca" / „Do miesiąca", podgląd trzech najbliższych terminów, „Wydatek stały",
  „Księguj automatycznie", notatka, „Usuń pozycję" z potwierdzeniem.
- `/recurring/:id` przekierowuje na `/recurring` z otwartym arkuszem tej reguły — adres
  szczegółów jako osobny wpis historii ścigałby się z arkuszem, który sam przechwytuje
  „wstecz" (15 §4.6).

### 3.10 Planowane wydatki — `/planned`

Realizacja wymagania #13. Dostępne z zakładki *Więcej* oraz z kafla na dashboardzie.

```
┌─────────────────────────────────────────────┐
│ Planowane wydatki                       [+] │
├─────────────────────────────────────────────┤
│ NAJBLIŻSZE 6 MIESIĘCY             5 200,00  │
│ Odłożone                          1 300,00  │
│ Odkładaj miesięcznie                645,00  │
│ [███████░░░░░░░░░░░░░░░░░]  25% pokrycia    │
├─────────────────────────────────────────────┤
│ ⚠ W marcu zabraknie 500,00 zł               │
│   OC wypada 14 marca · prognoza 1 900,00    │
│                        [Zwiększ odkładanie] │
├─────────────────────────────────────────────┤
│ LISTOPAD 2026                       800,00  │
│ ┌─────────────────────────────────────────┐ │
│ │ 🔧 Przegląd + wymiana opon              │ │
│ │ ~800,00 zł · za 2 miesiące   ⬤ ważne    │ │
│ │ Odłożone 800,00 / 800,00        ✓ 100%  │ │
│ │ [████████████████████]                  │ │
│ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│ MARZEC 2027                       2 400,00  │
│ ┌─────────────────────────────────────────┐ │
│ │ 🚗 OC + AC samochód          🔁 co rok  │ │
│ │ ~2 400,00 zł · 14 mar        ⬤ konieczne│ │
│ │ Odłożone 800,00 / 2 400,00        33%   │ │
│ │ [███████░░░░░░░░░░░░░]                  │ │
│ │ Odkładaj 266,67 zł/mies.                │ │
│ │ ○ Wpłata za wrzesień      [Odłóż teraz] │ │
│ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│ LIPIEC 2027                       2 000,00  │
│ ┌─────────────────────────────────────────┐ │
│ │ ✈ Wakacje                               │ │
│ │ ~2 000,00 zł                 ○ opcjonalne│ │
│ │ Bez odkładania          [Włącz odkładanie]│
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

Grupowanie **po miesiącu terminu**, rosnąco — najbliższe u góry. Nagłówek grupy niesie
sumę miesiąca, bo to ona decyduje o obciążeniu budżetu.

**Formularz** (arkusz):

```
│ Nazwa           [ OC + AC samochód        ] │
│ Szacowana kwota [ 2 400,00 zł             ] │
│                 ☑ to tylko szacunek         │
│ Kiedy           [ marzec 2027 ▾ ]           │
│                 ☑ znam dokładną datę        │
│                 [ 14 marca 2027 ]           │
│ Kategoria       [ Ubezpieczenie OC/AC    › ] │
│ Ważność         ( ) opcjonalne              │
│                 (•) planowane               │
│                 ( ) konieczne               │
│ ─────────────────────────────────────────── │
│ ☑ Odkładaj co miesiąc                       │
│   Gdzie      [ Poduszka bezpieczeństwa  › ] │
│   Już mam    [ 0,00 zł                    ] │
│   ⓘ Trzeba odkładać 266,67 zł przez 9 mies. │
│ ─────────────────────────────────────────── │
│ ☑ Powtarzaj co rok                          │
│   ⓘ Po zapłacie utworzymy wpis na marzec    │
│     2028 z faktycznie zapłaconą kwotą.      │
```

Wiersz „Trzeba odkładać X przez N miesięcy" przelicza się **na żywo** przy każdej zmianie
kwoty lub terminu. To jest właściwa odpowiedź na pytanie, które użytkownik zadaje sobie,
dodając taki wydatek — i musi być widoczna zanim zapisze, a nie dopiero po.

**Na dashboardzie miesiąca** (sekcja między „Do zrobienia" a „Na co idą pieniądze"):

```
├─────────────────────────────────────────────┤
│ NADCHODZĄCE                      [wszystkie]│
│  🚗 OC samochód      2 400,00   za 6 mies.  │
│     odłożone 33%  ·  odkładaj 266,67/mies.  │
│     ○ Wrzesień           [Odłóż 266,67]     │
│  🔧 Przegląd           800,00   za 2 mies.  │
│     odłożone 100%                     ✓     │
│  ⚠ W marcu zabraknie 500,00 zł              │
└─────────────────────────────────────────────┘
```

Sekcja jest ukryta, gdy nie ma żadnych planowanych wydatków — pusty kafel na głównym
ekranie byłby szumem.

**Zachowanie w miesiącu terminu:** wydatek przechodzi w status `ready` i pojawia się
w sekcji „Do zrobienia" obok wystąpień cyklicznych, z przyciskiem **„Zapłacone"**
otwierającym formularz z wpisaną kwotą szacunkową do skorygowania.

**Odróżnienie od pozycji cyklicznych w UI.** Dwie osobne zakładki w *Więcej*:
*Cykliczne* (powtarzalne, stała kwota) i *Planowane* (jednorazowe, szacunek, odkładanie).
Przy dodawaniu pozycji cyklicznej z częstotliwością roczną pojawia się podpowiedź:
„Dla nieregularnych wydatków jak OC lepiej sprawdzą się Planowane wydatki — pozwalają
odkładać co miesiąc. [Utwórz tam zamiast tego]".

**Ustalenia z `F6-6`…`F6-9`** ([ADR-056](./14-decisions-log.md#adr-056)):

- Podsumowanie: „Wypada", „Odłożone", „Odkładaj miesięcznie" i pasek pokrycia. Rata łączna
  liczy każdy wydatek z odkładaniem, także za horyzontem sześciu miesięcy.
- Ostrzeżenia prognozy pod podsumowaniem, z przyciskiem, gdy dotyczą jednego wydatku:
  „Odłóż zaległe" (kwota luki) albo „Włącz odkładanie" (formularz).
- Karta: nazwa (dotknięcie → formularz), „co rok", `~kwota · termin`, ważność
  (opcjonalne / planowane / konieczne); przy odkładaniu „Odłożone X / Y", %, pasek,
  „Odkładaj X/mies.", „○ Wpłata za wrzesień [Odłóż teraz]" albo „✓"; bez odkładania —
  „Bez odkładania [Włącz odkładanie]"; w miesiącu terminu — „[Zapłacone]".
- Formularz: „Gdzie" (konto) i „Na cel"; „Już mam" jako pole tekstowe; wiersz raty na
  żywo; „Odwołaj wydatek" i „Usuń" z potwierdzeniem.
- „Nadchodzące": do trzech najbliższych (także za horyzontem), odległość do terminu,
  pokrycie i rata, „Odłóż X" tylko w miesiącu bieżącym, ostrzeżenia na dole.
- „Utwórz tam zamiast tego" tylko przy nowej regule wydatku; przenosi nazwę, kwotę,
  kategorię i najbliższy miesiąc roku.
- Jeszcze nie ma: ekranu szczegółów z historią odkładania (`Z-36`), przycisku
  „Przesuń termin" (`Z-37`).

### 3.11 Kategorie — `/settings/categories`

Lista drzewiasta z licznikiem użyć i sumą wydatków w bieżącym miesiącu. Kategorie
systemowe nie dają się usunąć (tylko zarchiwizować) — mówi o tym arkusz; plakietkę „własna" na liście mają kategorie dodane przez domowników, bo seed oznacza jako systemowe wszystkie 94 (`Z-25`, ADR-042).

Formularz kategorii zawiera pole **„Podpowiedzi dla AI"** z wyjaśnieniem:

```
│ Podpowiedzi dla AI                          │
│ ┌─────────────────────────────────────────┐ │
│ │ Biedronka, Lidl, Żabka, Kaufland        │ │
│ └─────────────────────────────────────────┘ │
│ ⓘ Nazwy sklepów i słowa z paragonów.        │
│   Im więcej podasz, tym trafniej AI         │
│   przypisze wydatki do tej kategorii.       │
```

To bezpośrednio steruje jakością wymagania #4 i warto, żeby użytkownik o tym wiedział.

**Ustalone przy `F2-9`** ([ADR-038](./14-decisions-log.md#adr-038)):

- Zakładki Wydatki / Przychody / Przelewy, rodzaj w adresie (`?kind=income`).
- Licznik to transakcje ze wszystkich miesięcy (bez kosza), kwota — z bieżącego miesiąca
  (`GET /categories/usage`). Kategoria główna pokazuje sumę razem z podkategoriami;
  zerowa kwota się nie pokazuje, „nieużywana" zamiast „0 transakcji".
- Zarchiwizowane — w osobnej sekcji „Archiwum" na dole, z nazwą rodzica.
- Arkusz: nazwa, podpowiedzi dla AI (pole wielowierszowe z wyjaśnieniem), „Należy do"
  zwinięte do jednego wiersza (kategoria z podkategoriami go nie ma — 04 §6), potem
  „Działania": scalenie z wyborem celu (tylko własne, bez podkategorii), archiwizacja
  z „Cofnij" / przywrócenie, usunięcie z potwierdzeniem w treści (tylko własne; `409`
  z komunikatem serwera, gdy są transakcje).
- Ikony i kolory kategorii — bez edycji, dopóki seed ich nie ma (`Z-22`).

### 3.12 Ustawienia — `/settings`

Sekcje: **Gospodarstwo** (nazwa, waluta, strefa czasowa, dzień startu miesiąca, limit
księgowania wstecz), **Użytkownicy** (dwie osoby, zmiana PIN-u, aktywne sesje),
**Kategorie**, **Źródła przychodu**, **Dane** (eksport JSON/CSV, informacja o kopiach),
**AI** (zużycie i koszt OCR w tym miesiącu, limit miesięczny), **O aplikacji** (wersja).

**Stan po `F8-1`/`F8-2`** ([ADR-061](./14-decisions-log.md#adr-061)):

- **Gospodarstwo** — wiersze: nazwa, strefa czasowa, „Wstecz: 1 miesiąc wstecz"
  z „Księgowanie od 1 sierpnia 2026", waluta z dopiskiem „Miesiąc od 1. dnia · stałe
  w tej wersji". „Zmień" (i dotknięcie wiersza) otwiera arkusz: nazwa, strefa (pole
  tekstowe + „Użyj strefy tego urządzenia"), limit wstecz jako siatka Brak/1/2/3/6/12.
  Wiersz **„Konto do wydatków"** otwiera wybór konta z opcją „Bez domyślnego" i zapisuje
  od razu ([ADR-070](./14-decisions-log.md#adr-070)); konto proponują formularze
  transakcji i przegląd skanu.
  **Skutek zmiany limitu widać przed zapisem**: obniżenie — ostrzeżenie „Transakcji
  sprzed 1 września 2026 nie da się już zmienić ani usunąć…", podniesienie — „Znów da
  się dopisywać i poprawiać transakcje od…".
- **Domownicy** — obie osoby z inicjałami, e-mailem i plakietką „Ty"; własny wiersz
  otwiera profil (nazwa). „Zmień PIN" (obecny, nowy, powtórzenie; reguły słabych PIN-ów
  przed wysłaniem; po zmianie „PIN zmieniony. Wylogowano N innych urządzeń."),
  „Urządzenia" (lista sesji, „Wyloguj" przy każdym poza bieżącym, „Wyloguj wszędzie"
  z potwierdzeniem).
- **Porządek** — „Kategorie" i „Źródła przychodu" (`/settings/income-sources`: aktywne
  i archiwum; arkusz z nazwą, rodzajem, „Czyje" — Wspólne albo domownik, „Liczy się do
  celów procentowych", archiwizacją i usunięciem z potwierdzeniem).
- **Dane** — „Kopia wszystkich danych" (JSON), „Transakcje: <miesiąc>" i „Wszystkie
  transakcje" (CSV); pod spodem informacja o nocnych kopiach serwera i o tym, że plik
  JSON zawiera pełny obraz finansów. Na końcu sekcji przycisk **„Usuń wszystkie dane"**
  (`ghost`, tekst `--danger`) — otwiera arkusz „Usunąć wszystkie dane?": co znika, co
  zostaje (domownicy i PIN-y, ustawienia, kategorie domyślne), ostrzeżenie z radą, by
  najpierw pobrać kopię JSON, pole „Twój PIN" i jedyny na ekranie przycisk `danger`.
  Zły PIN — komunikat przy polu, arkusz zostaje; po usunięciu toast „Dane usunięte:
  N transakcji, M kont." i pamięć zapytań wyczyszczona — ekrany pokazują stany puste
  ([ADR-072](./14-decisions-log.md#adr-072)).
- **Odczyt dokumentów (AI)** — koszt w miesiącu z limitem i procentem, liczba
  dokumentów, model; wyczerpany limit — ostrzeżenie; `AI_ENABLED=false` — wyjaśnienie.
  Sekcja ma własne stany, żeby awaria zużycia nie zasłaniała ustawień.
- **O aplikacji** — wersja, „Zainstaluj aplikację" (gdy przeglądarka daje
  `beforeinstallprompt`; na iPhonie instrukcja „Udostępnij → Do ekranu początkowego"),
  „Wyloguj".
- **Wygląd** — motyw: Ciemny / Jasny / Systemowy (siatka opcji). Ustawienie urządzenia,
  nie gospodarstwa, więc sekcja stoi poniżej treści także w stanie ładowania i błędu
  ([ADR-067](./14-decisions-log.md#adr-067)).
- Kolor awatara — bez interfejsu (`Z-43`).

### 3.13 Logowanie — `/login`

```
┌─────────────────────────────────────────────┐
│                                             │
│                  FineApp                    │
│                                             │
│   ┌─────────────────────────────────────┐   │
│   │ ja@example.com                      │   │
│   └─────────────────────────────────────┘   │
│                                             │
│            ● ● ● ● ○ ○                      │
│                                             │
│              ┌───┬───┬───┐                  │
│              │ 1 │ 2 │ 3 │                  │
│              ├───┼───┼───┤                  │
│              │ 4 │ 5 │ 6 │                  │
│              ├───┼───┼───┤                  │
│              │ 7 │ 8 │ 9 │                  │
│              ├───┼───┼───┤                  │
│              │   │ 0 │ ⌫ │                  │
│              └───┴───┴───┘                  │
│                                             │
│        ☑ Zapamiętaj to urządzenie           │
└─────────────────────────────────────────────┘
```

Adres e-mail jest zapamiętywany lokalnie (`localStorage`), więc przy kolejnym wejściu
widać od razu klawiaturę PIN. Po wpisaniu kompletu cyfr logowanie startuje automatycznie.
Komunikat błędu jest **jednakowy** dla złego e-maila i złego PIN-u (patrz [09](./09-security-auth.md)).

### 3.14 Planer budżetu — `/budget`, `/budget/:month`

> **Faza 9 — zrobione** (`F9-6`…`F9-9`; ustalenia poniżej). Opis funkcji:
> [16](./16-budget-planner.md), reguły: [07 §13](./07-domain-rules.md#13-planer-budżetu),
> decyzje: [ADR-079](./14-decisions-log.md#adr-079).

Wymaganie #14. Wejście: *Więcej → Budżet* (pasek boczny na desktopie), podpowiedź na
dashboardzie i odnośnik w podglądzie przyszłego miesiąca. Bez nowej zakładki
w dolnym pasku — planuje się raz w miesiącu, a pasek ma pięć miejsc na rzeczy
codzienne.

**`/budget`** — lista: kafel `suggestedMonth` („Zaplanuj listopad 2026 →") nad listą
istniejących szkiców (miesiąc, „Zostaje X", liczba ostrzeżeń). Dotknięcie →
`/budget/:month`. Bez szkiców — sam kafel z krótkim zdaniem, po co jest planer.

**`/budget/:month`** — szkic:

```
┌─────────────────────────────────────────────┐
│ ‹  listopad 2026  ›                   [⋯]  │ ← przełącznik jak na Miesiącu; ⋯ = Odśwież,
├─────────────────────────────────────────────┤   Skopiuj linie z…, Notatka, Usuń szkic
│ PLAN                                        │
│  Wpływy                      11 800,00      │
│  Wydatki                      8 214,00      │
│  Oszczędności                 2 170,00      │
│  Inwestycje                   1 180,00      │
│  ───────────────────────────────            │
│  Zostaje                        236,00      │
│                                             │
│  Oszczędności  18,4% z 20%  [████████░]     │
│  Inwestycje    10,0% z 10%  [█████████] ✓   │
│  ⚠ Do planu oszczędności brakuje 190,00 zł  │
│                   [Dodaj brakujące 190 zł]  │
├─────────────────────────────────────────────┤
│ CELE I ODKŁADANIE                           │
│  🏠 Wkład własny     2 000 / 2 000     ✓    │
│  🛡 Poduszka             0 / 300    ⚠ −300  │
│  🚗 Odkładanie: OC     170,00 / 170,00  ✓   │
├─────────────────────────────────────────────┤
│ WPŁYWY                          11 800,00   │
│  🔁 Wynagrodzenie AK             9 800,00   │
│  🔁 Wynagrodzenie BN             2 000,00   │
│                                [+ Dodaj]    │
├─────────────────────────────────────────────┤
│ WYDATKI                          8 214,00   │
│  🔁 Czynsz                       1 850,00   │
│  🔁 Rata kredytu                 1 850,00   │
│  📅 Przegląd + opony               800,00   │
│  ≈  Jedzenie                     1 900,00   │
│     średnia 3 mies. 1 874,00               │
│  ≈  Transport                      642,00   │
│  ≈  Dom                            723,00   │
│  ✎  Prezent dla mamy               300,00   │
│  🔁 Siłownia                       149,00   │
│     ⓘ W regule teraz 159,00 zł  [Przyjmij]  │
│                                [+ Dodaj]    │
├─────────────────────────────────────────────┤
│ OSZCZĘDNOŚCI I INWESTYCJE        3 350,00   │
│  🎯 Wkład własny                 2 000,00   │
│  📅 Odkładanie: OC                 170,00   │
│  🔁 IKE                          1 180,00   │
│                                [+ Dodaj]    │
├─────────────────────────────────────────────┤
│ ▸ Pominięte w planie (1)                    │ ← zwinięte; Netflix [Przywróć]
└─────────────────────────────────────────────┘
```

- **Ikona pochodzenia** przed nazwą — tekstem dla czytnika („pozycja cykliczna",
  „planowany wydatek", „cel", „ze średniej", „własna"); kolor nigdy jedynym nośnikiem.
  Ikony z zestawu z 15 §6, nie emoji — szkic powyżej to tylko schemat.
- **Kwoty** wyłącznie przez `<Money>`; linia ujemna („Z odłożonego: OC") z minusem
  typograficznym. „Zostaje" ujemne — „Na minusie" w `--danger`, jak na dashboardzie.
- **Dotknięcie linii** → arkusz linii. **Przesunięcie w lewo** → „Usuń" / „Pomiń"
  (powiązana); gest nigdy jedyną drogą — ta sama akcja jest w arkuszu.
- **„+ Dodaj"** w sekcji → arkusz nowej linii z ustawionym `flow`.
- **„Dodaj brakujące"** dopisuje linię własną („Uzupełnienie oszczędności") z kwotą
  niedoboru — jedno dotknięcie, toast z „Cofnij".
- Sekcja „Cele i odkładanie" tylko, gdy jest co oceniać.

**Arkusz linii:**

```
│ Nazwa         [ Jedzenie                  ] │
│ Kwota         [ 1 900,00 zł               ] │
│               Średnia: 3 mies. 1 874 · 6 mies. 1 790 · 12 mies. 1 812
│               [Użyj 1 874]                  │ ← tylko kategorie wydatków
│ Kategoria     [ Jedzenie                 › ] │
│ Dzień         [ — ]                         │ ← opcjonalny, podpowiedź do zamiany
│ ─────────────────────────────────────────── │
│ Zamień w…                                   │ ← tylko linia własna (canPromote)
│   [🔁 Pozycję cykliczną]  [📅 Planowany wydatek]
│ ─────────────────────────────────────────── │
│ Usuń z planu                                │
```

Dla linii powiązanej zamiast „Zamień w…" — blok **„Powiązane z: Czynsz (cykliczne)"**
z kwotą w źródle, odnośnikiem do źródła i — gdy `canApplyToSource` — przyciskiem
**„Zapisz w regule"**, który najpierw pokazuje skutek: „Od grudnia 2026: 1 950,00 zł.
Do listopada zostaje 1 850,00 zł." (`rule_split`) albo „Zmieni kwotę reguły od
bieżącego miesiąca." (`rule_updated`). Linia osierocona: „Źródło usunięto" +
[Zostaw jako własną] [Usuń].

**Zamiana** otwiera drugi krok arkusza z polami z formularza reguły (06 §3.9)
albo planowanego wydatku (06 §3.10) — te same komponenty, wypełnione z linii. Po
zapisie toast: „Dodano do pozycji cyklicznych" / „Dodano do planowanych na luty 2027"
z odnośnikiem.

**Stan pusty szkicu** (404): „Brak planu na listopad 2026" i trzy przyciski:
**[Utwórz z danych]** (podstawowy) · [Skopiuj z października] (gdy szkic istnieje) ·
[Zacznij od zera]. „Utwórz z danych" → arkusz: przełącznik „Pozycje cykliczne, raty,
planowane i cele" (domyślnie włączony), okno średniej (3 / 6 / 12), lista kategorii
z średnią do zaznaczenia (nic domyślnie zaznaczone), opcjonalnie „Linie własne z:
październik".

**Stany:** ładowanie — szkielet sekcji; pusto — jak wyżej; błąd — komunikat
z „Spróbuj ponownie"; treść. Szkic minionego miesiąca — baner „Plan zakończonego
miesiąca — tylko do odczytu", bez „+ Dodaj" i bez arkuszy edycji.

**Plan kontra wykonanie** (`F9-9`, miesiąc bieżący i miniony): przy każdej linii
z wykonaniem drugi wiersz „wydano 1 450,00 · zostało 450,00" (albo „ponad plan
120,00" w `--warning`) i cienki pasek; w podsumowaniu kolumna „Wykonanie"; na dole
wiersz „Poza planem 320,00 zł" z odnośnikiem do historii miesiąca. Grupa dwóch linii
tej samej kategorii ma jedno wykonanie pod nagłówkiem grupy (07 §13.8).

**Ustalenia z `F9-6`** (`features/budget/`):

- Zamiast menu „⋯" w nagłówku — przycisk ikonowy „Odśwież ze źródeł" (tylko szkic
  edytowalny); „Usuń plan" na dole ekranu, z arkuszem potwierdzenia. Notatka i „Skopiuj
  linie z…" w istniejącym szkicu — razem z arkuszami w `F9-7`.
- Stan pusty: „Utwórz z danych" zakłada szkic od razu (wszystkie źródła, bez średnich);
  arkusz wyboru kategorii ze średnią dochodzi w `F9-7`. „Skopiuj z …" — z najbliższego
  wcześniejszego planu, gdy taki istnieje. Miesiąc miniony bez planu: „Nie było planu na
  …"; dalej niż +12: „Za wcześnie na plan na …" z zakresem.
- Ostrzeżenia z „Dodaj brakujące" tylko przy niedoborze puli oszczędności / inwestycji
  i celu; odkładanie i dług — bez przycisku (mają własne linie do poprawienia).
- Sekcja z pustą listą pokazuje „Brak pozycji." — „+ Dodaj" i dotknięcie wiersza
  (arkusz linii) dochodzą w `F9-7`.
- Lista `/budget`: wiersz planu — miesiąc, „N pozycji · M ostrzeżeń", kwota „Zostaje".
- Sprawdzone w Chromium na 390 × 844 w obu motywach na prawdziwym API (pensja, czynsz,
  edytowana siłownia, przelew na poduszkę, OC z odkładaniem, cel, rozkład 30/10):
  bez poziomego przepełnienia; małe przyciski 36 px z obszarem dotyku 44 px (ADR-073).

**Ustalenia z `F9-7`** (`features/budget/components/`):

- **„+ Dodaj"** — przycisk ikonowy „+" przy sumie w nagłówku każdej sekcji (tylko szkic
  edytowalny). W sekcji pul arkusz pyta najpierw o pulę (Oszczędności / Inwestycje).
- **Arkusz linii** (`budget-line-sheet.tsx`, otwierany dotknięciem wiersza): nazwa,
  kwota, kategoria (dla pul — cel), opcjonalny dzień w miesiącu planu. Przy wydatku
  z kategorią — „Średnia wydatków w kategorii": trzy przyciski 3 / 6 / 12 mies. z kwotą;
  dotknięcie wpisuje kwotę i zapamiętuje okno. Zapis wysyła tylko zmienione pola.
- Linia własna: „Zamień w…" → „Pozycję cykliczną" / „Planowany wydatek" — formularz
  w tym samym arkuszu (`budget-promote-form.tsx`): terminarz i konto jak w regule
  (pula — także konto docelowe), albo miesiąc, dokładna data i ważność jak w planowanym
  wydatku. Kwota zawsze z linii; planowany powstaje jako szacunek, bez odkładania
  (do włączenia w jego własnym arkuszu).
- Linia powiązana: „Powiązane z: {pochodzenie} · w źródle X", „Zapisz w regule" /
  „Zapisz w źródle" — **dwa kroki**: najpierw zdanie o skutku (podział reguły od M /
  zmiana kwoty / szacunku / planu wpłat), potem „Zapisz". Przycisk aktywny tylko, gdy
  kwota w arkuszu jest zapisana (najpierw „Zapisz zmiany") — zapis w źródle bierze
  kwotę z szkicu, nie z niezapisanego pola. „Zostaw jako własną" odpina linię.
- Usunięcie: linia własna — „Usuń z planu", powiązana — „Pomiń w planie" (I-24).
- Klucz idempotencji zamiany i zapisu w źródle — jeden na otwarcie arkusza.
- **Arkusz „Utwórz z danych"** (`budget-fill-sheet.tsx`): przełącznik źródeł (domyślnie
  włączony), okno średniej 3 / 6 / 12, lista kategorii ze średnią > 0 z polami wyboru
  (domyślnie nic nie zaznaczone), „Skopiuj własne pozycje z …" przy wcześniejszym planie.
  Jedno okno dla wszystkich zaznaczonych kategorii. Szybkie „Skopiuj z …" i „Zacznij od
  zera" zostają w stanie pustym.

**Na dashboardzie** (`F9-8`): w ostatnich 7 dniach miesiąca, gdy następny nie ma
szkicu — wiersz pod „Nadchodzące": „Zaplanuj listopad →". W podglądzie przyszłego
miesiąca baner dostaje odnośnik „Plan budżetu" (gdy szkic istnieje) albo „Zaplanuj".

**Ustalenia z `F9-9`** (plan kontra wykonanie):

- Bilans: nad kwotami nagłówek „Plan · Wykonanie", druga kolumna z `actuals.totals`
  (także „Zostaje" = `netMinor`). Pule bez planu, ale z wykonaniem — wiersz się pokazuje.
- Pod linią: „wydano X · zostało Y" / „wydano X · ponad plan Z" (wydatek; `--warning`
  tylko przy przekroczeniu wydatku), „wpłynęło … · brakuje …", „odłożono …",
  „zainwestowano …"; cienki pasek 4 px w kolorze strony bilansu (przy przekroczeniu
  wydatku — `--warning`). Kwoty bez „zł" (`unit={false}`) — jak podpisy wierszy.
- Grupa kilku linii jednej kategorii: wykonanie pod **ostatnią** linią grupy, z podpisem
  „Jedzenie razem: …" — bez osobnego nagłówka grupy.
- „Poza planem X zł" z odnośnikiem „historia" (`/m/:month/transactions`) i zdaniem
  wyjaśnienia; tylko gdy kwota > 0.

**Ustalenia z `F9-8`** (`features/budget/components/budget-hint.tsx`, `nav-items.ts`):

- *Budżet* (ikona schowka) w `secondaryNav()` zaraz po *Planowane* — ta sama lista
  zasila ekran „Więcej" i pasek boczny.
- „Zaplanuj {miesiąc}" — wiersz-odnośnik (≥ 44 px) pod „Nadchodzące", widoczny tylko przy
  `budget.suggestNextMonth`; bez planowanych wydatków stoi zaraz pod „Do zrobienia".
- Baner podglądu przyszłości: odnośnik pod zdaniem — „Plan budżetu" (szkic istnieje),
  „Zaplanuj" (da się założyć), nic poza zakresem.

**Grupy i kolejność** (`F9-11`…`F9-13`, [ADR-081](./14-decisions-log.md#adr-081),
makieta [`design/mockups/budget-layout.html`](../design/mockups/budget-layout.html)):

```
│ WYDATKI              6 970,09 zł [⇅ Układaj] [+] │
│ ⌄ Mieszkanie i media · 5            3 206,30    │ ← nagłówek grupy: zwiń / rozwiń
│   🔁 Czynsz najmu                 −2 450,00 zł   │
│   …                                             │
│ › Subskrypcje · 2                      62,99    │ ← zwinięta: sama suma
│ Bez grupy                             149,00    │ ← tylko gdy sekcja ma grupy
│   🔁 Siłownia                       −149,00 zł   │
```

- Sekcja bez grup wygląda jak dotąd. Z grupami: grupy w kolejności, na końcu „Bez grupy".
  Nagłówek grupy: nazwa, liczba pozycji, suma planu; dotknięcie zwija i rozwija
  (zapamiętane w przeglądarce dla sekcji i nazwy — także w kolejnych miesiącach). Pusta
  grupa ma nagłówek z „0,00" (struktura skopiowana z poprzedniego miesiąca czeka na
  pozycje); pusty „Bez grupy" widać tylko w trybie układania — tam jest celem upuszczenia.
- **„Układaj"** (tylko szkic edytowalny) — tryb jednej sekcji: przy każdym wierszu
  i nagłówku grupy uchwyt 44 px po prawej; dotknięcie wiersza nic nie otwiera; zamiast
  FAB (schowany — zasłaniałby uchwyty, `useHideFab`) pasek „Układasz {sekcja}. [Gotowe]". Przeciągnięcie wiersza pod nagłówek grupy
  przenosi go do grupy, pod „Bez grupy" — wyjmuje z grup. Nagłówek grupy przeciąga się
  razem z jej pozycjami. Zapis po upuszczeniu; błąd → powrót do poprzedniego układu
  i toast „Nie zapisano kolejności.".
- **Klawiatura:** uchwyt to przycisk — spacja podnosi, strzałki przesuwają, spacja
  odkłada, Escape anuluje; komunikaty po polsku dla czytnika ekranu.
- **Pierwsze „Układaj" w sekcji bez grup:** kafel „Podzielić na grupy?" z podglądem
  *Stałe / Planowane / Zmienne* (liczba pozycji, suma) i [Utwórz grupy] · [Sam ułożę].
- **„+ Nowa grupa"** pod listą w trybie układania → arkusz z nazwą.
- **„⋯" przy grupie** (tryb układania) → arkusz grupy: nazwa, „Przesuń wyżej / niżej",
  „Usuń grupę" (pozycje zostają, w „Bez grupy") — bez potwierdzenia, toast z „Cofnij".
- **Arkusz linii:** pole „Grupa" — chipy z grupami sekcji i „Bez grupy" (gdy sekcja ma
  grupy). Nowa linia z „+" — domyślnie ostatnio wybrana grupa sekcji w tej wizycie.
- **Desktop** (wskaźnik precyzyjny): uchwyt pojawia się po najechaniu na wiersz także
  poza trybem — przeciąganie bez włączania „Układaj".
- **Wykonanie grupy** (miesiąc bieżący i miniony): pod nagłówkiem „wydano X · zostało Y"
  i pasek 4 px, gdy grupa ma wykonanie (07 §13.10); inaczej sam plan.
- Szkic minionego miesiąca — bez „Układaj"; grupy i zwijanie działają.

## 4. Design system

> **Źródłem prawdy jest [`15-design-system.md`](./15-design-system.md).** Ta sekcja
> zawierała wartości tymczasowe, dobrane przy planowaniu, żeby dało się konkretnie opisać
> ekrany. Etap projektowy `F0-9` zaprojektowała warstwę wizualną od zera i je zastąpiła.

| Szukasz | Idź do |
|---|---|
| kolorów, tokenów, obu motywów | [15 §3](./15-design-system.md#3-tokeny) · wartości w [`tokens.css`](../apps/web/src/styles/tokens.css) |
| krojów, skali, stopni pisma | [15 §3.3](./15-design-system.md#33-typografia) |
| odstępów, siatki, promieni | [15 §3.4](./15-design-system.md#34-odstępy-i-siatka), [15 §3.5](./15-design-system.md#35-promienie-i-elewacja) |
| specyfikacji komponentów | [15 §4](./15-design-system.md#4-prymitywy) |
| wzorców powtarzalnych | [15 §5](./15-design-system.md#5-wzorce) |
| ikon | [15 §6](./15-design-system.md#6-ikonografia) |
| czasów i krzywych animacji | [15 §7](./15-design-system.md#7-ruch) |
| makiet | [15 §8](./15-design-system.md#8-makiety) · pliki w [`design/mockups/`](../design/mockups/) |

**Zasady, nie liczby, pozostają w mocy** i są przepisane do
[15 §2](./15-design-system.md#2-zasady-nienegocjowalne) jako nienegocjowalne: mobile-first
390 px, kwoty wyłącznie przez `<Money>`, cyfry tabelaryczne, kolor nigdy jako jedyny nośnik
informacji, minus typograficzny, cele dotykowe ≥ 44 px, gest nigdy jako jedyna droga do
akcji, cztery stany każdego ekranu z danymi, wartości ujemne jako poprawny wynik, kontrast
4,5:1 / 3:1, `prefers-reduced-motion`, oba motywy pierwszoklasowe.

## 5. Zachowanie mobilne — szczegóły

| Zagadnienie | Rozwiązanie |
|---|---|
| Klawiatura zasłania pola | Arkusze przewijane, aktywne pole przewijane do widoku |
| Pasek adresu iOS | `100dvh` zamiast `100vh` |
| Wcięcia ekranu | `env(safe-area-inset-*)` na pasku dolnym i nagłówku |
| Podwójne dotknięcie zoomuje | `touch-action: manipulation` + cele dotyku ≥ 44 px; powiększanie gestem **dozwolone** (WCAG 1.4.4, [ADR-064](./14-decisions-log.md#adr-064)) — wcześniej `maximum-scale=1` |
| Aparat | `<input type="file" accept="image/*" capture="environment">` |
| Offline | Powłoka PWA z cache; dane **zawsze z sieci**. Bez sieci przyklejony u góry baner „Brak połączenia. Kwoty pochodzą z ostatniego wczytania i mogą być nieaktualne; zapis zadziała po powrocie sieci." (`F8-3`) |
| Odświeżenie gestem | Pociągnięcie w dół na *Miesiącu* i *Historii* |
| Nawigacja wstecz | Zamyka arkusz zamiast wychodzić z ekranu (przechwycone `popstate`) |

## 6. Wydajność

- Ekran miesiąca: **jedno** żądanie. Cel: pierwsze renderowanie < 1,5 s na 4G.
- Wstępne pobranie sąsiednich miesięcy po bezczynności (`prefetchQuery`).
- Zdjęcia paragonów skalowane po stronie klienta **przed** wysyłką (max 1568 px dłuższego
  boku) — oszczędza transfer i tokeny.
- Podział kodu po trasach; `/scan` i `recharts` ładowane leniwie.
- Budżet rozmiaru: < 200 kB (gzip) dla ścieżki krytycznej.

## 7. Kolejność budowy widoków

Wynika z [11-roadmap.md](./11-roadmap.md); tutaj dla porządku:

1. `/login` + powłoka aplikacji z nawigacją
2. `/accounts` (bez kont nie da się nic zaksięgować)
3. `/t/new` — formularz transakcji
4. `/m/:month` — dashboard (iteracyjnie, sekcja po sekcji)
5. `/m/:month/transactions` — historia
6. `/recurring` + sekcja „Do zrobienia" na dashboardzie
7. `/goals` + przelicznik
8. `/allocation`
9. `/liabilities`
10. `/planned` + sekcja „Nadchodzące" na dashboardzie
11. `/scan`
12. `/settings`
13. `/budget` + podpowiedź na dashboardzie (Faza 9)
