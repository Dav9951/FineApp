# 15 — Design system

> **Status: wypełniony.** Warstwa wizualna została zaprojektowana od zera w etapie `F0-9`
> (2026-09-21). Wybrany kierunek: **Papier** — [§1](#1-kierunek-wizualny),
> uzasadnienie w [ADR-013](./14-decisions-log.md#adr-013).
>
> Sekcje `✅ USTALONE` wynikające z domeny ([§2](#2-zasady-nienegocjowalne) zasady,
> [§9](#9-granice-kierunku-wizualnego) granice) obowiązują niezależnie od kierunku
> wizualnego i **nie zmieniają się przy odświeżaniu wyglądu**.
>
> Próbki odrzuconych kierunków: [`design/directions/`](../design/directions/).

Ten dokument mówi **jak rzeczy wyglądają i dlaczego**. Co znajduje się na którym ekranie —
[`06-ui-views.md`](./06-ui-views.md). Wartości tokenów w postaci wykonywalnej —
[`apps/web/src/styles/tokens.css`](../apps/web/src/styles/tokens.css).

---

## 1. Kierunek wizualny

✅ **USTALONE** — wybrany 2026-09-21 spośród trzech propozycji, [ADR-013](./14-decisions-log.md#adr-013).

| Pole | Wartość |
|---|---|
| Nazwa kierunku | **Papier** |
| Opis w jednym zdaniu | Ciepły papier i atrament: szeryfowe kwoty, włosowe linie zamiast wypełnionych kafli, kolor zredukowany do poziomu tuszu. |
| Dlaczego ten, a nie pozostałe | Odrzucono **Grafit** (wydatek bez odcienia — najspokojniejszy, ale para wpływy/wydatki schodziła przy deuteranopii do ΔE ≈ 24) i **Nokturn** (paleta na osi temperatury — najczytelniejszy kątem oka, ale najwięcej koloru na ekranie, co kłóci się z „spokój ponad osobowość"). Papier daje hierarchię z typografii i linii, a nie z wypełnień, więc siedem sekcji na 390 px nie zamienia się w siedem prostokątów. |
| Próbki kierunków | [`design/directions/`](../design/directions/) — `index.html` porównuje trzy obok siebie |
| Data ustalenia | 2026-09-21 |
| ADR | [ADR-013](./14-decisions-log.md#adr-013) |

## 2. Zasady nienegocjowalne

✅ **USTALONE** — wynikają z domeny i z decyzji zapisanych w [06](./06-ui-views.md)
oraz [07](./07-domain-rules.md). Kierunek wizualny ma się do nich dopasować, nie odwrotnie.

1. **Mobile-first, 390 × 844 px.** Projekt powstaje na tę szerokość. Desktop to ten sam
   układ rozlany na szerszą siatkę, nie osobny projekt.
2. **Kwoty wyłącznie przez `<Money>`.** Formatowanie, znak, kolor, `tabular-nums`
   i `aria-label` w jednym miejscu. Nigdzie indziej nie ma `toFixed(2)` ani `zł` w JSX.
3. **Cyfry tabelaryczne** (`font-variant-numeric: tabular-nums`) wszędzie, gdzie kwoty
   stoją w kolumnie — bez tego liczby „skaczą" przy przewijaniu listy.
4. **Kolor nigdy nie jest jedynym nośnikiem informacji.** Zawsze towarzyszy mu znak
   (`+`/`−`), ikona lub etykieta. Dotyczy zwłaszcza pary wpływy/wydatki.
5. **Minus typograficzny** `−` (U+2212), nie łącznik. Separator tysięcy: spacja
   niełamliwa (U+00A0).
6. **Cele dotykowe ≥ 44 × 44 px**, odstęp między sąsiednimi ≥ 8 px.
7. **Gest nigdy nie jest jedyną drogą do akcji** — zawsze istnieje alternatywa w menu.
8. **Cztery stany każdego ekranu z danymi:** ładowanie (szkielet o kształcie docelowej
   treści, nie spinner), pusto, błąd, treść. Brak któregokolwiek = ekran nieukończony.
9. **Wartości ujemne są poprawnym wynikiem.** Alokacje liczone netto (ADR-011) —
   pierścień postępu i kwota muszą umieć pokazać ubytek, nie zero.
10. **Kontrast** tekstu ≥ 4,5:1, elementów interfejsu ≥ 3:1. Oba motywy.
11. **`prefers-reduced-motion`** wyłącza animacje przejść i pierścieni postępu.
12. **Oba motywy są pierwszoklasowe.** Ciemny jest domyślny (aplikacja bywa używana
    wieczorem), jasny musi działać tak samo dobrze.

---

## 3. Tokeny

Wartości żyją w [`tokens.css`](../apps/web/src/styles/tokens.css) i są mapowane na klasy
Tailwinda w [`tailwind.config.ts`](../apps/web/tailwind.config.ts). Ten dokument tłumaczy
**po co** dany token istnieje; plik CSS trzyma **wartość**.

### 3.1 Kolory bazowe

✅ **USTALONE**

Papier, nie biel: tło ma ciepły odcień (40°), żeby ekran oglądany wieczorem nie świecił
neutralną bielą. Kafel jest **jaśniejszy** od tła o dwa punkty, bo hierarchię niesie tu
linia i odstęp, a nie wypełnienie.

| Token | Rola | Jasny | Ciemny |
|---|---|---|---|
| `--background` | tło aplikacji | `40 32% 96%`<br>#f8f6f2 | `28 14% 9%`<br>#1a1714 |
| `--foreground` | tekst podstawowy | `28 16% 13%`<br>#26211c | `40 24% 94%`<br>#f3f1ec |
| `--card` | tło kafla i arkusza | `42 44% 99%`<br>#fefdfb | `28 13% 13%`<br>#25211d |
| `--card-foreground` | tekst na kaflu | `28 16% 13%`<br>#26211c | `40 24% 94%`<br>#f3f1ec |
| `--muted` | tło drugorzędne, separatory | `40 22% 91%`<br>#edeae3 | `28 12% 19%`<br>#36302b |
| `--muted-foreground` | tekst drugorzędny, podpisy | `32 12% 38%`<br>#6d6255 | `36 12% 64%`<br>#aea598 |
| `--border` | obramowania i linie rozdzielające | `38 18% 85%`<br>#e0dbd2 | `28 11% 23%`<br>#413a34 |
| `--input` | obramowanie pól | `34 16% 48%`<br>#8e7d67 | `30 12% 46%`<br>#837567 |
| `--ring` | pierścień fokusu | `212 64% 34%`<br>#1f538e | `206 84% 62%`<br>#4da9ef |
| `--primary` | akcja główna | `212 62% 26%`<br>#19406b | `206 78% 66%`<br>#65b1ec |
| `--primary-foreground` | tekst na akcji głównej | `42 44% 99%`<br>#fefdfb | `28 20% 10%`<br>#1f1914 |

`--primary` to pruski błękit: jedyna barwa w palecie, która nie oznacza pieniędzy.
Dzięki temu „Zapisz" i „Uzupełnij" nie mogą zostać pomylone z kwotą.

### 3.2 Kolory semantyki finansowej

✅ **USTALONE**

| Token | Rola | Gdzie | Jasny | Ciemny |
|---|---|---|---|---|
| `--income` | wpływy | kwoty dodatnie, wykres przychodów | `164 54% 32%`<br>#267e66 | `164 48% 56%`<br>#59c5a8 |
| `--expense` | wydatki | kwoty ujemne, kategorie wydatków | `6 62% 32%`<br>#84291f | `6 68% 61%`<br>#df6558 |
| `--savings` | oszczędności | pierścień celu, konta i cele oszczędnościowe | `210 60% 30%`<br>#1f4c7a | `206 66% 56%`<br>#4599d9 |
| `--investment` | inwestycje | pierścień celu, konta i cele inwestycyjne | `288 42% 50%`<br>#a04ab5 | `288 48% 79%`<br>#d9b0e3 |
| `--debt` | zobowiązania | raty, pasek spłaty kredytu | `336 50% 38%`<br>#913057 | `336 56% 65%`<br>#d8749c |

| Token | Rola | Jasny | Ciemny |
|---|---|---|---|
| `--warning` | ostrzeżenie o płynności, zaległa rata | `38 80% 30%`<br>#8a5d0f | `40 82% 58%`<br>#ecb13c |
| `--success` | cel zrealizowany, dokument zatwierdzony | `164 54% 32%`<br>#267e66 | `164 48% 56%`<br>#59c5a8 |
| `--danger` | akcja nieodwracalna (usunięcie) | `6 62% 32%`<br>#84291f | `6 68% 61%`<br>#df6558 |

**Trzy rzeczy w tej tabeli są wynikiem pomiaru, nie gustu.**

1. **`--debt` nie jest bursztynowy.** Zobowiązanie i ostrzeżenie w tej samej strefie
   ciepłej dają przy deuteranopii ΔE ≈ 3 — są nierozróżnialne. Zaległa rata to dokładnie
   ta sytuacja, w której oba kolory stoją obok siebie. Dlatego `--debt` siedzi na osi
   różu/śliwki, sąsiadując z `--investment`: jedno i drugie jest zobowiązaniem, tylko
   w przeciwne strony.
2. **`--savings` i `--investment` rozdziela jasność, nie odcień.** Przy dichromatyzmie
   z barwy zostaje oś żółto-niebieska, więc błękit i fiolet zlewają się co do odcienia.
   Nasycenie `--investment` (42% w motywie jasnym) jest **minimalne**, przy którym para
   przechodzi próg przy protanopii — niżej zlewa się nieodwracalnie. To dlatego fiolet
   jest tu jaśniejszy i bardziej nasycony, niż chciałby kierunek „tusz, nie farba".
3. **`--success` = `--income`, `--danger` = `--expense`.** Osiem ról, sześć odcieni.
   Wciśnięcie ośmiu rozróżnialnych barw w tę przestrzeń wymagałoby podniesienia
   nasycenia wszystkich — a wtedy żadna nie mogłaby zostać cicha. Tokeny pozostają
   osobne, żeby dało się je kiedyś rozdzielić bez przeszukiwania kodu.

Audyt: [`design/tools/palette_audit.py`](../design/tools/palette_audit.py) czyta
`tokens.css` i sprawdza wszystkie progi oraz pary. 84 sprawdzenia, zero naruszeń.

**Wykresy** (`F8-5`, [ADR-063](./14-decisions-log.md#adr-063)) — dwa tokeny ról, nie
nowe barwy:

| Token | Rola | Jasny | Ciemny |
|---|---|---|---|
| `--chart-actual` | linia i znaczniki wykonania | `212 62% 26%` (= `--primary`) | `206 66% 56%` (= `--savings`) |
| `--chart-plan` | przerywana linia planu (odniesienie) | `32 12% 38%` (= `--muted-foreground`) | `36 12% 64%` (= `--muted-foreground`) |

Sprawdzone walidatorem palety (skill dataviz) na tle `--card`: jasny ΔE 17,5 przy
zwykłym widzeniu, 14,9 przy protanopii; ciemny 16,0 / 12,6; kontrast obu ≥ 3:1.
W ciemnym `--primary` dawał z planem ΔE 13,6 — poniżej progu 15 — stąd stopień
`--savings`. Plan jest szary celowo i odróżnia go też kreskowanie, więc kolor nie jest
jedynym nośnikiem. Podpisy i osie — kolorami tekstu, nigdy kolorem serii.

### 3.3 Typografia

✅ **USTALONE**

| Pole | Wartość | Uwaga |
|---|---|---|
| Krój interfejsu | **Source Sans 3** | rezerwa `system-ui, -apple-system, sans-serif` |
| Krój kwot | **Spectral** | rezerwa `Georgia, 'Times New Roman', serif` |
| Skala | `12 / 13 / 14 / 16 / 20 / 24 / 32 / 40` px | osiem stopni; nazwy w `tailwind.config.ts` |
| Grubości | `400` zwykła · `500` średnia · `600` półgruba · `700` gruba | oba kroje mają komplet |
| Interlinia | 1,05 → 1,5 — im większy stopień, tym ciaśniej | wartości w `fontSize` Tailwinda |

**Dlaczego te dwa kroje.** Wybrane pomiarem, nie wrażeniem:

- **Spectral** ma najniższy kontrast grubości z rozważanych szeryfów (obok Source Serif 4
  i Newsreadera), więc jego włosowe kreski nie znikają w motywie ciemnym oglądanym
  wieczorem, a minus `−` zachowuje pełną wagę — w Newsreaderze wyraźnie się załamuje.
- **Cyfry obu krojów są tabelaryczne domyślnie.** Kolumna kwot zostaje wyrównana nawet
  tam, gdzie ktoś zapomni `font-variant-numeric`. Literata, Bitter, Faustina i Karla
  wymagają jawnego `tnum` — przy zasadzie „kwoty wyłącznie przez `<Money>`" to i tak
  powinno wystarczyć, ale margines błędu jest tu za darmo.
- **Source Sans 3 jest najoszczędniejszy** z mierzonych krojów interfejsu:
  „Ubezpieczenie OC/AC" zajmuje 127 px wobec 140 px w IBM Plex Sans i 146 px w Literacie.
  Przy siedmiu sekcjach na 390 px to realna różnica.
- **Oba mają podzbiór `latin-ext`**, czyli komplet polskiej diakrytyki.

**Lato odpadło** mimo najlepszych ogonków (projektant: Łukasz Dziedzic) i najcieplejszego
charakteru: nie ma grubości 500 ani 600 — Google Fonts odpowiada na nie `HTTP 400`.
Skala powyżej wymaga obu.

**Wielkości wymuszone przez układy z [06](./06-ui-views.md)** — zmierzone na 390 px:

| Element | Stopień / grubość | Zmierzona szerokość | Budżet |
|---|---|---|---|
| kwota główna na dashboardzie | 32 px / 600 | 227 px przy kwocie siedmiocyfrowej | 358 px |
| kwoty na listach | 16 px / 600 | 88 px (`−1 850,00 zł`), 119 px siedmiocyfrowa | zostaje 214 px / 183 px na nazwę |
| nazwa w wierszu listy | 14 px / 500 | 127 px (`Ubezpieczenie OC/AC`), 172 px (`Oprogramowanie i narzędzia`) | mieści się w obu przypadkach |
| nagłówki sekcji | 12 px / 600, wersaliki, `letter-spacing: .1em` | | |
| podpisy pod pozycją listy | 13 px / 400, `--muted-foreground` | 181 px (`18 wrz · Konto mieszkaniowe · AK`) | |

> **Odstępstwo od `06 §4`.** Kwoty na listach mają grubość **600**, nie 500. Spectral 500
> na ciemnym tle jest zbyt lekki, żeby kwota wygrywała z nazwą pozycji obok. `06 §4` samo
> opisuje swoje wartości jako tymczasowe i wskazuje ten dokument jako następcę.

**Jednostka przy kwocie.** Kwoty niosą `zł` (wariant domyślny `<Money>`). W kafelku
„Cele procentowe" jednostka pada **raz na parę** — `2 000 / 2 360 zł` — bo powtórzona
przy obu liczbach zjada szerokość i nic nie dodaje przy jednej walucie (ADR-007).

**Samodzielny hosting.** Oba kroje trzeba podać z własnego serwera (podzbiór `latin-ext`,
`woff2`), nie z CDN-u Google — aplikacja stoi na prywatnym VPS-ie i nie ma powodu wysyłać
adresów IP domowników do zewnętrznej usługi przy każdym otwarciu.

### 3.4 Odstępy i siatka

✅ **USTALONE** — siatka 4 px zostaje bez zmian.

| Pole | Ustalone |
|---|---|
| Siatka bazowa | 4 px |
| Skala odstępów | `4 / 8 / 12 / 16 / 24 / 32 / 48` |
| Margines ekranu (mobile) | 16 px |
| Margines ekranu (≥ 768 px) | 24 px |
| Odstęp między sekcjami | **24 px** (nie 12 px — patrz niżej) |
| Maksymalna szerokość treści | 1200 px |
| Minimalny cel dotykowy | 44 px (`spacing.touch` w Tailwindzie) |
| Wysokość dolnego paska zakładek | **56 px** (`--tabbar-height`, `spacing.tabbar`) — bez bezpiecznego marginesu urządzenia |

> **Dlaczego wysokość paska jest tokenem.** Liczą od niej pozycję dwa elementy stojące
> poza paskiem: FAB ([§4.4](#44-fab) — „cały nad paskiem", 16 px odstępu) i toast
> ([§4.10](#410-pozostałe)). Zapisana dwa razy jako liczba rozjeżdża się przy pierwszej
> zmianie paska, a objaw — FAB zachodzący na zakładkę „Więcej" — jest dokładnie tym,
> czego §4.4 zabrania. 56 px = ikona 21 px + podpis 11 px + odstępy 4 px; cel dotykowy
> 44 px każdej z pięciu pozycji mieści się w tej wysokości.
> `safe-area-inset-bottom` obsługuje **pasek**, nie FAB, więc token jej nie zawiera.

> **Odstępstwo od wartości tymczasowej.** Odstęp między sekcjami dashboardu to 24 px,
> nie 12 px. W tym kierunku sekcje nie mają wypełnionego tła — rozdziela je włosowa linia
> i powietrze. Przy 12 px linie stają się kreskowaniem i siedem sekcji zlewa się w jedną
> tabelę. 24 px to najmniejsza wartość, przy której podział czyta się bez obramowań.

### 3.5 Promienie i elewacja

✅ **USTALONE**

| Token | Zastosowanie | Ustalone |
|---|---|---|
| `--radius` | arkusze, kafle w wariancie wypełnionym | 14 px |
| `--radius-sm` | pola, przyciski | 8 px |
| `--radius-full` | plakietki, awatary | 999 px |
| cień kafla | — | **brak** |
| cień arkusza | `--shadow-sheet` | `0 −8px 32px −8px` + górna krawędź `--border` |
| cień FAB | `--shadow-fab` | `0 6px 20px −4px` |

**Hierarchia stoi na liniach i odstępach, nie na cieniu ani na wypełnieniu.** To jest
teza tego kierunku i zarazem odejście od założenia, które `15 §3.5` robiło wcześniej
(„kafle dashboardu odróżnia od tła kolor"). Kafel na dashboardzie ma **przezroczyste tło**
i górną linię `--border`; `--card` zostaje dla arkuszy, modali i układu desktopowego,
gdzie treść naprawdę unosi się nad tłem.

Cień dostaje więc tylko to, co faktycznie jest wyżej: arkusz od dołu i FAB. W motywie
ciemnym cień traci siłę, dlatego `--shadow-sheet` niesie **dwie warstwy** — rozmycie
i jednopikselową jaśniejszą krawędź górną, która działa tam, gdzie rozmycie już nie.

### 3.6 Mechanika motywów

✅ **USTALONE**

- `:root` niesie motyw **jasny**, klasa `.dark` na `<html>` nadpisuje token po tokenie.
- Każdy token musi mieć wartość w obu motywach. Token zdefiniowany tylko w jednym =
  błąd, który ujawni się dopiero u użytkownika.
- Komponenty **nigdy** nie odwołują się do surowych kolorów — wyłącznie przez tokeny.
  Nie ma `bg-blue-500` w kodzie aplikacji.
- Klasę `.dark` ustawia `public/theme-init.js` przed pierwszym malowaniem, a potem
  `lib/theme.ts` (`useTheme`). Wybór: ciemny (domyślny), jasny, systemowy — w
  `localStorage` urządzenia ([ADR-067](./14-decisions-log.md#adr-067)). Zmiana
  `--background` = zmiana `THEME_COLORS` (kolor paska przeglądarki) w obu plikach.

---

## 4. Prymitywy

✅ **USTALONE** — spisane z tego, co wyszło w makietach ([§8](#8-makiety)).
Dla każdego: warianty, stany, użyte tokeny, zachowanie na 390 px.

> **Zakodowane w `F1-0`** ([ADR-023](./14-decisions-log.md#adr-023)).
> Kod: [`apps/web/src/components/ui/`](../apps/web/src/components/ui/).
> Przegląd na żywo — trasa **`/dev/ui`**, ze stanami skrajnymi i przełącznikiem motywu.
> Zanim napiszesz nowy komponent, zajrzyj tam: prawdopodobnie już jest.

**Stany wspólne dla wszystkich elementów dotykalnych.** Spoczynek — bez zmian.
Hover — tylko desktop, nigdy jedyny nośnik informacji (§9). Aktywny — `bg-muted`,
bez przesunięcia i bez skalowania. Fokus — `ring-2 ring-ring ring-offset-2
ring-offset-background`, zawsze widoczny, nigdy `outline: none` bez zamiennika.
Wyłączony — `opacity-50` **i** `aria-disabled`, nigdy samo wyszarzenie.

### 4.1 `<Money>`

Najważniejszy komponent w aplikacji — kwota pojawia się na każdym ekranie.

| Aspekt | Ustalenie |
|---|---|
| Wejście | `amountMinor: number`, `currency?`, `variant`, `unit?`, `size?` |
| Warianty | `neutral` · `income` · `expense` · `savings` · `investment` · `debt` · `compact` |
| Znak | `+` dla wpływu, `−` (U+2212) dla wydatku; neutralny bez znaku; **zero nigdy nie dostaje znaku** |
| Kolor | z wariantu, nigdy z zewnątrz — `text-income`, `text-expense`, … |
| Jednostka | `zł` domyślnie; `unit={false}` tylko tam, gdzie waluta pada obok raz na parę |
| Cyfry | `font-numeric tabular-nums` zawsze; Spectral ma je tabelaryczne domyślnie |
| Dostępność | widoczna kwota `aria-hidden`, obok tekst `sr-only` z pełnym odczytem: „minus sto dwadzieścia siedem złotych dziewięćdziesiąt dziewięć groszy". **Nie `aria-label`** — na `<span>` bez roli czytniki go pomijają ([ADR-064](./14-decisions-log.md#adr-064)) |
| Zero | „0,00 zł", nigdy pusty string |

**Wariant `compact`** pomija grosze: `2 000 / 2 360 zł`. Używany wyłącznie tam, gdzie
liczy się **porównanie**, a nie zgodność do grosza — czyli przy pierścieniach celów
i paskach postępu. Tak samo zapisuje te kwoty [`06 §3.1`](./06-ui-views.md). Pełna
wartość zostaje w odczycie `sr-only`, więc czytnik ekranu nie traci ani grosza.

**Jednostka raz na parę.** W `2 000 / 2 360 zł` jednostka pada tylko na końcu:
powtórzona przy obu liczbach zjada szerokość i nic nie wnosi przy jednej walucie
([ADR-007](./14-decisions-log.md#adr-007)).

**Zmierzone szerokości** (Spectral, 390 px): `−1 850,00 zł` przy 16 px/600 to 88 px,
kwota siedmiocyfrowa 119 px, `−1 215 727,90 zł` w nagłówku sekcji mieści się obok
etykiety „majątek netto". Kwota nigdy się nie zawija ani nie skraca — zawija się
albo skraca **nazwa obok niej**.

### 4.2 `<AmountInput>`

Pole kwoty z własną klawiaturą numeryczną. Wyróżnik tej aplikacji — systemowa
klawiatura numeryczna na iOS nie ma przecinka.

| Aspekt | Ustalenie |
|---|---|
| Układ | siatka 3 × 4: `1–9`, `,`, `0`, `⌫` |
| Wysokość klawisza | **52 px** (powyżej progu 44 px), odstęp 6 px |
| Wygląd klawisza | `bg-muted/50 border border-border rounded-md`, cyfra 20 px `font-numeric` |
| `⌫` | **ikona, nie znak** — U+232B nie istnieje w Spectral ani Source Sans i wypada na znak zastępczy wyglądający jak koperta; `aria-label="Usuń ostatnią cyfrę"` |
| Kwota | 40 px / 600, wyśrodkowana, pod nią kreska 1 px w `--primary` (fokus) albo `--danger` (błąd) |
| Walidacja | na żywo pod kreską, 12 px `--danger`; „Zapisz" nieaktywny, ale **widoczny** |
| Fokus | pole ma fokus od razu po otwarciu arkusza |

`,` i `.` wprowadzają ten sam separator. Druga cyfra po przecinku kończy wpisywanie
części groszowej. Przytrzymanie `⌫` czyści całość.

### 4.3 `<Button>` i `<IconButton>`

| Wariant | Tokeny | Kiedy |
|---|---|---|
| `primary` | `bg-primary text-primary-foreground` | jedna akcja główna na ekran: Zapisz, Zatwierdź, Zaksięguj |
| `soft` | `bg-muted text-primary border-border` | akcja wewnątrz ostrzeżenia lub kafla — uwagę niesie już baner |
| `ghost` | `border-border text-foreground` | akcja odwracalna obok głównej: Pomiń, Wybierz inną |
| `danger` | `bg-danger text-background` | wyłącznie operacja nieodwracalna, zawsze z potwierdzeniem |

Rozmiary: duży (akcje w arkuszu, `min-h-touch`, `w-full`), średni (domyślny,
`min-h-touch px-4`), mały (w wierszu listy i w stopce karty). **Wysokość dotykowa nigdy
nie schodzi poniżej 44 px**, nawet gdy przycisk wygląda na mniejszy:

- mały `link` (bez tła) — `min-h-touch px-2` i ujemny margines `-my-2`;
- mały z tłem (`primary`, `soft`, `ghost`, `danger`) — tło `h-9` (36 px), `px-3`,
  a obszar dotyku dociąga do 44 px przezroczysty pseudoelement (`after:-inset-y-1`).
  Ujemny margines przy widocznym tle wpychał 44-px pudełko na linię nad stopką karty
  ([ADR-073](./14-decisions-log.md#adr-073)).

Stan ładowania: tekst zostaje na miejscu, obok niego wskaźnik; szerokość się nie
zmienia, żeby układ nie skakał.

`<IconButton>` ma zawsze `aria-label` — ikona bez etykiety nie istnieje dla czytnika.

### 4.4 `<FAB>`

| Aspekt | Ustalenie |
|---|---|
| Rozmiar | 56 × 56 px, `rounded-full`, `bg-primary`, `shadow-fab` |
| Pozycja | `right-4`, **cały nad paskiem zakładek** — 16 px odstępu, nie zachodzi na pasek. Od 768 px (bez paska) `bottom-6 right-6` — FAB jest też na desktopie (ADR-058) |
| Zapas pod treścią (desktop) | `md:pb-28` |
| Dlaczego nie zachodzi | nachodząc, zasłaniałby zakładkę „Więcej", czyli odbierałby dostęp do Kont, Zobowiązań i Ustawień |
| Zapas pod treścią | `pb-20` na kontenerze treści, żeby FAB nie zasłaniał ostatniego wiersza |
| Kontekstowość | Miesiąc i Historia → formularz transakcji; Cele → wpłata na cel; Skan → aparat |
| Długie przytrzymanie | menu: Wydatek / Przychód / Przelew / Paragon; na desktopie także prawy przycisk myszy |
| Przewijanie | pozostaje widoczny; nie chowa się, bo to najczęstsza akcja w aplikacji |
| Poziomy nadmiar treści | kontener treści powłoki ma `relative overflow-x-clip`; każda pozioma taśma przewijana (np. konta) ma `relative`, bo absolutny tekst `sr-only` bez pozycjonowanego przodka ucieka spod przycięcia — za szeroki element na ekranie nie może poszerzyć obszaru układu, do którego przypięte są FAB i pasek zakładek (na Androidzie FAB lądował za prawą krawędzią). `clip`, nie `hidden`: bez kontenera przewijania ([ADR-074](./14-decisions-log.md#adr-074)) |

`safe-area-inset-bottom` obsługuje pasek, nie FAB — FAB liczy pozycję od paska.

### 4.5 `<Card>` / `<Section>`

**To jest miejsce, w którym kierunek „Papier" najbardziej odbiega od typowej aplikacji.**

| Wariant | Wygląd | Gdzie |
|---|---|---|
| `plain` (domyślny) | tło przezroczyste, górna linia `border-border`, odstęp 24 px | sekcje dashboardu |
| `raised` | `bg-card rounded-lg border-border` | arkusze, modale, kafle kont, układ desktopowy |

Sekcja `plain` składa się z nagłówka (etykieta 12 px wersaliki `tracking-[.1em]`
`--muted-foreground`, akcja po prawej jako `link`), treści i opcjonalnego ostrzeżenia.
Pierwsza sekcja na ekranie nie ma górnej linii.

Odstęp 24 px jest **minimalny, nie estetyczny**: przy 12 px linie rozdzielające
zlewają się w kreskowanie i siedem sekcji czyta się jak jedna tabela.

### 4.6 `<Sheet>`

| Aspekt | Ustalenie |
|---|---|
| Mobile | arkusz od dołu, `rounded-t-lg`, `bg-card`, `shadow-sheet`, `max-height: 97%` |
| Desktop (≥ 768 px) | modal wyśrodkowany, `max-width: 520px` |
| Przyciemnienie | `bg-scrim/55` — **własny token**, nie `--foreground` |
| Uchwyt | 36 × 4 px, `bg-muted-foreground/45`, wyśrodkowany |
| Nagłówek | ✕ po lewej, tytuł na środku, akcja po prawej; przyklejony, nie przewija się |
| Treść | `overflow-y-auto`; przy otwartej klawiaturze aktywne pole przewijane do widoku |
| Zamknięcie | ✕, gest w dół, klawisz Esc, **oraz przycisk „wstecz" przeglądarki** (przechwycony `popstate`) |

> **Dlaczego `--scrim` jest osobnym tokenem.** Nakładka z `--foreground` działa tylko
> w motywie jasnym. W ciemnym tekst podstawowy jest prawie biały, więc przyciemnienie
> **rozjaśniałoby** ekran. Błąd widać dopiero po przełączeniu motywu — dlatego token.

### 4.7 `<ProgressRing>` i `<ProgressBar>`

| Aspekt | Ustalenie |
|---|---|
| Pierścień | 96 × 96 px, grubość 9 px, start na godzinie dwunastej, zgodnie z ruchem wskazówek |
| Ścieżka | `hsl(var(--muted-foreground) / .45)` — **nie `--muted`** |
| Wypełnienie | kolor puli: `--savings`, `--investment`, `--debt` |
| Przekroczenie 100% | cieńszy łuk `--success` narysowany na wierzchu |
| Środek | wykonanie w procentach (20 px / 600, kolor puli) + znacznik celu pod spodem |
| Znacznik celu | `○` niezrealizowany / `●` zrealizowany — **kształt, nie tylko kolor** (§2.4) |
| Pasek | wysokość 6 px, `rounded-full`, tło `--muted`; znacznik celu jako pionowa kreska |
| Pasek — dostępność | `role="progressbar"` z nazwą (`label` albo z puli: „Realizacja: oszczędności”), `aria-valuenow` przycięte do 0–100, prawdziwa wartość — także ponad 100% i ujemna — w `aria-valuetext` ([ADR-064](./14-decisions-log.md#adr-064)) |

> **Ścieżka pierścienia nie może używać `--muted`.** Wobec `--card` daje to około
> **1,2:1** — przy wykonaniu ujemnym, gdy nic jej nie wypełnia, pierścień po prostu
> znika i nie widać, do czego odnosi się liczba w środku. `--muted-foreground` z alfą
> `.45` daje 2,0–2,5:1 w obu motywach: zakres celu widać, a ścieżka nadal nie krzyczy.

**Wartość ujemna** ([ADR-011](./14-decisions-log.md#adr-011)) — najtrudniejszy przypadek
w tej aplikacji:

- łuk biegnie **w lewo** od godziny dwunastej, czyli przeciwnie do wypełnienia;
- rysowany jest jako **ślad kropek** (`stroke-dasharray`, `linecap: round`) w kolorze
  `--expense`, a nie ciągłą linią — ciągła czytałaby się jak postęp;
- w punkcie zero stoi pełna kropka, żeby było widać, skąd ubytek się zaczyna;
- liczba w środku i kwota pod spodem są w `--expense`, z minusem typograficznym;
- długość łuku jest ograniczona do 40% obwodu — dalej i tak nie niesie informacji,
  a zaczyna wyglądać jak postęp w drugą stronę.

**Progi kolorów** paska celu: zrealizowane → `--success`; w tempie → kolor puli;
poniżej tempa przy końcu miesiąca → etykieta `--warning` pod paskiem, nie zmiana
koloru samego paska (kolor niesie pulę, nie ocenę).

### 4.8 `<ListRow>`

Wiersz transakcji i wiersz pozycji — najczęściej powtarzany układ w aplikacji.

```
[ikona 32] [nazwa 14/500        ] [kwota 16/600]
           [podpis 12 --muted-fg ]
```

| Aspekt | Ustalenie |
|---|---|
| Wysokość dotykowa | ≥ 44 px, niezależnie od ilości danych |
| Ikona | 32 × 32 px, `rounded bg-muted text-muted-foreground`, glif 17 px |
| Nazwa | 14 px / 500, `truncate`; przy nazwach kategorii **zawija się** zamiast urywać |
| Podpis | 12–13 px `--muted-foreground`: data · konto · autor · źródło; `truncate`, a gdy koniec podpisu niesie informację („kwota szacunkowa") — `wrapCaption` |
| Kwota | 16 px / 600, `<Money>`, wariant z typu transakcji |
| Rozdzielenie | `border-t border-border` między wierszami, bez tła |
| Grupowanie | po dniach, z sumą dnia w nagłówku grupy |
| Akcje w wierszu | pod kolumną tekstu (wcięcie 44 px = ikona + odstęp), dwie równe kolumny, przyciski `medium` (pełne 44 px, bez ujemnego marginesu `small`), 12 px do linii podziału; akcja główna zawsze w prawej kolumnie, także gdy jest jedyna (ADR-050) |
| Gesty | przesunięcie w bok = edycja / usunięcie, **zawsze z alternatywą w menu** (§2.7) |

Zmierzony budżet na 390 px: po odjęciu marginesów, ikony i odstępu zostaje **313 px**.
Przy kwocie 88 px nazwa dostaje 214 px, przy kwocie siedmiocyfrowej — 183 px.
Najdłuższa nazwa kategorii z zestawu domyślnego („Oprogramowanie i narzędzia") potrzebuje
172 px, więc mieści się w obu przypadkach.

### 4.9 Stany ekranu

**`<Skeleton>`** — kształt docelowej treści, nie spinner. Szkielet dashboardu odtwarza
cztery kafle kont, trzy wiersze podsumowania, dwa pierścienie i wiersze list, żeby po
dojściu danych **nic nie przeskoczyło**. `bg-muted animate-pulse`, wyłączane przez
`prefers-reduced-motion`. Nagłówek miesiąca jest przygaszony — przełączanie w trakcie
wczytywania nie ma sensu.

**`<EmptyState>`** — ikona w kole `bg-muted`, tytuł 20 px, jedno zdanie wyjaśnienia,
**jedna** pierwsza akcja. Pusty dashboard pokazuje cztery kroki startowe, z czego tylko
pierwszy ma przycisk: ekran ma powiedzieć, co zrobić, a nie ile rzeczy brakuje.

**`<ErrorState>`** — ikona w kole `bg-danger/12`, co się stało, **dlaczego nie pokazujemy
starych danych** (kwoty zawsze z sieci — [06 §5](./06-ui-views.md)), godzina ostatniej
udanej aktualizacji, „Spróbuj ponownie" jako `primary` i szczegóły techniczne schowane
za drugim przyciskiem. Kod błędu nigdy nie jest tytułem.

### 4.10 Pozostałe

| Komponent | Ustalenie |
|---|---|
| `<Badge>` | `rounded-full px-2 h-5 text-[11px] font-bold`, tło `--warning/20`, tekst `--warning`; liczniki z `tabular-nums` |
| `<Field>` | etykieta po lewej `--muted-foreground`, wartość po prawej `font-medium`, `›` gdy otwiera arkusz; `min-h-touch`; rozdzielone `border-t` |
| `<TextField>` | od `F2-6`: etykieta nad polem `--muted-foreground`, pole `min-h-touch bg-card border-input rounded-sm`, podpowiedź `placeholder:text-muted-foreground`; błąd — ramka `--danger` i komunikat 12 px powiązany przez `aria-describedby`; od `F2-9` `rows` daje `<textarea>` z tymi samymi stanami; od `F4-5` `type="month"` — natywny wybór miesiąca (okres reguły cyklicznej) |
| `<Select>` | nie natywny — arkusz z listą, bo natywny nie da się utrzymać w tokenach na iOS |
| `<Switch>` | 44 × 24 px, stan także przez pozycję uchwytu, nie tylko kolor |
| `<MonthSwitcher>` | `‹ nazwa ›`, strzałki 44 × 44 px; dotknięcie nazwy otwiera siatkę 12 miesięcy; gest w bok na treści — od `F2-8` w `components/ui` same strzałki (odnośniki, bo miesiąc jest w adresie), nazwa 16 px do 640 px, żeby „październik 2026" mieściło się obok dwóch ikon; od `F3-5` nazwa jako przycisk (`onOpenPicker`) i stan `dimmed` przy wczytywaniu; gest żyje w ekranie miesiąca |
| `<MonthGridSheet>` | od `F3-5`: arkusz „Wybierz miesiąc", rok ‹ ›, siatka 4 × 3 celów 56 px; bez danych — `--muted-foreground`, bieżący — kropka `--primary` (kształt, nie tylko kolor), oglądany — ramka 2 px `--primary`; wybór to przycisk, nawigacja dopiero po `popstate` zamknięcia arkusza |
| `<CategoryPicker>` | arkusz: wyszukiwarka, „Ostatnio używane", siatka ikon 4 kolumny, cel 56 px — od `F2-7` widok w arkuszu formularza: wyszukiwarka i lista z podkategoriami, bo kategorie nie mają jeszcze ikon ([ADR-037](./14-decisions-log.md#adr-037)) |
| `<OptionGrid>` | od `F2-7` w `components/ui` (powstał w `F2-6`): siatka kafli na natywnych `radio`, zaznaczenie grubszą ramką i znacznikiem, nie samym kolorem; formularz konta (rodzaj) i źródła przychodu (rodzaj); od `F4-6` kafle w siatce mają **równą wysokość** (`auto-rows-fr`) — etykieta w jednej linii nie robi kafla niższego od sąsiada |
| Taśma kafli | poziomy rząd kafli (konta na ekranie miesiąca) przewija się bez widocznego paska — `scrollbar-none` w `tokens.css`; to, że jest więcej, mówi ucięty ostatni kafel ([ADR-073](./14-decisions-log.md#adr-073)) |
| `<Tabs>` / segmented | `bg-muted p-1 rounded-md`, aktywny `bg-card` + cień; `role="tablist"` |
| `<Toast>` | nad paskiem zakładek, 4 s, z akcją „Cofnij" przy operacjach odwracalnych — od `F2-8`: stan powłoki (`ToastProvider`, `useToast`), jeden naraz, obok FAB-a (nie pod nim), tło `--foreground` / tekst `--background`, odliczanie stoi pod wskaźnikiem i fokusem, region `status` zawsze w drzewie |
| `<Checkbox>` | 20 × 20 px, obszar dotyku przez `<label>` obejmujący cały wiersz |
| Suwak udziału | od `F5-7`: natywny `input type=range`, `h-touch`, `accent-primary`, krok 0,5%; etykieta nad nim z procentem i kwotą `compact`, `aria-valuetext` z procentem (ADR-054) |

---

## 5. Wzorce

✅ **USTALONE** — złożenia prymitywów powtarzające się na wielu ekranach.

**Kafel dashboardu.** Nagłówek sekcji + akcja po prawej + treść + opcjonalne ostrzeżenie
+ opcjonalna podpowiedź. Akcja po prawej jest zawsze `link` (tekst w `--primary`),
nigdy przycisk z tłem — na ekranie z siedmioma sekcjami siedem przycisków to siedem
fałszywych akcji głównych.

**Wiersz listy z kwotą.** Ikona · nazwa (rośnie) · kwota (stała). Kwota nigdy się nie
zawija; zawija się nazwa. Wyrównanie kwot do prawej plus `tabular-nums` daje pionową
linię przecinków — to jedyny powód, dla którego kolumnę da się skanować wzrokiem.

**Pasek postępu z celem.** Pasek + kwota `compact` + procent + etykieta stanu pod
spodem. Etykieta niesie ocenę („✓ wrzesień", „⚠ brak wpłaty"), pasek niesie pulę.
Rozdzielenie tych dwóch rzeczy pozwala nie zmieniać koloru paska przy każdej zmianie tempa.

**Ostrzeżenie w kaflu.** Lewa krawędź 3 px w kolorze stanu, tło `/10`, glif, treść,
akcja po prawej jako `soft`. Nigdy `danger` — brak pokrycia to nie awaria.
Ostrzeżenie mówi, **co się stało**, a nie podaje samej różnicy: „Z oszczędności
wypłacono więcej, niż wpłacono" zamiast „−340,00 zł".

**Plakietka efektu alokacji.** Nagłówek + jedna linia na pulę + wyłącznik + zdanie
wyjaśnienia. Przelew między pulami daje **dwie linie naraz** (07 §2.2) — to nie jest
przypadek brzegowy, tylko zwykły wtorek, więc plakietka jest listą od początku.

**Kontrola sumy dokumentu.** Suma odczytana, znacznik zgodności, a przy niezgodności
różnica w `--danger` i zdanie o tym, że **zapis nie jest blokowany**. Narzędzie, które
nie jest pewne, mówi o tym wprost i oddaje decyzję człowiekowi.

---
## 6. Ikonografia

✅ **USTALONE**

| Pole | Wartość |
|---|---|
| Zestaw | `lucide-react` |
| Rozmiary | 17 px (w wierszu listy) · 20 px (domyślny) · 21 px (pasek zakładek) · 26 px (FAB) · 28 px (stany ekranu) |
| Grubość linii | **1,5 px** przy 20 px; przy 17 px też 1,5 px (lucide skaluje `stroke-width` proporcjonalnie — trzeba to wyłączyć) |
| Kolor | zawsze `currentColor`, nigdy własny |
| Ikony kategorii | z zestawu; nazwa lucide trafia do `categories.icon` |

Ikony kategorii są **danymi** (`categories.icon`), nie kodem — zestaw musi mieć stabilne
nazwy, a lucide je ma. Nowa kategoria proponowana przez model dostaje nazwę ikony z tej
samej listy; nieznana nazwa degraduje się do ikony domyślnej, nie do pustego miejsca.

**Ikona nigdy nie stoi sama jako nośnik znaczenia.** W wierszu listy niesie kategorię,
ale obok stoi jej nazwa. W pasku zakładek ma podpis. W przycisku bez tekstu ma
`aria-label`. To ta sama zasada co §2.4, tylko o kształtach zamiast o kolorach.

**Znaki, których nie ma w krojach.** `⌫` (U+232B) nie istnieje ani w Spectral, ani
w Source Sans 3 — przeglądarka podstawia znak zastępczy wyglądający jak koperta.
Każdy symbol sterujący bierzemy z zestawu ikon, nie z Unicode. Wyjątki, które **są**
w obu krojach i zostają jako tekst: `−` (U+2212), `✓`, `○`, `●`, `→`, `↑`, `↓`.

---

## 7. Ruch

✅ **USTALONE** — ruch jest dodatkiem, nie warunkiem korzystania z aplikacji.

| Przejście | Czas | Krzywa | Uwaga |
|---|---|---|---|
| Arkusz od dołu — wejście | 260 ms | `cubic-bezier(.32,.72,0,1)` | wyjście 200 ms, ta sama krzywa |
| Przyciemnienie pod arkuszem | 200 ms | `ease-out` | zanika szybciej, niż arkusz schodzi |
| Zmiana miesiąca | 180 ms | `ease-out` | przesunięcie w bok o 16 px + zanik, nie pełne przesunięcie ekranu |
| Pierścień postępu | 420 ms | `ease-out` | animowany jest `stroke-dasharray`, licznik w środku liczy równolegle |
| Pasek postępu | 300 ms | `ease-out` | |
| Toast | 200 ms | `ease-out` | wejście od dołu, wyjście zanikiem |
| Stan wciśnięcia | 0 ms | — | zmiana tła natychmiast; opóźnienie czyta się jak zacięcie |

**Czego nie animujemy.** Pojawienia się treści po wczytaniu — szkielet ma kształt
docelowej treści, więc podmiana ma być natychmiastowa i niezauważalna. Liczb
przewijających się do wartości: kwota to nie licznik samochodowy, a przewijanie
utrudnia odczyt dokładnie w momencie, w którym ktoś chce ją przeczytać. Wyjątkiem
jest procent w pierścieniu, bo towarzyszy rysowaniu łuku.

`prefers-reduced-motion: reduce` sprowadza wszystkie czasy do 0,01 ms
(zasada [§2.11](#2-zasady-nienegocjowalne), implementacja w `tokens.css`).
Pierścień rysuje się wtedy od razu w docelowym stanie — nie znika, bo niesie informację.

---

## 8. Makiety

✅ **USTALONE** — statyczny HTML, otwierany dwuklikiem. Arkusz Tailwinda jest
**wkompilowany w plik**, więc makiety działają bez sieci; z zewnątrz ładują się tylko
kroje z Google Fonts.

| Ekran | Plik | Motywy | Co zawiera |
|---|---|---|---|
| Miesiąc (dashboard) | [`design/mockups/dashboard.html`](../design/mockups/dashboard.html) | oba | cztery stany: ładowanie · pusto · błąd · treść; osobno fragment z ujemnym wykonaniem celu |
| Formularz transakcji | [`design/mockups/transaction-form.html`](../design/mockups/transaction-form.html) | oba | wydatek · przelew z plakietką efektu alokacji · walidacja |
| Przegląd paragonu | [`design/mockups/receipt-review.html`](../design/mockups/receipt-review.html) | oba | suma zgodna · suma niezgodna · przetwarzanie |
| Próbki kierunków | [`design/directions/`](../design/directions/) | oba | materiał historyczny wyboru; `index.html` porównuje trzy obok siebie |

**Przypadki brzegowe w makietach.** Kwota siedmiocyfrowa i ujemna (`−1 215 727,90 zł`
jako majątek netto — [07 §7](./07-domain-rules.md): suma kont minus suma zobowiązań, przy
kredycie hipotecznym wynik jest ujemny i jest poprawny). Nazwa kategorii nieszczędząca
miejsca („Oprogramowanie i narzędzia" z grupy B2B, [ADR-012](./14-decisions-log.md#adr-012)).
Ujemne wykonanie celu procentowego ([ADR-011](./14-decisions-log.md#adr-011)). Pozycja
paragonu z pewnością 41%, czyli poniżej progu 60%. Kwota dodatnia wśród pozycji paragonu
(rabat). Zero.

**Czego makiety celowo nie pokazują.** Stanów hover — projektujemy na telefon, a hover
tam nie istnieje (§9). Animacji — opisane w §7 liczbowo, bo statyczny HTML i tak by ich
nie zweryfikował.

---

## 9. Granice kierunku wizualnego

✅ **USTALONE** — rzeczy, których żaden kierunek nie zmienia. Zapisane, żeby przy kolejnym
odświeżaniu wyglądu nikt nie „naprawił" ich przez nieuwagę.

- **Układ i nawigacja** — z [06](./06-ui-views.md). Dolny pasek zakładek, FAB i arkusze
  od dołu wynikają z obsługi jedną ręką, nie z estetyki.
- **Semantyka kolorów finansowych** — zestaw `income/expense/savings/investment/debt`
  wymuszony przez domenę.
- **Gęstość** — wiersz listy ma ≥ 44 px wysokości dotykowej, niezależnie od tego, ile
  danych dałoby się upchnąć.
- **Hover jako nośnik informacji** — na telefonie nie istnieje; nie może być jedynym
  sposobem pokazania czegokolwiek.

✅ **USTALONE** — decyzje odrzucone w trakcie projektowania i powód. Zapisane, żeby
nie wracały jako „ulepszenia".

| Odrzucone | Powód |
|---|---|
| Kierunek **Grafit** (wydatek bez odcienia, ciepły popiół zamiast czerwieni) | Najspokojniejszy z trzech i wolna strefa czerwieni dla akcji nieodwracalnej. Odpadł, bo para wpływy/wydatki schodziła przy deuteranopii do ΔE ≈ 24 — pomiar pokazał, że wyżej nie da się bez zepchnięcia wydatku do czerni albo wpływu do neonu. |
| Kierunek **Nokturn** (paleta na osi temperatury) | Najczytelniejszy kątem oka: chłodne = pieniądz zostaje, ciepłe = wychodzi. Odpadł na „spokój ponad osobowość" — najwięcej koloru z trzech na ekranie, który ma siedem sekcji. |
| **Lato** jako krój interfejsu | Najlepsza polska diakrytyka z rozważanych (projektant: Łukasz Dziedzic) i najcieplejszy charakter. Nie ma grubości 500 ani 600 — Google Fonts odpowiada `HTTP 400` — a skala z §3.3 wymaga obu. |
| **Literata**, **Bitter**, **Faustina**, **Karla** | Cyfry proporcjonalne domyślnie; wymagają jawnego `tnum`. Przy kolumnie kwot wolimy krój, który jest tabelaryczny sam z siebie. |
| **Newsreader** jako krój kwot | Najwyższy kontrast grubości z rozważanych szeryfów: w motywie ciemnym włosowe kreski znikają, a minus wyraźnie się załamuje. |
| `--debt` w strefie bursztynu | Przy deuteranopii nierozróżnialny od `--warning` (ΔE ≈ 3), a zaległa rata to dokładnie ta sytuacja, w której oba kolory stoją obok siebie. |
| Osobne odcienie dla `--success` i `--danger` | Osiem ról w przestrzeni, w której sześć odcieni ledwo się mieści. Rozdzielenie wymagałoby podniesienia nasycenia wszystkich — wtedy żadna barwa nie mogłaby zostać cicha. |
| `--muted` jako ścieżka pierścienia | Około 1,2:1 wobec `--card`. Przy wykonaniu ujemnym, gdy nic jej nie wypełnia, pierścień znika. |
| `--foreground` jako przyciemnienie pod arkuszem | Działa tylko w motywie jasnym; w ciemnym rozjaśniałoby ekran. Stąd osobny `--scrim`. |
| FAB zachodzący na pasek zakładek | Zasłaniałby „Więcej", czyli odbierał dostęp do Kont, Zobowiązań i Ustawień. |
| Cienie jako nośnik hierarchii | W motywie ciemnym tracą siłę. Hierarchię niesie linia i odstęp; cień dostaje tylko arkusz i FAB. |
| Animowanie kwot przewijaniem do wartości | Utrudnia odczyt dokładnie wtedy, gdy ktoś chce kwotę przeczytać. |

---

## 10. Lista kontrolna wdrożenia

- [x] **Każdy token ma wartość w obu motywach** — 27 tokenów; kroje, promienie i skala
      celowo tylko w `:root`, reszta nadpisana w `.dark`.
- [x] **Kontrast sprawdzony w obu motywach** (tekst 4,5:1, interfejs 3:1) —
      `python3 design/tools/palette_audit.py`: **84 sprawdzenia, zero naruszeń**.
      Skrypt czyta `tokens.css`, więc nie może się z nim rozjechać.
- [x] **Para wpływy/wydatki rozróżnialna przy deuteranopii** — ΔE 31,0 (jasny)
      i 34,8 (ciemny) przy progu 28; przy protanopii 26,2 i 26,3 przy progu 26.
- [x] **Wszystkie cele dotykowe ≥ 44 px na 390 px** — sprawdzone automatem na
      wszystkich trzech makietach w obu motywach: zero elementów poniżej progu.
- [x] **`<Money>` obsługuje zero, wartość ujemną i kwotę siedmiocyfrową** — wszystkie
      trzy przypadki stoją w makietach; `−1 215 727,90 zł` w nagłówku sekcji „Konta".
- [x] **`<ProgressRing>` obsługuje wartość ujemną i przekroczenie 100%** — [§4.7](#47-progressring-i-progressbar);
      ujemna rysowana jako ślad kropek w lewo, nie jako zero.
- [x] **Cztery stany zamakietowane** — dashboard: ładowanie, pusto, błąd, treść, w obu motywach.
- [x] **`prefers-reduced-motion` uwzględnione** — reguła w `tokens.css`, czasy w [§7](#7-ruch).
- [x] **`tokens.css` zgodny z tym dokumentem** — tabele w §3.1 i §3.2 są **generowane
      z `tokens.css`**, nie przepisywane ręcznie.
- [x] **`tailwind.config.ts` mapuje wszystkie tokeny** — 27 z 27, sprawdzone automatem.
- [x] **Sekcja §9 wypełniona** — dwanaście odrzuconych decyzji z powodami.
- [x] **[`06-ui-views.md`](./06-ui-views.md) §4 wskazuje na ten dokument** — skrócone
      do tabeli odnośników.

### Czego ta lista nie obejmuje

`pnpm typecheck && pnpm lint && pnpm test` **nie zostało uruchomione** — zależności nie
są zainstalowane, bo zadanie `F0-1` (`pnpm install`) jest jeszcze przed nami. Ta sesja
zmieniła w `apps/web/` wyłącznie `tokens.css` (CSS, poza zasięgiem typechecku)
i `tailwind.config.ts`, którego składnię sprawdzono osobnym parserem TypeScriptu —
jedyne zgłoszenia to nierozwiązane moduły `tailwindcss` i `tailwindcss-animate`,
czyli dokładnie to, co znika po `pnpm install`.
