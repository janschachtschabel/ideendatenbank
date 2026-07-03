# Changelog

## 2026-07-03 — npm audit fix + Split-Entscheidungen idea-detail/routes.py

- **`npm audit fix` (ohne `--force`):** Dev-Tooling-Advisories **14 → 10**
  (0 kritisch, 2 high, 4 moderate, 4 low); **Runtime-Audit weiterhin 0/0/0/0**.
  Der Rest hängt an `@angular-devkit/build-webpack → webpack-dev-server` und
  wäre nur per `--force` (Breaking-Downgrade der Build-Kette) zu schließen —
  bewusst nicht: betrifft ausschließlich den lokalen Dev-Server (`ng serve`),
  nicht das ausgelieferte Bundle. Gates danach: Lint 0 Errors (105-Baseline),
  build:embed EXIT 0, 16/16 FE-Tests.
- **Entscheidung: `idea-detail.component.ts` (1882) wird NICHT weiter geteilt.**
  Bereits extrahiert: report-modal, comment-thread, vote-box. Vom Rest sind
  ~1150 Zeilen Inline-Template/-Styles, die Klasse hat ~720. Die verbliebenen
  Kandidaten schneiden entweder durch dokumentiert geteilten Zustand
  (Anhänge-UI ↔ Edit-Modal: Upload-Trio inkl. State, phases/events,
  editOnly-Lebenszyklus → Split hieße Prop-Drilling/Duplikation) oder bringen
  marginale Ersparnis bei echtem Risiko in frisch stabilisiertem, komponentenlos
  getestetem Code (Team-Panel ~150–250 Z.). Trigger für ein Re-Assess: sobald
  die Detailseite ein NEUES Feature bekommt, wird DAS als eigenes Kind gebaut
  (und dabei ggf. das Team-Panel mitgezogen).
- **Entscheidung: `routes.py` (775) wird NICHT weiter geteilt.** Nach dem
  18-Router-Split ist es der kohärente **Public-Read-Kern**: 7 anonyme
  GET-Endpoints (topics, meta, ideas-Liste inkl. FTS/Suggestions, get_idea,
  bootstrap, users/{name}) — eine Verantwortlichkeit, eine Änderungsursache
  (öffentliche Lese-Shapes). Größter Block ist `get_idea` (~340 Z.) = die
  frisch gebaute, 13-fach getestete Voll-Cache-Assembly — ein Umzug/Zerschnitt
  wäre Verschieben ohne Reduktion. Trigger für ein Re-Assess: wächst der Kern
  über ~1000 Zeilen oder kommt eine zweite Detail-Ansicht hinzu, wird
  `get_idea` + Cache-Helfer als `routes_idea_detail.py` ausgezogen.

## 2026-07-03 — Abschluss-Abgleich mit dem Programmierer-Review (verifiziert)

