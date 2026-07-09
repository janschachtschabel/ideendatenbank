"""Topic administration routes — create / edit / delete / preview / sort.

Split out of routes.py (behaviour-preserving). Mod-only CRUD for the topic
(theme/challenge) collections in edu-sharing + the SQLite cache. The router is
mounted back onto the main API router via ``include_router`` in routes.py, so the
public paths (/api/v1/admin/topics…) stay exactly the same. The read routes
(GET /topics, GET /topics/{id}) deliberately remain in routes.py for now.
"""

from __future__ import annotations

import asyncio
import logging

import httpx
from fastapi import APIRouter, Body, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import edu_sharing
from . import sync as sync_mod
from .config import settings
from .db import connect
from .routes_common import (
    _build_update_set,
    _log_activity,
    _read_upload_capped,
    _require_moderator,
)

log = logging.getLogger(__name__)

router = APIRouter()


class TopicCreate(BaseModel):
    parent_id: str | None = None  # None = neue Top-Level-Themen-Sammlung
    title: str = Field(..., min_length=2, max_length=120)
    description: str | None = None
    color: str | None = None


class TopicPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    color: str | None = None


class TopicSortItem(BaseModel):
    id: str
    sort_order: int


@router.post("/admin/topics", tags=["topics"], status_code=201)
async def create_topic(
    body: TopicCreate,
    authorization: str | None = Header(None),
):
    """Legt eine neue Themen- oder Herausforderungs-Sammlung in edu-sharing
    an. Mod-only — Owner-/Container-Permissions werden von ES geprüft."""
    await _require_moderator(authorization)
    parent = body.parent_id or settings.ideendb_root_collection_id
    try:
        result = await edu_sharing.client.create_collection(
            parent_id=parent,
            title=body.title,
            description=body.description,
            color=body.color,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, hier eine Sammlung anzulegen.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    new_id = (((result or {}).get("collection") or result or {}).get("ref") or {}).get("id")
    if not new_id:
        raise HTTPException(502, "edu-sharing lieferte keine ID")

    # Sofort in den Cache schreiben (Voll-Sync zieht später nach). Threadpool:
    # SQLite in async-Route darf den Event-Loop nicht blockieren (busy_timeout-
    # Wartezeit würde sonst ALLE Requests einfrieren, nicht nur diesen).
    def _cache_new_topic():
        with connect() as con:
            con.execute(
                "INSERT OR REPLACE INTO topic "
                "(id,parent_id,title,description,color,sort_order,created_at,modified_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (
                    new_id,
                    body.parent_id,
                    body.title,
                    body.description,
                    body.color,
                    100,
                    sync_mod._iso_now(),
                    sync_mod._iso_now(),
                ),
            )

    await asyncio.to_thread(_cache_new_topic)
    await asyncio.to_thread(
        _log_activity,
        action="topic_created",
        authorization=authorization,
        is_mod=True,
        target_type="topic",
        target_id=new_id,
        target_label=body.title,
        detail={"parent_id": body.parent_id},
    )
    return {"ok": True, "id": new_id}


@router.patch("/admin/topics/{topic_id}", tags=["topics"])
async def edit_topic(
    topic_id: str,
    body: TopicPatch,
    authorization: str | None = Header(None),
):
    """Aktualisiert Titel/Beschreibung/Farbe einer Themen-Sammlung in
    edu-sharing + Cache."""
    await _require_moderator(authorization)
    props: dict[str, list[str]] = {}
    if body.title is not None:
        props["cm:title"] = [body.title]
        props["cm:name"] = [body.title]
    if body.description is not None:
        props["cm:description"] = [body.description]
    # Farbe wird aktuell nicht in ES persistiert (kein dediziertes Feld);
    # wir speichern sie nur lokal im Cache, damit die UI sie nutzen kann.
    if props:
        try:
            await edu_sharing.client.update_metadata(
                topic_id,
                props,
                auth_header=authorization,
            )
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                raise HTTPException(403, "Keine Berechtigung, diese Sammlung zu ändern.")
            raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    # SET-Klausel über Whitelist-Helper bauen — Spaltennamen werden gegen
    # eine harte Liste geprüft, Werte gehen parametrisiert rein. So bleibt
    # die SQL injection-sicher, auch wenn jemand später User-Input in die
    # assignments-Liste packen sollte.
    _TOPIC_UPDATABLE = frozenset({"title", "description", "color", "modified_at"})
    assignments: list[tuple[str, object]] = []
    if body.title is not None:
        assignments.append(("title", body.title))
    if body.description is not None:
        assignments.append(("description", body.description))
    if body.color is not None:
        assignments.append(("color", body.color))
    if assignments:
        assignments.append(("modified_at", sync_mod._iso_now()))
        set_sql, params = _build_update_set(assignments, _TOPIC_UPDATABLE)
        params.append(topic_id)

        def _write_topic_patch():
            with connect() as con:
                con.execute(
                    f"UPDATE topic SET {set_sql} WHERE id=?",
                    params,
                )

        await asyncio.to_thread(_write_topic_patch)
    await asyncio.to_thread(
        _log_activity,
        action="topic_edited",
        authorization=authorization,
        is_mod=True,
        target_type="topic",
        target_id=topic_id,
        target_label=body.title,
        detail=body.model_dump(exclude_none=True),
    )
    return {"ok": True}


