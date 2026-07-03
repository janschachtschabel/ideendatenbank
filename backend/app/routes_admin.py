"""Admin operations — manual sync trigger + backup/restore management.

Split out of routes.py (behaviour-preserving). Mod-only. Mounted back onto the
main router via include_router in routes.py, so /api/v1/admin/sync and
/api/v1/admin/backup* paths stay unchanged.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, Header, HTTPException, Request, UploadFile

from . import backup as backup_mod
from . import sync as sync_mod
from .config import settings
from .ratelimit import limiter
from .routes_common import _log_activity, _read_upload_capped, _require_moderator

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/admin/sync", tags=["admin"])
async def trigger_sync(authorization: str | None = Header(None)):
    await _require_moderator(authorization)
    return await sync_mod.run_sync()


# ===== Backup / Restore (Mod-only) =======================================


@router.post("/admin/backup", tags=["admin"])
async def admin_backup_create(authorization: str | None = Header(None)):
    """Erstellt jetzt ein neues Backup. Behält die letzten N (laut
    settings.backup_keep), löscht ältere automatisch."""
    await _require_moderator(authorization)
    try:
        # Im Executor laufen lassen — VACUUM INTO + ZIP-Pack ist I/O-lastig
        import asyncio as _aio

        path = await _aio.to_thread(backup_mod.create_backup)
    except Exception as e:
        log.exception("backup failed")
        raise HTTPException(500, f"Backup fehlgeschlagen: {e}")
    _log_activity(
        action="backup_created",
        authorization=authorization,
        is_mod=True,
        target_type="backup",
        target_label=path.name,
        detail={"size": path.stat().st_size},
    )
    return {
        "ok": True,
        "filename": path.name,
        "size": path.stat().st_size,
    }


@router.get("/admin/backups", tags=["admin"])
async def admin_backup_list(authorization: str | None = Header(None)):
    """Liste vorhandener Backups, neueste zuerst."""
    await _require_moderator(authorization)
    return {
        "backups": backup_mod.list_backups(),
        "keep": settings.backup_keep,
        "interval_hours": settings.backup_interval_hours,
        "enabled": settings.backup_enabled,
    }


@router.get("/admin/backups/{filename}", tags=["admin"])
async def admin_backup_download(
    filename: str,
    authorization: str | None = Header(None),
):
    """Stream-Download einer Backup-ZIP."""
    await _require_moderator(authorization)
    try:
        path = backup_mod.get_backup_path(filename)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(404, str(e))
    from fastapi.responses import FileResponse

    return FileResponse(
        path,
        media_type="application/zip",
        filename=filename,
    )


@router.delete("/admin/backups/{filename}", tags=["admin"])
async def admin_backup_delete(
    filename: str,
    authorization: str | None = Header(None),
):
    """Löscht ein Backup manuell. Pre-Restore-Backups bleiben dadurch nicht
    automatisch erhalten — wer eines aufheben will, muss es vorher
    herunterladen."""
    await _require_moderator(authorization)
    try:
        backup_mod.delete_backup(filename)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(404, str(e))
    _log_activity(
        action="backup_deleted",
        authorization=authorization,
        is_mod=True,
        target_type="backup",
        target_label=filename,
    )
    return {"ok": True}


@router.post("/admin/backups/restore", tags=["admin"])
@limiter.limit("3/hour")
async def admin_backup_restore(
    request: Request,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Stellt aus einer hochgeladenen ZIP wieder her. Vor dem Austausch
    wird automatisch ein „pre-restore"-Backup angelegt — sicherheitshalber.

    WARNUNG: Aktivität-Log und alle App-DB-Daten werden auf den Stand des
    Backups zurückgesetzt. edu-sharing-Daten werden nicht angefasst, der
    nächste Voll-Sync zieht den aktuellen Stand vom Repo nach."""
    await _require_moderator(authorization)
    data = await _read_upload_capped(file, settings.upload_restore_max_bytes)
    if not data:
        raise HTTPException(400, "Leere Datei")
    try:
        result = await backup_mod.restore_backup(data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("restore failed")
        raise HTTPException(500, f"Restore fehlgeschlagen: {e}")
    _log_activity(
        action="backup_restored",
        authorization=authorization,
        is_mod=True,
        target_type="backup",
        target_label=file.filename,
        detail={"size": len(data), "restored_metadata": result.get("restored_metadata")},
    )
    return result
