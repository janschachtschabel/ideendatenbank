# Changelog

## 2026-07-09 — Ephemeral-DB-Modus (Variante A): SQLite auf RAM-Disk, Opt-in

Umsetzung der These „Request-Pfad darf den Storage nie berühren" — als
Opt-in für Instanzen mit trägem/stallendem Volume (Messbefund: ~40 ms pro
Datei-Open, 16-s-I/O-Stalls):

- **Backend:** `DB_EPHEMERAL=true` aktiviert den Modus. Auto-Restore läuft
  dann bei JEDEM Pod-Start (Marker `AUTO_RESTORE_OK` wird nicht mehr
  konsumiert — im Default-Modus unverändert einmalig, per Test gepinnt).
  `BACKUP_INTERVAL_MINUTES` (>0) übersteuert das Stunden-Intervall — es ist
  zugleich das maximale Verlustfenster bei hartem Crash. Beim geplanten
  Shutdown zieht der Lifespan ein Abschluss-Backup (`shutdown_backup`,
  no-op im Default-Modus) → Deployments/Restarts verlieren NICHTS.
- **Chart (0.3.0):** `persistence.dbInMemory.{enabled,sizeLimit,
  backupIntervalMinutes}` — mountet ein `emptyDir(medium: Memory)` für die
  DB, biegt `SQLITE_PATH` darauf um und setzt die beiden Env-Vars; Backups
  (und der Marker) bleiben auf dem PVC. README: Betriebsmodus-Abschnitt
  inkl. Erstaktivierungs-Hinweis (vorher Backup erzeugen + Marker anlegen).
- Verlustfenster ehrlich dokumentiert: nur bei HARTEM Crash die app-eigenen
  Writes (Votes/Team/Kontakte/Reports) seit dem letzten Backup, max.
  `backupIntervalMinutes`; edu-sharing-Inhalte stellt der Sync wieder her.
- 4 neue Tests (Minuten-Intervall, Marker-Konsum Default vs. ephemeral,
  Shutdown-Backup nur im Modus). Dabei gelernt: conftest deaktiviert
  BACKUP_ENABLED global — der Shutdown-Test aktiviert es gezielt.
- Verifiziert: pytest 220/220 · ruff clean · values.yaml parsebar ·
  Template↔Values-Keys konsistent · Env-Mapping-Smoke (DB_EPHEMERAL,
  BACKUP_INTERVAL_MINUTES) grün.
- **Nachtrag für Compose-Deployments (nip.io nutzt kein Helm):**
  `docker-compose.ephemeral.yml` als Override — Aktivierung per
  `docker compose -f docker-compose.yml -f docker-compose.ephemeral.yml up -d`
  (setzt die 3 Env-Vars + tmpfs-Mount; Daten-Volume/Backups aus der Basis
  bleiben). Inkl. dokumentierter Einmal-Schritte (Backup + Marker) und
  Rückwechsel-Hinweis (alte Disk-DB entfernen, sonst veralteter Stand).
  Merge per `docker compose config` verifiziert.

## 2026-07-09 — Diagnose verfeinert: Storage ist Hauptverdächtiger; `connect_open_ms` in /status

Zwei neue Proben präzisieren die Instanz-These:

- **TLS-Zertifikate:** beide Instanzen Let's Encrypt mit host-genauem SAN →
  das TLS (und damit HTTP/2) terminiert auf BEIDEN der eigene Ingress-Stack;
  der `use-http2`-Schalter liegt in eigener Hand (Controller-ConfigMap).
- **h2-Frame-Probe (idle lauschen):** die hackathoern-Kette schließt idle
  h2-Verbindungen nach exakt ~50 s mit SAUBEREM TCP-FIN (kein GOAWAY, aber
  auch kein Blackhole). Ein sauberes FIN erzeugt keine Browser-Hänger →
  die Idle-Kill-These wird ABGESCHWÄCHT. Neugewichtung: die 3–5-s-Fälle
  passen am besten zu den BELEGTEN sporadischen Storage-Stalls (16-s-
  bootstrap-Ausreißer): ein hängendes Volume stoppt ALLE parallelen
  DB-Requests gleichzeitig → identische Zeiten. Der Heartbeat (25 s < 50 s)
  bleibt sinnvoll: die Verbindung erreicht das FIN-Fenster nie.
- **Neu: `diagnostics.connect_open_ms` in `GET /status`** (Mod-only):
  misst die Kosten einer frischen DB-Datei-Öffnung direkt AUF der Instanz
  (gesund <1 ms, träge ~35–40 ms) — macht die Storage-These pro Instanz
  vergleichbar und nach dem Pool-Deploy dauerhaft überwachbar.
- Attribution nach Deploy: `Server-Timing`-Header zeigt bei jedem 3–5-s-Fall
  sofort, ob die Zeit im Server (dur groß → Storage) oder auf dem Weg lag.
