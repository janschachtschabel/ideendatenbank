# Screenshots

Visuelle Hilfen zur Doku. Dieser Ordner ist als Halde gedacht — die einzelnen
Markdown-Kapitel können von hier auf Bilder verweisen.

## Empfohlene Screenshots (TODO)

Beim eigenen Erstellen Bildmaterial bitte unter aussagekräftigen Dateinamen
hier ablegen und in der jeweiligen `.md` referenzieren als
`![Beschreibung](../screenshots/dateiname.png)`.

### Für das Benutzerhandbuch

| Datei | Was zeigen |
|---|---|
| `01-startseite.png` | Vollansicht der Startseite mit „Neueste Ideen" + „Herausforderungen durchstöbern" |
| `02-ideen-uebersicht-filter.png` | Filter-Reihen Phase/Veranstaltung/Herausforderung/Bereich mit aktivem Filter |
| `02-detail-ansicht.png` | Detail einer Idee mit Beschreibung + Sidebar + Anhängen |
| `02-rangliste.png` | Rangliste mit ▲▼-Pfeilen + „Top-Steiger"-Block |
| `03-submit-formular.png` | Idee-Einreichen-Formular |
| `04-mitmachen-folgen.png` | Sidebar einer Detail-Seite mit Mitmachen/Folgen-Knöpfen + Avatar-Reihe |
| `05-mein-bereich.png` | „Mein Bereich" mit den 4 Tabs |
| `05-public-profil.png` | Öffentliches Profil einer Person |
| `06-embed-doku.png` | Embed-Seite mit Code-Snippets |

### Für das Moderations-Handbuch

| Datei | Was zeigen |
|---|---|
| `mod-01-tabs.png` | Die 10 Tabs in der Mod-Topbar |
| `mod-02-postfach-filter.png` | Postfach mit den 4 Anzeige-Filtern + Item-Karten |
| `mod-02-bulk-bar.png` | Bulk-Move-Bar mit Auswahl + Ziel-Dropdown |
| `mod-03-herausforderungen.png` | Sammlungs-Editor mit Top-Level + Sub-Topics |
| `mod-04-versteckt.png` | Versteckt-Tab + Wiederherstellen-Knopf |
| `mod-04-meldungen.png` | Reports-Liste mit „Erledigt"-Workflow |
| `mod-05-backup-tab.png` | Backup-Tab mit Liste + Erstellen/Hochladen-Buttons |
| `mod-06-statistik.png` | Statistik-Dashboard komplett |
| `mod-06-aktivitaet.png` | Aktivitäts-Log mit Filtern + Mod-Pille |

## Wie aufnehmen?

### Lokale Demo starten
```bash
# Backend
cd backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Browser
http://localhost:8000/
```

### Themes durchschalten
Rechts oben in der Topbar — drei Farbquadrate.

Für die Doku empfohlen: **default-Theme** (dunkelblau) — kontrastreichste
Bilder für PDF/Print.

### Größe + Format
- Format: PNG (verlustfrei)
- Breite: 1600–1920 px (für Retina, in PDF skaliert)
- Browser-Zoom 100%
- Browser-Fenster maximiert oder fixe Breite (z.B. 1440 px für konsistente Ansicht)

### Werkzeuge
- **Windows**: Snipping Tool, ShareX
- **Chrome DevTools**: F12 → Cmd-Shift-P → „Capture full size screenshot"
- **Firefox**: Rechtsklick → „Screenshot aufnehmen"
- **macOS**: Cmd-Shift-4

### Anonymisierung
Wenn echte User-Daten in Screenshots auftauchen, vorher anonymisieren:
- Test-Account anlegen mit neutralem Namen (z.B. „demo-user")
- Persönliche Daten/IDs überdecken (DevTools Edit-Modus oder Bildbearbeitung)

## Verlinkung aus den Kapiteln

Beispiel in `benutzerhandbuch/02-ideen-stoebern.md`:

```markdown
## Tile-Grid

Pro Idee zeigt die Kachel: Vorschaubild, Titel, Pillen, Beschreibung, Footer.

![Ausschnitt der Ideen-Übersicht mit aktivem Filter](../screenshots/02-ideen-uebersicht-filter.png)
```

Wenn das Dokument als PDF gerendert wird (z.B. via Pandoc), bleiben die Bilder
erhalten — relative Pfade funktionieren.