Jeder Punkt des ursprünglichen Reviews („vor der Zerlegung") wurde gegen den
HEUTIGEN Code geprüft (Greps/Zeilenzahlen/Audits/Tests frisch ausgeführt, nicht
aus Doku übernommen). Legende: ✅ erledigt · ⚠️ gemildert/teilweise (dokumentiert)
· ⏸️ bewusst geparkt · ℹ️ bewusste Entscheidung.

**Frontend**
- ✅ **Externe URLs/Calls (DSGVO):** 0 Treffer fonts.googleapis/gstatic/qrserver
  (inkl. embed-demo) — Fonts via @fontsource, QR lokal (qrcode-generator).
- ✅ **favicon:** Marken-Icon (8,7 kB) statt Angular-Default (15 086 B).
- ✅ **README in public/assets:** entfernt.
- ✅ **Angular EOL:** 19 → **21.2**.
- ✅ **npm-Vulns (Runtime):** `npm audit --omit=dev` = **0/0/0/0** (vorher
  1 kritisch + 21 high). ⚠️ 14 neue *Dev-Tooling*-Advisories seit 03.07 (nicht
  im Bundle); CIs gaten via pip-audit/npm audit.
- ✅ **Kein HTTP-Interceptor:** `authInterceptor` via `withInterceptors` — Header
  strukturell nur an die eigene API (per Spec gepinnt).
- ✅ **Unkodierte Pfad-Parameter:** `encodeURIComponent` durchgängig.
- ✅ **Null Tests:** heute **155 Backend-Testfunktionen in 26 Dateien** (mit
  Parametrisierung 176 Fälle; pytest EXIT 0) + **16 Frontend-Tests**, beide in
  **beiden CIs** (GitHub + GitLab); fanden reale Bugs (u.a. Backup-Handle-Leak).
- ✅ **God-Komponenten:** moderation **3763 → 325** (9 Tab-Kinder), idea-detail
  **2544 → 1882** (3 Kinder extrahiert). ℹ️ app-shell (1525) + ranking (930)
  bewusst kohäsiv belassen (Zustands-Netz bzw. eine Feature-Seite — begründet
  im Eintrag 02.–03.07.).
- ⚠️ **Inline-Template/-Styles (kein HTML/CSS-Split):** statt mechanischer
  Extraktion wurde in Sub-Components geschnitten + Dead-CSS-Kehraus
  (scss 1294 → 837, −36 tote Klassen); Inline bleibt Stilmittel der kleinen Einheiten.
- ✅ **Doppelte Requests (/events, /meta):** In-Flight-Coalescing im ApiService
  + N+1-Topic-Zählungen → 1× /meta; live verifiziert (keine Dubletten, alle
  27 User-Routen ≤ 106 ms, Parallel-Bursts ohne Serialisierung).
- ℹ️ **Kein Angular-Router:** Signal-Navigation ist die bewusste Embed-Entscheidung
  (Router würde Host-URLs kapern). ⚠️ setTimeout-Hacks 8 → 4: Deep-Links setzen
  den View jetzt synchron (Home-Flash + verschwendeter Request behoben).
- ⚠️ **Credentials im sessionStorage (Basic):** bleibt bis OAuth (admin-blockiert,
  Spike dokumentiert); strukturell begrenzt (Interceptor-Origin-Garantie,
  fail-closed Owner-Gating). Neu: **Login-Username erscheint nirgends mehr
  öffentlich** (Klarname/App-Profilname statt Login — Detail, Rangliste, Steiger).
- ⚠️ **Hartcodierte Farben:** 643 → ~455 Roh-Vorkommen (Dead-CSS/Fossilien
  entfernt); Rest ⏸️ opportunistisch bei Berührung.
- ✅ **Accessibility (WCAG-Basics):** alle **90 a11y-Lint-Warnungen behoben**
  (Lint 195 → 105). Formular-Labels via `for`/`id` bzw. `role="group"` +
  `aria-labelledby` assoziiert (submit-idea, idea-detail, share-dialog,
  login-dialog); echte klickbare Inhalte (Kacheln, Ranglisten-Zeilen,
  Bewertungs-Sterne) tastaturbedienbar gemacht (`role="button"`/`tabindex`/
  `keyup.enter`); Klick-Backdrops + stopPropagation-Wrapper + redundante
  Maus-Klickflächen mit **begründeten scoped `eslint-disable`** versehen
  (ein fokussierbarer Fullscreen-Backdrop wäre selbst ein Anti-Pattern;
  Tastatur schließt über Escape/×/Toggle). Verifiziert: build + 16 FE-Tests
  grün, 0 Errors.
- ✅ **`any`-Typisierung (105 → 4):** in drei Wellen abgebaut, jede vom
  Compiler verifiziert. (1) Sicher lösbare mit existierendem Typ:
  comment-thread ×11 → `Comment`, `Topic.sort_order` ergänzt, Owner-Helfer
  → `Idea`, `friendlyMoveError` → `HttpErrorResponse`, Casts entschärft.
  (2) **68 `http.<verb><any>`-Generics in api.service skriptbasiert durch
  die ohnehin deklarierten Signatur-Rückgabetypen ersetzt** — kein Typ
  erfunden, nur die vorhandene Deklaration ins Generic kopiert (Gotcha
  dabei gelernt: die blob-Überladung nimmt KEIN Typargument). (3) Benannte
  Contract-Typen in models.ts (`ActivityEvent`, `BackupInfo`,
  `RestoreResult`, `PublicUserProfile`, `AdminStats`, `RankingRiser`) —
  konsolidieren die konstruktiv-beliebigen Felder (`detail`, `metadata`)
  auf je EIN dokumentiertes `any`; `rateIdea`/`backfill`-Shapes gegen den
  Backend-Code verifiziert nachgetragen. **Das Typisieren deckte einen
  echten Contract-Fehler auf:** `PublicUserProfile.profile`
  (display_name/bio/website/role) fehlte in der api-Signatur komplett —
  unsichtbar, solange der Konsument ein `any`-Signal war. Die 4
  verbleibenden Warnungen sind der edu-sharing-Preview-Passthrough
  (`inboxItemPreview` + Cache + `attIcon`) — dort ist die Laufzeitform
  konstruktiv beliebig; erfundene Interfaces würden lügen.
- ✅ **Material entfernt:** `@angular/material` + `@angular/cdk` +
  `@angular/animations` deinstalliert. Beweiskette: einziger Verweis war
  `mat.theme()` in styles.scss, dessen `--mat-sys-*`-Tokens nirgends
  konsumiert wurden (App stylt komplett über `--wlo-*`; Typografie stand
  sogar auf Roboto statt Inter); keine `<mat-*>`/CDK-Importe; keine
  `[@trigger]`-Animationen → auch `BrowserAnimationsModule` raus
  (dokumentiert in main.ts). Globales styles.css jetzt 3,6 kB.
- ℹ️ **Dev-Tooling-Advisories (10) — abschließend geklärt:** die
  transitiven Leaves (http-proxy-middleware 3.0.5/2.0.10, sockjs 0.3.24)
  sind bereits die NEUESTEN existierenden Releases — es gibt kein
  gepatchtes Upstream; npms „Fix" wäre ein Major-DOWNGRADE auf
  build-angular@19. Zudem nutzt `ng serve` beim application-Builder Vite
  (webpack-dev-server-Kette ungenutzt), Runtime-Audit 0/0/0/0.
  Re-Check-Trigger: nächstes `ng update`.
- ℹ️ **i18n:** bleibt deutsch (rein deutsches Produkt).

**Backend**
- ✅ **routes.py-Monolith (~5.500 → 6167 gewachsen):** vollständig zerlegt in
  **775-Zeilen-Read-Kern + 18 Domänen-Router** + `routes_common.py`; Beweis:
  87 = 87 Routen (Methode+Pfad) + AST-Symbolvergleich.
- ✅ **Kein Auth-Modul:** `app/auth.py` (217 Z.) + ✅ **Mod-Status-Cache** (60 s TTL)
  — kein Live-ES-Call mehr pro geschütztem Request; fail-closed gehärtet.
- ⚠️ **bool vs. throw / kein Depends():** bewusst dokumentierte Konvention
  (Header wird an edu-sharing durchgereicht; eine Quelle der Wahrheit = auth.py),
  s. docs/KNOWN-LIMITATIONS.md.
- ⏸️ **sync.py (912 Z.):** Split offen; intern aber restrukturiert
  (fetch-then-write: kein DB-Lock über Netz-Awaits, `asyncio.to_thread` für
  SQLite in async-Routen — AST-Blocking-Audit: 0 Funde).
- ℹ️ **Ratelimit/Clusterfähigkeit:** bewusster Single-Instance-Betrieb (SQLite,
  In-Memory-Limits), dokumentiert.

**Perspektivisch (aus dem Review)**
- ⏸️ **OAuth statt Basic:** Spike fertig, extern blockiert (eduApp-Secret fehlt).
- ⏸️ **Generierter API-Client:** Backlog — würde dokumentierte edu-sharing-
  Workarounds (Rating-500, Publish-ACL, Comment-Escape) reaktivieren.
- ✅ **Sync-Skalierung/Repo-Last:** strukturell entschärft — Voll-Sync nur noch
  **nächtlich** (+ Refresh-on-Write für Aktualität), schlanker propertyFilter,
  Anhang-Scan 1/4, und die Detailseite läuft im Warmbetrieb mit **0 Live-Calls**
  (Voll-Cache Rating/Kommentare/Anhänge mit Count-/TTL-Invalidierung).
  „Keine doppelte Datenhaltung": SQLite bleibt bewusster Cache (FTS,
  Decay-Ranking, Resilienz), dokumentiert.
