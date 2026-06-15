# 4. Versteckte Ideen + Meldungen

## Inhalte verwalten (Verstecken/Einblenden)

Manchmal soll eine Idee nicht öffentlich angezeigt werden, aber **nicht**
unwiderruflich gelöscht werden. Das ist der Use-Case für „Verstecken" (Soft-
Delete):

- **Strittige Inhalte** während einer Klärung
- **Lizenz-Probleme** während der Rücksprache
- **Duplikate**, wo das Original behalten werden soll
- **Frischer Spam**, der noch dokumentiert werden soll

Einen eigenen „Versteckt"-Tab gibt es nicht mehr — die Funktion liegt jetzt
unter **Moderation ▾ → Inhalte verwalten**. Dort findest du alle Ideen zentral:
ein Titel-Filter oben, darunter die Liste (versteckte zuerst, markiert mit
🚫 versteckt). Pro Zeile gibt es **Bearbeiten** (öffnet die Ideenseite),
**Verstecken** bzw. **Einblenden** und **Löschen**.

> Max. 400 Treffer (versteckte zuerst). Bei vielen Ideen den Titel-Filter nutzen.

### Eine Idee verstecken

Zwei Wege:
- In der Detail-Sidebar der Idee **🚫 Verstecken** klicken (nur sichtbar für Mods),
  oder
- in **Inhalte verwalten** in der jeweiligen Zeile auf **Verstecken** klicken.

Bei der Detail-Variante fragt ein Prompt optional nach einem Grund
(z.B. „lizenz-prüfung").

Verhalten:
- Die Idee verschwindet aus der öffentlichen Liste, der Suche, dem Ranking
- Bestehende Direkt-Links zeigen für Gäste 404, für Mods bleibt sie sichtbar
- In edu-sharing wird **nichts** verändert — die Daten bleiben da

### Versteckte Ideen wieder sichtbar machen

In **Inhalte verwalten** stehen versteckte Ideen oben (Badge 🚫 versteckt). Klick
auf **Einblenden** in der Zeile macht die Idee sofort wieder öffentlich.
Alternativ steht in der Detail-Sidebar einer versteckten Idee für Mods
**👁 Wieder anzeigen** statt „Verstecken".

### Wie ist das technisch umgesetzt?

In der App-DB hat jede `idea`-Row zwei Spalten:
- `hidden: 0|1`
- `hidden_reason: TEXT NULL`

Public-Listing-Queries filtern mit `WHERE hidden = 0`. Mod-Listings ignorieren
das Flag. Edu-sharing weiß nichts davon — die Idee ist im Repo unverändert.

## ⚠ Meldungen-Tab

Der Meldungen-Tab liegt unter **Moderation ▾ → Meldungen**. User können Ideen
über den „⚠ Melden"-Button reportieren (in der Aktionen-Sidebar jeder
Detail-Seite). Der Dialog lässt sich auch **ohne Login** öffnen — anonyme
Meldungen sind erlaubt (Reporter wird dann nicht erfasst).

### Was sehen Mods?

Liste aller offenen Meldungen, neueste zuerst. Pro Eintrag:

| Spalte | Inhalt |
|---|---|
| Datum | Wann gemeldet |
| Idee | Titel + Link zur Detail-Seite |
| Reporter | Username (falls eingeloggt) |
| Grund | Freitext, was der Reporter geschrieben hat |
| Aktion | „✓ Erledigt" + Idee öffnen |

Zeile rechts klicken (✓ Erledigt) → Meldung wird als bearbeitet markiert
(`resolved_at` gesetzt), aus der Default-Liste verschwindet sie.

### Workflow

1. **Meldung sichten** — Grund lesen
2. **Idee öffnen** — Inhalt prüfen
3. **Entscheidung treffen:**
   - Wirklich Spam/Missbrauch → 🗑 Löschen
   - Strittig oder zu klären → 🚫 Verstecken (Reversibel)
   - False Positive → ✓ Erledigt ohne weitere Aktion
4. **Meldung als erledigt markieren**

Der Reporter sieht beim erneuten Öffnen der Idee, dass seine Meldung bearbeitet
wurde. Auch Doppel-Meldungen derselben Idee durch denselben (eingeloggten) User
werden im UI verhindert („Bereits gemeldet").

> Meldungen werden **einzeln** erledigt (ein „✓ Erledigt" pro Meldung). Eine
> Sammel-Erledigung gibt es nicht. Es bleibt nur der Einzel-Endpoint
> `POST /admin/reports/{report_id}/resolve`.

## Activity-Log-Verknüpfung

Alle Mod-Aktionen (Verstecken, Anzeigen, Meldung-Erledigung) werden im
Aktivitäts-Log dokumentiert:

| action | wer | was |
|---|---|---|
| `idea_hidden` | Mod-Username | Idee mit Grund versteckt |
| `idea_unhidden` | Mod-Username | Idee wieder freigegeben |
| `report_resolved` | Mod-Username | Meldung als erledigt markiert |

Im Aktivitäts-Tab nach `action` filtern, um die Geschichte einer Idee
nachvollziehen zu können.

## Tipps

1. **Nutze Verstecken großzügig** — es ist reversibel und das Audit-Log schützt
   euch vor falschen Entscheidungen
2. **Begründe Verstecken immer** im Reason-Feld — andere Mods müssen verstehen
   können, warum
3. **Reports öfter prüfen** als reinkommt — Spam-Wellen werden so früh erkannt
4. **Bei Lizenz-Unsicherheit** zuerst Verstecken, dann Original-Owner kontaktieren

---

→ Weiter mit [Kapitel 5: Backup & Wiederherstellung](05-backup-restore.md)
