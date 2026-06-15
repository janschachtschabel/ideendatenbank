# 1. Einführung

## Was ist die HackathOERn Ideendatenbank?

Eine offene Plattform der OER-Community, auf der **Ideen für Open Educational
Resources (OER)** gesammelt, diskutiert und weiterentwickelt werden. Eingereichte
Ideen finden hier ihren Weg von der ersten Skizze über die öffentliche
Diskussion bis hin zur Pitch-Reife für Hackathon-Veranstaltungen
(HackathOERn 1, 2, 3 …).

Die Datenbank ist eine schlanke Web-App über dem zentralen
edu-sharing-Repository `redaktion.openeduhub.net`. Jede Idee, jeder Kommentar
und jede Bewertung ist dort als Lerninhalt (`ccm:io`) gespeichert — die App ist
nur eine optimierte Sicht darauf.

## Für wen ist die Plattform?

| Rolle | Was du damit machen kannst |
|---|---|
| **Anonymer Besucher** | Stöbern, Filter setzen, Volltext-Suche, Vorschau aller Ideen, Rangliste sehen |
| **Eingeloggter Nutzer** | Zusätzlich: Ideen einreichen, kommentieren, bewerten, „Mithacken", „Folgen", Notifications, eigenes Profil |
| **Moderator/Admin** | Zusätzlich: Inbox-Pflege, Sammlungen verwalten, Inhalte verstecken, Meldungen bearbeiten, Statistik einsehen |

## Welche Vorteile hat ein WLO-Konto?

Ein kostenloses Konto bei [WirLernenOnline (WLO)](https://wirlernenonline.de/)
ist die Eintrittskarte für aktive Mitwirkung:

- 💡 **Ideen einreichen** und nach der Freischaltung als Autor:in genannt werden
- 💬 **Kommentieren und diskutieren** — andere Community-Mitglieder profitieren von deinem Wissen
- ⭐ **Bewerten** — hilft, gute Ideen sichtbar zu machen
- 🤝 **Mithacken** — Signalisiert Interesse, zu einer Umsetzung beizutragen (die Ideengeber:in nimmt dich ins Team auf)
- 🔔 **Folgen + Notifications** — Du wirst informiert, wenn sich an „deinen" Ideen etwas tut
- 👤 **Öffentliches Profil** — deine Ideen werden gebündelt unter deinem Namen sichtbar
- 🛠 **Eigene Ideen bearbeiten** — Beschreibung, Anhänge, Vorschaubild jederzeit aktualisieren

Eine Registrierung dauert eine Minute → [hier registrieren](https://ideenbank.hackathoern.de/edu-sharing/components/register).

## Erstkontakt: was siehst du als Gast?

Auf der Startseite findest du mehrere Einstiegspunkte:

1. **Aktuelle Veranstaltung** — sofern ein Event hervorgehoben ist, erscheint ganz
   oben ein Slot mit den Buttons „Idee einreichen" und „Jetzt voten"
2. **Neueste Ideen** (8 frisch eingereichte oder geänderte Ideen, mit „Mehr laden"-Button)
3. **Themenbereiche durchstöbern** — die thematischen Ober-Sammlungen
4. **Veranstaltungen durchstöbern** — die kuratierten Events als Kacheln

Über die Navigation oben sind alle Bereiche jederzeit erreichbar:

```
Start  ·  Ideen  ·  Themenbereiche  ·  Veranstaltungen  ·  🏆 Rangliste  ·  Idee einreichen
```

Rechts oben kannst du jederzeit zwischen drei Farbschemata (default, hellem
HackathOERn-Theme, Dark Mode) wechseln — dein gewähltes Theme wird im Browser
gespeichert.

## Architektur in einem Bild

```
Browser
  │
  ├─ <ideendb-app>  (Angular Web Component)
  │
  ├─ HTTP/JSON
  │
FastAPI Backend
  │
  ├─ SQLite-Cache (Schnellzugriff für Listen, Suche, Rangliste)
  │
  └─ edu-sharing REST  ─→  Inhalte, Bewertungen, Kommentare, User
       (redaktion.openeduhub.net)
```

Source of Truth ist immer edu-sharing. Die App liest periodisch (alle 5 Min) und
schreibt deine Aktionen direkt zurück.

---

→ Weiter mit [Kapitel 2: Ideen stöbern](02-ideen-stoebern.md)
