# Dokumentation HackathOERn Ideendatenbank

Diese Doku-Sammlung ist in zwei Bereiche geteilt:

## Für alle Nutzer:innen → [`benutzerhandbuch/`](benutzerhandbuch/)

Anleitung für Ideengeber:innen, Gäste und alle OER-Community-Mitglieder, die
Ideen einreichen, kommentieren, bewerten oder mitmachen wollen.

| # | Kapitel | Inhalt |
|---|---|---|
| [01](benutzerhandbuch/01-einfuehrung.md) | Einführung | Was ist die Ideendatenbank, für wen, wozu |
| [02](benutzerhandbuch/02-ideen-stoebern.md) | Ideen stöbern | Suche, Filter, Rangliste, Veranstaltungen |
| [03](benutzerhandbuch/03-idee-einreichen.md) | Idee einreichen | Schritt-für-Schritt, mit Anhängen + Vorschaubild |
| [04](benutzerhandbuch/04-mitmachen-bewerten.md) | Mitmachen, Folgen, Bewerten, Kommentieren | Community-Funktionen |
| [05](benutzerhandbuch/05-konto-profil.md) | Konto und Profil | Registrierung, Login, Mein Bereich, öffentliches Profil |
| [06](benutzerhandbuch/06-einbinden-webcomponent.md) | Auf eigener Webseite einbinden | Web-Component-Snippets |
| [07](benutzerhandbuch/07-faq.md) | Häufige Fragen | Typische Stolpersteine, Lizenz, Datenschutz |

## Für das Moderations-Team → [`moderation/`](moderation/)

Anleitung für Teammitglieder mit Mod-/Admin-Rechten — Inbox-Pflege, Sammlungs-
Verwaltung, Meldungen, Backups und die technische Architektur dahinter.

| # | Kapitel | Inhalt |
|---|---|---|
| [01](moderation/01-uebersicht-mod-bereich.md) | Übersicht Mod-Bereich | Die zehn Tabs im Überblick |
| [02](moderation/02-postfach-einsortieren.md) | Postfach: Ideen einsortieren | Reference-Workflow, Filter, Bulk-Aktionen |
| [03](moderation/03-herausforderungen-pflegen.md) | Herausforderungen pflegen | Anlegen, beschreiben, Vorschaubild, sortieren |
| [04](moderation/04-versteckt-meldungen.md) | Versteckt + Meldungen | Soft-Hide, Report-Workflow |
| [05](moderation/05-backup-restore.md) | Backup & Wiederherstellung | Auto-Backup, Restore, Off-Site-Spiegelung |
| [06](moderation/06-statistik-aktivitaet.md) | Statistik + Aktivität | KPIs, Audit-Log, CSV-Export |
| [07](moderation/07-permissions-architektur.md) | Permissions & Architektur | Wie Rechte vergeben sind, Tool-Permissions, edu-sharing-Hintergrund |

---

## Format

Alle Dokumente sind Markdown — direkt nutzbar in:
- **Confluence** (Markdown-Import-Plugin oder Copy/Paste mit Live-Editor)
- **PDF** via `pandoc` oder Markdown-Preview-Druck
- **Statisch gehostete Doku-Site** via MkDocs, Docusaurus etc.

## Screenshots

Visuelle Hilfen liegen unter [`screenshots/`](screenshots/) und sind aus den
jeweiligen Kapiteln verlinkt. Wer eigene Screenshots ergänzt, kann sie dort
ablegen und in der relevanten `.md` referenzieren.

## Weiterführende Links

- **Live-Demo** der App: `http://localhost:8000/` (lokal) oder die produktive Instanz
- **Embed-Doku** in der App: `?view=embed`
- **Hilfeseite** in der App: `?view=help`
- **OpenAPI** (Schemata, alle Endpoints): `/docs` an deiner API-URL
- **Code-Repository** (Backend + Frontend): GitHub
