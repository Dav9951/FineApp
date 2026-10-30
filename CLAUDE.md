# CLAUDE.md — instrukcje dla asystenta AI

Aplikacja do planowania budżetu domowego. SQLite + TypeScript, monorepo pnpm.

## Zanim cokolwiek napiszesz

Przeczytaj [CONTRIBUTING.md](./CONTRIBUTING.md) — twarde zasady, kolejność pracy, pułapki.
Obowiązują w całości, także asystenta AI.

**`plans/` jest źródłem prawdy.** Kod niezgodny z planem jest błędem, nawet jeśli działa.
Jeśli plan trzeba zmienić — najpierw zmień dokument i dopisz wpis do
`plans/14-decisions-log.md`, potem implementuj.

## Mapa dokumentów

| Pracujesz nad | Czytaj |
|---|---|
| czymkolwiek | `02-architecture.md` (konwencje), `11-roadmap.md`, `13-progress.md` |
| bazą, migracją | `03-data-model.md`, `07-domain-rules.md` |
| endpointem | `04-api-spec.md`, `05-dto-contracts.md` |
| obliczeniami | `07-domain-rules.md` — **w całości** |
| ekranem | `06-ui-views.md`, `15-design-system.md`, `05-dto-contracts.md` |
| planerem budżetu | `16-budget-planner.md`, `07-domain-rules.md` §13 |
| OCR / AI | `08-ocr-ai-pipeline.md` |
| logowaniem, uploadem | `09-security-auth.md` |
| Dockerem, wdrożeniem | `10-deployment.md` |

## Struktura

```
apps/api/src/
  core/       config, errors, logger, money, dates, id, clock
  db/         schema (Drizzle), migrations, client, seed
  http/       server, plugins, middleware, error-handler
  ai/         DocumentExtractor, prompty, schematy narzędzi
  modules/    <moduł>/ routes · service · repository · mapper · types

apps/web/src/
  features/   lustro modułów backendu (components/, hooks/, api.ts)
  components/ ui · layout · charts
  lib/        api-client, query-keys, format, cn

packages/shared/src/
  dto/ domain/ utils/ constants/
```

## Polecenia

```bash
pnpm dev              # API :3000 + web :5173
pnpm typecheck
pnpm lint
pnpm format:check     # Prettier; kod bez *.md i design/ (ADR-042)
pnpm test
pnpm db:generate      # migracja ze zmian w schemacie Drizzle
pnpm db:migrate
pnpm db:seed
```

Przed zakończeniem pracy: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`
— zielone. Zmiana kontraktu → popraw `03` / `04` / `05` / `06` / `07`.

<!-- Lokalne, nieśledzone instrukcje (jeśli istnieją) -->
@.private/CLAUDE.md
