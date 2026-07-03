# Architektur: Backend & Frontend

Diese Seite erklärt die eingesetzten Techniken. Wie die App mit edu-sharing
zusammenspielt (was im Cache, was im Repo liegt), steht separat in
[`EDU-SHARING-ZUSAMMENSPIEL.md`](EDU-SHARING-ZUSAMMENSPIEL.md).

## Überblick

```
   Browser
   └── <ideendb-app> / <ideendb-tile-grid>   (Angular Web Components)
            │  HTTP + Authorization: Basic (durchgereicht)
            ▼
   FastAPI-Backend (ein Prozess)
   ├── Routen (REST, /api/v1/*) + Rate-Limiting
   ├── EduSharingClient (httpx async)
   ├── Sync-Worker (asyncio-Loop, alle 15 min)
   ├── Backup-Worker (asyncio-Loop)
   └── SQLite (WAL + FTS5)  ◄── lokaler Lese-Cache + App-eigene Daten
            │
            ▼
   edu-sharing REST-API  ◄── Source of Truth (Ideen, Bewertungen, Kommentare,
                              Anhänge, User, Rechte, Sammlungen)
```

Ein einziger FastAPI-Prozess serviert sowohl die JSON-API (`/api/v1/*`) als auch
das gebaute Angular-Bundle unter `/`. Keine getrennten Web-/App-Server, kein
CORS-Aufwand im Standardfall — eine Deploy-Einheit.

---

## Backend

### Stack

| Technik | Zweck |
|---|---|
| **Python ≥ 3.11** | Laufzeit |
| **FastAPI** (≥ 0.115) | REST-Framework, async, OpenAPI unter `/docs` |
| **uvicorn[standard]** | ASGI-Server (`--proxy-headers` hinter nginx) |
| **httpx** (async) | HTTP-Client für edu-sharing |
| **pydantic** / **pydantic-settings** | Request-/Response-Modelle + `.env`-Konfiguration |
| **slowapi** | Rate-Limiting |
| **python-multipart** | Datei-Uploads (Streaming) |
| **SQLite** (stdlib `sqlite3`) | lokaler Cache + App-Daten (WAL, FTS5) |
| **ruff** | Lint + Format (`E F I B UP C4 SIM`) |

Bewusst **keine** schwergewichtigen Abhängigkeiten: kein ORM (rohes SQL über
`sqlite3`), keine separate Such-Engine (FTS5 reicht), keine Message-Queue (ein
asyncio-Task genügt), kein Redis (In-Memory-Rate-Limit reicht für Single-Instance).

### Modul-Karte (`backend/app/`)

| Datei | Inhalt |
|---|---|
| `main.py` | FastAPI-App + Lifespan (Auto-Restore, Sync-Loop, Backup-Loop), mountet das Frontend-Bundle |
| `routes.py` | Read-/Query-Kern (Ideen-Liste/-Detail, Meta-Facetten, Users, Bootstrap) + Aggregation aller Domänen-Router |
| `routes_<domäne>.py` | ein Router pro Domäne, per `include_router` gemountet (Pfade unverändert): `submit`, `idea_edit` (PATCH/DELETE/refresh/backfill), `attachments` (content/preview/Anhänge), `feedback` (Rating/Kommentare), `participation` (contact/interest/follow/team), `ranking` (Top-Liste mit Verfalls-Score + Risers), `reports`, `settings`, `taxonomy` (Phasen/Events), `topics` (Admin-CRUD), `moderation` (hide/unhide/move/publish), `inbox` (Postfach + sync-diff), `mod_dashboard` (Meldungen/Statistik/Aktivität/Moderatoren), `me`, `admin` (Sync-Trigger/Backup), `captcha`, `ops` (health/ready/status) |
| `routes_common.py` | geteilte Route-Helfer ohne Decorator (Idea-Serialisierung, `_require_moderator`, Upload-Token, Settings-Zugriff, Aktivitäts-Log) — importiert nie ein Route-Modul (zyklenfrei) |
| `auth.py` | Auth-Prädikate (`verify_login`, `is_moderator`, `is_owner_or_mod`, `can_edit_idea`) + gedeckelter Mod-Status-Cache |
| `caches.py` | Eviction-Helfer für gedeckelte TTL-Caches |
| `db.py` | SQLite-Schema, `connect()` mit PRAGMAs, idempotente Migrationen |
| `sync.py` | edu-sharing-Voll-Sync, `refresh_idea` (Single-Node-Refresh), Verfalls-Score, Trend-Snapshots, Geisterzeilen-Cleanup |
| `edu_sharing.py` | Dünner REST-Client (`EduSharingClient`) |
| `backup.py` | Backup/Restore + Auto-Restore beim Erststart |
| `ratelimit.py` | slowapi-Limiter + Client-IP-Ermittlung hinter Proxy |
| `config.py` | `pydantic-settings` (liest `.env` / Umgebungsvariablen) |

