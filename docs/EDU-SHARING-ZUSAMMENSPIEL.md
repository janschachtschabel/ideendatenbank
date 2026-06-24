# Zusammenspiel mit edu-sharing

Diese Seite erklärt, **wo edu-sharing** und **wo die eigene App-Datenbank**
verwendet wird und wie beide zusammenspielen. Den Technik-Überblick (Frameworks,
Module) gibt es in [`ARCHITEKTUR.md`](ARCHITEKTUR.md).

## Grundprinzip

> **edu-sharing ist die einzige verbindliche Datenquelle** (Source of Truth) für
> Inhalte. Die lokale **SQLite ist (a) ein Lese-Cache** dieser Inhalte und
> (b) der **Speicher für App-eigene Zusätze**, die es in edu-sharing nicht gibt.

Daraus folgt die Grundregel:

- **Lesen** → fast immer aus dem schnellen SQLite-Cache (Liste, Suche, Filter,
  Ranking). Nur wenige Reads gehen live ans Repo (Kommentare, Anhang-Liste,
  Postfach).
- **Schreiben von Inhalten** → **immer zuerst nach edu-sharing**, danach wird die
  betroffene Cache-Zeile per `refresh_idea` aktualisiert. Der Cache muss also
  keine eigene Konsistenz-Garantie liefern — er holt sich die Wahrheit aus dem Repo.

---

## Was wo liegt

### edu-sharing (Source of Truth)

| Datentyp | Wie/wo im Repo |
|---|---|
| **Idee** | ein `ccm:io` (nutzt Standard-Metadaten, kein eigenes MDS) |
| Titel, Beschreibung, Autor, Projekt-URL | `cm:title`/`cclom:title`, `cclom:general_description`, `ccm:author_freetext`, `ccm:wwwurl` |
| Phase / Veranstaltung / Kategorie / Einreicher | Präfix-Keywords in `cclom:general_keyword` (`phase:` · `event:` · `topic:` · `submitter:` · `target-topic:`) |
| **Bewertungen** (Sternwerte) | edu-sharing Rating-API (`overall.rating/count/sum`) |
| **Kommentare** | edu-sharing Comment-API |
| **Anhänge / Dokumente** | Serienobjekte = Child-IOs unter der Idee (`ccm:childio`, Aspekt `ccm:io_childobject`) — erben die Rechte der Idee |
| **Vorschaubild** | Node-Preview (Thumbnail) des **Primärknotens** — **kein** Serienobjekt/Anhang |
| **User & Identität** | Login (HTTP Basic), Personen-Profil (firstName/lastName/email) |
| **Rechte / Gruppen** | ACLs + Mitgliedschaften (`my_memberships`) |
| **Sammlungen** | `ccm:map`: Themenbereiche (Ebene 1) → Herausforderungen (Ebene 2) |
| **Reference-Knoten** | `ccm:io_reference` mit `originalId` (Idee in einer Sammlung) |
| **Community-Inbox** | Sammlung, in der neue Einreichungen landen |

### App-DB (eigene Daten — edu-sharing kennt sie nicht)

| Datentyp | Tabelle |
|---|---|
| **Verstecken** (Soft-Hide, reversibel) | `idea.hidden` / `hidden_reason` (App-Spalte) |
| **Folgen / Mithacken / Team** (Status + Bearbeitungsrecht) | `idea_interaction` |
| **Kontakt für Rückfragen** (opt-in, nur für Eingeloggte sichtbar) | `idea_contact` |
| **Meldungen** | `idea_report` |
| **Phasen- & Veranstaltungs-Pflege** (Slug, Label, Sortierung, Status, Featured-Slot, Voting-Modus, Termine/Ort) | `taxonomy_phase`, `taxonomy_event` |
| **Themen-Farbe & -Sortierung** | `topic.color` / `topic.sort_order` (App-Spalten) |
| **Aktivitäts-Log** | `activity_log` |
| **Captcha-Tokens** | `captcha_challenge` |
| **Trend-Verlauf** | `ranking_snapshot` |
| **Verfalls-Score** (zeitgewichtete Stimmen) | `vote_event`, `idea_score_seed` |
| **Profil-Felder** (Bio, Rolle, Website) | `user_profile_meta` |
| **App-Einstellungen** (z.B. globaler Bewertungs-Modus) | `app_setting` |
| **Notification-Cursor** | `user_feed_seen` |

### App-DB (Cache — Kopie aus edu-sharing, autoritativ bleibt das Repo)

