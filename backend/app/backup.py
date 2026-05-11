"""Backup + Restore für die SQLite-DB.

Sichert konsistent via SQLite-`VACUUM INTO` (kein File-Copy mit Locks),
packt zusätzlich `metadata.json` ins ZIP. **Konfiguration / Umgebungs-
variablen werden bewusst NICHT mitgesichert** — Secrets gehören in die
System-/Docker-Umgebungsvariablen, nicht in transportable Datei-Backups.
Retention: behält die jüngsten N Backups (siehe `settings.backup_keep`),
älteres wird beim Anlegen automatisch entfernt.

Restore ersetzt die SQLite-Datei zur Laufzeit. Damit das sicher ist:
1. Wir nehmen den globalen `_sync_lock` aus sync.py, damit kein paralleler
   Sync auf die DB schreibt.
2. Wir erzwingen ein WAL-Checkpoint auf der alten DB, schließen alle
   Cursor (per-call Connections schließen sich von selbst), und kopieren
   die neue Datei drüber.
3. Index-/Schema-Migration läuft beim nächsten Connect implizit über die
   `init_db()`-Idempotenz.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from .config import settings

log = logging.getLogger(__name__)

BACKUP_NAME_PREFIX = "ideendb-backup-"
BACKUP_NAME_RE = re.compile(
    r"^ideendb-backup-(\d{8})-(\d{4})\.zip$"
)


def _backup_dir() -> Path:
    p = Path(settings.backup_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _now_str() -> str:
    return datetime.now(UTC).strftime("%Y%m%d-%H%M")


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


def _gather_metadata() -> dict:
    """Plausibilitäts-Stats fürs ZIP — werden beim Restore zur Anzeige
    gebraucht, sind aber nicht zwingend (Restore klappt auch ohne)."""
    stats: dict = {"created_at": _iso_now()}
    try:
        with sqlite3.connect(settings.sqlite_path) as con:
            con.row_factory = sqlite3.Row
            cur = con.cursor()
            for tbl in ("idea", "topic", "activity_log", "ranking_snapshot",
                        "idea_interaction", "taxonomy_phase", "taxonomy_event"):
                try:
                    n = cur.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
                    stats[f"{tbl}_count"] = n
                except sqlite3.OperationalError:
                    stats[f"{tbl}_count"] = 0
    except Exception as e:
        log.warning("metadata gather failed: %s", e)
    return stats


def _vacuum_into(target: Path) -> None:
    """SQLite-konsistente Online-Kopie via VACUUM INTO. Funktioniert auch
    während Reads/Writes laufen — keine Locks nötig."""
    if target.exists():
        target.unlink()
    with sqlite3.connect(settings.sqlite_path) as con:
        con.execute("VACUUM INTO ?", (str(target),))


def create_backup() -> Path:
    """Erstellt ein neues ZIP-Backup. Rückgabe: Pfad zur ZIP-Datei.
    Schmeißt den Pruning-Lauf direkt mit an."""
    out_dir = _backup_dir()
    zip_path = out_dir / f"{BACKUP_NAME_PREFIX}{_now_str()}.zip"
    # Falls Sekunden-genaue Kollision (z.B. zwei Backups innerhalb derselben
    # Minute manuell ausgelöst): mit Suffix versehen
    if zip_path.exists():
        for i in range(2, 100):
            cand = out_dir / f"{BACKUP_NAME_PREFIX}{_now_str()}-{i}.zip"
            if not cand.exists():
                zip_path = cand
                break

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        # 1. Konsistente DB-Kopie
        db_copy = tmp / "database.sqlite"
        _vacuum_into(db_copy)

        # 2. Metadata
        meta = _gather_metadata()
        (tmp / "metadata.json").write_text(
            json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8",
        )

        # 3. KEIN .env-Snapshot — Secrets gehören in System-Env, nicht in
        #    transportable Backups. Wenn Konfig-Migration nötig: separat
        #    bei der System-Env vornehmen.

        # 4. ZIP packen
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for entry in tmp.iterdir():
                zf.write(entry, arcname=entry.name)

    prune_old_backups()
    log.info("backup created: %s", zip_path.name)
    return zip_path


def list_backups() -> list[dict]:
    """Liste verfügbarer Backups, neueste zuerst. Liest metadata.json
    aus dem ZIP für die UI-Anzeige."""
    out: list[dict] = []
    for p in sorted(_backup_dir().iterdir(), reverse=True):
        # Reguläres Namensschema ODER Suffix-Variante (-2, -3) für Kollisionen
        if (not p.is_file() or not BACKUP_NAME_RE.match(p.name)) and (
            not p.name.startswith(BACKUP_NAME_PREFIX) or not p.name.endswith(".zip")
        ):
            continue
        try:
            with zipfile.ZipFile(p) as zf:
                if "metadata.json" in zf.namelist():
                    meta = json.loads(zf.read("metadata.json").decode("utf-8"))
                else:
                    meta = {}
        except Exception as e:
            meta = {"error": str(e)}
        stat = p.stat()
        out.append({
            "filename": p.name,
            "size": stat.st_size,
            "created_at": datetime.fromtimestamp(
                stat.st_mtime, tz=UTC
            ).isoformat(),
            "metadata": meta,
        })
    return out


def prune_old_backups() -> int:
    """Behalte nur die neuesten settings.backup_keep Backups."""
    keep = max(1, int(settings.backup_keep))
    files = sorted(
        [p for p in _backup_dir().iterdir() if p.is_file()
         and p.name.startswith(BACKUP_NAME_PREFIX) and p.name.endswith(".zip")],
        reverse=True,
    )
    removed = 0
    for old in files[keep:]:
        try:
            old.unlink()
            removed += 1
            log.info("backup pruned: %s", old.name)
        except Exception as e:
            log.warning("prune failed for %s: %s", old.name, e)
    return removed


def get_backup_path(filename: str) -> Path:
    """Pfad zu einer Backup-ZIP — verhindert Path-Traversal."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise ValueError("Ungültiger Dateiname")
    if not filename.startswith(BACKUP_NAME_PREFIX) or not filename.endswith(".zip"):
        raise ValueError("Kein Backup-Dateiname")
    p = _backup_dir() / filename
    if not p.is_file():
        raise FileNotFoundError(filename)
    return p


