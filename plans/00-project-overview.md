# 00 — Przegląd projektu

## 1. Czym jest FineApp

Samodzielnie hostowana aplikacja webowa do **planowania i kontroli budżetu domowego** dla jednego
gospodarstwa domowego prowadzonego przez **dwie osoby**. Działa na własnym serwerze w Dockerze,
dane trzyma lokalnie w SQLite. Interfejs jest **mobile-first** (przeglądarka na telefonie
to główny sposób użycia), instalowalny jako PWA.

Nie jest to produkt komercyjny ani wielodostępowy SaaS — nie ma rejestracji, onboardingu,
planów płatnych, ról ani zaproszeń. Dwóch użytkowników zakładanych jest ręcznie skryptem.

## 2. Problem, który rozwiązuje

Typowe narzędzia budżetowe albo skupiają się na *rejestrowaniu przeszłości* (kategoryzacja
wyciągów), albo na *planowaniu przyszłości* (arkusz kalkulacyjny). FineApp łączy oba w jednym
widoku miesiąca i dokłada trzy rzeczy, których zwykle brakuje:

1. **Cel procentowy zamiast kwotowego.** „Odkładam 20% wpływów" jest odporne na zmienny
   dochód, ale ręczne przeliczanie to mordęga. Aplikacja liczy to na bieżąco w obie strony.
2. **Stałe pozycje ustawione raz.** Czynsz, rata, przelew na IKE — definiowane raz, potem
   tylko potwierdzane (albo księgowane automatycznie).
3. **Wrzucenie paragonu zamiast przepisywania.** Zdjęcie → AI → propozycja pozycji
   i kategorii → akceptacja jednym kliknięciem.

## 3. Persony

| Persona | Kto | Jak korzysta |
|---------|-----|--------------|
| **Planista** | osoba prowadząca budżet | Ustawia konta, cele, wydatki stałe, docelowy rozkład %. Wchodzi kilka razy w miesiącu, patrzy na realizację celów. |
| **Rejestrujący** | druga osoba w domu | Głównie dodaje wydatki i wrzuca paragony z telefonu. Rzadko zmienia konfigurację. |