- ℹ️ **Kommentar-Sprache:** deutsch, opportunistisch.

**Verifikation heute:** pytest grün (EXIT 0, 155 Funktionen/176 Fälle) ·
ng lint 0 Errors ·
build:embed EXIT 0 · Live-Sweep aller 27 anonymen User-Routen ≤ 106 ms ·
Parallel-Bursts (12/20 Requests, 10× dieselbe Detailseite) ohne Blocking ·
Runtime-npm-audit 0 Vulnerabilities.

## 2026-07-02 – 2026-07-03 — Modularisierung + Härtungswelle (voll verifiziert)

Zweitägiger Audit-→-Fix-Zyklus (Voll-Audit, Umsetzung via better-coding-workflow,
Re-Audit). Jede Scheibe einzeln verifiziert: ruff clean, am Ende **132 pytest grün**
(vorher 117), Frontend-Build + Lint = Baseline, Routen-Vollständigkeit bewiesen.

**Architektur**
- `routes.py`-Monolith (6167 Zeilen) vollständig zerlegt → **849 Zeilen Read-Kern
  + 18 Domänen-Router** (`routes_<domäne>.py`) + `routes_common.py`. Beweis:
  87 Routen vorher = 87 nachher (exakte Methode+Pfad-Mengengleichheit) UND
  AST-Vergleich gegen das Pre-Split-Backup: 158 Symbole, 157 wortgleich,
  1 bewusst entfernt (`_VALID_VOTING_MODES`, toter Code).
- `routes_moderation.py` (1300) weiter geteilt → Kern (Sichtbarkeit/Einsortierung,
  453) + `routes_inbox.py` (Postfach + Sync-Diff, 524) + `routes_mod_dashboard.py`
  (Meldungen/Statistik/Aktivität/Moderatoren, 371).
- Frontend-Zerlegung der God-Komponenten (verhaltensgleiche Scheiben, jede
  einzeln per Build + Lint = Baseline verifiziert): `moderation.component.ts`
  **3763 → 372 Zeilen** = reine Shell (Navigation, Zähler-Badges, globaler
  Bewertungsmodus) — **alle neun Tabs sind eigene Kinder**: `backup-management`,
  `reports-list`, `stats-dashboard`, `topic-editor`, `taxonomy-editor`
  (Veranstaltungen/Phasen), `mods-list`, `inbox-list` (Postfach-Triage inkl.
  eigener Topic-Maps; der Sync-Diff-Ast ist nochmals eigenständig:
  `sync-diff` mit `[challengeGroups]`/`[refresh]`-Inputs), `content-manager`
  (Inhalte verwalten), `activity-log`. Nav-Zähler laufen einheitlich über
  `(countChanged)`.
  Beim Umzug entfielen beweisbar tote Reste: `challenges`-Signal (nur
  geschrieben), Share-Dialog-Style-Duplikate (Emulated Encapsulation),
  `.stat-ico.lg`. `idea-detail.component.ts` **2544 → 1979**
  (`report-problem-modal`, `comment-thread` und `vote-box` extrahiert;
  Kinder bekommen die Idee/Kommentare als Input, Mutationen melden
  `(changed)`/`(ideaChanged)` zurück — das Idea-Signal bleibt Source-of-
  Truth im Parent). `my_rating` im Idea-Modell typisiert (kam schon immer
  vom Backend, wurde via `any` gelesen). Die tote `ideaSelected`-Verkabelung
  moderation↔app-shell (nie emittiert) entfernt. Geteilte Logik in
  `format-utils.ts` (+ `initialsOf`) + `action-format.ts` (eine Quelle
  statt Kopien). **Bewusste Entscheidung:** das Edit-Modal bleibt in
  idea-detail — es teilt drei Subsysteme mit der Hauptansicht
  (Upload-Trio inkl. State, phases/events/allowedPhases, editOnly-
  Lebenszyklus); jede Split-Variante hieße Duplikation, Prop-Drilling
  oder einen Zweck-Service (spekulative Abstraktion) bei ~350 von
  1979 Zeilen Ersparnis. Damit ist die Monolith-Zerlegung abgeschlossen.
- Dead-CSS-Kehraus in `app-shell.component.scss`: 36 Klassen (416 Zeilen,
  9 Blöcke) waren beweisbar wirkungslos — Fossilien ausgelagerter Features
  (Share-Dialog, Ranglisten-/Event-Grid, alte Themen-Karten-Varianten).
  Nachweis: view-scoped Stylesheet (0× `::ng-deep`/`:host-context`, nur
  `styleUrls`) + Klassen-Token nirgends im Component-TS. Kompiliert
  **29,2 → 20,4 kB**; Analyzer danach: 92/92 Klassen referenziert.
- Die 3 NG8102-Warnungen (nullish coalescing) aufgelöst: `countFor(id)`-
  Helfer besitzt die Missing-Key-Semantik der async befüllten Zähl-Map —
  Runtime-Schutz bleibt, Templates sind diagnostik-sauber.
