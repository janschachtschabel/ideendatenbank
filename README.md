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
    └── Idee (ccm:io)               ← Idee = ein ccm:io
        ├── anhang.pdf              ← optional 0..n Child-IOs
        └── ...                       (Aspekt ccm:io_childobject,
                                       Assoc ccm:childio)
```

- **Idee = ein ccm:io** (kein eigenes MDS, nutzt Standard-Felder)
- **Rating + Kommentare** laufen direkt am ccm:io (edu-sharing-eigenes Feature)
- **Phase / Event / Kategorie** werden als Präfix-Keywords abgebildet
  (`phase:*`, `event:*`, `target-topic:*`)
- **Mehrfach-Event** pro Idee unterstützt
- **Anhänge** als Child-IOs direkt unter der Idee (Aspekt
  `ccm:io_childobject`, Assoc `ccm:childio`, Sortierung über
  `ccm:childobject_order`) — Cascading-Delete mit der Idee.
  Migration April 2026 vom alten Sammlungs-Pattern. Skill:
  `~/.claude/skills/wlo-childobjects/SKILL.md`
- **Mitmachen / Folgen** liegen in der App-SQLite (edu-sharing kennt sie nicht)

---

## Features (Stand Mai 2026)

### Für alle Besucher:innen

- **Themen-Drilldown** (Themen → Herausforderungen → Ideen, mit Breadcrumbs)
- **Veranstaltungs-Drilldown** mit QR-Code + Share-Link je Event
- **Trend-Rangliste** mit ▲▼-Pfeilen, Sparklines pro Idee, Top-5-
  Verlaufs-Chart + **„Top-Steiger der letzten 7 Tage"**-Sektion
  (Snapshots werden stündlich getrottelt geschrieben, letzten 60 behalten)
- **Volltext-Suche** mit `<mark>`-Highlights im Tile-Grid und 0-Treffer-
  Vorschlägen („Vielleicht meintest du…" + zuletzt aktualisierte Ideen)
- **Filter**: Phase, Veranstaltung, Kategorie, Topic
- **Detail-Ansicht** mit Rating, Kommentaren (mit Reply-to), Anhängen als
  Karten-Grid mit prominenten Download-Buttons
- **Öffentliches Profil** (`?view=user&u=<name>`) zeigt alle Ideen einer
  Person + Stats — verlinkt aus jeder Idee per Klick auf den Autor-Namen,
  mit Share-Link und Webkomponenten-Embed-Snippet
- **Drei Farbschemata** (default · hackathoern · dark), in der Topbar
  jederzeit umschaltbar; Logo passt sich automatisch an
- **Hilfe + Einbinden-Doku** über Footer-Links (Endnutzer-Anleitung +
  Entwickler-Doku mit allen Embed-Snippets)
- **Restricted-Banner** für nicht-öffentliche Ideen mit Login-Anzeige

### Für eingeloggte User

- **Eigene Ideen einreichen** mit Datei-Upload, Vorschaubild,
  Mehrfach-Event-Auswahl. Defaults für die WLO-Freischaltung
  (CC BY 4.0, Sprache `de`, Replikations-Quelle) werden automatisch
  gesetzt
- **Eigene Ideen** bearbeiten / duplizieren / löschen (App-seitiges
  Owner-Gating via `cm:creator` + `submitter:<user>`-Keyword)
- **„Aus Repo aktualisieren"-Button** auf der Idee-Detailseite zieht
  frische Daten (Titel, Beschreibung, Vorschaubild, …) ohne 5-Min-
  Sync abzuwarten
- **Phase-Status-Workflow** (Variante A): Owner darf nur eine Stufe
  vorwärts, „Archiviert" und Sprünge nur für Mods
- **Anhänge** direkt an die Idee hängen, umbenennen, löschen (Child-IO-Pattern)
- **Mitmachen** und **Folgen** je Idee
- **Eigene Kommentare löschen** (Verfasser:in selbst oder Mod)
- **Mein Bereich** mit:
  - „Was ist neu"-Feed (gefolgte/eigene/Mitmach-Ideen)
  - **Notification-Badge** am Username-Button mit Counter ungelesener
    Aktivitäten (Polling 60 s, Reset beim Öffnen)
  - Eigene Ideen, Followed, Mitmachen-Liste
- **Problem melden** über Modal — mit Status-Anzeige beim erneuten Öffnen
  („bereits gemeldet — wird geprüft" bzw. „bearbeitet")
- **Idee teilen** (Mail, WhatsApp, X, LinkedIn, Mastodon, Bluesky,
  Telegram, URL kopieren, im Repo öffnen) + **Embed-Snippet** als
  Web-Komponente

### Für Moderator:innen

Moderations-UI mit 10 Tabs:

| Tab | Funktion |
|---|---|
| 📊 **Statistik** | KPI-Karten + Wochen-Chart + Phasen-/Event-Verteilung + Top-Aktive User + Top-Engagement-Ideen + Action-Verteilung + Button „Pflicht-Metadaten nachpflegen" für Bulk-Backfill |
| 📥 **Postfach** | Anonyme Einreichungen verschieben (mit **Bulk-Move** über Checkboxen) oder löschen |
| ⚠ **Meldungen** | User-Meldungen prüfen, Idee öffnen, als erledigt markieren (Single + Bulk-Resolve via API) |
| 📝 **Aktivität** | Audit-Log aller App-Schreibvorgänge, filterbar nach Action / Akteur / Zeitraum, CSV-Export |
| 🗂 **Herausforderungen** | Themen + Herausforderungen anlegen, umbenennen, beschreiben, Vorschaubild setzen, sortieren (▲▼), löschen (nur leere) |
| 📅 **Veranstaltungen** | Event-Taxonomie verwalten + Share-Link/QR-Code je Event |
| 🎯 **Phasen** | Phasen-Taxonomie verwalten (sort_order steuert den Workflow) |
| 👥 **Moderatoren** | Lesende Anzeige aller Mod-Gruppen-Mitglieder. Verwaltung erfolgt direkt in edu-sharing (kein Add/Remove über die App, um globale Admin-Gruppen-Manipulation zu vermeiden) |
| 🚫 **Versteckt** | Soft-gelöschte Ideen einsehen + wieder anzeigen. Verstecken/Anzeigen-Aktion liegt in der Aktionen-Sidebar der Idee-Detailseite |
| 💾 **Backup** | DB-Sicherungen erstellen, herunterladen, hochladen, restaurieren |

### Backup / Restore

- **Sicherung**: nur die SQLite-DB (Activity-Log, Trends, Reports,
  Mitmachen/Folgen, Taxonomien, Topic-Sortierung)
- **Konsistent** via `VACUUM INTO` (kein File-Copy mit Locks)
- **Auto-Backup** alle 24h, behält die letzten 3 (konfigurierbar)
- **Pre-Restore-Backup** wird vor jedem Restore automatisch angelegt
- **Restore aus dem Mod-UI** mit Confirm-Dialog und Magic-Bytes-Validierung
- **Auto-Restore beim Erststart**: Wenn die App auf einem Volume mit
  Backup-ZIPs aber ohne SQLite-DB hochfährt, lädt sie automatisch das
  jüngste Backup vor der Schema-Migration. Damit ist Disaster-Recovery
  reine Volume-Wiederherstellung — nichts an der App muss angefasst werden.
  Eine bestehende DB wird **nie** überschrieben.
- edu-sharing-Daten werden NIE gesichert/restored — die liegen im edu-sharing-Repo
- **Konfiguration / Secrets sind NICHT im Backup** — die müssen in
  System-/Docker-Umgebungsvariablen liegen (siehe Sicherheit unten)
- Optionale **Off-Site-Spiegelung via rclone** in einen Google-Drive-Ordner —
  siehe [`scripts/BACKUP-GDRIVE.md`](scripts/BACKUP-GDRIVE.md)

---

## Web Components

> Die laufende App hat unter **Footer → „Einbinden"** alle Embed-Szenarien
> mit Live-Snippets zum Kopieren. Diese Sektion ist die Kurzfassung für
> den Einstieg.

```html
<!-- 0. Setup-Snippet (einmal pro Seite) -->
<script type="module" src="https://ideen.example.de/main.js"></script>

