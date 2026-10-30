#!/bin/sh
# Kopia poza serwerem (plans/10-deployment.md §5.3): restic → Backblaze B2.
# Plik bazy to pełny obraz finansów gospodarstwa, więc restic szyfruje wszystko na VPS —
# do B2 trafiają wyłącznie zaszyfrowane paczki.
#
# Uruchamiany z crona zaraz po backup.sh:
#   backup.sh && offsite.sh
#
# ~/.config/restic/fineapp.pass   hasło repozytorium — MUSI mieć kopię poza serwerem
#                                 (menedżer haseł); bez niego kopia jest nie do odczytania
# ~/.config/restic/fineapp-b2.env B2_ACCOUNT_ID / B2_ACCOUNT_KEY — klucz aplikacji B2
#                                 ograniczony do jednego bucketu
set -eu

B2_ENV="${B2_ENV:-$HOME/.config/restic/fineapp-b2.env}"
set -a
. "$B2_ENV"
set +a

: "${RESTIC_REPOSITORY:?ustaw RESTIC_REPOSITORY, np. b2:nazwa-bucketu:fineapp}"
: "${RESTIC_PASSWORD_FILE:=$HOME/.config/restic/fineapp.pass}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/projects/fineapp/backups}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE

# 1) Kopie z BACKUP_DIR (bazy + archiwa uploadów); restic deduplikuje, więc
#    14 dobowych kopii bazy kosztuje niewiele więcej niż jedna.
restic backup --quiet --tag fineapp --exclude 'backup.log' "$BACKUP_DIR"

# 2) Retencja poza serwerem dłuższa niż na serwerze: 14 dni, 8 tygodni, 12 miesięcy
restic forget --quiet --tag fineapp --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune

# 3) W niedzielę sprawdzenie struktury repozytorium (bez pobierania całości)
if [ "$(date +%u)" = "7" ]; then
  restic check --quiet
fi

echo "Kopia poza serwerem gotowa: $RESTIC_REPOSITORY ($(date '+%F %T'))"
