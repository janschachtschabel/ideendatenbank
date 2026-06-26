# HackathOERn Ideendatenbank

Plattform zum Einreichen, Diskutieren und Bewerten von OER-Ideen.
Backend in **FastAPI**, Frontend als **Angular Web Components**, Persistenz
in **edu-sharing** (`redaktion.openeduhub.net`).

> 📦 **Installation auf einem Server** → [`docs/INSTALL-DOCKER.md`](docs/INSTALL-DOCKER.md)
> 🔄 **Docker-Update (Schnellreferenz)** → [`docs/DOCKER-UPDATE.md`](docs/DOCKER-UPDATE.md)
> 📖 **Bedienung (Endnutzer)** → [`docs/benutzerhandbuch/`](docs/benutzerhandbuch/)
> 🛠 **Bedienung (Moderation)** → [`docs/moderation/`](docs/moderation/)
> 🏗 **Architektur & Technik** → [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md)
> 🔌 **Zusammenspiel mit edu-sharing** → [`docs/EDU-SHARING-ZUSAMMENSPIEL.md`](docs/EDU-SHARING-ZUSAMMENSPIEL.md)

---

## Inhalt

- [Architektur](#architektur) — wie die Komponenten zusammenspielen
- [Features](#features) — was die App kann
- [Web Components](#web-components) — Einbettung auf eigenen Seiten
- [Teilen- & Direkt-Links](#teilen---direkt-links) — verlinkbare Ansichten + QR-Codes
- [Setup (Development)](#setup-development) — lokal entwickeln
- [Deployment](#deployment) — Produktiv-Betrieb
- [Verzeichnis](#verzeichnis) — Code-Karte
- [Sicherheit](#sicherheit) — was die App selbst mitbringt
- [Lizenz](#lizenz)

---

## Architektur

> Ausführlich: [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md) (Techniken Backend/Frontend)
> und [`docs/EDU-SHARING-ZUSAMMENSPIEL.md`](docs/EDU-SHARING-ZUSAMMENSPIEL.md)
> (Cache ↔ edu-sharing). Kurzfassung:

```
Browser (<ideendb-app> / <ideendb-tile-grid> Web Components)
        │
        ▼
FastAPI Backend  ──► SQLite (FTS5, Activity-Log, Trend-Snapshots,
        │                    Reports, Mithacken/Folgen, Taxonomien,
        │                    Captcha-Tokens)
        ▼
edu-sharing REST-API (Source of Truth: Ideen, Rating, Kommentare, User)
```

**Trennung**:
- **edu-sharing** ist die einzig verbindliche Datenquelle für Ideen,
  Kommentare, Bewertungen, Anhänge, User und ACLs
- **SQLite** ist nur ein Performance-Cache + Speicher für App-spezifische
  Zusätze (Mithacken, Folgen, Reports, Versteckt-Flag, Aktivitäts-Log,
  Captcha-Challenges)
- Sync alle 15 Min, plus Single-Node-Refresh bei jeder Schreib-Aktion

### Datenmodell

```
Themenbereich (ccm:map)             ← Top-Level-Sammlungen
└── Herausforderung (ccm:map)
    └── Idee (ccm:io)               ← Idee = ein ccm:io
        ├── anhang.pdf              ← optional 0..n Child-IOs
        └── ...                       (Aspekt ccm:io_childobject,
                                       Assoc ccm:childio)
```

- **Idee = ein ccm:io** (kein eigenes MDS, nutzt Standard-Felder)
- **Rating + Kommentare** laufen direkt am ccm:io
- **Phase / Event / Kategorie** werden als Präfix-Keywords abgebildet
  (`phase:*`, `event:*`, `target-topic:*`)
- **Mehrfach-Event** pro Idee unterstützt
- **Anhänge** als Child-IOs direkt unter der Idee (Cascading-Delete mit
  der Idee). Migration April 2026 vom alten Sammlungs-Pattern.
- **Mithacken / Folgen** liegen in der App-SQLite (edu-sharing kennt sie nicht)
- **Inbox-Pattern**: anonyme Submits landen in der Community-Inbox, von dort
  setzt die Moderation **Reference-Knoten** in die Herausforderungs-Sammlungen
  (kein `_move`)

---

## Features

### Für alle Besucher:innen

- Themen-Drilldown (Themenbereiche → Herausforderungen → Ideen)
- Volltext-Suche, sortier-/filterbare Liste
- Sterne- **oder** Daumen-Bewertung (im Mod-Bereich umschaltbar), Kommentare, Beschreibungen
- Trend-Rangliste mit Top-Steigern
- Themen- und Veranstaltungs-Übersicht mit aggregierten Counts
- Direkt-Links auf Ideen, Themen, Veranstaltungen, User
- Drei Farbschemata (Default, HackathOERn-hell, Dark) mit User-Wechsel

### Für eingeloggte User

- Idee einreichen (Veranstaltung ist Pflicht; Phase/Themen-Vorwahl;
  bis zu 4 Anhänge + Vorschaubild direkt im Formular)
- Eigene Ideen bearbeiten (Titel, Beschreibung, Phase, Anhänge ergänzen)
- **Mithacken** (mit Freigabe-Workflow) + **Folgen** mit Avatar-Reihe an der Idee
- Profil „Mein Bereich": eigene Ideen, Mithacken, Mithack-Anfragen freigeben,
  Folgen, „Was ist neu"-Feed, Profil (Rollen + opt-in-Kontakt)
- Öffentliches Profil pro User (auch ohne Login einsehbar)
- Anonyme Submits werden durch eine **kleine Mathe-Captcha** vor
  Bot-Spam geschützt (kein Drittanbieter)

### Für Moderator:innen

- Sticky Pill-/Dropdown-Navigation in fünf Gruppen: **Statistik**,
  **Postfach**, **Inhalte** (Themenbereiche · Veranstaltungen · Phasen),
  **Moderation** (Meldungen · Aktivität · Inhalte verwalten),
  **System** (Moderatoren · Backup)
- Postfach mit Bulk-Move + Sync-Differenz-Abgleich (Cache ↔ edu-sharing)
- „Inhalte verwalten": alle Ideen durchsuchen, bearbeiten, verstecken/
  einblenden und löschen an einer Stelle
- Audit-Log aller Schreib-Aktionen, CSV-Export
- Statistik-Dashboard mit Phasen-/Event-Verteilung, Top-Aktive User,
  Engagement-Ideen

### Backup / Restore

- Auto-Backup alle 24h (konfigurierbar), Retention konfigurierbar
- `VACUUM INTO` für konsistente Snapshots ohne App-Stop
- Atomare ZIP-Schreibvorgänge (kein Halb-File bei Crash)
- Pre-Restore-Safety-Backup vor jedem Restore
- **Auto-Restore beim Erststart** mit Opt-in-Marker (`AUTO_RESTORE_OK`),
  ideal für Disaster-Recovery
- Off-Site-Spiegelung via `rclone` → Google Drive (Setup siehe
  [`scripts/BACKUP-GDRIVE.md`](scripts/BACKUP-GDRIVE.md), Empfehlung mit
  `rclone crypt` bei personenbezogenen Daten)

---

## Web Components

> Die laufende App hat unter **Footer → „Einbinden"** alle Embed-Szenarien
> mit Live-Snippets zum Kopieren. Hier die Kurzfassung.

```html
<!-- 0. Setup-Snippet (einmal pro Seite) -->
<script type="module" src="https://<deine-domain>/main.js"></script>

<!-- 1. Voll-App -->
<ideendb-app api-base="/api/v1"></ideendb-app>

<!-- 2. Direkt eine bestimmte Idee öffnen -->
<ideendb-app api-base="/api/v1" view="detail" idea-id="<UUID>"></ideendb-app>

<!-- 3. Kachelansicht (Drittseiten-Embed) -->
<ideendb-tile-grid
  api-base="https://<deine-domain>/api/v1"
  event="<event-slug>"
  sort="rating"
  limit="6"
  theme="dark"></ideendb-tile-grid>
```

### `<ideendb-app>` Attribute

| Attribut | Werte | Bedeutung |
|---|---|---|
| `api-base` | URL | Basis-URL des FastAPI-Backends, Default `/api/v1` |
| `theme` | `default` ⋅ `hackathoern` ⋅ `dark` | Initiales Farbschema |
| `view` | `home` ⋅ `detail` ⋅ `user` ⋅ `browser` ⋅ `ranking` ⋅ `topics` ⋅ `events` ⋅ `submit` ⋅ `profile` ⋅ `imprint` ⋅ `privacy` ⋅ `embed` ⋅ `help` | Initiale Seite |
| `idea-id` | UUID | bei `view="detail"`: ID der direkt geöffneten Idee |
| `u` | Username | bei `view="user"`: Profil-Username |

### `<ideendb-tile-grid>` Attribute

| Attribut | Werte | Bedeutung |
|---|---|---|
| `api-base` | URL | siehe oben |
| `theme` | siehe oben | Farbschema |
| `topic-id` | UUID | nur Ideen unter dieser Sammlung |
| `phase` / `event` / `category` | Slug | Filter (z.B. `pitch-bereit`) |
| `q` | Text | Volltextsuche |
| `ids` | Komma-UUIDs | gezielte Auswahl einer/mehrerer Ideen |
| `sort` | `modified` ⋅ `created` ⋅ `rating` ⋅ `comments` ⋅ `title` | |
| `order` | `asc` ⋅ `desc` | Sortier-Richtung |
| `limit` | 1–200 | max. Kachel-Anzahl |
| `hide-footer` | boolean | „Mehr laden" verstecken |

### Theme-Verhalten

User-Wechsel über die Topbar landet in `localStorage` (Schlüssel
`ideendb-theme`) und gilt für alle Web-Components im selben DOM-Scope —
auch eingebettete Komponenten auf Drittseiten ohne sichtbare Topbar.

---

## Teilen- & Direkt-Links

Alle Ansichten sind über `?view=…`-Query-Parameter direkt verlinkbar — ideal
für QR-Codes auf Plakaten, Einladungs-Mails oder Folien. Die App stellt an
mehreren Stellen fertige „Teilen"-Dialoge mit Link + QR-Code bereit
(Idee-Detailseite, öffentliches Profil, Veranstaltungs-Seite, Rangliste).

Basis ist die Instanz-URL (z.B. `https://<deine-domain>/`):

| Zweck | Link-Muster |
|---|---|
| **Idee einreichen** (allgemein) | `?view=submit` |
| **Idee einreichen, Event vorgewählt** | `?view=submit&event=<slug>` |
| **Einzelne Idee** öffnen | `?view=detail&id=<UUID>` |
| **Veranstaltungs-Seite** (Ideen + Voting-Verlauf + Schnellvoting) | `?view=events&event=<slug>` |
| **Rangliste** (alle Ideen, live) | `?view=ranking` |
| **Rangliste, nach Event gefiltert** | `?view=ranking&event=<slug>` |
| **Öffentliches Profil** | `?view=user&u=<username>` |
| **Themen-/Herausforderungs-Übersicht** | `?view=topics` |
| **Hilfe / Einbinden / Impressum / Datenschutz** | `?view=help` ⋅ `?view=embed` ⋅ `?view=imprint` ⋅ `?view=privacy` |

**Drei sinnvolle Teilen-Wege pro Veranstaltung** (alle im „Teilen"-Dialog der
Event-Seite mit eigenem QR-Code):

- `?view=submit&event=<slug>` — „Reicht eure Ideen ein!"
- `?view=events&event=<slug>` — „Stöbert & stimmt ab" (Event-Hub)
- `?view=ranking&event=<slug>` — „Schaut euch den Live-Stand an"

> Die QR-Codes werden **lokal im Browser** erzeugt (`qrcode-generator` →
> Data-URI-PNG, **kein externer Dienst**) — DSGVO-neutral, es verlassen keine
> Daten die Seite.

---

## Setup (Development)

```bash
cp .env.example .env
# Pflichtfelder eintragen, v.a. EDU_GUEST_USER / EDU_GUEST_PASS
# (Werte vom WLO-Redaktionsteam)

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
# Dev-Server proxyt /api/* an :8000 (proxy.conf.json)
```

### Konfiguration via `.env`

Vorlage: `cp .env.example .env`. Die Pflichtfelder + alle optionalen
Werte sind in der **[Installations-Anleitung](docs/INSTALL-DOCKER.md)**
ausführlich dokumentiert.

Kürzeste Zusammenfassung:

| Variable | Pflicht? | Bedeutung |
|---|---|---|
| `EDU_GUEST_USER` + `EDU_GUEST_PASS` | ✅ | Service-Account fürs anonyme Submit-Routing (WLO-Team) |
| `EDU_GUEST_INBOX_ID` | ✅ | UUID der Community-Inbox im Repo |
| `IDEENDB_ROOT_COLLECTION_ID` | ✅ | UUID der obersten Themen-Sammlung |
| `APP_CORS_ORIGINS` | ✅ | erlaubte Browser-Origins (kommagetrennt) |
| `EDU_REPO_BASE_URL` | optional | Repo-Host; steuert API **und** „im Repo öffnen"-/Registrierungs-Links. Für ein anderes Repo **nur diese** Zeile ändern |
| `EDU_REPO_API` | optional | API-Basis; leer = automatisch aus `EDU_REPO_BASE_URL` abgeleitet (`<base>/edu-sharing/rest`) |
| `MODERATION_FALLBACK_GROUPS` | optional | edu-sharing-Gruppen mit Mod-Rechten (einzige Mod-Quelle) |
| `BACKUP_*` / `BACKUP_AUTO_RESTORE_MARKER` | optional | Auto-Backup-Intervall, Retention, Auto-Restore-Marker |
| `SYNC_INTERVAL_SECONDS` / `UPLOAD_*_MAX_BYTES` | optional | sinnvolle Defaults vorhanden |
| `B_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | optional | reserviert für künftige LLM-Funktionen |

> Das **Bewertungssystem** (Sterne vs. Daumen hoch) ist **keine** Env-Variable,
> sondern wird zur Laufzeit im Moderationsbereich umgeschaltet — global und
> optional pro Veranstaltung.

> **Secrets niemals** ins Git-Repo. `.env` ist gitignored. Backup-ZIPs
> enthalten bewusst keine Konfig — die liegt ausschließlich in
> Umgebungsvariablen.

### Lokal bauen ohne Frontend-Dev-Server

```bash
cd frontend && npm run build:embed         # → dist/embed/browser/
cd ../backend && uvicorn app.main:app      # serviert API + Bundle
```

Das Backend mountet `frontend/dist/embed/browser/` automatisch als Root,
sofern das Verzeichnis existiert. Eine Deploy-Einheit, keine CORS-Sorgen.

---

## Deployment

Für die Produktiv-Installation auf einem eigenen Server gibt es eine
dedizierte Schritt-für-Schritt-Anleitung:

→ **[`docs/INSTALL-DOCKER.md`](docs/INSTALL-DOCKER.md)** —
Docker-Container, nginx + TLS, Backup-Strategie, Härtung,
Troubleshooting.

### CI/CD (`.github/workflows/`)

- **`ci.yml`** — bei jedem Push/PR: Backend `ruff` + `pytest`, Frontend `ng lint`
  + `ng test` + `build:embed`
- **`docker.yml`** — bei Push auf `main`, git-Tag `vX.Y.Z` oder manuell:
  Image bauen + nach `ghcr.io/janschachtschabel/ideendatenbank` pushen

Verfügbare Image-Tags:

| Tag | Bedeutung |
|---|---|
| `main` | Letzter erfolgreicher Build vom main-Branch |
| `vX.Y.Z` | Release-Tag |
| `latest` | Letzter Release-Tag |
| `sha-<short>` | Pinned auf einen Commit |

### Web-Component auf Drittseite einbinden

```html
<script type="module" src="https://<deine-domain>/main.js"></script>
<ideendb-app api-base="https://<deine-domain>/api/v1"></ideendb-app>
```

`APP_CORS_ORIGINS` im Backend-Env muss die Drittseiten-Domain enthalten.

---

## Verzeichnis

### Backend (`backend/app/`)

| Datei | Inhalt |
|---|---|
| `main.py` | FastAPI-App + Lifespan (Auto-Restore vor `init_db`, Sync-Loop, Auto-Backup) |
| `routes.py` | alle API-Endpoints (Ideen, Topics, Ranking, Moderation, Backup, Users, Notifications, Captcha) |
| `db.py` | SQLite-Schema + idempotente Migrationen |
| `sync.py` | edu-sharing-Sync, Single-Node-Refresh, Trend-Snapshots, Geisterzeilen-Cleanup |
| `backup.py` | Backup/Restore-Logik + Auto-Restore beim Erststart |
| `edu_sharing.py` | REST-Client für edu-sharing |
| `ratelimit.py` | slowapi-Limiter (Auth-User-Hash bei eingeloggt, IP bei anonym) |
| `config.py` | pydantic-settings |

### Frontend (`frontend/src/app/`)

| Pfad | Inhalt |
|---|---|
| `app-shell/app-shell.component.ts` | Shell, Routing, Topbar, Theme-Switcher |
| `app-shell/idea-detail.component.ts` | Detail mit Kommentaren, Rating, Anhängen, Sidebar |
| `app-shell/moderation.component.ts` | Mod-UI (gruppierte Pill-/Dropdown-Navigation) |
| `app-shell/profile.component.ts` | „Mein Bereich" (Feed, eigene Ideen, Mithacken, Folgen, Profil) |
| `app-shell/public-profile.component.ts` | öffentliches Profil |
| `app-shell/ranking.component.ts` | Trend-Rangliste + Top-Steiger |
| `app-shell/submit-idea.component.ts` | Einreiche-Formular inkl. Mathe-Captcha |
| `app-shell/embed.component.ts` | Entwickler-Doku: alle Embed-Snippets |
| `app-shell/help.component.ts` | Endnutzer-Hilfeseite |
| `app-shell/legal.component.ts` | Impressum + Datenschutz |
| `tile-grid/` | Standalone-Kachelansicht `<ideendb-tile-grid>` |
| `api.service.ts` | HttpClient-Wrapper |
| `models.ts` | TypeScript-Typen |
| `theme.service.ts` | Theme-State (Signal-basiert, in LocalStorage) |

### Doku & Skripte

| Pfad | Inhalt |
|---|---|
| `docs/INSTALL-DOCKER.md` | Schritt-für-Schritt-Installation auf einem Server |
| `docs/benutzerhandbuch/` | Bedienungs-Handbuch für Endnutzer (Confluence/PDF-tauglich) |
| `docs/moderation/` | Bedienungs-Handbuch für Moderator:innen |
| `scripts/BACKUP-GDRIVE.md` | Setup für Off-Site-Backup-Spiegelung via rclone |
| `scripts/*.py` | Einmalige Migrations- und Wartungs-Skripte |

---

## Code-Qualität

### Backend — `ruff`

```bash
cd backend && pip install ruff
ruff check app/                       # Lint
ruff check app/ --fix                 # sichere Auto-Fixes
ruff format app/                      # Formatierung (optional)
```

Konfiguration in `backend/pyproject.toml`. Regelgruppen: `E F I B UP C4 SIM`.

### Frontend — `@angular-eslint`

```bash
cd frontend
npx ng lint
npx ng lint --fix
```

Konfiguration in `frontend/eslint.config.js`.

### Tests

Backend (pytest) — der Harness mockt edu-sharing über das Singleton
`app.edu_sharing.client` und nutzt eine temporäre SQLite pro Test; es fließt
kein Netz-/Prod-Zugriff:

```bash
cd backend
pip install -e ".[dev]"      # einmalig: pytest + ruff
pytest                       # Auth-Gating, Ideen, Ratings, Moderation,
                             # Sync-Diff/Karteileichen, Captcha, Health …
```

Frontend (Karma + Jasmine, headless):

```bash
cd frontend
npx ng test --watch=false --browsers=ChromeHeadless
# CI/Linux-Runner ohne Sandbox-Rechte:
#   npx ng test --watch=false --browsers=ChromeHeadlessNoSandbox
```

Beide laufen in CI (`.github/workflows/ci.yml`, `.gitlab-ci.yml`).

---

## Sicherheit

Die App bringt out-of-the-box mit:

- **Mathe-Captcha** für anonyme Submits (kein Drittanbieter, DSGVO-neutral)
- **Rate-Limiting** auf Schreib-Endpoints (Auth-User-Hash bei eingeloggt,
  IP nur bei anonym — Schul-NAT-tauglich)
- **Upload-Caps** auf allen Datei-Endpoints (10 MB Bilder / 50 MB Anhänge /
  200 MB Restore), Streaming statt RAM-Pufferung
- **URL-Validierung** (http(s)-only) für project-URLs — blockt `javascript:`/
  `data:`-XSS-Vektoren
- **Strikte CORS**-Whitelist
- **Atomares Backup-Schreiben** (`.zip.tmp` → `os.replace`)
- **Magic-Bytes-Check** beim Restore-Upload
- **Pfad-Traversal-Schutz** auf Backup-Endpoints
- **Auto-Restore mit Opt-in-Marker** (verhindert versehentliches
  Überschreiben aus untergeschobenen ZIPs)
- **Auth-Failed-Audit-Log** für Brute-Force-Erkennung
- **Backup-ZIPs enthalten KEINE Secrets** — `.env` bleibt im System-Env

Empfehlungen für die Produktiv-Schicht (Reverse-Proxy mit TLS,
client_max_body_size, fail2ban, Off-Site-Backup) sind in
[`docs/INSTALL-DOCKER.md`](docs/INSTALL-DOCKER.md#8-härtungs-optionen-empfehlung-für-production)
ausgeführt.

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