- Ranglisten-Fossil entfernt: der „große Rang-Verlaufs-Chart"
  (`chartSeries`/`chartGuides`/`chartViewBox` + `chartW/H`/`PALETTE` +
  Styles `.seg`/`.legend`/`.dot`, 88 Zeilen) hatte null Template-Referenzen
  (inline-Template, kein ViewChild) — ersetzt durch Sparklines + Top-3-
  Balken. `ranking.component.ts` 1059 → 971. **Bewusste Entscheidung:**
  keine weitere Zerlegung — eine kohäsive Feature-Seite, deren Unter-Widgets
  (Balken/Steiger/Liste/Transparenz-Box) denselben Load + dieselbe
  Score-Vokabular-Gruppe teilen; ein Split verschöbe nur Kopplung.
- **Bewusste Entscheidung app-shell (1608 Z.):** kein View-Split. Die vier
  fetten Views (home/browser/topics/events) bilden ein Zustands-Netz —
  Event-Schwimmbahnen speisen auch die Startseite (`homeBrowseEvents`),
  Datums-/Label-Helfer laufen quer durch Karte/Drill/Featured-Banner,
  `eventDrill` wird von URL-Parsing, `go()` und Home-Handlern geschrieben,
  die Event-Kachel ist eine geteilte `ng-template`. Ein Schnitt entlang der
  Views verschöbe die Kopplung in Input/Output-Geflecht; der saubere Weg
  wäre ein Redesign (EventCatalog-Service + View-Komponenten) — erst
  angehen, wenn die Event-Features konkret weiterwachsen.
- `anyComponentStyle`-Budget 16 → 22 kB (Warning; Error bleibt 32 kB): die
  zwei verbliebenen Überschreitungen (app-shell 20,4 kB, idea-detail
  16,4 kB) sind nach dem Dead-CSS-Kehraus belegt lebendes CSS — die
  Dauer-Warnungen waren Rauschen; ab jetzt warnt nur echtes Neuwachstum.

**Sync & Performance**
- Voll-Sync läuft **nur noch nächtlich** (`SYNC_NIGHTLY_HOUR`, Default 1 UTC)
  + manuell + einmalig bei leerem Cache; `SYNC_INTERVAL_SECONDS` deprecated.
- Event-Loop-Blockaden strukturell eliminiert: alle SQLite-Zugriffe in
  async-Routen laufen via `asyncio.to_thread`; `_upsert_idea/_upsert_topic`
  sind bewusst synchron (Netz-await unter DB-Lock per Sprache unmöglich).
  AST-Blocking-Audit: 0 Funde. Thread-Pools explizit dimensioniert
  (`THREADPOOL_*`, asyncio-Executor + anyio-Limiter).
- Detailseite: die zwei konditionalen Live-Reads (Kommentare, Child-Anhänge)
  starten beim Doppel-Miss parallel statt seriell.

**Sicherheit & Tests**
- Owner-Gating fail-closed: `is_owner_or_mod`/`can_edit_idea` akzeptieren den
  (nur dekodierten) Basic-Username erst bei zugesicherter Passwort-Prüfung
  (`verified=True`) — vergessenes Flag sperrt aus statt Impersonation zuzulassen.
- Security-Header (`nosniff`, `Referrer-Policy`) auf allen Antworten; bewusst
  ohne Frame-Verbot (Embed-Web-Component).
- **pytest läuft jetzt in beiden CIs** (GitHub + GitLab); +15 Tests
  (Auth-fail-closed, Settings-Gating, Delete-Gating, Header, Thread-Pools).
- **Re-Audit-Nachtrag (2026-07-03): +44 Tests (132 → 176)** für die bis dahin
  ungetesteten kritischen Gruppen — Backup/Restore-Vollzyklus (create → list
  → download → delete, Restore-Roundtrip inkl. Pre-Restore-Sicherung,
  kaputte/falsche ZIPs, Größen-Cap, Path-Traversal), Taxonomie-CRUD
  (inkl. Tag-Purge an Ideen + Teil-Fehler-Pfad + Draft-Leak-Schutz),
  Topics-CRUD (inkl. 409-Preflight), bulk_move (inkl. Sammelantwort bei
  Teil-Fehlern) — durchweg mit Body- und Seiteneffekt-Assertions. Die
  MOD_ONLY-Auth-Denial-Parametrisierung deckt jetzt auch Backup/Sync/
  Taxonomie/Topics ab.
