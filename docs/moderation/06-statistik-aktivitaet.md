# 6. Statistik und Aktivitätsprotokoll

## 📊 Statistik-Tab

Übersichts-Dashboard mit allen relevanten KPIs. Lädt automatisch beim Tab-Öffnen.

### KPI-Karten (oben)

Acht Kacheln mit Live-Zahlen:

| KPI | Was wird gezählt |
|---|---|
| **Ideen** | Anzahl Ideen im Public-Cache (ohne versteckte) |
| **Herausforderungen** | Top-Level-Themen-Sammlungen |
| **Herausforderungen** (Sub) | Sub-Sammlungen (Challenges) |
| **Kommentare** | Total über alle Ideen |
| **Schnitt-Bewertung** (mit Zähler) | ø-Sterne über alle bewerteten Ideen |
| **🤝 Mitmachen** | Total „Mitmachen"-Marker |
| **🔔 Folgen** | Total „Folgen"-Marker |
| **⚠ Offene Meldungen** (rot wenn > 0) | Reports, die noch nicht erledigt sind |

### Neue Ideen pro Woche (Chart)

Säulen-Chart der letzten 12 Wochen, basierend auf `created_at` der Ideen.
Zeigt sofort, ob die Aktivität steigt/fällt.

### Phasen-Verteilung

Horizontale Balken pro Phase mit Anzahl Ideen. Hilft zu sehen, ob viele Ideen
in „Anregung" hängen bleiben (= Energie verloren) oder schnell durchlaufen.

### Veranstaltungs-Verteilung

Wie viele Ideen sind pro Event eingereicht? Praktisch zur Vorbereitung von
nachfolgenden Editionen — welche Themen wurden bisher abgedeckt, wo ist Lücke.

### Top-Aktive User (30 Tage)

Welche Benutzer haben in den letzten 30 Tagen die meisten Aktivitäten erzeugt
(Kommentare, Bewertungen, Einreichungen)? Hilft, Community-Schlüsselfiguren zu
erkennen.

### Top-Engagement-Ideen

Liste der zehn aktivsten Ideen nach Rating + Kommentare + Mitmachen-Counts.
Nützlich für Highlights in Newslettern oder Präsentationen.

### Aktivität nach Typ (30 Tage)

Welche App-Aktionen wurden am häufigsten ausgeführt? Z.B. `idea_submitted`,
`idea_moved`, `comment_posted`, `auth_failed`. Auffällige Spitzen lohnen einen
Blick ins Activity-Log.

### Pflicht-Metadaten nachpflegen

Knopf für einen Wartungs-Job. Klick führt einen Bulk-Backfill aus:
- Für bis zu 200 Ideen wird geprüft, ob `ccm:commonlicense_key`, `_cc_version`,
  `cclom:general_language`, `ccm:replicationsource` gesetzt sind
- Fehlende Felder werden mit Defaults (CC BY 4.0, Deutsch) ergänzt
- Pro Idee einzelner Aufruf, Fehler werden gesammelt + im Result gezeigt

Wann nutzen? Wenn die WLO-Redaktion einen Sammel-Freigabe-Lauf macht und
„unvollständige Metadaten"-Warnings auftauchen. Default-Werte sind so gewählt,
dass sie für die meisten Ideen passen.

## 📝 Aktivitäts-Log

Vollständiges Audit-Log aller App-Schreibvorgänge. Liest aus der
`activity_log`-Tabelle.

### Filter

| Filter | Werte |
|---|---|
| **Aktion** | Dropdown mit allen vorkommenden Actions (z.B. `idea_submitted`, `idea_moved`, `idea_hidden`, `comment_posted`, `auth_failed`, `backup_created`) |
| **Akteur (Username)** | Freitext-Filter |
| **Zeitraum** | „Letzte 24h", „Letzte 7 Tage", „Letzte 30 Tage" |

### Zeilen-Anatomie

```
[20.05., 14:30]  Mod  janschachtschabel  · Idee verschoben nach „KI-Unterstützung"
       │           │       │                          │
       │           │       │                  Action-Text (mit verlinkter Idee)
       │           │       Username
       │           Mod-Pille (orange)
       Zeitstempel
```

### Wichtige Action-Typen

| action | Bedeutung |
|---|---|
| `idea_submitted` | Neue Idee in der Inbox |
| `idea_moved` | Idee in Sammlung referenziert |
| `idea_topic_changed` | Idee in andere Sammlung umgehängt |
| `idea_edited` | Owner/Mod hat Metadaten geändert |
| `idea_deleted` | Idee komplett gelöscht (vorsicht!) |
| `idea_hidden` | Soft-Delete |
| `idea_unhidden` | Soft-Delete zurückgenommen |
| `comment_posted` | Neuer Kommentar |
| `comment_deleted` | Kommentar entfernt |
| `report_submitted` | User hat eine Idee gemeldet |
| `report_resolved` | Mod hat Meldung als erledigt markiert |
| `phase_changed` | Idee-Phase geändert |
| `attachment_uploaded` | Datei an Idee angehängt |
| `attachment_deleted` | Anhang entfernt |
| `topic_*` | Sammlungs-Aktionen (anlegen, ändern, löschen) |
| `mod_added`/`mod_removed` | Mod-Gruppen-Verwaltung |
| `backup_created`/`backup_restored` | Backup-Operationen |
| `auth_failed` | Fehlgeschlagener Mod-Login-Versuch |
| `publication_meta_backfilled` | Pflicht-Metadaten-Lauf |

### CSV-Export

Knopf **⬇ CSV** lädt das aktuelle Filter-Ergebnis als CSV runter — für externe
Audits oder Excel-Analysen.

## Wann ins Activity-Log schauen?

| Situation | Filter |
|---|---|
| „Wer hat diese Idee zuletzt geändert?" | Aktion = `idea_edited` + Suche im Detail |
| „Wieso ist meine Idee weg?" | Aktion = `idea_deleted` oder `idea_hidden`, Akteur + Zeitraum |
| „Spam-Welle oder Brute-Force-Versuche?" | Aktion = `auth_failed`, Zeitraum „Letzte 24h" |
| „Was hat Mod X die letzte Woche gemacht?" | Akteur = X, Zeitraum „Letzte 7 Tage" |
| „Backups laufen?" | Aktion = `backup_created`, Zeitraum „Letzte 30 Tage" |

## Audit-Log-Aufbewahrung

Standardmäßig wird das `activity_log` bei jedem Sync-Lauf gepflegt — alte
Einträge älter als 90 Tage werden entfernt (`ACTIVITY_LOG_KEEP_DAYS`). Die
letzten 10 000 Einträge bleiben mindestens (`ACTIVITY_LOG_KEEP_ROWS`), egal wie
alt.

Möchtest du längere History → vor Backups herunterladen + extern lagern.

---

→ Weiter mit [Kapitel 7: Permissions & Architektur](07-permissions-architektur.md)
