# 13 — Status prac

> Stan realizacji faz, sprawy zauważone do rozważenia i wskaźniki jakości.
> Plan zadań: [11-roadmap.md](./11-roadmap.md).

**Ostatnia aktualizacja:** 2026-10-29 (przygotowanie do otwarcia kodu, ADR-083)
**Aktualna faza:** Faza 8 (dopracowanie i wdrożenie) — 9 / 10, **aplikacja działa produkcyjnie**; zostaje `F8-10` (miesiąc użytkowania). Faza 7 nadal czeka na pomiar `F7-11`. **Faza 9 (planer budżetu) w toku** — backend i ekrany (`F9-1`…`F9-6`), następne `F9-7` (arkusze)
**Stan:** ✅ typecheck · lint · format · **2375 testów zielonych**

---

## Postęp faz

| Faza | Zakres | Stan | Postęp |
|---|---|---|---|
| — | Planowanie i szkielet projektu | ✅ zrobione | 100% |
| 0 | Fundament (core, baza, serwer, design system) | ✅ zrobione | 9 / 9 |
| 1 | Logowanie | ✅ zrobione | 8 / 8 |
| 2 | Konta i transakcje | ✅ zrobione | 9 / 9 |
| 3 | Ekran miesiąca | ✅ zrobione | 7 / 7 |
| 4 | Pozycje cykliczne i zobowiązania | ✅ zrobione | 9 / 9 |
| 5 | Cele i rozkład procentowy | ✅ zrobione | 9 / 9 |
| 6 | Planowane wydatki | ✅ zrobione | 9 / 9 |
| 7 | OCR i AI | ✅ zrobione (`F7-11` potwierdzone przez właściciela) | 11 / 11 |
| 8 | Dopracowanie i wdrożenie | 🟡 działa produkcyjnie; zostaje `F8-10` | 9 / 10 |
| 9 | Planer budżetu ([16](./16-budget-planner.md)) | ✅ zrobione (grupy i kolejność) | 13 / 13 |

---

---

## Zauważone — do rozważenia poza bieżącym zakresem