| Was | Tabelle | Quelle |
|---|---|---|
| Ideen-Felder (Titel, Beschreibung, Phase, Events, Bewertungs-Schnitt, Kommentar-Zahl, Anhang-Meta, Vorschau-URL, Owner, …) | `idea` | edu-sharing-Knoten |
| Sammlungs-Felder (Titel, Beschreibung, Vorschau) | `topic` | edu-sharing `ccm:map` |
| Volltext-Index | `idea_fts` | aus den gecachten `idea`-Feldern |

> Wichtig: Beim Voll-Sync werden **nur** die edu-sharing-Felder überschrieben.
> Die App-eigenen Spalten derselben Zeilen (`idea.hidden`, `topic.color`,
> `topic.sort_order`) bleiben erhalten — sonst würde der 5-Minuten-Sync sie
> wegräumen.

---

## Zwei Klassen von Schreibvorgängen

Der entscheidende Sicherheits- und Konsistenz-Punkt: ob ein Schreibvorgang nach
edu-sharing geht oder nur in die App-DB.

### Klasse A — edu-sharing-Schreibvorgänge

Auth wird **durchgereicht**; edu-sharing prüft das Passwort bei jedem Call selbst.
Danach `refresh_idea` → Cache sofort aktuell.

> Idee einreichen · bearbeiten · Herausforderung wechseln/verschieben · löschen ·
> bewerten / Bewertung zurücknehmen · kommentieren / Kommentar löschen ·
> Anhänge hoch-/umbenennen/ersetzen/löschen · Vorschaubild.

Verschieben/Wechseln **veröffentlicht** dabei zusätzlich das Original, Löschen
entfernt **auch das Original** (s. *Freigabe & Sichtbarkeit*). Anonyme Uploads
(Vorschaubild/Anhänge an frische Ideen) laufen über den Service-Account/Gast.

Weil edu-sharing das Passwort verifiziert, sind diese Vorgänge **fälschungssicher**:
Ein erfundener Auth-Header scheitert am Repo.

### Klasse B — App-DB-only-Schreibvorgänge

Diese gehen **nicht** nach edu-sharing — sie betreffen nur App-eigene Tabellen.
Hier prüft die App die Identität selbst, denn der Basic-Username allein ist ohne
Passwortprüfung fälschbar:

- **`_verify_login`** (ein `my_memberships`-Roundtrip, der die Credentials
  validiert) bei: Kontakt setzen, Folgen, Mithacken/Interesse, Team-Mitglied
  setzen/entfernen, Profil-Felder, Notification-Cursor.
- **`_require_moderator`** (Gruppen-Check) bei: Verstecken/Einblenden, Taxonomie
  (Phasen/Veranstaltungen), Einstellungen, Meldungen erledigen, Backup/Restore.
- **Meldung abschicken** ist anonym möglich; ist ein Login dabei, wird die
  Melder-Identität via `_verify_login` verifiziert (sonst `NULL`).

> **Sonderfall Verstecken/Einblenden:** Diese sind App-DB-Flag (`idea.hidden`)
> **plus** ein (best-effort) edu-sharing-Permission-Write — sie ent- bzw.
> veröffentlichen zusätzlich das Original (s. *Freigabe & Sichtbarkeit*). Rein
> App-DB sind sie also nicht mehr.

> **Warum der Unterschied?** `_user_key_from_auth()` dekodiert nur den Usernamen
> aus dem Basic-Header — **ohne** Passwortprüfung. Für Klasse-A-Writes ist das
> egal (edu-sharing prüft). Für Klasse-B-Writes (reine App-DB) wäre es ein
> Impersonations-Vektor — deshalb dort immer `_verify_login`/`_require_moderator`.

---

## Auth- & Rechte-Modell

- **HTTP Basic, durchgereicht:** Header kommt pro Request vom Browser, geht
  unverändert ans Repo. Das Backend speichert **nie** Credentials.
- **Service-Account / Gast** (`EDU_GUEST_*` aus `.env`, Pflicht, kein Default):
  schreibt im Namen Anonymer in die Inbox — beim anonymen Einreichen **inkl.
  Vorschaubild + Anhängen** (nur für frische, noch nicht einsortierte Ideen).
- **Mod-Status:** ausschließlich edu-sharing-Gruppenmitgliedschaft
  (`MODERATION_FALLBACK_GROUPS`, geprüft via `my_memberships`). Es gibt **keinen**
  Username-Bootstrap. Details:
  [`moderation/07-permissions-architektur.md`](moderation/07-permissions-architektur.md).

---

## Inbox- & Reference-Pattern

Wie Ideen vom Einreichen bis zur Sammlung wandern:

1. **Einreichen** → eine Idee wird als `ccm:io` in der **Community-Inbox** angelegt
   (anonym über den Service-Account, eingeloggt mit der eigenen Auth, sodass die
   Person ES-Creator wird). Inbox-Knoten sind **nicht** öffentlich — der Voll-Sync
   überspringt sie, `refresh_idea` ebenfalls.