### Lebenszyklus (Lifespan)

Beim Start in dieser Reihenfolge (`main.py`):

1. **Auto-Restore** — wenn keine DB existiert **und** die Opt-in-Markerdatei
   `AUTO_RESTORE_OK` im Backup-Verzeichnis liegt, wird das jüngste Backup
   eingespielt (Disaster-Recovery: Volume kopieren + Container neu starten).
2. **`init_db()`** — Schema anlegen + idempotente `ALTER TABLE`-Migrationen.
3. **`ensure_vote_seed()`** — vorhandene Alt-Bewertungen einmalig als Verfalls-Seed erfassen.
4. **Sync-Loop** + **Backup-Loop** als asyncio-Tasks starten.

### Datenhaltung — SQLite (WAL + FTS5)

`connect()` setzt: `journal_mode=WAL` (gleichzeitig Reader + Writer),
`synchronous=NORMAL`, `busy_timeout` (wartet auf Locks statt sofort „database is
locked"). SQLite reicht für diese App-Klasse mühelos (ein Repo, Tausende Ideen,
viele parallele Leser).

**17 Tabellen**, nach Zweck gruppiert:

- **Cache (Spiegel aus edu-sharing):** `topic`, `idea`, `idea_fts` (FTS5-Index)
- **App-eigene Daten (kennt edu-sharing nicht):** `idea_interaction`
  (Folgen / Mithacken / Team-Status), `idea_contact` (opt-in-Kontakt),
  `idea_report` (Meldungen), `taxonomy_event` + `taxonomy_phase` (Pflege von
  Veranstaltungen/Phasen inkl. Status, Featured-Slot, Voting-Modus),
  `user_profile_meta` (Bio/Rolle/Website), `app_setting` (z.B. globaler
  Bewertungs-Modus), `user_feed_seen` (Notification-Cursor)
- **Ranking / Verfall:** `vote_event` (Stimmen-Ledger), `idea_score_seed`
  (Alt-Bestands-Seed), `ranking_snapshot` (Trend-Verlauf)
- **Betrieb:** `activity_log` (Audit-Trail), `captcha_challenge`, `sync_log`

