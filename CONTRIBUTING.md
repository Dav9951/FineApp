# Współtworzenie FineApp

Dziękujemy za chęć pomocy. Zgłoszenia (issues) i pull requesty przyjmujemy **po polsku
lub po angielsku**.

## Zanim zaczniesz

- **Błąd** — opisz, co zrobiłeś, czego się spodziewałeś i co się stało. Nie wklejaj
  prawdziwych danych finansowych; wystarczy przykład na wymyślonych kwotach.
- **Nowa funkcja albo zmiana zachowania** — najpierw issue. Projekt jest prowadzony
  „dokumentacją najpierw" i większa zmiana zaczyna się od uzgodnienia planu.
- **Luka bezpieczeństwa** — nie zgłaszaj publicznie; użyj prywatnego zgłoszenia
  (GitHub → Security → *Report a vulnerability*).

## Plan jest źródłem prawdy

Katalog [`plans/`](./plans/README.md) opisuje model danych, API, kontrakty, ekrany i reguły
obliczeń. Kod niezgodny z planem jest błędem, nawet jeśli działa. Gdy plan trzeba zmienić:

1. Opisz problem i proponowane rozwiązanie (w issue albo w opisie PR).
2. Zaktualizuj właściwy dokument planu **i** dopisz wpis do
   [`plans/14-decisions-log.md`](./plans/14-decisions-log.md) (kolejny numer ADR).
3. Dopiero wtedy implementuj.

Zmieniła się tabela → popraw **03**. Endpoint → **04**. DTO → **05**. Ekran → **06**.
Reguła obliczeń → **07**. Dokument niezgodny z kodem jest gorszy niż brak dokumentu.

## Twarde zasady

1. **Kwoty tylko w groszach** (`INTEGER`), pola z sufiksem `...Minor`. Nigdy float.
2. **Procenty tylko w bps** (1% = 100), pola z sufiksem `...Bps`.
3. **Daty biznesowe** = `YYYY-MM-DD` w strefie gospodarstwa. **Nigdy**
   `new Date().toISOString().slice(0,10)`.
4. **`householdId` zawsze z tokenu**, nigdy z ciała żądania. Pierwszy argument każdej
   metody repozytorium.
5. **`deleted_at IS NULL`** w każdym zapytaniu o transakcje.
6. **Alokacje liczone netto** — wpłaty minus wypłaty; `actual` i `fulfillmentBps` mogą być
   ujemne. Nigdy nie obcinaj ich do zera (ADR-011).
7. **Kontrakt przed implementacją** — DTO w `packages/shared` powstaje pierwsze.
8. **JSDoc po polsku** na każdym eksporcie; przy obliczeniach wyjaśnia *dlaczego*.
9. **Żadnych `any`.** Nieznany typ → `unknown` + zawężenie.
10. **Nowa reguła domenowa = nowy test.** Bez wyjątków.
11. **Routes nie dotykają bazy.** Repozytorium nie zna HTTP. Serwis nie zwraca wierszy DB.
12. **Żadnych sekretów, kluczy ani danych osobowych** w kodzie, testach i logach. Dane
    przykładowe są zawsze wymyślone (ADR-083).

### Język

- Kod, nazwy symboli, kolumny: **angielski**.
- JSDoc, komunikaty błędów, interfejs i dokumentacja: **polski**.
- Kolumny DB `snake_case`, pola DTO `camelCase` — mapowanie wyłącznie w mapperach.

### Interfejs

Pełny opis: [`plans/15-design-system.md`](./plans/15-design-system.md).

- Tylko tokeny kolorów (`bg-card`, `text-income`), nigdy surowe (`bg-blue-500`).
- Kwoty wyłącznie przez `<Money>` — zero `toFixed(2)` i zero `zł` w JSX.
- Cele dotykowe ≥ 44 px, projekt na **390 px** szerokości.
- Cztery stany każdego ekranu z danymi: ładowanie, pusto, błąd, treść.
- Zanim napiszesz nowy komponent, sprawdź `apps/web/src/components/ui/` i trasę `/dev/ui`.

## Kolejność pracy w zadaniu

