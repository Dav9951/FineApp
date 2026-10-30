# 16 — Planer budżetu (szkic miesiąca)

> **Stan:** zrobione — **Faza 9** zamknięta 2026-10-27, [11-roadmap.md](./11-roadmap.md).
> Decyzje: [ADR-075](./14-decisions-log.md#adr-075) … [ADR-079](./14-decisions-log.md#adr-079).
> Wymaganie **#14** w [00 §4](./00-project-overview.md#4-zakres--mapowanie-wymagań).

Ten dokument opisuje funkcję w całości — po co jest, jak się jej używa i jak łączy się
z resztą aplikacji. Szczegóły kontraktowe żyją tam, gdzie wszystkie inne:

| Co | Gdzie |
|---|---|
| tabele `budget_drafts`, `budget_draft_lines`, niezmienniki I-20…I-24 | [03 §3.19–3.20](./03-data-model.md#319-budget_drafts) |
| endpointy `/api/v1/budget-drafts` | [04 §14a](./04-api-spec.md#14a-planer-budżetu--apiv1budget-drafts) |
| DTO `dto/budget.ts` | [05 §13b](./05-dto-contracts.md#13b-planer-budżetu--dtobudgetts) |
| ekrany `/budget`, `/budget/:month` | [06 §3.14](./06-ui-views.md#314-planer-budżetu--budget-budgetmonth) |
| wypełnianie, średnia, ocena szkicu, plan kontra wykonanie | [07 §13](./07-domain-rules.md#13-planer-budżetu) |

---

## 1. Po co

Pod koniec miesiąca albo na jego początku chcę **rozpisać budżet na następny miesiąc**
i zobaczyć, czy przy takim planie dowiozę cele: rozkład procentowy (20% oszczędności,
10% inwestycji), cele z terminem, odkładanie na planowane wydatki — i czy w ogóle
zostanie coś „na życie".

Dziś aplikacja zna większość składników, ale rozrzucone po pięciu ekranach: pozycje
cykliczne, planowane wydatki, cele, zobowiązania, rozkład docelowy. Nie zna natomiast
rzeczy, które dopiero przychodzą do głowy przy planowaniu: „w listopadzie prezent dla
mamy 300 zł", „na jedzenie dam 1 900 zł", „w grudniu wyjazd na narty".

Planer to **jedna kartka na miesiąc**, na której:

1. to, co aplikacja już wie, pojawia się samo (cykliczne, planowane, raty, cele),
2. wszystko da się zmienić i dopisać ręcznie,
3. dopisaną pozycję można jednym ruchem zamienić w coś, co aplikacja będzie pamiętać —
   pozycję cykliczną albo planowany (nadchodzący) wydatek,
4. na dole widać bilans i ocenę: czy plan dowozi cele.

## 2. Pojęcia

| Pojęcie | Znaczenie |
|---|---|
| **Szkic** (`budget_drafts`) | Plan jednego miesiąca gospodarstwa. Najwyżej jeden na miesiąc, wspólny dla obu domowników. |
| **Linia** (`budget_draft_lines`) | Pozycja szkicu: wpływ, wydatek, oszczędności albo inwestycje — nazwa, kwota, opcjonalnie kategoria. |
| **Źródło linii** (`origin`) | Skąd linia przyszła: `manual` (dopisana), `recurring` (pozycja cykliczna), `planned` (planowany wydatek w tym miesiącu), `set_aside` (odkładanie na planowany wydatek albo wypłata z odłożonego), `goal` (plan wpłat celu), `liability` (rata zobowiązania bez reguły). |
| **Linia powiązana** | Każda o źródle innym niż `manual`. Pamięta, z czego powstała, i kwotę źródła z chwili wypełnienia. |
| **Linia własna** | `origin = manual` — istnieje **tylko w szkicu**. To domyślny i najczęstszy przypadek („tylko w tym miesiącu"). |
| **Zamiana** (`promote`) | Przerobienie linii własnej na pozycję cykliczną albo planowany wydatek. Linia staje się powiązana. |
| **Zastosuj w źródle** | Świadome przeniesienie kwoty ze szkicu do źródła (np. czynsz od grudnia 1 950 zł). Bez tego edycja w szkicu **nie zmienia** niczego poza szkicem. |
| **Średnia kategorii** | Przeciętny miesięczny wydatek zmienny kategorii z 3, 6 albo 12 pełnych miesięcy — podpowiedź kwoty dla linii typu „Jedzenie". |
| **Grupa** (`budget_draft_groups`) | Nazwany zbiór linii jednej sekcji szkicu („Raty”). Tylko układ — nie zmienia sum ani oceny. Przechodzi na następny szkic razem z kolejnością. |
| **Ocena szkicu** | Bilans (wpływy − wydatki − oszczędności − inwestycje) i porównanie z rozkładem docelowym, celami i odkładaniem. Informuje, nie blokuje. |

**„Nadchodzący" wydatek to planowany wydatek.** W aplikacji jednorazowy wydatek
z przyszłą datą jest planowanym wydatkiem (`planned_expenses`) z ustawionym `due_on`
i bez odkładania — pokazuje się w „Nadchodzące" na dashboardzie, a w swoim miesiącu
w „Do zrobienia" z „Zapłacone". Nie wprowadzamy trzeciego bytu ([ADR-077](./14-decisions-log.md#adr-077)).

## 3. Scenariusze

### 3.1 Koniec października — plan na listopad

1. *Więcej → Budżet* (albo podpowiedź „Zaplanuj listopad" na dashboardzie w ostatnim
   tygodniu miesiąca). Listopad nie ma szkicu → stan pusty z trzema drogami:
   **Utwórz z danych** · **Skopiuj z października** · **Zacznij od zera**.
2. „Utwórz z danych" otwiera arkusz: co wciągnąć (cykliczne, planowane, raty, cele —
   domyślnie wszystko) oraz lista kategorii ze średnią z 3 miesięcy do odhaczenia
   („Jedzenie ~1 874 zł", „Transport ~642 zł"…).
3. Szkic: wpływy (pensje z reguł), wydatki stałe (czynsz, rata, Netflix), planowane na
   listopad (przegląd 800 zł), odkładanie na OC (170 zł), cele (wkład własny 2 000 zł),
   zmienne ze średniej (Jedzenie 1 874 zł).
4. Poprawiam „Jedzenie" na 1 900 zł, dopisuję „Prezent dla mamy 300 zł", usuwam
   Netflix (linia powiązana — trafia do „Pominięte w planie", reguła zostaje).
5. Na dole: „Zostaje 236 zł · Oszczędności 18,4% z 20% — brakuje 190 zł".
   „Dodaj brakujące 190 zł do oszczędności" dopisuje linię własną.

### 3.2 Z dopisanej linii do pozycji, którą aplikacja zapamięta

- „Siłownia 149 zł" dopisana do szkicu → *Zamień → Wydatek cykliczny* → arkusz
  terminarza (co miesiąc, dzień 5, od listopada 2026, konto) → reguła powstaje, linia
  zmienia się w powiązaną (`recurring`).
- „Narty ~3 000 zł" dopisane w listopadzie → *Zamień → Planowany wydatek* → termin
  luty 2027, data 14.02 → planowany wydatek z odkładaniem albo bez. Termin poza
  listopadem: linia **znika ze szkicu listopada** (wydatek nie wypada w listopadzie),
  a jeśli szkic lutego istnieje — pojawia się tam jako `planned`.
- „Prezent 300 zł" zostaje linią własną — nie wszystko musi być bytem.

### 3.3 Z bytu do szkicu i z powrotem

- Czynsz podnoszą od grudnia: w szkicu grudnia zmieniam 1 850 → 1 950 zł i wybieram
  **Zastosuj w regule** → „od grudnia 2026: 1 950 zł, do listopada zostaje 1 850 zł".
  Reguła dzieli się na dwie (stara kończy się w listopadzie), szkice od grudnia
  przechodzą na nową ([ADR-076](./14-decisions-log.md#adr-076)).
- OC w marcu wychodzi drożej: w szkicu marca 2 400 → 2 650 zł → *Zastosuj w planowanym*
  → szacunek planowanego wydatku zmienia się, rata odkładania przelicza się sama.
- Zmieniłem kwotę w regule na ekranie *Cykliczne*: szkice pokazują przy linii
  „W regule teraz 1 950 zł" z „Przyjmij". Szkic niczego nie nadpisuje sam.

### 3.4 Kilka miesięcy naprzód

Szkic można założyć na miesiąc bieżący i do **12 miesięcy naprzód**. Przełącznik
`‹ grudzień 2026 ›` jak na ekranie miesiąca; lista `/budget` pokazuje istniejące szkice
z bilansem. Szkic grudnia wypełnia się z tych samych źródeł, liczonych dla grudnia
(pensja i czynsz z reguł, raty, planowane na grudzień).

### 3.4a Układam listę

Wydatków jest piętnaście i nie widać, ile idzie na mieszkanie, a ile na raty.
*Układaj* przy sekcji → „Podzielić na grupy?" → *Utwórz grupy* (Stałe / Planowane /
Zmienne) albo *Sam ułożę* → *+ Nowa grupa* „Mieszkanie i media" → przeciągam czynsz,
prąd i internet pod nagłówek → *Gotowe*. Nagłówek grupy pokazuje sumę; „Subskrypcje"
zwijam. W grudniu szkic ma te same grupy i te same pozycje w nich — układam raz
([ADR-081](./14-decisions-log.md#adr-081), 07 §13.10).

### 3.5 Miesiąc trwa i się kończy

W trwającym i minionych miesiącach szkic pokazuje **plan kontra wykonanie**: przy linii
kwota planu i wykonania, przy kategoriach „Jedzenie: 1 900 plan · 1 450 wydano",
na dole „Poza planem: 320 zł". Szkic minionego miesiąca jest tylko do odczytu.

## 4. Zakres

**W zakresie (Faza 9):** szkic na miesiąc (bieżący … +12), wypełnianie ze źródeł,
kopiowanie linii własnych z innego szkicu, średnie kategorii, edycja i dopisywanie,
pomijanie linii powiązanych, zamiana linii w regułę cykliczną albo planowany wydatek,
„Zastosuj w źródle", ocena szkicu, plan kontra wykonanie, wejścia z *Więcej*
i z dashboardu, eksport i „Usuń wszystkie dane".
Uzupełnienie (`F9-11`…`F9-13`): grupy linii w sekcjach, kolejność przeciąganiem,
układ przechodzący na następny miesiąc.

**Poza zakresem:**

- **Szkic nie jest księgą.** Nie tworzy transakcji, wystąpień ani ostrzeżeń na
  dashboardzie; linia własna nie pojawia się w „Do zrobienia". Od tego jest zamiana
  w planowany wydatek.
- Budżety kwotowe pilnowane w ciągu miesiąca („przekroczyłeś Jedzenie o 10%") —
  plan kontra wykonanie pokazuje to na ekranie szkicu, ale bez powiadomień i bez kafla
  na dashboardzie. Do rozważenia po Fazie 9 (11, „Po v1").
- Prognoza salda kont na podstawie szkiców (szkic mówi o przepływie miesiąca, nie
  o stanie kont) — prognoza płynności zostaje w planowanych wydatkach (07 §6.5).
- Zatwierdzanie, wersje i historia zmian szkicu — szkic jest jeden i żywy.
- Przypisywanie linii do osoby („moje / twoje").

## 5. Pytania rozstrzygnięte

Wszystkie pięć **potwierdzone przez właściciela 2026-10-27** bez zmian — plan
obowiązuje w brzmieniu z ADR-075…079.

| # | Pytanie | Rozstrzygnięcie |
|---|---|---|
| P-1 | Czy „nadchodzący wydatek z przyszłą datą" to planowany wydatek z dokładną datą? | Tak — bez nowego bytu (ADR-077) |
| P-2 | Czy linia własna ma się pokazać na dashboardzie (np. w „Do zrobienia")? | Nie — tylko w szkicu; plan kontra wykonanie na ekranie szkicu |
| P-3 | Domyślne okno średniej | 3 pełne miesiące; do wyboru 6 i 12 (ADR-078) |
| P-4 | Szkic wspólny dla obu domowników? | Tak, jeden na miesiąc gospodarstwa (ADR-075) |
| P-5 | Szkic minionego miesiąca edytowalny? | Nie — tylko odczyt; bieżący i przyszłe edytowalne |
