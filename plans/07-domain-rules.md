# 07 — Reguły domenowe

Dokument opisuje **obliczenia i reguły decydujące o poprawności aplikacji**. Każda reguła
z tego pliku musi mieć test jednostkowy. Jeśli implementacja odbiega od opisu — to opis
jest wiążący, a zmianę trzeba tu wprowadzić świadomie.

---

## 1. Czas i miesiąc budżetowy

### 1.1 Trzy różne pojęcia czasu

| Pojęcie | Typ | Przykład | Zastosowanie |
|---|---|---|---|
| Data biznesowa | `TEXT YYYY-MM-DD` | `2026-09-18` | kiedy poniesiono wydatek |
| Klucz miesiąca | `TEXT YYYY-MM` | `2026-09` | do którego miesiąca należy |
| Znacznik systemowy | `INTEGER` epoch ms UTC | `1789660800000` | kiedy powstał rekord |

Data biznesowa **nie ma strefy czasowej**. Wydatek z 31 sierpnia należy do sierpnia
niezależnie od tego, gdzie stoi serwer i o której zapisano rekord. Konwersja
`Date` → data biznesowa odbywa się **zawsze** w strefie gospodarstwa
(`households.timezone`, domyślnie `Europe/Warsaw`).

```ts
/**
 * Zwraca dzisiejszą datę biznesową w strefie gospodarstwa.
 *
 * Nie wolno tu użyć `new Date().toISOString().slice(0, 10)` — dla Warszawy
 * dałoby to poprzedni dzień między 00:00 a 02:00 czasu lokalnego latem.
 *
 * @param timezone - Strefa gospodarstwa, np. `Europe/Warsaw`.
 * @param now - Chwila odniesienia (wstrzykiwany zegar).
 * @returns Data w formacie `YYYY-MM-DD`.
 */
export function todayInTimezone(timezone: string, now: Date): string;
```

### 1.2 Wyznaczanie miesiąca

Przy `monthStartDay = 1` (domyślnie):

```
monthKey = bookedOn.slice(0, 7)
```

Przy `monthStartDay = D > 1` miesiąc budżetowy biegnie od dnia `D` do dnia `D − 1`
następnego miesiąca i **nazywa się od miesiąca, w którym się zaczyna**:

```ts
/**
 * Wyznacza klucz miesiąca budżetowego dla daty.
 *
 * Przy `monthStartDay = 26` data 2026-09-28 należy do miesiąca `2026-09`
 * (okres 26.09 – 25.10), a data 2026-09-20 do miesiąca `2026-08`.
 *
 * @param bookedOn - Data biznesowa `YYYY-MM-DD`.
 * @param monthStartDay - Dzień rozpoczęcia miesiąca budżetowego (1–28).
 * @returns Klucz miesiąca `YYYY-MM`.
 */
export function monthKeyOf(bookedOn: string, monthStartDay = 1): MonthKey {
  const [year, month, day] = parseParts(bookedOn);
  if (monthStartDay === 1 || day >= monthStartDay) {
    return `${year}-${pad(month)}`;
  }
  return shiftMonth(`${year}-${pad(month)}`, -1);
}
```

`month_key` jest wyliczany **przy zapisie** i przechowywany w kolumnie. Zmiana
`monthStartDay` wymaga migracji przeliczającej wszystkie wiersze — dlatego ustawienie
jest opisane w UI jako „zmiana wpływa na historię".

> **Uwaga wdrożeniowa:** w v1 implementujemy wyłącznie `monthStartDay = 1`. Kolumna
> i funkcja przyjmują parametr, ale ścieżka `> 1` zostaje wyłączona w UI do Fazy 6.
> Powód: przeliczanie historii to osobny, nietrywialny temat, a wartość dla użytkownika
> jest niewielka. Patrz ADR-006 oraz [11](./11-roadmap.md), sekcja „Po v1 — rozważane".

### 1.3 Księgowanie wstecz (wymaganie #12)

```ts
/**
 * Najwcześniejsza data, na którą wolno zaksięgować transakcję.
 *
 * Liczona jako początek miesiąca sprzed `backPostingLimitMonths` miesięcy — czyli
 * przy limicie 1 przez cały wrzesień wolno księgować od 1 sierpnia, a nie „30 dni wstecz".
 * Taka definicja odpowiada temu, jak ludzie myślą o domykaniu poprzedniego miesiąca.
 *
 * @param today - Dzisiejsza data biznesowa.
 * @param limitMonths - Limit z ustawień gospodarstwa (0 = tylko bieżący miesiąc).
 * @returns Najwcześniejsza dozwolona data `YYYY-MM-DD`.
 */
export function earliestPostableDate(today: string, limitMonths: number): string {
  const currentMonth = today.slice(0, 7);
  return `${shiftMonth(currentMonth, -limitMonths)}-01`;
}
```

Granica górna: **koniec bieżącego miesiąca**. Transakcji w przyszłości nie księgujemy —
od tego są pozycje cykliczne. Wyjątek: wystąpienie cykliczne z `autoPost` może powstać
w dniu swojego terminu, nigdy wcześniej.

Naruszenie → `422 DOMAIN_RULE_VIOLATION` z komunikatem
„Nie można księgować przed 1 sierpnia 2026. Zmień limit w ustawieniach.".