```
1. Schemat / migracja (jeśli potrzebna)      → pnpm db:generate
2. DTO w packages/shared                      → kontrakt najpierw
3. Repozytorium                               → zapytania
4. Serwis + testy jednostkowe reguł           → logika
5. Trasy                                      → HTTP
6. Test integracyjny trasy                    → app.inject()
7. Hooki frontu (TanStack Query)              → dane
8. Komponenty ekranu                          → UI
9. Sprawdzenie na szerokości 390 px           → mobile-first to nie deklaracja
```

Moduł to pionowy plasterek `routes → service → repository`, bez importów skrośnych między
repozytoriami modułów (wyjątek udokumentowany: moduł `months`). Szczegóły:
[`plans/02-architecture.md`](./plans/02-architecture.md).

## Testy — co musi być pokryte

| Bezwzględnie | Rozsądnie | Pomijamy |
|---|---|---|
| `money.ts`, `month.ts` | serwisy CRUD | komponenty prezentacyjne |
| alokacje i procenty | trasy (happy path + 401 + walidacja) | style |
| generator wystąpień cyklicznych | mappery | konfiguracja |
| rata odkładania i pokrycie | | |
| wyliczanie sald i stanu zobowiązań | | |
| niezmienniki I-1 … I-19 | | |

Przypadki brzegowe, które **muszą** mieć test: zerowe wpływy, pusty miesiąc, 31. dzień
miesiąca w lutym, rok przestępny, księgowanie na granicy limitu wstecz, przelew między
kontami tej samej klasy, kwota `0`, kwoty na granicy zaokrąglenia.

## Najczęstsze pułapki

| Pułapka | Jak jej uniknąć |
|---|---|
| Kwoty jako liczby zmiennoprzecinkowe | Wyłącznie grosze (`Math.round`, nigdy `toFixed` w obliczeniach) |
| `new Date().toISOString()` do daty biznesowej | Konwersja zawsze w strefie gospodarstwa ([07 §1.1](./plans/07-domain-rules.md#11-trzy-różne-pojęcia-czasu)) |
| Zapomniany filtr `deleted_at IS NULL` | Każde zapytanie o transakcje; miękko usunięte nie mogą wpływać na sumy |
| Zapomniany `household_id` w zapytaniu | Pierwszy argument każdej metody repozytorium |
| Zaokrąglenie przy podziale kwoty | `splitEvenly`, nigdy `round(total / n)` w pętli |
| Procent liczony przy zerowej podstawie | Zwróć `0` i flagę, nie `NaN`/`Infinity` |
| Materializacja salda „dla wydajności" | Salda są wyliczane. Optymalizacja tylko po pomiarze |
| Zmiana klasy konta przeliczająca historię | Migawki `source_allocation_class` / `target_allocation_class` są zapisane i niezmienne |
| Obcięcie ujemnej alokacji do zera | Wykonanie jest **netto** — wartość ujemna jest poprawnym wynikiem (ADR-011) |
| Duplikat przy ponownym generowaniu cykli | Unikalny `(rule_id, due_on)` + `ON CONFLICT DO NOTHING` |
| Podwójne zaksięgowanie na słabym łączu | `Idempotency-Key` przy księgowaniu i commicie |
| Kategoria niezgodna z typem transakcji | Niezmiennik I-4; filtrowanie listy w formularzu |
| Sekret w logu | Nie logujemy ciał żądań; e-mail i IP wyłącznie jako hash |
| EXIF ze zdjęcia wysłany do AI | `sharp` usuwa metadane przed wysłaniem |
| Ekran bez stanu pustego / ładowania / błędu | Cztery stany to warunek ukończenia ekranu |
| Testowanie tylko na szerokim ekranie | Sprawdzaj na 390 px — to jest docelowa szerokość |

## Zanim otworzysz pull request

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

Wszystko zielone, bez zakomentowanego kodu i bez `console.log`. W opisie PR: co i dlaczego,
które dokumenty planu się zmieniły i numer ADR, jeśli był potrzebny.

## Mapa dokumentów

```
00 ──► po co to wszystko
01 ──► czym budujemy
02 ──► jak układamy kod
11 ──► w jakiej kolejności        13 ──► co zostało
14 ──► co się zmieniło i dlaczego

03 ──► baza      ┐
04 ──► API       ├── kontrakty: kod MUSI być z nimi zgodny
05 ──► DTO       │
06 ──► ekrany    │
07 ──► obliczenia┘

08 ──► OCR/AI
09 ──► bezpieczeństwo
10 ──► wdrożenie
15 ──► design system
16 ──► planer budżetu
```
