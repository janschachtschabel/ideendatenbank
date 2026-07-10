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
import os
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
BACKUP_NAME_RE = re.compile(r"^ideendb-backup-(\d{8})-(\d{4})\.zip$")

# Feste Whitelist der Tabellen für die metadata.json-Zähler. Die Namen werden
# (bewusst — SQLite kann Identifier nicht parametrisieren) per f-String in SQL
# interpoliert. NIEMALS aus Request-/Nutzereingaben speisen; neue Tabellen nur
# hier ergänzen.
_METADATA_TABLES = (
    "idea",
    "topic",
    "activity_log",
    "ranking_snapshot",
    "idea_interaction",
    "taxonomy_phase",
    "taxonomy_event",
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
        # ACHTUNG: `with sqlite3.connect(...)` schließt die Connection NICHT
        # (der sqlite3-Context-Manager committet nur) → explizit schließen.
        # Ein offener Handle hielt die DB-Datei auf Windows gesperrt und ließ
        # den Restore-Dateitausch mit „database disk image is malformed"
        # scheitern; auf Linux war es „nur" ein Connection-Leak pro Backup.
        con = sqlite3.connect(settings.sqlite_path)
        try:
            con.row_factory = sqlite3.Row
            cur = con.cursor()
            for tbl in _METADATA_TABLES:
                try:
                    # tbl stammt aus der Konstanten-Whitelist oben — kein User-Input.
                    n = cur.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
                    stats[f"{tbl}_count"] = n
                except sqlite3.OperationalError:
                    stats[f"{tbl}_count"] = 0
        finally:
            con.close()
    except Exception as e:
        log.warning("metadata gather failed: %s", e)
    return stats


def _vacuum_into(target: Path) -> None:
    """SQLite-konsistente Online-Kopie via VACUUM INTO. Funktioniert auch
    während Reads/Writes laufen — keine Locks nötig.

    Explizites close() statt `with`: der sqlite3-Context-Manager schließt
    nicht (nur Commit) — der geleakte Handle blockierte auf Windows den
    Restore-Dateitausch (s. _gather_metadata)."""
    if target.exists():
        target.unlink()
    con = sqlite3.connect(settings.sqlite_path)
    try:
        con.execute("VACUUM INTO ?", (str(target),))
    finally:
        con.close()


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
            json.dumps(meta, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        # 3. KEIN .env-Snapshot — Secrets gehören in System-Env, nicht in
        #    transportable Backups. Wenn Konfig-Migration nötig: separat
        #    bei der System-Env vornehmen.

        # 4. ZIP packen — atomar: erst in eine Temp-Datei im Zielordner
        #    schreiben, dann per os.replace() umbenennen. Falls der Prozess
        #    während des ZIP-Schreibens stirbt, bleibt nur die .tmp-Datei
        #    liegen (wird beim nächsten Lauf manuell oder per Prune entfernt),
        #    aber list_backups() listet keine kaputten Halb-ZIPs als gültig.
        tmp_zip = zip_path.with_suffix(".zip.tmp")
        with zipfile.ZipFile(tmp_zip, "w", zipfile.ZIP_DEFLATED) as zf:
            for entry in tmp.iterdir():
                zf.write(entry, arcname=entry.name)
        os.replace(tmp_zip, zip_path)

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
        out.append(
            {
                "filename": p.name,
                "size": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
                "metadata": meta,
            }
        )
    return out


def prune_old_backups() -> int:
    """Behalte nur die neuesten settings.backup_keep Backups.
    Räumt zusätzlich verwaiste `.zip.tmp`-Dateien weg (Crash während eines
    Backup-Laufs)."""
    keep = max(1, int(settings.backup_keep))
    removed = 0
    # Reste vom letzten halb-fertigen Backup wegräumen
    for stale in _backup_dir().glob(f"{BACKUP_NAME_PREFIX}*.zip.tmp"):
        try:
            stale.unlink()
            log.info("stale backup tempfile pruned: %s", stale.name)
        except Exception as e:
            log.warning("prune (tmp) failed for %s: %s", stale.name, e)
    files = sorted(
        [
            p
            for p in _backup_dir().iterdir()
            if p.is_file() and p.name.startswith(BACKUP_NAME_PREFIX) and p.name.endswith(".zip")
        ],
        reverse=True,
    )
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


# ===== Auto-Restore-Marker (per Mod-API steuerbar) ==================
# Der Marker ist das bewusste Opt-in für den automatischen Restore beim Start
# (Pflicht-Dauerzustand im Ephemeral-Modus). Die API-Steuerung macht die
# Ephemeral-Aktivierung kubectl-frei — Sicherheitsniveau unverändert: nur
# Mods, und die dürfen ohnehin beliebige Backups einspielen (Restore-Upload).


def _auto_restore_marker_path() -> Path | None:
    name = (settings.backup_auto_restore_marker or "").strip()
    if not name:
        return None  # Auto-Restore per Konfiguration deaktiviert
    return _backup_dir() / name


def auto_restore_marker_exists() -> bool:
    p = _auto_restore_marker_path()
    return bool(p and p.exists())


def set_auto_restore_marker() -> str:
    """Legt den Marker an (idempotent). ValueError, wenn Auto-Restore per
    Konfiguration deaktiviert ist (leerer Marker-Name) — dann wäre das Setzen
    ein stilles No-op."""
    p = _auto_restore_marker_path()
    if p is None:
        raise ValueError("Auto-Restore ist deaktiviert (kein Marker-Name konfiguriert)")
    p.touch()
    log.info("auto-restore: Marker %s angelegt", p.name)
    return p.name


def clear_auto_restore_marker() -> bool:
    """Entfernt den Marker (idempotent). True, wenn er existierte."""
    p = _auto_restore_marker_path()
    if p is None or not p.exists():
        return False
    p.unlink()
    log.info("auto-restore: Marker %s entfernt", p.name)
    return True


async def restore_backup(zip_bytes: bytes) -> dict:
    """Stellt aus einem ZIP-Bytes-Blob wieder her.

    Wichtig: läuft *unter* dem Sync-Lock, damit kein paralleler Sync auf
    die alte DB schreibt während wir die Datei austauschen. Die THREAD-
    GEPOOLTEN Connections (db.connect) werden vor UND nach dem Datei-Tausch
    invalidiert: vorher, weil offene Handles den Tausch auf Windows blockieren
    und auf Linux danach die alte Inode läsen; nachher, um Connections zu
    verwerfen, die ein anderer Request GENAU im Tausch-Fenster geöffnet hat.
    Ein Request, der dabei mitten in einer Query steckt, schlägt kontrolliert
    fehl — akzeptiert für die seltene Restore-Wartung.

    Vor dem Restore wird ein automatisches Sicherungs-Backup („pre-restore")
    angelegt — falls die hochgeladene Datei kaputt ist, kann man sich
    selbst manuell zurückholen.
    """
    from . import sync as sync_mod

    # Alle blockierenden Schritte (ZIP-I/O bis 200 MB, VACUUM-INTO-Backup,
    # Datei-Tausch, Schema-Migration) laufen im Threadpool: ein Restore darf
    # den Event-Loop — und damit ALLE parallelen Requests — nicht sekundenlang
    # einfrieren. Die Schritt-Reihenfolge bleibt exakt wie zuvor.
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)

        # 1. ZIP validieren + extrahieren
        def _validate_and_extract() -> dict:
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
                            return json.loads(zf.read("metadata.json").decode("utf-8"))
                        except Exception:
                            return {}
                    return {}
            except zipfile.BadZipFile:
                raise ValueError("Datei ist kein gültiges ZIP")

        meta = await asyncio.to_thread(_validate_and_extract)

        new_db = tmp / "database.sqlite"
        # Plausibilitäts-Check: SQLite-Magic-Bytes
        if not new_db.is_file() or new_db.stat().st_size < 100:
            raise ValueError("database.sqlite im ZIP ist ungültig oder leer")
        with open(new_db, "rb") as f:
            magic = f.read(16)
        if not magic.startswith(b"SQLite format 3"):
            raise ValueError("database.sqlite ist keine SQLite-Datei (Magic-Bytes fehlen)")

        # 2. Pre-Restore-Backup (VACUUM INTO + ZIP — mehrere Sekunden bei
        #    großer DB, daher Threadpool)
        try:
            pre = await asyncio.to_thread(create_backup)
            log.info("pre-restore backup: %s", pre.name)
        except Exception as e:
            log.warning("pre-restore backup failed: %s", e)

        # 3. Unter Sync-Lock: alte DB löschen + neue an Stelle setzen
        def _swap_db_files() -> None:
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

        from .db import invalidate_pooled_connections

        async with sync_mod._sync_lock:
            await asyncio.to_thread(invalidate_pooled_connections)
            await asyncio.to_thread(_swap_db_files)
            await asyncio.to_thread(invalidate_pooled_connections)

        # 4. Schema-Migration via init_db (idempotent — fügt fehlende Spalten ein)
        from .db import init_db

        try:
            await asyncio.to_thread(init_db)
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
    Gibt das Restore-Manifest zurück oder None, wenn kein Restore lief.

    Sicherheits-Opt-in: Der Restore springt nur an, wenn im Backup-
    Verzeichnis eine Marker-Datei liegt (`AUTO_RESTORE_OK` per Default,
    konfigurierbar via `settings.backup_auto_restore_marker`). So kann
    nicht ein versehentlich oder böswillig hineingelegtes ZIP automatisch
    aktiviert werden — der Operator muss den Auto-Restore bewusst
    freigeben (z.B. nach Volume-Migration).
    """
    db_path = Path(settings.sqlite_path)
    if db_path.is_file() and db_path.stat().st_size >= 200:
        return None  # DB existiert und ist plausibel — kein Auto-Restore

    marker_name = (settings.backup_auto_restore_marker or "").strip()
    if not marker_name:
        log.info("auto-restore: deaktiviert (kein Marker-Name konfiguriert)")
        return None
    marker = _backup_dir() / marker_name
    if not marker.exists():
        log.info(
            "auto-restore: übersprungen — Marker fehlt (%s). "
            "Zum Aktivieren: leere Datei mit diesem Namen ins Backup-"
            "Verzeichnis legen.",
            marker,
        )
        return None

    backups = list_backups()
    if not backups:
        log.info("auto-restore: keine Backups vorhanden, starte fresh")
        return None

    newest = backups[0]
    zip_path = _backup_dir() / newest["filename"]
    if not zip_path.is_file():
        log.warning("auto-restore: Backup-Datei nicht gefunden: %s", zip_path)
        return None

    log.info("auto-restore: stelle %s wieder her (DB war leer/fehlend)", newest["filename"])
    try:
        with zipfile.ZipFile(zip_path) as zf:
            if "database.sqlite" not in zf.namelist():
                log.error("auto-restore: %s enthält keine database.sqlite", newest["filename"])
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
                        log.error("auto-restore: database.sqlite hat falschen Magic-Header")
                        return None
                # Begleitdateien wegräumen (sollten bei fresh install nicht
                # existieren, aber sicher ist sicher)
                for ext in ("", "-wal", "-shm", "-journal"):
                    aux = Path(str(db_path) + ext)
                    if aux.exists():
                        try:
                            aux.unlink()
                        except Exception as e:
                            log.warning("auto-restore: konnte %s nicht entfernen: %s", aux, e)
                db_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(src, db_path)
    except Exception as e:
        log.exception("auto-restore: fehlgeschlagen: %s", e)
        return None

    # Marker konsumieren — Auto-Restore ist ein einmaliger Vorgang. Wer
    # nochmal automatisch restoren möchte (z.B. nach erneutem Volume-
    # Verlust), muss den Marker erneut anlegen. Das verhindert, dass eine
    # versehentlich gelöschte DB stillschweigend durch ein altes Backup
    # ersetzt wird. AUSNAHME Ephemeral-Modus (DB auf tmpfs): dort ist der
    # Restore der NORMALE Startvorgang jedes Pods — der Marker bleibt liegen.
    if settings.db_ephemeral:
        log.info("auto-restore: ephemeral-Modus — Marker bleibt für den nächsten Start")
    else:
        try:
            marker.unlink()
            log.info("auto-restore: Marker %s konsumiert", marker.name)
        except Exception as e:
            log.warning("auto-restore: Marker konnte nicht entfernt werden: %s", e)

    log.info("auto-restore: erfolgreich aus %s — Schema-Migration via init_db", newest["filename"])
    return {
        "ok": True,
        "from": newest["filename"],
        "size": newest.get("size"),
        "metadata": newest.get("metadata", {}),
    }


# ===== Auto-Backup-Loop ===========================================

_last_auto_backup: datetime | None = None


def _backup_interval_seconds() -> int:
    """Effektives Auto-Backup-Intervall: `backup_interval_minutes` (>0)
    übersteuert die Stunden — im Ephemeral-Modus ist dieses Intervall
    zugleich das Verlustfenster bei einem harten Crash."""
    minutes = int(settings.backup_interval_minutes or 0)
    if minutes > 0:
        return minutes * 60
    return max(1, int(settings.backup_interval_hours)) * 3600


def shutdown_backup() -> None:
    """Abschluss-Backup beim geplanten Shutdown — NUR im Ephemeral-Modus
    (dort ginge sonst das letzte Intervall verloren; geplante Deployments
    verlieren damit nichts). Im Default-Modus bewusst no-op, um Backup-Churn
    bei jedem Restart zu vermeiden."""
    if not (settings.db_ephemeral and settings.backup_enabled):
        return
    try:
        path = create_backup()
        log.info("shutdown-backup (ephemeral): %s", path.name)
    except Exception as e:
        log.warning("shutdown-backup fehlgeschlagen: %s", e)


async def auto_backup_loop() -> None:
    """Hintergrund-Task: prüft periodisch, ob ein Auto-Backup fällig ist
    (Intervall: `_backup_interval_seconds`). Erster Lauf erfolgt nach kurzer
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
        interval_s = _backup_interval_seconds()
        try:
            now = datetime.now(UTC)
            due = (
                _last_auto_backup is None or (now - _last_auto_backup).total_seconds() >= interval_s
            )
            if due:
                # Im Executor laufen lassen, damit das Event-Loop nicht blockiert
                await asyncio.to_thread(create_backup)
                _last_auto_backup = now
        except Exception as e:
            log.warning("auto-backup tick failed: %s", e)
        # Prüf-Takt: halbes Intervall, gedeckelt auf [60 s, 1 h] — trägt sowohl
        # das 24-h-Default als auch Minuten-Intervalle des Ephemeral-Modus.
        await asyncio.sleep(min(3600, max(60, interval_s // 2)))
