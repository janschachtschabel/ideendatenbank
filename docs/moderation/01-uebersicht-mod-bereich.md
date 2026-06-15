# 1. Übersicht des Moderationsbereichs

## Wer sieht den Mod-Bereich?

User, die in einer der konfigurierten Mod-Gruppen Mitglied sind. Default ist
**ausschließlich** `GROUP_ALFRESCO_ADMINISTRATORS` (globale ES-Admins). Weitere
Gruppen — z.B. org-spezifische Admin-Gruppen wie `GROUP_xxx_ORG_ADMINISTRATORS`
der HackathOERn-Org — lassen sich optional kommasepariert ergänzen, sind aber
**nicht** standardmäßig enthalten.

Nach erfolgreichem Login erscheint im User-Menü oben rechts der zusätzliche
Eintrag **🔧 Moderation** — Klick öffnet den Mod-Bereich.

> Details zum Permission-Setup: [Kapitel 7 — Permissions & Architektur](07-permissions-architektur.md)

## Die Navigation im Überblick

Oben sitzt eine klebende Pillen-Leiste mit **fünf Gruppen**. Drei davon klappen
per ▾ ein Dropdown mit Unterpunkten auf:

```
📊 Statistik   📥 Postfach (13)   📁 Inhalte ▾   🛡 Moderation ▾   ⚙ System ▾
```

| Gruppe | Unterpunkt | Hauptzweck | Wichtigste Aktionen |
|---|---|---|---|
| **📊 Statistik** | — | Übersicht aktiver Stand | Ideen-, Kommentar-, Bewertungs-Counts; Wochen-Aktivität; Pflicht-Metadaten-Backfill |
| **📥 Postfach** | — | Inbox-Pflege | Idee in Herausforderung referenzieren, Bulk-Move, löschen |
| **📁 Inhalte** ▾ | Themenbereiche | Sammlungs-Verwaltung | Anlegen, umbenennen, Vorschaubild, sortieren, löschen |
| | Veranstaltungen | Event-Taxonomie | Anlegen, Slug + Label, Sortierung, QR-Code-Share |
| | Phasen | Phasen-Taxonomie | Phasen anlegen + Workflow-Reihenfolge bestimmen |
| **🛡 Moderation** ▾ | Meldungen | User-Reports | Idee öffnen, einzeln als erledigt markieren |
| | Aktivität | Audit-Log | Filter nach Aktion/Akteur/Zeitraum, CSV-Export |
| | Inhalte verwalten | Alle Ideen + Soft-Hide | suchen, bearbeiten, verstecken/einblenden, löschen |
| **⚙ System** ▾ | Moderatoren | Liste der Mods | nur lesend — Verwaltung läuft in edu-sharing direkt |
| | Backup | DB-Sicherung | Backup erstellen, herunterladen, wiederherstellen |

> Es gibt **keinen** eigenständigen „🚫 Versteckt"-Tab mehr (in „Inhalte
> verwalten" aufgegangen) und **keinen** „🗂 Herausforderungen"-Tab — die
> Sammlungs-Verwaltung heißt jetzt „Themenbereiche" unter **Inhalte**.

## Was tust du als Mod typischerweise?

### Täglich (5–15 Min)
1. **Postfach** auf neue Einreichungen prüfen — passende Herausforderung wählen, „Verschieben"
2. **Meldungen** sichten — entscheiden ob Bestand, Verstecken oder Löschen

### Wöchentlich
3. **Aktivität** durchscrollen — sind ungewöhnliche Muster (Auth-Failures, Spam-Wellen) zu sehen?
4. **Statistik** mit dem Team teilen — wachsende Themen, neue Beiträge

### Bei Bedarf
5. **Inhalte → Themenbereiche** anpassen — neue Themen anlegen, alte umbenennen
6. **Inhalte → Veranstaltungen** ergänzen — neue HackathOERn-Editionen, andere Events
7. **System → Backup** vor größeren Operationen — und gelegentlich Off-Site sichern
   ([siehe Kapitel 5](05-backup-restore.md))

## Wichtige Sicherheits-Hinweise

| Aktion | Konsequenz |
|---|---|
| **Löschen einer Idee** | unwiderruflich, edu-sharing-Repo wird auch geleert. Lieber „Verstecken" |
| **Verstecken** | Soft-Delete in der App-DB. Idee bleibt in edu-sharing erhalten, ist aber für Besucher unsichtbar. **Reversibel** |
| **Sammlung löschen** | Geht nur, wenn die Sammlung leer ist. Sub-Sammlungen müssen zuerst geleert werden |
| **Reference entfernen** | Originalknoten bleibt in der Inbox, nur die Verknüpfung zur Sammlung weg |
| **Bulk-Operationen** | Pro-Item-Fehler werden gesammelt + im Result-Body zurückgemeldet, Gesamtaufruf bricht **nicht** ab |

## Was sind „Reference" vs. „Direct-Child"?

Aktuelle Convention seit Mai 2026: alle Ideen liegen als **Original** in der
HackathOERn-Community-Inbox und werden als **Reference** in die thematischen
Challenge-Sammlungen verlinkt.

```
HackathOERn-Inbox (Sammlung)
└── fAIr (ccm:io, Original)           ← echte Bytes + Metadaten
        ↑
        │ originalId
        │
Bewertungsmechanismen / QA (Challenge-Sammlung)
└── fAIr-Reference (ccm:io_reference) ← Pointer auf das Original
```

**Vorteile dieses Patterns:**
- Eine Idee kann gleichzeitig in mehreren Sammlungen erscheinen
- Edits am Original wirken überall
- ACLs bleiben stabil
- Sync ist deterministisch

Wenn die App-UI „Verschieben" sagt, macht sie tatsächlich **addReference** —
das Original bleibt in der Inbox.

→ Details: [Kapitel 2 — Postfach: Ideen einsortieren](02-postfach-einsortieren.md)

## Häufig genutzte URLs

| Was | URL |
|---|---|
| Mod-Bereich direkt | `?view=moderation` |
| Edu-sharing-Repo-UI (zur Original-Knoten-Inspektion) | `https://redaktion.openeduhub.net/edu-sharing/` |
| OpenAPI-Schema deiner App | `<host>/docs` |
| Health-Check | `<host>/api/v1/health` |

## Was, wenn etwas schiefgeht?

1. **Aktivität-Tab** öffnen + nach roten Fehlern filtern — fast jeder Fehler
   ist dort als Activity-Log-Eintrag dokumentiert
2. **Backup** aus dem Backup-Tab herunterladen, bevor du eine größere Aktion
   machst (Bulk-Restore, große Umstrukturierung)
3. **Im Repo direkt** prüfen (`https://redaktion.openeduhub.net/edu-sharing/`)
   — als Single-Source-of-Truth gibt edu-sharing immer das endgültige Bild

---

→ Weiter mit [Kapitel 2: Postfach: Ideen einsortieren](02-postfach-einsortieren.md)
