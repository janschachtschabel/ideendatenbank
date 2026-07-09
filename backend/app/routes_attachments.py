"""Idea media — main content upload, preview image, and file attachments.

Split out of routes.py (behaviour-preserving). Owns everything that puts files
on an idea: uploading the main content document, setting the preview image
(including the anonymous upload-token path for fresh submissions and the
preview-URL cache-buster), and the attachment lifecycle as child-IOs
(``ccm:childio`` series objects): upload, list, rename, delete, replace
content. ``_verify_child_of`` guards every per-attachment operation so a
foreign node can never be touched via a mismatched idea id.

The router is mounted back onto the main API router via ``include_router`` in
routes.py, so the public paths (/api/v1/ideas/{id}/content, /preview,
/attachments…) stay exactly the same.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import edu_sharing
from . import sync as sync_mod
from .auth import can_edit_idea as _can_edit_idea
from .auth import is_owner_or_mod as _is_owner_or_mod
from .config import settings
from .db import connect
from .routes_common import _log_activity, _read_upload_capped, _upload_token_valid

log = logging.getLogger(__name__)

router = APIRouter()


def _invalidate_children_cache(idea_id: str) -> None:
    """Tier-C-Anhang-Cache (Child-IOs) einer Idee verwerfen — aufrufen, sobald
    sich die Anhänge ändern (Add/Rename/Delete/Replace), damit die Änderung
    SOFORT statt erst nach Ablauf der TTL erscheint. Best-effort; die TTL bleibt
    der Backstop, falls dies fehlschlägt."""
    try:
        with connect() as con:
            con.execute("UPDATE idea SET children_cache=NULL WHERE id=?", (idea_id,))
    except Exception:
        pass


@router.post("/ideas/{idea_id}/content", tags=["ideas"])
async def upload_idea_content(
    idea_id: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Lädt eine Datei (Anhang oder Hauptinhalt) ans ccm:io der Idee.
    Nur Owner/Mod/angenommene Mitwirkende (App-Gate); zusätzlich prüft
    edu-sharing die Schreibrechte."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    if not (await _can_edit_idea(idea_id, authorization, verified=True))[0]:
        raise HTTPException(
            403, "Keine Berechtigung, diese Idee zu bearbeiten (nur Team/Moderation)."
        )
    data = await _read_upload_capped(file, settings.upload_content_max_bytes)
    if not data:
        raise HTTPException(400, "Leere Datei")
    try:
        await edu_sharing.client.upload_content(
            idea_id,
            file_bytes=data,
            filename=file.filename or "upload.bin",
            mimetype=file.content_type or "application/octet-stream",
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, hier Inhalte zu speichern.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    # io-Selbstanhang im Cache auffrischen (seit dem Voll-Cache wird er aus dem
    # idea-Row bedient statt live) → der hochgeladene Inhalt erscheint sofort.
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass
    return {"ok": True, "size": len(data), "name": file.filename}


@router.post("/ideas/{idea_id}/preview", tags=["ideas"])
async def upload_idea_preview(
    idea_id: str,
    file: UploadFile = File(...),
    upload_token: str | None = Form(None),
    authorization: str | None = Header(None),
):
    """Setzt das Vorschaubild ans ccm:io der Idee (Owner/Mod/Mitwirkende).

    Anonyme Einreicher dürfen ihr Vorschaubild an die FRISCH eingereichte, noch
    nicht einsortierte Idee hängen — der Upload läuft dann über den WLO-Gast
    (dafür ist er da). Bereits einsortierte Ideen liegen im Cache und verlangen
    eine Anmeldung."""
    if not authorization:
        # Anonym nur an die EIGENE frische Einreichung: gültiges Upload-Token
        # (Objekt-Autorisierung) UND noch nicht einsortiert.
        if not _upload_token_valid(upload_token, idea_id):
            raise HTTPException(
                403,
                "Kein gültiges Upload-Token — für diese Idee ist zum Setzen eines "
                "Vorschaubilds eine Anmeldung nötig.",
            )

        def _is_cached_idea():
            with connect() as con:
                return con.execute(
                    "SELECT 1 FROM idea WHERE id=? OR original_id=?", (idea_id, idea_id)
                ).fetchone()

        cached = await asyncio.to_thread(_is_cached_idea)
        if cached:
            raise HTTPException(
                403, "Für bereits einsortierte Ideen ist zum Bearbeiten eine Anmeldung nötig."
            )
    elif not (await _can_edit_idea(idea_id, authorization, verified=True))[0]:
        raise HTTPException(
            403, "Keine Berechtigung, diese Idee zu bearbeiten (nur Team/Moderation)."
        )
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(400, "Vorschaubild muss ein Bild sein (image/*).")
    data = await _read_upload_capped(file, settings.upload_image_max_bytes)
    if not data:
        raise HTTPException(400, "Leere Datei")
    try:
        await edu_sharing.client.upload_preview(
            idea_id,
            image_bytes=data,
            filename=file.filename or "preview.png",
            mimetype=file.content_type or "image/png",
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, hier ein Vorschaubild zu setzen.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    # Cache aktualisieren: edu-sharing setzt einen neuen `?modified=`-Param
    # in preview.url. Ohne Refresh würde das Frontend weiter die alte URL
    # (alter Zeitstempel) anfragen und den Browser-Cache treffen.
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception as e:
        log.debug("upload_idea_preview: Cache-Refresh fehlgeschlagen: %s", e)
    # Falls preview.url im Sync NICHT direkt aufgefrischt wurde (z.B. weil
    # der Knoten als Reference im Postfach liegt), hängen wir manuell einen
    # Cache-Buster an, damit der Browser das neue Bild lädt.
    try:

        def _write_preview_cache_buster():
            with connect() as con:
                row = con.execute(
                    "SELECT preview_url FROM idea WHERE id=?",
                    (idea_id,),
                ).fetchone()
                if row and row["preview_url"]:
                    bust = int(datetime.now(UTC).timestamp())
                    sep = "&" if "?" in row["preview_url"] else "?"
                    new_url = f"{row['preview_url']}{sep}cb={bust}"
                    # Cache-Buster nur, wenn nicht bereits via Sync gesetzt
                    if "modified=" not in row["preview_url"]:
                        con.execute(
                            "UPDATE idea SET preview_url=? WHERE id=?",
                            (new_url, idea_id),
                        )

        await asyncio.to_thread(_write_preview_cache_buster)
    except Exception as e:
        log.debug("upload_idea_preview: Cache-Buster fehlgeschlagen: %s", e)
    return {"ok": True}


# =====================================================================
# Anhänge an Ideen — Serienobjekte (`ccm:io_childobject`).
#
# Statt einer Geschwister-Sammlung legen wir das Anhang-IO direkt UNTER
# die Idee als Child. Vorteile:
#   - keine separate Sammlungs-Schreibrechte nötig (Owner der Idee reicht)
#   - native Eltern-Kind-Beziehung über `ccm:childio`-Assoziation
#   - kein Hilfs-Keyword `attachment-of:<id>` mehr
#   - Children werden bei Idee-Löschung automatisch mit-gelöscht
# Siehe Skill `wlo-childobjects` für API-Details.
# =====================================================================


class AttachmentRename(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


async def _verify_child_of(
    *,
    child_id: str,
    parent_id: str,
    authorization: str,
) -> dict:
    """Sicherheits-Check: das Child muss tatsächlich unter dem angegebenen
    Eltern-IO hängen. Verhindert versehentliche Operationen auf fremden
    Knoten. Gibt die Node-Metadaten zurück (für nachfolgenden Code reusable)."""
    try:
        meta = await edu_sharing.client.node_metadata(
            child_id,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    parent = (meta.get("node") or {}).get("parent") or {}
    actual_parent = parent.get("id") or (parent.get("ref") or {}).get("id")
    if actual_parent != parent_id:
        raise HTTPException(
            409,
            "Dieser Anhang gehört nicht zu dieser Idee. Aus Sicherheitsgründen abgelehnt.",
        )
    return meta


@router.patch("/ideas/{idea_id}/attachments/{attachment_id}", tags=["ideas"])
async def rename_attachment(
    idea_id: str,
    attachment_id: str,
    body: AttachmentRename,
    authorization: str | None = Header(None),
):
    """Benennt einen Anhang um. App-Gate: Owner/Mod/Mitwirkende. Sicherheits-
    Check: Anhang muss Child der Idee sein."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    if not (await _can_edit_idea(idea_id, authorization, verified=True))[0]:
        raise HTTPException(
            403, "Keine Berechtigung, Anhänge dieser Idee zu bearbeiten (nur Team/Moderation)."
        )
    await _verify_child_of(
        child_id=attachment_id,
        parent_id=idea_id,
        authorization=authorization,
    )
    new_name = body.name.strip()
    try:
        await edu_sharing.client.update_metadata(
            attachment_id,
            {"cm:name": [new_name], "cm:title": [new_name], "cclom:title": [new_name]},
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, diesen Anhang umzubenennen.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    await asyncio.to_thread(
        _log_activity,
        action="attachment_renamed",
        authorization=authorization,
        target_type="attachment",
        target_id=attachment_id,
        target_label=new_name,
        detail={"idea_id": idea_id},
    )
    _invalidate_children_cache(idea_id)
    return {"ok": True, "name": new_name}


@router.delete("/ideas/{idea_id}/attachments/{attachment_id}", tags=["ideas"])
async def delete_attachment(
    idea_id: str,
    attachment_id: str,
    authorization: str | None = Header(None),
):
    """Löscht einen einzelnen Anhang. App-Gate: NUR Owner/Mod (Mitwirkende
    dürfen nicht löschen — edu-sharing's „Collaborator" erlaubt das ohnehin
    nicht). Sicherheits-Check: Anhang muss Child der Idee sein."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    if not (await _is_owner_or_mod(idea_id, authorization, verified=True))[0]:
        raise HTTPException(403, "Nur Einreicher:in oder Moderation können Anhänge löschen.")
    meta = await _verify_child_of(
        child_id=attachment_id,
        parent_id=idea_id,
        authorization=authorization,
    )
    att_props = (meta.get("node") or {}).get("properties") or {}
    att_name = (att_props.get("cm:name") or att_props.get("cclom:title") or [None])[0] or "Datei"
    try:
        await edu_sharing.client.delete_node(attachment_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, diesen Anhang zu löschen.")
        if e.response.status_code != 404:
            raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    await asyncio.to_thread(
        _log_activity,
        action="attachment_deleted",
        authorization=authorization,
        target_type="attachment",
        target_id=attachment_id,
        target_label=att_name,
        detail={"idea_id": idea_id},
    )
    _invalidate_children_cache(idea_id)
    return {"ok": True}


@router.put("/ideas/{idea_id}/attachments/{attachment_id}/content", tags=["ideas"])
async def replace_attachment_content(
    idea_id: str,
    attachment_id: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Tauscht die Datei eines Anhangs aus (neue Version als Content). App-Gate:
    Owner/Mod/Mitwirkende. Sicherheits-Check: der Anhang muss ein Child der Idee
    sein — damit lässt sich der Hauptknoten der Idee NICHT versehentlich
    überschreiben."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    if not (await _can_edit_idea(idea_id, authorization, verified=True))[0]:
        raise HTTPException(
            403, "Keine Berechtigung, Anhänge dieser Idee zu bearbeiten (nur Team/Moderation)."
        )
    await _verify_child_of(
        child_id=attachment_id,
        parent_id=idea_id,
        authorization=authorization,
    )
    data = await _read_upload_capped(file, settings.upload_attachment_max_bytes)
    if not data:
        raise HTTPException(400, "Leere Datei")
    filename = file.filename or "upload.bin"
    mimetype = file.content_type or "application/octet-stream"
    try:
        await edu_sharing.client.upload_content(
            attachment_id,
            file_bytes=data,
            filename=filename,
            mimetype=mimetype,
            auth_header=authorization,
        )
        # cm:name an die neue Datei angleichen (korrekte Endung beim Download).
        # cm:title/cclom:title bleiben unangetastet → ein zuvor per „Umbenennen"
        # gesetzter Anzeigename bleibt erhalten.
        try:
            await edu_sharing.client.update_metadata(
                attachment_id,
                {"cm:name": [filename]},
                auth_header=authorization,
            )
        except Exception:
            pass
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, diesen Anhang auszutauschen.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass
    await asyncio.to_thread(
        _log_activity,
        action="attachment_replaced",
        authorization=authorization,
        target_type="attachment",
        target_id=attachment_id,
        target_label=filename,
        detail={"idea_id": idea_id, "size": len(data), "mimetype": mimetype},
    )
    _invalidate_children_cache(idea_id)
    return {"ok": True, "name": filename, "size": len(data)}


@router.post("/ideas/{idea_id}/attachments/upload", tags=["ideas"])
async def upload_attachment(
    idea_id: str,
    file: UploadFile = File(...),
    upload_token: str | None = Form(None),
    authorization: str | None = Header(None),
):
    """Lädt einen Anhang direkt als Child-IO (`ccm:childio` +
    `ccm:io_childobject`-Aspekt) unter die Idee. App-Gate: Owner/Mod/
    angenommene Mitwirkende.

    Anonyme Einreicher dürfen Anhänge an die FRISCH eingereichte, noch nicht
    einsortierte Idee hängen — der Upload läuft dann über den WLO-Gast.
    Bereits einsortierte Ideen liegen im Cache und verlangen eine Anmeldung."""
    if not authorization:
        # Anonym nur an die EIGENE frische Einreichung: gültiges Upload-Token
        # (Objekt-Autorisierung) UND noch nicht einsortiert.
        if not _upload_token_valid(upload_token, idea_id):
            raise HTTPException(
                403,
                "Kein gültiges Upload-Token — für diese Idee ist zum Anhängen "
                "eine Anmeldung nötig.",
            )

        def _is_cached_idea():
            with connect() as con:
                return con.execute(
                    "SELECT 1 FROM idea WHERE id=? OR original_id=?", (idea_id, idea_id)
                ).fetchone()

        cached = await asyncio.to_thread(_is_cached_idea)
        if cached:
            raise HTTPException(
                403, "Für bereits einsortierte Ideen ist zum Anhängen eine Anmeldung nötig."
            )
    elif not (await _can_edit_idea(idea_id, authorization, verified=True))[0]:
        raise HTTPException(
            403, "Keine Berechtigung, an diese Idee Anhänge zu hängen (nur Team/Moderation)."
        )

    data = await _read_upload_capped(file, settings.upload_attachment_max_bytes)
    if not data:
        raise HTTPException(400, "Leere Datei")
    filename = file.filename or "upload.bin"
    mimetype = file.content_type or "application/octet-stream"

    # Step 1: Child-IO als Serienobjekt unter der Idee anlegen.
    # Order = aktuelle Anzahl bestehender Children, damit Reihenfolge stabil bleibt.
    try:
        existing = await edu_sharing.client.list_child_objects(
            idea_id,
            auth_header=authorization,
        )
    except Exception:
        existing = []
    order = len(existing)
    # Gesamt-Obergrenze pro Idee serverseitig durchsetzen (Frontend-Limit allein
    # reicht nicht, seit anonyme Uploads über den Gast laufen).
    if order >= settings.max_attachments_per_idea:
        raise HTTPException(
            409,
            f"Maximal {settings.max_attachments_per_idea} Anhänge pro Idee erreicht.",
        )

    try:
        result = await edu_sharing.client.add_child_object(
            parent_id=idea_id,
            filename=filename,
            order=order,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, an diese Idee Anhänge zu hängen.")
        if e.response.status_code == 404:
            raise HTTPException(404, "Idee nicht gefunden")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    new_id = ((result or {}).get("node") or {}).get("ref", {}).get("id")
    if not new_id:
        raise HTTPException(502, "edu-sharing lieferte keine ID für den neuen Anhang")

    # Step 2: Bytes als content uploaden
    try:
        await edu_sharing.client.upload_content(
            new_id,
            file_bytes=data,
            filename=filename,
            mimetype=mimetype,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        # Aufräumen — Stub-Node ohne Content ist Datenmüll
        try:
            await edu_sharing.client.delete_node(new_id, auth_header=authorization)
        except Exception:
            pass
        raise HTTPException(
            e.response.status_code,
            f"edu-sharing Upload-Fehler: {e.response.text[:200]}",
        )
    # Idee-Cache anstoßen — modified_at aktuell halten.
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass
    await asyncio.to_thread(
        _log_activity,
        action="attachment_uploaded",
        authorization=authorization,
        target_type="attachment",
        target_id=new_id,
        target_label=filename,
        detail={"idea_id": idea_id, "size": len(data), "mimetype": mimetype},
    )
    _invalidate_children_cache(idea_id)
    return {"ok": True, "node_id": new_id, "name": filename, "size": len(data)}


@router.get("/ideas/{idea_id}/attachments", tags=["ideas"])
async def list_attachments(
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Listet alle Child-IO-Anhänge unter einer Idee, sortiert nach
    `ccm:childobject_order`."""
    try:
        children = await edu_sharing.client.list_child_objects(
            idea_id,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(404, "Idee nicht gefunden")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    items = []
    for n in children:
        ref = n.get("ref") or {}
        props = n.get("properties") or {}
        items.append(
            {
                "node_id": ref.get("id"),
                "name": (props.get("cm:name") or [n.get("name")])[0],
                "mimetype": (props.get("ccm:content-type") or [None])[0] or n.get("mimetype"),
                "size": n.get("size"),
                "created_at": n.get("createdAt"),
                "order": (props.get("ccm:childobject_order") or [None])[0],
                "preview_url": (n.get("preview") or {}).get("url"),
                # Konsistent zum primären Anhang-Serialisierer (_attachment_dict):
                # die edu-sharing-Content-URL, nicht ein erfundenes es_render_base.
                "render_url": (n.get("content") or {}).get("url"),
            }
        )
    return {"items": items, "count": len(items)}