- **Echter Bug durch die neuen Tests gefunden + gefixt:** `backup.py` nutzte
  `with sqlite3.connect(...)` — dessen Context-Manager committet nur,
  schließt aber NICHT. Der geleakte Handle machte den Restore auf Windows
  kaputt („database disk image is malformed", Datei gesperrt) und war auf
  Linux ein Connection-Leak pro Backup-Lauf. Jetzt explizites close().
- Test-Hermetik: `backup_dir` wird pro Test isoliert — vorher lasen Tests
  (z.B. /status-Diagnostics) echte ZIPs aus `./data/backups` der
  Entwickler-Maschine.
- `/status` gehärtet (Audit-Befund): PRAGMA-Werte/Dateigrößen/Index-Namen
  (`diagnostics`) nur noch für Mods; öffentlich bleiben die groben Zähler +
  letzter Sync (reicht für Uptime-Pings). Neu darin: `last_backup` als
  Minimal-Check „läuft die Auto-Sicherung?" ohne externen Dienst.
- **`ng test` läuft jetzt in beiden CIs** (GitHub headless-Chrome,
  GitLab Chromium + NoSandbox-Launcher): die 16 Frontend-Specs — u.a. die
  Interceptor-Garantie, dass Credentials NIE an Fremd-Origins gehen —
  existierten, liefen aber in keiner Pipeline. Lokal verifiziert:
  16/16 SUCCESS.
- `backup.py`: Metadata-Tabellennamen als dokumentierte Whitelist-Konstante
  (`_METADATA_TABLES`) statt Inline-Tupel am f-String (Audit-Refactoring-
  Falle entschärft).
- Dependency-Gates: `pip-audit` + `npm audit` in beiden CIs; Builds jetzt
  Lockfile-bindend (`npm ci` statt `npm install --no-save` — das frühere
  Windows-Lockfile-Problem reproduziert nicht mehr, im Linux-Container
  verifiziert). Ist-Stand beider Audits: 0 bekannte Vulnerabilities.
- a11y: ESC schließt Dialoge, `role="dialog"`/`aria-modal` im Login-Dialog,
  globales `prefers-reduced-motion`.

## 2026-06-23 – 2026-06-24 — Sanierung nach Programmierer-Review

Antwort auf das Code-Review (DSGVO, Framework-EOL, fehlende Tests, Auth,
Modularisierung, Sync-Last). Unten zuerst die durchgeführten Änderungen, dann der
**Status jedes Kritikpunkts**. (Nachtrag 2026-06-24: Objekt-Autorisierung für
anonyme Uploads via Upload-Token — der einzige MITTEL-Befund des Security-Reviews
ist damit ebenfalls geschlossen.)

Legende: ✅ erledigt · ⚠️ teilweise / gemildert (dokumentiert) · ⏸️ bewusst
geparkt (mit Begründung dokumentiert) · ℹ️ bewusste Entscheidung

---

### Durchgeführte Änderungen

**DSGVO & Sicherheit (Sofort-Hotfix)**
- Google Fonts selbst gehostet (`@fontsource`) — **0 externe Font-Calls** mehr
  (`index.html` + `public/embed-demo.html`); verifiziert.
- QR-Codes lokal erzeugt (`qrcode-generator`) statt `api.qrserver.com`.
- Generisches Angular-favicon durch Marken-Icon ersetzt.
- `public/assets/README.md` nach `docs/` entfernt.
- `npm audit fix` + Backend-Deps gepinnt (`pip-audit` sauber) → `docs/SICHERHEIT-ABHAENGIGKEITEN.md`.

**Framework**
- Angular **19 → 21** (EOL behoben), npm-Core-XSS-Vulns geschlossen.

**Tests (vorher: 0)**
- Backend: pytest-Harness (FakeES, kein Netz) + **77 Tests** (11 Dateien).
- Frontend: AuthService/Interceptor-Spec, **7 Tests** (inkl. „Header nie an Fremd-URL").
- CI: `pytest` + `ng test` verdrahtet.

**Auth-Härtung**
- Backend `app/auth.py` (Auth-Prädikate aus `routes.py` extrahiert) + **Mod-Status-Cache**
  (60 s TTL, SHA-256-Key, keine Fehler-Cachung).
- Frontend `AuthService` + `authInterceptor` (Auth-Header **nur** an eigene API),
  `encodeURIComponent` auf Pfad-Parameter, 58× manuelles `authHeaders()` entfernt.
- OAuth-Spike → `docs/AUTH-OAUTH-SPIKE.md`; Grenzen → `docs/KNOWN-LIMITATIONS.md`.
- **Objekt-Autorisierung für anonyme Uploads**: Vorschaubild/Anhang nur noch mit
  kurzlebigem Upload-Token der eigenen frischen Einreichung (DB-Tabelle
  `upload_token`, beim anonymen Submit ausgegeben) — schließt den einzigen
  MITTEL-Befund des Security-Reviews (vorher: jede unkatalogisierte Inbox-GUID
  bebilderbar/anhängbar).

**Stabilität & Bugfixes**
- `/health` trivial + `/ready` + `/status` (k8s-Liveness-Fix), WAL einmalig in `init_db`.
- Karteileichen-Bereinigung (Sync-Diff-Status + Moderations-Aktion, bessere Hilfetexte).
- **Bugfix `provideZoneChangeDetection()`**: Angular-21/`createApplication`-Regression —
  asynchrone HTTP-Antworten lösten keine View-Aktualisierung aus (Kacheln „Lädt…").
- **Ideen-Detailseite schneller (A + B-lite):** `get_idea` lädt Node-Metadaten +
  Kommentare jetzt PARALLEL statt seriell und holt die Anhang-Metadaten nicht mehr
  doppelt (~1,2 s → ~0,6 s). Zusätzlich rendert die Detailseite den Kern SOFORT aus
  dem bereits geladenen Listen-Objekt (kein „Lädt…"-Vollbild); Kommentare/Dokumente
  laden nach. Statt 3–4 s blankem Warten ist die Seite sofort da.
- **Bugfix Rangliste — Sterne-Score unter Daumen-Icon (Race):** Im Daumen-Modus
  zeigte die Bewertungs-Rangliste kurzzeitig den Sterne-Score (`sort=rating`, z. B.
  4.53 = 5 × Verfall) statt des Daumen-Scores (`sort=likes`, ~1) — weil der erste
  Fetch lief, bevor der Modus aus `/settings` da war (`voting.load()` ist async; der
  Default ist 'stars'). Ein `effect` lädt die Liste jetzt einmalig nach, sobald der
  globale Modus eintrifft. **Keine Daten betroffen** — reiner Anzeigefehler (jede
  Idee hatte real 1 Stimme; 1 👍 wird intern als 5-Sterne-Bewertung gespeichert).
- **Bugfix Voting-Flackern beim Reload (alle Seiten):** Der gesamte Voting-Stand
  (Modus Sterne/Daumen, globaler Master-Schalter, pro-Event-Bewertungsphase) wird
  jetzt in `localStorage` gecacht und initialisiert die Signale damit — statt der
  permissiven Defaults (Sterne, Voting an, Phase offen), bis das asynchrone
  `/settings` + Event-Liste antworten. Vorher blitzte beim Reload kurz der falsche
  Stand auf (Sterne statt Daumen, oder Vote-Buttons obwohl global/Event deaktiviert),
  und ein transienter `/settings`-Fehler warf die UI auf die Defaults zurück. Jetzt
  rendert der Reload sofort korrekt; Fehler behalten den zuletzt bekannten Stand.
  Die Deaktivierung selbst ist serverseitig durchgesetzt (Rating-Endpoint → **409**
  bei global aus / Event gestoppt, `add_rating` wird gar nicht erst gerufen) — der
  Cache betrifft nur die sofort korrekte Anzeige (6 `voting.service.spec`-Tests).
- **Render-Performance nach Angular-21 (`eventCoalescing`):** `provideZoneChangeDetection()`
  lief „bar" mit dem Default `eventCoalescing: false` → jedes Event löste mehrere volle
  Change-Detection-Läufe über den (großen, nicht-OnPush) Komponentenbaum aus. Jetzt
  `{ eventCoalescing: true }` (Angulars empfohlener Default) → weniger Render-Last bei
  Interaktionen (Filter, Voting); vom Nutzer als „deutlich schneller" bestätigt.
- **Sync hält keinen DB-Write-Lock mehr über Netzwerk-I/O (sporadische 503/Hänger):**
  Der Voll-Sync lief komplett in EINER `with connect()`-Transaktion und `await`ete
  edu-sharing MITTENDRIN — der SQLite-Write-Lock wurde so über die langsamen
  Alfresco-Roundtrips gehalten und staute parallele User-Writes (Voten/Kommentar/
  Mod-Speichern) bis zum `busy_timeout` → sporadische 503/lange Ladephasen (v. a.
  hinter dem strengeren hackathoern-Proxy). Umgebaut auf **erst lesen (ohne offene
  Connection), dann in einer kurzen Transaktion schreiben** → Lock nur noch
  Millisekunden. Audit aller 98 `with connect()`-Blöcke (routes.py + sync.py):
  sonst KEINE weitere Stelle mit `await` unter offenem Lock; `routes.py` durchweg
  sauber. Verhaltenserhaltend (alle Backend-Tests grün, EXIT=0).
- **Audit-Quick-Wins (risikoarm, aus dem Code-Audit):**
  - **Production-Build repariert:** `anyComponentStyle`-Budget 8/20 → 16/32 kB
    (analog Embed) → `npm run build` läuft wieder durch. (CI + Docker nutzen
    ohnehin `build:embed`, daher war es kein Deploy-Blocker.)
  - **Suche robuster (Pro-Buchstabe-Reaktion bleibt erhalten):** Das Grid
    reagiert weiterhin auf JEDEN Tastenanschlag, bricht aber die vom nächsten
    Tastendruck überholte Anfrage ab (HttpClient-Unsubscribe → echter XHR-Abbruch).
    Verhindert Out-of-Order-Ergebnisse/Flackern beim schnellen Tippen, ohne die
    angenehme Sofort-Reaktion zu entfernen. (Die Suche trifft den lokalen
    FTS-Cache, nicht edu-sharing — die Request-Anzahl war nie das Problem.)
  - **Timer-Leak:** `refreshUnseenCount`-Poll (60 s) wird in `ngOnDestroy` per
    `clearInterval` gestoppt.
  - **Doppel-Request:** Die Rangliste holt `/settings` (Verfalls-Parameter) nur
    noch einmal statt bei jeder `ngOnChanges`.
  - `AuthService.refreshMe()` von `new Observable` auf `pipe(tap, catchError)`
    umgestellt (+ ein `any` entfernt); Submit-Uploads nutzen `firstValueFrom`
    statt des deprecateten `toPromise()`.
  - **Index** `idea_original_idx` auf `idea(original_id)` (Ghost-Cleanup +
    Inbox-„bereits einsortiert"-Lookup).
  - Lokale `datetime`-Importe an die Modulköpfe gehoben.
  - *Evaluiert + verworfen:* erweiterte `edit_idea`-Read-Back-Prüfung für
    Description — hätte legitime Edits fälschlich mit 403 blockiert (FakeES/edu-
    sharing spiegeln `cm:description` nicht zuverlässig zurück), daher zurückgenommen.
- **Weitere Audit-Fixes (verifiziert, risikoarm — kein Schema/Datenverlust beim Live-Update):**
  - **Captcha Single-Use jetzt atomar** (`_captcha_verify`): das Einlösen IST das
    `DELETE` (rowcount-Check) → kein Doppel-Einlösen mehr bei TOCTOU zwischen
    SELECT und DELETE; falsche Antwort verbraucht das Token weiterhin NICHT
    (Tippfehler-Retry bleibt). Nutzt die bestehende Spalte — keine Migration.
  - **Suche gedeckelt:** `q` hat `max_length=200` → keine pathologisch großen
    FTS-Queries. (Rate-Limit auf `/ideas` bewusst NICHT gesetzt — würde hinter
    Schul-NAT legitime Nutzer in 429 laufen lassen.)
  - **Rating-Fehler-UX** (`setRating`/`toggleThumb`): bei Fehler wird auf den
    VORHERIGEN Wert zurückgesetzt (nicht 0) → kein fälschliches „nicht bewertet"
    nach Fehler; auch ein fehlgeschlagenes „Daumen zurücknehmen" lässt den Daumen an.
  - **Quick-Edit verliert keine Events mehr:** Das Schnell-Ändern der Veranstaltung
    in der Detail-Sidebar reduzierte eine Mehr-Event-Idee bisher auf EIN Event.
    Jetzt wird die volle Event-Liste gesendet (nur der gezeigte erste Event ändert
    sich, der Rest bleibt erhalten).
  - **httpx-Keepalive erhöht** (edu-sharing-Client): explizite `httpx.Limits`
    (`max_keepalive_connections` 20 → 40, `max_connections`=100) → unter
    Last-Spitzen (Sync + parallele Detail-Requests) weniger TLS-Handshakes zu
    edu-sharing. Reine Verbindungs-Wiederverwendung, KEINE zusätzliche
    gleichzeitige Last; `keepalive_expiry` bewusst beim Default (5 s) belassen
    (kein Risiko, tote Verbindungen wiederzuverwenden).
  - **Frontend-Bundle wird jetzt gzip-komprimiert** (`GZipMiddleware`): das
    ~816-KB-`main.js` ging bisher UNKOMPRIMIERT raus (StaticFiles + Proxy gzippten
    nicht) → mehrsekündige Erstladezeit, v. a. nach jedem Deploy (Cache-Bust →
    Re-Download). Mit gzip ~1/4 der Bytes (~195 KB), greift app-weit (auch
    API-JSON > 1 KB). Verifiziert: `GET /main.js → Content-Encoding: gzip`.
  - **Doppelte Requests beim Seitenaufbau eliminiert (In-Flight-Coalescing):**
    Globale GETs (`/settings`, `/meta`, `/topics`, `/phases`, `/events`,
    `/events/featured`) wurden beim Aufbau von mehreren Komponenten gleichzeitig
    parallel gefeuert und verstopften die ~6 Browser-Verbindungen (im DevTools-Trace
    10–16 s sichtbar). Ein kleiner `coalesced()`-Helfer im `ApiService` führt
    gleichzeitige identische Anfragen auf EINEN HTTP-Call zusammen (`shareReplay`
    + Cleanup nach Abschluss → kein Caching, keine Staleness). Drei Specs pinnen
    das Verhalten (gleichzeitig→1 Call, danach frisch, verschiedene Params→getrennt).
  - **N+1-Abfrage-Flut der Themen-/Event-Seiten behoben:** Die Idee-Zahlen pro
    Themenbereich/Herausforderung wurden mit je einer eigenen
    `GET /ideas?topic_id=…`-Abfrage geholt (~25 Requests allein beim Start). Jetzt
    liefert EIN `GET /meta` die exakten Counts pro `topic_id`; die Subtree-Summe
    wird client-seitig aus dem geladenen Themenbaum gebildet (identisch zur
    `include_descendants`-Semantik von `/ideas` → unveränderte Anzeige-Zahlen).
  - **Home-View-Flash bei Deep-Links behoben:** Bei `?view=events&…` (Share-Links/
    QR-Codes) rendert nicht mehr kurz die Home-Ansicht mit. Deren Ideen-Vorschau
    (`[limit]="8"`) feuerte sonst einen `GET /ideas?limit=8`, der beim sofortigen
    View-Wechsel abgebrochen wurde (rotes „(canceled)" im Network-Tab +
    verschwendeter Call). Der Ziel-View wird jetzt **synchron** aus der URL gesetzt
    (statt per `setTimeout`), sodass er schon beim ersten Render steht.
    `detail`-Deep-Links bleiben async (brauchen `getIdea`).
  - **Voll-Cache der Detailseite (A+B):** `GET /ideas/{id}` machte pro Aufruf
    Live-Calls zu edu-sharing (`node_metadata` + `comments`, parallel). Jetzt
    kommen Rating/Owner/eigene Stimme aus dem SQLite-Cache bzw. dem
    `vote_event`-Ledger (A — kein `node_metadata` mehr), und der Kommentar-Thread
    wird lazy gecacht mit `comment_count`-Invalidierung (B): stimmt der gecachte
    Count, kein Live-Call; sonst einmal holen + cachen. Post/Delete bumpen
    `comment_count` (über `refresh_idea`) → automatische Invalidierung. Tier C:
    auch die Child-IO-Anhänge (`list_child_objects`, der letzte Live-Call) werden
    gecacht — kein zuverlässiges Änderungssignal, daher kurze TTL
    (`CHILD_CACHE_TTL_SECONDS=60`). Zusätzlich leeren alle anhang-ändernden
    Endpoints (Upload/Rename/Delete/Replace) den `children_cache` sofort
    (`_invalidate_children_cache`) → eine Anhang-Änderung erscheint ohne
    TTL-Wartezeit; der io-Selbstanhang-Upload triggert `refresh_idea`. Detail
    fällt damit von **3 auf 0** Live-Calls (bei warmem Cache). Additive Migration
    (`comments_cache`, `comments_cache_count`, `children_cache`,
    `children_cache_at`) → kein DB-Bruch, rollback-sicher; Live-Fallback bei
    Cache-Miss bleibt. Tests: `tests/test_idea_detail_cache.py`,
    `tests/test_attachments.py`.
  - **Sicherheit: Owner-Login-Username wird nirgends öffentlich angezeigt.** Der
    Login-Username (z. B. „KathrinR") ist zugleich die halbe Anmeldeinformation und
    erschien öffentlich als Owner-Name — auf der Detailseite *und* (über das
    `author`-Feld = `cm:creator`) in der **Rangliste** und den **Top-Steigern**.
    Fix an der Quelle: neue Spalte `idea.owner_display_name`, im Sync/`refresh_idea`
    mit dem Klarnamen (Vor- + Nachname aus edu-sharing `createdBy`/`owner`, additiv
    + `COALESCE`) befüllt. `_row_to_idea` und der risers-Endpoint liefern `author`
    nicht mehr aus, wenn er nur der Login ist, und geben den sicheren
    `owner_display_name`. Frontend (Detail/Rangliste/Top-Steiger) zeigt
    App-Profilname → Klarname → echter Freitext-Autor → **sonst nichts**, NIE den
    Username. `owner_username` bleibt nur für Profil-Link/Owner-Check (nicht als
    angezeigter Name). Tests: `tests/test_idea_detail_cache.py`.
- **Bugfix Ranglisten-Skala im Daumen-Modus:** Die Top-3-Balkengrafik der
  Ranglisten-Seite begrenzte den Skalen-Maximalwert auf `Math.max(1, …)`. Bei
  Daumen-Verfallswerten < 1 (z. B. 0,91) sprang die Skala dadurch auf „1" und der
  oberste Balken erreichte nie 100 %. Jetzt wird der echte Spitzenwert angezeigt
  (Nenner nur gegen Division-durch-0 abgesichert) — konsistent zur Trend-Box auf
  den Event-Seiten (`rank-trend`).
- **Bugfix „Top-Steiger" im Daumen-Modus (422):** `/ranking/risers` ließ per
  `Literal` nur `rating/comments/interest` zu; das Frontend schickt im
  Daumen-Modus aber `sort=likes` (denselben Wert wie an `/ranking`, das `likes`
  akzeptiert) → **422**, die „Top-Steiger"-Sektion blieb dauerhaft leer. `likes`
  ins Literal aufgenommen (Snapshots werden ohnehin für `likes` geführt);
  unbekannte Sortierungen werfen weiterhin 422. Regressionstest
  `tests/test_ranking.py` (6 Fälle).

**Sync-Last reduziert (~4–7×)**
- Intervall **5 → 15 min** (an allen Default-Stellen: `config.py`, `.env`, `docker-compose.yml`, Doku).
- Schlanker `propertyFilter` statt `-all-` (nur ~9 genutzte Properties; live geprüft, kein Feldverlust).
- Legacy-Anhang-Ordner-Scan nur noch jeden 4. Lauf (Sicherheitsnetz, kein zweiter Timer).

---

### Status der Review-Kritik

**Frontend**
- ✅ Externe URLs/Calls (Fonts, QR, embed-demo) — **DSGVO-Blocker behoben**
- ✅ Generisches favicon ersetzt · ✅ README aus `public/assets` entfernt
- ✅ Angular ≥ 21 (EOL behoben) · ✅ npm-Audit: kritische + Core-XSS geschlossen (Rest Dev-Tooling, dokumentiert)
- ✅ Kein HTTP-Interceptor → `authInterceptor` eingeführt
- ✅ Unkodierte Pfad-Parameter → `encodeURIComponent`
- ✅ Null Tests → Test-Netz (77 Backend + 7 Frontend)
- ⚠️ Credentials im `sessionStorage` (Basic) → Interceptor begrenzt den Header **strukturell** auf die eigene API; vollständige Ablösung nur via OAuth (geparkt, s.u.). Dokumentiert.
- ✅ God-Komponenten / Inline-Template+Styles → Zerlegung **abgeschlossen** (2026-07-03): `moderation` 3763→369 (reine Shell + 9 Kinder; `inbox-list` 1112→915 mit eigenständigem `sync-diff`-Kind), `idea-detail` 2544→1979 (3 Kinder raus; Edit-Modal bewusst drin — teilt Upload-Trio/Taxonomien/editOnly-Lebenszyklus mit der Hauptansicht, Split wäre Duplikation oder Zweck-Service)
- ⏸️ Hartcodierte Farben (643/~270) → Phase 3 (opportunistisch)
- ⏸️ Kein Routing / `setTimeout`-Hacks → **Phase 2b** (NavigationService); die Hacks sind nach dem Zone-Fix funktional redundant
- ⏸️ Doppelte Requests (`/events`, `/meta`) → Phase 3
- ⏸️ Schwache Typisierung (`any`, ~92) → opportunistisch bei Berührung
- ℹ️ Material: Komponenten ungenutzt, aber M3-Theming aktiv (`styles.scss` `mat.theme`) → Dependency bleibt; Entfernung nur zusammen mit Theming-Ersatz · ℹ️ i18n → bewusst zurückgestellt (rein deutsches Produkt)

**Backend**
- ✅ Kein eigenes Auth-Modul → `app/auth.py`
- ✅ Kein Mod-Status-Cache → 60-s-TTL-Cache (beseitigt den Live-ES-Call pro geschütztem Request)
- ⚠️ `bool` vs. `throw` inkonsistent → Prädikate (bool) zentral in `auth.py`; `_require_moderator` (throw + Audit) bewusst in `routes.py`; dokumentiert
- ⚠️ Kein `Depends()`-Layer → **bewusst nicht erzwungen**: der Auth-Header wird in **67 Routen** an edu-sharing weitergereicht → `Depends()` würde Code verschieben statt reduzieren. Ziel „eine Quelle der Wahrheit" ist über `auth.py` erreicht. Begründung in `docs/KNOWN-LIMITATIONS.md`.
- ✅ `routes.py` monolithisch (~5.500) → Router-Split **vollzogen** (2026-07-02, s. Eintrag oben): 849-Zeilen-Read-Kern + 18 Domänen-Router, Vollständigkeit bewiesen
- ⏸️ `sync.py` (~900) Split → offen
- ℹ️ Ratelimit/Cluster (SQLite + lokale Session) → bewusster Single-Instance-Betrieb, dokumentiert

**Allgemein & perspektivisch**
- ⏸️ OAuth statt Basic → Spike erledigt, **admin-blockiert** (`eduApp`-`client_secret` fehlt); geparkt inkl. Selbst-Test-Rezept (`docs/AUTH-OAUTH-SPIKE.md`)
- ⏸️ Generierter API-Client statt `EduSharingClient` → Backlog (würde dokumentierte Workarounds reaktivieren)
- ⚠️ Sync-Skalierung / Repo-Last bei Children-Endpunkten → heute ~4–7× reduziert (Intervall/Filter/Anhang-Scan); der große Hebel (Suche statt Tree-Walk) ist als **Team-Frage** geparkt (`docs/EDU-SHARING-ZUSAMMENSPIEL.md`). „Keine doppelte Datenhaltung": der SQLite-Mirror ist bewusster Cache (FTS, Decay-Ranking), dokumentiert.
- ℹ️ Englische vs. deutsche Kommentare → Projekt bleibt deutsch (opportunistisch)