- Verifiziert: pytest 216/216 · ruff clean.

## 2026-07-09 — Thread-gepoolte SQLite-Connections + h2-Rezepte im Chart

Umsetzung des Connection-Reuse-Vorschlags (Messbefund: auf trägem Storage
kostet JEDES Öffnen der DB-Datei ~35–40 ms; get_idea mit ~6–8 DB-Blöcken
lag deshalb bei 303 ms statt 40 ms):

- **`db.connect()` poolt jetzt pro Worker-Thread EINE offene Connection** —
  identische Contextmanager-Semantik (Commit bei Erfolg, Rollback bei
  Exception, per Test gepinnt). Invalidiert wird bei: sqlite_path-Wechsel
  (Test-Hermetik), explizitem `invalidate_pooled_connections()` und kaputter
  Connection. Verschachteltes `connect()` im selben Thread bekommt eine
  Wegwerf-Connection (ein inneres Commit kann nie die äußere Transaktion
  mit-committen). `check_same_thread=False` nur damit Restore/Teardown fremde
  Handles SCHLIESSEN dürfen — benutzt wird jede Connection weiter nur von
  ihrem Thread.
- **Restore-Datei-Swap absichert:** `restore_backup` invalidiert den Pool vor
  UND nach dem Tausch (Windows: offene Handles blockieren sonst den Swap;
  Linux: Handles läsen die alte Inode; das Nachher deckt das Race-Fenster).
  Test-Teardown invalidiert ebenfalls (tmp_path-Locks).
- **`cache_size` 8 MB → 2 MB pro Connection:** mit bis zu ~100 langlebigen
  Worker-Connections (32 asyncio + 64 anyio) wären 8 MB bis zu ~800 MB im
  1-Gi-Container; Reads trägt ohnehin die prozessweit geteilte 128-MB-mmap.
- Erwartung nach Deploy auf der trägen Instanz: get_idea ~303→~60 ms,
  bootstrap ~334→~80 ms; auf gesunder Instanz neutral.
- **deploy/ (Chart 0.2.1, nur Doku):** README-Abschnitt „Troubleshooting:
  sporadische 3–5-s-Hänger (HTTP/2-Keepalive)" — erklärt den h2-Single-
  Connection-Effekt + die drei Stellschrauben (Idle-Timeout/GOAWAY beim
  Betreiber; Controller-ConfigMap `use-http2: "false"` clusterweit; per-Host
  `server-snippet: http2 off;` als AUSKOMMENTIERTE values-Option inkl.
  Snippet-Webhook-Warnung). Keine Default-Verhaltensänderung.
- 6 neue Pool-Tests. Verifiziert: pytest 216/216 (inkl. aller 8
  Backup/Restore-Tests mit Datei-Swap) · ruff clean · values.yaml parsebar.

## 2026-07-09 — Instanz-Diagnose komplett + Verbindungs-Heartbeat gegen h2-Idle-Kill

Messreihe beider Instanzen (8×9 Endpoints, warme Verbindung) + TLS/ALPN-Check.
Drei belegte Effekte erklären, warum idee.hackathoern.de trotz identischem
Code langsamer ist als nip.io:

1. **HTTP/2 vs. HTTP/1.1:** hackathoern-Kette spricht h2 (EINE Browser-
   Verbindung für alles), nip.io nur http/1.1 (bis zu 6 Sockets). Kappt der
   vorgeschaltete Proxy die h2-Verbindung nach Leerlauf STILL (gemessen:
   1,3–4 s Reuse-Hänger), hängen ALLE XHRs des nächsten Klicks gleichzeitig —
   deshalb identische 3–5-s-Zeiten auf derselben Connection-ID.
   → **Fix (App): Verbindungs-Heartbeat** — /health-Ping alle 25 s bei
   sichtbarem Tab + Sofort-Ping beim Tab-Rückwechsel (Page Visibility). Die
   Verbindung wird nie idle genug für den Kill; wirkt auf jeder Proxy-Kette.
2. **DB-Datei-Open kostet dort ~35–40 ms** (nip.io ~0): ready 73 vs. 33 ms;
   Endpoints mit mehreren DB-Blöcken multiplizieren das (get_idea 303 vs.
   40 ms, bootstrap 334 vs. 40 ms) → Storage der Instanz ist träge.
   → Vorschlag (nächster Schritt, nicht umgesetzt): Thread-lokale
   Connection-Wiederverwendung mit Generation-Invalidierung (Restore-sicher).
3. **Sporadische Storage-Stalls:** ein bootstrap-Aufruf hing 16 s (warme
   Verbindung, reiner DB-Read) → PVC/Storage-Class der Instanz prüfen
   (Betreiber). In-Memory-SQLite bewusst NICHT umgesetzt: Writes (Votes/
   Interaktionen/Caches) bräuchten eine Sync-Back-Schicht mit Verlustfenster;
   Connection-Reuse liefert den Read-Nutzen ohne Persistenzrisiko.

