# 01 — Stos technologiczny

## 1. Skrót

| Warstwa | Wybór | Dlaczego |
|---------|-------|----------|
| Język | TypeScript 5.7 (strict, ESM) | Największe doświadczenie właściciela; jeden język FE+BE. |
| Runtime | Node.js 22 LTS | Wsparcie do 2027, natywny `fetch`, stabilne ESM. |
| Monorepo | pnpm workspaces | Współdzielone DTO bez publikowania paczek; szybkie i oszczędne na dysku. |
| Backend | Fastify 5 | Szybki, pierwszorzędne typowanie, wbudowana walidacja schematami, dobry ekosystem pluginów. |
| Walidacja | Zod 3 | Jedno źródło: schemat → typ TS → walidacja runtime → dokumentacja. |
| Baza | SQLite (better-sqlite3) | Wymóg projektu; idealna dla 2 użytkowników — zero administracji, backup = kopia pliku. |
| ORM | Drizzle ORM + drizzle-kit | Schemat w TS, typowane zapytania blisko SQL, migracje generowane do plików `.sql`. |
| Auth | argon2id + JWT (access) + opaque refresh w DB | PIN wymaga mocnego KDF; sesje odwoływalne. |
| AI/OCR | Anthropic SDK, `claude-sonnet-5-5` (vision + tool use; ADR-071) | Strukturalne wyjście przez tool schema zamiast parsowania tekstu. |
| Frontend | React 19 + Vite 6 | Standard, szybki dev, prosty build do statyków. |
| Routing | React Router 7 | Wystarczający, dobrze znany, proste route'y z parametrem miesiąca. |
| Dane serwerowe | TanStack Query 5 | Cache per-miesiąc, invalidacje, optymistyczne update'y. |
| Formularze | react-hook-form + `@hookform/resolvers/zod` | Ten sam Zod co na backendzie. |
| Style | Tailwind CSS 3.4 + Radix UI primitives | Mobile-first, brak walki z CSS, dostępne komponenty bez ciężkiej biblioteki. |
| Wykresy | Recharts | Proste wykresy (donut alokacji, słupki miesięczne). |
| PWA | vite-plugin-pwa | Instalowalność na telefonie, offline shell. |
| Logi | pino (+ pino-pretty w dev) | Structured logging, tanie. |
| Testy | Vitest + `fastify.inject()` | Bez uruchamiania serwera; szybkie testy integracyjne na SQLite in-memory. |
| Konteneryzacja | Docker multi-stage, jeden obraz | Jeden proces = jeden kontener + wolumen `/data`. |

## 2. Decyzje wymagające uzasadnienia

### 2.1 Dlaczego Fastify, a nie Express / Hono / NestJS

- **Express** — brak natywnej walidacji, typowanie handlerów słabe, ekosystem middleware
  w wersji 4 nie jest typowany.
- **NestJS** — dużo ceremonii (moduły, DI, dekoratory) jak na aplikację dla dwóch osób;
  narzucałby architekturę zamiast pozwolić jej wyniknąć z domeny.
- **Hono** — świetny, ale ekosystem pluginów (multipart, rate-limit, cookie) słabszy niż
  Fastify, a my potrzebujemy ich wszystkich.
- **Fastify** wygrywa: `fastify-type-provider-zod` daje end-to-end typowanie
  request/response na podstawie tych samych schematów Zod, które idą do frontu.

### 2.2 Dlaczego Drizzle, a nie Prisma / Kysely / surowy SQL

- **Prisma** — własny silnik binarny, ciężki w kontenerze, generowany klient; dla SQLite
  overkill i komplikuje build wieloetapowy.
- **Kysely** — bardzo dobry query builder, ale migracje trzeba dopisać samemu.
- **Surowy SQL** — kuszące przy SQLite, ale tracimy typowanie wyników i refaktoryzowalność.
- **Drizzle** — schemat jest TypeScriptem (jedno źródło prawdy), `drizzle-kit generate`
  produkuje czytelne pliki `.sql` które commitujemy i uruchamiamy deterministycznie na
  produkcji. Zapytania wyglądają jak SQL, więc nie ma „magii".

