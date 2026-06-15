# 2. Ideen stöbern, suchen und filtern

## Startseite

Ein Schnellblick auf das Aktuellste:
- **Aktuelle Veranstaltung** — hervorgehobenes Event (falls vorhanden) mit „Idee einreichen" + „Jetzt voten"
- **Neueste Ideen** — 8 Kacheln, sortiert nach Änderungsdatum. „Mehr laden" für weitere
- **Themenbereiche** — Übersicht der Hauptthemen (Sammlungen Ebene 1)
- **Veranstaltungen** — die kuratierten Events als Kacheln

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
| **Bewertung** | höchster Sterne-Schnitt zuerst — im Daumen-Modus zählt stattdessen die Zahl der Likes |
| **Kommentare** | meist diskutiert zuerst |
| **Name** | alphabetisch |

Pfeil ↑↓ daneben kehrt die Reihenfolge um.

### Filter-Pillen

| Pille | Auswahl |
|---|---|
| **Sortierung:** | wählt das Sortierfeld (siehe oben); daneben kehrt ein Pfeil ↑↓ die Richtung um |
| **Phase:** | Anregung · Pitch-bereit · In Umsetzung · Abgeschlossen · Archiviert |
| **Veranstaltung:** | HackathOERn 1, 2, 3, … (alle kuratierten Events) |
| **Themenbereich:** | alle Top-Themen (Ebene-1-Sammlungen) |
| **Herausforderung:** | erscheint **nur**, sobald ein Themenbereich gewählt ist (zeigt dessen Unter-Sammlungen) |

Jede Pille hat einen kleinen Counter, der die Anzahl Ideen mit diesem Filter
zeigt. Aktive Pille ist dunkelblau hervorgehoben. „Alle" setzt die jeweilige
Filter-Spalte zurück. Ist mindestens ein Filter (oder eine Suche) aktiv,
erscheint zusätzlich ein zentrales **„✕ Filter zurücksetzen"**, das alles auf
einmal leert.

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
- **Dokumente** (PDF, Bilder, Dateien — direkt herunterladbar; Eingeloggte können Anhänge ergänzen)
- **Kommentare** mit Reply-Funktion

### Sidebar
- **Bewertung / Zustimmung** — Sterne (1–5) oder Daumen 👍, je nach eingestelltem
  Modus; klickbar wenn eingeloggt. Kann auch geschlossen sein („Bewertung abgeschlossen")
- **Teilen …** — ein Button öffnet ein Fenster mit Direkt-Link, QR-Code und Embed-Snippet
- **Mithacken / Folgen** (eingeloggt)
- **Aktionen** (Bearbeiten, Löschen, Aus Repo aktualisieren, Im edu-sharing öffnen, Melden — je nach Rolle)
- **Status & Veranstaltung** als Quick-Edit (Phase, Veranstaltung; Herausforderung nur für Mods — Owner/Mod)

## Themenbereiche

Übersichtsseite mit allen Themenbereichen als Karten. Klick auf einen Themenbereich
öffnet seine Herausforderungen (Unter-Sammlungen) + alle Ideen darin. Drilldown bis
zu zwei Ebenen tief.

## Veranstaltungen

Hub für die kuratierten HackathOERn-Editionen + andere Events. Pro Veranstaltung:
- Beschreibung
- Liste der zugeordneten Ideen
- **Share + QR-Code** (rechts oben, ideal für Plakate)

## Rangliste

Drei Ranglisten in einer:
- **Top nach Bewertung** — Summe der Sternpunkte (im Daumen-Modus: Anzahl der Daumen)
- **Top nach Kommentaren** — meist diskutiert
- **Top nach Mithacken** — meiste Mithackende

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
?view=events&event=hackathoern-3   (direkt auf die Eventseite)
?view=ranking
?view=ranking&event=hackathoern-3
```

Praktisch für Vorlesungen, Slides oder QR-Codes.

---

→ Weiter mit [Kapitel 3: Idee einreichen](03-idee-einreichen.md)
