# 14 — Dziennik decyzji (ADR)

Rejestr decyzji projektowych i odstępstw od pierwotnych założeń. Każdy wpis odpowiada
na trzy pytania: **co ustalono**, **dlaczego** i **jakim kosztem**.

Nowy wpis dodajemy zawsze, gdy:

- odchodzimy od tego, co opisano w dokumentach planu,
- podejmujemy decyzję, która ograniczy przyszłe wybory,
- świadomie akceptujemy uproszczenie mające widoczne konsekwencje.

Format: numer rosnąco, data, status (`przyjęta` / `wycofana` / `zastąpiona przez ADR-XXX`).

---

<a id="adr-001"></a>

## ADR-001 — Monorepo pnpm ze współdzieloną paczką kontraktów

**Data:** 2026-09-20 · **Status:** przyjęta

**Decyzja.** Trzy paczki w jednym repozytorium: `apps/api`, `apps/web`, `packages/shared`.
Kontrakty DTO (schematy Zod) żyją w `shared` i są importowane przez obie aplikacje.

**Dlaczego.** Backend i front mówią o tych samych bytach. Duplikowanie typów prowadzi
do cichego rozjechania się kontraktu — zwłaszcza przy kwotach i jednostkach. Jeden
schemat Zod daje jednocześnie walidację na serwerze, typ TS na obu końcach i walidację
formularza. Komunikat „Przelew wymaga konta docelowego" istnieje w jednym miejscu.

**Koszt.** Nieco bardziej złożona konfiguracja budowania i Dockerfile. Wymaga
`pnpm deploy --filter` przy pakowaniu obrazu produkcyjnego.

---

<a id="adr-002"></a>

## ADR-002 — Kwoty jako liczby całkowite w groszach

**Data:** 2026-09-20 · **Status:** przyjęta

**Decyzja.** Wszystkie kwoty to `INTEGER` w groszach, w kodzie z sufiksem `...Minor`.
Żadnych `REAL` w kolumnach pieniężnych, żadnej arytmetyki zmiennoprzecinkowej.

**Dlaczego.** `0.1 + 0.2 !== 0.3`. W aplikacji, która sumuje setki transakcji i liczy
z nich procenty, błędy zaokrągleń kumulują się w widoczne rozjazdy. Sufiks w nazwie
pola sprawia, że pomyłka „złote czy grosze" jest widoczna w kodzie, nie dopiero w wyniku.

**Koszt.** Konwersja na granicy UI (`parseAmountToMinor`, `formatMinor`). Wyjątek:
`document_items.quantity` i `confidence` pozostają `REAL` — to nie są pieniądze.

---

<a id="adr-003"></a>

## ADR-003 — Przelew jako jeden wiersz, nie podwójny zapis księgowy

**Data:** 2026-09-20 · **Status:** przyjęta

**Decyzja.** Przelew między kontami to jedna transakcja z `account_id` (źródło)
i `counter_account_id` (cel), zamiast dwóch wierszy w konwencji podwójnego zapisu.

**Dlaczego.** Pełna podwójna księgowość jest poprawniejsza rachunkowo, ale wymusza
obsługę par wierszy przy każdej edycji, usunięciu i w każdym raporcie. W budżecie
domowym prowadzonym przez dwie osoby ta poprawność nie kupuje niczego, co byłoby
widoczne dla użytkownika. Saldo konta wychodzi identyczne przy prostszych zapytaniach.

**Koszt.** Wyliczanie salda wymaga dwóch warunków (`account_id` i `counter_account_id`).
Ewentualne przejście na podwójny zapis wymagałoby migracji danych.

---

<a id="adr-004"></a>

## ADR-004 — Zobowiązania bez rozbicia raty na kapitał i odsetki

**Data:** 2026-09-20 · **Status:** przyjęta

**Decyzja.** Cała rata pomniejsza „pozostałą kwotę do spłaty". Nie prowadzimy
harmonogramu amortyzacji. Korekta stanu przez `POST /liabilities/:id/rebase`.

**Dlaczego.** Wymaganie mówi wprost o „pozostałej kwocie, miesięcznej racie i okresie
spłaty" — czyli o tym, jak ludzie myślą o swoich zobowiązaniach („zostało 24 raty
po 1500"). Prawidłowy harmonogram wymagałby stopy procentowej, jej zmian w czasie,
obsługi nadpłat i karencji. To osobny projekt, a pytanie użytkownika brzmi
„ile jeszcze", nie „jaka część raty to odsetki".

**Koszt.** Przy kredycie hipotecznym „pozostała kwota" rozjeżdża się z saldem kapitału
w banku — tym bardziej, im dłużej. Łagodzone przez `rebase` (aktualizacja z wyciągu),
podpowiadany raz na kwartał dla zobowiązań typu `mortgage`.

---

<a id="adr-005"></a>

## ADR-005 — Klasyfikacja alokacji zapisywana, nie wyliczana na bieżąco

**Data:** 2026-09-20 · **Status:** przyjęta

**Decyzja.** `transactions.allocation_kind` jest kolumną wypełnianą przy zapisie
(z podpowiedzi wynikającej z klas kont, z możliwością nadpisania przez użytkownika),
a nie wyliczaną przy każdym odczycie z bieżących klas kont.

**Dlaczego.** Dwa powody. Po pierwsze, użytkownik musi móc powiedzieć „ten konkretny
przelew to nie jest oszczędzanie" — bez tego mechanika % jest sztywna i szybko przestaje
odpowiadać rzeczywistości. Po drugie, zmiana klasy konta nie może zmieniać historii:
przekwalifikowanie konta w listopadzie nie powinno przepisywać wyników z marca.

**Koszt.** Redundancja: informacja istnieje w transakcji i wynika (zwykle) z kont.
Rozbieżność jest możliwa, ale zamierzona — a raporty za zamknięte miesiące są stabilne.

> **Sprostowanie (ADR-011).** Pierwotnie decyzja mówiła o jednej kolumnie `allocation_kind`.
> Po przejściu na ujęcie netto zapisujemy zamiast niej **migawki klas obu kont**
> (`source_allocation_class`, `target_allocation_class`) plus `allocation_override`.
> Sama zasada — „klasyfikacja jest zapisywana, nie odczytywana na bieżąco" — pozostaje
> w mocy i to ona jest treścią tego ADR.

---

<a id="adr-006"></a>

## ADR-006 — Miesiąc budżetowy wyłącznie kalendarzowy w v1

**Data:** 2026-09-20 · **Status:** przyjęta

**Decyzja.** Kolumna `households.month_start_day` istnieje i funkcje przyjmują parametr,
ale w v1 obsługujemy wyłącznie wartość `1`; ustawienie jest ukryte w UI.

**Dlaczego.** Miesiąc budżetowy zaczynający się np. 26. dnia (dzień wypłaty) to realna
potrzeba części osób, ale wymaga przeliczenia `month_key` we wszystkich istniejących
wierszach przy każdej zmianie ustawienia — czyli migracji danych uruchamianej z UI.
To osobne, nietrywialne zadanie, a pierwotne wymagania go nie wymieniają.

**Koszt.** Osoby z takim rytmem wypłat muszą na razie akceptować miesiąc kalendarzowy.
Struktura jest przygotowana, więc dołożenie tego nie będzie wymagało zmiany schematu.

---

<a id="adr-007"></a>

## ADR-007 — Jedna waluta w v1

**Data:** 2026-09-20 · **Status:** przyjęta

**Decyzja.** Kolumny `currency` istnieją w schemacie, ale wszystkie rekordy mają walutę
gospodarstwa (`PLN`). Brak przewalutowania i kursów.

**Dlaczego.** Wielowalutowość zrobiona porządnie oznacza kursy historyczne, wybór źródła
kursów, moment przeliczenia i decyzję, w jakiej walucie pokazywać sumy. Pierwotne
wymagania nie wspominają o walutach obcych.

**Koszt.** Konto walutowe lub inwestycja w USD wymagałaby ręcznego przeliczania.
Kolumny są na miejscu, więc dołożenie nie wymusi migracji struktury.

---

<a id="adr-008"></a>

## ADR-008 — Analiza dokumentów w procesie aplikacji, bez kolejki zadań

**Data:** 2026-09-20 · **Status:** przyjęta

**Decyzja.** Odczyt dokumentu przez AI działa w tle procesu Node, po odesłaniu
odpowiedzi `202`. Bez brokera kolejek i bez osobnego procesu roboczego.

**Dlaczego.** Dwóch użytkowników, kilkanaście dokumentów miesięcznie, jeden kontener.
Redis lub BullMQ to dodatkowa usługa do uruchomienia, monitorowania i backupowania —
koszt bez pokrycia w skali.

**Koszt.** Restart kontenera w trakcie analizy zostawia dokument w stanie `processing`.
Łagodzone: przy starcie aplikacji dokumenty wiszące ponad 10 minut są oznaczane jako
`failed` z możliwością ponowienia jednym kliknięciem.

---

<a id="adr-009"></a>

## ADR-009 — „Planowane wydatki" jako osobny byt, nie wariant pozycji cyklicznej