> **Uwaga o surowym SQL:** dla zapytań agregujących (podsumowanie miesiąca, alokacje)
> dopuszczamy surowy SQL przez tag `sql` z jawnym typem wyniku.
> Patrz [02](./02-architecture.md#6-repozytoria).

### 2.3 Dlaczego better-sqlite3 (synchroniczne), a nie node:sqlite / libsql

- `better-sqlite3` jest **synchroniczne** — przy jednym procesie i dwóch użytkownikach to
  zaleta: brak wyścigów, transakcje są trywialne (`db.transaction(fn)`), brak `await`
  w repozytoriach.
- `node:sqlite` (wbudowane w Node 22) jest jeszcze eksperymentalne; wrócimy do niego, gdy
  się ustabilizuje — to jedna warstwa (`db/client.ts`) do wymiany.
- Wymaga natywnej kompilacji → w Dockerfile jest etap z `python3/make/g++`.

**Konfiguracja SQLite (obowiązkowa, w `db/client.ts`):**

```
PRAGMA journal_mode = WAL;        -- równoległy odczyt podczas zapisu
PRAGMA synchronous = NORMAL;      -- rozsądny kompromis trwałość/szybkość przy WAL
PRAGMA foreign_keys = ON;         -- SQLite domyślnie ich NIE egzekwuje
PRAGMA busy_timeout = 5000;       -- czekaj zamiast rzucać SQLITE_BUSY
PRAGMA temp_store = MEMORY;
```

### 2.4 Dlaczego Tailwind 3.4, a nie 4

Tailwind 4 przeniósł konfigurację do CSS i zmienił model pluginów. Dla startu projektu
wybieramy 3.4 — dojrzałe, kompatybilne z całym ekosystemem Radix/shadcn, ogrom przykładów.
Upgrade do 4 to osobne, izolowane zadanie (patrz [11](./11-roadmap.md), sekcja „Po v1 — rozważane").

### 2.5 Dlaczego jeden kontener, a nie osobno API + nginx

Aplikacja dla dwóch osób na prywatnym VPS. Fastify serwuje statyki z `@fastify/static`
równie dobrze jak nginx przy tym ruchu. Mniej ruchomych części = mniej rzeczy do zepsucia.
TLS i tak zwykle kończy na wspólnym reverse-proxy VPS-a (Caddy/nginx/Traefik) — patrz
[10](./10-deployment.md).

### 2.6 Model AI

`claude-sonnet-5-5` (od ADR-071; wcześniej `claude-sonnet-5`) jako domyślny: dobry stosunek jakości vision do kosztu, wystarczający do
odczytu paragonów i wyciągów. Model jest konfigurowalny przez `AI_MODEL`, a warstwa
`ai/` ma interfejs `DocumentExtractor`, więc podmiana dostawcy to jedna implementacja.

Struktura odpowiedzi wymuszana przez **tool use** (`tool_choice` na konkretne narzędzie),
nie przez proszenie o JSON w tekście — to eliminuje parsowanie markdown i halucynacje formatu.

## 3. Wersje pakietów — ustalone instalacją

> **Zamknięte w `F0-1`.** Wersje nie są już „rozsądnymi minimami wpisanymi
> przy projektowaniu" — `pnpm install` przeszedł, `pnpm-lock.yaml` jest w repozytorium,
> a kluczowe pary sprawdzono uruchomieniem. Pełny zapis i uzasadnienia:
> [ADR-014](./14-decisions-log.md#adr-014).

| Pakiet | Wersja | Uwaga |
|---|---|---|
| `zod` | 3.25.76 | ostatnia z gałęzi 3.x — **zostaje**, patrz niżej |
| `fastify` | 5.12.5 | |
| `fastify-type-provider-zod` | 4.0.2 | deklaruje `zod ^3.14.2` — para spełniona |
| `drizzle-orm` / `drizzle-kit` | 0.45.3 / 0.31.11 | |
| `better-sqlite3` | 13.0.3 | SQLite 3.53.4 |
| `@anthropic-ai/sdk` | 0.127.0 | podniesione z `^0.33.0` |
| `tailwindcss` | 3.4.19 | bez zmian — §2.4 obowiązuje |
| `typescript` | 5.9.3 | TS 7 odpada: `typescript-eslint` deklaruje `<6.1.0` |
| `@types/node` | 22.x | trzyma się majora runtime'u z `.nvmrc` |

**Dlaczego Zod zostaje na 3.x.** Obawa z pierwotnej wersji tego paragrafu („przy Zod 4
wymagany jest nowszy type provider") potwierdziła się, ale wypadła na korzyść 3.x:
`fastify-type-provider-zod` od wersji 5 ma w zależnościach równorzędnych
`@fastify/swagger` i `openapi-types`, a projekt nigdzie nie wystawia OpenAPI. Koszt
przejścia na Zod 4 to dwie zależności dodane wyłącznie po to, żeby uciszyć ostrzeżenia.
Migracja kiedyś nastąpi i dotknie każdego DTO — świadomie odłożona, [`Z-6` w 13](./13-progress.md).

**Model AI.** Od ADR-071 domyślny jest `claude-sonnet-5-5` (§2.6).

**Przy zmianie wersji.** Instalacja nie zgłasza dziś **żadnego** ostrzeżenia
o niespełnionych zależnościach równorzędnych — to jest stan bazowy. Jeśli po `pnpm up`
pojawi się ostrzeżenie, coś się rozjechało.

## 4. Zależności, których świadomie NIE używamy

| Pakiet | Zamiast tego | Powód |
|--------|--------------|-------|
| `moment` | `date-fns` + `date-fns-tz` | Rozmiar, mutowalność, status legacy. |
| `dinero.js` / `currency.js` | własny moduł `money.ts` (kilkadziesiąt linii) | Potrzebujemy tylko dodawania i procentów na integerach. |
| `lodash` | natywne metody ES2023 | Node 22 ma wszystko, czego potrzebujemy. |
| `axios` | natywny `fetch` | Wbudowany w Node 22 i przeglądarki. |
| `bcrypt` | `argon2` | argon2id jest rekomendowany dla krótkich sekretów (PIN). |
| `passport` | własny handler logowania (~100 linii) | Jeden sposób logowania, bez OAuth. |
| Redis | tabela w SQLite | Rate-limit i sesje mieszczą się w bazie przy 2 użytkownikach. |
| Biblioteka OCR (tesseract) | Claude vision | Tesseract na polskich paragonach wymaga dużo preprocessingu i i tak nie kategoryzuje. |

## 5. Skrypty (root `package.json`)

```bash
pnpm dev            # API (3000) + web (5173) równolegle
pnpm dev:api
pnpm dev:web
pnpm build          # shared → api → web
pnpm typecheck      # tsc --noEmit we wszystkich paczkach
pnpm lint / lint:fix
pnpm format / format:check
pnpm test           # vitest we wszystkich paczkach

pnpm db:generate    # drizzle-kit generate — nowa migracja ze zmian w schemacie
pnpm db:migrate     # zastosuj migracje
pnpm db:seed        # kategorie domyślne + gospodarstwo
pnpm db:studio      # przeglądarka bazy

pnpm docker:build / docker:up / docker:logs
```
