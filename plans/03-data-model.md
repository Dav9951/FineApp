# 03 — Model danych

Dokument jest **kanonicznym opisem schematu**. Schemat Drizzle w `apps/api/src/db/schema/`
musi mu odpowiadać 1:1. Migracje są generowane z Drizzle, ale to ten dokument tłumaczy
*dlaczego* kolumny wyglądają tak, a nie inaczej.

## 1. Konwencje

| Zagadnienie | Decyzja |
|---|---|
| Klucze główne | `TEXT` — identyfikator sortowalny czasowo (ULID-podobny, 26 znaków). Generowany w aplikacji, nie w bazie. |
| Kwoty | `INTEGER` w **groszach**. Kolumny zawsze z sufiksem `_minor`. Nigdy `REAL`. |
| Procenty / udziały | `INTEGER` w **punktach bazowych** (1% = 100). Sufiks `_bps`. |
| Daty biznesowe | `TEXT` w formacie `YYYY-MM-DD` (lokalna data gospodarstwa, bez strefy). |
| Miesiąc | `TEXT` w formacie `YYYY-MM`, kolumna `month_key`, zawsze indeksowana. |
| Znaczniki systemowe | `INTEGER` — epoch **milisekundy UTC** (`created_at`, `updated_at`). |
| Wartości logiczne | `INTEGER` 0/1 (SQLite nie ma typu boolean). |
| Enumy | `TEXT` + `CHECK (... IN (...))`. Czytelne w bazie, walidowane przez silnik. |
| Usuwanie | Twarde, z wyjątkiem `transactions` (miękkie — `deleted_at`). |
| Zakres danych | Każda tabela domenowa ma `household_id`. |

**Dlaczego dwa formaty czasu.** Daty biznesowe (kiedy poniesiono wydatek) muszą być
odporne na strefy — wydatek z 31 sierpnia ma należeć do sierpnia niezależnie od tego,
gdzie stoi serwer. Znaczniki systemowe (kiedy rekord powstał) są techniczne i chcemy
w nich precyzji oraz łatwego sortowania. Mieszanie tych dwóch pojęć jest klasycznym
źródłem błędów „wydatek wpadł do złego miesiąca".

**Dlaczego `household_id` przy jednym gospodarstwie.** Koszt to jedna kolumna i jeden
warunek `WHERE`, a zysk jest podwójny: (a) zakres danych jest wymuszany strukturalnie,
więc nie da się przypadkiem pokazać cudzych danych, (b) gdyby projekt kiedyś miał obsłużyć
drugie gospodarstwo, nie trzeba przepisywać każdego zapytania.

## 2. Diagram relacji

```
households ──┬─< users ──< auth_sessions
             │
             ├─< accounts ──────────────┐
             ├─< categories (self-ref)  │
             ├─< income_sources         │
             ├─< liabilities            │
             ├─< goals                  │
             ├─< allocation_targets     │
             ├─< recurring_rules ──< recurring_occurrences
             ├─< planned_expenses
             ├─< documents ──< document_items
             ├─< budget_drafts ──< budget_draft_lines   (Faza 9; → reguły, planowane, cele, zobowiązania)
             │        └──────< budget_draft_groups >── (linie: group_id; ADR-081)
             └─< transactions ──────────┘
                    │  account_id, counter_account_id  → accounts
                    │  category_id                     → categories
                    │  income_source_id                → income_sources
                    │  liability_id                    → liabilities
                    │  goal_id                         → goals
                    │  recurring_occurrence_id         → recurring_occurrences
                    │  planned_expense_id              → planned_expenses
                    └─ source_document_id              → documents
```

`transactions` jest **centralną księgą**. Wszystkie liczby na ekranie miesiąca — wpływy,
wydatki, oszczędności, inwestycje, postęp celów, stany kont — są z niej wyliczane.
Żadna z tych wartości nie jest przechowywana redundantnie.

## 3. DDL

Kolejność tworzenia tabel odpowiada zależnościom kluczy obcych.

### 3.1 `households`

```sql
CREATE TABLE households (
  id                        TEXT PRIMARY KEY,
  name                      TEXT    NOT NULL,
  base_currency             TEXT    NOT NULL DEFAULT 'PLN',
  timezone                  TEXT    NOT NULL DEFAULT 'Europe/Warsaw',
  locale                    TEXT    NOT NULL DEFAULT 'pl-PL',
  -- Ile miesięcy wstecz wolno księgować transakcje (wymaganie #12). 1 = poprzedni miesiąc.
  back_posting_limit_months INTEGER NOT NULL DEFAULT 1,
  -- Dzień, w którym zaczyna się miesiąc budżetowy. 1 = kalendarzowy. Patrz 07 §1.
  month_start_day           INTEGER NOT NULL DEFAULT 1
                              CHECK (month_start_day BETWEEN 1 AND 28),
  -- Konto proponowane przy wydatkach i skanie (ADR-070). Usunięcie konta czyści pole.
  default_expense_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL
);
```

W v1 istnieje dokładnie **jeden** wiersz, tworzony przez seed.

### 3.2 `users`

```sql
CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  household_id   TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email          TEXT    NOT NULL UNIQUE,   -- zawsze zapisywany małymi literami
  display_name   TEXT    NOT NULL,
  pin_hash       TEXT    NOT NULL,          -- argon2id, zawiera sól i parametry
  pin_updated_at INTEGER NOT NULL,
  avatar_color   TEXT,                      -- do odróżnienia autorów transakcji w UI
  last_login_at  INTEGER,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
```

Brak rejestracji — użytkowników zakłada skrypt `pnpm --filter @fineapp/api user:create`.
Licznik nieudanych prób i blokada **nie są** tutaj, tylko w `auth_attempts` — dzięki temu
limitowanie działa również dla nieistniejących adresów i nie zdradza, które konta istnieją
(patrz [09](./09-security-auth.md)).

### 3.3 `auth_sessions`

```sql
CREATE TABLE auth_sessions (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id          TEXT    NOT NULL,   -- urządzenie; pierwszy wiersz rodziny ma family_id = id
  refresh_token_hash TEXT    NOT NULL,   -- SHA-256 tokenu; surowy token tylko w cookie
  device_label       TEXT,               -- np. "iPhone — Safari"
  user_agent         TEXT,
  ip_hash            TEXT,               -- SHA-256(ip + IP_HASH_SALT)
  expires_at         INTEGER NOT NULL,
  revoked_at         INTEGER,
  last_used_at       INTEGER,
  created_at         INTEGER NOT NULL
);

CREATE INDEX idx_auth_sessions_user    ON auth_sessions(user_id, expires_at);
CREATE INDEX idx_auth_sessions_family  ON auth_sessions(family_id);
CREATE UNIQUE INDEX uq_auth_sessions_token ON auth_sessions(refresh_token_hash);
```