**Data:** 2026-09-20 · **Status:** przyjęta
**Kontekst:** rozszerzenie zakresu zgłoszone w trakcie planowania (wymaganie #13)

**Decyzja.** Nowa tabela `planned_expenses` z własnym modułem, zamiast rozszerzania
`recurring_rules` o tryb „raz w roku, kwota szacunkowa".

**Dlaczego.** Byty różnią się trzema rzeczami naraz: kwota (stała kontra szacunkowa),
rytm (powtarzalny kontra pojedynczy) i — najważniejsze — sensem dla użytkownika.
Pozycja cykliczna odpowiada na pytanie „co mi co miesiąc schodzi", planowany wydatek
na „czy będę miał na to odłożone". Z tego drugiego wynikają mechanizmy, których reguły
cykliczne nie mają i mieć nie powinny: wyliczana rata odkładania, pokrycie procentowe,
ostrzeżenia o płynności, status `funding`. Wciśnięcie obu w jedną tabelę dałoby
kilkanaście kolumn nieużywanych przez połowę wierszy i warunki `if (isPlanned)`
rozsiane po całym module.

**Koszt.** Dwa miejsca w UI, w których można dodać „coś, co się powtarza co roku" —
potencjalne zamieszanie. Łagodzone podpowiedzią przy tworzeniu rocznej reguły cyklicznej
kierującą do właściwego ekranu ([06 §3.10](./06-ui-views.md#310-planowane-wydatki--planned))
oraz tabelą rozstrzygającą „kiedy co" w [07 §6.5](./07-domain-rules.md#65-planowane-wydatki).

**Alternatywy odrzucone.**

- *Flaga `is_planned` na `recurring_rules`* — odrzucona z powodów wyżej.
- *Traktowanie tego jako celu oszczędnościowego* — cel kończy się zgromadzeniem kwoty,
  planowany wydatek kończy się jej wydaniem. Odkładanie jest środkiem, nie celem.
  Powiązanie pozostaje możliwe przez `set_aside_goal_id`.

---

<a id="adr-011"></a>

## ADR-011 — Realizacja celów procentowych liczona netto

**Data:** 2026-09-20 · **Status:** przyjęta
**Zastępuje:** pierwotne założenie z 07 §2.2 (wykonanie brutto)

**Decyzja.** Wykonanie celu procentowego w miesiącu to **wpłaty minus wypłaty** z danej puli.
Wypłata z konta oszczędnościowego na bieżące zmniejsza wykonanie; przelew
z oszczędnościowego na maklerskie zmniejsza oszczędności i zwiększa inwestycje jednocześnie.

**Dlaczego.** Ujęcie brutto pokazywało „odłożono 2 000" w miesiącu, w którym wpłacono 2 000
i wypłacono 1 500. Formalnie mierzyło dyscyplinę wpłat, praktycznie — wprowadzało w błąd
co do tego, czy majątek urósł. Skoro ten ekran ma odpowiadać na pytanie „czy trzymam plan",
musi liczyć to, co naprawdę zostało odłożone.

**Konsekwencje.**

- `transactions.allocation_kind` zastąpione przez `source_allocation_class`,
  `target_allocation_class` (migawki) i `allocation_override`. Efekt alokacji jest
  **listą**, bo jeden przelew potrafi dotknąć dwóch pul naraz.
- `actualAmountMinor`, `actualPercentBps` i `fulfillmentBps` mogą być **ujemne**.
  Kontrakty DTO przestają używać w tych polach `BpsSchema` (ma `min(0)`).
- `debt_repayment` przestaje być wartością `allocation_kind` — jest wyliczane z wydatków
  powiązanych ze zobowiązaniem (07 §2.2a). To przy okazji usuwa sprzeczność pierwotnego
  niezmiennika I-5, który wymagał `type='transfer'` dla czegoś, co zawsze jest wydatkiem.
- UI musi umieć pokazać wykonanie ujemne — pusty pierścień i kwotę ze znakiem minus,
  nie zero.

**Koszt.** Więcej przypadków brzegowych do przetestowania i konieczność sensownego
zaprezentowania wartości ujemnych. Możliwość „wyzerowania" złego miesiąca przez
przelew tam i z powrotem znika, bo przerzucenie w obrębie jednej puli nadal nic nie zmienia.

---

<a id="adr-012"></a>

## ADR-012 — Przychód z działalności zapisywany netto

**Data:** 2026-09-20 · **Status:** przyjęta

**Decyzja.** Przychód z B2B wpisujemy w kwocie, która realnie wpływa na konto — **po
podatku i ZUS**. Obciążenia publicznoprawne nie są rejestrowane jako wydatki i nie mają
własnych kategorii. Kosztami działalności pozostają rzeczy faktycznie płacone z tych
pieniędzy: księgowość, adres wirtualny, narzędzia, sprzęt.

**Dlaczego.** Taka jest praktyka prowadzenia tego budżetu: podatek i ZUS są „poza dochodem",
więc wciąganie ich do księgi podwyższałoby zarówno wpływy, jak i wydatki o tę samą kwotę,
zniekształcając wszystkie wskaźniki procentowe bez żadnego zysku informacyjnego.

**Koszt.** Aplikacja nie pokaże pełnego obrotu firmy ani efektywnej stopy podatkowej —
od tego jest księgowość, nie budżet domowy. Gdyby kiedyś było potrzebne, wystarczy dodać
kategorie i zacząć wpisywać brutto; schemat tego nie blokuje.

---

<a id="adr-010"></a>

## ADR-010 — Rata odkładania wyliczana, nie przechowywana

**Data:** 2026-09-20 · **Status:** przyjęta

**Decyzja.** `monthlySetAsideMinor` jest liczone przy każdym odczycie
(`ceil(pozostało / miesięcy do terminu)`), nie zapisywane w bazie.

**Dlaczego.** Wartość zmienia się przy każdym zdarzeniu: po wpłacie maleje, po pominięciu
miesiąca rośnie, po korekcie szacunku zmienia się skokowo. Zapisana byłaby nieaktualna
niemal natychmiast, a synchronizowanie jej wymagałoby przeliczania przy każdej operacji
dotykającej wydatku.

**Koszt.** Kilka działań arytmetycznych na odczyt — nieistotne przy tej skali.

---

## Wpisy planowane

Miejsca, w których ADR trzeba będzie dopisać w kolejnych zadaniach:

| Kiedy | Czego będzie dotyczyć |
|---|---|
| F0-1 | Faktyczne wersje pakietów po `pnpm install`, zwłaszcza para `zod` ↔ `fastify-type-provider-zod` |
| F1-1 | Zmierzone parametry argon2id na docelowym VPS |
| F3-1 | Kształt zapytań agregujących modułu `months`, jeśli odbiegnie od planu |
| F7-11 | Wyniki oceny jakości OCR i ewentualna zmiana modelu lub promptu |
| F8-7 | Wybór reverse-proxy i konfiguracja TLS na VPS |

---

<a id="adr-013"></a>

## ADR-013 — Kierunek wizualny „Papier"

**Data:** 2026-09-21 · **Status:** przyjęta

**Decyzja.** Warstwa wizualna aplikacji to kierunek **„Papier"**: ciepłe tło o odcieniu
papieru (40°), kwoty składane szeryfowym **Spectral**, interfejs **Source Sans 3**,
hierarchia budowana **włosową linią i odstępem 24 px**, a nie wypełnionym tłem kafla ani
cieniem. Kolor zredukowany do poziomu tuszu. Pełny zapis: [15 §1](./15-design-system.md#1-kierunek-wizualny)
i [15 §3](./15-design-system.md#3-tokeny); wartości w `apps/web/src/styles/tokens.css`.

**Dlaczego ten, a nie pozostałe.** Powstały trzy kierunki, każdy jako działająca próbka
(`design/directions/`, `index.html` porównuje je obok siebie):

- **Grafit** — wydatek oddaje odcień i staje się ciepłym popiołem, przez co czerwień
  zostaje wolna dla akcji nieodwracalnej. Najspokojniejszy z trzech. Odrzucony: pomiar
  pokazał, że przy tak niskim nasyceniu wydatku para wpływy/wydatki schodzi przy
  deuteranopii do ΔE ≈ 24, a podniesienie tej wartości wymaga zepchnięcia wydatku
  do czerni albo wpływu do neonu — jedno i drugie niszczy tezę kierunku.
- **Nokturn** — paleta ułożona na osi temperatury (chłodne = pieniądz zostaje, ciepłe =
  wychodzi). Najczytelniejszy kątem oka. Odrzucony na zasadę „spokój ponad osobowość":
  najwięcej koloru z trzech na ekranie, który ma siedem sekcji.
- **Papier** — wybrany. Hierarchia z typografii i linii oznacza, że siedem sekcji
  dashboardu nie zamienia się w siedem prostokątów, a kwota jest na ekranie
  najmocniejszym elementem bez konkurencji ze strony obramowań.

**Ustalenia, które są wynikiem pomiaru, nie gustu** — obowiązują niezależnie od tego,
kto kiedyś zechce odświeżyć wygląd:

1. **`--debt` nie może być bursztynowy.** Zobowiązanie i ostrzeżenie w tej samej strefie
   ciepłej dają przy deuteranopii ΔE ≈ 3, czyli są nierozróżnialne — a zaległa rata to
   dokładnie ta sytuacja, w której oba kolory stoją obok siebie. `--debt` siedzi na osi
   różu/śliwki, sąsiadując z `--investment`.
2. **`--savings` i `--investment` rozdziela jasność, nie odcień.** Przy dichromatyzmie
   z barwy zostaje oś żółto-niebieska, więc błękit i fiolet zlewają się co do odcienia.
   Nasycenie `--investment` (42% w motywie jasnym) jest **minimalne**, przy którym para
   przechodzi próg przy protanopii — obniżenie go zlewa pierścienie nieodwracalnie.
3. **`--success` = `--income`, `--danger` = `--expense`.** Osiem ról semantycznych nie
   mieści się w przestrzeni, w której każda miałaby zostać cicha. Tokeny są osobne,
   żeby dało się je kiedyś rozdzielić bez przeszukiwania kodu.
4. **Ścieżka pierścienia nie używa `--muted`** (ok. 1,2:1 wobec `--card`): przy wykonaniu
   ujemnym, gdy nic jej nie wypełnia, pierścień znika.
5. **Przyciemnienie pod arkuszem ma własny token `--scrim`**, bo `--foreground`
   w motywie ciemnym jest prawie biały i rozjaśniałby ekran zamiast go przygasić.

**Odstępstwa od wartości tymczasowych z `06 §4`** (samo `06 §4` opisywało je jako
tymczasowe): kwoty na listach mają grubość **600**, nie 500 — Spectral 500 na ciemnym tle
przegrywa z nazwą pozycji obok; odstęp między sekcjami to **24 px**, nie 12 px — przy 12 px
linie rozdzielające zlewają się w kreskowanie.

**Koszt.** Kierunek stoi na typografii, więc jest wrażliwy na podmianę kroju: Spectral
i Source Sans 3 mają cyfry tabelaryczne **domyślnie**, a zamiennik bez tej własności
rozjedzie każdą kolumnę kwot. Oba kroje trzeba podać z własnego serwera (podzbiór
`latin-ext`, `woff2`) — aplikacja stoi na prywatnym VPS-ie i nie ma powodu wysyłać
adresów IP domowników do Google przy każdym otwarciu. Brak wypełnionych kafli oznacza
też, że układ desktopowy będzie wymagał osobnej decyzji o tym, co niesie hierarchię
na szerokim ekranie — na 390 px wystarcza linia i odstęp, na 1200 px może nie wystarczyć.

**Weryfikacja.** `design/tools/palette_audit.py` czyta `tokens.css` i sprawdza progi
kontrastu oraz rozróżnialność par przy deuteranopii i protanopii (macierze Machado 2009).
Stan: **84 sprawdzenia, zero naruszeń** w obu motywach. Uruchamiać po każdej zmianie
wartości — inaczej dwa punkty listy kontrolnej `15 §10` są deklaracją, a nie faktem.

---

<a id="adr-014"></a>

## ADR-014 — Wersje zależności ustalone instalacją; Zod zostaje na 3.x

**Data:** 2026-09-21 · **Status:** przyjęta

**Decyzja.** Wersje w `package.json` przestały być deklaracją. Pierwsza instalacja
(`F0-1`) potwierdziła je uruchomieniem i domknęła uwagę operacyjną z
[01 §3](./01-tech-stack.md#3-wersje-pakietów--ważna-uwaga-operacyjna). Ustalenia:

| Warstwa | Wersja | Uwaga |
|---|---|---|
| `zod` | **3.25.76** | ostatnia z gałęzi 3.x; **zostaje** |
| `fastify` ↔ `fastify-type-provider-zod` | **5.12.5** ↔ **4.0.2** | para zweryfikowana `app.inject()` |
| `drizzle-orm` / `drizzle-kit` | 0.45.3 / 0.31.11 | SQLite 3.53.4 przez `better-sqlite3` 13.0.3 |
| `@anthropic-ai/sdk` | **0.127.0** | było `^0.33.0` (grudzień 2024) |
| `tailwindcss` | 3.4.19 | bez zmian — [ADR z 01 §2.4](./01-tech-stack.md#24-dlaczego-tailwind-34-a-nie-4) obowiązuje |
| `typescript` | 5.9.3 | TS 7 odpada: `typescript-eslint` deklaruje `<6.1.0` |
| `@types/node` | 22.x | trzyma się majora runtime'u z `.nvmrc`, nie „latest" |

Narzędzia podniesione o majory: ESLint 9 → 10, Vitest 2 → 5, Vite 6 → 8,
`vite-plugin-pwa` 0.21 → 1.3, `@fastify/*`, `jose` 5 → 6, `pino` 9 → 10,
`dotenv` 16 → 18, `argon2` 0.41 → 0.45, `sharp` 0.33 → 0.35. Instalacja nie zgłasza
**żadnego** ostrzeżenia o niespełnionych zależnościach równorzędnych.

**Dlaczego Zod zostaje na 3.x.** Punkt zapalny wskazany w roadmapie okazał się nie
gryźć: `fastify-type-provider-zod@4.0.2` deklaruje `zod ^3.14.2` i `fastify ^5.0.0` —
oba spełnione. Przejście na Zod 4 wymaga type providera ≥ 6, a ten od wersji 5 ma
w zależnościach równorzędnych `@fastify/swagger` i `openapi-types`. Projekt nigdzie nie
wystawia OpenAPI ([04](./04-api-spec.md) nie wspomina o nim ani razu), więc kosztem
byłyby dwie zależności dodane wyłącznie po to, żeby uciszyć ostrzeżenia — albo życie
z ostrzeżeniami przy każdej instalacji.

**Dlaczego SDK Anthropica to był jedyny podnoszony major bez dyskusji.** `^0.33.0`
pochodzi z grudnia 2024 i nie zna kształtu API, na którym stoi [08](./08-ocr-ai-pipeline.md):
w 0.127.0 istnieją `beta.messages.toolRunner`, `files.upload` i `messages.countTokens` —
sprawdzone na zainstalowanej paczce. Model `claude-sonnet-5` z
[01 §2.6](./01-tech-stack.md#26-model-ai) jest aktualny i zostaje bez zmian.

**Koszt.** Zod 3.25.76 to gałąź zamknięta — migracja do 4.x kiedyś nastąpi i dotknie
**każdego** DTO w `packages/shared`, a przy okazji wymusi type provider ciągnący
OpenAPI. Świadomie odkładamy ten koszt, zamiast płacić go przed napisaniem pierwszego
kontraktu. Wpisane do „Zauważone" w [13](./13-progress.md) jako `Z-6`.

**Weryfikacja — czym to potwierdzono.** Nie samą instalacją:

- trasa Fastify ze schematem Zod na `params`, `body` i `response`, wywołana przez
  `app.inject()`: poprawne żądanie zwraca 200, `params/id` spoza formatu UUID → 400,
  a pole nieobjęte schematem odpowiedzi **znika** z ciała (serializer działa jako lista
  dozwoleń — istotne, bo [09](./09-security-auth.md) opiera się na tym, że odpowiedź
  nie wynosi pól spoza kontraktu);
- rejestracja `@fastify/cors`, `helmet`, `cookie` i `rate-limit` w nowych majorach;
- pragmy z [01 §2.3](./01-tech-stack.md#23-dlaczego-better-sqlite3-synchroniczne-a-nie-nodesqlite--libsql)
  (`foreign_keys=ON`, `busy_timeout=5000`) plus zapis i odczyt przez Drizzle;
- `argon2id` przy 64 MiB / t=3 / p=1 — **318 ms** w kontenerze deweloperskim;
- pełny łańcuch `pnpm build` (shared → api → web) i uruchomienie `node dist/index.js`
  tak, jak robi to kontener.

> **Uwaga o `:memory:`.** Przy bazie w pamięci `journal_mode` zgłasza `memory`,
> nie `wal` — SQLite nie prowadzi WAL dla takiej bazy. To nie jest błąd konfiguracji
> i nie należy tego „naprawiać" w `F0-4` ani w testach z `F0-7`.

---

<a id="adr-015"></a>

## ADR-015 — Szkielet budowania: osobny tsconfig do emisji, `shared` wystawia `dist`

**Data:** 2026-09-21 · **Status:** przyjęta

**Decyzja.** Pierwsze uruchomienie narzędzi (`F0-1`) pokazało, że pierwotny szkielet
nie przechodzi własnych bramek. Pięć poprawek, wszystkie w konfiguracji:

1. **`apps/api` ma dwa tsconfigi.** `tsconfig.json` jest konfiguracją *rozwiązującą*
   (`noEmit`, obejmuje `src`, `test` i `drizzle.config.ts`) — używa jej `pnpm typecheck`
   i typowany ESLint. `tsconfig.build.json` jest konfiguracją *emitującą* (`rootDir: src`,
   wyłącznie `src`) — używa jej `pnpm build`. Jeden plik nie mógł być obojgiem:
   `drizzle.config.ts` leży poza `rootDir`, co przerywało `tsc` błędem TS6059, a przy
   jednym pliku do `dist/` trafiałyby także testy.
2. **`@fineapp/shared` wystawia na zewnątrz `dist`, nie `src`.** Dotąd `exports`
   wskazywało `./src/index.ts`. Zbudowane `apps/api/dist/index.js` zawiera gołe
   `import ... from '@fineapp/shared'`, więc w kontenerze `node dist/index.js`
   rozwiązywał ten import do **pliku `.ts`**, którego Node nie uruchomi. Narzędzia
   deweloperskie sięgają po źródło inną drogą (`paths` w tsconfigu API, alias w Vite),
   więc wygoda pracy nie ucierpiała.
3. **Zniknęły `references` z `apps/api` i `apps/web`.** Referencja do paczki `composite`
   każe TypeScriptowi żądać zbudowanego wyjścia (TS6305), co kłóciło się z `paths`
   wskazującym źródło. Spójność zapewnia `paths`; `typecheck` nie wymaga builda.
4. **`tsBuildInfoFile` przeniesione do `dist/`.** Leżąc obok `tsconfig.json`, przeżywał
   `rm -rf dist` i kolejny build **po cichu nie emitował niczego**.
5. **Pliki konfiguracyjne w JS** (`eslint.config.js`, `postcss.config.js`) dostały
   w `eslint.config.js` blok z `disableTypeChecked` — nie należą do żadnego tsconfiga,
   więc usługa projektu nie potrafiła ich sparsować i `pnpm lint` kończył się błędem.
   `tailwind.config.ts` poszedł odwrotną drogą: trafił do `include` w `apps/web`,
   bo jest TypeScriptem tej paczki i zasługuje na sprawdzenie typów.

Poza tym `vitest run` dostał `--passWithNoTests` (bez plików testowych kończył się
kodem 1, a paczki Fazy 0 jeszcze testów nie mają) i powstał `packages/shared/src/index.ts`,
obiecywany przez `exports` tej paczki, a nieistniejący.

**Dlaczego to nie mogło poczekać.** Projekt wymaga trzech zielonych bramek przed zakończeniem
każdej zmiany, a żadna z nich nie była zielona: `typecheck` przerywał się na braku źródeł
w `shared`, `lint` na trzech plikach konfiguracyjnych, `test` na braku testów. Punkty 1–3
uderzyłyby w `F0-2` przy pierwszym imporcie z `shared` — sprawdzone sondą: import
`@fineapp/shared` z `apps/api/src` wywracał build, dopóki obie poprawki nie weszły.

**Koszt.** Dwa tsconfigi w `apps/api` zamiast jednego — zmiana opcji kompilatora wymaga
uwagi, który plik jest właściwy (dziedziczenie ogranicza to do `tsconfig.json`).
`@fineapp/shared` trzeba zbudować przed `apps/api`; kolejność jest już zapisana
w skrypcie `build` w korzeniu i w `Dockerfile`. `--passWithNoTests` oznacza, że
przekonfigurowanie Vitesta, po którym przestaje on widzieć testy, przejdzie niezauważone
— do usunięcia, gdy `F0-3` i `F0-7` wniosą pierwsze testy.

---

<a id="adr-016"></a>

## ADR-016 — Kształt `core/`: błędy, generator ID, konfiguracja

**Data:** 2026-09-21 · **Status:** przyjęta

**Decyzja.** Cztery ustalenia podjęte przy pisaniu `core/` (`F0-2`), z których każde
odbiega od litery planu albo domyka jego lukę.

### 1. Podklasy błędów ustalają kod i status; dochodzi pięć brakujących

[02 §7](./02-architecture.md#7-obsługa-błędów) pokazywał podklasy z pustym ciałem
(`class ValidationError extends AppError {}`), co znaczy konstruktor odziedziczony —
a więc kod i status podawane przy **każdym** rzuceniu. To zaproszenie do `NotFoundError`
ze statusem 400. Podklasy dostały własne konstruktory `(message, details?)`.

`02 §7` wymieniał siedem klas, a [04 §3](./04-api-spec.md#3-format-błędów) dwanaście
kodów. Brakujące pięć (`DomainRuleViolationError`, `FileTooLargeError`,
`UnsupportedMediaTypeError`, `AiBudgetExceededError`, `InternalError`) istnieje teraz
jako klasy. `02 §7` poprawione.

### 2. `AI_BUDGET_EXCEEDED` to **402**, a naruszenie reguły domenowej to **422**

[08](./08-ocr-ai-pipeline.md) mówi o błędzie „`402`-podobnym"; kod potrzebował liczby,
więc jest nią 402 — nie 429, bo to nie jest ograniczenie tempa i ponowienie za minutę
nic nie da.

Przy okazji wyszła sprzeczność w [04 §2](./04-api-spec.md#2-kody-statusu): wiersz 400
brzmiał „błąd walidacji **lub naruszenie reguły domenowej**", a wiersz 422 „poprawny
kształt, niespełniony niezmiennik domenowy". [07 §2](./07-domain-rules.md) rozstrzyga na
rzecz 422. Tabela poprawiona, dopisane brakujące 402 i 500.

### 3. Generator ID jest fabryką, nie funkcją ze stanem modułowym

ULID gwarantuje kolejność w obrębie jednej milisekundy, zwiększając część losową —
co wymaga pamiętania poprzedniego wyniku. Pierwsza wersja trzymała ten stan w module
i **test to wywrócił**: dwa testy podające jawne znaczniki zaczęły na siebie wpływać
przez kolejność wykonania, bo późniejszy znacznik zaciągał generator w przyszłość.

Stan należy więc do instancji: `createIdGenerator(clock)`, a `newId()` jest domyślną
instancją na zegarze systemowym. Zegar jest wstrzykiwany tak samo jak w serwisach
([02 §5](./02-architecture.md#5-serwisy--wstrzykiwanie-zależności)) — ukryty stan
globalny to dokładnie to, czego `Clock` ma w tym projekcie unikać.

Generator zachowuje porządek również wtedy, gdy zegar **cofnie się** (NTP, zmiana
czasu): zostaje przy ostatnim znaczniku i zwiększa część losową, zamiast wyprodukować
identyfikator mniejszy od poprzedniego.

### 4. Konfiguracja nie jest singletonem modułowym

`loadConfig(source = process.env)` zwraca zamrożony obiekt; tworzy go `index.ts`
i przekazuje dalej. Singleton modułowy walidowałby się w trakcie importu, więc każdy
test dotykający czegokolwiek z `core/` wymagałby kompletu zmiennych środowiskowych.

Konfiguracja wypisuje **wszystkie** problemy naraz i po polsku (Zod domyślnie mówi
„Required"), nigdy nie pokazując wartości sekretu. To jest komunikat, który widać
w `docker compose logs app`, gdy kontener restartuje się w pętli — jedyna wskazówka,
jaką dostaje osoba stawiająca aplikację ([10](./10-deployment.md)).

Reguły ponad te z [09 §9](./09-security-auth.md#9-zarządzanie-sekretami): `AI_ENABLED`
bez `ANTHROPIC_API_KEY` nie wstaje (inaczej awaria ujawniłaby się dopiero przy pierwszym
paragonie), `REFRESH_TOKEN_TTL_SECONDS` musi przekraczać `ACCESS_TOKEN_TTL_SECONDS`,
a w produkcji `COOKIE_SECURE` musi być włączone.

**Koszt.** Więcej powierzchni API w `core/` niż zakładał szkic w `02`: dwanaście klas
błędów zamiast siedmiu, fabryka generatora obok funkcji `newId`. W zamian znika cała
klasa pomyłek, których typ nie wyłapie — zły status przy błędzie i test zależny od
kolejności wykonania.

---

<a id="adr-017"></a>

## ADR-017 — Kontrakty w `@fineapp/shared`: data kalendarzowa, nazwy, miejsce helperów

**Data:** 2026-09-21 · **Status:** przyjęta

**Decyzja.** Cztery ustalenia z pisania paczki kontraktów (`F0-3`).

### 1. Walidacja daty biznesowej jest kalendarzowa, nie przez `Date.parse`

[05 §1](./05-dto-contracts.md#1-prymitywy-domenowe--domainprimitivests) definiował
`DateOnlySchema` z dopiskiem `.refine((v) => !Number.isNaN(Date.parse(...)), 'Nieistniejąca data')`.
**To nie działa.** `Date.parse('2026-02-31T00:00:00Z')` nie zwraca `NaN` — zwraca
3 marca. Sprawdzone w Node 22:

| Wejście | `Date.parse` | Powinno |
|---|---|---|
| `2026-02-31` | przewija na 3 marca | odrzucić |
| `2026-02-29` (rok zwykły) | przewija na 1 marca | odrzucić |
| `2026-09-31` | przewija na 1 października | odrzucić |
| `2026-13-01` | `NaN` | odrzucić ✓ |

Transakcja z datą `2026-02-31` przeszłaby więc walidację i trafiła do bazy jako napis,
którego nie ma w kalendarzu — a `bookedOn` jest podstawą wyznaczania miesiąca i granic
okresu. `DateOnlySchema` używa teraz `isValidDateOnly` z `utils/month.ts`, które liczy
długość miesiąca z uwzględnieniem roku przestępnego.

### 2. Nazwy przelicznika: `toBps` / `fromBps`

Plan podawał dwie nazwy tej samej pary: [05 §14](./05-dto-contracts.md#14-helpery-izomorficzne)
i [07 §2.4](./07-domain-rules.md#24-wykonanie) mówiły `toBps` / `fromBps`,
a [07 §3](./07-domain-rules.md#3-przelicznik-kwoty-i-procentu) —
`amountToPercentBps` / `percentBpsToAmount`. Obowiązuje pierwsza para (dwa miejsca
przeciw jednemu, w tym kontrakt paczki). `07 §3` poprawione.

Przy okazji: `07 §3` używał w kierunku kwota → procent zwykłego `Math.round`, co dla
wartości ujemnych łamie regułę z [07 §8.3](./07-domain-rules.md#83-zaokrąglanie)
(„połówki w górę co do wartości bezwzględnej"). Ponieważ wykonanie alokacji liczone
netto bywa ujemne (ADR-011), **obie** funkcje używają reguły symetrycznej.
Różnica jest realna: `Math.round(-2.5)` to `-2`, więc kwota i jej przeciwność
przestawały się znosić.

### 3. `money` i `month` mieszkają wyłącznie w `shared` (zamyka `Z-9`)

Drzewo w [02 §2](./02-architecture.md#2-struktura-katalogów) przewidywało
`core/money.ts` i `core/dates.ts`, podczas gdy [05 §14](./05-dto-contracts.md)
umieszczał `money.ts` i `month.ts` w `packages/shared/utils/`. Dwie implementacje tej
samej arytmetyki to gwarancja, że kiedyś się rozjadą — a rozjazd w zaokrąglaniu kwot
jest dokładnie tym rodzajem błędu, którego nie widać, dopóki nie zacznie brakować groszy.

Rozstrzygnięcie: **`shared` ma całość**. `core/money.ts` znika z drzewa. `core/dates.ts`
zostaje, ale wyłącznie na to, czego nie da się zrobić bez strefy gospodarstwa — zamianę
`Date` na datę biznesową ([07 §1.1](./07-domain-rules.md#11-trzy-różne-pojęcia-czasu)).
Reszta modułu miesiąca operuje na **napisach** `YYYY-MM-DD` i nie dotyka `Date`, więc
nie wciąga strefy czasowej ani błędów typu „o północy wychodzi poprzedni dzień".

### 4. Próg pokrycia zapisany w konfiguracji, nie w dokumencie

[11](./11-roadmap.md) wymaga od `F0-3` **100% pokrycia**. Próg jest teraz twardy
w `packages/shared/vitest.config.ts` i sprawdza się sam przy `pnpm test:coverage`;
sprawdzono, że **potrafi zafailować** (dopisana nieużywana funkcja → exit 1 ze wskazaniem
linii). Wymaga to jednej zależności deweloperskiej: `@vitest/coverage-v8`.

**Koszt.** `isValidDateOnly` żyje w `utils/month.ts`, a `domain/primitives.ts` je stamtąd
importuje — zależność w stronę, której w drzewie nie widać. Odwrotny kierunek
(`month.ts` → `primitives.ts`) jest wyłącznie **typem** (`import type`), więc znika przy
kompilacji i cyklu w czasie wykonania nie ma. Gdyby ktoś kiedyś potrzebował tam wartości,
a nie typu, cykl powstanie i trzeba będzie wydzielić trzeci moduł.

---

<a id="adr-018"></a>

## ADR-018 — Schemat Drizzle: CHECK-i z enumów, cykle referencji, testy bez builda

**Data:** 2026-09-21 · **Status:** przyjęta

**Decyzja.** Cztery ustalenia z przepisywania [03 §3](./03-data-model.md#3-ddl) na Drizzle
(`F0-4`). Schemat odpowiada dokumentowi 1:1: **17 tabel**, 32 warunki `CHECK`,
trzy indeksy częściowe.

### 1. Listy w `CHECK` są generowane z enumów w `@fineapp/shared`

[03 §1](./03-data-model.md#1-konwencje) wymaga `TEXT` + `CHECK (... IN (...))`, a
[05 §2](./05-dto-contracts.md) nazywa enumy „jedynym źródłem tych wartości". Gdyby listy
w schemacie były przepisywane ręcznie, rozjechałyby się przy pierwszym dopisanym
wariancie — i to w najgorszy możliwy sposób: Zod by wartość przyjął, a baza odrzuciła.

Pomocnik `inEnum(column, Schema.options)` wstawia je jako literały SQL (`CHECK` nie
przyjmie parametru). Bezpieczeństwo tego kroku opiera się na teście, który sprawdza,
że każda wartość enumu pasuje do `^[a-z][a-z0-9_]*$`.

### 2. Cykliczne klucze obce wymagają adnotacji typu zwracanego

Model ma cztery cykle: zobowiązanie ↔ reguła cykliczna oraz transakcja ↔ wystąpienie,
planowany wydatek i dokument. Bez adnotacji TypeScript zgłasza `TS7022`
(„implicitly has type 'any' … referenced directly or indirectly in its own initializer").

Wszystkie referencje międzytabelowe mają więc postać
`.references((): AnySQLiteColumn => tabela.id)`. Adnotacja przerywa cykl wnioskowania;
sama referencja jest leniwa, więc cykliczny import między modułami nie jest problemem
w czasie wykonania.

### 3. `_shared.ts` nie należy do barrela

Buildery kolumn (`minorColumn`, `bpsColumn`, `dateOnlyColumn`) są hydrauliką schematu.
Re-eksportowane przez `schema/index.ts` psuły `Object.values(schema)` — wynik przestawał
być zbiorem samych tabel, co uderzyło w test sprawdzający komplet tabel.

Nazwy tych builderów niosą jednostkę celowo: `integer('x')` nie mówi nic, a
`minorColumn('x')` mówi „grosze". W projekcie, w którym pomylenie groszy ze złotówkami
jest najdroższym możliwym błędem, to nie jest ozdoba.

### 4. Testy API nie mogą zależeć od zbudowanego `shared`

ADR-015 skierował `exports` paczki `shared` na `dist` — to warunek tego, żeby
`node dist/index.js` w kontenerze wystartował. Skutek uboczny wyszedł dopiero tutaj:
**`pnpm test` w `apps/api` przestało działać bez wcześniejszego `pnpm build`**, bo Vitest
rozwiązuje moduły jak Vite. Po świeżym klonie testy po prostu nie startowały.

`apps/api/vitest.config.ts` kieruje alias `@fineapp/shared` na **źródło**, dokładnie tak
jak od początku robił to `apps/web/vite.config.ts`. Produkcja nadal czyta `dist`.

**Weryfikacja.** Schemat nie jest sprawdzony samym `tsc`. Wygenerowany DDL został
wykonany na prawdziwej bazie SQLite i potwierdzone zostało, że:

| Sprawdzenie | Wynik |
|---|---|
| liczba utworzonych tabel | 17 |
| `CHECK (amount_minor > 0)` | odrzuca kwotę ujemną |
| `CHECK (type IN (...))`, `CHECK (source IN (...))` | odrzucają wartość spoza enumu |
| klucz obcy `account_id` | odrzuca nieistniejące konto |
| `ON DELETE RESTRICT` | nie pozwala usunąć konta z transakcją |
| `UNIQUE (rule_id, due_on)` | blokuje duplikat wystąpienia (klucz idempotencji) |
| `ON DELETE CASCADE` z `households` | sprząta konta |

**Koszt.** Adnotacja `AnySQLiteColumn` na każdej referencji zubaża typ kolumny docelowej
— Drizzle nie podpowie już, do której konkretnie kolumny prowadzi klucz obcy. To cena
za obsługę cykli; alternatywą byłoby zebranie wszystkich tabel w jeden plik, co kłóci się
z „jeden plik na obszar" z [02 §2](./02-architecture.md#2-struktura-katalogów).

---

<a id="adr-019"></a>

## ADR-019 — Migracje: kopia robi runner, nie entrypoint; pusta baza bez kopii

**Data:** 2026-09-22 · **Status:** przyjęta

**Decyzja.** Dwa doprecyzowania mechanizmu opisanego w
[10 §6](./10-deployment.md#6-migracje-bazy) i [03 §6](./03-data-model.md#6-strategia-migracji),
podjęte przy pisaniu runnera (`F0-5`).

### 1. Migawkę przed migracją robi `db/migrate.ts`, nie `entrypoint.sh`

`10 §6` mówi, że kopię robi entrypoint. W praktyce nie może: [03 §6](./03-data-model.md#6-strategia-migracji)
wymaga `VACUUM INTO`, a to polecenie SQL wymagające **otwartego połączenia** z bazą.
Skrypt powłoki mógłby co najwyżej skopiować plik — a kopiowanie `.db` przy włączonym
WAL, bez towarzyszących `-wal` i `-shm`, potrafi dać kopię niekompletną. Dokładnie tego
rodzaju kopia zawiedzie wtedy, kiedy będzie potrzebna.

Kopię robi więc runner, tuż przed zastosowaniem migracji, do `<katalog bazy>/backups/`
pod nazwą `pre-migration-<znacznik>.db`. Entrypoint nadal ją wywołuje — pośrednio,
przez `node dist/db/migrate.js`.

### 2. Kopia jest pomijana, gdy nie ma czego stracić

Kopia powstaje **przed** migracją, więc przy pierwszej instalacji zapisywałaby pustą
bazę. Runner pomija ją, gdy baza nie ma jeszcze żadnej tabeli, oraz gdy nie ma żadnej
migracji do zastosowania — restart kontenera bez nowej wersji jest sytuacją normalną
i częstą, a katalog `/data/backups/` nie powinien puchnąć od kopii identycznych plików.

**Weryfikacja.** Zbudowany `dist/db/migrate.js` uruchomiony dokładnie tak, jak robi to
kontener:

| Sprawdzenie | Wynik |
|---|---|
| pierwszy przebieg | `applied: 1`, 17 tabel, 1 wpis w `__drizzle_migrations` |
| drugi przebieg | „Brak migracji do zastosowania" — idempotentny |
| pliki bazy | `fineapp.db`, `-wal`, `-shm` — WAL faktycznie działa na pliku |
| pusta baza | kopia pominięta, katalog `backups/` nie powstaje |
| baza z danymi | `VACUUM INTO` daje kopię, z której da się odczytać wiersze |
| zła konfiguracja | komunikat po polsku i **kod wyjścia 1** |

Ostatni wiersz jest istotny dla `entrypoint.sh`: skrypt działa z `set -e`, więc nieudana
migracja zatrzymuje start kontenera, zamiast wpuścić aplikację do bazy w nieznanym stanie.

**Koszt.** Kopia jest robiona tym samym połączeniem, które zaraz wykona migrację — jeśli
`VACUUM INTO` się nie powiedzie (brak miejsca na dysku), migracja nie ruszy. To jest
zachowanie zamierzone, ale oznacza, że pełny dysk blokuje aktualizację aplikacji do czasu
zwolnienia miejsca. Przy bazie liczonej w megabajtach i wolumenie liczonym w gigabajtach
ryzyko jest znikome; gdyby kiedyś przestało być, trzeba będzie dodać próg i pominięcie
kopii z ostrzeżeniem w logu.

---

<a id="adr-020"></a>

## ADR-020 — Seed: slugi z prefiksem rodzica, idempotencja przez odczyt identyfikatorów

**Data:** 2026-09-22 · **Status:** przyjęta

**Decyzja.** Dwie rzeczy wyszły dopiero przy pisaniu seeda (`F0-6`) i obie wpływają na
to, jak kategorie wyglądają w bazie.

### 1. Slug podkategorii niesie prefiks rodzica

Lista z [03 §5](./03-data-model.md#5-kategorie-domyślne-seed) zawiera **dwie kategorie
o nazwie „Transport"**: główną (paliwo, komunikacja, serwis) oraz podkategorię
*Podróży* (przejazd na wakacje). Obie mają `kind = 'expense'`, więc naiwny slug
`transport` łamie `uq_categories_slug (household_id, kind, slug)` i seed nie przechodzi.

Slug podkategorii powstaje więc jako `<slug-rodzica>-<slug-dziecka>`:
`transport` kontra `podroze-transport`. Konwencja rozwiązuje ten konflikt i każdy
następny tego rodzaju, a przy hierarchii jednopoziomowej (I-11) nie da się przez nią
uzyskać slugów nadmiernie długich.

Polskie znaki są transliterowane (`ż` → `z`, `ł` → `l`), bo slug bywa częścią adresu URL
i klucza pamięci podręcznej, gdzie potrafią się rozjechać między przeglądarką a serwerem.

### 2. Identyfikatory rodziców są odczytywane z bazy, nie generowane ponownie

Pierwsza wersja budowała komplet wierszy z nowymi ULID-ami i wstawiała je
`ON CONFLICT DO NOTHING`. Przy pierwszym przebiegu działa. Przy drugim — wywraca się
na kluczu obcym, ale **tylko wtedy, gdy brakuje samego dziecka**: rodzic zostaje
pominięty (jego slug już istnieje), a dziecko niesie świeżo wylosowany identyfikator
rodzica, którego w bazie nie ma.

To jest dokładnie scenariusz „dopisaliśmy nową kategorię domyślną w kolejnej wersji" —
czyli ten, dla którego seed ma być idempotentny. Wyłapał to test; zwykły powtórny
przebieg przechodził, bo wszystkie wiersze były pomijane, zanim klucz obcy zaczął
cokolwiek znaczyć.

Seed wstawia więc najpierw rodziców, potem **odczytuje ich identyfikatory** po
`(household_id, kind, slug)` i dopiero z nimi wstawia dzieci.

### Czego seed świadomie nie robi

Nie nadpisuje niczego. Kategoria, której użytkownik zmienił nazwę albo podpowiedzi,
zostaje nietknięta — seed bywa uruchamiany ręcznie po aktualizacji, a „naprawiona"
kategoria z przypisanymi transakcjami zabrałaby ze sobą kawałek historii.

Podpowiedzi `ai_hints` trafiają do kategorii, w której wierszu występują w `03 §5` —
nie rozdzielam ich samowolnie na liście. Dostrojenie ich do podkategorii to zadanie
Fazy 7, mierzone na prawdziwych paragonach (`Z-5`), a nie zgadywane przy seedzie.

**Weryfikacja.** `pnpm db:seed` na prawdziwej bazie, dwa razy pod rząd:

| Sprawdzenie | Wynik |
|---|---|
| pierwszy przebieg | 94 kategorie: 79 wydatków, 11 przychodów, 4 przelewy |
| struktura | 33 kategorie główne, 61 podkategorii, zero wnuków (I-11) |
| kolizja „Transport" | `transport` i `podroze-transport` współistnieją |
| drugi przebieg | `categoriesInserted: 0`, to samo gospodarstwo |
| zmiana użytkownika | nazwa i `ai_hints` przetrwały ponowny seed |
| usunięta podkategoria | ponowny seed wstawia **tylko ją** |
| `ai_hints` | polskie znaki nienaruszone (`Żabka`) |

**Koszt.** Prefiks w slugu oznacza, że zmiana nazwy kategorii nadrzędnej przez
użytkownika nie przepisze slugów jej dzieci — zostaną z dawnym prefiksem. Jest to
akceptowalne: slug jest identyfikatorem technicznym, a nie etykietą, i właśnie dlatego
nie powinien podążać za nazwą.

> **`Z-10` się nie potwierdziło.** Zapowiadałem, że seed będzie pierwszym realnym
> odbiorcą `core/dates.ts`. Nie jest: seed operuje wyłącznie na znacznikach systemowych
> (epoch ms), a żadnej daty biznesowej nie zapisuje. Pierwszym odbiorcą będzie dopiero
> Faza 2 — tworzenie kont (`opening_balance_on`) i transakcji (`booked_on`).

---

<a id="adr-021"></a>

## ADR-021 — Serwer HTTP: logger przez opcje, błędy w jednym miejscu

**Data:** 2026-09-22 · **Status:** przyjęta

**Decyzja.** Trzy ustalenia z budowy serwera (`F0-7`).

### 1. Fastify dostaje **opcje** loggera, nie gotową instancję

Fastify 5 przyjmuje gotowy logger wyłącznie pod kluczem `loggerInstance` — przekazanie
go pod `logger` kończy się błędem „logger options only accepts a configuration object".
Ale `loggerInstance` parametryzuje typ instancji konkretnym loggerem, przez co **każda
funkcja przyjmująca zwykłe `FastifyInstance` przestaje pasować** (`registerSecurity`,
`registerErrorHandler` i każdy przyszły moduł).

`core/logger.ts` wystawia więc `loggerOptions(config)`, a Fastify buduje pino sam.
`createLogger(config)` zostaje dla kontekstów poza HTTP — runnera migracji i seeda.

### 2. Błąd staje się JSON-em w jednym miejscu

`http/error-handler.ts` obsługuje pięć przypadków w ustalonej kolejności: błąd
aplikacyjny (kod i status już ma), walidacja wejścia przez Zod, niezgodność odpowiedzi
z własnym schematem, błąd wtyczki Fastify z własnym statusem, i wszystko pozostałe.

Trasa rzuca `NotFoundError('Nie znaleziono konta.')` i nie wie nic o kształcie
odpowiedzi ani o statusie. **Błąd nierozpoznany nigdy nie wynosi szczegółów na
zewnątrz**: komunikat jest ogólny, pełny stos idzie wyłącznie do logu. Bez tego pierwszy
nieobsłużony wyjątek zdradziłby ścieżkę na dysku albo fragment zapytania SQL — co
sprawdza osobny test.

Przypadek trzeci (`isResponseSerializationError`) zasługuje na uwagę: to jest błąd
serwera, nie klienta, i bez własnego rozgałęzienia wyglądałby jak zwykła awaria,
zamiast wskazać, że trasa zwróciła coś niezgodnego z własnym kontraktem.

### 3. `X-Request-Id` to ten sam ULID, co klucze główne

Identyfikator żądania jest generowany tym samym generatorem, co identyfikatory
rekordów. Jeden format w logach, w nagłówku odpowiedzi i w ciele błędu oznacza, że
użytkownik może podać identyfikator z komunikatu, a szukanie w logu jest natychmiastowe.

### Czego serwer świadomie nie robi

**Nie uruchamia migracji.** Robi to `docker/entrypoint.sh` przed startem procesu
(ADR-019). Gdyby migrował serwer, dwa restartujące się kontenery mogłyby zacząć
migrować równolegle.

`/health` jest wyłączony z limitu żądań: healthcheck Dockera odpytuje go co 30 sekund,
a wyczerpanie limitu ubiłoby kontener.

**Weryfikacja.** Zbudowany serwer uruchomiony z `NODE_ENV=production`:

| Sprawdzenie | Wynik |
|---|---|
| `GET /api/v1/health` | `{"status":"ok","version":"0.1.0","dbOk":true,"uptimeSeconds":16}` |
| wersja | odczytana z `package.json` — ta sama ścieżka działa w `src/` i w `dist/` |
| nagłówki | pełne CSP z `09 §6`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` |
| HSTS | obecny w produkcji, nieobecny w dev (inaczej zablokowałby localhost po HTTP) |
| `X-Request-Id` | ULID, inny dla każdego żądania |
| nieznana trasa | `404` z kopertą `{ error: { code, message, requestId } }` |
| obce pochodzenie | brak nagłówka `access-control-allow-origin` |

**Koszt.** `registerSecurity` rejestruje cztery wtyczki w jednym miejscu, więc zmiana
kolejności ich rejestracji wymaga świadomej decyzji — kolejność ma znaczenie, gdy
wtyczki dokładają hooki. Alternatywą byłby osobny plik na wtyczkę, ale przy czterech
wtyczkach dałoby to więcej plików niż treści.

---

<a id="adr-022"></a>

## ADR-022 — Szkielet frontu: strefa czasowa w `shared`, ikony z tokenów

**Data:** 2026-09-22 · **Status:** przyjęta

**Decyzja.** Trzy ustalenia z budowy szkieletu frontu (`F0-8`), domykającego Fazę 0.

### 1. Konwersja strefy trafia do `shared`, nie do `core/dates.ts` (rewizja ADR-017)

ADR-017 zarezerwował zamianę `Date` → data biznesowa dla `apps/api/src/core/dates.ts`,
a `Z-10` czekało na pierwszego odbiorcę. Odbiorca okazał się **frontem**: router musi
wiedzieć, który miesiąc pokazać przy wejściu na `/`.

Dwie implementacje tej samej konwersji rozjechałyby się dokładnie o północy — czyli
wtedy, gdy różnica jest najbardziej widoczna i najtrudniej ją odtworzyć. Ponieważ
`Intl.DateTimeFormat` z opcją `timeZone` działa tak samo w Node 22 i w przeglądarce,
funkcja jest **izomorficzna** i mieszka w `packages/shared/src/utils/date-tz.ts`.

Powód, dla którego ADR-017 trzymał ją z dala od `utils/month.ts`, zostaje w mocy:
`month.ts` operuje na napisach i strefy nie zna. `date-tz.ts` jest osobnym modułem
i to **jedyne** miejsce w projekcie, w którym `Date` spotyka datę biznesową.

Pułapka z `CONTRIBUTING.md` ma własny test: 00:30 czasu warszawskiego latem to 22:30 UTC dnia
poprzedniego, więc `new Date().toISOString().slice(0, 10)` cofnąłby datę o dobę —
a w nocy z 31 sierpnia przeniósłby wydatek do poprzedniego miesiąca.

`core/dates.ts` nie powstanie; `Z-10` zamknięte.

### 2. Ikony PWA są generowane z tokenów, nie rysowane ręcznie

`design/tools/generate-icons.mjs` produkuje komplet ikon z trzech tokenów
(`--primary`, `--background`, `--income`). Motywem jest **pierścień wykonania celu
procentowego** — sygnaturowy element dashboardu z ADR-013, a nie dowolny obrazek.
Ikona pokazuje 72% wypełnienia: postęp, nie stan osiągnięty.

Przy okazji wyszło, że manifest PWA i `index.html` niosły `#0f172a` — surowy slate
Tailwinda z pierwotnego szkieletu, sprzed wyboru kierunku „Papier". Pasek statusu
telefonu i ekran powitalny miałyby inny kolor niż aplikacja. Zastąpione wartością
`--background` motywu ciemnego (`#1a1714`).

**Manifest nie czyta CSS**, więc te dwa miejsca są jedynymi w projekcie z zapisem HEX.
Oba mają komentarz wskazujący token źródłowy.

### 3. Wąskie odstępstwo od reguły JSDoc dla tabeli kluczy cache

`lib/query-keys.ts` to tabela stałych zapisana jako jednoliniowe fabryki. Wymuszony
`@param month - Klucz miesiąca` przy `month: (month) => ['months', month]` byłby
dokładnie tym szumem, którego zakazuje [02 §8](./02-architecture.md#8-konwencje-kodu).
Sam obiekt `qk` — jedyny eksport modułu, a więc jedyny objęty regułą 8 z `CONTRIBUTING.md` —
jest udokumentowany wraz z konwencją unieważniania.

Odstępstwo jest zapisane w `eslint.config.js` wraz z uzasadnieniem i ograniczone do tego
jednego wzorca ścieżki.

**Weryfikacja.** `pnpm dev` podniesione i odpytane:

| Sprawdzenie | Wynik |
|---|---|
| API na `:3000` | `{"status":"ok","version":"0.1.0","dbOk":true}` |
| front na `:5173` | `200` |
| `/api` przez proxy Vite | ta sama odpowiedź co bezpośrednio z API |
| `pnpm build` | **przechodzi cały łańcuch** shared → api → web |
| paczka frontu | **121,25 kB** gzip przy budżecie 200 kB |
| ikony w buildzie | komplet pięciu plików, manifest je widzi |

**Koszt.** Zaślepki tras (`components/layout/placeholder.tsx`) są kodem do usunięcia —
każdy prawdziwy ekran zabiera jedno jej użycie. Dopóki istnieją, „przeklikanie"
aplikacji nie dowodzi niczego poza tym, że router działa. To świadoma cena za to, że
kształt nawigacji jest ustalony przed pierwszym ekranem i widoki można budować
niezależnie od siebie.

---

## ADR-023 — Prymitywy UI: `twMerge` douczony, znak kwoty w jednym miejscu, testy z DOM

**Data:** 2026-09-22 · **Zadanie:** `F1-0` · **Status:** przyjęte

**Kontekst.** `15 §4` opisuje czternaście prymitywów wraz z wariantami, stanami i tokenami.
Kodowanie ich ujawniło trzy rzeczy, których specyfikacja nie mogła przewidzieć, bo
wychodzą dopiero z narzędzi.

### 1. `twMerge` trzeba douczyć własnej skali stopni pisma

`tailwind-merge` zna **domyślną** skalę Tailwinda. Nasza skala z `15 §3.3` dokłada
`text-caption`, `text-meta`, `text-amount` i `text-hero`, których w niej nie ma —
a nierozpoznany `text-*` ląduje w grupie **koloru tekstu**. Skutek: `cn('text-hero',
'text-expense')` zwracało samo `text-expense`, czyli kwota w nagłówku renderowała się
w 16 px zamiast 40 px.

Błąd jest cichy — nic nie protestuje, typografia po prostu przestaje działać wszędzie
tam, gdzie rozmiar stoi obok koloru, czyli w `<Money>`, czyli na każdym ekranie.
Wykryło go dopiero zmierzenie `font-size` w przeglądarce, nie test i nie oko.

**Decyzja.** `lib/cn.ts` używa `extendTailwindMerge` z jawną listą własnych stopni pisma.
Lista jest krótka i zmienia się razem z `15 §3.3`; `cn.test.ts` pilnuje obu kierunków —
że stopień przeżywa obok koloru i że dwa stopnie nadal się wykluczają.

### 2. Znak kwoty powstaje raz, dla ekranu i dla czytnika naraz

Pierwsza wersja `<Money>` doklejała minus do **tekstu**, a `aria-label` liczyła osobno
z `amountMinor`. Wydatek `8990` pokazywał się jako `−89,90 zł`, a czytnik ekranu
odczytywał „osiemdziesiąt dziewięć złotych dziewięćdziesiąt groszy" — **bez minusa**.
Dla osoby patrzącej na ekran błąd jest niewidoczny.

**Decyzja.** Znak wylicza `displayMinorOf()` raz, a tekst i odczyt biorą tę samą wartość.
Wariant `expense` odwraca znak (transakcje trzymają kwotę dodatnią, kierunek niesie typ),
więc korekta wydatku `−8990` czyta się jako `+89,90 zł`. Zero jest odbijane jawnie, bo
`-0` to w JavaScripcie osobna wartość i `Intl` formatuje ją jako „−0,00 zł" — wbrew
regule „zero nigdy nie dostaje znaku".

### 3. `formatMinorCompact` to nie jest wariant `compact`

`15 §4.1` mówi, że wariant `compact` **pomija grosze** (`2 000 / 2 360 zł`).
`formatMinorCompact` z `07 §8.5` robi co innego — skraca rząd wielkości (`12,3 tys. zł`)
i jest przeznaczona **wyłącznie na wykresy**. Zbieżność nazw sprawiła, że pierścień celu
pokazywał `2,4 tys. zł` zamiast `2 360 zł`, czyli ukrywał różnicę, którą miał pokazać.

**Decyzja.** Nowa funkcja `formatMinorWhole` w `@fineapp/shared` obsługuje wariant
`compact`. **Zaokrągla, nie ucina** — ucinanie pokazałoby `999,99 zł` jako `999 zł`,
czyli mniej, niż jest naprawdę. `07 §8.5` rozróżnia teraz trzy formaty i ich zastosowania.

### Pozostałe ustalenia

| Rzecz | Ustalenie |
|---|---|
| Wysokość paska zakładek | token `--tabbar-height: 56px` (`15 §3.4`) — FAB i toast liczą od niej pozycję; zapisana dwa razy jako liczba rozjedzie się przy pierwszej zmianie |
| Cel dotykowy `<Switch>` | 44 × 24 px wizualnie, ale obszar kliknięcia powiększa pseudoelement `after:h-touch`; wypełnienie pomalowałoby się tłem stanu |
| Geometria `<ProgressRing>` | łuk rysowany poleceniem `A` z jawną flagą `sweep`, nie przesunięciem `stroke-dashoffset` — przy wartości ujemnej kierunek musi być widoczny w kodzie, a nie wynikać z transformacji |
| Zamknięcie `<Sheet>` | otwarcie dokłada wpis do historii, `popstate` zamyka arkusz; bez tego gest cofnięcia — pierwszy odruch na telefonie — wyrzuca z aplikacji razem z wypełnionym formularzem |
| Klawisz `⌫` | ikona z `lucide-react`, nigdy znak U+232B (nie istnieje w Spectral ani Source Sans) |
| Trasa `/dev/ui` | zostaje w wersji produkcyjnej, ładowana leniwie jako osobny fragment (38,7 kB gzip); `CONTRIBUTING.md` odsyła do niej, a odsyłacz do czegoś, czego nie ma na wdrożeniu, jest wart tyle co nic |

### Testy frontu wymagają DOM

`01 §3` przewidywał Vitest, ale nie mówił, czym renderować komponenty. Reguły z `15 §4`
w większości **nie dają się sprawdzić bez renderu**: znak kwoty, `aria-label`, wysokość
celu dotykowego, kształt znacznika celu, zamknięcie arkusza przyciskiem „wstecz".

**Decyzja.** `jsdom` + Testing Library (`@testing-library/react`, `user-event`,
`jest-dom`) jako zależności deweloperskie `apps/web`, osobny `vitest.config.ts`
(bez wtyczki PWA — generowanie service workera przy każdym uruchomieniu testów kosztuje
sekundy i nic nie sprawdza).

**Koszt.** Cztery zależności deweloperskie więcej i środowisko `jsdom` tworzone raz na
plik testowy (~0,5 s narzutu na plik). W zamian trzy z czterech błędów opisanych wyżej
wyszły z testu albo z pomiaru w przeglądarce, a nie z przeglądania kodu.

**Weryfikacja w przeglądarce.** `/dev/ui` na 390 × 844 px, Chromium, oba motywy:

| Sprawdzenie | Wynik |
|---|---|
| kolory semantyczne rozwiązują się z tokenów | `--income` `rgb(89,197,168)` ciemny / `rgb(38,126,102)` jasny |
| ścieżka pierścienia | `hsl(var(--muted-foreground) / .45)`, nigdy `--muted` |
| cele dotykowe < 44 px | **brak** (po poprawce `<Switch>`) |
| poziomy pasek przewijania na 390 px | brak |
| błędy konsoli | brak |
| klawisze klawiatury kwoty | 12 × 52 px |
| kwota w arkuszu | 40 px / 600, fokus od razu po otwarciu |
| arkusz na desktopie | 520 px, wyśrodkowany |
| przyciemnienie | `rgba(0,0,0,.55)` z `--scrim` |
| paczka | główna 121,1 kB gzip (budżet 200 kB), `/dev/ui` osobne 38,7 kB |

---

## ADR-024 — `user:create`: reguły PIN-u w `shared`, `details` typowane kontraktem

**Data:** 2026-09-22 · **Zadanie:** `F1-1` · **Status:** przyjęte

**Kontekst.** Aplikacja nie ma rejestracji — konta zakłada jeden skrypt CLI
([09 §10](./09-security-auth.md#10-zakładanie-użytkowników)). Kodowanie go wymusiło
cztery rozstrzygnięcia.

### 1. Reguły PIN-u mieszkają w `shared`, nie w API

PIN sprawdza dziś skrypt, jutro ekran zmiany PIN-u. Dwie kopie reguł rozjechałyby się
przy pierwszej zmianie listy popularnych wzorców, a objawem byłoby „PIN poprawny"
tuż przed odrzuceniem go przez API.

`domain/pin.ts` zwraca **powód wraz z komunikatem po polsku**, a nie samo `true/false`:
skrypt i formularz potrzebują tego samego zdania, a zdanie złożone po stronie odbiorcy
z kodu błędu to trzecie miejsce, w którym reguła może się rozjechać.

Sprawdzenie „ciąg kolejnych cyfr" jest **podciągiem `0123456789`**, a nie pętlą po parach.
Wersja pętlowa wymagała trzech sprawdzeń na `undefined`, z których żadne nie mogło się
wydarzyć — czyli trzech gałęzi nie do pokrycia testem przy progu 100%.

### 2. Skrypt musi zdjąć separator `--`, który przekazuje mu pnpm

Udokumentowane wywołanie z `09 §10` to
`pnpm --filter @fineapp/api user:create -- --email … --name …`. pnpm przekazuje `--`
**dalej, do skryptu**, więc pierwsza wersja parsera kończyła udokumentowane polecenie
błędem „Nieznany argument: --". Wyszło to z uruchomienia, nie z testu — test wołał
`parseArgs` bez separatora, bo tak wygląda to w kodzie.

### 3. Limit dwóch kont jest w serwisie, nie tylko w dokumencie

`MAX_ACTIVE_USERS = 2` to decyzja produktowa, nie ograniczenie techniczne. Wymuszona
w serwisie, a nie w skrypcie — inaczej obeszłoby ją pierwsze wywołanie z innego miejsca.

### 4. `AppError.details` dostaje typ z kontraktu koperty

`details` było `unknown`, więc `error-handler.ts` sprawdzał kształt w locie
(`Array.isArray(...) ? (... as ApiErrorDetail[]) : undefined`) — kontrakt pilnował się
sam dopiero w czasie wykonania, a każdy odczyt `details` w teście był `any`.

Przy okazji wyszła **sprzeczność w planie**: `04 §4` opisywał `429 RATE_LIMITED` jako
`details.retryAfterSeconds`, podczas gdy `05 §3` definiuje `details` jako **jednorodną
listę** `{ path, message }`, z której front buduje mapę błędów pól
(`ApiRequestError.fieldErrors()`). Liczba sekund wciśnięta do tej listy zepsułaby
wszystkie formularze naraz.

**Decyzja.** `details` ma typ `readonly ApiErrorDetail[]`, a czas oczekiwania stoi
**obok** niego jako `error.retryAfterSeconds` — przepisany z nagłówka `Retry-After`,
który i tak ustawia `@fastify/rate-limit`. `04 §4` i `05 §3` poprawione.

### Pomiar argon2id

| Operacja | Czas (średnia z 10, kontener deweloperski) |
|---|---|
| `hashPin` | **156 ms** |
| `verifyPin` | **160 ms** |

Powyżej docelowych 50–100 ms z `09 §2.2`, ale kontener deweloperski nie jest maszyną
docelową — pomiar na VPS zostaje wymagany przed wdrożeniem (`Z-2`). Gdyby na VPS wyszło
podobnie, obniżamy `timeCost`, **nie** `memoryCost`: to pamięć blokuje zrównoleglenie
na kartach graficznych.

**Weryfikacja uruchomieniem.** Skrypt na prawdziwym pliku bazy:

| Przebieg | Wynik |
|---|---|
| pierwszy użytkownik | gospodarstwo + **94 kategorie** + konto, PIN wylosowany i wypisany raz |
| drugi użytkownik, PIN podany | konto założone, gospodarstwo **nie** zduplikowane |
| trzeci użytkownik | `409` — limit dwóch kont |
| ten sam adres inną wielkością liter | `409` — adres zajęty |
| PIN `111111` | `400` z komunikatem po polsku |
| hash w bazie | `$argon2id$v=19$m=65536,p=1,t=3$…`, bez PIN-u w treści |
| kolory awatarów | dwa różne, spoza palety semantycznej |

---

## ADR-025 — Logowanie: jak dokładnie liczy się limit prób

**Data:** 2026-09-22 · **Zadanie:** `F1-2` · **Status:** przyjęte

**Kontekst.** `09 §2.5` podaje tabelę progów i jedno zdanie, które przy kodowaniu
okazało się dwuznaczne: *„udane logowanie **nie kasuje** historii prób — kasuje jedynie
bieżącą blokadę. Dzięki temu atakujący, który trafi jeden PIN, nie zeruje sobie licznika
dla drugiego konta"*. Te dwie połowy przeczą sobie, dopóki nie rozdzieli się zakresów.

**Decyzja.** Zakresy liczą się **inaczej**:

| Zakres | Co liczymy | Dlaczego |
|---|---|---|
| e-mail | nieudane próby **po ostatniej udanej** | właściciel konta, który pomylił PIN cztery razy i za piątym trafił, nie chodzi z licznikiem na czwórce — to jest „kasuje bieżącą blokadę" |
| IP | **wszystkie** nieudane próby w oknie | atakujący, który zgadł PIN do jednego konta, nie wyzeruje sobie licznika, z którym dobija się do drugiego — to jest zdanie o „drugim koncie" |

**Blokada biegnie od ostatniej nieudanej próby**, nie od pierwszej ani od końca okna:
kto próbuje dalej, ten sam sobie przedłuża blokadę. Z kilku zadziałałych reguł wygrywa
ta, która każe czekać najdłużej.

**Zablokowanej próby nie zapisujemy.** Gdyby się zapisywała, liczyłaby się do własnego
limitu i blokada przedłużałaby się w nieskończoność przy samym odświeżaniu strony —
użytkownik, który zobaczył „spróbuj za 15 minut" i odruchowo odświeżył, zaczynałby
odliczanie od nowa. Test `blokada nie przedłuża się przy samym odświeżaniu strony`
pilnuje właśnie tego.

### Hash-atrapa musi być policzona przy starcie

`09 §2.4` każe porównywać z atrapą, gdy użytkownika nie ma — inaczej czas odpowiedzi
zdradza, które konta istnieją. Pierwsza wersja liczyła atrapę **leniwie**, przy pierwszym
użyciu. Pomiar na działającym serwerze pokazał, że pierwsze żądanie dla nieistniejącego
adresu trwa wtedy **331 ms** zamiast ~170 ms: sam mechanizm chroniący przed pomiarem
czasu dawał jeden pomiar do odczytania.

`warmUpDummyPinHash()` w bootstrapie liczy ją przed `listen()`. Po poprawce, dwanaście
przeplatanych par żądań na działającym serwerze:

| Adres | Mediana | Zakres |
|---|---|---|
| istniejący, zły PIN | **172 ms** | 153–189 ms |
| nieistniejący | **176 ms** | 141–184 ms |

Rozkłady się pokrywają — z czasu odpowiedzi nie da się odczytać, czy konto istnieje.

### `retryAfterSeconds` jako pole błędu, nie element `details`

Ciąg dalszy [ADR-024](#adr-024): `RateLimitError` dostał własne pole
`retryAfterSeconds`, które obsługa błędów przepisuje **i do ciała, i do nagłówka
`Retry-After`**. Nagłówek jest standardem HTTP i czytają go pośredniki, ciało — bo front
czyta odpowiedź, nie nagłówki.

Komunikat mówi **ile** czekać po polsku („Spróbuj ponownie za 15 minut"), a nie
„spróbuj później": `09 §2.5` wprost chce, żeby UI mógł pokazać odliczanie.

### Sprzątanie historii prób

Tabela `auth_attempts` rośnie o wiersz na **każdą** próbę — także nieudaną i także dla
adresów, które nie istnieją, więc przy ataku szybciej niż cała reszta bazy razem wzięta.
`pruneLoginAttempts` przy starcie usuwa wiersze starsze niż 30 dni
([03 §3.4](./03-data-model.md#34-auth_attempts)); najdłuższe okno reguł to doba, więc
starsze i tak na nic nie wpływają.

**Weryfikacja na działającym serwerze** (nie tylko `inject`):

| Sprawdzenie | Wynik |
|---|---|
| poprawne logowanie | `200`, access token 15 min, profil i gospodarstwo |
| ciasteczko | `fineapp_rt`, `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/auth`, `Max-Age=2592000` |
| token odświeżający w ciele | **nieobecny** — wychodzi wyłącznie w ciasteczku |
| pięć złych PIN-ów | `401` × 5, szósta próba `429` |
| odpowiedź `429` | `retryAfterSeconds: 900`, nagłówek `Retry-After: 900`, komunikat „za 15 minut" |
| nieistniejący adres vs zły PIN | identyczny kod, identyczny komunikat, nieodróżnialny czas |
| PIN albo e-mail w logu | **zero wystąpień** |

---

## ADR-026 — Rotacja tokenów: wiersz to token, `family_id` to urządzenie

**Data:** 2026-09-22 · **Zadanie:** `F1-3` · **Status:** przyjęte

**Kontekst.** `09 §3.3` opisuje rotację z wykrywaniem ponownego użycia, ale nie mówi,
jak zapisać ją w `auth_sessions`. Schemat z `03 §3.3` trzymał jeden wiersz na urządzenie
z nadpisywanym `refresh_token_hash` — i przy tym układzie **wykrycie ponownego użycia
nie działa**: token sprzed rotacji przestaje istnieć w bazie, więc złodziej odtwarzający
go jest nie do odróżnienia od kogoś, kto wkleił śmieci.

Rozważone były trzy warianty:

| Wariant | Co daje | Dlaczego odpadł |
|---|---|---|
| nadpisywanie hasha w miejscu | zero zmian w schemacie | **nie wykrywa niczego** — to jest właśnie ta dziura |
| dodatkowa kolumna `previous_token_hash` | wykrywa odtworzenie sprzed **jednej** rotacji | złodziej, który zdążył obrócić token kilka razy, zanim ofiara wróciła, zostaje niewykryty — a to najbardziej prawdopodobny przebieg |
| **wiersz na token + `family_id`** | wykrywa odtworzenie **dowolnej głębokości** | wymaga migracji i sprzątania wierszy |

**Decyzja: trzeci wariant.** Migracja `0001` dokłada `family_id`, rotacja dokłada wiersz
i unieważnia poprzedni. Scenariusz sprawdzony na działającym serwerze **odtwarza token
sprzed dwóch rotacji** i zostaje wykryty — czyli dokładnie ten przypadek, którego wariant
z jedną kolumną by nie złapał.

### Trzy stany wiersza, a wylogowanie **usuwa**

| Stan | `revoked_at` | Znaczenie |
|---|---|---|
| aktywny | `NULL` | bieżący token rodziny |
| zużyty | ustawione | wymieniony przez rotację — **ponowne użycie to sygnał kradzieży** |
| — | wiersza nie ma | wylogowanie skasowało rodzinę → stary token daje zwykłe `401` |

Gdyby wylogowanie **unieważniało** zamiast usuwać, karta zostawiona otwarta w tle
odesłałaby po wylogowaniu swój stary token, zostałaby wzięta za kradzież i wylogowała
użytkownika z **pozostałych** urządzeń. Test `stary token po wylogowaniu daje zwykłe 401,
a nie alarm o kradzieży` pilnuje właśnie tego.

### `sid` to rodzina, nie wiersz

Gdyby `sid` wskazywał wiersz, zmieniałby się przy każdym odświeżeniu i nie nadawałby się
na nic trwałego. Jako identyfikator rodziny jest stabilny przez całe życie urządzenia.

### Rodzina nie dostaje nowych trzydziestu dni

Nowy wiersz dziedziczy `expires_at` poprzednika. Przy odnawianiu terminu skradziona
sesja odświeżana w kółko żyłaby wiecznie, a „ważność 30 dni" z `09 §3.1` nie znaczyłoby nic.

### Limit odświeżeń musi być liczony po rodzinie

`04 §12` mówi „60 / godz. na sesję". Pierwsza wersja kluczowała licznik **hashem tokenu** —
i limit nie działał wcale, bo rotacja zmienia token przy każdym żądaniu, więc każde miało
własny licznik. Wyszło z testu, który wykonał 61 odświeżeń i doczekał się `200`.
Klucz to teraz `family_id`, czytany tym samym zapytaniem, którego użyje obsługa trasy.

### Migracja `0001` napisana ręcznie

`drizzle-kit` wygenerował `ALTER TABLE auth_sessions ADD family_id text NOT NULL`, co
w SQLite jest błędem **zawsze** — nawet na pustej tabeli — bo kolumna `NOT NULL` bez
wartości domyślnej nie ma czym wypełnić istniejących wierszy. Zamiast dokładać sztuczny
`DEFAULT ''`, który zostałby w schemacie na zawsze, tabela jest odtwarzana standardową
procedurą SQLite, a wiersze sprzed migracji dostają `family_id = id`.

### Przy okazji: puste ciało i CSRF

- **`Content-Type: application/json` z pustym ciałem** Fastify odrzuca komunikatem
  „Body cannot be empty". Trasy `/auth/refresh` i `/auth/logout` ciała nie mają, a wiele
  klientów HTTP ustawia ten nagłówek odruchowo — użytkownik zobaczyłby „Żądanie zawiera
  nieprawidłowe dane" zamiast odnowionej sesji. Własny parser traktuje puste ciało jak
  `{}`; **uwaga na regresję**, którą to wprowadziło: goły `SyntaxError` z `JSON.parse`
  nie niesie statusu, więc literówka w JSON-ie zaczęła zwracać `500` zamiast `400`.
  Parser rzuca teraz `ValidationError`.
- **Ochrona CSRF z `09 §5`** (nagłówek `X-Requested-With: fineapp`) nie była dotąd
  wymuszana po stronie serwera — front ją wysyłał, API jej nie sprawdzało. Hook stoi
  na `onRequest`, czyli przed parsowaniem ciała.

**Weryfikacja na działającym serwerze:**

| Krok | Wynik |
|---|---|
| logowanie, dwa odświeżenia | `200`, za każdym razem nowy token |
| `sid` po obu odświeżeniach | **ten sam** |
| odtworzenie tokenu sprzed **dwóch** rotacji | `401` + `WARN` z `familyId`, `userId`, `revoked: 2` |
| urządzenie A po wykryciu | `401` |
| drugie urządzenie B po wykryciu | `401` |
| wylogowanie A | rodzina skasowana (3 wiersze → 1), B działa dalej |
| wylogowanie bez ciasteczka | `200` — idempotentne |
| odświeżenie bez nagłówka CSRF | `403` |
| tokeny albo PIN-y w logu | **zero wystąpień** |

---

## ADR-027 — `requireAuth` per trasa, `sid` jako identyfikator urządzenia na liście sesji

**Data:** 2026-09-22 · **Zadanie:** `F1-4` · **Status:** przyjęte

**Kontekst.** `09 §4` stawia jedną regułę: każde żądanie poza `/auth/login`,
`/auth/refresh` i `/health` wymaga ważnego access tokenu. Pytanie brzmiało, **jak ją
wymusić**, żeby trudno było ją obejść przez przeoczenie.

### `requireAuth` podpinane per trasa, nie hookiem całego modułu

Hook na poziomie pluginu byłby krótszy, ale wymusiłby **wyjątki**: `/login`, `/refresh`
i `/logout` tokenu nie mają. Wyjątek od reguły bezpieczeństwa jest niebezpieczniejszy
niż jej jawne włączenie — przy dopisywaniu trasy łatwiej zauważyć brak `preHandler`
niż fakt, że nowa ścieżka wpadła na listę wyłączeń. Moduły dziedzinowe (Faza 2 i dalsze)
nie mają tras publicznych, więc tam hook całego pluginu będzie właściwy; `auth` jest
jedynym modułem mieszanym.

`authContext(request)` zawęża `request.auth` z `undefined` w jednym miejscu. Rzucenie
z niej znaczy, że trasa zapomniała o `requireAuth` — **błąd programisty**, ale kończy się
odmową dostępu, a nie zapytaniem bez ograniczenia do gospodarstwa.

### `householdId` wyłącznie z tokenu

`GET /auth/me` **nie przyjmuje** `householdId` w żadnej postaci — bierze go z wiersza
użytkownika odnalezionego po `sub` z tokenu. Gdyby przychodził z zewnątrz, trasa
pozwalałaby zajrzeć do cudzego gospodarstwa przez podmianę parametru. To jest reguła 4
z `CONTRIBUTING.md` zastosowana do pierwszej trasy, która mogłaby ją złamać.

### Na liście urządzeń `id` to rodzina, a `createdAt` to moment zalogowania

Dwa wnioski z rotacji ([ADR-026](#adr-026)), które łatwo przeoczyć:

1. **`id` musi być `family_id`.** Identyfikator wiersza zmienia się przy każdym
   odświeżeniu, więc nie nadaje się ani do pokazania, ani do przekazania
   do `DELETE /auth/sessions/:id` — link „wyloguj to urządzenie" przestawałby działać
   po pierwszym odświeżeniu.
2. **`created_at` żywego wiersza to moment ostatniej rotacji**, nie zalogowania. Lista
   budowana wprost z wiersza pokazywałaby, że każde urządzenie zalogowało się przed
   chwilą — czyli informację bezużyteczną akurat wtedy, gdy się jej szuka. Podzapytanie
   dokłada najstarszy `created_at` z rodziny.

### `sameDevice` zamiast „przybliżonej lokalizacji"

`09 §3.5` mówi o „przybliżonej lokalizacji z hasha IP". Z hasha nie da się odczytać
miejsca — to cała jego istota. Można go tylko **porównać** z hashem bieżącego żądania,
i dokładnie to robi pole `sameDevice`. Dla użytkownika liczy się i tak jedno pytanie:
*czy to ja teraz, czy ktoś inny*.

### Zmiana PIN-u wymaga obecnego PIN-u

Sam ważny access token nie wystarcza: token mógł zostać wykradziony, a zmiana PIN-u
odcina prawowitego właściciela. Po zmianie wylogowywane są wszystkie urządzenia poza
bieżącym — jeśli PIN był zmieniany dlatego, że ktoś obcy się zalogował, to właśnie
ten ruch go wyprasza. Usuwane, nie unieważniane, z tego samego powodu co przy
wylogowaniu ([ADR-026](#adr-026)).

**Zakres.** `F1-4` w roadmapie wymienia `requireAuth`, kontekst gospodarstwa i `/auth/me`,
ale `04 §4` opisuje **osiem** tras `/auth`. Pozostałe (`/sessions`, `/sessions/:id`,
`/logout-all`, `/pin`) powstały razem z nimi: wszystkie stoją na `requireAuth`, żadna nie
ma własnej logiki poza tą już napisaną, a zostawienie ich na później znaczyłoby,
że `04 §4` opisuje trasy, których nie ma.

**Weryfikacja na działającym serwerze:**

| Sprawdzenie | Wynik |
|---|---|
| `GET /auth/me` | `200`, profil i gospodarstwo; **bez `pinHash`** |
| `GET /auth/me` bez tokenu | `401 UNAUTHORIZED` |
| `GET /auth/sessions` | dwa urządzenia, `current` na jednym |
| `DELETE /auth/sessions/:id` | `200`, urządzenie natychmiast traci możliwość odświeżenia |
| `DELETE` cudzej/nieistniejącej | **`404 NOT_FOUND`**, nie `403` |
| `PATCH /auth/pin` ze słabym PIN-em | `400` — „PIN nie może być ciągiem kolejnych cyfr." |
| `PATCH /auth/pin` ze złym obecnym | `401` — „Obecny PIN się nie zgadza." |
| `PATCH /auth/pin` poprawnie | `200`; stary PIN `401`, nowy `200` |
| `PATCH /auth/pin` bez nagłówka CSRF | `403` |

---

## ADR-028 — Ekran logowania: token tylko w pamięci, jedna klawiatura na dwa zastosowania

**Data:** 2026-09-22 · **Zadanie:** `F1-5` · **Status:** przyjęte

**Kontekst.** `06 §3.13` opisuje ekran, a `09 §3.1` stawia wymaganie, które decyduje
o jego budowie: **access token nie trafia do `localStorage`**.

### Sesja w pamięci Reacta, nie w pamięci przeglądarki

`AuthProvider` trzyma token w `useState`. Nie ma go ani w `localStorage`, ani
w `sessionStorage` — to zdejmuje najczęstszy wektor kradzieży przy XSS. Ceną jest to,
że po odświeżeniu strony token trzeba **odtworzyć**: robi to ciche `POST /auth/refresh`
na starcie, z ciasteczkiem `httpOnly`, którego skrypt nie widzi. `401` z tego żądania
jest **normalną odpowiedzią**, a nie awarią — znaczy tylko, że nikt nie jest zalogowany.

Token jest odnawiany **60 sekund przed wygaśnięciem**, a nie dopiero po pierwszym `401`:
inaczej co piętnaście minut jedno żądanie użytkownika kończyłoby się niepowodzeniem
i trzeba by budować ponawianie w kliencie API. Nieudane odnowienie wylogowuje — może
znaczyć, że serwer unieważnił wszystko po wykryciu ponownego użycia tokenu
([ADR-026](#adr-026)).

Wylogowanie czyści sesję w przeglądarce **nawet gdy serwer odmówił**. Inaczej awaria
sieci zostawiałaby użytkownika zalogowanym wbrew jego decyzji.

### Jedna klawiatura na dwa zastosowania

`15 §4.2` (`<AmountInput>`) i `06 §3.13` (PIN) opisują **tę samą** siatkę 3 × 4,
klawisz 52 px i odstęp 6 px. Różnią się jednym klawiszem w lewym dolnym rogu: kwota
ma tam przecinek, PIN — pustkę. Zamiast drugiej kopii powstał `<Keypad>`, a `AmountInput`
został na niego przepisany.

Puste miejsce jest `<span aria-hidden>`, nie wyłączonym przyciskiem: pusty przycisk
łapałby fokus, a czytnik ekranu zapowiadałby go jako „przycisk", nie mówiąc, co robi.

### Walidacja adresu bez natywnego dymka

Formularz ma `noValidate`, a adres sprawdza `EmailSchema` — **ten sam schemat, którego
użyje serwer**. Natywny dymek przeglądarki mówiłby co innego, w języku systemu i poza
naszymi tokenami, a rozjazd między tym, co odrzuca przeglądarka, a tym, co odrzuca API,
jest źródłem błędów nie do odtworzenia.

### Nieudana próba czyści wpisane cyfry

Zostawienie ich na ekranie zachęca do „poprawienia" jednej cyfry, a każda próba kosztuje
jedną z pięciu przed blokadą ([09 §2.5](./09-security-auth.md#25-limitowanie-prób)).

### Znalezione przy okazji: pole wyboru malowało się błękitem przeglądarki

`<Checkbox>` z `F1-0` miał klasę `text-primary`, ale **natywne pole wyboru ignoruje
`color`** i używa `accent-color`. Zaznaczenie malowało się więc domyślnym, jaskrawym
błękitem przeglądarki — czyli surowym kolorem spoza tokenów, czego zabrania `15 §3`.
Widać to było dopiero na zrzucie ekranu obok kropek PIN-u w `--primary`. Po poprawce
`accent-primary` przeglądarka raportuje `rgb(101, 177, 236)`, czyli dokładnie
`hsl(206 78% 66%)` z tokenu.

**Przeklikane w przeglądarce** (Chromium, 390 × 844 px, prawdziwe API):

| Krok | Wynik |
|---|---|
| zły PIN | „Nieprawidłowy e-mail lub PIN." — komunikat z serwera, bez zmian |
| kropki po błędzie | wyczyszczone do `0 z 6` |
| poprawny PIN | przekierowanie na `/m/2026-09` |
| `localStorage` | `{}` — **ani tokenu, ani PIN-u** |
| `document.cookie` | pusty — ciasteczko jest `httpOnly` |
| ciasteczko w przeglądarce | `fineapp_rt`, `httpOnly`, `path=/api/v1/auth`, `SameSite=Lax` |
| odświeżenie strony (`F5`) | zostaje na `/m/2026-09` — sesja odtworzona po cichu |
| wysokość klawisza | 52 px |
| poziomy pasek przewijania na 390 px | brak |
| błędy strony | brak |

---

## ADR-029 — Powłoka aplikacji i okno tolerancji przy odświeżaniu sesji

**Data:** 2026-09-22 · **Zadanie:** `F1-6` · **Status:** przyjęte

**Kontekst.** Powłoka z `06 §2` jest prosta: pasek zakładek do 768 px, pasek boczny
powyżej, trasy chronione. Kodowanie jej odsłoniło jednak **błąd w rotacji tokenów**,
którego nie dało się zobaczyć bez działającej bramy sesji.

### Dwie karty otwarte naraz wylogowywały ze wszystkich urządzeń

Access token żyje w pamięci ([ADR-028](#adr-028)), więc **każde wejście na stronę
odtwarza sesję jednym `POST /auth/refresh`**. Dwie karty otwarte równocześnie wysyłają
dwa żądania z **tym samym** ciasteczkiem: pierwsze rotuje token, drugie przychodzi
z tokenem już zużytym — czyli dokładnie z sygnałem kradzieży
([ADR-026](#adr-026)). Skutek: zwykłe „otwórz w nowej karcie" unieważniało sesje
na wszystkich urządzeniach.

Wyszło to z przeglądarki, nie z testu: testy wołały `/auth/refresh` po kolei, a nie
równolegle, bo tak wygląda ta ścieżka w kodzie.

**Decyzja: okno tolerancji 10 sekund.** Ponowne użycie tokenu unieważnionego mniej niż
10 sekund temu, **gdy rodzina ma nadal żywy wiersz**, jest wyścigiem, nie kradzieżą.
Spóźniona karta dostaje **sam access token** — bez rotacji i **bez nowego ciasteczka**,
bo zwycięzca wyścigu zdążył już podmienić to wspólne dla całej przeglądarki. Gdyby
spóźniona karta też rotowała, rodzina miałaby dwa żywe wiersze i jedno urządzenie
pojawiłoby się dwa razy na liście sesji.

Cena jest policzalna i zapisana w `09 §3.3`: napastnik, który odtworzy token w ciągu
dziesięciu sekund od prawowitego użycia, nie zostanie wykryty. Po dziesięciu — zostanie.
Skradzione ciasteczko jest wykorzystywane w godzinach, nie w sekundach.

### Dopasowanie aktywnej pozycji należy do `NavLink`, nie do nas

Pierwsza wersja liczyła aktywność sama (`pathname === to` albo prefiks) i przekazywała
`aria-current` jawnie. `NavLink` **równolegle liczył swoje** i ustawiał `aria-current`
po swojemu — a `aria-current={undefined}` nie kasuje atrybutu, który ustawił ktoś inny.
Na `/m/:month/transactions` bieżące były więc **dwie** pozycje naraz: „Miesiąc"
(prefiksowo, wg routera) i „Historia" (dokładnie, wg nas). Czytnik ekranu zapowiadał
dwie „bieżące" strony.

**Decyzja.** Dopasowanie liczy wyłącznie `NavLink`, sterowany propsem `end`; pozycja
nawigacji ma pole `nested`, które mówi tylko tyle, czy ma być aktywna także na ścieżkach
potomnych. Mniej kodu i jedno źródło prawdy.

### Brama sesji nie przekierowuje w trakcie sprawdzania

Trzy stany sesji, trzy zachowania. `checking` **nie przekierowuje** — odtworzenie sesji
trwa jedno żądanie, a wyrzucenie w tym czasie na `/login` mignęłoby ekranem logowania
przy każdym `F5`, także osobie zalogowanej. `anonymous` przekierowuje **z zapamiętaniem
miejsca**, żeby po zalogowaniu wrócić tam, gdzie się szło.

### Pozostałe ustalenia

| Rzecz | Ustalenie |
|---|---|
| Jedna lista pozycji | pasek zakładek i pasek boczny czytają z `nav-items.ts`; dwie listy rozjechałyby się przy pierwszej zmianie |
| Pasek boczny to `<nav>`, nie `<aside>` | `<aside>` ma rolę `complementary` — pasek nie trafiłby na listę punktów orientacyjnych nawigacyjnych |
| FAB znika na desktopie | `06 §2`: zamienia się w przycisk „Dodaj" w nagłówku; pływający przycisk zasłaniałby treść, bo kciuk nie musi tam dosięgać |
| Odstęp FAB od paska | `--tabbar-height` **nie obejmuje** włosowej linii `border-t` paska — bez doliczenia 1 px odstęp wychodził 15 px zamiast wymaganych 16 |
| Miesiąc w odnośnikach nawigacji | „Historia" prowadzi do historii **oglądanego** miesiąca; poza trasami miesięcznymi — bieżącego |
| `/login` i `/dev/ui` poza powłoką | pierwsze, bo nawigacja nie ma sensu, zanim jest gdzie nawigować; drugie, bo przegląd prymitywów ma pokazywać je same |

**Zmierzone w przeglądarce** (Chromium, prawdziwe API):

| Sprawdzenie | 390 px | 1280 px |
|---|---|---|
| pasek zakładek | widoczny, 5 pozycji × 56 px | ukryty |
| pasek boczny | ukryty | widoczny, **240 px**, z podsekcjami „Więcej" |
| FAB | 56 × 56 px, **16 px** nad paskiem | ukryty; w nagłówku przycisk „Dodaj" |
| `/goals` bez sesji | → `/login`, ze stanem `from` | — |
| po zalogowaniu | → `/goals`, czyli tam, skąd odesłało | — |
| korzeń | → `/m/2026-09` | — |
| `aria-current="page"` | **dokładnie jedna** pozycja na każdej trasie | jw. |
| poziomy pasek przewijania | brak | — |
| błędy strony | brak | brak |

---

## ADR-030 — Domknięcie Fazy 1: co testy pomijały i co było napisane na zapas

**Data:** 2026-09-22 · **Zadanie:** `F1-7` · **Status:** przyjęte

**Kontekst.** `F1-7` brzmi „testy: blokada po 5 próbach, rotacja, wykrycie kradzieży
tokenu" — a te trzy rzeczy miały już testy z `F1-2` i `F1-3`. Zadanie sprowadziło się
więc do pytania **czego testy nie dotykają** i czy to, czego nie dotykają, powinno
w ogóle istnieć.

### Dwa eksporty napisane na zapas — usunięte

Pomiar pokrycia modułu `auth` wskazał dwie funkcje, których **nic nie woła**:

| Funkcja | Po co powstała | Dlaczego znika |
|---|---|---|
| `hashesEqual` (`auth.hash.ts`) | porównanie hashy w stałym czasie, „przyda się" | hashe porównuje baza przez indeks, a nie kod; nigdy nie została użyta |
| `registerRequireAuth` (`require-auth.ts`) | objęcie wszystkich tras pluginu hookiem | [ADR-027](#adr-027) rozstrzygnął, że `auth` podpina `requireAuth` **per trasa** |

Obie usunięte. To ten sam wniosek co przy martwym kodzie w `date-tz.ts`
([ADR-022](#adr-022)): kod bez wołającego nie jest „gotowy na przyszłość", tylko
nieprzetestowany.

### Czego testy nie dotykały, a powinny

| Przypadek | Dlaczego umykał |
|---|---|
| limit na **adres IP** przez HTTP | reguła miała test jednostkowy, ale nikt nie sprawdził, czy hash IP w ogóle dociera do bramki |
| blokada **wykładnicza** przez HTTP | to samo — arytmetyka progów była sprawdzona, ścieżka nie |
| reguła, której blokada już minęła | gałąź `retryAfterSeconds <= 0`: okno wciąż widzi komplet prób, ale blokada wygasła |
| żądanie **bez `User-Agent`** | `inject` nie dokłada tego nagłówka, prawdziwi klienci też bywają skąpi |
| konto wyłączone w **oknie tolerancji** | ścieżka wyścigu dwóch kart z `ADR-029` omijała sprawdzenie `isActive` |
| trasa, która **zapomniała `requireAuth`** | siatka bezpieczeństwa, która nigdy nie była uruchomiona |

Po dopisaniu tych testów moduł `auth` ma **99% instrukcji i 100% funkcji**. Dwie
pozostałe luki to strażnicy stanu, którego schemat zabrania (użytkownik bez gospodarstwa,
chroniony kluczem obcym) — nie da się ich osiągnąć, a usunąć nie wolno, bo TypeScript
i tak wymaga obsługi `undefined`.

### Powolny test zostaje powolny

Dwa testy limitu IP wykonują po **dwadzieścia prawdziwych haszowań argon2** po 64 MiB
i trwają kilka sekund. Pod obciążeniem (trzy paczki testów naraz) przekraczały domyślny
limit pięciu sekund. Kusiło, żeby obniżyć parametry argon2 „na czas testów" — ale to
jest dokładnie ten koszt, który płaci atakujący
([09 §2.1](./09-security-auth.md#21-dlaczego-pin-jest-ryzykowny-i-co-z-tym-robimy)),
i test, który go omija, przestaje cokolwiek dowodzić. Podniesiony został **limit czasu**,
nie obniżony koszt.

**Kryteria zamknięcia Fazy 1** — sprawdzone w Chromium udającym iPhone'a 390 × 844 px,
na prawdziwym API i prawdziwej bazie:

| Kryterium z roadmapy | Wynik |
|---|---|
| logowanie działa na telefonie | wejście bez sesji → `/login`; po PIN-ie → `/m/2026-09` z widoczną nawigacją |
| odświeżenie strony nie wylogowuje | po `F5` i po wejściu wprost na `/goals` sesja trwa |
| po 5 błędnych próbach blokada | piąta nieudana → `429`; szósta z **poprawnym** PIN-em też `429` |
| błędy strony | brak |

---

## ADR-031 — Moduł kont: `requireAuth` w `onRequest`, usuwanie rozstrzyga klucz obcy

**Data:** 2026-09-23 · **Zadanie:** `F2-1` · **Status:** przyjęte

**Kontekst.** Pierwszy moduł domenowy. Plan ([04 §5](./04-api-spec.md#5-konta--apiv1accounts),
[05 §5](./05-dto-contracts.md#5-konta--dtoaccountdtots)) opisywał trasy i DTO, ale kilku
rzeczy nie rozstrzygał, a jedna reguła z Fazy 1 okazała się dziurawa.

### 1. `requireAuth` w fazie `onRequest`, nie `preHandler`

Test „każda trasa bez tokenu daje `401`" wyłożył się na `POST /accounts`: odpowiedź
brzmiała `400`. Fastify waliduje ciało **przed** `preHandler`, więc żądanie bez tokenu
i z błędnym ciałem dostawało błąd walidacji — po sparsowaniu ciała, którego
nieuwierzytelniony klient nie powinien móc nam wcisnąć. Ten sam błąd miał `PATCH /auth/pin`
od Fazy 1; nikt go nie zauważył, bo żaden test nie wysyłał złego ciała bez tokenu.

Decyzja: `requireAuth` podpinamy jako `onRequest` — w module kont i w module `auth`.
[ADR-027](#adr-027) (per trasa, nie hookiem pluginu) pozostaje w mocy; zmienia się tylko faza.
Regresję pilnuje test w `auth.me.test.ts` i test `401` wszystkich tras kont.

### 2. Usuwanie konta rozstrzyga klucz obcy, nie zliczenie transakcji

Niezmiennik I-10: konta z transakcjami nie wolno usunąć. Zamiast liczyć transakcje przed
usunięciem, repozytorium próbuje usunąć, a `ON DELETE RESTRICT` na
`transactions.account_id` / `counter_account_id` odmawia. Wynik wraca jako wartość
(`'in_use'`), serwis zamienia go na `409`.

- **Miękko usunięte** transakcje też blokują usunięcie. To celowe: przez 30 dni można je
  przywrócić (07 §10), a przywrócona transakcja bez konta rozbiłaby salda. Zliczenie
  z filtrem `deleted_at IS NULL` (reguła 5 z `CONTRIBUTING.md`) dałoby tu **zły** wynik.
- Brak okna wyścigu między „policz" a „usuń".
- Moduł kont nie czyta tabeli, której właścicielem jest moduł transakcji (02 §3, reguła 4).

Pułapka: SQLite zgłasza `RESTRICT` kodem **`SQLITE_CONSTRAINT_TRIGGER`**, a nie
`SQLITE_CONSTRAINT_FOREIGNKEY`. Ten sam kod niesie `RAISE()` z wyzwalacza, więc
rozpoznanie sprawdza też komunikat `FOREIGN KEY constraint failed` — test z wyzwalaczem
pilnuje, że inny błąd nie udaje „konta w użyciu".

### 3. Zmiana typu konta a klasa alokacji

07 §2.1 mówił tylko, że klasa **domyślnie** wynika z typu. Nie mówił, co przy zmianie typu
istniejącego konta. Przyjęte: klasa jest przeliczana tylko wtedy, gdy nie była nadpisana
(równa domyślnej dla starego typu). Reguła mieszka w `shared`
(`allocationClassAfterTypeChange`), bo formularz potrzebuje tej samej odpowiedzi. Dopisane
do [07 §2.1](./07-domain-rules.md#21-klasyfikacja-kont).

### 4. Uzupełnienia kontraktu

Dopisane do [05 §5](./05-dto-contracts.md#5-konta--dtoaccountdtots) i
[04 §5](./04-api-spec.md#5-konta--apiv1accounts):

| Co | Rozstrzygnięcie |
|---|---|
| `?includeArchived` | `ListAccountsQuerySchema`: wyłącznie `"true"`/`"false"`. `z.coerce.boolean()` zamienia `"false"` na `true` |
| ciało `PATCH /accounts/order` | `ReorderAccountsRequestSchema`; lista może być częściowa, bez powtórzeń |
| konta spoza listy kolejności | idą za wymienionymi w dotychczasowej kolejności — żadne dwa nie dzielą pozycji |
| `GET /accounts/:id` | do `F2-2` samo `AccountDto`; saldo dochodzi razem z wyliczaniem sald |
| `institution` | przycinana (`trim`) jak `name` |
| PATCH bez zmian | nie rusza `updatedAt`; archiwizacja zarchiwizowanego też nie |

### 5. Styl serwisu: funkcje z uchwytem bazy, nie fabryka

[02 §5](./02-architecture.md#5-serwisy--wstrzykiwanie-zależności) pokazuje serwis jako
fabrykę `createAccountsService(deps)`. Moduł `auth` od Fazy 1 używa zwykłych funkcji
przyjmujących `(handle, …, householdId, …)` — bez wpisu w dzienniku. Moduł kont idzie za
**kodem**, nie za przykładem: dwa style w jednym projekcie byłyby gorsze od każdego
z nich osobno, a zalety fabryki (atrapy w testach) i tak nie są wykorzystywane — testy
idą przez prawdziwą bazę `:memory:`. 02 §5 poprawione.

**Konsekwencje.** Fabryki danych testowych (`apps/api/test/factories.ts`) wstawiają
gospodarstwo, użytkownika i transakcję wprost do bazy i podpisują token bez logowania —
kolejne moduły Fazy 2 dostają je gotowe.

---

## ADR-032 — Salda: agregat w module transakcji, zarchiwizowane konta nie znikają z historii

**Data:** 2026-09-23 · **Zadanie:** `F2-2` · **Status:** przyjęte

**Kontekst.** 07 §7 podaje wzór salda, ale nie mówi, gdzie ma mieszkać zapytanie, co
z kontami zarchiwizowanymi, jak liczyć „saldo na początek miesiąca" ani czym jest
`liabilitiesRemainingMinor`, zanim istnieją zobowiązania. Dopisane do 04 §5, 05 §5 i 07 §7.

### 1. Gdzie liczy się suma ruchów

Saldo sumuje transakcje, więc zapytanie należy do modułu **transakcji**
(`transactions.repository.sumAccountFlows`), a moduł kont dostaje wynik przez
`transactions.service.accountFlows` — serwis woła serwis (02 §3, reguła 4). Moduł
`transactions` powstaje tu w szczątkowej postaci; CRUD dokłada `F2-5`.

Zapytanie rozkłada transakcję na nogi (przelew = dwie), liczy oba przekroje — przed
miesiącem i do `asOf` — w **jednym** przebiegu (`SUM(CASE …)`), żeby nie zobaczyć dwóch
różnych stanów bazy. Łączy się z `accounts` tylko po `opening_balance_on`.

Arytmetyka (`opening + ruch`, sumy per klasa, majątek) jest w czystych funkcjach
`accounts.balances.ts` — 100% pokrycia bez bazy.

### 2. Konta zarchiwizowane

Pominięcie zarchiwizowanych kont zmieniałoby majątek za marzec po archiwizacji
w listopadzie — wbrew 07 §10 („nic, co wpływa na liczby w zamkniętych miesiącach, nie
znika"). Pokazywanie wszystkich zaśmiecałoby listę pustymi kontami. Przyjęte: konto
zarchiwizowane jest w saldach, gdy na początku miesiąca albo na `asOf` miało saldo ≠ 0.
Konto z zerem nic nie wnosi, więc jego pominięcie nie zmienia żadnej sumy.
`AccountBalanceDto` dostaje pole `isArchived`, żeby ekran mógł takie konto oznaczyć.

### 3. Okres i „dziś"

`?month` → saldo na ostatni dzień miesiąca budżetowego; `?asOf` → ruch od początku
miesiąca tej daty; brak → dziś w strefie gospodarstwa (`households.timezone`, 07 §1.1).
Oba naraz → `400`. Strefę i dzień startu miesiąca moduł kont bierze z nowej funkcji
`auth.service.getHousehold` — tabela `households` należy do modułu `auth`.

### 4. `GET /accounts/:id`

Zwraca `AccountDetailDto` = `AccountDto` + `balanceMinor` + `balanceAsOf`. `balanceAsOf`
jest jawne, bo tuż po północy „dziś" klienta i gospodarstwa mogą się różnić.
Wykres 12 miesięcy z 06 §3.7 zostaje dla ekranu (`F2-6`) — nie jest częścią tego DTO.

### 5. Zobowiązania w majątku netto

`liabilitiesRemainingMinor` wynosi `0` do `F4-4`. To nie jest przybliżenie: bez modułu
zobowiązań żadnego nie da się założyć. `F4-4` podmienia funkcję
`liabilitiesRemainingMinor()` w `accounts.service.ts` na wywołanie serwisu zobowiązań
(07 §5.1). Implementowanie wzoru teraz byłoby wyprzedzaniem fazy (12 §2.2).

**Konsekwencje.** Saldo liczy się przy każdym odczycie (03 §3.5); przy skali projektu
jedno zapytanie z `UNION ALL` na kilka tysięcy wierszy jest pomijalne, a indeksy
`idx_tx_account` i `idx_tx_counter` (`… , booked_on`) istnieją od `F0-4`. Migawki
miesięczne (03 §3.5) — dopiero po pomiarze.

---

## ADR-033 — Kategorie: slug stały, zliczanie transakcji z koszem, scalanie obejmuje całą konfigurację

**Data:** 2026-09-23 · **Zadanie:** `F2-3` · **Status:** przyjęte

**Kontekst.** 04 §6, 05 §6 i 07 §9 opisywały kategorie, ale kilka rzeczy zostawiały
otwartych, a jedna reguła nie dawała się zrealizować tak jak dla kont.

### 1. I-10 wymaga zliczenia — klucz obcy tu nie pomoże

Przy kontach usuwanie rozstrzygał `ON DELETE RESTRICT` ([ADR-031](#adr-031)).
`transactions.category_id` ma **`ON DELETE SET NULL`**, więc usunięcie kategorii
po cichu odebrałoby ją wszystkim transakcjom. Serwis kategorii pyta więc serwis
transakcji (`categoryHasTransactions`) i dopiero wtedy usuwa.

Zliczenie **obejmuje transakcje miękko usunięte**, choć reguła 5 z `CONTRIBUTING.md` każe
filtrować `deleted_at IS NULL` „w każdym zapytaniu o transakcje". Reguła chroni
**sumy** — tu nie liczymy pieniędzy, tylko pilnujemy referencji: transakcję z kosza
można przywrócić przez 30 dni i musi wrócić z kategorią, która istnieje. To samo
dotyczy przepinania przy scalaniu. Wyjątek jest opisany w nagłówku
`transactions.repository.ts` i dotyczy wyłącznie tych dwóch funkcji.

Kategoria z podkategoriami też nie jest usuwana (`409`): `parent_id` ma
`ON DELETE SET NULL`, więc dzieci wypadłyby po cichu na poziom główny.

### 2. Slug powstaje raz i się nie zmienia

Seed rozpoznaje kategorie domyślne po `(household_id, kind, slug)` ([ADR-020](#adr-020)).
Gdyby zmiana nazwy przeliczała slug, przemianowana „Jedzenie" dostałaby nowy slug,
a ponowny seed założyłby drugą „Jedzenie". Dlatego:

- slug liczony jest przy założeniu tą samą funkcją `slugify` co w seedzie, z prefiksem
  rodzica dla podkategorii; kolizja → przyrostek `-2`, `-3`… (kolizja nie musi znaczyć
  duplikatu: przemianowana „Kawa" wciąż trzyma `kawa`);
- o duplikatach decyduje **nazwa**, nie slug: unikalna wśród rodzeństwa (ten sam `kind`
  i rodzic), bez względu na wielkość liter, łącznie z archiwum. Porównanie w JS
  (`toLocaleLowerCase('pl')`), bo SQLite-owe `lower()` zna tylko ASCII.

### 3. Scalanie przepina całą konfigurację

07 §9.3 wymieniał transakcje, reguły cykliczne i podpowiedzi AI. Planowane wydatki,
zobowiązania i propozycje w pozycjach dokumentów też wskazują kategorię — zostawione
wskazywałyby po scaleniu kategorię zarchiwizowaną. Scalenie obejmuje więc wszystkie.

Moduły tych tabel powstają w Fazach 4, 6 i 7, więc na razie przepięcie ich wierszy
robi `categories.repository.reassignConfigurationReferences`. **Każda z tych faz
przenosi swoją część do własnego serwisu** — to jest świadome, czasowe odstępstwo od
02 §3; wpis w „Zauważone" (`Z-13`) pilnuje, żeby nie zostało na stałe.

Dodatkowe warunki scalenia (`422`): ten sam rodzaj (inaczej I-4), cel aktywny, źródło
bez podkategorii, źródło ≠ cel, źródło nie systemowe (07 §9.3).

### 4. Archiwizacja w drzewie

Archiwizacja kategorii głównej archiwizuje jej podkategorie — aktywne dziecko pod
zarchiwizowanym rodzicem znikałoby z drzewa, a dalej byłoby do wybrania. Przywrócenie
podkategorii przywraca rodzica; przywrócenie rodzica dzieci **nie** przywraca, bo
mogły być zarchiwizowane świadomie i osobno.

### 5. Kontrakt

- Nowa trasa `POST /categories/:id/unarchive` — archiwizacja miała być odwracalna,
  a 04 §6 nie dawał drogi powrotu.
- Nowe schematy: `UpdateCategoryRequestSchema` (bez `kind` — zmiana rodzaju łamałaby
  I-4), `ListCategoriesQuerySchema`, `MergeCategoryRequestSchema`,
  `MergeCategoryResponseSchema`.
- `GET /categories/spending` i `CategorySpendingDto` przesunięte do Fazy 3. To raport
  miesiąca, nie zarządzanie kategoriami (`F2-3` go nie wymienia), i pokrywa się
  z `/months/:key/categories` z `F3-2`.

---

## ADR-034 — Źródła przychodu: kontrakt dopisany, domyślna flaga podstawy z rodzaju

**Data:** 2026-09-23 · **Zadanie:** `F2-4` · **Status:** przyjęte

**Kontekst.** 04 §12 wymieniał trasy, 03 §3.7 tabelę, ale **05 nie miał sekcji DTO**
dla źródeł przychodu. Kontrakt powstał więc przy tym zadaniu (05 §6a), przed kodem.

### 1. Domyślne `countsTowardAllocation`

Kolumna ma `DEFAULT 1`, a komentarz w 03 §3.7 mówi, że zwrot podatku „zwykle nie
powinien" wchodzić do podstawy. Przyjęte: pominięta flaga wynika z rodzaju — `refund`
→ `false`, pozostałe → `true`. Reguła w `shared` (`defaultCountsTowardAllocation`),
bo formularz ma podpowiedzieć tę samą wartość. Innych rodzajów nie wyłączam na zapas —
plan wskazuje tylko zwrot, a użytkownik przełącza każde źródło ręcznie.

Zmiana `kind` **nie** przelicza flagi: to pole użytkownik widzi i ustawia jawnie
(04 §12 wymienia je z nazwy), inaczej niż klasa konta ukryta w „Zaawansowanych".

Flaga nie jest migawką — jej zmiana działa wstecz (dopisane do 07 §2.3).

### 2. Usuwanie i archiwizacja

`transactions.income_source_id` ma `ON DELETE SET NULL`, więc I-10 idzie przez
zliczenie w serwisie transakcji, łącznie z koszem — wzorzec z [ADR-033](#adr-033).
Dodana trasa `unarchive`, jak przy kategoriach.

### 3. Właściciel i nazwa

`ownerUserId` musi należeć do gospodarstwa; tabela `users` należy do modułu `auth`,
więc sprawdza to nowa funkcja `auth.service.isHouseholdMember`. Osoba spoza
gospodarstwa → `404`, jak każdy cudzy zasób (09 §4).

Nazwa unikalna w gospodarstwie, bez względu na wielkość liter. Porównanie nazw
przeniesione z modułu kategorii do `shared/utils/names.ts` (`sameName`) — dwa moduły
nie powinny importować z siebie nawzajem pomocników.

### 4. `GET /income-sources/summary`

Przesunięte do Fazy 3 z tego samego powodu co `/categories/spending` (ADR-033):
to raport miesiąca, a `F2-4` to CRUD. Dopisane do `Z-14`.

---

<a id="adr-035"></a>

## ADR-035 — Transakcje: `422` dla reguł kształtu, migawka przy zmianie konta, `bulk` w Fazie 7

**Data:** 2026-09-23 · **Zadanie:** `F2-5` · **Status:** przyjęte

**Kontekst.** 04 §7, 05 §7 i 07 opisywały transakcje, ale kontrakt był wewnętrznie
sprzeczny w jednym miejscu, miał dwie pułapki w parametrach listy i zostawiał otwarte
kilka zachowań, które kod musiał rozstrzygnąć.

### 1. Reguły kształtu dają `422`, nie `400`

05 §7 wyrażał I-2, I-3 i I-7a przez `superRefine` w `CreateTransactionRequestSchema`.
Użyty jako ciało trasy dawałby `400 VALIDATION_ERROR` — a 04 §2 (poprawione w ADR-016)
podaje „przelew wymaga konta docelowego" jako **wzorcowy** przykład `422`. Poza tym
`PATCH` i tak musi sprawdzać kształt **po scaleniu** z bieżącym stanem, czego schemat
żądania nie potrafi (nie zna typu transakcji).

Przyjęte: reguły są jedną funkcją `transactionShapeIssues` w `shared/domain/transaction.ts`.
Formularz dostaje ją przez `superRefine` (`CreateTransactionRequestSchema` bez zmian
w roli), serwis woła ją na transakcji po scaleniu i rzuca `422` z problemami w `details`.
Ciałem `POST` jest `TransactionFieldsSchema` — te same pola bez `superRefine`.

Dopisana reguła **I-3a**: źródło przychodu tylko przy przychodzie. Na wydatku nic by nie
znaczyło, a raport źródeł (04 §12) mógłby je policzyć.

### 2. Pułapki parametrów listy

- `includeDeleted: z.coerce.boolean()` zamienia napis `"false"` na `true` — ten sam błąd,
  który `F2-1` ominął w `ListAccountsQuerySchema`. Teraz dwa literały.
- `minAmountMinor`/`maxAmountMinor` jako `AmountMinorSchema` odrzucałyby każdą wartość,
  bo parametr zapytania to tekst. Teraz `z.coerce.number().pipe(...)`.
- Filtry identyfikatorów i `source` wielokrotne, jak mówi 04 §7 (05 miał część
  pojedynczych). Pojedyncza wartość i powtórzony parametr dają zawsze tablicę.
- Dopisane reguły spójności: `month` wyklucza `from`/`to`, `from ≤ to`, `min ≤ max`.

### 3. Migawki klas przy zmianie konta

I-6 mówi, że migawka nie zmienia się przy zmianie **klasy konta**. O zmianie **konta
w transakcji** milczał. Przyjęte: `PATCH` zmieniający konto przelewu bierze migawkę tej
strony z nowego konta, drugiej nie rusza. Stara migawka opisywałaby konto, którego
transakcja już nie dotyczy, a efekt trafiałby do puli, do której pieniądze nie poszły.

### 4. Odwołania do archiwum i do cudzych bytów

Konto, kategoria i źródło z archiwum → `422` przy **ustawianiu** odwołania; transakcje,
które już je wskazują, dają się poprawiać. Byt spoza gospodarstwa → `404` z polem
w `details` (09 §4). Cel i zobowiązanie sprawdzane przez szkielety modułów `goals`
i `liabilities` z jedną funkcją istnienia — tak zaczynał moduł transakcji przy `F2-2`;
pełne moduły w Fazach 4–5.

### 5. Okno księgowania (I-8) — kiedy sprawdzane

Przy zapisie daty: nowa transakcja i zmiana `bookedOn`. Edycja innych pól, usunięcie
i przywrócenie transakcji sprzed okna **nie są blokowane** — czy zamknięte miesiące mają
być zamrożone w całości, to decyzja o zachowaniu produktu, którą roadmapa przypisuje
do `F3-3`. Do tego czasu `Z-17`. Górna granica: `latestPostableDate` w `shared`.

### 6. Cykl importów między serwisami

Serwis transakcji woła serwisy kont, kategorii i źródeł, a one wołały
`transactions.service` (salda, sprawdzenia referencji). Funkcje dla innych modułów
przeniesione do `transactions.ledger.ts`, który importuje tylko repozytorium. Wzorzec
dopisany do 02 §3.

### 7. Lista

- Paginacja kursorowa po (kolumna sortowania, `id`); kursor nieprzezroczysty (base64url),
  niesie sortowanie — kursor z innego sortowania albo uszkodzony → `400`.
- `accountId` łapie obie strony przelewu — wpływ jest częścią historii konta.
- `q` szuka bez względu na wielkość liter i ogonki: funkcja SQL `fold_search`
  rejestrowana na połączeniu (`foldForSearch` z `shared`). Wbudowane `lower()`/`LIKE`
  w SQLite znają tylko ASCII — „żabka" nie znalazłoby „Żabki". `instr` zamiast `LIKE`,
  więc `%` i `_` są dosłowne. Przy nazwach (`sameName`) ogonki nadal się liczą.
- Filtr `allocationKind` to SQL-owy odpowiednik `allocationEffects`; test przechodzi
  wszystkie kombinacje klas i nadpisań i pilnuje zgodności.
- `GET /transactions/:id` zwraca `TransactionListItemDto` (z nazwami), także z kosza.

### 8. Przesunięte

- `POST /transactions/bulk` → `F7-6`: jedynym odbiorcą jest commit dokumentu, a jego
  potrzeby (tryby `single`/`split`, tworzenie kategorii w tej samej transakcji
  bazodanowej) będą znane dopiero tam.
- `POST /transactions/:id/save-as-recurring` → `F4-8`, jak w roadmapie — bez modułu
  `recurring` nie ma czego tworzyć.

---

<a id="adr-036"></a>

## ADR-036 — Ekran kont: pierwszy ekran z danymi, „Więcej", szczegóły bez wykresu

**Data:** 2026-09-23 · **Zadanie:** `F2-6` · **Status:** przyjęte

**Kontekst.** Pierwszy ekran frontu, który czyta i zapisuje dane — ustala wzorzec dla
kolejnych (`api.ts` → hooki TanStack Query → ekran z czterema stanami). 06 §3.7 opisywał
listę i formularz, ale kilka rzeczy trzeba było rozstrzygnąć.

### 1. Ekran „Więcej" powstał razem z kontami

Konta siedzą w podsekcjach „Więcej" (06 §2), a `/more` był zaślepką — na telefonie,
czyli na docelowej szerokości, `/accounts` byłoby osiągalne tylko z paska adresu.
Żadne zadanie roadmapy nie obejmuje „Więcej", więc minimalna wersja (lista z
`secondaryNav()`, tej samej co pasek boczny) weszła do `F2-6`.

### 2. Szczegóły konta bez wykresu i bez historii

06 §3.7 zapowiada na `/accounts/:id` wykres 12 miesięcy i historię transakcji konta.
Wykres wymaga trasy sald miesiąc po miesiącu, której API nie ma (`Z-19`); historia —
listy transakcji z `F2-8`, gdzie dojdzie jako filtr `?accountId=`. Ekran ma na razie
saldo, dane konta, edycję, archiwizację i usunięcie.

### 3. Formularz: saldo tekstem, znak przełącznikiem

Saldo początkowe bywa ujemne (debet, karta), a klawiatura dziesiętna iOS nie ma minusa.
Pole przyjmuje kwotę tekstem (`parseAmountToMinor` z `shared`), znak niesie przełącznik
„Saldo ujemne". Wpisany minus jest odrzucany z podpowiedzią — dwie drogi do jednego znaku
rodziłyby pytanie, co znaczy „ujemne" przy wpisanym minusie. Klawiatura kwoty
(`<AmountInput>`) zostaje dla formularza transakcji: w formularzu z sześcioma polami
zajmowałaby pół ekranu.

Pula idzie do API **tylko wybrana ręcznie**, a przy zmianie rodzaju także wtedy, gdy się
nie zmieniła — inaczej serwer przeliczyłby nienadpisaną pulę z nowego rodzaju wbrew
podglądowi w formularzu (07 §2.1).

### 4. Nazwy rodzajów to przymiotniki

„Oszczędnościowe" / „Inwestycyjne" zamiast „Oszczędności" / „Inwestycje". Rodzaj i pula
to różne rzeczy, a te same słowa dawały w szczegółach „Rodzaj: Oszczędności, Pula:
Oszczędności" i dwa pola o tej samej nazwie w formularzu.

### 5. Konta z archiwum

Zarchiwizowane z saldem ≠ 0 zostają w swojej grupie z plakietką — wciąż wchodzą do
majątku (07 §7) i do sumy grupy z serwera, więc zabranie ich z listy rozjechałoby sumę
z wierszami. Zarchiwizowane z zerem są w sekcji „Archiwum". Każde konto widać raz.

### 6. Drobne zmiany infrastruktury

- `apiRequestWithMeta` w kliencie API — `meta` niesie treść (majątek netto, kursor,
  `affectedMonths`), a `apiRequest` ją gubił.
- Klucze `qk.accountList(includeArchived)` i `qk.account(id)`; mutacje kont unieważniają
  `qk.accounts()`, `qk.months()` i `qk.transactions()` (pozycje list niosą nazwę konta).
- Nowy prymityw `<TextField>` (15 §4.10), w `/dev/ui`.
- `formatDateOnly` we froncie to teraz reeksport z `shared` — dwie identyczne kopie.
- Usunięcie konta z potwierdzeniem w treści ekranu, nie w arkuszu, a po zapisie nowego
  konta zostajemy na liście: zamknięcie arkusza cofa wpis historii (`popstate`, 15 §4.6)
  i ścigałoby się z nawigacją wykonaną w tej samej chwili.

---

<a id="adr-037"></a>

## ADR-037 — Formularz transakcji: `Idempotency-Key` w API, arkusz jako stan powłoki

**Data:** 2026-09-23 · **Zadanie:** `F2-7` · **Status:** przyjęte

**Kontekst.** Formularz transakcji to najczęściej używany ekran aplikacji (06 §1.3:
„dwa dotknięcia do wydatku"). Przed nim trzeba było rozstrzygnąć `Z-16` — czy słabe
łącze może zapisać ten sam wydatek dwa razy — oraz kilka odstępstw od makiety 06 §3.3.

### 1. `Idempotency-Key` dla `POST /transactions` — po stronie API

Sama blokada przycisku w formularzu nie wystarcza: na słabym łączu żądanie **dochodzi**
do serwera, a gubi się odpowiedź. Użytkownik widzi błąd, stuka „Zapisz" jeszcze raz
i wydatek jest dwa razy. Chroni przed tym dopiero serwer, który rozpozna powtórkę.

- Tabela `idempotency_keys` ([03 §3.18](./03-data-model.md#318-idempotency_keys)),
  klucz główny `(household_id, scope, key)`; `scope` = `POST /transactions`, więc ten
  sam mechanizm obsłuży później księgowanie wystąpienia i commit dokumentu.
- Zapisywany jest skrót SHA-256 kanonicznego JSON-u ciała (klucze posortowane —
  kolejność pól w obiekcie nie ma znaczenia). Ten sam klucz i to samo ciało → pierwsza
  odpowiedź z nagłówkiem `Idempotent-Replayed: true`; ten sam klucz z innym ciałem →
  `409` (to błąd klienta, nie powtórka).
- **Pamiętane są tylko sukcesy.** Odrzucone żądanie (`422`) nie zużywa klucza — po
  poprawieniu pola formularz wysyła ten sam klucz z nowym ciałem i zapis przechodzi.
- Klucze żyją dobę; starsze są usuwane przy każdym zapisie z kluczem (tabela zostaje
  mała bez osobnego zadania okresowego).
- Nagłówek jest **opcjonalny** (8–128 znaków `A–Z a–z 0–9 _ -`): skrypty i testy
  nie muszą go wysyłać, a formularz wysyła zawsze.
- Formularz generuje klucz **raz na otwarcie arkusza** (`crypto.randomUUID()`), nie raz
  na żądanie — ponowienie po błędzie sieci niesie ten sam klucz. Nowe otwarcie arkusza
  to nowa transakcja i nowy klucz.

### 2. Arkusz jest stanem powłoki, nie trasą

06 §3.3 mówi „otwiera się nad bieżącym ekranem, żeby nie tracić kontekstu". Trasa
`/t/new` zabrałaby ekran spod arkusza, więc arkusz żyje w `TransactionSheetProvider`
w powłoce, a FAB i „Dodaj" otwierają go bez zmiany adresu. Trasy `/t/new`
(`?type=income|transfer`) i `/t/:id` zostają jako wejścia z zewnątrz: podmieniają
adres na bieżący miesiąc i otwierają arkusz nad nim.

### 3. Wybory w arkuszu to widoki, nie osobne arkusze

Każdy `<Sheet>` przechwytuje „wstecz" (15 §4.6). Arkusz kategorii nad arkuszem
formularza zamknąłby się razem z nim jednym gestem i zgubił wpisaną kwotę. Wybór konta,
kategorii, daty i źródła podmienia więc treść arkusza, a „Wróć" przywraca formularz.

### 4. „Zapisz" przyklejony na dole, nie w nagłówku

Makieta ma „Zapisz" w prawym górnym rogu. Nad klawiaturą kwoty kciuk sięga dołu ekranu,
a nie górnego rogu (06 §1.2), więc przycisk stoi przyklejony pod polami, zawsze widoczny.

### 5. Wybór kategorii: lista, bez „Ostatnio używanych"

Kategorie z seeda nie mają ikon, więc siatka ikon z 15 §4.10 byłaby siatką pustych
kafli — jest lista z podkategoriami wciętymi pod rodzicem i wyszukiwarka. Sekcja
„Ostatnio używane" wymaga statystyki użycia, której API nie ma (`Z-22`). Kategoria jest
opcjonalna (07 §9.2): „Bez kategorii" jest pierwszą pozycją.

### 6. Poza zakresem `F2-7`

- „Zapisz jako wydatek stały" — reguły cykliczne powstają w Fazie 4; checkbox dojdzie
  w `F4-8`, zgodnie z roadmapą.
- Pole „Na cel" w przelewie — cele powstają w Fazie 5 (`Z-23`).

### 7. Okno księgowania w formularzu

Formularz sprawdza okno (I-8) tak jak serwer ([ADR-035](#adr-035)): tylko gdy data jest
nowa albo zmieniona. Poprawka opisu starej transakcji z niezmienioną datą przechodzi.
Wybór daty i tak nie pozwala wyjść poza okno — sprawdzenie przy zapisie łapie datę
wpisaną ręcznie w polu kalendarza.

### 8. Drobne zmiany infrastruktury

- `<OptionGrid>` przeniesiony z `features/accounts` do `components/ui` — drugim
  użytkownikiem jest rodzaj źródła przychodu.
- `useAccessToken()` / `requireToken()` w `features/auth/use-token.ts` — wspólne dla
  wszystkich hooków danych.
- Klucz `qk.categoryTree(kind)`; zapis transakcji unieważnia `qk.transactions()`,
  `qk.accounts()`, `qk.monthsAvailable()` i `qk.month(m)` dla każdego miesiąca
  z `meta.affectedMonths`.
- Szybko dodane źródło przychodu trafia do pamięci podręcznej od razu — bez tego pole
  „Źródło" pokazywałoby „…" do czasu powrotu listy z serwera.
- `<AmountInput>` wywoływał `onChange` z wnętrza funkcji aktualizującej `setDraft`.
  Póki nikt nie trzymał kwoty w stanie, było to niewidoczne; formularz transakcji
  dostawał ostrzeżenie Reacta „setState w trakcie renderowania innego komponentu".
  Poprawione, z testem w trybie ścisłym.
- `errorDetails` przeniesiony z `accounts-screen.tsx` do `lib/api-client.ts` — arkusz
  transakcji importował go z ekranu kont i wciągał cały ekran do paczki startowej.

### 9. Formularz ładowany leniwie

Powłoka montuje `TransactionSheetProvider` na każdym ekranie. Ze statycznym importem
formularza paczka startowa urosła z ~147 kB do ~190 kB gzip (prymitywy, Radix, pickery,
schematy Zod z `shared`) — przy budżecie 200 kB. Provider trzyma teraz tylko stan,
a arkusz z formularzem (`transaction-sheet-view.tsx`, 6,7 kB gzip) jest ładowany
leniwie i **pobierany w tle 1,5 s po starcie**, więc pierwsze dotknięcie FAB-a nie czeka
na sieć. Trasa `/t/*` (z `TransactionTypeSchema`) poszła do osobnego modułu z tego
samego powodu. Paczka startowa: ~150 kB gzip.

Wcześniejsze wpisy w 13 („109 kB") liczyły tylko fragment wejściowy; od `F2-7` liczony
jest cały zestaw ładowany na starcie (wejście + `modulepreload` + CSS).

### 10. `<Sheet>` zamontowany od razu otwarty

Arkusz ładowany leniwie montuje się z `open` już ustawionym. Tryb ścisły Reacta odpala
wtedy efekt „wstecz" dwa razy: wpis historii → cofnięcie → wpis. Cofnięcie jest
w przeglądarce asynchroniczne, więc jego `popstate` dochodziło po drugim wpisie
i zamykało arkusz, zanim użytkownik go zobaczył (tylko w trybie deweloperskim, ale
każdy przyszły arkusz ładowany leniwie trafiłby na to samo). `<Sheet>` zaczyna
pilnować „wstecz" dopiero po zamontowaniu. jsdom nie odtwarza tej kolejności, więc
poprawkę potwierdza sprawdzenie w przeglądarce, nie test jednostkowy.

Przy okazji: test „wstecz zamyka arkusz" czekał na `popstate` jeden takt zegara
i padał mniej więcej raz na piętnaście przebiegów — czeka teraz przez `waitFor`.

---

## ADR-038 — Historia i kategorie: sumy z serwera, statystyka użycia, toast w powłoce

**Data:** 2026-09-23 · **Zadanie:** `F2-8`, `F2-9` · **Status:** przyjęte

**Kontekst.** Oba ekrany potrzebowały liczb, których API nie dawało: historia — liczby
transakcji, sum i sumy **każdego dnia** (06 §3.2), ekran kategorii — licznika użyć i sumy
w miesiącu (06 §3.11). Przy okazji wyszły braki w prymitywach (toast, przełącznik
miesiąca, pole wielowierszowe) i w arkuszu transakcji (brak „Usuń").

### 1. `meta.summary` w `GET /transactions` — zamiast osobnej trasy

Suma dnia liczona z wczytanych wierszy jest **błędna** przy paginacji: dzień rozcięty
granicą strony pokazuje sumę części transakcji i zmienia ją po doczytaniu reszty.
Podsumowanie liczy więc serwer, dla tych samych filtrów co lista (wspólna funkcja
warunków w repozytorium — suma nie może liczyć innego zbioru niż lista pod nią).

- Tylko na **pierwszej** stronie (bez `cursor`): kolejne doczytują tę samą listę, której
  sumy się nie zmieniły. Jedno żądanie na wejście na ekran zamiast dwóch.
- `count` — każda pasująca transakcja (także z kosza przy `includeDeleted=true`); sumy —
  wyłącznie `posted` i nieusunięte, jak salda. Transakcja z kosza widoczna na liście nie
  może ruszyć sumy (reguła 5).
- Przelewy osobno (`transferMinor`) — nie są ani wydatkiem, ani wpływem (ADR-003).

Odrzucone: `GET /transactions/summary` — drugie żądanie i drugi klucz pamięci podręcznej
do unieważniania przy każdym zapisie, bez zysku.

### 2. `GET /categories/usage?month=` — statystyka, nie raport

`GET /categories/spending` czeka na `F3-2` (ADR-033, `Z-14`) — to raport miesiąca do
wykresu z udziałem procentowym i porównaniem. Ekran ustawień potrzebuje czegoś innego:
liczby transakcji **ze wszystkich miesięcy** (czy kategoria jest w ogóle używana, zanim się
ją usunie) i gołej sumy bieżącego miesiąca. Nowa, wąska trasa nie przesądza decyzji
z `Z-14`.

- Liczby samej kategorii, bez podkategorii — sumę rodzica składa front, bo to on wie,
  które podkategorie pokazuje (archiwum osobno).
- Bez kosza w liczniku. Kategoria z licznikiem `0` może mimo to nie dać się usunąć
  (I-10 liczy kosz) — ekran pokazuje wtedy komunikat `409` z serwera.
- Zapytanie przez księgę transakcji (`transactions.ledger.categoryUsage`), jak
  `categoryHasTransactions` — moduł kategorii nie sięga do cudzego repozytorium.
- Każdy zapis transakcji unieważnia `qk.categoryUsageAll()`.

### 3. Usunięcie bez pytania, z „Cofnij"

Gest w lewo i „Usuń transakcję" w arkuszu przenoszą do kosza **od razu**, z toastem
„Cofnij". Usunięcie jest miękkie i odwracalne (07 §10), a pytanie „na pewno?" przy każdym
przesunięciu wiersza uczy klikać „Tak" bez czytania. Potwierdzenie w treści zostaje
tam, gdzie operacja jest nieodwracalna — usunięcie kategorii i konta.

„Usuń transakcję" w arkuszu edycji to **wymagana** alternatywa gestu (15 §2.7) — przed
`F2-8` arkusz nie miał usuwania w ogóle. Arkusz z transakcją z kosza dostał „Przywróć"
(wcześniej odsyłał do listy, która nie umiała pokazać kosza), a panel filtrów historii —
„Pokaż usunięte transakcje".

### 4. Toast jako stan powłoki

Toast pokazany przez komponent, który zaraz znika (arkusz zamykany po usunięciu, wiersz
wypadający z listy), zniknąłby razem z nim i zabrał „Cofnij". `ToastProvider` siedzi
w powłoce obok `TransactionSheetProvider`; jeden toast naraz, obok FAB-a. Mutacja
„Cofnij" żyje w komponencie, który przetrwa zamknięcie arkusza.

### 5. Filtry w adresie pod nazwami z API

`?type=expense&categoryId=…&minAmountMinor=…` — jedno mapowanie mniej. Adres pochodzi od
użytkownika, więc każda wartość przechodzi przez schematy z `shared`; śmieć znika po cichu
zamiast dawać `400` na cały ekran, odwrócony zakres kwot jest zamieniany. „Źródło" z 06
§3.2 to źródło przychodu. Zaznaczenie kategorii głównej zaznacza podkategorie — API
filtruje po dokładnym `categoryId`, a „Jedzenie" bez „Kawy" pokazałoby garść transakcji.
Zamknięcie panelu cofa jego wpis historii, więc filtry trafiają do adresu dopiero po
`popstate` — ta sama pułapka i to samo rozwiązanie co w ADR-037 §5.

### 6. Prymitywy i drobne zmiany

- `<MonthSwitcher>` w `components/ui`: na razie **same strzałki** (odnośniki). Siatka
  12 miesięcy, gest w bok i wstępne pobieranie sąsiadów zostają w `F3-5`, gdzie są
  w roadmapie. Nazwa miesiąca 16 px do 640 px, a „Filtry" na 390 px to ikona
  z plakietką na niej — pomiar w przeglądarce: z napisem i plakietką obok nazwa
  „październik 2026" była ucinana o 16 px.
- `<TextField rows>` — pole wielowierszowe (podpowiedzi dla AI).
- `<Button asChild>` renderował obok dziecka `null` wskaźnika ładowania, a `Slot` z Radix
  przyjmuje dokładnie jedno dziecko — każdy `asChild` wywracał ekran. Dotąd nikt go nie
  używał.
- Szczegóły konta: odnośnik „Historia" do historii z filtrem konta — spełnia zapowiedź
  z ADR-036 bez drugiej kopii listy.
- Wybór rodzica w arkuszu kategorii zwinięty do jednego wiersza: kilkanaście kategorii
  głównych z seeda spychało podpowiedzi dla AI poza ekran.
- `transactionCountLabel` (polska odmiana: 1 transakcja / 2 transakcje / 5 transakcji)
  w `lib/format.ts`.

### 7. Poza zakresem

- Odświeżenie gestem na Historii (06 §5) — `Z-24`.
- Ikony i kolory kategorii — nie ma ich w seedzie (`Z-22`), więc formularz ich nie edytuje.
- Lista osób w gospodarstwie (`Z-15`) — ekran kategorii jej nie potrzebował; zostaje
  do ekranu ustawień.

---

<a id="adr-039"></a>

## ADR-039 — Ekran miesiąca: podsumowanie rośnie sekcja po sekcji, jeden raport kategorii

**Data:** 2026-09-23 · **Zadanie:** `F3-1`, `F3-2` · **Status:** przyjęte

**Kontekst.** 04 §14 i 05 §13 opisują `GET /months/:key/summary` jako komplet: konta,
sumy, rozkład, cele, zobowiązania, pozycje cykliczne, planowane wydatki, kategorie,
ostatnie transakcje. Pięć z tych sekcji należy do modułów Faz 4–6, których jeszcze nie
ma. Do tego kilka pól kontraktu nie miało definicji (`unallocatedMinor`, `isPartial`),
a `Z-14` czekał na decyzję, który raport kategorii zostaje.

### 1. Sekcje dochodzą z modułami, które je zasilają

W Fazie 3 `MonthSummaryDto` ma wyłącznie sekcje, które da się wypełnić **prawdziwymi**
liczbami: ramy czasu, sumy, konta, kategorie, ostatnie transakcje, porównanie.
`allocation` i `goals` dochodzą w `F5-8`, `liabilities` i `recurring` w `F4-7`,
`plannedExpenses` w Fazie 6 — każda z testem swojego modułu. Docelowy kształt z 04 §14
się nie zmienia, zmienia się kolejność dostarczenia (06 §7: „dashboard iteracyjnie,
sekcja po sekcji").

Odrzucone: puste sekcje-zaślepki. Zera w `liabilities` są prawdą (ADR-032), ale
`allocation` wymaga reguł `F5-3` (status linii, trend) — zaślepka udawałaby wynik, a front
zbudowany na niej rysowałby kafel, którego logiki nie ma.

### 2. Definicje pól, których brakowało

- `netMinor = income − expense − savings − investment`. Spłata długu jest **częścią**
  wydatków (07 §2.2a), więc nie jest odejmowana drugi raz.
- `unallocatedMinor = max(0, net)` — kwota, którą da się jeszcze gdzieś skierować.
  Miesiąc na minusie nie ma czego rozdysponować; minus niesie `net`.
- `isPartial` — miesiąc trwa (dla `monthStartDay = 1` to samo co `isCurrent`).
- Nowe: `isFuture` (podgląd bez księgowania, 06 §3.1), `daysElapsed` / `daysInMonth`
  (pasek „20 z 30 dni"; dzisiejszy dzień liczy się jako miniony; w Fazie 5 to samo
  zasila `progress` z 07 §2.5), `canPostUntil` (górna granica okna, 07 §1.3).
- `uncategorizedCount` — licznik wydatków bez kategorii z 07 §9.2 (`Z-18`, część
  „licznik"; filtr listy dochodzi przy dashboardzie).
- `comparison.hasPreviousData` i `incomeDeltaBps` — procent przy zerowej podstawie to
  `0` **i flaga** (12 §6), a wiersz „Wpływy ↑ 0%" z 06 §3.1 potrzebuje procentu wpływów.

### 3. Jeden raport kategorii: `GET /months/:key/categories` (`Z-14`)

`GET /categories/spending` z 04 §6 **nie powstaje** — liczyłby to samo. Raport miesiąca
zwraca kategorie główne z podkategoriami (`CategorySpendingTreeDto`), kafel dashboardu
bierze z tego samego wyliczenia pięć pierwszych (`topCategories`).

- Podkategorie zwinięte do rodzica; rodzic niesie sumę razem z dziećmi.
- „Bez kategorii" jako pozycja z `categoryId: null` — `CategorySpendingDto.categoryId`
  jest teraz `nullable`. Suma rozbicia **zawsze** równa się wydatkom miesiąca.
- Kategorie z archiwum zostają w raporcie (07 §10).
- `previousMonthAmountMinor = null`, gdy poprzedni miesiąc nie miał żadnego wydatku —
  inaczej pierwszy miesiąc używania aplikacji pokazywałby same strzałki „↑".
- Pozycja z wydatkiem tylko w poprzednim miesiącu zostaje (kwota `0`) — spadek do zera
  też jest informacją. Kafel dashboardu pokazuje tylko kategorie z wydatkiem teraz.

### 4. Skąd biorą się liczby

Sumy i kategorie liczy **własne** repozytorium `months` (wyjątek z 02 §3) — jedno
zapytanie na sumy miesiąca, żeby dwa odczyty nie zobaczyły różnego stanu bazy. Efekt
alokacji w SQL jest odpowiednikiem `allocationEffects`; test przechodzi wszystkie 36
kombinacji klas i nadpisań. Salda i ostatnie transakcje pochodzą z serwisów kont
i transakcji — to te same liczby co na ekranach kont i historii i muszą wychodzić z tego
samego kodu.

### 5. Przesunięte

- `GET /months/compare?from=&to=` — dane do wykresu trendu. Dziś nie ma odbiorcy
  (wykresy: Faza 8); porównanie z poprzednim miesiącem jest w podsumowaniu.
- Liczba zapytań podsumowania (~9 prostych, po indeksach) — pomiar w `F3-7`.

---

<a id="adr-040"></a>

## ADR-040 — Zamknięte miesiące: liczby zamrożone, opisy do poprawienia

**Data:** 2026-09-23 · **Zadanie:** `F3-3` · **Status:** przyjęte

**Kontekst.** Okno księgowania (I-8) było sprawdzane tylko przy zapisie **daty**
(ADR-035 §5). Zmiana kwoty wydatku z marca, jego usunięcie albo przywrócenie z kosza
przechodziły, choć zmieniają raport marca dokładnie tak samo jak dopisanie nowego
wydatku. Roadmapa przypisała decyzję do `F3-3` (`Z-17`).

**Decyzja.** Miesiąc sprzed okna jest zamknięty (07 §1.4):

- wolno poprawić `description`, `merchant`, `notes` — żaden raport z nich nie liczy;
- każde inne pole, usunięcie i przywrócenie → `422 DOMAIN_RULE_VIOLATION`; przy `PATCH`
  `details` wskazuje zablokowane pola, a żądanie jest odrzucane w całości (bez zapisu
  dozwolonej części — częściowy sukces ukryłby odmowę);
- przeniesienie daty z zamkniętego miesiąca do okna też jest odmową: transakcja znika
  wtedy z zamkniętego miesiąca;
- granica = dolna granica okna; podniesienie limitu otwiera miesiąc.

Reguła jest w `shared` (`isInClosedMonth`, `frozenFieldChanges`, `closedMonthMessage`).
Formularz nie czeka na `422`: w transakcji z zamkniętego miesiąca kwota, kategoria, konta
i data są wierszami tylko do odczytu z notką, a arkusz nie pokazuje „Usuń transakcję"
ani „Przywróć".

**Dlaczego nie „wszystko zamrożone".** Literówka w nazwie sklepu albo notatka do starego
wydatku nie zmieniają żadnej liczby, a blokada zmuszałaby do podnoszenia limitu dla
kosmetyki. **Dlaczego nie „nic nie zamrożone".** Wtedy limit chroni przed dopisaniem,
ale nie przed usunięciem — raport zamkniętego miesiąca zmieniałby się bez śladu, wbrew
07 §10 („nic, co wpływa na liczby w zamkniętych miesiącach, nie znika").

**Koszt.** Poprawka kategorii starego wydatku wymaga chwilowego podniesienia limitu.
Czyszczenie kosza po 30 dniach (07 §10) nie jest blokowane — to zadanie konserwacyjne,
a transakcja w koszu i tak nie wchodzi do liczb. Gest usunięcia na liście historii
zamkniętego miesiąca nie jest wyłączany: odmowa serwera wraca w toaście z wyjaśnieniem.

---

<a id="adr-041"></a>

## ADR-041 — Dashboard miesiąca, przełącznik z siatką, pomiar pierwszego renderowania

**Data:** 2026-09-23 · **Zadanie:** `F3-4`…`F3-7` · **Status:** przyjęte

**Kontekst.** 06 §3.1 rysuje dashboard z siedmioma sekcjami; w Fazie 3 dane ma pięć
z nich (ADR-039). Kilka zachowań nie było opisanych: co pokazać, gdy nie ma porównania,
kiedy kroki startowe, jak ma działać siatka miesięcy w arkuszu, który trzyma wpis historii.

### 1. Sekcje i liczby

- „Zostaje" = `netMinor`. Żeby dało się to policzyć z ekranu, pod wpływami i wydatkami
  stoją „Na / Z oszczędności" i „Na / Z inwestycji" — tylko gdy ≠ 0. Mockup z 06 §3.1
  ich nie ma, bo tam tę rolę gra kafel celów procentowych (Faza 5).
- Porównanie: bez danych z poprzedniego miesiąca nic; przy zerowej podstawie sama
  strzałka (procent nie istnieje). Kierunek słowem dla czytnika ekranu.
- Trend kategorii „→" przy różnicy poniżej 5% — strzałka przy złotówce różnicy
  sugerowałaby zmianę, której nie było.
- Kroki startowe wyłącznie przy pierwszym uruchomieniu (brak kont i transakcji). Pusty
  miesiąc u kogoś, kto ma konta, to dashboard z zerami — „Dodaj konta" wyglądałoby tam
  jak utrata danych.
- Baner miesiąca przyszłego i zamkniętego (07 §1.4); w obu brak „Dodaj wydatek".

### 2. Filtr „bez kategorii" (`Z-18`)

Licznik z 07 §9.2 potrzebował celu. `GET /transactions?uncategorized=true` (dwa literały,
jak `includeDeleted`; razem z `categoryId` → `400`), w historii parametr adresu i pole
w panelu filtrów. Z adresu wygrywa jawnie wybrana kategoria — oba naraz dałyby `400`
na cały ekran.

### 3. Przełącznik (`F3-5`)

- Siatka jako prymityw `<MonthGridSheet>` w `components/ui` (danych nie pobiera —
  dostaje listę miesięcy), `<MonthSwitcher onOpenPicker>` otwiera ją dotknięciem nazwy.
  Lista miesięcy z danymi pobierana dopiero przy otwarciu.
- Wybór w siatce to **przycisk**, nie odnośnik: zamknięcie arkusza cofa jego wpis
  historii asynchronicznie, więc nawigacja idzie po `popstate` (ta sama pułapka co
  ADR-037 §5 i ADR-038 §5).
- Gest w bok na treści, ≥ 60 px i co najmniej dwa razy dłuższy w poziomie niż w pionie;
  ignorowany na kaflach kont (tam poziomy ruch przewija kafle) i dla myszy.
- Sąsiednie miesiące: `prefetchQuery` po `requestIdleCallback`, dopiero po wczytaniu
  oglądanego — nie dzielą z nim łącza.

### 4. Pomiar (`F3-7`)

Produkcyjna paczka (`vite preview`), Chromium 390 × 844, CPU spowolnione 4×, baza
z 4 332 transakcjami z 36 miesięcy, sesja przez odnowienie jak w aplikacji. Czas od
nawigacji do treści dashboardu (5 przebiegów):

| Profil | Pierwsze malowanie | Treść dashboardu |
|---|---|---|
| 4G: 9 Mb/s, RTT 60 ms | 0,75–0,83 s | **1,31–1,37 s** ✅ |
| „wolne 4G” Lighthouse: 1,6 Mb/s, RTT 150 ms | 1,82–1,87 s | 2,60–2,65 s ❌ |

`GET /months/:key/summary`: mediana **12 ms** po stronie serwera, 10 KB odpowiedzi.
Kryterium „< 1,5 s na 4G" jest spełnione dla zwykłego 4G, nie dla profilu wolnego.
Ścieżka krytyczna na wolnym łączu jest szeregowa: paczka startowa (149 kB gzip, ~1,1 s)
→ odnowienie sesji → fragment ekranu → podsumowanie. Sprawdzone i **odrzucone**: wstępne
pobieranie fragmentu ekranu równolegle z sesją — bez mierzalnego zysku (pierwsze
malowanie o ~0,15 s później przez rywalizację o łącze). Dalsze kroki w `Z-26`, `Z-27`.

### 5. Poza zakresem

Odświeżenie gestem (`Z-24`), awatary domowników w nagłówku (`Z-15`), ikony kategorii
(`Z-22`) — kafel ma ikonę zastępczą.

---

<a id="adr-042"></a>

## ADR-042 — Cofnięcie zaksięgowania, formatowanie w bramce, plakietka „własna", cel wydajności

**Data:** 2026-09-24 · **Zadanie:** przed `F4-1` · **Status:** przyjęte (decyzje właściciela)

### 1. Usunięcie transakcji z zaksięgowania cofa zaksięgowanie (`Z-11`)

**Kontekst.** `recurring_occurrences.transaction_id` i `planned_expenses.transaction_id`
mają `ON DELETE SET NULL`, a I-12 i I-18 wymagają niepustego `transaction_id` przy
`posted`. `Z-11` opisywał to jako problem czyszczenia kosza po 30 dniach — ale sprzeczność
pojawia się wcześniej: miękkie usunięcie transakcji zostawiało wystąpienie `posted`
wskazujące transakcję z kosza. Dashboard pokazywałby czynsz jako zapłacony, choć pieniędzy
nie ma w księdze. `POST /recurring/occurrences/:id/unpost` był w 04 §9, ale bez opisu,
co dzieje się z transakcją.

**Decyzja.** Jedna operacja z dwoma wejściami (07 §6.7): `unpost` przenosi transakcję
do kosza i przywraca `planned`; usunięcie transakcji robi to samo; przywrócenie z kosza
wiąże ponownie, o ile wystąpienie nadal jest `planned`, inaczej wraca jako zwykła
transakcja. Planowany wydatek analogicznie, status z odłożonej kwoty i terminu; instancja
na kolejny rok zostaje i powstaje najwyżej raz.

**Skutek.** I-12 i I-18 obowiązują zawsze, nie tylko do czyszczenia kosza. `ON DELETE
SET NULL` zostaje bez zmian jako siatka bezpieczeństwa — **schemat się nie zmienia**.
Implementacja w `F4-3` (wystąpienia) i Fazie 6 (planowane wydatki); do tego czasu nic
nie tworzy powiązań, więc nie ma czego cofać.

**Odrzucone.** `ON DELETE RESTRICT` — kosz nie dałby się wyczyścić, a problem transakcji
w koszu przy `posted` zostałby nietknięty. Blokada usuwania transakcji z zaksięgowania —
zmuszałaby do szukania drugiej drogi dla tej samej intencji („to się nie wydarzyło").

### 2. `format:check` w bramce przed scaleniem (`Z-12`)

Jednorazowe `prettier --write` w osobnym commicie (wyłącznie formatowanie, 40 plików).
Bramka: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` (`CONTRIBUTING.md`,
12 §2.4, §3). Poza Prettierem: `*.md` — wyrównywałby tabele przy każdej edycji dokumentu
i zaśmiecał diffy planu — oraz `design/`, gdzie makiety mają wkompilowany arkusz Tailwinda.

### 3. Plakietka „własna" zamiast „systemowa" (`Z-25`)

Seed oznacza jako systemowe wszystkie 94 kategorie, więc „systemowa" stała przy prawie
każdym wierszu. Na liście wyróżniamy wyjątek: „własna" przy kategoriach dodanych przez
domowników. Informacja o tym, że systemowej nie da się usunąć, zostaje w arkuszu.

### 4. Cel wydajności: zwykłe 4G

Kryterium z 06 §6 („< 1,5 s na 4G") dotyczy zwykłego 4G — spełnione (1,3 s, ADR-041 §4).
Profil „wolnego 4G" Lighthouse nie jest celem (decyzja właściciela); `Z-26` zamknięte.

### 5. Odłożone do wdrożenia

Parametry argon2id na docelowym VPS (`Z-2`) i reverse-proxy z kompresją (`Z-27`) —
sprawdzane przy `F8-7`, gdy będzie maszyna.

---

<a id="adr-043"></a>

## ADR-043 — Reguły cykliczne: te same reguły co transakcja, terminarz w `shared`

**Data:** 2026-09-24 · **Zadanie:** `F4-1` · **Status:** przyjęte

**Kontekst.** 05 §11 opisywał `CreateRecurringRuleRequestSchema` z `superRefine` — jako
ciało trasy dawałby `400`, a nie `422`, tak jak kiedyś przy transakcjach (ADR-035 §1).
Nie było opisane, jak sprawdzać odwołania reguły, co robić z polami bez znaczenia dla
częstotliwości ani skąd wziąć `anchorDate`, który w 03 §3.11 jest `NOT NULL`.

### 1. Reguła sprawdzana tak jak transakcja, którą utworzy

- Kształt: `recurringRuleShapeIssues` = `transactionShapeIssues` (I-2, I-3, I-7a, źródło
  tylko przy przychodzie) + terminarz. Ciało `POST` to `RecurringRuleFieldsSchema` bez
  walidacji krzyżowej, `422` z serwisu; formularz dostaje te same reguły przez `superRefine`.
- Odwołania: sprawdzenia z serwisu transakcji przeniesione do `transactions.references.ts`
  (importuje wyłącznie serwisy innych modułów) i wołane przez oba serwisy. Kopia
  rozjechałaby się przy pierwszej poprawce — a błąd reguły wyszedłby dopiero przy
  księgowaniu, miesiące po jej zapisie.
- `flow` niezmienny, jak `type` transakcji.

### 2. Terminarz w `shared`

`occurrenceDatesForMonth`, `upcomingDueDates`, `defaultAnchorDate`, `normalizeSchedule`
i `recurringScheduleIssues` — czyste funkcje: API użyje ich do wystąpień (`F4-2`),
formularz do podglądu terminów przed zapisem. Pola bez znaczenia dla częstotliwości
są czyszczone (dzień miesiąca przy regule tygodniowej mylił każdego, kto czyta regułę),
`every_n_months` wymaga odstępu ≥ 2 („co 1 miesiąc" to `monthly`).

### 3. Podgląd bez zapisu

`nextDueOn` i `upcomingDueDates` są wyliczane z terminarza przy odczycie. Wystąpienia
w bazie powstają dopiero w `F4-2`, wyłącznie dla bieżącego i wcześniejszych miesięcy
(07 §6.2) — podgląd przyszłości nie może ich zapisywać.

### 4. `Z-13` — część reguł

Przepinanie `recurring_rules` przy scalaniu kategorii przeniesione z repozytorium kategorii
do modułu `recurring` (`recurring.categories.ts`). Zostają planowane wydatki, zobowiązania
i pozycje dokumentów (Fazy 4, 6, 7).

### 5. Odłożone

- Skutki edycji i usunięcia reguły dla wystąpień (07 §6.4) — `F4-2`, gdy wystąpienia powstaną.
- Usunięcie konta, kategorii albo źródła wskazywanego przez regułę — `Z-28`.

---

<a id="adr-044"></a>

## ADR-044 — Konto reguły usunięte albo zarchiwizowane: reguła wstrzymana

**Data:** 2026-09-24 · **Zadanie:** przed `F4-3` (`Z-28`) · **Status:** przyjęte (decyzja właściciela)

**Kontekst.** I-10 blokuje usunięcie konta, kategorii i źródła z transakcjami. Reguły
cykliczne wskazują je przez `ON DELETE SET NULL`, więc usunięcie po cichu zostawiało
regułę bez konta — a takiej nie da się zaksięgować. Archiwizacja konta daje ten sam skutek
(na konto z archiwum nie wolno księgować, ADR-035 §4) i jest drogą częstszą: konta
z historią nie da się usunąć.

**Decyzja właściciela: reguła jest archiwizowana, nie blokuje usunięcia.** Reguły nie
mają osobnego archiwum — archiwizacją reguły jest jej **wstrzymanie** (`isActive = false`),
które zachowuje konfigurację i historię.

- Usunięcie **albo archiwizacja** konta wstrzymuje wszystkie aktywne reguły z tym kontem
  po dowolnej stronie — w tej samej transakcji bazodanowej; nieudane usunięcie (`409`)
  cofa wstrzymanie.
- Przywrócenie konta z archiwum reguł **nie** wznawia — to decyzja o przyszłych płatnościach.
- Usunięta kategoria albo źródło przychodu: pole reguły czyszczone (`SET NULL`), reguła
  działa dalej — oba pola są opcjonalne i nie blokują księgowania.

Wejście dla modułu kont: `recurring.external.ts` (dawniej `recurring.categories.ts`),
importuje wyłącznie repozytorium reguł.

---

<a id="adr-045"></a>

## ADR-045 — Wystąpienia cykliczne: okno generowania, podgląd przyszłości, skutki edycji

**Data:** 2026-09-24 · **Zadanie:** `F4-2` · **Status:** przyjęte

**Kontekst.** 07 §6.2 mówi „generowanie obejmuje wyłącznie miesiąc bieżący i wcześniejsze",
ale nie mówi, od kiedy, ani jak wygląda lista miesiąca przyszłego, skoro jej wystąpień
nie ma w bazie (`RecurringOccurrenceDto.id` był wymagany). 07 §6.3 (migawka kwoty)
i §6.4 („zmiana kwoty dotyczy wystąpień niezaksięgowanych") czytane dosłownie są sprzeczne
dla zaległego wystąpienia z poprzedniego miesiąca. Nie było opisane, co po wznowieniu
reguły z terminami z czasu wstrzymania.

### 1. Okno generowania: od pierwszego otwartego do bieżącego miesiąca

Każdy wyzwalacz (`GET /months/:key/summary` dla miesiąca nieprzyszłego,
`GET /recurring/occurrences`, `POST /recurring/generate`) generuje **całe okno**
`[początek okna księgowania, bieżący miesiąc]` — przy limicie 1 to dwa miesiące.

- Całe okno, a nie tylko oglądany miesiąc: niezapłacony czynsz z poprzedniego miesiąca ma
  trafić do „Do zrobienia" (07 §6.6), nawet jeśli nikt tamtego miesiąca nie otworzył.
- Miesiące zamknięte (07 §1.4) nie dostają wystąpień: reguła założona dziś od stycznia
  nie dopisuje zaległości do miesięcy, których nie da się już zmienić. Lista zamkniętego
  miesiąca pokazuje to, co w nim zapisano wcześniej.
- `POST /recurring/generate` dla miesiąca przyszłego albo zamkniętego → `422` (wywołujący
  ma wiedzieć, że nic nie powstało); odpowiedź `{ month, createdCount }`.
- `app_meta.last_recurring_generation` zapisywany tylko wtedy, gdy powstało choć jedno
  wystąpienie — żeby odczyt dashboardu nie był zapisem przy każdym odświeżeniu.

### 2. Miesiąc przyszły — podgląd z `id: null`

Lista miesiąca przyszłego jest wyliczana z aktywnych reguł, bez zapisu. Wystąpienia mają
`id: null` (kontrakt: `IdSchema.nullable()`), kwotę bieżącą reguły i status `planned`;
`meta.isPreview = true`. Takiego wystąpienia nie da się zaksięgować ani pominąć —
nie ma czego wskazać w adresie.

### 3. Reguła miesięczna ma w miesiącu najwyżej jedno wystąpienie

Dla `monthly`, `every_n_months`, `quarterly`, `yearly`: miesiąc, w którym reguła ma już
wystąpienie w **dowolnym** statusie, jest pomijany. Bez tego czynsz zapłacony 10. i reguła
przestawiona na 15. dawały drugi czynsz do zapłaty w tym samym miesiącu (07 §6.4 „usuwane
są wystąpienia `planned` od bieżącego miesiąca i generowane na nowo"). Reguły tygodniowe
mają wiele terminów — tam decyduje sam `(rule_id, due_on)`.

### 4. Skutki edycji (07 §6.4) — granicą jest bieżący miesiąc

| Zmiana | Skutek |
|---|---|
| kwota | czekające (`planned`) **od bieżącego miesiąca** dostają nową kwotę; zaległe z wcześniejszych zachowują migawkę (07 §6.3 — tamten czynsz był w tamtej wysokości) |
| terminarz (częstotliwość, odstęp, dzień, dzień tygodnia, miesiąc, kotwica, start, koniec) | czekające od bieżącego miesiąca **i** spoza nowego `[startMonth, endMonth]` usuwane, okno generowane na nowo |
| nazwa, kategoria, konta, plakietki | nic — wystąpienie ich nie przechowuje, bierze z reguły |

Zaksięgowane i pominięte zostają nietknięte. Wszystko w transakcji bazodanowej edycji.

### 5. Wznowienie: terminy z czasu wstrzymania zapisują się jako pominięte

Wznowienie reguły zapisuje brakujące terminy **wcześniejszych** miesięcy okna jako
`skipped` z `skipped_reason = 'Reguła była wstrzymana'`. Bez tego siłownia wstrzymana na
sierpień i wznowiona 5 września dostałaby przy najbliższym odczycie zaległą opłatę za
sierpień — okno generuje wszystkie swoje miesiące, a reguła nie pamięta, kiedy była
wstrzymana. Bieżący miesiąc generuje się zwyczajnie (`planned`).

### 6. Sumy listy

`plannedTotalMinor` — kwoty planowane poza pominiętymi; `postedTotalMinor` — kwoty
faktycznie zaksięgowane; `remainingTotalMinor` — kwoty planowane czekających. Sumy łączne
dodają kwoty bez znaku ze wszystkich rodzajów (jak w przykładzie 04 §9); znaczący podział
daje `byFlow`. `allocationEffects` wystąpienia — z klas **bieżących** kont reguły.

### Odłożone

- Auto-księgowanie (07 §6.2 krok 4), księgowanie, pomijanie, cofanie — `F4-3`.
- `categoryId` zaksięgowanego wystąpienia pochodzi z reguły, nie z transakcji —
  do rozważenia przy `F4-3`, gdy księgowanie pozwoli zmienić kategorię.

---

<a id="adr-046"></a>

## ADR-046 — Księgowanie wystąpień: przez serwis transakcji, auto-księgowanie bez powrotu cofniętych

**Data:** 2026-09-24 · **Zadanie:** `F4-3` · **Status:** przyjęte

**Kontekst.** 07 §6.5 opisuje, co transakcja dziedziczy z reguły, a §6.7 — że cofnięcie
zaksięgowania to usunięcie transakcji. Nie było opisane: czy pominięte można zaksięgować,
co z auto-księgowaniem, gdy ktoś je cofnął (reguła z `autoPost` i wystąpienie `planned` po
terminie to dokładnie warunek ponownego księgowania), kto jest autorem transakcji z
auto-księgowania (`transactions.created_by` jest `NOT NULL`) ani co z kwotą szacunkową.

### 1. Jedna droga tworzenia i jedna droga cofania

- Zaksięgowanie woła `createTransaction` z pochodzeniem `{ source: 'recurring',
  recurringOccurrenceId }` — te same niezmienniki, odwołania (archiwum → `422`) i okno
  księgowania co formularz. Opisem transakcji jest nazwa reguły.
- `unpost` woła `deleteTransaction`; to `deleteTransaction` cofa zaksięgowanie przez
  `recurring.external.ts`. Przywrócenie z kosza wiąże ponownie albo zrywa powiązanie
  (`recurring_occurrence_id → NULL`), gdy wystąpienie zaksięgowano w międzyczasie inaczej.
  Zmiana kwoty transakcji przechodzi na `posted_amount_minor`.
- Transakcja w koszu **zachowuje** `recurring_occurrence_id` — po nim przywrócenie wie,
  co związać.

### 2. Auto-księgowanie nie wraca po cofnięciu

Kandydat do auto-księgowania: `planned`, termin `≤ dziś`, miesiąc w oknie generowania,
reguła aktywna z `auto_post = 1` i `amount_is_estimate = 0`, **i żadna transakcja (także
z kosza) nie wskazuje wystąpienia**. Cofnięcie zostawia transakcję w koszu z powiązaniem,
więc cofnięte auto-zaksięgowanie zostaje do ręcznego zaksięgowania albo pominięcia —
bez zmiany schematu. Po wyczyszczeniu kosza (30 dni) powiązanie znika; do tego czasu
wystąpienie zwykle leży już w zamkniętym miesiącu, poza oknem.

- Kwota szacunkowa się nie księguje sama — 07 §6.5 wymaga potwierdzenia kwoty.
- Każde wystąpienie w osobnej transakcji bazodanowej; to, którego zaksięgować się nie da
  (konto z archiwum, reguła bez konta), zostaje `planned`, a odczyt działa dalej.
- Autorem transakcji jest osoba, której odczyt wyzwolił księgowanie (dashboard, lista
  wystąpień, `/generate`) — w gospodarstwie dwóch osób nie ma konta systemowego.
- Auto-księgowanie działa przy tych samych wyzwalaczach co generowanie, **przed** sumami
  dashboardu — liczby miesiąca od razu je obejmują.

### 3. Operacje

- `post` — `201 { data: { occurrence, transaction }, meta: { affectedMonths } }`; wymaga
  `Idempotency-Key` (zakres klucza zawiera identyfikator wystąpienia — ten sam klucz przy
  innym wystąpieniu to inna operacja); puste ciało = kwota planowana w dniu terminu, z konta
  reguły. Zaksięgowane → `409`. **Pominięte można zaksięgować** („jednak zapłaciłem") — to
  jedyna droga powrotu z pominięcia, bez osobnego `unskip`.
- `skip` — `200`, opcjonalny powód, idempotentne; zaksięgowane → `409` (najpierw cofnij).
- `unpost` — `200` z wystąpieniem i `affectedMonths`; niezaksięgowane bez zmian
  (idempotentne); zamknięty miesiąc → `422` (blokada usunięcia transakcji, 07 §1.4).

### Odłożone

- `categoryId` wystąpienia zaksięgowanego nadal pochodzi z reguły (ADR-045) — księgowanie
  nie pozwala zmienić kategorii, a zmiana w transakcji po zaksięgowaniu to rzadkość.

---

<a id="adr-047"></a>

## ADR-047 — Zobowiązania: stan w `shared`, rata przez wystąpienie reguły, zamknięcie wstrzymuje regułę

**Data:** 2026-09-24 · **Zadanie:** `F4-4` · **Status:** przyjęte

**Kontekst.** 07 §5.1 opisuje stan, 04 §8 trasy, 05 §8 kształt. Nie było opisane: które
transakcje są ratą, jak liczyć postęp przy korekcie do zera, od którego miesiąca startuje
reguła tworzona razem z zobowiązaniem, co robi `POST /:id/payments`, gdy ta sama rata czeka
już jako wystąpienie reguły, co z regułą po zamknięciu albo usunięciu zobowiązania i jak
zobowiązanie wchodzi do majątku netto za przeszłe miesiące.

### 1. Stan — czyste funkcje w `shared/domain/liability.ts`

`liabilityState`, `liabilitySchedule`, `nextInstallmentOn`, `installmentsFor`,
`firstInstallmentMonth` — API liczy z nich każdy odczyt, formularz `F4-6` pokaże to samo
przed zapisem.

- **Rata** = wydatek z `liability_id`, zaksięgowany, poza koszem, z `booked_on >
  balance_as_of`. Tylko wydatki — zaciągnięcie długu to przychód (07 §2.2a). Suma jednym
  zapytaniem z `liabilities` w złączeniu (`sumLiabilityPayments` w księdze transakcji).
- `progressBps`: spłacone (`remaining = 0`) to zawsze `10000` — także po korekcie do zera,
  gdzie podstawa jest zerowa i `toBps` dałby `0`.
- **Najbliższa rata**: rata bieżącego miesiąca, dopóki nie jest zaksięgowana (także po
  terminie — wtedy zaległa); po zaksięgowaniu — następnego miesiąca; nie wcześniej niż
  `firstPaymentOn`. Dzień przycinany jak w pozycjach cyklicznych. Dzień płatności nieznany
  (`paymentDay` i `firstPaymentOn` puste) → `nextDueOn` i prognoza `null`.
- DTO dostaje `nextDueOn`, `lastPaymentOn` (do „Zapłacono we wrześniu (10 wrz)", 06 §3.8),
  `firstPaymentOn`, `installmentsRemainingAtAsOf` i znaczniki czasu. Szczegóły —
  `payments`: do 24 ostatnich rat z listy transakcji.

### 2. Reguła na ratę tworzona razem z zobowiązaniem

`createRecurringRule: true` wymaga `paymentAccountId` i `paymentDay` (`422`). Reguła:
wydatek stały, miesięczny, z konta płatności, z kategorią i `liabilityId`.

- **Start** — miesiąc pierwszej raty **po** `balanceAsOf` (albo `firstPaymentOn`, jeśli
  późniejsza): kwota „na 23 września" obejmuje ratę z 20 września, więc reguła nie może
  wygenerować jej jako zaległej.
- **Koniec** — miesiąc ostatniej raty z prognozy. Reguła jest dalej osobnym bytem: zmiana raty
  w zobowiązaniu nie zmienia kwoty reguły (edytuje się ją na ekranie pozycji cyklicznych).

### 3. `POST /:id/payments` księguje czekające wystąpienie raty

Gdy reguła z `liabilityId` ma czekające wystąpienie w oknie generowania — księgowane jest
najwcześniejsze z nich (`postNextLiabilityOccurrence`), inaczej ta sama rata zostałaby
do zapłaty drugi raz w „Do zrobienia". Bez takiego wystąpienia powstaje wydatek
z `liabilityId`: rata z warunków, dziś, z konta płatności (brak konta → `422`). Wymaga
`Idempotency-Key` jak księgowanie wystąpienia (ADR-046). Zamknięte zobowiązanie → `409`.

### 4. Zamknięcie i usunięcie wstrzymują reguły raty

`PATCH { isActive: false }` i `DELETE` wstrzymują aktywne reguły z tym `liabilityId`
w tej samej transakcji bazodanowej — spłacony kredyt nie może dalej produkować rat do
zapłaty. Ponowne otwarcie ich nie wznawia (jak przywrócenie konta, ADR-044). Usunięcie:
raty zostają zwykłymi wydatkami (`SET NULL`), reguła traci `liabilityId`.

### 5. Majątek netto — na dzień sald

`liabilitiesRemainingMinor` (ADR-032) liczy aktywne zobowiązania z `balanceAsOf ≤ asOf`
i ratami do `asOf` włącznie. Kredyt wpisany we wrześniu nie zmienia majątku z sierpnia —
nie wiadomo, ile wtedy wynosił.

### 6. Pozostałe

- `rebase`: dzień wyciągu w przyszłości → `422`; `installmentsRemainingAtAsOf` czyszczone
  (dotyczyło starego punktu); notatka korekty dopisywana do notatek z datą wyciągu.
- `Z-13`: przepinanie zobowiązań przy scalaniu kategorii przeniesione do
  `liabilities.external.ts`. W repozytorium kategorii zostają planowane wydatki
  i pozycje dokumentów.
- `isLiabilityInHousehold` przeniesione do `liabilities.external.ts` — serwis zobowiązań woła
  serwisy transakcji i reguł, które sprawdzają to odwołanie (ADR-035).

---

<a id="adr-048"></a>

## ADR-048 — Ekran pozycji cyklicznych: sześć grup, miesięczne odpowiedniki, arkusz zamiast szczegółów

**Data:** 2026-09-25 · **Zadanie:** `F4-5` · **Status:** przyjęte

**Kontekst.** 06 §3.9 pokazuje cztery grupy (wydatki stałe, odkładanie, wpływy, wstrzymane)
i sumę „Miesięcznie", ale nie mówi, gdzie trafia wydatek, który nie jest stały, ani zwykły
przelew między kontami bieżącymi; nie mówi też, jak sumować reguły tygodniowe i roczne.
Trasa `/recurring/:id` istniała, choć ekranu szczegółów nie zaprojektowano.

**Decyzja.**

1. **Sześć grup** — dochodzą *Inne wydatki* i *Przelewy*; puste grupy są pomijane, więc
   gospodarstwo z samymi wydatkami stałymi widzi układ z makiety. *Odkładanie* = przelew na
   konto z pulą `savings`/`investment` albo z takim nadpisaniem alokacji (`none` wyklucza).
2. **Miesięczne odpowiedniki** w „Miesięcznie" i w sumach grup (tydzień × 52/12, dwa
   tygodnie × 26/12, kwartał / 3, rok / 12, co N / N), zaokrąglenie per reguła. To średnia
   do porównania z budżetem, nie plan konkretnego miesiąca — ten liczą wystąpienia
   (`F4-2`). Przy regułach innych niż miesięczne nagłówek mówi „(średnio)".
3. **Arkusz zamiast ekranu szczegółów.** Wszystko, co reguła ma do pokazania (terminarz,
   podgląd najbliższych terminów), mieści się w formularzu edycji. `/recurring/:id`
   przekierowuje na listę z otwartym arkuszem — osobny wpis historii ścigałby się z arkuszem,
   który sam obsługuje „wstecz".
4. **Przełącznik optymistyczny** — zmiana widoczna od razu, błąd przywraca stan; przy dwóch
   osobach konflikt jest rzadki, a czekanie przy każdym dotknięciu byłoby odczuwalne.
5. `TextField` dostaje `type="month"` (natywny wybór miesiąca) — okres reguły to miesiące,
   nie dni.

**Koszt.** Suma „Miesięcznie" przy regule rocznej nie jest kwotą żadnego konkretnego
miesiąca — dlatego podpis „(średnio)" i wyjaśnienie pod nim.

---

<a id="adr-049"></a>

## ADR-049 — Ekran zobowiązań: rata jednym dotknięciem z „Cofnij", szczegóły jako ekran

**Data:** 2026-09-25 · **Zadanie:** `F4-6` · **Status:** przyjęte

**Kontekst.** 06 §3.8 pokazuje kartę z „[Zaksięguj]" i formularz „dwa z trzech", ale nie mówi,
czy księgowanie raty otwiera formularz, jak wybrać pole wyliczane ani co pokazuje
`/liabilities/:id`.

**Decyzja.**

1. **„Zaksięguj" bez arkusza.** Rata z warunków zobowiązania, dziś, z konta płatności (albo
   czekające wystąpienie reguły raty — ADR-047). Pomyłkę naprawia „Cofnij" w toaście —
   usunięcie transakcji, ta sama droga co z historii (cofa też zaksięgowanie wystąpienia).
   Inna kwota albo data: edycja transakcji. Rata jest stała, więc arkusz przy każdej racie
   byłby formalnością. Nowy klucz idempotencji na każde dotknięcie; przed podwójnym
   dotknięciem chroni przycisk w stanie ładowania.
2. **Pole wyliczane = najdawniej dotknięte z trzech.** Domyślnie liczba rat (kwota i rata to
   to, co stoi w umowie). Wyliczenia: `installmentsFor` z `shared`, rata w górę w groszach,
   kwota jako `rata × liczba rat`.
3. **Szczegóły jako ekran**, jak konto (06 §3.7) — jest co pokazać: raty, harmonogram,
   korekta, zamknięcie. Harmonogram skrócony do sześciu rat z podsumowaniem reszty.
4. **Zapis transakcji unieważnia `qk.recurring()` i `qk.liabilities()`** — usunięcie
   i przywrócenie cofa albo odtwarza zaksięgowanie wystąpienia, a rata zmienia stan
   zobowiązania.
5. **`OptionGrid` z równymi kaflami** (`auto-rows-fr`) — uwaga właściciela przy podglądzie:
   kafle z etykietą w jednej linii były niższe od sąsiadów.

---

<a id="adr-050"></a>

## ADR-050 — „Do zrobienia" na dashboardzie: sekcje `recurring` i `liabilities`, jedna rata raz

**Data:** 2026-09-25 · **Zadanie:** `F4-7` · **Status:** przyjęte

**Kontekst.** 05 §13 opisuje kształt sekcji `recurring` i `liabilities`, 07 §6.6 — zaległe
z poprzednich miesięcy na dashboardzie bieżącego. Nie było opisane: co jest w `items`, skąd
biorą się zaległe, czy raty zobowiązań trafiają do „Do zrobienia" i jak nie pokazać raty
dwa razy.

**Decyzja.**

1. **`recurring.items` = do zrobienia**, nie wszystkie wystąpienia: czekające w oglądanym
   miesiącu, a w **bieżącym** także czekające z wcześniejszych miesięcy okna generowania
   (każde z własnym `monthKey`). Zamknięte miesiące nie wracają — tamtych liczb nie wolno
   zmieniać (07 §1.4). Sumy planu i wykonania — z `GET /recurring/occurrences` tego miesiąca.
2. **Sekcja liczona przed sumami** miesiąca: generowanie i auto-księgowanie (ADR-046)
   muszą wejść do liczb tego samego odczytu. `ensureRecurringOccurrences` znika — robi to
   `recurringSectionForMonth`.
3. **`liabilities`** — stan zobowiązań na dziś (ta sama liczba co na ekranie zobowiązań);
   z oglądanym miesiącem związane tylko `paidThisMonthMinor` i `unpaidCount`.
4. **Raty bez reguły w „Do zrobienia"** (bieżący miesiąc, niezapłacone, niespłacone). Raty
   z regułą są już wystąpieniami — druga pozycja dawałaby dwa przyciski do jednej raty.
5. **Kwota szacunkowa** — „Zaksięguj" otwiera arkusz z klawiaturą kwoty (07 §6.5); kwota
   pewna — jedno dotknięcie z „Cofnij" (`unpost`). **„Pomiń" bez „Cofnij"** — API nie ma
   cofnięcia pominięcia; pominięte można zaksięgować (ADR-046), ale ekran tego jeszcze nie
   oferuje (`Z-30`).
6. **Przyciski wiersza pod kolumną tekstu** (poprawka po przeglądzie na 390 px): dwie
   równe kolumny z wcięciem 44 px, przyciski `medium` z pełną wysokością 44 px i 12 px
   do linii podziału. Rozmiar `small` (ujemny margines) przy prawej krawędzi kleił
   przyciski do linii kolejnego wiersza. „Zaksięguj" zawsze w prawej kolumnie, także
   w wierszu raty bez „Pomiń". Podpis wiersza się zawija (`ListRow.wrapCaption`) —
   „kwota szacunkowa" na końcu była ucinana (15 §4.8).

---

<a id="adr-051"></a>

## ADR-051 — „Zapisz jako wydatek stały": reguła z transakcji, transakcja opłaca swój termin

**Data:** 2026-09-25 · **Zadanie:** `F4-8` · **Status:** przyjęte

**Kontekst.** 04 §7 zapowiadał `POST /transactions/:id/save-as-recurring` z przykładem
ciała, 06 §3.3 — pole wyboru w formularzu, które „rozwija pola cykliczności i po zapisie
tworzy regułę". Nie było opisane: co z samą transakcją (czynsz zapłacony dziś i zapisany
jako stały pokazałby się od razu w „Do zrobienia" jako zaległy), skąd nazwa, co z ratą
zobowiązania i z ponowieniem po zerwanym połączeniu.

**Decyzja.**

1. **Ciało to terminarz**, reszta z transakcji (`SaveAsRecurringRequestSchema`, 05 §11).
   Każde pole opcjonalne: `{}` = co miesiąc, dnia transakcji, od jej miesiąca. Nazwa —
   opis → zobowiązanie → sprzedawca → kategoria → źródło → „Wydatek stały". Reguła
   przechodzi te same sprawdzenia co `POST /recurring/rules` (wspólne `insertCheckedRule`).
2. **Transakcja opłaca termin swojego miesiąca** (07 §6.8): wystąpienie `posted` z nią
   powiązane, termin najbliższy jej dacie (`sourcePaymentDueOn` w `shared` — ten sam liczy
   podgląd w formularzu). Wcześniejsze terminy miesiąca — `skipped`. Miesiąc zamknięty —
   bez powiązania. Powiązanie przez `transactions.ledger.ts`
   (`linkTransactionToOccurrence`), więc dalej działa I-12: usunięcie transakcji cofa
   zaksięgowanie.
3. **Rata zobowiązania bez reguły** — reguła zostaje jego regułą raty
   (`liabilities.external.ts`, ADR-047); zobowiązanie z regułą → `409`, druga reguła
   dawałaby dwie raty co miesiąc. Transakcja w koszu albo już z pozycji cyklicznej → `409`.
4. **Trasa w module transakcji, logika w serwisie reguł** — ścieżka z 04 §7, a reguła
   powstaje tam, gdzie wszystkie inne. Opcjonalny `Idempotency-Key` z zakresem per
   transakcja.
5. **Formularz: dwa żądania, nie jedno.** Najpierw transakcja (jej klucz), potem reguła
   (osobny klucz). Błąd reguły nie cofa transakcji — toast mówi, czego nie zapisano,
   i arkusz się zamyka; ponowne „Zapisz" dopisałoby tylko powtórkę transakcji. Błędny
   terminarz blokuje zapis **przed** wysłaniem transakcji. Tylko nowa transakcja — przy
   edycji pola nie ma.
6. **Pola terminarza wspólne** (`features/recurring/components/schedule-fields.tsx`,
   `parseSchedule` w `recurring-form-state.ts`) — formularz reguły i transakcji wyglądają
   i sprawdzają terminarz tak samo.
7. **Toast liczy następny termin z podglądu**, nie z `RecurringRuleDto.nextDueOn` — ten
   liczy od dziś włącznie i pokazałby termin, który transakcja właśnie opłaciła (`Z-31`).

**Konsekwencje.** Nowa reguła z transakcji nie pokazuje „zaległego" bieżącego terminu.
Nie da się dziś zapisać jako stałej transakcji już istniejącej z poziomu historii —
endpoint to umie, interfejsu nie ma (`Z-32`).

---

<a id="adr-052"></a>

## ADR-052 — Cele: postęp netto, kierunek wpłaty z konta celu, osiągnięcie przy odczycie

**Data:** 2026-09-25 · **Zadanie:** `F5-1`, `F5-2` · **Status:** przyjęte

**Kontekst.** 07 §4 opisywał postęp jako „sumę wpłat oznaczonych celem" i prognozę
z tempa, ale nie mówił: co z **wypłatą** z celu (przelew z konta celu oznaczony celem),
jak liczyć wpłaty miesiąca w trybie salda konta, kiedy serwis ustawia `achieved` ani
jaki miesiąc jest „bieżący" dla prognozy przy `GET /goals?month=`. Kontrakt 05 §9 nie
miał też metadanych listy (06 §3.5 pokazuje „Zaplanowano · wpłacono"), historii w
szczegółach, ciała wpłaty ani kolejności.

**Decyzja.**

1. **Postęp netto** (jak ADR-011): przelew oznaczony celem to wpłata (`+`) albo wypłata
   (`−`). Kierunek (`goalTransferSign` w `shared/domain/goal.ts`): cel z **powiązanym
   kontem** — przelew na nie `+`, z niego `−`; inaczej z migawek klas: z konta klasy celu
   na konto innej klasy `−`, każdy inny `+` (przelew między dwoma kontami oszczędnościowymi
   to dla celu wpłata, choć dla rozkładu jest neutralny, I-7). Zebrana kwota nie schodzi
   poniżej zera; ponad kwotę docelową — `progressBps` > 10 000, `remainingMinor` 0.
2. **Tryb `account_balance`**: kwota = saldo konta **na dziś**, wpłaty miesiąca = ruch
   netto na koncie w miesiącu (też odsetki i wydatki z tego konta — konto jest celu).
   Konto usunięte (`SET NULL`) przełącza liczenie na wpłaty.
3. **Plan miesiąca** — `?month=` (domyślnie bieżący); **prognoza** zawsze od bieżącego
   miesiąca. Tempo: średnia z miesięcy z wpłatą ≠ 0 spośród sześciu do bieżącego
   włącznie; mniej niż dwa takie miesiące — plan bieżącego miesiąca. Prognoza dłuższa
   niż 1200 miesięcy → `null` (nie mieści się w `YYYY-MM`). Termin w bieżącym albo
   minionym miesiącu → cała reszta teraz. DTO dostało `paceMonthlyMinor`.
4. **Osiągnięcie** wykrywa odczyt (lista, szczegóły, dashboard): aktywny cel z
   `remaining = 0` → `achieved` + `achievedAt`, warunkowo na `status = 'active'`.
   Podniesienie kwoty tego nie cofa (07 §4.3 — decyduje użytkownik); `PATCH status:
   'active'` czyści `achievedAt`. `achieved` nie da się ustawić `PATCH`-em — służy do
   tego `POST /:id/complete` (idempotentne, zachowuje datę).
5. **Zapis jednej strony przelicznika** (07 §3): `normalizeGoalPlan` czyści pole niezgodne
   z trybem przy tworzeniu i edycji. I-14 (`goalIssues`, wspólne dla formularza
   i serwisu, `422`) dokłada: procent > 0 i ≤ 100% wpływów; `account_balance` wymaga
   konta. `purpose` to enum z `CHECK` tabeli, nie dowolny tekst.
6. **Kontrakt uzupełniony**: `GoalsListMetaSchema` (`month`, `incomeBaseMinor`,
   `isPartialMonth`, `plannedTotalMinor`, `contributedTotalMinor` — cele aktywne),
   `GoalDetailDto` (`contributions` — 24 ostatnie przelewy, `history` — sześć miesięcy
   tempa), `GoalContributionRequest` (`fromAccountId`, `toAccountId` domyślnie konto celu,
   wymagany `Idempotency-Key`, `409` dla celu w archiwum), `ReorderGoalsRequest`
   (permutacja wszystkich celów, inaczej `422`), `GoalDto` z zapisaną stroną przelicznika
   i `achievedAt`/`createdAt`/`updatedAt`. Archiwum poza listą bez `includeArchived=true`.
7. **Przelicznik** `POST /goals/convert`: podstawa jak 07 §2.3; `isPartialMonth` =
   `basedOnIncomeSoFar` = miesiąc bieżący albo przyszły; procent przycinany do 1000%.
8. **Odwołanie do celu z transakcji** przeniesione do `goals.external.ts` — serwis celów
   woła serwis transakcji, więc przez serwis byłby cykl (jak ADR-047).

**Konsekwencje.** Wpłaty na cel są zwykłymi przelewami — liczą się też do rozkładu
(07 §4.1: dwie perspektywy tych samych pieniędzy). Odczyt listy celów może zapisać
(`achieved`), jak odczyt dashboardu generuje wystąpienia.

---

<a id="adr-053"></a>

## ADR-053 — Rozkład docelowy: wersja poprawiana w miejscu, zamknięte miesiące, linia długu

**Data:** 2026-09-25 · **Zadanie:** `F5-3`, `F5-4` · **Status:** przyjęte

**Kontekst.** 04 §11 opisywał trasy i przykład statusu, ale nie: co robi ponowny `PUT`
tego samego miesiąca, czy wolno ustawić rozkład wstecz, kiedy pokazywać linię spłaty
długu, jak wygląda trend ani skąd moduł rozkładu ma sumy miesiąca (liczył je dotąd
wyłącznie `months.repository` — wyjątek z 02 §3, zarezerwowany dla modułu `months`).

**Decyzja.**

1. **`PUT` tego samego miesiąca poprawia wersję** (unikalny indeks), inny miesiąc — nowa
   wersja. Wersja obowiązuje do następnej.
2. **Miesiąc zamknięty (07 §1.4) → `422`**: plan zamkniętego miesiąca jest zamrożony jak
   jego liczby; wyjście to samo — podnieść limit księgowania wstecz. Udział jednej puli
   ≤ 100% (`400`), suma może więcej — `meta.warning: 'ALLOCATION_EXCEEDS_INCOME'`.
3. **Linie**: `savings` i `investment` zawsze (bez rozkładu — cel 0%, `met`);
   `debt_repayment` tylko przy `debtPercentBps > 0` — bez planu rata nie ma z czym się
   porównać, a w sumach zawyżałaby „odłożone". `isPartialMonth` = miesiąc trwa **albo**
   podstawa zerowa (07 §2.7). Upływ miesiąca (`monthTiming`) przeniesiony do
   `shared/utils/month.ts` — potrzebują go `months` i `allocation`. `fulfillmentBps` przy
   zerowym planie = 0 (`toBps`), status i tak `met`/`behind`.
4. **Status** dostał `effectiveFromMonth` (ekran: „obowiązują od: wrzesień").
   `GET /allocation/target` zwraca `data: null`, gdy rozkładu brak.
5. **Trend** = lista `AllocationStatusDto` rosnąco, każdy miesiąc z wersją, która **wtedy**
   obowiązywała. Domyślnie sześć miesięcy do bieżącego; sam `from`/`to` — sześć od/do;
   najwyżej 24 (`400`).
6. **Sumy z księgi**: `transactions.ledger.allocationSumsByMonth` (jedno zapytanie
   grupowane po miesiącu). Wyrażenia SQL efektu netto, spłaty i podstawy wydzielone do
   `db/sql/allocation-effect.ts` — używa ich też `months.repository`, więc dashboard,
   ekran rozkładu i trend nie mogą się rozjechać (test zgodności z `allocationEffects`
   z `F3-1` pilnuje wspólnego wyrażenia).

**Konsekwencje.** Pierwszego rozkładu nie da się ustawić na miesiąc sprzed okna — przy
limicie 1 najwcześniej na poprzedni miesiąc. Zmiana `backPostingLimitMonths` otwiera go.

---

<a id="adr-054"></a>

## ADR-054 — Ekrany Fazy 5: pierścień realizacji, „Uzupełnij" z kontem puli, „Na cel" w przelewie

**Data:** 2026-09-25 · **Zadanie:** `F5-5`…`F5-9` · **Status:** przyjęte

**Kontekst.** 06 §3.1, §3.5 i §3.6 szkicowały kafel „Cele procentowe", ekran celów
z przelicznikiem i ekran rozkładu. Nie rozstrzygały: co jest liczbą w środku pierścienia
(szkic: wykonanie jako % wpływów, `○ 20%` pod spodem), dokąd idzie przelew
„Uzupełnij", jak wybrać cel wpłaty w formularzu przelewu (`Z-23`), jak rysować trend
przed wykresami z `F8-5` i co z przyciskiem „Wpłać".

**Decyzja.**

1. **Pierścień = realizacja planu** (`fulfillmentBps`): wypełnienie i liczba mówią to samo
   — „85%" planu. Udział we wpływach („17,0% z 20,0% wpływów") jest linią pod
   pierścieniem, kwoty — `2 000 / 2 360 zł`. Znacznik `○`/`●` — plan wykonany (`met`,
   `ahead`). Ujemne wykonanie rysuje `ProgressRing` z `F1-0` (ślad kropek). Bez rozkładu
   kafel pokazuje zachętę z „ustaw", bez pierścieni.
2. **„Uzupełnij" / „Przelej teraz"** otwiera arkusz przelewu z wartościami z góry
   (`openNew('transfer', preset)`, `TransactionPreset`): cały `shortfallMinor` i konto
   docelowe — pierwsze aktywne konto klasy puli z największym niedoborem
   (`topUpPreset`). Domknięcie planu to otwarcie i „Zapisz". Tylko w bieżącym miesiącu;
   w przyszłym niedobór bez przycisku.
3. **„Na cel" w przelewie** (`Z-23`): pole `goalId` w formularzu, wybór spośród celów
   aktywnych i wstrzymanych; cel z kontem podpowiada konto docelowe, gdy nie jest wybrane.
   Zmiana typu czyści cel.
4. **„Wpłać" na karcie celu** — osobny arkusz z `POST /goals/:id/contributions`: kwota
   z klawiatury (domyślnie brakująca część planu miesiąca), konto z (na wydatki) i na
   (konto celu); jeden `Idempotency-Key` na otwarcie.
5. **Formularz celu**: przelicznik tuż pod kwotą docelową — oba pola edytowalne, wynik
   z `POST /goals/convert` po 300 ms (`useDebouncedValue`), szybkie procenty, przełącznik
   „Co zapisać" (stała kwota / procent / bez planu). Zapis bierze to, co widać
   (`settleConverter`). `/goals/:id` otwiera arkusz edycji (jak `/recurring/:id`).
6. **Ekran rozkładu**: suwaki natywne (`input type=range`, krok 0,5%, cel 44 px,
   `aria-valuetext`), kwoty z bieżących wpływów, „Na życie zostaje" (ujemne — ostrzeżenie),
   „Obowiązuje od" bieżący albo następny miesiąc. **Trend jako lista** miesięcy z paskiem
   realizacji i „X% z Y%" („bez planu" bez rozkładu) — wykres liniowy w `F8-5`.
7. **Dashboard**: po sekcji miesiąca — „Cele procentowe", „Cele" (do trzech aktywnych,
   etykieta „wpłacono we wrześniu" / „brak wpłaty"), dalej „Do zrobienia". Zapis
   transakcji unieważnia też `qk.goals()` i `qk.allocationAll()`.
8. Fraza „we wrześniu" z jednej tabeli (`lib/format.ts`, `inMonth`) dla zobowiązań, celów
   i porównania miesięcy — przy okazji poprawione „w wrześniu" w etykiecie porównania.

**Konsekwencje.** Szczegóły celu z historią wpłat (`GET /goals/:id`) nie mają jeszcze
własnego ekranu, kolejność celów (`PATCH /goals/order`) — interfejsu; FAB na `/goals`
nadal otwiera zwykły formularz transakcji (`Z-33`…`Z-35`).

---

<a id="adr-055"></a>

## ADR-055 — Planowane wydatki: status z pieniędzy i kalendarza, prognoza bez zapisu, niepokryta część

**Data:** 2026-09-25 · **Zadanie:** `F6-1`…`F6-5` · **Status:** przyjęte

**Kontekst.** 07 §6.5 opisywał rachunek odkładania, przejścia statusów, powtarzanie co rok
i ostrzeżenia, a 04 §9a trasy. Nie rozstrzygały: kiedy status zmienia się „sam", co znaczy
`deferred`, jak liczyć „oczekiwane na teraz", z czego prognoza bierze przepływy
cykliczne (i czy wolno jej generować wystąpienia), czy prognoza odejmuje pełny szacunek
czy tylko niepokrytą część, jakie są wartości domyślne `set-aside` i `post`.

**Decyzja.**

1. **Status `planned` / `funding` / `ready` wynika ze stanu** (`derivedPlannedStatus`):
   `ready` — pokrycie ≥ 100% albo nadszedł miesiąc terminu; `funding` — cokolwiek zebrano
   (także kwota początkowa); inaczej `planned`. Odczyt zapisuje zmieniony status (filtry
   i dashboard widzą to samo co DTO). `posted` i `cancelled` są końcowe. **`deferred` jest
   przejściowy**: `POST /defer` wymaga nowego terminu (≥ bieżący miesiąc), więc wydatek od
   razu wraca do statusu ze stanu; wartość zostaje w enumie.
2. **Rachunek** (`shared/domain/planned-expense.ts`): miesiące do terminu z bieżącym,
   minimum 1 (zaległy — cała reszta teraz); oczekiwane na dziś =
   `⌊szacunek × pełne miesiące od startu / wszystkie miesiące⌋` — bieżący się nie liczy;
   bez włączonego odkładania wydatek jest „w tempie". Start odkładania domyślnie bieżący
   miesiąc (dla terminu minionego — termin); przesunięcie terminu przed start przesuwa start.
3. **Wpłata na odkładanie** (`POST /:id/set-aside`, wymagany `Idempotency-Key`): przelew
   `source = 'planned'` z `plannedExpenseId`, kwota domyślnie rata, konto źródłowe domyślnie
   konto płatności, docelowe — konto odkładania albo konto celu (wtedy też `goalId`, 07 §6.5).
   Pokryte w całości → `422`.
4. **Zapłata** (`POST /:id/post`, wymagany `Idempotency-Key`, każde pole opcjonalne):
   wydatek z kwotą szacunku, dziś, z konta, kategorii i zobowiązania wydatku. Instancja na
   kolejny rok — kwota zapłacona, termin +12 miesięcy (29.02 → 28.02), start odkładania
   w miesiącu po zapłacie, **tylko gdy nie ma jeszcze instancji** z `previous_instance_id`.
   Usunięcie, przywrócenie i zmiana kwoty zapłaty działają jak przy wystąpieniu (07 §6.7,
   I-18) przez `planned-expenses.external.ts`.
5. **Prognoza płynności bez zapisu**: przepływ cykliczny miesiąca z `pendingRecurringNet`
   (`recurring.external.ts`) — wystąpienia `planned` plus terminy reguł jeszcze
   niewygenerowane; przelewy pominięte. Podgląd przyszłego miesiąca na dashboardzie nie
   może generować wystąpień (07 §6.2). Z salda kont wydatkowych odejmowana jest
   **niepokryta część** wydatku — odłożone pieniądze czekają na koncie odkładania.
   Zaległy wydatek obciąża bieżący miesiąc. `UNFUNDED_MUST_EXPENSE` i `SET_ASIDE_BEHIND` —
   gdy do terminu ≤ 3 miesiące (`monthsUntilDue`), z wydatkiem w `plannedExpenseId`
   i komunikatem po polsku.
6. **Kontrakt uzupełniony**: `SetAsideDto` ze `startMonth` i `monthsLeft`,
   `PlannedExpenseDto` z `alreadySetAsideMinor`, `previousInstanceId`, `postedAt`,
   znacznikami; `PlannedExpenseDetailDto.setAsideHistory`; `UpcomingExpensesMeta` z
   `setAsidePaidThisMonthMinor`; `LiquidityWarningDto.plannedExpenseId`;
   `TransactionDto.plannedExpenseId` i filtr `?plannedExpenseId=` listy transakcji;
   sekcja `MonthSummaryDto.plannedExpenses` (horyzont 6 miesięcy od dziś, `readyToPay` —
   tylko w bieżącym miesiącu).
7. **`Z-13`**: przepinanie planowanych wydatków przy scalaniu kategorii w ich module.

**Konsekwencje.** Prognoza jest ostrożna, nie dokładna (nie zna wydatków nieregularnych
ani przelewów cyklicznych). Dashboard miesiąca czyta planowane wydatki trzykrotnie
(sekcja, horyzont, suma miesiąca) — przy dziesiątkach wierszy bez znaczenia.

---

<a id="adr-056"></a>

## ADR-056 — Ekrany Fazy 6: rata na żywo w przeglądarce, „Zapłacone" zawsze z arkuszem, rata łączna bez horyzontu

**Data:** 2026-09-25 · **Zadanie:** `F6-6`…`F6-9` · **Status:** przyjęte

**Kontekst.** 06 §3.10 rysuje ekran, formularz, sekcję „Nadchodzące" i podpowiedź przy
rocznej regule. Nie rozstrzyga: skąd formularz bierze ratę przed zapisem, co liczy
„Odkładaj miesięcznie" przy wydatkach za horyzontem, jak wybrać miejsce odkładania (konto
czy cel), jak zapłacić z dashboardu i co przenosi „Utwórz tam zamiast tego".

**Decyzja.**

1. **Rata na żywo w przeglądarce** — `setAsidePreview` woła `monthlySetAsideMinor`
   i `monthsLeftUntil` z `shared` (te same co serwer), bez żądania. Przy edycji liczą się
   wpłaty zrobione w aplikacji (`accumulated − alreadySetAside`). Bez odkładania formularz
   podpowiada „Odkładając, wystarczy X co miesiąc".
2. **Rata łączna i „odłożone w tym miesiącu" liczą każdy aktywny wydatek** z odkładaniem,
   także za horyzontem (wakacje za 10 miesięcy też wymagają raty teraz); horyzont zawęża
   tylko sumę, obciążenie miesięcy i ostrzeżenia. Skrót „Nadchodzące" na dashboardzie
   (`items`, do trzech) też sięga za horyzont — sekcja znika tylko bez żadnego wydatku.
3. **Miejsce odkładania**: pole „Gdzie" (konto) i „Na cel" (opcjonalnie); cel z kontem
   wypełnia konto, jeśli puste. I-17 pokazywany przy polu konta.
4. **„Odłóż teraz"** — arkusz z kwotą (rata albo zaległość z ostrzeżenia „Odłóż
   zaległe"), źródłem do zmiany i kontem docelowym tylko do odczytu; klucz idempotencji
   na otwarcie. Na karcie tylko przy włączonym odkładaniu, reszcie > 0 i braku wpłaty
   w miesiącu; potem „✓ Wpłata za wrzesień". Na dashboardzie tylko w miesiącu bieżącym.
5. **„Zapłacone" zawsze otwiera arkusz** z szacunkiem do skorygowania — w „Do zrobienia"
   (wiersz „planowany wydatek", `readyToPay`) i na karcie w miesiącu terminu. Kwota
   zapłacona staje się szacunkiem na kolejny rok, więc arkusz to mówi.
6. **Ostrzeżenia z akcją**: `SET_ASIDE_BEHIND` → „Odłóż zaległe" z kwotą luki,
   `UNFUNDED_MUST_EXPENSE` → „Włącz odkładanie" (formularz), brak salda — bez przycisku.
7. **„Utwórz tam zamiast tego"** (`F6-9`) — tylko przy **nowej** regule wydatku rocznej;
   przenosi nazwę, kwotę, kategorię i najbliższy miesiąc roku (`nextMonthOfYear`) w stanie
   nawigacji do `/planned`, który otwiera formularz z tymi wartościami.
8. `SwitchRow` z formularza reguły eksportowany i używany w formularzu wydatku; „Już mam"
   jako pole tekstowe (jedna klawiatura kwoty na arkusz). Klucze `qk.plannedExpenseList()`,
   `qk.plannedUpcoming(n)`; zapisy wydatku unieważniają `qk.months()` (prognoza liczy się
   od dziś, więc dotyka każdego oglądanego miesiąca), zapis transakcji — `qk.plannedExpenses()`.

**Konsekwencje.** Brak ekranu szczegółów z historią odkładania (`GET /:id` gotowe) —
`Z-36`. Przesunięcie terminu idzie przez edycję miesiąca; `POST /:id/defer` bez przycisku
— `Z-37`.


---

<a id="adr-057"></a>

## ADR-057 — `.env` w korzeniu, szukany w górę; punkt wejścia przez `pathToFileURL`; Node ≥ 22.12

**Data:** 2026-09-25 · **Zadanie:** poprawki po teście na Windowsie (przed `F7-1`) · **Status:** przyjęte

**Kontekst.** Uruchomienie na Windowsie (2026-09-25) pokazało cztery problemy:

1. Skrypty `migrate`, `seed`, `create-user` rozpoznawały uruchomienie porównaniem
   `import.meta.url` z `` `file://${argv[1]}` ``. Na Windowsie (`C:\…`) i przy spacji
   w ścieżce warunek jest fałszywy — skrypt kończy się **cicho z kodem 0**. W kontenerze
   działało przypadkiem (`/app/dist/…` bez znaków do zakodowania), ale cicha nieudana
   migracja wpuściłaby aplikację do niezmigrowanej bazy mimo `set -e` w `entrypoint.sh`.
2. `.env` czytało tylko `index.ts` (`dotenv/config`), i to z bieżącego katalogu —
   pod `pnpm --filter` jest nim `apps/api`. README i `docker compose` (`env_file: .env`)
   zakładają `.env` w korzeniu, więc w trybie deweloperskim nie wczytywało się nic.
3. `engines.node >=22` przepuszczało 22.11, na którym rolldown (Vite) nie ma natywnego
   wiązania, a prekompilowany `better-sqlite3` 13 się wywraca.
4. `.env.example` miało `AI_ENABLED=true` bez klucza — z takim plikiem API nie wstaje.

**Decyzja.**

1. `core/entry-point.ts` — `isEntryPoint(import.meta.url)`: porównanie z
   `pathToFileURL(argv[1])`, a w drugiej kolejności z `pathToFileURL(realpath(argv[1]))`
   (loader ESM rozwiązuje dowiązania symboliczne).
2. **Kanoniczne miejsce `.env` to korzeń repozytorium** (tam, gdzie czyta go compose).
   `core/env-file.ts` — `loadEnvFile()` szuka `.env` od bieżącego katalogu w górę do
   katalogu z `pnpm-workspace.yaml` włącznie; bliższy plik wygrywa. Wołane w `main()`
   API i trzech skryptów (nie przy imporcie — testy nie dostają zmiennych z pliku).
   Zmienne ze środowiska mają pierwszeństwo, więc w kontenerze (gdzie `.env` nie ma)
   nic się nie zmienia.
3. `engines.node >=22.12.0` i `.npmrc` z `engine-strict=true` — za stary Node zatrzymuje
   `pnpm install` czytelnym błędem zamiast cicho pominąć natywne wiązanie. Obraz
   (`node:22-bookworm-slim`) i tak bierze najnowsze 22.x.
4. `.env.example`: `AI_ENABLED=false` z komentarzem; 10 §3 każe na produkcji ustawić
   `AI_ENABLED=true` razem z kluczem.

**Konsekwencje.** Wpływ na produkcję: tylko pozytywny (odporniejszy punkt wejścia
migracji); konfiguracja w kontenerze nadal wyłącznie z `docker compose`. Osoba, która
postawi VPS z `.env.example` i zapomni o fladze, dostanie aplikację bez zakładki *Skan*
zamiast kontenera w pętli restartów — to świadomy wybór łagodniejszej awarii.

---

<a id="adr-058"></a>

## ADR-058 — FAB także na desktopie, bez przycisku „Dodaj" w nagłówku

**Data:** 2026-09-25 · **Zadanie:** poprawka zgłoszona przez właściciela · **Status:** przyjęte

**Kontekst.** 06 §2 zamieniało FAB od 768 px w przycisk „Dodaj" w nagłówku powłoki.
Ekrany mają własny przycisk „+" w nagłówku (np. „Nowy cel" na `/goals`), więc na
desktopie stały dwa plusy jeden nad drugim — „Dodaj" otwierał formularz transakcji,
„+" formularz celu. Właściciel uznał to za mylące.

**Decyzja.** FAB jest na każdej szerokości. Na telefonie bez zmian (nad paskiem zakładek);
od 768 px `bottom-6 right-6`, a treść ma `md:pb-28`, żeby ostatni wiersz nie znikał pod
przyciskiem. Przycisk „Dodaj" w nagłówku usunięty. Menu szybkich akcji otwiera też
prawy przycisk myszy (przytrzymanie myszą to gest nieoczywisty).

**Konsekwencje.** Uzasadnienie z 06 §2 („pływający przycisk na desktopie zasłaniałby
treść") zostaje częściowo prawdziwe — łagodzi je zapas pod treścią. Akcja globalna
(transakcja) i akcje ekranu („+" w nagłówku) są teraz w różnych miejscach.

---

<a id="adr-059"></a>

## ADR-059 — Pipeline OCR: structured outputs zamiast narzędzia, PDF natywnie, konto dokumentu, koszt z konfiguracji

**Data:** 2026-09-25 · **Zadanie:** `F7-1`…`F7-7`, `F7-11` · **Status:** przyjęte

**Kontekst.** 08 opisuje wywołanie modelu z `tool_choice` wymuszającym narzędzie
i `temperature: 0`, render PDF-u do obrazów i konwersję HEIC na serwerze. Przy
implementacji: `claude-sonnet-5` (domyślny `AI_MODEL`) odrzuca parametry próbkowania
(`400`), a nowsze modele (Opus 5.5, Fable 5.1) odrzucają wymuszony `tool_choice`;
prekompilowany `sharp` nie ma dekodera HEVC ani PDF-u. Kontrakt (05 §12
`suggestedAccountId`, 04 §13 `PATCH` „konto") zakładał konto dokumentu, którego
`documents` nie miało gdzie trzymać.

**Decyzja.**

1. **Structured outputs** (`output_config.format: json_schema`) zamiast narzędzia —
   gwarancja zgodności ze schematem bez `tool_choice`, na każdym modelu z `AI_MODEL`.
   Pola i opisy jak w 08 §5–§6; schemat spełnia ograniczenia structured outputs
   (wszystkie pola wymagane, brak wartości = `null`, bez `minimum`/`maximum`).
   `categoryId` to **enum identyfikatorów z kontekstu** — model nie może zwrócić
   kategorii spoza listy. Odpowiedź i tak przechodzi walidację Zod (zakres pewności,
   daty z kalendarza, kategoria z listy); błąd → `AI_SCHEMA_MISMATCH`, bez ponowienia.
2. **Bez `temperature`**; `AI_MAX_OUTPUT_TOKENS` domyślnie **16 000** (myślenie
   adaptacyjne liczy się do limitu; 4096 ucinało długie wyciągi → `AI_OUTPUT_TRUNCATED`);
   timeout 120 s; ponowienia robi SDK (2 × przy 408/409/429/5xx). Odmowa →
   `AI_REFUSED`, awaria usługi → `AI_UNAVAILABLE` (kody w `documents.error_code`).
3. Pozycja paragonu ma **`direction`** — reguła 6 promptu (rabaty i kaucje z kierunkiem)
   nie miała pola w schemacie z 08 §5. Kwota ujemna od modelu = odwrócony kierunek,
   zerowa znika.
4. **PDF idzie natywnie** jako blok `document` (bez renderowania stron). Liczba stron
   z `/Count` drzewa stron albo obiektów `/Type /Page`; PDF ze skompresowanym drzewem
   (liczba nieznana) przechodzi — usługa ma własny limit. Zapisywany bez zmian,
   serwowany jako `attachment`.
5. **HEIC** zamienia na JPEG przeglądarka przy skalowaniu (`F7-9`, Safari dekoduje
   HEIC); nieczytelny obraz na serwerze → `415` z podpowiedzią o formacie „Najbardziej
   zgodny". Zdjęcia zapisywane zawsze jako JPEG bez metadanych + miniatura 320 px.
6. **`documents.account_id`** (migracja `0003`, `ON DELETE SET NULL`) — konto
   z wrzucenia albo korekty nagłówka; commit ustawia je na konto zapisu.
7. **Stawki kosztu w konfiguracji**: `AI_INPUT_COST_MINOR_PER_MTOK` (800),
   `AI_OUTPUT_COST_MINOR_PER_MTOK` (4000) — grosze za milion tokenów, zaokrąglenie w górę.
   Koszt nieudanego odczytu (gdy usługa odpowiedziała) też liczy się do limitu.
   Wyczerpany limit przy wrzuceniu: plik zostaje (`failed`, `AI_BUDGET_EXCEEDED`),
   odpowiedź `402` z `details: [{ path: 'documentId' }]`.
8. **Duplikaty tylko dla wyciągów** (08 §10 mówi o wyciągach; na paragonie pozycja
   za 4,99 zł „dublowałaby" dowolną kawę). Jedna transakcja = jeden duplikat.
9. Commit: `single` zapisuje **sumę netto zaznaczonych** (obciążenia − rabaty; ≤ 0 →
   `422`), kategoria całości może być nową z `createCategories` (`categoryName`);
   `split` — uznanie to przychód, a kategoria innego rodzaju niż kierunek przepada
   (bez kategorii zamiast łamania I-4). Z `F7-6` powstał `POST /transactions/bulk`
   (wszystkie albo żadna, ścieżki błędów `transactions.<i>.<pole>`).
10. `GET /documents?month=` filtruje po **miesiącu dokumentu** (`detected_month_key`
    z daty odczytu albo `monthHint`), nie po dniu wrzucenia. Nagłówek wyciągu:
    `bookedOn` = koniec okresu.
11. Przerwane analizy (`processing` > 10 min) oznacza start aplikacji (`INTERRUPTED`);
    zamknięcie serwera czeka na rozpoczęte analizy.
12. Limity z 04 §17 liczone w `preHandler` po gospodarstwie z tokenu (20/h wrzuceń,
    5/h analiz na dokument).
13. `Z-13` zamknięte: przepinanie `document_items` przy scalaniu kategorii w module
    `documents` (`documents.external.ts`), zakresem gospodarstwa przez dokument.
14. `F7-11`: skrypt `pnpm --filter @fineapp/api ocr:evaluate [katalog]` liczy cztery
    wskaźniki z 08 §15 na parach `zdjęcie + .expected.json`; zbiór w
    `apps/api/test/fixtures/receipts/` (`.gitignore`).

**Konsekwencje.** Brak zależności od biblioteki PDF i dekodera HEVC w obrazie. Koszt
wyciągu PDF jest wyższy niż obrazu (model czyta stronę jako obraz i tekst) — przy
kilku wyciągach miesięcznie bez znaczenia. Pomiar jakości na 20 paragonach wymaga
zbioru właściciela (`Z-5`) i klucza API — do wykonania ręcznie.

---

<a id="adr-060"></a>

## ADR-060 — Ekrany skanu: przegląd pełnoekranowy, zaznaczenie po stronie klienta, obrazy przez blob

**Data:** 2026-09-25 · **Zadanie:** `F7-8`…`F7-10` · **Status:** przyjęte

**Decyzja.**

1. `/scan` — stan A (aparat, plik, rodzaj, „Ostatnie" odpytywane, gdy coś się
   analizuje); `/scan/:id` — stany B i C oraz nieudany odczyt, zero pozycji, zapisany,
   odrzucony. Po wrzuceniu przejście na `/scan/:id` (odpytywanie co 1,5 s).
2. **Zaznaczenie pozycji żyje w przeglądarce** i idzie w commicie (`itemIds`); korekty
   treści (opis, kwota, kategoria, nagłówek) idą od razu `PATCH`-em. Klucz idempotencji
   commitu — jeden na otwarcie przeglądu.
3. Tryb domyślny: paragon i faktura — „Jedna transakcja" z kategorią najczęstszą wśród
   zaznaczonych; wyciąg — tylko po operacji (bez przełącznika). Propozycja nowej
   kategorii („Dodaj", „Wybierz inną") działa w trybie podziału — w trybie jednej
   transakcji kategorie pozycji nie trafiają do księgi.
4. **Linia kategorii pozycji jest celem dotyku** korekty (arkusz: opis, kwota,
   kategoria) — bez osobnego „popraw" w każdym wierszu (makieta go nie ma).
5. Zdjęcia pobierane `fetch`-em z tokenem i pokazywane przez `blob:` (`<img src>` nie
   niesie `Authorization`); PDF — kafel „PDF · stron: N".
6. Konto domyślne: z dokumentu, a bez niego — jedyne konto klasy „na życie".
7. `AI_ENABLED=false` (flaga w `GET /settings/ai-usage`) chowa zakładkę *Skan*
   i „Paragon" w menu FAB; wejście na `/scan` pokazuje stan „wyłączony".
8. FAB na `/scan` zostaje globalny (transakcja) — 06 §2 zapowiadało aparat, ale kafel
   „Zrób zdjęcie" jest na tym ekranie największym elementem.

**Konsekwencje.** Odświeżenie przeglądu gubi zaznaczenie (wraca domyślne) — korekty
treści zostają. Linia pod pozycją otwiera korektę także w trybie jednej transakcji.

---

<a id="adr-061"></a>

## ADR-061 — Ustawienia i eksport: zapis przez moduł `auth`, eksport z własnym repozytorium wielotabelowym

**Data:** 2026-09-26 · **Zadanie:** `F8-1`, `F8-2` · **Status:** przyjęte

**Decyzja.**

1. **Tabele `households` i `users` zostają w module `auth`.** `PATCH /settings/household`
   i `PATCH /settings/profile` wołają nowe funkcje serwisu `auth`
   (`updateHouseholdSettings`, `updateProfile`, `listMembers`, `listExportUsers`);
   moduł `settings` tylko składa odpowiedź (02 §3, reguła 4).
2. **`GET /settings`** oddaje `SettingsDto` = gospodarstwo + aktywni domownicy (zalogowany
   pierwszy, `isCurrent`) + `appVersion` — zamyka `Z-15` (lista osób do pola „Czyje").
3. **Kontrakt zmian gospodarstwa:** nazwa, strefa IANA (sprawdzana konstruktorem
   `Intl.DateTimeFormat`, nie listą — aliasy różnią się między Node a przeglądarką),
   limit wstecz 0–12; `monthStartDay` przyjmuje wyłącznie `1` (ADR-006); waluta i język
   tylko do odczytu (ADR-007). Profil: nazwa i kolor awatara (`null` = domyślny).
4. **Eksport JSON to drugi świadomy wyjątek od reguły 4** (po `months`):
   `settings.export.repository.ts` czyta wprost dwanaście tabel gospodarstwa. Złożenie
   eksportu z serwisów dałoby DTO z polami wyliczanymi zamiast zapisanych, a kopia ma
   oddawać **to, co jest w bazie**, żeby dało się ją kiedyś wczytać. Wiersze przechodzą
   w całości (`camelCase` z Drizzle); użytkownicy — pole po polu przez mapper `auth`.
   Nie ma w nim: sesji, prób logowania, kluczy idempotencji, `app_meta`, hashy PIN-ów,
   transakcji z kosza ani plików zdjęć. Format `fineapp-export` w wersji `1`.
5. **Eksporty bez koperty `{ data }`**, z `Content-Disposition: attachment` i
   `Cache-Control: no-store` — to pliki, a nie odpowiedzi API.
6. **CSV dla polskiego Excela:** BOM UTF-8, separator `;`, kwota ze znakiem (wydatek
   ujemny, przelew dodatni z dwoma kontami), przecinek dziesiętny bez separatora tysięcy,
   łącznik zamiast minusa typograficznego; pola tekstowe zaczynające się od `= + - @`
   dostają apostrof (CSV injection). `?month=` opcjonalne — bez niego wszystkie transakcje.
7. **Ekran `/settings/income-sources`** (06 §3.12 wymieniało sekcję „Źródła przychodu",
   a ekranu nie było).
8. **Kolor awatara bez interfejsu** — paleta awatarów nie ma tokenów, a surowe kolory są
   zabronione (`Z-43`).

**Konsekwencje.** Eksport rośnie liniowo z danymi, bez stronicowania — przy dwóch osobach
to pojedyncze megabajty. Nowa tabela domenowa musi trafić do `EXPORT_TABLES`, inaczej
kopia będzie niekompletna po cichu (test pilnuje listy kluczy).

---

<a id="adr-062"></a>

## ADR-062 — Front serwowany przez Fastify; kopie i odtworzenie skryptem aplikacji

**Data:** 2026-09-26 · **Zadanie:** `F8-3`, `F8-7`, `F8-8`, `F8-9` · **Status:** przyjęte

**Kontekst.** `Dockerfile` i 02 §1 zakładały, że Fastify serwuje zbudowany SPA
(`WEB_DIST_PATH`), ale kodu, który by to robił, nie było — obraz wystawiałby samo API.
Skrypt kopii w 10 §5.2 wklejał kod w `node -e`, a odtworzenie montowało wolumen
`fineapp-data`, podczas gdy Compose nazywa go `<projekt>_fineapp-data` — przywrócenie
trafiłoby do nowego, pustego wolumenu.

**Decyzja.**

1. `WEB_DIST_PATH` w konfiguracji (`config.web.distPath`, pusty = bez frontu, jak w dev).
   `@fastify/static` z listą plików przy starcie (`wildcard: false`); `assets/*` —
   `public, max-age=31536000, immutable`, reszta (`index.html`, `sw.js`, manifest) —
   `no-cache`. Nieznany adres `GET`/`HEAD` spoza `/api` i bez kropki w ostatnim członie
   dostaje `index.html`; `/api/*` i brakujące pliki — JSON-owe `404`. Katalog bez
   `index.html` → odmowa startu.
2. Produkcja odmawia startu bez `https://` w `APP_URL` (10 §9 to zapowiadało, kod
   sprawdzał tylko `COOKIE_SECURE`).
3. **`dist/scripts/backup.js`**: `VACUUM INTO` + `PRAGMA integrity_check` + raport
   (migracje, domownicy, konta, transakcje, ostatnia data); `--verify <plik>` sprawdza
   kopię tylko do odczytu. Uszkodzona kopia — kod wyjścia 1.
4. **`scripts/backup.sh`** i **`scripts/restore.sh`** wyłącznie przez `docker compose`
   (`exec`, `cp`, `run`) — Compose zna nazwę wolumenu. Odtworzenie: sprawdzenie kopii →
   zabezpieczenie bieżącej bazy (`pre-restore-*.db`) → stop → podmiana bez `-wal`/`-shm`
   → start → czekanie na `/health`.
5. PWA: baner „Brak połączenia" (`navigator.onLine`), przycisk „Zainstaluj aplikację"
   w ustawieniach (zdarzenie `beforeinstallprompt` łapane przy starcie), instrukcja dla
   iOS.

**Stan weryfikacji.** Zbudowany `dist` uruchomiony lokalnie w trybie produkcyjnym:
SPA, głębokie linki, service worker, odświeżenie offline z pamięci SW, brak błędów CSP.
Przećwiczone odtworzenie (lokalnie, bez Dockera): migawka żywej bazy → utrata → baza
z kopii → logowanie drugiej osoby i dane na miejscu. **Obrazu Dockera nie dało się
zbudować w środowisku deweloperskim** (polityka sieci blokuje repozytoria Debiana i corepack) —
budowa, `restore.sh` na wolumenie i przećwiczenie na VPS zostają do `F8-7`/`F8-8` u
właściciela.

---

<a id="adr-063"></a>

## ADR-063 — Wykresy w SVG bez biblioteki; bez wykresu kołowego kategorii

**Data:** 2026-09-26 · **Zadanie:** `F8-5` · **Status:** przyjęte

**Decyzja.**

1. **Trend rozkładu** (06 §3.6) to wykres liniowy w ręcznie pisanym SVG
   (`components/charts/trend-chart.tsx`): wykonanie (linia ciągła ze znacznikami)
   na tle planu (przerywana), przerwa w miesiącu bez wpływów, oś schodząca pod zero przy
   wykonaniu ujemnym (ADR-011), legenda i podpisy końców linii, odczyt dotkniętego
   miesiąca w wierszu nad wykresem. Lista miesięcy zostaje jako widok tabeli pod
   „Miesiąc po miesiącu".
2. **Bez `recharts`** — sześć punktów to kilkadziesiąt linii SVG, a biblioteka dołożyłaby
   ~100 kB gzip. Zależność zostaje w `package.json` nieużywana (`Z-44`).
3. **Tokeny `--chart-actual` i `--chart-plan`** dla obu motywów, zwalidowane walidatorem
   palety: jasny — `--primary` vs szary plan ΔE 17,5; ciemny — `--primary` dawał ΔE 13,6
   (poniżej progu 15), więc wykonanie bierze stopień `--savings` (ΔE 16,0). Szary plan to
   linia odniesienia, nie druga seria — odróżnia ją też kreskowanie.
4. **Wydatki po kategoriach bez wykresu kołowego.** Rozbicie `/m/:month/categories` ma od
   `F3-2` posortowane paski udziału — to właściwa forma do porównania wielkości; koło
   z kilkunastoma wycinkami na 390 px byłoby nieczytelne. „Bez wykresu kołowego
   (Faza 8)" z 06 §3.1 zamknięte tą decyzją.

---

<a id="adr-064"></a>

## ADR-064 — Dostępność: odczyt kwot jako tekst ukryty, powiększanie gestem dozwolone

**Data:** 2026-09-26 · **Zadanie:** `F8-4` · **Status:** przyjęte

**Kontekst.** Skan axe-core (WCAG 2.1 A/AA) trzynastu ekranów w obu motywach wykazał:
`aria-label` z kwotą słowami siedział na `<span>` bez roli — w ARIA 1.2 to zabronione
i czytniki go pomijają, więc zasada „kwota słowami dla czytnika" (15 §4.1) nie działała
nigdzie; paski postępu bez nazwy; `maximum-scale=1` blokujące powiększanie. Kontrast —
bez naruszeń.

**Decyzja.**

1. `<Money>`: widoczna kwota `aria-hidden`, obok `<span class="sr-only">` z odczytem.
2. `ProgressBar`: `aria-label` z puli albo podany (`label`), `aria-valuenow` przycięte do
   0–100, prawdziwa wartość (także ponad 100% i ujemna) w `aria-valuetext`.
3. **Zmiana 06 §5:** zamiast `maximum-scale=1` — `touch-action: manipulation` na `<html>`:
   podwójne dotknięcie nie powiększa, a gest powiększania działa (WCAG 1.4.4).

**Stan.** Po poprawkach axe: zero naruszeń na 29 skanach (logowanie ×2, 13 ekranów × 2
motywy, otwarty arkusz).

**Znalezione przy okazji.** Arkusz (`Sheet`) miał `onOpenChange` w zależnościach efektu
historii — rodzic podający funkcję strzałkową uruchamiał przy każdym renderze
cofnięcie i nowy wpis, a spóźniony `popstate` zamykał arkusz i zdejmował wpis ekranu
(ustawienia wyrzucały na dashboard). Funkcja trafia do refa; test regresji w `sheet.test`.

---

<a id="adr-065"></a>

## ADR-065 — Produkcja za bramą https-portal; obraz z GitHub Actions, wdrożenie przez SSH

**Data:** 2026-09-28 · **Zadanie:** `F8-7` · **Status:** przyjęte

**Kontekst.** 10 §1–§4 zakładały osobny reverse-proxy (Caddy/nginx) na hoście, port
`127.0.0.1:3000` i budowę obrazu na VPS (`git pull && docker compose build`). Docelowy
VPS ma już jedną bramę dla wszystkich serwisów — `steveltn/https-portal` w sieci
dockerowej `gateway-net`, sterowaną listą `DOMAINS` — a pozostałe aplikacje są
wdrażane obrazem z GHCR przez GitHub Actions. Obrazu FineApp nie zbudowano dotąd nigdzie
(ADR-062). Domena `budzet.example.pl` (i `www`) wskazuje na ten VPS.

**Decyzja.**

1. **Brama zamiast Caddy.** Kontener `fineapp-app` w `gateway-net`, **bez portu na
   hoście** — ostrzej niż `127.0.0.1:3000` z 09 §11. Brama spełnia 10 §4 bez zmian:
   `X-Forwarded-For`/`-Proto`, 100 MB ciała, 2 h `proxy_read_timeout`.
2. **Obraz budowany w CI**, nie na VPS: `deploy-prod.yml` wypycha `:<sha>` i `:latest`
   do GHCR, serwer tylko pobiera. VPS nie dostaje toolchaina ani kopii repozytorium,
   a kompilacja `better-sqlite3`/`sharp` nie konkuruje o CPU z działającymi serwisami.
   `ci.yml` buduje obraz na każdym PR-ze — Dockerfile nie może się zepsuć niezauważony.
3. **Compose także na produkcji** (`deploy/docker-compose.prod.yml`, kopiowany jako
   `~/projects/fineapp/docker-compose.yml`), ze stałą nazwą projektu `fineapp` — żeby
   `backup.sh` i `restore.sh` z ADR-062 działały bez zmian. Obraz jako lokalny znacznik
   `:deployed` z `pull_policy: never`: każde `up`/`run` (także w `restore.sh`) bierze
   dokładnie wdrożoną wersję.
4. **Wdrożenie udane tylko przy `healthy`** (healthcheck z `dbOk`), inaczej job kończy
   się błędem z logami kontenera. Przed wdrożeniem `backup.sh` do
   `~/projects/fineapp/backups` — obok migawki `pre-migration-*` w wolumenie.
5. **Automatyczne wdrażanie za przełącznikiem.** Push na `main` wdraża dopiero przy
   zmiennej repozytorium `AUTO_DEPLOY=true`; do tego czasu tylko ręcznie. Wycofanie —
   ręczne uruchomienie z `image_tag` (SHA), bez testów i budowy.
6. **Logowanie do GHCR na serwerze jednorazowym `GITHUB_TOKEN`-em** w tymczasowej
   konfiguracji Dockera — bez trwałego tokenu na VPS i bez nadpisania logowania, z którego
   korzystają inne serwisy.
7. **Osobny klucz SSH** tylko dla tego workflow, z opcjami bez przekierowań.
8. Limity zasobów kontenera (1 GB RAM, 2 CPU, 256 procesów, `no-new-privileges`) —
   aplikacja nie może zagłodzić bramy trzymającej TLS pozostałych serwisów.

**Kolejność przy pierwszym wdrożeniu.** Domena trafia do `DOMAINS` bramy **po** tym, jak
`fineapp-app` istnieje w `gateway-net`: nginx nie wstaje, gdy nie rozwiąże nazwy
z `proxy_pass`, więc odwrotna kolejność wyłączyłaby wszystkie serwisy na VPS (10 §12.5).

**Koszt.** Dwa miejsca opisują compose (`docker-compose.yml` do lokalnej budowy i
`deploy/docker-compose.prod.yml`); zmiana zmiennych w `environment` wymaga poprawienia
obu. 10 §1–§7 zostają jako wariant ogólny, z odnośnikiem do §12.

---

<a id="adr-066"></a>

## ADR-066 — Po wdrożeniu: argon2id bez zmian, bez map źródeł, kopia poza serwerem w B2

**Data:** 2026-09-28 · **Zadanie:** `F8-8`, `F8-9` · **Status:** przyjęte

**Kontekst.** Przejście 09 §11 na działającym `budzet.example.pl` zostawiło trzy decyzje
właściciela i jedną lekcję operacyjną.

**Decyzja.**

1. **argon2id zostaje na t=3, 64 MiB** (`Z-2`). Na VPS (AMD EPYC, 4 vCPU): haszowanie
   **177 ms**, weryfikacja **171 ms**. 09 §2.2 celował w 50–100 ms i kazał w takim
   przypadku obniżyć `timeCost` — świadomie **nie** obniżamy: logowanie jest raz na
   urządzenie na 30 dni, ~175 ms jest niezauważalne, dwóch użytkowników nie obciąży CPU,
   a wyższy koszt to jedyna bariera dla 6-cyfrowego PIN-u po wycieku bazy.
2. **Bez map źródeł w produkcji** (`Z-45`). Na produkcji `/assets/*.js.map` oddawał
   1,1 MB kodu frontu każdemu. `build.sourcemap: false`; do debugowania — lokalny build
   z `--sourcemap`.
3. **Kopia poza serwerem: restic → Backblaze B2** (10 §5.3). Klucz aplikacji ograniczony
   do jednego bucketu, szyfrowanie na VPS, `offsite.sh` po `backup.sh` w cronie (`&&` —
   wysyłana jest tylko sprawdzona kopia). Google Drive przez `rclone` odrzucony:
   współdzielony `client_id` rclone jest wycofywany w 2026, a własny wymaga aplikacji
   OAuth opublikowanej w Google Cloud (inaczej token wygasa po 7 dniach).
4. **Migawki w wolumenie z rotacją** — `backup.sh` zostawia 5 najnowszych `pre-migration-*`
   i `pre-restore-*`; wcześniej rosły bez końca.

**Lekcja: brama odnawia certyfikaty przy każdym starcie** (10 §12.7). Odtworzenie bramy
po dopisaniu domeny wpadło w pętlę restartów, bo odnowienie certyfikatu hosta
z przeniesionym DNS (`inna.example.pl`) jest dla https-portal błędem krytycznym —
na kilka minut zniknęły wszystkie serwisy na VPS. Wpis usunięty za zgodą właściciela;
przed każdą zmianą bramy — sprawdzenie DNS wszystkich hostów z `DOMAINS`.

**Kompresja** (`Z-27`) — brama oddaje `gzip`; `@fastify/compress` niepotrzebny.

---

## ADR-067 — Przełącznik motywu i zwijany pasek boczny jako ustawienia urządzenia

**Data:** 2026-09-28 · **Zadanie:** poprawki po wdrożeniu · **Status:** przyjęte

**Kontekst.** 06 §1.5 zapowiadał „ciemny domyślny, jasny dostępny", ale jedyny
przełącznik siedział na `/dev/ui` — na produkcji motyw był na stałe ciemny. Na desktopie
pasek boczny 240 px nie dawał się schować. Do tego arkusze na desktopie nie miały dolnego
odstępu: `pb-safe-bottom` nadpisywało `p-4`, a `safe-area-inset-bottom` poza telefonem
wynosi 0.

**Decyzja.**

1. **Motyw: Ciemny / Jasny / Systemowy**, domyślnie ciemny. Wybór w Ustawieniach
   (sekcja „Wygląd") i szybki przełącznik ☀/☾ na dole paska bocznego. Wspólny stan
   (`lib/theme.ts`, `useSyncExternalStore`), więc oba miejsca widzą tę samą wartość.
2. **Ustawienie urządzenia, nie gospodarstwa** — `localStorage` (`fineapp.theme`), bez
   API i migracji. Ten sam domownik może chcieć ciemnego telefonu i jasnego laptopa.
3. **Motyw przed pierwszym malowaniem** — `public/theme-init.js`, ładowany synchronicznie
   w `<head>`. Plik, nie wstawka: CSP ma `script-src 'self'` (09 §6), a `'unsafe-inline'`
   dla jednej linijki byłoby złą wymianą. `class="dark"` w `index.html` zostaje jako
   wartość domyślna.
4. **Pasek boczny zwija się do szyny 64 px** z samymi ikonami (podpisy jako `title`
   i tekst dla czytnika ekranu), zamiast znikać całkiem — nawigacja zostaje o jedno
   kliknięcie, a przycisk rozwinięcia ma stałe miejsce. Stan w `localStorage`
   (`fineapp.sidebar`).
5. **Dolny odstęp arkusza** = `calc(1rem + env(safe-area-inset-bottom))`.

**Odrzucone.** Motyw w `settings` gospodarstwa — wymusza jeden motyw na obu domownikach
i wszystkich ich urządzeniach. Całkowite ukrycie paska — wymagałoby pływającego przycisku
nad nagłówkami ekranów.

---

## ADR-068 — Pierwsza rata zobowiązania: nie wcześniej niż po dniu „na dzień", wskazana wprost wygrywa

**Data:** 2026-09-28 · **Zadanie:** poprawki po wdrożeniu · **Status:** przyjęte

**Kontekst.** Przy wpisywaniu zobowiązań 28 września każde z ratą wcześniej w miesiącu
pokazywało „Rata po terminie", choć kwota „na dzień" już tę ratę obejmowała. Reguła raty
liczyła to poprawnie (`firstInstallmentMonth` — od pierwszej raty **po** `balanceAsOf`),
ale stan zobowiązania (`nextInstallmentOn`) punktu odniesienia nie znał. Do tego pole
`firstPaymentOn` było w kontrakcie i w bazie, ale nie w formularzu — zobowiązania
spłacanego od listopada nie dało się wpisać bez fałszywej zaległości.

**Decyzja.**

1. `LiabilityTerms` dostaje `balanceAsOf`. Nowa `firstInstallmentOn`: `firstPaymentOn`,
   gdy podana, a bez niej pierwszy dzień płatności **po** `balanceAsOf`. Najbliższa rata
   nigdy nie jest wcześniejsza; `firstInstallmentMonth` (start reguły) liczy z tej samej
   funkcji, więc stan i reguła się nie rozjadą.
2. **Wskazana wprost wygrywa** — także gdy wypada wcześniej niż wyliczona (np. w dniu
   „na dzień"). To świadoma deklaracja użytkownika; wcześniej reguła brała późniejszą z dwóch.
3. Formularz dostaje opcjonalne pole **„Najbliższa rata"** (data) — obsługuje oba
   przypadki: spłata od listopada i rata z tego miesiąca już zapłacona.
4. Zmiana `firstPaymentOn` w edycji przesuwa start i koniec reguły raty o tyle samo
   miesięcy (liczba rat bez zmian); serwis reguł sprząta i dogenerowuje wystąpienia.
5. „Do zrobienia" i `unpaidCount` miesiąca pomijają zobowiązania, których rata przypada
   w późniejszym miesiącu.

**Odrzucone.** Osobne pole „rata z tego miesiąca zapłacona" — to samo wyraża data
najbliższej raty, a jedno pole zamiast dwóch nie zostawia sprzecznych kombinacji.
Automatyczne księgowanie „zaległej" raty przy zakładaniu — dublowałoby kwotę, którą
podana kwota „na dzień" już uwzględnia.


---

## ADR-069 — Zatwierdzenie paragonu „wg kategorii": jedna transakcja na kategorię

**Data:** 2026-09-29 · **Zadanie:** poprawki po wdrożeniu · **Status:** przyjęte

**Kontekst.** Paragon z zakupami spożywczymi i jedną pozycją „Worki na śmieci" dawał do
wyboru dwie skrajności: „Jedna transakcja" (worki lądują w jedzeniu) albo „Podziel na
pozycje" (30 transakcji, każda z jednym produktem — to, przed czym 08 §11 ostrzega).
Model i tak proponuje kategorię **każdej** pozycji, więc rozbicie na kategorie jest
w danych — brakowało trybu, który z niego korzysta. Użytkownik chce, żeby taki podział
był proponowany **automatycznie**.

**Decyzja.**

1. Trzeci tryb commitu `mode = 'by_category'`: jedna transakcja wydatku na każdą
   kategorię wśród zaznaczonych pozycji; kwota = suma netto pozycji grupy; opis =
   sprzedawca (jak w `single`), notatka = opisy pozycji grupy. Każda transakcja ma
   `source = 'ocr'` i odnośnik do dokumentu; pozycje dostają `transaction_id` swojej grupy.
2. Grupowanie to czysta funkcja w `packages/shared` (`groupItemsByCategory`, 07 §9a) —
   ten sam wynik liczy podgląd na ekranie i serwer przy zapisie:
   - kluczem grupy jest kategoria **wydatku** pozycji (wybrana albo przyjęta propozycja);
   - pozycja bez kategorii i rabat (`inflow`) bez kategorii wydatku trafiają do grupy
     **dominującej** (najwięcej obciążeń — jak kategoria całości w `single`; remis —
     pierwsza na paragonie); rabat z kategorią wydatku pomniejsza swoją grupę;
   - grupa o sumie ≤ 0 (sam rabat) wchodzi do dominującej;
   - łączna suma ≤ 0 → `422`, jak w `single`.
3. **Tryb domyślny** paragonu i faktury: `by_category`, gdy podział daje co najmniej dwie
   grupy; inaczej `single` (06 §3.4.C). Wyciąg bez zmian — `split`.
4. Przełącznik trybu ma trzy opcje: „Całość", „Kategorie", „Pozycje"; w trybie
   „Kategorie" pod przełącznikiem widać podgląd: kategoria i kwota każdej transakcji.

**Odrzucone.** Prośba do modelu o gotowe grupy — suma grup musiałaby się zgadzać
z pozycjami, a korekta kategorii pozycji na ekranie i tak wymaga przeliczenia po
stronie aplikacji. Pozycje bez kategorii jako osobna transakcja „bez kategorii" —
przy typowym paragonie to jedna niepewna pozycja spożywcza, a osobny wpis bez kategorii
zaśmieca historię bardziej, niż myli sumę kategorii; pozycję widać na liście i da się
ją przepiąć przed zatwierdzeniem.

---

## ADR-070 — Domyślne konto wydatków w ustawieniach gospodarstwa

**Data:** 2026-09-29 · **Zadanie:** poprawki po wdrożeniu · **Status:** przyjęte

**Kontekst.** Przegląd skanu proponował konto tylko wtedy, gdy gospodarstwo ma dokładnie
jedno konto „na życie". Przy dwóch takich kontach trzeba było je wybierać za każdym
razem, a brak konta objawiał się komunikatem na samym dole ekranu — przycisk
„Zatwierdź" (w nagłówku) „nic nie robił".

**Decyzja.**

1. Kolumna `households.default_expense_account_id` (`NULL` = brak;
   `ON DELETE SET NULL`), pole `HouseholdDto.defaultExpenseAccountId`, zmiana przez
   `PATCH /settings/household` (konto musi należeć do gospodarstwa i nie być
   zarchiwizowane, inaczej `422`).
2. Ustawienie na poziomie **gospodarstwa**, nie domownika — jedno wspólne konto do
   wydatków to przypadek z wdrożenia; osobne konta per osoba można dołożyć później
   bez zmiany kształtu tego pola.
3. Pierwszeństwo przy wyborze konta: konto wskazane w dokumencie → konto domyślne (jeśli
   aktywne) → dotychczasowa reguła. W formularzach transakcji (i wszędzie, gdzie działa
   `defaultAccountId`) konto domyślne wyprzedza „pierwsze konto na życie".
4. Ustawienia → Gospodarstwo: wiersz „Konto do wydatków" z wyborem konta
   (i „Bez domyślnego").
5. Błąd walidacji przy „Zatwierdź" pokazuje się **pod nagłówkiem**, obok przycisku,
   a przy braku konta od razu otwiera się wybór konta.

**Odrzucone.** Flaga `is_default` na koncie — dwa konta mogłyby ją mieć naraz, a jedna
kolumna w gospodarstwie wyklucza sprzeczność strukturalnie.

---

## ADR-071 — Model OCR: `claude-sonnet-5-5`

**Data:** 2026-09-29 · **Zadanie:** poprawki po wdrożeniu · **Status:** przyjęte

**Kontekst.** Na prośbę użytkownika domyślny model odczytu dokumentów zmienia się
z `claude-sonnet-5` na nowszy `claude-sonnet-5-5`.

**Decyzja.** `AI_MODEL` domyślnie `claude-sonnet-5-5`. Żądanie się nie zmienia: nie
wysyłamy `temperature`, `thinking` ani `tool_choice` (ADR-059), a structured outputs
działają tak samo; model domyślnie myśli adaptacyjnie. Cennik ($2 / $10 za milion tokenów)
jest ten sam, więc stawki `AI_*_COST_MINOR_PER_MTOK` zostają. Na serwerze trzeba
zmienić `AI_MODEL` w `.env`, jeśli jest tam wpisany jawnie.

**Odrzucone.** Parametr `fallbacks` (beta) na wypadek odmowy — przy paragonach odmowa
się nie zdarzyła, a `AI_MODEL` jest konfiguracją, więc parametr związany z konkretnym
modelem mógłby dać `400` po zmianie modelu.

---

## ADR-072 — Usunięcie wszystkich danych gospodarstwa

**Data:** 2026-10-01 · **Zadanie:** prośba użytkownika (testy przed właściwym użytkowaniem) · **Status:** przyjęte

**Kontekst.** Aplikacja jest testowana na prawdziwym serwerze. Po testach trzeba zacząć
od czystej karty bez odtwarzania bazy z kopii i bez zakładania domowników od nowa.

**Decyzja.**

1. `POST /settings/reset` z `{ pin }` → `{ deleted: { <tabela>: liczba } }` (nazwy tabel
   z `EXPORT_TABLES`). PIN zalogowanej osoby sprawdzany jak przy zmianie PIN-u
   (`confirmPin` w `auth.service`); zły → `401`, nic nie znika.
2. Usuwane w **jednej transakcji** SQLite: transakcje razem z koszem, pozycje
   dokumentów i dokumenty, wystąpienia i reguły cykliczne, planowane wydatki,
   zobowiązania, cele, wersje rozkładu, źródła przychodu, konta, **własne** kategorie
   i klucze idempotencji; `households.default_expense_account_id` → `NULL`.
3. Sprawdzanie kluczy obcych odroczone do zatwierdzenia (`PRAGMA defer_foreign_keys`) —
   powiązania są cykliczne (transakcja ↔ wystąpienie, zobowiązanie ↔ reguła), a część
   ma `RESTRICT`; ręczna kolejność usuwania psułaby się przy każdej nowej kolumnie.
4. Pliki dokumentów (oryginał i miniatura) usuwane z `UPLOAD_DIR` **po** zatwierdzeniu
   transakcji; błąd pojedynczego pliku nie cofa usunięcia (sierota na dysku jest
   niegroźna, połowiczne dane w bazie — tak).
5. Zostają: gospodarstwo z ustawieniami, domownicy, sesje (nikt nie jest wylogowany),
   kategorie systemowe z ich zmianami (I-9) i licznik kosztu AI w `app_meta` — usunięcie
   danych nie może zerować miesięcznego limitu OCR.
6. Repozytorium `settings.reset.repository.ts` czyta i kasuje tabele innych modułów —
   trzeci udokumentowany wyjątek od reguły 4 z 02 §3 (lustro eksportu, ADR-061).
7. Ekran: Ustawienia → Dane → „Usuń wszystkie dane" (`ghost` w kolorze `--danger`) →
   arkusz z listą tego, co znika i co zostaje, polem PIN-u i przyciskiem `danger`.
   Po sukcesie toast z liczbą transakcji i kont oraz `resetQueries` (poza samymi
   ustawieniami, które tylko się odświeżają — ich reset zgubiłby stan ekranu).

**Odrzucone.** Wpisywanie słowa „USUŃ" zamiast PIN-u — PIN chroni także przed
wykradzionym tokenem, a na telefonie wpisanie słowa z ogonkiem jest bardziej uciążliwe
niż sześć cyfr. Ponowne wstawienie kategorii z seeda — kategorie systemowe nigdy nie
znikają (I-9), więc nie ma czego odtwarzać. Usuwanie domowników — reset ma zostawić
aplikację gotową do użycia bez dostępu do serwera.

---

## ADR-073 — Mały przycisk z tłem bez ujemnego marginesu; taśma kafli bez paska

**Data:** 2026-10-01 · **Zadanie:** poprawki po wdrożeniu · **Status:** przyjęte

**Kontekst.** „Wpłać" na karcie celu wyglądał źle: `Button size="small"` miał
`min-h-touch -my-2`, co przy wariancie `soft` (tło i ramka) dawało 44-px pudełko
wchodzące 8 px na linię nad stopką karty i w jej dolny margines. 15 §4.3 zakładało, że
mały przycisk jest „wizualnie mniejszy przez brak tła", a w kodzie używano go z tłem
(karty celów i planowanych wydatków, „Do zrobienia", przegląd skanu). Osobno: na
Androidzie (Chrome, Brave) pod taśmą kont na ekranie miesiąca od razu widać pasek
przewijania.

**Decyzja.**

1. `Button` w rozmiarze `small` rozróżnia warianty (`compoundVariants`): `link` bez
   zmian (`min-h-touch -my-2 px-2`), warianty z tłem — `h-9 px-3` i przezroczysty
   pseudoelement `after:-inset-y-1`, który dociąga obszar dotyku do 44 px. Układ
   widzi 36 px, więc przycisk nie nachodzi na sąsiednie linie.
2. Klasa `scrollbar-none` w `tokens.css` (`scrollbar-width: none` i
   `::-webkit-scrollbar { display: none }`) na taśmie kont. Przewijanie działa jak
   dotąd; to, że kafli jest więcej, mówi ucięty ostatni kafel.

**Odrzucone.** Poprawka tylko na karcie celu (`size="medium"`) — ta sama usterka
dotyczyła każdej stopki karty z małym przyciskiem z tłem.

---

## ADR-074 — Treść powłoki przycina poziomy nadmiar (`overflow-x-clip`)

**Data:** 2026-10-02 · **Zadanie:** zgłoszenie po wdrożeniu · **Status:** przyjęte

**Kontekst.** Na telefonie (Brave, Android) FAB „+" był widoczny tylko na ekranie
*Skan*. Na zrzucie ekranu miesiąca cała strona była przesunięta w bok: pasek zakładek
rozłożony na ~475 px (zakładka „Miesiąc" za lewą krawędzią), FAB za prawą. Chrome na
Androidzie poszerza obszar układu do szerokości dokumentu, a elementy `fixed` (pasek,
FAB) są przypięte do tego obszaru — jeden element szerszy niż ekran wystarcza, żeby FAB
wyjechał poza widok. Konkretnego elementu nie udało się odtworzyć (emulacja 393/412 px,
dane podobne do produkcyjnych, gesty dotykowe); wstrzyknięty element 470 px dał dokładnie
objaw ze zgłoszenia (`scrollWidth` 487, prawa krawędź FAB 471 przy ekranie 393).

**Decyzja.** Kontener treści w `AppShell` dostaje `overflow-x-clip`. Za szeroki element
zostaje ucięty przy prawej krawędzi treści, ale strona nie poszerza się, więc pasek
zakładek i FAB zawsze są na ekranie. Z tym samym wstrzykniętym elementem: `scrollWidth`
393, FAB 377. Test `app-shell.test.tsx` pilnuje klasy.

**Dlaczego `clip`, nie `hidden`.** `overflow-x: hidden` wymusza `overflow-y: auto`
i robi z kontenera kontener przewijania — `sticky` w treści przestałoby działać,
a przewijanie strony przeszłoby na wewnętrzny element. `clip` tylko przycina.
Taśma kont (`-mx-4` w obrębie `px-4` kontenera) mieści się w polu dopełnienia, więc
nie jest ucinana.

**Odrzucone.** Szukanie i poprawianie pojedynczego elementu bez zabezpieczenia — przy
danych zależnych od użytkownika (nazwy, kwoty) następny za szeroki element zepsułby
nawigację tak samo. Jeśli coś okaże się ucięte, poprawiamy ten element osobno.

**Uzupełnienie (2026-10-05) — przyczyna znaleziona.** Po wdrożeniu FAB wrócił wszędzie
poza ekranem miesiąca. Winowajcą jest **taśma kont**: kwoty w kaflach mają tekst dla
czytnika (`sr-only`, `position: absolute`), a ani taśma, ani kontener treści nie były
pozycjonowane. Absolutny element bez pozycjonowanego przodka liczy się od całej strony —
nie przycina go ani przewijana taśma (`overflow-x-auto`), ani `overflow-x-clip`
kontenera. Kafle przewinięte za prawą krawędź poszerzały więc dokument (4 konta na
393 px: `scrollWidth` 490, FAB 474). Dlatego „po zmianie": problem pojawia się dopiero
przy kontach, które nie mieszczą się na ekranie. Poprawka: `relative` na taśmie
(właściwa przyczyna) i na kontenerze treści w `AppShell` (żeby `clip` łapał takie
elementy na każdym ekranie). Wszystkie inne elementy `absolute` w aplikacji mają już
pozycjonowanego rodzica, więc `relative` kontenera niczego nie przesuwa. Po poprawce:
`scrollWidth` 393, FAB 377, taśma dalej przewija się (`scrollWidth` 552).

---

<a id="adr-075"></a>

## ADR-075 — Planer budżetu: szkic miesiąca jako osobny byt, zapisane linie, poza księgą

**Data:** 2026-10-27 · **Zadanie:** prośba właściciela — planowanie budżetu (wymaganie #14, Faza 9) · **Status:** przyjęte (plan, przed implementacją)

**Kontekst.** Właściciel chce pod koniec miesiąca albo na jego początku rozpisać budżet
na następny miesiąc (także kilka naprzód) i zobaczyć, czy dowiezie cele. Składniki planu
istnieją, ale osobno: pozycje cykliczne, planowane wydatki, cele, zobowiązania, rozkład
docelowy. Brakuje miejsca na rzeczy, które przychodzą do głowy przy planowaniu
(„prezent 300 zł", „na jedzenie 1 900 zł") i na ich ocenę razem z resztą. Opis funkcji:
[16](./16-budget-planner.md).

**Decyzja.**

1. Nowe tabele `budget_drafts` (jeden szkic na miesiąc gospodarstwa) i
   `budget_draft_lines` (03 §3.19–3.20). Szkic jest **wspólny** dla obu domowników —
   tak jak cała reszta danych (brak ról, 00 §3).
2. **Linie są zapisane**, nie wyliczane ze źródeł przy odczycie. Szkic ma sens dlatego,
   że różni się od źródeł (wyłączony Netflix, „jedzenie 1 900, nie średnia"); wersja
   wyliczana i tak potrzebowałaby tabeli nadpisań i wykluczeń.
3. Linia ma `flow` z czterech stron bilansu (`income`, `expense`, `savings`,
   `investment`) — nie typ transakcji. Przelew na oszczędności to linia `savings`, bo
   pytanie planu brzmi „ile odkładam", a nie „z jakiego konta na jakie".
4. **Szkic nie jest księgą.** Nie tworzy transakcji ani wystąpień, nie zmienia sum
   miesiąca (07 §12), nie wchodzi do „Do zrobienia". Linia własna istnieje tylko
   w szkicu — to domyślny przypadek („wydatki tylko na ten miesiąc").
5. Zakres miesięcy: zakładanie od bieżącego do **+12**; szkic minionego miesiąca zostaje
   jako historia, **tylko do odczytu** (I-20, 07 §13.1). Bez stanów „zatwierdzony",
   wersji i historii zmian — szkic jest jeden i żywy.
6. Sumy i ocena nie są przechowywane — jak salda, liczone z linii przy odczycie.

**Odrzucone.**

- *Budżet jako widok przyszłego miesiąca na dashboardzie, bez nowego bytu.* Nie ma
  gdzie zapisać linii własnych ani wykluczeń; dashboard przyszłego miesiąca to podgląd
  z reguł (07 §6.2) i powinien takim zostać.
- *Linie własne jako „transakcje planowane" (`transactions.status='pending'`).* Księga
  przestałaby być księgą: każde zapytanie o sumy musiałoby pamiętać o nowym filtrze,
  a plan „jedzenie 1 900 zł" nie jest zdarzeniem z datą i kontem.
- *Budżety kwotowe per kategoria (11, „Po v1").* Planer je częściowo pokrywa (linia
  z kategorią + plan kontra wykonanie), ale bez pilnowania w trakcie miesiąca.
  Pomysł zostaje na liście.
- *Osobny szkic dla każdego domownika.* Budżet jest jeden; dwa szkice wymagałyby
  scalania.

**Koszt.** Dwie tabele i moduł do utrzymania; eksport, „Usuń wszystkie dane" i scalanie
kategorii muszą je znać (`F9-1`). Linie mogą rozjechać się ze źródłami — temu służy
ADR-076.

---

<a id="adr-076"></a>

## ADR-076 — Linie powiązane: migawka kwoty źródła, odświeżanie bez nadpisywania, „Zastosuj w źródle" z podziałem reguły

**Data:** 2026-10-27 · **Zadanie:** Faza 9 (plan) · **Status:** przyjęte (plan, przed implementacją)

**Kontekst.** Właściciel chce, żeby planer „działał w obie strony": nadchodzące wydatki
mają się pojawiać w szkicu same, a zmiany w szkicu dać się łatwo przenieść z powrotem.
Ryzyko jest symetryczne: szkic, który sam się nadpisuje ze źródeł, gubi decyzje
planisty; szkic, który sam zmienia źródła, psuje pozycje cykliczne „przy okazji".

**Decyzja.**

1. Wypełnianie ze źródeł — siedem kroków z 07 §13.2 (cykliczne, raty bez reguły,
   planowane w miesiącu, odkładanie, cele). Jedno źródło = najwyżej jedna linia
   (unikalne indeksy); wstawianie `ON CONFLICT DO NOTHING`.
2. Linia powiązana zapisuje `source_amount_minor` — kwotę źródła z chwili wypełnienia.
   Odczyt porównuje ją z bieżącą i liczy `sourceState` (07 §13.5): zmiana w źródle to
   **informacja** („W regule teraz 1 950 zł [Przyjmij]"), zmiana w szkicu to **decyzja**.
3. **Odświeżenie** dokłada brakujące linie, nie zmienia istniejących i nie wskrzesza
   wykluczonych. „Usunięcie" linii powiązanej to wykluczenie (`is_excluded`), żeby
   odświeżenie jej nie przywróciło (I-24).
4. Edycja w szkicu **nigdy** nie zmienia źródła. „Zastosuj w źródle" jest osobną,
   jawną akcją z podglądem skutku (07 §13.7).
5. Dla reguły i miesiąca późniejszego niż bieżący (i niż start reguły) „Zastosuj" **dzieli
   regułę**: stara kończy się w M − 1, nowa zaczyna w M z nową kwotą; linie szkiców od M
   przepinają się na nową. Reguła raty zobowiązania — odmowa (`422`): ratę zmienia się
   w zobowiązaniu.
6. Usunięcie źródła nie kasuje linii (`ON DELETE SET NULL`) — linia osierocona dostaje
   „Zostaw jako własną" / „Usuń".
7. W miesiącu terminu planowanego wydatku z odkładaniem szkic dostaje linię odkładania
   **ujemną** (`−S_M`, wypłata z odłożonego) obok linii wydatku — bilans obciąża tylko
   część niepokryta (ujęcie netto, ADR-011).

**Dlaczego podział, a nie zmiana kwoty.** Zmiana kwoty reguły działa od bieżącego
miesiąca (07 §6.4). Podwyżka czynszu „od grudnia" wpisana w październiku zmieniłaby
czynsz za październik i listopad. Podział zachowuje obie kwoty i nie rusza historii.

**Odrzucone.**

- *Automatyczna synchronizacja w obie strony.* Każda z dwóch kierunkowych wersji
  niszczy coś cicho — decyzję w szkicu albo regułę.
- *Kwota przyszła w regule (tabela zmian kwot od miesiąca).* Poprawne, ale to zmiana
  modelu pozycji cyklicznych dla jednego przypadku, który podział obsługuje bez nowej
  tabeli.
- *Wypłata z odłożonego zaszyta w kwocie linii wydatku (estimated − odłożone).* Linia
  wydatku przestałaby odpowiadać kwocie do zapłaty, a plan kontra wykonanie
  porównywałby różne rzeczy.

**Koszt.** `sourceState` liczony przy każdym odczycie szkicu edytowalnego — jedna
runda zapytań do źródeł na odczyt; przy kilkudziesięciu liniach bez znaczenia. Podział
reguły tworzy dwie reguły tam, gdzie użytkownik myśli o jednej — ekran *Cykliczne*
pokaże obie (stara z „do listopada 2026").

---

<a id="adr-077"></a>

## ADR-077 — Zamiana linii w regułę albo planowany wydatek; „nadchodzący" to planowany wydatek z datą

**Data:** 2026-10-27 · **Zadanie:** Faza 9 (plan) · **Status:** przyjęte (plan, przed implementacją)

**Kontekst.** Linię dopisaną w szkicu właściciel chce móc „łatwo zamienić w planowany
albo cykliczny wydatek, albo nawet jednorazowy nadchodzący wydatek z przyszłą datą".

**Decyzja.**

1. Dwa cele zamiany: **pozycja cykliczna** (wydatek, wpływ, przelew na pulę) i
   **planowany wydatek** (tylko wydatek). Kombinacje w tabeli 07 §13.6; reszta → `422`.
2. **„Nadchodzący" wydatek nie jest nowym bytem** — to planowany wydatek z `dueOn`,
   zwykle bez odkładania. Już dziś robi dokładnie to, czego nadchodzący wydatek
   potrzebuje: „Nadchodzące" na dashboardzie, „Do zrobienia" z „Zapłacone" w swoim
   miesiącu, ostrzeżenia płynności. Arkusz zamiany pokazuje go jako jedną drogę
   („Planowany wydatek") z polem daty; odkładanie domyślnie wyłączone.
3. Byt powstaje przez **serwis modułu docelowego** (`recurringService`,
   `plannedExpensesService`) — te same walidacje i komunikaty co z jego ekranu. Całość
   w jednej transakcji bazy, z `Idempotency-Key`.
4. Po zamianie linia staje się powiązana. Reguła dostaje `start_month = M`, a istniejące
   szkice późniejszych miesięcy — jej linię od razu.
5. Planowany wydatek z terminem w innym miesiącu niż szkic: linia **znika** ze szkicu M
   i pojawia się w szkicu miesiąca terminu, jeśli ten istnieje (`lineMovedTo` w odpowiedzi
   — toast mówi, dokąd).
6. Zamiana w drugą stronę (reguła → linia własna) to „Zostaw jako własną" — tylko dla
   linii osieroconych; dla zwykłych wystarczy wykluczenie.

**Odrzucone.**

- *Trzeci byt „jednorazowy wydatek z datą" (np. przyszła transakcja `pending`).* Dublowałby
  planowany wydatek bez odkładania, a przyszła transakcja w księdze łamie zasadę, że
  księga to przeszłość i teraźniejszość (I-8).
- *Zamiana w cel.* Cel to zamiar wieloletni, nie pozycja miesiąca; „Dodaj cel" jest
  na ekranie celów. Do rozważenia, jeśli się okaże potrzebne.
- *Zamiana bez drugiego kroku (z domyślnym terminarzem).* Reguła bez dnia płatności
  i konta zakłada się „po cichu" źle; dzień bierzemy z `dueOn` linii, gdy jest, a resztę
  pokazujemy w arkuszu.

**Koszt.** Moduł `budget` woła dwa serwisy w obrębie swojej transakcji — serwisy muszą
dać się wywołać wewnątrz transakcji wywołującego (do sprawdzenia przy `F9-5`; wzorzec
z „Zapisz jako stały", ADR-051).

---

<a id="adr-078"></a>

## ADR-078 — Średnia kategorii: pełne miesiące przed bieżącym, bez pozycji powiązanych, zera się liczą, w górę do złotówki

**Data:** 2026-10-27 · **Zadanie:** Faza 9 (plan) · **Status:** przyjęte (plan, przed implementacją)

**Kontekst.** Dla kategorii zmiennych („Jedzenie") właściciel chce wziąć do planu
średni wydatek. Średnia musi być uczciwa wobec szkicu, w którym stałe pozycje są już
osobnymi liniami.

**Decyzja** (wzory: 07 §13.3).

1. Okno: **3, 6 albo 12 pełnych miesięcy przed bieżącym**, domyślnie 3. Okno nie zależy
   od planowanego miesiąca — najświeższą wiedzą są ostatnie pełne miesiące.
2. Kategoria główna z podkategoriami (jak rozbicie w 07 §12.4).
3. **Bez transakcji powiązanych** z wystąpieniem cyklicznym, planowanym wydatkiem albo
   zobowiązaniem — inaczej czynsz z reguły byłby w szkicu dwa razy.
4. Miesiące bez wydatku liczą się jako **0**; mianownik ograniczony do miesięcy od
   pierwszej transakcji gospodarstwa (krótka historia nie zaniża średniej).
5. Wynik zaokrąglony **w górę do pełnego złotego** — plan ma być ostrożny.
6. Zapytanie żyje w `transactions.ledger.ts` (agregat księgi wystawiany innym modułom,
   02 §3) — moduł `budget` nie czyta tabeli transakcji sam.
7. Linia zapamiętuje `average_months`; przy kopiowaniu do innego szkicu kwota liczona
   jest na nowo.

**Odrzucone.**

- *Mediana.* Odporna na jednorazowe skoki, ale przy 3 miesiącach to po prostu środkowy
  miesiąc; średnia z podglądem miesięcy (`byMonth`) mówi więcej.
- *Średnia tylko z miesięcy z wydatkiem* (jak tempo celu, 07 §4.2). Rzadki wydatek
  (fryzjer co dwa miesiące) wyszedłby dwa razy za wysoki.
- *Średnia liczona do planowanego miesiąca (przesuwające się okno).* Dla miesięcy
  przyszłych okno zawierałoby miesiące bez danych.
- *Automatyczne linie ze średniej dla wszystkich kategorii.* Zaśmieca szkic; kategorie
  wybiera się w arkuszu wypełniania.

**Koszt.** Średnia nie widzi sezonowości (grudzień droższy) — przy 12 miesiącach
częściowo, ale planista i tak poprawia kwotę ręcznie.

---

<a id="adr-079"></a>

## ADR-079 — Ocena szkicu, plan kontra wykonanie, moduł `budget` bez wyjątku od warstw, wejście z „Więcej"

**Data:** 2026-10-27 · **Zadanie:** Faza 9 (plan) · **Status:** przyjęte (plan, przed implementacją)

**Kontekst.** Celem planowania jest odpowiedź „czy dowiozę cele". Trzeba ustalić, co
szkic ocenia, gdzie mieszka kod i jak się do planera wchodzi.

**Decyzja.**

1. **Ocena** (07 §13.4): bilans `leftover = income − expense − savings − investment`
   (lustro `net` z 07 §12.1), rozkład docelowy z wersji obowiązującej w M (pula po puli,
   z niedoborem), cele (wymaganie z terminu celu albo z planu wpłat), odkładanie na
   planowane wydatki, ostrzeżenia. **Informuje, nie blokuje.** Plan nie ma statusu
   „w tempie" — dotyczy całego miesiąca.
2. „Dodaj brakujące X" dopisuje linię własną z niedoborem — jedno dotknięcie, jak
   „Uzupełnij" na dashboardzie (ADR-054).
3. **Plan kontra wykonanie** (07 §13.8) dla bieżącego i minionych miesięcy, w tej
   samej odpowiedzi co szkic (`actuals`). Linie własne grupowane po kategorii głównej —
   księga nie wie, której z dwóch linii „Jedzenie" dotyczy zakup. „Poza planem" pokazuje
   wydatki bez linii.
4. Moduł `modules/budget/` (routes · service · repository · mapper · types) — **bez
   wyjątku od 02 §3**: źródła czyta przez serwisy (`recurring`, `planned-expenses`,
   `goals`, `liabilities`, `allocation`, `income-sources`), agregaty księgi przez
   `transactions.ledger.ts`. Czyste wyliczenia w `shared/domain/budget.ts` (100%
   pokrycia, jak alokacje).
5. Odpowiedzią każdej zmiany jest cały szkic — ocena zależy od wszystkich linii, front
   nie liczy jej sam.
6. Wejście: *Więcej → Budżet* i pasek boczny; na dashboardzie podpowiedź „Zaplanuj
   listopad" w ostatnich 7 dniach miesiąca (gdy następny nie ma szkicu) i odnośnik
   w podglądzie przyszłego miesiąca — sekcja `budget` w `GET /months/:key/summary`,
   liczona przez `budgetService`. Bez nowej zakładki dolnego paska.
7. Eksport JSON (`fineapp-export` v1) i „Usuń wszystkie dane" obejmują obie tabele;
   scalanie kategorii przepina `budget_draft_lines.category_id`. W `EXPORT_TABLES`
   szkice i linie stoją **przed** `transactions` — transakcje zostają ostatnie, jak
   wymaga test kolejności, a linie i tak idą po wszystkich źródłach, na które wskazują
   (ustalone przy `F9-1`). Wersja formatu bez zmian: dochodzą tabele, kształt pliku ten
   sam, a importu jeszcze nie ma (`Z-46`).

**Odrzucone.**

- *Kafel „plan kontra wykonanie" na dashboardzie.* Dashboard ma już siedem sekcji;
  najpierw sprawdzimy, czy ekran szkicu wystarcza (`F8-10` — miesiąc używania).
- *Moduł `budget` z własnym repozytorium wielotabelowym (jak `months`).* Szkic nie jest
  ekranem głównym i nie ma wymagania 1,5 s; złożenie z serwisów jest wolniejsze, ale
  zgodne z regułami warstw. Wrócimy do tego tylko po pomiarze.
- *Prognoza salda kont ze szkiców.* Szkic opisuje przepływ, nie stan kont; prognoza
  płynności zostaje w planowanych wydatkach (07 §6.5).

**Koszt.** Odczyt szkicu woła kilka serwisów; przy kilkudziesięciu liniach i dwóch
osobach to pojedyncze milisekundy, ale bez pomiaru to założenie.

**Uzupełnienie (2026-10-27, `F9-4`) — kody błędów i drobne ustalenia API.**

1. **Standardowe kody błędów** zamiast planowanych `BUDGET_*`: `404 NOT_FOUND`,
   `409 CONFLICT` (szkic istnieje, szkic tylko do odczytu), `422 DOMAIN_RULE_VIOLATION`
   (zakres miesięcy, odwołania, akcje niedozwolone dla linii). `ErrorCode` jest wspólnym
   zbiorem dla całego API (`core/errors.ts`, 04 §2–§3), a front rozróżnia sytuacje
   komunikatem i statusem — osobne kody dla jednego modułu nic by nie dały.
2. `DELETE …/lines/:lineId` zawsze `200` z całym szkicem (także dla linii własnej) —
   front i tak podmienia cały szkic, a `204` wymagałby osobnego odczytu.
3. Odczyt źródeł przez serwisy: `listGoals`, `listLiabilities`, `listPlannedExpenses`,
   `listIncomeSources`, `listCategoriesFlat`, `getAllocationTarget`, `lookupAccount`
   oraz nowe wejście `recurring.external.budgetRuleSources` (reguły z wystąpieniami
   miesiąca i klasami kont — tylko odczyt, nic nie generuje).
4. Doprecyzowania reguł (ADR-045 w kwocie reguły, „Przyjmij" przy `in_sync`, pamiątka
   średniej, rata zapłacona w bieżącym miesiącu) — 07 §13.5.

**Uzupełnienie (2026-10-27, `F9-5`) — zamiana i „Zastosuj" w kodzie.** Dotyczy też
ADR-076 i ADR-077:

1. „Zastosuj w regule" **nie obejmuje reguł tygodniowych i co dwa tygodnie** — linia
   szkicu niesie sumę kilku terminów miesiąca, więc kwota jednej płatności jest nieznana
   (np. 150 zł w grudniu to 5 × 30 zł, w listopadzie 4 × 30 zł). Zgadywanie przez
   dzielenie dałoby kwotę zależną od miesiąca. `BudgetApplyContext.isWeeklyRule`
   w `shared/domain/budget.ts`; zmiana kwoty takich reguł — na ekranie *Cykliczne*.
   Skutek uboczny: podział dotyczy tylko reguł liczonych w miesiącach, więc nie trzeba
   przesuwać kotwicy `biweekly`.
2. Zamiana linii puli w przelew sprawdza klasy kont (`transferBudgetFlow`) — reguła,
   która w szkicu dałaby linię innej puli, nie powstaje.
3. Zamiana w regułę bez terminu w miesiącu szkicu → `422` (reguła cofnięta w tej samej
   transakcji) — linia należy do miesiąca, którego reguła by nie dotyczyła.
4. Obie akcje: nagłówek `Idempotency-Key` wymagany, całość w transakcji
   `runIdempotent` — serwisy reguł, planowanych wydatków i celów otwierają własne
   transakcje, które `better-sqlite3` zagnieżdża jako punkty zapisu.

**Uzupełnienie (2026-10-27, `F9-8`) — sekcja `budget` i wejścia.**

1. Sekcja `budget` ma dwa pola ponad plan: `canCreate` (podgląd przyszłości poza
   zakresem [bieżący, +12] nie pokazuje „Zaplanuj", które skończyłoby się `422`)
   i `suggestNextMonth` (kiedy podpowiadać, liczy serwer — tak jak `suggestedMonth`
   listy, wspólną funkcją `isNearBudgetMonthEnd`; ekran tylko rysuje).
2. Mutacje szkicu unieważniają także `qk.months()` — „Zostaje" i podpowiedź w sekcji
   `budget` zależą od szkicu.
3. *Budżet* w „Więcej" i pasku bocznym stoi zaraz po *Planowane* — obok rzeczy, z których
   szkic się składa.

**Uzupełnienie (2026-10-27, `F9-9`) — wykonanie.**

1. Wykonanie liczy czysta funkcja `budgetActuals` w `shared` z wierszy księgi miesiąca
   (`transactions.ledger.monthLedger`, `posted`, spoza kosza, z regułą wystąpienia
   przez złączenie) — zamiast kilku sum SQL. Jedno źródło przypisania transakcji do linii,
   testowane bez bazy; miesiąc to najwyżej kilkaset wierszy.
2. Linia reguły bierze transakcje z `month_key = M`, nie wystąpienia z M — spójnie z sumami
   miesiąca (07 §13.8 „Doprecyzowania z `F9-9`").
3. Wpływ własny z kategorią ma wykonanie grupowe po kategorii (arkusz linii nie ma
   wyboru źródła przychodu; bez tego żadna linia wpływu własnego nie miałaby wykonania).
4. Grupa kilku linii pokazuje wykonanie pod ostatnią linią z podpisem „{kategoria}
   razem" zamiast osobnego nagłówka — mniej elementów na 390 px.

## ADR-080 — Po wdrożeniu przeładowanie nginx bramy; publiczny health check jako błąd

**Data:** 2026-10-27 · **Zadanie:** wydanie Fazy 9 · **Status:** przyjęte

**Kontekst.** Pierwsze wdrożenie Fazy 9 skończyło się zielonym jobem i `502` dla
użytkowników. Kontener był zdrowy, migracja przeszła, ale log bramy pokazywał
`connect() failed (113: No route to host) … upstream: http://172.19.0.4:3000`, gdy
nowy `fineapp-app` miał w `gateway-net` adres `172.19.0.3`. nginx w https-portal
rozwiązuje nazwę z `proxy_pass` raz, przy wczytaniu konfiguracji; `docker compose up -d`
tworzy kontener od nowa, a adres dostaje ten, który akurat jest wolny. Wcześniejsze
wdrożenia trafiały na ten sam adres przypadkiem. Publiczny health check był
ostrzeżeniem (z czasów przed dopisaniem domeny, §12.5), więc job tego nie zgłosił.

**Decyzja.**
1. W `deploy-prod.yml`, po zdrowym kontenerze: `nginx -t`, potem `nginx -s reload`
   w kontenerze bramy (znalezionym po obrazie `https-portal`). Bez bramy — ostrzeżenie;
   konfiguracja nie przechodzi `nginx -t` — błąd joba **bez** przeładowania.
2. Publiczny `GET /api/v1/health` przez bramę — do 6 prób co 5 s, potem **błąd** joba.

**Odrzucone.**
- *Restart kontenera bramy* — każdy start odnawia certyfikaty wszystkich serwisów
  i może się zapętlić (10 §12.7).
- *Stały adres `fineapp-app` w `gateway-net`* (`ipv4_address`) — podsieć należy do bramy
  i innych serwisów; ręcznie przydzielony adres to kolizja czekająca na kolejny serwis.
- *`resolver 127.0.0.11` i zmienna w `proxy_pass`* — wymaga własnej konfiguracji nginx
  w bramie wspólnej dla wszystkich serwisów; zmiana poza tym repozytorium.

**Skutki.** Wdrożenie przeładowuje nginx całej bramy — łagodnie (stare procesy kończą
bieżące żądania), bez przerwy dla innych serwisów i bez odnawiania certyfikatów.
Klucz wdrożeniowy i tak ma dostęp do Dockera, więc uprawnień nie przybywa.


<a id="adr-081"></a>

## ADR-081 — Planer: kolejność linii i grupy w sekcji, tryb „Układaj", układ przechodzi na następny miesiąc

**Data:** 2026-10-28 · **Zadanie:** `F9-11`…`F9-13` · **Status:** przyjęte

**Kontekst.** Po miesiącu z planerem właściciel poprosił o dwie rzeczy na ekranie szkicu:
**przeciąganie pozycji** na liście i **dzielenie ich na grupy** („Mieszkanie i media",
„Raty", „Subskrypcje"). Sekcja *Wydatki* ma kilkanaście linii w kolejności dopisania —
przy piętnastu pozycjach nie widać, ile idzie na co. Propozycja wizualna:
[`design/mockups/budget-layout.html`](../design/mockups/budget-layout.html), zatwierdzona
z czterema rozstrzygnięciami (wszystkie „tak").

**Decyzja.**

1. **Grupy są prezentacyjne.** Nie zmieniają bilansu, oceny (07 §13.4) ani wykonania
   linii (07 §13.8). Nowa tabela `budget_draft_groups` (03 §3.21) i kolumna
   `budget_draft_lines.group_id` (`ON DELETE SET NULL`).
2. **Grupa żyje w jednej sekcji** szkicu: `income`, `expense` albo `pools`
   (oszczędności i inwestycje razem — jak sekcja na ekranie). Linia może należeć tylko
   do grupy swojej sekcji (I-25). Nazwa unikalna w sekcji szkicu, bez względu na
   wielkość liter (po niej układ przechodzi na następny miesiąc).
3. **Kolejność** to `sort_order` linii w szkicu, zapisywana hurtem przez
   `PATCH /budget-drafts/:month/layout` — cały układ jednej sekcji naraz (grupy w kolejności
   i ich linie, potem linie bez grupy), jak `PATCH /accounts/order`. Jedno żądanie
   po upuszczeniu zamiast N zmian linii; brak stanu pośredniego przy zerwanym łączu.
   Linie bez grupy stoją **na końcu** sekcji; tam trafiają nowe linie i to, co przyniesie
   „Odśwież ze źródeł".
4. **Układ przechodzi na następny miesiąc** (rozstrzygnięcie 1). Założenie szkicu — każdą
   drogą, także „Zacznij od zera" — kopiuje grupy z planu, z którego kopiujemy linie
   własne, a bez niego z najbliższego wcześniejszego planu. Linie nowego szkicu dostają
   grupę i miejsce linii odpowiadającej im w planie źródłowym (07 §13.10): najpierw po
   źródle (reguła, planowany wydatek, cel, zobowiązanie; linia własna — po kategorii
   i nazwie), potem po stronie bilansu i nazwie — to łapie regułę podzieloną przez
   „Zastosuj w regule" i regułę założoną od nowa.
5. **Wszystkie trzy sekcje** mogą mieć grupy (rozstrzygnięcie 2).
6. **Szybki start** (rozstrzygnięcie 3): `POST …/groups/by-origin` zakłada w sekcji bez
   grup do trzech grup według pochodzenia linii — *Stałe* (cykliczne, raty), *Planowane*
   (planowane i odkładanie), *Zmienne* (średnie, własne, cele) — pomijając puste.
7. **Szkic miniony bez układania** (rozstrzygnięcie 4) — trasy grup i układu odpowiadają
   `409` jak każda zmiana szkicu (I-20).
8. **Interfejs:** układanie to osobny tryb „Układaj" w nagłówku sekcji, nie ukryty gest —
   dotknięcie wiersza dalej otwiera arkusz linii. Uchwyt 44 px po prawej; bez gestu:
   pole „Grupa" w arkuszu linii, „Przesuń wyżej / niżej" w arkuszu grupy, klawiatura
   na uchwycie. Na desktopie (wskaźnik precyzyjny) uchwyt pokazuje się też po najechaniu
   na wiersz poza trybem. Zwinięcie grupy pamięta przeglądarka (per sekcja i nazwa, więc
   też w kolejnych miesiącach), nie szkic.
9. **Wykonanie grupy** (07 §13.8): nagłówek grupy w miesiącu bieżącym i minionym pokazuje
   „wydano X · zostało Y", gdy wszystkie wspólne wykonania kategorii (grupy linii jednej
   kategorii) jej linii leżą w całości w tej grupie; inaczej sam plan. Liczone na froncie
   z `actuals` (jak wykonanie linii), bez nowych pól w API.
10. **Nowa zależność frontu: `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`.**
    Przeciąganie dotykiem, myszą i klawiaturą z komunikatami dla czytnika ekranu.

**Odrzucone.**
- *Grupy na poziomie gospodarstwa* (wspólne dla wszystkich szkiców) — przydział linii
  i tak jest per szkic (linia żyje w szkicu), więc tabela gospodarstwa wymagałaby
  drugiej tabeli przydziałów; kopiowanie przy zakładaniu daje to samo prościej i pozwala
  zmienić układ jednego miesiąca bez psucia innych.
- *Grupa jako tekstowa etykieta na linii* — zmiana nazwy i kolejność grup musiałyby
  przechodzić przez wszystkie linie; pustej grupy nie da się zapisać.
- *Długie przytrzymanie wiersza jako start przeciągania* — koliduje z przewijaniem jedną
  ręką i z dotknięciem otwierającym arkusz; nie do odkrycia.
- *Natywne HTML5 drag & drop* — nie działa na dotyku.
- *Własna obsługa wskaźnika* (jak w makiecie) — wystarczy do makiety; klawiatura,
  przewijanie przy krawędzi i komunikaty dla czytnika to właśnie to, co daje biblioteka.

**Skutki.** Migracja `0006_budget_draft_groups` (nowa tabela + kolumna, bez przepisywania
danych; istniejące szkice nie mają grup i wyglądają jak dotąd). Eksport i „Usuń wszystkie
dane" obejmują `budgetDraftGroups`. Paczka frontu: dnd-kit tylko we fragmencie ekranu
planera (ładowany leniwie), ścieżka krytyczna bez zmian.

<a id="adr-082"></a>

## ADR-082 — Pasek boczny z profilem, Ustawienia na dole, przełącznik motywu i „Wyloguj"

**Data:** 2026-10-28 · **Zadanie:** dopracowanie nawigacji (po `F9-13`) · **Status:** przyjęte

**Kontekst.** Właściciel poprosił o pasek boczny na wzór pliku Figma „Sidebar Dashboard":
profil u góry, ładniejszy przełącznik motywu, „Wyloguj" na dole i Ustawienia oddzielone
od reszty. Dziś „Wyloguj" jest tylko na dole ekranu Ustawień, a pasek ma płaską listę
„Więcej" z Kategoriami i Ustawieniami pomiędzy ekranami planowania. Makieta:
[`design/mockups/sidebar.html`](../design/mockups/sidebar.html).

**Decyzja.**
1. **Profil** u góry paska i ekranu „Więcej": kółko z inicjałami (zdjęć nie ma), nad imieniem
   nazwa gospodarstwa małymi kapitalikami, małe kółko z inicjałem drugiego domownika
   (`GET /settings`, już w pamięci po wejściu w Ustawienia). Dotknięcie → `/settings`.
   Kolor kółka z tokenów (`--primary` z przezroczystością) — `avatarColor` dalej czeka na
   paletę awatarów (Z-43).
2. **Grupy:** „Miesiąc" (pozycje dolnego paska), „Planowanie" (dawne „Więcej" bez
   Kategorii i Ustawień), a **Kategorie i Ustawienia** w klastrze na dole, **bez
   nagłówka** — nagłówek „Ustawienia" nad pozycją „Ustawienia" czytał się jak powtórzenie.
   `secondaryNav()` dzieli się na `planningNav()` i `settingsNav()`.
3. **Przełącznik motywu**: dwa pola „Jasny / Ciemny" z przesuwanym podkładem
   (`aria-pressed`). Ustawia jawny wybór; „Systemowy" zostaje w Ustawieniach → Wygląd.
4. **„Wyloguj"** na dole paska i ekranu „Więcej", kolor `--danger`, bez potwierdzenia —
   wylogowanie jest odwracalne jednym PIN-em, a `danger` w przycisku z tłem (15 §4.3)
   zostaje dla operacji nieodwracalnych (tu: przycisk tekstowy).
5. Szerokość 248 px, szyna 76 px; przycisk zwijania — okrągły na prawej krawędzi.
   „Rozkład docelowy" dostaje ikonę `PieChart` (dotąd tarcza jak „Cele").

**Odrzucone.** Nagłówek grupy „Ustawienia" / „Konfiguracja" — drugi napis do przeczytania,
gdy samo położenie na dole oddziela grupę. Rozwijane podmenu jak w pliku Figma — FineApp
nie ma ekranów z podstronami w nawigacji.

**Skutki.** Pasek i ekran „Więcej" pytają o `GET /settings` (domownicy) — jedno zapytanie
na sesję, z pamięcią TanStack Query; bez niego profil pokazuje tylko zalogowaną osobę.

**Uzupełnienie (ten sam dzień, po pierwszym użyciu).** Na niższym oknie (~780 px) środek
paska się przewijał i właścicielowi przeszkadzał pasek przewijania. Zmiany:
- „Wyloguj" i przełącznik motywu w **jednym rzędzie** (przełącznik z samymi ikonami,
  `aria-label` „Motyw jasny / ciemny"); w szynie bez zmian.
- Nagłówki grup to przyciski — grupę da się **złożyć**; złożona pokazuje tylko pozycję
  bieżącej strony. Stan w `localStorage` (`fineapp.sidebar.folded`).
- Mniejsze odstępy (linie `my-3`, wiersze bez przerw, dół `gap-1`) — przy 780 px wszystko
  mieści się rozłożone.
- Gdy i tak brakuje miejsca: pasek przewijania niewidoczny, dopóki kursor nie stoi nad
  paskiem (zmienia się tylko kolor, więc bez skoku układu), a na dole cieniowanie mówi,
  że niżej jest coś jeszcze.

Odrzucone: wiersze 40 px na desktopie — pasek widać od 768 px, czyli także na tabletach
dotykowych, a 15 §2 wymaga 44 px.

<a id="adr-083"></a>

## ADR-083 — Otwarcie kodu: licencja MIT, wyłącznie fikcyjne dane przykładowe

**Data:** 2026-10-29 · **Zadanie:** przygotowanie do publikacji (poza roadmapą) · **Status:** przyjęte

**Kontekst.** Projekt ma zostać opublikowany jako open source dla polskich użytkowników.
Testy, makiety i przykłady w planie zawierały imiona i inicjały prawdziwych osób,
a makieta planera — pozycje i kwoty przepisane z prawdziwego szkicu budżetu.

**Decyzja.**

1. Kod i dokumentacja na licencji **MIT** (`LICENSE`, pole `license` w `package.json`),
   właściciel praw: „FineApp contributors".
2. **Dane przykładowe są wyłącznie fikcyjne.** Domownicy w testach, makietach i planie to
   „Adam Kowalski" (`AK`) i „Basia" (`BN`), adresy w domenie `example.com`. Nie
   przepisujemy do repozytorium pozycji ani kwot z prawdziwych zrzutów ekranu — przy
   makiecie „na prawdziwych danych" wymyślamy dane o tym samym kształcie.
3. Makiety ekranu miesiąca, formularza, paragonu i kierunków (`design/`) dostały nowe
   kwoty z **zachowaniem procentów** (17% / 10% / −3%, 35%, 60%, 33%), więc pierścienie
   i przypadki brzegowe (kwota siedmiocyfrowa ujemna, ujemne wykonanie celu) wyglądają
   tak samo. Makieta planera (`budget-layout.html`) i schemat w 06 §3.14 — fikcyjne
   pozycje, sumy grup i wykonanie przeliczone.

**Konsekwencje.** Liczby w makietach (np. wpływy 10 400 zł) nie są już identyczne
z przykładem obliczeniowym w 04 §10–11 (wpływy 11 800 zł); makiety są materiałem
projektowym, nie specyfikacją, więc rozjazd jest akceptowalny.

<a id="adr-084"></a>

## ADR-084 — Porównanie miesięcy: sufit wzrostu +1000%

**Data:** 2026-11-01 · **Zadanie:** błąd produkcyjny (poza roadmapą) · **Status:** przyjęte

**Kontekst.** Ekran listopada kończył się „Nie udało się wczytać miesiąca" (HTTP 500,
`FST_ERR_RESPONSE_SERIALIZATION`). `comparison.incomeDeltaBps` przekroczyło 100 000 —
granicę `SignedBpsSchema`. W październiku wpływów prawie nie było (mała, niezerowa kwota),
w listopadzie doszła pensja. 07 §12.3 opisywało zerową podstawę, ale nie małą: spadek
kończy się na −100%, wzrost nie ma górnej granicy. Ten sam błąd groził `expenseDeltaBps`.

**Decyzja.** `compareMonths` obcina oba procenty do `MAX_DELTA_BPS = 100 000` (+1000%,
stała w `packages/shared`, ta sama, która ogranicza `SignedBpsSchema`). Front przy
wartości na sufitcie pokazuje „↑ >1000% do października", dla czytnika „o ponad 1000%
więcej niż w październiku". Zmienione: 07 §12.3, 06 §3.1, 05 (`MonthComparisonDto`).

**Odrzucone.** Zdjęcie górnej granicy ze schematu dla różnic — „↑ 11 900%" niczego nie
mówi więcej niż „>1000%", a kontrakt zostałby bez sufitu. Ukrywanie procentu powyżej
progu — strzałka bez liczby wygląda jak zerowa podstawa, którą UI pokazuje inaczej.

**Konsekwencje.** Procent na sufitcie nie jest dokładny; dokładną różnicę niesie
`incomeDeltaMinor` / `expenseDeltaMinor`.
