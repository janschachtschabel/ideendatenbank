# HackathOERn Ideendatenbank

Plattform zum Einreichen, Diskutieren und Bewerten von OER-Ideen —
Backend in FastAPI, Frontend als Angular Web Components, Persistenz in
edu-sharing (`redaktion.openeduhub.net`).

---

## Architektur

```
Browser (<ideendb-app> / <ideendb-tile-grid> Web Components)
        │
        ▼
FastAPI Backend  ──► SQLite (FTS5, Activity-Log, Trend-Snapshots,
        │                    Reports, Mitmachen/Folgen, Taxonomien)
        ▼
edu-sharing REST-API (Source of Truth: Ideen, Rating, Kommentare, User)
```

### Datenmodell

```
Themengebiet (ccm:map)              ← 11×, Top-Level-Sammlungen
└── Herausforderung (ccm:map)
    ├── Idee (ccm:io)               ← Idee = ein ccm:io
    └── Idee — Anhänge (ccm:map)    ← optional, Geschwister mit Keyword
                                       `attachment-of:<idea-id>`
```

- **Idee = ein ccm:io** (kein eigenes MDS, nutzt Standard-Felder)
- **Rating + Kommentare** laufen direkt am ccm:io (edu-sharing-eigenes Feature)
- **Phase / Event / Kategorie** werden als Präfix-Keywords abgebildet
  (`phase:*`, `event:*`, `target-topic:*`)
- **Mehrfach-Event** pro Idee unterstützt
- **Anhänge-Sammlung** als optionale Geschwister-`ccm:map`, eindeutig
  per `attachment-of:<idea-id>`-Keyword verknüpft
- **Mitmachen / Folgen** liegen in der App-SQLite (edu-sharing kennt sie nicht)

---

## Features (Stand April 2026)

### Für alle Besucher:innen

- **Themen-Drilldown** (Themen → Herausforderungen → Ideen, mit Breadcrumbs)
- **Veranstaltungs-Drilldown** mit QR-Code + Share-Link je Event
- **Trend-Rangliste** mit ▲▼-Pfeilen, Sparklines pro Idee und Top-5-
  Verlaufs-Chart (Snapshots werden stündlich getrottelt geschrieben,
  letzten 60 behalten)
