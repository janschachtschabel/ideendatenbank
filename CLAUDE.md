# 📌 Aktueller Architektur-Stand (Stand 2026-04-29, Nachmittag)

Dieser Block ist die **gültige Spezifikation**. Die Sektionen weiter unten
(„Hier sind erste Gedanken zur Umsetzung", „Anmerkungen zum POC" usw.)
dokumentieren die historische Konzeptphase und sind teils überholt — sie
bleiben aus Nachvollziehbarkeitsgründen erhalten.

## Datenmodell — eine Idee = ein Inhalt

| Knoten | edu-sharing Typ | Rolle |
|---|---|---|
| **Idee** | `ccm:io` | Selbst der Inhalt. Trägt Titel, Beschreibung, Phase/Event-Keywords, Kommentare, Rating, optional ein hochgeladenes Dokument oder einen externen Link (`ccm:wwwurl`). |
| **Anhänge-Sammlung** *(optional)* | `ccm:map` | Geschwister auf gleicher Sammlungs-Ebene zur Idee. Wird nur dann angelegt, wenn der/die Einreichende weitere Dateien anhängen will. Kann nachträglich hinzugefügt werden. |

```
Themengebiet (ccm:map)              ← „Auffindbarkeit von OER"
└── Herausforderung (ccm:map)       ← „Zersplitterte Infrastruktur"
    ├── Idee A (ccm:io)             ← die Idee selbst
    ├── Idee A (Anhänge) (ccm:map)  ← optional, leer oder mit weiteren Dateien
    │   ├── mockup.pdf
    │   └── pitch-folie.pptx
    ├── Idee B (ccm:io)             ← weitere Idee, ohne Anhänge-Sammlung
    └── …
```

**Konvention für Anhänge-Sammlungen:**
- Name = Idea-Titel + Suffix `" — Anhänge"` (oder eindeutig erkennbarer Variant)
- Keyword `attachment-of:<idea-node-id>` → exakte Verknüpfung, sync-stabil

Das Backend cached die Beziehung; Detail-Anzeige listet die Anhänge der
Geschwister-Sammlung als zusätzliche Dokumente neben der eigentlichen
Idee-Datei (falls vorhanden).

**Begründung dieser Architektur:**
- Rating und Kommentare gehen edu-sharing-seitig nur an `ccm:io` — die Idee
  selbst ist `ccm:io`, also funktionieren beide Features sofort.
- Sammlungen tragen keine eigenen Engagement-Daten — sind hier nur Container
  für zusätzliches Material.
- Klare Permissions: Owner der Idee (= Einreicher) kann seine Idee und seine
  zugehörige Anhänge-Sammlung verwalten. Andere User können nur kommentieren
  und bewerten.

## Phase + Veranstaltung — kuratierte Taxonomien

Da edu-sharing keine eigenen Felder dafür hat, werden sie über Keywords mit
Slug-Präfix abgebildet:

- `phase:<slug>` (z.B. `phase:ausarbeitung`)
- `event:<slug>` (z.B. `event:hackathoern-3`)

Die erlaubten Slugs werden im Backend in zwei SQLite-Taxonomie-Tabellen
gepflegt (`taxonomy_phase`, `taxonomy_event`):

- **Default-Phasen** sind bereits vorgesehen: Anregung · Ausarbeitung ·
  Pitch-bereit · In Umsetzung · Abgeschlossen · Archiviert.
- **Veranstaltungen** legt das Projektteam über die Moderations-UI an
  (Slug + Anzeige-Label, aktiv/inaktiv-Toggle).
- Submit-Formular und Edit-Dialog bieten Dropdowns aus der Taxonomie —
  kein Freitext mehr.

## Rollen & Berechtigungen

| Rolle | edu-sharing-Sicht | Was sie tun darf |
|---|---|---|
| **Gast (anonym)** | App nutzt internen Service-Account (`WLO-Upload`) | Ideen einreichen → landet im Moderations-Postfach (zentrale Inbox-Sammlung). Kann lesen, suchen, filtern. |
| **User (eingeloggt)** | Eigenes Konto auf wirlernenonline.de | Idee direkt unter einer Herausforderung ablegen. Eigene Idee + eigene Anhänge-Sammlung erstellen, editieren, befüllen, löschen. Bewerten, kommentieren, mitmachen, folgen. |
| **Moderator/Admin** | Mitglied einer Moderations-Gruppe (z.B. `GROUP_ALFRESCO_ADMINISTRATORS`) | Alles vom User. Zusätzlich: Veranstaltungen + Phasen kuratieren, fremde Ideen bearbeiten/verschieben/löschen, Inbox abarbeiten, Sammlungen umstrukturieren. |

Die Rollen werden über die `iam/v1/people/-home-/-me-/memberships`-API
ermittelt. Schreibrechte enforced edu-sharing selbst über Owner+Permission;
unser FastAPI reicht den User-Auth-Header durch.

## Submit-Flow

1. Anonymer Submit (kein Login):
   - POST `/api/v1/ideas` → erzeugt `ccm:io` im Inbox-Ordner via Gast-Account
   - Moderator verschiebt später aus Inbox in Ziel-Herausforderung
2. Eingeloggter Submit:
   - POST `/api/v1/ideas` mit `Authorization`-Header → erzeugt `ccm:io`
     direkt unter der gewählten Herausforderung
   - Optional: Datei + Vorschaubild beim Anlegen mitschicken (Multipart)
   - Optional: Anhänge-Sammlung mitanlegen → POST `/api/v1/ideas/{id}/attachments`
     erzeugt die `ccm:map` als Geschwister mit Keyword `attachment-of:<id>`
   - Weitere Dateien: POST `/api/v1/ideas/{id}/attachments/files` (multipart)

## Was schon gebaut ist (Stand 2026-04-29)

### Backend
- ✅ FastAPI + SQLite-Cache + edu-sharing-Sync (alle 5 min, idempotent)
- ✅ **Sync-Mutex** (`asyncio.Lock`) — verhindert parallele Voll-Syncs/DB-Locks
- ✅ **Sync graceful failure**: einzelne 401/403/404-Knoten überspringen, Sync läuft weiter
- ✅ **Single-Node-Refresh** (`refresh_idea`) nach jeder Schreib-Aktion — kein Voll-Sync nötig
- ✅ Such-API mit Volltext-FTS5, Phase-/Event-/Kategorie-/Topic-/Q-Filtern
- ✅ Submit-Endpoint (anonym → Inbox; eingeloggt → direkt unter Herausforderung)
- ✅ **Mehrfach-Event** pro Idee (`events: string[]`, Backward-Compat zu `event`)
- ✅ Datei-Upload + Vorschaubild beim Submit/Edit (multipart)
- ✅ Anhänge-Sammlung anlegen / löschen + Datei in Sammlung uploaden / **umbenennen** / löschen
- ✅ Idee **löschen** / **duplizieren** (Auth-Passthrough → ES prüft Permission)
- ✅ **Owner-Edit-Gating**: `can_edit`/`can_delete` aus `accessEffective`
- ✅ **Cache-Miss-Fallback in `get_idea`**: frische Ideen werden live aus ES geholt + gecached
- ✅ **Problem melden** (POST `/ideas/{id}/report` + Mod-Liste + Resolve)
- ✅ Edit-Endpoint PATCH `/api/v1/ideas/{id}` (auth-passthrough, mit Mehrfach-Event)
- ✅ Detail-Endpoint mit Auth-Passthrough für Live-Reads (Comments, Attachments, node_metadata)
- ✅ Rating (PUT mit Schein-500-Workaround), Kommentare (mit Reply-to)
- ✅ Mitmachen + Folgen als App-eigene SQLite-Signale
- ✅ Moderations-Postfach (lesen, verschieben via `_move`, löschen) + **Bulk-Move**
- ✅ **Topic-CRUD** (anlegen / umbenennen / löschen / sortieren / Beschreibung / Vorschaubild)
- ✅ Phasen-/Event-Taxonomie (CRUD-Endpoints)
- ✅ **Trend-Ranking** mit Snapshot-Tabelle (rating/comments/interest × event/all),
  Delta + Sparkline-History, **1h-Throttling**, 60-Snapshots-Pruning (~2,5 Tage Tiefe)
