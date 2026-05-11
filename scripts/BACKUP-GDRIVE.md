# Backup → Google Drive Spiegelung

Ergänzt das eingebaute lokale Backup-System (`backend/data/backups/`) um eine
automatische Spiegelung in einen Google-Drive-Ordner. Läuft komplett **außerhalb**
der Ideendatenbank-App über `rclone` + System-Scheduler — kein App-Restart,
keine Code-Änderung, kein GCP-Service-Account.

## Was du dafür brauchst

- `rclone` (CLI-Tool, frei)
- Einen Google-Account mit Schreibrechten in einem Drive-Ordner
- Cron (Linux/macOS) oder Task Scheduler (Windows)

## 1. rclone installieren

| OS | Befehl |
|---|---|
| **Linux** (Debian/Ubuntu) | `sudo apt install rclone` |
| **Linux** (universal) | `curl https://rclone.org/install.sh \| sudo bash` |
| **macOS** | `brew install rclone` |
| **Windows** | `winget install Rclone.Rclone` &nbsp; oder Download von rclone.org/downloads |

Verifizieren:
```bash
rclone version
```

## 2. Google-Drive-Remote einrichten (einmalig, interaktiv)

```bash
rclone config
```

Schrittweise:

1. `n` → New remote
2. Name: **`gdrive`** (oder beliebig — dann später als `RCLONE_REMOTE` setzen)
3. Storage: aus der Liste **Google Drive** wählen (Nummer kann variieren, ein Stichwort eingeben funktioniert)
4. **client_id / client_secret**: leer lassen (Enter) — nutzt rclones eigene Default-App. Reicht für persönliche Backups.
5. **scope**: `1` (= `drive` — voller Zugriff) **oder** `2` (= `drive.file` — nur auf vom Tool angelegte Dateien, sicherer).
   - Empfehlung: **`2` (drive.file)** — `rclone` sieht dann ausschließlich, was es selbst hochlädt.
6. **root_folder_id**: leer lassen.
7. **service_account_file**: leer lassen.
8. **Auto config**: `y`, falls der Server eine Browser-GUI hat. Sonst `n` → rclone gibt dir einen URL, den du auf einer Maschine mit Browser öffnest, dort den Login machst und den Code zurück in die Console kopierst.
9. **team_drive (Shared Drive)**: meist `n` (nein) — nur `y` wählen, wenn du einen Shared Drive nutzt.
10. Bestätigen, `q` zum Verlassen.

Test, ob alles funktioniert:
```bash
rclone lsd gdrive:
# Sollte deine obersten Drive-Ordner zeigen
```

## 3. Zielordner anlegen (optional, geschieht sonst automatisch beim ersten Sync)

```bash
rclone mkdir gdrive:HackathOERn-Backups
```

> **Hinweis bei `scope=drive.file`:** `rclone lsd gdrive:` zeigt nur Ordner an, die
> rclone selbst angelegt hat. Das ist gewollt und kein Fehler.

## 4. Script-Lauf testen

### Linux / macOS

```bash
cd /pfad/zu/ideendatenbank
chmod +x scripts/backup-to-gdrive.sh
./scripts/backup-to-gdrive.sh
```

### Windows

```powershell
cd C:\Users\jan\staging\Windsurf\ideendatenbank
.\scripts\backup-to-gdrive.ps1
```

Im Drive sollten jetzt die ZIPs aus `backend/data/backups/` liegen.
Logfile: `backend/data/backup-to-gdrive.log`.

## 5. Zeitplan einrichten

### Linux / macOS — Cron

```bash
crontab -e
```

Beispiel: täglich 04:15 UTC:
```cron
15 4 * * *  /pfad/zu/ideendatenbank/scripts/backup-to-gdrive.sh
```

Logs landen im konfigurierten LOG_FILE; man kann zusätzlich stderr nach
`/var/log/...` umleiten, falls Cron-Mail erwünscht ist.

### Windows — Task Scheduler

1. Task Scheduler öffnen → **Create Basic Task…**
2. Trigger: täglich, z.B. 04:15
3. Action: **Start a program**
   - Program: `powershell.exe`
   - Arguments: `-NoProfile -ExecutionPolicy Bypass -File "C:\Users\jan\staging\Windsurf\ideendatenbank\scripts\backup-to-gdrive.ps1"`
4. Im Reiter „Conditions" Häkchen bei „Wake the computer" raus (falls Laptop).
5. Im Reiter „Settings": „Run task as soon as possible after a scheduled start is missed".

## 6. Konfiguration anpassen (optional)

Die Defaults reichen in der Regel. Falls nötig, Environment-Variablen vor
dem Aufruf setzen:

| Variable | Default | Bedeutung |
|---|---|---|
| `RCLONE_REMOTE` | `gdrive` | Name aus `rclone config` |
| `RCLONE_PATH` | `HackathOERn-Backups` | Zielordner-Pfad im Drive |
| `RCLONE_MAX_AGE_DAYS` | `30` | Drive-Retention in Tagen (`0` = nie löschen) |
| `BACKUP_DIR` | `backend/data/backups` | Lokaler Backup-Ordner |
| `LOG_FILE` | `backend/data/backup-to-gdrive.log` | Logdatei |

Beispiel Cron-Zeile mit Overrides:
```cron
15 4 * * *  RCLONE_MAX_AGE_DAYS=90 /pfad/.../scripts/backup-to-gdrive.sh
```

## 7. Wartung & Troubleshooting

| Symptom | Ursache / Fix |
|---|---|
| `command not found: rclone` | rclone nicht im PATH des Cron-Users → vollen Pfad im Script verwenden (`/usr/local/bin/rclone`) oder PATH im Cron-Header setzen. |
| `Token has been expired or revoked` | OAuth-Token abgelaufen → `rclone config reconnect gdrive:` (Browser-Login wiederholen). |
| Drive-Retention löscht nichts | Sicherstellen, dass `scope=drive` gewählt wurde — bei `drive.file` sieht rclone nur eigene Uploads, das ist hier aber gewollt und Retention funktioniert für diese. |
| Quota überschritten | Bei persönlichem Drive-Account: alte ZIPs löschen oder `RCLONE_MAX_AGE_DAYS` reduzieren. |
| Sync läuft, aber Mod sieht nichts im App-UI | Korrekt — die App weiß nichts von der Drive-Spiegelung. Status nur über die Logdatei. |

## 8. Wiederherstellung aus Drive

1. ZIP aus Drive auf den Server kopieren (Web-UI → Download, oder `rclone copy gdrive:HackathOERn-Backups/ideendb-backup-XXX.zip .`).
2. Im Mod-UI: Tab **Backup** → **Backup hochladen + wiederherstellen** → ZIP wählen.

Die App validiert die ZIP (Magic-Bytes, Größe ≤ 200 MB) und legt vor dem
Restore automatisch ein Safety-Backup an. Kein Server-Restart nötig.
