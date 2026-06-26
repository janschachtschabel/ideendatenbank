# Changelog

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
- **Bugfix Ranglisten-Skala im Daumen-Modus:** Die Top-3-Balkengrafik der
  Ranglisten-Seite begrenzte den Skalen-Maximalwert auf `Math.max(1, …)`. Bei
  Daumen-Verfallswerten < 1 (z. B. 0,91) sprang die Skala dadurch auf „1" und der
  oberste Balken erreichte nie 100 %. Jetzt wird der echte Spitzenwert angezeigt
  (Nenner nur gegen Division-durch-0 abgesichert) — konsistent zur Trend-Box auf
  den Event-Seiten (`rank-trend`).

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
- ⏸️ God-Komponenten / Inline-Template+Styles / kein HTML-CSS-Split → **Phase 3** (durch das Test-Netz jetzt risikoarm machbar)
- ⏸️ Hartcodierte Farben (643/~270) → Phase 3 (opportunistisch)
- ⏸️ Kein Routing / `setTimeout`-Hacks → **Phase 2b** (NavigationService); die Hacks sind nach dem Zone-Fix funktional redundant
- ⏸️ Doppelte Requests (`/events`, `/meta`) → Phase 3
- ⏸️ Schwache Typisierung (`any`, ~92) → opportunistisch bei Berührung
- ℹ️ Material nicht genutzt → Entfernung geplant (Phase 3b) · ℹ️ i18n → bewusst zurückgestellt (rein deutsches Produkt)

**Backend**
- ✅ Kein eigenes Auth-Modul → `app/auth.py`
- ✅ Kein Mod-Status-Cache → 60-s-TTL-Cache (beseitigt den Live-ES-Call pro geschütztem Request)
- ⚠️ `bool` vs. `throw` inkonsistent → Prädikate (bool) zentral in `auth.py`; `_require_moderator` (throw + Audit) bewusst in `routes.py`; dokumentiert
- ⚠️ Kein `Depends()`-Layer → **bewusst nicht erzwungen**: der Auth-Header wird in **67 Routen** an edu-sharing weitergereicht → `Depends()` würde Code verschieben statt reduzieren. Ziel „eine Quelle der Wahrheit" ist über `auth.py` erreicht. Begründung in `docs/KNOWN-LIMITATIONS.md`.
- ⏸️ `routes.py` monolithisch (~5.500) → Router-Split = Phase 3 (auth.py ist der erste Schnitt)
- ⏸️ `sync.py` (~900) Split → offen
- ℹ️ Ratelimit/Cluster (SQLite + lokale Session) → bewusster Single-Instance-Betrieb, dokumentiert

**Allgemein & perspektivisch**
- ⏸️ OAuth statt Basic → Spike erledigt, **admin-blockiert** (`eduApp`-`client_secret` fehlt); geparkt inkl. Selbst-Test-Rezept (`docs/AUTH-OAUTH-SPIKE.md`)
- ⏸️ Generierter API-Client statt `EduSharingClient` → Backlog (würde dokumentierte Workarounds reaktivieren)
- ⚠️ Sync-Skalierung / Repo-Last bei Children-Endpunkten → heute ~4–7× reduziert (Intervall/Filter/Anhang-Scan); der große Hebel (Suche statt Tree-Walk) ist als **Team-Frage** geparkt (`docs/EDU-SHARING-ZUSAMMENSPIEL.md`). „Keine doppelte Datenhaltung": der SQLite-Mirror ist bewusster Cache (FTS, Decay-Ranking), dokumentiert.
- ℹ️ Englische vs. deutsche Kommentare → Projekt bleibt deutsch (opportunistisch)
