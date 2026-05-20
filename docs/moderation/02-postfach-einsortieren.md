# 2. Postfach: Ideen einsortieren

Die Kernaufgabe der Moderation. Wer sind die neuen Einreichungen, gehören sie zu
welcher Herausforderung, sind sie spam oder schon mal eingereicht?

## Die vier Anzeigen-Filter

Oben im Postfach-Tab vier Textlinks:

| Filter | Was wird gezeigt | Typischer Use-Case |
|---|---|---|
| **Ohne Sammlung** (Default) | ccm:io-Items in der Inbox, die **noch nirgends referenziert** sind | tägliche Arbeitsliste |
| **Alle** | Alle ccm:io-Items in der Inbox, egal ob schon irgendwo zugeordnet | Gesamt-Übersicht zur Reproduzierbarkeit |
| **In Sammlung** | Items, die bereits als Reference irgendwo zugeordnet sind | um nachzuvollziehen, was schon eingepflegt wurde |
| **App-Einreichungen** | Items, die App-Konvention-Marker tragen (`phase:`, `event:`, `target-topic:`) | nur die durchs eigene Submit-Formular gelaufenen |

Hinter jedem Link steht in Klammern die aktuelle Anzahl, z.B. `Ohne Sammlung (13)`.
Counter laden automatisch beim Tab-Öffnen.

## Eine Idee einsortieren (Reference setzen)

1. **Idee öffnen** — Vorschau lesen (Beschreibung, Anhänge, Schlagwörter)
2. **Optional: in Repo öffnen** — falls technisches Detail unklar, mit dem
   „Im Repo öffnen"-Knopf direkt zur Edusharing-Web-UI
3. **Ziel-Herausforderung wählen** — Dropdown auf der Item-Karte
4. **„➜ Verschieben"** klicken

Im Hintergrund passiert:
- API ruft `PUT /collection/.../references/{node-id}` auf
- Im Ziel entsteht ein `ccm:io_reference`-Knoten mit `originalId = <inbox-node>`
- Das Original bleibt in der Inbox — du kannst es jederzeit in eine weitere
  Sammlung referenzieren
- Im App-Cache wird die Inbox-Original-Row beim nächsten Sync-Tick aufgeräumt;
  die neue Reference-Row erscheint in der Public-Liste

**Was passiert wenn die Idee schon dort ist?**
Server gibt 409 zurück — die App schluckt das als „no-op". Anzeige: „Bereits in
dieser Herausforderung."

## Bulk-Move (mehrere Ideen auf einmal)

Pro Item-Karte ist links eine **Checkbox**. Mehrere markieren →

```
3 ausgewählt   [Dropdown: Ziel-Herausforderung]   ➜ Alle verschieben
```

Erscheint oben als Bulk-Bar. Alle markierten Ideen werden parallel
referenziert. Pro-Item-Fehler werden gesammelt und am Ende gezeigt:

```
✓ 3 verschoben nach „KI-Unterstützung bei OER-Erstellung"
```

## Eine Idee löschen

Direkt auf der Item-Karte: 🗑 **Löschen**. Bestätigungs-Dialog.

⚠ **Achtung**: Löschen entfernt den Knoten aus edu-sharing **vollständig** — nicht
reversibel. Für „verstecken statt löschen" siehe [Kapitel 4](04-versteckt-meldungen.md).

Wann löschen vs. verstecken?
- **Löschen**: echter Spam, doppelt eingereicht, sicher unbrauchbar
- **Verstecken**: strittige Inhalte, evtl. wertvoll, soll nur nicht angezeigt werden

## Im Repo öffnen

Knopf **„↗ Im Repo"** auf jeder Item-Karte. Öffnet die Edusharing-Web-UI mit
dem Knoten in der Detail-Ansicht. Praktisch für:
- ACL-Inspektion
- Manuelle Eingriffe am Knoten (Metadaten, Permissions)
- Vergleich zwischen App-Sicht und Repo-Realität

## Typische Probleme

### „Ich sehe die Idee nicht im Postfach, obwohl sie eingereicht wurde"

Mögliche Ursachen:
1. **Sie wurde direkt im Repo angelegt** → erscheint nur unter Filter „Alle"
2. **Sync hat noch nicht gegriffen** → max. 5 Min. warten, oder Postfach-Tab schließen + öffnen
3. **Sie wurde schon irgendwo referenziert** → erscheint unter „In Sammlung"

### „Die Idee ist in der falschen Sammlung gelandet"

Im **Detail-Bereich der Idee** (über Klick aus dem Postfach erreichbar) gibt's
in der Sidebar einen „Herausforderung"-Dropdown (Mod-only). Auswahl ändern →
sofort wird die Reference umgehängt: alte raus, neue rein. Original-Inhalt
bleibt intakt.

### „Die Idee soll in zwei Sammlungen erscheinen"

Funktioniert nicht direkt im Postfach (Bulk-Move zielt auf eine Sammlung). Aber:
1. Idee zur Sammlung A verschieben (im Postfach)
2. Detail-Seite der referenzierten Idee öffnen
3. (Wenn der Endpoint dafür eingerichtet ist:) Bulk-Reference auf Sammlung B —
   sonst manuell im edu-sharing-Web-UI „Zu Sammlung hinzufügen"

Beachte: die App-DB-Cache zeigt die Idee unter **einer** Topic-ID (die zuletzt
gesetzte Reference). Die zweite Reference ist im Repo da, aber die App-Listen-Sicht
zeigt nur die erste.

## Datenfluss-Übersicht

```
User submittet              edu-sharing-Inbox       App-Postfach
─────────────              ────────────────────     ────────────
                                                                    
  Submit-Form  ─────→  ccm:io ANLEGEN  ─────→  erscheint unter
                       in 98fcbe56...           "Ohne Sammlung"
                       als Child                                     
                                                                    
  Mod öffnet                                                         
  + wählt Topic                                                      
                                                                    
  "Verschieben"  ───→  PUT references ────→     erscheint dort als
                       in Challenge X            Reference in App-
                       (= addReference)          Liste, Inbox-Row
                                                 raus (Cleanup)
```

## Best Practices

1. **Lies die Beschreibung wirklich** bevor du in eine Challenge sortierst — viele
   Einreichungen haben präzise Hinweise zur Zielsammlung im Text
2. **Nutze den `target-topic:`-Vorschlag** des Submitters, falls vorhanden (zeigt der UI als „➜ Sammlung-X" tag)
3. **Bei Unsicherheit: kommentiere** statt löschen — Owner kriegt's mit, Klärung möglich
4. **Verstecken statt Löschen** für strittige Fälle. Reversibel, edu-sharing-Repo bleibt sauber
5. **Bulk-Aktionen für Aktions-Wellen** (z.B. nach einem HackathOERn-Event mit vielen Einreichungen)

---

→ Weiter mit [Kapitel 3: Herausforderungen pflegen](03-herausforderungen-pflegen.md)