2. **Einsortieren** (Moderation) → zwei Schritte:
   a) Die Idee wird per **`addReference`** in eine Herausforderungs-Sammlung
      verlinkt (**nicht** `_move`). Das Original bleibt in der Inbox, die Sammlung
      bekommt einen `ccm:io_reference` mit `originalId`.
   b) Das **Original wird veröffentlicht** — die App setzt `GROUP_EVERYONE`/
      `Consumer` (öffentliches Leserecht) auf den Inbox-Knoten. edu-sharing
      publiziert das Original beim Referenzieren **nicht** automatisch; ohne
      diesen Schritt zeigt die eingebettete (anonyme) Vorschau/Render
      „insufficient permissions". Anhänge (Child-IOs) erben das Recht.
3. **Cache** → der Sync findet den Reference-Knoten unter
   `/children/references` und nimmt ihn in den Public-Cache auf. Das Inbox-Original
   wird als Geisterzeile aus dem Public-Cache entfernt (es ist über die Reference
   repräsentiert).

**Warum Reference statt Move?** Das Original bleibt die maßgebliche Stelle, dieselbe
Idee kann in mehreren Sammlungen erscheinen, ACLs bleiben stabil, und der Sync hat
eine klare Quelle. Mehr: [`moderation/02-postfach-einsortieren.md`](moderation/02-postfach-einsortieren.md).

> **Herausforderung wechseln** kombiniert beide Schritte: neue Reference in die
> Ziel-Sammlung anlegen (idempotent gegen 409), Original erneut veröffentlichen,
> alte Reference löschen. Die App führt pro Idee **genau eine** Topic-Referenz.

### Freigabe & Sichtbarkeit (Veröffentlichen / Zurückziehen)

Die Sichtbarkeit einer Idee hängt am **Leserecht des Originals** — und edu-sharing
veröffentlicht beim Referenzieren nicht selbst, also macht es die App explizit:

| Aktion | edu-sharing-Effekt |
|---|---|
| Einsortieren / Herausforderung wechseln | Original **veröffentlichen** (`GROUP_EVERYONE`/`Consumer`) |
| Verstecken | Original **ent-veröffentlichen** (Leserecht entzogen) |
| Einblenden | Original **wieder veröffentlichen** |
| Löschen | Reference **und** Original entfernen (Original nur, wenn keine andere Sammlung es referenziert) |

Diese Publish-/Un-Publish-Schritte laufen **best-effort**: schlägt der
Permission-Write fehl, bleibt die Hauptaktion gültig; die Moderation kann den
Knopf **„Vorschau reparieren"** (Inhalte-Verwaltung) nutzen, um das Original
nachträglich zu veröffentlichen.

### Keyword-Konvention

Phase, Veranstaltung, Kategorie und Einreicher liegen als Präfix-Keywords im
`cclom:general_keyword` des Knotens. Der Sync klassifiziert sie in die
Cache-Spalten (`phase`, `events`, `categories`) und **normalisiert** dabei
Legacy-Event-Slugs (`EVENT_SLUG_ALIASES`). Interne Marker (`submitter:`,
`target-topic:`) werden aus der UI-sichtbaren Keyword-Liste herausgefiltert.

---

## Wie Cache & Repo konsistent bleiben

Zwei Mechanismen greifen ineinander:

1. **Refresh-on-Write (sofort):** Nach jedem Klasse-A-Write holt `refresh_idea`
   den Knoten frisch → die Nutzerin sieht den neuen Stand ohne Wartezeit.
2. **Periodischer Voll-Sync (eventual, alle 15 min):** fängt Änderungen ab, die
   **direkt im edu-sharing** (Redaktionsmaske) gemacht wurden — die App erfährt
   davon erst beim nächsten Sync.

Daraus ergeben sich klare Erwartungen:

| Änderung über … | im Cache sichtbar |
|---|---|
| die App (Klasse A) | **sofort** (refresh-on-write) |
| die edu-sharing-Oberfläche direkt | nach dem **nächsten Sync** (≤ 15 min) |
| App-eigene Daten (Klasse B) | **sofort**, betrifft edu-sharing nicht |

App-eigene Daten brauchen **keinen** Abgleich mit dem Repo — sie existieren dort
nicht. Genau deshalb bewahrt der Sync die App-Spalten (`hidden`, `color`,
`sort_order`) bewusst.

### Sync-Last gering halten

Der Voll-Sync läuft den Sammlungs-Baum per Alfresco-Calls ab und ist dort die
Hauptlast auf edu-sharing. Maßnahmen (Stand 2026-06-23):

