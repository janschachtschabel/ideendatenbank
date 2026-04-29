from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Literal

import re

log = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Body, File, Header, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from . import backup as backup_mod, edu_sharing, sync as sync_mod
from .config import settings
from .db import connect
from .ratelimit import limiter

router = APIRouter()

SortBy = Literal["modified", "created", "rating", "comments", "title"]


def _row_to_idea(r) -> dict:
    return {
        "id": r["id"],
        "kind": r["kind"],
        "topic_id": r["topic_id"],
        "main_content_id": r["main_content_id"],
        "title": r["title"],
        "description": r["description"],
        "preview_url": r["preview_url"],
        "author": r["author"],
        "project_url": r["project_url"],
        "phase": r["phase"],
        "events": json.loads(r["events"] or "[]"),
        "categories": json.loads(r["categories"] or "[]"),
        "keywords": json.loads(r["keywords"] or "[]"),
        "rating_avg": r["rating_avg"],
        "rating_count": r["rating_count"],
        "comment_count": r["comment_count"],
        "attachment_mimetype": _safe_get(r, "attachment_mimetype"),
        "attachment_size": _safe_get(r, "attachment_size"),
        "attachment_name": _safe_get(r, "attachment_name"),
        "attachment_url": _safe_get(r, "attachment_url"),
        "owner_username": _safe_get(r, "owner_username"),
        "attachment_folder_id": _safe_get(r, "attachment_folder_id"),
        "created_at": r["created_at"],
        "modified_at": r["modified_at"],
    }


def _safe_get(row, key: str):
    try:
        return row[key]
    except (IndexError, KeyError):
        return None


def _attachment_from_node(n: dict) -> dict:
    """Normalise an edu-sharing ccm:io node into our attachment payload."""
    props = n.get("properties") or {}
    preview = n.get("preview") or {}
    ref_id = (n.get("ref") or {}).get("id")
    return {
        "id": ref_id,
        "name": n.get("name") or (props.get("cm:name") or [None])[0],
        "title": n.get("title") or (props.get("cm:title") or [None])[0] or n.get("name"),
        "mimetype": n.get("mimetype"),
        "size": n.get("size"),
        "download_url": n.get("downloadUrl"),
        "render_url": (n.get("content") or {}).get("url"),
        "preview_url": preview.get("url") if not preview.get("isIcon") else None,
    }


def _collect_topic_subtree(con, root_id: str) -> list[str]:
    """Return [root_id] + all transitive descendants from the topic table."""
    ids = [root_id]
    frontier = [root_id]
    while frontier:
        placeholders = ",".join("?" * len(frontier))
        rows = con.execute(
            f"SELECT id FROM topic WHERE parent_id IN ({placeholders})", frontier
        ).fetchall()
        frontier = [r["id"] for r in rows]
        ids.extend(frontier)
    return ids