<!-- 1. Voll-App -->
<ideendb-app api-base="/api/v1"></ideendb-app>

<!-- 2. Direkt eine bestimmte Idee öffnen -->
<ideendb-app api-base="/api/v1" view="detail" idea-id="<UUID>"></ideendb-app>

<!-- 3. Öffentliches Profil einer Person -->
<ideendb-app api-base="/api/v1" view="user" u="<username>"></ideendb-app>

<!-- 4. Rangliste, Herausforderungen, Veranstaltungen, Submit-Form, Browser -->
<ideendb-app api-base="/api/v1" view="ranking"></ideendb-app>
<ideendb-app api-base="/api/v1" view="topics"></ideendb-app>
<ideendb-app api-base="/api/v1" view="events"></ideendb-app>
<ideendb-app api-base="/api/v1" view="browser"></ideendb-app>
<ideendb-app api-base="/api/v1" view="submit"></ideendb-app>

<!-- 5. Kachelansicht für Drittseiten -->
<ideendb-tile-grid
  api-base="https://ideen.example.de/api/v1"
  event="hackathoern-3"
  sort="rating"
  limit="6"
  theme="dark"></ideendb-tile-grid>

<!-- 6. Einzelne Ideen als Kachel(n) via Komma-Liste -->
<ideendb-tile-grid
  api-base="/api/v1"
  ids="<UUID-1>,<UUID-2>,<UUID-3>"
  hide-footer></ideendb-tile-grid>
