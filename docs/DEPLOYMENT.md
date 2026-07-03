# Deployment — Staging & Produktion

> Umgebungs-spezifischer Deployment-Plan (URLs, edu-sharing-Anbindung, Container-Env).
> Die **generische** Server-Einrichtung (Docker, nginx + TLS, Backups, Härtung) steht in
> [INSTALL-DOCKER.md](INSTALL-DOCKER.md); Architektur/Abnahme in
> [ARCHITEKTUR-UEBERSICHT.md](ARCHITEKTUR-UEBERSICHT.md).

**Code-Basis:** <https://scm.edu-sharing.com/edu-sharing/projects/wlo/ideendatenbank> (GitLab)
**Setup-Ticket (Staging):** [HACKOER-256](https://edu-sharing.atlassian.net/browse/HACKOER-256)

---

## 1. Umgebungen im Überblick

| Umgebung | App-URL | edu-sharing-Repo | Status |
|---|---|---|---|
| **Staging** | <https://ideendatenbank.staging.openeduhub.net/> | `repository.staging.openeduhub.net` | **läuft** |
| **Prod (Test)** | <https://31.70.69.74.nip.io/> | `redaktion.openeduhub.net` (Test-Zugang via `31.70.69.74.nip.io`) | in Prüfung im Test-Container |
| **Prod (Ziel)** | <https://idee.hackathoern.de> *(gewünscht)* | `redaktion.openeduhub.net` | geplant |
| *Alt-Domain* | <https://ideenbank.hackathoern.de/> | Prod-Sammlungen | bestehend → soll abgelöst/umgeleitet werden |

**Eine Deploy-Einheit pro Umgebung:** ein Container (FastAPI + eingebackenes Frontend)
hinter Reverse-Proxy. Unterschiede zwischen den Umgebungen liegen **ausschließlich in der
Env** (Repo-URL, Node-IDs, Mod-Gruppe, eigene Domain) — gleicher Code, gleiches Image.

---

## 2. edu-sharing-Anbindung je Umgebung

| Schlüssel | **Staging** | **Prod** |
|---|---|---|
| `EDU_REPO_BASE_URL` | `https://repository.staging.openeduhub.net` | `https://redaktion.openeduhub.net` (Test-Zugang via `https://31.70.69.74.nip.io`) |
| `EDU_GUEST_INBOX_ID` | `26df1cf0-5f50-4adb-9f1c-f05f507adb72` | `21144164-30c0-4c01-ae16-264452197063` |
| `IDEENDB_ROOT_COLLECTION_ID` | `7b6e0189-3957-4296-ae01-89395702968d` | `4197d4d2-c700-400c-97d4-d2c700900c68` |
| `MODERATION_FALLBACK_GROUPS` | `GROUP_7ad6f113ad149b0b907330cd278fae4d_ORG_ADMINISTRATORS` | `GROUP_ALFRESCO_ADMINISTRATORS` ¹ |
| `EDU_GUEST_USER` / `EDU_GUEST_PASS` | WLO-Service-Account (separat & sicher) | WLO-Service-Account (separat & sicher) |

> **Herkunft der Prod-Werte:** Repo-URL + Node-IDs sind die im Code hinterlegten
> Defaults — die Werte, mit denen die App heute (Alt-Domain `ideenbank.hackathoern.de`)
> gegen `redaktion` läuft; der Test-Container erreicht dasselbe Prod-Repo über die
> IP-URL `31.70.69.74.nip.io`. *(Annahme: `31.70.69.74.nip.io` zeigt auf dasselbe
> Repo — falls es eine eigenständige Prod-Instanz ist, Node-IDs von dort übernehmen.)*
>
> ¹ `GROUP_ALFRESCO_ADMINISTRATORS` ist der **Code-Default** (Repo-Admins). Existiert
> auf Prod — wie auf Staging — eine **dedizierte HackathOERn-Org-Admin-Gruppe**, diese
> stattdessen setzen (engerer Kreis als alle Repo-Admins).

---

## 3. Container-Env (Muster)

Vorlage — pro Umgebung kopieren und die markierten Werte setzen. Secrets
(`EDU_GUEST_USER`/`PASS`) **getrennt & sicher** übergeben, nie ins Git/Image.
Identische Vorlage liegt auch unter [`muster-env.txt`](../muster-env.txt) im Repo-Root.

```dotenv
# ──────────────── edu-sharing ────────────────
# Repo-Host — steuert API UND die „im Repo öffnen"-/Registrierungs-Links.
EDU_REPO_BASE_URL=https://repository.staging.openeduhub.net
# Optional: API-Basis. Leer lassen → wird aus BASE_URL abgeleitet
# (<base>/edu-sharing/rest). Nur setzen, wenn die API woanders liegt.
# EDU_REPO_API=

# Service-Account von WLO-Redaktion (kein Personen-Login).
# Getrennt & sicher übertragen, NICHT in dieser Datei mitschicken.
EDU_GUEST_USER=<WLO-Service-Account>
EDU_GUEST_PASS=<WLO-Passwort>

# ─────────── HackathOERn-Inbox + Wurzel-Sammlung ───────────
# Node-IDs im UUID-Format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
EDU_GUEST_INBOX_ID=<inbox-node-id>
IDEENDB_ROOT_COLLECTION_ID=<root-collection-id>

# ─────────── App / CORS ───────────
# Eigene öffentliche Domain, KEIN Wildcard, KEIN abschließender Slash!
APP_CORS_ORIGINS=https://deine-domain.example.de
APP_HOST=0.0.0.0
APP_PORT=8000

# ──────────────── Daten / Sync ────────────────
SQLITE_PATH=/data/ideendb.sqlite
# Nächtlicher Voll-Sync (UTC-Stunde). NUR nachts + manuell (POST /admin/sync),
# nicht beim App-Start — die SQLite-Datei überlebt Restarts auf dem Volume.
SYNC_NIGHTLY_HOUR=1

# ──────────────── Backup ────────────────
BACKUP_ENABLED=true
BACKUP_DIR=/data/backups
BACKUP_INTERVAL_HOURS=24
BACKUP_KEEP=3
# Auto-Restore-Opt-in: nur wenn diese Markerdatei in BACKUP_DIR liegt
BACKUP_AUTO_RESTORE_MARKER=AUTO_RESTORE_OK

# ──────────────── Moderation ────────────────
# Mod-Rechte ausschließlich über Mitgliedschaft in dieser edu-sharing-Gruppe
# (Passwort wird beim Login gegen edu-sharing geprüft).
MODERATION_FALLBACK_GROUPS=<edu-sharing-Admin-Gruppe>
```

> **Hinweis zu `MODERATION_BOOTSTRAP_USERS`:** Diese Variable gibt es **nicht mehr**.
> Der frühere Username-Bootstrap wurde entfernt (er hätte dem ungeprüften Login-Namen
> vertraut → Impersonations-Vektor). Wird sie gesetzt, **ignoriert** das Backend sie.
> Initiale Mod-Rechte erhält man, indem der eigene edu-sharing-Account in die in
> `MODERATION_FALLBACK_GROUPS` genannte Gruppe aufgenommen wird.

### Umgebungs-Werte (einsetzen)

**Staging**
```dotenv
EDU_REPO_BASE_URL=https://repository.staging.openeduhub.net
EDU_GUEST_INBOX_ID=26df1cf0-5f50-4adb-9f1c-f05f507adb72
IDEENDB_ROOT_COLLECTION_ID=7b6e0189-3957-4296-ae01-89395702968d
APP_CORS_ORIGINS=https://ideendatenbank.staging.openeduhub.net
MODERATION_FALLBACK_GROUPS=GROUP_7ad6f113ad149b0b907330cd278fae4d_ORG_ADMINISTRATORS
```

**Prod (Test-Container, aktuell)**
```dotenv
EDU_REPO_BASE_URL=https://31.70.69.74.nip.io   # Prod-Repo über IP/nip.io im Test
EDU_GUEST_INBOX_ID=21144164-30c0-4c01-ae16-264452197063
IDEENDB_ROOT_COLLECTION_ID=4197d4d2-c700-400c-97d4-d2c700900c68
APP_CORS_ORIGINS=https://31.70.69.74.nip.io
MODERATION_FALLBACK_GROUPS=GROUP_ALFRESCO_ADMINISTRATORS
```

**Prod (Ziel `idee.hackathoern.de`)** — wie Test, aber:
```dotenv
EDU_REPO_BASE_URL=https://redaktion.openeduhub.net   # finale Repo-Domain statt IP/nip.io
APP_CORS_ORIGINS=https://idee.hackathoern.de
EDU_GUEST_INBOX_ID=21144164-30c0-4c01-ae16-264452197063
IDEENDB_ROOT_COLLECTION_ID=4197d4d2-c700-400c-97d4-d2c700900c68
MODERATION_FALLBACK_GROUPS=GROUP_ALFRESCO_ADMINISTRATORS
```

---

## 4. Deployment-Schritte (je Umgebung)

1. **Image beziehen** — aus der GitLab-CI (`build and push`) bzw. lokal `docker build .`
   (Dockerfile baut Frontend + Backend in ein Image; siehe [INSTALL-DOCKER.md](INSTALL-DOCKER.md)).
2. **`.env` setzen** (Abschnitt 3) + **Volume** für `/data` (SQLite + Backups) mounten.
3. **Container starten** (`APP_HOST=0.0.0.0`, Port 8000 intern).
4. **Reverse-Proxy** (nginx) davor: TLS-Zertifikat, `client_max_body_size` ≥ Upload-Limits
   (Anhang 50 MB, Restore-ZIP 200 MB), `--proxy-headers`/`X-Forwarded-For` durchreichen.
5. **DNS**: `idee.hackathoern.de` auf den Prod-Host zeigen lassen; TLS ausstellen.
6. **Smoke-Test** (Abschnitt 5).

> Update bestehender Umgebungen: neues Image ziehen + Container neu starten — das
> `/data`-Volume (DB + Backups) bleibt erhalten. Kurzreferenz: [DOCKER-UPDATE.md](DOCKER-UPDATE.md).

### Alt-Domain `ideenbank.hackathoern.de`

Verbindet aktuell zu den Prod-Sammlungen. Nach Prod-Go-Live auf `idee.hackathoern.de`
entweder **301-Redirect** der Alt-Domain auf die neue setzen oder als zweite
`APP_CORS_ORIGINS` zulassen (kommasepariert), bis die Umstellung kommuniziert ist.

---

## 5. Smoke-Test / Abnahme je Umgebung

- [ ] `GET /api/v1/health` → `200`, `topics`/`ideas` plausibel, letzter Sync ohne Fehler.
- [ ] Startseite lädt (Frontend-Bundle unter `/`), Themenbereiche sichtbar.
- [ ] Login mit edu-sharing-Account; Mod-Account sieht den Moderationsbereich.
- [ ] Idee einreichen (anonym mit Captcha **und** eingeloggt) — inkl. Vorschaubild + Anhang.
- [ ] Moderation: Idee in eine Herausforderung verschieben → Vorschau/Render wird **öffentlich**
      sichtbar (Original veröffentlicht). Verstecken/Einblenden + „Vorschau reparieren" prüfen.
- [ ] Bewerten/Kommentieren mit Login.
- [ ] Reverse-Proxy: TLS gültig, große Uploads gehen durch, echte Client-IP kommt an.
- [ ] Backup läuft (`/data/backups`), Restore einmal getestet.

---

## 6. Bekannte edu-sharing-Server-Themen (nicht App-Code)

Beim Repo-Betrieb zu beachten (Stand der Staging-Prüfung, betrifft Prod analog):

| Feature | Status |
|---|---|
| Rating lesen / abgeben | funktioniert (Abgeben über Read-Back wegen Schein-500) |
| Rating **löschen** | serverseitig defekt (Rating-Config der Instanz nicht gesetzt) |
| **Feedback** | serverseitig defekt (Service-Bean nicht deployed) |
| Kommentare | funktionieren mit Login |

→ Diese liegen in der edu-sharing-Instanz, nicht im App-Code; bei Bedarf beim
Repo-Betrieb/Setup-Ticket adressieren.

---

## 7. Verweise

- [INSTALL-DOCKER.md](INSTALL-DOCKER.md) — vollständige Server-Einrichtung (Docker, nginx, TLS, Backup, rclone)
- [DOCKER-UPDATE.md](DOCKER-UPDATE.md) — Image-Update-Kurzreferenz
- [ARCHITEKTUR-UEBERSICHT.md](ARCHITEKTUR-UEBERSICHT.md) — Architektur & IT-Abnahme inkl. Rechtemodell
- [EDU-SHARING-ZUSAMMENSPIEL.md](EDU-SHARING-ZUSAMMENSPIEL.md) — Cache vs. Repo, Freigabe/Sichtbarkeit
- [`muster-env.txt`](../muster-env.txt) — Env-Vorlage im Repo-Root
