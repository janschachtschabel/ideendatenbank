"""Backup + Restore — der destruktivste Pfad der App (Restore ersetzt die
gesamte App-DB). Audit-Befund: bislang ohne jede Abdeckung; ein Regressions-
Bug hier fiele erst im Ernstfall auf — genau dann, wenn man das Backup
braucht. Deckt den vollen Zyklus (create → list → download → delete), den
Restore-Roundtrip inkl. Pre-Restore-Sicherung sowie die Abwehrpfade
(kaputte/falsche ZIPs, Größen-Cap, Path-Traversal) ab."""

from __future__ import annotations

import io
import zipfile

import pytest

from app import backup as backup_mod
from app.config import settings
from app.db import connect
from app.ratelimit import limiter


@pytest.fixture(autouse=True)
def _isolated_backups(tmp_path, monkeypatch):
    """Eigenes Backup-Verzeichnis pro Test + Restore-Rate-Limit (3/hour) aus —
    sonst koppeln sich die Restore-Tests untereinander über den Limiter."""
    monkeypatch.setattr(settings, "backup_dir", tmp_path / "backups")
    monkeypatch.setattr(limiter, "enabled", False)  # monkeypatch stellt zurück
    yield


def _seed_marker(title: str = "marker") -> None:
    """Wiedererkennbare Zeile, an der sich der Restore-Roundtrip beweisen lässt."""
    with connect() as con:
        con.execute("INSERT INTO topic (id, title) VALUES ('t-marker', ?)", (title,))


def _marker_title() -> str | None:
    with connect() as con:
        row = con.execute("SELECT title FROM topic WHERE id='t-marker'").fetchone()
    return row["title"] if row else None


def test_backup_create_list_download_delete_cycle(client, mod_headers):
    _seed_marker()
    r = client.post("/api/v1/admin/backup", headers=mod_headers)
    assert r.status_code == 200
    body = r.json()
    fn = body["filename"]
    assert fn.startswith("ideendb-backup-") and fn.endswith(".zip")
    assert body["size"] > 0

    r = client.get("/api/v1/admin/backups", headers=mod_headers)
    assert r.status_code == 200
    listed = r.json()["backups"]
    assert [b["filename"] for b in listed] == [fn]
    # metadata.json aus dem ZIP muss die geseedete Zeile zählen
    assert listed[0]["metadata"]["topic_count"] == 1

    r = client.get(f"/api/v1/admin/backups/{fn}", headers=mod_headers)
    assert r.status_code == 200
    assert r.content[:2] == b"PK"  # ZIP-Magic

    r = client.delete(f"/api/v1/admin/backups/{fn}", headers=mod_headers)
    assert r.status_code == 200 and r.json()["ok"] is True
    assert client.get("/api/v1/admin/backups", headers=mod_headers).json()["backups"] == []


def test_backup_download_unknown_is_404(client, mod_headers):
    r = client.get("/api/v1/admin/backups/ideendb-backup-nope.zip", headers=mod_headers)
    assert r.status_code == 404


def test_backup_path_rejects_traversal_and_foreign_names():
    """Direkt am Helper — die Route mappt ValueError auf 404, hier geht es um
    die eigentliche Abwehr (kein Verzeichnis-Ausbruch, kein Fremd-Download)."""
    for bad in (
        "../ideendb-backup-x.zip",
        "..\\ideendb-backup-x.zip",
        "ideendb-backup-../../etc.zip",
        "somefile.zip",
        "ideendb-backup-x.txt",
    ):
        with pytest.raises(ValueError):
            backup_mod.get_backup_path(bad)