Frontend-Gates: ng lint clean · 22/22 Tests · build:embed 0 Errors.

## 2026-07-09 — Observability: Server-Timing-Header + Slow-Request-Log

Für die Instanzvergleichs-Diagnose (idee.hackathoern.de langsam vs. nip.io
flüssig): jede Antwort trägt jetzt `Server-Timing: app;dur=<ms>` — die
Browser-DevTools (Request → Timing) zeigen damit die reine SERVER-Zeit pro
Request. Ist ein Request 5 s langsam, aber `dur` ~10 ms, liegt die Zeit auf
dem WEG (Proxy-Keepalive/DNS/TLS/Queueing), nicht in App/DB — das beendet das
Rätselraten datenbasiert. API-Requests > 1 s landen zusätzlich als WARNING im
Pod-Log. Messbasis dazu (von außen, gleicher Tag): DB-Endpoints der
hackathoern-Instanz per Direktmessung median 0,21 s über 15 Bursts (Storage-
These damit unwahrscheinlich); Keepalive-Reuse nach Idle dort erneut
unzuverlässig (1,3–4 s vs. nip.io 0,04 s). Test gepinnt
(test_security_headers). pytest 210/210 · ruff clean.

## 2026-07-09 — Anhang-Cache: Negative-Caching + Prewarm beim Freischalten

Live-Diagnose des Instanz-Vergleichs (idee.hackathoern.de vs. nip.io, gleicher
Code): Listen auf beiden gleich schnell, aber `get_idea` auf hackathoern
KONSTANT ~0,37 s (nip.io: 0,145 s) — dort läuft der Anhang-Live-Call
(`list_child_objects`) offenbar bei JEDEM Aufruf, weil ein FEHLSCHLAGENDER
Call (z.B. Gast ohne Leserecht) nie gecacht wurde. Der 4,5-s-Ausreißer des
Users war zusätzlich der Erstaufruf einer frisch freigeschalteten Idee
(leerer Cache) während einer ES-Lastspitze; `interactions` (4,4 s) wartete
nur seriell dahinter (gleiche HTTP/1.1-Verbindung).

- **Negative-Caching:** Schlägt der Anhang-Live-Call fehl, wird der
  Leer-Fallback mit kurzem Stempel gecacht (60 s „frisch", danach
  SWR-Zone) — statt bei jedem Detailaufruf erneut synchron gegen das
  werfende edu-sharing zu laufen. `log.info` mit Fehlergrund, damit der
  Betreiber die Ursache (z.B. 403) in den Pod-Logs sieht.
- **Prewarm beim Freischalten:** `moderation/move` + `bulk_move` füllen den
  Anhang-Cache der frischen Reference als Background-Task — der erste
  Detailaufruf einer gerade freigeschalteten Idee zahlt den ES-Call nicht
  mehr. Ein zusätzlicher ES-Call pro Freischaltung, best-effort.
- Children-Cache-Helfer (TTL-Konstante, map/store/refresh) von routes.py
  nach routes_common.py gezogen (get_idea + Move teilen sie jetzt).
- 3 neue Tests (Negative-Cache greift ab Aufruf 2 ohne ES-Call; Move +
  Bulk-Move wärmen die Reference vor). Verifiziert: pytest 209/209 ·
  ruff clean.
- **Zusätzlicher Infra-Befund (kein App-Fix möglich):** Der Proxy vor
  idee.hackathoern.de kappt idle Keepalive-Verbindungen still (Messung:
  Folgerequest nach 8 s idle = 4,05 s vs. nip.io 0,04 s) → sporadische
  ~3-s-Hänger im Browser. Empfehlung an den Betreiber: Idle-Timeout ≥ 65 s
  bzw. sauberes FIN, oder HTTP/2 aktivieren.

## 2026-07-09 — Browser-Zurück funktioniert jetzt in der App + Brotkrumen-Ausbau

User-Feedback: Die Zurück-Taste des Browsers warf einen aus der App (SPA ohne
History-Integration — kein Angular-Router wegen Web-Component-Embed).

- **History-Integration (`nav-url.ts` + Shell):** Jede Navigation (View-Wechsel,
  Idee öffnen, Themen-/Event-Drill, Drill verlassen, Topic-Filter) spiegelt den
  Zustand per `pushState` in die Query-Params — dasselbe Vokabular wie die
  bestehenden Share-Links (`view`/`id`/`u`/`event`, neu `topic`). `popstate`
  stellt die Ansicht wieder her (inkl. Detailseite via ideaId-Selbst-Load,
  Drill-Rekonstruktion aus dem Themenbaum, Browser-Filter). Embed-sicher:
  NUR die app-eigenen Query-Keys werden angefasst, fremde Host-Params bleiben;
  alles in try/catch (sandboxte iframes laufen einfach ohne). Der Start-Eintrag
  wird nur normalisiert (replace) — der erste Back-Druck verlässt die App
  weiterhin, solange nicht navigiert wurde.