```

### `<ideendb-app>` Attribute

| Attribut | Werte | Bedeutung |
|---|---|---|
| `api-base` | URL | Basis-URL des FastAPI-Backends, default `/api/v1` |
| `theme` | `default` ⋅ `hackathoern` ⋅ `dark` | initiales Farbschema. Leer = LocalStorage / `prefers-color-scheme` |
| `view` | `home` ⋅ `detail` ⋅ `user` ⋅ `browser` ⋅ `ranking` ⋅ `topics` ⋅ `events` ⋅ `submit` ⋅ `profile` ⋅ `imprint` ⋅ `privacy` ⋅ `embed` ⋅ `help` | Initiale Seite |
| `idea-id` | UUID | nur bei `view="detail"`: ID der direkt geöffneten Idee |
| `u` | Username | nur bei `view="user"`: Profil-Username |

### `<ideendb-tile-grid>` Attribute

| Attribut | Werte | Bedeutung |
|---|---|---|
| `api-base` | URL | siehe oben |
| `theme` | siehe oben | Farbschema |
| `topic-id` | UUID | nur Ideen unter dieser Sammlung |
| `phase` | Slug | Filter (z.B. `pitch-bereit`) |
| `event` | Slug | Filter (z.B. `hackathoern-3`) |
| `category` | Slug | Filter |
| `q` | Text | Volltextsuche |
| `ids` | Komma-UUIDs | Gezielte Auswahl einer oder mehrerer Ideen (Embed-Use-Case) |
| `sort` | `modified` ⋅ `created` ⋅ `rating` ⋅ `comments` ⋅ `title` | |
| `order` | `asc` ⋅ `desc` | Sortier-Richtung |
| `limit` | Zahl 1–200 | max. Anzahl Kacheln |
| `hide-footer` | boolean | „Mehr laden"-Button verstecken |

### Farbschemata

| Theme | Verwendung | Look |
|---|---|---|
| `default` | klassisches WLO-Branding | dunkelblauer Header, blau-gelbe Akzente |
| `hackathoern` | helles HackathOERn-Branding | weißer Header mit Logo-Farben (Cyan #27ABE2, Coral #ED8F65, Olive #B7B764, Charcoal #383838) |
| `dark` | Dark Mode | rein neutrale Grauabstufungen, keine Blautöne, dezenter Gold-Akzent |

Der User kann das Theme in der Topbar (3 Farb-Quadrate rechts) jederzeit wechseln. Wenn `theme=...` als Attribut gesetzt ist, gilt dieser Wert beim Mount; spätere User-Wechsel werden in `localStorage` (`ideendb-theme`) gespeichert und beim nächsten Aufruf übernommen.

Eingebettete Komponenten ohne sichtbare Topbar (z.B. `<ideendb-tile-grid>` auf einer Drittseite) übernehmen das Theme ebenfalls — gehört zum gleichen DOM-`<html>`-Scope, sodass alle CSS-Custom-Properties wirken.

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

Vorlage: `cp .env.example .env` und Platzhalter ersetzen.

#### Pflicht

| Variable | Was | Woher |
|---|---|---|
| `EDU_GUEST_USER` | Username des edu-sharing-Service-Accounts (anonymes Submit-Routing) | WLO-Redaktion |
| `EDU_GUEST_PASS` | Passwort dazu | WLO-Redaktion |
| `APP_CORS_ORIGINS` | Komma-Liste erlaubter Browser-Origins | eigene Domain(en) |

> Die App startet zwar auch ohne diese Werte, aber jeder edu-sharing-
> Call (Sync, anonyme Einreichung) bekommt dann 401. Mit
> `docker compose up` schlägt das Hochfahren dank `${VAR:?…}`-Pattern
> hart fehl, wenn die Pflichtfelder leer sind — bei `docker run`
> müssen sie als `-e EDU_GUEST_USER=…` ans Command angehängt werden.

#### Optional (sinnvolle Defaults vorhanden)

| Variable | Default | Bedeutung |
|---|---|---|
| `EDU_REPO_BASE_URL` | `https://redaktion.openeduhub.net` | Repo-Host |
| `EDU_REPO_API` | `…/edu-sharing/rest` | API-Pfad |
| `EDU_GUEST_INBOX_ID` | UUID der HackathOERn-Inbox | nur ändern bei eigener Inbox |
| `IDEENDB_ROOT_COLLECTION_ID` | UUID der HackathOERn-Wurzel-Sammlung | nur ändern bei eigenem Root |
| `APP_HOST` / `APP_PORT` | `127.0.0.1` / `8000` | Uvicorn-Bind |
| `SQLITE_PATH` | `./data/ideendb.sqlite` | im Docker: `/data/ideendb.sqlite` |
| `SYNC_INTERVAL_SECONDS` | `300` | edu-sharing-Sync-Intervall |
| `BACKUP_ENABLED` | `true` | Auto-Backup-Loop |
| `BACKUP_DIR` | `./data/backups` | im Docker: `/data/backups` |
| `BACKUP_INTERVAL_HOURS` | `24` | wie oft Auto-Backup |
| `BACKUP_KEEP` | `3` | Retention der ZIPs |
| `MODERATION_FALLBACK_GROUPS` | `GROUP_ALFRESCO_ADMINISTRATORS` | Mod-Gruppen (Komma-Liste) |
| `MODERATION_BOOTSTRAP_USERS` | _leer_ | Username-Liste mit Mod-Rechten unabhängig von der Gruppe |

