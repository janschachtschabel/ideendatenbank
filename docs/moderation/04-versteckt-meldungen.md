# 4. Versteckte Ideen + Meldungen

## 🚫 Versteckt-Tab

Manchmal soll eine Idee nicht öffentlich angezeigt werden, aber **nicht**
unwiderruflich gelöscht werden. Das ist der Use-Case für „Verstecken" (Soft-
Delete):

- **Strittige Inhalte** während einer Klärung
- **Lizenz-Probleme** während der Rücksprache
- **Duplikate**, wo das Original behalten werden soll
- **Frischer Spam**, der noch dokumentiert werden soll

### Eine Idee verstecken

In der Detail-Sidebar der Idee, **🚫 Verstecken** klicken (nur sichtbar für Mods).
Prompt fragt optional nach einem Grund (z.B. „lizenz-prüfung").

Verhalten:
- Die Idee verschwindet aus der öffentlichen Liste, der Suche, dem Ranking
- Bestehende Direkt-Links zeigen für Gäste 404, für Mods bleibt sie sichtbar
- In edu-sharing wird **nichts** verändert — die Daten bleiben da

### Versteckte Ideen wieder sichtbar machen

Im **Versteckt**-Tab erscheint die Liste aller versteckten Ideen mit Titel,
Grund und Zeit. Klick auf eine → öffnet die Detail-Seite.

In der Aktionen-Sidebar steht für Mods jetzt **👁 Wieder anzeigen** statt
„Verstecken". Klick macht sie sofort wieder öffentlich.

### Wie ist das technisch umgesetzt?

In der App-DB hat jede `idea`-Row zwei Spalten:
- `hidden: 0|1`
- `hidden_reason: TEXT NULL`

Public-Listing-Queries filtern mit `WHERE hidden = 0`. Mod-Listings ignorieren
das Flag. Edu-sharing weiß nichts davon — die Idee ist im Repo unverändert.

## ⚠ Meldungen-Tab

User können Ideen über den „⚠ Melden"-Button reportieren (sichtbar in der
Aktionen-Sidebar jeder Detail-Seite, für eingeloggte User).

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
wurde. Auch Doppel-Meldungen derselben Idee durch denselben User werden im UI
verhindert („Bereits gemeldet").

### Bulk-Resolve (per API)

Für mehrere Meldungen auf einmal gibt's einen API-Endpoint:

```
POST /api/v1/admin/reports/bulk-resolve
Body: {"ids": [1, 2, 3]}
```

Im UI noch nicht integriert — kann manuell via curl oder Postman aufgerufen werden:

```bash
curl -X POST -u janschachtschabel:DEIN_PW \
  -H "Content-Type: application/json" \
  -d '{"ids":[1,2,3]}' \
  http://localhost:8000/api/v1/admin/reports/bulk-resolve
```

## Activity-Log-Verknüpfung

Alle Mod-Aktionen (Verstecken, Anzeigen, Meldung-Erledigung) werden im
Aktivitäts-Log dokumentiert:

| action | wer | was |
|---|---|---|
| `idea_hidden` | Mod-Username | Idee mit Grund versteckt |
| `idea_unhidden` | Mod-Username | Idee wieder freigegeben |
| `report_resolved` | Mod-Username | Meldung als erledigt markiert |
| `reports_bulk_resolved` | Mod-Username | Bulk-Erledigung mit `count` + `ids` |

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
