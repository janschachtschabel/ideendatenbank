# 3. Herausforderungen pflegen

Der **Herausforderungen**-Tab im Mod-Bereich verwaltet die Sammlungs-Hierarchie:
Top-Themen (Ebene 1) und ihre Unter-Bereiche (Ebene 2 — die eigentlichen
„Challenges").

## Struktur

```
Themengebiet (Top-Level)
├── Herausforderung 1 (mit n Ideen drin)
├── Herausforderung 2
└── Herausforderung 3
```

In edu-sharing sind das `ccm:map`-Knoten unter der konfigurierten Wurzel-Sammlung
(`IDEENDB_ROOT_COLLECTION_ID`). Die App spiegelt sie automatisch im Postfach
nach jedem Sync.

## Neue Herausforderung anlegen

Oben rechts im Tab:

| Feld | Beispiel |
|---|---|
| Eltern-Sammlung | „Top-Level (neue Herausforderung)" → erzeugt ein neues Themengebiet |
| | ODER ein bestehendes Themengebiet wählen → erzeugt eine Sub-Challenge |
| Titel | „Mangelnde Metadatenstandards" |

Klick **„+ Anlegen"** legt im edu-sharing-Repo ein neues `ccm:map` an. Erscheint
sofort in der Liste.

## Eine Herausforderung bearbeiten

Bleistift-Icon ✎ neben dem Titel:

| Feld | Bedeutung |
|---|---|
| **Titel** | Wird in Filter-Pillen, Detail-Seiten + edu-sharing angezeigt |
| **Beschreibung** | Optional, erscheint im Detail-Header des Sammlungs-Hubs |
| **Vorschaubild** | Optional, ersetzt das Default-Placeholder-Icon |

„Speichern" schreibt die Änderungen direkt am ES-Knoten.

## Sortierreihenfolge

Pro Zeile ▲▼-Buttons zum Verschieben. Reihenfolge wird in der App-DB
gespeichert (`sort_order`-Spalte) und beim Rendern auf Startseite +
Filter-Dropdowns angewandt.

> Die Sortierung ist **app-spezifisch** und wird **nicht** in edu-sharing
> gespiegelt. Andere Tools, die dasselbe Repo nutzen, sehen ihre eigene
> Reihenfolge.

Nach einer Umsortierung erscheint oben **„✓ Reihenfolge speichern"** — bis du das
klickst, sind Änderungen nur lokal in deinem Browser sichtbar.

## Vorschaubild hochladen

🖼 **Vorschaubild**-Button im Edit-Modus. Bild-Datei auswählen (PNG/JPG, ideal
16:9). Wird sofort hochgeladen + im edu-sharing am Sammlungs-Knoten gesetzt.

## Eine Herausforderung löschen

🗑-Button. **Nur möglich**, wenn die Sammlung leer ist:
- Keine Sub-Sammlungen
- Keine referenzierten Ideen

Bei vollen Sammlungen ist der Button disabled mit Tooltip „Sammlung ist nicht
leer". Workaround:
1. Erst alle Ideen in andere Sammlungen umhängen (Reference umsetzen)
2. Erst alle Sub-Sammlungen entfernen
3. Dann die Eltern-Sammlung löschen

## Idee-Counter pro Sammlung

Hinter jedem Sub-Topic steht z.B. `(5 Ideen)`. Counter werden beim Tab-Öffnen
geladen — bei vielen Sammlungen kann das einige Sekunden brauchen.

> Der Counter zählt **eindeutige Ideen pro Topic** (Reference-IDs aus dem
> Cache). Wenn eine Idee in mehreren Sammlungen referenziert ist, wird sie
> pro Sammlung gezählt — Summe der Counter ≠ Gesamt-Anzahl Ideen.

## Was passiert mit App-Cache nach Topic-Edit?

| Aktion | Sync-Verhalten |
|---|---|
| Neue Sammlung anlegen | Erscheint sofort in der UI + nach nächstem Sync im Cache |
| Titel/Beschreibung ändern | Direkt im ES geschrieben + App-Cache via refresh_topic synchronisiert |
| Vorschaubild hochladen | Direkt am ES-Knoten gesetzt + Cache refresht |
| Sammlung löschen | Aus ES entfernt + Cache-Row gelöscht |

## Nicht in der UI: Drag-and-Drop

Die Sortierung läuft über ▲▼-Buttons, nicht über Drag-and-Drop. Bewusst — DnD
wäre auf Touch-Geräten unbequem und führt zu versehentlichem Verschieben.

## Manuelle Eingriffe im edu-sharing-Repo

Wer fortgeschrittenen Bedarf hat (Sammlungs-Typ als EDITORIAL setzen, ACL-
Anpassungen, Sammlungen außerhalb der Wurzel verschieben), greift direkt in
der edu-sharing-Web-UI ein. Die App holt sich die neuen Daten beim nächsten
Sync.

→ Details zu edu-sharing-Permissions: [Kapitel 7](07-permissions-architektur.md)

## Typische Workflows

### Eine neue HackathOERn-Edition vorbereiten

1. **Veranstaltung anlegen** im Veranstaltungen-Tab (z.B. `hackathoern-4` /
   „HackathOERn 4")
2. **Optional: neues Themengebiet** oder neue Sub-Challenges anlegen, falls
   die Edition thematische Schwerpunkte hat
3. **Sortierung anpassen** — relevante Challenges nach oben
4. **QR-Code teilen** (im Events-Tab) für Plakate

### Nach einem Event: Aufräumen

1. **Postfach prüfen** — alle Einreichungen einsortiert?
2. **Statistik kontrollieren** — welche Challenges am aktivsten?
3. **Leere Sammlungen löschen** — falls Challenges sich als nicht relevant
   herausgestellt haben
4. **Phase setzen** — eingereichte Ideen, die nicht weitergeführt werden,
   auf „archiviert"

---

→ Weiter mit [Kapitel 4: Versteckt + Meldungen](04-versteckt-meldungen.md)