Doprecyzowania z `F2-5` ([ADR-035](./14-decisions-log.md#adr-035)):

- Górną granicę liczy `latestPostableDate(today, monthStartDay)` w `shared` — ostatni
  dzień bieżącego miesiąca budżetowego. Przekroczenie: „Nie można księgować po
  30 września 2026 — przyszłe płatności zaplanuj jako pozycję cykliczną.".
- „Dziś" w strefie gospodarstwa: o 00:30 1 października w Warszawie (22:30 UTC) okno
  przy limicie 1 to już 1 września – 31 października.
- Okno sprawdzamy przy **zapisie daty** — nowej transakcji i zmianie `bookedOn`.
  Transakcje, które już leżą przed oknem, opisuje §1.4.

### 1.4 Zamknięte miesiące

Miesiąc sprzed okna księgowania jest **zamknięty** (`F3-3`, [ADR-040](./14-decisions-log.md#adr-040)).
Jego liczby są zamrożone — inaczej limit chroniłby tylko przed dopisaniem, a nie przed
zmianą kwoty czy usunięciem wydatku z marca, co zmienia raport marca tak samo.

| Operacja na transakcji z zamkniętego miesiąca | Wynik |
|---|---|
| zmiana `description`, `merchant`, `notes` | dozwolona — opis nie zmienia żadnej liczby |
| zmiana każdego innego pola (kwota, data, konta, kategoria, źródło, cel, zobowiązanie, nadpisanie alokacji) | `422`, `details` wskazuje zablokowane pola, nic nie jest zapisywane |
| przeniesienie daty **do** okna | `422` — zmienia zamknięty miesiąc, z którego transakcja znika |
| usunięcie, przywrócenie z kosza | `422` |

```ts
isInClosedMonth(bookedOn, today, limitMonths) = bookedOn < earliestPostableDate(today, limitMonths)
```

Granica jest ta sama co dolna granica okna (§1.3) — jedna reguła z dwóch stron: czego nie
wolno dopisać, tego nie wolno też zmienić. Wyjście jest to samo: podniesienie limitu
w ustawieniach otwiera miesiąc z powrotem. Funkcja żyje w `shared/domain/closed-month.ts`:
serwis odpowiada `422`, formularz od razu pokazuje liczby tylko do odczytu.
Komunikat: „Transakcja należy do zamkniętego miesiąca — można poprawić tylko opis,
sprzedawcę i notatki. Zmiany są możliwe od 1 sierpnia 2026 — zmień limit w ustawieniach."

---

## 2. Alokacje i realizacja celów procentowych

Najważniejsza mechanika aplikacji (wymaganie #8). Ustala, **co liczy się jako odkładanie**.

### 2.1 Klasyfikacja kont

`allocationClass` konta wynika domyślnie z typu:

| `type` | domyślna `allocationClass` |
|---|---|
| `checking`, `cash` | `spending` |
| `savings` | `savings` |
| `investment` | `investment` |
| `other` | `spending` |

Użytkownik może to nadpisać — np. konto techniczne w banku używane wyłącznie jako
poduszka bezpieczeństwa dostaje klasę `savings` mimo typu `checking`.

**Zmiana typu istniejącego konta** (bez jawnie podanej klasy) przelicza klasę **tylko
wtedy, gdy nie była nadpisana**, czyli gdy równa się domyślnej dla dotychczasowego typu.
Nadpisanie jest świadomą decyzją i zmiana ikonki typu nie może go po cichu cofnąć;
klasa nieruszana podąża za typem, inaczej zmiana „bieżące → oszczędnościowe"
zostawiłaby konto poza pulą oszczędności. Historii to nie zmienia — transakcje niosą
migawkę klas (I-6). Implementacja: `allocationClassAfterTypeChange` w `shared`
([ADR-031](./14-decisions-log.md#adr-031)).

### 2.2 Wpływ przelewu na pule — ujęcie netto

Realizacja celu liczona jest **netto**: wpłaty na oszczędności minus wypłaty z nich
w tym samym miesiącu. Wpłacone 2 000 i wypłacone 1 500 daje wykonanie 500, nie 2 000
(ADR-011).

Dlatego transakcja **nie** przechowuje jednego „typu alokacji", tylko **migawkę klas
obu kont**. Z niej wyliczamy efekt, który może dotyczyć jednej puli, obu naraz albo żadnej.

```sql
source_allocation_class TEXT,   -- migawka klasy konta źródłowego  (tylko type='transfer')
target_allocation_class TEXT,   -- migawka klasy konta docelowego  (tylko type='transfer')
allocation_override     TEXT    -- NULL = wylicz z klas; 'none'|'savings'|'investment' = wymuś
```

Migawka, a nie odczyt bieżącej klasy konta, bo zmiana klasy konta w listopadzie nie może
przepisywać wyników z marca — to pozostaje w mocy z [ADR-005](./14-decisions-log.md#adr-005).

```ts
/**
 * Wylicza wpływ przelewu na pule celów procentowych.
 *
 * Zwraca listę, bo jeden przelew potrafi dotknąć dwóch pul naraz: przesunięcie
 * 5 000 zł z konta oszczędnościowego na maklerskie to jednocześnie −5 000 oszczędności
 * i +5 000 inwestycji. Przelew między kontami tej samej klasy daje listę pustą
 * (niezmiennik I-7) — inaczej dałoby się zawyżyć wykonanie, przelewając tam i z powrotem.
 *
 * @param tx - Transakcja z zapisanymi migawkami klas i ewentualnym nadpisaniem.
 * @returns Efekty alokacji; kwota dodatnia = wpłata do puli, ujemna = wypłata z niej.
 */
export function allocationEffects(tx: TransferSnapshot): AllocationEffect[] {
  if (tx.allocationOverride === 'none') return [];
  if (tx.allocationOverride) {
    return [{ kind: tx.allocationOverride, amountMinor: tx.amountMinor }];
  }

  const { sourceClass, targetClass, amountMinor } = tx;
  if (sourceClass === targetClass) return [];

  const effects: AllocationEffect[] = [];
  if (targetClass !== 'spending') effects.push({ kind: targetClass, amountMinor });
  if (sourceClass !== 'spending') effects.push({ kind: sourceClass, amountMinor: -amountMinor });
  return effects;
}
```

Tabela wszystkich przypadków:

| Z konta | Na konto | Efekt |
|---|---|---|
| bieżące | oszczędnościowe | oszczędności **+** |
| bieżące | inwestycyjne | inwestycje **+** |
| oszczędnościowe | bieżące | oszczędności **−** |
| inwestycyjne | bieżące | inwestycje **−** |
| oszczędnościowe | inwestycyjne | oszczędności **−**, inwestycje **+** |
| oszczędnościowe | oszczędnościowe | brak (przerzucenie w obrębie puli) |

**Zmiana konta w zapisanym przelewie** (`PATCH`) bierze migawkę klasy tej strony
z **nowego** konta; drugiej strony nie rusza. Stara migawka opisywała konto, którego
transakcja już nie dotyczy — zostawiona dawałaby efekt dla puli, do której pieniądze nie
trafiły. Zmiana klasy samego konta nadal niczego nie przelicza (I-6, ADR-035).

**Efekt w DTO.** `allocationEffects` każdej transakcji liczy jedna funkcja z `shared`
(`domain/allocation.ts`): przelew — jak wyżej, wydatek ze zobowiązaniem — `debt_repayment`
(§2.2a), pozostałe — lista pusta. Wynik nie jest przechowywany; filtr listy
`allocationKind` jest jej odpowiednikiem w SQL i test pilnuje zgodności obu.

**Nadpisanie przez użytkownika.** Pole `allocation_override` pozwala powiedzieć „ta konkretna
operacja nie jest odkładaniem" (`'none'`) albo wymusić zaliczenie przelewu, którego klasy kont
nie opisują (`'savings'` / `'investment'`). Wartość jest zapisywana, więc wynik pozostaje
deterministyczny.

W formularzu przelewu UI pokazuje wyliczony efekt jako plakietkę
(„Liczy się jako oszczędności +2 000,00" albo „Zmniejsza oszczędności o 1 500,00")
z możliwością wyłączenia — użytkownik widzi konsekwencję **zanim** zapisze.

### 2.2a Spłata zobowiązań

`debt_repayment` nie jest przelewem — zobowiązanie nie jest kontem. Wyliczamy je z wydatków
powiązanych ze zobowiązaniem:

```
effect('debt_repayment', M) = Σ amount WHERE type = 'expense'
                                AND liability_id IS NOT NULL
                                AND allocation_override IS DISTINCT FROM 'none'
```

Spłata długu nigdy nie jest ujemna — zaciągnięcie nowego zobowiązania to przychód,
nie ujemna rata.

### 2.3 Podstawa procentu

```ts
/**
 * Suma przychodów miesiąca stanowiąca podstawę celów procentowych.
 *
 * Wliczane są wyłącznie transakcje `income` o statusie `posted`, których źródło ma
 * `countsTowardAllocation = 1`. Dzięki temu jednorazowy zwrot podatku nie zaniża
 * wskaźnika „odłożyłem X% wpływów" w miesiącu, w którym wpłynął.
 * Przychody bez wskazanego źródła są wliczane (domyślnie liczą się).
 *
 * Podstawą jest kwota, która realnie wpłynęła: przychód z działalności rejestrujemy
 * netto, po podatku i ZUS (ADR-012). Dzięki temu „20% wpływów" odnosi się do pieniędzy,
 * którymi faktycznie da się dysponować, a nie do obrotu firmy.
 *
 * @param householdId - Identyfikator gospodarstwa.
 * @param month - Klucz miesiąca.
 * @returns Podstawa w groszach; 0 gdy brak przychodów.
 */
export function incomeBaseMinor(householdId: string, month: MonthKey): number;
```

Doprecyzowania z `F2-4` ([ADR-034](./14-decisions-log.md#adr-034)):

- Nowe źródło bez jawnej flagi dostaje `countsTowardAllocation` z rodzaju:
  `refund` → `false`, pozostałe → `true` (`defaultCountsTowardAllocation` w `shared`).
- Flaga **nie jest migawką** na transakcji: jej zmiana przelicza podstawę także za
  przeszłe miesiące. Flaga mówi, czym źródło jest (zwrot zawsze był zwrotem), więc
  poprawka ma działać wstecz — inaczej niż klasa konta (I-6), która opisuje decyzję
  z chwili przelewu.

### 2.4 Wykonanie

```
-- Suma efektów netto wszystkich przelewów miesiąca dotykających danej puli.
actual(kind, M)   = Σ allocationEffects(tx).amountMinor
                    FOR tx WHERE month_key = M
                      AND type = 'transfer'
                      AND status = 'posted'
                      AND deleted_at IS NULL
                    ONLY effects WHERE effect.kind = kind

target(kind, M)   = fromBps(targetBps(kind, M), incomeBase(M))

actualBps(kind,M) = toBps(actual(kind, M), incomeBase(M))

delta(kind, M)    = actual(kind, M) − target(kind, M)

fulfillment(kind) = toBps(actual(kind, M), target(kind, M))     // 10000 = plan wykonany
```

`targetBps` pochodzi z wiersza `allocation_targets` o największym
`effective_from_month <= M`. Brak wiersza → cel 0%.

### 2.5 Status linii

Miesiąc w trakcie wymaga innej oceny niż miesiąc zamknięty — inaczej 5 września
wszystko byłoby „poniżej planu".

```ts
/**
 * Ocenia realizację pojedynczej linii rozkładu.
 *
 * W trwającym miesiącu plan jest skalowany proporcjonalnie do upływu dni, więc
 * „jestem na dobrej drodze" oznacza wykonanie proporcjonalne do części miesiąca,
 * która już minęła. W miesiącu zamkniętym liczy się wyłącznie pełne wykonanie.
 *
 * @param actualMinor - Wykonanie netto; może być ujemne, gdy wypłaty przewyższyły wpłaty.
 * @param targetMinor - Kwota planowana na cały miesiąc.
 * @param progress - Udział upływu miesiąca (0–1); 1 dla miesięcy zamkniętych.
 * @returns Status linii.
 */
export function allocationLineStatus(
  actualMinor: number,
  targetMinor: number,
  progress: number,
): AllocationStatus {
  if (targetMinor === 0) return actualMinor < 0 ? 'behind' : 'met';
  if (actualMinor >= targetMinor) return actualMinor > targetMinor ? 'ahead' : 'met';
  const expectedByNow = Math.round(targetMinor * progress);
  return actualMinor >= expectedByNow ? 'on_track' : 'behind';
}
```

`progress = daysElapsed / daysInMonth`, przy czym dla miesięcy przeszłych `progress = 1`,
a dla przyszłych `progress = 0`.

**Wykonanie ujemne.** Przy ujęciu netto `actualMinor` bywa ujemne — w miesiącu, w którym
sięgnięto do poduszki, oszczędności spadły. Status jest wtedy zawsze `behind`, a UI pokazuje
kwotę ze znakiem minus i procent ujemny (`−12,7%`), nie zero. Ukrycie tego byłoby
zafałszowaniem obrazu miesiąca — to właśnie ta informacja jest powodem wyboru netto.

### 2.6 `shortfallMinor`

```
shortfall = Σ max(0, target(kind, M) − actual(kind, M))  dla wszystkich linii
```

Liczba, która pojawia się na dashboardzie jako *„Brakuje 360,00 zł do planu miesiąca"*
i zasila przycisk „Uzupełnij". Nigdy nie jest ujemna — nadwyżka w jednej linii
nie kompensuje niedoboru w drugiej, bo oszczędzanie i inwestowanie to różne cele.

### 2.7 Przypadki brzegowe

| Sytuacja | Zachowanie |
|---|---|
| `incomeBase = 0` | Procenty nieokreślone. API zwraca `actualPercentBps: 0` i `isPartialMonth: true`; UI pokazuje `—` zamiast `0%`. |
| Brak rozkładu docelowego | Wszystkie cele 0%, status `met`, brak ostrzeżeń. |
| Suma celów > 100% | Zapis dozwolony, `meta.warning: 'ALLOCATION_EXCEEDS_INCOME'`; UI ostrzega, nie blokuje. |
| Przelew między kontami tej samej klasy | Brak efektów — nie wpływa na wykonanie. |
| **Wykonanie ujemne** (wypłaty > wpłaty) | Status `behind`, kwota i procent pokazywane ze znakiem minus. `fulfillmentBps` ujemne; pierścień postępu rysowany jako pusty z etykietą ujemną. |
| **Wypłata przy zerowym planie** | `target = 0`, `actual < 0` → status `behind`, mimo że planu nie było. |
| Transakcja usunięta miękko | Nie wlicza się (filtr `deleted_at IS NULL`). |
| Zmiana klasy konta | **Nie przelicza wstecz** — migawki klas w transakcji są zapisane. |
| Przelew wyłączony przez użytkownika | `allocation_override = 'none'` → brak efektów w obu pulach. |

Doprecyzowania z `F5-3`, `F5-4` ([ADR-053](./14-decisions-log.md#adr-053)), kod
`shared/domain/allocation-status.ts`:

- Linie `savings` i `investment` zawsze; `debt_repayment` — tylko gdy rozkład planuje spłatę
  (`debtPercentBps > 0`); sumy (`totals`) obejmują pokazane linie.
- `isPartialMonth` = miesiąc trwa albo `incomeBase = 0`. `fulfillment` przy zerowym planie
  = 0 (`toBps`); o ocenie decyduje status.
- Rozkładu nie da się ustawić od miesiąca zamkniętego (§1.4); ten sam miesiąc — poprawka
  wersji. Sumy liczy jedno wyrażenie SQL (`db/sql/allocation-effect.ts`) dla dashboardu,
  statusu i trendu.

---

## 3. Przelicznik kwoty i procentu

Wymaganie #6: *„mogę ustawić, że wpłacam 2000 na konto mieszkaniowe i zostanie to
przeliczone na procent wpływów w danym miesiącu"*.

```ts
/**
 * Przelicza kwotę na udział we wpływach miesiąca.
 *
 * @param amountMinor - Kwota wpłaty.
 * @param incomeBaseMinor - Podstawa: wpływy miesiąca wliczane do alokacji.
 * @returns Udział w punktach bazowych; 0 gdy podstawa zerowa.
 */
export function toBps(amountMinor: number, baseMinor: number): number {
  if (baseMinor <= 0) return 0;
  return roundHalfAwayFromZero((amountMinor * 10_000) / baseMinor);
}

/**
 * Przelicza udział we wpływach na kwotę.
 *
 * Zaokrąglenie do pełnego grosza, połówki w górę co do wartości bezwzględnej —
 * tak, by wynik był symetryczny dla wartości dodatnich i ujemnych.
 *
 * @param percentBps - Udział w punktach bazowych.
 * @param incomeBaseMinor - Podstawa.
 * @returns Kwota w groszach.
 */
export function fromBps(bps: number, baseMinor: number): number {
  return roundHalfAwayFromZero((bps * baseMinor) / 10_000);
}
```

> **Nazwy i zaokrąglenie — sprostowanie z `F0-3`.** Funkcje nazywają się `toBps`
> i `fromBps`, zgodnie z [05 §14](./05-dto-contracts.md#14-helpery-izomorficzne), i żyją
> w `packages/shared/utils/money.ts`. Wcześniejszy zapis tego paragrafu używał
> `Math.round` w kierunku kwota → procent, co dla wartości ujemnych łamie regułę
> z [§8.3](#83-zaokrąglanie) („połówki w górę co do wartości bezwzględnej"). Ponieważ
> wykonanie alokacji liczone netto bywa ujemne (ADR-011), obie funkcje używają teraz
> tej samej, symetrycznej reguły (ADR-017).

### Który kierunek jest zapisywany

To rozróżnienie decyduje o zachowaniu celu w kolejnych miesiącach:

| `contributionMode` | Zapisane | Wyliczane co miesiąc |
|---|---|---|
| `fixed` | `contributionAmountMinor` | procent = `toBps(kwota, wpływy(M))` |
| `percent_of_income` | `contributionPercentBps` | kwota = `fromBps(bps, wpływy(M))` |
| `none` | — | brak planu; cel śledzi tylko postęp |

Przy `percent_of_income` w **trwającym** miesiącu kwota rośnie wraz z kolejnymi wpływami.
API zwraca `isPartialMonth: true`, a UI dopisuje „na podstawie dotychczasowych wpływów".
Bez tej informacji użytkownik zobaczyłby 10 września kwotę niższą niż rzeczywisty plan
i uznałby ją za błąd.

### Utrata precyzji

Przeliczenie w obie strony **nie jest bijekcją**: `2000,00 zł` z podstawy `11 800,00 zł`
to `1694,9152…` bps → zapisujemy `1695` → z powrotem `2000,10 zł`. Dlatego:

1. Zapisujemy **zawsze tylko jedną** wartość (tę zgodną z `contributionMode`).
2. Drugą liczymy na żądanie i oznaczamy jako pochodną.
3. UI pokazuje procent z jednym miejscem po przecinku (`17,0%`), nie z czterema cyframi.

---

## 4. Cele

### 4.1 Postęp

```ts
/**
 * Wylicza kwotę zgromadzoną na cel.
 *
 * Dwa tryby:
 *  - `contributions` — suma wpłat oznaczonych tym celem plus kwota początkowa.
 *    Właściwy, gdy jedno konto obsługuje kilka celów.
 *  - `account_balance` — bieżące saldo powiązanego konta.
 *    Właściwy, gdy konto istnieje wyłącznie dla tego celu; automatycznie uwzględnia
 *    odsetki i wpłaty zaksięgowane poza aplikacją.
 *
 * @param goal - Cel.
 * @returns Kwota zgromadzona w groszach.
 */
export function goalCurrentAmountMinor(goal: Goal): number;
```

```
progressBps = toBps(currentAmount, targetAmount)          // null gdy brak targetAmount
remaining   = max(0, targetAmount − currentAmount)
```

Wpłata na cel liczy się, gdy transakcja ma `goal_id = <cel>` **i** `type = 'transfer'`.
Wpłaty nieoznaczone celem wliczają się do alokacji (§2), ale nie do żadnego celu —
to zamierzone: rozkład procentowy i cele to dwie niezależne perspektywy tych samych pieniędzy.

### 4.2 Prognoza

```ts
/**
 * Prognozuje dojście do celu.
 *
 * Tempo liczone jako średnia wpłat z ostatnich 6 miesięcy (tylko miesiące z jakąkolwiek
 * wpłatą — inaczej przerwa zaniżałaby prognozę do absurdu). Gdy historia jest krótsza
 * niż 2 miesiące, używamy kwoty planowanej z `contribution`.
 *
 * @param goal - Cel z wyliczonym postępem.
 * @param history - Wpłaty miesiąc po miesiącu.
 * @returns Prognoza; pola `null`, gdy cel nie ma kwoty docelowej.
 */
export function projectGoal(goal: Goal, history: MonthlyContribution[]): GoalProjection;
```

```
pace            = średnia wpłat z ≤ 6 ostatnich miesięcy z wpłatą
monthsToTarget  = ceil(remaining / pace)                     // null gdy pace = 0
requiredMonthly = ceil(remaining / monthsUntil(targetDate))  // null gdy brak targetDate
isOnTrack       = pace >= requiredMonthly
```

`isOnTrack = false` jest w UI pokazywane jako konkretna informacja
(„Cel na czerwiec 2028 → potrzeba 3 714 zł/mies."), nie jako samo ostrzeżenie —
użytkownik ma dostać liczbę, na którą może zareagować.

### 4.3 Osiągnięcie celu

Gdy `currentAmount >= targetAmount`, serwis ustawia `status = 'achieved'` i `achieved_at`.
Kolejne wpłaty są nadal możliwe (cel nie jest zamykany automatycznie) — użytkownik
decyduje, czy podnieść kwotę docelową, czy zarchiwizować cel.

Doprecyzowania z `F5-1` ([ADR-052](./14-decisions-log.md#adr-052)), kod
`shared/domain/goal.ts`:

- **Postęp netto.** Przelew z `goal_id` to wpłata albo wypłata z celu
  (`goalTransferSign`): cel z powiązanym kontem — na nie `+`, z niego `−`; bez konta —
  z konta klasy celu na konto innej klasy `−`, pozostałe `+`. Zebrana kwota ≥ 0.
- **`account_balance`**: saldo konta na dziś; wpłaty miesiąca = ruch netto na koncie.
- **Tempo** = średnia z miesięcy z wpłatą ≠ 0 spośród sześciu do bieżącego włącznie;
  < 2 takich miesięcy → plan bieżącego miesiąca. `monthsToTarget > 1200` → `null`.
  Miesiące do terminu = `max(1, monthsDiff(bieżący, miesiąc targetDate))`.
- **Plan** wg `?month=`, **prognoza** od bieżącego miesiąca.
- **`achieved`** ustawia odczyt (aktywny cel z `remaining = 0`); powrót do `active`
  czyści `achievedAt`. Procent planu: > 0 i ≤ 100% wpływów (I-14).

---

## 5. Zobowiązania

### 5.1 Stan bieżący

```
remaining(L)  = L.opening_balance_minor
                − Σ transactions.amount_minor
                  WHERE liability_id = L.id
                    AND booked_on > L.balance_as_of
                    AND status = 'posted'
                    AND deleted_at IS NULL

paidSoFar(L)  = L.opening_balance_minor − remaining(L)
progressBps   = toBps(paidSoFar(L), L.opening_balance_minor)
installmentsRemaining = ceil(remaining(L) / L.monthly_payment_minor)
projectedFinalPaymentOn = dodaj (installmentsRemaining − 1) miesięcy do najbliższego terminu
```

`remaining` nigdy nie schodzi poniżej zera (`max(0, …)`). Po osiągnięciu zera serwis
proponuje oznaczenie zobowiązania jako nieaktywne — nie robi tego automatycznie,
bo nadpłata bywa zamierzona.

Doprecyzowania z `F4-4` ([ADR-047](./14-decisions-log.md#adr-047)), kod
`shared/domain/liability.ts`:

- Ratą jest **wydatek** (`type = 'expense'`) — zaciągnięcie długu to przychód (§2.2a).
- Spłacone (`remaining = 0`) → `progressBps = 10000`, także przy podstawie zerowej po korekcie.
- **Najbliższy termin**: rata bieżącego miesiąca, dopóki nie jest zaksięgowana (po terminie —
  zaległa), po zaksięgowaniu — następnego; dzień przycinany jak w §6.1. Bez `payment_day`
  i `first_payment_on` — brak prognozy daty.
- **Nie wcześniej niż pierwsza rata** ([ADR-068](./14-decisions-log.md#adr-068)):
  `first_payment_on`, gdy podana (wygrywa zawsze), a bez niej pierwszy dzień płatności
  **po** `balance_as_of` — kwota „na dzień" obejmuje raty do tego dnia włącznie.
  Zobowiązanie wpisane 28 września z ratą 10. ma najbliższą ratę 10 października, a nie
  zaległą z 10 września. Ta sama data wyznacza start reguły raty, a licznik
  niezapłaconych rat miesiąca pomija zobowiązania, których pierwsza rata jest później.
- Harmonogram (`GET /:id/schedule`): pełne raty, ostatnia — reszta; najwyżej 600 pozycji.
- Reguła na ratę startuje od pierwszej raty (wyżej), kończy się w miesiącu ostatniej raty
  z prognozy. Zmiana `first_payment_on` przesuwa start i koniec reguły o tyle samo miesięcy. Zamknięcie (`is_active = 0`) i usunięcie zobowiązania
  wstrzymują jego reguły; ponowne otwarcie ich nie wznawia.
- Rata z ekranu zobowiązań księguje czekające wystąpienie reguły raty, jeśli jest w oknie
  generowania — jedna rata, jedna płatność.

### 5.2 Uproszczenie: brak rozbicia na kapitał i odsetki

Cała rata pomniejsza „pozostałą kwotę". Dla kredytu hipotecznego oznacza to rozbieżność
z saldem kapitału w banku — rosnącą w czasie. Rozwiązanie: **`POST /liabilities/:id/rebase`**,
które ustawia nowy punkt odniesienia (`opening_balance_minor`, `balance_as_of`) na podstawie
wyciągu, bez ruszania historii transakcji.

W UI ta operacja nazywa się *„Zaktualizuj stan z wyciągu"* i jest podpowiadana raz na
kwartał przy zobowiązaniach typu `mortgage`.

Uzasadnienie wyboru: ADR-004 w [14-decisions-log.md](./14-decisions-log.md).

---

## 6. Pozycje cykliczne

Jeden mechanizm obsługuje wymagania #3 i #9.

### 6.1 Wyznaczanie terminów

```ts
/**
 * Wylicza daty wystąpień reguły w zadanym miesiącu.
 *
 * @param rule - Reguła cykliczna.
 * @param month - Miesiąc, dla którego generujemy wystąpienia.
 * @returns Lista dat `YYYY-MM-DD`, rosnąco. Pusta, gdy reguła nie obowiązuje w tym miesiącu.
 */
export function occurrenceDatesForMonth(rule: RecurringRule, month: MonthKey): string[];
```

| `frequency` | Reguła |
|---|---|
| `monthly` | `dayOfMonth` każdego miesiąca |
| `every_n_months` | `dayOfMonth` co `intervalCount` miesięcy, licząc od `startMonth` |
| `quarterly` | jak `every_n_months` z `intervalCount = 3` |
| `yearly` | `dayOfMonth` w miesiącu `monthOfYear` |
| `weekly` | każdy `weekday` w miesiącu |
| `biweekly` | co 14 dni od `anchorDate`, wystąpienia wpadające w miesiąc |

Doprecyzowania z `F4-1` ([ADR-043](./14-decisions-log.md#adr-043)), kod
`shared/domain/recurring.ts`:

- `weekday`: 0 = niedziela … 6 = sobota. `every_n_months` i `quarterly` liczą od
  `startMonth` (`monthsDiff(startMonth, M) % n = 0`), także przez granicę roku.
- `biweekly`: `anchorDate` to **pierwszy** termin; wcześniejszych dat nie ma. Domyślnie
  pierwszy `weekday` miesiąca startu. Odstęp liczony w dniach od północy UTC, więc zmiana
  czasu go nie przesuwa.
- `[startMonth, endMonth]` włącznie, z dokładnością do miesiąca. Wstrzymanie nie zmienia
  terminów — decyduje o generowaniu.
- Pola bez znaczenia dla częstotliwości są czyszczone przy zapisie (`normalizeSchedule`).
- Reguła spełnia te same niezmienniki kształtu co transakcja, którą utworzy
  (`recurringRuleShapeIssues` = `transactionShapeIssues` + terminarz).

**Przycinanie dnia miesiąca.** `dayOfMonth = 31` w kwietniu daje 30 kwietnia,
w lutym 28 (lub 29). Nigdy nie przenosimy terminu na kolejny miesiąc — czynsz płatny
„ostatniego dnia" ma wypaść w tym miesiącu, w którym powinien.

```ts
/**
 * Przycina dzień miesiąca do ostatniego istniejącego dnia.
 *
 * @param year - Rok.
 * @param month - Miesiąc 1–12.
 * @param day - Żądany dzień 1–31.
 * @returns Data `YYYY-MM-DD` z dniem nie późniejszym niż ostatni dzień miesiąca.
 */
export function clampDayOfMonth(year: number, month: number, day: number): string;
```

**Dni wolne** nie są przesuwane. Data wystąpienia to termin planowany, a nie data
zaksięgowania — tę użytkownik podaje przy potwierdzeniu.

### 6.2 Generowanie wystąpień

Leniwe, wyzwalane przez `GET /months/:month/summary` oraz `GET /recurring/occurrences`:

1. Pobierz aktywne reguły, dla których `startMonth <= M` i (`endMonth` pusty lub `>= M`).
2. Dla każdej wylicz terminy w M.
3. Wstaw brakujące wystąpienia (`INSERT ... ON CONFLICT(rule_id, due_on) DO NOTHING`)
   z `planned_amount_minor` = bieżąca kwota reguły.
4. Dla reguł z `auto_post = 1`, których termin już minął, a status to `planned` —
   zaksięguj (utwórz transakcję, ustaw `posted`).
5. Zapisz znacznik w `app_meta.last_recurring_generation`.

Krok 3 jest idempotentny dzięki unikalnemu indeksowi `(rule_id, due_on)` — wielokrotne
odświeżenie ekranu nie tworzy duplikatów. **Generowanie obejmuje wyłącznie miesiąc
bieżący i wcześniejsze** — miesiące przyszłe pokazują plan wyliczany w locie, bez zapisu
do bazy (inaczej zmiana reguły wymagałaby czyszczenia wygenerowanej przyszłości).

Doprecyzowania z `F4-2` ([ADR-045](./14-decisions-log.md#adr-045)), kod
`modules/recurring/recurring.rules.ts`:

- **Okno generowania** = od początku okna księgowania (§1.3) do bieżącego miesiąca.
  Każdy wyzwalacz generuje całe okno, nie tylko oglądany miesiąc — niezapłacony czynsz
  z poprzedniego miesiąca ma trafić do „Do zrobienia" (§6.6), nawet jeśli nikt tamtego
  miesiąca nie otworzył. Miesiące zamknięte (§1.4) nowych wystąpień nie dostają.
- **Miesiąc przyszły** — lista wyliczana z aktywnych reguł, wystąpienia z `id: null`,
  bez zapisu.
- **Reguła liczona w miesiącach** (`monthly`, `every_n_months`, `quarterly`, `yearly`) ma
  w miesiącu najwyżej jedno wystąpienie: miesiąc z wystąpieniem w dowolnym statusie jest
  pomijany (zapłacony czynsz + zmiana dnia płatności ≠ drugi czynsz).
- Krok 4 (auto-księgowanie) — `F4-3`. Krok 5 zapisuje znacznik tylko wtedy, gdy powstało
  choć jedno wystąpienie.

### 6.3 Migawka kwoty

`planned_amount_minor` jest kopiowana w chwili generowania. Podniesienie czynszu
w listopadzie nie zmienia planu z sierpnia — inaczej historia „plan kontra wykonanie"
traciłaby sens, a raporty za zamknięte miesiące zmieniałyby się wstecz.

### 6.4 Edycja reguły

| Zmiana | Skutek |
|---|---|
| Kwota, kategoria, konto | Dotyczy wystąpień **jeszcze niezaksięgowanych**; `posted` zostają nietknięte |
| Częstotliwość, dzień | Usuwane są wystąpienia `planned` od bieżącego miesiąca i generowane na nowo |
| `endMonth` w przeszłość | Wystąpienia `planned` po tej dacie są usuwane |
| Wstrzymanie (`pause`) | Nowe wystąpienia nie powstają; istniejące `planned` zostają |
| Usunięcie reguły | Kasuje wystąpienia `planned`; `posted` zostają jako zwykłe transakcje |

Doprecyzowania z `F4-2` ([ADR-045](./14-decisions-log.md#adr-045)):

- Granicą „jeszcze niezaksięgowanych" i „od bieżącego miesiąca" jest **bieżący miesiąc**:
  zmiana kwoty nie rusza zaległych z wcześniejszych miesięcy — zachowują migawkę (§6.3).
- Zmiana terminarza obejmuje też `intervalCount`, `monthOfYear`, `anchorDate` i przesunięcie
  `startMonth` później — czekające sprzed nowego startu są usuwane jak te po `endMonth`.
- Kategoria, konta i nazwa nie są kopiowane do wystąpienia — zmiana działa od razu.
- **Wznowienie** zapisuje brakujące terminy wcześniejszych miesięcy okna jako `skipped`
  („Reguła była wstrzymana") — inaczej wróciłyby jako zaległości z czasu wstrzymania.
- Usunięcie reguły kasuje **wszystkie** jej wystąpienia (`ON DELETE CASCADE`); transakcje
  z zaksięgowanych zostają, tracąc powiązanie.

### 6.5 Księgowanie wystąpienia

```ts
/**
 * Księguje wystąpienie cykliczne, tworząc transakcję.
 *
 * Idempotentne względem nagłówka `Idempotency-Key` — powtórzone żądanie przy
 * niestabilnym połączeniu zwraca pierwotny wynik, nie tworzy drugiej transakcji.
 *
 * @param occurrenceId - Identyfikator wystąpienia.
 * @param overrides - Rzeczywista kwota i data, gdy różnią się od planu.
 * @returns Utworzona transakcja i zaktualizowane wystąpienie.
 */
export function postOccurrence(occurrenceId: string, overrides?: PostOccurrenceInput): PostResult;
```

Transakcja dziedziczy z reguły: konta, kategorię, cel, zobowiązanie, `allocationKind`,
`source = 'recurring'` i `recurring_occurrence_id`. Gdy `amountIsEstimate = 1`,
UI **wymusza** potwierdzenie kwoty zamiast przyjąć planowaną.

Doprecyzowania z `F4-3` ([ADR-046](./14-decisions-log.md#adr-046)):

- Transakcja powstaje przez `createTransaction` — te same niezmienniki, odwołania i okno
  księgowania (§1.3) co wpisana ręcznie; opisem jest nazwa reguły. Konto można podać
  inne niż w regule; reguła bez konta bez podanego konta → `422`.
- Zaksięgowane → `409`. Pominięte **można** zaksięgować. Pominąć zaksięgowanego nie można.
- **Auto-księgowanie** (§6.2 krok 4): wystąpienie czekające, z terminem `≤ dziś`, w oknie
  generowania, reguły aktywnej z `autoPost` i kwotą **pewną** — i bez żadnej transakcji
  (także z kosza) wskazującej je. Cofnięte auto-zaksięgowanie nie wraca samo. Wystąpienie,
  którego zaksięgować się nie da, zostaje do zrobienia. Autorem jest osoba, której odczyt
  wyzwolił księgowanie.

### 6.6 Zaległości

Wystąpienie jest `isOverdue`, gdy `status = 'planned'` i `due_on < dziś`. Zaległe
z poprzednich miesięcy pojawiają się na dashboardzie bieżącego miesiąca w sekcji
„Do zrobienia" z etykietą miesiąca, którego dotyczą — żeby nie zniknęły z pola widzenia
po przełączeniu miesiąca.

Doprecyzowania z `F4-7` ([ADR-050](./14-decisions-log.md#adr-050)): zaległe z wcześniejszych
miesięcy — tylko z okna generowania (zamknięte miesiące nie wracają); w „Do zrobienia" stoją
także raty zobowiązań **bez** reguły cyklicznej, niezapłacone w bieżącym miesiącu —
zobowiązanie z regułą ma ratę wśród wystąpień, więc nie pojawia się dwa razy.

### 6.7 Cofnięcie zaksięgowania

Zaksięgowanie ma dwie strony: wystąpienie (albo planowany wydatek) i transakcję. Cofnąć
je można z każdej z nich — i obie drogi robią **to samo**, w jednej transakcji bazodanowej
([ADR-042](./14-decisions-log.md#adr-042), `Z-11`):

| Wejście | Skutek |
|---|---|
| `POST /recurring/occurrences/:id/unpost` | transakcja → kosz; wystąpienie → `planned` |
| usunięcie transakcji (gest, arkusz, `DELETE /transactions/:id`) | to samo |
| przywrócenie transakcji z kosza („Cofnij") | wystąpienie → z powrotem `posted`, **o ile** nadal jest `planned`; jeśli w międzyczasie zaksięgowano je inną transakcją — przywrócona wraca jako zwykła, bez powiązania |

Cofnięcie czyści `transaction_id`, `posted_amount_minor` i `posted_at` wystąpienia;
transakcja w koszu **zachowuje** `recurring_occurrence_id` — po nim przywrócenie wie, co
związać, a auto-księgowanie, że cofnięto świadomie (ADR-046). Przywrócona jako zwykła traci
powiązanie. Zmiana kwoty transakcji przechodzi na `posted_amount_minor`. Planowany wydatek
wraca do stanu wynikającego z odłożonej kwoty i terminu (`funding` albo `ready`, §6.5);
instancja na kolejny rok, utworzona przy zaksięgowaniu, **zostaje** — to osobny wydatek.
Żeby ponowne zaksięgowanie nie zrobiło drugiej, instancja powstaje tylko wtedy, gdy nie
istnieje jeszcze żadna z `previous_instance_id` wskazującym bieżącą.

**Dlaczego tak.** Bez tego wystąpienie `posted` wskazywałoby transakcję z kosza:
dashboard pokazywałby czynsz jako zapłacony, choć pieniędzy nie ma w księdze. Po 30 dniach
czyszczenie kosza zostawiłoby `posted` bez transakcji, łamiąc I-12 i I-18.

Zamknięty miesiąc (§1.4) blokuje usunięcie transakcji, więc blokuje też cofnięcie
zaksięgowania — zamknięty miesiąc nie traci płatności.

### 6.8 Reguła z transakcji — „Zapisz jako wydatek stały"

Wymaganie #3, `F4-8`, [ADR-051](./14-decisions-log.md#adr-051). Reguła powstaje z zapisanej
transakcji: kwota, konta, kategoria, źródło, cel, zobowiązanie i nadpisanie alokacji z niej,
terminarz z żądania albo z jej daty (co miesiąc, tego samego dnia, od jej miesiąca).

**Transakcja źródłowa jest płatnością swojego terminu.** W miesiącu transakcji (jeśli jest
otwarty, §1.4) powstaje wystąpienie `posted` wskazujące tę transakcję, a ona dostaje
`recurring_occurrence_id` — od tej chwili działa I-12 i §6.7. Termin to data reguły
w tym miesiącu **najbliższa dacie transakcji**, przy remisie wcześniejsza
(`sourcePaymentDueOn`): czynsz zapłacony 8. przy regule „10. dnia" opłaca termin 10.
Wcześniejsze terminy tego miesiąca (reguła tygodniowa) zapisują się jako `skipped`
z powodem „Przed zapisaniem pozycji cyklicznej" — reguły wtedy nie było. Późniejsze
generują się zwyczajnie.

| Przypadek | Wynik |
|---|---|
| Czynsz 10.09, `{}` | reguła „10. dnia" od 2026-09; wrzesień `posted`, październik czeka |
| Siłownia w środę 23.09, `weekly` | 2, 9, 16.09 `skipped`; 23.09 `posted`; 30.09 czeka |
| Transakcja z zamkniętego miesiąca | reguła powstaje, transakcja zostaje zwykła |
| Rata zobowiązania bez reguły | reguła zostaje regułą raty (`liabilities.recurring_rule_id`) |
| Transakcja w koszu / z pozycji cyklicznej / rata zobowiązania z regułą | `409` |

**Dlaczego tak.** Bez powiązania czynsz zapisany jako stały pokazałby się od razu
w „Do zrobienia" jako zaległy — do zapłacenia drugi raz.

### 6.5 Planowane wydatki

Wymaganie #13: większe wydatki znane z wyprzedzeniem (OC, przegląd, wakacje, podatek).
Kluczowa różnica wobec pozycji cyklicznych: **kwota jest szacunkowa i trzeba na nią odłożyć**.

#### Kiedy co

| Sytuacja | Właściwy byt |
|---|---|
| Czynsz 1850 zł 10. dnia każdego miesiąca | pozycja cykliczna |
| Rata kredytu | pozycja cykliczna (powiązana ze zobowiązaniem) |
| Netflix 43 zł | pozycja cykliczna |
| OC samochodu ~2400 zł w marcu | **planowany wydatek** |
| Przegląd + opony ~800 zł jesienią | **planowany wydatek** |
| Wakacje ~6000 zł w lipcu | **planowany wydatek** |
| Wymiana pralki, kiedy padnie | **planowany wydatek** bez terminu → `due_month` szacunkowy |

Test rozstrzygający: *czy muszę na to odkładać z wyprzedzeniem?* Jeśli tak — planowany wydatek.

#### Zebrana kwota

```
accumulated(P) = P.already_set_aside_minor
               + Σ transactions.amount_minor
                 WHERE planned_expense_id = P.id
                   AND type = 'transfer'
                   AND status = 'posted'
                   AND deleted_at IS NULL

remaining(P)   = max(0, P.estimated_amount_minor − accumulated(P))
coverageBps    = toBps(accumulated(P), P.estimated_amount_minor)
```

Gdy odkładanie idzie na cel (`set_aside_goal_id`), wpłata liczy się **jednocześnie**
do celu i do planowanego wydatku — to te same pieniądze oglądane z dwóch stron.
Nie jest to podwójne liczenie, bo cele i planowane wydatki nigdy nie są sumowane razem
w żadnym podsumowaniu.

#### Miesięczna rata odkładania

```ts
/**
 * Wylicza, ile trzeba odkładać miesięcznie, by uzbierać na termin.
 *
 * Wartość nie jest przechowywana, tylko liczona przy każdym odczycie: po pominięciu
 * jednej wpłaty rata musi wzrosnąć, a zapisana liczba byłaby nieaktualna zaraz po zapisie.
 * Zaokrąglenie w górę — lepiej odłożyć o grosz za dużo niż zabraknąć w terminie.
 *
 * @param remainingMinor - Ile jeszcze brakuje.
 * @param monthsLeft - Pełne miesiące do terminu włącznie z bieżącym (co najmniej 1).
 * @returns Rata miesięczna w groszach.
 */
export function monthlySetAsideMinor(remainingMinor: number, monthsLeft: number): number {
  if (remainingMinor <= 0) return 0;
  return Math.ceil(remainingMinor / Math.max(1, monthsLeft));
}
```

```
monthsLeft = liczba miesięcy od bieżącego do due_month włącznie
           = monthsBetween(currentMonth, due_month).length
```

Termin w bieżącym miesiącu ⇒ `monthsLeft = 1` ⇒ rata = całość brakującej kwoty.
Termin w przeszłości (zaległy) ⇒ `monthsLeft = 1`, a wydatek dostaje flagę zaległości.

`isOnTrack` jest prawdą, gdy `accumulated >= oczekiwane_na_teraz`, gdzie

```
oczekiwane_na_teraz = estimated × (miesiące_od_startu_odkładania / wszystkie_miesiące)
```

#### Przejścia statusów

```
planned ──(włączono odkładanie)──► funding ──(coverage = 100%)──► ready
   │                                  │                             │
   │                                  └──(nadszedł due_month)──────►│
   │                                                                │
   ├──(odroczono)──► deferred ──(nowy termin)──► planned            │
   ├──(odwołano)───► cancelled                                      │
   └───────────────────(zaksięgowano)──────────────────────────► posted
                                                                    │
                                              (repeats_yearly) ─────┴──► nowy `planned`
```

- `planned` → `funding`: automatycznie przy pierwszej wpłacie na odkładanie.
- `funding` → `ready`: gdy `coverage >= 10000 bps` **lub** nastał `due_month`.
  Wydatek w stanie `ready` pojawia się w sekcji „Do zrobienia" na dashboardzie.
- `→ posted`: tworzy transakcję wydatkową z `source = 'planned'` i `planned_expense_id`.
- `→ deferred`: przesunięcie terminu. Zebrane pieniądze zostają; rata przelicza się sama.
- `posted` → `funding`/`ready`: cofnięcie zaksięgowania albo usunięcie jego transakcji (§6.7).

#### Powtarzanie co rok

```ts
/**
 * Tworzy kolejną instancję powtarzalnego wydatku po zaksięgowaniu bieżącej.
 *
 * Kwotą nowej instancji jest kwota FAKTYCZNIE zapłacona, nie poprzedni szacunek —
 * to najlepsza dostępna prognoza na przyszły rok i zwalnia użytkownika z korygowania
 * szacunku ręcznie co dwanaście miesięcy.
 *
 * @param posted - Zaksięgowany wydatek.
 * @returns Nowa instancja na ten sam miesiąc w następnym roku.
 */
export function createNextYearlyInstance(posted: PlannedExpense): PlannedExpense;
```

Nowa instancja dziedziczy kategorię, priorytet, ustawienia odkładania i `repeats_yearly`,
a `set_aside_start_month` ustawia na miesiąc następujący po zaksięgowaniu — dzięki czemu
odkładanie na kolejny rok zaczyna się od razu i rozkłada na pełnych dwanaście miesięcy.

#### Ostrzeżenia o płynności

```ts
/**
 * Wykrywa miesiące, w których planowane wydatki mogą przekroczyć dostępne środki.
 *
 * Prognoza salda: bieżące saldo kont wydatkowych plus przewidywane wpływy cykliczne
 * minus przewidywane wydatki cykliczne, narastająco po miesiącach. Celowo NIE
 * uwzględnia wydatków nieregularnych — prognoza ma być ostrożna, a nie dokładna.
 *
 * @param expenses - Planowane wydatki w horyzoncie.
 * @param forecast - Prognoza sald miesiąc po miesiącu.
 * @returns Lista ostrzeżeń, pusta gdy wszystko jest pokryte.
 */
export function detectLiquidityWarnings(
  expenses: PlannedExpense[],
  forecast: MonthlyBalanceForecast[],
): LiquidityWarning[];
```

| Kod | Warunek |
|---|---|
| `INSUFFICIENT_PROJECTED_BALANCE` | Suma wydatków miesiąca > prognozowane saldo kont wydatkowych |
| `UNFUNDED_MUST_EXPENSE` | Wydatek `priority='must'` bez odkładania, termin ≤ 3 miesiące |
| `SET_ASIDE_BEHIND` | `isOnTrack = false` i pozostało ≤ 3 miesiące |

Ostrzeżenia **informują, nie blokują**. Użytkownik może mieć środki poza aplikacją,
o których nie wie prognoza — narzędzie nie ma prawa twierdzić, że coś jest niemożliwe.

Doprecyzowania z `F6-1`…`F6-5` ([ADR-055](./14-decisions-log.md#adr-055)):

- Status `planned`/`funding`/`ready` wynika ze stanu (pokrycie, termin, cokolwiek zebrane)
  i jest synchronizowany przy odczycie; `deferred` jest przejściowy — przesunięcie terminu
  od razu wraca do statusu ze stanu.
- Oczekiwane na dziś: pełne miesiące od startu (bez bieżącego); bez odkładania — „w tempie".
- Instancja na kolejny rok: start odkładania w miesiącu po zapłacie (nie później niż
  nowy termin), 29 lutego → 28 lutego.
- Prognoza: przepływ cykliczny bez zapisu (`pendingRecurringNet`), przelewy pominięte,
  z salda odejmowana niepokryta część wydatku; zaległy obciąża bieżący miesiąc;
  `UNFUNDED_MUST_EXPENSE` i `SET_ASIDE_BEHIND` przy `monthsUntilDue ≤ 3`.

---

## 7. Salda kont

```
balance(A, asOf) = A.opening_balance_minor
                 + Σ amount WHERE type='income'   AND account_id = A
                 − Σ amount WHERE type='expense'  AND account_id = A
                 − Σ amount WHERE type='transfer' AND account_id = A            -- wypływ
                 + Σ amount WHERE type='transfer' AND counter_account_id = A    -- wpływ

  (wszystkie sumy: booked_on <= asOf AND booked_on >= A.opening_balance_on
                   AND status = 'posted' AND deleted_at IS NULL)
```

```
netWorth = Σ balance(A) dla kont z include_in_net_worth = 1
         − Σ remaining(L) dla aktywnych zobowiązań
```

Salda nie są materializowane — uzasadnienie w [03 §3.5](./03-data-model.md#35-accounts).

Doprecyzowania z `F2-2` ([ADR-032](./14-decisions-log.md#adr-032)):

- **Saldo na początek miesiąca** to `balance(A, dzień przed pierwszym dniem miesiąca)`,
  a `changeInMonth = balance − balanceAtMonthStart`. Saldo początkowe wchodzi do obu,
  więc konto założone w środku miesiąca nie pokazuje swojego salda startowego jako wpływu.
- **Konta zarchiwizowane** są w saldach i w majątku netto, o ile na początku miesiąca
  albo na `asOf` miały saldo różne od zera. Zarchiwizowane z zerem nic nie wnoszą, więc
  są pomijane. Dzięki temu archiwizacja nigdy nie zmienia liczb za przeszłe miesiące (§10).
- **Sumy per klasa** obejmują wszystkie pokazane konta; majątek netto — tylko te
  z `include_in_net_worth = 1`.
- `remaining(L)` wchodzi do majątku od `F4-4` **na dzień sald**: zobowiązania aktywne
  z `balance_as_of ≤ asOf`, raty do `asOf` włącznie (ADR-047).

---

## 8. Pieniądz

### 8.1 Reprezentacja

Wyłącznie liczby całkowite w groszach. `1234` to `12,34 zł`. Zakres bezpieczny dla
`Number.MAX_SAFE_INTEGER` to ok. 90 bilionów złotych — wystarczy z ogromnym zapasem.

**Nigdy** nie wykonujemy arytmetyki na wartościach po sformatowaniu i nigdy nie
przechowujemy kwot jako `REAL`. Jedyne pole `REAL` w schemacie to `document_items.quantity`
(ilość sztuk, nie pieniądz) oraz `confidence`.

### 8.2 Parsowanie wejścia

```ts
/**
 * Zamienia tekst z pola formularza na grosze.
 *
 * Akceptuje przecinek i kropkę jako separator dziesiętny, spacje (również niełamliwe)
 * jako separator tysięcy oraz opcjonalny sufiks waluty. Odrzuca wejście z więcej niż
 * dwoma cyframi po separatorze — cichy zapis 10,999 zł jako 10,99 zł byłby gorszy
 * od komunikatu o błędzie.
 *
 * @param input - Tekst wpisany przez użytkownika, np. `"1 234,56 zł"`.
 * @returns Kwota w groszach albo `null`, gdy tekstu nie da się zinterpretować.
 */
export function parseAmountToMinor(input: string): number | null;
```

Przykłady: `"1234,56"` → `123456`; `"1 234.56"` → `123456`; `"12"` → `1200`;
`"12,5"` → `1250`; `"12,555"` → `null`; `"abc"` → `null`.

### 8.3 Zaokrąglanie

Jedna reguła w całej aplikacji: **połówki w górę co do wartości bezwzględnej**
(`sign(x) * round(abs(x))`). Zapewnia symetrię: `+2,5` → `+3`, `−2,5` → `−3`.
Stosowana w przeliczniku procentowym, podziale kwot i prognozach.

### 8.4 Podział kwoty

```ts
/**
 * Dzieli kwotę na części tak, by ich suma równała się dokładnie kwocie wejściowej.
 *
 * Reszta z dzielenia jest rozdawana po jednym groszu, począwszy od pierwszej części.
 * Naiwne `round(total / n)` dla każdej części potrafi zgubić lub wytworzyć grosze,
 * co przy dzieleniu paragonu prowadzi do niezgodności sumy pozycji z sumą na paragonie.
 *
 * @param totalMinor - Kwota do podziału.
 * @param parts - Liczba części (> 0).
 * @returns Tablica kwot sumująca się dokładnie do `totalMinor`.
 */
export function splitEvenly(totalMinor: number, parts: number): number[];
```

`splitEvenly(10000, 3)` → `[3334, 3333, 3333]`.

### 8.5 Formatowanie

```ts
formatMinor(123456)            // "1 234,56 zł"
formatMinor(-12799)            // "−127,99 zł"   (minus typograficzny U+2212)
formatMinor(0)                 // "0,00 zł"
formatMinorWhole(236000)       // "2 360 zł"     — bez groszy, do porównań
formatMinorCompact(1234567)    // "12,3 tys. zł" — tylko na wykresach
```

**Trzy formaty, trzy zastosowania.** `formatMinor` wszędzie tam, gdzie liczy się
zgodność do grosza — listy, podsumowania, formularze. `formatMinorWhole` tam, gdzie
liczy się **porównanie** dwóch kwot i grosze tylko przeszkadzają: pierścienie celów
i paski postępu (`<Money variant="compact">`, [15 §4.1](./15-design-system.md#41-money)).
`formatMinorCompact` **wyłącznie na wykresach**, gdzie brakuje miejsca na pełną liczbę.

`formatMinorWhole` **zaokrągla**, nie ucina: ucinanie pokazałoby `999,99 zł` jako
`999 zł`, czyli mniej, niż jest naprawdę. Pełna wartość zostaje w `aria-label`.

Separator tysięcy: spacja niełamliwa (` `). Znak minus: `−` (U+2212), nie łącznik —
w czcionce tabelarycznej ma właściwą szerokość i nie łamie kolumny.

---

## 9. Kategoryzacja

### 9.1 Zgodność rodzaju

Kategoria transakcji musi mieć `kind` zgodny z typem transakcji (niezmiennik I-4):
`expense` → kategoria `expense`, `income` → `income`, `transfer` → `transfer` albo `NULL`.

Formularz pokazuje wyłącznie kategorie pasujące do wybranego typu, więc naruszenie
oznacza błąd klienta → `422`.

Kategorii **zarchiwizowanej** nie da się przypisać (`422`) — tak samo konta i źródła
przychodu z archiwum. Dotyczy to wyłącznie ustawianego odwołania: transakcje, które już
wskazują zarchiwizowany byt, zostają i dają się poprawiać ([ADR-035](./14-decisions-log.md#adr-035)).

### 9.2 Kategoria niewymagana

`category_id` może być `NULL`. Szybkie dodanie wydatku bez kategorii jest dopuszczalne —
lepiej zarejestrować kwotę teraz niż nie zarejestrować jej wcale. Takie transakcje
trafiają do kategorii „Bez kategorii" w raportach, a dashboard pokazuje ich licznik
z odnośnikiem do uzupełnienia.

### 9.3 Scalanie

`POST /categories/:id/merge` przepina wszystkie transakcje, reguły cykliczne i podpowiedzi
AI na kategorię docelową, a źródłową archiwizuje. Operacja w jednej transakcji bazodanowej.
Kategorii systemowej nie da się scalić w inną (można scalać **w** nią).

Doprecyzowania z `F2-3` ([ADR-033](./14-decisions-log.md#adr-033)):

- Przepinane są **wszystkie** odwołania: transakcje (także miękko usunięte — przywrócona
  z kosza nie może wrócić z kategorią zarchiwizowaną), reguły cykliczne, planowane
  wydatki, zobowiązania i propozycje kategorii w pozycjach dokumentów.
- Podpowiedzi AI: najpierw celu, potem źródła, bez duplikatów (bez względu na wielkość
  liter). Scalenie nie może oduczyć AI rozpoznawania sprzedawcy.
- Scalić można tylko kategorie **tego samego rodzaju** (inaczej I-4), cel musi być
  aktywny, a źródło bez podkategorii.
- Archiwizacja kategorii głównej archiwizuje jej podkategorie; przywrócenie podkategorii
  przywraca jej rodzica.

### 9.4 Podział dokumentu po kategoriach

Tryb zatwierdzenia `by_category` ([ADR-069](./14-decisions-log.md#adr-069)) zamienia
zaznaczone pozycje paragonu na **jedną transakcję wydatku na kategorię**. Grupowanie
(`groupItemsByCategory` w `packages/shared`) liczy ekran i serwer tą samą funkcją:

1. Klucz pozycji = jej kategoria **wydatku** (wybrana albo przyjęta propozycja nowej);
   kategoria innego rodzaju, zarchiwizowana albo brak → brak klucza.
2. Obciążenia z kluczem tworzą grupy; **dominująca** = najwięcej obciążeń (remis —
   pierwsza na paragonie) — ta sama reguła, co kategoria całości w `single`. Liczba, nie
   kwota: niepewna pozycja paragonu z dziesięcioma produktami spożywczymi i jedną
   patelnią to raczej jedzenie, choć patelnia kosztuje więcej.
3. Obciążenie bez klucza → grupa dominująca. Uznanie (rabat, kaucja) z kluczem istniejącej
   grupy pomniejsza tę grupę; bez klucza albo z kluczem bez obciążeń → dominująca.
4. Grupa inna niż dominująca o sumie ≤ 0 wchodzi do dominującej; jeśli dominująca ma
   sumę ≤ 0, wszystko staje się jedną grupą.
5. Suma wszystkich grup ≤ 0 → `422` (jak w `single`). Gdy żadna pozycja nie ma klucza —
   jedna grupa bez kategorii.
6. Kolejność grup: malejąco po kwocie. Pozycje zachowują kolejność z paragonu.

Kwoty są sumami całkowitych groszy — nie ma dzielenia, więc nie ma zaokrągleń.

---

## 10. Reguły usuwania

| Byt | Reguła |
|---|---|
| Transakcja | Miękkie usunięcie (`deleted_at`). Przywracalna przez 30 dni, potem czyszczona zadaniem konserwacyjnym. Transakcja z zaksięgowania (wystąpienie, planowany wydatek) — usunięcie cofa zaksięgowanie (§6.7). |
| Konto | Archiwizacja, gdy ma transakcje. Twarde usunięcie tylko dla konta bez historii. Usunięcie i archiwizacja **wstrzymują** reguły cykliczne księgujące na tym koncie albo z niego — takiej reguły nie da się zaksięgować; przywrócenie konta ich nie wznawia (ADR-044). |
| Kategoria | Jak wyżej — liczą się też transakcje miękko usunięte. Systemowej nie można usunąć nigdy. Kategorii z podkategoriami też nie (`ON DELETE SET NULL` wypchnęłoby je po cichu na poziom główny). |
| Źródło przychodu | Jak wyżej. |
| Cel | Twarde usunięcie; wpłaty tracą `goal_id`, ale zostają w księdze. |
| Zobowiązanie | Twarde usunięcie; raty zostają jako zwykłe wydatki. |
| Reguła cykliczna | Twarde usunięcie; wystąpienia `planned` kasowane, `posted` zostają. Usunięta kategoria albo źródło przychodu reguły — pole czyszczone, reguła działa dalej (oba są opcjonalne). |
| Planowany wydatek | Twarde usunięcie. Wpłaty na odkładanie zostają jako przelewy, tracąc `planned_expense_id`. Zaksięgowany wydatek zostaje w księdze. |
| Dokument | Twarde usunięcie wraz z plikiem. Utworzone transakcje zostają, tracąc `source_document_id`. |
| Użytkownik | Nie usuwamy. Dezaktywacja (`is_active = 0`) i unieważnienie sesji. |

Zasada: **nic, co wpływa na liczby w zamkniętych miesiącach, nie znika**. Usunięcie
konfiguracji nie może zmienić historii finansowej.

---

## 11. Współbieżność

Dwóch użytkowników może edytować jednocześnie. SQLite w trybie WAL obsługuje jednego
piszącego naraz; przy tej skali kolizje są rzadkie i rozwiązuje je `busy_timeout`.

Dla operacji wrażliwych stosujemy dodatkowe zabezpieczenia:

| Operacja | Zabezpieczenie |
|---|---|
| Księgowanie wystąpienia cyklicznego | Unikalny `(rule_id, due_on)` + zmiana statusu w tej samej transakcji |
| Zatwierdzenie dokumentu | Zmiana `status` na `committed` warunkowana obecnym stanem `parsed` |
| Import z wyciągu | Unikalny częściowy indeks na `external_ref` |
| Edycja transakcji | Ostatni zapis wygrywa; `updated_at` w odpowiedzi pozwala UI wykryć rozbieżność |

Nie wprowadzamy blokad optymistycznych na każdą encję — przy dwóch osobach
w jednym gospodarstwie koszt przewyższa zysk.

---

## 12. Ekran miesiąca

Liczby `GET /months/:key/summary` i `GET /months/:key/categories` (`F3-1`, `F3-2`,
[ADR-039](./14-decisions-log.md#adr-039)). Wszystkie sumy: `status = 'posted'`,
`deleted_at IS NULL`, `month_key = M`.

### 12.1 Sumy

```
income(M)        = Σ amount  WHERE type = 'income'
incomeBase(M)    = Σ amount  WHERE type = 'income' AND (źródło puste OR counts_toward_allocation)   -- §2.3
expense(M)       = Σ amount  WHERE type = 'expense'
savings(M)       = Σ efekt 'savings'    z allocationEffects      -- §2.4, może być ujemne
investment(M)    = Σ efekt 'investment' z allocationEffects      -- jw.
debtRepayment(M) = §2.2a — część expense(M), nie dodatek
net(M)           = income − expense − savings − investment
unallocated(M)   = max(0, net(M))
```

`net` nie odejmuje spłaty długu: rata jest wydatkiem, więc już siedzi w `expense`.
Wypłata z oszczędności (`savings < 0`) **zwiększa** `net` — te pieniądze wróciły do
wydawania. `unallocated` to kwota, którą da się jeszcze gdzieś skierować; miesiąc na
minusie nie ma czego rozdysponować, a minus pokazuje `net`.

### 12.2 Upływ miesiąca

```
daysInMonth = liczba dni zakresu monthRange(M)
daysElapsed = daysInMonth           dla miesięcy przeszłych
            = dziś − from + 1       dla bieżącego (dzisiejszy dzień liczy się jako miniony)
            = 0                     dla przyszłych
```

Daty biznesowe liczone jako północ UTC — zmiana czasu nie daje doby 23-godzinnej.
W Fazie 5 `progress = daysElapsed / daysInMonth` z §2.5.

### 12.3 Porównanie z poprzednim miesiącem

```
expenseDelta    = expense(M) − expense(M−1)
expenseDeltaBps = toBps(expenseDelta, expense(M−1))      -- 0 przy zerowej podstawie
hasPreviousData = w M−1 jest jakakolwiek transakcja (poza koszem)
```

Wpływy analogicznie. Przy `hasPreviousData = false` UI nie pokazuje strzałki ani procentu.

### 12.4 Rozbicie po kategoriach

- Wydatki podkategorii doliczane do kategorii głównej; drzewo zachowuje dzieci.
- Wydatki bez kategorii (i — teoretycznie — z kategorią spoza listy) to pozycja
  „Bez kategorii" z `categoryId: null`. **Suma rozbicia = `expense(M)`**.
- Kategorie zarchiwizowane zostają (§10).
- `shareBps = toBps(kwota, expense(M))`; udziały zaokrąglone osobno mogą nie sumować
  się do 10 000 — to etykiety, nie podział kwoty.
- `previousMonthAmountMinor` = kwota w M−1, albo `null`, gdy M−1 nie ma żadnego wydatku.
- Kolejność: kwota malejąco, potem kwota z M−1, potem nazwa. Kafel dashboardu: pięć
  pierwszych z kwotą > 0.


---

## 13. Planer budżetu

> **Faza 9 — zrobione**. Opis funkcji i scenariusze:
> [16](./16-budget-planner.md). Decyzje: [ADR-075](./14-decisions-log.md#adr-075) …
> [ADR-079](./14-decisions-log.md#adr-079). Czyste funkcje: `shared/domain/budget.ts`.

Szkic to **plan przepływu jednego miesiąca**, nie księga. Nic w tej sekcji nie tworzy
transakcji, wystąpień ani nie zmienia wyników z §2 i §12 — z wyjątkiem jawnych akcji
„Zamień" (§13.6) i „Zastosuj w źródle" (§13.7), które działają przez serwisy
właściwych modułów, z ich regułami.

### 13.1 Zakres miesięcy i edycja

```
current        = bieżący miesiąc w strefie gospodarstwa (§1.1)
można założyć  = M ∈ [current, shift(current, +12)]                      -- I-20
edytowalny     = M ≥ current
tylko odczyt   = M < current   (plan minionego miesiąca to historia; zostaje plan kontra wykonanie)
```

Szkic miesiąca, który minął, nie znika i nie zamraża się kopią — linie są zapisane,
a ocena (§13.4) liczy się z nich tak samo. Źródła mogły się od tego czasu zmienić;
dlatego dla miesięcy minionych **stan źródła** (§13.5) nie jest liczony.

### 13.2 Wypełnianie ze źródeł

Wypełnienie (przy zakładaniu albo „Odśwież") przechodzi źródła w ustalonej kolejności —
cele procentowe potrzebują sumy wpływów, więc wpływy idą pierwsze. Każde źródło daje
**najwyżej jedną linię** na szkic (unikalne indeksy 03 §3.20); wstawianie idzie przez
`ON CONFLICT DO NOTHING`, więc odświeżenie:

- dokłada linie dla nowych źródeł,
- **nie zmienia** istniejących linii (ani kwoty, ani nazwy),
- **nie wskrzesza** wykluczonych (`is_excluded=1` — wiersz istnieje, konflikt),
- ustawia `last_filled_at`.

| Krok | Źródło | Linia |
|---|---|---|
| 1 | Aktywne reguły cykliczne `flow='income'` z terminem w M | `income`, kategoria i źródło przychodu z reguły |
| 2 | Aktywne reguły `flow='expense'` z terminem w M | `expense`; `liability_id` i kategoria z reguły |
| 3 | Aktywne reguły `flow='transfer'` z terminem w M, których efekt alokacji (§2.2) dotyka **jednej** puli | `savings`/`investment` ze znakiem efektu; `goal_id` z reguły |
| 4 | Aktywne zobowiązania **bez** reguły raty, z ratą wypadającą w M | `expense`, `origin='liability'` |
| 5 | Planowane wydatki z `due_month = M`, status ≠ `cancelled` | `expense`, `origin='planned'` |
| 6 | Planowane wydatki z odkładaniem — przed terminem i w miesiącu terminu | `savings`/`investment`, `origin='set_aside'` (wzory niżej) |
| 7 | Aktywne cele z planem wpłat (`fixed`, `percent_of_income`) | `savings`/`investment` wg rodzaju celu, `origin='goal'` |

**Kwota linii z reguły (kroki 1–3).**

```
dates(rule, M)  = occurrenceDatesForMonth(rule, M)                      -- §6.1
amount(rule, M) = Σ po dates:  migawka istniejącego wystąpienia (§6.3),
                               jeśli wystąpienie istnieje i nie jest 'skipped';
                               0, jeśli 'skipped';
                               rule.amount_minor, jeśli wystąpienia jeszcze nie ma
```

Tygodniowa siłownia w miesiącu z pięcioma środami daje jedną linię „Siłownia" na 5 ×
kwota. Dla miesięcy przyszłych wystąpień nie ma (§6.2), więc liczy się kwota reguły.
Reguła wstrzymana (`is_active=0`) nie daje linii.

**Przelewy (krok 3).** Efekt liczony `allocationEffects` z klas kont reguły
i `allocation_override`. Brak efektu (konto wydatkowe → wydatkowe, `override='none'`)
— brak linii: przelew między własnymi kontami nie zmienia bilansu miesiąca. Dwa efekty
(oszczędności → inwestycje) — **brak linii**: jedna linia nie wyrazi dwóch pul, a na
„Zostaje" taki przelew i tak nie wpływa. Ten przypadek odnotowuje §13.9.

**Raty bez reguły (krok 4).** Rata i termin z `liabilitySchedule` (§5). Zobowiązanie
z regułą raty ma ratę w kroku 2 — nie pojawia się dwa razy (jak w „Do zrobienia", ADR-050).

**Planowany wydatek w swoim miesiącu (krok 5).** Kwota = `posted_amount_minor`, gdy
zaksięgowany, inaczej `estimated_amount_minor`. Wydatek idzie w całości — jest wydatkiem
miesiąca, z którego zostanie zapłacony.

**Odkładanie (krok 6).** Rata liczona **raz, na dziś** (§6.5), i przyjmowana jako plan
na każdy miesiąc do terminu — zgodnie z tym, co pokazuje ekran *Planowane*:

```
req      = monthlySetAsideMinor(remaining_dziś, monthsLeft_dziś)       -- §6.5
pula     = klasa konta odkładania albo rodzaj celu odkładania;
           konto klasy 'spending' → brak linii (pieniądze nie wychodzą z puli wydatków)

M < due_month:   linia +req                         („Odkładanie: OC samochodu")
M = due_month:   S_M  = min(estimated, accumulated_dziś + req × monthsDiff(current, M))
                 linia −S_M                         („Z odłożonego: OC samochodu")
M > due_month:   brak linii
```

**Dlaczego w miesiącu terminu linia jest ujemna.** Wydatek (krok 5) obciąża miesiąc
w całości, a pieniądze odłożone wcześniej wracają z puli — ujęcie netto z §2.2
(ADR-011). Bilans miesiąca obciąża więc tylko część **niepokryta** odkładaniem:
`−estimated + S_M`. Bez tej linii planer pokazałby, że OC za 2 400 zł „rozwala" marzec,
choć od pół roku się na nie odkłada.

**Cele (krok 7).**

```
fixed               → amount = contribution_amount_minor
percent_of_income   → amount = fromBps(contribution_percent_bps, incomeBase(linie z kroku 1))
none, paused, achieved, archived → brak linii
```

Cel pomijany, gdy w kroku 3 powstała już linia reguły z tym samym `goal_id` — przelew
cykliczny na cel **jest** planem wpłat; dwie linie liczyłyby te same pieniądze dwa razy.
Linie odkładania (krok 6) nie niosą `goal_id`, nawet gdy odkładanie idzie na cel —
inaczej ta sama kwota zaliczyłaby się do oceny celu i do oceny odkładania (§13.4).

**Kopiowanie linii własnych** (`copyManualFrom`). Z szkicu źródłowego przechodzą linie
`origin='manual'` (nazwa, `flow`, kwota, kategoria, źródło przychodu, notatki). `due_on`
przesuwany na ten sam dzień w M (`clampDayToMonth`). Linia z `average_months` dostaje
kwotę ze średniej przeliczonej teraz (§13.3), o ile średnia istnieje — inaczej zostaje
kwota źródłowa.

**Doprecyzowania z `F9-2`** (kod `shared/domain/budget.ts`, `buildBudgetSourceLines`):

- Linia reguły dostaje `due_on` = pierwszy termin reguły w M (podpowiedź do zamiany).
- Odkładanie bez linii, gdy przed terminem rata wynosi 0 (pokryte) albo w miesiącu terminu
  `S_M = 0` (nic nie odłożono); zapłacony planowany wydatek (`posted`) nie daje linii
  odkładania — nie ma już czego odkładać ani skąd wypłacać.
- Nazwy linii odkładania: „Odkładanie: {nazwa}" (+) i „Z odłożonego: {nazwa}" (−).
- Cel z kwotą planu ≤ 0 (np. procent przy zerowych wpływach w szkicu) — bez linii.
- Klucz źródła linii (`origin:id`) jest tym samym podziałem co unikalne indeksy 03 §3.20;
  stan źródła (§13.5) porównuje linie szkicu z wynikiem `buildBudgetSourceLines` po kluczu.

### 13.3 Średnia kategorii

Podpowiedź kwoty dla linii zmiennych („Jedzenie", „Transport"). Ma odpowiadać na pytanie
„ile zwykle wydaję na to **poza** stałymi pozycjami", bo stałe są już w szkicu osobno.

```
W(N)        = N pełnych miesięcy przed bieżącym: [shift(current, −N), shift(current, −1)]
              (nie zależy od M — przy planowaniu na luty najświeższą wiedzą są i tak
               ostatnie pełne miesiące)
dataStart   = miesiąc najwcześniejszej transakcji gospodarstwa poza koszem
months      = miesiące z W(N) nie wcześniejsze niż dataStart
n           = |months|;  n = 0 → średnia null („za mało danych")

spend(c, m) = Σ amount_minor  WHERE type = 'expense' AND status = 'posted'
                                AND deleted_at IS NULL AND month_key = m
                                AND category_id ∈ poddrzewo(c)          -- kategoria + dzieci
                                AND recurring_occurrence_id IS NULL
                                AND planned_expense_id IS NULL
                                AND liability_id IS NULL

average(c)  = ceilToZloty( Σ_{m ∈ months} spend(c, m) / n )
ceilToZloty(x) = ceil(x / 100) × 100
```

- **Miesiące bez wydatku liczą się jako 0.** To średnia miesięczna, a nie średnia
  „miesięcy, w których coś było" — rzadki wydatek (fryzjer co dwa miesiące) ma się
  rozłożyć, nie podwoić. Inaczej niż tempo celu (§4.2), które pyta o coś innego.
- **`dataStart`** chroni nowe gospodarstwo: przy dwóch miesiącach historii średnia
  z 6 dzieli przez 2, nie przez 6.
- **Wyłączenie powiązanych transakcji** zapobiega podwójnemu liczeniu: czynsz zapłacony
  z reguły jest w szkicu linią `recurring`, więc nie może też podbijać średniej
  „Mieszkania".
- **Zaokrąglenie w górę do złotówki** — plan ma być ostrożny (jak rata odkładania,
  §6.5), a grosze w planie są szumem.
- Tylko kategorie wydatkowe. Odpowiedź niesie też kwoty z poszczególnych miesięcy okna
  (do mini-wykresu i podpisu „od 1 450 do 2 210 zł").

**Doprecyzowania z `F9-3`** (`categoryAverages` w `shared/domain/budget.ts`, zapytanie
`categorySpendByMonth` w `transactions.ledger.ts`):

- `byMonth` zawiera tylko miesiące liczone do mianownika (od `dataStart`) — przy pełnej
  historii to całe okno.
- `dataStart` liczy każdą transakcję poza koszem (także przychód i nieksięgowaną) — mówi,
  od kiedy gospodarstwo prowadzi zapis, a nie od kiedy ma wydatki w kategorii.
- Kategorie zarchiwizowane się liczą (także jako podkategorie) — wydatek w nich był
  wydatkiem (§10). Kategoria z sumą 0 w oknie nie trafia na listę.
- Remis średnich — kolejność po nazwie (porównanie polskie).

### 13.4 Ocena szkicu

Liczona przy każdym odczycie z linii **niewykluczonych**. Niczego nie blokuje — tak jak
ostrzeżenia płynności (§6.5), bo użytkownik może wiedzieć coś, czego aplikacja nie wie.

```
income        = Σ amount  WHERE flow = 'income'
incomeBase    = Σ amount  WHERE flow = 'income' AND (źródło puste OR counts_toward_allocation)  -- §2.3
expense       = Σ amount  WHERE flow = 'expense'
savings       = Σ amount  WHERE flow = 'savings'       -- netto, może być ujemne
investment    = Σ amount  WHERE flow = 'investment'    -- jw.
debtRepayment = Σ amount  WHERE flow = 'expense' AND liability_id niepuste
leftover      = income − expense − savings − investment                  -- może być ujemne
```

Rachunek jest lustrem `net(M)` z §12.1 — dzięki temu plan i wykonanie (§13.8) da się
porównać linia w linię.

**Rozkład docelowy.** Wersja rozkładu obowiązująca w M (03 §3.10):

```
target(kind)     = fromBps(targetBps(kind, M), incomeBase)
planned(kind)    = savings | investment | debtRepayment
plannedBps(kind) = toBps(planned(kind), incomeBase)      -- 0 i hasIncomeBase = false przy zerowej podstawie
status(kind)     = planned ≥ target ? 'met' : 'short'
shortfall(kind)  = max(0, target − planned)
```

Linia z `targetBps = 0` nie jest oceniana. Status planu nie ma wariantu „w tempie" —
plan dotyczy całego miesiąca, więc `progress` z §2.5 nie ma tu zastosowania.

**Cele.** Dla każdego aktywnego celu:

```
planned(goal)  = Σ amount linii z goal_id = goal (bez odkładania, §13.2 krok 7)
required(goal) = requiredMonthly z prognozy (§4.2), gdy cel ma kwotę i termin;
                 inaczej plan wpłat celu (fixed → kwota, percent → fromBps(bps, incomeBase));
                 inaczej brak wymagania
status         = brak wymagania → 'no_requirement'
                 planned ≥ required → 'met', inaczej 'short' z brakującą kwotą
```

**Odkładanie.** Dla każdego planowanego wydatku z odkładaniem i `due_month > M`:
`required = req` (§13.2 krok 6), `planned` = kwota jego linii `set_aside` (0, gdy
wykluczona albo usunięta).

**Ostrzeżenia** (lista, kolejność jak w tabeli):

| Kod | Warunek |
|---|---|
| `NEGATIVE_LEFTOVER` | `leftover < 0` — „Plan jest na minusie o X" |
| `NO_INCOME` | brak linii wpływów przy niepustych wydatkach |
| `ALLOCATION_SHORT` | linia rozkładu ze statusem `short` (osobno dla każdej puli) |
| `GOAL_SHORT` | cel ze statusem `short` |
| `SET_ASIDE_SHORT` | odkładanie z `planned < required` |
| `ORPHAN_LINES` | są linie, których źródło usunięto (§13.5 `missing`) |

### 13.5 Stan źródła linii

Liczony przy odczycie dla linii powiązanych w szkicach **edytowalnych** (§13.1):

| `sourceState` | Kiedy |
|---|---|
| `in_sync` | bieżąca kwota źródła dla M (wzory §13.2) = `source_amount_minor` |
| `source_changed` | jest różna — DTO niesie `sourceCurrentAmountMinor` („W regule teraz 1 950 zł") |
| `not_in_month` | źródło istnieje, ale nie daje już nic w M (reguła wstrzymana albo skończona, wydatek przeniesiony, cel wstrzymany) |
| `missing` | wskaźnik pusty — źródło usunięte |

`null` dla linii własnych i w szkicach tylko do odczytu. **Kwota linii różna od
`source_amount_minor`** przy `in_sync` to zwykła edycja w szkicu — UI pokazuje kwotę
źródła jako podpis („w regule 1 850 zł"), bez ostrzeżenia.

„Przyjmij" (`accept-source`) ustawia `amount_minor = source_amount_minor = bieżąca
kwota źródła`. „Zostaw jako własną" zamienia osieroconą linię w `manual` (czyści
`origin` i wskaźniki).

**Doprecyzowania z `F9-4`** (`budget.service.ts`):

- „Przyjmij" działa także przy `in_sync` — cofa edycję w szkicu do kwoty źródła;
  bez źródła w miesiącu (`not_in_month`, `missing`) → `422`. Czyści `average_months`.
- „Zostaw jako własną" tylko przy `missing` — linia z istniejącym źródłem po odłączeniu
  wróciłaby przy odświeżeniu jako druga. Zdejmuje też wykluczenie.
- Zmiana kwoty linii bez podania `averageMonths` czyści pamiątkę średniej — kwota
  wpisana ręcznie nie jest już średnią; zmiana nazwy czy kategorii jej nie rusza.
- Odświeżenie dopisuje nowe linie na koniec (`sort_order` po największym).
- Kwota reguły liczonej w miesiącach z wystąpieniem w M, ale na inny dzień niż obecny
  termin (zmieniony dzień płatności) — liczy się to wystąpienie, raz (ADR-045, §13.2).
- Linia raty bez reguły w bieżącym miesiącu, gdy rata już zapłacona — nadal w planie,
  z dniem ostatniej płatności (`liabilityInstallmentForMonth`).
- Ocena nie wlicza odkładania na konto wydatkowe (nie ma dla niego linii), więc takie
  odkładanie nie daje `SET_ASIDE_SHORT`.

### 13.6 Zamiana linii w byt

Tylko linia `origin='manual'`, niewykluczona, w szkicu edytowalnym, z kwotą > 0.
Byt powstaje przez **serwis docelowego modułu** — te same walidacje, niezmienniki
i komunikaty, co przy zakładaniu z jego ekranu. Wszystko w **jednej transakcji bazy**
z nagłówkiem `Idempotency-Key`: powtórzone żądanie nie zakłada drugiej reguły.

| Linia | Cel zamiany | Co powstaje |
|---|---|---|
| `expense` | `recurring` | reguła `flow='expense'` |
| `income` | `recurring` | reguła `flow='income'` |
| `savings` / `investment` | `recurring` | reguła `flow='transfer'` — konta obu stron **wymagane** w żądaniu |
| `expense` | `planned` | planowany wydatek |
| inne kombinacje | — | `422` |

**→ pozycja cykliczna.** Z linii: nazwa, kwota, kategoria, źródło przychodu, cel.
Z żądania: terminarz (domyślnie `monthly`, dzień z `due_on` linii — bez niego dzień
jest wymagany), konto (konta), `autoPost`, `amountIsEstimate`. `start_month = M`.
Linia staje się `origin='recurring'` ze wskaźnikiem i `source_amount_minor = kwota`.
Istniejące szkice **późniejszych** miesięcy dostają linię tej reguły od razu (jak przy
odświeżeniu), w tej samej transakcji — pozycja cykliczna „od listopada" ma być widać
w szkicu grudnia bez szukania przycisku.

**→ planowany wydatek.** Z linii: nazwa, kwota (jako szacunek), kategoria. Z żądania:
`dueMonth` (domyślnie M, nie wcześniej niż `current`), `dueOn`, priorytet (domyślnie
`should`), `amountIsEstimate` (domyślnie `true`), odkładanie i `repeatsYearly` — pola
jak `POST /planned-expenses`.

- `dueMonth = M` → linia staje się `origin='planned'` ze wskaźnikiem.
- `dueMonth ≠ M` → linia **znika ze szkicu M** (wydatek nie wypada w M), a jeśli
  istnieje szkic `dueMonth` — dostaje linię `planned`. Linie odkładania w szkicach
  pośrednich pojawiają się przy ich odświeżeniu.

Jednorazowy „nadchodzący" wydatek z przyszłą datą to ten sam przypadek: planowany
wydatek z `dueOn` i bez odkładania (16 §2, ADR-077).

### 13.7 Zastosuj w źródle

Przeniesienie kwoty linii **do** źródła. Zawsze jawne, z podsumowaniem skutku przed
zatwierdzeniem; po nim `source_amount_minor = amount_minor`.

| Źródło | Skutek |
|---|---|
| reguła, `M = current` albo `M = start_month` reguły | zmiana kwoty reguły — §6.4 (dotyczy czekających od bieżącego miesiąca) |
| reguła, `M > current` i `M > start_month` | **podział reguły**: stara dostaje `end_month = M − 1`, nowa jest jej kopią z nową kwotą, `start_month = M` i tym samym `end_month`, co miała stara |
| reguła raty zobowiązania (`liabilities.recurring_rule_id`) | `422` — ratę zmienia się w zobowiązaniu (§5), podział zerwałby powiązanie |
| planowany wydatek | zmiana `estimated_amount_minor`; rata odkładania przelicza się sama (§6.5) |
| cel `fixed` | zmiana `contribution_amount_minor` — dotyczy planu celu we wszystkich miesiącach |
| cel `percent_of_income`, odkładanie, rata bez reguły | `422` — kwota jest wyliczana, nie ma czego zapisać |

**Dlaczego podział reguły.** Zmiana kwoty reguły działa od bieżącego miesiąca (§6.4).
Podwyżka czynszu „od grudnia" wpisana w październiku zmieniłaby wtedy czynsz już
za październik i listopad. Podział zachowuje obie prawdy: do listopada 1 850 zł,
od grudnia 1 950 zł — i nie rusza historii (§6.3).

Przy podziale: `anchor_date` nowej reguły to pierwszy termin starego terminarza w M
(dla `biweekly` i `every_n_months` rytm się nie przesuwa); `auto_post`, konta,
kategoria, cel, `is_fixed_expense` i notatki kopiowane. Linie w szkicach od M wzwyż
wskazujące starą regułę przepinają się na nową (kwoty linii bez zmian, poza linią,
z której zastosowano).

**Doprecyzowania z `F9-5`** (`promoteBudgetLine`, `applyBudgetLineToSource`):

- **Zamiana w regułę:** dzień płatności z `due_on` linii, gdy żądanie go nie podaje;
  `is_fixed_expense` tylko dla wydatku. Reguła musi mieć termin w M — inaczej `422`
  i nic nie powstaje (linia należy do M). Linia po zamianie dostaje kwotę i `due_on`
  ze źródła — dla reguły tygodniowej to suma terminów miesiąca (5 × 30 zł).
- **Przelew z linii puli:** klasy wskazanych kont muszą dawać wpłatę do puli linii
  (`transferBudgetFlow` = pula linii, znak +) — inaczej `422` na `counterAccountId`.
- **Zamiana w planowany wydatek:** `due_on` z żądania, a bez niego — z linii, gdy termin
  zostaje w M. Termin wcześniejszy niż bieżący miesiąc → `422`. `lineMovedTo` jest
  zwracane także wtedy, gdy szkicu miesiąca terminu nie ma.
- **„Zastosuj" nie działa dla reguł tygodniowych i co dwa tygodnie** — linia niesie sumę
  kilku terminów, więc nie da się z niej odczytać kwoty jednej płatności
  (`canApplyToSource = false`, `422`). Ich kwotę zmienia się na ekranie *Cykliczne*.
  Dzięki temu podział dotyczy tylko reguł liczonych w miesiącach, a dla nich `anchor_date`
  nie ma znaczenia (domyślna kotwica nowej reguły).
- Kwota reguły z linii wypłaty z puli (kwota ujemna) to jej wartość bezwzględna; kwota
  ≤ 0 → `422`. Podział reguły bez konta → `422` (reguła bez konta nie powstaje, §6.8).
- `fromMonth` w skutku: zmiana kwoty — od bieżącego miesiąca (albo od startu reguły,
  gdy jest późniejszy, §6.4); podział i planowany wydatek — miesiąc szkicu; cel — bieżący
  miesiąc (plan celu nie jest wersjonowany).
- Całość w jednej transakcji bazy razem z kluczem idempotencji (`runIdempotent`):
  błąd walidacji bytu cofa też zmianę linii.

### 13.8 Plan kontra wykonanie

Dla szkiców z `M ≤ current`. Wykonanie z księgi — zawsze `status='posted'`,
`deleted_at IS NULL`, `month_key = M`.

| Linia | Wykonanie |
|---|---|
| `recurring` | Σ `posted_amount_minor` wystąpień reguły w M |
| `planned` | `posted_amount_minor`, gdy transakcja zapłaty jest w M; inaczej 0 |
| `liability` | Σ wydatków z `liability_id` w M bez `recurring_occurrence_id` |
| `set_aside` | Σ efektów alokacji (§2.2) przelewów z `planned_expense_id` w M |
| `goal` | wpłaty netto na cel w M (§4.1) bez przelewów z wystąpień reguł, które mają w szkicu własną linię |
| `manual`, `expense` z kategorią | **grupowo po kategorii głównej**: `spend(c, M)` z §13.3 — jedna kwota wykonania na grupę linii tej kategorii |
| `manual`, `income` ze źródłem | grupowo po źródle: przychody w M z tym źródłem bez `recurring_occurrence_id` |
| `manual` bez kategorii i źródła | brak wykonania (`null`) |

```
actualTotals = totals(M) z §12.1                       -- wpływy, wydatki, pule, net
unplanned    = max(0, expense(M) − Σ wykonań przypisanych liniom wydatków)
```

Grupy z §13.10 mają własne wykonanie w nagłówku, gdy żadne wspólne wykonanie
kategorii nie wychodzi poza grupę.

„Poza planem" (`unplanned`) to wydatki w kategoriach bez linii i bez kategorii — to one
najczęściej tłumaczą, czemu plan się nie domknął. Dwie linie tej samej kategorii
(„Jedzenie — dom", „Jedzenie — wyjście") dzielą jedno wykonanie: księga nie wie, której
linii dotyczy zakup.

**Doprecyzowania z `F9-9`** (`budgetActuals` w `shared/domain/budget.ts`):

- Wykonanie bierze **transakcje z `month_key = M`** — także linii reguły (transakcja
  wystąpienia w M). Zaległe wrześniowe wystąpienie zaksięgowane w październiku liczy się
  w październiku, tak jak w sumach miesiąca (§12.1); bez tego „Wydatki" w kolumnie
  wykonania i suma linii by się rozjechały.
- Linia reguły przelewu (pula) — efekt przelewów reguły **w puli linii** (§2.2), netto.
- Linia własna **wpływu z kategorią** (arkusz linii nie ma wyboru źródła) — grupowo po
  kategorii głównej, przychody bez wystąpienia; ze źródłem — po źródle, jak w tabeli.
- Grupa kategorii liczy tylko transakcje „zmienne" — bez wystąpienia, planowanego
  wydatku i zobowiązania (jak §13.3); tamte mają własne linie albo idą do „Poza planem".
- Linie własne pul i linie pominięte — bez wykonania; wydatki pominiętych linii
  trafiają do „Poza planem".
- Plan ≤ 0 (odkładanie `−S_M`) — wykonanie bez „zostało" i bez paska; udział `0`.

### 13.9 Przypadki brzegowe (każdy z testem)

| Przypadek | Wynik |
|---|---|
| Reguła tygodniowa, miesiąc z 5 terminami | jedna linia, 5 × kwota |
| Reguła z wystąpieniem `skipped` w bieżącym miesiącu | to wystąpienie liczy się jako 0 |
| Reguła wstrzymana / `end_month < M` | brak linii; istniejąca linia → `not_in_month` |
| Przelew oszczędności → inwestycje | brak linii (dwa efekty) |
| Przelew konto wydatkowe → wydatkowe | brak linii |
| Cel z regułą przelewu z tym samym `goal_id` | tylko linia reguły |
| Planowany wydatek z odkładaniem, termin w M | linia `planned` (całość) + linia `set_aside` ujemna (`−S_M`) |
| Odkładanie na konto klasy `spending` | brak linii odkładania |
| Odświeżenie po wykluczeniu linii | linia nie wraca |
| Odświeżenie po zmianie kwoty reguły | linia bez zmian, `source_changed` |
| Średnia przy 2 miesiącach historii, okno 6 | dzielone przez 2 |
| Średnia bez żadnej historii | `null` |
| Średnia kategorii z czynszem z reguły | czynsz nie wchodzi |
| Średnia 1 873,40 zł | 1 874,00 zł |
| `incomeBase = 0` przy rozkładzie 20% | `plannedBps = 0`, `hasIncomeBase = false`, bez `NaN` |
| `leftover < 0` | `NEGATIVE_LEFTOVER`, liczba ujemna pokazana, nie obcięta |
| Zamiana linii z kwotą 0 | `422` |
| Zamiana w planowany z `dueMonth ≠ M`, szkic `dueMonth` istnieje | linia znika z M, pojawia się w `dueMonth` |
| Powtórzona zamiana z tym samym `Idempotency-Key` | jedna reguła |
| „Zastosuj" dla grudnia przy regule od września | podział: wrzesień–listopad stara kwota, od grudnia nowa |
| „Zastosuj" dla reguły raty zobowiązania | `422` |
| Założenie szkicu na `current + 13` albo `current − 1` | `422` |
| Edycja linii w szkicu minionego miesiąca | `409` |
| Usunięcie reguły użytej w szkicu | linia zostaje, `missing` |

### 13.10 Układ szkicu: grupy i kolejność

> **Uzupełnienie Fazy 9** (`F9-11`…`F9-13`, [ADR-081](./14-decisions-log.md#adr-081)).
> Czyste funkcje: `budgetSectionOf`, `sortBudgetLines`, `budgetLayoutKeys`,
> `inheritBudgetLayout`, `groupsByOrigin` w `shared/domain/budget-layout.ts`; wykonanie
> grupy — `groupProgress` w `web/features/budget/budget-view.ts`.

Grupy i kolejność **nie wchodzą do żadnego wyliczenia** z §13.2–§13.8: bilans, ocena,
stan źródła i wykonanie linii liczą się tak samo bez względu na układ.

```
section(line) = 'income'  dla flow = income
                'expense' dla flow = expense
                'pools'   dla flow ∈ {savings, investment}
kolejność w sekcji = grupy po group.sort_order, w każdej linie po line.sort_order;
                     na końcu linie bez grupy, po line.sort_order
```

**Zmiana układu** (`PATCH …/layout`) podaje pełny układ jednej sekcji: każda grupa sekcji
dokładnie raz, każda niewykluczona linia sekcji dokładnie raz. Linie wykluczone (I-24)
zachowują grupę i wracają do niej po „Przywróć". Nowa linia (dopisana, z odświeżenia,
z „Dodaj brakujące") idzie na koniec — swojej grupy albo „Bez grupy". Usunięcie grupy
przenosi jej linie do „Bez grupy" bez zmiany ich kolejności względem siebie.

**Przejście układu na nowy szkic.** Przy zakładaniu szkicu M (każdą drogą):

```
źródło układu = szkic z copyManualFrom, a bez niego najbliższy szkic < M (może nie być)
grupy         = kopia grup źródła (sekcja, nazwa, kolejność) — także pustych
dopasowanie linii nowego szkicu do linii źródła, każda linia źródła najwyżej raz:
  1. klucz źródła:  recurring → rule:id · planned/set_aside → origin:planned_id
                    goal → goal:id · liability → liability:id
                    manual → manual:flow:category_id:nazwa (małymi literami, przycięta)
  2. dla reszty:    flow:nazwa (małymi literami, przycięta)
linia dopasowana  → grupa odpowiednika (po nazwie) i jego miejsce w kolejności źródła
linia bez pary    → „Bez grupy", za dopasowanymi, w kolejności wypełnienia
```

Drugi krok łapie regułę podzieloną przez „Zastosuj w regule" (§13.7 — linie od M
wskazują nową regułę, linie sprzed M starą) i regułę usuniętą i założoną od nowa.

**Szybki start** (`POST …/groups/by-origin`) — tylko w sekcji bez grup:

| Grupa | Linie (niewykluczone) |
|---|---|
| Stałe | `recurring`, `liability` |
| Planowane | `planned`, `set_aside` |
| Zmienne | `manual` (także ze średniej), `goal` |

Puste grupy nie powstają; kolejność linii w grupie — jak przed podziałem.

**Wykonanie grupy** (miesiąc bieżący i miniony, §13.8). Wspólne wykonanie kategorii
(„Jedzenie razem") należy do grupy, gdy **wszystkie** linie tej kategorii są w tej grupie.

```
groupActual(G) = Σ wykonań linii G z własnym wykonaniem (lines[id])
               + Σ wspólnych wykonań kategorii leżących w całości w G
dostępne       ⇔ żadne wspólne wykonanie kategorii nie dzieli G z inną grupą
                 ani z „Bez grupy"; inaczej nagłówek pokazuje sam plan
```

Linie bez wykonania (własne bez kategorii i źródła, własne pul) wnoszą plan, nie
wykonanie — jak w sumach sekcji.

| Przypadek | Wynik |
|---|---|
| Linia w grupie innej sekcji (wpływ do grupy wydatków) | `422` |
| Dwie grupy „Raty" i „raty" w jednej sekcji | `422` |
| Układ bez jednej z niewykluczonych linii albo z linią dwa razy | `422` |
| Układ w szkicu minionego miesiąca | `409` |
| Usunięcie grupy z trzema liniami | linie w „Bez grupy", kolejność między nimi bez zmian |
| Wykluczenie i przywrócenie linii w grupie | wraca do tej samej grupy |
| Szkic grudnia po listopadzie z grupami | te same grupy; czynsz w „Mieszkanie", siłownia z tej samej reguły na tym samym miejscu |
| Reguła podzielona od grudnia (nowy id) | linia grudnia w grupie po nazwie |
| Nowa reguła, której nie było w listopadzie | „Bez grupy", na końcu |
| „Zacznij od zera" po planie z grupami | puste grupy skopiowane |
| Szybki start w sekcji, która ma grupę | `422` |
| Szybki start bez planowanych wydatków | tylko *Stałe* i *Zmienne* |
| „Jedzenie — dom" w grupie A, „Jedzenie — wyjście" w B | nagłówki A i B bez wykonania; wykonanie pod ostatnią z tych linii |