- **Drei lokale `replaceState`-Inseln konsolidiert** (goSubmitForEvent,
  goVoteForEvent, enterEventDrillFromHome) — Featured-Klicks erzeugen jetzt
  EINEN korrekten History-Eintrag statt URL-Update ohne Rückweg.
- **Brotkrumen-Ausbau:** Detailseite zeigt jetzt die volle Kette
  „← Zurück / Ideen / **Themenbereich** / Herausforderung" (Parent-Ebene neu,
  klickbar); öffentliche Profilseite hat eine „← Zurück zu den Ideen"-Leiste
  (hatte keinen In-App-Rückweg). Bestand geprüft: Browser-Breadcrumb (3-stufig),
  Themen-/Event-Drill-Zurück-Links vorhanden ✓.
- Verifiziert im echten Browser (Preview, lokale Daten): Push-Kette
  `/ → ?view=browser → ?view=detail&id=…`, Back→Liste→Home, Forward→Liste,
  Topic-Drill rein/raus, Featured-Event-Drill (ein Eintrag + state), 0
  Console-Errors. Gates: ng lint clean · **22/22** FE-Tests (16 + 6 neue
  nav-url-Specs) · build:embed 0 Errors.

## 2026-07-09 — Detailseite: ~1,2-s-Hänger pro Ideenwechsel behoben (SWR-Mod-Status)

Live-Diagnose (DevTools, frischer Deploy): `ideas`-Liste 59 ms, `unseen` 41 ms
(DB-Pfade schnell ✓) — aber `get_idea` **1,24 s** und `interactions` **1,23 s**,
parallel und fast identisch lang = beide warteten auf DENSELBEN (coalesced)
`my_memberships`-Roundtrip. Ursache: der Mod-Status-Cache (TTL 60 s) läuft beim
Stöbern ständig ab, und die Re-Verifikation (~1 s edu-sharing-Auth) blockierte
die Antwort — nur um UI-Flags zu setzen. Betroffen: alle EINGELOGGTEN Nutzer,
bei praktisch jedem Ideenwechsel nach >60 s Lesezeit.

- **`is_moderator(stale_ok=True)` (SWR):** Anzeige-Pfade (get_idea
  can_edit/can_delete + Phasen-Dropdown, interactions can_manage) verwenden
  einen kurz abgelaufenen Cache-Eintrag SOFORT; die Re-Verifikation läuft im
  Hintergrund (In-Flight-dedupliziert, Task-referenziert). Gnadenfenster
  `_MOD_STALE_GRACE` 10 min — danach wieder blockierend (verhindert unbegrenzt
  alte Anzeige-Zustände). Cache-Eviction um das Fenster verschoben.
- **Sicherheits-GATES unverändert streng:** `require_moderator` (alle
  Mod-Aktionen), hidden-404 und sämtliche Mutationen nutzen `stale_ok` NIE —
  deren Widerrufs-Fenster bleibt 60 s (per Test gepinnt: Entzug greift sofort).
- **Kontakt-Gate gehärtet:** Anzeige der (personenbezogenen) Kontaktdaten
  verlangt jetzt IMMER die Passwort-Verifikation — der frühere Mod-Shortcut
  entfällt (er wäre mit stale-Status ein Bypass gewesen; Verify ist coalesced
  und läuft nur auf Ideen MIT hinterlegtem Kontakt).
- Effekt nach Redeploy: nur der ERSTE Aufruf nach Login/Neustart zahlt die
  Auth-Latenz einmalig; jeder weitere Ideenwechsel antwortet cache-schnell.
  Bonus: die Detailseiten-Flags überleben jetzt sogar einen ES-Ausfall
  (Integrationstest).
- 4 neue Tests: stale liefert sofort + Hintergrund-Refresh erneuert, Gates
  bleiben strikt nach Ablauf, Gnadenfenster begrenzt, Detailseite bei
  ES-Ausfall. Verifiziert: pytest 206/206 · ruff clean.

## 2026-07-09 — Login-Latenz /me halbiert + Format-Baseline

