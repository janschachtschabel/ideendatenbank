# 3. Idee einreichen

## Der typische Ablauf

```
Du                  Mod-Team             edu-sharing-Repo
─────               ─────────             ────────────────
                                                         
1. Formular   →  Inbox-Sammlung
   ausfüllen     ("Postfach")
                                                         
                  2. Postfach prüfen
                     Idee öffnen,
                     ggf. nachfragen
                                                         
                  3. In Herausforderung
                     einsortieren
                     (= Reference setzen)  → in Sammlung 
                                            sichtbar
                                                         
4. Bearbeitung   ←  ggf. Phase/Event
   möglich,         setzen, freigeben
   Anhänge
   ergänzen
                                                         
                                          ⇄ Sync
                                            (alle 5 Min)
                                                         
5. Idee jetzt für alle als Kachel
   in der App sichtbar
```

## Schritt 1 — Klick auf „Idee einreichen"

Den **gelben Button** in der Topbar — oder, wenn gerade ein Event hervorgehoben
ist, „Idee einreichen" im Slot „Aktuelle Veranstaltung" auf der Startseite (dann
ist die Veranstaltung gleich vorausgewählt). Geht sowohl angemeldet als auch anonym.

> 💡 **Wir empfehlen ein Login**, weil du dann später deine Idee bearbeiten kannst.
> Anonyme Einreichungen sind möglich, aber nicht mehr änderbar.
> → [Hier kostenlos bei WLO registrieren](https://ideenbank.hackathoern.de/edu-sharing/components/register)

## Schritt 2 — Pflichtfelder ausfüllen

| Feld | Pflicht? | Hinweis |
|---|---|---|
| **Titel** | ✅ | mindestens 3 Zeichen, sollte den Kern in einem Satz fassen |
| **Themenbereich / Herausforderung** | optional | Vorschlag, in welche Sammlung die Idee soll. Mod entscheidet final. |
| **Phase** | optional | Default: „offen". Du kannst auch direkt „Pitch-bereit" wählen, wenn schon weiter |
| **Veranstaltung** | ✅ | Genau **eine** Veranstaltung wählen — oder ausdrücklich „Keine Veranstaltungszugehörigkeit". Über einen Event-Link ist sie ggf. schon vorausgewählt. |
| **Beschreibung** | optional, aber sehr empfohlen | Was ist die Idee, für wen, welcher Mehrwert, was wird gebraucht? Links/URLs kannst du direkt hier einfügen. |
| **Dein Name / Kontext** | optional | Erscheint öffentlich als Ideengeber:in (z.B. „Teilnehmer:in OER-Camp 2025") |
| **Projekt-Link** | optional | URL zu Demo, Repo, Konzept-Doc |
| **Schlagwörter** | optional | Komma-getrennt, z.B. Metadaten, KI, Barrierefreiheit |
| **Kontakt für Rückfragen** | optional | Nur bei Login: E-Mail oder Link für Rückfragen & Mithackende. Wird **nur gespeichert, wenn du der Einwilligungs-Checkbox zustimmst**, und ist nur für eingeloggte Nutzer:innen sichtbar. |

## Schritt 3 — Anhänge & Vorschaubild (optional)

Beides kannst du **direkt im Einreich-Formular** hinzufügen, schon **vor** dem
ersten Speichern:

- **Datei-Anhänge** (PDFs, Bilder, Pitch-Decks, …) — bis zu **4 Stück** beim
  Einreichen. Jeder Anhang ist ein eigenes Dokument und lässt sich später einzeln
  austauschen oder entfernen, ohne die Idee selbst zu ändern. Weitere Anhänge gehen
  jederzeit nachträglich über „Bearbeiten".
- **Vorschaubild** — wird oben auf der Kachel und der Detailseite gezeigt.
  Empfehlung: 16:9-Verhältnis, < 500 KB.

Du kannst sie natürlich auch erst später über das **Bearbeiten-Modal**
(Bleistift-Icon in der Aktionen-Sidebar) nachreichen.

## Schritt 4 — Submit

**Anonyme Einreichungen** müssen kurz eine kleine **Rechenaufgabe** lösen
(z.B. „Was ist 3 + 7?"). Das hält automatischen Spam fern und kommt ohne
Drittanbieter / Tracking aus. Mit WLO-Login entfällt dieser Schritt.

Klick auf „Idee einreichen". Sofortige Bestätigung:

> ✓ Deine Idee wurde im Moderations-Postfach eingereicht. Das Team prüft sie und ordnet sie der passenden Herausforderung zu.

## Was passiert dahinter?

1. Die App schreibt die Idee als `ccm:io` (Lerninhalt) in die **HackathOERn-Inbox**
   im edu-sharing-Repo
2. Standardmäßig werden gesetzt: **Lizenz CC BY 4.0**, **Sprache: Deutsch**,
   Replikations-Quelle: hackathoern-ideendatenbank (für die Mod-Übersicht)
3. Falls du eingeloggt warst, wird dein Username als **Submitter** vermerkt —
   du kannst die Idee später bearbeiten/löschen
4. Sie erscheint sofort im Mod-Postfach unter `Anzeigen: Ohne Sammlung`

## Schritt 5 — Freischaltung (Mod-Team)

Das Mod-Team prüft die Einreichung und:
- **Sortiert sie in eine Herausforderung** (per Drag/Drop oder via Dropdown)
- Setzt optional Phase oder Veranstaltung neu
- Veröffentlicht sie damit auf der Ideen-Übersichtsseite

Nach dieser Aktion ist deine Idee öffentlich. Du wirst (Stand jetzt) **nicht
automatisch benachrichtigt**, kannst aber im Profil-Bereich („Was ist neu") die
Phasen-Wechsel + Kommentare an deiner Idee verfolgen.

## Schritt 6 — Nachträgliches Bearbeiten

Auf der Detail-Seite siehst du (als Owner) die Aktionen-Sidebar mit:
- **✎ Bearbeiten** — öffnet das Modal mit allen Feldern (Titel, Beschreibung,
  Tags, Vorschaubild, Hauptdatei ersetzen, Phase, Event)
- **🗑 Löschen** — entfernt die Idee komplett (Bestätigungs-Dialog)
- **Aus Repo aktualisieren** — frische ES-Metadaten ziehen (nützlich, wenn du
  parallel direkt im Repo etwas geändert hast)

Phase-Workflow ist linear: nur „eine Stufe weiter" pro Owner-Edit. Größere
Sprünge oder Rückwärtsbewegung sind dem Mod-Team vorbehalten.

## Tipps für eine gute Idee-Einreichung

1. **Aussagekräftiger Titel** — was ist der Kern in einem Satz?
2. **Zielgruppe nennen** — wer profitiert von dieser Idee?
3. **Kontext + Bedarf** — welches Problem löst es?
4. **Wer wird gebraucht?** — IT, Design, Redaktion, Forschung? Hilft beim Vernetzen.
5. **Konkrete erste Schritte** — wo könnte man anfangen?
6. **Lizenz beachten** — Default ist CC BY 4.0. Wer enger braucht, kann nachträglich
   per direkt-im-Repo-Edit ändern (Mod-Bereich oder edu-sharing-Web-UI).

## Häufige Fragen

**Muss ich technisch versiert sein?**
Nein. Die Idee allein zählt — Umsetzung kann später ein Team übernehmen.

**Werden meine Daten gespeichert?**
Titel, Beschreibung, Autorname und ggf. dein Login-Username sind öffentlich.
Eingaben werden nicht für Werbung oder Tracking genutzt. Details im
[Impressum + Datenschutz](?view=privacy) der App.

**Wie schnell wird meine Idee freigeschaltet?**
Das hängt vom Mod-Team ab — üblich sind Stunden bis wenige Tage.

**Was, wenn meine Idee abgelehnt wird?**
Tatsächliche Ablehnungen sind selten — meistens wird umsortiert oder das Team
fragt nach Klarstellung im Kommentar. Wenn etwas grundsätzlich nicht passt,
bekommt es das Soft-Delete-Flag (Versteckt) statt vollständig gelöscht zu werden.

---

→ Weiter mit [Kapitel 4: Mithacken, Folgen, Bewerten, Kommentieren](04-mitmachen-bewerten.md)
