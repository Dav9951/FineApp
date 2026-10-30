# 09 — Bezpieczeństwo i uwierzytelnianie

## 1. Kontekst i model zagrożeń

Aplikacja prywatna, dwóch użytkowników, własny VPS, brak rejestracji. Dane są wrażliwe
(pełny obraz finansów gospodarstwa), ale krąg zaufania jest mały i ustalony.

| Zagrożenie | Realność | Odpowiedź |
|---|---|---|
| Zgadywanie PIN-u z internetu | **wysoka** — endpoint publiczny, PIN ma 6 cyfr | limit prób, blokada wykładnicza, argon2id |
| Przechwycenie sesji | średnia | cookie `httpOnly` + `Secure` + `SameSite`, krótki access token |
| CSRF | średnia | `SameSite=Lax` + nagłówek niestandardowy + wąska ścieżka cookie |
| XSS | średnia | React escapuje domyślnie, CSP, brak `dangerouslySetInnerHTML` |
| Wyciek pliku bazy | niska, ale katastrofalna | plik poza katalogiem serwowanym, kopie szyfrowane |
| Wyciek zdjęć paragonów | niska | katalog nieserwowany statycznie, dostęp tylko uwierzytelniony |
| Wyciek danych do AI | średnia | wysyłamy wyłącznie obraz + nazwy kategorii, EXIF usuwany |
| Złośliwy upload | niska | walidacja typu po zawartości, przetwarzanie przez sharp, brak wykonywania |
| Podniesienie uprawnień | **brak znaczenia** | obaj użytkownicy mają identyczny dostęp |

**Czego świadomie nie robimy:** 2FA, resetu PIN-u przez e-mail, polityki złożoności haseł,
szyfrowania bazy w spoczynku (SQLCipher), audytu każdej operacji. Przy dwóch osobach
i jednym serwerze koszt utrzymania przewyższa realną redukcję ryzyka. Każda z tych
pozycji jest odnotowana jako możliwe rozszerzenie w [11-roadmap.md](./11-roadmap.md).

## 2. Uwierzytelnianie e-mailem i PIN-em

### 2.1 Dlaczego PIN jest ryzykowny i co z tym robimy

Sześciocyfrowy PIN to milion kombinacji. Bez zabezpieczeń zautomatyzowany atak
przechodzi go w minuty. Stąd **trzy niezależne warstwy**:

1. **argon2id** — sam sprawdzian jednego PIN-u kosztuje ~50 ms i 64 MB pamięci.
2. **Limit prób z blokadą wykładniczą** — po 5 nieudanych próbach konto jest zablokowane
   na 15 minut, przy kolejnych seriach blokada rośnie.
3. **Limit na adres IP** — niezależny od adresu e-mail, chroni przed zgadywaniem
   po wielu kontach naraz.

Przy tej konfiguracji atak słownikowy na cały zakres PIN-ów zajmuje lata.

### 2.2 Parametry argon2id

```ts
/**
 * Parametry haszowania PIN-u.
 *
 * Dobrane tak, by pojedyncze sprawdzenie zajmowało ~50–100 ms na typowym VPS.
 * Przy krótkim sekrecie (6 cyfr) koszt funkcji skrótu jest główną barierą dla atakującego,
 * więc nie obniżamy go „dla wygody" — jedno logowanie dziennie może kosztować 100 ms.
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,   // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;
```

Parametry warto zweryfikować na docelowym VPS przy wdrożeniu — na słabszej maszynie
64 MiB × równoległe logowania może być odczuwalne. Wynik pomiaru → [14](./14-decisions-log.md).

**Punkt odniesienia (kontener deweloperski):** haszowanie **156 ms**, weryfikacja
**160 ms** (średnia z dziesięciu przebiegów). To powyżej docelowych 50–100 ms, ale kontener
deweloperski nie jest maszyną docelową — pomiar na VPS jest nadal wymagany przed wdrożeniem
(obserwacja `Z-2`). Gdyby na VPS wyszło podobnie, obniżamy `timeCost`, **nie** `memoryCost`:
to pamięć jest tym, co blokuje zrównoleglenie na kartach graficznych.