@router.get("/topics/{topic_id}")
def get_topic(topic_id: str):
    """Single topic plus its direct children, for drill-down views."""
    cols = "id,parent_id,title,description,preview_url,color,created_at,modified_at"
    with connect() as con:
        row = con.execute(
            f"SELECT {cols} FROM topic WHERE id=?", (topic_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Topic not found")
        children = con.execute(
            f"SELECT {cols} FROM topic WHERE parent_id=? ORDER BY title", (topic_id,),
        ).fetchall()
        parent = None
        if row["parent_id"]:
            parent = con.execute(
                "SELECT id,parent_id,title FROM topic WHERE id=?", (row["parent_id"],)
            ).fetchone()
    return {
        "topic": dict(row),
        "parent": dict(parent) if parent else None,
        "children": [dict(c) for c in children],
    }


# ===== Topic-CRUD (Mod-only) ============================================

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
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )
    new_id = (
        ((result or {}).get("collection") or result or {}).get("ref") or {}
    ).get("id")
    if not new_id:
        raise HTTPException(502, "edu-sharing lieferte keine ID")
    # Sofort in den Cache schreiben (Voll-Sync zieht später nach)
    with connect() as con:
        con.execute(
            "INSERT OR REPLACE INTO topic "
            "(id,parent_id,title,description,color,sort_order,created_at,modified_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (new_id, body.parent_id, body.title, body.description, body.color,
             100, sync_mod._iso_now(), sync_mod._iso_now()),
        )
    _log_activity(
        action="topic_created", authorization=authorization, is_mod=True,
        target_type="topic", target_id=new_id, target_label=body.title,
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
                topic_id, props, auth_header=authorization,
            )
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                raise HTTPException(403, "Keine Berechtigung, dieses Thema zu ändern.")
            raise HTTPException(
                e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
            )

    set_parts: list[str] = []
    params: list = []
    if body.title is not None:
        set_parts.append("title=?"); params.append(body.title)
    if body.description is not None:
        set_parts.append("description=?"); params.append(body.description)
    if body.color is not None:
        set_parts.append("color=?"); params.append(body.color)
    if set_parts:
        set_parts.append("modified_at=?"); params.append(sync_mod._iso_now())
        params.append(topic_id)
        with connect() as con:
            con.execute(
                f"UPDATE topic SET {', '.join(set_parts)} WHERE id=?", params,
            )
    _log_activity(
        action="topic_edited", authorization=authorization, is_mod=True,
        target_type="topic", target_id=topic_id, target_label=body.title,
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
    # Vor-Check: hat Cache noch Kinder/Ideen?
    with connect() as con:
        kids = con.execute(
            "SELECT COUNT(*) FROM topic WHERE parent_id=?", (topic_id,),
        ).fetchone()[0]
        ideas = con.execute(
            "SELECT COUNT(*) FROM idea WHERE topic_id=?", (topic_id,),
        ).fetchone()[0]
        title_row = con.execute(
            "SELECT title FROM topic WHERE id=?", (topic_id,),
        ).fetchone()
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
            raise HTTPException(403, "Keine Berechtigung, dieses Thema zu löschen.")
        if e.response.status_code != 404:
            raise HTTPException(
                e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
            )
    with connect() as con:
        con.execute("DELETE FROM topic WHERE id=?", (topic_id,))
    _log_activity(
        action="topic_deleted", authorization=authorization, is_mod=True,
        target_type="topic", target_id=topic_id,
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
    data = await file.read()
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
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )
    _log_activity(
        action="topic_preview_set", authorization=authorization, is_mod=True,
        target_type="topic", target_id=topic_id,
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
    with connect() as con:
        for it in items:
            con.execute(
                "UPDATE topic SET sort_order=? WHERE id=?",
                (it.sort_order, it.id),
            )
    _log_activity(
        action="topics_sorted", authorization=authorization, is_mod=True,
        target_type="topic",
        detail={"count": len(items)},
    )
    return {"ok": True, "updated": len(items)}


@router.get("/meta")
def meta_facets():
    """Distinct phase/event/category values currently in the cache, with counts."""
    with connect() as con:
        phases = con.execute(
            "SELECT phase AS value, COUNT(*) AS count FROM idea "
            "WHERE phase IS NOT NULL AND phase <> '' GROUP BY phase ORDER BY count DESC"
        ).fetchall()
        rows = con.execute("SELECT events, categories FROM idea").fetchall()
    events: dict[str, int] = {}
    categories: dict[str, int] = {}
    for r in rows:
        for e in json.loads(r["events"] or "[]"):
            events[e] = events.get(e, 0) + 1
        for c in json.loads(r["categories"] or "[]"):
            categories[c] = categories.get(c, 0) + 1
    return {
        "phases": [dict(p) for p in phases],
        "events": [{"value": k, "count": v} for k, v in sorted(events.items(), key=lambda x: -x[1])],
        "categories": [{"value": k, "count": v} for k, v in sorted(categories.items(), key=lambda x: -x[1])],
    }


@router.get("/topics")
def list_topics():
    """Flat list of all topics + challenges (tree reconstructable via parent_id).
    Sortierung: erst Root-Themen, dann Kinder; innerhalb gleiches Parent
    nach sort_order, dann nach Titel."""
    with connect() as con:
        rows = con.execute(
            "SELECT id,parent_id,title,description,preview_url,color,sort_order,"
            "       created_at,modified_at FROM topic "
            "ORDER BY parent_id NULLS FIRST, sort_order ASC, title ASC"
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/ideas")
def list_ideas(
    topic_id: str | None = Query(None, description="Filter by topic (theme or challenge)"),
    include_descendants: bool = Query(True, description="Include ideas in sub-topics"),
    phase: str | None = None,
    event: str | None = None,
    category: str | None = None,
    q: str | None = Query(None, description="Full-text search"),
    sort: SortBy = "modified",
    order: Literal["asc", "desc"] = "desc",
    limit: int = Query(24, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    sort_cols = {
        "modified": "modified_at",
        "created": "created_at",
        "rating": "rating_avg",
        "comments": "comment_count",
        "title": "title",
    }
    sort_col = sort_cols[sort]

    where: list[str] = []
    params: list = []
    if topic_id:
        if include_descendants:
            with connect() as con:
                ids = _collect_topic_subtree(con, topic_id)
            placeholders = ",".join("?" * len(ids))
            where.append(f"topic_id IN ({placeholders})")
            params.extend(ids)
        else:
            where.append("topic_id = ?")
            params.append(topic_id)
    if phase:
        where.append("phase = ?")
        params.append(phase)
    if event:
        # events is a JSON array; LIKE works for simple membership lookup
        where.append("events LIKE ?")
        params.append(f'%"{event}"%')
    if category:
        where.append("categories LIKE ?")
        params.append(f'%"{category}"%')

    base_sql = "FROM idea i"
    if q:
        base_sql += " JOIN idea_fts f ON i.id = f.id"
        where.append("idea_fts MATCH ?")
        params.append(q)
    if where:
        base_sql += " WHERE " + " AND ".join(where)

    # Bei Volltext-Suche FTS5-Highlights mitselektieren. Spalten-Index in
    # idea_fts: 0=id, 1=title, 2=description, 3=keywords. Wir nutzen
    # snippet() für die Beschreibung (zeigt Match in Kontext) und
    # highlight() für den Titel (markiert nur).
    select_cols = "i.*"
    if q:
        select_cols += (
            ", snippet(idea_fts, 2, '<mark>', '</mark>', '…', 16) AS highlight_desc"
            ", highlight(idea_fts, 1, '<mark>', '</mark>') AS highlight_title"
        )

    list_sql = f"SELECT {select_cols} {base_sql} ORDER BY {sort_col} {order.upper()} LIMIT ? OFFSET ?"
    count_sql = f"SELECT COUNT(*) {base_sql}"

    with connect() as con:
        total = con.execute(count_sql, params).fetchone()[0]
        rows = con.execute(list_sql, [*params, limit, offset]).fetchall()

    items = []
    for r in rows:
        d = _row_to_idea(r)
        # Highlights nur dann mitsenden, wenn vorhanden (q gesetzt + Treffer)
        try:
            ht = r["highlight_title"]
            hd = r["highlight_desc"]
            if ht or hd:
                d["highlights"] = {
                    "title": ht if "<mark>" in (ht or "") else None,
                    "description": hd if "<mark>" in (hd or "") else None,
                }
        except (IndexError, KeyError):
            pass
        items.append(d)

    response: dict = {
        "total": total, "limit": limit, "offset": offset, "items": items,
    }

    # 0-Treffer-Suggestions: bei Volltext-Suche ohne Treffer schlagen wir
    # alternative Begriffe vor (LIKE-Match auf Title) und liefern zusätzlich
    # eine Auswahl aktueller Ideen. So sieht die UI nie eine Sackgasse.
    if q and total == 0:
        suggestions = _suggest_for_empty_query(q)
        if suggestions:
            response["suggestions"] = suggestions

    return response


def _suggest_for_empty_query(q: str) -> dict:
    """Liefert Vorschläge bei 0 FTS5-Treffern.
    - alt_terms: Titel-Tokens, die LIKE %term% in der idea-Tabelle matchen
    - recent: 5 aktuelle Ideen als „bei Sackgasse halt mal das hier"-Fallback
    """
    tokens = [t for t in re.split(r"\W+", q.strip()) if len(t) >= 3][:5]
    alt_terms: list[str] = []
    with connect() as con:
        for tok in tokens:
            row = con.execute(
                "SELECT title FROM idea WHERE title LIKE ? "
                "ORDER BY modified_at DESC LIMIT 1",
                (f"%{tok}%",),
            ).fetchone()
            if row and row["title"] not in alt_terms:
                alt_terms.append(row["title"])
        recent_rows = con.execute(
            "SELECT * FROM idea ORDER BY modified_at DESC LIMIT 5"
        ).fetchall()
    return {
        "alt_terms": alt_terms,
        "recent": [_row_to_idea(r) for r in recent_rows],
    }


# ===== Trend-Ranking =====================================================

_RANKING_SORTS = {"rating", "comments", "interest"}


@router.get("/ranking", tags=["ranking"])
async def get_ranking(
    sort: str = Query("rating"),
    event: str | None = None,
    limit: int = Query(20, ge=1, le=50),
):
    """Aktuelle Top-Liste + Trend-Delta gegen den vorherigen Snapshot.
    Für jede Idee zusätzlich die letzten N Score-Werte als Sparkline-Daten."""
    if sort not in _RANKING_SORTS:
        raise HTTPException(400, f"sort muss eins von {sorted(_RANKING_SORTS)} sein")

    ev = event or ""
    with connect() as con:
        snaps = [
            r["snapshot_at"]
            for r in con.execute(
                "SELECT DISTINCT snapshot_at FROM ranking_snapshot "
                "WHERE event=? AND sort=? ORDER BY snapshot_at DESC LIMIT 12",
                (ev, sort),
            ).fetchall()
        ]
        if not snaps:
            return {"sort": sort, "event": event, "items": [], "snapshots": []}

        latest = snaps[0]
        prev = snaps[1] if len(snaps) > 1 else None

        rows = con.execute(
            "SELECT rank, idea_id, score FROM ranking_snapshot "
            "WHERE event=? AND sort=? AND snapshot_at=? "
            "ORDER BY rank ASC LIMIT ?",
            (ev, sort, latest, limit),
        ).fetchall()

        prev_ranks: dict[str, int] = {}
        if prev:
            for r in con.execute(
                "SELECT idea_id, rank FROM ranking_snapshot "
                "WHERE event=? AND sort=? AND snapshot_at=?",
                (ev, sort, prev),
            ).fetchall():
                prev_ranks[r["idea_id"]] = r["rank"]

        # Sparkline-History — alle Snapshots in chronologischer Reihenfolge.
        history_rows = con.execute(
            "SELECT idea_id, snapshot_at, score, rank FROM ranking_snapshot "
            "WHERE event=? AND sort=? ORDER BY snapshot_at ASC",
            (ev, sort),
        ).fetchall()
        history_by_idea: dict[str, list[dict]] = {}
        for hr in history_rows:
            history_by_idea.setdefault(hr["idea_id"], []).append({
                "at": hr["snapshot_at"],
                "score": hr["score"],
                "rank": hr["rank"],
            })

        # Idea-Stammdaten dazuholen.
        ids = [r["idea_id"] for r in rows]
        idea_map: dict[str, dict] = {}
        if ids:
            placeholders = ",".join(["?"] * len(ids))
            for ir in con.execute(
                f"SELECT * FROM idea WHERE id IN ({placeholders})", ids
            ).fetchall():
                idea_map[ir["id"]] = _row_to_idea(ir)

    items = []
    for r in rows:
        prev_rank = prev_ranks.get(r["idea_id"])
        delta = (prev_rank - r["rank"]) if prev_rank is not None else None
        # delta > 0 → nach oben gewandert (kleinere rank-Zahl), delta < 0 → gefallen
        items.append({
            "rank": r["rank"],
            "prev_rank": prev_rank,
            "delta": delta,
            "score": r["score"],
            "idea": idea_map.get(r["idea_id"]),
            "history": history_by_idea.get(r["idea_id"], []),
        })

    return {
        "sort": sort,
        "event": event,
        "snapshot_at": latest,
        "previous_snapshot_at": prev,
        "snapshots": list(reversed(snaps)),  # alt → neu
        "items": items,
    }


@router.get("/ideas/{idea_id}")
async def get_idea(idea_id: str, authorization: str | None = Header(None)):
    with connect() as con:
        row = con.execute("SELECT * FROM idea WHERE id = ?", (idea_id,)).fetchone()
        interest_count = con.execute(
            "SELECT COUNT(*) FROM idea_interaction WHERE idea_id=? AND kind='interest'",
            (idea_id,),
        ).fetchone()[0]

    # Cache-Miss-Fallback: frisch eingereichte Ideen sind noch nicht im Cache.
    # Statt 404 → live aus edu-sharing holen, in den Cache schreiben (refresh
    # nutzt _upsert_idea), Row neu lesen. Funktioniert auch für anonyme Reader,
    # solange die Idee öffentlich lesbar ist.
    if not row:
        ok = await sync_mod.refresh_idea(idea_id, auth_header=authorization)
        if ok:
            with connect() as con:
                row = con.execute(
                    "SELECT * FROM idea WHERE id = ?", (idea_id,)
                ).fetchone()
        if not row:
            raise HTTPException(404, "Idea not found")

    base = _row_to_idea(row)
    base["interest_count"] = interest_count

    # can_edit / can_delete: aus accessEffective des Caller-Tokens abgeleitet.
    # Ohne Login false; mit Login wird gegen edu-sharing geprüft.
    can_edit = False
    can_delete = False
    if authorization:
        try:
            meta = await edu_sharing.client.node_metadata(
                row["main_content_id"] or row["id"],
                auth_header=authorization,
            )
            access = (meta.get("node") or {}).get("access") or []
            can_edit = "Write" in access or "ChangePermissions" in access
            can_delete = "Delete" in access
        except Exception:
            pass
    base["can_edit"] = can_edit
    base["can_delete"] = can_delete

    # Phase-Workflow: dem Frontend mitteilen, welche Phasen der Caller setzen
    # darf. Mod sieht alle, Owner nur „aktuelle + 1 vorwärts" (ohne Archive).
    is_mod_caller = False
    if authorization:
        try:
            is_mod_caller = await _is_moderator(authorization)
        except Exception:
            is_mod_caller = False
    with connect() as con:
        order = _phase_order(con)
    base["allowed_next_phases"] = (
        _allowed_next_phases(
            current=base.get("phase"), is_mod=is_mod_caller, order=order,
        )
        if can_edit else []
    )

    # Live comments — always against the ccm:io target (collection ideas
    # route to main_content_id, io ideas to themselves).
    # Auth-Passthrough: wenn der Caller eingeloggt ist, dessen Identität nutzen
    # statt Gast — damit funktioniert auch der Lesezugriff auf Ideen, die der
    # Gast (z.B. ohne Admin-Rechte) nicht sehen kann.
    comment_target = row["main_content_id"] or row["id"]
    is_private = False  # markiert: Gast hat keinen Lesezugriff
    try:
        base["comments"] = (await edu_sharing.client.comments(
            comment_target, auth_header=authorization,
        )).get("comments") or []
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            is_private = True
        base["comments"] = []
    except Exception:
        base["comments"] = []

    # Live attachments — documents the user can download / preview.
    attachments: list[dict] = []
    if row["kind"] == "io":
        # The node itself IS the attachment; use cached fields, top it up
        # with a fresh probe to get render_url + preview_url.
        try:
            meta = await edu_sharing.client.node_metadata(
                row["id"], auth_header=authorization,
            )
            attachments.append(_attachment_from_node(meta.get("node") or {}))
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                is_private = True
            # Fall back to cached row values so the UI is never empty
            attachments.append({
                "id": row["id"],
                "name": _safe_get(row, "attachment_name"),
                "title": row["title"],
                "mimetype": _safe_get(row, "attachment_mimetype"),
                "size": _safe_get(row, "attachment_size"),
                "download_url": _safe_get(row, "attachment_url"),
                "render_url": None,
                "preview_url": row["preview_url"],
            })
        except Exception:
            attachments.append({
                "id": row["id"],
                "name": _safe_get(row, "attachment_name"),
                "title": row["title"],
                "mimetype": _safe_get(row, "attachment_mimetype"),
                "size": _safe_get(row, "attachment_size"),
                "download_url": _safe_get(row, "attachment_url"),
                "render_url": None,
                "preview_url": row["preview_url"],
            })
    else:
        # Collection idea — list every referenced ccm:io as an attachment.
        try:
            refs = await edu_sharing.client.collection_references(
                row["id"], max_items=50, auth_header=authorization,
            )
            for n in refs.get("references") or []:
                attachments.append(_attachment_from_node(n))
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                is_private = True
        except Exception:
            pass

    # Anhänge-Sammlung: wenn die Idee eine verknüpfte ccm:map-Geschwister-
    # Sammlung hat, alle ccm:io darin als zusätzliche Dokumente anhängen.
    folder_id = _safe_get(row, "attachment_folder_id")
    if folder_id:
        try:
            folder_meta = await edu_sharing.client.get_collection(
                folder_id, auth_header=authorization,
            )
            base["attachment_folder"] = {
                "id": folder_id,
                "name": (folder_meta.get("collection") or {}).get("title")
                or folder_meta.get("collection", {}).get("name"),
            }
            files = await edu_sharing.client.collection_references(
                folder_id, max_items=50, auth_header=authorization,
            )
            for n in files.get("references") or []:
                a = _attachment_from_node(n)
                a["from_folder"] = True
                attachments.append(a)
        except Exception:
            pass
    else:
        base["attachment_folder"] = None

    base["attachments"] = attachments
    # Hinweis für die UI, falls der Reader keinen Zugriff auf Live-Daten hat.
    # Eingeloggte User sehen das normalerweise nicht — deshalb nur bei Gast.
    if is_private and not authorization:
        base["restricted"] = True
    return base


@router.post("/ideas/{idea_id}/rating")
@limiter.limit("30/minute")
async def rate_idea(
    request: Request,
    idea_id: str,
    rating: float = Query(..., ge=0, le=5),
    text: str = "",
    authorization: str | None = Header(None),
):
    if not authorization:
        raise HTTPException(401, "Authorization header required for rating")
    with connect() as con:
        row = con.execute(
            "SELECT main_content_id,id FROM idea WHERE id = ?", (idea_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Idea not found")
    target = row["main_content_id"] or row["id"]
    if not target:
        raise HTTPException(409, "Idea has no ccm:io target for rating")
    try:
        await edu_sharing.client.add_rating(
            target, rating=rating, text=text, auth_header=authorization
        )
    except httpx.HTTPStatusError as e:
        # Known edu-sharing bug: the rating DOES persist even though the
        # server returns 500 'config.values.rating is null'. Treat only that
        # specific failure as a soft success.
        if (
            e.response.status_code == 500
            and "config.values.rating" in e.response.text
        ):
            pass
        elif e.response.status_code in (401, 403):
            raise HTTPException(e.response.status_code, "Anmeldung erforderlich")
        else:
            raise HTTPException(
                e.response.status_code,
                f"edu-sharing Fehler: {e.response.text[:200]}",
            )

    # Read back the current rating from node metadata so the UI can update.
    # Cache wird im selben Aufruf via refresh_idea aktualisiert, damit
    # rating_avg/rating_count in Listen + Karten sofort frisch sind.
    try:
        meta = await edu_sharing.client.node_metadata(target)
        r = (meta.get("node") or {}).get("rating") or {}
        overall = r.get("overall") or {}
        # Cache update — best-effort
        try:
            await sync_mod.refresh_idea(idea_id, auth_header=authorization)
        except Exception:
            pass
        return {
            "ok": True,
            "rating": {
                "avg": float(overall.get("rating") or 0.0),
                "count": int(overall.get("count") or 0),
                "mine": float(r.get("user") or 0.0),
            },
        }
    except Exception:
        return {"ok": True}


@router.post("/ideas/{idea_id}/comments")
@limiter.limit("30/minute")
async def comment_idea(
    request: Request,
    idea_id: str,
    comment: str = Query(..., min_length=1),
    reply_to: str | None = None,
    authorization: str | None = Header(None),
):
    if not authorization:
        raise HTTPException(401, "Authorization header required for comments")
    with connect() as con:
        row = con.execute(
            "SELECT main_content_id,id FROM idea WHERE id = ?", (idea_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Idea not found")
    target = row["main_content_id"] or row["id"]
    result = await edu_sharing.client.add_comment(
        target, comment=comment, reply_to=reply_to, auth_header=authorization
    )
    # Cache aktualisieren — comment_count fließt in Sortierung + Karten ein.
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass
    return result


class IdeaSubmission(BaseModel):
    title: str = Field(..., min_length=3, max_length=150)
    description: str | None = None
    author: str | None = None
    project_url: str | None = None
    keywords: list[str] = []
    topic_id: str | None = None  # target challenge (level-2 topic) — moderator moves there later
    phase: str | None = None
    event: str | None = None  # legacy single-event (wird auf events[] gemerged)
    events: list[str] = []  # mehrere Veranstaltungen pro Idee


_SAFE_NAME = re.compile(r"[^a-zA-Z0-9_\-]+")


def _slugify(title: str) -> str:
    s = _SAFE_NAME.sub("-", title.strip().lower()).strip("-")
    return (s[:80] or "idee") + ".html"


@router.post("/ideas", status_code=201)
@limiter.limit("10/minute")
async def submit_idea(
    request: Request,
    body: IdeaSubmission,
    authorization: str | None = Header(None),
):
    """Create a new idea as ccm:io. Without Authorization header it is created
    in the guest inbox for moderator review. With Authorization it is created
    under the same inbox for now (later: directly under the target challenge)."""
    kws = [k.strip() for k in body.keywords if k and k.strip()]
    if body.phase and not any(k.lower().startswith("phase:") for k in kws):
        kws.append(f"phase:{body.phase}")
    # Events: einzelne event-Flag + events-Liste mergen, deduplizieren.
    event_slugs = list(body.events or [])
    if body.event:
        event_slugs.append(body.event)
    seen_events: set[str] = set()
    for ev in event_slugs:
        ev = (ev or "").strip()
        if not ev or ev in seen_events:
            continue
        seen_events.add(ev)
        if not any(k.lower() == f"event:{ev}".lower() for k in kws):
            kws.append(f"event:{ev}")
    if body.topic_id and not any(k.lower().startswith("target-topic:") for k in kws):
        # remember the intended target so moderator/UI can pick it up later
        kws.append(f"target-topic:{body.topic_id}")

    props: dict[str, list[str]] = {
        "cm:name": [_slugify(body.title)],
        "cm:title": [body.title],
        "cclom:title": [body.title],
    }
    if body.description:
        props["cclom:general_description"] = [body.description]
        props["cm:description"] = [body.description]
    if kws:
        props["cclom:general_keyword"] = kws
    if body.author:
        props["ccm:author_freetext"] = [body.author]
    if body.project_url:
        props["ccm:wwwurl"] = [body.project_url]

    try:
        result = await edu_sharing.client.create_node(
            parent_id=settings.edu_guest_inbox_id,
            node_type="ccm:io",
            properties=props,
            auth_header=None,  # always use guest creds for v1 submit flow
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            502,
            f"edu-sharing Fehler beim Anlegen: {e.response.status_code} "
            f"{e.response.text[:180]}",
        )

    node = (result or {}).get("node") or {}
    new_id = (node.get("ref") or {}).get("id")

    # Single-Node-Refresh: frische Idee sofort im Cache, ohne auf 5-min-Sync
    # zu warten. Auth des Erstellers (oder None für Gast) wird durchgereicht.
    if new_id:
        try:
            await sync_mod.refresh_idea(new_id, auth_header=authorization)
        except Exception:
            pass

    _log_activity(
        action="idea_submitted",
        authorization=authorization,
        target_type="idea", target_id=new_id, target_label=body.title,
        detail={"anonymous": authorization is None,
                "topic_id": body.topic_id,
                "phase": body.phase,
                "events": list(body.events or []) + ([body.event] if body.event else [])},
    )

    return {
        "ok": True,
        "moderation": "pending",
        "node_id": new_id,
        "message": (
            "Danke! Deine Idee liegt jetzt im Moderations-Postfach. "
            "Das Team prüft sie und sortiert sie in den passenden Themenbereich ein."
        ),
    }


def _user_key_from_auth(authorization: str | None) -> str | None:
    """Derive a stable user key from Basic-Auth header (Base64-decoded username).
    Returns None when no credentials are provided."""
    if not authorization or not authorization.lower().startswith("basic "):
        return None
    import base64 as _b
    try:
        raw = _b.b64decode(authorization.split(" ", 1)[1]).decode("utf-8", "replace")
        return raw.split(":", 1)[0] or None
    except Exception:
        return None


# ===== Phase-Status-Workflow (Variante A) ===============================
# Regeln:
#   - Owner darf phase nur um GENAU EINE Stufe vorwärts setzen
#   - Moderator darf jede Transition (auch zurück, springen, zur Archiviert)
#   - Archiviert + Sprünge über >1 Stufe sind ausschließlich Mod
#   - Phasen ohne sort_order werden ans Ende gestellt
#   - Heuristik: phase==None oder unbekannt wird wie „erste Phase" behandelt
PHASE_ARCHIVE_SLUG = "archiviert"


def _phase_order(con) -> list[str]:
    """Liefert die aktiven Phase-Slugs in der vom Mod definierten Reihenfolge.
    Fallback auf den DEFAULT_PHASES-Stand, falls keine Taxonomie da ist."""
    rows = con.execute(
        "SELECT slug FROM taxonomy_phase WHERE active = 1 "
        "ORDER BY sort_order ASC, slug ASC"
    ).fetchall()
    if rows:
        return [r["slug"] for r in rows]
    # Fallback (sollte init_db immer schon gepflanzt haben)
    return ["anregung", "ausarbeitung", "pitch-bereit",
            "in-umsetzung", "abgeschlossen", PHASE_ARCHIVE_SLUG]


def _is_allowed_phase_transition(
    *, current: str | None, target: str | None, is_mod: bool, order: list[str],
) -> tuple[bool, str | None]:
    """Returns (ok, reason). Reason ist nur bei ok=False gesetzt."""
    if is_mod:
        return True, None
    # Kein Mod → strengere Regeln
    if not target:
        return True, None  # phase löschen → setzt zurück, harmlos
    if target == PHASE_ARCHIVE_SLUG:
        return False, "Nur Moderator:innen dürfen Ideen archivieren."
    if target not in order:
        # Phase-Slug existiert in taxonomy_phase nicht (oder inaktiv)
        return False, f'Phase „{target}" ist nicht (mehr) verfügbar.'
    target_idx = order.index(target)
    if not current or current not in order:
        # Idee ohne Phase → darf auf erste oder zweite Stufe wechseln (Toleranz)
        if target_idx <= 1:
            return True, None
        return False, ("Phase muss schrittweise hochgesetzt werden — "
                       "Sprung zu weit. Mod fragen.")
    current_idx = order.index(current)
    if target_idx == current_idx:
        return True, None  # No-Op
    if target_idx == current_idx + 1:
        return True, None  # genau eine Stufe vorwärts
    if target_idx < current_idx:
        return False, "Nur Moderator:innen dürfen Phasen zurückschalten."
    return False, ("Mehrere Stufen auf einmal sind nur für Moderator:innen — "
                   "schrittweise weiter, oder Mod fragen.")


def _allowed_next_phases(
    *, current: str | None, is_mod: bool, order: list[str],
) -> list[str]:
    """Welche Phasen darf der Caller jetzt setzen?"""
    if is_mod:
        return list(order)  # alles erlaubt
    if not current or current not in order:
        return order[:2]  # erste oder zweite Stufe
    idx = order.index(current)
    out = [current]
    if idx + 1 < len(order) and order[idx + 1] != PHASE_ARCHIVE_SLUG:
        out.append(order[idx + 1])
    return out


def _log_activity(
    *,
    action: str,
    authorization: str | None = None,
    is_mod: bool = False,
    target_type: str | None = None,
    target_id: str | None = None,
    target_label: str | None = None,
    detail: dict | None = None,
) -> None:
    """Schreibt eine Zeile in activity_log. Best-effort: Fehler werden nur
    geloggt, niemals propagiert — das Logging darf eine Schreib-Aktion nie
    zum Scheitern bringen."""
    try:
        actor = _user_key_from_auth(authorization)
        with connect() as con:
            con.execute(
                "INSERT INTO activity_log "
                "(ts,actor,is_mod,action,target_type,target_id,target_label,detail) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (
                    sync_mod._iso_now(),
                    actor or "Gast",
                    1 if is_mod else 0,
                    action,
                    target_type,
                    target_id,
                    (target_label or "")[:200] if target_label else None,
                    json.dumps(detail, ensure_ascii=False) if detail else None,
                ),
            )
    except Exception as e:
        log.warning("activity log failed (%s): %s", action, e)


@router.get("/ideas/{idea_id}/interactions")
def get_interactions(
    idea_id: str,
    authorization: str | None = Header(None),
):
    with connect() as con:
        rows = con.execute(
            "SELECT kind, display_name, user_key, created_at FROM idea_interaction "
            "WHERE idea_id = ? ORDER BY created_at DESC",
            (idea_id,),
        ).fetchall()
    current = _user_key_from_auth(authorization)
    interest = [dict(r) for r in rows if r["kind"] == "interest"]
    follow = [dict(r) for r in rows if r["kind"] == "follow"]
    return {
        "interest": {
            "count": len(interest),
            "users": [
                {"name": r["display_name"] or r["user_key"], "user_key": r["user_key"]}
                for r in interest
            ],
            "mine": any(r["user_key"] == current for r in interest) if current else False,
        },
        "follow": {
            "count": len(follow),
            "mine": any(r["user_key"] == current for r in follow) if current else False,
        },
    }


@router.post("/ideas/{idea_id}/interest")
def toggle_interest(
    idea_id: str,
    authorization: str | None = Header(None),
):
    user = _user_key_from_auth(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        row = con.execute("SELECT id FROM idea WHERE id = ?", (idea_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Idee nicht gefunden")
        existing = con.execute(
            "SELECT 1 FROM idea_interaction WHERE idea_id=? AND user_key=? AND kind='interest'",
            (idea_id, user),
        ).fetchone()
        if existing:
            con.execute(
                "DELETE FROM idea_interaction WHERE idea_id=? AND user_key=? AND kind='interest'",
                (idea_id, user),
            )
            return {"state": "removed"}
        con.execute(
            "INSERT INTO idea_interaction (idea_id,user_key,kind,display_name,created_at) "
            "VALUES (?,?, 'interest', ?, datetime('now'))",
            (idea_id, user, user),
        )
    return {"state": "added"}


@router.post("/ideas/{idea_id}/follow")
def toggle_follow(
    idea_id: str,
    authorization: str | None = Header(None),
):
    user = _user_key_from_auth(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        row = con.execute("SELECT id FROM idea WHERE id = ?", (idea_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Idee nicht gefunden")
        existing = con.execute(
            "SELECT 1 FROM idea_interaction WHERE idea_id=? AND user_key=? AND kind='follow'",
            (idea_id, user),
        ).fetchone()
        if existing:
            con.execute(
                "DELETE FROM idea_interaction WHERE idea_id=? AND user_key=? AND kind='follow'",
                (idea_id, user),
            )
            return {"state": "removed"}
        con.execute(
            "INSERT INTO idea_interaction (idea_id,user_key,kind,display_name,created_at) "
            "VALUES (?,?, 'follow', ?, datetime('now'))",
            (idea_id, user, user),
        )
    return {"state": "added"}


@router.get("/inbox", tags=["moderation"])
async def list_inbox(
    limit: int = Query(50, ge=1, le=200),
    authorization: str | None = Header(None),
):
    await _require_moderator(authorization)
    """List recently submitted ideas in the guest moderation inbox.

    Only shows nodes that carry our keyword convention (phase:/event:/
    target-topic:) so unrelated legacy uploads don't pollute the view.
    Uses the guest credentials — anyone can call this; the inbox content is
    not secret, and login gating is handled on the frontend side.
    """
    # Fetch up to 3 pages of 200 newest-first nodes to surface our recent
    # submissions in an inbox that contains lots of legacy uploads.
    raw_nodes: list[dict] = []
    try:
        for skip in (0, 200, 400):
            page = await edu_sharing.client.node_children(
                settings.edu_guest_inbox_id,
                max_items=200,
                skip_count=skip,
                sort_prop="cm:created",
                sort_asc=False,
            )
            ns = page.get("nodes") or []
            raw_nodes.extend(ns)
            if len(ns) < 200:
                break
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"edu-sharing Fehler: {e.response.status_code}")

    items = []
    for n in raw_nodes:
        if n.get("type") != "ccm:io":
            continue
        props = n.get("properties") or {}
        kws = props.get("cclom:general_keyword") or []
        if isinstance(kws, str):
            kws = [kws]
        # Only show our submissions
        if not any(
            str(k).lower().startswith(p)
            for k in kws
            for p in ("phase:", "event:", "target-topic:")
        ):
            continue

        phase = next(
            (k[len("phase:") :] for k in kws if str(k).lower().startswith("phase:")),
            None,
        )
        event = next(
            (k[len("event:") :] for k in kws if str(k).lower().startswith("event:")),
            None,
        )
        target_topic = next(
            (
                k[len("target-topic:") :]
                for k in kws
                if str(k).lower().startswith("target-topic:")
            ),
            None,
        )
        items.append(
            {
                "id": (n.get("ref") or {}).get("id"),
                "name": n.get("name"),
                "title": n.get("title")
                or (props.get("cm:title") or [None])[0]
                or n.get("name"),
                "description": (props.get("cclom:general_description") or [None])[0]
                or (props.get("cm:description") or [None])[0],
                "author": (props.get("ccm:author_freetext") or [None])[0],
                "project_url": (props.get("ccm:wwwurl") or [None])[0],
                "phase": phase,
                "event": event,
                "target_topic": target_topic,
                "created_at": n.get("createdAt"),
            }
        )
    # Newest first
    items.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return {"count": len(items), "items": items[:limit]}


@router.delete("/inbox/{node_id}", tags=["moderation"])
async def delete_inbox_item(
    node_id: str,
    authorization: str | None = Header(None),
):
    """Delete a pending inbox submission. Caller muss Moderator sein."""
    await _require_moderator(authorization)
    try:
        result = await edu_sharing.client.delete_node(
            node_id, auth_header=authorization
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:180]}"
        )
    _log_activity(
        action="inbox_deleted",
        authorization=authorization, is_mod=True,
        target_type="idea", target_id=node_id,
    )
    return result


@router.post("/ideas/{idea_id}/content", tags=["ideas"])
async def upload_idea_content(
    idea_id: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Lädt eine Datei (Anhang oder Hauptinhalt) ans ccm:io der Idee.
    Auth wird durchgereicht — Schreibrechte muss edu-sharing prüfen."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    data = await file.read()
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
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )
    return {"ok": True, "size": len(data), "name": file.filename}


@router.post("/ideas/{idea_id}/preview", tags=["ideas"])
async def upload_idea_preview(
    idea_id: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Setzt das Vorschaubild ans ccm:io der Idee."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(400, "Vorschaubild muss ein Bild sein (image/*).")
    data = await file.read()
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
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )
    return {"ok": True}


class MoveRequest(BaseModel):
    node_id: str
    target_topic_id: str


class BulkMoveRequest(BaseModel):
    node_ids: list[str] = Field(..., min_length=1, max_length=50)
    target_topic_id: str


@router.post("/moderation/bulk_move", tags=["moderation"])
async def bulk_move_to_topic(
    body: BulkMoveRequest,
    authorization: str | None = Header(None),
):
    """Verschiebt mehrere Ideen in einem Schwung in eine Ziel-Herausforderung.
    Pro Idee wird einzeln per ES-API gemoved + per refresh_idea im Cache
    aktualisiert. Pro-Item-Fehler werden gesammelt und im Antwort-Body
    zurückgegeben — der Gesamtaufruf bricht nicht ab."""
    await _require_moderator(authorization)
    with connect() as con:
        t = con.execute(
            "SELECT id,title FROM topic WHERE id = ?", (body.target_topic_id,)
        ).fetchone()
    if not t:
        raise HTTPException(404, f"Unknown target topic {body.target_topic_id}")

    succeeded: list[str] = []
    failed: list[dict] = []
    for nid in body.node_ids:
        try:
            await edu_sharing.client.move_node(
                source_id=nid,
                target_parent_id=body.target_topic_id,
                auth_header=authorization,
            )
        except httpx.HTTPStatusError as e:
            failed.append({"id": nid, "status": e.response.status_code,
                           "detail": e.response.text[:160]})
            continue
        except Exception as e:
            failed.append({"id": nid, "status": 0, "detail": str(e)[:160]})
            continue
        try:
            await sync_mod.refresh_idea(nid, auth_header=authorization)
        except Exception:
            pass
        # Titel für Log
        with connect() as con:
            r = con.execute("SELECT title FROM idea WHERE id=?", (nid,)).fetchone()
            moved_title = r["title"] if r else None
        _log_activity(
            action="idea_moved", authorization=authorization, is_mod=True,
            target_type="idea", target_id=nid, target_label=moved_title,
            detail={"to_topic_id": body.target_topic_id,
                    "to_topic_title": t["title"], "bulk": True},
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
    authorization: str | None = Header(None),
):
    """Move an inbox submission into a target topic/challenge collection.

    Caller muss Moderator sein. Triggers einen Sync nach erfolgreichem Move.
    """
    await _require_moderator(authorization)
    # Validate target exists in our cache
    with connect() as con:
        t = con.execute(
            "SELECT id,title FROM topic WHERE id = ?", (body.target_topic_id,)
        ).fetchone()
    if not t:
        raise HTTPException(404, f"Unknown target topic {body.target_topic_id}")

    try:
        result = await edu_sharing.client.move_node(
            source_id=body.node_id,
            target_parent_id=body.target_topic_id,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code,
            f"edu-sharing: {e.response.text[:200]}",
        )

    # Single-Node-Refresh: neuer Eltern-Container wird im Cache gesetzt,
    # damit die Idee sofort unter der Ziel-Herausforderung auftaucht.
    try:
        await sync_mod.refresh_idea(body.node_id, auth_header=authorization)
    except Exception:
        pass

    # Idee-Titel für Log nachschlagen (nach Refresh ist die Row aktuell)
    moved_title = None
    with connect() as con:
        r = con.execute("SELECT title FROM idea WHERE id=?", (body.node_id,)).fetchone()
        moved_title = r["title"] if r else None
    _log_activity(
        action="idea_moved",
        authorization=authorization, is_mod=True,
        target_type="idea", target_id=body.node_id, target_label=moved_title,
        detail={"to_topic_id": body.target_topic_id, "to_topic_title": t["title"]},
    )

    return {"ok": True, "moved_to": t["title"], "node": result}


# Selbstregistrierung läuft extern über https://wirlernenonline.de/register/.
# Der edu-sharing /register/v1/register-Endpoint auf redaktion.openeduhub.net
# läuft deterministisch in einen 50s-Server-Disconnect (synchroner Mail-Hook
# hängt). Das WordPress-Plugin auf wirlernenonline.de umgeht das mit eigenem
# Service-Pfad. Bis das server-seitig gefixt ist, leitet das Frontend direkt
# auf das WLO-Formular weiter.


# ===== Taxonomie: Phasen + Veranstaltungen =====================
# Wird im Submit-Form als Dropdown angeboten und ans `cclom:general_keyword`
# als `phase:<slug>` bzw. `event:<slug>` angehängt.

class TaxonomyEntry(BaseModel):
    slug: str = Field(..., min_length=2, max_length=80, pattern=r"^[a-z0-9][a-z0-9\-]*$")
    label: str = Field(..., min_length=2, max_length=120)
    description: str | None = None
    sort_order: int = 100
    active: bool = True


def _list_taxonomy(table: str) -> list[dict]:
    with connect() as con:
        rows = con.execute(
            f"SELECT slug,label,description,sort_order,active,created_at,created_by "
            f"FROM {table} ORDER BY sort_order, label"
        ).fetchall()
    return [
        {**dict(r), "active": bool(r["active"])} for r in rows
    ]


@router.get("/phases", tags=["taxonomy"])
def list_phases(only_active: bool = True):
    items = _list_taxonomy("taxonomy_phase")
    return [i for i in items if i["active"]] if only_active else items


@router.get("/events", tags=["taxonomy"])
def list_events(only_active: bool = True):
    items = _list_taxonomy("taxonomy_event")
    return [i for i in items if i["active"]] if only_active else items


def _upsert_taxonomy(table: str, body: TaxonomyEntry, user: str | None) -> dict:
    with connect() as con:
        existing = con.execute(
            f"SELECT slug FROM {table} WHERE slug=?", (body.slug,)
        ).fetchone()
        if existing:
            con.execute(
                f"UPDATE {table} SET label=?, description=?, sort_order=?, active=? "
                f"WHERE slug=?",
                (body.label, body.description, body.sort_order,
                 1 if body.active else 0, body.slug),
            )
        else:
            from datetime import datetime, timezone
            con.execute(
                f"INSERT INTO {table} (slug,label,description,sort_order,active,"
                f"created_at,created_by) VALUES (?,?,?,?,?,?,?)",
                (body.slug, body.label, body.description, body.sort_order,
                 1 if body.active else 0,
                 datetime.now(timezone.utc).isoformat(), user or "anonymous"),
            )
    return {"ok": True, "slug": body.slug}


@router.put("/admin/events/{slug}", tags=["taxonomy"])
async def upsert_event(slug: str, body: TaxonomyEntry, authorization: str | None = Header(None)):
    user = await _require_moderator(authorization)
    if slug != body.slug:
        raise HTTPException(400, "URL-Slug und Body-Slug stimmen nicht überein")
    res = _upsert_taxonomy("taxonomy_event", body, user)
    _log_activity(
        action="taxonomy_event_changed",
        authorization=authorization, is_mod=True,
        target_type="taxonomy", target_id=slug, target_label=body.label,
        detail={"active": body.active, "sort_order": body.sort_order},
    )
    return res


@router.delete("/admin/events/{slug}", tags=["taxonomy"])
async def delete_event(slug: str, authorization: str | None = Header(None)):
    await _require_moderator(authorization)
    with connect() as con:
        con.execute("DELETE FROM taxonomy_event WHERE slug=?", (slug,))
    _log_activity(
        action="taxonomy_event_deleted",
        authorization=authorization, is_mod=True,
        target_type="taxonomy", target_id=slug,
    )
    return {"ok": True}


@router.put("/admin/phases/{slug}", tags=["taxonomy"])
async def upsert_phase(slug: str, body: TaxonomyEntry, authorization: str | None = Header(None)):
    user = await _require_moderator(authorization)
    if slug != body.slug:
        raise HTTPException(400, "URL-Slug und Body-Slug stimmen nicht überein")
    res = _upsert_taxonomy("taxonomy_phase", body, user)
    _log_activity(
        action="taxonomy_phase_changed",
        authorization=authorization, is_mod=True,
        target_type="taxonomy", target_id=slug, target_label=body.label,
        detail={"active": body.active, "sort_order": body.sort_order},
    )
    return res


@router.delete("/admin/phases/{slug}", tags=["taxonomy"])
async def delete_phase(slug: str, authorization: str | None = Header(None)):
    await _require_moderator(authorization)
    with connect() as con:
        con.execute("DELETE FROM taxonomy_phase WHERE slug=?", (slug,))
    _log_activity(
        action="taxonomy_phase_deleted",
        authorization=authorization, is_mod=True,
        target_type="taxonomy", target_id=slug,
    )
    return {"ok": True}


# ===== Idee bearbeiten =========================================
class IdeaPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    author: str | None = None
    project_url: str | None = None
    keywords: list[str] | None = None
    phase: str | None = None
    event: str | None = None  # legacy single-event
    events: list[str] | None = None  # mehrere Veranstaltungen — überschreibt komplett


@router.patch("/ideas/{idea_id}", tags=["ideas"])
async def edit_idea(
    idea_id: str,
    body: IdeaPatch,
    authorization: str | None = Header(None),
):
    """Updates the metadata on the underlying ccm:io. Auth is passed through
    to edu-sharing — that decides whether the caller has Write permission on
    the node (owner or moderator)."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")

    with connect() as con:
        row = con.execute(
            "SELECT main_content_id, kind, phase FROM idea WHERE id=?", (idea_id,)
        ).fetchone()

    # Fallback wenn der Cache den Node noch nicht kennt (z.B. unmittelbar
    # nach einem POST /ideas vor dem nächsten Sync): direkt am Node editieren.
    if not row:
        target_node = idea_id
        current_phase: str | None = None
    else:
        target_node = (
            row["main_content_id"] if row["kind"] == "collection" and row["main_content_id"]
            else idea_id
        )
        current_phase = row["phase"]

    # Phase-Status-Workflow (Variante A): Owner darf nur eine Stufe vorwärts,
    # Mod darf alles. Der Workflow-Check läuft *bevor* ES kontaktiert wird.
    if body.phase is not None and body.phase != current_phase:
        is_mod = await _is_moderator(authorization)
        with connect() as con:
            order = _phase_order(con)
        ok, reason = _is_allowed_phase_transition(
            current=current_phase, target=body.phase, is_mod=is_mod, order=order,
        )
        if not ok:
            raise HTTPException(403, reason or "Phase-Wechsel nicht erlaubt.")

    # Build the property update — only fields that were sent are merged in.
    props: dict[str, list[str]] = {}
    if body.title is not None:
        props["cm:title"] = [body.title]
        props["cclom:title"] = [body.title]
    if body.description is not None:
        props["cclom:general_description"] = [body.description]
        props["cm:description"] = [body.description]
    if body.author is not None:
        props["ccm:author_freetext"] = [body.author]
    if body.project_url is not None:
        props["ccm:wwwurl"] = [body.project_url]
    # Keywords-Merge: bestehende phase:/event:/target-topic:/sonstiges + neue Werte
    if (body.keywords is not None or body.phase is not None
            or body.event is not None or body.events is not None):
        kws = list(body.keywords or [])
        # Drop existing phase:/event: prefixes from supplied keywords (caller may
        # have included them; we re-derive to keep things consistent).
        kws = [
            k for k in kws
            if not k.lower().startswith(("phase:", "event:"))
        ]
        if body.phase:
            kws.append(f"phase:{body.phase}")
        # Events: events[] hat Vorrang, sonst legacy event-Feld.
        evs = body.events if body.events is not None else (
            [body.event] if body.event else []
        )
        seen: set[str] = set()
        for ev in evs:
            ev = (ev or "").strip()
            if not ev or ev.lower() in seen:
                continue
            seen.add(ev.lower())
            kws.append(f"event:{ev}")
        props["cclom:general_keyword"] = kws

    if not props:
        raise HTTPException(400, "Keine Felder zum Aktualisieren angegeben")

    try:
        await edu_sharing.client.update_metadata(
            target_node, props, auth_header=authorization
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(
                403, "Du hast keine Berechtigung, diese Idee zu bearbeiten."
            )
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )

    # Single-Node-Refresh statt Voll-Sync: nur diese eine Idee neu cachen.
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass
    _log_activity(
        action="idea_edited",
        authorization=authorization,
        target_type="idea", target_id=idea_id, target_label=body.title,
        detail={k: v for k, v in body.model_dump(exclude_none=True).items()
                if k in {"title", "phase", "event", "events"}},
    )
    # Separater Phase-Wechsel-Eintrag mit Old/New, falls Phase wirklich gewechselt
    if body.phase is not None and body.phase != current_phase:
        _log_activity(
            action="phase_changed",
            authorization=authorization,
            target_type="idea", target_id=idea_id, target_label=body.title,
            detail={"from": current_phase, "to": body.phase},
        )
    return {"ok": True, "node_id": target_node}


@router.delete("/ideas/{idea_id}", tags=["ideas"])
async def delete_idea(
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Löscht eine Idee. Auth wird durchgereicht — edu-sharing prüft, ob der
    Caller Owner oder Moderator ist (sonst 403). Eine eventuell verknüpfte
    Anhänge-Sammlung wird NICHT automatisch mitgelöscht — dafür gibt es einen
    eigenen Endpoint, damit das Verschwindenlassen von Material immer eine
    bewusste Aktion ist."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    try:
        await edu_sharing.client.delete_node(idea_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(
                403, "Keine Berechtigung, diese Idee zu löschen."
            )
        if e.response.status_code == 404:
            # Schon weg — Cache nachziehen, dem Caller OK zurückgeben.
            pass
        else:
            raise HTTPException(
                e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
            )

    # Cache aufräumen + Titel für Log retten BEVOR wir löschen
    deleted_title: str | None = None
    with connect() as con:
        row = con.execute("SELECT title FROM idea WHERE id = ?", (idea_id,)).fetchone()
        deleted_title = row["title"] if row else None
        con.execute("DELETE FROM idea WHERE id = ?", (idea_id,))
        con.execute("DELETE FROM idea_fts WHERE id = ?", (idea_id,))
        con.execute("DELETE FROM idea_interaction WHERE idea_id = ?", (idea_id,))
    _log_activity(
        action="idea_deleted",
        authorization=authorization,
        target_type="idea", target_id=idea_id, target_label=deleted_title,
    )
    return {"ok": True}


@router.post("/ideas/{idea_id}/duplicate", tags=["ideas"])
async def duplicate_idea(
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Erstellt eine Kopie der Idee als neuen ccm:io im selben Eltern-Container.
    Title wird mit „ (Kopie)" suffixiert. Anhänge-Sammlung und Bewertungen
    werden NICHT mitkopiert — nur die Stamm-Metadaten."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")

    try:
        meta = await edu_sharing.client.node_metadata(idea_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )
    node = (meta or {}).get("node") or {}
    props = node.get("properties") or {}
    parent = node.get("parent") or {}
    parent_id = parent.get("id") or (parent.get("ref") or {}).get("id")
    if not parent_id:
        raise HTTPException(409, "Quell-Idee hat keinen Eltern-Container")

    title = (
        (props.get("cclom:title") or props.get("cm:title") or [None])[0]
        or node.get("title") or "Idee"
    )
    new_title = f"{title} (Kopie)"
    new_props: dict[str, list[str]] = {
        "cm:name": [_slugify(new_title)],
        "cm:title": [new_title],
        "cclom:title": [new_title],
    }
    # Beschreibung, Author, Project-URL, Keywords übernehmen.
    for src, dst in [
        ("cclom:general_description", "cclom:general_description"),
        ("cm:description", "cm:description"),
        ("ccm:author_freetext", "ccm:author_freetext"),
        ("ccm:wwwurl", "ccm:wwwurl"),
        ("cclom:general_keyword", "cclom:general_keyword"),
    ]:
        if props.get(src):
            new_props[dst] = list(props[src])

    try:
        result = await edu_sharing.client.create_node(
            parent_id=parent_id,
            node_type="ccm:io",
            properties=new_props,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, hier eine Kopie anzulegen.")
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )
    new_id = ((result or {}).get("node") or {}).get("ref", {}).get("id")
    if not new_id:
        raise HTTPException(502, "edu-sharing lieferte keine ID für die Kopie")
    # Single-Node-Refresh: Kopie ist im Cache, sobald der Caller die Detail-
    # Ansicht öffnet — kein Warten auf den 5-min-Lauf.
    try:
        await sync_mod.refresh_idea(new_id, auth_header=authorization)
    except Exception:
        pass
    _log_activity(
        action="idea_duplicated",
        authorization=authorization,
        target_type="idea", target_id=new_id, target_label=new_title,
        detail={"source_id": idea_id},
    )
    return {"ok": True, "node_id": new_id}


@router.delete("/ideas/{idea_id}/attachments/folder", tags=["ideas"])
async def delete_attachment_folder(
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Löscht die mit einer Idee verknüpfte Anhänge-Sammlung samt aller
    enthaltenen Dateien. Bewusst getrennt vom Idee-Löschen, damit der User
    aktiv entscheiden muss, das Material wegzuwerfen."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        row = con.execute(
            "SELECT attachment_folder_id FROM idea WHERE id=?", (idea_id,)
        ).fetchone()
    folder_id = row["attachment_folder_id"] if row else None
    if not folder_id:
        raise HTTPException(404, "Keine Anhänge-Sammlung verknüpft")
    try:
        await edu_sharing.client.delete_node(folder_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(
                403, "Keine Berechtigung, die Anhänge-Sammlung zu löschen."
            )
        if e.response.status_code != 404:
            raise HTTPException(
                e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
            )
    with connect() as con:
        con.execute(
            "UPDATE idea SET attachment_folder_id=NULL WHERE id=?", (idea_id,)
        )
    _log_activity(
        action="attachment_folder_deleted",
        authorization=authorization,
        target_type="folder", target_id=folder_id,
        detail={"idea_id": idea_id},
    )
    return {"ok": True}


class AttachmentRename(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


@router.patch("/ideas/{idea_id}/attachments/{attachment_id}", tags=["ideas"])
async def rename_attachment(
    idea_id: str,
    attachment_id: str,
    body: AttachmentRename,
    authorization: str | None = Header(None),
):
    """Benennt eine Datei in der Anhänge-Sammlung der Idee um. Sicherheits-
    Check wie beim Löschen: Datei muss Kind der verknüpften Sammlung sein."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    try:
        meta = await edu_sharing.client.node_metadata(
            attachment_id, auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )
    parent = (meta.get("node") or {}).get("parent") or {}
    parent_id = parent.get("id") or (parent.get("ref") or {}).get("id")
    with connect() as con:
        row = con.execute(
            "SELECT attachment_folder_id FROM idea WHERE id=?", (idea_id,),
        ).fetchone()
    folder_id = row["attachment_folder_id"] if row else None
    if not folder_id or parent_id != folder_id:
        raise HTTPException(
            409,
            "Diese Datei gehört nicht zur Anhänge-Sammlung dieser Idee. "
            "Aus Sicherheitsgründen abgelehnt.",
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
            raise HTTPException(403, "Keine Berechtigung, diese Datei umzubenennen.")
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )
    _log_activity(
        action="attachment_renamed", authorization=authorization,
        target_type="attachment", target_id=attachment_id, target_label=new_name,
        detail={"idea_id": idea_id, "folder_id": folder_id},
    )
    return {"ok": True, "name": new_name}


@router.delete("/ideas/{idea_id}/attachments/{attachment_id}", tags=["ideas"])
async def delete_attachment(
    idea_id: str,
    attachment_id: str,
    authorization: str | None = Header(None),
):
    """Löscht eine einzelne Datei aus der Anhänge-Sammlung der Idee.
    Sicherheits-Check: wir prüfen, dass die Datei tatsächlich Kind der
    verknüpften Anhänge-Sammlung ist — sonst lehnen wir ab, damit hier nicht
    versehentlich fremde Knoten geleert werden."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    # idea_id ist nur Kontext-Pfad; primärer Schutz ist die Folder-Membership-Prüfung.
    try:
        meta = await edu_sharing.client.node_metadata(
            attachment_id, auth_header=authorization
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )
    parent = (meta.get("node") or {}).get("parent") or {}
    parent_id = parent.get("id") or (parent.get("ref") or {}).get("id")
    with connect() as con:
        row = con.execute(
            "SELECT attachment_folder_id FROM idea WHERE id=?", (idea_id,)
        ).fetchone()
    folder_id = row["attachment_folder_id"] if row else None
    if not folder_id or parent_id != folder_id:
        raise HTTPException(
            409,
            "Diese Datei gehört nicht zur Anhänge-Sammlung dieser Idee. "
            "Aus Sicherheitsgründen abgelehnt.",
        )
    # Filename für Log retten BEVOR wir löschen
    att_props = (meta.get("node") or {}).get("properties") or {}
    att_name = (
        (att_props.get("cm:name") or att_props.get("cclom:title") or [None])[0]
        or "Datei"
    )
    try:
        await edu_sharing.client.delete_node(attachment_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, diese Datei zu löschen.")
        if e.response.status_code != 404:
            raise HTTPException(
                e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
            )
    _log_activity(
        action="attachment_deleted",
        authorization=authorization,
        target_type="attachment", target_id=attachment_id, target_label=att_name,
        detail={"idea_id": idea_id, "folder_id": folder_id},
    )
    return {"ok": True}


class IdeaReport(BaseModel):
    reason: str = Field(..., min_length=3, max_length=2000)


@router.post("/ideas/{idea_id}/report", tags=["ideas"])
@limiter.limit("10/minute")
async def report_idea(
    request: Request,
    idea_id: str,
    body: IdeaReport,
    authorization: str | None = Header(None),
):
    """Trägt einen Melde-Eintrag in die DB ein. Moderatoren sehen die offenen
    Meldungen in ihrem Bereich. Kein automatischer Mailversand — bewusst
    minimal, weil ES-eigener SMTP-Hook auf prod hängt."""
    with connect() as con:
        con.execute(
            """CREATE TABLE IF NOT EXISTS idea_report (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 idea_id TEXT NOT NULL,
                 reason TEXT NOT NULL,
                 reporter TEXT,
                 created_at TEXT NOT NULL,
                 resolved_at TEXT
               )"""
        )
        # Reporter ggf. aus auth-User ableiten (Cache greift nicht für anon).
        reporter = None
        if authorization:
            try:
                me = await edu_sharing.client.node_metadata(
                    idea_id, auth_header=authorization
                )
                reporter = ((me.get("node") or {}).get("createdBy") or {}).get("authorityName")
            except Exception:
                pass
        con.execute(
            "INSERT INTO idea_report (idea_id,reason,reporter,created_at) "
            "VALUES (?,?,?,?)",
            (idea_id, body.reason.strip(), reporter, sync_mod._iso_now()),
        )
        # Idee-Titel für hübsches Log
        title_row = con.execute(
            "SELECT title FROM idea WHERE id=?", (idea_id,)
        ).fetchone()
    _log_activity(
        action="report_submitted",
        authorization=authorization,
        target_type="idea", target_id=idea_id,
        target_label=(title_row["title"] if title_row else None),
        detail={"reason_excerpt": body.reason.strip()[:120]},
    )
    return {"ok": True}


@router.get("/admin/reports", tags=["moderation"])
async def list_reports(authorization: str | None = Header(None)):
    """Mod-Liste offener Meldungen (resolved_at IS NULL)."""
    await _require_moderator(authorization)
    with connect() as con:
        con.execute(
            """CREATE TABLE IF NOT EXISTS idea_report (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 idea_id TEXT NOT NULL,
                 reason TEXT NOT NULL,
                 reporter TEXT,
                 created_at TEXT NOT NULL,
                 resolved_at TEXT
               )"""
        )
        rows = con.execute(
            """SELECT r.*, i.title FROM idea_report r
                 LEFT JOIN idea i ON i.id = r.idea_id
                WHERE r.resolved_at IS NULL
                ORDER BY r.created_at DESC LIMIT 200"""
        ).fetchall()
    return {"count": len(rows), "items": [dict(r) for r in rows]}


@router.get("/admin/stats", tags=["moderation"])
async def admin_stats(authorization: str | None = Header(None)):
    """Übersichts-Dashboard für Mods: Totals, Phasen-/Event-Verteilung,
    Aktivitätskurve (Ideen pro Woche), Top-Aktive User, Reports-Stand."""
    await _require_moderator(authorization)
    with connect() as con:
        # Totals
        ideas_total = con.execute("SELECT COUNT(*) FROM idea").fetchone()[0]
        topics_total = con.execute("SELECT COUNT(*) FROM topic").fetchone()[0]
        themes_total = con.execute(
            "SELECT COUNT(*) FROM topic WHERE parent_id IS NULL"
        ).fetchone()[0]
        challenges_total = topics_total - themes_total

        comments_total = con.execute(
            "SELECT COALESCE(SUM(comment_count),0) FROM idea"
        ).fetchone()[0]
        ratings_total = con.execute(
            "SELECT COALESCE(SUM(rating_count),0) FROM idea"
        ).fetchone()[0]
        interest_total = con.execute(
            "SELECT COUNT(*) FROM idea_interaction WHERE kind='interest'"
        ).fetchone()[0]
        follow_total = con.execute(
            "SELECT COUNT(*) FROM idea_interaction WHERE kind='follow'"
        ).fetchone()[0]

        # Phasen-Verteilung
        phases = [
            {"phase": r["phase"] or "(offen)", "count": r["c"]}
            for r in con.execute(
                "SELECT COALESCE(phase,'') AS phase, COUNT(*) AS c "
                "FROM idea GROUP BY phase ORDER BY c DESC"
            ).fetchall()
        ]

        # Event-Verteilung — events ist JSON, also in Python aggregieren
        ev_rows = con.execute("SELECT events FROM idea").fetchall()
        events: dict[str, int] = {}
        no_event = 0
        for r in ev_rows:
            try:
                evs = json.loads(r["events"] or "[]")
            except Exception:
                evs = []
            if not evs:
                no_event += 1
            for e in evs:
                events[e] = events.get(e, 0) + 1
        events_dist = sorted(
            [{"event": k, "count": v} for k, v in events.items()],
            key=lambda x: -x["count"],
        )
        if no_event:
            events_dist.append({"event": "(keine)", "count": no_event})

        # Aktivität pro Woche — letzte 12 Wochen, basiert auf created_at
        # ISO-Wochen-Format „YYYY-Www"
        weekly = con.execute(
            "SELECT strftime('%Y-W%W', created_at) AS week, COUNT(*) AS c "
            "FROM idea WHERE created_at IS NOT NULL "
            "GROUP BY week ORDER BY week DESC LIMIT 12"
        ).fetchall()
        weekly_list = list(reversed([
            {"week": r["week"], "count": r["c"]} for r in weekly
        ]))

        # Top-Aktive User aus activity_log (letzte 30 Tage)
        cutoff = (
            datetime.now(timezone.utc) - timedelta(days=30)
        ).isoformat()
        top_actors = [
            {"actor": r["actor"], "count": r["c"]}
            for r in con.execute(
                "SELECT actor, COUNT(*) AS c FROM activity_log "
                "WHERE ts >= ? AND actor IS NOT NULL AND actor != 'Gast' "
                "GROUP BY actor ORDER BY c DESC LIMIT 10",
                (cutoff,),
            ).fetchall()
        ]

        # Reports
        rep_open = con.execute(
            "SELECT COUNT(*) FROM idea_report WHERE resolved_at IS NULL"
        ).fetchone()[0] if con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='idea_report'"
        ).fetchone() else 0
        rep_resolved = con.execute(
            "SELECT COUNT(*) FROM idea_report WHERE resolved_at IS NOT NULL"
        ).fetchone()[0] if con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='idea_report'"
        ).fetchone() else 0

        # Aktivitäts-Volumen letzte 30 Tage pro Action
        action_dist = [
            {"action": r["action"], "count": r["c"]}
            for r in con.execute(
                "SELECT action, COUNT(*) AS c FROM activity_log "
                "WHERE ts >= ? GROUP BY action ORDER BY c DESC",
                (cutoff,),
            ).fetchall()
        ]

        # Aktivste Ideen (Rating + Comments + Interest gewichtet)
        top_ideas = [
            dict(r) for r in con.execute(
                "SELECT i.id, i.title, i.rating_avg, i.rating_count, "
                "       i.comment_count, "
                "       (SELECT COUNT(*) FROM idea_interaction "
                "        WHERE idea_id=i.id AND kind='interest') AS interest_count "
                "FROM idea i "
                "ORDER BY (rating_count + comment_count + "
                "  (SELECT COUNT(*) FROM idea_interaction "
                "   WHERE idea_id=i.id AND kind='interest')) DESC LIMIT 10"
            ).fetchall()
        ]

    # Avg-Rating (gewichtet)
    avg_rating = 0.0
    if ratings_total:
        with connect() as con:
            r = con.execute(
                "SELECT SUM(rating_avg * rating_count) / SUM(rating_count) AS a "
                "FROM idea WHERE rating_count > 0"
            ).fetchone()
            avg_rating = float(r["a"] or 0.0)

    return {
        "totals": {
            "ideas": ideas_total,
            "themes": themes_total,
            "challenges": challenges_total,
            "comments": comments_total,
            "ratings": ratings_total,
            "interest": interest_total,
            "follow": follow_total,
            "avg_rating": round(avg_rating, 2),
        },
        "phases": phases,
        "events": events_dist,
        "weekly": weekly_list,
        "top_actors": top_actors,
        "top_ideas": top_ideas,
        "reports": {"open": rep_open, "resolved": rep_resolved},
        "actions_30d": action_dist,
    }


@router.get("/admin/activity", tags=["moderation"])
async def list_activity(
    action: str | None = None,
    actor: str | None = None,
    target_id: str | None = None,
    since: str | None = Query(None, description="ISO datetime — only entries newer than this"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    authorization: str | None = Header(None),
):
    """Mod-Aktivitätslog. Filterbar nach action-Typ, Akteur, Target-Idee
    oder Zeitraum. Sortiert chronologisch absteigend (neueste zuerst)."""
    await _require_moderator(authorization)
    where: list[str] = []
    params: list = []
    if action:
        where.append("action = ?"); params.append(action)
    if actor:
        where.append("actor LIKE ?"); params.append(f"%{actor}%")
    if target_id:
        where.append("target_id = ?"); params.append(target_id)
    if since:
        where.append("ts >= ?"); params.append(since)
    sql_where = (" WHERE " + " AND ".join(where)) if where else ""

    with connect() as con:
        total = con.execute(
            f"SELECT COUNT(*) FROM activity_log{sql_where}", params
        ).fetchone()[0]
        rows = con.execute(
            f"SELECT * FROM activity_log{sql_where} "
            f"ORDER BY ts DESC LIMIT ? OFFSET ?",
            (*params, limit, offset),
        ).fetchall()
        # Verfügbare Action-Typen für UI-Dropdown
        actions = [
            r["action"] for r in con.execute(
                "SELECT DISTINCT action FROM activity_log ORDER BY action ASC"
            ).fetchall()
        ]

    items = []
    for r in rows:
        d = dict(r)
        if d.get("detail"):
            try: d["detail"] = json.loads(d["detail"])
            except Exception: pass
        items.append(d)

    return {
        "total": total, "limit": limit, "offset": offset,
        "actions": actions, "items": items,
    }


@router.post("/admin/reports/{report_id}/resolve", tags=["moderation"])
async def resolve_report(report_id: int, authorization: str | None = Header(None)):
    await _require_moderator(authorization)
    with connect() as con:
        con.execute(
            "UPDATE idea_report SET resolved_at=? WHERE id=?",
            (sync_mod._iso_now(), report_id),
        )
    _log_activity(
        action="report_resolved",
        authorization=authorization, is_mod=True,
        target_type="report", target_id=str(report_id),
    )
    return {"ok": True}


# ===== Moderation — Rolle ermitteln =============================

async def _is_moderator(authorization: str | None) -> bool:
    """Bestätigt, ob der eingeloggte User Mod-Rechte hat.

    Drei Wege, in Reihenfolge:
    1. Username steht in der Bootstrap-Whitelist (env)
    2. User ist Mitglied der konfigurierten Moderations-Gruppe
    3. User ist Mitglied einer Fallback-Gruppe (z.B. ALFRESCO_ADMINISTRATORS)
    """
    if not authorization:
        return False
    user = _user_key_from_auth(authorization)
    if user and user in settings.bootstrap_mod_users:
        return True
    try:
        m = await edu_sharing.client.my_memberships(auth_header=authorization)
        groups = {(g.get("authorityName") or "") for g in (m.get("groups") or [])}
    except Exception:
        return False
    if settings.moderation_group in groups:
        return True
    if any(g in groups for g in settings.fallback_mod_groups):
        return True
    return False


async def _require_moderator(authorization: str | None) -> str:
    """Helper, der bei nicht-Mod den 403 wirft. Gibt sonst den Username zurück.
    Fehlgeschlagene Versuche werden ins Activity-Log geschrieben — so kann ein
    Mod im Audit-Tab erkennen, ob jemand Mod-Endpoints zu raten versucht."""
    if not authorization:
        _log_activity(
            action="auth_failed", target_type="admin",
            detail={"reason": "no_credentials"},
        )
        raise HTTPException(401, "Anmeldung erforderlich")
    if not await _is_moderator(authorization):
        _log_activity(
            action="auth_failed", authorization=authorization,
            target_type="admin",
            detail={"reason": "not_moderator"},
        )
        raise HTTPException(403, "Diese Aktion ist Moderator:innen vorbehalten.")
    return _user_key_from_auth(authorization) or ""


@router.get("/me", tags=["me"])
async def whoami(authorization: str | None = Header(None)):
    """Bestätigt den aktuell eingeloggten User + Mod-Status.
    Frontend nutzt das beim Login um Mod-UI zu gaten."""
    if not authorization:
        return {"authenticated": False}
    user = _user_key_from_auth(authorization)
    is_mod = await _is_moderator(authorization)
    return {
        "authenticated": bool(user),
        "username": user,
        "is_moderator": is_mod,
        "moderation_group": settings.moderation_group,
    }


# ===== "Mein Bereich" — User-spezifische Listen ==================

@router.get("/me/ideas", tags=["me"])
def my_ideas(authorization: str | None = Header(None)):
    """Ideen, die dem eingeloggten User gehören (cm:owner == username)."""
    user = _user_key_from_auth(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        rows = con.execute(
            "SELECT * FROM idea WHERE owner_username = ? ORDER BY modified_at DESC",
            (user,),
        ).fetchall()
    return {"count": len(rows), "items": [_row_to_idea(r) for r in rows]}


@router.get("/me/follows", tags=["me"])
def my_follows(authorization: str | None = Header(None)):
    """Ideen, denen der User folgt."""
    user = _user_key_from_auth(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        rows = con.execute(
            "SELECT i.* FROM idea i "
            "JOIN idea_interaction x ON x.idea_id = i.id "
            "WHERE x.user_key = ? AND x.kind = 'follow' "
            "ORDER BY x.created_at DESC",
            (user,),
        ).fetchall()
    return {"count": len(rows), "items": [_row_to_idea(r) for r in rows]}


@router.get("/me/interest", tags=["me"])
def my_interest(authorization: str | None = Header(None)):
    """Ideen, bei denen der User „mitmachen" gemarkt hat."""
    user = _user_key_from_auth(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        rows = con.execute(
            "SELECT i.* FROM idea i "
            "JOIN idea_interaction x ON x.idea_id = i.id "
            "WHERE x.user_key = ? AND x.kind = 'interest' "
            "ORDER BY x.created_at DESC",
            (user,),
        ).fetchall()
    return {"count": len(rows), "items": [_row_to_idea(r) for r in rows]}


@router.get("/me/activity", tags=["me"])
async def my_activity(
    limit: int = Query(50, ge=1, le=200),
    authorization: str | None = Header(None),
):
    """Aktivitäts-Feed für den eingeloggten User: Ereignisse zu Ideen, denen
    er folgt, die ihm gehören oder bei denen er „Mitmachen" angeklickt hat.
    Eigene Aktionen werden ausgeblendet — wir zeigen nur, was *andere* tun."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    me = _user_key_from_auth(authorization)
    if not me:
        raise HTTPException(401, "Username konnte nicht ermittelt werden")

    with connect() as con:
        # Sammle relevante Idea-IDs: gefolgt + Mitmachen + eigene
        idea_ids = {
            r["idea_id"] for r in con.execute(
                "SELECT idea_id FROM idea_interaction "
                "WHERE user_key = ? AND kind IN ('follow','interest')",
                (me,),
            ).fetchall()
        }
        for r in con.execute(
            "SELECT id FROM idea WHERE owner_username = ?", (me,),
        ).fetchall():
            idea_ids.add(r["id"])

        if not idea_ids:
            return {"count": 0, "items": []}

        placeholders = ",".join(["?"] * len(idea_ids))
        rows = con.execute(
            f"SELECT * FROM activity_log "
            f"WHERE target_id IN ({placeholders}) "
            f"  AND COALESCE(actor,'') <> ? "  # eigene Aktionen ausblenden
            f"ORDER BY ts DESC LIMIT ?",
            (*idea_ids, me, limit),
        ).fetchall()

    items = []
    for r in rows:
        d = dict(r)
        if d.get("detail"):
            try: d["detail"] = json.loads(d["detail"])
            except Exception: pass
        items.append(d)
    return {"count": len(items), "items": items}


# ===== Anhänge-Sammlung anlegen ==================================

@router.post("/ideas/{idea_id}/attachments/upload", tags=["ideas"])
async def upload_to_attachment_folder(
    idea_id: str,
    file: UploadFile = File(...),
    folder_id: str | None = None,
    authorization: str | None = Header(None),
):
    """Lädt eine Datei in die Anhänge-Sammlung der Idee.
    Falls keine Anhänge-Sammlung existiert, wird ein 409 zurückgegeben — vorher
    POST /ideas/{id}/attachments/folder rufen.
    Erzeugt einen ccm:io-Child mit dem Datei-Namen, lädt die Bytes als content.

    Optionaler Query-Param `folder_id` umgeht den Cache-Lookup — nötig für
    frisch eingereichte Ideen, die noch nicht synchronisiert wurden."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")

    if not folder_id:
        with connect() as con:
            row = con.execute(
                "SELECT attachment_folder_id FROM idea WHERE id = ?", (idea_id,),
            ).fetchone()
        if row and row["attachment_folder_id"]:
            folder_id = row["attachment_folder_id"]
    if not folder_id:
        raise HTTPException(
            409,
            "Keine Anhänge-Sammlung verknüpft. Erst über "
            "POST /ideas/{id}/attachments/folder anlegen, dann "
            "folder_id als Query-Param mitgeben oder Sync abwarten.",
        )

    data = await file.read()
    if not data:
        raise HTTPException(400, "Leere Datei")
    filename = file.filename or "upload.bin"
    mimetype = file.content_type or "application/octet-stream"

    # Step 1: ccm:io-Child in der Anhänge-Sammlung anlegen
    try:
        result = await edu_sharing.client.create_node(
            parent_id=folder_id,
            node_type="ccm:io",
            properties={
                "cm:name": [filename],
                "cm:title": [filename],
                "cclom:title": [filename],
            },
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(
                403, "Keine Berechtigung, hier Inhalte zu speichern."
            )
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )

    new_id = ((result or {}).get("node") or {}).get("ref", {}).get("id")
    if not new_id:
        raise HTTPException(502, "edu-sharing lieferte keine ID für die neue Datei")

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
    # Idee-Cache anstoßen — Anhang-Liste wird live aus collection_references
    # geholt, aber so bleiben Idee-Felder (modified_at) aktuell.
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass
    _log_activity(
        action="attachment_uploaded",
        authorization=authorization,
        target_type="attachment", target_id=new_id, target_label=filename,
        detail={"idea_id": idea_id, "size": len(data), "mimetype": mimetype},
    )
    return {"ok": True, "node_id": new_id, "name": filename, "size": len(data)}


@router.post("/ideas/{idea_id}/attachments/folder", tags=["ideas"])
async def create_attachment_folder(
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Erstellt eine Geschwister-Sammlung zur Idee als Ablage für weitere
    Dateien. Der Name ist „<idea-title> — Anhänge"; Keyword
    `attachment-of:<idea-id>` verknüpft sie eindeutig.
    Erfordert Schreibrechte am Eltern-Container (Herausforderung)."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")

    with connect() as con:
        row = con.execute(
            "SELECT id, topic_id, title, attachment_folder_id FROM idea WHERE id = ?",
            (idea_id,),
        ).fetchone()

    topic_id: str | None = None
    title: str | None = None
    fresh_node: dict | None = None
    if row:
        if row["attachment_folder_id"]:
            return {
                "ok": True,
                "already_exists": True,
                "folder_id": row["attachment_folder_id"],
            }
        topic_id = row["topic_id"]
        title = row["title"]

    # Fallback für frisch eingereichte Ideen, die noch nicht im SQLite-Cache
    # liegen: Metadaten direkt aus edu-sharing holen (Parent + Titel).
    if not row or not topic_id or not title:
        try:
            md = await edu_sharing.client.node_metadata(idea_id)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                raise HTTPException(404, "Idee nicht gefunden")
            raise HTTPException(
                e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
            )
        fresh_node = (md or {}).get("node") or md or {}
        props = fresh_node.get("properties") or {}
        if not title:
            title = (
                (props.get("cclom:title") or props.get("cm:title") or [None])[0]
                or fresh_node.get("title")
                or (props.get("cm:name") or [None])[0]
                or "Idee"
            )
        if not topic_id:
            parent = fresh_node.get("parent") or {}
            topic_id = parent.get("id") or (parent.get("ref") or {}).get("id")

    if not topic_id:
        raise HTTPException(409, "Idee hat keinen zugeordneten Sammlungs-Container")

    folder_name = f"{title} — Anhänge"
    try:
        result = await edu_sharing.client.create_collection(
            parent_id=topic_id,
            title=folder_name,
            description=f"Zusatzmaterial zur Idee „{title}"".",
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(
                403, "Keine Berechtigung, eine Sammlung in diesem Bereich anzulegen."
            )
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )

    folder_id = (
        ((result or {}).get("collection") or result or {}).get("ref") or {}
    ).get("id")
    if not folder_id:
        raise HTTPException(502, "edu-sharing lieferte keine ID für die neue Sammlung")

    # Keyword `attachment-of:<idea-id>` ans Folder-Node anhängen, damit der
    # Sync die Verknüpfung beim nächsten Lauf wiederfindet.
    try:
        await edu_sharing.client.update_metadata(
            folder_id,
            {"cclom:general_keyword": [f"attachment-of:{idea_id}"]},
            auth_header=authorization,
        )
    except Exception:
        pass  # nicht kritisch — Cache-Eintrag unten reicht für Sofortanzeige

    # Cache schreiben — wenn die Idee noch nicht im Cache war, legen wir einen
    # Stub-Row an, damit GET /ideas/{id} bis zum nächsten Sync funktioniert
    # und die Anhänge-Sammlung sofort persistent sichtbar bleibt.
    with connect() as con:
        if row is None and fresh_node is not None:
            try:
                from .sync import _upsert_idea
                # ccm:io ⇒ kind="io"; main_content_id = idea selbst
                ntype = fresh_node.get("type") or ""
                kind_local = "collection" if ntype == "ccm:map" else "io"
                main_id = idea_id if kind_local == "io" else None
                await _upsert_idea(
                    con,
                    fresh_node,
                    kind=kind_local,
                    topic_id=topic_id,
                    main_content_id=main_id,
                )
            except Exception as e:
                log.warning("stub upsert failed for %s: %s", idea_id, e)
        con.execute(
            "UPDATE idea SET attachment_folder_id = ? WHERE id = ?",
            (folder_id, idea_id),
        )
    _log_activity(
        action="attachment_folder_created",
        authorization=authorization,
        target_type="folder", target_id=folder_id, target_label=folder_name,
        detail={"idea_id": idea_id},
    )
    return {"ok": True, "folder_id": folder_id, "name": folder_name}


# ===== Moderator-Verwaltung (Mitglieder der Mod-Gruppe) ===========

@router.get("/admin/moderators", tags=["moderation"])
async def list_moderators(authorization: str | None = Header(None)):
    """Liste der Mitglieder der konfigurierten Moderations-Gruppe + bootstrap."""
    await _require_moderator(authorization)
    members: list[dict] = []
    try:
        m = await edu_sharing.client.group_members(
            settings.moderation_group, auth_header=authorization
        )
        for p in (m.get("persons") or m.get("authorities") or m.get("members") or []):
            profile = p.get("profile") or {}
            members.append({
                "username": p.get("authorityName") or p.get("userName"),
                "first_name": profile.get("firstName"),
                "last_name": profile.get("lastName"),
                "email": profile.get("email") or p.get("mailbox"),
                "source": "group",
            })
    except httpx.HTTPStatusError as e:
        if e.response.status_code != 404:
            raise HTTPException(
                e.response.status_code,
                f"edu-sharing: {e.response.text[:200]}",
            )
        # 404 = Gruppe existiert noch nicht — leere Liste, Bootstrap zeigen

    # Bootstrap-User aus ENV anhängen (sofern nicht bereits in der Gruppe)
    seen = {(m.get("username") or "").lower() for m in members}
    for u in settings.bootstrap_mod_users:
        if u.lower() not in seen:
            members.append({"username": u, "source": "bootstrap"})

    return {
        "group": settings.moderation_group,
        "fallback_groups": settings.fallback_mod_groups,
        "count": len(members),
        "members": members,
    }


@router.put("/admin/moderators/{username}", tags=["moderation"])
async def add_moderator(
    username: str,
    authorization: str | None = Header(None),
):
    await _require_moderator(authorization)
    try:
        await edu_sharing.client.add_group_member(
            settings.moderation_group, username, auth_header=authorization
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code,
            f"edu-sharing: {e.response.text[:200]}",
        )
    _log_activity(
        action="mod_added",
        authorization=authorization, is_mod=True,
        target_type="mod", target_id=username, target_label=username,
    )
    return {"ok": True, "username": username}


@router.delete("/admin/moderators/{username}", tags=["moderation"])
async def remove_moderator(
    username: str,
    authorization: str | None = Header(None),
):
    await _require_moderator(authorization)
    try:
        await edu_sharing.client.remove_group_member(
            settings.moderation_group, username, auth_header=authorization
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code,
            f"edu-sharing: {e.response.text[:200]}",
        )
    _log_activity(
        action="mod_removed",
        authorization=authorization, is_mod=True,
        target_type="mod", target_id=username, target_label=username,
    )
    return {"ok": True}


@router.get("/admin/users/search", tags=["moderation"])
async def search_users(
    q: str = Query(..., min_length=2),
    authorization: str | None = Header(None),
):
    """Suche edu-sharing User für die Moderator-Auswahl."""
    await _require_moderator(authorization)
    try:
        d = await edu_sharing.client.search_people(
            q, max_items=15, auth_header=authorization
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code,
            f"edu-sharing: {e.response.text[:200]}",
        )
    out = []
    for p in (d.get("persons") or d.get("authorities") or []):
        profile = p.get("profile") or {}
        out.append({
            "username": p.get("authorityName") or p.get("userName"),
            "first_name": profile.get("firstName"),
            "last_name": profile.get("lastName"),
            "email": profile.get("email") or p.get("mailbox"),
        })
    return {"results": out}


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
        action="backup_created", authorization=authorization, is_mod=True,
        target_type="backup", target_label=path.name,
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
    return {"backups": backup_mod.list_backups(),
            "keep": settings.backup_keep,
            "interval_hours": settings.backup_interval_hours,
            "enabled": settings.backup_enabled}


@router.get("/admin/backups/{filename}", tags=["admin"])
async def admin_backup_download(
    filename: str, authorization: str | None = Header(None),
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
    filename: str, authorization: str | None = Header(None),
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
        action="backup_deleted", authorization=authorization, is_mod=True,
        target_type="backup", target_label=filename,
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
    data = await file.read()
    if not data:
        raise HTTPException(400, "Leere Datei")
    if len(data) > 200 * 1024 * 1024:  # 200 MB Hard-Cap
        raise HTTPException(413, "Backup-Datei zu groß (max 200 MB)")
    try:
        result = await backup_mod.restore_backup(data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("restore failed")
        raise HTTPException(500, f"Restore fehlgeschlagen: {e}")
    _log_activity(
        action="backup_restored", authorization=authorization, is_mod=True,
        target_type="backup", target_label=file.filename,
        detail={"size": len(data),
                "restored_metadata": result.get("restored_metadata")},
    )
    return result


@router.get("/health")
def health():
    with connect() as con:
        counts = con.execute(
            "SELECT (SELECT COUNT(*) FROM topic) topics, (SELECT COUNT(*) FROM idea) ideas"
        ).fetchone()
        last = con.execute(
            "SELECT * FROM sync_log ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return {
        "ok": True,
        "topics": counts["topics"],
        "ideas": counts["ideas"],
        "last_sync": dict(last) if last else None,
    }