- ✅ **Aktivitäts-Log** für Mods (alle Schreib-Aktionen, filterbar nach Action/Akteur/Zeitraum,
  CSV-Export, **90 Tage / 5000 Einträge Pruning**)

### Frontend (Angular Web Components)
- ✅ `<ideendb-app>`, `<ideendb-tile-grid>`
- ✅ Themen / Veranstaltungen / Rangliste / Browser / Detail / Submit / Moderation / Profil
- ✅ Mehrstufige Drill-Navigation (Themen → Herausforderungen → Ideen)
- ✅ QR-Code + Share-Link je Veranstaltung (Events-Drill-Down + Mod-UI)
- ✅ **Trend-Rangliste** mit Pfeilen (▲▼—✨), Sparklines, Top-5-Verlaufs-Chart
- ✅ Submit/Edit mit Mehrfach-Event-Chips
- ✅ Detail-Aktionen: Bearbeiten · Duplizieren · Löschen · Melden (alle gating-aware)
- ✅ Anhänge als Karten-Grid mit Download / **Umbenennen** / Löschen
- ✅ Quick-Edit Phase/Event inline im Detail
- ✅ **Restricted-Banner** für Anonyme bei privaten Ideen ("🔒 Diese Idee ist nicht öffentlich")
- ✅ **Mod-UI** mit 7 Tabs: Postfach (mit Bulk-Move-Bar) · Meldungen · Aktivität · Themen ·
  Veranstaltungen · Phasen · Moderator:innen
- ✅ Login-Dialog, sessionStorage-persistent, `/me`-cached

### Deployment
- ✅ Same-origin Deployment (FastAPI serviert `dist/embed/browser/`)
- ✅ Registrierung über externes wirlernenonline.de/register-Formular
  (eigener Endpoint deaktiviert wegen Server-seitigem 50s-Timeout-Bug)

## Offene Punkte

- ⏳ **Service-Account-Rechte aufräumen**: `WLO-Upload`-Gast hat
  `GROUP_ALFRESCO_ADMINISTRATORS`. Code-Härtung (Auth-Passthrough +
  Sync-Resilience) ist fertig — Server-Policy-Frage, wartet auf Konfig-Fix
  (Inbox-Write-Recht + public-readable Themen).
- ⏳ **User-Activity-Feed**: „Was hat sich an Ideen, denen ich folge, getan?"
  Datenbasis (`activity_log`) liegt — UI fehlt.
