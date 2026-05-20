# 5. Backup & Wiederherstellung

Die Ideendatenbank hat ein automatisches Backup-System für die App-Datenbank.
edu-sharing-Daten (Ideen, Kommentare, Ratings) werden **nicht** gesichert — die
leben im edu-sharing-Repo, das eigene Sicherungs-Strategien hat.

## Was wird gesichert?

Die SQLite-Datei `data/ideendb.sqlite` mit:

| Tabelle | Inhalt |
|---|---|
| `idea` | App-Cache aller Ideen mit topic_id, hidden-Flag, Tags, Sync-Stand |
| `idea_fts` | Volltext-Index |
| `topic` | Sammlungs-Hierarchie mit Sortierung + Beschreibungen |
| `taxonomy_event` | Kuratierte Veranstaltungs-Liste mit Labels |
| `taxonomy_phase` | Kuratierte Phasen-Liste |
| `idea_interaction` | Mitmachen + Folgen pro User |
| `idea_report` | Meldungen offen/erledigt |
| `activity_log` | Audit-Log aller Mod-Aktionen |
| `ranking_snapshot` | Trend-Snapshots für die Rangliste |
| `user_feed_seen` | Notification-Read-Cursor pro User |
| `sync_log` | Sync-Lauf-Statistiken |

Nicht gesichert: `.env`-Konfiguration / Secrets. Die gehören in
System-/Docker-Umgebungsvariablen, nicht ins Backup-ZIP.

## Automatisches Backup

Läuft eingebaut, alle 24h (konfigurierbar via `BACKUP_INTERVAL_HOURS`-Env).
Aktiv, wenn `BACKUP_ENABLED=true` gesetzt ist (Default).

Retention: behält die letzten N Backups (`BACKUP_KEEP=3` Default). Ältere
werden beim Anlegen eines neuen automatisch entfernt.

Backup-Verzeichnis: `data/backups/` (im Container: `/data/backups/`).

## Manuelles Backup

Im Mod-Tab **💾 Backup**:

**„Backup jetzt erstellen"** — legt sofort ein ZIP an, taucht in der Liste auf.

Pro Backup zeigt die Liste:
- Dateiname (z.B. `ideendb-backup-20260520-1430.zip`)
- Erstellungs-Zeit
- Größe (typisch 100–500 KB)
- Idea-Count (aus `metadata.json` im ZIP)

Aktionen pro ZIP:
- **⬇ Download** — lokales Speichern
- **🗑 Löschen** — manuell entfernen (über die Retention hinaus)

## Restore

⚠ **Restore überschreibt die aktuelle DB komplett**. Bestehende neue Daten gehen
verloren. **Vor jedem Restore wird automatisch ein Pre-Restore-Backup angelegt**,
falls die zurückzustellende Datei kaputt ist.

### Im Mod-UI

1. **„Backup hochladen + wiederherstellen"**
2. ZIP-Datei aus dem Datei-Picker wählen
3. Bestätigen