| # | Obserwacja | Waga |
|---|---|---|
| Z-1 | ~~Wersje pakietów niezweryfikowane instalacją~~ — zrobione, [ADR-014](./14-decisions-log.md#adr-014) | — |
| Z-2 | ~~Parametry argon2id wymagają pomiaru na docelowym VPS~~ — **zmierzone**: 177 ms haszowanie / 171 ms weryfikacja; t=3 zostaje ([ADR-066](./14-decisions-log.md#adr-066)) | — |
| Z-3 | ~~Ikony PWA nie istnieją~~ — **zrobione w `F0-8`**: generowane z tokenów przez `design/tools/generate-icons.mjs`, motywem pierścień wykonania z ADR-013 | — |
| Z-4 | ~~Brak repozytorium git~~ — zrobione | — |
| Z-5 | Zestaw 20 rzeczywistych paragonów do oceny OCR — **zbiera właściciel**; narzędzie pomiaru gotowe (`ocr:evaluate`, sekcja „W toku") | średnia |
| Z-6 | `zod` 3.25.76 to ostatnia wersja gałęzi 3.x. Migracja do 4.x dotknie **każdego** DTO w `packages/shared` i wymusi type provider ciągnący `@fastify/swagger` — [ADR-014](./14-decisions-log.md#adr-014) | średnia |
| Z-7 | Korzeniowy `tsconfig.json` ma `references` do paczek, które nie są `composite` — `tsc -b` w korzeniu nie zadziała. Dziś nic go nie wywołuje | niska |
| Z-8 | ~~`--passWithNoTests`~~ — **zdjęte ze wszystkich trzech paczek**; każda ma własne testy | — |
| Z-11 | ~~`ON DELETE SET NULL` kontra I-12/I-18~~ — **rozstrzygnięte przed `F4-1`**: usunięcie transakcji z zaksięgowania cofa zaksięgowanie (07 §6.7, [ADR-042](./14-decisions-log.md#adr-042)); implementacja w `F4-3` i Fazie 6 | — |
| Z-12 | ~~`format:check` nie przechodzi~~ — **zrobione**: jednorazowe formatowanie, `format:check` w bramce; `*.md` i `design/` poza Prettierem ([ADR-042](./14-decisions-log.md#adr-042)) | — |
| Z-13 | `categories.repository.reassignConfigurationReferences` przepina przy scalaniu wiersze tabel modułów, które jeszcze nie istnieją (`recurring_rules`, `planned_expenses`, `liabilities`, `document_items`). Czasowe odstępstwo od 02 §3 ([ADR-033](./14-decisions-log.md#adr-033)): ~~`F4-1`~~ (reguły — ADR-043), ~~`F4-4`~~ (zobowiązania — ADR-047), ~~`F6-1`~~ (planowane wydatki — ADR-055); ~~`F7-*` przenosi `document_items`~~ — **zrobione w `F7-5`** (`documents.external.ts`, ADR-059) | — |
| Z-14 | ~~`/categories/spending` kontra `/months/:key/categories`~~ — **rozstrzygnięte w `F3-2`**: zostaje raport miesiąca ([ADR-039](./14-decisions-log.md#adr-039)); `GET /income-sources/summary` (04 §12) do przemyślenia w tym samym duchu | — |
| Z-15 | ~~Lista osób do pola „czyje”~~ — **zrobione w `F8-1`**: `GET /settings` zwraca domowników, ekran `/settings/income-sources` ma pole „Czyje” ([ADR-061](./14-decisions-log.md#adr-061)) | — |
| Z-16 | ~~`POST /transactions` nie przyjmuje `Idempotency-Key`~~ — **zrobione w `F2-7`**: klucz po stronie API, jeden na otwarcie formularza ([ADR-037](./14-decisions-log.md#adr-037)) | — |
| Z-17 | ~~Okno księgowania sprawdzane tylko przy zapisie daty~~ — **rozstrzygnięte w `F3-3`**: zamknięty miesiąc ma zamrożone liczby, opisy do poprawienia ([ADR-040](./14-decisions-log.md#adr-040)) | — |
| Z-18 | ~~Brak filtra „bez kategorii"~~ — **zrobione w `F3-4`**: `uncategorized=true` w API i historii, licznik na dashboardzie ([ADR-041](./14-decisions-log.md#adr-041)) | — |
| Z-19 | Szczegóły konta (06 §3.7) zapowiadają wykres zmian salda w 12 miesiącach — API nie ma trasy sald miesiąc po miesiącu. Do dodania razem z wykresami (Faza 3 albo 8); rozważyć `GET /accounts/:id/balance-history?months=12` liczone jednym zapytaniem | niska |
| Z-20 | Pole daty w formularzu to natywne `<input type="date">` — format zależy od języka przeglądarki (w Chromium z `en-US` pokazuje `09/23/2026`). Na polskim telefonie jest `23.09.2026`; własny wybór daty dopiero, gdyby to przeszkadzało | niska |
| Z-21 | `PATCH /accounts/order` nie ma jeszcze interfejsu — kolejność kont to kolejność założenia. Przeciąganie wierszy do rozważenia w Fazie 8 | niska |
| Z-22 | Wybór kategorii w formularzu nie ma sekcji „Ostatnio używane" ani siatki ikon (06 §3.3, 15 §4.10): API nie zwraca statystyki użycia, a kategorie z seeda nie mają ikon. Do rozważenia razem: ikony w seedzie i np. `GET /categories/recent?kind=` z ostatnich 30 dni. Przy dziesiątkach kategorii wyszukiwarka wystarcza | niska |
| Z-24 | Odświeżenie gestem (pociągnięcie w dół) na *Historii* i *Miesiącu* (06 §5) — nie powstało w `F2-8`; dane i tak odświeżają się po każdym zapisie i powrocie do karty. W `F3-4` też nie — dashboard odświeża się po zapisie, powrocie do karty i przy przełączaniu miesiąca; odsunięte do Fazy 8 (dopracowanie) | niska |
| Z-25 | ~~Plakietka „systemowa" przy prawie każdej kategorii~~ — **zrobione**: „własna" przy kategoriach domowników ([ADR-042](./14-decisions-log.md#adr-042)) | — |
| Z-26 | ~~2,6 s na „wolnym 4G"~~ — **zamknięte**: celem jest zwykłe 4G, spełnione 1,3 s (decyzja właściciela, [ADR-042](./14-decisions-log.md#adr-042)) | — |
| Z-27 | ~~API nie kompresuje odpowiedzi~~ — **sprawdzone**: brama https-portal oddaje `gzip`; `@fastify/compress` zbędny | — |
| Z-28 | ~~Reguła traci konto po jego usunięciu~~ — **rozstrzygnięte**: usunięcie i archiwizacja konta wstrzymują jego reguły; kategoria i źródło tylko czyszczone ([ADR-044](./14-decisions-log.md#adr-044)) | — |
| Z-29 | Czyszczenie kosza po 30 dniach (07 §10) nie ma jeszcze zadania konserwacyjnego — transakcje w koszu zostają bezterminowo. Przy jego pisaniu pamiętać, że transakcja z koszem i `recurring_occurrence_id` blokuje auto-księgowanie cofniętego wystąpienia (ADR-046); po czyszczeniu wystąpienie w oknie mogłoby się zaksięgować ponownie — czyścić tylko transakcje sprzed okna księgowania albo najpierw oznaczyć wystąpienie jako pominięte | niska |
| Z-30 | Pominięcia nie da się cofnąć z ekranu: API nie ma „unskip", a zaksięgowanie pominiętego (ADR-046) nie ma jeszcze przycisku — pominięte znika z „Do zrobienia". Do rozważenia: lista wystąpień miesiąca na `/recurring` z akcjami albo `POST /:id/unskip` | niska |
| Z-31 | `RecurringRuleDto.nextDueOn` liczy od dziś włącznie i nie pomija terminu już zaksięgowanego — czynsz zapłacony 8.09 przy regule „10. dnia" pokazuje „najbliższy 10 wrz" na `/recurring`. Do rozważenia: pomijać terminy z wystąpieniem `posted`/`skipped` (jedno zapytanie przy liście reguł) | niska |
| Z-32 | „Zapisz jako stały" tylko przy nowej transakcji — endpoint przyjmuje dowolną, ale historia i arkusz edycji nie mają akcji. Dołożyć w menu wiersza historii, gdy ktoś o to poprosi | niska |
| Z-23 | ~~Przelew nie ma pola „Na cel”~~ — **zrobione w `F5-5`** ([ADR-054](./14-decisions-log.md#adr-054)) | — |
| Z-33 | Szczegóły celu (`GET /goals/:id`: 24 ostatnie wpłaty, historia sześciu miesięcy) nie mają ekranu — `/goals/:id` otwiera arkusz edycji. Dołożyć, gdy przyda się historia wpłat | niska |
| Z-34 | `PATCH /goals/order` bez interfejsu — kolejność celów to kolejność założenia (jak `Z-21`) | niska |
| Z-35 | FAB na `/goals` otwiera zwykły formularz transakcji, a 15 §4.4 zapowiada „wpłatę na cel” — dziś wpłata jest przyciskiem na karcie | niska |
| Z-36 | Szczegóły planowanego wydatku (`GET /planned-expenses/:id` z historią odkładania) nie mają ekranu — `/planned/:id` otwiera arkusz edycji | niska |
| Z-37 | `POST /planned-expenses/:id/defer` bez przycisku — przesunięcie terminu idzie przez zmianę miesiąca w formularzu | niska |
| Z-38 | FAB na `/scan` otwiera formularz transakcji, a 06 §2 zapowiada aparat — kafel „Zrób zdjęcie" jest na ekranie największym elementem ([ADR-060](./14-decisions-log.md#adr-060)) | niska |
| Z-39 | Wyciąg zna konto z nagłówka (`accountHint`, np. „mBank 1234"), ale nie dopasowujemy go do kont — przegląd proponuje konto z wrzucenia albo jedyne konto „na życie" | niska |
| Z-40 | Zaznaczenie pozycji w przeglądzie żyje w przeglądarce — odświeżenie wraca do domyślnego (korekty treści zostają) | niska |
| Z-41 | Fastify 5.12 ostrzega `FSTDEP023` (`disableRequestLogging` w `server.ts`) — do przestawienia przed Fastify 6 | niska |
| Z-42 | Transakcje z dokumentu mają `source_document_id`, ale historia nie pokazuje jeszcze plakietki 📷 ani przejścia do zdjęcia (08 §11) | średnia |
| Z-43 | Kolor awatara — API go przyjmuje (`PATCH /settings/profile`), ale ekran nie oferuje wyboru: paleta awatarów nie ma tokenów, a surowe kolory są zabronione. Do zaprojektowania razem z awatarami w nagłówku | niska |
| Z-44 | `recharts` w zależnościach frontu, nieużywany — wykres trendu jest w SVG (ADR-063). Usunąć przy najbliższym porządku zależności | niska |
| Z-45 | ~~`build.sourcemap: true` publikuje mapy źródeł~~ — **potwierdzone na produkcji i wyłączone** (`sourcemap: false`, [ADR-066](./14-decisions-log.md#adr-066)) | — |
| Z-47 | Cel śledzony saldem konta nie liczy wpłat sprzed „saldo na dzień" konta — ani do salda (słusznie: saldo startowe je zawiera), ani do „wpłacono w tym miesiącu". Przelew z datą wstecz na konto założone później daje więc „brak wpłaty", choć pieniądze wpłynęły w tym miesiącu. Formularz przelewu nie ostrzega, że transakcja nie zmieni salda | średnia |
| Z-48 | „Usuń wszystkie dane" w trakcie odczytu dokumentu przez AI: zadanie analizy kończy się na usuniętym wierszu (błąd połykany w `documents.jobs.ts`), koszt odczytu i tak trafia do licznika. Niegroźne przy dwóch osobach; gdyby przeszkadzało — odrzucać reset przy dokumencie w stanie `processing` (ADR-072) | niska |
| Z-49 | ~~Nieznany element szerszy niż ekran~~ — **znaleziony**: `sr-only` w kaflach kont za prawą krawędzią; `relative` na taśmie i kontenerze ([ADR-074](./14-decisions-log.md#adr-074)) | — |
| Z-50 | `pnpm --filter @fineapp/shared test:coverage` nie przechodzi progu 100% (gałęzie i linie w `domain/document.ts`, `domain/liability.ts`, `domain/recurring.ts`, `dto/liability.ts`, `dto/recurring.ts`) — próg sprawdza tylko `test:coverage`, nie `pnpm test`, więc luka nie blokuje bramki. Do domknięcia testami albo włączenia `--coverage` w bramce | niska |
| Z-51 | `router.test.tsx` › „w trakcie sprawdzania sesji NIE migają ekranem logowania" — pada przy pełnym przebiegu web (nie znajduje „Nawigacja główna"), osobno zielony; pod obciążeniem (`pnpm test` z api równolegle) na limicie czasu pada więcej testów ekranów | średnia |
| Z-52 | Na Windowsie bez uprawnień do dowiązań `entry-point.test.ts` (symlink) i dwa testy `backup.test.ts` (usuwanie katalogu tymczasowego) padają na `EPERM` — do pominięcia warunkowego albo uruchamiania tylko w CI/Linuksie | niska |
| Z-46 | Eksport JSON nie ma jeszcze importu — format (`fineapp-export` v1, kolejność tabel pod klucze obce) jest pod niego przygotowany. Odtwarzanie całości idzie z kopii bazy (10 §5.4), nie z eksportu | niska |
| Z-9 | ~~`core/money.ts` kontra `shared/utils/money.ts`~~ — rozstrzygnięte w `F0-3`: całość w `shared`, [ADR-017](./14-decisions-log.md#adr-017) | — |
| Z-10 | ~~Brak konwersji `Date` → data biznesowa~~ — **zrobione w `F0-8`**, ale nie tam, gdzie zakładałem: pierwszym odbiorcą okazał się router frontu, więc funkcja mieszka w `shared/utils/date-tz.ts` i jest izomorficzna. `core/dates.ts` nie powstanie ([ADR-022](./14-decisions-log.md#adr-022)) | — |

---

## Wskaźniki jakości

Uzupełniane w miarę postępu prac.

| Wskaźnik | Cel | Stan |
|---|---|---|
| Pokrycie testami: `money`, `month`, alokacje, cykle | 100% | `money` i `month` ✅ **100%** (próg wymuszony); generator wystąpień (`recurring.rules.ts`) **100%** linii (`F4-2`); moduł `liabilities` **100%** linii (`F4-4`); alokacje i cele (`shared/domain/allocation-status.ts`, `goal.ts`) **100%** (`F5-4`) |
| Pokrycie testami: pozostały backend | rozsądne | moduł `auth` **99%** instrukcji, 100% funkcji; `accounts` **100%** linii, salda 100%; `transactions` **100%** linii, 95,7% gałęzi (`F2-5`) |
| Pokrycie testami: prymitywy interfejsu | reguły z `15 §4` | ✅ 104 testy frontu |
| `pnpm typecheck` | bez błędów | ✅ |
| `pnpm lint` | bez błędów | ✅ zero ostrzeżeń |
| Rozmiar paczki frontu (ścieżka krytyczna, gzip) | < 200 kB | **159,6 kB** (`gzip -9` plików z `index.html`: wejście 75,1 + `modulepreload` 78 + CSS 6,5). **149 kB** (dashboard 4,2 kB i rozbicie 1,9 kB leniwie). Wcześniej: 145 kB ( wejście 77,6 + `modulepreload` 61,5 + CSS 5,9; historia 6,4 kB i kategorie 4,2 kB leniwie). Poprzednio ~150 kB (`F2-7`: wejście 79,8 + `modulepreload` 64 + CSS 5,8). Wcześniejsze „109 kB” liczyły sam fragment wejściowy — w `F2-6` cały zestaw startowy miał ~147 kB. Formularz transakcji (6,7 kB) ładowany leniwie, ekrany w osobnych fragmentach |
| Pierwsze renderowanie ekranu miesiąca (4G) | < 1,5 s | ✅ **1,3 s** na 4G (9 Mb/s, RTT 60 ms, CPU 4×); „wolne 4G" nie jest celem (ADR-042) |
| Dostępność (axe-core, WCAG 2.1 A/AA) | zero naruszeń | ✅ **0** na 29 skanach — 13 ekranów × 2 motywy, logowanie, arkusz |
| OCR: trafność sumy paragonu | ≥ 95% | — |
| OCR: trafność kategorii przy `confidence ≥ 0.8` | ≥ 85% | — |

---

## Realizacja wymagań

| # | Wymaganie | Faza | Stan |
|---|---|---|---|
| 1 | Konta + przycisk dodania | 2 | ✅ API z saldami (`F2-1`, `F2-2`, `F2-5`) i ekran z dodawaniem, edycją i archiwizacją (`F2-6`) |
| 2 | Zobowiązania: kwota, rata, okres | 4 | ✅ API (`F4-4`) i ekrany listy, szczegółów i formularza „dwa z trzech" (`F4-6`) |
| 3 | Wydatki stałe, zapis jako stałe | 4 | 🟡 API (`F4-1`…`F4-3`) i ekran `/recurring` (`F4-5`); „Zapisz jako stały" — `F4-8` |
| 4 | OCR paragonu i wyciągu z AI | 7 | 🟡 API i ekrany (`F7-1`…`F7-10`); pomiar jakości na paragonach właściciela — `F7-11` |
| 5 | Kategorie domyślne i własne, AI widzi wszystkie | 2 + 7 | ✅ API (`F2-3`), ekran (`F2-9`), kontekst AI ze wszystkimi kategoriami i `ai_hints`, propozycje nowych kategorii jednym dotknięciem (`F7-4`, `F7-8`) |
| 6 | Cele oszczędnościowe + przelicznik % ↔ kwota | 5 | ✅ API (`F5-1`, `F5-2`) i ekran z formularzem przelicznika (`F5-5`, `F5-6`) |
| 7 | Cele inwestycyjne | 5 | ✅ ten sam moduł, zakładka „Inwestycje”, tryb salda konta (`F5-1`, `F5-5`) |
| 8 | Rozkład docelowy % + porównanie z wykonaniem | 5 | ✅ wersje od miesiąca, wykonanie netto, trend (`F5-3`, `F5-4`, `F5-7`), kafel z „Uzupełnij” (`F5-8`) |
| 9 | Wpłaty i wydatki cykliczne | 4 | 🟡 API (`F4-1`…`F4-3`) i ekran reguł (`F4-5`); księgowanie z dashboardu — `F4-7` |
| 10 | Przychód w dowolnym momencie + źródło | 2 | ✅ API (`F2-4`, `F2-5`) i formularz przychodu z wyborem i szybkim dodaniem źródła (`F2-7`) |
| 11 | Dwóch użytkowników, e-mail + PIN | 1 | ✅ logowanie, sesje, zmiana PIN-u i urządzenia w ustawieniach (`F1-*`, `F8-1`) |
| 12 | Widok miesiąca, przełączanie, księgowanie wstecz | 3 | ✅ dashboard `/m/:month` z przełącznikiem (siatka, gest), okno księgowania i zamknięte miesiące (`F3-1`…`F3-7`) |
| 13 | Planowane wydatki z odkładaniem | 6 | ✅ API i ekran `/planned`, sekcja „Nadchodzące” (`F6-1`…`F6-9`) |
| 14 | Planer budżetu: szkic miesiąca (bieżący … +12) ze źródeł, edycja, zamiana linii w pozycję cykliczną / planowany wydatek, średnie kategorii, ocena celów | 9 | ⬜ zaplanowane (16, ADR-075…079); `F9-1`…`F9-10` |