- **`GET /me` parallelisiert:** Der Login-Check machte zwei **serielle**
  edu-sharing-Roundtrips (Mod-Status via memberships ~700 ms, dann Klarname via
  profile ~500 ms) = die im Browser gemessenen **1,2 s**. Beide sind unabhängig →
  `asyncio.gather` = **ein** Roundtrip Wandzeit (~0,7 s). Verhaltensgleich (beide
  Helfer fangen ihre Fehler selbst); pytest grün.
  **Einordnung Floor:** Unter ~0,7 s geht beim Login nicht ohne Credential-
  Caching — die Passwort-Prüfung MUSS live gegen edu-sharing (bewusst ungecacht,
  s. `verify_login`-Doku). Der /me/*-Burst der Profilseite teilt sich bereits
  EINEN Roundtrip (In-Flight-Coalescing in auth.py); die ~770 ms je Call im
  DevTools-Trace sind alle DERSELBE gemeinsame ES-Call, nicht vier.
  Inbox-Listen (~1 s) bleiben live-by-design (Mod-Triage braucht Ist-Stand).
- **Format-Baseline wiederhergestellt:** 19 Backend-Dateien hatten reine
  Whitespace-Drift aus parallelen Arbeitssträngen — `ruff format --check`
  (eigener CI-Job!) wäre rot gewesen. Normalisiert; check 58/58, pytest grün.
- **Inbox: Einmal-Retry bei transienten edu-sharing-5xx.** Beim Einsortieren
  (Move) mutiert edu-sharing den Inbox-Container, während die Mod-UI die drei
  Sichtfilter parallel lädt — das quittierte ES gelegentlich mit einem kurzen
  5xx (im Trace: `inbox?filter=categorized` → 502, Sekunden später wieder 200).
  Der rein lesende, **idempotente** Seitenabruf (`node_children`) wird jetzt
  GENAU EINMAL wiederholt (0,5 s Pause); 4xx wird sofort durchgereicht, bleibt
  auch der Retry 5xx → weiterhin ehrlicher 502. **Schreibpfade (Move/Delete)
  retryn bewusst NICHT** — ein wiederholtes „Reference anlegen" könnte doppelt
  einsortieren. Tests: `tests/test_inbox_retry.py` (heilt transient / bleibt
  502 bei Dauerausfall / kein 4xx-Retry).

## 2026-07-08 — Offene Audit-Punkte abgearbeitet: Chart-Fixes, Lint-Baseline eliminiert

Abarbeitung der im Abschluss-Audit als „offen" gelisteten Punkte (auf explizite
Freigabe hin auch die zwei deploy/-Notizen — einzige Chart-Änderungen):

- **deploy/ (Chart 0.1.0 → 0.2.0):**
  - Readiness-Probe zeigt jetzt auf **`/api/v1/ready`** (DB-`SELECT 1`) statt
    `/health` — ein Pod mit kaputter DB fällt aus dem Service, wird aber nicht
    neu gestartet (Liveness bleibt auf dem I/O-freien `/health`).
  - Tote `SYNC_INTERVAL_SECONDS`/`syncIntervalSeconds` entfernt und durch die
    vom Backend real gelesene **`SYNC_NIGHTLY_HOUR`** (`config.app.syncNightlyHour`,
    Default 1) ersetzt — der Operator behält echte Sync-Steuerung statt einer
    Schein-Variable. Env-Mapping verifiziert (Settings-Smoke-Test).
  - README-Parametertabelle synchron; helm lokal nicht installiert →
    verifiziert per Template↔Values-Konsistenz-Grep + YAML-Parse.
- **Lint-`any`-Baseline eliminiert (4 → 0):** Die Inbox-Review-Vorschau ist KEIN
  roher ES-Passthrough — das Backend formt das Response-Shape explizit
  (routes_inbox.inbox_item_preview) → neues `InboxPreview`-Interface (models.ts,
  Attachment-Reuse), typisiert `inboxItemPreview()`, den Preview-Cache und
  `attIcon()`. Drei Template-Stellen auf optional chaining (Angular-Narrowing).
  **ng lint: „All files pass linting."**
- **Geprüft, unverändert (begründet):** npm-Advisories weiterhin nur in der
  webpack-dev-server/sockjs-Kette, kein non-breaking Upstream-Fix (nur
  `--force`-Downgrade) — Dev-only-Baseline bleibt. httpx-keepalive,
  `/me`-Live-Verifikation, Mod-Cache 60 s: bewusste Tradeoffs, nicht angefasst.
  Sentry-DSN/OAuth brauchen Secrets vom Betreiber; Bild-Proxy wäre ein neues
  Feature (kein Fix).
- Verifiziert: ng lint 0/0 · 16/16 FE-Tests · build:embed 0 Errors ·
  pytest 199/199 + ruff clean (Backend unverändert, letzter Lauf).

## 2026-07-08 — Audit-Fixes: Detailseite ohne Live-Owner-Check, SWR-Anhang-Cache, Restore blockiert nicht mehr

Umsetzung der Audit-Befunde (DB-Connections/Blocking/ES-Lage/Caching/5–10-s-Ausreißer):

- **🟠 Detailseite (HIGH):** `is_owner_or_mod`/`can_edit_idea` haben jetzt
  `live_fallback` (Default `True`). `get_idea` setzt `False` — die UI-Flags
  `can_edit`/`can_delete` kommen rein aus dem Cache-Owner-Match. Vorher zahlte
  JEDER eingeloggte Nicht-Owner pro Detailaufruf einen ungecachten
  `node_metadata`-Roundtrip (~300–450 ms; bei ES-Hängern bis zum 30-s-Timeout —
  die beobachteten Einzel-Ausreißer). Randfall bleibt korrekt: Row ohne
  `owner_username` → Live-Blick weiterhin. Mutationspfade (Edit/Delete/Anhänge)
  unverändert mit Live-Fallback.
- **Caching-Abwägung Detailseite:** Anhang-Cache jetzt **stale-while-revalidate**
  — abgelaufener `children_cache` wird sofort ausgeliefert, der Refresh läuft
  NACH der Antwort (FastAPI BackgroundTasks). Kein Aufruf zahlt mehr die
  Anhang-Latenz; ES-Last identisch (gleiche Refresh-Anzahl, nur asynchron).
  Sync-Vorwärmen bewusst VERWORFEN: ~100+ zusätzliche ES-Calls pro Nachtlauf,
  Nutzen bei 1-h-TTL um 02:00 schon verpufft. Kommentare bleiben bewusst
  synchron bei Count-Mismatch (stale wäre inhaltlich falsch, z.B. direkt nach
  eigenem Kommentar).
- **🟡 Admin-Restore (MEDIUM):** `restore_backup` blockierte den Event-Loop
  (ZIP-I/O bis 200 MB, `create_backup()`/VACUUM INTO, Datei-Tausch, init_db
  synchron im async-Body) → alle Schritte laufen jetzt im Threadpool; während
  eines Restores frieren parallele Requests nicht mehr ein.
- **🟢 `admin_backup_list` (LOW):** ZIP-Header-Reads via to_thread.
- **Bewusst NICHT geändert:** httpx `keepalive_expiry` (Stale-Connection-Risiko,
  dokumentierte Entscheidung), `/me`-Login-Verifikation (Sofort-Widerruf-
  Garantie), deploy/ (eingefroren — Readiness-Probe→/ready + tote
  SYNC_INTERVAL_SECONDS-Var als Notiz fürs nächste Chart-Update).
- 6 neue Tests: kein `node_metadata` auf Detail (Nicht-Owner + Owner),
  Live-Randfall bei unbekanntem Owner, Mutations-Pfad behält Fallback,
  UI-Pfad-Unit, SWR (stale sofort + Hintergrund-Refresh + Neu-Stempel).
- **Nachtrag (Abschluss-Audit):** gleiche Latenzfalle auch im
  `GET /ideas/{id}/interactions` gefunden (lädt die Detailseite bei jedem
  Öffnen parallel) — das reine `can_manage`-UI-Flag machte für eingeloggte
  Nicht-Owner denselben Live-`node_metadata`-Roundtrip → `live_fallback=False`
  (+ Regressionstest). Damit ist der Detailseiten-Load für eingeloggte User
  komplett ES-frei, solange die Caches greifen.
- Verifiziert: pytest 199/199 · ruff clean · AST-Scanner: 0 Event-Loop-DB-Zugriffe
  in Request-Pfaden (nur dokumentierter Lifespan-Startup).

## 2026-07-08 — Ideengeber:in: nie mehr der Mod, der freigeschaltet hat

Live-Befund: Nach dem Einsortieren (Move Inbox → Herausforderung) stand auf der
Ideenseite der **Moderations-Account** als „Ideengeber:in" — der Mod legt den
Reference-Knoten in der Sammlung an, dessen `createdBy`/`owner` übernahm der
Sync blind als `owner_display_name`, und die Anzeige bevorzugte diesen Klarnamen
vor dem eingereichten Namen.

- **Sync-Guard (Wurzel, `sync.py`):** Klarname aus `createdBy`/`owner` zählt nur
  noch bei Login-Match mit dem aufgelösten Owner (`submitter:`-Keyword →
  `cm:owner` → `cm:creator`). Bekannter Mismatch (Mod-Reference) oder
  Guest-Service-Account → Sentinel `''`, das per `NULLIF` im UPSERT auch
  **früher falsch gecachte Namen beim nächsten Refresh löscht**
  (Alt-Daten-Heilung; Detailseiten-Aufruf genügt). Sammlungs-Walk ohne
  Personen-Info hält weiterhin bekannte korrekte Namen (COALESCE).
- **Anzeige-Priorität (Anforderung):** 1. Freitext-Name aus dem Einreichformular
  (`author`), 2. Klarname des einreichenden WLO-Users, 3. „Anonym" — nie der
  Mod, nie der Login. Umgesetzt in `ownerLabel` (Detailseite), `_row_to_idea`
  (Listen) und im Ranking-Merge.
- **Guest-Login nicht mehr in API-Antworten** (`owner_username=None` bei
  anonymen Ideen) → kein Profil-Link auf den Service-Account; das
  „Anonym"-Fallback verlinkt nie.
- 7 neue Regression-Tests (`test_owner_attribution.py`): Mod-Reference,
  Stale-Heilung, eigene Einreichung, Owner-Delegation, Sammlungs-Walk,
  Guest-Fall, Listen-Priorität.
- Verifiziert: pytest 192/192 · ruff clean · ng lint 0 Errors (4 any-Baseline) ·
  16/16 FE-Tests · build:embed 0 Errors. Live sichtbar nach Rebuild+Redeploy;
  falsche Alt-Namen korrigieren sich beim ersten Aufruf der jeweiligen
  Detailseite (refresh) bzw. Sync mit Personen-Metadaten.

## 2026-07-04 — Postfach: redundante Inbox-Abrufe entfernt

Live-Diagnose (DevTools) beim Öffnen des Postfachs zeigte `inbox?filter=uncategorized`
**3×** gefeuert + `all`/`categorized` je 1× — 5–6 parallele Live-ES-Walks (~1 s
each), unter deren Last edu-sharing gelegentlich mit **502** antwortete (in der
Konsole als „1 error" sichtbar, von der App aber bereits weich abgefangen).

- **`api.inbox()` jetzt coalesced** (wie `topics`/`meta`/`phases`/`events`):
  Nav-Badge (`moderation.loadInboxCount`) + Haupt-Load (`inbox-list.load`) fragen
  beim Öffnen DENSELBEN Filter gleichzeitig ab → nur noch EIN Roundtrip.
- **`loadInboxCounts()` überspringt den aktiven Filter** (dessen Count liefert
  schon `load()`) — der Kommentar versprach das längst, der Code holte ihn aber
  trotzdem. Ergebnis: `uncategorized` **3× → 1×**, gesamt 5–6 → 3 Calls beim
  Öffnen. Kleinerer ES-Burst → seltener 502.
- **Meldungen + Moderatoren geprüft — sauber:** je genau EIN Call.
  `/admin/reports` ist eine einzelne SQL-JOIN-Query (kein N+1); die ~600–900 ms
  sind der kalte Mod-Auth-ES-Check (`is_moderator`, 60-s-gecacht) + bei
  Moderatoren der `group_members`-ES-Call — inhärente Basic-Auth-Latenz, kein
  Defekt. Die „1 error"-Konsole war der akkumulierte Inbox-502, kein neuer Fehler.
- Verifiziert: build 0 Errors · ng lint 0 Errors (4 any-Baseline) · 16/16 FE-Tests.

## 2026-07-04 — Robustheit: alle Datenabrufe fangen Fehler ab

Ausgehend vom „Mein Bereich"-Befund (fehlender error-Callback → transienter
Auth-Fehler wurde als **uncaught error** sichtbar) den GESAMTEN Frontend-Code
per Skript (`scan_subscribe.py`, balancierte Klammer-Erfassung) durchsucht:
**32 `.subscribe(...)`-Aufrufe ohne error-Handler** in 6 Komponenten gefunden
und behoben → Scanner jetzt **0**.

- **Load-Reads** (Themen-/Facetten-/Taxonomie-/Interaktions-Abrufe beim Öffnen
  bzw. Navigieren) fangen jetzt weich ab: die betroffene Sektion behält ihren
  Stand (leer/vorherig), die Seite bricht NICHT ab. Betrifft app-shell
  (Topic-Drill + Facetten, verschachtelt), idea-detail (Interaktionen +
  Taxonomie-Lazy-Loads), submit-idea + inbox-list (Dropdown-Daten),
  taxonomy-/topic-editor (Listen + Counts).
- **Mutationen** (Mod-Schreibaktionen) geben jetzt **Feedback** statt still zu
  scheitern — die Taxonomie-Writes (`addEvent`/`savePhase`/`addPhase`/
  `toggleActive`/`setEventRating`) waren inkonsistent (nur `saveEvent`/`delete*`
  hatten Handler); jetzt alle via `_taxSaveError`-Alert. Ebenso
  `deleteInboxItem` (Postfach) und die Like/Follow-Toggles auf der Detailseite.
- Verifiziert: build 0 Errors · ng lint 0 Errors (4 any-Baseline) · 16/16 FE-Tests.

## 2026-07-03 — Performance: Live-Netzwerk-Befunde behoben (+ Folgeprüfung)

Aus DevTools-Beobachtung im Live-Betrieb diagnostiziert und im Code verifiziert
(je +Test, wo backendseitig):

- **Detailseiten-Latenz (~300–450 ms bei FAST JEDEM Aufruf) — Hauptursache:**
  Der Child-IO-Anhang-Cache (`children_cache`) hatte eine **60-s-TTL** → jeder
  Detailaufruf mit >60 s Abstand erzwang einen Live-`list_child_objects`-ES-Call.
  Ein Fehlgriff, denn Anhang-Mutationen über die App rufen ohnehin bereits
  `_invalidate_children_cache` (NULL → nächster View lädt sofort frisch) — die
  TTL bewacht nur seltene out-of-band-Änderungen. **TTL 60 s → 1 h** (60×
  weniger Live-Reads; out-of-band spätestens per Nightly-Attachment-Scan). Test:
  `test_child_attachments_cache_survives_far_beyond_old_60s`.
- **Detailseite, Kommentar-Zweig:** bei `comment_count == 0` lief trotzdem ein
  Live-`comments()`-Call (kalter Cache) → jetzt ohne Call leer ausgeliefert.
  Reduziert die ES-LAST (der zweite konditionale Read lief bislang parallel zum
  Anhang-Read); Wall-Clock-Gewinn erst zusammen mit dem TTL-Fix, da beide Reads
  parallel starten. Test: `test_comments_skipped_when_count_zero`.
- **Moderation → Themenbereiche: N+1 eliminiert.** Der Editor feuerte je
  Themenbereich einen eigenen `ideas?topic_id=…`-Request (40+ Calls) nur für den
  „leer?"-Count → ersetzt durch **einen** `/meta`-Call (liefert die Counts als
  `topics: {id: n}` gebündelt). Verhaltensgleich: `/meta` zählt direkt per
  `topic_id` — für die an Herausforderungen (Blättern) angezeigten Zahlen und
  die Delete-Gate identisch zum vorigen Subtree-Count; `hidden`-Ausschluss in
  beiden gleich.
- **„Mein Bereich": 4 parallele Auth-Roundtrips → 1.** Der Profilseiten-Burst
  (`/me/follows` + `/me/interest` + `/me/team-requests` + `/me/notifications/seen`)
  rief je einen ungecachten `verify_login` → `my_memberships`-ES-Call (~940 ms)
  auf — 4 simultane Auth-Prüfungen auf edu-sharing (Ursache der beobachteten
  transienten Fehler). Neu: **In-Flight-Coalescing** in `auth.py` — nebenläufige,
  identische Header teilen sich EINEN Roundtrip. Kein Zeit-Cache → die Sofort-
  Widerruf-Garantie der Schreibpfade bleibt (nur überlappende Prüfungen werden
  gebündelt, deren Ergebnis ohnehin gleich ist). Tests: `test_auth_coalesce.py`
  (4 Fälle inkl. distinct-header + sequential-not-cached + Exception-Propagation).
  **Zweite Ursache (Frontend-Robustheit):** `profile.reloadAll()`/`reloadTeam()`
  riefen die 5 `/me`-Sektionen OHNE error-Callback → ein transienter Auth-Fehler
  einer einzelnen Route wurde als **uncaught error** sichtbar. Jetzt fängt jede
  Sektion weich ab (behält ihren Stand, die übrigen laden normal). Damit bricht
  „Mein Bereich" nicht mehr ab, selbst wenn eine Auth-Prüfung mal zuckt.

**Folgeprüfung „weitere ähnliche Probleme?"** (systematischer Sweep):
- Backend-Hot-Paths **sauber**: `ranking`/`list_ideas`/`meta`/`/me/*`-Reads sind
  reine SQLite-Zugriffe, kein Per-Item-ES. Die Per-Item-ES-Loops
  (`_purge_tag_from_ideas`, Publication-Meta-Backfill, `group_members`,
  `bulk_move`, Sync-Diff-Walk, `_annotate_stale_status`) sind allesamt Mod-only
  Bulk-/Admin-Operationen, die jeden Knoten anfassen MÜSSEN — keine
  versteckte N+1.
- Frontend-Loop-Subscribes geprüft: `sortTopics` ist bereits **ein** Bulk-Call,
  Inbox-Counts sind bounded (3).
- **Taxonomie-Reorder N+1 behoben** (der oben notierte Minor-Fund): neuer
  `PUT /admin/taxonomy/sort` (`{kind, items:[{slug,sort_order}]}`) ersetzt die N
  Einzel-`upsertPhase/Event`-Calls beim ▲▼-Umsortieren durch EINEN. Schreibt
  **nur** sort_order (der frühere Voll-Upsert je Zeile konnte nebenläufige
  Label-/Status-Edits überschreiben — jetzt behoben) und loggt EINEN Aktivitäts-
  Eintrag statt N. Tests: `test_sort_taxonomy_*` (Reihenfolge, Nur-sort_order,
  Mod-Gate).

Gates: **185 pytest** (+9) grün · ruff clean · build:embed 0 Errors · ng lint
0 Errors (4 any-Baseline) · 16/16 FE-Tests.

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
