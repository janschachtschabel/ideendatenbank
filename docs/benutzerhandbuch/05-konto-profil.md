# 5. Konto und Profil

## Warum ein WLO-Konto?

Die Ideendatenbank teilt sich die User-Verwaltung mit **WirLernenOnline**.
Dieselbe Anmeldung gilt für viele weitere OER-Tools im Netzwerk:

- ✏ **Eigene Ideen einreichen + bearbeiten** statt nur lesen
- 💬 Diskussionen mitführen + bewerten
- 🎯 Vorlagen, Material, andere OER-Repositorien im WLO-Verbund nutzen
- 👥 Sichtbar werden mit deinen Beiträgen — Networking in der OER-Community
- 📩 Notifications zu deinen Ideen + denen, denen du folgst

→ **Hier registrieren** (kostenlos, dauert eine Minute):
> https://ideenbank.hackathoern.de/edu-sharing/components/register

## Anmelden

Oben rechts auf **„Anmelden"** klicken. Dialog mit zwei Tabs:

| Tab | Was tun |
|---|---|
| **Anmelden** | Benutzername + Passwort eingeben |
| **Registrieren** | Großer Button öffnet das WLO-Registrierungsformular in einem neuen Tab |

Nach Login wird dein Benutzername mit grünem Punkt (●) oben rechts angezeigt.
Klick darauf öffnet das User-Menü.

## User-Menü

Drei Einträge:
- **👤 Mein Bereich** — dein persönlicher Dashboard
- **🔧 Moderation** — nur sichtbar wenn du Mod/Admin bist
- **↪ Abmelden** — Session beenden

## Mein Bereich

Fünf Tabs (ein sechster — **Mithack-Anfragen** — erscheint nur, wenn du selbst
Ideen eingereicht hast):

### Was ist neu
Aktivitäts-Feed mit Notification-Counter. Zeigt:
- Neue Kommentare an deinen / gefolgten / Mithack-Ideen
- Phasen-Wechsel
- Anhänge die hochgeladen wurden
- Mod-Aktionen (verschoben, versteckt, freigegeben)

Sobald du den Tab öffnest, wird der Counter (oben rechts am Username) zurückgesetzt.

### Meine Ideen
Liste deiner Einreichungen. Pro Idee:
- Titel, Phase, Bewertung, Kommentarzahl
- Klick öffnet die Detail-Ansicht zum Bearbeiten

### Gefolgt
Alle Ideen, denen du folgst. Praktisch zum schnellen Zurückkehren ohne Suche.

### Mithacken
Alle Ideen, bei denen du „Ich will mithacken" markiert hast — inkl. Status
(wartet auf Bestätigung / angenommen) und ob du Bearbeitungsrecht hast.

### Mithack-Anfragen
Nur sichtbar, wenn dir Ideen gehören: Wer sich bei deinen Ideen zum Mithacken
eingetragen hat. Hier nimmst du Anfragen an, vergibst Bearbeitungsrechte oder
entfernst Mithackende wieder.

### Profil & Teilen
Deine öffentlichen Profil-Felder bearbeiten (Anzeigename, Kurzbeschreibung,
Website, Rolle) und einen Direktlink + QR-Code zu deinem Profil holen.

## Öffentliches Profil

Jeder eingeloggte Nutzer hat ein **öffentliches Profil** mit allen seinen
eingereichten Ideen. Erreichbar:
- über Klick auf den Autor-Namen in einer Idee-Detail-Seite
- über URL `?view=user&u=<dein-username>`

Was dort steht:
- **Initialen-Avatar** mit Anzeigename bzw. Username
- **Profil-Felder**, sofern gepflegt: Kurzbeschreibung (Bio), Website-Link und
  Rolle/Kontext (als Pille) — gesetzt im Tab „Profil & Teilen"
- **Stats**: Anzahl Ideen, Anzahl Kommentare gesamt, Anzahl Bewertungen, Schnittbewertung
- **Letzte Aktivität** (Datum)
- **Alle eigenen Ideen** als Kachelgitter

Oben rechts hast du einen **„Teilen"-Button** mit:
- Direkt-Link zum Kopieren (`?view=user&u=…`)
- Embed-Snippet als Web-Component für andere Webseiten

> Profile sind öffentlich → wirb gerne damit, indem du den Link in Mail-Signaturen
> oder LinkedIn-Profilen verwendest.

## Login-Verhalten technisch

- Authentifizierung läuft per **HTTP Basic Auth** gegen edu-sharing — App speichert
  deine Zugangsdaten **nur im `sessionStorage` deines Browser-Tabs**
- Schließt du den Tab, ist die Session weg (kein Persistent-Cookie)
- Andere Tabs derselben Browser-Sitzung teilen den Login
- Inkognito-/Privat-Modus startet immer ohne Login

Sicherheit: Passwörter werden nicht an Dritt-Server geleitet, die App selbst
sieht sie nur, um sie als Auth-Header weiterzureichen.

## Passwort vergessen?

Geht direkt über **WirLernenOnline → Account** außerhalb der Ideendatenbank.
Wir haben keinen eigenen Passwort-Reset.

## Konto löschen?

Bitte ans WLO-Team wenden. Eingereichte Ideen, Kommentare, Bewertungen bleiben
nach Konto-Löschung in edu-sharing — falls du das nicht möchtest, lösche zuvor
deine Inhalte selbst über die Detail-Seiten.

---

→ Weiter mit [Kapitel 6: Auf eigener Webseite einbinden](06-einbinden-webcomponent.md)
