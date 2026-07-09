"""Moderation core — visibility (hide/unhide + admin listings) and filing
(move / bulk-move / change-topic / publish).

The other moderation slices live in their own modules: routes_inbox.py
(inbox + sync-diff) and routes_mod_dashboard.py (reports/stats/activity/
moderators). Mounted onto the main router via ``include_router`` in routes.py —
public paths stay unchanged.
"""

from __future__ import annotations

import asyncio
import logging

import httpx
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException
from pydantic import BaseModel, Field

from . import edu_sharing
from .db import connect
from .routes_common import (
    _log_activity,
    _publish_original_safe,
    _reference_into_collection,
    _refresh_children_cache_bg,
    _require_moderator,
    _unpublish_original_safe,
)

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/admin/hidden-ideas", tags=["moderation"])
async def list_hidden_ideas(authorization: str | None = Header(None)):
    """Liste der versteckten Ideen — für den Mod-Tab „Versteckt"."""
    await _require_moderator(authorization)

    # Threadpool: SQLite in async-Route darf den Event-Loop nicht blockieren
    # (busy_timeout-Wartezeit träfe sonst ALLE Requests, nicht nur diesen).
    def _read_hidden():
        with connect() as con:
            return con.execute(
                """SELECT id, title, owner_username, hidden_reason, modified_at
                     FROM idea WHERE hidden = 1
                    ORDER BY modified_at DESC LIMIT 500"""
            ).fetchall()

    rows = await asyncio.to_thread(_read_hidden)
    return {"count": len(rows), "items": [dict(r) for r in rows]}


@router.get("/admin/all-ideas", tags=["moderation"])
async def list_all_ideas_admin(
    q: str | None = None,
    authorization: str | None = Header(None),
):
    """Alle Ideen inkl. versteckte — für die Sichtbarkeits-Verwaltung im
    Mod-Tab „Versteckt". Optionaler Titel-Filter `q` (LIKE, Wildcards
    escaped). Versteckte zuerst, dann nach Änderungsdatum. Nur Mod."""
    await _require_moderator(authorization)
    sql = (
        "SELECT id, title, owner_username, COALESCE(hidden, 0) AS hidden, "
        "hidden_reason, modified_at FROM idea"
    )
    params: list = []
    if q and q.strip():
        like = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        sql += " WHERE title LIKE ? ESCAPE '\\'"
        params.append(f"%{like}%")
    sql += " ORDER BY COALESCE(hidden, 0) DESC, modified_at DESC LIMIT 400"

    def _read_all_ideas():
        with connect() as con:
            return con.execute(sql, params).fetchall()

    rows = await asyncio.to_thread(_read_all_ideas)
    return {"count": len(rows), "items": [dict(r) for r in rows]}


@router.post("/admin/ideas/{idea_id}/hide", tags=["moderation"])
async def hide_idea(
    idea_id: str,
    body: dict | None = None,
    authorization: str | None = Header(None),
):
    """Idee soft-deleten: bleibt in der DB, ist aber für öffentliche Listen
    und Detail-Seiten unsichtbar. Reversibel via /unhide."""
    await _require_moderator(authorization)
    reason = (body or {}).get("reason") if isinstance(body, dict) else None

    def _hide_in_cache():
        with connect() as con:
            row = con.execute(
                "SELECT title, original_id FROM idea WHERE id=?",
                (idea_id,),
            ).fetchone()
            if not row:
                raise HTTPException(404, "Idee nicht gefunden")
            con.execute(
                "UPDATE idea SET hidden = 1, hidden_reason = ? WHERE id=?",
                (reason, idea_id),
            )
        return row

    row = await asyncio.to_thread(_hide_in_cache)
    # Öffentliche Freigabe des Originals entziehen, damit die versteckte Idee
    # auch direkt über edu-sharing nicht mehr anonym erreichbar ist (das App-DB-
    # Flag allein blendet sie nur in der App aus).
    await _unpublish_original_safe(row["original_id"] or idea_id, authorization)
    await asyncio.to_thread(
        _log_activity,
        action="idea_hidden",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        target_id=idea_id,
        target_label=row["title"],
        detail={"reason": reason} if reason else None,
    )
    return {"ok": True}


