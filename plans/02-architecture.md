# 02 — Architektura

## 1. Widok z lotu ptaka

```
┌────────────────── przeglądarka (telefon / desktop) ──────────────────┐
│  React 19 SPA (PWA)                                                  │
│  features/* — TanStack Query — lib/api-client.ts — @fineapp/shared   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTPS; cookie httpOnly (refresh) + Bearer (access)
┌───────────────────────────────▼──────────────────────────────────────┐
│  Kontener Docker — jeden proces Node                                 │
│                                                                      │
│  Fastify                                                             │
│   ├─ @fastify/static  ──►  zbudowany SPA (WEB_DIST_PATH)             │
│   └─ /api/v1/*        ──►  moduły                                    │
│                                                                      │
│   ┌── moduł (pionowy plasterek) ─────────────────────────────────┐   │
│   │  *.routes.ts    walidacja Zod, HTTP, kody statusu            │   │
│   │  *.service.ts   reguły domenowe, transakcje, orkiestracja    │   │
│   │  *.repository.ts  zapytania Drizzle — jedyny dostęp do DB    │   │
│   │  *.mapper.ts    wiersz DB ↔ DTO                              │   │
│   └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  core/  config, błędy, logger, dates, id, clock                      │
│  ai/    DocumentExtractor (Anthropic), prompty, schematy narzędzi    │
│  db/    schema (Drizzle), migracje, klient, seed                     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
              ┌─────────────────┴──────────────────┐
              │  wolumen /data                     │
              │   fineapp.db  (SQLite, tryb WAL)   │
              │   uploads/YYYY/MM/<uuid>.jpg       │
              └────────────────────────────────────┘
                                │
                                │ wyłącznie po wrzuceniu dokumentu przez użytkownika
                                ▼
                     Anthropic API (vision + tool use)
```

## 2. Struktura katalogów

```
FineApp/
├─ apps/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ index.ts                 # bootstrap: config → db → server → listen
│  │  │  ├─ core/
│  │  │  │  ├─ config.ts             # walidacja env Zod-em, typowany obiekt config
│  │  │  │  ├─ errors.ts             # AppError + podklasy, kody błędów
│  │  │  │  ├─ logger.ts             # pino
│  │  │  │  ├─ dates.ts              # WYŁĄCZNIE konwersja Date → data biznesowa
│  │  │  │  ├─ id.ts                 # generator ID (ULID, 26 znaków, sortowalny)
│  │  │  │  └─ clock.ts              # wstrzykiwalne „teraz" (testowalność)
│  │  │  ├─ db/
│  │  │  │  ├─ client.ts             # better-sqlite3 + pragmy + instancja Drizzle
│  │  │  │  ├─ migrate.ts            # runner migracji (wołany przez entrypoint)
│  │  │  │  ├─ schema/               # jeden plik na obszar + index.ts (barrel)
│  │  │  │  ├─ migrations/           # wygenerowane .sql — COMMITOWANE
│  │  │  │  └─ seed/                 # kategorie domyślne, gospodarstwo
│  │  │  ├─ http/
│  │  │  │  ├─ server.ts             # budowa instancji Fastify, kompozycja modułów
│  │  │  │  ├─ plugins/              # cookie, helmet, rate-limit, multipart, static
│  │  │  │  ├─ middleware/           # requireAuth, householdScope, requestContext
│  │  │  │  └─ error-handler.ts      # AppError / ZodError → odpowiedź JSON
│  │  │  ├─ ai/
│  │  │  │  ├─ anthropic-client.ts
│  │  │  │  ├─ document-extractor.ts # interfejs + implementacja
│  │  │  │  ├─ prompts/
│  │  │  │  └─ schemas/              # tool input schemas
│  │  │  └─ modules/
│  │  │     ├─ auth/  accounts/  categories/  transactions/  liabilities/
│  │  │     ├─ recurring/  planned-expenses/  goals/  allocation/
│  │  │     ├─ income-sources/  documents/  months/  settings/
│  │  └─ test/                       # helpery i fabryki danych testowych
│  └─ web/
│     └─ src/
│        ├─ main.tsx, app/           # router, providery, ErrorBoundary
│        ├─ components/
│        │  ├─ ui/                   # prymitywy (Button, Sheet, Input, Money…)
│        │  ├─ layout/               # AppShell, BottomNav, MonthSwitcher
│        │  └─ charts/
│        ├─ features/                # lustro modułów backendu
│        │  ├─ auth/  month/  accounts/  transactions/  liabilities/
│        │  ├─ recurring/  planned-expenses/  goals/  allocation/
│        │  ├─ categories/  scan/  settings/
│        │  └─ (każdy: components/, hooks/, api.ts)
│        ├─ lib/                     # api-client, query-keys, format, cn
│        ├─ hooks/                   # ogólne (useMediaQuery, useMonthParam)
│        └─ styles/
├─ packages/shared/src/
│  ├─ dto/                           # schematy Zod per obszar + typy
│  ├─ domain/                        # enumy i typy domenowe
│  ├─ utils/                         # money.ts, month.ts (izomorficzne)
│  └─ constants/                     # kategorie domyślne, limity
├─ plans/
├─ docker/
└─ scripts/
```

