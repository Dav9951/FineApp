import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { config as loadDotenv } from 'dotenv';

/** Plik oznaczający korzeń repozytorium — dalej w górę nie szukamy. */
const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

/**
 * Szuka pliku `.env` od katalogu startowego w górę, najdalej do korzenia repozytorium.
 *
 * `pnpm --filter @fineapp/api …` uruchamia skrypty z `apps/api`, a `.env` leży
 * w korzeniu — tam, gdzie czyta go `docker compose` (`env_file: .env`). Dotąd
 * `dotenv/config` szukało tylko w bieżącym katalogu i w trybie deweloperskim nie
 * znajdowało niczego (ADR-057). Granica na znaczniku workspace'u chroni przed
 * wczytaniem przypadkowego `.env` z katalogu domowego.
 *
 * @param startDir - Katalog, od którego zaczynamy; domyślnie bieżący.
 * @returns Ścieżka znalezionego pliku albo `null`.
 */
export function findEnvFile(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(dir, WORKSPACE_MARKER))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Wczytuje `.env` do `process.env`, jeśli taki plik istnieje.
 *
 * Zmienne już ustawione w środowisku **wygrywają** z plikiem — w kontenerze
 * konfigurację podaje `docker compose`, a w obrazie `.env` i tak nie ma, więc
 * wywołanie jest tam bezczynne. Wołane z `main()` skryptów, nie przy imporcie,
 * żeby testy nie dostawały zmiennych z deweloperskiego `.env`.
 *
 * @param startDir - Katalog startowy wyszukiwania; domyślnie bieżący.
 * @returns Ścieżka wczytanego pliku albo `null`, gdy go nie było.
 */
export function loadEnvFile(startDir: string = process.cwd()): string | null {
  const path = findEnvFile(startDir);
  if (path) loadDotenv({ path, quiet: true });
  return path;
}