def delete_backup(filename: str) -> None:
    p = get_backup_path(filename)
    p.unlink()
    log.info("backup deleted: %s", filename)


async def restore_backup(zip_bytes: bytes) -> dict:
    """Stellt aus einem ZIP-Bytes-Blob wieder her.

    Wichtig: läuft *unter* dem Sync-Lock, damit kein paralleler Sync auf
    die alte DB schreibt während wir die Datei austauschen. Live-Connections
    der API-Routen sind safe, weil unsere `connect()`-Wrapper jeweils nur
    pro Request offen sind.

    Vor dem Restore wird ein automatisches Sicherungs-Backup („pre-restore")
    angelegt — falls die hochgeladene Datei kaputt ist, kann man sich
    selbst manuell zurückholen.
    """
    from . import sync as sync_mod

    # 1. ZIP validieren
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        zip_path = tmp / "upload.zip"
        zip_path.write_bytes(zip_bytes)
        try:
            with zipfile.ZipFile(zip_path) as zf:
                names = zf.namelist()
                if "database.sqlite" not in names:
                    raise ValueError(
                        "ZIP enthält keine database.sqlite — falsches Backup-Format"
                    )
                zf.extract("database.sqlite", tmp)
                if "metadata.json" in names:
                    try:
                        meta = json.loads(
                            zf.read("metadata.json").decode("utf-8")
                        )
                    except Exception:
                        meta = {}
                else:
                    meta = {}
        except zipfile.BadZipFile:
            raise ValueError("Datei ist kein gültiges ZIP")

        new_db = tmp / "database.sqlite"
        # Plausibilitäts-Check: SQLite-Magic-Bytes
        if not new_db.is_file() or new_db.stat().st_size < 100:
            raise ValueError("database.sqlite im ZIP ist ungültig oder leer")
        with open(new_db, "rb") as f:
            magic = f.read(16)
        if not magic.startswith(b"SQLite format 3"):
            raise ValueError(
                "database.sqlite ist keine SQLite-Datei (Magic-Bytes fehlen)"
            )

        # 2. Pre-Restore-Backup
        try:
            pre = create_backup()
            log.info("pre-restore backup: %s", pre.name)
        except Exception as e:
            log.warning("pre-restore backup failed: %s", e)

        # 3. Unter Sync-Lock: alte DB löschen + neue an Stelle setzen
        async with sync_mod._sync_lock:
            target = Path(settings.sqlite_path)
            target.parent.mkdir(parents=True, exist_ok=True)
            # Alte WAL/SHM-Begleitdateien wegräumen (sonst inkonsistent)
            for ext in ("", "-wal", "-shm", "-journal"):
                aux = Path(str(target) + ext)
                if aux.exists():
                    try:
                        aux.unlink()
                    except Exception as e:
                        log.warning("could not remove %s: %s", aux, e)
            shutil.copy(new_db, target)

        # 4. Schema-Migration via init_db (idempotent — fügt fehlende Spalten ein)
        from .db import init_db
        try:
            init_db()
        except Exception as e:
            log.warning("init_db post-restore failed: %s", e)

    log.info("restore complete from %d-byte ZIP", len(zip_bytes))
    return {
        "ok": True,
        "restored_metadata": meta,
        "size": len(zip_bytes),
    }


