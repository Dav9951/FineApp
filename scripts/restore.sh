#!/bin/sh
# Odtworzenie bazy FineApp z kopii (plans/10-deployment.md §5.4).
#
#   scripts/restore.sh /opt/fineapp/backups/fineapp-20260920-033000.db
#
# Kolejność jest celowa:
#   1. kopia do odtworzenia jest SPRAWDZANA, zanim cokolwiek zatrzymamy —
#      uszkodzony plik nie może zastąpić działającej bazy;
#   2. bieżąca baza trafia do /data/backups/pre-restore-*.db — odtworzenie da się cofnąć;
#   3. dopiero wtedy stop, podmiana pliku (bez -wal/-shm starej bazy), start;
#   4. na końcu czekamy na /health — skrypt kończy się sukcesem tylko przy żywej aplikacji.
set -eu

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Użycie: $0 <plik-kopii.db>" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

FILE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "[1/4] Sprawdzam kopię $FILE"
docker compose run --rm --no-deps -T \
  -v "$FILE:/restore/candidate.db:ro" \
  --entrypoint node app dist/scripts/backup.js --verify /restore/candidate.db

echo "[2/4] Zabezpieczam bieżącą bazę"
# Aplikacja może już nie działać (właśnie po to się odtwarza) — wtedy idziemy dalej.
docker compose exec -T app node dist/scripts/backup.js "/data/backups/pre-restore-$STAMP.db" ||
  echo "UWAGA: nie udało się zabezpieczyć bieżącej bazy (aplikacja nie działa?) — kontynuuję."

echo "[3/4] Zatrzymuję aplikację i podmieniam bazę"
docker compose stop app
docker compose run --rm --no-deps -T -u root \
  -v "$FILE:/restore/candidate.db:ro" \
  --entrypoint sh app -c '
    rm -f /data/fineapp.db /data/fineapp.db-wal /data/fineapp.db-shm &&
    cp /restore/candidate.db /data/fineapp.db &&
    chown node:node /data/fineapp.db'

echo "[4/4] Start i czekanie na /health"
docker compose up -d app
i=0
until docker compose exec -T app node -e \
  "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "Aplikacja nie wstała po odtworzeniu. Poprzednia baza: /data/backups/pre-restore-$STAMP.db" >&2
    exit 1
  fi
  sleep 2
done
echo "Odtworzono z $FILE. Poprzednia baza: /data/backups/pre-restore-$STAMP.db"