> **Secrets NIEMALS** ins Git-Repo. `.env` ist in `.gitignore`. Auch
> Backups enthalten bewusst keine Konfig — die liegt ausschließlich in
> System-/Docker-Umgebungsvariablen.

---

## Deployment (Docker, empfohlen)

Ein-Container-Image baut Backend + Frontend in einem Schritt und serviert
beides aus demselben Uvicorn-Prozess. Image wird via GitHub Actions auf
[GitHub Container Registry](https://ghcr.io) gepusht.

### Quick-Start (Docker Compose)

```bash
git clone https://github.com/janschachtschabel/ideendatenbank.git
cd ideendatenbank
cp .env.example .env             # Pflichtfelder setzen, v.a. EDU_GUEST_USER/PASS

docker compose up -d             # baut + startet
docker compose logs -f           # Log live mitlesen
open http://localhost:8000       # Voll-App
```

Persistente Daten landen im Docker-Volume `ideendb-data` (SQLite + Backups).
Reset:

```bash
docker compose down -v           # ACHTUNG: löscht das Volume
```

#### Disaster-Recovery / Neuinstallation mit Backup-Wiederherstellung

Auf eine frische Installation/Volume legst du einfach ein Backup-ZIP ins
`backups/`-Unterverzeichnis und startest die App — sie zieht beim Boot
automatisch das jüngste vorhandene Backup, **bevor** die Schema-Migration
läuft.

```bash
# Beispiel: vorhandenes Backup ins frische Volume kopieren
docker volume create ideendb-data
docker run --rm -v ideendb-data:/data -v "$PWD":/host alpine \
  sh -c "mkdir -p /data/backups && cp /host/ideendb-backup-*.zip /data/backups/"

docker compose up -d
docker compose logs ideendb | grep auto-restore
# → auto-restore: stelle ideendb-backup-20260511-...zip wieder her
```

Eine bereits vorhandene DB wird dabei **nie** überschrieben — der
Auto-Restore springt nur an, wenn `SQLITE_PATH` fehlt oder leer ist.

### Aus GHCR ziehen (ohne lokalen Build)

```bash
docker pull ghcr.io/janschachtschabel/ideendatenbank:main

docker run -d --name ideendb \
  -p 127.0.0.1:8000:8000 \
  -v ideendb-data:/data \
  -e EDU_GUEST_USER=WLO-Upload \
  -e EDU_GUEST_PASS='<von-WLO-erhalten>' \
  -e MODERATION_BOOTSTRAP_USERS=dein-username \
  -e APP_CORS_ORIGINS=https://ideen.example.de \
  ghcr.io/janschachtschabel/ideendatenbank:main
```

Verfügbare Tags:

| Tag | Bedeutung |
|---|---|
| `main` | Letzter erfolgreicher Build vom main-Branch |
| `vX.Y.Z` | Release-Tag |
| `latest` | Letzter Release-Tag |
| `sha-<short>` | Pinned auf einen Commit |

### Update auf neue Version

```bash
docker compose pull              # neuestes Image holen
docker compose up -d             # Container neu starten, Volume bleibt
```

DB-Migrationen laufen idempotent beim Startup über `init_db()` —
bestehende Daten bleiben heile.

### Lokal bauen ohne Docker

Wer ohne Container entwickeln will:

```bash
cd frontend && npm run build:embed         # → dist/embed/browser/
cd ../backend && uvicorn app.main:app      # serviert API + Bundle
```

Das Backend mountet `frontend/dist/embed/browser/` automatisch als Root,
sofern das Verzeichnis existiert. Keine CORS-Sorgen, eine Deploy-Einheit.

### CI/CD

`.github/workflows/`:

- **`ci.yml`** — bei jedem Push/PR: Backend-Imports + Frontend-Build prüfen
- **`docker.yml`** — bei Push auf main, git-Tag `vX.Y.Z` oder manuell:
  Image bauen + nach `ghcr.io/janschachtschabel/ideendatenbank` pushen
  - PRs bauen das Image, pushen aber nicht (nur Sanity-Check)
  - Tags + Labels werden automatisch via `docker/metadata-action` gesetzt
  - Build-Cache liegt in der GitHub-Actions-Cache-Schicht
  - Provenance + SBOM werden mit signiert (Sigstore via OIDC)

Erste Veröffentlichung nach Repo-Push: GitHub Actions läuft automatisch.
Im GitHub-Repo unter **Settings → Packages** sicherstellen, dass das
veröffentlichte Image auf „Public" gestellt ist (sonst braucht jeder
Pull einen GHCR-Login).

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
- `http://127.0.0.1:8000/?view=help` — Endnutzer-Hilfeseite
- `http://127.0.0.1:8000/?view=embed` — Entwickler-Doku mit allen Embed-Snippets
- `http://127.0.0.1:8000/?view=detail&id=<uuid>` — Direkt-Link Idee
- `http://127.0.0.1:8000/?view=user&u=<username>` — Öffentliches Profil
- `http://127.0.0.1:8000/embed-demo.html` — Statische Einbettungs-Demo
- `http://127.0.0.1:8000/docs` — OpenAPI/Swagger

