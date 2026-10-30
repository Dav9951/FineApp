# FineApp — dokumentacja planów

Katalog `plans/` jest **jedynym źródłem prawdy** o zamierzeniach projektu. Kod implementuje
to, co tu opisano; jeżeli kod i plan się rozjeżdżają — najpierw aktualizujemy plan
(lub wpis w dzienniku decyzji), potem kod.

## Jak czytać

| # | Dokument | Co zawiera | Dla kogo |
|---|----------|------------|----------|
| 00 | [00-project-overview.md](./00-project-overview.md) | Cel, zakres, persony, słownik pojęć, mapowanie wymagań | wszyscy |
| 01 | [01-tech-stack.md](./01-tech-stack.md) | Stos technologiczny + uzasadnienia | wszyscy |
| 02 | [02-architecture.md](./02-architecture.md) | Warstwy, struktura katalogów, konwencje kodu | implementacja |
| 03 | [03-data-model.md](./03-data-model.md) | Schemat bazy (DDL), indeksy, niezmienniki | implementacja |
| 04 | [04-api-spec.md](./04-api-spec.md) | Wszystkie endpointy REST | implementacja |
| 05 | [05-dto-contracts.md](./05-dto-contracts.md) | Kontrakty DTO (Zod) współdzielone FE/BE | implementacja |
| 06 | [06-ui-views.md](./06-ui-views.md) | Ekrany, układy, nawigacja, design system | implementacja FE |
| 07 | [07-domain-rules.md](./07-domain-rules.md) | Reguły domenowe: pieniądz, daty, alokacje, cykle | implementacja |
| 08 | [08-ocr-ai-pipeline.md](./08-ocr-ai-pipeline.md) | Pipeline OCR/AI, prompty, schematy narzędzi | implementacja |
| 09 | [09-security-auth.md](./09-security-auth.md) | Logowanie e-mail + PIN, sesje, model zagrożeń | implementacja |
| 10 | [10-deployment.md](./10-deployment.md) | Docker, VPS, backupy, zmienne środowiskowe | ops |
| 11 | [11-roadmap.md](./11-roadmap.md) | Fazy, kamienie milowe, definicja ukończenia | planowanie |
| 13 | [13-progress.md](./13-progress.md) | Stan faz, sprawy zauważone do rozważenia, wskaźniki jakości | wszyscy |
| 14 | [14-decisions-log.md](./14-decisions-log.md) | Dziennik decyzji (ADR) i odstępstw od założeń | wszyscy |
| 15 | [15-design-system.md](./15-design-system.md) | Tokeny, prymitywy, reguły wizualne | implementacja FE |
| 16 | [16-budget-planner.md](./16-budget-planner.md) | Planer budżetu (Faza 9): po co, pojęcia, scenariusze, zakres | wszyscy |

## Zasada aktualizacji

Przy każdej zmianie, która tego wymaga:

1. Jeżeli coś zmieniło się względem założeń — dopisz wpis do [14-decisions-log.md](./14-decisions-log.md).
2. Jeżeli zmienił się kontrakt (DB/API/DTO/ekran/reguła) — popraw odpowiedni dokument 03–07.
3. Sprawy zauważone poza zakresem zmiany — dopisz do „Zauważone" w [13-progress.md](./13-progress.md).

Zasady pracy z kodem: [CONTRIBUTING.md](../CONTRIBUTING.md).