Obie persony mają **identyczne uprawnienia** — nie ma ról. Rozróżnienie służy tylko
projektowaniu UX (co musi być dostępne w dwa dotknięcia, a co może być w „Ustawieniach").

## 4. Zakres — mapowanie wymagań

Numery odpowiadają punktom z pierwotnego zgłoszenia.

| # | Wymaganie | Realizacja | Gdzie opisane |
|---|-----------|------------|---------------|
| 1 | Konta (oszczędności, gotówka) + przycisk dodania | tabela `accounts` z `type` i `allocation_class`; ekran *Konta*; szybkie dodawanie | [03](./03-data-model.md), [06](./06-ui-views.md) |
| 2 | Zobowiązania: pozostała kwota, rata, okres spłaty | tabela `liabilities` + powiązanie płatności z transakcjami; harmonogram wyliczany | [03](./03-data-model.md), [07](./07-domain-rules.md#5-zobowiązania) |
| 3 | Stałe wydatki, łatwe dodawanie, zapis jako stałe | `recurring_rules` z flagą `is_fixed_expense`; „zapisz jako stały" wprost z formularza transakcji | [07](./07-domain-rules.md#6-pozycje-cykliczne) |
| 4 | OCR z AI: paragon / wyciąg → kategoryzacja | `documents` + `document_items`, pipeline Claude vision + tool use, ekran przeglądu | [08](./08-ocr-ai-pipeline.md) |
| 5 | Kategorie domyślne + własne, AI widzi wszystkie | `categories` z `is_system`, `ai_hints`; pełna lista wstrzykiwana do promptu | [03](./03-data-model.md), [08](./08-ocr-ai-pipeline.md) |
| 6 | Cele oszczędnościowe + przelicznik % ↔ kwota | `goals.contribution_mode = fixed \| percent_of_income`, dwukierunkowy przelicznik | [07](./07-domain-rules.md#3-przelicznik-kwoty-i-procentu) |
| 7 | Cele inwestycyjne | ta sama tabela `goals`, `kind = 'investment'` | [07](./07-domain-rules.md#4-cele) |
| 8 | Docelowy rozkład % inwestycje/oszczędności + porównanie z faktycznym | `allocation_targets` (wersjonowane od miesiąca) + wyliczenie `actual` z transakcji | [07](./07-domain-rules.md#2-alokacje-i-realizacja-celów-procentowych) |
| 9 | Wpłaty/wydatki cykliczne (wydatki, oszczędności, inwestycje) | jeden mechanizm `recurring_rules` → `recurring_occurrences` | [07](./07-domain-rules.md#6-pozycje-cykliczne) |
| 10 | Przychód w dowolnym momencie + źródło | `transactions.type='income'` + `income_sources` | [03](./03-data-model.md) |
| 11 | Dwóch użytkowników, e-mail + PIN | `users` + `auth_sessions`, argon2id, brak rejestracji | [09](./09-security-auth.md) |
| 12 | Domyślny widok = miesiąc, stany kont i cele zawsze widoczne, przełączanie miesięcy, księgowanie wstecz | ekran *Miesiąc* jako route domyślny; `GET /months/:key/summary`; limit księgowania wstecz konfigurowalny | [06](./06-ui-views.md#31-miesiąc-dashboard--mmonth), [07](./07-domain-rules.md#1-czas-i-miesiąc-budżetowy) |
| 13 | **Planowane wydatki** — większe wydatki w przyszłości (OC, przegląd, wakacje) z odkładaniem co miesiąc | `planned_expenses` + wyliczana rata odkładania + ostrzeżenie o płynności | [07](./07-domain-rules.md#65-planowane-wydatki), [06](./06-ui-views.md#310-planowane-wydatki--planned) |
| 14 | **Planer budżetu** — szkic budżetu na kolejny miesiąc (i do 12 naprzód) generowany z pozycji cyklicznych, planowanych, rat i celów; edycja i dopisywanie; zamiana pozycji szkicu w pozycję cykliczną albo planowany wydatek; średnia wydatków kategorii; ocena, czy plan dowozi cele; plan kontra wykonanie (Faza 9, ✅) | `budget_drafts` + `budget_draft_lines`, linie powiązane ze źródłami, ocena liczona z linii | [16](./16-budget-planner.md), [07 §13](./07-domain-rules.md#13-planer-budżetu) |

## 5. Poza zakresem (świadomie)

- Integracje bankowe (PSD2/open banking) — wyciąg wrzucamy jako plik.
- Wielowalutowość z przewalutowaniem. Jedna waluta bazowa (PLN); pole `currency` istnieje,
  ale w v1 wszystkie rekordy mają walutę gospodarstwa. Patrz [14](./14-decisions-log.md) ADR-007.
- Automatyczna wycena portfela inwestycyjnego (kursy akcji/ETF). Inwestycje śledzimy
  **kwotą wpłaconą**, nie wartością rynkową.
- Aplikacje natywne. PWA wystarcza.
- Współdzielenie z księgowym, eksport do systemów księgowych.
- Podział wydatków między użytkowników („kto ile dołożył") — budżet jest wspólny.
- Rozliczenia podatkowe działalności. Przychód z B2B wpisujemy **netto**, po podatku
  i ZUS; obciążenia publicznoprawne nie przechodzą przez księgę (ADR-012). Kosztami
  działalności pozostają rzeczy płacone z tych pieniędzy: księgowość, adres wirtualny,
  narzędzia.

## 6. Słownik pojęć

Terminy używane konsekwentnie w kodzie (angielski) i w UI (polski).

| Kod (EN) | UI (PL) | Znaczenie |
|----------|---------|-----------|
| `household` | gospodarstwo | Kontener na wszystkie dane. W v1 dokładnie jeden rekord. |
| `account` | konto | Miejsce, gdzie leżą pieniądze: ROR, oszczędnościowe, gotówka, maklerskie. |
| `allocation_class` | klasa konta | `spending` / `savings` / `investment` — decyduje, czy przelew liczy się jako odkładanie. |
| `transaction` | transakcja | Pojedynczy ruch pieniądza: `expense`, `income` lub `transfer`. |
| `transfer` | przelew | Ruch między własnymi kontami. Nie jest ani przychodem, ani wydatkiem. |
| `allocation_effect` | efekt alokacji | Wpływ przelewu na pulę oszczędności lub inwestycji, liczony **netto** (dodatni = wpłata, ujemny = wypłata). Wyliczany z migawek klas obu kont. |
| `liability` | zobowiązanie | Kredyt, pożyczka, raty, karta. |
| `recurring_rule` | pozycja cykliczna | Definicja powtarzalnej transakcji o znanym rytmie („czynsz 15. dnia"). |
| `recurring_occurrence` | wystąpienie | Konkretna instancja reguły w danym miesiącu; do potwierdzenia lub pominięcia. |
| `planned_expense` | planowany wydatek | Pojedyncze większe zdarzenie w przyszłości o szacunkowej kwocie (OC, przegląd, wakacje), na które zwykle odkłada się co miesiąc. |
| `set_aside` | odkładanie | Miesięczna kwota gromadzona z wyprzedzeniem na planowany wydatek. |
| `goal` | cel | Cel oszczędnościowy lub inwestycyjny. |
| `allocation_target` | rozkład docelowy | Założenie „20% oszczędności, 10% inwestycje". |
| `income_source` | źródło przychodu | Wynagrodzenie, freelance, zwrot podatku… |
| `document` | dokument | Wrzucony paragon lub wyciąg. |
| `month_key` | miesiąc | Klucz `YYYY-MM`, podstawowa jednostka nawigacji. |
| `amount_minor` | kwota | Kwota w **groszach** (integer). Nigdy float. |

## 7. Główne zasady projektowe

1. **Pieniądz to liczba całkowita w groszach.** Żadnych `number` z częścią ułamkową
   w obliczeniach finansowych. Formatowanie tylko na granicy UI.
2. **Miesiąc jest osią aplikacji.** Prawie każde zapytanie ma parametr `month`.
3. **Jeden mechanizm cykliczności** dla wydatków, przychodów i przelewów — bez duplikacji.
4. **AI proponuje, człowiek zatwierdza.** Żadna transakcja nie powstaje z OCR bez akceptacji.
5. **Kontrakty w jednym miejscu.** DTO są Zod-schematami w `@fineapp/shared`, używanymi
   jednocześnie do walidacji na backendzie i typowania na froncie.
6. **Moduł = pionowy plasterek.** Routes → Service → Repository, bez „warstwy utils" na skróty.
7. **Dane to prywatne finanse.** Brak telemetrii, brak zewnętrznych wywołań poza Anthropic API
   dla OCR (i tylko po jawnym wrzuceniu pliku).