---

## Verzeichnis

- `backend/app/`
  - `main.py` — FastAPI-App + Lifespan (Auto-Restore vor `init_db`, Sync-Loop, Auto-Backup)
  - `routes.py` — alle API-Endpoints (Ideen, Topics, Ranking, Moderation, Backup, Users, Notifications, …)
  - `db.py` — SQLite-Schema + idempotente Migrationen (inkl. `idea.hidden`, `user_feed_seen`, `idea_report`)
  - `sync.py` — edu-sharing-Sync, Single-Node-Refresh, Trend-Snapshots
  - `backup.py` — Backup/Restore-Logik + Auto-Restore beim Erststart
  - `edu_sharing.py` — REST-Client für edu-sharing
  - `config.py` — pydantic-settings
- `frontend/src/app/`
  - `app-shell/` — Voll-App-Komponente + Mod-UI + Detail + Submit
    - `app-shell.component.ts` — Shell, Routing, Topbar, Theme-Switcher
    - `idea-detail.component.ts` — Detail mit Kommentaren, Rating, Anhängen, Aktionen-Sidebar
    - `moderation.component.ts` — Mod-UI mit 10 Tabs
    - `profile.component.ts` — Mein Bereich (eigener Feed/Ideen/Follows)
    - `public-profile.component.ts` — öffentliches Profil
    - `ranking.component.ts` — Trend-Rangliste + Top-Steiger
    - `submit-idea.component.ts` — Einreiche-Formular
    - `embed.component.ts` — Entwickler-Doku: Embed-Snippets aller Web-Components
    - `help.component.ts` — Endnutzer-Hilfeseite
    - `legal.component.ts` — Impressum + Datenschutz
  - `tile-grid/` — Standalone-Kachelansicht (Web-Component `<ideendb-tile-grid>`)
  - `api.service.ts` — HttpClient-Wrapper
  - `models.ts` — TypeScript-Typen
  - `theme.service.ts` — Theme-State (Signal-basiert, in LocalStorage)
