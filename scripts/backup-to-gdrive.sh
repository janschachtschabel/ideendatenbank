#!/usr/bin/env bash
# ============================================================================
# backup-to-gdrive.sh — lokale Ideendatenbank-Backups nach Google Drive spiegeln
#
# Wird per Cron (Linux/macOS) zu einer festen Zeit aufgerufen und kopiert
# alle ZIPs aus backend/data/backups/ in einen rclone-Remote-Ordner.
# Retention auf Drive separat (z.B. 30 Tage) — die lokale Retention regelt
# weiterhin die App.
#
# Vor dem ersten Lauf: scripts/BACKUP-GDRIVE.md durchlesen.
# ============================================================================

set -euo pipefail

# ─── Konfiguration ──────────────────────────────────────────────────────────
# Pfad zum Backup-Verzeichnis der App (relativ zum Repo-Root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backend/data/backups}"

# Name des rclone-Remotes (aus `rclone config` — z.B. "gdrive").
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive}"

# Zielordner-Pfad im Remote (wird angelegt, falls nicht vorhanden).
RCLONE_PATH="${RCLONE_PATH:-HackathOERn-Backups}"

# Drive-Retention: ZIPs älter als N Tage löschen (0 = nie löschen).
RCLONE_MAX_AGE_DAYS="${RCLONE_MAX_AGE_DAYS:-30}"

# Log-Datei (rotiert von außen über logrotate, oder einfach klein gehalten).
LOG_FILE="${LOG_FILE:-$REPO_ROOT/backend/data/backup-to-gdrive.log}"

# ─── Helpers ────────────────────────────────────────────────────────────────
log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" | tee -a "$LOG_FILE"
}

die() {
  log "FEHLER: $*"
  exit 1
}

# ─── Vorbedingungen ─────────────────────────────────────────────────────────
mkdir -p "$(dirname "$LOG_FILE")"

command -v rclone >/dev/null 2>&1 \
  || die "rclone ist nicht installiert. Siehe scripts/BACKUP-GDRIVE.md."

[[ -d "$BACKUP_DIR" ]] \
  || die "Backup-Verzeichnis nicht gefunden: $BACKUP_DIR"

# Prüfen, dass der Remote konfiguriert ist.
if ! rclone listremotes | grep -q "^${RCLONE_REMOTE}:"; then
  die "rclone-Remote '${RCLONE_REMOTE}' fehlt. 'rclone config' ausführen (siehe BACKUP-GDRIVE.md)."
fi

# ─── Upload ─────────────────────────────────────────────────────────────────
log "Starte Sync $BACKUP_DIR  →  ${RCLONE_REMOTE}:${RCLONE_PATH}"

# `copy` legt nur neue/geänderte Dateien an — vorhandene werden nicht gelöscht.
# `--checksum` ist robust gegen Mtime-Differenzen zwischen ext4/Drive.
rclone copy "$BACKUP_DIR" "${RCLONE_REMOTE}:${RCLONE_PATH}" \
  --checksum \
  --transfers 2 \
  --log-level INFO \
  --log-file "$LOG_FILE" \
  || die "rclone copy fehlgeschlagen"

# ─── Drive-Retention (optional) ─────────────────────────────────────────────
if [[ "$RCLONE_MAX_AGE_DAYS" -gt 0 ]]; then
  log "Lösche Drive-ZIPs älter als ${RCLONE_MAX_AGE_DAYS}d"
  rclone delete "${RCLONE_REMOTE}:${RCLONE_PATH}" \
    --min-age "${RCLONE_MAX_AGE_DAYS}d" \
    --include "ideendb-backup-*.zip" \
    --log-level INFO \
    --log-file "$LOG_FILE" \
    || log "WARNUNG: Drive-Retention nicht vollständig (kein Abbruch)"
fi

log "Sync OK"