Validierungen:
- ZIP muss `database.sqlite` enthalten (sonst Fehler)
- SQLite-Magic-Bytes („SQLite format 3") werden geprüft
- Datei-Größe max 200 MB
- Rate-Limit: 3 Restores pro Stunde

### Direkt via API (für SCP-Workflow)

Wenn das ZIP auf dem Server liegt (z.B. per scp von einem lokalen Backup
übertragen):

```bash
curl -X POST -u janschachtschabel:DEIN_PW \
  -F "file=@/tmp/ideendb-backup-20260520-1430.zip" \
  http://127.0.0.1:8000/api/v1/admin/backups/restore
```

Bypassed den Browser-File-Picker — vermeidet versehentliches Hochladen der
falschen Datei.

## Auto-Restore beim Erststart

Wenn die App auf einem **frischen Volume** hochfährt:
- SQLite-Datei existiert nicht oder ist leer (< 200 Bytes)
- Im `/data/backups/`-Verzeichnis liegt ein ZIP
- **Marker-Datei** `/data/backups/AUTO_RESTORE_OK` ist vorhanden (Opt-in!)

→ Die App lädt **vor `init_db()`** automatisch das jüngste Backup und
**löscht den Marker** anschließend (einmaliger Vorgang).

Use-Case: Disaster-Recovery. Server kaputt, neuen aufsetzen, Volume aus Backup
restaurieren, Marker setzen, Container starten → App ist wieder live mit dem
letzten Stand.

**Sicherheits-Opt-in**: Der Marker verhindert, dass ein versehentlich oder
böswillig hineingelegtes ZIP automatisch produktiv geladen wird. Auf einem
neuen Server gezielt aktivieren:

```bash
touch /var/lib/docker/volumes/ideendb-data/_data/backups/AUTO_RESTORE_OK
docker start ideendb
# Nach erfolgreichem Restore wird der Marker automatisch entfernt.
```

**Eine bestehende DB wird nie überschrieben** — der Auto-Restore springt nur
an, wenn SQLite-Pfad fehlt oder unter 200 Bytes groß ist.

## Off-Site-Spiegelung via rclone

Automatische lokale Backups schützen vor App-Datenverlust, nicht vor Server-
Verlust. Empfohlen: täglich nach einem zweiten Standort spiegeln.

Im Repo unter `scripts/`:
- `backup-to-gdrive.sh` (Linux/macOS)
- `backup-to-gdrive.ps1` (Windows)
- `BACKUP-GDRIVE.md` (Setup-Anleitung)

Verwendet `rclone` mit Google-Drive-OAuth-Login. Setup einmal, danach via
Cron-Job (Linux) oder Task Scheduler (Windows) automatisch.

```bash
# Beispiel-Cron (täglich 04:15 UTC)
15 4 * * *  /opt/ideendb/scripts/backup-to-gdrive.sh
```

Konfiguration per Env-Variable:
- `RCLONE_REMOTE=gdrive`
- `RCLONE_PATH=HackathOERn-Backups`
- `RCLONE_MAX_AGE_DAYS=30` (Drive-Retention)

## Manuelle Restore via CLI (Notfall)

Wenn das Mod-UI nicht erreichbar ist (kompletter Server-Crash, neuer Aufbau):

```bash
# Container stoppen
docker stop ideendb

# Backup-Datei in Position kopieren
docker run --rm -v ideendb-data:/data -v "$PWD":/host alpine \
  sh -c "cp /host/ideendb-backup-20260520-1430.zip /data/backups/"

# Bestehende DB sicherheitshalber wegmoven
docker run --rm -v ideendb-data:/data alpine \
  mv /data/ideendb.sqlite /data/ideendb.sqlite.before-restore

# Container starten — Auto-Restore springt an
docker start ideendb
docker logs ideendb 2>&1 | grep auto-restore
```

## Wiederherstellungs-Checkliste

Nach einem Restore prüfen:

1. **Health-Endpoint**: `curl http://127.0.0.1:8000/api/v1/health` → `topics`/`ideas`-Counts plausibel?
2. **Login**: kannst du dich mit deinem Mod-Account einloggen?
3. **Postfach**: zeigt es Items?
4. **Veranstaltungen-Tab**: ist die Liste aus dem Backup wiederhergestellt?
5. **Versteckt-Tab**: sind die versteckten Ideen wieder als versteckt markiert?
6. **Activity-Log**: aktuelle Einträge sichtbar?
7. **Sync triggern** (`POST /admin/sync`) → bringt edu-sharing-Stand wieder mit Cache in Sync

## Backup-Hygiene

- **Mindestens 1× Woche** ein manuelles Backup erstellen + Off-Site spiegeln
- **Vor großen Mod-Aktionen** (z.B. Massen-Verschiebung, ACL-Änderungen) ein Backup
- **Backup-Größe im Auge behalten** — bei plötzlichem Sprung (`<200 KB` → `>5 MB`)
  prüfen ob z.B. Activity-Log explodiert (z.B. wegen Auth-Failures-Welle)
- **Aufräumen**: Test-/Pre-Restore-Backups, die nicht mehr gebraucht werden,
  über das UI löschen

---

→ Weiter mit [Kapitel 6: Statistik + Aktivität](06-statistik-aktivitaet.md)