- **Intervall 15 min** (vorher 5; `SYNC_INTERVAL_SECONDS`) — Refresh-on-Write
  hält den Cache trotzdem aktuell.
- **Schlanker `propertyFilter`** statt `-all-`: pro Call nur die ~9 tatsächlich
  genutzten Properties (kleinere Antworten).
- **Legacy-Anhang-Ordner-Scan** (`collection_subcollections` je Challenge — die
  teuerste Abfrage) nur noch **jeden 4. Lauf** als Sicherheitsnetz; neue Anhänge
  sind Child-IOs, Altordner baut `scripts/cleanup_old_attachment_folders.py` ab.
- Der Themen/Challenge-Baum wird **weiterhin jeden Lauf** gewalkt → neue
  Sammlungen/Challenges werden sofort gefunden.

Grob: ~76 → ~44 Calls je Normal-Lauf, dazu 3× seltener → in Summe ~4–7× weniger
Last (am stärksten bei den langsamen Untersammlungs-Abfragen).

**Geparkt (Team-Frage an edu-sharing):** Den per-Challenge-Tree-Walk durch EINE
**Such-Abfrage** ersetzen wäre der große Hebel (1 Call statt vieler). Blocker:
Die Suche liefert Ideen-Knoten, aber nicht ihre Challenge-Zugehörigkeit
(Sammlungs-Reference). Offene Frage: *Kann die Suche pro Knoten die
referenzierenden Sammlungen liefern oder einen Sammlungs-Subtree filtern?* Falls
ja, lohnt der Umbau.

---

## Drei Abläufe als Beispiel

### 1. Anonyme Idee einreichen → öffentlich

```
Browser ──POST /ideas (+ Captcha)──► Backend
   Backend ──create ccm:io (Service-Account)──► edu-sharing (Inbox)
   (Inbox-Knoten: NICHT im Public-Cache)
        … später, Moderation:
   Mod ──POST /moderation/move──► Backend ──addReference + Original veröffentlichen──► edu-sharing
   Backend ──refresh──► Cache: Reference-Idee öffentlich, Inbox-Original ge-prunt
```

### 2. Idee bewerten

```
Browser ──POST /ideas/{id}/rating (Auth)──► Backend
   Backend ──add_rating (Auth durchgereicht)──► edu-sharing  (prüft Passwort)
   Backend ──vote_event-Eintrag (App-DB, für Verfalls-Score)
   Backend ──refresh_idea──► Cache: rating_avg/count frisch aus dem Repo
```

Der **angezeigte Schnitt** kommt aus edu-sharing; der **Verfalls-Score** fürs
Trend-Ranking aus dem App-eigenen `vote_event`-Ledger.

### 3. Mithacken anfragen + Freigabe (reine App-DB)

```
Browser ──POST /ideas/{id}/interest (Auth)──► Backend
   Backend ──_verify_login (my_memberships)──► edu-sharing  (nur Identitätsprüfung)
   Backend ──idea_interaction: status=pending (App-DB)   ← KEIN Inhalts-Write ins Repo
        … Ideengeber:in:
   ──PUT /ideas/{id}/team/{user}: approved (App-DB)
```

edu-sharing ist hier nur **Identitäts-Prüfstelle**, nicht Datenspeicher — Mithacken
ist ein reines App-Feature.

---

## Verhalten bei Ausfall / Divergenz

- **edu-sharing kurz nicht erreichbar:** Lesen funktioniert weiter aus dem Cache
  (evtl. leicht veraltet). Klasse-A-Writes scheitern sauber mit Fehler (kein
  stiller Datenverlust). Der nächste Sync holt auf.
- **Cache verloren / Neuaufbau:** unkritisch — der Voll-Sync baut den Cache aus dem
  Repo neu auf. App-eigene Daten liegen in denselben SQLite-Tabellen und werden per
  Backup/Restore gesichert (s. [`moderation/05-backup-restore.md`](moderation/05-backup-restore.md)).
- **Idee direkt im Repo geändert/gelöscht:** der Cache zieht spätestens beim
  nächsten Sync nach; gelöschte Knoten werden als Geisterzeilen entfernt.

## Querverweise

- [`ARCHITEKTUR.md`](ARCHITEKTUR.md) — Frameworks, Module, Tabellen, Build
- [`moderation/02-postfach-einsortieren.md`](moderation/02-postfach-einsortieren.md) — Inbox & Reference in der Praxis
- [`moderation/07-permissions-architektur.md`](moderation/07-permissions-architektur.md) — Rechte-Modell im Detail
- [`../README.md`](../README.md) — Kurzüberblick + Datenmodell
