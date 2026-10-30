# 11 — Mapa drogowa

Podział na fazy, w których **każda kończy się czymś działającym**. Nie budujemy całego
backendu, żeby dopiero potem zobaczyć ekran — od Fazy 2 aplikacja jest używalna
i z każdą fazą robi więcej.

Aktualny stan realizacji: [13-progress.md](./13-progress.md).

---

## Faza 0 — Fundament

**Cel:** projekt startuje, migracje działają, jest w czym pisać.

| ID | Zadanie | Efekt |
|---|---|---|
| F0-1 | ✅ `pnpm install`, weryfikacja i przypięcie wersji; zapis ustaleń w ADR | **Zrobione** ([ADR-014](./14-decisions-log.md#adr-014) · [ADR-015](./14-decisions-log.md#adr-015)) |
| F0-2 | ✅ `core/`: config (Zod), errors, logger, id, clock | **Zrobione** ([ADR-016](./14-decisions-log.md#adr-016)) |
| F0-3 | ✅ `@fineapp/shared`: prymitywy, enumy, `money.ts`, `month.ts` + testy | **Zrobione** ([ADR-017](./14-decisions-log.md#adr-017)) — 145 testów, **100% pokrycia** wymuszone progiem |
| F0-4 | ✅ `db/client.ts` z pragmami; schemat Drizzle wszystkich tabel | **Zrobione** ([ADR-018](./14-decisions-log.md#adr-018)) — 17 tabel, 32 warunki `CHECK`, DDL sprawdzony na bazie |
| F0-5 | ✅ Pierwsza migracja + runner + `entrypoint.sh` | **Zrobione** ([ADR-019](./14-decisions-log.md#adr-019)) — idempotentny, z `VACUUM INTO` przed zmianą |
| F0-6 | ✅ Seed: gospodarstwo, kategorie domyślne z `ai_hints` | **Zrobione** ([ADR-020](./14-decisions-log.md#adr-020)) — 94 kategorie, idempotentny |
| F0-7 | ✅ `http/server.ts`, error-handler, `/health`, Vitest z bazą `:memory:` | **Zrobione** ([ADR-021](./14-decisions-log.md#adr-021)) — serwer wstaje, `/health` zwraca `dbOk` |
| F0-8 | ✅ Szkielet frontu: Vite, Tailwind, router, `api-client`, `query-keys` | **Zrobione** ([ADR-022](./14-decisions-log.md#adr-022)) — `pnpm dev` podnosi API i front |
| F0-9 | ✅ **Design system od zera**: kierunek wizualny → tokeny, [`15-design-system.md`](./15-design-system.md), makiety 3 ekranów | **Zrobione** ([ADR-013](./14-decisions-log.md#adr-013)) |

**Ukończone, gdy:** `pnpm dev` podnosi API i front, `/api/v1/health` zwraca `ok`,
`pnpm test` zielone, `pnpm typecheck` bez błędów.

> ### ✅ Faza 0 zamknięta — 2026-09-22
>
> Wszystkie dziewięć zadań zrobione. Sprawdzone uruchomieniem, nie deklaracją:
> `pnpm dev` podnosi API na `:3000` i front na `:5173`, `/api/v1/health` zwraca
> `{"status":"ok","version":"0.1.0","dbOk":true}` także przez proxy Vite,
> `pnpm build` przechodzi cały łańcuch shared → api → web, a paczka frontu waży
> **121 kB** gzip przy budżecie 200 kB. **343 testy**, pokrycie `shared` **100%**.

> **`F0-1` zrobione.** Lockfile jest w repozytorium, a wersje przestały być
> deklaracją — para `fastify` ↔ `fastify-type-provider-zod` ↔ `zod` została sprawdzona
> uruchomieniem, nie lekturą ([ADR-014](./14-decisions-log.md#adr-014)). **Zod zostaje
> na 3.x**; przejście na 4.x wymagałoby type providera ciągnącego `@fastify/swagger`,
> którego projekt nie używa.
>
> Przy okazji wyszło, że pierwotny szkielet nie przechodził własnych bramek — pięć
> poprawek konfiguracyjnych opisuje [ADR-015](./14-decisions-log.md#adr-015). Dwie z nich
> (`tsconfig.build.json` w `apps/api`, `dist` w `exports` paczki `shared`) są warunkiem
> tego, żeby `F0-2` mogło w ogóle zaimportować cokolwiek z `@fineapp/shared`.

> **`F0-9` zrobione** — nie blokuje niczego w Fazie 0 i nic w niej nie czeka
> na design system. Powstało: kierunek **„Papier"** ([ADR-013](./14-decisions-log.md#adr-013)),
> komplet tokenów w [`tokens.css`](../apps/web/src/styles/tokens.css) dla obu motywów,
> wypełniony [`15-design-system.md`](./15-design-system.md) (w tym specyfikacje prymitywów
> w §4) oraz makiety trzech ekranów w [`design/mockups/`](../design/mockups/).
>
> **Co z `F0-9` zostało do zakodowania:** prymitywy `components/ui/` i trasa `/dev/ui`
> potrzebują działającego Vite, więc — zgodnie z pierwotnym założeniem — są w Fazie 1
> jako **`F1-0`**. Specyfikacji nie trzeba już wymyślać: `15 §4` opisuje warianty, stany,
> tokeny i zachowanie na 390 px dla każdego komponentu.
>

---

## Faza 1 — Logowanie

**Cel:** da się wejść do aplikacji.

| ID | Zadanie | Stan |
|---|---|---|
| F1-0 | ✅ Prymitywy `components/ui/` wg [15 §4](./15-design-system.md#4-prymitywy) + trasa `/dev/ui` z ich przeglądem | **Zrobione** ([ADR-023](./14-decisions-log.md#adr-023)) — 14 prymitywów, 104 testy frontu, oba motywy zmierzone w przeglądarce |
| F1-1 | ✅ argon2id, walidacja PIN-u, skrypt `user:create` | **Zrobione** ([ADR-024](./14-decisions-log.md#adr-024)) — skrypt przetestowany na prawdziwej bazie, limit dwóch kont wymuszany |
| F1-2 | ✅ `POST /auth/login` z limitem prób i blokadą wykładniczą | **Zrobione** ([ADR-025](./14-decisions-log.md#adr-025)) — blokada zmierzona na działającym serwerze, czasy odpowiedzi nie do odróżnienia |
| F1-3 | ✅ Sesje: refresh w bazie, rotacja, wykrycie ponownego użycia | **Zrobione** ([ADR-026](./14-decisions-log.md#adr-026)) — scenariusz kradzieży odtworzony na działającym serwerze; migracja `0001` dokłada `family_id` |
| F1-4 | ✅ `requireAuth` + kontekst gospodarstwa + `/auth/me` | **Zrobione** ([ADR-027](./14-decisions-log.md#adr-027)) — komplet `/auth` z `04 §4`, sprawdzony na działającym serwerze |
| F1-5 | ✅ Ekran `/login` z klawiaturą PIN ([06 §3.13](./06-ui-views.md#313-logowanie--login)) | **Zrobione** ([ADR-028](./14-decisions-log.md#adr-028)) — przeklikany w przeglądarce na prawdziwym API, token poza pamięcią przeglądarki |
| F1-6 | ✅ Powłoka aplikacji: dolny pasek, pasek boczny, trasy chronione | **Zrobione** ([ADR-029](./14-decisions-log.md#adr-029)) — zmierzona w przeglądarce na obu szerokościach; przy okazji naprawione wylogowanie przy dwóch kartach |
| F1-7 | ✅ Testy: blokada po 5 próbach, rotacja, wykrycie kradzieży tokenu | **Zrobione** ([ADR-030](./14-decisions-log.md#adr-030)) — pokrycie modułu `auth` 99% instrukcji, kryteria fazy przeklikane na telefonie |

**Ukończone, gdy:** logowanie działa na telefonie, po 5 błędnych próbach jest blokada,
odświeżenie strony nie wylogowuje.

> ### ✅ Faza 1 zamknięta — 2026-09-22
>
> Wszystkie trzy kryteria sprawdzone w Chromium udającym iPhone'a 390 × 844 px,
> na prawdziwym API i prawdziwej bazie:
>
> | Kryterium | Wynik |
> |---|---|
> | logowanie działa na telefonie | wejście bez sesji → `/login`, po PIN-ie → `/m/2026-09` z nawigacją |
> | odświeżenie strony nie wylogowuje | po `F5` i po wejściu wprost na `/goals` sesja trwa |
> | po 5 błędnych próbach blokada | piąta nieudana próba → `429`, szósta z **poprawnym** PIN-em też |
>
> **Co Faza 1 zostawia gotowe.** Uwierzytelnianie od skryptu zakładającego konto po
> powłokę aplikacji: argon2id, limit prób z blokadą wykładniczą, rotacja tokenów
> z wykryciem kradzieży, `requireAuth` z kontekstem gospodarstwa, komplet tras `/auth`,
> ekran logowania i nawigacja. Moduły Fazy 2 dokładają wyłącznie własną logikę —
> `householdId` mają z tokenu, a `<RequireSession>` pilnuje wejścia.
>
> **Czego świadomie nie ma.** Ekrany są nadal zaślepkami: „przeklikanie" aplikacji
> dowodzi, że działa nawigacja i sesja, a nie że cokolwiek liczy. To zmienia dopiero
> Faza 2.

---

## Faza 2 — Konta i transakcje

**Cel:** pierwsza realna wartość — można prowadzić budżet.

| ID | Zadanie |
|---|---|
| F2-1 | Moduł `accounts`: CRUD, archiwizacja, kolejność |
| F2-2 | Wyliczanie sald + `/accounts/balances` + majątek netto |
| F2-3 | Moduł `categories`: drzewo, CRUD, scalanie, `ai_hints` |
| F2-4 | Moduł `income-sources`: CRUD |
| F2-5 | Moduł `transactions`: CRUD, filtry, paginacja kursorowa, niezmienniki I-1…I-8 (bez `bulk` → `F7-6`; `save-as-recurring` → `F4-8`) |
| F2-6 | Ekran `/accounts` z grupowaniem po klasie |
| F2-7 | Formularz transakcji (3 warianty) z klawiaturą kwoty |
| F2-8 | Ekran `/m/:month/transactions` z grupowaniem po dniach i gestami (z `meta.summary` w `GET /transactions`, ADR-038) |
| F2-9 | Ekran `/settings/categories` (z `GET /categories/usage`, ADR-038) |

**Ukończone, gdy:** można dodać konta, wpisać przychód i wydatki, zobaczyć historię
i poprawne salda. Od tego momentu aplikacja ma sens bez reszty funkcji.

> ### ✅ Faza 2 zamknięta — 2026-09-23
>
> Kryteria sprawdzone w Chromium na 390 × 844 px, na prawdziwym API i bazie z dwiema
> osobami i 16 transakcjami (konta, przychód, wydatki, przelew na oszczędności):
>
> | Kryterium | Wynik |
> |---|---|
> | można dodać konta, wpisać przychód i wydatki | ekran kont i formularz (`F2-6`, `F2-7`); zapis z `Idempotency-Key` |
> | zobaczyć historię | `/m/:month/transactions` z dniami, filtrami, gestami i koszem (`F2-8`) |
> | poprawne salda | ROR: 5 120,00 − 349,00 + 9 800,00 − 2 541,93 − 2 000,00 = **10 029,07 zł** — tyle samo w `/accounts/balances` |
>
> **Co zostaje na później.** Dashboard miesiąca i przełącznik z siatką (Faza 3), odświeżenie
> gestem (`Z-24`), ikony kategorii (`Z-22`), okno księgowania przy edycji starych
> transakcji (`Z-17`).

---

## Faza 3 — Ekran miesiąca

**Cel:** realizacja wymagania #12 — domyślny widok, z którego wszystko widać.

| ID | Zadanie |
|---|---|
| F3-1 | Moduł `months`: repozytorium agregujące, `/months/:key/summary` |
| F3-2 | `/months/available`, `/months/:key/categories`, porównanie z poprzednim miesiącem |
| F3-3 | Reguły księgowania wstecz (I-8) + komunikaty; decyzja o edycji i usuwaniu transakcji sprzed okna (`Z-17`) |
| F3-4 | Dashboard `/m/:month` — sekcje: konta, podsumowanie, ostatnie, kategorie |
| F3-5 | Przełącznik miesiąca: strzałki, siatka, gest, wstępne pobieranie sąsiadów |
| F3-6 | Stany: ładowanie (szkielety), pusto (kroki startowe), błąd |
| F3-7 | Pomiar wydajności: pierwsze renderowanie < 1,5 s na 4G |

**Ukończone, gdy:** ekran miesiąca jest domyślny, przełączanie działa płynnie,
księgowanie wstecz respektuje limit.

> ### ✅ Faza 3 zamknięta — 2026-09-23
>
> | Kryterium | Wynik |
> |---|---|
> | ekran miesiąca jest domyślny | `/` → `/m/<bieżący>`, dashboard z `GET /months/:key/summary` (`F3-1`, `F3-4`) |
> | przełączanie działa płynnie | strzałki, siatka, gest; sąsiednie miesiące pobierane w tle — przejście bez szkieletu (`F3-5`) |
> | księgowanie wstecz respektuje limit | okno przy zapisie daty + zamknięte miesiące zamrożone (`F3-3`, ADR-040) |
> | pierwsze renderowanie < 1,5 s na 4G | **1,3 s** na 4G (9 Mb/s, RTT 60 ms, CPU 4×); „wolne 4G” nie jest celem (ADR-041, ADR-042) |
>
> **Co zostaje na później.** Sekcje dashboardu Faz 4–6 (ADR-039), `GET /months/compare`
> (wykresy, Faza 8), odświeżenie gestem (`Z-24`), awatary domowników (`Z-15`).

---

## Faza 4 — Pozycje cykliczne i zobowiązania

**Cel:** wymagania #2, #3 i #9 — koniec z przepisywaniem tego samego co miesiąc.

| ID | Zadanie |
|---|---|
| F4-1 | Moduł `recurring`: reguły CRUD, wyznaczanie terminów, przycinanie dnia miesiąca |
| F4-2 | Leniwe generowanie wystąpień, idempotencja, migawka kwoty |
| F4-3 | Księgowanie / pomijanie / cofanie, `Idempotency-Key`, auto-księgowanie |
| F4-4 | Moduł `liabilities`: CRUD, wyliczanie stanu, harmonogram, `rebase` |
| F4-5 | Ekran `/recurring` z grupowaniem i przełącznikami |
| F4-6 | Ekran `/liabilities` z formularzem wiążącym ratę, kwotę i okres |
| F4-7 | Sekcja „Do zrobienia w tym miesiącu" na dashboardzie |
| F4-8 | „Zapisz jako wydatek stały" w formularzu transakcji |
| F4-9 | Testy: 29/30/31 dzień miesiąca, rok przestępny, idempotencja |

**Ukończone, gdy:** czynsz i rata definiowane raz pojawiają się co miesiąc
do potwierdzenia, a zobowiązania pokazują poprawny stan i liczbę rat.

> ### ✅ Faza 4 zamknięta — 2026-09-25
>
> Kryteria sprawdzone na prawdziwym API z przesuwanym zegarem (`recurring.calendar.test.ts`)
> i w Chromium na 390 × 844 px w obu motywach:
>
> | Kryterium | Wynik |
> |---|---|
> | czynsz definiowany raz pojawia się co miesiąc do potwierdzenia | reguła → wystąpienia leniwie w oknie, zaległe z podpisem miesiąca, „Zaksięguj" z „Cofnij" na dashboardzie (`F4-2`, `F4-3`, `F4-7`); zapis z formularza transakcji jednym polem wyboru (`F4-8`) |
> | rata definiowana raz — tak samo | zobowiązanie z regułą raty albo rata „Zaksięguj" bez reguły, nigdy dwa razy (`F4-4`, `F4-6`, ADR-047, ADR-050) |
> | zobowiązania pokazują poprawny stan i liczbę rat | stan i harmonogram z księgi (`shared/domain/liability.ts`); w danych próbnych: kredyt 303 350,00 zł, 164 raty do IV 2040 |
> | 29/30/31, rok przestępny | 31. → 28.02 / 29.02, auto-księgowanie dokładnie 29.02, marzec wraca do 31., kwartalnie bez dryfu, co 2 tygodnie przez 29.02, co roku 29.02 (`F4-9`) |
> | idempotencja | unikalny `(rule_id, due_on)`, `Idempotency-Key` przy księgowaniu, racie i „Zapisz jako stały"; wielokrotne odczyty z auto-księgowaniem — jedna transakcja |
>
> **Co zostaje na później.** Cofnięcie pominięcia (`Z-30`), `nextDueOn` pomijające
> zaksięgowany termin (`Z-31`), „Zapisz jako stały" z historii (`Z-32`), czyszczenie kosza
> (`Z-29`).

---

## Faza 5 — Cele i rozkład procentowy

**Cel:** wymagania #6, #7 i #8 — serce aplikacji.

| ID | Zadanie |
|---|---|
| F5-1 | Moduł `goals`: CRUD, postęp (dwa tryby), prognoza |
| F5-2 | `POST /goals/convert` — przelicznik dwukierunkowy |
| F5-3 | Moduł `allocation`: rozkład wersjonowany, `status`, `trend` |
| F5-4 | Wyliczanie efektów alokacji **netto** (07 §2.2), niezmienniki I-5…I-7a; testy wykonania ujemnego |
| F5-5 | Ekran `/goals` z kartami postępu |
| F5-6 | Formularz celu z przelicznikiem % ↔ kwota i przełącznikiem trybu |
| F5-7 | Ekran `/allocation` z suwakami, porównaniem i trendem |
| F5-8 | Kafel „Cele procentowe" na dashboardzie z przyciskiem „Uzupełnij" |
| F5-9 | Testy: przypadki brzegowe z [07 §2.7](./07-domain-rules.md#27-przypadki-brzegowe) |

**Ukończone, gdy:** po wpłacie widać na bieżąco, czy cel 20%/10% jest zrealizowany,
a brakującą kwotę da się dopłacić jednym dotknięciem.

> ### ✅ Faza 5 zamknięta — 2026-09-25
>
> Kryteria sprawdzone w Chromium na 390 × 844 px, na prawdziwym API i bazie (wpływy
> 11 800 zł, rozkład 20% / 10%, trzy cele):
>
> | Kryterium | Wynik |
> |---|---|
> | po wpłacie widać na bieżąco, czy cel 20%/10% jest zrealizowany | kafel „Cele procentowe”: 85% / 100% po wpłacie 2 000 zł na cel i 1 180 zł na IKE; wykonanie netto, ujemne ze śladem kropek (`F5-3`, `F5-4`, `F5-8`) |
> | brakującą kwotę da się dopłacić jednym dotknięciem | „Uzupełnij” → przelew 360,00 zł na „Konto mieszkaniowe” wpisany z góry → „Zapisz” → oba pierścienie 100%, niedobór znika (ADR-054) |
> | cele i przelicznik % ↔ kwota (#6, #7) | ekran `/goals` z postępem, planem w obu stronach, prognozą i „Wpłać”; formularz z przelicznikiem na żywo (1 500 zł → 12,7%) (`F5-1`, `F5-2`, `F5-5`, `F5-6`) |
> | rozkład z porównaniem (#8) | `/allocation`: suwaki, „Na życie zostaje”, wykonanie, trend; wersje od miesiąca (`F5-3`, `F5-7`) |
> | przypadki brzegowe 07 §2.7 | każdy wiersz tabeli ma test (`F5-9`, mapa w 13) |
>
> **Co zostaje na później.** Szczegóły celu z historią wpłat na osobnym ekranie (`Z-33`),
> kolejność celów w interfejsie (`Z-34`), FAB na `/goals` jako wpłata na cel (`Z-35`),
> wykres trendu (`F8-5`).

---

## Faza 6 — Planowane wydatki

**Cel:** wymaganie #13 — większe wydatki nie zaskakują.

| ID | Zadanie |
|---|---|
| F6-1 | Moduł `planned-expenses`: CRUD, statusy, niezmienniki I-16…I-19 |
| F6-2 | Wyliczanie raty odkładania i pokrycia ([07 §6.5](./07-domain-rules.md#65-planowane-wydatki)) |
| F6-3 | `POST /:id/set-aside` i `/post` z idempotencją |
| F6-4 | Powtarzanie co rok — tworzenie kolejnej instancji z faktycznej kwoty |
| F6-5 | Prognoza płynności i ostrzeżenia |
| F6-6 | Ekran `/planned` z grupowaniem po miesiącu terminu |
| F6-7 | Formularz z przeliczaniem raty na żywo |
| F6-8 | Sekcja „Nadchodzące" na dashboardzie + wejście do „Do zrobienia" w miesiącu terminu |
| F6-9 | Podpowiedź przy tworzeniu rocznej reguły cyklicznej |

**Ukończone, gdy:** dodanie OC na marzec od razu pokazuje, ile odkładać miesięcznie,
a dashboard ostrzega, gdy pokrycie jest za małe.

> ### ✅ Faza 6 zamknięta — 2026-09-25
>
> Kryteria sprawdzone w Chromium na 390 × 844 px, na prawdziwym API i bazie (pięć
> wydatków: OC na marzec z odkładaniem, przegląd pokryty, podatek konieczny bez
> odkładania, wakacje, okna w bieżącym miesiącu):
>
> | Kryterium | Wynik |
> |---|---|
> | dodanie OC na marzec od razu pokazuje, ile odkładać miesięcznie | formularz: „Trzeba odkładać X przez N mies." przelicza się przy każdej zmianie kwoty, terminu i „Już mam", przed zapisem (`F6-2`, `F6-7`, ADR-056) |
> | dashboard ostrzega, gdy pokrycie jest za małe | „Nadchodzące": pokrycie i rata przy wydatku, pod spodem ostrzeżenia prognozy („„Podatek…” jest konieczny, a nic na niego nie odkładasz — brakuje 450,00 zł.") (`F6-5`, `F6-8`) |
> | odkładanie i zapłata | „Odłóż teraz" → przelew na „Poduszkę", pokrycie OC 33% → 42%, rata 228,58 → 195,92 zł; „Zapłacone" w „Do zrobienia" z szacunkiem do skorygowania (`F6-3`) |
> | powtarzanie co rok | zapłata zakłada wpis na kolejny rok z kwotą zapłaconą, raz (`F6-4`) |
> | podpowiedź przy rocznej regule | „Utwórz tam zamiast tego" przenosi nazwę, kwotę, kategorię i miesiąc (`F6-9`) |
>
> **Co zostaje na później.** Ekran szczegółów z historią odkładania (`Z-36`), przycisk
> „Przesuń termin" (`Z-37`).

---

## Faza 7 — OCR i AI

**Cel:** wymaganie #4 — koniec z przepisywaniem paragonów.

| ID | Zadanie |
|---|---|
| F7-1 | Upload: multipart, walidacja magic bytes, SHA-256, zapis na dysk |
| F7-2 | `prepareForVision`: sharp, skalowanie, usuwanie EXIF; PDF natywnie jako dokument (ADR-059) |
| F7-3 | `DocumentExtractor` + klient Anthropic + schematy odpowiedzi (structured outputs, ADR-059) |
| F7-4 | Budowa kontekstu kategorii z `ai_hints` |
| F7-5 | Utrwalanie wyniku, walidacja Zod, wykrywanie duplikatów |
| F7-6 | Commit: tryby `single` i `split`, tworzenie kategorii, transakcja bazodanowa; `POST /transactions/bulk` (ADR-035) |
| F7-7 | Kontrola kosztów, limity, `/settings/ai-usage` |
| F7-8 | Ekran `/scan`: wybór źródła → przetwarzanie → przegląd |
| F7-9 | Skalowanie zdjęcia po stronie klienta przed wysyłką |
| F7-10 | Tryb wyciągu bankowego z oznaczaniem duplikatów |
| F7-11 | ✅ **Ocena jakości na 20 rzeczywistych paragonach** ([08 §15](./08-ocr-ai-pipeline.md#15-ocena-jakości)) — **zrobione przez właściciela** (potwierdzone 2026-10-27) |

**Ukończone, gdy:** zdjęcie paragonu daje gotowe pozycje z kategoriami, a wskaźniki
jakości osiągają cele z dokumentu 08.

> ### ✅ Faza 7 zamknięta — 2026-10-27 (potwierdzenie właściciela)
>
> Właściciel potwierdził (2026-10-27), że ocena na paragonach jest zrobiona i skanowanie
> działa na produkcji. Liczb z `ocr:evaluate` nie wpisano do 13 — gdyby były potrzebne do
> porównań po zmianie promptu, warto je dopisać do „Wskaźników jakości".
>
> #### Stan z 2026-09-25
>
> `F7-1`…`F7-10` zrobione ([ADR-059](./14-decisions-log.md#adr-059),
> [ADR-060](./14-decisions-log.md#adr-060)); przepływ sprawdzony w Chromium na 390 px
> z atrapą ekstraktora: zdjęcie → analiza w tle → przegląd → podział z nową kategorią →
> zatwierdzenie → miesiąc; wyciąg PDF z duplikatem odznaczonym.
>
> **`F7-11`** — narzędzie gotowe (`pnpm --filter @fineapp/api ocr:evaluate`), pomiar nie:
> wymaga 20 paragonów właściciela (`Z-5`) w `apps/api/test/fixtures/receipts/` i klucza
> `ANTHROPIC_API_KEY`. Faza zamknie się po wpisaniu wyników do 13 (08 §15).

---

## Faza 8 — Dopracowanie i wdrożenie

| ID | Zadanie |
|---|---|
| F8-1 | ✅ Ekran `/settings` w całości — **zrobione** ([ADR-061](./14-decisions-log.md#adr-061)), razem z `/settings/income-sources` |
| F8-2 | ✅ Eksport JSON i CSV — **zrobione** ([ADR-061](./14-decisions-log.md#adr-061)) |
| F8-3 | ✅ PWA: manifest, ikony, instalacja, baner offline — **zrobione** ([ADR-062](./14-decisions-log.md#adr-062)) |
| F8-4 | ✅ Przegląd dostępności — **zrobione** (axe: zero naruszeń, [ADR-064](./14-decisions-log.md#adr-064)) |
| F8-5 | ✅ Wykresy: trend alokacji; kategorie zostają przy paskach — **zrobione** ([ADR-063](./14-decisions-log.md#adr-063)) |
| F8-6 | ✅ Przegląd wydajności — **zrobione** (ścieżka krytyczna 159,6 kB gzip, ekrany w osobnych fragmentach) |
| F8-7 | ✅ Budowa obrazu Dockera, wdrożenie na VPS, reverse-proxy, TLS — **zrobione** ([ADR-065](./14-decisions-log.md#adr-065)): obraz z GitHub Actions, `budzet.example.pl` za bramą https-portal, Let's Encrypt |
| F8-8 | ✅ Kopie zapasowe + **przećwiczone odtworzenie** — **zrobione** ([ADR-066](./14-decisions-log.md#adr-066)): cron 03:30, `restore.sh` na VPS, kopia szyfrowana w B2 odtworzona i sprawdzona |
| F8-9 | ✅ Przejście listy kontrolnej z [09 §11](./09-security-auth.md#11-lista-kontrolna-przed-wdrożeniem) — **zrobione**: wszystkie punkty odhaczone na produkcji, argon2id zmierzony, mapy źródeł wyłączone |
| F8-10 | Wprowadzenie danych rzeczywistych i miesiąc użytkowania |

**Ukończone, gdy:** aplikacja działa na VPS, obie osoby z niej korzystają,
kopie zapasowe są sprawdzone.

> ### 🟡 Faza 8 — 9 / 10 (2026-09-28)
>
> **Aplikacja działa produkcyjnie.** `F8-7`…`F8-9` zrobione na VPS
> (ADR-065, ADR-066). Zostaje `F8-10` — dane rzeczywiste, drugi domownik i miesiąc
> użytkowania — oraz powtórka odtworzenia kopii na prawdziwych danych.
>
> #### Stan z 2026-09-26 — 6 / 10
>
> Wszystko, co da się zrobić bez serwera, jest zrobione: ustawienia, eksport, PWA,
> dostępność, wykres trendu, budżet paczki. Front serwowany przez Fastify, kopie
> sprawdzane skryptem aplikacji, odtworzenie przećwiczone lokalnie. Zostaje praca
> właściciela na VPS: `F8-7` (obraz, proxy, TLS), `F8-8` (przebieg `restore.sh`),
> `F8-9` (punkty operatora z 09 §11) i `F8-10`.

---

## Faza 9 — Planer budżetu

**Cel:** wymaganie #14 — pod koniec miesiąca rozpisać budżet na następny (albo kilka
naprzód) i zobaczyć, czy plan dowozi cele. Opis: [16-budget-planner.md](./16-budget-planner.md);
decyzje: [ADR-075](./14-decisions-log.md#adr-075) … [ADR-079](./14-decisions-log.md#adr-079).

| ID | Zadanie |
|---|---|
| F9-1 | ✅ Schemat i migracja `budget_drafts`, `budget_draft_lines` (03 §3.19–3.20); eksport i „Usuń wszystkie dane"; scalanie kategorii przepina linie — **zrobione** (migracja `0005`) |
| F9-2 | ✅ DTO `dto/budget.ts` (05 §13b) i czyste funkcje `shared/domain/budget.ts`: linie ze źródeł, kwota reguły w miesiącu, odkładanie i `S_M`, ocena szkicu, stan źródła — **100% pokrycia** — **zrobione** |
| F9-3 | ✅ Średnia kategorii w `transactions.ledger.ts` + `GET /budget-drafts/averages` (07 §13.3) — **zrobione** |
| F9-4 | ✅ Moduł `budget`: szkic i linie (CRUD), wypełnianie, kopiowanie linii własnych, odświeżanie, wykluczanie, „Przyjmij", „Zostaw jako własną", tylko odczyt dla minionych — **zrobione** |
| F9-5 | ✅ Zamiana linii w regułę / planowany wydatek i „Zastosuj w źródle" z podziałem reguły; `Idempotency-Key`; jedna transakcja bazy (07 §13.6–13.7) — **zrobione** |
| F9-6 | ✅ Ekrany `/budget` i `/budget/:month`: podsumowanie z oceną, sekcje linii, pominięte, cztery stany, 390 px (06 §3.14) — **zrobione** |
| F9-7 | ✅ Arkusze: linia (średnia, zamiana, zapis w źródle), wypełnianie szkicu, zamiana z polami reguły / planowanego wydatku — **zrobione** |
| F9-8 | ✅ Wejścia: *Więcej → Budżet*, pasek boczny, sekcja `budget` w podsumowaniu miesiąca, podpowiedź „Zaplanuj …" i odnośnik w podglądzie przyszłego miesiąca — **zrobione** |
| F9-9 | ✅ Plan kontra wykonanie dla bieżącego i minionych miesięcy (07 §13.8) — **zrobione** |
| F9-10 | ✅ Testy przypadków z 07 §13.9; sprawdzenie przepływu na 390 px w obu motywach — **zrobione** (mapa w 13) |
| F9-11 | ✅ Grupy i kolejność linii — schemat `budget_draft_groups` + `group_id` (03 §3.21), DTO, trasy grup i układu, kopiowanie układu przy zakładaniu (07 §13.10), eksport i reset ([ADR-081](./14-decisions-log.md#adr-081)) — **zrobione** (migracja `0006`) |
| F9-12 | ✅ Ekran: grupy w sekcjach, zwijanie, tryb „Układaj" z przeciąganiem (dnd-kit), arkusz grupy, szybki start, pole „Grupa" w arkuszu linii, wykonanie grupy (06 §3.14) — **zrobione** |
| F9-13 | ✅ Testy przypadków 07 §13.10; sprawdzenie na 390 px w obu motywach i na desktopie — **zrobione** |

**Ukończone, gdy:** szkic listopada powstaje jednym dotknięciem z pozycji cyklicznych,
planowanych, rat i celów; kwoty da się zmienić, linie dopisać i jedną z nich zamienić
w pozycję cykliczną, a drugą w planowany wydatek na luty; „Jedzenie" bierze średnią
z 3 miesięcy; podsumowanie mówi, ile zostaje i której puli rozkładu brakuje; szkic
grudnia powstaje równolegle; w trakcie listopada widać plan kontra wykonanie.

**Kolejność.** `F9-1` → `F9-2` → `F9-3` i `F9-4` → `F9-5` → `F9-6` → `F9-7` → `F9-8`,
`F9-9` → `F9-10`. Faza nie zależy od `F7-11` ani `F8-10`; dobrze, jeśli `F8-10` (miesiąc
używania) trwa równolegle — planer korzysta ze średnich, a te potrzebują historii.

> ### ✅ Faza 9 zamknięta — 2026-10-27
>
> Kryteria sprawdzone testami i w Chromium na 390 × 844 px w obu motywach, na prawdziwym
> API i bazie (pensja, czynsz, siłownia, przelew na poduszkę, OC z odkładaniem, cel,
> rozkład 30% / 10%):
>
> | Kryterium | Wynik |
> |---|---|
> | szkic powstaje jednym dotknięciem ze źródeł | „Utwórz z danych" → arkusz → „Utwórz plan": linie z reguł, rat, planowanych, odkładania i celów (`F9-4`, `F9-7`) |
> | kwoty do zmiany, linie do dopisania, zamiana w cykliczną i w planowany na luty | arkusz linii; „Zamień w…" — test ekranu i testy API (termin w innym miesiącu przenosi linię do szkicu terminu) (`F9-5`, `F9-7`) |
> | „Jedzenie" ze średniej z 3 miesięcy | przyciski 3 / 6 / 12 mies. w arkuszu i wybór kategorii w „Utwórz z danych"; średnia sprawdzona testami API (`F9-3`, `F9-7`) — w przeglądarce baza testowa nie miała historii |
> | ile zostaje i której puli brakuje | bilans z „Zostaje", rozkład i „Dodaj brakujące" (`F9-6`) |
> | szkic grudnia równolegle | szkice do +12, przełącznik miesiąca, lista planów (`F9-4`, `F9-6`) |
> | w trakcie miesiąca plan kontra wykonanie | kolumna „Wykonanie", „wydano · zostało / ponad plan" pod liniami, „Poza planem" z historią (`F9-9`) |
> | przypadki brzegowe 07 §13.9 | każdy wiersz tabeli ma test (`F9-10`, mapa w 13) |
>
> **Co zostaje na później.** Nagłówek grupy linii jednej kategorii zamiast podpisu pod
> ostatnią linią; notatka szkicu w interfejsie (API ją ma); wybór źródła przychodu
> w arkuszu linii.

---

## Po v1 — rozważane

Nie deklarujemy, że powstaną. Zapisane, żeby nie wracać do tych samych pomysłów.

| Pomysł | Wartość | Koszt |
|---|---|---|
| Budżety kwotowe per kategoria („max 800 zł na jedzenie") — **częściowo w Fazie 9** (linia z kategorią + plan kontra wykonanie); zostaje pilnowanie w trakcie miesiąca i kafel na dashboardzie | średnia | niski po Fazie 9 |
| Prognoza przepływów na 12 miesięcy | średnia | średni |
| Miesiąc budżetowy inny niż kalendarzowy (`monthStartDay > 1`) | niska | wysoki (migracja historii) |
| Import CSV z banku (zamiast PDF) | średnia | niski |
| Wielowalutowość z kursami | niska | wysoki |
| Wycena portfela inwestycyjnego | średnia | wysoki (źródło kursów) |
| Powiadomienia push o terminach | średnia | średni |
| Upgrade Tailwind 3 → 4 | niska | niski |
| Zamiana `better-sqlite3` na `node:sqlite` | niska | niski |
| Szyfrowanie bazy (SQLCipher) | średnia | średni |
| 2FA (TOTP) | niska | średni |
| Dzielenie wydatków między użytkowników | niska | wysoki |

---

## Kolejność i zależności

```
F0 ──► F1 ──► F2 ──┬──► F3 ──┬──► F4 ──► F5 ──► F6 ──┐
                   │         │                      ├──► F8
                   └─────────┴──► F7 ───────────────┘
                                      F4 + F5 + F6 ──► F9 (planer budżetu)
```

`F7` (OCR) zależy tylko od `F2` (transakcje i kategorie) — można ją przesunąć wcześniej,
jeśli wrzucanie paragonów okaże się pilniejsze niż cele procentowe. Reszta kolejności
jest wymuszona zależnościami danych.

## Zasada zakresu fazy

Faza nie jest ukończona, dopóki nie ma **wszystkich czterech**: działającego backendu,
działającego ekranu, testów kalkulacji i zaktualizowanego
[13-progress.md](./13-progress.md). Ekran bez testów albo backend bez ekranu
to zadanie w toku, nie faza zamknięta.
