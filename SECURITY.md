# Bezpieczeństwo

## Zgłaszanie podatności

**Nie zgłaszaj luk bezpieczeństwa w publicznych issues ani pull requestach.**

Użyj prywatnego zgłoszenia: **Security → Report a vulnerability** w tym repozytorium.
Zgłoszenie widzi tylko opiekun projektu.

Opisz:

- czego dotyczy luka (logowanie, upload, API, wdrożenie…),
- jak ją odtworzyć — krok po kroku, na wymyślonych danych,
- jaki widzisz skutek.

Potwierdzenie odbioru — zwykle w ciągu kilku dni. Po poprawce, jeśli chcesz,
wymienimy Cię w opisie zmiany.

## Zakres

Wspierana jest wyłącznie najnowsza wersja z gałęzi `main`. Projekt jest przeznaczony
do samodzielnego hostowania — za konfigurację własnej instancji (`.env`, sekrety,
serwer, brama HTTPS) odpowiada osoba, która ją uruchamia. Zasady bezpieczeństwa
aplikacji: [`plans/09-security-auth.md`](./plans/09-security-auth.md).

## Sekrety

W repozytorium nie ma i nie może być żadnych kluczy, haseł ani danych osobowych
(ADR-083). Jeśli zauważysz coś, co wygląda na prawdziwy sekret — zgłoś to prywatnie
jak podatność.
