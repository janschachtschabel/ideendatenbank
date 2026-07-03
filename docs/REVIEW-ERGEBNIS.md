# Ergebnis: Abarbeitung des Programmierer-Reviews

Stand **2026-07-03** — jeder Punkt wurde gegen den aktuellen Code verifiziert
(Greps, Zeilenzahlen, Audits, Testläufe), nicht aus älterer Doku übernommen.

Legende: ✅ abgestellt · ⚠️ gemildert (Rest dokumentiert) · ⏸️ bewusst geparkt
(begründet) · ℹ️ bewusste Entscheidung (dokumentiert)

## Frontend

| # | Kritikpunkt (Review) | Status | Beleg / Was wurde getan |
|---|---|---|---|
| 1 | **Externe URLs & Calls (DSGVO-Blocker):** Google Fonts, api.qrserver.com, embed-demo | ✅ | 0 Treffer `fonts.googleapis/gstatic/qrserver` im gesamten Frontend. Fonts self-hosted (@fontsource), QR lokal (qrcode-generator) |
| 2 | **Generisches Angular-favicon** | ✅ | Marken-Icon (8,7 kB; Angular-Default wäre 15 086 B) |
| 3 | **Große Komponenten, keine HTML-Aufsplittung** (moderation 3661, idea-detail 2509, app-shell 1552, scss 1294, ranking 1019) | ✅/ℹ️ | Zerlegung in Sub-Components statt Datei-Split: moderation **3763→325** (alle 9 Tabs eigene Kinder), idea-detail **2544→1882** (report-modal, comment-thread, vote-box extrahiert), scss **1294→837** (Dead-CSS-Kehraus, 36 tote Klassen). app-shell (1525) + ranking (930) bewusst kohäsiv (Zustands-Netz bzw. eine Feature-Seite — begründet im CHANGELOG). Weitere Splits inkl. konkreter Re-Assess-Trigger dokumentiert |
| 4 | **Inline-Styles/Farbwerte in Templates** | ⚠️ | Sub-Component-Schnitt + Dead-CSS-Kehraus; Inline-Template/-Styles bleiben Stilmittel der jetzt kleinen Einheiten |
| 5 | **README.md in public/assets** | ✅ | entfernt (nach docs/) |
| 6 | **Angular 19 EOL** | ✅ | Angular **21.2** |
| 7 | **npm audit: 39 Vulns (1 crit, 21 high…)** | ✅/⚠️ | **Runtime/Bundle: 0/0/0/0.** Dev-Tooling nach `npm audit fix`: 10 (0 crit, 2 high) — Rest nur per `--force` (Breaking der Build-Kette) schließbar, betrifft ausschließlich `ng serve`; CIs gaten via npm audit + pip-audit |
| 8 | **Selbst gebaute HTTP-Aufrufe ohne Param-Encoding** | ✅ | `encodeURIComponent` durchgängig auf Pfad-Parametern |
| 9 | **Material nur als Theme, keine Komponenten** | ⏸️ | Paket noch installiert; Entfernung = eigener geplanter Schritt |
| 10 | **Kein Angular-Routing, harte Navigation** | ℹ️/⚠️ | Signal-Navigation ist die bewusste **Embed-Entscheidung** (Router würde Host-URLs kapern); Deep-Links/Share-URLs funktionieren über Query-Params. `setTimeout`-Hacks 8→4 (Deep-Links setzen View jetzt synchron) |
| 11 | **Doppelte Backend-Requests (/events, /meta)** | ✅ | In-Flight-Coalescing im ApiService + N+1-Topic-Zählungen → 1× `/meta` + neuer `/bootstrap`-Endpoint (Erststart in EINER Antwort). Live verifiziert: keine Dubletten, 27 User-Routen ≤ 106 ms |
| 12 | **Kein i18n** | ℹ️ | bewusst deutsch (rein deutsches Produkt) |
| 13 | **Hartcodierte Farben (643 / ~270 o. Fallbacks)** | ⚠️ | 643 → ~455 Roh-Vorkommen (Fossilien/Dead-CSS raus); Rest opportunistisch bei Berührung |
| 14 | **God-Komponenten (KI-Analyse)** | ✅/ℹ️ | s. #3 |
| 15 | **Kein Routing (KI-Analyse)** | ℹ️ | s. #10 |
| 16 | **Null Tests (~13.000 LoC ungesichert)** | ✅ | **155 Backend-Testfunktionen/26 Dateien (176 Fälle)** + **16 Frontend-Specs**, beide in **beiden CIs** (GitHub + GitLab). Fanden reale Bugs (u. a. Backup-Handle-Leak → Restore-Korruption auf Windows) |
| 17 | **Auth ohne HTTP-Interceptor** | ✅ | `authInterceptor` via `withInterceptors`; Garantie „Header nie an Fremd-Origin" per Spec gepinnt |
| 18 | **Credentials im sessionStorage (Basic, XSS-lesbar)** | ⚠️/⏸️ | Bleibt bis OAuth (extern blockiert: eduApp-Secret fehlt; Spike + Selbst-Test-Rezept in docs/AUTH-OAUTH-SPIKE.md). Strukturell begrenzt: Interceptor-Origin-Garantie, fail-closed Owner-Gating, **Login-Username erscheint nirgends mehr öffentlich** (Klarname/App-Profilname in Detail, Rangliste, Top-Steigern) |
| 19 | **Schwache Typisierung (92× any)** | ⚠️ | Alle sicher lösbaren typisiert (Comment, Topic.sort_order, Idea-Helfer, HttpErrorResponse …); verbleibende **88** Lint-Warnings liegen an der dynamischen edu-sharing-Grenze — bewusst nicht force-typisiert (erfundene Interfaces würden über unzuverlässige Laufzeitformen lügen); Baseline sichtbar, 0 Errors |