- `scripts/`
  - `backup-to-gdrive.sh` / `.ps1` — rclone-basierte Off-Site-Spiegelung
  - `BACKUP-GDRIVE.md` — Setup-Anleitung
  - `explore_api.py` u.a. — Explorations- und Probe-Skripte gegen
    edu-sharing. Erwarten die Credentials als Umgebungsvariablen:
    ```bash
    EDU_GUEST_USER=… EDU_GUEST_PASS=… python scripts/explore_api.py
    ```
- `.env.example` — Konfig-Vorlage
- `CLAUDE.md` — Detail-Spec + Architektur-Entscheidungen

---

## Code-Qualität / Linter

Beide Stacks haben einen Linter eingerichtet, der bei jedem Commit lokal
laufen sollte:

### Backend — `ruff`

```bash
cd backend
pip install ruff
ruff check app/                       # Lint
ruff check app/ --fix                 # sichere Auto-Fixes (Imports, etc.)
ruff format app/                      # Black-kompatible Formatierung (optional)
```

Konfiguration in `backend/pyproject.toml`. Aktivierte Regelgruppen: `E F I B UP C4 SIM`.
Bewusst deaktiviert: `E501` (Line-Länge), `B904` (raise-from), `SIM105`
(suppressible-exception), `E701/E702` — jede Entscheidung kommentiert.

### Frontend — `@angular-eslint`

```bash
cd frontend
npx ng lint                           # Lint
npx ng lint --fix                     # Auto-Fix
```

Konfiguration in `frontend/eslint.config.js`. Projekt-Prefix `ideendb-`,
A11y-Regeln auf `warn` (iterative Verbesserung), Web-Component-Inputs
mit Bindestrich-Attributen erlaubt (`no-input-rename: off`).

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
