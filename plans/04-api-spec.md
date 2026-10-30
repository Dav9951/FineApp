# 04 — Specyfikacja API

Bazowy prefiks: **`/api/v1`**. Wszystko poza `/api/*` jest obsługiwane przez SPA fallback.

## 1. Zasady ogólne

| Zagadnienie | Decyzja |
|---|---|
| Format | JSON, `Content-Type: application/json` (wyjątek: upload dokumentu — `multipart/form-data`). |
| Koperta odpowiedzi | Sukces: `{ "data": ... }`, opcjonalnie `{ "data": ..., "meta": ... }`. Błąd: `{ "error": {...} }`. |
| Uwierzytelnienie | Nagłówek `Authorization: Bearer <access token>`. Token odświeżający w cookie `httpOnly`. |
| Zakres danych | `householdId` **nigdy** nie przychodzi od klienta — jest brany z tokenu. |
| Kwoty | Zawsze `...Minor`, liczba całkowita groszy. |
| Procenty | Zawsze `...Bps` (1% = 100). |
| Daty | `YYYY-MM-DD`. Miesiąc: `YYYY-MM`. |
| Paginacja | Kursorowa: `?limit=&cursor=`; odpowiedź zwraca `meta.nextCursor` (`null` = koniec). |
| Idempotencja | Operacje tworzące skutki uboczne (nowa transakcja, księgowanie wystąpienia, commit dokumentu) przyjmują nagłówek `Idempotency-Key`: 8–128 znaków `A–Z a–z 0–9 _ -` (np. UUID). Powtórzenie z tym samym kluczem i ciałem zwraca pierwszą odpowiedź z nagłówkiem `Idempotent-Replayed: true`; ten sam klucz z innym ciałem → `409`. Pamiętane są tylko sukcesy, przez dobę ([ADR-037](./14-decisions-log.md#adr-037), [03 §3.18](./03-data-model.md#318-idempotency_keys)). |
| Wersjonowanie | Przez prefiks ścieżki. Zmiana łamiąca kontrakt ⇒ `/api/v2`. |
| Czas odpowiedzi | Każda odpowiedź ma nagłówek `X-Request-Id`. |

## 2. Kody statusu

| Kod | Kiedy |
|---|---|
| 200 | Odczyt, aktualizacja |
| 201 | Utworzenie zasobu (z nagłówkiem `Location`) |
| 202 | Przyjęto do przetwarzania asynchronicznego (analiza dokumentu) |
| 204 | Usunięcie |
| 400 | Błąd walidacji — zły kształt lub typ danych |
| 401 | Brak/nieważny token |
| 402 | Wyczerpany miesięczny limit kosztów OCR (`AI_MONTHLY_BUDGET_MINOR`) |
| 403 | Token ważny, ale zasób spoza gospodarstwa |
| 404 | Zasób nie istnieje |
| 409 | Konflikt (duplikat, zły stan, próba usunięcia użytego zasobu) |
| 413 | Plik za duży |
| 415 | Nieobsługiwany typ pliku |
| 422 | Poprawny kształt, niespełniony niezmiennik domenowy |
| 429 | Limit żądań |
| 500 | Błąd nieprzewidziany — szczegóły wyłącznie w logu |
| 502 | Błąd usługi zewnętrznej (Anthropic) |

> **Granica 400 / 422.** „Kwota nie jest liczbą" to `400 VALIDATION_ERROR`; „przelew
> wymaga konta docelowego" to `422 DOMAIN_RULE_VIOLATION`. Wiersz 400 mówił wcześniej
> „lub naruszenie reguły domenowej", co przeczyło wierszowi 422 i
> [07 §2](./07-domain-rules.md) — poprawione przy `F0-2` ([ADR-016](./14-decisions-log.md#adr-016)).

## 3. Format błędów

```jsonc
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Kwota musi być większa od zera.",
    "details": [
      { "path": "amountMinor", "message": "Oczekiwano liczby dodatniej" }
    ],
    "requestId": "01JB2X..."
  }
}
```

Kody: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
`RATE_LIMITED`, `DOMAIN_RULE_VIOLATION`, `FILE_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`,
`EXTERNAL_SERVICE_ERROR`, `AI_BUDGET_EXCEEDED`, `INTERNAL_ERROR`.

`message` jest po polsku i nadaje się do pokazania użytkownikowi.
`details` służy do podświetlenia pól formularza.

---

## 4. Auth — `/api/v1/auth`

| Metoda | Ścieżka | Opis |
|---|---|---|
| POST | `/auth/login` | Logowanie e-mailem i PIN-em. |
| POST | `/auth/refresh` | Wymiana tokenu odświeżającego na nowy access token. |
| POST | `/auth/logout` | Unieważnia bieżącą sesję. |
| POST | `/auth/logout-all` | Unieważnia wszystkie sesje użytkownika. |
| GET | `/auth/me` | Dane zalogowanego użytkownika + gospodarstwo. |
| PATCH | `/auth/pin` | Zmiana PIN-u (wymaga podania obecnego). |
| GET | `/auth/sessions` | Lista aktywnych sesji (urządzeń). |
| DELETE | `/auth/sessions/:id` | Unieważnia wskazaną sesję. |

**`POST /auth/login`**

```jsonc
// żądanie
{ "email": "ja@example.com", "pin": "482913", "deviceLabel": "iPhone — Safari" }

// 200
{
  "data": {
    "accessToken": "eyJhbGciOi...",
    "expiresIn": 900,
    "user": {
      "id": "01JB...", "email": "ja@example.com",
      "displayName": "Adam", "avatarColor": "#3b82f6"
    },
    "household": {
      "id": "01JA...", "name": "Dom", "baseCurrency": "PLN",
      "timezone": "Europe/Warsaw", "locale": "pl-PL",
      "backPostingLimitMonths": 1, "monthStartDay": 1
    }
  }
}
```

Ustawia cookie `fineapp_rt` (`httpOnly`, `SameSite=Lax`, `Secure` w produkcji,
`Path=/api/v1/auth`).

Błędne dane logowania → **zawsze** `401 UNAUTHORIZED` z tym samym komunikatem, niezależnie
od tego, czy nie istnieje e-mail, czy nie zgadza się PIN. Po przekroczeniu limitu prób →
`429 RATE_LIMITED` z polem `error.retryAfterSeconds` (obok `error.details`, nie w środku —
`details` jest jednorodną listą `{ path, message }`, z której front buduje mapę błędów pól).
Ta sama wartość jedzie w standardowym nagłówku `Retry-After`. Szczegóły:
[09](./09-security-auth.md).

**`POST /auth/refresh`** — ciała nie przyjmuje, czyta ciasteczko `fineapp_rt`. Odpowiada
**tym samym kształtem co `/auth/login`**: access token żyje wyłącznie w pamięci
aplikacji, więc po odświeżeniu strony front nie ma ani jego, ani profilu. Rotacja
i wykrywanie ponownego użycia: [09 §3.3](./09-security-auth.md#33-rotacja-refresh-tokenów).

**`POST /auth/logout`** — usuwa całą rodzinę tokenów urządzenia i czyści ciasteczko.
Idempotentne: bez ciasteczka również `200`.

**`GET /auth/me`** → `{ user, household }` — ten sam kształt co pola `user` i `household`
z odpowiedzi logowania.

**`GET /auth/sessions`** → lista urządzeń. `id` to identyfikator **rodziny**, nie wiersza
(rotacja zmienia wiersz przy każdym odświeżeniu). `createdAt` to moment **zalogowania
urządzenia**, nie ostatniej rotacji. `sameDevice` zastępuje „przybliżoną lokalizację":
z hasha IP nie da się odczytać miejsca, można go tylko porównać z hashem bieżącego żądania.

**`DELETE /auth/sessions/:id`** → `{ affected }`. Cudza albo nieistniejąca sesja →
**`404`, nie `403`** ([09 §4](./09-security-auth.md#4-autoryzacja)).

**`POST /auth/logout-all`** → `{ affected }`; usuwa również sesję bieżącą.

**`PATCH /auth/pin`** → `{ affected }` — liczba **wyproszonych urządzeń**. Wymaga podania
obecnego PIN-u: sam ważny access token nie wystarcza, bo mógł zostać wykradziony,
a zmiana PIN-u odcina prawowitego właściciela. Nowy PIN przechodzi przez reguły
z [09 §2.3](./09-security-auth.md#23-wymagania-wobec-pinu) i musi różnić się od obecnego.

**Wszystkie trasy poza `/auth/login`, `/auth/refresh` i `/auth/logout`** wymagają nagłówka
`Authorization: Bearer <access token>`. **Każda metoda zmieniająca stan** wymaga dodatkowo
`X-Requested-With: fineapp` ([09 §5](./09-security-auth.md#5-ochrona-csrf)).

---

## 5. Konta — `/api/v1/accounts`

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/accounts` | Lista kont. `?includeArchived=true` dołącza zarchiwizowane. |
| GET | `/accounts/balances` | Salda kont. `?asOf=YYYY-MM-DD` lub `?month=YYYY-MM` (saldo na koniec miesiąca). |
| POST | `/accounts` | Nowe konto. |
| GET | `/accounts/:id` | Szczegóły + saldo. |
| PATCH | `/accounts/:id` | Edycja. |
| POST | `/accounts/:id/archive` | Archiwizacja (odwracalna). Wstrzymuje reguły cykliczne na tym koncie (ADR-044). |
| POST | `/accounts/:id/unarchive` | Przywrócenie. |
| DELETE | `/accounts/:id` | Usunięcie — **tylko** gdy brak transakcji, inaczej `409`. Wstrzymuje reguły cykliczne na tym koncie (ADR-044). |
| PATCH | `/accounts/order` | Zmiana kolejności: `{ "ids": ["...", "..."] }`. |

**Szczegóły zachowania** (ustalone przy `F2-1`, [ADR-031](./14-decisions-log.md#adr-031))

- `POST /accounts` → `201` z nagłówkiem `Location: /api/v1/accounts/:id`. Nowe konto trafia
  na koniec listy (`sortOrder` = dotychczasowe maksimum + 1, licząc też zarchiwizowane).
- `GET /accounts/:id` → `AccountDetailDto`: konto plus `balanceMinor` i `balanceAsOf`
  (saldo na dziś w strefie gospodarstwa) — od `F2-2`.
- `PATCH /accounts/:id` zmienia wyłącznie przysłane pola; `null` czyści `institution`,
  `color`, `icon`. Puste ciało niczego nie zmienia (także `updatedAt`). Zmiana `type` bez
  `allocationClass` przelicza klasę tylko wtedy, gdy nie była nadpisana
  ([07 §2.1](./07-domain-rules.md#21-klasyfikacja-kont)).
- `archive` / `unarchive` → `200` z `AccountDto`; ponowne wywołanie jest bez skutku.
- `DELETE` → `204` bez ciała; `409 CONFLICT`, gdy konto ma **jakąkolwiek** transakcję —
  także miękko usuniętą, bo tę można jeszcze przywrócić.
- `PATCH /accounts/order` może wymienić część kont (np. tylko aktywne). Wymienione
  dostają pozycje `0…n−1`, pozostałe idą za nimi w dotychczasowej kolejności. Odpowiedź:
  **wszystkie** konta, łącznie z zarchiwizowanymi, w nowej kolejności. Identyfikator spoza
  gospodarstwa → `404` i brak jakiejkolwiek zmiany; powtórzony identyfikator → `400`.
- Brak tokenu daje `401` **przed** walidacją ciała — żądanie bez tokenu i z błędnym ciałem
  nie dostaje `400`.

**`POST /accounts`**

```jsonc
{
  "name": "Konto mieszkaniowe",
  "type": "savings",                  // checking | cash | savings | investment | other
  "allocationClass": "savings",       // opcjonalne — domyślnie wynika z `type`
  "openingBalanceMinor": 1250000,     // 12 500,00 zł
  "openingBalanceOn": "2026-09-01",
  "institution": "mBank",
  "color": "#22c55e",
  "icon": "piggy-bank",
  "includeInNetWorth": true
}
```

**`GET /accounts/balances`** (od `F2-2`, [ADR-032](./14-decisions-log.md#adr-032))

- `?month=YYYY-MM` — saldo na **ostatni** dzień miesiąca budżetowego; `?asOf=YYYY-MM-DD` —
  saldo na ten dzień, ruch od początku jego miesiąca; bez parametrów — na dziś w strefie
  gospodarstwa. Oba naraz → `400`.
- Lista: konta aktywne oraz zarchiwizowane z niezerowym saldem na początku miesiąca albo
  na `asOf` (pole `isArchived`), w kolejności kont.
- `liabilitiesRemainingMinor` do `F4-4` wynosi `0`.

**`GET /accounts/balances?month=2026-09`**

```jsonc
{
  "data": [
    {
      "accountId": "01JB...", "name": "ROR", "type": "checking",
      "allocationClass": "spending", "isArchived": false,
      "balanceMinor": 843210,
      "balanceAtMonthStartMinor": 512000,
      "changeInMonthMinor": 331210
    }
  ],
  "meta": {
    "asOf": "2026-09-30",
    "totalsByClass": { "spending": 843210, "savings": 4200000, "investment": 1800000 },
    "netWorthMinor": 6843210,        // aktywa − pozostałe zobowiązania
    "liabilitiesRemainingMinor": 3200000
  }
}
```

---

## 6. Kategorie — `/api/v1/categories`

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/categories` | Lista drzewiasta. Filtry: `?kind=expense&includeArchived=`. |
| GET | `/categories/flat` | Lista płaska — na potrzeby selectów i promptu AI. |
| POST | `/categories` | Nowa kategoria (również podkategoria przez `parentId`). |
| PATCH | `/categories/:id` | Edycja — w tym `aiHints`. |
| POST | `/categories/:id/archive` | Archiwizacja. |
| POST | `/categories/:id/unarchive` | Przywrócenie z archiwum (dodane przy `F2-3`, [ADR-033](./14-decisions-log.md#adr-033)). |
| DELETE | `/categories/:id` | Usunięcie — blokowane dla `isSystem` oraz kategorii z transakcjami. |
| POST | `/categories/:id/merge` | Scalenie w inną: `{ "targetCategoryId": "..." }` — przepina transakcje i archiwizuje źródło. |
| GET | `/categories/usage?month=` | Liczba transakcji i suma w miesiącu per kategoria — ekran ustawień (dodane przy `F2-9`, [ADR-038](./14-decisions-log.md#adr-038)). |
| ~~GET~~ | ~~`/categories/spending?month=`~~ | **Nie powstaje** — zastąpione przez `GET /months/:key/categories` (ADR-039). |

**Szczegóły zachowania** (ustalone przy `F2-3`, [ADR-033](./14-decisions-log.md#adr-033))

- `POST` → `201` z `Location`. `slug` powstaje raz (podkategoria: `<slug-rodzica>-<nazwa>`,
  przy kolizji przyrostek `-2`, `-3`…) i **nie zmienia się** przy zmianie nazwy.
- Nazwa unikalna wśród rodzeństwa (ten sam `kind` i rodzic), bez względu na wielkość
  liter, łącznie z zarchiwizowanymi → inaczej `409`.
- Rodzic: kategoria główna (I-11), tego samego rodzaju, niezarchiwizowana → inaczej `422`;
  rodzic spoza gospodarstwa → `404`.
- `PATCH` przyjmuje `name`, `parentId` (`null` = poziom główny), `icon`, `color`, `aiHints`;
  **nie** `kind`. Kategoria z dziećmi nie może stać się podkategorią → `422`.
- `archive` kategorii głównej archiwizuje też jej podkategorie; `unarchive` podkategorii
  przywraca też jej rodzica. Obie idempotentne, `200` z `CategoryDto`.
- `DELETE` → `204`; systemowa → `422` (I-9); z podkategoriami → `409`; z jakąkolwiek
  transakcją, także miękko usuniętą → `409` (I-10).
- `merge` → `200` z `{ target, transactionsMoved }`. Źródło systemowe, ten sam
  identyfikator, inny rodzaj, cel w archiwum, źródło z podkategoriami → `422`.
- `GET /categories/spending` przesunięte do Fazy 3, a w `F3-2` zastąpione przez
  `/months/:key/categories` — to ten sam raport (ADR-039).
- `GET /categories/usage?month=YYYY-MM` → `200` z `CategoryUsageDto[]` (05 §6): wyłącznie
  kategorie z co najmniej jedną transakcją. `transactionCount` — transakcje w księdze bez
  kosza, ze wszystkich miesięcy; `monthAmountMinor` — suma `posted` z podanego miesiąca.
  Liczby **samej** kategorii, bez podkategorii. Brak albo zły `month` → `400`. To
  statystyka ekranu ustawień, nie raport — `spending` zostaje w Fazie 3 (ADR-038).

```jsonc
// POST /categories
{
  "name": "Kawa na mieście",
  "kind": "expense",
  "parentId": "01JB...",             // kategoria "Jedzenie"
  "icon": "coffee",
  "color": "#a16207",
  "aiHints": "Starbucks, Costa, kawiarnia, espresso"
}
```

---

## 7. Transakcje — `/api/v1/transactions`

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/transactions` | Lista z filtrami i paginacją kursorową. |
| POST | `/transactions` | Nowa transakcja (dowolny `type`). |
| GET | `/transactions/:id` | Szczegóły. |
| PATCH | `/transactions/:id` | Edycja. |
| DELETE | `/transactions/:id` | Miękkie usunięcie. |
| POST | `/transactions/:id/restore` | Cofnięcie usunięcia. |
| POST | `/transactions/bulk` | Wiele naraz — `{ transactions: [...] }` (1–100), wszystkie albo żadna; `201` z listą i `meta.affectedMonths`; błąd pozycji z `details.path = transactions.<i>.<pole>`; opcjonalny `Idempotency-Key` (`F7-6`, ADR-059). |
| POST | `/transactions/:id/save-as-recurring` | Tworzy regułę cykliczną z istniejącej transakcji (wymaganie #3). **`F4-8`**. |

**Szczegóły zachowania** (ustalone przy `F2-5`, [ADR-035](./14-decisions-log.md#adr-035))

- `POST` → `201` z `Location` i `{ data: TransactionDto, meta: { affectedMonths } }`.
  Przyjmuje **opcjonalny** `Idempotency-Key` (§1, od `F2-7`); formularz wysyła go zawsze.
  Status `posted`, źródło `manual`, autor z tokenu. Ciało to pola **bez** walidacji
  krzyżowej: naruszenie I-2, I-3, I-7a (i źródło przychodu przy innym typie niż przychód)
  daje **`422`** z listą problemów w `details` — nie `400` (§2).
- Odwołania (`accountId`, `counterAccountId`, `categoryId`, `incomeSourceId`, `goalId`,
  `liabilityId`): byt spoza gospodarstwa → `404` z polem w `details`; konto, kategoria
  albo źródło **zarchiwizowane** → `422`; kategoria innego rodzaju niż typ → `422` (I-4).
  Sprawdzane są odwołania ustawiane zapisem — transakcja na koncie zarchiwizowanym później
  daje się dalej poprawiać.
- Data poza oknem księgowania (I-8, [07 §1.3](./07-domain-rules.md#13-księgowanie-wstecz-wymaganie-12))
  → `422` z `details: [{ path: 'bookedOn' }]`. Sprawdzana przy zapisie i przy zmianie daty.
- **Zamknięty miesiąc** (transakcja sprzed okna, [07 §1.4](./07-domain-rules.md#14-zamknięte-miesiące),
  od `F3-3`): `PATCH` zmieniający cokolwiek poza `description`, `merchant`, `notes` → `422`
  z `details` wskazującym zablokowane pola (całe żądanie odrzucone); `DELETE` i `restore`
  → `422`. Operacje bez skutku (ponowne usunięcie usuniętej) zostają `204`/`200`.
- `GET /transactions/:id` → `TransactionListItemDto` (z nazwami), także dla transakcji
  z kosza — z niepustym `deletedAt`.
- `PATCH` zmienia wyłącznie przysłane pola, które się różnią; puste albo niczego
  niezmieniające ciało nie rusza `updatedAt`. `type` jest niezmienny (pole jest pomijane).
  `null` czyści pole opcjonalne. Kształt sprawdzany na transakcji **po scaleniu**
  (`PATCH { counterAccountId: null }` na przelewie → `422`). Odpowiedź jak przy `POST`,
  `affectedMonths` obejmuje stary i nowy miesiąc. Transakcja w koszu → `409`.
- `DELETE` → `204`, miękko (`deletedAt`); ponowne wywołanie bez skutku.
  `POST /:id/restore` → `200` jak `PATCH`; na transakcji spoza kosza bez skutku.
- Brak tokenu → `401` przed walidacją ciała.
- `bulk` powstał z commitem dokumentu (`F7-6`); commit korzysta z tej samej funkcji
  serwisu w swojej transakcji bazodanowej (nowe kategorie + transakcje razem).

**Parametry `GET /transactions`**

| Parametr | Typ | Uwagi |
|---|---|---|
| `month` | `YYYY-MM` | Najczęstszy filtr. Po `month_key` (I-1). |
| `from`, `to` | `YYYY-MM-DD` | Zamiast `month` (oba naraz → `400`). Krańce włącznie. |
| `type` | `expense\|income\|transfer` | Wielokrotny. |
| `accountId`, `categoryId`, `goalId`, `liabilityId`, `incomeSourceId` | id | Wielokrotne. `accountId` łapie **obie** strony przelewu. |
| `allocationKind` | `savings\|investment\|debt_repayment` | Filtruje po puli, której dotyczy efekt alokacji — wynik zgodny z `allocationEffects`. Wielokrotny. |
| `source` | `manual\|ocr\|recurring\|planned\|import` | Wielokrotny. |
| `q` | tekst | Szuka w `description`, `merchant`, `notes` — bez względu na wielkość liter i ogonki („zabka" znajdzie „Żabkę"); `%` i `_` dosłownie. |
| `minAmountMinor`, `maxAmountMinor` | int ≥ 0 | Krańce włącznie. |
| `uncategorized` | `true\|false` | Tylko transakcje bez kategorii (od `F3-4`, `Z-18`, ADR-041). Razem z `categoryId` → `400`. |
| `includeDeleted` | `true\|false` | Domyślnie `false`. Inna wartość → `400`. |
| `sort` | `bookedOn\|amount\|createdAt` + `:asc\|:desc` | Domyślnie `bookedOn:desc`. `createdAt` tylko `:desc`. Remis rozstrzyga `id`. |
| `limit` | 1–200 | Domyślnie 50. |
| `cursor` | string | Z `meta.nextCursor`; nieprzezroczysty. Uszkodzony albo z innego `sort` → `400`. |

Odpowiedź: `{ data: TransactionListItemDto[], meta: { nextCursor, hasMore, summary? } }`.

`meta.summary` (od `F2-8`, [ADR-038](./14-decisions-log.md#adr-038)) — **tylko na pierwszej
stronie** (bez `cursor`), liczone dla tych samych filtrów co lista: `count` (każda pasująca
transakcja, także z kosza przy `includeDeleted=true`), `expenseMinor`, `incomeMinor`,
`transferMinor` (wyłącznie `posted` i nieusunięte) oraz `days` — sumy wydatków i wpływów
każdego dnia z co najmniej jedną transakcją, od najnowszego. Suma dnia z serwera, bo dzień
rozcięty granicą strony pokazywałby na froncie sumę części transakcji.

**`POST /transactions` — wydatek**

```jsonc
{
  "type": "expense",
  "bookedOn": "2026-09-18",
  "amountMinor": 12799,
  "accountId": "01JB...",
  "categoryId": "01JC...",
  "description": "Zakupy tygodniowe",
  "merchant": "Lidl",
  "notes": null
}
```

**`POST /transactions` — przychód**

```jsonc
{
  "type": "income",
  "bookedOn": "2026-09-10",
  "amountMinor": 980000,
  "accountId": "01JB...",            // konto, na które wpłynął
  "incomeSourceId": "01JD...",
  "categoryId": "01JE...",           // kategoria o kind='income'
  "description": "Wynagrodzenie wrzesień"
}
```

**`POST /transactions` — przelew na cel (odkładanie)**

```jsonc
{
  "type": "transfer",
  "bookedOn": "2026-09-11",
  "amountMinor": 200000,             // 2 000,00 zł
  "accountId": "01JB...",            // z ROR
  "counterAccountId": "01JF...",     // na konto mieszkaniowe
  "goalId": "01JG...",
  // opcjonalne; pominięte → alokacja wyliczana z klas kont (07 §2.2).
  // 'none' wyłącza operację z rozliczania celów procentowych.
  "allocationOverride": null,
  "description": "Wkład własny — wrzesień"
}
```

Odpowiedź zawiera wyliczone `allocationEffects` — ujęcie **netto**, więc przelew
z konta oszczędnościowego na bieżące zwróci efekt ujemny:

```jsonc
{
  "sourceAllocationClass": "spending",
  "targetAllocationClass": "savings",
  "allocationOverride": null,
  "allocationEffects": [{ "kind": "savings", "amountMinor": 200000 }]
}
```

Rata zobowiązania (wydatek z `liabilityId`) zwraca `[{ "kind": "debt_repayment", ... }]`,
chyba że `allocationOverride: 'none'` ([07 §2.2a](./07-domain-rules.md#22a-spłata-zobowiązań)).

Odpowiedź `201` zawiera pełne DTO transakcji oraz `meta.affectedMonths` — listę miesięcy,
których cache frontend powinien unieważnić (istotne przy księgowaniu wstecz).

**`POST /transactions/:id/save-as-recurring`** (`F4-8`, [ADR-051](./14-decisions-log.md#adr-051))

```jsonc
// żądanie — każde pole opcjonalne; `{}` = co miesiąc, dnia transakcji, od jej miesiąca
{ "name": "Czynsz", "frequency": "monthly", "dayOfMonth": 10,
  "startMonth": "2026-10", "autoPost": false, "isFixedExpense": true }
// 201 → RecurringRuleDto
```

- Kwota, konta, kategoria, źródło, cel, zobowiązanie i nadpisanie alokacji — **z transakcji**;
  ciało niesie terminarz (`SaveAsRecurringRequestSchema`, 05 §11). Reguła przechodzi te same
  sprawdzenia co `POST /recurring/rules` (`422`).
- Transakcja staje się zaksięgowaniem wystąpienia swojego miesiąca (termin najbliższy jej
  dacie), o ile miesiąc jest otwarty — nie trafia do „Do zrobienia" drugi raz. Przy regule
  tygodniowej wcześniejsze terminy tego miesiąca zapisują się jako pominięte (07 §6.8).
- Rata zobowiązania bez reguły — nowa reguła zostaje jego regułą raty (ADR-047).
- `409` — transakcja w koszu, już pochodząca z pozycji cyklicznej albo rata zobowiązania,
  które ma regułę. `404` — transakcji nie ma w gospodarstwie.
- Opcjonalny nagłówek `Idempotency-Key`, zakres per transakcja — ponowienie nie zakłada
  drugiej reguły.

---

## 8. Zobowiązania — `/api/v1/liabilities`

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/liabilities` | Lista z wyliczonym stanem bieżącym. |
| POST | `/liabilities` | Nowe zobowiązanie. |
| GET | `/liabilities/:id` | Szczegóły + historia płatności. |
| PATCH | `/liabilities/:id` | Edycja. |
| DELETE | `/liabilities/:id` | Usunięcie (płatności zachowują się jako zwykłe wydatki). |
| POST | `/liabilities/:id/payments` | Zaksięgowanie raty — tworzy transakcję i wiąże ją z zobowiązaniem. |
| GET | `/liabilities/:id/schedule` | Prognozowany harmonogram do spłaty. |
| POST | `/liabilities/:id/rebase` | Korekta stanu: nowa „pozostała kwota" na wskazany dzień. |

**`GET /liabilities` — element odpowiedzi**

```jsonc
{
  "id": "01JH...",
  "name": "Kredyt hipoteczny",
  "kind": "mortgage",
  "creditor": "mBank",
  "openingBalanceMinor": 32000000,
  "balanceAsOf": "2026-01-01",
  "remainingMinor": 30150000,            // wyliczone: opening − suma rat po balanceAsOf
  "paidSoFarMinor": 1850000,
  "monthlyPaymentMinor": 185000,
  "installmentsRemaining": 163,          // wyliczone
  "projectedFinalPaymentOn": "2040-04-10",
  "paymentDay": 10,
  "progressBps": 578,                    // 5,78% spłacone
  "paidThisMonth": true,
  "isActive": true
}
```

`POST /liabilities/:id/rebase` istnieje, bo po roku wyliczenie „opening − suma rat"
rozjedzie się z wyciągiem z banku (odsetki, nadpłaty). Korekta zapisuje nowy punkt
odniesienia zamiast zmuszać do poprawiania historii transakcji.

**Szczegóły zachowania** (ustalone przy `F4-4`, [ADR-047](./14-decisions-log.md#adr-047))

- `GET /` — filtr `?isActive=true|false`; aktywne przed zamkniętymi, potem po nazwie.
  Element ma dodatkowo `nextDueOn`, `lastPaymentOn`, `firstPaymentOn`,
  `installmentsRemainingAtAsOf`, `createdAt`, `updatedAt`.
- `POST /` → `201` z `Location`. Ciało bez walidacji krzyżowej; `createRecurringRule` bez
  `paymentAccountId` albo `paymentDay` i `firstPaymentOn < balanceAsOf` → `422`. Cudze konto
  albo kategoria → `404`, konto z archiwum i kategoria nie-wydatkowa → `422`
  (`details.path`: `paymentAccountId`, `categoryId`). Reguła na ratę: od `firstPaymentOn`,
  a bez niej od pierwszej raty po `balanceAsOf`; do miesiąca ostatniej raty z prognozy.
- `GET /:id` — dokłada `payments`: do 24 ostatnich rat (wydatki z `liabilityId`, od najnowszej).
- `PATCH /:id` — każde pole poza `createRecurringRule`, plus `isActive`; `isActive: false`
  wstrzymuje reguły raty. Zmiana `firstPaymentOn` przesuwa start i koniec reguły raty
  o tyle samo miesięcy ([ADR-068](./14-decisions-log.md#adr-068)). `DELETE` → `204`, reguły raty wstrzymane, raty zostają zwykłymi
  wydatkami.
- `POST /:id/payments` → `201 { data: { liability, transaction }, meta: { affectedMonths } }`;
  wymaga `Idempotency-Key`; ciało `{ amountMinor?, bookedOn?, accountId?, notes? }`. Czekająca
  rata z reguły w oknie generowania jest księgowana jako to wystąpienie; inaczej wydatek:
  rata, dziś, konto płatności (brak → `422`). Zamknięte → `409`.
- `GET /:id/schedule` → `[{ number, dueOn, amountMinor, remainingAfterMinor }]`.
- `POST /:id/rebase` → `200` z zobowiązaniem; `asOf` w przyszłości → `422`.

---

## 9. Pozycje cykliczne — `/api/v1/recurring`

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/recurring/rules` | Lista reguł. Filtry: `?flow=&isFixedExpense=&isActive=`. |
| POST | `/recurring/rules` | Nowa reguła. |
| GET | `/recurring/rules/:id` | Szczegóły + najbliższe wystąpienia. |
| PATCH | `/recurring/rules/:id` | Edycja — dotyczy **wyłącznie przyszłych** wystąpień. |
| DELETE | `/recurring/rules/:id` | Usunięcie reguły; wystąpienia już zaksięgowane zostają. |
| POST | `/recurring/rules/:id/pause` / `/resume` | Wstrzymanie i wznowienie. |
| GET | `/recurring/occurrences?month=` | Wystąpienia w miesiącu (generowane leniwie). |
| POST | `/recurring/occurrences/:id/post` | Zaksięgowanie → tworzy transakcję. |
| POST | `/recurring/occurrences/:id/skip` | Pominięcie w tym miesiącu. |
| POST | `/recurring/occurrences/:id/unpost` | Cofnięcie zaksięgowania: wystąpienie wraca do `planned`, jego transakcja trafia do kosza (z „Cofnij"). To samo co usunięcie tej transakcji z listy — 07 §6.7, ADR-042. |
| POST | `/recurring/generate` | Wymuszenie generacji: `{ "month": "2026-10" }`. |

**Szczegóły zachowania reguł** (ustalone przy `F4-1`, [ADR-043](./14-decisions-log.md#adr-043))

- `POST` → `201` z `Location`. Ciało bez walidacji krzyżowej: kształt (I-2, I-3, I-7a,
  źródło tylko przy przychodzie) i terminarz → `422` z polami w `details`, jak przy
  transakcjach. Odwołania tymi samymi regułami co transakcja: cudze → `404`, archiwum
  i kategoria innego rodzaju → `422`.
- Terminarz: `monthly`/`quarterly`/`every_n_months` wymagają `dayOfMonth`, `yearly` także
  `monthOfYear`, `weekly`/`biweekly` — `weekday` (0 = niedziela). `every_n_months` wymaga
  `intervalCount ≥ 2`. `endMonth ≥ startMonth`. Pola bez znaczenia dla częstotliwości są
  czyszczone, `intervalCount` poza `every_n_months` to `1`. `anchorDate` pominięty —
  pierwszy `weekday` miesiąca startu (dla `biweekly`); podany musi wypadać w `weekday`.
- `nextDueOn` — najbliższy termin od dziś (strefa gospodarstwa), `null` dla wstrzymanej
  i zakończonej. `GET /rules/:id` dokłada `upcomingDueDates` — do sześciu terminów
  wyliczonych z terminarza (bez zapisu wystąpień).
- `GET /rules` — filtry `flow`, `isFixedExpense`, `isActive` (`true`/`false`); aktywne
  przed wstrzymanymi, potem po nazwie.
- `PATCH` — każde pole poza `flow` (niezmienny, pomijany); reguła sprawdzana po scaleniu;
  sprawdzane tylko zmieniane odwołania; zmiana częstotliwości, dnia tygodnia albo miesiąca
  startu bez kotwicy wylicza kotwicę na nowo. Skutki dla wystąpień (07 §6.4, ADR-045):
  kwota — czekające od bieżącego miesiąca; terminarz — czekające od bieżącego miesiąca
  i spoza nowego okresu usuwane i generowane na nowo.
- `pause`/`resume` → `200` z regułą, idempotentne. Wznowienie zapisuje terminy
  wcześniejszych miesięcy okna jako pominięte. `DELETE` → `204`; wystąpienia znikają,
  zaksięgowane transakcje zostają jako zwykłe.

**Szczegóły zachowania wystąpień** (ustalone przy `F4-2`, [ADR-045](./14-decisions-log.md#adr-045))

- `GET /occurrences?month=` — `month` wymagany (`400` bez niego). Miesiąc bieżący
  i wcześniejsze: najpierw generowanie okna (od początku okna księgowania do bieżącego
  miesiąca), potem odczyt z bazy. Miesiąc przyszły: podgląd z reguł, `id: null`,
  `meta.isPreview: true`, nic nie jest zapisywane. Kolejność: termin, nazwa reguły.
- `GET /months/:key/summary` dla miesiąca nieprzyszłego też generuje okno.
- `POST /generate` → `200` z `{ "month", "createdCount" }` (liczba nowych w całym oknie);
  miesiąc przyszły albo zamknięty → `422`.

**`POST /recurring/rules`**

```jsonc
{
  "name": "Wpłata na IKE",
  "flow": "transfer",
  "amountMinor": 100000,
  "amountIsEstimate": false,
  "accountId": "01JB...",
  "counterAccountId": "01JI...",     // konto maklerskie
  "goalId": "01JJ...",
  "allocationOverride": null,
  "frequency": "monthly",
  "dayOfMonth": 5,
  "startMonth": "2026-10",
  "endMonth": null,
  "autoPost": true,
  "isFixedExpense": false
}
```

**`GET /recurring/occurrences?month=2026-09`**

```jsonc
{
  "data": [
    {
      "id": "01JK...",
      "ruleId": "01JL...",
      "ruleName": "Czynsz",
      "flow": "expense",
      "dueOn": "2026-09-10",
      "monthKey": "2026-09",
      "plannedAmountMinor": 185000,
      "status": "posted",
      "postedAmountMinor": 185000,
      "transactionId": "01JM...",
      "isFixedExpense": true,
      "isOverdue": false,
      "amountIsEstimate": false,
      "categoryId": "01JN...",
      "categoryName": "Czynsz",
      "allocationEffects": []
    }
  ],
  "meta": {
    "month": "2026-09",
    "isPreview": false,                // true dla miesiąca przyszłego — wtedy "id": null
    "plannedTotalMinor": 645000,
    "postedTotalMinor": 445000,
    "remainingTotalMinor": 200000,
    "byFlow": {
      "expense":  { "plannedMinor": 445000, "postedMinor": 445000 },
      "transfer": { "plannedMinor": 200000, "postedMinor": 0 },
      "income":   { "plannedMinor": 0,      "postedMinor": 0 }
    }
  }
}
```

**Księgowanie, pomijanie, cofanie** (ustalone przy `F4-3`, [ADR-046](./14-decisions-log.md#adr-046))

- `post` → `201 { data: { occurrence, transaction }, meta: { affectedMonths } }`. Bez
  `Idempotency-Key` → `400`; klucz obowiązuje dla danego wystąpienia. Puste ciało albo brak
  ciała — kwota planowana w dniu terminu, z konta reguły. Zaksięgowane → `409`; pominięte
  można zaksięgować. Naruszenie okna księgowania, konto z archiwum, reguła bez konta → `422`.
- `skip` → `200` z wystąpieniem; ciało `{ "reason": "urlop" }` opcjonalne; idempotentne;
  zaksięgowane → `409`.
- `unpost` → `200 { data: occurrence, meta: { affectedMonths } }`; niezaksięgowane bez
  zmian; zamknięty miesiąc → `422`.
- Cudze wystąpienie → `404`. Auto-księgowanie działa przy odczycie listy, dashboardu
  i przy `/generate`.

**`POST /recurring/occurrences/:id/post`**

```jsonc
// żądanie — puste ciało księguje kwotę planowaną
{ "amountMinor": 191200, "bookedOn": "2026-09-11", "notes": "wyższy rachunek za prąd" }
// 201 → { "data": { "occurrence": {...}, "transaction": {...} }, "meta": { "affectedMonths": ["2026-09"] } }
```

Wymaga nagłówka `Idempotency-Key` — chroni przed podwójnym zaksięgowaniem
przy niestabilnym połączeniu mobilnym.

---

## 9a. Planowane wydatki — `/api/v1/planned-expenses`

Realizacja wymagania #13. Reguły wyliczeń: [07 §6.5](./07-domain-rules.md#65-planowane-wydatki).

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/planned-expenses` | Lista. Filtry: `?status=&from=&to=&priority=`. Domyślnie aktywne, rosnąco po terminie. |
| GET | `/planned-expenses/upcoming?months=6` | Najbliższe wydatki + prognoza płynności — na dashboard. |
| POST | `/planned-expenses` | Nowy planowany wydatek. |
| GET | `/planned-expenses/:id` | Szczegóły + historia odkładania. |
| PATCH | `/planned-expenses/:id` | Edycja (w tym korekta szacunku). |
| DELETE | `/planned-expenses/:id` | Usunięcie. |
| POST | `/planned-expenses/:id/set-aside` | Zaksięgowanie miesięcznej wpłaty na odkładanie. |
| POST | `/planned-expenses/:id/post` | Zaksięgowanie wydatku → tworzy transakcję. |
| POST | `/planned-expenses/:id/defer` | Przesunięcie terminu: `{ "dueMonth": "2027-03" }`. |
| POST | `/planned-expenses/:id/cancel` | Odwołanie (np. sprzedano samochód). |

**`POST /planned-expenses`**

```jsonc
{
  "name": "OC + AC samochód",
  "estimatedAmountMinor": 240000,      // 2 400,00 zł — szacunek
  "dueMonth": "2027-03",
  "dueOn": "2027-03-14",               // opcjonalne
  "categoryId": "01JT...",             // Transport > Ubezpieczenie
  "accountId": "01JB...",
  "priority": "must",
  "setAsideEnabled": true,
  "setAsideAccountId": "01JF...",      // gdzie zbieramy
  "alreadySetAsideMinor": 0,
  "repeatsYearly": true,
  "notes": "Link4, polisa nr ..."
}
```

**`GET /planned-expenses/upcoming?months=6`**

```jsonc
{
  "data": [
    {
      "id": "01JU...",
      "name": "OC + AC samochód",
      "estimatedAmountMinor": 240000,
      "amountIsEstimate": true,
      "dueMonth": "2027-03",
      "dueOn": "2027-03-14",
      "monthsUntilDue": 6,
      "priority": "must",
      "status": "funding",
      "categoryId": "01JT...",
      "categoryName": "Ubezpieczenie OC/AC",

      "setAside": {
        "enabled": true,
        "accountId": "01JF...",
        "accumulatedMinor": 80000,          // zebrane do tej pory
        "remainingMinor": 160000,
        "coverageBps": 3333,                // 33,33% odłożone
        "monthlyRequiredMinor": 26667,      // wyliczane co miesiąc na nowo
        "paidThisMonth": false,
        "isOnTrack": true
      },
      "repeatsYearly": true
    }
  ],
  "meta": {
    "horizonMonths": 6,
    "totalUpcomingMinor": 520000,
    "totalSetAsideMinor": 130000,
    "monthlySetAsideRequiredMinor": 64500,   // suma rat wszystkich wydatków z odkładaniem
    "byMonth": [
      { "month": "2026-11", "totalMinor": 80000, "coveredMinor": 80000,  "shortfallMinor": 0 },
      { "month": "2027-03", "totalMinor": 240000, "coveredMinor": 80000, "shortfallMinor": 160000 }
    ],
    "liquidityWarnings": [
      {
        "month": "2027-03",
        "code": "INSUFFICIENT_PROJECTED_BALANCE",
        "message": "W marcu 2027 wypada 2 400,00 zł, a prognozowane saldo to 1 900,00 zł.",
        "gapMinor": 50000
      }
    ]
  }
}
```

`monthlySetAsideRequiredMinor` w `meta` to liczba, dla której ta funkcja istnieje:
*ile muszę odkładać miesięcznie, żeby wszystkie zaplanowane wydatki były pokryte na czas*.

**`POST /planned-expenses/:id/set-aside`**

```jsonc
// puste ciało → księguje kwotę wyliczoną (`monthlyRequiredMinor`)
{ "amountMinor": 26667, "bookedOn": "2026-09-20", "fromAccountId": "01JB..." }
// 201 → { "data": { "plannedExpense": {...}, "transaction": {...} } }
```

Tworzy przelew z konta źródłowego na `setAsideAccountId`; alokacja wyliczana jest
z klas kont (07 §2.2), transakcja dostaje `plannedExpenseId`. Wymaga nagłówka `Idempotency-Key`.

**`POST /planned-expenses/:id/post`**

```jsonc
{ "amountMinor": 251300, "bookedOn": "2027-03-14", "accountId": "01JF..." }
// 201 → { "data": { "plannedExpense": {...}, "transaction": {...}, "nextInstance": {...} } }
```

Tworzy wydatek, ustawia status `posted`. Gdy `repeatsYearly = true`, w odpowiedzi jest
`nextInstance` — automatycznie utworzony wydatek na ten sam miesiąc w następnym roku,
z kwotą równą **faktycznie zapłaconej** (lepszy szacunek niż poprzedni).

**Doprecyzowania z `F6-1`…`F6-5`** ([ADR-055](./14-decisions-log.md#adr-055)):

- `GET /planned-expenses?status=&from=&to=&priority=` — `status` pojedynczy albo powtórzony;
  domyślnie aktywne (`planned`, `funding`, `ready`, `deferred`).
- `GET /:id` dokłada `setAsideHistory` (24 ostatnie przelewy odkładania).
- `PATCH` i akcje na wydatku `posted` albo `cancelled` → `409`.
- `POST /:id/set-aside` — puste ciało = rata wyliczona, dziś, z konta płatności na konto
  odkładania (albo konto celu, z `goalId`); pokryte w całości → `422`.
- `POST /:id/post` — każde pole opcjonalne (kwota szacunku, dziś, konto i kategoria
  wydatku); wymagany `Idempotency-Key`; `nextInstance` tylko przy pierwszej zapłacie.
- `POST /:id/defer` — `{ dueMonth, dueOn? }`, termin w przeszłości → `422`.
- `GET /upcoming?months=1..24` (domyślnie 6) — także zaległe (obciążają bieżący miesiąc);
  `meta.setAsidePaidThisMonthMinor`; ostrzeżenie ma `plannedExpenseId` (albo `null` dla
  całego miesiąca).
- `GET /transactions?plannedExpenseId=` — wpłaty i zapłata wydatku.

## 10. Cele — `/api/v1/goals`

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/goals` | Lista z postępem. `?month=` liczy plan wpłat dla miesiąca. |
| POST | `/goals` | Nowy cel (oszczędnościowy lub inwestycyjny). |
| GET | `/goals/:id` | Szczegóły + historia wpłat. |
| PATCH | `/goals/:id` | Edycja. |
| DELETE | `/goals/:id` | Usunięcie (wpłaty zostają, tracą powiązanie). |
| POST | `/goals/:id/contributions` | Wpłata na cel — skrót tworzący przelew. |
| POST | `/goals/:id/complete` | Oznaczenie jako osiągnięty. |
| POST | `/goals/convert` | **Przelicznik % ↔ kwota** (wymaganie #6). |
| PATCH | `/goals/order` | Zmiana priorytetów. |

**`POST /goals/convert`** — przelicznik dwukierunkowy, bez zapisu do bazy:

```jsonc
// żądanie A: mam kwotę, chcę procent
{ "month": "2026-09", "amountMinor": 200000 }
// 200
{
  "data": {
    "month": "2026-09",
    "incomeBaseMinor": 1180000,        // podstawa: przychody wliczane do alokacji
    "amountMinor": 200000,
    "percentBps": 1695,                // 16,95%
    "isPartialMonth": true,            // miesiąc trwa — podstawa może jeszcze urosnąć
    "basedOnIncomeSoFar": true
  }
}

// żądanie B: mam procent, chcę kwotę
{ "month": "2026-09", "percentBps": 2000 }
// 200 → { "data": { "amountMinor": 236000, "percentBps": 2000, ... } }
```

**`GET /goals?month=2026-09` — element odpowiedzi**

```jsonc
{
  "id": "01JG...",
  "name": "Wkład własny",
  "kind": "savings",
  "purpose": "down_payment",
  "targetAmountMinor": 12000000,
  "targetDate": "2028-06-30",
  "currentAmountMinor": 4200000,
  "progressBps": 3500,
  "remainingMinor": 7800000,
  "contribution": {
    "mode": "fixed",
    "plannedAmountMinor": 200000,
    "plannedPercentBps": 1695,          // przeliczone na % wpływów miesiąca
    "contributedThisMonthMinor": 200000,
    "isPlanMetThisMonth": true
  },
  "projection": {
    "monthsToTargetAtCurrentPace": 39,
    "projectedCompletionMonth": "2029-12",
    "requiredMonthlyToHitTargetDateMinor": 371429,
    "isOnTrack": false                  // tempo nie wystarczy do targetDate
  },
  "status": "active"
}
```

**Doprecyzowania z `F5-1`, `F5-2`** ([ADR-052](./14-decisions-log.md#adr-052)):

- `GET /goals?month=&kind=&includeArchived=` → `{ data, meta }`, `meta` =
  `{ month, incomeBaseMinor, isPartialMonth, plannedTotalMinor, contributedTotalMinor }`
  (sumy celów aktywnych). Archiwum domyślnie pominięte. Kolejność — `priority`.
- Plan (`contribution`) dotyczy `?month=`, prognoza (`projection`, z `paceMonthlyMinor`)
  zawsze bieżącego miesiąca. Odczyt oznacza cel z zebraną kwotą docelową jako `achieved`.
- `GET /goals/:id` dokłada `contributions` (24 ostatnie przelewy z celem) i `history`
  (wpłaty netto sześciu miesięcy do bieżącego).
- `PATCH /goals/:id` — `status` tylko `active | paused | archived`; `achieved` przez
  `POST /:id/complete` (powtórzenie zachowuje datę).
- `POST /goals/:id/contributions` — `{ amountMinor, fromAccountId, toAccountId?, bookedOn?,
  notes? }`, wymagany `Idempotency-Key`; konto docelowe domyślnie powiązane z celem
  (brak → `422`), cel w archiwum → `409`. `201` → `{ data: { goal, transaction },
  meta: { affectedMonths } }`.
- `PATCH /goals/order` — `{ ids }`, permutacja **wszystkich** celów gospodarstwa (`422`).
- `POST /goals/convert` — `400`, gdy nie ma dokładnie jednej strony; procent przycięty do
  1000%; przy zerowej podstawie `0`.

---

## 11. Rozkład docelowy — `/api/v1/allocation`

Realizacja wymagania #8.

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/allocation/target?month=` | Rozkład obowiązujący dla miesiąca. |
| PUT | `/allocation/target` | Ustawienie rozkładu od wskazanego miesiąca. |
| GET | `/allocation/history` | Wszystkie wersje rozkładu. |
| GET | `/allocation/status?month=` | **Porównanie plan/wykonanie** — serce ekranu miesiąca. |
| GET | `/allocation/trend?from=&to=` | Realizacja miesiąc po miesiącu (wykres). |

**`PUT /allocation/target`**

```jsonc
{
  "effectiveFromMonth": "2026-10",
  "savingsPercentBps": 2000,        // 20%
  "investmentPercentBps": 1000,     // 10%
  "debtPercentBps": 0,
  "note": "Po podwyżce"
}
```

**`GET /allocation/status?month=2026-09`**

```jsonc
{
  "data": {
    "month": "2026-09",
    "incomeBaseMinor": 1180000,
    "isPartialMonth": true,
    "daysElapsed": 20,
    "daysInMonth": 30,
    "lines": [
      {
        "kind": "savings",
        "targetPercentBps": 2000,
        "targetAmountMinor": 236000,
        "actualAmountMinor": 200000,
        "actualPercentBps": 1695,
        "deltaAmountMinor": -36000,      // ujemne = brakuje
        "deltaPercentBps": -305,
        "fulfillmentBps": 8475,          // 84,75% celu
        "status": "behind"               // on_track | behind | ahead | met
      },
      {
        "kind": "investment",
        "targetPercentBps": 1000,
        "targetAmountMinor": 118000,
        "actualAmountMinor": 118000,
        "actualPercentBps": 1000,
        "deltaAmountMinor": 0,
        "deltaPercentBps": 0,
        "fulfillmentBps": 10000,
        "status": "met"
      }
    ],
    "totals": {
      "targetPercentBps": 3000,
      "actualPercentBps": 2695,
      "targetAmountMinor": 354000,
      "actualAmountMinor": 318000,
      "shortfallMinor": 36000            // ile jeszcze przelać, żeby domknąć plan
    }
  }
}
```

`shortfallMinor` to liczba, dla której ten ekran istnieje: *ile dokładnie muszę jeszcze
przelać w tym miesiącu*. Reguła wyliczenia — [07 §2](./07-domain-rules.md#2-alokacje-i-realizacja-celów-procentowych).

**Wartości ujemne.** Wykonanie jest liczone **netto** (ADR-011), więc `actualAmountMinor`,
`actualPercentBps` i `fulfillmentBps` bywają ujemne — w miesiącu, w którym wypłaty z puli
przewyższyły wpłaty. Status jest wtedy `behind`, a `shortfallMinor` odpowiednio większy:

```jsonc
{
  "kind": "savings",
  "targetPercentBps": 2000,
  "targetAmountMinor": 236000,
  "actualAmountMinor": -150000,      // wpłacono 50 000 gr, wypłacono 200 000 gr
  "actualPercentBps": -1271,
  "deltaAmountMinor": -386000,
  "fulfillmentBps": -6356,
  "status": "behind"
}
```

**Doprecyzowania z `F5-3`, `F5-4`** ([ADR-053](./14-decisions-log.md#adr-053)):

- `GET /allocation/target?month=` → wersja obowiązująca albo `data: null`.
- `PUT /allocation/target` — ten sam miesiąc poprawia wersję; miesiąc zamknięty → `422`;
  udział jednej puli > 100% → `400`; suma > 100% → `200` z
  `meta.warning: 'ALLOCATION_EXCEEDS_INCOME'` (inaczej `null`).
- `GET /allocation/history` — wersje malejąco po `effectiveFromMonth`.
- `GET /allocation/status?month=` — pominięty miesiąc = bieżący; odpowiedź ma
  `effectiveFromMonth`. Linie `savings` i `investment` zawsze, `debt_repayment` tylko przy
  `debtPercentBps > 0`.
- `GET /allocation/trend?from=&to=` — `data: AllocationStatusDto[]` rosnąco; domyślnie
  sześć miesięcy do bieżącego, najwyżej 24 (`400`).

---

## 12. Źródła przychodu — `/api/v1/income-sources`

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/income-sources` | Lista. |
| POST | `/income-sources` | Nowe źródło. |
| PATCH | `/income-sources/:id` | Edycja — w tym `countsTowardAllocation`. |
| POST | `/income-sources/:id/archive` | Archiwizacja. |
| POST | `/income-sources/:id/unarchive` | Przywrócenie (dodane przy `F2-4`, [ADR-034](./14-decisions-log.md#adr-034)). |
| DELETE | `/income-sources/:id` | Usunięcie, gdy nieużywane. |
| GET | `/income-sources/summary?month=` | Wpływy per źródło w miesiącu. **Faza 3** — raport miesiąca. |

**Szczegóły zachowania** (ustalone przy `F2-4`, [ADR-034](./14-decisions-log.md#adr-034))

- `GET` → lista w kolejności `sortOrder`; `?includeArchived=true` dołącza zarchiwizowane.
- `POST` → `201` z `Location`; nowe źródło na końcu listy. Pominięte
  `countsTowardAllocation` wynika z `kind`: `refund` → `false`, pozostałe → `true`.
- Nazwa unikalna w gospodarstwie (bez względu na wielkość liter, łącznie z archiwum) → `409`.
- `ownerUserId` spoza gospodarstwa → `404`; `null` = źródło wspólne.
- `PATCH` zmienia przysłane pola; zmiana `kind` **nie** przelicza `countsTowardAllocation`.
- `archive` / `unarchive` → `200`, idempotentne.
- `DELETE` → `204`; z jakimkolwiek przychodem, także w koszu → `409` (I-10).

---

## 13. Dokumenty / OCR — `/api/v1/documents`

Pełny opis pipeline'u: [08-ocr-ai-pipeline.md](./08-ocr-ai-pipeline.md).

| Metoda | Ścieżka | Opis |
|---|---|---|
| POST | `/documents` | Upload pliku (`multipart/form-data`). Zwraca `202`. |
| GET | `/documents` | Lista wrzuconych dokumentów. Filtry: `?status=&month=`. |
| GET | `/documents/:id` | Status + wynik analizy + pozycje. |
| POST | `/documents/:id/analyze` | Ponowna analiza (np. po dodaniu kategorii). |
| PATCH | `/documents/:id` | Korekta nagłówka: `kind`, data, sprzedawca, konto. |
| PATCH | `/documents/:id/items/:itemId` | Korekta pozycji (kategoria, kwota, opis, akceptacja/odrzucenie). |
| POST | `/documents/:id/commit` | Zatwierdzenie → tworzy transakcje. |
| POST | `/documents/:id/discard` | Odrzucenie całości. |
| DELETE | `/documents/:id` | Usunięcie dokumentu i pliku. |
| GET | `/documents/:id/file` | Pobranie oryginału (uwierzytelnione). |

**`POST /documents`** — pola formularza: `file` (wymagane), `kind`
(`receipt` | `bank_statement` | `invoice`, domyślnie `receipt`), `accountId`
(opcjonalne — podpowiedź konta), `monthHint`.

Ograniczenia: max 10 MB, typy `image/jpeg`, `image/png`, `image/webp`, `image/heic`,
`application/pdf`. Przekroczenie → `413` / `415`.

```jsonc
// 202
{ "data": { "id": "01JP...", "status": "processing", "pollAfterMs": 1500 } }
```

Ponowne wrzucenie identycznego pliku (ten sam SHA-256) → `409 CONFLICT`
z `details.existingDocumentId`, żeby UI mógł od razu otworzyć istniejący wynik.

**`GET /documents/:id`** (po analizie)

```jsonc
{
  "data": {
    "id": "01JP...",
    "kind": "receipt",
    "status": "parsed",
    "fileUrl": "/api/v1/documents/01JP.../file",
    "summary": {
      "merchant": "Lidl sp. z o.o.",
      "bookedOn": "2026-09-18",
      "totalMinor": 12799,
      "currency": "PLN",
      "confidence": 0.94,
      "detectedMonthKey": "2026-09"
    },
    "suggestedAccountId": "01JB...",
    "items": [
      {
        "id": "01JQ...", "lineNo": 1,
        "description": "Mleko 3,2% 1L", "quantity": 2,
        "unitPriceMinor": 349, "amountMinor": 698,
        "direction": "outflow",
        "suggestedCategoryId": "01JC...",
        "suggestedCategoryName": null,
        "confidence": 0.97,
        "reviewStatus": "pending",
        "duplicateOfTransactionId": null
      }
    ],
    "newCategoryProposals": [
      { "name": "Chemia gospodarcza", "kind": "expense", "itemIds": ["01JR..."] }
    ],
    "ai": { "model": "claude-sonnet-5-5", "costMinor": 3, "processedAt": 1790000000000 }
  }
}
```

**`POST /documents/:id/commit`**

```jsonc
{
  "mode": "single",                  // single      = jedna transakcja na całość
                                     // by_category = jedna transakcja na kategorię (ADR-069)
                                     // split       = osobna transakcja na każdą pozycję
  "accountId": "01JB...",
  "bookedOn": "2026-09-18",
  "categoryId": "01JC...",           // wymagane przy mode=single
  "createCategories": [              // akceptacja propozycji AI
    { "name": "Chemia gospodarcza", "kind": "expense", "parentId": "01JS..." }
  ],
  "itemIds": ["01JQ...", "01JR..."]  // tylko te pozycje; pominięte → rejected
}
// 201 → { "data": { "document": {...}, "transactions": [...] } }
```

Wymaga nagłówka `Idempotency-Key`. Commit jest wykonywany w jednej transakcji bazodanowej —
albo powstają wszystkie transakcje, albo żadna.

**Doprecyzowania z implementacji** (`F7-1`…`F7-7`, [ADR-059](./14-decisions-log.md#adr-059))

- `POST /documents`: pola tekstowe przed plikiem; `kind` spoza listy → `400` z
  `details[].path = kind`; typ po zawartości (magic bytes) → `415`; > `UPLOAD_MAX_BYTES`
  → `413`; PDF > 5 stron → `422`; konto spoza gospodarstwa → `404`, zarchiwizowane →
  `422`; `AI_ENABLED=false` → `502 EXTERNAL_SERVICE_ERROR` „Odczyt dokumentów jest
  wyłączony…". Duplikat: `409` z `details: [{ path: 'existingDocumentId', message: <id> }]`.
  Wyczerpany limit: plik zostaje (`failed`, `AI_BUDGET_EXCEEDED`), `402` z
  `details: [{ path: 'documentId', message: <id> }]`. Odpowiedź `202` ma nagłówek `Location`.
- `GET /documents`: `?status=&month=&limit=` (limit 1–100, domyślnie 20); `month` to
  **miesiąc dokumentu** (`detected_month_key`), nie wrzucenia. Wiersz:
  `DocumentListItemDto` (05 §12) z liczbą wszystkich pozycji.
- `POST /:id/analyze` → `202` jak upload; dozwolone z `uploaded`/`parsed`/`failed`
  (inaczej `409`); zastępuje pozycje; `402` przy wyczerpanym limicie.
- `PATCH /:id` (`kind`, `merchant`, `bookedOn`, `accountId`) i `PATCH /:id/items/:itemId`
  (`description`, `amountMinor`, `direction`, `suggestedCategoryId`, `bookedOn`,
  `reviewStatus`) tylko w stanie `parsed` (`409`); kategoria pozycji musi pasować do
  kierunku (obciążenie — wydatek, uznanie — przychód), inaczej `422`. Odpowiedź: cały
  `DocumentDto`.
- `POST /:id/commit`: `categoryName` zamiast `categoryId` wskazuje kategorię z
  `createCategories` (tryb `single`); `merchant` nadpisuje opis. `single` zapisuje sumę
  netto zaznaczonych (≤ 0 → `422`); `by_category` grupuje zaznaczone pozycje po
  kategorii wydatku (07 §9.4) — jedna transakcja na grupę, suma ≤ 0 → `422`; pozycja
  spoza dokumentu → `422`; stan inny niż
  `parsed` → `409`. Odpowiedź `201` z `meta.affectedMonths`.
- `POST /:id/discard` → `200` z dokumentem (pozycje `pending` → `rejected`);
  `DELETE /:id` → `204`, w trakcie analizy `409`.
- `GET /:id/file?variant=original|thumb`: zdjęcie `inline`, PDF `attachment`; PDF nie ma
  miniatury (`404`); `Cache-Control: private, max-age=3600`.

---

## 14. Miesiąc — `/api/v1/months`

Agregat zasilający ekran główny (wymaganie #12). **Jedno żądanie = cały dashboard.**

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/months/:monthKey/summary` | Pełne podsumowanie miesiąca. |
| GET | `/months/available` | Miesiące, w których są dane (do nawigatora). |
| GET | `/months/:monthKey/categories` | Rozbicie wydatków po kategoriach (zastępuje `/categories/spending`, ADR-039). |
| GET | `/months/compare?from=&to=` | Porównanie miesięcy (wykres trendu). **Przesunięte** do wykresów (Faza 8) — ADR-039. |

**Stan dostarczenia** ([ADR-039](./14-decisions-log.md#adr-039)). Podsumowanie rośnie
sekcja po sekcji razem z modułami: od `F3-1` — ramy czasu, `totals`, `accounts`,
`netWorthMinor`, `topCategories`, `uncategorizedCount`, `recentTransactions`,
`comparison`; od `F4-7` — `recurring` i `liabilities`; od `F5-8` — `allocation`
(dokładnie `GET /allocation/status?month=`) i `goals` (aktywne cele jak
`GET /goals?month=`, pełne DTO); `plannedExpenses` w Fazie 6. Przykład niżej pokazuje
kształt docelowy.

**Sekcje `F4-7`** ([ADR-050](./14-decisions-log.md#adr-050)):

- `recurring` — `plannedTotalMinor` i `postedTotalMinor` jak w `GET /recurring/occurrences`
  dla tego miesiąca; `items` = czekające wystąpienia miesiąca, a w bieżącym także zaległe
  z wcześniejszych miesięcy okna (z własnym `monthKey`); w przyszłym — podgląd z `id: null`.
  `pendingCount = items.length`, `overdueCount` — z nich po terminie. Sekcja jest liczona
  **przed** sumami — generowanie i auto-księgowanie wchodzą do liczb miesiąca.
- `liabilities` — aktywne zobowiązania ze stanem na dziś; `paidThisMonthMinor`
  i `unpaidCount` dotyczą oglądanego miesiąca.

**Szczegóły zachowania** (ustalone przy `F3-1`, `F3-2`)

- Zły klucz miesiąca → `400`. Miesiąc przyszły → `200` z `isFuture: true` (podgląd).
- `isPartial` — miesiąc trwa; `daysElapsed` liczy dzisiejszy dzień jako miniony
  (przeszłe: pełny miesiąc, przyszłe: `0`); `canPostBackTo`/`canPostUntil` — okno
  księgowania z 07 §1.3 liczone od **dziś**, nie od oglądanego miesiąca.
- `totals` — tylko `posted` i nieusunięte; definicje w 07 §12.
- `accounts`, `netWorthMinor` — dokładnie to, co `GET /accounts/balances?month=`.
- `topCategories` — do pięciu kategorii głównych z wydatkiem w miesiącu;
  `uncategorizedCount` — liczba zaksięgowanych wydatków bez kategorii (07 §9.2).
- `recentTransactions` — dziesięć najnowszych (`bookedOn:desc`), bez kosza, każdy status.
- `GET /months/available` → `{ currentMonth, months }`: bieżący miesiąc w strefie
  gospodarstwa i miesiące z co najmniej jedną transakcją poza koszem, rosnąco.
- `GET /months/:key/categories` → `{ month, previousMonth, expenseMinor, items }`:
  kategorie główne z podkategoriami, malejąco po kwocie; „Bez kategorii" ma
  `categoryId: null`; suma `items` = `expenseMinor`.

**`GET /months/2026-09/summary`**

```jsonc
{
  "data": {
    "month": "2026-09",
    "range": { "from": "2026-09-01", "to": "2026-09-30" },
    "isCurrent": true,
    "isPartial": true,
    "isFuture": false,
    "daysElapsed": 23,
    "daysInMonth": 30,
    "canPostBackTo": "2026-08-01",
    "canPostUntil": "2026-09-30",

    "totals": {
      "incomeMinor": 1180000,
      "incomeBaseMinor": 1180000,       // podstawa dla celów procentowych
      "expenseMinor": 642300,
      "savingsMinor": 200000,          // netto: wpłaty minus wypłaty; może być ujemne
      "investmentMinor": 118000,       // netto, jw.
      "debtRepaymentMinor": 185000,
      "netMinor": 219700,               // income − expense − savings − investment
      "unallocatedMinor": 219700        // max(0, net)
    },

    "accounts": [ /* jak w /accounts/balances */ ],
    "netWorthMinor": 6843210,

    "allocation": { /* jak w /allocation/status */ },

    "goals": [ /* jak w /goals?month= — skrócone do pól potrzebnych na kaflu */ ],

    "liabilities": {
      "totalRemainingMinor": 30150000,
      "monthlyPaymentTotalMinor": 185000,
      "paidThisMonthMinor": 185000,
      "unpaidCount": 0,
      "items": [ /* skrót */ ]
    },

    "recurring": {
      "plannedTotalMinor": 645000,
      "postedTotalMinor": 445000,
      "pendingCount": 1,
      "overdueCount": 0,
      "items": [ /* wystąpienia do potwierdzenia */ ]
    },

    "plannedExpenses": {
      "dueThisMonthMinor": 0,
      "upcoming6MonthsMinor": 520000,
      "monthlySetAsideRequiredMinor": 64500,
      "setAsidePaidThisMonthMinor": 26667,
      "warningCount": 1,
      "items": [ /* najbliższe 3 wydatki — skrót */ ]
    },

    "topCategories": [
      { "categoryId": "01JC...", "name": "Jedzenie", "color": null, "icon": null,
        "amountMinor": 187400, "shareBps": 2918, "transactionCount": 23,
        "previousMonthAmountMinor": 190000 }
    ],
    "uncategorizedCount": 2,

    "recentTransactions": [ /* 10 ostatnich */ ],

    "comparison": {
      "previousMonth": "2026-08",
      "hasPreviousData": true,
      "incomeDeltaMinor": 0,
      "incomeDeltaBps": 0,
      "expenseDeltaMinor": -41200,
      "expenseDeltaBps": -602
    }
  }
}
```

Odpowiedź jest świadomie duża — pozwala narysować cały ekran miesiąca bez kaskady żądań,
co ma realne znaczenie na łączu komórkowym. Sekcje szczegółowe (pełna lista transakcji)
dociągane są osobno.

**Faza 9 — sekcja `budget`** (zrobione w `F9-8`): `{ month, hasDraft, canCreate,
leftoverMinor | null, nextMonth, nextMonthHasDraft, suggestNextMonth }` — zasila
podpowiedź „Zaplanuj listopad" i odnośnik do szkicu oglądanego miesiąca. Liczona przez
`budgetService.budgetSectionForMonth`, nie własnym zapytaniem modułu `months`
([ADR-079](./14-decisions-log.md#adr-079)). `suggestNextMonth` — oglądany miesiąc jest
bieżący, trwa jego ostatni tydzień (`isNearBudgetMonthEnd`, ta sama reguła co
`suggestedMonth` listy) i następny nie ma szkicu. `canCreate` — miesiąc w zakresie
[bieżący, +12]. Ocena szkicu (`leftoverMinor`) liczona tylko, gdy szkic istnieje.

---

## 14a. Planer budżetu — `/api/v1/budget-drafts`

> **Faza 9 — zrobione**. Opis: [16](./16-budget-planner.md), reguły:
> [07 §13](./07-domain-rules.md#13-planer-budżetu), DTO: [05 §13b](./05-dto-contracts.md#13b-planer-budżetu--dtobudgetts).

Szkic jest adresowany **miesiącem**, nie identyfikatorem — w gospodarstwie jest najwyżej
jeden na miesiąc (03 §3.19), a URL `/budget/2026-11` ma być czytelny i do wysłania
drugiej osobie, jak `/m/2026-11`.

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/budget-drafts` | Istniejące szkice (miesiąc, sumy, liczba linii) + `suggestedMonth` i dozwolony zakres. |
| GET | `/budget-drafts/averages?months=3` | Średnie miesięczne kategorii wydatków (07 §13.3); `months` ∈ {3, 6, 12}. |
| GET | `/budget-drafts/:month` | Szkic z liniami, stanem źródeł, oceną i — dla `M ≤ bieżący` — wykonaniem. |
| POST | `/budget-drafts/:month` | Założenie szkicu, opcjonalnie z wypełnieniem, kopią linii własnych i liniami ze średniej. |
| PATCH | `/budget-drafts/:month` | Notatka szkicu. |
| DELETE | `/budget-drafts/:month` | Usunięcie szkicu z liniami. Źródła nietknięte. |
| POST | `/budget-drafts/:month/refresh` | Dociągnięcie brakujących linii ze źródeł (07 §13.2). |
| POST | `/budget-drafts/:month/lines` | Nowa linia własna. |
| PATCH | `/budget-drafts/:month/lines/:lineId` | Edycja linii (także `isExcluded` dla powiązanej). |
| DELETE | `/budget-drafts/:month/lines/:lineId` | Własna → usunięcie. Powiązana → wykluczenie (`isExcluded=true`). W obu przypadkach `200` z całym szkicem. |
| POST | `/budget-drafts/:month/lines/:lineId/accept-source` | „Przyjmij" bieżącą kwotę źródła (07 §13.5). |
| POST | `/budget-drafts/:month/lines/:lineId/detach` | „Zostaw jako własną" — linia staje się `manual`. |
| POST | `/budget-drafts/:month/lines/:lineId/promote` | Zamiana w regułę cykliczną albo planowany wydatek (07 §13.6). **`Idempotency-Key`.** |
| POST | `/budget-drafts/:month/lines/:lineId/apply-to-source` | Zapis kwoty linii w źródle, z podziałem reguły (07 §13.7). **`Idempotency-Key`.** |
| POST | `/budget-drafts/:month/groups` | Nowa grupa w sekcji: `{ section, name, lineIds?, position? }` — linie z `lineIds` przechodzą do niej w podanej kolejności, `position` to miejsce wśród grup sekcji (domyślnie na końcu). Od `F9-11`, ADR-081. |
| PATCH | `/budget-drafts/:month/groups/:groupId` | Zmiana nazwy grupy: `{ name }`. |
| DELETE | `/budget-drafts/:month/groups/:groupId` | Usunięcie grupy; jej linie przechodzą do „Bez grupy". `200` z całym szkicem. |
| POST | `/budget-drafts/:month/groups/by-origin` | Szybki start: `{ section }` — grupy *Stałe / Planowane / Zmienne* wg pochodzenia (07 §13.10); sekcja z grupami → `422`. |
| PATCH | `/budget-drafts/:month/layout` | Cały układ jednej sekcji: `{ section, groups: [{ id, lineIds }], ungroupedLineIds }` — kolejność grup i linii (07 §13.10). |

**Zachowanie**

Kody błędów to **standardowe kody API** (§2–§3) — rozróżnia je komunikat, nie osobny
kod (od `F9-4`; plan zakładał własne kody `BUDGET_*`, ADR-079 uzupełnienie).

- Zły klucz miesiąca → `400`. Szkic nie istnieje → `404 NOT_FOUND` „Brak planu na
  listopad 2026." (ekran pokazuje stan pusty z trzema drogami założenia).
- Założenie poza [bieżący, bieżący + 12] → `422 DOMAIN_RULE_VIOLATION` „Plan można
  założyć na miesiące od … do …."; drugi szkic na ten sam miesiąc → `409 CONFLICT`.
  Kopia z miesiąca bez szkicu albo średnia kategorii spoza wydatków → `422`.
- Każda zmiana szkicu miesiąca minionego (linie, odświeżenie, zamiana, zastosowanie,
  notatka) → `409 CONFLICT` „Plan zakończonego miesiąca jest tylko do odczytu.".
  Usunięcie całego szkicu jest dozwolone zawsze (`204`).
- Linia: kształt (I-21, kategoria/cel/źródło przy właściwym `flow`) → `400` z kontraktu;
  rodzaj kategorii, nieznane odwołanie, data spoza miesiąca, pominięcie linii własnej
  (I-24) → `422`. „Przyjmij" bez źródła w miesiącu i „Zostaw jako własną" przy
  istniejącym źródle → `422`.
- Zamiana linii nie-`manual`, wykluczonej, z kwotą 0 albo w niedozwolonej kombinacji
  `flow` × cel → `422`. Błędy walidacji bytu (np. brak konta przy przelewie) przychodzą
  z modułu docelowego bez zmian, z `path` wskazującym pole żądania. Przelew z linii puli
  na konta, które nie dają wpłaty do tej puli → `422` na `counterAccountId`; reguła bez
  terminu w miesiącu szkicu → `422`.
- „Zastosuj w źródle" dla źródła wyliczanego, reguły raty albo reguły tygodniowej → `422`.
- Grupy i układ (`F9-11`, ADR-081): nazwa pusta / > 40 znaków → `400`; nazwa zajęta
  w sekcji (bez względu na wielkość liter) → `422` „Grupa „Raty” już jest w tej sekcji.";
  grupa albo linia z innego szkicu lub innej sekcji (I-25) → `422`; układ, który pomija
  grupę sekcji albo niewykluczoną linię sekcji, albo podaje coś dwa razy → `422`
  „Układ nie zgadza się z planem — odśwież ekran."; szybki start w sekcji z grupami →
  `422`. Linia: `groupId` w `POST …/lines` i `PATCH …/lines/:id` (`null` = „Bez grupy"),
  zmiana grupy przenosi linię na koniec nowej grupy.
- Założenie szkicu kopiuje układ z planu źródłowego (07 §13.10) — w odpowiedzi
  `groups` i `groupId` linii.
- `POST /:month`, `POST /:month/lines` i `POST /:month/groups…` → `201`; pozostałe
  zmiany → `200`.
- Odpowiedzią każdej zmiany jest **cały szkic** (`BudgetDraftDto`) — ocena zależy od
  wszystkich linii, więc front podmienia dane zapytania zamiast liczyć sam.

**Stan dostarczenia:** `F9-3` — `/averages`; `F9-4` — szkic i linie; `F9-5` — `promote`
i `apply-to-source` (nagłówek `Idempotency-Key` **wymagany**, brak → `400`; powtórka
z tym samym kluczem → ta sama odpowiedź z `idempotent-replayed: true`); `F9-9` —
`actuals` dla szkicu miesiąca bieżącego i minionego (07 §13.8), dla przyszłego `null`.

**`POST /budget-drafts/2026-11`**

```jsonc
{
  "fillFromSources": true,                // kroki 1–7 z 07 §13.2
  "copyManualFrom": "2026-10",            // opcjonalne: linie własne z innego szkicu
  "averageLines": [                       // opcjonalne: linie zmienne ze średniej
    { "categoryId": "01JC...", "months": 3 }
  ],
  "notes": null
}
```

Wszystkie trzy części w jednej transakcji bazy. Linia ze średniej bez danych (średnia
`null`) powstaje z kwotą `0` — kategoria była wybrana świadomie, kwotę wpisze się ręcznie.

**`POST /budget-drafts/2026-11/lines/01JL.../promote`**

```jsonc
// → pozycja cykliczna
{
  "target": "recurring",
  "frequency": "monthly",
  "dayOfMonth": 5,
  "accountId": "01JB...",
  "counterAccountId": null,              // wymagane dla linii savings/investment
  "autoPost": false,
  "amountIsEstimate": false
}

// → planowany (nadchodzący) wydatek
{
  "target": "planned",
  "dueMonth": "2027-02",
  "dueOn": "2027-02-14",
  "priority": "should",
  "amountIsEstimate": true,
  "setAsideEnabled": false,
  "repeatsYearly": false
}
```

Odpowiedź: `{ draft: BudgetDraftDto, created: { kind: 'recurring_rule' | 'planned_expense',
id }, lineMovedTo: MonthKey | null }` — `lineMovedTo`, gdy planowany wydatek wypadł
w innym miesiącu (07 §13.6), żeby toast mógł powiedzieć „Przeniesiono na luty 2027".

**`POST /budget-drafts/2026-12/lines/01JL.../apply-to-source`** — ciało puste (kwotą
jest kwota linii). Odpowiedź: `{ draft, effect }`, gdzie `effect` to
`{ kind: 'rule_updated' | 'rule_split' | 'planned_updated' | 'goal_updated',
previousAmountMinor, newAmountMinor, fromMonth, newRuleId | null }`.

**`GET /budget-drafts/averages?months=3`**

```jsonc
{
  "data": {
    "months": 3,
    "window": { "from": "2026-07", "to": "2026-09" },
    "monthsWithData": 3,
    "items": [
      {
        "categoryId": "01JC...", "name": "Jedzenie", "icon": null,
        "averageMinor": 187400,                 // zaokrąglone w górę do złotówki
        "byMonth": [
          { "month": "2026-07", "amountMinor": 145000 },
          { "month": "2026-08", "amountMinor": 221000 },
          { "month": "2026-09", "amountMinor": 196000 }
        ]
      }
    ]
  }
}
```

Kategorie główne z co najmniej jednym wydatkiem w oknie, malejąco po średniej.
**Zrobione w `F9-3`** — pierwsza trasa modułu `budget` (`budget.routes.ts`); `months`
z zapytania, domyślnie 3, inne wartości → `400`.

---

## 15. Ustawienia — `/api/v1/settings`

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/settings` | Ustawienia gospodarstwa + użytkownicy. |
| PATCH | `/settings/household` | Nazwa, strefa, limit księgowania wstecz, dzień startu miesiąca. |
| PATCH | `/settings/profile` | Nazwa wyświetlana, kolor awatara. |
| GET | `/settings/export` | Eksport całości do JSON (kopia użytkownika). |
| GET | `/settings/export.csv?month=` | Eksport transakcji do CSV. |
| POST | `/settings/reset` | Usunięcie wszystkich danych gospodarstwa po potwierdzeniu PIN-em. ([ADR-072](./14-decisions-log.md#adr-072)). |
| GET | `/settings/ai-usage` | Zużycie i koszt OCR w bieżącym miesiącu — `AiUsageDto` (05 §12): `enabled` (flaga `AI_ENABLED`, UI chowa *Skan*), liczba dokumentów, tokeny, `spentMinor`, `budgetMinor`, `remainingMinor` (`null` bez limitu). **Od `F7-7`.** |

**Szczegóły zachowania** (ustalone przy `F8-1`, `F8-2`, [ADR-061](./14-decisions-log.md#adr-061))

- `GET /settings` → `SettingsDto` (05 §13a): gospodarstwo, aktywni domownicy (zalogowany
  pierwszy, `isCurrent`), `appVersion`.
- `PATCH /settings/household` → `HouseholdDto`; przyjmuje `name`, `timezone` (strefa IANA),
  `backPostingLimitMonths` (0–12), `monthStartDay` (wyłącznie `1`, ADR-006),
  `defaultExpenseAccountId` (konto gospodarstwa albo `null`; konto obce → `404`,
  zarchiwizowane → `422`, [ADR-070](./14-decisions-log.md#adr-070)). Waluty
  i języka nie zmienia. Limit działa od razu przy następnym zapisie (07 §1.3–1.4).
- `PATCH /settings/profile` → `UserDto`; tylko własny profil (`displayName`,
  `avatarColor` albo `null`).
- `GET /settings/export` → plik `fineapp-RRRR-MM-DD.json` (`ExportDto`, **bez koperty**),
  `Content-Disposition: attachment`, `Cache-Control: no-store`. Dwanaście tabel
  gospodarstwa (`EXPORT_TABLES`), bez kosza, sesji, kluczy idempotencji, hashy PIN-ów
  i plików.
- `GET /settings/export.csv?month=` → `text/csv; charset=utf-8`, plik
  `fineapp-RRRR-MM.csv` (albo z dzisiejszą datą bez `month` — wszystkie transakcje).
  BOM, separator `;`, kwota ze znakiem i przecinkiem, formuły zneutralizowane
  apostrofem. Kolumny: Data, Miesiąc, Typ, Kwota, Waluta, Konto, Konto docelowe,
  Kategoria („Nadrzędna / Podkategoria"), Źródło przychodu, Opis, Sprzedawca, Notatki,
  Status, Pochodzenie, Identyfikator.
- `POST /settings/reset` — ciało `ResetDataRequest` (`{ pin }`), odpowiedź
  `ResetDataResult` (`{ deleted: { <tabela z EXPORT_TABLES>: liczba } }`). Zły PIN → `401`
  „PIN się nie zgadza." i nic nie znika. Kasuje w jednej transakcji: transakcje (**także
  kosz**), dokumenty z pozycjami, wystąpienia i reguły cykliczne, planowane wydatki,
  zobowiązania, cele, wersje rozkładu, źródła przychodu, konta, **własne** kategorie
  i klucze idempotencji; czyści `defaultExpenseAccountId`. Po zatwierdzeniu usuwa pliki
  dokumentów z `UPLOAD_DIR`. Zostają: gospodarstwo z ustawieniami, domownicy, sesje,
  kategorie systemowe i licznik kosztu AI (limit miesięczny nie zeruje się).
- Poza `/api`: przy `WEB_DIST_PATH` serwer oddaje front, a nieznany adres aplikacji —
  `index.html` ([ADR-062](./14-decisions-log.md#adr-062)).

## 16. Systemowe

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/v1/health` | Bez autoryzacji. `{ "status": "ok", "version": "...", "dbOk": true }` — używane przez healthcheck Dockera. |

## 17. Limity żądań

| Zakres | Limit |
|---|---|
| `POST /auth/login` | 5 / 15 min na parę (e-mail, IP); potem blokada — [09](./09-security-auth.md) |
| `POST /auth/refresh` | 60 / godz. na sesję |
| `POST /documents` | 20 / godz. na gospodarstwo (ochrona kosztów AI) |
| `POST /documents/:id/analyze` | 5 / godz. na dokument |
| Pozostałe | 300 / min na użytkownika |