@router.post("/admin/ideas/{idea_id}/unhide", tags=["moderation"])
async def unhide_idea(
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Idee wieder sichtbar machen."""
    await _require_moderator(authorization)

    def _unhide_in_cache():
        with connect() as con:
            row = con.execute(
                "SELECT title, original_id FROM idea WHERE id=?",
                (idea_id,),
            ).fetchone()
            if not row:
                raise HTTPException(404, "Idee nicht gefunden")
            con.execute(
                "UPDATE idea SET hidden = 0, hidden_reason = NULL WHERE id=?",
                (idea_id,),
            )
        return row

    row = await asyncio.to_thread(_unhide_in_cache)
    # Wieder veröffentlichen, damit Vorschau/Inhalt erneut anonym sichtbar sind
    # (symmetrisch zum Un-Publish beim Verstecken).
    await _publish_original_safe(row["original_id"] or idea_id, authorization)
    await asyncio.to_thread(
        _log_activity,
        action="idea_unhidden",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        target_id=idea_id,
        target_label=row["title"],
    )
    return {"ok": True}


# ===== Idee verschieben / einsortieren (Mod-only) =========================


class MoveRequest(BaseModel):
    node_id: str
    target_topic_id: str


class BulkMoveRequest(BaseModel):
    node_ids: list[str] = Field(..., min_length=1, max_length=50)
    target_topic_id: str


class ChangeTopicRequest(BaseModel):
    new_topic_id: str


@router.post("/moderation/ideas/{idea_id}/change-topic", tags=["moderation"])
async def change_idea_topic(
    idea_id: str,
    body: ChangeTopicRequest,
    authorization: str | None = Header(None),
):
    """Wechselt die Herausforderung einer Idee. Praktisch: löscht die alte
    Reference und legt eine neue im Ziel-Topic an. Original bleibt in der
    Community-Inbox unangetastet.

    Idempotent: ist die Idee bereits im Ziel-Topic, passiert nichts.
    Nur Moderatoren — Herausforderungs-Zuordnung ist redaktioneller Akt.
    """
    await _require_moderator(authorization)

    def _read_change_topic_state():
        with connect() as con:
            row = con.execute(
                "SELECT id, original_id, topic_id, title FROM idea WHERE id = ?",
                (idea_id,),
            ).fetchone()
            target = con.execute(
                "SELECT id, title FROM topic WHERE id = ?",
                (body.new_topic_id,),
            ).fetchone()
            return row, target

    row, target = await asyncio.to_thread(_read_change_topic_state)
    if not row:
        raise HTTPException(404, "Idee nicht im Cache — unbekannte ID")
    if not target:
        raise HTTPException(404, f"Ziel-Herausforderung {body.new_topic_id} nicht gefunden")

    current_topic = row["topic_id"]
    if current_topic == body.new_topic_id:
        return {
            "ok": True,
            "message": "Idee ist bereits in dieser Herausforderung",
            "result_id": idea_id,
            "no_op": True,
        }

    # `original_id` zeigt auf den Inbox-Knoten. Falls die Row selbst das
    # Original ist (z.B. neu eingereicht, noch nirgends referenziert),
    # nehmen wir die Row-ID als Source.
    source_id = row["original_id"] or row["id"]

    # 1. Neue Reference im Ziel-Topic
    try:
        new_ref_id = await _reference_into_collection(
            source_id,
            body.new_topic_id,
            authorization=authorization,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code,
            f"edu-sharing: {e.response.text[:200]}",
        )

    # 2. Alte Reference löschen — aber nur wenn die App-Row tatsächlich eine
    #    Reference war (original_id gesetzt). Sonst (Original direkt unter
    #    altem Topic) würden wir den Inhalt verlieren.
    deleted_old = False
    if row["original_id"] and row["id"] != new_ref_id:
        try:
            await edu_sharing.client.delete_collection_reference(
                row["id"],
                auth_header=authorization,
            )

            def _delete_old_reference_cache():
                with connect() as con:
                    con.execute("DELETE FROM idea WHERE id = ?", (row["id"],))
                    con.execute("DELETE FROM idea_fts WHERE id = ?", (row["id"],))

            await asyncio.to_thread(_delete_old_reference_cache)
            deleted_old = True
        except Exception as e:
            log.warning("change-topic: alte Reference %s nicht gelöscht: %s", row["id"], e)

    await asyncio.to_thread(
        _log_activity,
        action="idea_topic_changed",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        target_id=idea_id,
        target_label=row["title"],
        detail={
            "from_topic_id": current_topic,
            "to_topic_id": body.new_topic_id,
            "to_topic_title": target["title"],
            "new_ref_id": new_ref_id,
            "old_ref_deleted": deleted_old,
        },
    )
    return {
        "ok": True,
        "moved_to": target["title"],
        "result_id": new_ref_id,
        "old_ref_deleted": deleted_old,
    }


@router.post("/moderation/bulk_move", tags=["moderation"])
async def bulk_move_to_topic(
    body: BulkMoveRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
):
    """Referenziert mehrere Inbox-Ideen in eine Ziel-Herausforderung.
    Pro-Item-Fehler werden gesammelt; der Gesamtaufruf bricht nicht ab.
    """
    await _require_moderator(authorization)

    def _read_target_topic():
        with connect() as con:
            return con.execute(
                "SELECT id,title FROM topic WHERE id = ?", (body.target_topic_id,)
            ).fetchone()

    t = await asyncio.to_thread(_read_target_topic)
    if not t:
        raise HTTPException(404, f"Unknown target topic {body.target_topic_id}")

    succeeded: list[str] = []
    failed: list[dict] = []
    for nid in body.node_ids:
        try:
            new_id = await _reference_into_collection(
                nid,
                body.target_topic_id,
                authorization=authorization,
            )
        except httpx.HTTPStatusError as e:
            failed.append(
                {"id": nid, "status": e.response.status_code, "detail": e.response.text[:160]}
            )
            continue
        except Exception as e:
            failed.append({"id": nid, "status": 0, "detail": str(e)[:160]})
            continue

        # Anhang-Cache der frischen Reference vorwärmen (s. move_to_topic).
        background_tasks.add_task(_refresh_children_cache_bg, new_id, authorization)

        # Titel für Log (aus Cache nach Upsert)
        def _read_moved_title(current_new_id=new_id, current_nid=nid):
            with connect() as con:
                r = con.execute(
                    "SELECT title FROM idea WHERE id=? OR original_id=?",
                    (current_new_id, current_nid),
                ).fetchone()
                return r["title"] if r else None

        moved_title = await asyncio.to_thread(_read_moved_title)
        await asyncio.to_thread(
            _log_activity,
            action="idea_moved",
            authorization=authorization,
            is_mod=True,
            target_type="idea",
            target_id=nid,
            target_label=moved_title,
            detail={
                "to_topic_id": body.target_topic_id,
                "to_topic_title": t["title"],
                "result_id": new_id,
                "bulk": True,
            },
        )
        succeeded.append(nid)

    return {
        "ok": len(failed) == 0,
        "moved_to": t["title"],
        "succeeded": succeeded,
        "failed": failed,
        "succeeded_count": len(succeeded),
        "failed_count": len(failed),
    }


@router.post("/moderation/move", tags=["moderation"])
async def move_to_topic(
    body: MoveRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
):
    """Referenziert eine Inbox-Idee in eine Herausforderung. Caller muss
    Moderator sein. Original bleibt in der Inbox — die Sammlung bekommt
    einen Reference-Knoten dazu (HackathOERn-Standard).
    Der Endpoint heißt aus historischen Gründen weiterhin /move."""
    await _require_moderator(authorization)

    def _read_target_topic():
        with connect() as con:
            return con.execute(
                "SELECT id,title FROM topic WHERE id = ?", (body.target_topic_id,)
            ).fetchone()

    t = await asyncio.to_thread(_read_target_topic)
    if not t:
        raise HTTPException(404, f"Unknown target topic {body.target_topic_id}")

    try:
        new_id = await _reference_into_collection(
            body.node_id,
            body.target_topic_id,
            authorization=authorization,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code,
            f"edu-sharing: {e.response.text[:200]}",
        )

    # Anhang-Cache der frischen Reference VORWÄRMEN (nach der Antwort): der
    # erste Detailaufruf einer gerade freigeschalteten Idee zahlte sonst den
    # einzigen verbliebenen synchronen ES-Call — bei ES-Lastspitzen live
    # mehrere Sekunden. Ein ES-Call pro Freischaltung, best-effort.
    background_tasks.add_task(_refresh_children_cache_bg, new_id, authorization)

    # Titel für Log
    def _read_moved_title():
        with connect() as con:
            r = con.execute(
                "SELECT title FROM idea WHERE id=? OR original_id=?",
                (new_id, body.node_id),
            ).fetchone()
            return r["title"] if r else None

    moved_title = await asyncio.to_thread(_read_moved_title)
    await asyncio.to_thread(
        _log_activity,
        action="idea_moved",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        target_id=body.node_id,
        target_label=moved_title,
        detail={
            "to_topic_id": body.target_topic_id,
            "to_topic_title": t["title"],
            "result_id": new_id,
        },
    )

    return {"ok": True, "moved_to": t["title"], "result_id": new_id}


@router.post("/moderation/ideas/{idea_id}/publish", tags=["moderation"])
async def publish_idea(idea_id: str, authorization: str | None = Header(None)):
    """Macht das Original einer Idee öffentlich lesbar (GROUP_EVERYONE/Consumer),
    damit Vorschau/Render auch für anonyme Betrachter funktioniert.

    Reparatur-Endpoint für die Moderation: Beim Einsortieren wird die Idee nur
    als Reference in die Sammlung gehängt; das Original bleibt in der Inbox und
    ist u.U. nicht öffentlich → die eingebettete (anonyme) Vorschau zeigt
    „insufficient permissions". Dieser Endpoint holt die Veröffentlichung
    nachträglich nach. Nur Moderation.

    Das eigentliche Original wird live über `ccm:original` ermittelt (robust für
    Referenz- wie Original-Knoten)."""
    await _require_moderator(authorization)
    try:
        meta = await edu_sharing.client.node_metadata(idea_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:160]}")
    node = (meta or {}).get("node") or {}
    if not node:
        raise HTTPException(404, "Idee nicht gefunden")
    props = node.get("properties") or {}
    original = (props.get("ccm:original") or [None])[0] or idea_id
    try:
        was_public = await edu_sharing.client.publish_node(original, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:160]}")
    _log_activity(
        action="idea_published",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        target_id=idea_id,
        detail={"original_id": original, "was_public": was_public},
    )
    return {"ok": True, "original_id": original, "was_public": was_public}
