# 7. Häufige Fragen

## Allgemein

### Brauche ich ein Konto, um zu lesen?
Nein. Stöbern, Suchen, Filtern, Detail-Ansichten — alles offen für anonyme
Besucher. Auch Bewerten ist möglich (pro Browser/Cookie gezählt).

### Was kostet die Nutzung?
Nichts. Die Ideendatenbank, das WLO-Konto und das edu-sharing-Repo sind alle
kostenfrei.

### Wie aktuell sind die Daten?
- Eigene Änderungen sind sofort sichtbar
- Änderungen, die direkt im edu-sharing-Repo gemacht werden (z.B. von Admins):
  bis zu 5 Min Sync-Lag. Mit dem **„Aus Repo aktualisieren"**-Button in der
  Aktionen-Sidebar zwingst du einen sofortigen Refresh.

### Welche Browser werden unterstützt?
Alle aktuellen Chromium-, Firefox-, Safari- und Edge-Versionen (Stand 2024+).
Mobile Browser ebenso. Sehr alte Browser (IE11) werden **nicht** unterstützt.

## Idee einreichen

### Was passiert, wenn ich anonym einreiche?
Die Idee landet wie sonst im Mod-Postfach, wird vom Team gesichtet und in eine
Sammlung einsortiert. Du kannst sie aber **nicht mehr nachträglich bearbeiten** —
dafür müsstest du eingeloggt sein, und auch dann nur deine eigenen Einreichungen.

### Kann ich meine Idee löschen?
Ja, als eingeloggter Owner — in der Aktionen-Sidebar **🗑 Löschen**. Bestätigung
nötig. Die Idee wird auch im edu-sharing-Repo gelöscht (nicht reversibel ohne
Backup-Restore durch Mods).

### Muss ich eine Lizenz wählen?
Default ist **CC BY 4.0** (Creative Commons mit Namensnennung). Wer eine andere
Lizenz braucht, kann die nachträglich im edu-sharing-Repo direkt setzen — oder
das Mod-Team bitten.

### Was ist „Phase"?
Stadium der Idee:
1. **Anregung** — erste Skizze
2. **Pitch-bereit** — ausformuliert genug für eine Hackathon-Präsentation
3. **In Umsetzung** — wird gerade gebaut
4. **Abgeschlossen** — fertig (Prototyp, Konzept, Dokument)
5. **Archiviert** — nicht weiterverfolgt

Owner können nur **eine Stufe weiter** schalten — Sprünge oder Rückwärts sind
dem Mod-Team vorbehalten.

### Was ist „Veranstaltung"?
Kuratierte HackathOERn-Editionen (HackathOERn 1, 2, 3 …) oder andere Events,
denen die Idee thematisch zugeordnet wurde. Eine Idee kann mehreren
Veranstaltungen angehören. Erscheint auf der Veranstaltungs-Hub-Seite.

## Mitmachen, Folgen, Bewerten

### Sehen andere, was ich bewertet habe?
Nein. Sterne werden anonym aggregiert — sichtbar ist nur der Durchschnitt + die
Stimmenzahl.

### Sehen andere, welchen Ideen ich folge?
Nein, „Folgen" ist privat. Nur du siehst die Liste in deinem Profil.

### Was passiert, wenn ich „Mitmachen" klicke?
Du erscheinst in der Avatar-Reihe der Idee als interessierte Person. Andere
können dich anschreiben (über dein WLO-Profil), wenn sie ein Team
zusammenstellen.

### Werde ich per E-Mail benachrichtigt?
Nein, derzeit nur über das Notification-Center in der App („Mein Bereich → Was
ist neu") + den Counter am Username. Eine E-Mail-Integration ist nicht
implementiert.

## Sichtbarkeit & Datenschutz

### Was ist öffentlich?
- Idee-Titel + Beschreibung + Anhänge
- Mein Login-Username (als Autor / bei Kommentaren)
- Bewertungs-Durchschnitt + Stimmzahl
- „Mitmachen"-Avatars

### Was ist privat?
- Mein konkret abgegebener Stern
- Meine „Folgen"-Liste
- Mein Passwort / E-Mail / Profil-Details aus WLO
- Notification-Read-Status

Komplette Datenschutzerklärung über Footer → **„Datenschutz"** in der App.

## Technische Probleme

### Das Vorschaubild zeigt „Keine ausreichenden Rechte"
Das ist der edu-sharing-Default-Platzhalter, wenn anonym keine Lesezugriff auf
das Preview möglich ist. Tritt nach manchen Move-Operationen auf — bitte ans
Mod-Team melden, das kann mit einem Klick die Permission setzen.

### Ein Filter zeigt 0 Treffer, ich finde nicht zurück
Filter-Pillen bleiben sichtbar, auch bei 0 Treffern. **Klick „Alle"** in der
jeweiligen Filter-Reihe setzt diesen Filter zurück. Oder über die Topbar zurück
zur Startseite.

### Login funktioniert nicht
- Username + Passwort korrekt? Beachte Groß-/Kleinschreibung
- Konto bei WLO bestätigt? Beim ersten Login musst du die Bestätigungs-Mail
  geklickt haben
- Browser-Cookies blockiert? Login speichert in `sessionStorage` — wenn das
  blockiert ist, klappt's nicht

### Idee bearbeiten ist nicht da
Du bist entweder nicht der Owner (Idee wurde von jemand anderem oder anonym
eingereicht) oder nicht eingeloggt. Beides nötig.

### Anhang lässt sich nicht hochladen
Dateigröße prüfen — Repo hat ~50 MB-Grenze pro Datei. Bei größeren Dateien lade
sie woanders hoch (Cloud, Repo) und verlinke im Beschreibungs-Text.

## Mod-/Admin-Aspekte (kurz)

Wer fragt: „Wie kann ich Mod werden?" — über das WLO-Team:
janschachtschabel@openeduhub.de o.ä.

Mod-Rechte werden über Mitgliedschaft in der edu-sharing-Gruppe vergeben.
Details im [Moderations-Handbuch](../moderation/01-uebersicht-mod-bereich.md).

---

→ Zurück zur [Übersicht](../README.md) · → [Moderations-Handbuch](../moderation/01-uebersicht-mod-bereich.md)