## Backend

| # | Kritikpunkt (Review) | Status | Beleg / Was wurde getan |
|---|---|---|---|
| 1 | **routes.py-Monolith (~5.500 Zeilen)** | ✅ | Vollständig zerlegt: **775-Zeilen-Public-Read-Kern + 18 Domänen-Router** + routes_common.py. Beweis: 87 = 87 Routen (Methode+Pfad-Mengengleichheit) + AST-Symbolvergleich gegen Pre-Split-Backup. Weiterer Split bewusst nicht (eine Verantwortlichkeit; Trigger dokumentiert) |
| 2 | **sync.py grenzwertig (~900)** | ⏸️/⚠️ | Split offen (912 Z.); intern restrukturiert: fetch-then-write (kein DB-Lock über Netz-Awaits), `asyncio.to_thread` für SQLite in async-Routen — **AST-Blocking-Audit: 0 Funde** |
| 3 | **Ratelimit ohne Effekt bei Kubernetes** | ℹ️ | Bewusster Single-Instance-Betrieb (SQLite + In-Memory) — dokumentiert, Bedingung „keine Clusterfähigkeit" gilt |
| 4 | **Keine Depends()-Schicht** | ℹ️ | Bewusst dokumentierte Konvention (docs/KNOWN-LIMITATIONS.md): Auth-Header wird in ~67 Routen an edu-sharing durchgereicht — Depends() würde verschieben, nicht reduzieren. „Eine Quelle der Wahrheit" über auth.py erreicht; Owner-Gating **fail-closed** gehärtet |
| 5 | **Keine Auth-Middleware / jede Route gated selbst** | ⚠️ | s. #4; MOD_ONLY-Auth-Denial per parametrisierter Testmatrix abgesichert (jede geschützte Route getestet) |
| 6 | **Kein eigenes Auth-Modul** | ✅ | `app/auth.py` (217 Z.) |
| 7 | **Mod-Check = Live-ES-Call pro Request** | ✅ | Mod-Status-Cache (60 s TTL, SHA-256-Key). Zusätzlich: Detailseite im Warmbetrieb **0 Live-ES-Calls** (Voll-Cache für Rating/Owner/Kommentare/Anhänge mit Count-/TTL-Invalidierung) |
| 8 | **bool vs. throw inkonsistent** | ⚠️ | Prädikate (bool) zentral in auth.py; werfende Varianten bewusst am Routen-Rand; dokumentiert |

## Allgemein & Perspektivisch

| Punkt | Status | Beleg |
|---|---|---|
| Englische Code-Kommentare | ℹ️ | Projekt bleibt deutsch; opportunistisch |
| Nicht clusterfähig | ℹ️ | bewusst + dokumentiert (s. o.) |
| OAuth statt Basic | ⏸️ | Spike fertig; extern blockiert (eduApp-client_secret fehlt) |
| Generierter API-Client | ⏸️ | Backlog — würde dokumentierte edu-sharing-Workarounds (Rating-Schein-500, Publish-ACL-Merge, Comment-Escape) reaktivieren |
| Sync-Skalierung / Repo-Last / „keine doppelte Datenhaltung" | ✅/ℹ️ | Voll-Sync nur noch **nächtlich** + Refresh-on-Write + schlanker propertyFilter + Anhang-Scan 1/4; Detailseite 0 Live-Calls warm. SQLite bleibt bewusster Cache (FTS-Suche, Decay-Ranking, Resilienz) — dokumentiert |

## Bilanz

- **Alle Blocker und Kritisch-Punkte des Reviews sind abgestellt** (DSGVO, EOL-Framework, npm-Runtime-Vulns, fehlende Tests, Interceptor, Encoding, Monolithen, Mod-Check-Latenz).
- **⚠️-Punkte** sind strukturell gemildert und mit Restzustand dokumentiert (sessionStorage-Basic bis OAuth, any-Baseline an der ES-Grenze, Farben, Inline-Styles).
- **⏸️/ℹ️-Punkte** sind bewusste, begründete Entscheidungen mit definierten Re-Assess-Triggern (Material-Entfernung, sync.py-Split, OAuth, generierter Client, kein Router im Embed, i18n, Single-Instance).

**Verifikation (2026-07-03):** pytest grün (EXIT 0; 155 Funktionen/176 Fälle) ·
ng lint 0 Errors (88-Warning-Baseline) · build:embed EXIT 0 · 16/16 FE-Tests ·
Live-Sweep aller 27 anonymen User-Routen ≤ 106 ms · Parallel-Bursts ohne
Blocking · Runtime-npm-audit 0 Vulnerabilities.