## 3. Warstwy i kierunek zależności

```
routes  →  service  →  repository  →  db
   ↓          ↓             ↓
        core / @fineapp/shared     (bez zależności zwrotnych)
```

Reguły twarde:

1. **Routes nie dotykają bazy.** Żadnego importu z `db/` w pliku `*.routes.ts`.
2. **Repository nie zna HTTP.** Nie rzuca błędów ze statusem, nie czyta `request`.
3. **Service nie zwraca wierszy DB.** Zwraca DTO (przez mapper) albo typ domenowy.
4. **Brak importów skrośnych między repozytoriami modułów.** Jeśli moduł A potrzebuje
   danych z B — woła `bService`, nie `bRepository`.
5. **`core/` nigdy nie importuje z `modules/`.**

**Cykl serwisów.** Gdy serwis B woła serwis A, a A potrzebuje B, funkcje A wystawione
innym modułom trafiają do osobnego pliku, który importuje wyłącznie repozytorium A.
Pierwszy przypadek: `transactions.ledger.ts` (salda, sprawdzenia referencji) obok
`transactions.service.ts` (CRUD, który woła serwisy kont, kategorii i źródeł) —
[ADR-035](./14-decisions-log.md#adr-035). Tak samo `recurring.categories.ts` (przepinanie
reguł przy scalaniu kategorii) i `transactions.references.ts` — sprawdzenia odwołań wspólne
dla transakcji i reguł cyklicznych, importujące wyłącznie serwisy
([ADR-043](./14-decisions-log.md#adr-043)).

### Moduł `months` — świadomy wyjątek

`GET /months/:key/summary` agreguje dane z sześciu obszarów. Złożenie go z wywołań
serwisów dałoby problem N+1 i wolną odpowiedź na głównym ekranie aplikacji. Dlatego
`months` ma własne repozytorium z dedykowanymi zapytaniami po wielu tabelach.
Musi to być odnotowane w nagłówku pliku.

### Moduł `settings` — eksport, drugi wyjątek

`GET /settings/export` oddaje kopię wszystkich tabel gospodarstwa. `settings.export.repository.ts`
czyta je wprost, tylko do odczytu — złożenie kopii z serwisów dałoby DTO z polami
wyliczanymi zamiast zapisanych ([ADR-061](./14-decisions-log.md#adr-061)).

`POST /settings/reset` to lustro eksportu: `settings.reset.repository.ts` kasuje te same
tabele w **jednej** transakcji bazy — złożone z serwisów dwunastu modułów nie dałoby
się zatwierdzić naraz ([ADR-072](./14-decisions-log.md#adr-072)). Poza tymi dwoma
modułami wyjątków nie ma.

## 4. Anatomia modułu

Przykład — `modules/accounts/`:

```
accounts/
├─ accounts.routes.ts       # rejestracja tras, schematy, kody HTTP
├─ accounts.service.ts      # reguły domenowe
├─ accounts.repository.ts   # zapytania Drizzle
├─ accounts.mapper.ts       # AccountRow → AccountDto
├─ accounts.types.ts        # typy wewnętrzne modułu
└─ accounts.service.test.ts
```

Plik tras eksportuje jedną funkcję-plugin Fastify:

```ts
/**
 * Rejestruje trasy zarządzania kontami.
 *
 * Wszystkie trasy wymagają uwierzytelnienia i są automatycznie ograniczone
 * do gospodarstwa zalogowanego użytkownika (middleware `householdScope`).
 *
 * @param app - Instancja Fastify z type providerem Zod.
 */
export const accountsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ...
};
```

Rejestracja w `http/server.ts`:

```ts
await app.register(accountsRoutes, { prefix: '/api/v1/accounts' });
```

## 5. Serwisy — wstrzykiwanie zależności

Bez kontenera DI i bez fabryk. Serwis to zestaw **zwykłych funkcji**, które dostają
zależności jawnie w argumentach: uchwyt bazy, zegar, konfigurację — i `householdId`
z tokenu ([ADR-031](./14-decisions-log.md#adr-031)):

```ts
/**
 * Zakłada konto.
 *
 * @param handle - Uchwyt bazy.
 * @param clock - Źródło czasu.
 * @param householdId - Gospodarstwo z tokenu.
 * @param input - Zwalidowane dane konta.
 * @returns Założone konto.
 */
export function createAccount(
  handle: DbHandle,
  clock: Clock,
  householdId: string,
  input: CreateAccountRequest,
): AccountDto {
  // ...
}
```

Zalety: brak dekoratorów i metadanych, jawny graf zależności w sygnaturze. Testy idą
przez prawdziwą bazę `:memory:` z migracjami, więc atrapy repozytoriów nie są potrzebne.
Kompozycja w jednym miejscu — `http/server.ts` przekazuje `db`, `config` i `clock`
do pluginu tras.

> Wcześniejsza wersja tego punktu pokazywała fabrykę `createAccountsService(deps)`.
> Moduł `auth` od początku używał funkcji; przy `F2-1` przyjęto styl z kodu.

`Clock` (`{ now(): Date }`) wstrzykujemy zawsze, gdy serwis zależy od bieżącego czasu.
Bez tego reguły miesięczne i cykliczne są nietestowalne.

## 6. Repozytoria

- Jeden obiekt na agregat.
- Zwracają **wiersze** (typy wywnioskowane z Drizzle), nie DTO.
- Transakcje bazodanowe: `db.transaction(() => { ... })` — synchronicznie, bo
  better-sqlite3 jest synchroniczne. **O granicy transakcji decyduje serwis**, nie repozytorium.
- Zapytania agregujące mogą używać surowego SQL przez tag `sql` — pod warunkiem jawnie
  zadeklarowanego typu wyniku i komentarza JSDoc wyjaśniającego, co liczą.

```ts
/**
 * Zwraca sumy wpływów i wydatków dla miesiąca.
 *
 * Liczy wyłącznie transakcje o statusie `posted`; pomija `void` i skasowane miękko.
 *
 * @param householdId - Identyfikator gospodarstwa.
 * @param monthKey - Miesiąc w formacie `YYYY-MM`.
 * @returns Sumy w groszach; zera, gdy brak transakcji.
 */
sumByType(householdId: string, monthKey: string): MonthTotalsRow;
```

## 7. Obsługa błędów

Jedna hierarchia w `core/errors.ts`:

```ts
/** Bazowy błąd aplikacyjny z kodem domenowym i statusem HTTP. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly statusCode: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

ValidationError             // 400  VALIDATION_ERROR
UnauthorizedError           // 401  UNAUTHORIZED
AiBudgetExceededError       // 402  AI_BUDGET_EXCEEDED
ForbiddenError              // 403  FORBIDDEN
NotFoundError               // 404  NOT_FOUND
ConflictError               // 409  CONFLICT
FileTooLargeError           // 413  FILE_TOO_LARGE
UnsupportedMediaTypeError   // 415  UNSUPPORTED_MEDIA_TYPE
DomainRuleViolationError    // 422  DOMAIN_RULE_VIOLATION
RateLimitError              // 429  RATE_LIMITED
InternalError               // 500  INTERNAL_ERROR
ExternalServiceError        // 502  EXTERNAL_SERVICE_ERROR
```

Komplet odpowiada kodom z [04 §3](./04-api-spec.md#3-format-błędów) — każdy kod
z kontraktu ma swoją klasę, żeby nie trzeba było składać `AppError` ręcznie.
**Podklasa ustala `code` i `statusCode` na sztywno**, a miejsce rzucenia podaje tylko
komunikat i opcjonalne szczegóły:

```ts
throw new NotFoundError('Nie znaleziono konta.');
throw new DomainRuleViolationError('Przelew wymaga konta docelowego.');
throw new ValidationError('Kwota musi być większa od zera.', [
  { path: 'amountMinor', message: 'Oczekiwano liczby dodatniej' },
]);
```

Gdyby kod i status trzeba było podawać przy każdym rzuceniu, prędzej czy później
pojawiłby się `NotFoundError` ze statusem 400 (ADR-016).

Do zawężania `unknown` w bloku `catch` służy `isAppError(error)`.

`http/error-handler.ts` zamienia je na kontrakt z [04-api-spec.md](./04-api-spec.md#3-format-błędów).
Błędy nierozpoznane → `500 INTERNAL_ERROR` z `requestId`; pełny stack trafia wyłącznie do logu.

**Nigdy nie logujemy:** PIN-ów, hashy, tokenów, treści dokumentów, jawnych adresów e-mail
przy nieudanym logowaniu (tam wyłącznie hash).

## 8. Konwencje kodu

### Nazewnictwo

| Element | Konwencja | Przykład |
|---------|-----------|----------|
| Pliki | kebab-case | `income-sources.service.ts` |
| Typy, interfejsy, klasy | PascalCase | `AccountDto`, `AppError` |
| Funkcje, zmienne | camelCase | `computeMonthSummary` |
| Stałe modułowe | UPPER_SNAKE_CASE | `DEFAULT_CATEGORIES` |
| Kolumny DB | snake_case | `amount_minor` |
| Pola DTO / JSON | camelCase | `amountMinor` |
| Klucze TanStack Query | z `lib/query-keys.ts` | `qk.month('2026-09')` |

Mapowanie snake_case ↔ camelCase odbywa się **wyłącznie w mapperach**. Poza warstwą DB
w kodzie nie występuje `amount_minor`.

### Sufiksy jednostek — reguła krytyczna

- `...Minor` — kwota w **groszach**, `number` całkowity (`amountMinor`, `targetAmountMinor`).
- `...Bps` — udział w **punktach bazowych**, 1% = 100 bps (`savingsPercentBps`).

Nazwa niesie jednostkę, więc nie da się pomylić `20` (procent) z `2000` (bps) ani
`100` (złotówki) z `10000` (grosze). Pola bez sufiksu nie są kwotami ani udziałami.

### JSDoc — zakres obowiązkowy

Wymagany dla:

- każdej eksportowanej funkcji, klasy, typu i interfejsu,
- każdej trasy (opis + wymagania autoryzacyjne + skutki uboczne),
- każdego pola DTO, którego nazwa nie tłumaczy się sama,
- **każdego nieoczywistego obliczenia domenowego** — tu JSDoc tłumaczy *dlaczego*, nie *co*.

Nie dokumentujemy rzeczy oczywistych; `/** Zwraca id. */` to szum. Reguła praktyczna:
komentarz odpowiada na pytanie, które czytelnik zada, patrząc na kod.

Język: opisy po **polsku**, nazwy symboli po angielsku.

### Importy

Alias `@/` → `src/` w obu aplikacjach. Kolejność: wbudowane Node → zewnętrzne →
`@fineapp/shared` → `@/...` → względne.

### Asynchroniczność

Warstwa DB jest synchroniczna, warstwa HTTP i AI asynchroniczna. Serwisy, które nie
wykonują I/O sieciowego, **nie są `async`** — nie opakowujemy niczego w `Promise` na zapas.

## 9. Testy

| Poziom | Zakres | Narzędzie |
|--------|--------|-----------|
| Jednostkowe | `shared/utils/money`, `shared/utils/month`, kalkulacje alokacji, generator wystąpień cyklicznych | Vitest, czyste funkcje |
| Serwisowe | reguły domenowe z atrapami repozytoriów | Vitest |
| Integracyjne | trasy + prawdziwa baza SQLite `:memory:` z migracjami | Vitest + `app.inject()` |
| Kontraktowe | `parse()` przykładowych payloadów z [05](./05-dto-contracts.md) | Vitest |

Priorytet pokrycia: **kalkulacje pieniężne, miesięczne i alokacyjne — 100%**.
Reszta rozsądnie. Fabryki danych w `apps/api/test/factories/`.

## 10. Frontend — wzorce

- **Jedno źródło stanu serwerowego:** TanStack Query. Bez Reduxa/Zustanda dla danych z API.
  Lokalny stan UI: `useState`. Globalny stan nawigacyjny: parametr URL.
- **Miesiąc jest w URL** (`/m/2026-09`) — przycisk „wstecz" w przeglądarce działa naturalnie,
  a link da się wysłać drugiej osobie.
- **Klucze cache** centralnie w `lib/query-keys.ts`. Każda mutacja ma w JSDoc listę kluczy,
  które unieważnia (np. transakcja → `qk.month(m)`, `qk.accounts()`, `qk.goals()`).
- **Formatowanie pieniądza wyłącznie** przez komponent `<Money />` i `formatMinor()`.
  Żadnego `toFixed(2)` rozsianego po komponentach.
- **Komponenty prezentacyjne nie wołają API.** Dane wchodzą propsami; hooki `useX()`
  mieszkają w `features/*/hooks/`.
- **Granice błędów** na poziomie route'u, nie całej aplikacji — awaria widżetu celów
  nie może wygasić całego ekranu miesiąca.
