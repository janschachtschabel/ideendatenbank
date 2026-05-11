# ============================================================================
# backup-to-gdrive.ps1 — lokale Ideendatenbank-Backups nach Google Drive spiegeln
#
# Wird per Task Scheduler (Windows) zu einer festen Zeit aufgerufen.
# Kopiert alle ZIPs aus backend/data/backups/ in einen rclone-Remote-Ordner.
# Retention auf Drive separat (z.B. 30 Tage).
#
# Vor dem ersten Lauf: scripts\BACKUP-GDRIVE.md durchlesen.
# ============================================================================

[CmdletBinding()]
param(
    [string]$RcloneRemote   = $(if ($env:RCLONE_REMOTE)  { $env:RCLONE_REMOTE }  else { 'gdrive' }),
    [string]$RclonePath     = $(if ($env:RCLONE_PATH)    { $env:RCLONE_PATH }    else { 'HackathOERn-Backups' }),
    [int]   $MaxAgeDays     = $(if ($env:RCLONE_MAX_AGE_DAYS) { [int]$env:RCLONE_MAX_AGE_DAYS } else { 30 })
)

$ErrorActionPreference = 'Stop'

# ─── Pfade ──────────────────────────────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
$BackupDir = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { Join-Path $RepoRoot 'backend\data\backups' }
$LogFile   = if ($env:LOG_FILE)   { $env:LOG_FILE   } else { Join-Path $RepoRoot 'backend\data\backup-to-gdrive.log' }

# ─── Helpers ────────────────────────────────────────────────────────────────
function Write-Log {
    param([string]$Message)
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $line  = "[$stamp] $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

function Die {
    param([string]$Message)
    Write-Log "FEHLER: $Message"
    exit 1
}

# ─── Vorbedingungen ─────────────────────────────────────────────────────────
$logDir = Split-Path -Parent $LogFile
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
    Die "rclone ist nicht installiert oder nicht im PATH. Siehe scripts\BACKUP-GDRIVE.md."
}

if (-not (Test-Path $BackupDir)) {
    Die "Backup-Verzeichnis nicht gefunden: $BackupDir"
}

# Remote vorhanden?
$remotes = & rclone listremotes
if (-not ($remotes -match "^${RcloneRemote}:$")) {
    Die "rclone-Remote '$RcloneRemote' fehlt. 'rclone config' ausführen (siehe BACKUP-GDRIVE.md)."
}

# ─── Upload ─────────────────────────────────────────────────────────────────
Write-Log "Starte Sync $BackupDir  ->  ${RcloneRemote}:$RclonePath"

& rclone copy $BackupDir "${RcloneRemote}:$RclonePath" `
    --checksum `
    --transfers 2 `
    --log-level INFO `
    --log-file $LogFile

if ($LASTEXITCODE -ne 0) { Die "rclone copy fehlgeschlagen (Exit $LASTEXITCODE)" }

# ─── Drive-Retention (optional) ─────────────────────────────────────────────
if ($MaxAgeDays -gt 0) {
    Write-Log "Lösche Drive-ZIPs älter als ${MaxAgeDays}d"
    & rclone delete "${RcloneRemote}:$RclonePath" `
        --min-age "${MaxAgeDays}d" `
        --include "ideendb-backup-*.zip" `
        --log-level INFO `
        --log-file $LogFile

    if ($LASTEXITCODE -ne 0) {
        Write-Log "WARNUNG: Drive-Retention nicht vollständig (kein Abbruch)"
    }
}

Write-Log "Sync OK"