- ⏳ **E-Mail-Benachrichtigungen** bei Kommentar/Status-Änderung (ES-SMTP-Hook hängt)
- ⏳ **Phase-Status-Workflow**: Restriktion (z.B. nicht von „Abgeschlossen" zurück)
- ⏳ **Bessere Such-UX**: Volltext-Highlights, Vorschläge bei 0 Treffern, Suchhistorie
- ⏳ **Idee-Export** (PDF/Markdown für Pitch-Decks)
- ⏳ **CSV-Export der Ranglisten** für Workshop-Auswertungen
- ⏳ **Statistik-Dashboard** für Mods (Phasen-/Event-Verteilung, neue/Woche)
- ⏳ **Mehrsprachigkeit (DE/EN)**
- ⏳ **SSO/OAuth** im Frontend (heute nur HTTP-Basic; ES-seitig Google möglich)
- ⏳ **„Ich habe eine ähnliche Idee"-Button** (Spezial-Kommentar-Typ)
- ⏳ **Mobile-Optimierung** Detail-Aktions-Sidebar als Bottom-Sheet

## Bekannte Server-Bugs (siehe `project_staging_bugs.md`)
- ⚠️ DELETE `/node/{id}/rating` → 500 (Workaround: nur Überschreiben)
- ⚠️ GET `/feedback` → 500 (Read-Pfad nicht nutzbar)
- ⚠️ Comments-403 für reguläre User auf manche Nodes (Tool-Permission-Frage)
- ⚠️ `/register/v1/register` SMTP-Hook hängt 50s

## Doku-Schulden
- 📋 Deploy-Doku (Build-Script, Static-Hosting-Pfad, sessionStorage-Persistenz)
- 📋 README.md (Quickstart + Architektur-Diagramm)
- 📋 `.claude/skills/*` aktualisieren (Trend-Ranking, Activity-Log, refresh_idea, Topic-CRUD)

---

# 📜 Ursprüngliche Konzept-Notizen (historisch)

> ⚠️ Die folgenden Sektionen sind die ursprüngliche Brainstorming- und
> Konzeptphase. Wo sie der oben stehenden Architektur widersprechen,
> gilt **die obere Spezifikation**. Sie bleiben für die Nachvollziehbarkeit
> der Entscheidungswege erhalten.

---

Ziel ist es eine Ideedatenbank für das HackathOERn Projekt zu erstellen. Diese soll es ermöglichen, eigene Ideen einzureichen, gemeinsam mit anderen Interessierten daran zu arbeiten und diese bei einem HackathOERn Event vorzustellen, um eventuell Hilfe/Förderung für die Umsetzung zu bekommen.

Die App soll aus einem FastAPI Backend bestehen und Angular Webkomponenten für die Hauptapp und eventuell weitere kleine Komponenten für Drittseiten z.B. die Ideenansichten. die daten sollen in der fastapi gepuffert und schnell ausgeliefert werden. bei manchen Arbeitsschritten wie z.b. dem Rating sind auch noch Berechnungen notwendig. es sollte eine suche geben - ob dafür eine SQL Datenbank wie z.b. SQLite und/oder eine Vektordatenbank wie z.b. sqlite-vector zum Einsatz kommen must Du entscheiden.

Im Hintergrund muss das Backend mit der edu-sharing Software zusammenarbeiten, in der die Ideen abgelegt werden, das Rating stattfindet und die Benutzer verwaltet werden. Zugriff auf die Dienste kann man mittels einer RestAPI nehmen, die wir z.T. schon in den Skills dokumentiert haben.

DAs Design der Haupt-Webkomponente in Angular und den Nebenkomponenten soll sich an der Webseite: https://wp-test.wirlernenonline.de/home/ orientieren mit Dunkelblau, hellgrau weiß und optisch ansprechend für den Bildungsbereich designt werden.
Es können Google Material Elemente V3 verwendet werden. Die Haupt-Webkomponente für die App kann auf dem Bildschirm viel Platz einnehmen. Die kleinen ergänzenden Webkomponenten z.b. für die Ausspielung der Kacheln der Idee eher weniger. 

Prinzipiell sollen User sich registrieren und dann einen normalen user Account nutzen. es soll aber auch einfache Funktionen geben wie z.b. die ideeneinreichung die ohne Anmeldung möglich sein könnten. vielleicht prüfen wir dafür den gast Account, den wir für Inhalte Uploads im browser Plugin verwendet haben.

Je Idee soll eine (Untersammlung) in einem Thema angelegt werden, damit man später auch weitere Materialien im gleichen Ordner ablegen kann. je Idee ist mind. ein Inhalt notwendig indem die wichtigsten Infos gespeichert werden.

neben der Strukturierung über themen-Sammlungen soll auch eine Sortierung über Veranstaltungen möglich sein - entweder als Sammlung oder mit tags (Keywords). auch ein Status soll integriert werden. da es aktuell noch kein statusfeld im edusharing gibt - sollte man überlegen auch hier Keywords zu verwenden und dann im backend zu filtern. 

es sollte eine hübsche Startseite mit kacheln der Idee geben - sortier Möglichkeiten nach änderungs oder erstellungsdatum, damit man updates und neue Ideen sofort sieht - aber auch eine Filterung nach Veranstaltungen.
Auch Bewertungen / Ratings und Kommentare sind spannend. Die Kommentarfunktion könnte beworben werden um sich für Ideen einzuschreiben oder Kontakt herzustellen.

Falls umsetzbar sollten auch die Userregistrierung, inhalteerstellung und Einsortierung direkt in der app möglich sein. es sollte gute Dialoge geben. auch moderations Interaktionen für das Team müssen mitgedacht werden u.a. löschen, verschieben, moderieren und ändern.

Es muss immer eine einfache Mitmachmöglichkeit mitgedacht werden. Bei Bedarf liefere ich Dir Wissen nach zu den API nach. Du kannst auch https://redaktion.openeduhub.net/edu-sharing/swagger/ lesen.


Die APP soll an die Produktivumgebung von Wirlernenonline angebunden werden.

Die Sammlungen der Ideen sind unter Sammlung: https://redaktion.openeduhub.net/edu-sharing/components/collections?id=4197d4d2-c700-400c-97d4-d2c700900c68&scope=TYPE_EDITORIAL zu finden   Node ID = 4197d4d2-c700-400c-97d4-d2c700900c68

das Repo mit dem wir arbeiten Produktiv umgebung:  https://redaktion.openeduhub.net 

ein Gast Account gibt es - uploads landen allerdings in einem bereich der erst von admins freigegeben werden muss. 

        inboxId: '21144164-30c0-4c01-ae16-264452197063',
        username: 'WLO-Upload',
        password: 'wlo#upload!20'

könnte sein das der wlo upload user nur staging ist und nicht auf der prod geht



Hier sind erste Gedanken zur Umsetzung:

Technische Umsetzung - Abstimmung



Von Jan Schachtschabel

Anhören

4

Eine Reaktion hinzufügen
Numbered Headings
Numbered Headings
Smart Designer
Smart Designer
App-SymbolScroll page details

Weniger anzeigen
1. Vision
2. Datenmodell
2.1 Strukturvarianten
2.2 Persistierung: Eigenes Metadatenset
2.3 Sammlungsstruktur
3. Was edu-sharing liefert
Offene Punkte (Testen mit Torsten)
4. Was die Webkomponente liefern muss
5. Funktionen-Übersicht: Wer liefert was?
6. Ansichten im PoC
6.1 Startseite
6.2 Ideen-Browser (Listenansicht)
6.3 Detailansicht einer Idee
6.4 Themen-Übersicht
6.5 Veranstaltungs-Übersicht
6.6 Einreichungsformular
7. Funktionen nach Rolle
Ohne Login (Gast)
Mit Login (Community)
Projektteam (Admin/Moderation)
8. Backend: Ja oder Nein?
9. Nächste Schritte
Anmerkungen zu Edu-Sharing Funktionen
Persistierung
Sammlungen 
Rating
Kommentare
Suche bzw. ggf Inhalte-Teaser ? 
Anwendung in den edu-sharing Kontext bringen
Anmerkungen zum POC (Jason)
🧭 Ansichten (Seiten)
🧩 Wie Inhalte aussehen
Ideenkarte (Listenansicht)
Detailansicht einer Idee
⚙️ Zentrale Funktionen
Für alle (ohne Login)
Für eingeloggte Nutzer
Für Admins
🔎 Filter & Entdecken
🔐 Auth & Zugriff
🎨 UX & Darstellung
🧠 Kurzfazit
1. Vision
Technisch umgesetzt als Angular-Webkomponente auf einem edu-sharing-Repository — möglichst viel nachnutzen, möglichst wenig selbst bauen.

Leitmetapher: Ideen-Garten — Ideen werden gesät (auch als Einzeiler), von der Community gepflegt und wachsen über mehrere Phasen, bis sie reif für die Umsetzung sind.

Phasen:

Anregung → Ausarbeitung → Ideen-Pitch → Hackathon → Prototyp → Förderung → Produkt

Die Ideendatenbank deckt die ersten drei Phasen ab. 

2. Datenmodell
2.1 Strukturvarianten
Idee A — Objekt als Idee (empfohlen für PoC)



Sammlung: Themengebiet (z.B. „Auffindbarkeit von OER")
  └── Untersammlung: Herausforderung (z.B. „Zersplitterte Infrastruktur")
        └── Inhaltsobjekt = eine Idee (mit eigenem MDS)
Idee B — Sammlung als Idee (Alternative)



Sammlung: Themengebiet
  └── Sammlung = eine Idee (mit Themenseite)
        ├── Dokument 1 (Mockup, PDF…)
        └── Dokument 2 (Pitch-Folie…)
Vergleich:

Kriterium

A: Objekt als Idee

B: Sammlung als Idee

Rating / Kommentare

Direkt am Objekt nutzbar

Auf Sammlungen? Testen

Mehrere Dateien pro Idee

Nur über Anhänge/Verknüpfungen

Natürlich (Kinder der Sammlung)

Themenseite pro Idee

Nicht automatisch

Ja — Sammlung hat eigene Seite

Suche / Inhalte-Teaser

Standard-Suche liefert Objekte

Sammlungen in Suche? Testen

Workspace-Workflow

Objekt → Veröffentlichen

Ordner → Inhalte-Teaser zur Anzeige möglich

Rechte-Handling

Einfach (Objekt-Rechte)

Komplexer (Sammlungs- + Kind-Rechte) — klären

Einfachheit

Einfacher

Aufwändiger

Entscheidung: Idee A für den PoC. Ein File pro Idee reicht zunächst. Falls später pro Idee mehrere Dateien gebraucht werden, kann auf B umgestellt oder ein Hybrid gebaut werden.

2.2 Persistierung: Eigenes Metadatenset
Ideen werden als normale edu-sharing-Objekte gespeichert, mit einem eigenen Metadatenset (MDS). Das Datenmodell ist bewusst schlank. Das Beschreibungsfeld (Rich Text) trägt den Großteil der inhaltlichen Informationen. Separate Felder gibt es nur dort, wo sie für Filterung, Sortierung oder automatische Anzeige gebraucht werden.

Feld

Typ

Pflicht

Bemerkung

Titel

Text

Ja

Kurzname der Idee (5–150 Zeichen)

Vorschaubild

Bild

Nein

Thumbnail für Kachelansicht

Beschreibung

WYSIWYG

Nein

Hauptfeld: Problem, Lösungsansatz, Ziel, Nutzen, benötigte Ressourcen — alles in einem Freitext. Leitfragen als Platzhalter geben Orientierung.

Kategorie(n)

Tags

Nein

Themengebiet zur Filterung

Keywords

Tags

Nein

Freie Schlagwörter

Phase

Enum

Ja (auto)

Anregung · Ausarbeitung · Pitch-bereit · In Umsetzung · Abgeschlossen · Archiviert

Eingereicht von

Text

Nein

Name/Kontext, z.B. „Teilnehmer:in OER-Camp 2025"

Ansprechpartner

Text

Nein

Kontaktperson für Rückfragen

Link zum Projekt

URL

Nein

GitHub, Prototyp, externe Referenz

Interner Kommentar

Text

Nein

Nur für Projektteam sichtbar → Recht auf Feldebene

Datum (Create)

Timestamp

Ja (auto)

Erstellungsdatum

Datum (Update)

Timestamp

Ja (auto)

Letzte Änderung

Hinweis zum Beschreibungsfeld: Statt vieler separater Felder (Problem, Ziel, Lösungsansatz, Ressourcen, Nächste Schritte …) werden diese Aspekte als Leitfragen im WYSIWYG-Editor angeboten. So bleibt die Einreichung niedrigschwellig — ein Einzeiler reicht — und die Struktur wächst mit der Ausarbeitung.

2.3 Sammlungsstruktur
Struktur 1 — Nach Thema (primär):



Ideendatenbank (Root-Sammlung)
├── Auffindbarkeit von OER
│   ├── Zersplitterte Infrastruktur
│   │   ├── Idee: Zentrale OER-Datenbank
│   │   └── Idee: Interoperable Metadatenstandards
│   └── Fehlende Metadatenstandardisierung
│       └── Idee: …
├── Barrierefreiheit
│   └── …
└── Qualitätssicherung
    └── …
Struktur 2 — Nach Veranstaltung (ergänzend):



HackathOERn Workshops (Root-Sammlung)
├── HackathOERn #1 (März 2025)
│   ├── Idee: …  (Verlinkung)
│   └── Idee: …
├── HackathOERn #2 (Herbst 2025)
│   └── …
└── OER-Camp 2025
    └── …
Eine Idee kann in beiden Strukturen auftauchen — über edu-sharings Sammlung-Verlinkung (ein Objekt in mehreren Sammlungen referenziert, keine Duplikate).

3. Was edu-sharing liefert
Bestätigte und nachnutzbare Funktionen, die nicht selbst gebaut werden müssen.

Funktion

Was edu-sharing liefert

Nutzung in der Ideendatenbank

Authentifizierung

Login via Google OAuth oder lokaler Account. Session/Cookie-basiert — funktioniert bereits.

Direkt nutzen, kein eigenes Auth-System.

Benutzerverwaltung

Registrierung, Rollen, Gruppen

Projektteam = Gruppe mit Sonderrechten (Admin/Moderation)

Sammlungen

Hierarchische Struktur, Beschreibung, Vorschaubild

Themengebiete + Herausforderungen + Events abbilden

Inhalte (Nodes)

CRUD über REST-API, Metadaten, Vorschaubilder

Jede Idee = ein Node mit eigenem MDS

Metadatenset (MDS)

Eigene Feldsets definierbar, Validierung, Feldrechte

Ideen-MDS mit den oben definierten Feldern

Rating

1–5 Sterne, Anzahl + Durchschnitt

Bewertung von Ideen. Testen: Anzeige ohne Login? Benutzerrechte?

Kommentare

Threaded, nur mit Login

Diskussion unter Ideen. Testen: Welche Rechte nötig?

Suche

Volltextsuche über Metadaten, Facetten-Filter

Freitextsuche + Filter nach Kategorien/Tags

Inhalte-Teaser

Kachel-Rendering mit Vorschaubild, Titel, Metadaten

Basis für die Kachelansicht der Ideen

Sammlung-Verlinkung

Ein Objekt in mehreren Sammlungen referenziert

Idee erscheint in Themen- UND Event-Sammlung

Rechte auf Feldebene

Felder nur für bestimmte Gruppen sichtbar/editierbar

Interner Kommentar nur für Projektteam

Workspace

Persönlicher Arbeitsbereich → Veröffentlichung

Ideen-Entwurf → Freigabe durch Projektteam

Offene Punkte (Testen mit Torsten)
Rating: Anzeige ohne Login möglich? (ja - über Metadaten); Funktioniert Rating auf Sammlungen zuverlässig? Benutzerrechte für Rating?

Derzeit technisch auf ccm:io beschränkt



if (!Objects.equals(nodeType, CCConstants.CCM_TYPE_IO)) {
    throw new IllegalArgumentException("Ratings only supported for nodes of type " + CCConstants.CCM_TYPE_IO);
}
Permissions hängen an allen Objekten (ccm:rating) + Toolpermissions

Vermutlich Umbau mit Test ca. 4h

Kommentare: Welche Rechte sind nötig zum Lesen/Schreiben?

Gehen derzeit auch nur an ccm:io

Ist im Alfresco nur als childassoc an ccm:io

Permissions hängen an allen Objekten (ccm:rating) + Toolpermissions

Es müsste ggf. verifiziert werden das alle getChildren Endpunkte für Sammlung, Suche etc. auch die Kommentare filtern!

Gesamt ca. 1PT

Suche: Sortierung nach modifiedAt möglich? Sortierung nach Rating über API?

ModifiedAt kann sortiert werden

Rating geht von außen nicht

Soweit ich das sehen kann geht das auch noch gar nicht über die MongoDB und nutzt die alten Objekte (die es gar nicht mehr gibt) => https://scm.edu-sharing.com/edu-sharing/community/repository/edu-sharing-community-repository-plugin-elastic/-/blob/acc46da6bd503affe628c44a389c615de3cdb912/tracker/src/main/java/org/edu_sharing/elasticsearch/elasticsearch/core/WorkspaceService.java#L592 @Daniel Rudolph ?

Wir haben ein Feld statistic_RATING_null für die Rating über Gesamtzeit sowie die letzten X-Tage (Tracker Config) - letzteres müsste aber per Script aggregiert werden

Umbau für Mongo + Feld zur Sortierung nutzen: 2PT? (@Daniel Rudolph )

Sammlung-Verlinkung: Workflow zum Verlinken eines Objekts in eine zweite Sammlung?

Was genau ist hier gemeint? Sammlungen in eine andere Sammlung legen? Ein Objekt in 2 Sammlungen geht ja @Matthias Hupfer 

Workspace: Wie läuft der Veröffentlichungs-Workflow konkret?

Ist hier dokumentiert: 
Ist-Stand Dokumentation Workflow, Aufgaben (edu + WLO), Material-Status (WLO)
 

Rechte allgemein: Rechte-Handling bei Objekten, Sammlungen, Feldebene — was muss konfiguriert werden?

Bräuchte ich noch etwas mehr Details was die konkrete Frage ist slightly smiling face @Matthias Hupfer 

UX Zugang: Wie kommt jemand von außen zur App und zum Login? Registrierungsworkflow prüfen.

Derzeit ist ein SSO via externe Anbieter (z.B. Google) grundsätzlich konfigurierbar (11.0)

In der es-App müsste Nutzer dennoch zunnächst Repo wählen → Auf Login Screen dann das Google Login icon wählen → Wird dann zu einem Google Login geleitet (hier gibt es z.t. Probleme das der Browser bei Autocomplete der Nutzerdaten Warnungen ausgibt)

 

4. Was die Webkomponente liefern muss
Alles, was edu-sharing nicht mitbringt, wird als Angular-Webkomponente gebaut.

Feature

Warum nötig

Umsetzung

Ideen-Startseite

Kein Landing-Page-Konzept in edu-sharing

Custom-Komponente: Hero + CTA + Grid mit neuesten Ideen + Einstiegspunkte z.B. für Beteiligung

Kachelansicht mit Badges

Phase/Status nur Metadatenfeld, keine spezielle UI

Karten-Grid mit farbigen Phase-Badges, Rating-Anzeige (Punktzahl, Anzahl Wertungen), Kommentaranzahl

Sortierung „Beste Bewertung"

edu-sharing-Suche sortiert nicht nach Rating

Ideen laden, client-seitig nach Rating sortieren (oder API-Parameter testen)

Sortierung „Letzte Updates"

Standard ist nach Erstellung

Sortierung nach modifiedAt in der API-Abfrage

Sortierung „Meiste Kommentare"

Kommentar-Anzahl kein Sortierkriterium

Kommentaranzahl pro Idee abfragen, client-seitig sortieren

Einreichungsformular

Standard-MDS-Editor nicht niedrigschwellig genug

Eigenbau: Custom-Formular mit Leitfragen als Platzhalter. Daten werden über die API als Node gespeichert.

Phasen-Filter

Kein nativer Filter nach Phase

Filter-Chips in der Listenansicht

Event-Zuordnung

Kein natives Konzept für Veranstaltungen

Idee in Event-Sammlung verlinken; optional Feld „Herkunft" im MDS

Idee teilen

Keine Share-Funktion in Standard-UI

Button mit navigator.clipboard.writeText(url)

Problem melden

Kein Melde-Mechanismus

Button → E-Mail an Redaktion oder Flag im MDS

Mail an Redaktion bei Einreichung

Kein automatischer Benachrichtigungsdienst

Stufe 1: Manuell (Moderations-Queue prüfen). Stufe 2: Webhook/Mail falls Backend vorhanden.

Menüpunkt „Ideen-DB"

Muss in edu-sharing-Navigation eingebunden werden

Konfiguration im edu-sharing-Frontend oder Custom-Routing

5. Funktionen-Übersicht: Wer liefert was?
Gesamtübersicht aller Funktionen mit klarer Zuordnung.

Funktion

edu-sharing

Webkomponente (Eigenbau)

Login / Session

✅ Google OAuth, lokaler Account, Session/Cookie

—

Benutzer & Gruppen

✅ Registrierung, Rollen, Gruppen

—

Ideen speichern (CRUD)

✅ Node-API + eigenes MDS

—

Ideen-Felder & Validierung

✅ MDS-Konfiguration

—

Feldrechte (int. Kommentar)

✅ Rechte auf Feldebene

—

Rating (1–5 Sterne)

✅ Rating-API

—

Kommentare (threaded)

✅ Comment-API

—

Volltextsuche

✅ Search-API

—

Sammlungen (Themen/Events)

✅ Collection-API

—

Sammlung-Verlinkung

✅ Ein Objekt in mehreren Sammlungen

—

Workspace → Veröffentlichung

✅ Workspace-Workflow

—

Inhalte-Teaser (Kacheln)

✅ Teaser-Rendering als Basis

✅ Eigene Kacheln mit Badges, Kennzahlen

Startseite

—

✅ Hero + CTA + Grid mit Top-Ideen

Einreichungsformular

MDS-Editor vorhanden, aber nicht niedrigschwellig

✅ Custom-Formular mit Leitfragen

Sortierung nach Rating

Nicht in Such-API

✅ Client-seitig

Sortierung nach Kommentaren

Nicht in Such-API

✅ Client-seitig

Sortierung nach Änderungsdatum

Testen ob API das kann

✅ Fallback client-seitig

Phase-Badges (farbig)

Nur Metadatenfeld

✅ UI-Darstellung

Phase-Filter

Facetten-Filter testen

✅ Filter-Chips

Idee teilen (Link)

—

✅ Clipboard-Button

Problem melden

—

✅ Button → Mail/Flag

Mail an Redaktion

—

✅ Manuell (Stufe 1), Webhook (Stufe 2)

Menüpunkt „Ideen-DB"

—

✅ Navigation/Routing

Detailansicht

Node + Rating + Kommentare via API

✅ Custom-Layout

Themen-Übersicht

Sammlungshierarchie via API

✅ Custom-Darstellung

Veranstaltungs-Übersicht

Event-Sammlungen via API

✅ Custom-Darstellung

6. Ansichten im PoC
6.1 Startseite
Hero-Bereich mit kurzer Erklärung und Call-to-Action („Idee einreichen"). Darunter ein Grid mit den neuesten Ideen (6–12 Kacheln). Einstiegspunkte zu Themengebieten und Veranstaltungen.

Datenquelle: Search-API (sortiert nach Erstellungsdatum), Collection-API für Einstiegspunkte.

6.2 Ideen-Browser (Listenansicht)
Karten-Grid mit Pagination oder „Mehr laden". Jede Karte zeigt Titel, Phase-Badge (farbig), Kurzbeschreibung (~150 Zeichen), Kategorie-Badges, Kennzahlen (Rating, Kommentaranzahl) und Autor + Datum.

Sortieroptionen:

Sortierung

Datenquelle

Neueste (Erstellungsdatum)

Search-API

Letzte Updates (Änderungsdatum)

Search-API (modifiedAt) — testen

Beste Bewertung

Ideen laden → client-seitig sortieren

Meiste Kommentare

Kommentaranzahl abfragen → client-seitig sortieren

Filteroptionen:

Filter

Datenquelle

Themengebiet

Sammlungsstruktur (Collection-API)

Phase

Facetten-Filter oder client-seitig

Freitextsuche

edu-sharing Volltextsuche (Search-API)

Tags/Keywords

Facetten-Filter (Search-API)

6.3 Detailansicht einer Idee
Vollansicht mit allen Feldern: Titel, Phase-Badge, Autor, Datum, Beschreibung (Volltext), Kategorie + Tags, Ansprechpartner, Link zum Projekt. Dazu Rating (mit Bewertungsmöglichkeit für eingeloggte Nutzer), Kommentarbereich (threaded) und Aktionen (Teilen, Problem melden).

Datenquelle: Node-API + Rating-API + Comments-API.

6.4 Themen-Übersicht
Anzeige der Sammlungshierarchie: Themengebiete → Herausforderungen. Jedes Thema zeigt Anzahl der enthaltenen Ideen. Klick führt zum Ideen-Browser, gefiltert auf das Thema.

Datenquelle: Collection-API.

6.5 Veranstaltungs-Übersicht
Liste der Event-Sammlungen (HackathOERn #1, OER-Camp …). Jede Veranstaltung zeigt die dort eingereichten/verlinkten Ideen.

Datenquelle: Collection-API.

6.6 Einreichungsformular
Custom-Formular (Eigenbau, kein Standard-MDS-Editor). Pflichtfeld ist nur der Titel. Beschreibung mit Leitfragen als Platzhalter (Problem? Ziel? Lösungsansatz?). Optionale Felder: Kategorie, Tags, Ansprechpartner, Link. Daten werden über die edu-sharing Node-API als Objekt mit dem Ideen-MDS gespeichert.

Datenquelle: Node-API (POST).

7. Funktionen nach Rolle
Ohne Login (Gast)
Ideen durchsuchen, filtern, sortieren

Detailseiten lesen

Rating und Kommentare sehen (Anzeige ohne Login — testen)

Idee teilen (Link kopieren)

Mit Login (Community)
Idee einreichen (Custom-Formular)

Eigene Ideen bearbeiten

Rating abgeben (1–5 Sterne)

Kommentieren (threaded)

Problem melden

Projektteam (Admin/Moderation)
Ideen freigeben / moderieren

Phase einer Idee ändern

Sammlungsstruktur verwalten (Themen, Events)

Interne Kommentare lesen/schreiben (Feldrecht)

Ideen in Event-Sammlungen verlinken

8. Backend: Ja oder Nein?
Für den PoC wird kein eigenes Backend gebaut. Die Webkomponente arbeitet direkt gegen die edu-sharing REST-API und nutzt die bestehende Session/Cookie-Authentifizierung. Das hält Deployment und Wartung einfach: ein Artefakt, ein System, eine Quelle der Wahrheit.

Einschränkungen ohne Backend:

Sortierung nach Rating/Kommentaren nur client-seitig (tragbar bis ~500 Ideen)

Keine automatische Mail an Redaktion bei Einreichung (manuell moderieren)

Kein Trending-Score (keine Historie)

Keine PollOER- oder HedgeDoc-Anbindung

Spätere Erweiterung mit Backend (z.B. FastAPI) wird sinnvoll, wenn Trending-Scores, automatische E-Mail-Benachrichtigungen, PollOER-Integration oder HedgeDoc-Anbindung gebraucht werden. Das ist kein Thema für den PoC.

9. Nächste Schritte
MDS anlegen: Eigenes Metadatenset für Ideen in edu-sharing konfigurieren (Felder siehe Abschnitt 2.2)

API testen (mit Torsten): Rating-Anzeige ohne Login, Rating-Benutzerrechte, Kommentar-Rechte, Sortierung nach modifiedAt, Sammlung-Verlinkung

Registrierungsworkflow prüfen: UX — wie kommt jemand von außen zur App und zum Login? (Google OAuth + lokal)

Rechte klären: Rechte-Handling bei Objekten, Sammlungen, Feldebene

Angular-Skeleton: Projekt aufsetzen, als Web Component bauen, in edu-sharing einbinden

Kachelansicht: Erste Ansicht mit Inhalte-Teasern aus der Search-API

Einreichungsformular: Custom-Formular mit Leitfragen (Eigenbau, nicht MDS-Editor)

Sammlungsstruktur: Themen- und Event-Sammlungen anlegen, Verlinkung testen

Menüpunkt: Ideen-DB in edu-sharing-Navigation integrieren

 

 

 

 

Anmerkungen zu Edu-Sharing Funktionen
User müssen sich Anmelden / 

mit Google oder local

? UX wie komme ich in die APP 

Idee A) 

Sammlung als Struktur

Objekt als Idee

Idee B)

Sammlung als Idee 

Objekte : Dokumente der Idee

? Rating und Kommentare @Torsten Simon 

Vorteil: Themenseite pro Idee 

Mehrere Dateien pro Idee

Workspace Nutzung → Ordner zur Veröffentlichung → Inhalte-teaser zur Anzeige 

Nachteil: ? 


Rechte ? 

Menüpunkt zur Ideen-DB

Anmelde / Registrierungsworkflow prüfen 

 

Persistierung
normale Objekte ? evtl. eigenes Metadatenset

Titel:

Vorschaubild

Beschreibung  WYSIWYG Feld

Ziel : xxx

Problem: xxx

Ansprechpartner: xxxx

Keywords

Status (offen, 

eingereicht von : Textfeld

Datum Create, Update

Link zum Projekt / Github ….

interner Kommentar des Teams: Textfeld → Recht auf Feldebene  

Sammlungen 
Kategorie der Idee → Untersammlung

Hackathoern Workshops

Sammlung-Verlinkung → zu Hackathoern Workshop 

Rating
1 bis 5 (Sterne)

mit Benutzerrechten  ? testen 

Kommentare
Liste letzte Änderung

Suche bzw. ggf Inhalte-Teaser ? 
 

Einreichen : neue Idee ? Formular  ? mds oder bau 

Mail an Redaktion ? Torsten

   ein File pro Idee

Anwendung in den edu-sharing Kontext bringen
Session / Cookie  Anmeldung funktioniert 

 

 

Anmerkungen zum POC (Jason)
🧭 Ansichten (Seiten)
Öffentlich:

Startseite: Hero + CTA + Grid mit 12 neuesten Ideen

Ideen-Browser (/ideas): Filter + Sortierung + Karten-Grid (Pagination)

Idee-Detail: Vollansicht einer Idee mit Interaktionen & Kommentaren

Kategorien: Übersicht + Detailseiten mit gefilterten Ideen

Hackathons: Übersicht + Event-Detail mit verknüpften Ideen

Eingeloggt:

Idee erstellen & bearbeiten

Profil-Dashboard (eigene, gefolgte, „will hacken“-Ideen)

Admin:

Kategorien, Hackathons verwalten

CSV Import/Export für Ideen

🧩 Wie Inhalte aussehen
Ideenkarte (Listenansicht)
Titel + Status-Badge (farbig)

Kategorien als Badges

Kurzbeschreibung (~150 Zeichen)

Autor + Datum

3 Kennzahlen: ❤️ Votes · 💬 Kommentare · 🤝 Mitmacher

👉 Kompakt, scannbar, Fokus auf schnelle Bewertung

Detailansicht einer Idee
Zweispaltig aufgebaut:

Links (Inhalt):

Titel, Autor, Status

Kategorien + Tags

Beschreibung (Volltext)

„Was wird benötigt“

Threaded Kommentare (bis 3 Ebenen)

Rechts (Sticky Sidebar):

▲▼ Voting (Score)

🔔 Folgen

🤝 Mitmachen

Avatare der Interessierten

👉 Fokus: Tiefe + Interaktion + Zusammenarbeit

⚙️ Zentrale Funktionen
Für alle (ohne Login)
Ideen durchsuchen, filtern, sortieren

Detailseiten & Kommentare lesen

Für eingeloggte Nutzer
Ideen erstellen, bearbeiten, löschen (eigene)

Voten (+1 / −1)

Folgen

„Ich will mitmachen“ (Hack-Interesse)

Kommentieren & Antworten (Threaded)

Für Admins
Kategorien & Hackathons CRUD

Ideen per CSV importieren/exportieren

Ideen mit Events verknüpfen

🔎 Filter & Entdecken
Kategorie-Filter (Dropdown)

Sortierung:

Neueste

Top bewertet

Meiste Mitmacher

Meiste Kommentare

Pagination („Mehr laden“)

❗ Nicht vorhanden: Freitextsuche, Tag-Filter

🔐 Auth & Zugriff
Login via GitHub OAuth oder E-Mail/Passwort

Geschützte Seiten: Erstellen, Profil, Admin

Rollen: Gast / User / Admin

🎨 UX & Darstellung
Komplett auf Deutsch

Farbcodierte Status-Badges

Kategorie-Farben (individuell)

Icons für Interaktionen (❤️ 💬 🤝 etc.)

Responsives Karten-Grid

Optimistische UI (sofortige Updates bei Klicks)

🧠 Kurzfazit
Der PoC ist im Kern eine Ideen-Plattform mit Social- und Kollaborations-Features:

Erfassen & strukturieren von Ideen

Bewerten & diskutieren (Votes + Kommentare)

Interesse & Zusammenarbeit sichtbar machen (Follow + Hacken)

Kontext durch Kategorien & Events

👉 Stark in: Ideen sammeln, sichtbar machen, erste Kollaboration
👉 Schwächer in: Suche, Team-Building, Reifegrad-Tracking



hier nochmal die alten konzepte:
Status quo: 
Bislang wird Redaktionsumgebung genutzt: https://wirlernenonline.de/portal/sonstiges-hackathoer-ideensammlung/ 

Verschiedene Ebenen werden versucht durch Sammlungen und Untersammlungen abzubilden

Herausfordernd: Interaktionen (Liken, Kommentieren etc.), niedrigschwelliger Zugang besonders zentral, für ad hoc Ideensammlungen, Berücksichtigung versch. Nutzer*innengruppen und jeweilige Rechte.

Ziel der Datenbank:
Sammlung und Bündelung von Herausforderungen und Ideen zu bestimmten Themenbereichen (Themenbereiche wurden auf Basis gesammelter Erfahrungen formuliert und durch Kooperation mit MOERFI und Community-Feedback ergänzt)

Inititalbefüllung mit Ideen aus Hackathon #1, Workshops bei Konferenzen etc.

Wachsen und Befüllen durch die Community und Stakeholder, ergänzt durch Aktivitäten des Projektteams

Herausforderungen und Ideen sollen aus der Community heraus kommen

Interaktion ermöglichen: [mit Login]: Kommentieren, Idee direkt einreichen, liken, vernetzen…; [ohne Login]: liken, vernetzen…

Bewertung und Priorisierung

Ideen können bewertet werden (z. B. durch Community-Votings) und sollen später in Hackathons oder Softwaresprints umgesetzt werden.

Strukturierter Wissenstransfer, offener Ideenaustausch

Einbindung von Stakeholdern

Niedrigschwelliger Zugang

Die Plattform soll benutzerfreundlich, barrierearm und offen gestaltet sein, sodass verschiedene Gruppen aktiv teilnehmen können.

User Journey 
1. Finden und kennenlernen
Nutzer*innen stoßen über Webseite(n) oder Veranstaltungen auf die Ideen-Datenbank. Erste Eindrücke: niedrigschwelliger Zugang, einfache Navigation, keine Registrierungspflicht für’s Stöbern. Im Idealfall gibt es ein kurzes “How-to-Ideen-Datenbank” auf der Startseite. Optional: Auf Startseite werden “Top-Themen des Monats” o.ä. angezeigt (als Teaser). Startseite lädt zum Mitmachen ein - ansprechende Landingpage.

→ Wichtig: Übersichtliches, responsives Frontend mit Filter- und Suchfunktion, inspirierender Einstieg (z. B. „Meist gevotet“, „Neueste Ideen“)

2. Einreichen & Teilen
Mit wenigen Klicks können Nutzer*innen Ideen erfassen – per strukturiertem Formular (z. B. Titel der Idee, Kurzbeschreibung, Zielgruppe…), es ist möglich Dateien anzuhängen.

Unterscheidung zwischen registrierten Nutzer*innen und nicht-registrierten Nutzer*innen. Bei nicht-Registrierten Nutzer*innen, müssen die Ideen erst freigegeben werden und landen zunächst auf dem Prüftisch.

→ Wichtig: intuitives Formular, Möglichkeit zur späteren Bearbeitung, Barrierefreiheit. Projektteam kann Ideen/ Beiträge kuratieren.

3. Bewerten & Vernetzen
Die Community kann Ideen liken, kommentieren, verfeinern. Es kann nach “meist gevotet” sortiert werden. Nutzer*innen können sich untereinander vernetzen. Nutzer*innen können “Interesse bekunden”, wenn Sie an einer Idee mitwirken möchten (ggfs. kann das über die Kommentarfunktion laufen) Optional: Nutzer*innen bekommen Benachrichtigungen über Reaktionen. 

→ Wichtig: Voting-System (like, thumbs up), Kommentarfunktion, optionales Nutzerkonto mit mehr Berechtigungen

4. Von der Idee zum Prototyp
Top-Ideen werden von Teams in Hackathons aufgegriffen. Optional: Die Datenbank verknüpft Ideen mit Status (z. B. „In Arbeit“, „Prototyp vorhanden“, “umgesetzt”).

→ Wichtig: Status-Tracking, Verlinkung zu Hackathon-Projekten, GitHub-Integration/-Verlinkung für Ergebnisse nach dem HackathOERn

Gesamtkonzept:
Beispielseiten: Alle für die Halle , Richtungspfeile für Partnerstädte  

Akteursgruppen:

Projektteam: Sammlungsstruktur anlegen, Kuratierung von Inhalten, Kommentieren etc.

Community: Unterscheidung ob Login oder nicht

Expert*innen (wie OER-Beirat): Gleiche Rechte wie Community? Wenn nicht, welche Rechte sollen sie haben?

Zugriff auf die Datenbank: 

Zugriff hat jeder (Betrachtungsmodus, aber auch Idee einreichen etc.)

Wer registriert ist kann direkt Ideen hinzufügen (ohne Freigabe durch Projektteam) und kann kommentieren und hat alle Funktionen, wie diejneigen ohne Login. 

Ohne Login: Ideeeinreichung muss erst geprüft werden und es kann nicht kommentiert werden. Möglich sind: suchen/ filtern, liken, Problem melden, Ideen teilen (mit anderen Interessenten), Interesse bekunden/ vernetzen.

Wer sich registriert und einloggt hat mehr Rechte/ Möglichkeiten. Keine weitere Unterscheidung zwischen Expert*innen und anderen Nutzer*innen.

Über PollOER (z.B. bei Konferenzen).

Nutzungskonzept: 

Prozess / Phasen (Ablaufdiagramm UML)

Features

Suchen/ filtern: 

Sortieren:

Neueste (Prio 1)

Älteste (Prio 1)

Meiste Votes/ Likes (Prio 1)

Meiste Kommentare/ meist diskutiert (Prio 2)

alphabetisch (Prio 2)

Filtern: (Prio 1)

Nach Themengebieten (Prio 1)

Nach Herausforderung (Prio 1)

Schlagwörter (Prio 1)

Zielgruppe (Prio 2)

Suchen (Prio 1)

Freitextsuche (Prio 1)

Schlagwortsuche (á la “Meinten Sie..”) (Prio 2)

Liken: Um Ideen priorisieren zu können (Prio 1)

Problem melden (falls es technische Schwierigkeiten gibt oder problematische Inhalte) (Prio 2)

Kommentieren: Um Interaktion zu ermöglichen (Prio 1)

Interesse bekunden/ vernetzen (Prio 2 (oder sogar 3, sofern Kommentarfunktion möglich ist))

Ideen verknüpfen (Prio 3)

Idee teilen: “Schau dir diese Idee an..” (Prio 1)

Artefakte/ Ebene + Beispiel 

Themengebiete als Themenseite/ Sammlung (z.B. Auffindbarkeit von OER): Erste Themenbereiche wurden identifiziert, Ergänzungen durch Projektteam müssen jederzeit möglich sein).

Herausforderungen als Sammlung (z.B. Zersplitterte Infrastruktur/ fehlende Metadatenstandardisierung)

Ideen/ Lösungsansätze als Inhalt (z.B. zentrale OER-Datenbank/ interoperable Metadatenstandards)

Projekte als Inhalt/ Sammlung (z.B. OER-Finder-Plugin zur besseren Auffindbarkeit/ Förderung von offenen, interoperablen Repositorien)

 

 

Akteure und ihre besonderen Rechte / Aufgaben

Community (Nutzende, Ideengeber*innen, Expert*innen) und Projektteam

Projektteam: Erstellung von Themenbereichen, Kuratierung von eingereichten Ideen

Community mit Login: Idee direkt hinzufügen, suchen, liken, Problem melden, Idee teilen, kommentieren, vernetzen, Ideen verknüpfen

Community ohne Login: Idee vorschlagen, vorab-Prüfung durch Projektteam, suchen, liken, Problem melden, Idee teilen, kommentieren, vernetzen

Expert*innen (z.B. OER-Beirat): Gleiche Voraussetzungen wie Community. Ergänzende Rechte/ Features?

 

Einbindung der Ideen-Datenbank

Plattformen / Webseiten 

Hackathoern Webseite, OERinfo, OER Strategie

Bei Drittwebseiten klären, welches CMS dort vorhanden ist (OERinfo + OER Strategie ist Wordpress)

Registrierung

Was muss abgefragt werden:

Name, Vorname

Organisation/ Institution

E-Mailadresse

Zustimmung Nutzungsbedingungen?

Beschreibung/ Kurzprofil (Themen-/ Interessensschwerpunkte, was hab ich bisher so gemacht…)

Poll-OER:
Verknüpfung mit der Ideendatenbank als niedrigschwellige “Vorebene” zur Datenbank, um auf Konferenzen etc. unkompliziert Ideen sammeln zu können. Wenn möglich, landen Ideen in der Datenbank und/ oder können direkt zu Sammlungen hinzugefügt werden. Ohne Registrierung, nutzerfreundlich, leicht verständich.

Use Case:
Ideen aus der Community in die Datenbank bringen, voten/ priorisieren und dann in die Bearbeitung bringen.

Ziel:
Eine Person aus der Community (und im Idealfall auch darüber hinaus) kann mit aber auch ohne Registrierung eine Idee zur Verbesserung der OER-Infrastrukturen einreichen.
Die Community kann die Idee kommentieren und priorisieren. Priorisierte Ideen werden im Vorfeld von HackathOERns in die Community “zurückgegeben”, geschärft und dann in den HackathOERns umgesetzt.

Bei adhoc Ideensammlungen bei Konferenzen oder wenn die eigenständige Eintragung aufgrund anderer Umstände nicht möglich ist, übernimmt das Projektteam die Eintragung.

Hauptakteure:
Ideengeber*innen (z. B. Lehrkraft, Multiplikator*in, Community-Mitglied, Stakeholder, IT…)

Community-Mitglieder (Personen, die Ideen kommentieren oder liken)

Redaktion / Projektteam (prüft und überträgt in den Prototyp)

Start:
Eine Person hat eine Idee (z. B. auf einer Veranstaltung oder spontan online) und möchte diese teilen und festhalten (Ideenspeicher).

Prozess:
Ideengeber*in ruft über einen QR-Code oder Link die Ideendatenbank auf. Im Idealfall erscheint direkt eine Eingabemaske zur Ideeneingabe (z.B. Formular, das alle benötigten Infos abfragt)oder Button “hier kannst du deine Idee einreichen.

Ideengeber*in trägt die Idee ein: Titel, kurze Beschreibung, Zuordnung zu Themenbereich Kontaktdaten und ggfs. Umsetzungspläne

Die Idee erscheint automatisch in der Sammlung.

Community-Mitglieder sehen die Idee, können sie liken oder kommentieren. 

Das Projektteam prüft regelmäßig:

ist ausreichend Kontext vorhanden?

ggf. Ergänzungsnachfrage bei Ideengeber*in.

Ideen mit vielen Likes oder Kommunikation werden in ergänzenden Formaten wie z.B. Ideen-Laboren weiterbearbeitet. Kommunikation könnte über Matrix-Kanäle erfolgen.

Erfolgskriterien:
Idee wird ohne Hürden eingereicht.

Kontextinformationen vollständig (Ansprechperson, Thema, Beschreibung).

Community-Beteiligung messbar (Likes, Kommentare).

Offene Punkte / Risiken:
Datenschutz (Kontaktangaben) muss berücksichtigt werden.

 



Nutzungskonzept Prototyp 2.0



Von Kathrin Rabsch

Anhören

6

Eine Reaktion hinzufügen
Numbered Headings
Numbered Headings
Smart Designer
Smart Designer
App-SymbolScroll page details

Weniger anzeigen
Coworking:

Jason muss erst Auftrag vergeben - abklären

Features, die wir im Antrag versprochen haben noch einmal rausziehen und noch einmal priorisieren was wir wirklich brauchen

Deutlich machen, dass Features nicht nur für Datenbank nützlich sind (z.B. Personenprofil anlegen und verknüpfen mit Idee oder Thema)

Themenseiteneditor nutzen - Themenseiten könnten Schaufenster sein → Inhalte in Themenseiten anzeigen lassen (wie Fachportal)

Metadaten mit Team 4 besprechen + Erschließung von Inhalten, was ist bisher möglich - erläutern, was wir wollen auch mit Blick auf die Features; agnostisch XY; generischer Crawler

Nachbereitung nach Workshops so schmal wie möglich halten. Dokumente/ Formulare so gut wie möglich vorbereiten, dass möglichst wenig Aufwand für die Teilnehmenden und mich entsteh, aber alle notwendigen Informationen abgefragt werden können.

Ideen-Labore: 

Voten für Themenbereich, dann Ideen-Labor zu den Ideen plus ggfs. neue Ideen. So können kontextarme Ideen unterfüttert werden. 

Zielgruppenspezifische Ideen-Labore (IT, Nutzende, Stakeholder…)

Matrix: Im Nachgang zu Ideen-Labor: Kommunikationskanal in Matrix. Damit nehmen wir Kommunikationskomponente aus Datenbank raus → klappt viell. besser weil Hürde niedriger

Einbauen AG-Painpoints Artikel

Leute, die Ideen haben ausfragen: Was braucht ihr, wen braucht ihr…

Welceh Akteure möchten wir aktivieren → Stakeholdermapping

Mit wem könnten wir HAckathOERn gemeinsam veranstalten? OER im Blick? Open Knowledge Foundation?

Überlegen: Wie Datenbank nach Projektende am Leben halten?

PollOER: Werden damit unsere Anfroderungen abgedeckt.

Keine Möglichkeit Version 2 in absehbarer Zeit umzusetzen - daher Neudenken, was mit dem Prototypen möglich ist und was nicht + überlegen wie wir damit umgehen können. 

Was ist mit der jetzigen Version möglich?

Ideen hinzufügen nur nach Registrierung

Durchklicken

ggfs. möglich: Ergänzungen hinzufügen, wenn wir das freischalten udn Idee als doc. eingetragen wurde

Was fehlt?

Vorstrukturiertes Abfragen aller nötigen Infos: Titel, Kurzbeschreibung etc.

Liken, kommentieren → Interaktion generell nicht möglich

Idee eintragen ohne Login

Vernetzung von Ideen

Version 2: Unklar, wann sie kommt und was dann möglich ist. Also müssen wir überlegen, wie wir aktuell mit der jetzt vorliegenden Version arbeiten können.

Hierbei sind zwei Aspekte wichtig:

A: Bei zukünftigen Veranstaltungen muss die Sammlung von Ideen strukturierter erfolgen. Im Idealfall mit einem Template, sodass wir zu den Ideen direkt alle Infos bekommen, die wir benötigen (Titel, Kurzbeschreibung, welches Problem wird adressiert, gibt es schon Ansätze, wer ist Ideengeber plus Kontaktdaten und zu welchem Themenbereich gehört die Idee.

B: Die Ideen, die wir gesammelt haben, müssen irgendwie wieder raus aus der Datenbank und zu den Leuten, sodass sich Verantwortliche finden können, die die Idee ggfs. umsetzen oder zumindest weiterdenken möchten. Dazu muss zunächst:

Noch einmal durch die Ideen gegangen werden, ggfs. Dopplungen löschen und sofern möglich Kurzbeschreibungen ergänzen

Im Rahmen von Ideen-Laboren/ Workshops werden die gesammelten Ideen in die Mitte gegeben, diskutiert und “umsetzbar” gemacht

Vorschlag: Nächster HackathOERn, kein offener Call for Ideas, sondern hier sind Ideen, wer möchte die umsetzen

PollOER: Kann das ggfs. umgesetzt werden?

Heruaforderung generell: Wann können wir mit Version 2 rechnen? Was wird diese Version können? Gibt es Optionen was die Struktur und den Aufbau angeht?

Überlegung: Struktur ändern, z.B. Aufteilung Schule/ Hochschule/ Bildungsbereichsübergreifend - oder diese Kategorisierung mit aufnehmen. Kann man das durch Tags o.Ä. leisten? 

Das bedeutet konkret:

Ideendatenbank ist derzeit nicht benutzerfreundlich und nicht geeignet für “spontane” Ideensammlungen.

Ideen, die in der Datenbank sind haben 1. keine Substanz (weil meist nur die Idee ohne weitere Daten und Infos), 2. keine zuständige Person und 3. kann nicht interagiert werden.

Was wir im Antrag angekündigt haben, ist demnach nicht möglich (liken, Community etc.)

Alternativ: Die Art und Weise, wie wir Ideen sammeln muss angepasst werden, PollOER wird kurzfristig umgesetzt und Ideen werden noch einmal neu sortiert und in Ideen-Laboren oder beim HackathOERn bearbeitet

Mitmach-Optionen aufzeigen: Per Mail, anderes Tool oder via Registrierung

Zu klären: 

Kommunizieren wir den Protoyp dann jetzt großflächiger? If so, dann braucht es eine “Anleitung” wie es funktioniert und was wir von potentiellen Ideengeber*innen erwarten. “Onepager”: Warum ist eine solche Datenbank wichtig. Kommuniktion wo der Prototyp gerade steht.

Nutzung des Prototyps eher als Schaukasten und Ideensammlung erfolgt über entweder ein anderes Tool, PollOER, Miro oder andere Wege.

 

Pragmatischer Vorschlag basierend auf 3 Bausteinen:

Einfache Sammlung von Ideen (Input)

Strukturierte Rückkopplung mit der Community (Feedback)

Übergabe an die bestehende Prototyp-Datenbank (Integration)

Ziel
Ideensammlung muss niedrigschwellig möglich sein, ohne dass Nutzende sich durch den Prototyp kämpfen müssen (insbesondere wenn die Zeit knapp ist bei Workshops o.Ä.).

Kontextinformationen zur Idee (z. B. Name, Institution, Beschreibung, Relevanz) müssen gleich beim Sammeln erfasst werden - das ist bisher nur teilweise erfolgt.

Community-Feedback und Interaktion (Likes, Kommentare, Diskussionsimpulse) müssen auf anderem Weg ermöglicht werden, auch wenn das eigentliche Tool dies nicht unterstützt.

Ideen rückführbar machen, sodass sie nicht kontextlos in der Datenbank landen.

 1. Ideensammlung vereinfachen (Input)
a) Externes Formular als „Frontend“
Vorschalten eines simplen Tools:

z. B. Typeform, LimeSurvey, Microsoft Forms… Oder PollOER, wenn möglich

Formularfelder z.B.:

Titel der Idee

Kurzbeschreibung (Problem + Lösung)

Kategorie / Thema

Ansprechperson + E-Mail (braucht vmtl. dann den Hinweis, dass das in der Datenbank erscheinen darf)

Zielgruppe 

Tags / Schlagworte

optional: Upload-Feld für Materialien oder Links

Vorteil: niedrigschwelliger Zugang, auch mobil auf Konferenzen/ in Workshops nutzbar.

2. Community-Interaktion und Kollaboration ermöglichen
Prototyp ermöglicht keine Interaktion, daher braucht aus das eine Alternative.

a) Öffentliche Ideenseite oder -board
Nutzung einer externen Plattform zur Sichtbarmachung & Interaktion, z. B.:

Padlet

Trello

Miro

…

Jede eingereichte Idee bekommt eine eigene „Karte“ oder einen Post.

Community kann:

Liken

Kommentieren / Rückfragen stellen

Ergänzen / verlinken/ vernetzen

Ermöglicht also Diskussion, Community-Gefühl und Priorisierung wird ermöglicht.

 3. Rückführung in die Prototyp-Datenbank
Kuratiertes Einpflegen der Ideen inkl. Metadaten durch das Projektteam → wer unterstützt dann hier?

Input aus externem Tool

Verlinkung: In Datenbank auf Originalbeitrag verweisen

Tags nutzen, um Ideen später leichter filterbar zu machen.

Nutzung des Prototyps eher als Schauksaten, nicht als Interaktionsplattform.

Was machen wir mit den “losen” Ideen, die in der Datenbank sind ohne weitere Infos?
Ideen bereinigen (bedeutet clustern, ggfs. löschen, verschieben etc.)

Ideen aus dem Prototp rausziehen und sie übersichtlich aufbereiten (Miro, Tabelle etc.)

Dann braucht es ein Format (z.B. Online Ideen-Labor oder Engagement der Leute von HackathOERn/ SC asynchron: “Wir haben Ideen gesammelt, was sind eure Gedanken dazu? Wie könnte das aussehen (co-creative Weiterentwicklung der “losen” Idee), welche interessiert euch besonders, an welcher möchtet ihr arbeiten” mit Bitte um Namensangabe

Dann: kuratierte Rückführung in den Prototyp

 

To Do:


Probelauf “Template” beim OERinfo-Fachtag

Bei Team 6 nachfragen, ob PollOER einsetzbar gemacht werden könnte

Bei Team 6 nachfragen, mit welchen Funktionen wir in Version 2 rechnen können

Bei Team 6 Zeitplan erfragen

Ideendatenbank durchgehen, sortieren, clustern und wo möglich Erläuterungen ergänzen

Offenes Projektbüro mit Jessi: Was ist ggfs mit wenig Aufwand doch jetzt scon möglich?
 