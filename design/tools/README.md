# Narzędzia projektowe

## `palette_audit.py`

Wykonywalna wersja dwóch punktów listy kontrolnej z
[`plans/15-design-system.md`](../../plans/15-design-system.md) §10:

- *kontrast sprawdzony w obu motywach (tekst 4,5:1, interfejs 3:1)*
- *para wpływy/wydatki rozróżnialna przy deuteranopii*

```bash
python3 design/tools/palette_audit.py
```

Kod wyjścia `0` = bez naruszeń, `1` = są naruszenia. Bez zależności zewnętrznych —
sama biblioteka standardowa.

**Skrypt czyta `apps/web/src/styles/tokens.css`.** Nie trzyma własnej kopii wartości,
więc nie da się z nim rozjechać: zmieniasz token, uruchamiasz audyt, masz odpowiedź.
Brakujący token w którymkolwiek motywie jest błędem, nie ostrzeżeniem.

### Co liczy

| Sprawdzenie | Próg | Skąd |
|---|---|---|
| tekst na `--background` i `--card` | 4,5:1 | WCAG AA, zasada `15 §2.10` |
| barwy semantyczne na `--muted` | 3,0:1 | plakietki i banery mają tło drugorzędne |
| `--input`, `--ring`, `--primary` | 3,0:1 | elementy interfejsu, `15 §2.10` |
| `--muted-foreground` na `--muted` | 4,5:1 | podpisy bywają na tle drugorzędnym |
| `--border` | — | separator dekoracyjny, bez progu |
| pary krytyczne | ΔE76 | widzenie typowe + deuteranopia + protanopia |

Symulacja daltonizmu: macierze Machado (2009), nasilenie pełne, stosowane w liniowym RGB.

### Dlaczego liczba, a nie „na oko”

Przy dichromatyzmie z barwy zostaje oś żółto-niebieska i jasność. `--savings` (błękit)
i `--investment` (fiolet) różnią się wtedy prawie wyłącznie jasnością — a stoją na
sąsiednich pierścieniach kafla „Cele procentowe”. Liczba mówi, czy rozdział wystarcza.
Oko projektanta z pełnym widzeniem barw tego nie powie.

To samo narzędzie wykryło ustalenie zapisane w ADR-013: `--debt` i `--warning` w tej
samej strefie ciepłej dają przy deuteranopii ΔE ≈ 3, czyli są nierozróżnialne —
a zaległa rata to dokładnie ta sytuacja, w której oba kolory stoją obok siebie.
Dlatego `--debt` siedzi na osi różu/śliwki, nie bursztynu.

### Uwaga o parsowaniu

Skrypt wycina komentarze przed odczytem tokenów. Bez tego zapis w rodzaju
`sąsiadując z --investment: jedno i drugie…` wygląda jak deklaracja i połyka
wszystko do najbliższego średnika — razem z prawdziwym tokenem stojącym niżej.
Audyt pomijał wtedy w ciszy cały motyw jasny i kończył się sukcesem. Jeżeli
kiedykolwiek liczba sprawdzeń spadnie skokowo, to jest pierwsze miejsce do obejrzenia.