**Pomiar na VPS (`F8-9`):** AMD EPYC, 4 vCPU, w kontenerze produkcyjnym przez
`hashPin`/`verifyPin` — haszowanie **177 ms**, weryfikacja **171 ms** (średnia z dziesięciu).
**Parametry zostają bez zmian** (t=3) — decyzja właściciela,
[ADR-066](./14-decisions-log.md#adr-066): logowanie zdarza się raz na urządzenie na 30 dni,
~175 ms jest niezauważalne, a dwóch użytkowników nie obciąży procesora; wyższy koszt
chroni krótki PIN przy wycieku bazy.

### 2.3 Wymagania wobec PIN-u

- Długość 6–8 cyfr (konfigurowalne przez `PIN_MIN_LENGTH` / `PIN_MAX_LENGTH`).
- Odrzucane: same identyczne cyfry (`111111`), ciągi rosnące i malejące (`123456`,
  `654321`), oraz lista 20 najpopularniejszych PIN-ów. Walidacja przy zakładaniu
  i zmianie, nie przy logowaniu.
- Bez wymuszanej rotacji — rotacja krótkich sekretów pogarsza bezpieczeństwo,
  bo skłania do zapisywania ich w oczywistych miejscach.

### 2.4 Przepływ logowania

```
POST /auth/login { email, pin, deviceLabel }
  │
  ├─ 1. normalizacja: email.trim().toLowerCase()
  ├─ 2. sprawdzenie limitu (email + IP) → 429 gdy przekroczony
  ├─ 3. odczyt użytkownika
  ├─ 4. weryfikacja argon2id
  │      ↳ gdy użytkownika nie ma: i tak wykonaj porównanie z atrapą hasha
  │        (ochrona przed rozpoznaniem istniejących kont po czasie odpowiedzi)
  ├─ 5. zapis próby w auth_attempts (hash e-maila, nigdy jawny)
  │
  ├─ sukces:
  │    • utworzenie auth_sessions (opaque refresh token, 256 bitów losowości)
  │    • cookie fineapp_rt = <token>  (httpOnly, Secure, SameSite=Lax, Path=/api/v1/auth)
  │    • JWT access token (15 min) w ciele odpowiedzi
  │    • aktualizacja users.last_login_at
  │
  └─ porażka: 401 z JEDNAKOWYM komunikatem, niezależnie od przyczyny
```

Krok 4 („porównaj z atrapą, gdy użytkownika nie ma") jest istotny: bez niego odpowiedź
dla nieistniejącego adresu wracałaby natychmiast, a dla istniejącego po 50 ms —
co pozwala wyliczyć, które konta istnieją.

### 2.5 Limitowanie prób

```ts
/**
 * Sprawdza, czy wolno podjąć próbę logowania.
 *
 * Okno liczone jest osobno dla adresu e-mail i dla adresu IP, żeby atak rozproszony
 * po wielu kontach z jednego adresu również został zatrzymany.
 *
 * @param emailHash - Hash znormalizowanego adresu.
 * @param ipHash - Hash adresu IP.
 * @returns Zgoda albo liczba sekund do odblokowania.
 */
export function checkLoginAllowed(emailHash: string, ipHash: string): LoginGate;
```

| Zakres | Próg | Blokada |
|---|---|---|
| e-mail | 5 nieudanych / 15 min | 15 min |
| e-mail | 10 nieudanych / 1 h | 1 h |
| e-mail | 20 nieudanych / 24 h | 24 h |
| IP | 20 nieudanych / 15 min | 15 min |

Udane logowanie **nie kasuje** historii prób — kasuje jedynie bieżącą blokadę. Dzięki
temu atakujący, który trafi jeden PIN, nie zeruje sobie licznika dla drugiego konta.

Odpowiedź `429` zawiera `details.retryAfterSeconds`, żeby UI mógł pokazać odliczanie
zamiast bezużytecznego „spróbuj później".

## 3. Sesje i tokeny

### 3.1 Podział ról

| Token | Postać | Ważność | Gdzie | Po co |
|---|---|---|---|---|
| Access | JWT (HS256) | 15 min | pamięć JS, nagłówek `Authorization` | autoryzacja żądań |
| Refresh | losowe 256 bitów (opaque) | 30 dni | cookie `httpOnly` | odnowienie access tokenu |

**Access jest JWT**, bo weryfikacja bez zapytania do bazy jest tania i wystarczy przy
15-minutowej ważności. **Refresh jest nieprzezroczysty i trzymany w bazie**, bo musi
dać się unieważnić natychmiast — JWT tego nie potrafi.

Access token świadomie **nie jest** w `localStorage`: trzymamy go w pamięci aplikacji,
co eliminuje najczęstszy wektor kradzieży przy XSS. Po odświeżeniu strony jest odtwarzany
z cookie refresh, więc dla użytkownika nic się nie zmienia.

### 3.2 Zawartość access tokenu

```jsonc
{
  "sub": "01JB...",          // id użytkownika
  "hid": "01JA...",          // id gospodarstwa — zakres WSZYSTKICH zapytań
  "sid": "01JZ...",          // id sesji, do powiązania z auth_sessions
  "iat": 1790000000,
  "exp": 1790000900,
  "iss": "fineapp",
  "aud": "fineapp-web"
}
```

`hid` w tokenie to podstawa izolacji danych: **`householdId` nigdy nie pochodzi z żądania**.
Nawet gdyby klient przysłał je w ciele, jest ignorowane.

### 3.3 Rotacja refresh tokenów

```
POST /auth/refresh  (cookie fineapp_rt)
  │
  ├─ hash tokenu → wyszukanie sesji
  ├─ odrzuć gdy: brak, wygasła, unieważniona
  ├─ WYGENERUJ NOWY refresh token, stary unieważnij (rotacja)
  ├─ wykrycie ponownego użycia: token już unieważniony
  │    ↳ unieważnij WSZYSTKIE sesje użytkownika i zaloguj zdarzenie
  └─ zwróć nowy access token + ustaw nowe cookie
```

Rotacja z wykrywaniem ponownego użycia to standardowa ochrona przed kradzieżą cookie:
gdy dwa urządzenia użyją tego samego tokenu, znaczy że jedno jest atakującym — wylogowujemy
wszystkich i użytkownik musi się zalogować ponownie.

**Okno tolerancji: 10 sekund.** Każde wejście na stronę odtwarza sesję jednym
`POST /auth/refresh`, więc **dwie karty otwarte naraz wysyłają dwa żądania z tym samym
ciasteczkiem** — bez tego okna zwykłe „otwórz w nowej karcie" wylogowywałoby ze wszystkich
urządzeń. Dlatego ponowne użycie tokenu unieważnionego **mniej niż 10 sekund temu**,
gdy rodzina ma nadal żywy wiersz, jest traktowane jako wyścig, a nie kradzież: spóźniona
karta dostaje **sam access token**, bez rotacji i bez nowego ciasteczka. Zwycięzca
wyścigu zdążył już podmienić ciasteczko, które jest wspólne dla całej przeglądarki.

Cena jest policzalna: napastnik, który odtworzy token w ciągu tych dziesięciu sekund
od prawowitego użycia, nie zostanie wykryty. Po dziesięciu sekundach — zostanie.
Skradzione ciasteczko jest wykorzystywane w godzinach, nie w sekundach, więc wymiana
jest korzystna.

### 3.4 Parametry cookie

```ts
/**
 * Konfiguracja cookie z tokenem odświeżającym.
 *
 * `path` zawężony do `/api/v1/auth`, żeby cookie nie było dołączane do żadnego innego
 * żądania — zmniejsza to powierzchnię ataku i wielkość każdego zapytania.
 */
export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.COOKIE_SECURE,       // true w produkcji (HTTPS)
  sameSite: 'lax' as const,
  path: '/api/v1/auth',
  maxAge: config.REFRESH_TOKEN_TTL_SECONDS,
  domain: config.COOKIE_DOMAIN || undefined,
};
```

`SameSite=Lax`, nie `Strict` — `Strict` psuje wejście z linku wysłanego przez komunikator,
co przy dwóch osobach w domu zdarza się regularnie.

### 3.5 Zarządzanie sesjami

`GET /auth/sessions` pokazuje aktywne urządzenia (etykieta, ostatnie użycie, przybliżona
lokalizacja z hasha IP — czyli tylko „to samo/inne urządzenie"). `DELETE /auth/sessions/:id`
unieważnia wskazaną sesję, `POST /auth/logout-all` wszystkie. Zmiana PIN-u unieważnia
wszystkie sesje poza bieżącą.

**Operacje nieodwracalne wymagają PIN-u, nie tylko tokenu.** Zmiana PIN-u i usunięcie
wszystkich danych (`POST /settings/reset`, [ADR-072](./14-decisions-log.md#adr-072))
sprawdzają PIN zalogowanej osoby — wykradziony token nie wystarczy, żeby odciąć
właściciela ani skasować finanse domu.

## 4. Autoryzacja

Jedna reguła: **każde żądanie poza `/auth/login`, `/auth/refresh` i `/health` wymaga
ważnego access tokenu.**

```ts
/**
 * Middleware wymagające uwierzytelnienia i ustawiające kontekst żądania.
 *
 * Po jego wykonaniu `request.auth` zawiera identyfikatory użytkownika i gospodarstwa.
 * Każde repozytorium przyjmuje `householdId` jako pierwszy argument — brak tego
 * parametru w zapytaniu jest błędem wyłapywanym na przeglądzie kodu.
 *
 * @param request - Żądanie Fastify.
 * @throws {UnauthorizedError} Gdy brak tokenu lub token jest nieważny.
 */
export async function requireAuth(request: FastifyRequest): Promise<void>;
```

Brak ról, brak uprawnień per zasób. Zakres danych wynika wyłącznie z `hid` w tokenie.
Zasób należący do innego gospodarstwa zwraca `404`, nie `403` — nie potwierdzamy
istnienia cudzych danych.

## 5. Ochrona CSRF

Trzy warstwy:

1. `SameSite=Lax` — przeglądarka nie wyśle cookie przy żądaniu z obcej strony metodą POST.
2. **Nagłówek niestandardowy** — API wymaga `X-Requested-With: fineapp` przy metodach
   zmieniających stan. Prosty formularz z obcej strony nie może go ustawić bez CORS.
3. **Wąska ścieżka cookie** — refresh token jest dołączany wyłącznie do `/api/v1/auth`,
   a te endpointy nie zmieniają danych finansowych.

Klasyczny token CSRF byłby czwartą warstwą; przy powyższych uznajemy go za zbędny.

## 6. Nagłówki bezpieczeństwa

`@fastify/helmet` z jawną polityką CSP:

```ts
/**
 * Polityka bezpieczeństwa treści.
 *
 * `connect-src` ogranicza się do własnego pochodzenia — front nie odwołuje się nigdzie
 * indziej. Wywołania do Anthropic wychodzą z backendu, nie z przeglądarki, co jest
 * jednym z powodów, dla których klucz API nigdy nie trafia do klienta.
 */
export const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],  // wymagane przez style inline Tailwinda
  imgSrc: ["'self'", 'data:', 'blob:'],     // podgląd zdjęcia przed wysyłką
  connectSrc: ["'self'"],
  fontSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
};
```

Dodatkowo: `Strict-Transport-Security` (gdy HTTPS), `X-Content-Type-Options: nosniff`,
`Referrer-Policy: same-origin`, `X-Frame-Options: DENY`.

## 7. Bezpieczeństwo uploadów

| Kontrola | Realizacja |
|---|---|
| Rozmiar | limit `@fastify/multipart` = `UPLOAD_MAX_BYTES` (10 MB), przerwanie strumienia |
| Typ | sprawdzenie **magic bytes**, nie nagłówka `Content-Type` ani rozszerzenia |
| Nazwa pliku | ignorowana; plik zapisywany pod wygenerowanym ULID-em |
| Ścieżka | budowana z ULID-a i daty — nie ma możliwości przejścia katalogu |
| Zawartość | przepuszczana przez `sharp` (re-enkodowanie) — usuwa dołączone dane |
| Wykonywanie | katalog uploadów nigdy nie jest serwowany statycznie |
| Dostęp | wyłącznie `GET /documents/:id/file` z weryfikacją gospodarstwa |
| EXIF | usuwany przed analizą i przed zapisem (w tym GPS) |

## 8. Prywatność danych

- **Brak telemetrii.** Żadnych analytics, żadnego raportowania błędów na zewnątrz.
- **Jedyne wywołanie zewnętrzne** to Anthropic API przy analizie dokumentu, wyłącznie
  po jawnym wrzuceniu pliku. Zakres wysyłanych danych: [08 §13](./08-ocr-ai-pipeline.md#13-prywatność).
- **Logi nie zawierają danych finansowych.** Logujemy metodę, ścieżkę, status, czas,
  `requestId`, id użytkownika. Nie logujemy ciał żądań ani odpowiedzi.
- **Adresy e-mail i IP w tabelach audytowych są haszowane** z solą `IP_HASH_SALT`.

## 9. Zarządzanie sekretami

| Sekret | Gdzie | Rotacja |
|---|---|---|
| `JWT_SECRET` | `.env` na VPS, uprawnienia `600` | ręcznie; wymusza wylogowanie wszystkich |
| `IP_HASH_SALT` | jw. | nie rotujemy (unieważniłoby historię audytu) |
| `ANTHROPIC_API_KEY` | jw. | wg potrzeby, przez panel Anthropic |
| PIN-y użytkowników | wyłącznie jako hash argon2id | na żądanie użytkownika |

`.env` **nigdy** nie trafia do repozytorium ani do obrazu Dockera (`.dockerignore`).
Aplikacja odmawia startu, gdy `JWT_SECRET` jest pusty, krótszy niż 32 znaki lub równy
wartości przykładowej — sprawdzane w `core/config.ts` przy uruchomieniu.

## 10. Zakładanie użytkowników

Brak rejestracji. Skrypt CLI:

```bash
pnpm --filter @fineapp/api user:create -- --email ja@example.com --name "Adam"
```

Skrypt generuje losowy PIN, wypisuje go **raz** na standardowe wyjście i zapisuje
wyłącznie hash. Pierwsze uruchomienie tworzy też gospodarstwo i kategorie domyślne.

Limit: **maksymalnie dwóch aktywnych użytkowników**, wymuszany w serwisie. To nie jest
ograniczenie techniczne, tylko jawna decyzja produktowa — zapisana, żeby nikt jej
przypadkiem nie obszedł.

## 11. Lista kontrolna przed wdrożeniem

Stan wdrożenia referencyjnego po przejściu listy na VPS (2026-09-28):

- [x] `JWT_SECRET` wygenerowany (`openssl rand -base64 48`), nie domyślny
- [x] `IP_HASH_SALT` ustawiony
- [x] `COOKIE_SECURE=true`
- [x] `APP_URL` wskazuje na produkcyjny adres HTTPS (`https://budzet.example.pl`)
- [x] `NODE_ENV=production`
- [x] Port 3000 **nie jest wystawiony na hoście wcale** — tylko sieć bramy `gateway-net`,
      TLS na bramie https-portal (ostrzej niż `127.0.0.1`, [ADR-065](./14-decisions-log.md#adr-065))
- [x] `.env` z uprawnieniami `600`, właściciel — użytkownik uruchamiający kontener
- [x] Wolumen `/data` objęty kopią zapasową, kopie poza serwerem szyfrowane (restic → B2, 10 §5.3)
- [x] Parametry argon2id zmierzone na docelowej maszynie — 177 / 171 ms, zostają (§2.2)
- [x] Przetestowane: blokada po 5 próbach — **na produkcji** przez bramę (`401` × 5,
      szósta `429`, `retryAfterSeconds: 900`); rotacja i wykrycie ponownego użycia — testy
      `auth.refresh.test` (na produkcji wymagałyby prawdziwego PIN-u)
- [x] Sprawdzone, że `/data/uploads` nie jest dostępny bez uwierzytelnienia — na produkcji
      `/uploads/…`, `/data/…`, `/.env` → `404`; `/documents/:id/file`, eksport → `401`

**Przegląd przed wdrożeniem (`F8-9`).** Co pilnuje kod, a co zostaje do
odhaczenia na VPS:

| Punkt | Stan |
|---|---|
| `JWT_SECRET`, `IP_HASH_SALT` | **wymusza konfiguracja** — pusty, za krótki albo przykładowy → odmowa startu (`config.test`) |
| `COOKIE_SECURE=true`, `APP_URL` po HTTPS | **wymusza konfiguracja** w produkcji — HTTPS dołożone w `F8-9` ([ADR-062](./14-decisions-log.md#adr-062)) |
| `NODE_ENV=production`, port tylko na `127.0.0.1` | ustawia `docker-compose.yml` — sprawdzić po wdrożeniu (`ss -tlnp`) |
| `.env` z `600` | właściciel, przy wdrożeniu; kopie z `scripts/backup.sh` dostają `600` same |
| Kopie szyfrowane poza serwerem | właściciel — `restic`/`rclone` (10 §5.3) |
| argon2id na docelowej maszynie | właściciel — `Z-2` |
| Blokada po 5 próbach, rotacja, wykrycie ponownego użycia | **testy** `auth.hardening.test`, `auth.refresh.test`, `auth.attempts.test` |
| `/data/uploads` bez uwierzytelnienia | **test** `spa.test`: statyczny katalog to wyłącznie `WEB_DIST_PATH`; `/uploads/…`, `/data/…`, `/.env` → `404`, wyjście poza katalog → powłoka SPA; plik dokumentu tylko przez `GET /documents/:id/file` z tokenem |
| Eksport | tylko z tokenem, `Cache-Control: no-store`; CSV neutralizuje formuły (`= + - @`) apostrofem — opis z paragonu nie wykona się w arkuszu |

Mapy źródeł (`Z-45`) — potwierdzone na produkcji (1,1 MB kodu frontu pod `/assets/*.map`),
**wyłączone** (`build.sourcemap: false`, [ADR-066](./14-decisions-log.md#adr-066)).
Kompresja (`Z-27`) — brama odpowiada `Content-Encoding: gzip`, `@fastify/compress` zbędny.
Adres IP klienta dociera do aplikacji (`X-Forwarded-For` z bramy, `trustProxy`) — w logach
adresy klientów, nie adres bramy.
