#!/bin/sh
# Kopia zapasowa FineApp (plans/10-deployment.md §5): spójna migawka bazy + archiwum uploadów.
# Retencja: 14 dobowych kopii bazy, 8 tygodniowych archiwów uploadów.
#
# Uruchamiany z hosta, z katalogu repozytorium albo przez cron:
#   30 3 * * * /opt/fineapp/scripts/backup.sh >> /var/log/fineapp-backup.log 2>&1
#
# Migawkę robi i od razu SPRAWDZA skrypt aplikacji (`dist/scripts/backup.js`):
# VACUUM INTO + PRAGMA integrity_check. Uszkodzona kopia kończy skrypt kodem 1,
# więc cron zapisze błąd w logu, a rotacja nie usunie ostatniej dobrej kopii.
#
# Volumen danych nazywa się w Dockerze `<projekt>_fineapp-data`, nie `fineapp-data` —
# dlatego wszystko idzie przez `docker compose`, który zna tę nazwę sam.
set -eu

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/opt/fineapp/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 1) Spójna migawka bazy, sprawdzona przed skopiowaniem na hosta
docker compose exec -T app node dist/scripts/backup.js /data/backups/snapshot.db
docker compose cp app:/data/backups/snapshot.db "$BACKUP_DIR/fineapp-$STAMP.db"
docker compose exec -T app rm -f /data/backups/snapshot.db
chmod 600 "$BACKUP_DIR/fineapp-$STAMP.db"

# 2) Uploady — tygodniowo (w niedzielę) albo na żądanie: FORCE_UPLOADS=1
if [ "$(date +%u)" = "7" ] || [ "${FORCE_UPLOADS:-0}" = "1" ]; then
  docker compose exec -T app tar czf - -C /data uploads > "$BACKUP_DIR/uploads-$STAMP.tar.gz"
  chmod 600 "$BACKUP_DIR/uploads-$STAMP.tar.gz"
fi

# 3) Rotacja — dopiero po udanej kopii (set -e przerwał wyżej, jeśli coś poszło źle)
ls -1t "$BACKUP_DIR"/fineapp-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +9 | xargs -r rm -f

# 4) Migawki w wolumenie — pre-migration-* (runner migracji) i pre-restore-* (restore.sh)
#    nie miały rotacji; zostaje 5 najnowszych z każdego rodzaju (kopie na hoście są wyżej)
docker compose exec -T app sh -c '
for kind in pre-migration pre-restore; do
  ls -1t /data/backups/"$kind"-*.db 2>/dev/null | tail -n +6 | xargs -r rm -f
done'

echo "Kopia gotowa: $BACKUP_DIR/fineapp-$STAMP.db"
