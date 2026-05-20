# 7. Permissions & Architektur

Hintergrund-Wissen für Mods, die verstehen wollen, wie Rechte vergeben sind und
wo die App technisch aufsetzt.

## Architektur in einem Bild

```
Browser
  │
  │ HTTP/JSON
  ▼
FastAPI Backend
  │
  ├─ SQLite (App-Cache)
  │   - idea, topic, taxonomy_event, taxonomy_phase
  │   - activity_log, idea_report, idea_interaction
  │   - ranking_snapshot, user_feed_seen
  │
  └─ HTTP Basic Auth (User-Auth wird durchgereicht)
       │
       ▼
   edu-sharing REST  (Source of Truth)
   - ccm:io, ccm:map, ccm:io_reference
   - Permissions / Memberships / Groups
   - Ratings, Comments, Anhänge
```

**Wichtigste Regel**: edu-sharing ist die einzige verbindliche Datenquelle. Die
App-DB ist nur ein Performance-Cache + Speicher für app-spezifische Zusätze
(Mitmachen, Folgen, Reports, Versteckt-Flag, Aktivitäts-Log).

## Wie wird Mod-Status erkannt?

Im Backend prüft `_is_moderator()` pro Request:

1. **Bootstrap-Whitelist** — Usernames aus der `MODERATION_BOOTSTRAP_USERS`-
   Env-Variable. Default leer. Sinnvoll als Notfall-Liste, damit du dich nie
   aussperrst.
2. **Group-Mitgliedschaft** — User wird in edu-sharing als Mitglied einer der
   `MODERATION_FALLBACK_GROUPS` geführt. Default `GROUP_ALFRESCO_ADMINISTRATORS`.

Wenn eine der beiden Bedingungen zutrifft → Mod.

### Gruppen-Mitgliedschaft prüfen

API-Endpoint:
```
GET /api/v1/me/memberships
Authorization: Basic …
```

Antwort zeigt deine ES-Gruppen + welche davon als Mod-Gruppe konfiguriert sind.

### Mod-Konfiguration ändern

Im `.env`:

```ini
# Beide Beispiele zusammen — User darf in jeder der Gruppen sein
MODERATION_FALLBACK_GROUPS=GROUP_xxx_ORG_ADMINISTRATORS,GROUP_ALFRESCO_ADMINISTRATORS

# Bootstrap-User: Komma-Liste von Login-Usernames
MODERATION_BOOTSTRAP_USERS=
```

Nach Änderung Container/Backend-Prozess neu starten (Env wird nur beim Start
gelesen).

### Mod werden / aussteigen

Mod-Verwaltung läuft **direkt in edu-sharing**, **nicht** über die App.
Im Mod-Tab „Moderatoren" siehst du nur lesend die Mitglieder, kannst keine
hinzufügen oder entfernen — das wäre eine globale ACL-Änderung in einer
Admin-Gruppe und ist bewusst nicht in der App exponiert.

Wenn jemand Mod werden soll:
1. ES-Admin öffnet `https://redaktion.openeduhub.net/edu-sharing/`
2. Navigiert zur konfigurierten Mod-Gruppe (z.B. `GROUP_xxx_ORG_ADMINISTRATORS`)
3. User als Mitglied hinzufügen

Beim nächsten Login des Users greift die App-Mod-Erkennung sofort.

## ACLs am Knoten

Jeder ES-Knoten (`ccm:io`, `ccm:map`) hat eine ACL mit:

| Permission | Bedeutung |
|---|---|
| **Consumer** | Lesen, Vorschau, Download |
| **Editor** | Metadaten ändern |
| **Collaborator** | Editor + Kinder anlegen |
| **Coordinator** | Voll-Admin auf diesem Knoten (ACL ändern, löschen) |

ACLs werden **vererbt**, können aber per-Knoten überschrieben werden.

### Wer hat Mod-Rechte auf den Mod-Aktionen?

Die App-Endpoints, die Mod-Rechte verlangen (`@_require_moderator`), prüfen
**nur** den App-Mod-Status. Aber dahinter ruft die App edu-sharing-APIs auf
(z.B. `addReference`, `delete_node`). Wenn der Caller im ES keine ACL-Write am
Ziel-Knoten hat → 403 von ES, App reicht den Fehler weiter.

Vereinfacht:
- **App-Mod-Status** = darfst die UI-Aktion auslösen
- **ES-ACL** = darfst die ES-Aktion tatsächlich ausführen

Für die HackathOERn-Sammlungen sind beide Permissions an den Mod-Gruppen
gehängt — solange du in der konfigurierten Gruppe bist, klappt beides.

## Tool-Permissions (Repository-Konfig)

Eine **dritte Schicht** auf Repository-Niveau: bestimmte API-Calls brauchen
zusätzliche Tool-Permissions, die der Repo-Admin in der ES-Admin-Konsole
freischaltet.

Wichtigste für unsere App:

| Tool-Permission | wofür |
|---|---|
| `COLLECTION_REFERENCE_ADD` | `PUT /collection/.../references/{node}` — Inhalt in Sammlung referenzieren |
| `WORKSPACE` | Schreibzugriff aufs Home-Verzeichnis |
| `INVITE` | Andere User einladen / Gruppen-Mitglieder hinzufügen |

