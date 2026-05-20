# 2. Ideen stöbern, suchen und filtern

## Startseite

Ein Schnellblick auf das Aktuellste:
- **Neueste Ideen** — 8 Kacheln, sortiert nach Änderungsdatum. „Mehr laden" für weitere
- **Herausforderungen** — Übersicht der Hauptthemen (Sammlungen Ebene 1)
- **Rangliste-Teaser** — die Top-3 nach Bewertung

Klick auf eine Kachel öffnet die Detail-Ansicht.

## Ideen-Übersicht (`Ideen`)

Die Hauptliste mit allen Ideen — sortierbar, filterbar, durchsuchbar.

### Suchfeld

Volltext-Suche über Titel, Beschreibung und Schlagwörter. Treffer werden
hervorgehoben (`<mark>`). Wenn 0 Treffer kommen, schlägt die App ähnliche
Begriffe und die zuletzt geänderten Ideen vor.

### Sortierung

| Option | Was wird sortiert |
|---|---|
| **Datum (geändert)** | jüngste Änderung zuerst (Default) |
| **Datum (erstellt)** | jüngste Anlage zuerst |
| **Bewertung** | höchster Schnitt zuerst |
| **Kommentare** | meist diskutiert zuerst |
| **Titel** | alphabetisch |

Pfeil ↑↓ daneben kehrt die Reihenfolge um.

### Filter-Pillen (vier Reihen)

| Reihe | Auswahl |
|---|---|
| **Phase:** | Anregung · Pitch-bereit · In Umsetzung · Abgeschlossen · Archiviert |
| **Veranstaltung:** | HackathOERn 1, 2, 3, … (alle kuratierten Events) |
| **Herausforderung:** | alle Top-Themen — Klick öffnet die Detail-Ansicht mit Sub-Bereichen |
| **Bereich:** | erscheint, sobald eine Herausforderung gewählt ist (zeigt die Unter-Sammlungen) |

Jede Pille hat einen kleinen Counter, der die Anzahl Ideen mit diesem Filter
zeigt. Aktive Pille ist dunkelblau hervorgehoben. „Alle" setzt die jeweilige
Filter-Spalte zurück.

> **Filter bleiben sichtbar**, auch wenn eine Kombination 0 Treffer ergibt — so
> findest du immer einen Klick-Weg zurück.

### Tile-Grid

Pro Idee zeigt die Kachel:
- **Vorschaubild** (oder Initialen, falls keins gesetzt ist)
- **Titel** (2 Zeilen reserviert für gleichmäßige Anordnung)
- **Phase + Veranstaltung** als Pillen
- **Beschreibung** (3 Zeilen Vorschau)
- **Bewertung + Kommentaranzahl** im Footer

Klick → Detail-Ansicht.

## Detail-Ansicht einer Idee

Volle Sicht mit allen Informationen:

### Header
- **Breadcrumb**: ← Zurück · Ideen · [Herausforderung] ← die Herausforderung ist klickbar und filtert die Ideen-Liste
- **Titel**
- **Meta**: Autor:in (klickbar → öffentliches Profil), erstellt/geändert-Daten, Projekt-Link
- **Phase + Veranstaltungen** als Pillen

### Hauptspalte
- **Beschreibung** (Markdown-Render, Zeilenumbrüche erhalten)
- **Schlagwörter**
- **Bewertung** (Sterne, klickbar wenn eingeloggt)
- **Anhänge** (PDF, Bilder, Dokumente — direkt herunterladbar)
- **Kommentare** mit Reply-Funktion

### Sidebar
- **Teilen-Buttons** (Link kopieren, E-Mail, WhatsApp, X, …) + Embed-Snippet
- **Mitmachen / Folgen** (eingeloggt)
- **Aktionen** (Bearbeiten, Löschen, Im edu-sharing öffnen, Melden — je nach Rolle)
- **Status-Quick-Edit** (Phase, Veranstaltung — Owner/Mod)

## Herausforderungen

Übersichtsseite mit allen Themengebieten als Karten. Klick auf eine Herausforderung
öffnet die zugeordneten Sub-Sammlungen + alle Ideen darin. Drilldown bis zu zwei
Ebenen tief.

## Veranstaltungen

Hub für die kuratierten HackathOERn-Editionen + andere Events. Pro Veranstaltung:
- Beschreibung
- Liste der zugeordneten Ideen
- **Share + QR-Code** (rechts oben, ideal für Plakate)

## Rangliste

Drei Ranglisten in einer:
- **Top nach Bewertung** — Sterne-Schnitt
- **Top nach Kommentaren** — meist diskutiert
- **Top nach Mitmachen** — meiste Interessenten

Mit Bewegungs-Pfeilen ▲▼ pro Idee, Sparkline der letzten 12 Snapshots und einem
**„Top-Steiger der letzten 7 Tage"**-Block ganz unten.

Filterbar nach Veranstaltung — „alle Events" zeigt das Gesamt-Ranking.

## Suche per URL (für Direkt-Links)

Alle Filter sind URL-Parametern zugänglich. Beispiele:

```
?view=browser&phase=anregung
?view=browser&event=hackathoern-3
?view=detail&id=<idea-uuid>
?view=user&u=<username>
?view=ranking
```

Praktisch für Vorlesungen, Slides oder QR-Codes.

---

→ Weiter mit [Kapitel 3: Idee einreichen](03-idee-einreichen.md)