@router.delete("/admin/topics/{topic_id}", tags=["topics"])
async def delete_topic(
    topic_id: str,
    authorization: str | None = Header(None),
):
    """Löscht eine Themen-/Herausforderungs-Sammlung. Vorsicht: Sammlung
    muss in ES leer sein, sonst lehnt edu-sharing ab. Wir versuchen den
    DELETE und reichen den ES-Status durch — kein Recursive-Force."""
    await _require_moderator(authorization)

    # Vor-Check: hat Cache noch Kinder/Ideen? (Threadpool, s. create_topic)
    def _read_delete_preflight():
        with connect() as con:
            kids = con.execute(
                "SELECT COUNT(*) FROM topic WHERE parent_id=?",
                (topic_id,),
            ).fetchone()[0]
            ideas = con.execute(
                "SELECT COUNT(*) FROM idea WHERE topic_id=?",
                (topic_id,),
            ).fetchone()[0]
            title_row = con.execute(
                "SELECT title FROM topic WHERE id=?",
                (topic_id,),
            ).fetchone()
        return kids, ideas, title_row

    kids, ideas, title_row = await asyncio.to_thread(_read_delete_preflight)
    if kids or ideas:
        raise HTTPException(
            409,
            f"Kann nicht gelöscht werden: enthält noch {kids} Sammlung(en) "
            f"und {ideas} Idee(n). Erst leeren oder verschieben.",
        )
    try:
        await edu_sharing.client.delete_node(topic_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, diese Sammlung zu löschen.")
        if e.response.status_code != 404:
            raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    def _delete_topic_row():
        with connect() as con:
            con.execute("DELETE FROM topic WHERE id=?", (topic_id,))

    await asyncio.to_thread(_delete_topic_row)
    await asyncio.to_thread(
        _log_activity,
        action="topic_deleted",
        authorization=authorization,
        is_mod=True,
        target_type="topic",
        target_id=topic_id,
        target_label=(title_row["title"] if title_row else None),
    )
    return {"ok": True}


@router.post("/admin/topics/{topic_id}/preview", tags=["topics"])
async def upload_topic_preview(
    topic_id: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Lädt ein Vorschaubild für eine Themen-/Herausforderungs-Sammlung."""
    await _require_moderator(authorization)
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(400, "Vorschaubild muss ein Bild sein (image/*).")
    data = await _read_upload_capped(file, settings.upload_image_max_bytes)
    if not data:
        raise HTTPException(400, "Leere Datei")
    try:
        await edu_sharing.client.upload_preview(
            topic_id,
            image_bytes=data,
            filename=file.filename or "preview.png",
            mimetype=file.content_type or "image/png",
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, hier ein Vorschaubild zu setzen.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    # Topic-Cache refreshen, damit die neue preview.url-URL (mit neuem
    # `?modified=`-Token) ins Cache wandert und Browser-Caches umgeht.
    try:
        meta = await edu_sharing.client.node_metadata(
            topic_id,
            auth_header=authorization,
        )
        node = (meta or {}).get("node") or {}
        new_preview = (node.get("preview") or {}).get("url")
        is_icon = (node.get("preview") or {}).get("isIcon", False)
        if new_preview and not is_icon:

            def _write_preview_url():
                with connect() as con:
                    con.execute(
                        "UPDATE topic SET preview_url=? WHERE id=?",
                        (new_preview, topic_id),
                    )

            await asyncio.to_thread(_write_preview_url)
    except Exception as e:
        log.debug("upload_topic_preview: Cache-Refresh fehlgeschlagen: %s", e)
    await asyncio.to_thread(
        _log_activity,
        action="topic_preview_set",
        authorization=authorization,
        is_mod=True,
        target_type="topic",
        target_id=topic_id,
        detail={"size": len(data), "mimetype": file.content_type},
    )
    return {"ok": True}


@router.put("/admin/topics/sort", tags=["topics"])
async def sort_topics(
    items: list[TopicSortItem] = Body(...),
    authorization: str | None = Header(None),
):
    """Setzt sort_order für eine Liste von Themen/Herausforderungen.
    Reihenfolge im Body bestimmt die Anzeige (kleinere Zahl = weiter oben).
    Persistiert nur in der App-DB — edu-sharing kennt kein Reihenfolge-Feld."""
    await _require_moderator(authorization)

    def _write_sort_order():
        with connect() as con:
            for it in items:
                con.execute(
                    "UPDATE topic SET sort_order=? WHERE id=?",
                    (it.sort_order, it.id),
                )

    await asyncio.to_thread(_write_sort_order)
    await asyncio.to_thread(
        _log_activity,
        action="topics_sorted",
        authorization=authorization,
        is_mod=True,
        target_type="topic",
        detail={"count": len(items)},
    )
    return {"ok": True, "updated": len(items)}