def test_restore_roundtrip_replaces_db_and_creates_pre_restore_backup(client, mod_headers):
    _seed_marker("vor-dem-backup")
    fn = client.post("/api/v1/admin/backup", headers=mod_headers).json()["filename"]
    zip_bytes = client.get(f"/api/v1/admin/backups/{fn}", headers=mod_headers).content

    # DB nach dem Backup verändern — der Restore muss das rückgängig machen.
    with connect() as con:
        con.execute("DELETE FROM topic WHERE id='t-marker'")
    assert _marker_title() is None

    r = client.post(
        "/api/v1/admin/backups/restore",
        files={"file": ("upload.zip", zip_bytes, "application/zip")},
        headers=mod_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["restored_metadata"]["topic_count"] == 1
    # Der Marker aus dem Backup ist wieder da → Datei wurde wirklich ersetzt.
    assert _marker_title() == "vor-dem-backup"
    # Pre-Restore-Sicherung: neben dem Original-Backup liegt jetzt ein zweites.
    names = [
        b["filename"]
        for b in client.get("/api/v1/admin/backups", headers=mod_headers).json()["backups"]
    ]
    assert fn in names and len(names) == 2


def test_restore_rejects_non_zip(client, mod_headers):
    r = client.post(
        "/api/v1/admin/backups/restore",
        files={"file": ("upload.zip", b"definitiv kein zip", "application/zip")},
        headers=mod_headers,
    )
    assert r.status_code == 400
    assert "ZIP" in r.json()["detail"]


def test_restore_rejects_zip_without_database(client, mod_headers):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("readme.txt", "kein backup")
    r = client.post(
        "/api/v1/admin/backups/restore",
        files={"file": ("upload.zip", buf.getvalue(), "application/zip")},
        headers=mod_headers,
    )
    assert r.status_code == 400
    assert "database.sqlite" in r.json()["detail"]


def test_restore_rejects_non_sqlite_payload(client, mod_headers):
    """ZIP-Struktur stimmt, aber die database.sqlite hat keine SQLite-Magic-
    Bytes → muss abgelehnt werden, BEVOR die echte DB angefasst wird."""
    _seed_marker("bleibt")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("database.sqlite", b"x" * 512)  # >100 Bytes, falsche Magic
    r = client.post(
        "/api/v1/admin/backups/restore",
        files={"file": ("upload.zip", buf.getvalue(), "application/zip")},
        headers=mod_headers,
    )
    assert r.status_code == 400
    assert _marker_title() == "bleibt"  # DB unangetastet


def test_restore_rejects_oversize_upload(client, mod_headers, monkeypatch):
    monkeypatch.setattr(settings, "upload_restore_max_bytes", 10)
    r = client.post(
        "/api/v1/admin/backups/restore",
        files={"file": ("upload.zip", b"0" * 64, "application/zip")},
        headers=mod_headers,
    )
    assert r.status_code == 413


# ---- Ephemeral-Modus (DB auf tmpfs/RAM-Disk, Persistenz via Backups) --------
# Variante A des Storage-Befunds: der Request-Pfad berührt den (trägen)
# Storage nie; dafür restauriert JEDER Pod-Start aus dem jüngsten Backup und
# Backups laufen minütlich-granular + beim Shutdown.


def test_backup_interval_prefers_minutes_over_hours(monkeypatch):
    """`backup_interval_minutes > 0` übersteuert das Stunden-Intervall —
    im Ephemeral-Modus ist das Backup-Intervall das Verlustfenster."""
    monkeypatch.setattr(settings, "backup_interval_hours", 24)
    monkeypatch.setattr(settings, "backup_interval_minutes", 10)
    assert backup_mod._backup_interval_seconds() == 600
    monkeypatch.setattr(settings, "backup_interval_minutes", 0)
    assert backup_mod._backup_interval_seconds() == 24 * 3600


def _prepare_auto_restore(tmp_path, monkeypatch) -> None:
    """Backup + Marker-Datei anlegen, dann auf eine fehlende DB-Datei zeigen —
    die Ausgangslage eines frischen (tmpfs-)Starts."""
    _seed_marker("aus-dem-backup")
    backup_mod.create_backup()
    marker = backup_mod._backup_dir() / settings.backup_auto_restore_marker
    marker.write_text("")
    monkeypatch.setattr(settings, "sqlite_path", tmp_path / "fresh" / "db.sqlite")


def test_auto_restore_consumes_marker_by_default(tmp_path, monkeypatch):
    """Default-Modus (persistente DB): Auto-Restore ist ein EINMALIGER Vorgang —
    der Marker wird konsumiert (Schutz vor stillem Ersetzen einer gelöschten DB)."""
    _prepare_auto_restore(tmp_path, monkeypatch)
    result = backup_mod.auto_restore_if_fresh()
    assert result and result["ok"] is True
    assert _marker_title() == "aus-dem-backup"
    marker = backup_mod._backup_dir() / settings.backup_auto_restore_marker
    assert not marker.exists()  # konsumiert


def test_auto_restore_keeps_marker_in_ephemeral_mode(tmp_path, monkeypatch):
    """Ephemeral-Modus: JEDER Start restauriert (tmpfs ist leer) → der Marker
    bleibt liegen, sonst käme der zweite Restart leer hoch."""
    monkeypatch.setattr(settings, "db_ephemeral", True)
    _prepare_auto_restore(tmp_path, monkeypatch)
    result = backup_mod.auto_restore_if_fresh()
    assert result and result["ok"] is True
    assert _marker_title() == "aus-dem-backup"
    marker = backup_mod._backup_dir() / settings.backup_auto_restore_marker
    assert marker.exists()  # bleibt für den nächsten Pod-Start


def test_shutdown_backup_only_in_ephemeral_mode(monkeypatch):
    """Beim geplanten Shutdown sichert der Ephemeral-Modus den letzten Stand —
    geplante Deployments verlieren damit NICHTS. Im Default-Modus (persistente
    DB) passiert nichts (unnötige Backup-Churn vermeiden)."""
    _seed_marker()
    # conftest deaktiviert BACKUP_ENABLED global (Hermetik) — hier gezielt an.
    monkeypatch.setattr(settings, "backup_enabled", True)
    monkeypatch.setattr(settings, "db_ephemeral", False)
    backup_mod.shutdown_backup()
    assert backup_mod.list_backups() == []
    monkeypatch.setattr(settings, "db_ephemeral", True)
    backup_mod.shutdown_backup()
    backups = backup_mod.list_backups()
    assert len(backups) == 1
    assert backups[0]["metadata"]["topic_count"] == 1