> Welche `idea`-Spalten aus edu-sharing gespiegelt werden und welche App-eigen
> sind (`hidden`, `color`, `sort_order`), steht im
> [Zusammenspiel-Doc](EDU-SHARING-ZUSAMMENSPIEL.md#was-wo-liegt).

Migrationen sind **idempotent**: `init_db()` führt `ALTER TABLE … ADD COLUMN` in
einem `try/except` aus, sodass alte DBs beim Deploy automatisch mitziehen.

### Sync-Worker (Periodischer Voll-Sync)

Ein asyncio-Task läuft einmal pro Nacht zur UTC-Stunde `SYNC_NIGHTLY_HOUR`
(Default 1) — bewusst NICHT beim App-Start (Ausnahme: leerer Cache = frisches
Volume → einmaliger Initial-Sync), zusätzlich manuell über `POST /admin/sync`;
serialisiert über einen `asyncio.Lock` (kein Doppellauf). Der Walk geht
Root-Sammlung → Themenbereiche → Herausforderungen → **Reference-Knoten** und
schreibt jede Idee per `_upsert_idea` (`INSERT … ON CONFLICT DO UPDATE`) in den
Cache; der FTS-Index wird im selben Zug aktualisiert.

- **Commit pro Herausforderung** statt einmal am Ende → gibt den Write-Lock in
  Fenstern frei, damit parallele Mod-Schreibvorgänge nicht in den Timeout laufen.
- **App-eigene Spalten überleben** den Sync: das `ON CONFLICT … SET` listet nur
  edu-sharing-Felder, lässt `hidden`/`color`/`sort_order` also unangetastet.
- **Geisterzeilen-Cleanup:** Inbox-Originale, die bereits als Reference in einer
  Sammlung hängen, werden aus dem Public-Cache entfernt.

### Refresh-on-Write

Jeder Schreibvorgang geht **zuerst nach edu-sharing**, danach holt
`refresh_idea(node_id)` genau diesen einen Knoten frisch und aktualisiert die
Cache-Zeile (~50–200 ms). So sieht die Nutzerin den neuen Stand sofort, ohne auf
den nächsten Voll-Sync zu warten. Inbox-Knoten werden dabei übersprungen (sie
sollen erst nach der Moderation öffentlich werden).

### Volltextsuche (FTS5)

`idea_fts` ist eine FTS5-Virtual-Table (`tokenize=unicode61 remove_diacritics`).
Suchanfragen liefern `snippet()`/`highlight()`-Treffer mit Sentinel-Markern, die
serverseitig **nach** dem HTML-Escapen in `<mark>` umgesetzt werden
(`_safe_highlight`) — XSS-sicher, da der Nutzertext escaped ist, bevor Markup
entsteht. Malformierte FTS-Queries fangen wir ab (leeres Ergebnis statt 500).

### Ranking & Verfalls-Score

- Die **angezeigten** Bewertungswerte (`rating_avg`/`count`/`sum`) kommen aus
  edu-sharing und werden gecacht.
- Das **Trend-Ranking** rechnet zusätzlich einen **zeit­gewichteten Verfalls-Score**
  aus dem App-eigenen `vote_event`-Ledger (+ `idea_score_seed` für Altbestände),
  berechnet **on-demand** zur Abfragezeit — nie in der `idea`-Tabelle gespeichert,
  daher vom Sync nicht überschreibbar.
- `ranking_snapshot` hält periodische Momentaufnahmen der Top-Listen für die
  „▲▼ Top-Steiger"-Anzeige (throttled).

### Auth & Rate-Limiting

- **Durchgereichte Auth:** Der `Authorization: Basic`-Header kommt pro Request vom
  Frontend und wird **unverändert** an edu-sharing weitergereicht. Das Backend
  speichert **nie** Nutzer-Credentials. edu-sharing prüft das Passwort bei jedem
  weitergereichten Call → solche Schreibvorgänge sind sicher.
- **App-DB-only-Writes** (die NICHT nach edu-sharing gehen) verifizieren die
  Identität explizit über `_verify_login` (ein `my_memberships`-Roundtrip), weil
  der Basic-Username allein fälschbar wäre. Details:
  [Zusammenspiel-Doc](EDU-SHARING-ZUSAMMENSPIEL.md#zwei-klassen-von-schreibvorgängen).
- **Mod-Rechte** ausschließlich über edu-sharing-Gruppenmitgliedschaft
  (`MODERATION_FALLBACK_GROUPS`, geprüft via `my_memberships`).
- **Rate-Limit-Key:** Hash des Auth-Headers bei eingeloggten Usern, sonst die
  Client-IP — so bremst man einzelne Accounts/IPs, ohne ganze Schul-NAT-/Embed-
  Netze auszusperren. Hinter nginx wird die echte Client-IP aus `X-Real-IP`
  bzw. dem letzten `X-Forwarded-For`-Eintrag gelesen (nicht der fälschbare erste).

### Captcha

Anonyme Submits brauchen ein **Mathe-Captcha** (kein Drittanbieter, DSGVO-neutral):
`GET /captcha` liefert `{token, question}`; Token ist single-use, ablaufend,
`secrets`-generiert. Eingeloggte User überspringen es.

### Backup & Restore

- Auto-Backup alle `BACKUP_INTERVAL_HOURS` (Default 24 h), Retention `BACKUP_KEEP`.
- Konsistenter Snapshot via `VACUUM INTO` (kein App-Stop).
- **Atomares** ZIP-Schreiben (`.zip.tmp` → `os.replace`), Pre-Restore-Safety-Backup,
  Magic-Bytes-Prüfung + Pfad-Traversal-Schutz beim Restore-Upload.
- Auto-Restore beim Erststart nur mit Opt-in-Marker (s. Lifespan).
- Off-Site-Spiegelung zu Google Drive via `rclone` (Setup: [`INSTALL-DOCKER.md` §8](INSTALL-DOCKER.md#8-off-site-backups-zu-google-drive)).

### Activity-Log

Jede Schreibaktion wird protokolliert (`activity_log`: Zeitstempel, Akteur,
Mod-Flag, Aktion, Ziel, Detail-JSON) — Audit-Trail + „Was ist neu"-Feed.
Auto-Pruning beim Sync-Tick.

### Konfiguration

`pydantic-settings` liest alle Werte aus Umgebungsvariablen / `.env`. Secrets
(edu-sharing-Service-Account) liegen nur dort, nie im Git. Vollständige Referenz:
[`INSTALL-DOCKER.md`](INSTALL-DOCKER.md), Vorlage `.env.example`.

---

## Frontend

### Stack

| Technik | Zweck |
|---|---|
| **Angular 19** (standalone) | UI-Framework, keine NgModules |
| **@angular/elements** | kapselt die App als native **Web Components** |
| **Signals** + `inject()` | reaktiver State, funktionale DI |
| **Control Flow** `@if`/`@for`/`@switch` | Template-Logik (kein `*ngIf`/`*ngFor`) |
| **RxJS** | HTTP-Streams (`HttpClient`) |
| **@angular/material** + **@angular/cdk** | einzelne UI-Bausteine |
| **TypeScript ~5.7**, **zone.js** | Sprache / Change-Detection |
| **angular-eslint** | Lint |

### Web-Components (`@angular/elements`)

`main.ts` registriert **zwei** Custom Elements und mountet automatisch ein
`<ideendb-app>`, falls die Host-Seite keines platziert hat:

| Tag | Inhalt |
|---|---|
| `<ideendb-app>` | die ganze App (alle Ansichten über das `view`-Attribut) |
| `<ideendb-tile-grid>` | nur die Kachel-Liste (für Drittseiten-Embeds) |

Dadurch ist dieselbe App sowohl Standalone-Seite als auch einbettbares Widget auf
beliebigen Fremdseiten. Einbettung + alle Attribute:
[`benutzerhandbuch/06-einbinden-webcomponent.md`](benutzerhandbuch/06-einbinden-webcomponent.md).

### Komponenten-Karte (`frontend/src/app/`)

| Pfad | Inhalt |
|---|---|
| `app-shell/app-shell.component.ts` | Shell: Routing über `view`-Signal, Topbar, Themen-Drilldown, Filter, Theme-Switch |
| `app-shell/idea-detail.component.ts` | Detailseite: Anhänge, Team-Sidebar, Bearbeiten |
| `app-shell/comment-thread.component.ts` · `vote-box.component.ts` · `report-problem-modal.component.ts` | Detailseite: Kommentar-Thread · Bewertungs-Karte (Sterne/Daumen) · Problem-melden-Dialog |
| `app-shell/moderation.component.ts` | Mod-Bereich: Shell (Pill-/Dropdown-Navigation, Zähler-Badges, globaler Bewertungsmodus) — die Tabs sind eigene Kinder ↓ |
| `app-shell/inbox-list.component.ts` · `sync-diff.component.ts` | Mod: Postfach-Triage (Bulk-Move, Lazy-Vorschau; eigene Topic-Maps) · Sync-Differenz (Karteileichen bereinigen/wieder einsortieren) |
| `app-shell/stats-dashboard.component.ts` · `reports-list.component.ts` · `activity-log.component.ts` | Mod: Statistik · Meldungen · Aktivitäts-Log (TSV-Export) |
| `app-shell/topic-editor.component.ts` · `taxonomy-editor.component.ts` | Mod: Themenbereiche · Veranstaltungen/Phasen (inkl. Event-Share-Dialog) |
| `app-shell/content-manager.component.ts` · `mods-list.component.ts` · `backup-management.component.ts` | Mod: Inhalte verwalten (verstecken/löschen/reparieren) · Moderatoren (read-only) · Backups |
| `app-shell/profile.component.ts` | „Mein Bereich" (Feed, eigene Ideen, Mithacken, Folgen, Profil) |
| `app-shell/public-profile.component.ts` | öffentliches Profil |
| `app-shell/ranking.component.ts` | Trend-Rangliste + Top-Steiger |
| `app-shell/submit-idea.component.ts` | Einreiche-Formular inkl. Mathe-Captcha |
| `app-shell/share-dialog.component.ts` | Teilen-Dialog (Link + QR + Embed-Snippet) |
| `app-shell/embed.component.ts` · `help.component.ts` · `legal.component.ts` | Einbinden-Doku · Hilfe · Impressum/Datenschutz |
| `tile-grid/` | Standalone-Kachelansicht `<ideendb-tile-grid>` |
| `api.service.ts` | `HttpClient`-Wrapper (alle API-Calls an einer Stelle) |
| `voting.service.ts` | Bewertungs-Modus (Sterne/Daumen, global + pro Event) |
| `theme.service.ts` | Theme-State (Signal, in `localStorage`) |
| `models.ts` | TypeScript-Typen (inkl. Profil-Rollen) |

### State & Services

State läuft über **Signals** in den Komponenten; geteilte Logik über `inject()`-bare
Services (`ApiService`, `VotingService`, `ThemeService`). Kein NgRx/Store —
für diese App-Größe unnötig. Aktualisierung per Tab-Wechsel/„Aktualisieren"-Button
statt WebSocket (Einreichen ist nicht echtzeitkritisch); der Notification-Badge
pollt im Minutentakt.

### Auth im Browser

Login baut den `Authorization: Basic`-Header und legt ihn in **`sessionStorage`**
ab (tab-scoped, beim Schließen weg — bewusst nicht `localStorage`). Der Header geht
**nur** an das eigene Backend, nie an Dritte, und wird nirgends geloggt oder in
URLs gesetzt.

### Theming

Drei Farbschemata (Default, HackathOERn-hell, Dark) über CSS-Variablen; die Wahl
landet in `localStorage` und gilt für alle Web-Components im selben DOM — auch für
eingebettete Komponenten ohne sichtbare Topbar.

### Build & Auslieferung

```bash
cd frontend && npm run build:embed
# = ng build --configuration=embed && node scripts/cache-bust.mjs
```

Die Component-SCSS wird in `main.js` eingebacken; `cache-bust.mjs` hängt einen
`?v=<timestamp>` an, damit Browser-Caches sicher invalidieren. Ergebnis liegt in
`frontend/dist/embed/browser/` und wird vom FastAPI-Backend unter `/` ausgeliefert.

**Entwicklung:** `npm start -- --port 4201` startet `ng serve`; `proxy.conf.json`
leitet `/api/*` an das Backend auf `:8000` weiter.

---

## Deploy-Topologie

Ein Docker-Container (FastAPI + eingebackenes Frontend), dahinter ein
Reverse-Proxy (nginx + TLS, `client_max_body_size`, `X-Forwarded-For`). Volume für
SQLite + Backups. Schritt-für-Schritt: [`INSTALL-DOCKER.md`](INSTALL-DOCKER.md),
Update-Kurzreferenz: [`DOCKER-UPDATE.md`](DOCKER-UPDATE.md).

## Querverweise

- [`EDU-SHARING-ZUSAMMENSPIEL.md`](EDU-SHARING-ZUSAMMENSPIEL.md) — was im Cache, was im Repo liegt; Schreib-Klassen; Sequenzen
- [`moderation/07-permissions-architektur.md`](moderation/07-permissions-architektur.md) — Rechte-Modell im Detail
- [`../README.md`](../README.md) — Kurzüberblick + Datenmodell
