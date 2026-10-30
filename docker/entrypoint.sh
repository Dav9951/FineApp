#!/bin/sh
set -e

# Entrypoint kontenera FineApp.
#  1) upewnia się, że katalogi danych istnieją,
#  2) uruchamia migracje bazy (idempotentnie, z kopią przed zmianą),
#  3) oddaje sterowanie procesowi aplikacji.
#
# `set -e` jest tu istotne: nieudana migracja ma ZATRZYMAĆ start kontenera, zamiast
# wpuścić aplikację do bazy w nieznanym stanie. `db/migrate.js` kończy się kodem 1
# przy każdym błędzie, łącznie z niepoprawną konfiguracją.
#
# Migawkę przed migracją robi sam runner, nie ten skrypt: `VACUUM INTO` wymaga otwartego
# połączenia z bazą, a kopiowanie pliku `.db` przy włączonym WAL potrafi dać kopię
# niekompletną (plany/03 §6, ADR-019).

DB_PATH="${DATABASE_PATH:-/data/fineapp.db}"

echo "[entrypoint] Katalog danych: ${DB_PATH}"
mkdir -p "$(dirname "${DB_PATH}")" "${UPLOAD_DIR:-/data/uploads}"

echo "[entrypoint] Uruchamiam migracje..."
node dist/db/migrate.js

echo "[entrypoint] Start aplikacji: $*"
exec "$@"
