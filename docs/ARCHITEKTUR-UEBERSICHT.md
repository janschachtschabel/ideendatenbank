# Architektur-Übersicht — HackathOERn Ideendatenbank

> Kompakte Übersicht für die **IT-Abnahme & -Prüfung**. Tiefe Details in:
> [ARCHITEKTUR.md](ARCHITEKTUR.md) (Techniken) ·
> [EDU-SHARING-ZUSAMMENSPIEL.md](EDU-SHARING-ZUSAMMENSPIEL.md) (Datenaufteilung) ·
> [INSTALL-DOCKER.md](INSTALL-DOCKER.md) (Betrieb) ·
> [moderation/07-permissions-architektur.md](moderation/07-permissions-architektur.md) (Rechte im Detail).

## 1. Was ist das?

Web-App zum **Einreichen, Sichten, Bewerten und Kommentieren** von Projekt-Ideen
rund um OER-Infrastruktur. Die Inhalte liegen in **edu-sharing** (WLO-Repository,
„Source of Truth"). Die App ist ein schlanker Layer davor mit eigenem Lese-Cache
und App-spezifischen Funktionen (Folgen, Mithacken, Ranking, Moderation, Postfach).

## 2. System auf einen Blick

```
   Browser
   └── <ideendb-app> / <ideendb-tile-grid>     Angular-19-Web-Components
            │   HTTP + Authorization: Basic (1:1 durchgereicht, nie gespeichert)
            ▼
   FastAPI-Backend  (EIN Prozess, EINE Deploy-Einheit)
   ├── REST-API  /api/v1/*           + Rate-Limiting (slowapi)
   ├── liefert das Angular-Bundle unter /
   ├── EduSharingClient (httpx async)
   ├── Sync-Worker   (asyncio, alle 15 min)
   ├── Backup-Worker (asyncio, alle 24 h)
   └── SQLite (WAL + FTS5)   ◄── lokaler Lese-Cache + App-eigene Daten
            │
            ▼
   edu-sharing REST-API  ◄── Source of Truth: Ideen, Bewertungen, Kommentare,
                              Anhänge, Nutzer, Rechte, Sammlungen
```

Ein FastAPI-Prozess serviert **API und Frontend gemeinsam** — kein separater
Web-Server, im Standardfall kein CORS, ein Docker-Image.

## 3. Technologie-Stack

| Schicht | Technik |
|---|---|
| **Backend** | Python ≥ 3.11 · FastAPI · uvicorn · httpx (async) · pydantic-settings · slowapi · SQLite (stdlib, WAL+FTS5) · ruff (Lint/Format) |
| **Frontend** | Angular 19 (standalone) · @angular/elements (Web Components) · Signals · RxJS · TypeScript 5.7 · angular-eslint |
| **Build** | `npm run build:embed` → Bundle wird vom Backend unter `/` ausgeliefert |
| **Deploy** | 1 Docker-Container hinter Reverse-Proxy (nginx + TLS) · Volume für SQLite + Backups |

Bewusst **keine** schweren Abhängigkeiten: kein ORM (rohes SQL), keine Such-Engine
(FTS5), keine Message-Queue (asyncio-Task), kein Redis (In-Memory-Rate-Limit für
Single-Instance).

## 4. Datenhaltung — Source of Truth vs. App-Cache

| Liegt in **edu-sharing** (führend) | Liegt in **SQLite** (App-eigen) |
|---|---|
| Ideen (`ccm:io`), Sammlungen (`ccm:map`), Anhänge | Lese-**Cache** von Ideen/Themen (`idea`, `topic`, FTS-Index) |
| Bewertungen, Kommentare, Dateien | `hidden`-Flag, Themen-Farbe/Reihenfolge (überleben den Sync) |
| Nutzer, Gruppen, **Berechtigungen** | Folgen/Mithacken/Team, opt-in-Kontakt, Meldungen |
| | Taxonomie (Veranstaltungen/Phasen), Ranking-Ledger, Activity-Log, Captcha, App-Settings |

→ Vollständige Feld-Aufteilung: [EDU-SHARING-ZUSAMMENSPIEL.md](EDU-SHARING-ZUSAMMENSPIEL.md).

## 5. Zentrale Abläufe

- **Voll-Sync (alle 15 min):** Walk Root-Sammlung → Themenbereiche → Herausforderungen
  → Referenz-Knoten; schreibt jede Idee in den Cache. App-eigene Spalten bleiben unangetastet.
- **Refresh-on-Write:** Jeder Schreibvorgang geht **zuerst nach edu-sharing**, danach
  wird genau dieser eine Knoten nachgeladen (~50–200 ms) → sofort sichtbar, ohne auf den Voll-Sync zu warten.
- **Request/Auth:** Der `Authorization: Basic`-Header kommt pro Request vom Browser
  und wird **unverändert** an edu-sharing weitergereicht; edu-sharing prüft das Passwort.

## 6. Sicherheits- & Rechtemodell  *(Kern der Abnahme)*

- **Keine gespeicherten Credentials.** Das Backend hält **nie** Nutzer-Passwörter;
  der Basic-Header wird nur pro Request durchgereicht. Im Browser liegt er in
  `sessionStorage` (tab-scoped), geht nur ans eigene Backend, wird nie geloggt/in URLs gesetzt.
- **Zwei Klassen von Schreibvorgängen:**
  1. *edu-sharing-Writes* (Idee, Rating, Kommentar, Upload) — sicher, da edu-sharing das Passwort prüft.
  2. *App-DB-only-Writes* (Folgen, Team, Kontakt) — verifizieren die Identität explizit über
     `_verify_login` (echter `my_memberships`-Roundtrip), weil der Basic-Username allein fälschbar wäre.
- **Moderations-Rechte** ausschließlich über **edu-sharing-Gruppenmitgliedschaft**
  (`moderation_fallback_groups`, Default `GROUP_ALFRESCO_ADMINISTRATORS`) — kein App-eigenes Rollen-System.
- **App-seitiges Owner-Gate:** Bearbeiten/Löschen prüft Owner-oder-Mod app-seitig (die
  edu-sharing-Gruppenvererbung würde sonst jedem Gruppenmitglied pauschal Schreibrechte geben).
- **Gast-Account (WLO-Upload):** trägt anonyme Beiträge. Credentials sind **Pflicht per Env**,
  **kein eingebauter Default** (verhindert versehentliche Läufe mit Test-Credentials gegen Prod);
  fehlen sie, schlagen die edu-sharing-Aufrufe fehl.
- **Captcha** (eigenes Mathe-Captcha, DSGVO-neutral) für anonyme Einreichungen; eingeloggte überspringen es.
- **Rate-Limiting** (slowapi) je Account/IP; hinter nginx echte Client-IP aus `X-Real-IP`/letztem `X-Forwarded-For`.
- **Upload-Grenzen:** Vorschaubild 10 MB · Anhang 50 MB · max. 20 Anhänge/Idee · Restore-ZIP 200 MB (zusätzlich nginx `client_max_body_size`).
- **Audit-Trail:** jede Schreibaktion in `activity_log` (Akteur, Mod-Flag, Aktion, Ziel).
- **DSGVO:** Kontaktdaten sind **opt-in** und nur für **eingeloggte/verifizierte Mods** sichtbar; keine Drittanbieter-Tracker; Impressum/Datenschutz integriert.

### Lebenszyklus einer Idee (inkl. Freigabe-/Rechtelogik)

```
1. Einreichen     → Idee landet im Gast-Postfach (Inbox). PRIVAT, wartet auf Moderation.
2. Moderation     → „Verschieben" in eine Herausforderung (Sammlung):
                     a) Referenz in der Sammlung anlegen
                     b) Original VERÖFFENTLICHEN (GROUP_EVERYONE/Consumer = öffentlich lesbar)
                        → Vorschau/Inhalt anonym sichtbar
3. Umsortieren    → neue Referenz + erneut veröffentlichen, alte Referenz löschen
4. Verstecken     → Original ENT-veröffentlichen (Lese-Recht entzogen) + App-Flag (reversibel)
5. Löschen        → Referenz UND Original entfernen (Mehrfach-Referenz-Schutz: Original nur,
                     wenn keine andere Sammlung es noch nutzt)
```

### Anlagen vs. Vorschaubild

- **Anlagen/Dokumente** = **Serienobjekte** (`ccm:io_childobject`) unter der Idee — erben deren
  Rechte; einheitliche Buttons/Berechtigungen. (Ausnahme: einzelne Bestandsideen mit Erst-Anlage im Primärknoten.)
- **Vorschaubild** = Thumbnail des **Primärobjekts** (kein Serienobjekt).
- **Anonyme Uploads** (Vorschaubild + Anlagen) laufen über den **Gast** — aber nur für
  **frisch eingereichte, noch nicht einsortierte** Ideen; einsortierte verlangen Login.

## 7. Betrieb & Deployment

- **1 Docker-Container** (FastAPI + eingebackenes Frontend) hinter Reverse-Proxy (nginx, TLS,
  `client_max_body_size`, `--proxy-headers`). **Volume** für SQLite + Backups.
- **Konfiguration** komplett über Env/`.env` (pydantic-settings); Secrets nie im Git. Vorlage: `.env.example`.
- **Backups:** automatisch alle 24 h (`VACUUM INTO`, atomar geschrieben, Retention 3), optionale
  Off-Site-Spiegelung zu Google Drive via `rclone`; Auto-Restore beim Erststart nur mit Opt-in-Marker.
- **CI/CD:** GitLab (`ruff check`, `ruff format`, `frontend lint`, Docker-Build/Push) +
  GitHub (Backend-Import + OpenAPI-Schema-Check, Frontend-Build). Lint-Warnungen blocken nicht, **Fehler schon**.

## 8. Externe Abhängigkeit: edu-sharing

Die App ist auf die edu-sharing-REST-API angewiesen. **Bekannte serverseitige Einschränkungen
der Instanz** (nicht in unserem Code, beim Repo-Betrieb zu beheben):

| Feature | Status |
|---|---|
| Rating lesen/abgeben | funktioniert (Abgeben über Read-Back-Muster wg. Schein-500) |
| Rating **löschen** | serverseitig defekt (Rating-Config nicht gesetzt) |
| **Feedback** (lesen/schreiben) | serverseitig defekt (Service-Bean nicht deployed) |
| Kommentare | funktionieren mit Login |

## 9. IT-Prüf-Checkliste

- [ ] **Secrets** nur in Env/Secret-Store, nicht im Git (`EDU_GUEST_USER/PASS`, optional `B_API_KEY`).
- [ ] **Gast-Credentials** per Env gesetzt (`EDU_GUEST_USER/PASS`) — kein Default; ohne sie keine edu-sharing-Anbindung.
- [ ] **Auth** wird nur durchgereicht, nirgends gespeichert/geloggt; Browser nutzt `sessionStorage`.
- [ ] **Mod-Rechte** ausschließlich über `MODERATION_FALLBACK_GROUPS` (edu-sharing-Gruppe).
- [ ] **Reverse-Proxy:** TLS aktiv, `X-Forwarded-For`/`X-Real-IP` korrekt, `client_max_body_size` ≥ Upload-Limits.
- [ ] **Rate-Limiting** aktiv; **Upload-Caps** gesetzt; **Captcha** bei anonymem Submit.
- [ ] **Backups** laufen, Retention plausibel, **Restore einmal getestet**; Off-Site optional eingerichtet.
- [ ] **CI** grün (Lint + Build) vor Deploy.
- [ ] **DSGVO:** Kontakt opt-in & nur für Mods, kein Drittanbieter-Tracking, Impressum/Datenschutz erreichbar.
- [ ] **Datenhoheit:** Inhalte liegen in edu-sharing; SQLite ist Cache + App-Daten und aus Backups wiederherstellbar.

## 10. Weiterführende Dokumente

- [ARCHITEKTUR.md](ARCHITEKTUR.md) — Techniken Backend & Frontend (Detailtiefe)
- [EDU-SHARING-ZUSAMMENSPIEL.md](EDU-SHARING-ZUSAMMENSPIEL.md) — was im Cache, was im Repo; Schreib-Klassen; Sequenzen
- [INSTALL-DOCKER.md](INSTALL-DOCKER.md) — Deployment, Env-Variablen, nginx, Backups
- [moderation/07-permissions-architektur.md](moderation/07-permissions-architektur.md) — Rechtemodell im Detail
- [../README.md](../README.md) — Kurzüberblick + Datenmodell
