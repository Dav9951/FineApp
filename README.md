# FineApp

Samodzielnie hostowana aplikacja do **planowania i kontroli budżetu domowego** — dla jednego
gospodarstwa prowadzonego przez dwie osoby. Po polsku, w złotówkach, mobile-first (PWA).
Działa na Twoim serwerze w Dockerze, dane trzyma w SQLite i nie wysyła ich nikomu
(wyjątek: zdjęcie paragonu, które sam wrzucisz do odczytu przez AI).

> 🇬🇧 English summary: [README.en.md](./README.en.md)

## Co robi

- **Widok miesiąca** — ekran startowy: salda kont, ile zostaje, realizacja celów, co jest
  do zrobienia w tym miesiącu. Przełączanie miesięcy i księgowanie wstecz.
- **Konta i transakcje** — ROR, gotówka, oszczędnościowe, maklerskie; wydatki, przychody
  ze źródłem, przelewy między własnymi kontami; majątek netto.
- **Pozycje cykliczne** — czynsz, abonamenty, wpłata na IKE: ustawiane raz, potem tylko
  potwierdzane.
- **Zobowiązania** — pozostała kwota, rata, okres spłaty, postęp.
- **Planowane wydatki** — OC, przegląd, wakacje: wyliczana rata odkładania i ostrzeżenie,
  gdy w którymś miesiącu zabraknie pieniędzy.
- **Cele i rozkład procentowy** — „odkładam 20% wpływów" liczone na bieżąco w obie strony
  (kwota ⇄ procent), z wykonaniem **netto** (wypłata z oszczędności zmniejsza wynik).
- **Planer budżetu** — szkic następnego miesiąca złożony z pozycji cyklicznych, planowanych
  wydatków, rat i celów; edycja, grupy, ocena, czy plan dowozi cele, potem plan kontra
  wykonanie.
- **Paragony przez AI** — zdjęcie paragonu albo wyciągu → propozycje pozycji i kategorii
  do zatwierdzenia. AI proponuje, człowiek zatwierdza. Funkcja opcjonalna (klucz Anthropic API).
- **Eksport i kopie** — eksport danych do CSV/JSON, skrypty kopii zapasowej i odtwarzania.

Czego nie robi (świadomie): integracji bankowych, wielu walut, wyceny portfela, rejestracji
kont i ról. Szczegóły: [`plans/00-project-overview.md`](./plans/00-project-overview.md).

## Stos

TypeScript · Node 22.12+ · Fastify 5 · SQLite (better-sqlite3) + Drizzle ORM · Zod ·
React 19 + Vite · TanStack Query · Tailwind CSS · Anthropic API (vision, opcjonalnie) ·
Docker · pnpm workspaces

Uzasadnienia wyborów: [`plans/01-tech-stack.md`](./plans/01-tech-stack.md).

## Uruchomienie lokalne

Wymagania: **Node 22.12+**, **pnpm 9+**. Działa na Linuksie, macOS i Windowsie.

```bash
pnpm install
```

```bash
cp .env.example .env
```

Uzupełnij w `.env` co najmniej `JWT_SECRET` i `IP_HASH_SALT` (dopisane na końcu pliku
wygrywają z przykładowymi `CHANGE_ME…`):

```bash
printf 'JWT_SECRET=%s\n' "$(openssl rand -base64 48)" >> .env
```

```bash
printf 'IP_HASH_SALT=%s\n' "$(openssl rand -hex 32)" >> .env
```

Baza, kategorie domyślne i pierwszy użytkownik (skrypt wypisze PIN **jeden raz**):

```bash
pnpm db:migrate && pnpm db:seed
```

```bash
pnpm --filter @fineapp/api user:create -- --email ja@example.com --name "Imię"
```

```bash
pnpm dev
```

API na `http://localhost:3000`, aplikacja na `http://localhost:5173`.

Odczyt paragonów jest w przykładowym `.env` wyłączony (`AI_ENABLED=false`). Żeby go włączyć,
ustaw `AI_ENABLED=true` i `ANTHROPIC_API_KEY`.

## Wdrożenie

```bash
docker compose build && docker compose up -d
```

Reverse-proxy z TLS, kopie zapasowe (także zaszyfrowane poza serwerem), migracje, aktualizacja
i lista kontrolna bezpieczeństwa: [`plans/10-deployment.md`](./plans/10-deployment.md)
i [`plans/09-security-auth.md`](./plans/09-security-auth.md) §11.

## Dokumentacja

Projekt jest prowadzony „dokumentacją najpierw": katalog [`plans/`](./plans/README.md) opisuje
model danych, API, kontrakty, ekrany i reguły obliczeń, a kod musi być z nim zgodny. Każde
odstępstwo od planu ma wpis w [dzienniku decyzji (ADR)](./plans/14-decisions-log.md).

| Dokument | Zawartość |
|---|---|
| [00 Przegląd](./plans/00-project-overview.md) | Cel, zakres, słownik pojęć |
| [02 Architektura](./plans/02-architecture.md) | Warstwy, struktura, konwencje kodu |
| [03 Model danych](./plans/03-data-model.md) | Schemat bazy, indeksy, niezmienniki |
| [04 API](./plans/04-api-spec.md) · [05 DTO](./plans/05-dto-contracts.md) | Endpointy i kontrakty Zod |
| [06 Widoki](./plans/06-ui-views.md) · [15 Design system](./plans/15-design-system.md) | Ekrany i reguły wizualne |
| [07 Reguły domenowe](./plans/07-domain-rules.md) | Pieniądz, miesiące, alokacje, cykle |
| [11 Roadmapa](./plans/11-roadmap.md) · [13 Stan](./plans/13-progress.md) | Fazy, zadania, co zostało |
| [14 Decyzje](./plans/14-decisions-log.md) | Dziennik ADR |

Pełny indeks: [`plans/README.md`](./plans/README.md).

## Współtworzenie

Zgłoszenia i poprawki mile widziane — po polsku lub po angielsku. Zanim otworzysz PR,
przeczytaj [CONTRIBUTING.md](./CONTRIBUTING.md): kwoty w groszach, procenty w bps, kontrakt
przed implementacją i dokumentacja aktualizowana razem z kodem.

## Licencja

[MIT](./LICENSE)