**Symptome wenn Tool-Permission fehlt**:
- 403 `DAOToolPermissionException` (für Mods)
- 403 `DAOSecurityException` (für Guests / Standard-User)

→ Lösung: ES-Admin muss die Tool-Permission für die HackathOERn-Mod-Gruppe in
der Admin-Konsole aktivieren. Kann nicht via App-UI gefixt werden.

## Submit-Mechanismus

| Fall | Pfad |
|---|---|
| **Anonymer Submit** | App → Backend → mit Guest-Account (`WLO-Upload`) in die Inbox schreiben |
| **Authentifizierter Submit** | App → Backend → mit User-Auth in die Inbox schreiben → User wird Owner |

In beiden Fällen entsteht ein neuer `ccm:io` direkt unter der konfigurierten
Inbox-Sammlung (`EDU_GUEST_INBOX_ID`).

## Reference-Pattern (Kern-Architektur)

Beim Einsortieren ins Sammlungs-Tree:

```
1. Original liegt in Inbox  ─────►  98fcbe56...
                                         │
                                         │ addReference
                                         ▼
2. Reference-Knoten in Sammlung X ──►  d671abfc... (Challenge)
   mit originalId = <Inbox-Knoten>
```

**Vorteile** des Pattern:
- Inhalt nur an EINER Stelle (Inbox)
- Mehrere Sammlungen können denselben Inhalt referenzieren
- Edits am Original sind sofort überall sichtbar
- ACLs bleiben stabil (keine Move-Inheritance-Drift)

Die App nutzt **Reference-only** — kein `_move`-Fallback. Wenn `addReference`
mit 403 abgelehnt wird, geht's nicht weiter. Dafür ist die Tool-Permission auf
Repo-Niveau die Ursache.

## Inbox-Owner-Tracking

`ccm:creator` ist immer der **Account, der den POST gemacht hat** — also bei
anonymen Submits der Guest-Account.

Für die App-Sicht „wer ist Owner dieser Idee, darf bearbeiten" gibt's einen
Zusatz-Mechanismus:

- Bei eingeloggten Submits wird `submitter:<username>`-Keyword als Schlagwort
  ans `cclom:general_keyword` angehängt
- Die App liest beim Owner-Check zuerst `submitter:`-Marker, dann `cm:creator`
- Owner-Edit-Gating prüft: `_is_owner_or_mod(idea_id, auth)` → owner = match
  von User mit Submitter ODER Creator

## Geisterzeilen-Cleanup im Sync

Wenn ein Inbox-Original irgendwo referenziert wird (= `original_id` einer
Reference-Row), gehört es nicht mehr in den Public-Cache. Beim Sync-Lauf:

```sql
DELETE FROM idea WHERE id IN (
    SELECT original_id FROM idea WHERE original_id IS NOT NULL
);
```

Räumt die Inbox-Originale automatisch aus der Listen-Sicht.

## Auth-Failed-Audit

Jeder fehlgeschlagene Mod-Endpoint-Aufruf wird im Activity-Log als
`auth_failed` notiert. Mods können im Aktivitäts-Tab nach Spitzen schauen
(Brute-Force-Versuche).

## Datenflüsse im Überblick

```
Aktion                          Wo geschrieben          Wo geslesen
──────                          ─────────────           ───────────
Idee einreichen                 ES (Inbox)              Backend-Sync → App-Cache
Idee bearbeiten                 ES (Original)           refresh_idea → App-Cache
Sammlung erstellen              ES                      Sync → App-Cache
Reference setzen                ES                      Sync + refresh
Idee verstecken                 App-DB (hidden=1)       App-DB
Idee löschen                    ES (delete)             Sync entfernt aus Cache
Kommentar                       ES (/comment/v1)        get_idea-Antwort
Rating                          ES (/rating/v1)         get_idea-Antwort
Mitmachen/Folgen                App-DB                  App-DB
Meldung                         App-DB                  App-DB
Activity-Log                    App-DB                  App-DB
Backup                          ZIP in /data/backups    App-UI
```

## edu-sharing-Begriffsmodell

Für tiefere Recherche / Repo-Inspektion:

| ES-Typ | Bedeutung | App-Entsprechung |
|---|---|---|
| `ccm:io` | Inhalts-Knoten (Lerninhalt) | „Idee" |
| `ccm:io_reference` | Referenz auf einen ccm:io | „Idee in Sammlung" |
| `ccm:map` | Container (Sammlung/Ordner) | „Topic" / „Herausforderung" |
| `cm:person` | User-Knoten | App-User |
| `cm:authority` | Gruppe oder User | für ACLs |

## Mehr Doku

- Code-Repo + Backend-Schema: GitHub
- edu-sharing-API: `https://redaktion.openeduhub.net/edu-sharing/swagger/index.html`
- Reference/Move-Pattern-Details: Skill `wlo-collections-references` (im Claude-Skill-Verzeichnis)
- Permissions-Quirks: Skill `wlo-permissions-iam`

---

→ Zurück zur [Mod-Übersicht](01-uebersicht-mod-bereich.md) · → [Benutzerhandbuch](../benutzerhandbuch/01-einfuehrung.md)
