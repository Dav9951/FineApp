import { createRequire } from 'node:module';

import { systemClock } from './core/clock.js';
import { loadConfig } from './core/config.js';
import { loadEnvFile } from './core/env-file.js';
import { createDb } from './db/client.js';
import { buildServer } from './http/server.js';
import { warmUpDummyPinHash } from './modules/auth/auth.pin.js';
import { failInterruptedDocuments } from './modules/documents/documents.service.js';
import { pruneDeadSessions, pruneLoginAttempts } from './modules/auth/auth.service.js';

/**
 * Bootstrap aplikacji: konfiguracja → baza → serwer → nasłuch.
 *
 * Migracje **nie są** tutaj uruchamiane — robi to `docker/entrypoint.sh` przed startem
 * procesu ([03 §6](../../../plans/03-data-model.md#6-strategia-migracji)). Gdyby
 * uruchamiał je serwer, dwa restartujące się kontenery mogłyby migrować równolegle.
 */

/**
 * Odczytuje wersję aplikacji z `package.json`.
 *
 * Ścieżka `../package.json` działa w obu układach: w trybie deweloperskim moduł leży
 * w `src/`, a w kontenerze w `dist/` — w obu przypadkach `package.json` jest katalog wyżej.
 *
 * @returns Wersja z `package.json` albo `0.0.0`, gdy nie da się jej odczytać.
 */
function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg: unknown = require('../package.json');
    if (typeof pkg === 'object' && pkg !== null && 'version' in pkg) {
      return String(pkg.version);
    }
  } catch {
    // Brak pliku nie jest powodem, żeby nie wstać — wersja jest informacyjna.
  }
  return '0.0.0';
}

/**
 * Uruchamia serwer.
 *
 * @returns Obietnica spełniona po rozpoczęciu nasłuchu.
 */
async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const db = createDb(config);
  const app = await buildServer({ config, db, version: readVersion() });

  // Historia prób logowania rośnie o wiersz na każdą próbę, także nieudaną i także dla
  // adresów, które nie istnieją — przy ataku szybciej niż cała reszta bazy (03 §3.4).
  const prunedAttempts = pruneLoginAttempts(db, systemClock);
  if (prunedAttempts > 0) {
    app.log.info({ pruned: prunedAttempts }, 'Usunięto starą historię prób logowania');
  }

  // Analiza biegnie w tle procesu, więc restart w jej trakcie zostawia dokument
  // w `processing` na zawsze — przy starcie oznaczamy go jako przerwany (08 §2).
  const interrupted = failInterruptedDocuments(db, systemClock);
  if (interrupted > 0) {
    app.log.warn({ interrupted }, 'Oznaczono przerwane analizy dokumentów');
  }

  // Rotacja dokłada wiersz przy każdym odświeżeniu, więc `auth_sessions` rośnie
  // szybciej niż liczba urządzeń (03 §3.3).
  const prunedSessions = pruneDeadSessions(db, systemClock);
  if (prunedSessions > 0) {
    app.log.info({ pruned: prunedSessions }, 'Usunięto martwe sesje');
  }

  // Hash-atrapa liczona teraz, a nie przy pierwszym nieudanym logowaniu — inaczej to
  // właśnie tamto żądanie byłoby zauważalnie wolniejsze (09 §2.4, krok 4).
  await warmUpDummyPinHash();

  const shutdown = (signal: string): void => {
    app.log.info({ signal }, 'Zamykanie serwera');
    void app.close().then(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  await app.listen({ port: config.server.port, host: config.server.host });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
