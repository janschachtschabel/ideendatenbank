# Docker-Update (Schnellreferenz)

Update der laufenden Instanz auf das neueste Image. **Working Directory ist
egal** — alle Pfade sind absolut.

> **Voraussetzung:** Der Code ist nach `main` gepusht und die GitHub-CI hat
> das neue Image gebaut (Status: GitHub → Actions → „Docker — Build & Push"
> muss ✓ sein). Erst dann liegt das aktualisierte `:main`-Image in der
> Registry.

## Die drei Befehle

```bash
docker pull ghcr.io/janschachtschabel/ideendatenbank:main && \
docker stop ideendb && docker rm ideendb && \
docker run -d --name ideendb --restart unless-stopped \
  -p 127.0.0.1:8000:8000 -v ideendb-data:/data \
  --env-file /home/ideendb/ideendb/.env \
  ghcr.io/janschachtschabel/ideendatenbank:main
```

## Danach prüfen

```bash
sleep 6
curl -s http://127.0.0.1:8000/api/v1/health
echo
curl -s http://127.0.0.1:8000/api/v1/events/featured | head -c 200
```

**Erwartung:**

- `/api/v1/health` → `{"ok":true,"topics":...,"ideas":...}`
- `/api/v1/events/featured` → JSON-Liste der hervorgehobenen Events (oder `[]`)

## Hinweise

- **Daten bleiben erhalten** — die SQLite-DB + Backups liegen im Volume
  `ideendb-data` und werden vom Update nicht angefasst. DB-Migrationen laufen
  idempotent beim Start.
- **Sicherheits-Backup vorab** (optional, empfohlen):
  ```bash
  curl -s -u '<mod-username>:<passwort>' \
    -X POST http://127.0.0.1:8000/api/v1/admin/backup
  ```
- **`docker pull` sagt „up to date"?** Dann ist die CI noch nicht fertig oder
  der Push fehlt. Build-Datum prüfen, muss von heute sein:
  ```bash
  docker inspect ghcr.io/janschachtschabel/ideendatenbank:main --format '{{.Created}}'
  ```
- **Browser nach dem Update:** hart neu laden (Strg+Shift+R), sonst zeigt der
  Browser das alte JS-Bundle aus dem Cache.

## Rollback (falls etwas klemmt)

Das vorherige Image liegt nach dem Pull noch lokal vor:

```bash
docker images ghcr.io/janschachtschabel/ideendatenbank   # alten Digest merken
docker stop ideendb && docker rm ideendb
docker run -d --name ideendb --restart unless-stopped \
  -p 127.0.0.1:8000:8000 -v ideendb-data:/data \
  --env-file /home/ideendb/ideendb/.env \
  ghcr.io/janschachtschabel/ideendatenbank@sha256:<alter-digest>
```

---

→ Vollständige Installations- & Betriebsanleitung: [`INSTALL-DOCKER.md`](INSTALL-DOCKER.md)