**Wiersz to token, `family_id` to urządzenie.** Rotacja
([09 §3.3](./09-security-auth.md#33-rotacja-refresh-tokenów)) **dokłada nowy wiersz**
z tym samym `family_id` i unieważnia poprzedni, zamiast nadpisywać hash w miejscu.

Powód jest jeden i konkretny: **wykrycie ponownego użycia wymaga pamiętania tokenów
zużytych**. Przy nadpisywaniu w miejscu token sprzed dwóch rotacji nie istnieje w bazie,
więc złodziej, który zdążył obrócić token kilka razy, zanim ofiara wróciła, byłby
nie do odróżnienia od kogoś, kto wkleił śmieci — a to jest dokładnie ta sytuacja,
którą rotacja ma wykrywać.

Stąd trzy stany wiersza:

| Stan | `revoked_at` | Znaczenie |
|---|---|---|
| aktywny | `NULL` | bieżący token rodziny; najwyżej jeden na rodzinę |
| zużyty | ustawione | token wymieniony przez rotację — **jego ponowne użycie to sygnał kradzieży** |
| — | wiersz usunięty | wylogowanie kasuje **całą rodzinę**, więc stary token daje zwykłe `401`, a nie alarm |

Wylogowanie **usuwa** wiersze, a nie unieważnia: gdyby je unieważniało, karta zostawiona
otwarta w tle wysłałaby po wylogowaniu swój stary token, zostałaby wzięta za kradzież
i wylogowała użytkownika z **pozostałych** urządzeń.

`sid` w access tokenie to `family_id`, nie `id` wiersza — dzięki temu nie zmienia się
przy każdym odświeżeniu.

Wiersze rodzin wygasłych i unieważnionych są czyszczone przy starcie aplikacji,
tak samo jak `auth_attempts`.

### 3.4 `auth_attempts`

```sql
CREATE TABLE auth_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash TEXT    NOT NULL,  -- SHA-256(email + IP_HASH_SALT) — nie logujemy jawnego adresu
  ip_hash    TEXT,
  succeeded  INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_auth_attempts_email ON auth_attempts(email_hash, created_at);
CREATE INDEX idx_auth_attempts_ip    ON auth_attempts(ip_hash, created_at);
```

Wiersze starsze niż 30 dni są czyszczone przy starcie aplikacji.

### 3.5 `accounts`

```sql
CREATE TABLE accounts (
  id                    TEXT PRIMARY KEY,
  household_id          TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name                  TEXT    NOT NULL,
  type                  TEXT    NOT NULL
                          CHECK (type IN ('checking','cash','savings','investment','other')),
  -- Decyduje, czy przelew na to konto liczy się jako oszczędzanie/inwestowanie.
  -- Domyślnie wynika z `type`, ale bywa nadpisywany (np. konto ROR używane jako poduszka).
  allocation_class      TEXT    NOT NULL
                          CHECK (allocation_class IN ('spending','savings','investment')),
  currency              TEXT    NOT NULL DEFAULT 'PLN',
  -- Saldo startowe i dzień, od którego liczymy historię. Saldo bieżące = to + suma transakcji.
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  opening_balance_on    TEXT    NOT NULL,   -- YYYY-MM-DD
  institution           TEXT,               -- nazwa banku/brokera, informacyjnie
  color                 TEXT,
  icon                  TEXT,
  include_in_net_worth  INTEGER NOT NULL DEFAULT 1,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  is_archived           INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE INDEX idx_accounts_household ON accounts(household_id, is_archived, sort_order);
```

**Saldo nie jest przechowywane.** Wyliczamy je z `opening_balance_minor` i sumy transakcji.
Materializacja salda przy dwóch użytkownikach i kilku tysiącach wierszy nie jest potrzebna,
a niesie realne ryzyko rozjechania się z księgą. Jeśli kiedyś zacznie to być wolne, dodamy
tabelę migawek miesięcznych — bez zmiany kontraktu API.

### 3.6 `categories`

```sql
CREATE TABLE categories (
  id           TEXT PRIMARY KEY,
  household_id TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  parent_id    TEXT    REFERENCES categories(id) ON DELETE SET NULL,
  name         TEXT    NOT NULL,
  slug         TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('expense','income','transfer')),
  icon         TEXT,
  color        TEXT,
  -- Podpowiedzi dla AI: nazwy sklepów, słowa kluczowe z paragonów. Lista po przecinku.
  -- Wymaganie #5: model widzi WSZYSTKIE kategorie wraz z tymi podpowiedziami.
  ai_hints     TEXT,
  is_system    INTEGER NOT NULL DEFAULT 0,  -- z seeda; nie da się usunąć, można zarchiwizować
  is_archived  INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_categories_slug ON categories(household_id, kind, slug);
CREATE INDEX idx_categories_parent     ON categories(household_id, parent_id, sort_order);
```

Hierarchia **jednopoziomowa**: kategoria z `parent_id` nie może mieć własnych dzieci.
Walidowane w serwisie (SQLite nie wyrazi tego deklaratywnie). Głębsze drzewo komplikuje
każdy raport, a w budżecie domowym nie daje nic w zamian.

### 3.7 `income_sources`

```sql
CREATE TABLE income_sources (
  id                        TEXT PRIMARY KEY,
  household_id              TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name                      TEXT    NOT NULL,
  kind                      TEXT    NOT NULL CHECK (kind IN (
                              'salary','business','freelance','benefit','rental',
                              'investment','refund','gift','sale','other')),
  owner_user_id             TEXT    REFERENCES users(id) ON DELETE SET NULL,
  -- Czy ten przychód wchodzi do podstawy wyliczania celów procentowych.
  -- Zwrot podatku zwykle NIE powinien zawyżać "odłożyłem tylko 12% wpływów".
  counts_toward_allocation  INTEGER NOT NULL DEFAULT 1,
  is_archived               INTEGER NOT NULL DEFAULT 0,
  sort_order                INTEGER NOT NULL DEFAULT 0,
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL
);

CREATE INDEX idx_income_sources_household ON income_sources(household_id, is_archived);
```

### 3.8 `liabilities`

```sql
CREATE TABLE liabilities (
  id                      TEXT PRIMARY KEY,
  household_id            TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name                    TEXT    NOT NULL,
  kind                    TEXT    NOT NULL CHECK (kind IN (
                            'mortgage','cash_loan','car_loan','installment',
                            'credit_card','bnpl','private','other')),
  creditor                TEXT,
  currency                TEXT    NOT NULL DEFAULT 'PLN',

  -- Punkt odniesienia: ile zostało do spłaty na dany dzień (wymaganie #2).
  -- Stan bieżący = opening_balance_minor − suma płatności zaksięgowanych po balance_as_of.
  opening_balance_minor   INTEGER NOT NULL,
  balance_as_of           TEXT    NOT NULL,   -- YYYY-MM-DD

  monthly_payment_minor   INTEGER NOT NULL,
  installments_total      INTEGER,            -- pełna liczba rat, jeśli znana
  installments_remaining_at_as_of INTEGER,    -- okres spłaty na dzień balance_as_of
  interest_rate_bps       INTEGER,            -- informacyjnie; nie liczymy harmonogramu odsetek
  payment_day             INTEGER CHECK (payment_day BETWEEN 1 AND 31),
  first_payment_on        TEXT,
  final_payment_on        TEXT,

  payment_account_id      TEXT REFERENCES accounts(id)        ON DELETE SET NULL,
  category_id             TEXT REFERENCES categories(id)      ON DELETE SET NULL,
  recurring_rule_id       TEXT REFERENCES recurring_rules(id) ON DELETE SET NULL,

  is_active               INTEGER NOT NULL DEFAULT 1,
  notes                   TEXT,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);

CREATE INDEX idx_liabilities_household ON liabilities(household_id, is_active);
```

> **Uproszczenie do odnotowania.** Nie rozdzielamy raty na kapitał i odsetki. „Pozostała
> kwota" to całość do zapłaty, a każda rata ją pomniejsza. To odpowiada temu, jak ludzie
> myślą o swoich zobowiązaniach („zostało 24 raty × 1500 zł") i jest zgodne z brzmieniem
> wymagania #2. Konsekwencja: przy kredycie hipotecznym liczba ta nie zgadza się
> z saldem kapitału w banku. Pole `interest_rate_bps` zostaje na przyszłość.
> Zapisane w [14-decisions-log.md](./14-decisions-log.md) jako ADR-004.

### 3.9 `goals`

```sql
CREATE TABLE goals (
  id                       TEXT PRIMARY KEY,
  household_id             TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name                     TEXT    NOT NULL,
  kind                     TEXT    NOT NULL CHECK (kind IN ('savings','investment')),
  purpose                  TEXT    CHECK (purpose IN (
                             'down_payment','emergency_fund','vacation','car',
                             'renovation','retirement','education','custom')),
  target_amount_minor      INTEGER,          -- NULL = cel bezterminowy (np. poduszka rosnąca)
  target_date              TEXT,             -- YYYY-MM-DD

  -- Kwota już zgromadzona PRZED wdrożeniem aplikacji (stan początkowy).
  starting_amount_minor    INTEGER NOT NULL DEFAULT 0,
  linked_account_id        TEXT REFERENCES accounts(id) ON DELETE SET NULL,

  -- Skąd bierzemy postęp: z wpłat oznaczonych tym celem, czy z salda powiązanego konta.
  progress_source          TEXT    NOT NULL DEFAULT 'contributions'
                             CHECK (progress_source IN ('contributions','account_balance')),

  -- Plan wpłat — sedno wymagania #6 (przelicznik % ↔ kwota).
  contribution_mode        TEXT    NOT NULL DEFAULT 'fixed'
                             CHECK (contribution_mode IN ('fixed','percent_of_income','none')),
  contribution_amount_minor INTEGER,         -- wymagane gdy mode = 'fixed'
  contribution_percent_bps  INTEGER,         -- wymagane gdy mode = 'percent_of_income'

  priority                 INTEGER NOT NULL DEFAULT 0,
  color                    TEXT,
  icon                     TEXT,
  status                   TEXT    NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','paused','achieved','archived')),
  achieved_at              INTEGER,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

CREATE INDEX idx_goals_household ON goals(household_id, status, priority);
```

Niezmiennik walidowany w serwisie: `contribution_mode = 'fixed'` ⇒ `contribution_amount_minor`
niepuste; `'percent_of_income'` ⇒ `contribution_percent_bps` niepuste. SQLite mógłby to
wyrazić `CHECK`-iem, ale komunikat błędu byłby nieczytelny — walidujemy w Zod i serwisie.

### 3.10 `allocation_targets`

```sql
CREATE TABLE allocation_targets (
  id                     TEXT PRIMARY KEY,
  household_id           TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  -- Wersjonowanie od miesiąca: zmiana założeń nie fałszuje historii (wymaganie #8).
  effective_from_month   TEXT    NOT NULL,   -- YYYY-MM
  savings_percent_bps    INTEGER NOT NULL DEFAULT 0,
  investment_percent_bps INTEGER NOT NULL DEFAULT 0,
  debt_percent_bps       INTEGER NOT NULL DEFAULT 0,
  note                   TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_allocation_month ON allocation_targets(household_id, effective_from_month);
```

Rozkład obowiązujący dla miesiąca M = wiersz o największym `effective_from_month <= M`.
Suma procentów **nie musi** wynosić 100% — to cele odkładania, nie pełny podział budżetu.
Serwis ostrzega (nie blokuje), gdy suma przekracza 10000 bps.

### 3.11 `recurring_rules`

Jeden mechanizm dla wydatków stałych (#3) oraz cyklicznych wpłat i wydatków (#9).

```sql
CREATE TABLE recurring_rules (
  id                 TEXT PRIMARY KEY,
  household_id       TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name               TEXT    NOT NULL,
  flow               TEXT    NOT NULL CHECK (flow IN ('expense','income','transfer')),

  amount_minor       INTEGER NOT NULL,
  -- Rachunki bywają zmienne. Kwota szacunkowa jest planem; przy księgowaniu podajemy realną.
  amount_is_estimate INTEGER NOT NULL DEFAULT 0,
  currency           TEXT    NOT NULL DEFAULT 'PLN',

  account_id         TEXT REFERENCES accounts(id)        ON DELETE SET NULL,
  counter_account_id TEXT REFERENCES accounts(id)        ON DELETE SET NULL,
  category_id        TEXT REFERENCES categories(id)      ON DELETE SET NULL,
  income_source_id   TEXT REFERENCES income_sources(id)  ON DELETE SET NULL,
  goal_id            TEXT REFERENCES goals(id)           ON DELETE SET NULL,
  liability_id       TEXT REFERENCES liabilities(id)     ON DELETE SET NULL,
  -- Alokacja wynika z klas kont reguły i jest wyliczana przy księgowaniu wystąpienia.
  -- Tutaj wyłącznie ewentualne nadpisanie, dziedziczone przez tworzone transakcje.
  allocation_override TEXT  CHECK (allocation_override IN ('none','savings','investment')),

  frequency          TEXT    NOT NULL CHECK (frequency IN (
                       'monthly','weekly','biweekly','quarterly','yearly','every_n_months')),
  interval_count     INTEGER NOT NULL DEFAULT 1,
  day_of_month       INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  weekday            INTEGER CHECK (weekday BETWEEN 0 AND 6),   -- 0 = niedziela
  month_of_year      INTEGER CHECK (month_of_year BETWEEN 1 AND 12),
  anchor_date        TEXT    NOT NULL,   -- YYYY-MM-DD, punkt odniesienia dla biweekly/every_n
  start_month        TEXT    NOT NULL,   -- YYYY-MM
  end_month          TEXT,               -- NULL = bezterminowo

  -- 0: wystąpienie czeka na potwierdzenie. 1: transakcja powstaje automatycznie w dniu terminu.
  auto_post          INTEGER NOT NULL DEFAULT 0,
  -- Oznaczenie "to jest wydatek stały" — steruje grupowaniem w UI (wymaganie #3).
  is_fixed_expense   INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX idx_recurring_rules_household ON recurring_rules(household_id, is_active, flow);
```

### 3.12 `recurring_occurrences`

```sql
CREATE TABLE recurring_occurrences (
  id                   TEXT PRIMARY KEY,
  household_id         TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  rule_id              TEXT    NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  due_on               TEXT    NOT NULL,   -- YYYY-MM-DD
  month_key            TEXT    NOT NULL,   -- YYYY-MM
  planned_amount_minor INTEGER NOT NULL,   -- migawka kwoty z reguły w chwili wygenerowania
  status               TEXT    NOT NULL DEFAULT 'planned'
                         CHECK (status IN ('planned','posted','skipped')),
  transaction_id       TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  posted_amount_minor  INTEGER,
  posted_at            INTEGER,
  skipped_reason       TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

-- Klucz idempotencji: ponowne generowanie miesiąca nie tworzy duplikatów.
CREATE UNIQUE INDEX uq_occurrence_rule_due ON recurring_occurrences(rule_id, due_on);
CREATE INDEX idx_occurrence_month ON recurring_occurrences(household_id, month_key, status);
```

`planned_amount_minor` jest **migawką**: podniesienie czynszu w listopadzie nie zmienia
wstecz planu z sierpnia. Bez tego historia „plan kontra wykonanie" traci sens.

Wiersze powstają leniwie, wyłącznie w oknie od początku okna księgowania do bieżącego
miesiąca (07 §6.2, [ADR-045](./14-decisions-log.md#adr-045)). `skipped_reason` wypełnia
też wznowienie reguły: terminy z czasu wstrzymania zapisują się jako `skipped`
z powodem „Reguła była wstrzymana".

**`transaction_id` i `ON DELETE SET NULL`** ([ADR-042](./14-decisions-log.md#adr-042)).
Wystąpienie `posted` nigdy nie wskazuje transakcji z kosza: jej miękkie usunięcie cofa
zaksięgowanie (07 §6.7). Czyszczenie kosza po 30 dniach usuwa więc wyłącznie transakcje,
do których nic już nie prowadzi, a `SET NULL` zostaje jako siatka bezpieczeństwa —
nie jako mechanizm, na którym coś polega. To samo dotyczy `planned_expenses.transaction_id`.

### 3.13 `planned_expenses`

Realizacja wymagania #13: większe wydatki znane z wyprzedzeniem — OC samochodu, przegląd,
wakacje, wymiana sprzętu, podatek roczny.

```sql
CREATE TABLE planned_expenses (
  id                      TEXT PRIMARY KEY,
  household_id            TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name                    TEXT    NOT NULL,

  -- Kwota jest z natury szacunkowa: ile wyniesie OC za rok, nie wie nikt.
  estimated_amount_minor  INTEGER NOT NULL,
  amount_is_estimate      INTEGER NOT NULL DEFAULT 1,
  currency                TEXT    NOT NULL DEFAULT 'PLN',

  -- Miesiąc jest wymagany (służy do planowania), dokładny dzień bywa nieznany.
  due_month               TEXT    NOT NULL,   -- YYYY-MM
  due_on                  TEXT,               -- YYYY-MM-DD, gdy znana konkretna data

  category_id             TEXT REFERENCES categories(id)  ON DELETE SET NULL,
  -- Konto, z którego planujemy zapłacić.
  account_id              TEXT REFERENCES accounts(id)    ON DELETE SET NULL,
  liability_id            TEXT REFERENCES liabilities(id) ON DELETE SET NULL,

  -- Waga wydatku: 'must' = konieczny (OC), 'should' = planowany, 'nice' = opcjonalny.
  priority                TEXT    NOT NULL DEFAULT 'should'
                            CHECK (priority IN ('must','should','nice')),

  status                  TEXT    NOT NULL DEFAULT 'planned' CHECK (status IN (
                            'planned','funding','ready','posted','deferred','cancelled')),

  -- Odkładanie z wyprzedzeniem (sinking fund). Rata miesięczna jest WYLICZANA,
  -- nie przechowywana — zmienia się wraz z upływem czasu i zebraną kwotą.
  set_aside_enabled       INTEGER NOT NULL DEFAULT 0,
  set_aside_account_id    TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  set_aside_goal_id       TEXT REFERENCES goals(id)    ON DELETE SET NULL,
  set_aside_start_month   TEXT,               -- YYYY-MM; domyślnie miesiąc utworzenia
  already_set_aside_minor INTEGER NOT NULL DEFAULT 0,  -- kwota zebrana poza aplikacją

  -- Gdy wydatek powtarza się co rok (OC, przegląd), po zaksięgowaniu tworzony jest
  -- automatycznie kolejny na ten sam miesiąc w następnym roku.
  repeats_yearly          INTEGER NOT NULL DEFAULT 0,
  previous_instance_id    TEXT REFERENCES planned_expenses(id) ON DELETE SET NULL,

  transaction_id          TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  posted_amount_minor     INTEGER,
  posted_at               INTEGER,
  notes                   TEXT,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);

CREATE INDEX idx_planned_due    ON planned_expenses(household_id, status, due_month);
CREATE INDEX idx_planned_active ON planned_expenses(household_id, due_month)
  WHERE status IN ('planned','funding','ready');
```

**Dlaczego to osobna tabela, a nie reguła cykliczna z częstotliwością roczną.**
Różnią się trzema rzeczami, z których każda ma konsekwencje w kodzie:

| | Pozycja cykliczna | Planowany wydatek |
|---|---|---|
| Kwota | znana i stała (czynsz 1850 zł) | szacunkowa, zmienia się co edycję |
| Rytm | regularny, generuje wystąpienia w nieskończoność | pojedyncze zdarzenie (opcjonalnie powtarzane co rok) |
| Sens dla użytkownika | „co miesiąc mi to schodzi" | „muszę mieć na to odłożone" |

Najważniejsza jest trzecia różnica: planowany wydatek wymaga **odkładania i ostrzeżenia
o płynności**, czego reguła cykliczna nie robi i robić nie powinna. Próba wcisnięcia
obu w jeden byt dałaby tabelę pełną kolumn nieużywanych przez połowę wierszy.
Odnotowane jako ADR-009.

**Dlaczego rata odkładania nie jest przechowywana.** `ceil(pozostało / miesięcy do terminu)`
zmienia się co miesiąc — po pominięciu jednej wpłaty rata rośnie. Przechowywanie
dawałoby wartość nieaktualną tuż po zapisie. Wyliczenie: [07 §6.5](./07-domain-rules.md#65-planowane-wydatki).

### 3.14 `documents`

```sql
CREATE TABLE documents (
  id                 TEXT PRIMARY KEY,
  household_id       TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind               TEXT    NOT NULL
                       CHECK (kind IN ('receipt','bank_statement','invoice','other')),
  status             TEXT    NOT NULL DEFAULT 'uploaded' CHECK (status IN (
                       'uploaded','processing','parsed','failed','committed','discarded')),

  original_filename  TEXT    NOT NULL,
  storage_path       TEXT    NOT NULL,   -- względem UPLOAD_DIR
  mime_type          TEXT    NOT NULL,
  byte_size          INTEGER NOT NULL,
  sha256             TEXT    NOT NULL,   -- wykrywanie ponownego wrzucenia tego samego pliku
  page_count         INTEGER,
  account_id         TEXT REFERENCES accounts(id) ON DELETE SET NULL,  -- konto z wrzucenia / korekty (ADR-059)

  ai_provider        TEXT,
  ai_model           TEXT,
  ai_request_id      TEXT,
  ai_input_tokens    INTEGER,
  ai_output_tokens   INTEGER,
  ai_cost_minor      INTEGER,            -- szacunek kosztu wywołania, w groszach
  ai_raw_response    TEXT,               -- JSON; do diagnozy złych odczytów
  parsed_summary     TEXT,               -- JSON: sprzedawca, suma, data, pewność
  detected_month_key TEXT,

  error_code         TEXT,
  error_message      TEXT,
  processed_at       INTEGER,
  uploaded_by        TEXT    NOT NULL REFERENCES users(id),
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_documents_sha  ON documents(household_id, sha256);
CREATE INDEX idx_documents_status     ON documents(household_id, status, created_at DESC);
```

Od `F7-1` ([ADR-059](./14-decisions-log.md#adr-059)): `account_id` dodane migracją `0003`;
`error_code` przyjmuje `AI_UNAVAILABLE`, `AI_SCHEMA_MISMATCH`, `AI_OUTPUT_TRUNCATED`,
`AI_REFUSED`, `AI_BUDGET_EXCEEDED`, `INTERRUPTED`, `INTERNAL_ERROR`; `parsed_summary` to
nagłówek z 05 §12 bez `detectedMonthKey` (ma własną kolumnę); zdjęcia są zapisywane jako
JPEG bez metadanych (`mime_type = image/jpeg`), PDF bez zmian.

### 3.15 `document_items`

```sql
CREATE TABLE document_items (
  id                         TEXT PRIMARY KEY,
  document_id                TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  line_no                    INTEGER NOT NULL,
  raw_text                   TEXT,             -- surowa linia z dokumentu, do weryfikacji
  description                TEXT    NOT NULL,
  quantity                   REAL,             -- jedyne dopuszczalne REAL: ilość, nie pieniądz
  unit_price_minor           INTEGER,
  amount_minor               INTEGER NOT NULL,
  direction                  TEXT    NOT NULL DEFAULT 'outflow'
                               CHECK (direction IN ('inflow','outflow')),
  booked_on                  TEXT,             -- dla wyciągów: data operacji

  suggested_category_id      TEXT REFERENCES categories(id) ON DELETE SET NULL,
  suggested_category_name    TEXT,             -- gdy AI proponuje kategorię spoza listy
  confidence                 REAL,             -- 0..1

  review_status              TEXT    NOT NULL DEFAULT 'pending'
                               CHECK (review_status IN ('pending','accepted','rejected','merged')),
  transaction_id             TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  duplicate_of_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at                 INTEGER NOT NULL,
  updated_at                 INTEGER NOT NULL
);

CREATE INDEX idx_document_items ON document_items(document_id, line_no);
```

### 3.16 `transactions`

```sql
CREATE TABLE transactions (
  id                TEXT PRIMARY KEY,
  household_id      TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  type              TEXT    NOT NULL CHECK (type IN ('expense','income','transfer')),
  status            TEXT    NOT NULL DEFAULT 'posted'
                      CHECK (status IN ('posted','pending','void')),

  booked_on         TEXT    NOT NULL,   -- YYYY-MM-DD, data zdarzenia
  month_key         TEXT    NOT NULL,   -- YYYY-MM, wyliczany przy zapisie; patrz 07 §1
  -- Kwota zawsze DODATNIA. Kierunek wynika z `type`, nie ze znaku.
  amount_minor      INTEGER NOT NULL CHECK (amount_minor > 0),
  currency          TEXT    NOT NULL DEFAULT 'PLN',

  -- expense: konto źródłowe | income: konto docelowe | transfer: konto źródłowe
  account_id        TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  -- wyłącznie dla transfer: konto docelowe
  counter_account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,

  category_id       TEXT REFERENCES categories(id)             ON DELETE SET NULL,
  income_source_id  TEXT REFERENCES income_sources(id)         ON DELETE SET NULL,
  liability_id      TEXT REFERENCES liabilities(id)            ON DELETE SET NULL,
  goal_id           TEXT REFERENCES goals(id)                  ON DELETE SET NULL,

  -- Alokacja na potrzeby celów procentowych (wymaganie #8), liczona NETTO. Patrz 07 §2.2.
  -- Migawki klas obu kont w chwili zapisu: z nich wyliczamy efekt przelewu na pule.
  -- Migawka, bo zmiana klasy konta nie może przepisywać wyników zamkniętych miesięcy.
  source_allocation_class TEXT CHECK (source_allocation_class IN
                            ('spending','savings','investment')),
  target_allocation_class TEXT CHECK (target_allocation_class IN
                            ('spending','savings','investment')),
  -- Nadpisanie przez użytkownika: NULL = wylicz z migawek klas.
  -- 'none' = nie licz wcale; 'savings'/'investment' = wymuś zaliczenie do tej puli.
  allocation_override     TEXT CHECK (allocation_override IN
                            ('none','savings','investment')),

  description       TEXT,
  merchant          TEXT,
  notes             TEXT,

  source            TEXT    NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('manual','ocr','recurring','planned','import')),
  source_document_id      TEXT REFERENCES documents(id)              ON DELETE SET NULL,
  recurring_occurrence_id TEXT REFERENCES recurring_occurrences(id)  ON DELETE SET NULL,
  planned_expense_id      TEXT REFERENCES planned_expenses(id)       ON DELETE SET NULL,
  external_ref      TEXT,   -- identyfikator/odcisk operacji bankowej; klucz deduplikacji

  created_by        TEXT    NOT NULL REFERENCES users(id),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER          -- miękkie usunięcie
);

CREATE INDEX idx_tx_month          ON transactions(household_id, month_key, booked_on DESC);
CREATE INDEX idx_tx_account        ON transactions(account_id, booked_on);
CREATE INDEX idx_tx_counter        ON transactions(counter_account_id, booked_on);
CREATE INDEX idx_tx_category       ON transactions(category_id, month_key);
-- Alokacje: częściowy indeks tylko po przelewach, bo tylko one tworzą efekty w pulach.
CREATE INDEX idx_tx_allocation ON transactions(
  household_id, month_key, target_allocation_class, source_allocation_class
) WHERE type = 'transfer' AND deleted_at IS NULL;
-- Spłata zobowiązań liczona z wydatków powiązanych ze zobowiązaniem (07 §2.2a).
CREATE INDEX idx_tx_goal           ON transactions(goal_id, month_key);
CREATE INDEX idx_tx_liability      ON transactions(liability_id, booked_on);

-- Deduplikacja importu z wyciągów; częściowy indeks, bo external_ref jest zwykle NULL.
CREATE UNIQUE INDEX uq_tx_external ON transactions(household_id, external_ref)
  WHERE external_ref IS NOT NULL;
```

**Dlaczego przelew to jeden wiersz, a nie dwa zapisy księgowe.** Pełna podwójna księgowość
(dwa wiersze na operację) jest poprawniejsza rachunkowo, ale wymusza obsługę par wierszy
w każdym zapytaniu i w każdej edycji. W budżecie domowym prowadzonym przez dwie osoby
koszt tej poprawności przewyższa zysk. Jeden wiersz z `account_id` → `counter_account_id`
daje to samo saldo przy prostszych zapytaniach. Odnotowane jako ADR-003.

### 3.17 `app_meta`

```sql
CREATE TABLE app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Klucze: `schema_version`, `seeded_at`, `last_recurring_generation`, `ai_spend_<YYYY-MM>_minor`.

### 3.18 `idempotency_keys`

Dodana przy `F2-7` ([ADR-037](./14-decisions-log.md#adr-037)).

```sql
CREATE TABLE idempotency_keys (
  household_id  TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  scope         TEXT    NOT NULL,   -- operacja, np. 'POST /transactions'
  key           TEXT    NOT NULL,   -- nagłówek Idempotency-Key
  request_hash  TEXT    NOT NULL,   -- SHA-256 kanonicznego JSON-a ciała
  status_code   INTEGER NOT NULL,
  response_json TEXT    NOT NULL,   -- odpowiedź odtwarzana przy powtórzeniu
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (household_id, scope, key)
);
CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);
```

Zapamiętywane są **tylko odpowiedzi udane**, w tej samej transakcji bazodanowej co skutki
operacji. Wpisy starsze niż doba są usuwane przy każdym zapisie z kluczem. Tabela
techniczna — bez `updated_at`, wiersz nigdy się nie zmienia.

### 3.19 `budget_drafts`

> **Faza 9 — schemat zrobiony w `F9-1`** (migracja `0005_budget_drafts`, schemat
> Drizzle `db/schema/budget.ts`); moduł i niezmienniki I-20…I-24 w serwisie — `F9-4`.
> Opis funkcji: [16](./16-budget-planner.md), decyzje:
> [ADR-075](./14-decisions-log.md#adr-075), [ADR-076](./14-decisions-log.md#adr-076).

Szkic budżetu jednego miesiąca (wymaganie #14). Najwyżej jeden na miesiąc gospodarstwa,
wspólny dla obu domowników.

```sql
CREATE TABLE budget_drafts (
  id             TEXT PRIMARY KEY,
  household_id   TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  month_key      TEXT    NOT NULL,   -- YYYY-MM, miesiąc, którego dotyczy plan
  notes          TEXT,
  -- Kiedy ostatnio dociągnięto linie ze źródeł (wypełnienie albo „Odśwież").
  last_filled_at INTEGER,
  created_by     TEXT    NOT NULL REFERENCES users(id),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_budget_draft_month ON budget_drafts(household_id, month_key);
```

Sumy i ocena szkicu **nie są przechowywane** — wylicza je każdy odczyt z linii (07 §13.4),
tak jak salda z księgi.

### 3.20 `budget_draft_lines`

```sql
CREATE TABLE budget_draft_lines (
  id                  TEXT PRIMARY KEY,
  household_id        TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  draft_id            TEXT    NOT NULL REFERENCES budget_drafts(id) ON DELETE CASCADE,

  -- Strona bilansu, nie typ transakcji: przelew na oszczędności to 'savings'.
  flow                TEXT    NOT NULL CHECK (flow IN ('income','expense','savings','investment')),
  name                TEXT    NOT NULL,
  -- Grosze. Ujemne wyłącznie dla 'savings'/'investment' — wypłata z odłożonego (I-21).
  amount_minor        INTEGER NOT NULL,

  category_id         TEXT REFERENCES categories(id)       ON DELETE SET NULL,
  income_source_id    TEXT REFERENCES income_sources(id)   ON DELETE SET NULL,
  goal_id             TEXT REFERENCES goals(id)            ON DELETE SET NULL,
  liability_id        TEXT REFERENCES liabilities(id)      ON DELETE SET NULL,
  -- Opcjonalny dzień w miesiącu — podpowiedź terminu przy zamianie w byt.
  due_on              TEXT,               -- YYYY-MM-DD

  -- Skąd linia przyszła. 'manual' = istnieje tylko w szkicu.
  origin              TEXT    NOT NULL DEFAULT 'manual' CHECK (origin IN (
                        'manual','recurring','planned','set_aside','goal','liability')),
  recurring_rule_id   TEXT REFERENCES recurring_rules(id)  ON DELETE SET NULL,
  planned_expense_id  TEXT REFERENCES planned_expenses(id) ON DELETE SET NULL,
  -- Kwota źródła w chwili ostatniego wypełnienia/przyjęcia. Odczyt porównuje ją
  -- z bieżącą kwotą źródła i pokazuje „W regule teraz X" — nic nie nadpisuje sam.
  source_amount_minor INTEGER,
  -- Pamiątka, że kwota przyszła ze średniej z N miesięcy (podpis w UI, kopiowanie).
  average_months      INTEGER CHECK (average_months IN (3,6,12)),

  -- Linia powiązana „usunięta" ze szkicu: zostaje, żeby odświeżenie jej nie wskrzesiło.
  is_excluded         INTEGER NOT NULL DEFAULT 0,
  -- Grupa w sekcji szkicu (§3.21, ADR-081); NULL = „Bez grupy", na końcu sekcji.
  group_id            TEXT REFERENCES budget_draft_groups(id) ON DELETE SET NULL,
  -- Kolejność w szkicu: grupy w kolejności, w nich linie po sort_order, potem bez grupy.
  sort_order          INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX idx_budget_lines_draft ON budget_draft_lines(draft_id, flow, sort_order);
-- Jedno źródło = jedna linia w szkicu; odświeżanie idzie przez ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX uq_budget_line_rule ON budget_draft_lines(draft_id, recurring_rule_id)
  WHERE recurring_rule_id IS NOT NULL;
CREATE UNIQUE INDEX uq_budget_line_planned ON budget_draft_lines(draft_id, planned_expense_id, origin)
  WHERE planned_expense_id IS NOT NULL;
CREATE UNIQUE INDEX uq_budget_line_goal ON budget_draft_lines(draft_id, goal_id)
  WHERE origin = 'goal';
CREATE UNIQUE INDEX uq_budget_line_liability ON budget_draft_lines(draft_id, liability_id)
  WHERE origin = 'liability';
```

**Dlaczego linie są zapisane, a nie wyliczane ze źródeł przy odczycie.** Szkic ma
sens właśnie dlatego, że różni się od źródeł: „Netflix wyłączam w listopadzie",
„na jedzenie daję 1 900, nie średnią". Wyliczanie w locie wymagałoby osobnej tabeli
nadpisań i wykluczeń — czyli i tak zapisu, tylko rozbitego na dwa miejsca.
Odwrotnie niż przyszłe wystąpienia cykliczne (07 §6.2), które *nie* są zapisywane,
bo nikt ich nie edytuje.

**Dlaczego `source_amount_minor`.** Bez niego nie da się odróżnić „użytkownik zmienił
kwotę w szkicu" od „zmieniła się reguła". Pierwsze jest decyzją do uszanowania,
drugie — informacją do pokazania (ADR-076).

**`ON DELETE SET NULL` przy źródłach.** Usunięcie reguły czy planowanego wydatku nie
kasuje linii — szkic to plan, a usunięcie bytu nie znaczy „i wykreśl z planu".
Linia zostaje osierocona (`origin ≠ 'manual'`, wskaźnik pusty) i UI proponuje
„Zostaw jako własną" albo „Usuń".

### 3.21 `budget_draft_groups`

> **Faza 9 — uzupełnienie `F9-11`** ([ADR-081](./14-decisions-log.md#adr-081)),
> migracja `0006_budget_draft_groups`.

Grupy linii w sekcji szkicu („Mieszkanie i media", „Raty"). **Czysto prezentacyjne** —
sumy, ocena i wykonanie liczą się z linii jak dotąd (07 §13.4, §13.8).

```sql
CREATE TABLE budget_draft_groups (
  id            TEXT PRIMARY KEY,
  household_id  TEXT    NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  draft_id      TEXT    NOT NULL REFERENCES budget_drafts(id) ON DELETE CASCADE,
  -- Sekcja ekranu, nie flow: 'pools' łączy oszczędności i inwestycje.
  section       TEXT    NOT NULL CHECK (section IN ('income','expense','pools')),
  name          TEXT    NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_budget_groups_draft ON budget_draft_groups(draft_id, section, sort_order);
```

**Grupy per szkic, nie per gospodarstwo.** Linia żyje w szkicu, więc jej przydział
i tak jest per szkic. Układ przechodzi na następny miesiąc przez kopię przy zakładaniu
szkicu (07 §13.10) — dzięki temu zmiana układu w grudniu nie psuje listopada.

**Unikalność nazwy** (w sekcji szkicu, bez względu na wielkość liter) pilnuje serwis
(I-25) — SQLite nie ma porównania `lower()` po polsku w indeksie, a po nazwie układ
jest dopasowywany między miesiącami.

## 4. Niezmienniki wymuszane w serwisach

SQLite nie wyrazi ich deklaratywnie. Każdy musi mieć test jednostkowy.

| # | Niezmiennik |
|---|---|
| I-1 | `month_key = substr(booked_on, 1, 7)` — chyba że `month_start_day > 1`; wtedy według reguły z [07 §1](./07-domain-rules.md#1-czas-i-miesiąc-budżetowy). |
| I-2 | `type='transfer'` ⇒ `account_id` i `counter_account_id` niepuste **i różne**. |
| I-3 | `type='expense'` lub `'income'` ⇒ `counter_account_id` jest `NULL`. |
| I-3a | `income_source_id` niepuste ⇒ `type='income'`. Dodany przy `F2-5` ([ADR-035](./14-decisions-log.md#adr-035)). |
| I-4 | `type='income'` ⇒ `category_id` wskazuje kategorię o `kind='income'` (lub jest `NULL`). Analogicznie dla `expense`. |
| I-5 | `source_allocation_class` i `target_allocation_class` niepuste ⇔ `type='transfer'`. Dla wydatku i przychodu oba są `NULL`. |
| I-6 | Migawki klas są zapisywane z klas kont w chwili utworzenia transakcji i **nigdy nie są aktualizowane** przy zmianie klasy konta. Zmiana **konta** w przelewie bierze migawkę tej strony z nowego konta (ADR-035). |
| I-7 | `source_allocation_class = target_allocation_class` ⇒ przelew nie tworzy żadnych efektów alokacji (przerzucenie w obrębie tej samej puli nie jest nowym oszczędzaniem). |
| I-7a | `allocation_override` niepuste ⇒ `type='transfer'` **albo** (`type='expense'` i `liability_id` niepuste, wtedy dozwolona jest wyłącznie wartość `'none'`). |
| I-8 | `booked_on` nie wcześniej niż `dziś − back_posting_limit_months` (liczone od początku miesiąca) i nie później niż koniec bieżącego miesiąca. Sprawdzane przy zapisie daty (nowa transakcja, zmiana `booked_on`). Transakcja sprzed okna leży w **zamkniętym miesiącu**: wolno poprawić `description`, `merchant`, `notes`; zmiana pozostałych pól, usunięcie i przywrócenie → `422` (07 §1.4, ADR-040). |
| I-9 | Kategorii z `is_system=1` nie można usunąć; można zarchiwizować. |
| I-10 | Nie można usunąć konta, kategorii ani źródła przychodu, do których istnieją transakcje — tylko archiwizacja. |
| I-11 | Kategoria z `parent_id` nie może być rodzicem (maks. jeden poziom zagnieżdżenia). |
| I-12 | `recurring_occurrences` o statusie `posted` ma niepuste `transaction_id`, wskazujące transakcję **poza koszem**. Miękkie usunięcie tej transakcji cofa zaksięgowanie w tej samej transakcji bazodanowej (07 §6.7, ADR-042). |
| I-13 | `documents.status='committed'` ⇒ żadna pozycja nie ma `review_status='pending'`. |
| I-14 | `goals.contribution_mode` zgodny z wypełnionym polem kwoty/procentu (patrz §3.9). |
| I-15 | `users.email` zawsze zapisany małymi literami i przycięty. |
| I-16 | `planned_expenses.due_on` (gdy podany) należy do `due_month`. |
| I-17 | `planned_expenses.set_aside_enabled=1` ⇒ wskazane `set_aside_account_id` albo `set_aside_goal_id`. |
| I-18 | `planned_expenses.status='posted'` ⇒ niepuste `transaction_id` (transakcja poza koszem) i `posted_amount_minor`. Miękkie usunięcie transakcji cofa zaksięgowanie jak przy I-12 (07 §6.7). |
| I-19 | `planned_expenses.due_month` nie może być wcześniejszy niż `set_aside_start_month`. |
| I-20 | `budget_drafts` można założyć tylko dla miesiąca z zakresu [bieżący, bieżący + 12]. Linie szkicu miesiąca minionego są tylko do odczytu (07 §13.1). *(Faza 9)* |
| I-21 | `budget_draft_lines.amount_minor < 0` ⇒ `flow IN ('savings','investment')`. *(Faza 9)* |
| I-22 | `origin='recurring'` ⇔ wypełnione `recurring_rule_id` (dopóki źródło istnieje); `origin IN ('planned','set_aside')` ⇒ `planned_expense_id`; `origin='goal'` ⇒ `goal_id`; `origin='liability'` ⇒ `liability_id`. `origin='manual'` ⇒ `recurring_rule_id` i `planned_expense_id` puste. *(Faza 9)* |
| I-23 | `category_id` linii zgodna z `flow` jak I-4: `income` → kategoria `income`, `expense` → `expense`; linie `savings`/`investment` bez kategorii. *(Faza 9)* |
| I-24 | `is_excluded=1` ⇒ `origin ≠ 'manual'` (linię własną się usuwa, nie wyklucza). Linie wykluczone nie wchodzą do sum ani oceny. *(Faza 9)* |
| I-25 | `budget_draft_lines.group_id` wskazuje grupę **tego samego szkicu** i tej samej sekcji: `income` → `income`, `expense` → `expense`, `savings`/`investment` → `pools`. Nazwa grupy niepusta, ≤ 40 znaków, unikalna w sekcji szkicu bez względu na wielkość liter. *(Faza 9, ADR-081)* |

## 5. Kategorie domyślne (seed)

Wstawiane z `is_system=1`. Pole `ai_hints` jest tu kluczowe — to ono decyduje o jakości
automatycznej kategoryzacji z paragonów (wymaganie #4 i #5).

**Wydatki** (rodzic → dzieci):

| Kategoria | Podkategorie | Przykładowe `ai_hints` |
|---|---|---|
| Mieszkanie | Czynsz, Rata kredytu, Prąd, Gaz, Woda, Internet i TV, Śmieci | wspólnota, spółdzielnia, Tauron, PGNiG, Orange, Play |
| Jedzenie | Zakupy spożywcze, Restauracje, Praca/lunch, Kawa | Biedronka, Lidl, Żabka, Kaufland, Auchan, Carrefour, Glovo, Uber Eats |
| Transport | Paliwo, Komunikacja miejska, Taxi, Serwis, Ubezpieczenie OC/AC, Parking, Autostrady | Orlen, BP, Shell, Circle K, ZTM, Uber, Bolt |
| Zdrowie | Lekarz, Apteka, Badania, Rehabilitacja, Abonament medyczny | Apteka, Doz, Medicover, Luxmed, Gemini |
| Dom | Chemia i higiena, Wyposażenie, Remont, Ogród | Rossmann, Hebe, IKEA, Leroy Merlin, Castorama, Jysk |
| Dzieci | Żłobek/przedszkole, Zajęcia, Ubrania, Zabawki | — |
| Zwierzęta | Karma, Weterynarz | — |
| Ubrania i obuwie | — | Zalando, H&M, Reserved, CCC, Zara |
| Uroda | Fryzjer, Kosmetyki, Kosmetyczka | — |
| Rozrywka | Kino i wydarzenia, Hobby, Książki, Sport i siłownia | Multikino, Empik, Decathlon |
| Subskrypcje | Streaming, Oprogramowanie, Telefon | Netflix, Spotify, YouTube, iCloud, Google One, Adobe |
| Edukacja | Kursy, Szkoła, Materiały | Udemy, Coursera |
| Podróże | Nocleg, Transport, Wyżywienie, Atrakcje | Booking, Airbnb, Ryanair, Wizzair |
| Prezenty i darowizny | — | — |
| Ubezpieczenia | Na życie, Majątkowe | PZU, Warta, Allianz |
| **Działalność (B2B)** | Księgowość, Adres wirtualny, Oprogramowanie i narzędzia, Sprzęt, Domeny i hosting, Usługi obce | wFirma, ifirma, Taxe, biuro rachunkowe, coworking, OVH, home.pl, cyber_Folks |
| Opłaty | Opłaty bankowe, Podatek od nieruchomości, Inne urzędowe | — |
| Inne wydatki | — | — |

**Przychody:** Wynagrodzenie, Premia, Działalność/B2B, Freelance, Wynajem, Odsetki
i dywidendy, Zwrot podatku, Świadczenia (800+, zasiłki), Sprzedaż, Prezent, Inne przychody.

**Transfery:** Oszczędności, Inwestycje, Spłata zobowiązań, Przelew własny.

> **Konwencja: przychód z działalności wpisujemy netto** (ADR-012). Podatek i ZUS są
> „poza dochodem" — nie mają kategorii wydatkowych i nie przechodzą przez księgę. Dlatego
> w kategoriach nie ma pozycji „US" ani „ZUS", a *Działalność (B2B)* obejmuje wyłącznie
> koszty realnie płacone z pieniędzy, które wpłynęły: księgowość (np. roczna opłata
> za wFirma), adres wirtualny, narzędzia, sprzęt.
>
> Gdyby kiedyś trzeba było prowadzić budżet brutto, wystarczy dodać kategorie i zmienić
> sposób wpisywania — schemat tego nie blokuje.

## 6. Strategia migracji

- Migracje generowane przez `pnpm db:generate` do `apps/api/src/db/migrations/` i **commitowane**.
- Uruchamiane przy starcie kontenera (`docker/entrypoint.sh` → `node dist/db/migrate.js`),
  idempotentnie, w transakcji, przed nasłuchem HTTP.
- Przed każdą migracją produkcyjną automatyczny `VACUUM INTO` do `/data/backups/`.
- Migracje są **tylko do przodu**. Brak `down` — przy jednym gospodarstwie rollback
  to przywrócenie kopii, co jest prostsze i pewniejsze niż odwrotne skrypty.
- Migracje zmieniające dane (nie tylko strukturę) opisujemy komentarzem w nagłówku pliku
  oraz wpisem w [14-decisions-log.md](./14-decisions-log.md).

## 7. Wielkość i wydajność

Szacunek dla dwóch osób: ~150 transakcji/miesiąc ⇒ ~1800/rok ⇒ ~18 tys. po dekadzie.
Plik bazy pozostanie poniżej 50 MB; uploady dominują rozmiar wolumenu. Przy tej skali
wszystkie zapytania miesięczne działają z indeksów w milisekundach — **nie wprowadzamy
żadnych optymalizacji przedwcześnie** (bez materializowanych sald, bez cache'u, bez denormalizacji).