- **Volltext-Suche** mit `<mark>`-Highlights und 0-Treffer-Vorschlägen
  („Vielleicht meintest du…" + zuletzt aktualisierte Ideen)
- **Filter**: Phase, Veranstaltung, Kategorie, Topic
- **Detail-Ansicht** mit Rating, Kommentaren (mit Reply-to), Anhängen als
  Karten-Grid mit prominenten Download-Buttons
- **Restricted-Banner** für nicht-öffentliche Ideen mit Login-Anzeige

### Für eingeloggte User

- **Eigene Ideen einreichen** mit Datei-Upload, Vorschaubild,
  Mehrfach-Event-Auswahl
- **Eigene Ideen** bearbeiten / duplizieren / löschen (Owner-Edit-Gating
  via `accessEffective` aus edu-sharing)
- **Phase-Status-Workflow** (Variante A): Owner darf nur eine Stufe
  vorwärts, „Archiviert" und Sprünge nur für Mods
- **Anhänge-Sammlung** anlegen, Dateien hochladen / umbenennen / löschen
- **Mitmachen** und **Folgen** je Idee
- **Mein Bereich** mit Aktivitäts-Feed („Was ist neu" zu gefolgten/
  eigenen/Mitmach-Ideen), eigenen Ideen, Followed, Mitmachen-Liste
- **Problem melden** über Modal — landet in der Mod-Meldungsliste
- **Idee teilen** (Mail, WhatsApp, X, LinkedIn, Mastodon, Bluesky,
  Telegram, URL kopieren, im Repo öffnen)

### Für Moderator:innen

Moderations-UI mit 9 Tabs:

| Tab | Funktion |
|---|---|
| 📊 **Statistik** | KPI-Karten + Wochen-Chart + Phasen-/Event-Verteilung + Top-Aktive User + Top-Engagement-Ideen + Action-Verteilung |
| 📥 **Postfach** | Anonyme Einreichungen verschieben (mit **Bulk-Move** über Checkboxen) oder löschen |
| ⚠ **Meldungen** | User-Meldungen prüfen, Idee öffnen, als erledigt markieren |
| 📝 **Aktivität** | Audit-Log aller App-Schreibvorgänge, filterbar nach Action / Akteur / Zeitraum, CSV-Export |
| 🗂 **Themen** | Themen + Herausforderungen anlegen, umbenennen, beschreiben, Vorschaubild setzen, sortieren (▲▼), löschen (nur leere) |
| 📅 **Veranstaltungen** | Event-Taxonomie verwalten + Share-Link/QR-Code je Event |
| 🎯 **Phasen** | Phasen-Taxonomie verwalten (sort_order steuert den Workflow) |
| 👥 **Moderator:innen** | Mitglieder der Mod-Gruppe verwalten (über edu-sharing-IAM) |
| 💾 **Backup** | DB-Sicherungen erstellen, herunterladen, hochladen, restaurieren |

### Backup / Restore

- **Sicherung**: nur die SQLite-DB (Activity-Log, Trends, Reports,
  Mitmachen/Folgen, Taxonomien, Topic-Sortierung)
- **Konsistent** via `VACUUM INTO` (kein File-Copy mit Locks)
- **Auto-Backup** alle 24h, behält die letzten 3 (konfigurierbar)
- **Pre-Restore-Backup** wird vor jedem Restore automatisch angelegt
- **Restore aus dem Mod-UI** mit Confirm-Dialog und Magic-Bytes-Validierung
- edu-sharing-Daten werden NIE gesichert/restored — die liegen im edu-sharing-Repo
- **Konfiguration / Secrets sind NICHT im Backup** — die müssen in
  System-/Docker-Umgebungsvariablen liegen (siehe Sicherheit unten)

---

## Web Components

```html
<!-- Voll-App -->
<ideendb-app api-base="/api/v1"></ideendb-app>

<!-- Kachelansicht für Drittseiten -->
<ideendb-tile-grid
  api-base="https://ideen.example.de/api/v1"
  event="hackathoern-2"
  sort="rating"
  limit="6">
</ideendb-tile-grid>
```

---

## Setup (Development)

```bash
cp .env.example .env

# Backend
cd backend
python -m venv .venv
. .venv/Scripts/activate            # Windows: .venv\Scripts\activate
pip install -e .
uvicorn app.main:app --reload       # http://127.0.0.1:8000

# Frontend (separate Konsole)
cd ../frontend
npm install
npm start -- --port 4201            # http://127.0.0.1:4201
# Dev-Server proxyt /api/* an 8000 (proxy.conf.json)
```

### Konfiguration via `.env`

```ini
# edu-sharing
EDU_REPO_BASE_URL=https://redaktion.openeduhub.net
EDU_GUEST_USER=WLO-Upload
EDU_GUEST_PASS=…
EDU_GUEST_INBOX_ID=21144164-30c0-4c01-ae16-264452197063
IDEENDB_ROOT_COLLECTION_ID=4197d4d2-c700-400c-97d4-d2c700900c68

# FastAPI
APP_HOST=127.0.0.1
APP_PORT=8000
APP_CORS_ORIGINS=http://localhost:4200,https://wp-test.wirlernenonline.de

# SQLite
SQLITE_PATH=./data/ideendb.sqlite
SYNC_INTERVAL_SECONDS=300

# Backup
BACKUP_ENABLED=true
BACKUP_DIR=./data/backups
BACKUP_INTERVAL_HOURS=24
BACKUP_KEEP=3

# Moderation
MODERATION_GROUP=GROUP_HackathOERn_Moderation
MODERATION_FALLBACK_GROUPS=GROUP_ALFRESCO_ADMINISTRATORS
MODERATION_BOOTSTRAP_USERS=admin,jan
```

---

## Deployment (same-origin, empfohlen)

Ein einziger Uvicorn-Prozess liefert API + Frontend aus:

```bash
cd frontend && npm run build:embed         # → dist/embed/browser/
cd ../backend && uvicorn app.main:app      # serviert API + Bundle
```

Das Backend mountet `frontend/dist/embed/browser/` automatisch als Root,
sofern das Verzeichnis existiert. Keine CORS-Sorgen, eine Deploy-Einheit.

### Updates / Wartung

```bash
git pull
cd frontend && npm install && npm run build:embed
cd ../backend && pip install -e .
# uvicorn neu starten (systemd-Unit: systemctl restart ideendb)
```

`init_db()` läuft beim Startup idempotent, neue Spalten werden via
`ALTER TABLE`-Migrationen ergänzt — bestehende Daten bleiben heile.

### Backup-Strategie für Prod

- Auto-Backup läuft eingebaut (siehe Mod-UI → Backup-Tab oder
  `POST /api/v1/admin/backup`)
- Backups landen in `data/backups/`
- **Empfehlung**: regelmäßig nach Außerhalb spiegeln (z.B. cron-Job
  `rsync data/backups/ user@nas:/path/`), weil bei Komplett-Verlust
  des Servers auch lokale Backups weg wären

### Restore via CLI (Notfall)

Wenn das Mod-UI nicht erreichbar ist:

```bash
systemctl stop ideendb
cd backend
unzip -o /path/to/ideendb-backup-20260429-1430.zip database.sqlite -d data/
# Backup auch des aktuellen Stands sicherheitshalber:
cp data/ideendb.sqlite data/ideendb.sqlite.before-restore
mv data/database.sqlite data/ideendb.sqlite
systemctl start ideendb
```

---

## Deployment (Web-Component in Drittseite)

```html
<link rel="stylesheet" href="https://ideen.hackathoern.de/styles.css">
<script type="module" src="https://ideen.hackathoern.de/main.js"></script>
<script type="module" src="https://ideen.hackathoern.de/polyfills.js"></script>

<ideendb-app api-base="https://ideen.hackathoern.de/api/v1"></ideendb-app>
```

`APP_CORS_ORIGINS` im Backend-Env muss dann auf die Drittseiten-Domain zeigen.

---

## Live-Beispiele

- `http://127.0.0.1:8000/` — Voll-App
- `http://127.0.0.1:8000/embed-demo.html` — Einbettungs-Szenarien
- `http://127.0.0.1:8000/docs` — OpenAPI/Swagger

---

## Verzeichnis

- `backend/app/`
  - `main.py` — FastAPI-App + Lifespan (Sync-Loop + Auto-Backup)
  - `routes.py` — alle API-Endpoints
  - `db.py` — SQLite-Schema + idempotente Migrationen
  - `sync.py` — edu-sharing-Sync, Single-Node-Refresh, Trend-Snapshots
  - `backup.py` — Backup/Restore-Logik
  - `edu_sharing.py` — REST-Client für edu-sharing
  - `config.py` — pydantic-settings
- `frontend/src/app/`
  - `app-shell/` — Voll-App-Komponente + Mod-UI + Detail + Submit
  - `tile-grid/` — Standalone-Kachelansicht
  - `api.service.ts` — HttpClient-Wrapper
  - `models.ts` — TypeScript-Typen
- `scripts/` — Explorations- und Probe-Skripte gegen edu-sharing
- `.env.example` — Konfig-Vorlage
- `CLAUDE.md` — Detail-Spec + Architektur-Entscheidungen

---

## Sicherheit

### Was die App schon mitbringt (Tier 1)

- **Rate-Limiting** via [slowapi](https://github.com/laurentS/slowapi) auf
  Schreib-Endpoints, IP-basiert:
  - `POST /ideas` (anonymes Einreichen): **10/Min**
  - `POST /ideas/{id}/rating`: **30/Min**
  - `POST /ideas/{id}/comments`: **30/Min**
  - `POST /ideas/{id}/report`: **10/Min**
  - `POST /admin/backups/restore`: **3/Stunde**
  - Reads sind unbeschränkt
- **Strikte CORS**-Whitelist (kein wildcard-Localhost-Regex). Origins
  über `APP_CORS_ORIGINS` explizit pflegen.
- **Backup-ZIPs enthalten KEINE Secrets / `.env`** — Konfiguration läuft
  ausschließlich über System-/Docker-Umgebungsvariablen.
- **Auth-Audit-Log**: jeder fehlgeschlagene Mod-Login-Versuch landet als
  `auth_failed` im Activity-Log. Mods sehen verdächtige Muster im Tab
  „📝 Aktivität".
- **Magic-Bytes-Check** beim Restore-Upload (lehnt Junk-ZIPs ab).
- **Pfad-Traversal-Schutz** auf Backup-Endpoints.
- **Mod-only-Gating** über `accessEffective` aus edu-sharing.

### Empfehlungen für Production-Deployment (Tier 2)

Diese Punkte sind **nicht im Code**, sondern Aufgabe der Ops-/Deployment-
Schicht. Setze sie um, bevor du die App öffentlich exponierst.

#### 1. Reverse-Proxy mit TLS (Pflicht)

nginx-Beispiel mit Let's Encrypt:

```nginx
server {
    listen 443 ssl http2;
    server_name ideen.example.de;
    ssl_certificate     /etc/letsencrypt/live/ideen.example.de/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ideen.example.de/privkey.pem;

    # Sicherheits-Header
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### 2. Zusätzliche Basic-Auth auf `/admin/*` (empfohlen)

Doppelte Hürde: Reverse-Proxy-Passwort + edu-sharing-Login.

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

`htpasswd -B /etc/nginx/htpasswd-ideendb mod` zum Anlegen.

#### 3. fail2ban gegen Brute-Force

`/etc/fail2ban/filter.d/ideendb.conf`:
```ini
[Definition]
failregex = ^<HOST>.*"POST /api/v1/admin/.*" 40[13]
ignoreregex =
```

`/etc/fail2ban/jail.local`:
```ini
[ideendb]
enabled = true
port    = http,https
filter  = ideendb
logpath = /var/log/nginx/access.log
maxretry = 5
findtime = 600
bantime = 3600
```

#### 4. Secrets ausschließlich über Umgebungsvariablen

**Niemals** `.env` im Backup, im Git-Repo oder in Logs landen lassen.

Docker-Compose-Beispiel:
```yaml
services:
  ideendb:
    image: ideendb:latest
    environment:
      EDU_GUEST_USER: ${EDU_GUEST_USER}
      EDU_GUEST_PASS: ${EDU_GUEST_PASS}
      MODERATION_BOOTSTRAP_USERS: ${MODERATION_BOOTSTRAP_USERS}
      APP_CORS_ORIGINS: https://ideen.example.de
      BACKUP_ENABLED: "true"
    volumes:
      - ideendb-data:/app/data           # SQLite + Backups bleiben persistent
    ports:
      - "127.0.0.1:8000:8000"            # nur an localhost binden, nginx davor
```

systemd-Service mit `EnvironmentFile=/etc/ideendb.env` (root-only `chmod 600`):
```ini
[Service]
EnvironmentFile=/etc/ideendb.env
ExecStart=/opt/ideendb/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

#### 5. Externe Backup-Spiegelung

Auto-Backups landen in `data/backups/` neben der App. Bei Server-Verlust
sind die mit weg. Mindestens täglich nach extern spiegeln:

```bash
# /etc/cron.d/ideendb-backup-mirror
30 4 * * * root rsync -a --delete /opt/ideendb/data/backups/ user@nas:/backup/ideendb/
```

oder via S3-kompatibel (rclone, restic).

### Was wir bewusst NICHT eingebaut haben (Tier 3)

- **OAuth/SSO im Frontend** — heute HTTP Basic gegen edu-sharing.
  edu-sharing kann Google-OAuth, müsste im Frontend integriert werden.
- **WAF** — Sache des Reverse-Proxy/Cloudflare.
- **Honeypot/CAPTCHA im Submit** — ggf. später wenn Spam ein Problem wird.

---

## Bekannte Server-seitige Bugs (edu-sharing prod)

- `DELETE /node/{id}/rating` → 500 (Bewertung kann nicht zurückgezogen,
  nur überschrieben werden)
- `GET /feedback` → 500 (Read-Pfad nicht nutzbar)
- Comments-403 für reguläre User auf manche Nodes (Tool-Permission-Frage)
- `/register/v1/register` SMTP-Hook hängt 50s — daher externe Registrierung
  via `wirlernenonline.de/register/`

---

## Lizenz

MIT — siehe `LICENSE`.
