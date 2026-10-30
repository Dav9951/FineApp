# 10 — Wdrożenie i eksploatacja

> **Wdrożenie produkcyjne** działa według [§12](#12-produkcja-brama-https-portal-i-github-actions):
> obraz budowany w GitHub Actions, kontener w sieci bramy `https-portal`, bez portu
> na hoście ([ADR-065](./14-decisions-log.md#adr-065)). Sekcje 1–7 opisują wariant ogólny
> (Caddy/nginx, budowa na VPS) i zostają jako punkt odniesienia.

## 1. Model wdrożenia

Jeden kontener Docker na prywatnym VPS:

```
Internet
   │ HTTPS (443)
   ▼
Caddy / nginx / Traefik  ← TLS, certyfikat Let's Encrypt (już na VPS)
   │ HTTP (127.0.0.1:3000)
   ▼
┌──────────────────────────────────────────┐
│ kontener `fineapp`                       │
│  Node 22 · Fastify                       │
│   ├─ /api/v1/*    → API                  │
│   └─ /*           → statyczny SPA        │
└──────────────┬───────────────────────────┘
               │
        wolumen `fineapp-data` → /data
               ├─ fineapp.db  (+ -wal, -shm)
               ├─ uploads/YYYY/MM/*
               └─ backups/*.db
```

Port aplikacji jest wystawiony **wyłącznie na pętlę zwrotną** (`127.0.0.1:3000`).
Ruch z zewnątrz przechodzi przez reverse-proxy, który obsługuje TLS. Dzięki temu
kontener nigdy nie jest bezpośrednio osiągalny z internetu.

## 2. Budowanie obrazu

Trzyetapowy `Dockerfile`:

| Etap | Zadanie |
|---|---|
| `deps` | `pnpm install --frozen-lockfile` z cache; toolchain do kompilacji `better-sqlite3` i `sharp` |
| `build` | `pnpm run build` (shared → api → web) + `pnpm deploy --prod` dla samego API |
| `runtime` | `node:22-bookworm-slim` bez kompilatorów; użytkownik `node`; `tini` jako PID 1 |

Kluczowe właściwości:

- **Warstwa zależności jest cache'owana osobno** — kopiujemy najpierw pliki `package.json`,
  potem instalujemy, dopiero potem resztę kodu. Zmiana kodu nie unieważnia instalacji.
- **Obraz produkcyjny nie zawiera kompilatorów ani źródeł** — tylko `dist`, zależności
  produkcyjne i zbudowany front.
- **`tini` jako PID 1** — bez tego Node nie dostaje poprawnie `SIGTERM` i restart
  kontenera kończy się twardym ubiciem po 10 sekundach, co przy SQLite jest ryzykowne.
- **Kontener działa jako `node`**, nie `root`.

```bash
docker compose build
```

> Pierwsze budowanie kompiluje `better-sqlite3` i pobiera binaria `sharp` — trwa kilka
> minut. Kolejne są szybkie dzięki cache warstw i cache'owi pnpm store.

## 3. Uruchomienie na VPS

```bash
git clone <repo> /opt/fineapp
cd /opt/fineapp
cp .env.example .env
```

Wygenerowanie sekretów:

```bash
printf 'JWT_SECRET=%s\n' "$(openssl rand -base64 48)" >> .env
```

```bash
printf 'IP_HASH_SALT=%s\n' "$(openssl rand -hex 32)" >> .env
```

Ustawienie wartości produkcyjnych w `.env`: `NODE_ENV=production`, `COOKIE_SECURE=true`,
`APP_URL=https://budzet.twojadomena.pl`, `AI_ENABLED=true`, `ANTHROPIC_API_KEY=...`.
`.env.example` ma OCR wyłączony (wygoda dla środowiska deweloperskiego, ADR-057) — bez
`AI_ENABLED=true` zakładka *Skan* się nie pojawi. Klucz bez tej flagi niczego nie włącza.

```bash
chmod 600 .env
```

```bash
docker compose up -d
```

Utworzenie użytkowników (jednorazowo):

```bash
docker compose exec app node dist/scripts/create-user.js --email ja@example.com --name "Adam"
```

Skrypt wypisze wygenerowany PIN **jeden raz** — trzeba go zapisać od razu.

## 4. Reverse-proxy

**Caddy** (`Caddyfile`) — najprostsza opcja, certyfikat automatycznie:

```
budzet.twojadomena.pl {
    reverse_proxy 127.0.0.1:3000
    encode gzip zstd
    request_body {
        max_size 12MB
    }
}
```

**nginx** — istotne są trzy ustawienia:

```nginx
server {
    listen 443 ssl http2;
    server_name budzet.twojadomena.pl;

    # Musi być większe niż UPLOAD_MAX_BYTES, inaczej nginx odrzuci
    # upload paragonu zanim dotrze do aplikacji.
    client_max_body_size 12M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Analiza dokumentu potrafi trwać kilkanaście sekund
        proxy_read_timeout 90s;
    }
}
```

`X-Forwarded-For` jest konieczny — bez niego limitowanie prób logowania widzi wyłącznie
adres proxy i blokuje wszystkich naraz. Fastify musi mieć `trustProxy: true`
(ustawiane, gdy `NODE_ENV === 'production'`).

## 5. Kopie zapasowe

### 5.1 Dlaczego nie `cp`

Kopiowanie pliku SQLite w trakcie zapisu daje uszkodzoną kopię — zwłaszcza w trybie WAL,
gdzie część danych żyje w `-wal`. Poprawna metoda to `VACUUM INTO`, która tworzy spójną
migawkę bez blokowania zapisów.

### 5.2 Skrypt

`scripts/backup.sh` (uruchamiany z hosta, z katalogu repozytorium) — od `F8-8`
([ADR-062](./14-decisions-log.md#adr-062)):

1. `docker compose exec -T app node dist/scripts/backup.js /data/backups/snapshot.db` —
   `VACUUM INTO` i **od razu** `PRAGMA integrity_check` z raportem (migracje, domownicy,
   konta, transakcje, ostatnia data). Uszkodzona kopia kończy skrypt kodem 1.
2. `docker compose cp` na hosta jako `fineapp-RRRRMMDD-HHMMSS.db` z uprawnieniami `600`.
3. Uploady — w niedzielę (albo `FORCE_UPLOADS=1`) jako `uploads-*.tar.gz` przez
   `docker compose exec … tar`.
4. Rotacja dopiero po udanej kopii: 14 baz, 8 archiwów uploadów.
5. Migawki w wolumenie (`pre-migration-*` z runnera migracji, `pre-restore-*`
   z `restore.sh`) — 5 najnowszych każdego rodzaju.

**Wszystko przez `docker compose`**, nie `docker run -v fineapp-data:/data`: Compose
nazywa wolumen `<projekt>_fineapp-data`, więc goła nazwa trafiłaby do nowego, pustego
wolumenu.

Harmonogram (cron hosta, codziennie o 3:30):

```bash
30 3 * * * /opt/fineapp/scripts/backup.sh >> /var/log/fineapp-backup.log 2>&1
```

### 5.3 Kopia poza serwerem

Kopia leżąca na tym samym VPS nie chroni przed utratą maszyny. Minimum: `rclone`
lub `restic` do zdalnego magazynu, **z szyfrowaniem** — plik bazy zawiera pełny obraz
finansów gospodarstwa.

Na produkcji: **`scripts/offsite.sh`** — `restic` (szyfrowanie na VPS) prosto do
**Backblaze B2**, bez `rclone`. Wysyła cały katalog kopii (restic deduplikuje), retencja
14 dni / 8 tygodni / 12 miesięcy, w niedzielę `restic check`.

| Plik na serwerze | Zawartość |
|---|---|
| `~/.config/restic/fineapp.pass` | hasło repozytorium — **kopia w menedżerze haseł właściciela**; bez niego kopia jest nie do odczytania |
| `~/.config/restic/fineapp-b2.env` | `B2_ACCOUNT_ID` / `B2_ACCOUNT_KEY` — klucz aplikacji ograniczony do jednego bucketu |

Repozytorium: `RESTIC_REPOSITORY` (domyślnie `b2:<nazwa-bucketu>:fineapp`).
Google Drive przez `rclone` odrzucony: od 2026 wymaga własnej aplikacji OAuth
opublikowanej w Google Cloud ([ADR-066](./14-decisions-log.md#adr-066)).

Odtworzenie z B2 na nowej maszynie:

```bash
restic -r b2:<nazwa-bucketu>:fineapp restore latest --target /tmp/fineapp-restore
```

potem `scripts/restore.sh` na wybranym pliku `fineapp-*.db` (§5.4).

### 5.4 Odtwarzanie

```bash
scripts/restore.sh /opt/fineapp/backups/fineapp-20260920-033000.db
```

Kolejność w skrypcie jest celowa:

1. kopia jest **sprawdzana** (`backup.js --verify`, tylko do odczytu), zanim cokolwiek
   zostanie zatrzymane;
2. bieżąca baza trafia do `/data/backups/pre-restore-*.db` (gdy aplikacja jeszcze działa);
3. `stop` → podmiana pliku bez `-wal`/`-shm` starej bazy → `up -d`;
4. czekanie na `/health` — sukces tylko przy żywej aplikacji. Migracje brakujące w kopii
   zastosują się przy starcie (entrypoint).

Po odtworzeniu: zalogować się i sprawdzić ostatnią transakcję z raportu kopii.

> **Kopia nieprzetestowana to nie kopia.** Odtworzenie trzeba przećwiczyć przy pierwszym
> wdrożeniu i powtarzać raz na kwartał (`F8-8`). Zostały przećwiczone lokalnie na
> zbudowanym `dist` (bez Dockera — patrz [ADR-062](./14-decisions-log.md#adr-062));
> przebieg na VPS z `restore.sh` zostaje do zrobienia przy wdrożeniu.

## 6. Migracje bazy

- Generowane lokalnie przez `pnpm db:generate` i **commitowane** do repozytorium.
- Uruchamiane automatycznie przez `docker/entrypoint.sh` przed startem serwera HTTP.
- Idempotentne — drizzle prowadzi tabelę zastosowanych migracji.
- **Przed każdą migracją** entrypoint robi automatyczną migawkę do `/data/backups/`
  z nazwą `pre-migration-<timestamp>.db`. Przy dwóch użytkownikach koszt jest znikomy,
  a zysk przy nieudanej migracji — ogromny.
- Brak migracji wstecznych. Wycofanie = przywrócenie kopii sprzed migracji.

## 7. Aktualizacja aplikacji

> Na produkcji aktualizację i wycofanie robi workflow — [§12.4](#124-wdrożenie-aktualizacja-wycofanie).

```bash
cd /opt/fineapp && git pull && docker compose build && docker compose up -d
```

Przerwa w działaniu: kilka sekund (restart kontenera). Przy dwóch użytkownikach
nie ma potrzeby wdrożeń bez przestoju.

Wycofanie zmiany:

```bash
git checkout <poprzedni-tag> && docker compose build && docker compose up -d
```

Jeśli nowa wersja zawierała migrację, wycofanie wymaga również przywrócenia kopii
`pre-migration-*.db`.

## 8. Monitorowanie

Przy tej skali nie stawiamy Prometheusa ani Grafany. Wystarczy:

| Co | Jak |
|---|---|
| Czy działa | `HEALTHCHECK` w Dockerze + `restart: unless-stopped` |
| Logi | `docker compose logs -f app`; rotacja `json-file` 10 MB × 3 |
| Miejsce na dysku | `df -h` w cotygodniowym cronie z powiadomieniem |
| Powiadomienie o awarii | zewnętrzny monitor (np. Uptime Kuma) odpytujący `/api/v1/health` |
| Koszty AI | ekran *Ustawienia → AI* w aplikacji |

Endpoint zdrowia:

```jsonc
// GET /api/v1/health  — bez autoryzacji
{ "status": "ok", "version": "0.3.1", "dbOk": true, "uptimeSeconds": 84321 }
```

`dbOk` wykonuje rzeczywiste `SELECT 1` — healthcheck, który sprawdza tylko czy proces
żyje, nie wykryje uszkodzonego wolumenu.

## 9. Zmienne środowiskowe

Pełna lista w [`.env.example`](../.env.example). Walidacja przy starcie w `core/config.ts`:

```ts
/**
 * Schemat zmiennych środowiskowych.
 *
 * Aplikacja odmawia startu przy brakującej lub niepoprawnej konfiguracji — błąd przy
 * uruchomieniu jest znacznie tańszy niż działająca aplikacja z domyślnym sekretem JWT.
 */
export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  APP_URL: z.string().url(),

  DATABASE_PATH: z.string().min(1),
  UPLOAD_DIR: z.string().min(1),
  UPLOAD_MAX_BYTES: z.coerce.number().int().default(10 * 1024 * 1024),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET musi mieć co najmniej 32 znaki')
    .refine((v) => !v.startsWith('CHANGE_ME'), 'Ustaw własny JWT_SECRET'),
  IP_HASH_SALT: z.string().min(16),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().default(2_592_000),
  COOKIE_SECURE: z.coerce.boolean().default(false),

  ANTHROPIC_API_KEY: z.string().optional(),
  AI_ENABLED: z.coerce.boolean().default(true),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().default(16_000),
  AI_MONTHLY_BUDGET_MINOR: z.coerce.number().int().default(5000),
  // Stawki szacunku kosztu — grosze za milion tokenów (ADR-059)
  AI_INPUT_COST_MINOR_PER_MTOK: z.coerce.number().int().default(800),
  AI_OUTPUT_COST_MINOR_PER_MTOK: z.coerce.number().int().default(4000),

  DEFAULT_CURRENCY: z.string().length(3).default('PLN'),
  DEFAULT_TIMEZONE: z.string().default('Europe/Warsaw'),
  // Pusty — API bez frontu (dev: front z Vite). W obrazie `/app/web` (docker-compose.yml).
  WEB_DIST_PATH: z.string().default(''),
});
```

Dodatkowa reguła: gdy `NODE_ENV === 'production'`, wymagane są `COOKIE_SECURE=true`
i `APP_URL` zaczynające się od `https://`. Brak → odmowa startu z czytelnym komunikatem
(oba sprawdzenia w kodzie od `F8-9`). `WEB_DIST_PATH` wskazujący katalog bez
`index.html` też zatrzymuje start — obraz nie wstanie z samym API
([ADR-062](./14-decisions-log.md#adr-062)).

## 10. Wymagania VPS

| Zasób | Minimum | Zalecane |
|---|---|---|
| RAM | 512 MB | 1 GB (argon2id bierze 64 MiB na weryfikację, `sharp` chwilowo więcej) |
| CPU | 1 vCPU | 1 vCPU wystarcza |
| Dysk | 5 GB | 20 GB (uploady rosną najszybciej) |
| System | dowolny z Dockerem | Debian 12 / Ubuntu 24.04 |

Realne zużycie w spoczynku: ~120 MB RAM, znikome CPU. Szczyty przy analizie dokumentu
(`sharp`) i logowaniu (argon2id).

## 11. Rozwiązywanie problemów

| Objaw | Prawdopodobna przyczyna | Co zrobić |
|---|---|---|
| Kontener restartuje się w pętli | Nieudana walidacja konfiguracji | `docker compose logs app` — komunikat z `core/config.ts` |
| `SQLITE_BUSY` w logach | Długa transakcja blokuje zapis | Sprawdzić `busy_timeout`; poszukać transakcji obejmującej wywołanie sieciowe |
| Upload kończy się `413` | Limit reverse-proxy niższy niż aplikacji | `client_max_body_size` / `max_size` w Caddy |
| Wszyscy blokowani przy logowaniu | Brak `X-Forwarded-For` → jeden adres IP dla wszystkich | Poprawić proxy, włączyć `trustProxy` |
| Baza rośnie mimo usuwania | WAL nie jest przycinany | `PRAGMA wal_checkpoint(TRUNCATE)` w oknie serwisowym |
| Analiza dokumentu wisi | Timeout proxy krótszy niż analiza | `proxy_read_timeout 90s` |
| `502` po wdrożeniu, kontener `healthy` | Brama trzyma stary adres `fineapp-app` z `gateway-net` (log bramy: `connect() failed … upstream: http://172.19.0.X:3000`) | `docker exec gateway-https-portal-1 nginx -t && docker exec gateway-https-portal-1 nginx -s reload` — **nie** restart bramy (§12.7). Workflow robi to sam od ADR-080 |
| Brak miejsca | Uploady | `du -sh /var/lib/docker/volumes/fineapp_fineapp-data/_data/uploads` (nazwa z prefiksem projektu Compose) |

## 12. Produkcja: brama https-portal i GitHub Actions

Decyzja i powody: [ADR-065](./14-decisions-log.md#adr-065).

### 12.1 Model

```
Internet ──HTTPS──► https-portal (brama wspólna dla wszystkich serwisów na VPS)
                        │  sieć dockerowa `gateway-net`, HTTP
                        ▼
                    fineapp-app:3000  (bez portu na hoście)
                        │
                    wolumen `fineapp_fineapp-data` → /data
```

Brama (`~/projects/gateway/docker-compose.yml`, obraz `steveltn/https-portal`) sama
zdobywa i odnawia certyfikaty Let's Encrypt. Spełnia wymagania z §4 bez dodatkowej
konfiguracji: ustawia `X-Forwarded-For` i `X-Forwarded-Proto`, `client_max_body_size`
100 MB (> 12 MB), `proxy_read_timeout` 2 h (> 90 s).

### 12.2 Pliki na serwerze

| Ścieżka | Skąd | Uwagi |
|---|---|---|
| `~/projects/fineapp/.env` | ręcznie, raz (§3) | `600`; poza repozytorium i poza workflow |
| `~/projects/fineapp/docker-compose.yml` | workflow, z `deploy/docker-compose.prod.yml` | nadpisywany przy każdym wdrożeniu |
| `~/projects/fineapp/scripts/{backup,restore,offsite}.sh` | workflow, z `scripts/` | jw. |
| `~/projects/fineapp/backups/` | `backup.sh` | kopia przed każdym wdrożeniem + cron; `backup.log` |
| `~/.config/restic/` | ręcznie, raz (§5.3) | `700`; hasło repozytorium i klucz B2 |

Compose ma stałą nazwę projektu `fineapp`, więc wolumen to zawsze
`fineapp_fineapp-data`, a `backup.sh` / `restore.sh` działają bez zmian (§5).
Obraz w compose to lokalny znacznik `ghcr.io/dav9951/fineapp:deployed` z
`pull_policy: never` — `restore.sh` i ręczne `docker compose up` uruchamiają dokładnie
wdrożoną wersję.

### 12.3 GitHub Actions

| Workflow | Kiedy | Co |
|---|---|---|
| `ci.yml` | każdy PR (i ręcznie); na `main` wołany z `deploy-prod.yml` | `typecheck` · `lint` · `format:check` · `test` + budowa obrazu bez wypychania |
| `deploy-prod.yml` | push na `main`, ręcznie | CI → obraz do GHCR (`:<sha>`, `:latest`) → scp plików z §12.2 → ssh: kopia, `pull`, `up -d`, czekanie na `healthy` |

Push na `main` **wdraża tylko wtedy**, gdy zmienna repozytorium `AUTO_DEPLOY` = `true`
(Settings → Secrets and variables → Actions → Variables). Bez niej `main` przechodzi
samo CI, a wdrożenie uruchamia się ręcznie (Actions → Deploy to Production → Run workflow).

Sekrety repozytorium: `HOST`, `USERNAME`, `SSH_PRIVATE_KEY` — klucz używany wyłącznie
przez ten workflow, w `~/.ssh/authorized_keys` z opcjami `no-port-forwarding,
no-agent-forwarding,no-X11-forwarding`. Pobranie obrazu na serwerze idzie jednorazowym
`GITHUB_TOKEN`-em joba w tymczasowej konfiguracji Dockera — serwer nie trzyma tokenu
do GHCR, a istniejące logowanie innych serwisów zostaje nietknięte.

### 12.4 Wdrożenie, aktualizacja, wycofanie

- **Wdrożenie / aktualizacja** — merge do `main` (przy `AUTO_DEPLOY=true`) albo ręczne
  uruchomienie. Kolejność na serwerze: kopia bazy (gdy aplikacja działa) → `pull` →
  `up -d` (entrypoint robi migracje z migawką `pre-migration-*`) → `healthy` albo błąd
  joba z logami kontenera → `nginx -t && nginx -s reload` w kontenerze bramy (ADR-080) →
  sprawdzenie `https://budzet.example.pl/api/v1/health` przez bramę (do 6 prób; brak
  odpowiedzi = błąd joba).
- **Wycofanie** — Run workflow z `image_tag` = pełny SHA wcześniejszego commita. Bez
  testów i bez budowy; obraz jest już w GHCR. Po migracji — dodatkowo `restore.sh`
  z kopii sprzed wdrożenia (§5.4).
- Dwa wdrożenia nigdy nie idą równolegle (`concurrency`), trwające nie jest przerywane.

### 12.5 Pierwsze uruchomienie

1. `.env` wg §3 z `APP_URL=https://budzet.example.pl`, `chmod 600`.
2. Sekrety `HOST`, `USERNAME`, `SSH_PRIVATE_KEY` w repozytorium.
3. Ręczne uruchomienie `deploy-prod.yml` → kontener `fineapp-app` zdrowy w `gateway-net`.
4. **Dopiero teraz** domena w bramie — `DOMAINS` w `~/projects/gateway/docker-compose.yml`:
   `budzet.example.pl -> http://fineapp-app:3000, www.budzet.example.pl => https://budzet.example.pl`,
   potem `docker compose up -d` w katalogu bramy. Kolejność ma znaczenie: nginx
   odmawia startu, gdy nie rozwiąże nazwy hosta z `proxy_pass` — domena dopisana przed
   kontenerem wyłączyłaby **wszystkie** serwisy za bramą. Odtworzenie bramy to kilka
   sekund przerwy dla wszystkich.
5. Użytkownicy: `docker compose exec app node dist/scripts/create-user.js --email … --name …`
   w `~/projects/fineapp` (PIN wypisany raz).
6. `F8-8`: `scripts/backup.sh` ręcznie, `scripts/restore.sh` na tej kopii, cron
   z `BACKUP_DIR=$HOME/projects/fineapp/backups`, kopia poza serwerem (§5.3).
7. Gdy wszystko działa — `AUTO_DEPLOY=true`.

### 12.6 Kopie na produkcji

Cron użytkownika `fineapp`:

```
30 3 * * * BACKUP_DIR=/home/fineapp/projects/fineapp/backups /home/fineapp/projects/fineapp/scripts/backup.sh >> /home/fineapp/projects/fineapp/backups/backup.log 2>&1 && /home/fineapp/projects/fineapp/scripts/offsite.sh >> /home/fineapp/projects/fineapp/backups/backup.log 2>&1
```

`&&` — do B2 idzie wyłącznie kopia, którą `backup.sh` sprawdził (`integrity_check`).
Stan: `tail backups/backup.log`; lista migawek poza serwerem — `restic snapshots` z
wczytanym `fineapp-b2.env`. `F8-8` przećwiczone na VPS 2026-09-28: `restore.sh` (5 s
przerwy, baza identyczna z kopią) i odtworzenie z B2 (plik bajt w bajt zgodny z lokalnym,
`integrity_check` ok). Baza była wtedy prawie pusta — **powtórzyć po miesiącu danych**
i dalej raz na kwartał.

### 12.7 Brama: każdy restart odnawia certyfikaty — i może się zapętlić

https-portal przy **każdym** starcie odnawia certyfikaty wygasające w ciągu 30 dni,
a nieudane wyzwanie ACME kończy start kontenera błędem. Z `restart: always` brama wpada
w pętlę i znikają **wszystkie** serwisy na VPS. Wydarzyło się przy dopisaniu
`budzet.example.pl`: `inna.example.pl` miał DNS przeniesiony na inny serwer,
więc odnowienie nie mogło przejść; wpis usunięty z `DOMAINS` za zgodą właściciela.

Przed każdą zmianą `DOMAINS` (i każdym `docker compose up -d` bramy):

```bash
for h in $(docker inspect gateway-https-portal-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^DOMAINS=//p' | tr ',' '\n' | awk '{print $1}'); do printf '%-32s %s\n' "$h" "$(dig +short A "$h" | tail -1)"; done
```

Każdy host musi wskazywać adres VPS (`<adres IP serwera>`). Kopię `docker-compose.yml`
bramy zapisywać jako `docker-compose.yml.bak-RRRRMMDD-HHMMSS` przed edycją.
