# Installation auf einem Server (Docker)

Schritt-für-Schritt-Anleitung, um die HackathOERn Ideendatenbank produktiv
auf einem eigenen Server zu betreiben. Die App läuft als ein
Docker-Container, nginx davor terminiert TLS.

> **Vor dem Start klären:** Du brauchst (a) einen edu-sharing-Service-
> Account vom WLO-Redaktionsteam für anonyme Submits, (b) eine Domain mit
> DNS-A-Record auf den Server, (c) Root- bzw. sudo-Zugriff.

## Inhalt

**Installation (einmalig)**

1. [Voraussetzungen](#voraussetzungen)
2. [Pflicht-Konfigurationswerte besorgen](#1-vorbereitung--pflicht-konfigurationswerte-besorgen)
3. [Verzeichnisstruktur](#2-verzeichnisstruktur-anlegen)
4. [`.env`-Datei erstellen](#3-env-datei-erstellen)
5. [Container starten](#4-container-starten)
6. [nginx als Reverse-Proxy](#5-nginx-als-reverse-proxy)
7. [Mod-Zugang verifizieren](#6-mod-zugang-verifizieren)

**Laufender Betrieb**

8. [Update auf eine neue Version](#7-update-auf-eine-neue-version)
9. [Off-Site-Backups zu Google Drive](#8-off-site-backups-zu-google-drive)
10. [Operatives (cheatsheet)](#9-operatives-cheatsheet)
11. [Härtungs-Optionen](#10-härtungs-optionen-empfehlung-für-production)
12. [Troubleshooting](#troubleshooting)

---

## Voraussetzungen

| Komponente | Mindestversion | Hinweis |
|---|---|---|
| Linux-Server | 1 vCPU, 1 GB RAM, 10 GB Disk | Debian 12 / Ubuntu 22.04+ getestet |
| Docker Engine | 24+ | inkl. compose-Plugin |
| nginx | 1.18+ | für TLS-Terminierung |
| certbot | aktuell | für Let's Encrypt-Zertifikate |
| Domain | beliebig | DNS muss auf den Server zeigen |

Installations-Befehle (Debian/Ubuntu):

```bash
apt update && apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
systemctl enable --now docker nginx
```

---

## 1. Vorbereitung — Pflicht-Konfigurationswerte besorgen

Bevor du loslegst, sammle folgende Werte. Du brauchst sie für die
`.env`-Datei:

| Wert | Wo bekommst du ihn? |
|---|---|
| **edu-sharing-Service-Account** (Username + Passwort) | Vom WLO-Redaktionsteam — wird für anonyme Submit-Routing benötigt |
| **Community-Inbox-ID** | UUID der Sammlung, in die anonyme Submits geschrieben werden (typischerweise eine Inbox des HackathOERn-Kontextes im edu-sharing-Repo) |
| **Root-Sammlung-ID** | UUID der obersten Themen-Sammlung („Ideendatenbank-Wurzel"); darunter liegen die Themen-Sammlungen mit ihren Herausforderungen |
| **Mod-Gruppen-Name(n)** | edu-sharing-Group-Authority(s), deren Mitglieder Mod-Rechte erhalten sollen — z.B. die Org-Admin-Gruppe deines Kontextes |
| **(optional) Bootstrap-Mod-Username** | Klartext-Username eines Notnagel-Mods, der unabhängig von der Gruppe Mod ist |

Diese Werte sind **kontext-spezifisch**. Frag im Zweifel das
WLO-Team — sie pflegen die konkreten Sammlungs-IDs.

---

## 2. Verzeichnisstruktur anlegen

Empfohlene Konvention auf dem Server:

```bash
adduser --system --group --home /home/ideendb --shell /bin/false ideendb
mkdir -p /home/ideendb/ideendb
chown -R ideendb:ideendb /home/ideendb
```

Die `.env` legen wir in `/home/ideendb/ideendb/.env` ab — Pfad ist nur
Konvention, hier aber konsistent in dieser Anleitung verwendet.

---

## 3. `.env`-Datei erstellen

```bash
nano /home/ideendb/ideendb/.env
```

Inhalt — Platzhalter durch deine Werte aus Schritt 1 ersetzen:

```ini
# === edu-sharing — Repository-Anbindung ===
# Default-Repo ist die WLO-Produktion. Nur ändern, wenn ein eigener
# Repo-Host gemeint ist.
EDU_REPO_BASE_URL=https://redaktion.openeduhub.net
EDU_REPO_API=https://redaktion.openeduhub.net/edu-sharing/rest

# Service-Account für anonyme Einreichungen (Werte vom WLO-Team).
# Wird ausschließlich genutzt, um nicht-angemeldete Submits in die
# Inbox zu schreiben — KEIN admin-Account.
EDU_GUEST_USER=<vom-wlo-team>
EDU_GUEST_PASS=<vom-wlo-team>

# UUID der Community-Inbox im edu-sharing-Repo
# (Sammlung, in die anonyme Submits landen — z.B. die HackathOERn-Inbox)
EDU_GUEST_INBOX_ID=<inbox-uuid>

# UUID der obersten Themen-Sammlung
# (darunter liegen die Themen mit ihren Herausforderungen)
IDEENDB_ROOT_COLLECTION_ID=<root-uuid>

# === FastAPI-Anwendung ===
APP_HOST=0.0.0.0
APP_PORT=8000

# Erlaubte Origins für CORS — deine Domain(en), kommagetrennt.
# Beispiel: https://ideen.example.de,https://example.de
APP_CORS_ORIGINS=https://<deine-domain>

# === Persistenz ===
# Pfade im Container — werden via Docker-Volume persistiert.
SQLITE_PATH=/data/ideendb.sqlite
SYNC_INTERVAL_SECONDS=300

# === Backup ===
BACKUP_ENABLED=true
BACKUP_DIR=/data/backups
BACKUP_INTERVAL_HOURS=24
BACKUP_KEEP=14
# Auto-Restore beim Erststart aktivieren? Nur falls Marker-Datei
# `AUTO_RESTORE_OK` im Backup-Verzeichnis liegt — Sicherheits-Opt-in.
# Default-Marker-Name reicht in den meisten Fällen.
BACKUP_AUTO_RESTORE_MARKER=AUTO_RESTORE_OK

# === Moderation ===
# Komma-Liste der edu-sharing-Gruppen, deren Mitglieder Mod-Status
# bekommen. Default-Bsp.: Repo-Admins + Org-Admins eines Kontexts.
MODERATION_FALLBACK_GROUPS=GROUP_ALFRESCO_ADMINISTRATORS,GROUP_<kontext>_ORG_ADMINISTRATORS

# Notnagel: Komma-Liste von Usernamen, die unabhängig von der Gruppe
# Mod sind. Leer lassen im Normalbetrieb; nur befüllen, wenn der
# Gruppen-Lookup nicht funktioniert.
MODERATION_BOOTSTRAP_USERS=

# === Upload-Limits (Bytes) ===
# Defaults reichen für die meisten Setups — nur anpassen, wenn die
# Reverse-Proxy-Limits parallel hochgezogen werden.
UPLOAD_IMAGE_MAX_BYTES=10485760
UPLOAD_CONTENT_MAX_BYTES=52428800
UPLOAD_ATTACHMENT_MAX_BYTES=52428800
UPLOAD_RESTORE_MAX_BYTES=209715200
```

`.env` absichern (sonst lesen alle lokalen User die Secrets):

```bash
chown ideendb:ideendb /home/ideendb/ideendb/.env
chmod 600 /home/ideendb/ideendb/.env
```

---

## 4. Container starten

Aus dem öffentlichen Image (kein lokaler Build nötig):

```bash
docker pull ghcr.io/janschachtschabel/ideendatenbank:main

docker run -d --name ideendb \
  --restart unless-stopped \
  -p 127.0.0.1:8000:8000 \
  -v ideendb-data:/data \
  --env-file /home/ideendb/ideendb/.env \
  ghcr.io/janschachtschabel/ideendatenbank:main
```

Wichtige Details:

- **Port-Bind auf `127.0.0.1`** — nur lokal erreichbar, nginx davor
  terminiert TLS. Niemals `-p 8000:8000` (ohne IP) ans öffentliche Netz.
- **Volume `ideendb-data`** — persistente Daten (SQLite + Backups).
  Wird automatisch angelegt.
- **`--restart unless-stopped`** — Container kommt nach Server-Reboot
  automatisch hoch.

Smoke-Test:

```bash
sleep 6 && curl -s http://127.0.0.1:8000/api/v1/health
# → {"ok":true,"topics":...,"ideas":...,"last_sync":{...}}
```

---

## 5. nginx als Reverse-Proxy

Konfig anlegen — Beispiel `/etc/nginx/sites-available/ideendb`:

```nginx
server {
    listen 80;
    server_name <deine-domain>;
    # Let's-Encrypt-Challenge zulassen, Rest auf HTTPS umleiten
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name <deine-domain>;

    ssl_certificate     /etc/letsencrypt/live/<deine-domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<deine-domain>/privkey.pem;

    # Sicherheits-Header
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # WICHTIG: Default ist 1 MB. Reicht nicht für Backup-Restore (200 MB)
    # und Anhänge (50 MB). Muss ≥ größtes UPLOAD_*_MAX_BYTES sein.
    client_max_body_size 200m;
    proxy_read_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        # Wichtig fürs Rate-Limiting hinter NAT-IPs:
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aktivieren + TLS-Zertifikat holen:

```bash
ln -s /etc/nginx/sites-available/ideendb /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

certbot --nginx -d <deine-domain> --redirect
# Renewal-Timer läuft automatisch — verifizieren:
systemctl status certbot.timer
```

---

## 6. Mod-Zugang verifizieren

Login mit deinem edu-sharing-User auf https://&lt;deine-domain&gt;/ — im
Profil-Menü erscheint „Moderation", wenn du in einer der konfigurierten
`MODERATION_FALLBACK_GROUPS` Mitglied bist.

Bei Problemen — was die App vom User „sieht":

```bash
curl -s -u '<username>:<passwort>' \
  https://<deine-domain>/api/v1/me/memberships | python3 -m json.tool
# → zeigt deine ES-Gruppen + Treffer in der Mod-Liste
```

Wenn der Login per Username klappt aber Mod-Status fehlt: in der `.env`
`MODERATION_FALLBACK_GROUPS` erweitern um die Gruppe(n) aus dem
`groups`-Feld der Antwort, dann Container neu starten.

---

## 7. Update auf eine neue Version

Bei einem neuen Release im `main`-Branch (oder Push eines `vX.Y.Z`-Tags)
baut die GitHub-Actions-CI automatisch ein neues Image und pusht es nach
`ghcr.io/janschachtschabel/ideendatenbank`. Auf dem Server reichen drei
Befehle:

```bash
# 1. (Optional, empfohlen) Vorher manuell ein Sicherheits-Backup ziehen
curl -s -u '<mod-username>:<passwort>' \
  -X POST http://127.0.0.1:8000/api/v1/admin/backup

# 2. Image pullen + Container ersetzen
docker pull ghcr.io/janschachtschabel/ideendatenbank:main
docker stop ideendb && docker rm ideendb
docker run -d --name ideendb --restart unless-stopped \
  -p 127.0.0.1:8000:8000 -v ideendb-data:/data \
  --env-file /home/ideendb/ideendb/.env \
  ghcr.io/janschachtschabel/ideendatenbank:main

# 3. Verifizieren
sleep 6 && curl -s http://127.0.0.1:8000/api/v1/health
```

**Was passiert beim Update:**

- Das alte Image bleibt lokal liegen (`docker images` listet beide). Im
  Notfall kannst du auf den vorherigen Stand zurück (siehe Rollback unten).
- Das **Volume bleibt unangetastet** — keine Datenverluste durch das
  Update.
- DB-Migrationen laufen idempotent beim Start (`init_db()`), neue Spalten
  werden via `ALTER TABLE` ergänzt.

### Rollback auf das vorherige Image

```bash
# 1. Verfügbare Images auflisten — den älteren Digest merken
docker images ghcr.io/janschachtschabel/ideendatenbank

# 2. Container mit dem alten Image starten
docker stop ideendb && docker rm ideendb
docker run -d --name ideendb --restart unless-stopped \
  -p 127.0.0.1:8000:8000 -v ideendb-data:/data \
  --env-file /home/ideendb/ideendb/.env \
  ghcr.io/janschachtschabel/ideendatenbank@sha256:<alter-digest>
```

Tipp: vor jedem Update einmal `docker tag ghcr.io/.../ideendatenbank:main
ghcr.io/.../ideendatenbank:rollback` ausführen — dann hast du immer ein
griffbereites Rollback-Tag.

### Update-Cadence: was sinnvoll ist

| Stand | Wann updaten |
|---|---|
| **`:main`** (rolling) | Wöchentlich oder bei wichtigen Bugfixes |
| **`:vX.Y.Z`** (pinned) | Nur bei Release-Tags — stabilster Weg |
| **Sicherheits-Patches** | Sofort nach Bekanntwerden |

Für Produktiv-Setups eher `:vX.Y.Z`-Tags nutzen statt `:main`, dann gibt's
keine Überraschungen durch unerwartete Builds. Tags siehe
[GHCR-Übersicht](https://github.com/janschachtschabel/ideendatenbank/pkgs/container/ideendatenbank).

---

## 8. Off-Site-Backups zu Google Drive

Auto-Backups landen lokal im Docker-Volume neben der App. Bei
Server-Verlust (Disk-Crash, gelöschtes Volume, gestohlener Server) sind
die mit weg. **Mindestens einmal täglich nach extern spiegeln.**

Die App selbst spiegelt nicht — das macht ein separates Script via
`rclone` (steht in `scripts/backup-to-gdrive.sh` bzw. `.ps1` im Repo).
Vorteile dieser Variante:

- Kein App-Restart bei Konfig-Änderungen
- Funktioniert auch außerhalb von Docker
- Eine Drive-Quota kann viele Server bedienen (familiares Konto, NAS,
  S3-Bucket etc.)
- Verschlüsselung optional via `rclone crypt`

### Voraussetzungen

- `rclone` (CLI-Tool, frei) — `apt install rclone` oder Download von
  https://rclone.org
- Ein Google-Account mit Schreibrecht in einem Drive-Ordner
- Cron auf dem Server (kommt mit Debian/Ubuntu out-of-the-box)

### Setup (Schritt für Schritt)

**1. Google-Drive-Remote anlegen (einmalig, interaktiv)**

```bash
rclone config
# n) New remote
# name: gdrive
# storage: drive (Google Drive)
# client_id / client_secret: leer lassen
# scope: 2 (drive.file — sicher, sieht nur eigene Uploads)
# root_folder_id / service_account_file: leer lassen
# Auto config: y (öffnet Browser für OAuth-Login)
# team_drive: n (außer du nutzt einen Shared Drive)
```

Test, ob die Verbindung steht:
```bash
rclone mkdir gdrive:HackathOERn-Backups
rclone lsd gdrive:
```

**2. Backup-Script aus dem Repo holen**

Wenn das Repo nicht eh schon auf dem Server liegt:
```bash
mkdir -p /opt/ideendb-tools && cd /opt/ideendb-tools
curl -O https://raw.githubusercontent.com/janschachtschabel/ideendatenbank/main/scripts/backup-to-gdrive.sh
chmod +x backup-to-gdrive.sh
```

Script-Defaults (per Env überschreibbar):

| Variable | Default | Bedeutung |
|---|---|---|
| `RCLONE_REMOTE` | `gdrive` | Name aus `rclone config` |
| `RCLONE_PATH` | `HackathOERn-Backups` | Zielordner im Drive |
| `RCLONE_MAX_AGE_DAYS` | `30` | Drive-Retention in Tagen (`0` = unbegrenzt) |
| `BACKUP_DIR` | `./data/backups` | Lokaler Quell-Ordner |
| `LOG_FILE` | `./data/backup-to-gdrive.log` | Logdatei |

**3. Backup-Ordner aus dem Docker-Volume zugänglich machen**

Das Script erwartet die ZIPs in `BACKUP_DIR`. Volume-Pfad herausfinden:
```bash
docker volume inspect ideendb-data --format '{{.Mountpoint}}'
# → typisch: /var/lib/docker/volumes/ideendb-data/_data
```

Dann das Script mit dem absoluten Pfad konfigurieren:
```bash
export BACKUP_DIR=/var/lib/docker/volumes/ideendb-data/_data/backups
```

(Im Cron-Job kannst du das `BACKUP_DIR=...` direkt vor dem Befehl
setzen — siehe nächster Schritt.)

**4. Cron-Eintrag — täglich um 04:15**

```bash
crontab -e
```

Zeile einfügen:
```cron
15 4 * * *  BACKUP_DIR=/var/lib/docker/volumes/ideendb-data/_data/backups RCLONE_MAX_AGE_DAYS=90 /opt/ideendb-tools/backup-to-gdrive.sh
```

Erster Test ohne Cron:
```bash
BACKUP_DIR=/var/lib/docker/volumes/ideendb-data/_data/backups \
  /opt/ideendb-tools/backup-to-gdrive.sh
```

Im Drive landen jetzt die ZIPs aus dem Backup-Ordner. Logfile prüfen:
```bash
tail -30 /var/lib/docker/volumes/ideendb-data/_data/backup-to-gdrive.log
```

### Verschlüsselung (DSGVO-Empfehlung)

Die Ideendatenbank-Backups enthalten personenbezogene Daten (Usernamen,
Aktivitäts-Log, Report-Texte, Mitmachen/Folgen-Marker). Bei Speicherung
auf Google Drive ist eine **Client-seitige Verschlüsselung empfohlen**.

Einfachster Weg — zweiter rclone-Remote als Crypt-Layer über dem ersten:

```bash
rclone config
# n) New remote
# name: gdrive-enc
# storage: crypt
# remote: gdrive:HackathOERn-Backups-enc
# Filename encryption: standard
# Directory name encryption: true
# Eigene Passphrase wählen (lang, an sicherem Ort sichern!)
```

Im Cron-Job dann `RCLONE_REMOTE=gdrive-enc` setzen. Drive sieht nur
Chiffrate, der Restore-Pfad funktioniert über `rclone copy gdrive-enc:…`
transparent.

⚠ **Passphrase verlieren = Backups unbrauchbar.** In einem
Passwort-Manager außerhalb des Servers sichern.

### Restore aus Drive (im Notfall)

```bash
# 1. ZIP aus Drive auf den Server holen
rclone copy gdrive:HackathOERn-Backups/ideendb-backup-20260520-1430.zip /tmp/

# 2. Im Mod-UI hochladen: Tab "Backup" → "Backup hochladen + wiederherstellen"
# Oder via API:
curl -s -u '<mod-username>:<passwort>' \
  -F "file=@/tmp/ideendb-backup-20260520-1430.zip" \
  -X POST http://127.0.0.1:8000/api/v1/admin/backups/restore

# 3. Verifizieren
curl -s http://127.0.0.1:8000/api/v1/health
```

**Ausführliches Setup + Troubleshooting** in
[`scripts/BACKUP-GDRIVE.md`](../scripts/BACKUP-GDRIVE.md).

---

## 9. Operatives (cheatsheet)

### Logs

```bash
docker logs --tail 100 -f ideendb            # live
docker logs --since 1h ideendb | grep ERROR  # letzte Stunde, nur Fehler
```

### Backup manuell anstoßen

Direkt im Container via API:

```bash
# Backup erstellen (Singular: /admin/backup)
curl -s -u '<mod-username>:<passwort>' \
  -X POST http://127.0.0.1:8000/api/v1/admin/backup

# Liste aller Backups (Plural: /admin/backups)
curl -s -u '<mod-username>:<passwort>' \
  http://127.0.0.1:8000/api/v1/admin/backups | python3 -m json.tool

# Ein Backup herunterladen (Export — z.B. zum Übertragen auf einen
# anderen Server)
curl -s -u '<mod-username>:<passwort>' \
  -o ideendb-backup.zip \
  http://127.0.0.1:8000/api/v1/admin/backups/ideendb-backup-YYYYMMDD-HHMM.zip
```

Oder über das Mod-UI → Tab **Backup** (Erstellen / Download / Restore).

### Volume-Snapshot (außerhalb der App, z.B. vor riskantem Schritt)

```bash
docker run --rm -v ideendb-data:/data -v "$PWD":/host alpine \
  tar czf /host/ideendb-volume-$(date +%F).tar.gz /data
```

### Disaster-Recovery: Volume + Backup-ZIP wiederherstellen

```bash
# 1. Frisches Volume + ZIP einspielen
docker volume create ideendb-data
docker run --rm -v ideendb-data:/data -v "$PWD":/host alpine \
  sh -c "mkdir -p /data/backups && cp /host/ideendb-backup-*.zip /data/backups/ \
         && touch /data/backups/AUTO_RESTORE_OK"

# 2. Container starten — Auto-Restore zieht das jüngste ZIP
docker run -d --name ideendb --restart unless-stopped \
  -p 127.0.0.1:8000:8000 -v ideendb-data:/data \
  --env-file /home/ideendb/ideendb/.env \
  ghcr.io/janschachtschabel/ideendatenbank:main

docker logs ideendb | grep auto-restore
```

Der Marker `AUTO_RESTORE_OK` wird nach erfolgreichem Restore automatisch
entfernt — einmaliger Vorgang, verhindert versehentliches Überschreiben
beim nächsten Restart.

---

## 10. Härtungs-Optionen (Empfehlung für Production)

### Mod-Endpoints zusätzlich Basic-Auth-schützen (Tier 2)

Doppelte Hürde: nginx-Basic-Auth + edu-sharing-Login.

```nginx
location /api/v1/admin/ {
    auth_basic           "Mod-Bereich";
    auth_basic_user_file /etc/nginx/htpasswd-ideendb;

    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Authorization $http_authorization;  # ES-Auth durchreichen
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
}
```

Passwort anlegen: `htpasswd -B /etc/nginx/htpasswd-ideendb mod`.

### Brute-Force-Schutz mit fail2ban

`/etc/fail2ban/filter.d/ideendb.conf`:
```ini
[Definition]
failregex = ^<HOST> .* "POST /api/v1/admin/.*" 40[13]
ignoreregex =
```

`/etc/fail2ban/jail.d/ideendb.conf`:
```ini
[ideendb]
enabled  = true
filter   = ideendb
logpath  = /var/log/nginx/access.log
maxretry = 5
findtime = 600
bantime  = 3600
```

### Docker-Log-Rotation

Verhindert volle Disks bei langem Container-Leben.

`/etc/docker/daemon.json`:
```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

`systemctl restart docker` (Container müssen einmal neu gestartet
werden, damit die Einstellung wirkt).

### Externes Monitoring

Der `/api/v1/health`-Endpoint ist **nicht** authentifiziert und liefert
JSON. Einfach an Uptime-Monitoring-Service deiner Wahl anhängen
(uptime-robot, healthchecks.io, eigener Prometheus-Job).

---

## Troubleshooting

| Symptom | Wahrscheinliche Ursache |
|---|---|
| Container startet, aber `/api/v1/health` → Connection refused | Port-Bind auf `127.0.0.1` falsch, oder Container noch im Boot. `docker logs ideendb` prüfen. |
| Sync läuft permanent in 401 | `EDU_GUEST_USER`/`EDU_GUEST_PASS` falsch oder Account hat keinen Inbox-Zugriff |
| „CORS-Fehler" im Browser | `APP_CORS_ORIGINS` enthält deine Domain nicht (Schreibweise muss exakt der im Browser sichtbaren entsprechen, inkl. `https://`) |
| Upload bricht stumm bei ~1 MB ab | nginx `client_max_body_size` zu niedrig |
| Mod-Status wird nicht erkannt | Login mit Username (nicht E-Mail) versuchen; in `MODERATION_BOOTSTRAP_USERS` als Notnagel eintragen |
| Auto-Restore springt nicht an | Marker-Datei `AUTO_RESTORE_OK` fehlt im Backup-Verzeichnis |
| Anonymer Submit gibt 400 „Captcha…" | Mathe-Captcha im Frontend gelöst werden — bei API-Tests `GET /api/v1/captcha` aufrufen und Antwort mitsenden |

---

## Verweise

- **Bedienung Endnutzer**: `docs/benutzerhandbuch/` (Markdown, Confluence-/PDF-tauglich)
- **Bedienung Moderation**: `docs/moderation/`
- **Backup → Google Drive**: `scripts/BACKUP-GDRIVE.md`
- **Architektur + Datenmodell**: `README.md` und `docs/moderation/07-permissions-architektur.md`