# ===== Auto-Restore beim Erststart =================================
# Sinn: Nach Neuinstallation oder Container-Neudeploy auf leeres Volume
# soll die App nicht „leer" hochkommen, sondern automatisch das letzte
# verfügbare Backup ziehen. Wir tun das BEVOR `init_db()` läuft —
# init_db ist nachher idempotent und ergänzt fehlende Spalten.
#
# Triggert nur, wenn:
#   1. Die SQLite-Datei nicht existiert ODER quasi-leer ist (< 200 Bytes,
#      also nicht mal SQLite-Header) UND
#   2. Mindestens ein Backup-ZIP im Backup-Ordner liegt.
#
# Asynchron läuft hier nichts — alle Aufrufe sind synchron, damit's vor
# init_db sauber sequenziert ist. Der reguläre Restore-Endpoint nutzt
# zusätzlich den Sync-Lock; beim Erststart ist der Sync noch nicht
# gestartet, also überflüssig.

def auto_restore_if_fresh() -> dict | None:
    """Stellt das jüngste Backup wieder her, wenn keine DB vorhanden ist.
    Gibt das Restore-Manifest zurück oder None, wenn kein Restore lief."""
    db_path = Path(settings.sqlite_path)
    if db_path.is_file() and db_path.stat().st_size >= 200:
        return None  # DB existiert und ist plausibel — kein Auto-Restore

    backups = list_backups()
    if not backups:
        log.info("auto-restore: keine Backups vorhanden, starte fresh")
        return None

    newest = backups[0]
    zip_path = _backup_dir() / newest["filename"]
    if not zip_path.is_file():
        log.warning("auto-restore: Backup-Datei nicht gefunden: %s", zip_path)
        return None

    log.info("auto-restore: stelle %s wieder her (DB war leer/fehlend)",
             newest["filename"])
    try:
        with zipfile.ZipFile(zip_path) as zf:
            if "database.sqlite" not in zf.namelist():
                log.error("auto-restore: %s enthält keine database.sqlite",
                          newest["filename"])
                return None
            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp = Path(tmp_dir)
                zf.extract("database.sqlite", tmp)
                src = tmp / "database.sqlite"
                if not src.is_file() or src.stat().st_size < 100:
                    log.error("auto-restore: database.sqlite im ZIP ist leer")
                    return None
                with open(src, "rb") as f:
                    if not f.read(16).startswith(b"SQLite format 3"):
                        log.error("auto-restore: database.sqlite hat falschen "
                                  "Magic-Header")
                        return None
                # Begleitdateien wegräumen (sollten bei fresh install nicht
                # existieren, aber sicher ist sicher)
                for ext in ("", "-wal", "-shm", "-journal"):
                    aux = Path(str(db_path) + ext)
                    if aux.exists():
                        try:
                            aux.unlink()
                        except Exception as e:
                            log.warning("auto-restore: konnte %s nicht entfernen: %s",
                                        aux, e)
                db_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(src, db_path)
    except Exception as e:
        log.exception("auto-restore: fehlgeschlagen: %s", e)
        return None

    log.info("auto-restore: erfolgreich aus %s — Schema-Migration via init_db",
             newest["filename"])
    return {
        "ok": True,
        "from": newest["filename"],
        "size": newest.get("size"),
        "metadata": newest.get("metadata", {}),
    }


# ===== Auto-Backup-Loop ===========================================

_last_auto_backup: datetime | None = None


async def auto_backup_loop() -> None:
    """Hintergrund-Task: prüft jede Stunde, ob ein Auto-Backup fällig ist
    (älter als `backup_interval_hours`). Erster Lauf erfolgt nach kurzer
    Verzögerung, damit die App vorher gestartet ist."""
    global _last_auto_backup
    if not settings.backup_enabled:
        log.info("auto-backup disabled via settings.backup_enabled=False")
        return

    # Initial: prüfe vorhandene Backups, setze _last_auto_backup auf das
    # neueste vorhandene, damit nach Neustart nicht direkt ein neues läuft.
    try:
        latest = list_backups()
        if latest:
            ts = latest[0].get("created_at") or latest[0]["metadata"].get("created_at")
            if ts:
                _last_auto_backup = datetime.fromisoformat(ts)
    except Exception:
        pass

    await asyncio.sleep(120)  # 2 Min Anlauf
    while True:
        try:
            interval = max(1, int(settings.backup_interval_hours))
            now = datetime.now(UTC)
            due = (
                _last_auto_backup is None
                or (now - _last_auto_backup).total_seconds() >= interval * 3600
            )
            if due:
                # Im Executor laufen lassen, damit das Event-Loop nicht blockiert
                await asyncio.to_thread(create_backup)
                _last_auto_backup = now
        except Exception as e:
            log.warning("auto-backup tick failed: %s", e)
        # Stündlich nachschauen, ob's wieder fällig ist
        await asyncio.sleep(3600)
