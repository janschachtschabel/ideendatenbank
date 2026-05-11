from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Literal

log = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Body, File, Header, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from . import backup as backup_mod
from . import edu_sharing
from . import sync as sync_mod
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
                raise HTTPException(403, "Keine Berechtigung, diese Herausforderung zu ändern.")
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
            raise HTTPException(403, "Keine Berechtigung, diese Herausforderung zu löschen.")
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
    # Topic-Cache refreshen, damit die neue preview.url-URL (mit neuem
    # `?modified=`-Token) ins Cache wandert und Browser-Caches umgeht.
    try:
        meta = await edu_sharing.client.node_metadata(
            topic_id, auth_header=authorization,
        )
        node = (meta or {}).get("node") or {}
        new_preview = (node.get("preview") or {}).get("url")
        is_icon = (node.get("preview") or {}).get("isIcon", False)
        if new_preview and not is_icon:
            with connect() as con:
                con.execute(
                    "UPDATE topic SET preview_url=? WHERE id=?",
                    (new_preview, topic_id),
                )
    except Exception as e:
        log.debug("upload_topic_preview: Cache-Refresh fehlgeschlagen: %s", e)
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
def meta_facets(topic_id: str | None = Query(None)):
    """Distinct phase/event/category values currently in the cache, with counts.

    Optionaler `topic_id` filtert die Facetten-Counts auf den Subtree
    dieser Sammlung — wichtig damit die Pillen unter z.B. „Kooperation"
    nicht globale Counts zeigen, die zur Auswahl 0 Treffer ergeben."""
    where_sql, params = "", []
    if topic_id:
        with connect() as con:
            ids = _collect_topic_subtree(con, topic_id)
        placeholders = ",".join("?" * len(ids))
        where_sql = f"WHERE topic_id IN ({placeholders})"
        params = list(ids)

    with connect() as con:
        phase_sql = (
            f"SELECT phase AS value, COUNT(*) AS count FROM idea "
            f"{where_sql} {'AND' if where_sql else 'WHERE'} "
            f"phase IS NOT NULL AND phase <> '' "
            f"GROUP BY phase ORDER BY count DESC"
        )
        phases = con.execute(phase_sql, params).fetchall()
        rows = con.execute(
            f"SELECT events, categories FROM idea {where_sql}", params,
        ).fetchall()

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
    # Query-Param heißt `ids` (öffentlicher Vertrag), die Python-Variable
    # `id_filter` vermeidet die Kollision mit `ids` aus dem topic-subtree-
    # Pfad weiter unten.
    id_filter: str | None = Query(
        None,
        alias="ids",
        description="Komma-separierte Idea-IDs für gezielte Auswahl (Embed-Anwendungen)",
    ),
    sort: SortBy = "modified",
    order: Literal["asc", "desc"] = "desc",
    limit: int = Query(24, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    # Spalten qualifizieren wir mit dem `i.`-Prefix, weil beim FTS-Join
    # (idea_fts) sonst `id` und `title` mehrdeutig wären → SQLite-500.
    sort_cols = {
        "modified": "i.modified_at",
        "created": "i.created_at",
        "rating": "i.rating_avg",
        "comments": "i.comment_count",
        "title": "i.title",
    }
    sort_col = sort_cols[sort]

    where: list[str] = []
    params: list = []
    if topic_id:
        if include_descendants:
            with connect() as con:
                ids = _collect_topic_subtree(con, topic_id)
            placeholders = ",".join("?" * len(ids))
            where.append(f"i.topic_id IN ({placeholders})")
            params.extend(ids)
        else:
            where.append("i.topic_id = ?")
            params.append(topic_id)
    if phase:
        where.append("i.phase = ?")
        params.append(phase)
    if event:
        # events is a JSON array; LIKE works for simple membership lookup
        where.append("i.events LIKE ?")
        params.append(f'%"{event}"%')
    if category:
        where.append("i.categories LIKE ?")
        params.append(f'%"{category}"%')

    if id_filter:
        # Komma-separiert, max 200 IDs zur Sicherheit
        id_list = [x.strip() for x in id_filter.split(",") if x.strip()][:200]
        if id_list:
            placeholders = ",".join("?" * len(id_list))
            where.append(f"i.id IN ({placeholders})")
            params.extend(id_list)
        else:
            where.append("1 = 0")  # leere ids → keine Treffer

    # Versteckte Ideen (vom Mod soft-deleted) generell ausblenden — Mods
    # haben einen separaten Tab im Mod-UI für die Verwaltung.
    where.append("COALESCE(i.hidden, 0) = 0")

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

        # Defensiv: nur Einträge mit echtem Score zeigen. Falls je 0-Werte
        # in die Snapshots eingeschlichen sind (alte Daten, künftige Bugs
        # in der Capture-Logik), würden sie sonst die Liste mit Karteileichen
        # füllen und das Verlaufs-Chart unnötig stauchen.
        rows = con.execute(
            "SELECT rank, idea_id, score FROM ranking_snapshot "
            "WHERE event=? AND sort=? AND snapshot_at=? AND score > 0 "
            "ORDER BY rank ASC LIMIT ?",
            (ev, sort, latest, limit),
        ).fetchall()

        prev_ranks: dict[str, int] = {}
        if prev:
            for r in con.execute(
                "SELECT idea_id, rank FROM ranking_snapshot "
                "WHERE event=? AND sort=? AND snapshot_at=? AND score > 0",
                (ev, sort, prev),
            ).fetchall():
                prev_ranks[r["idea_id"]] = r["rank"]

        # Sparkline-History — alle Snapshots in chronologischer Reihenfolge.
        history_rows = con.execute(
            "SELECT idea_id, snapshot_at, score, rank FROM ranking_snapshot "
            "WHERE event=? AND sort=? AND score > 0 ORDER BY snapshot_at ASC",
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

    # Versteckte Ideen: für non-mod als 404 behandeln, damit Suchmaschinen
    # und externe Embeds sie nicht zeigen. Mod sieht den Inhalt + Hinweis.
    if row["hidden"]:
        is_mod_caller_early = await _is_moderator(authorization)
        if not is_mod_caller_early:
            raise HTTPException(404, "Idea not found")

    base = _row_to_idea(row)
    base["hidden"] = bool(row["hidden"])
    base["hidden_reason"] = row["hidden_reason"]
    base["interest_count"] = interest_count

    # Node-Metadata einmalig holen — wir brauchen sie für can_edit/Rating.
    # Wenn keine Auth da ist, holen wir trotzdem (anonym), weil Rating-Werte
    # auch ohne Auth lesbar sind. So bekommt jeder User die Live-Werte.
    target_id = row["main_content_id"] or row["id"]
    live_meta_node: dict = {}
    try:
        meta = await edu_sharing.client.node_metadata(
            target_id, auth_header=authorization,
        )
        live_meta_node = (meta or {}).get("node") or {}
    except Exception as e:
        log.debug("get_idea: node_metadata fehlgeschlagen: %s", e)

    # can_edit / can_delete: NICHT aus ES-accessEffective ableiten — die
    # HackathOERn-Gruppe hat dort durch Vererbung pauschal Write-Rechte und
    # das wäre ein Free-for-all. App-seitiges Owner-Gating greift stattdessen.
    can_edit = False
    can_delete = False
    if authorization:
        allowed, _user, _is_mod = await _is_owner_or_mod(row["id"], authorization)
        can_edit = allowed
        can_delete = allowed
    base["can_edit"] = can_edit
    base["can_delete"] = can_delete

    # Display-Name des Erstellers/Owners — konsistent mit Kommentaren, die
    # `firstName + lastName` aus dem ES-Profil zeigen. Frontend nutzt das
    # statt des reinen Login-Usernamens.
    owner_display_name: str | None = None
    if live_meta_node:
        for src in ("createdBy", "owner"):
            obj = live_meta_node.get(src) or {}
            fn = (obj.get("firstName") or "").strip()
            ln = (obj.get("lastName") or "").strip()
            full = f"{fn} {ln}".strip()
            if full:
                owner_display_name = full
                break
    base["owner_display_name"] = owner_display_name

    # Live-Rating aus den Node-Metadaten — der Cache-Wert kann durch
    # Schein-500-Fehler hinterherhinken, bis der nächste Sync läuft.
    # Auf der Detail-Seite ist es vertretbar, einen aktuellen Wert zu zeigen.
    base["my_rating"] = 0.0
    if live_meta_node:
        live_rating = live_meta_node.get("rating") or {}
        overall = live_rating.get("overall") or {}
        live_avg = float(overall.get("rating") or 0.0)
        live_count = int(overall.get("count") or 0)
        if live_count > 0 or live_avg > 0:
            base["rating_avg"] = live_avg
            base["rating_count"] = live_count
        if authorization:
            base["my_rating"] = float(live_rating.get("user") or 0.0)

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
    def _has_real_content(att: dict) -> bool:
        """Eine Idee als ccm:io darf nur dann als Anhang gelistet werden,
        wenn sie tatsächlich Datei-Bytes oder einen externen Link mitbringt.
        Reine Brainstorm-Karten (Titel, ggf. textContent vom Crawler) ohne
        echten Datei-Inhalt führen sonst zu einer leeren `Dokumente (1)`-
        Anzeige mit unbenutzbarem „Öffnen"-Button."""
        sz = att.get("size") or 0
        try: sz = int(sz)
        except (TypeError, ValueError): sz = 0
        return bool(att.get("download_url")) or sz > 0

    attachments: list[dict] = []
    if row["kind"] == "io":
        # The node itself IS the attachment; use cached fields, top it up
        # with a fresh probe to get render_url + preview_url.
        att: dict | None = None
        try:
            meta = await edu_sharing.client.node_metadata(
                row["id"], auth_header=authorization,
            )
            att = _attachment_from_node(meta.get("node") or {})
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                is_private = True
            att = {
                "id": row["id"],
                "name": _safe_get(row, "attachment_name"),
                "title": row["title"],
                "mimetype": _safe_get(row, "attachment_mimetype"),
                "size": _safe_get(row, "attachment_size"),
                "download_url": _safe_get(row, "attachment_url"),
                "render_url": None,
                "preview_url": row["preview_url"],
            }
        except Exception:
            att = {
                "id": row["id"],
                "name": _safe_get(row, "attachment_name"),
                "title": row["title"],
                "mimetype": _safe_get(row, "attachment_mimetype"),
                "size": _safe_get(row, "attachment_size"),
                "download_url": _safe_get(row, "attachment_url"),
                "render_url": None,
                "preview_url": row["preview_url"],
            }
        if att and _has_real_content(att):
            attachments.append(att)
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

    # Serienobjekt-Anhänge: Child-IOs unter der Idee (ccm:io_childobject-
    # Aspekt). Ersetzt die alte Geschwister-Sammlungs-Lösung.
    base["attachment_folder"] = None  # Legacy-Feld — Frontend ignoriert es jetzt
    try:
        # Bei kind="io" hängen Children am Knoten selbst; bei kind="collection"
        # hängen sie ebenfalls am Idee-Knoten (= ccm:map). Funktioniert für beide.
        children = await edu_sharing.client.list_child_objects(
            row["id"], auth_header=authorization,
        )
        for n in children:
            a = _attachment_from_node(n)
            a["from_folder"] = True  # Backwards-compat-Flag fürs Frontend
            a["is_child_object"] = True
            attachments.append(a)
    except Exception:
        pass

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
    user = _user_key_from_auth(authorization)
    log.info("rate_idea: user=%s idea=%s rating=%s", user, idea_id, rating)
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
    # Strategie: Write versuchen, dann Read-Back als Wahrheits-Check.
    # edu-sharing wirft bei diesem Endpoint regelmäßig 500er, die je nach
    # Variante entweder Schein-Fehler (Rating IST drin) oder echte
    # Permission-Verweigerungen (Rating NICHT drin) sind:
    #   - `config.values.rating is null` → Schein, drin
    #   - `DAOSecurityException` → echt, nicht drin
    # Wir lassen das Write durchlaufen, schlucken den Fehler erstmal still
    # und vergleichen anschließend Read-Back-Wert mit dem gewünschten Rating.
    write_status: int | None = None
    write_error_text: str | None = None
    try:
        await edu_sharing.client.add_rating(
            target, rating=rating, text=text, auth_header=authorization
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(e.response.status_code, "Anmeldung erforderlich")
        write_status = e.response.status_code
        write_error_text = e.response.text[:200]
    except Exception as e:
        log.info("rate_idea: ES-Write Netzwerkfehler: %s", e)

    # Read-Back mit User-Auth — wahrer Stand
    avg = 0.0
    count = 0
    mine = 0.0
    try:
        meta = await edu_sharing.client.node_metadata(
            target, auth_header=authorization,
        )
        r = (meta.get("node") or {}).get("rating") or {}
        overall = r.get("overall") or {}
        avg = float(overall.get("rating") or 0.0)
        count = int(overall.get("count") or 0)
        mine = float(r.get("user") or 0.0)
    except Exception as e:
        log.warning("rate_idea: Read-Back fehlgeschlagen: %s", e)

    persisted = abs(mine - rating) < 0.01

    if write_status and write_status >= 400 and not persisted:
        # Echter Fehler — der Write ging schief und der Read-Back bestätigt
        # dass nichts persistiert wurde. Das ist meistens eine Permission-
        # Verweigerung (DAOSecurityException) — der User darf die Idee nicht
        # bewerten, z.B. weil sie einer anderen Person gehört und keine
        # Tool-Permission gesetzt ist.
        log.warning(
            "rate_idea: Rating nicht persistiert (HTTP %s): %s",
            write_status, write_error_text,
        )
        if "DAOSecurityException" in (write_error_text or "") or write_status == 403:
            raise HTTPException(
                403,
                "Du darfst diese Idee nicht bewerten. Wende dich an die "
                "Moderation, falls das ein Fehler ist.",
            )
        raise HTTPException(
            502,
            "edu-sharing konnte das Rating nicht speichern. "
            "Bitte später nochmal probieren.",
        )

    # Erfolg (entweder Write 200 oder Schein-500 mit persistiertem Rating)
    if write_status:
        log.info(
            "rate_idea: ES-Write %s ignoriert (Read-Back zeigt mine=%s)",
            write_status, mine,
        )

    # Cache update — best-effort
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass

    return {
        "ok": True,
        "rating": {
            "avg": avg,
            "count": count,
            "mine": mine,
        },
    }


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

    # Submitter-Tracking: bei eingeloggter Einreichung den Caller-Username
    # als Keyword anhängen, damit "Meine Ideen" und Edit-Gating zuordnen können.
    submitter = _user_key_from_auth(authorization) if authorization else None
    if submitter and not any(
        k.lower().startswith("submitter:") for k in kws
    ):
        kws.append(f"submitter:{submitter}")

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
    # Pflicht-Metadaten für die WLO-Freischaltung. Ohne diese Felder flaggt
    # die Redaktionsmaske die Idee als "unvollständig". Wir setzen WLO-übliche
    # Defaults, damit die Idee out-of-the-box freischaltbar ist:
    #   - Lizenz: CC BY 4.0 (WLO-Standard für OER-Beiträge)
    #   - Sprache: Deutsch
    #   - Replikations-Quelle: kennzeichnet den App-Ursprung
    # Diese Defaults können später im Repo geändert werden.
    props.setdefault("ccm:commonlicense_key", ["CC_BY"])
    props.setdefault("ccm:commonlicense_cc_version", ["4.0"])
    props.setdefault("cclom:general_language", ["de"])
    props.setdefault("ccm:replicationsource", ["hackathoern-ideendatenbank"])

    # Strategie:
    # - Eingeloggte User schreiben mit IHRER Auth direkt in die Community-Inbox
    #   (sie sind Mitglied der HackathOERn-Gruppe, die dort Collaborator-Rechte
    #   geerbt hat). Dadurch werden sie selbst der ES-Creator und können ihre
    #   Idee auch nach einem Move durch Mods weiter bearbeiten/löschen.
    # - Anonyme Submits laufen über den Guest (WLO-Upload), der direkt
    #   Collaborator auf der Inbox hat.
    # Kein Fallback eingeloggt → Guest, weil das den Owner-Tausch maskieren
    # würde. Fehler bleibt Fehler — der User merkt, dass etwas mit seinem
    # Account-Setup nicht stimmt.
    try:
        result = await edu_sharing.client.create_node(
            parent_id=settings.edu_guest_inbox_id,
            node_type="ccm:io",
            properties=props,
            auth_header=authorization,  # None bei Anonym → Guest-Fallback im Client
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(
                403,
                "Keine Berechtigung, eine Idee anzulegen. Vermutlich fehlt "
                "die Mitgliedschaft in der HackathOERn-Gruppe — bitte beim "
                "Moderationsteam melden.",
            )
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
            "Das Team prüft sie und sortiert sie in den passenden Bereich ein."
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

    # Originals, die bereits als Reference in einer Sammlung referenziert
    # werden, raus aus dem Postfach: ihre IDs stehen in idea.original_id.
    # Sonst tauchen alte Ideen-Originale (mit phase:/event:-Marker, weil
    # sie über den Reference-Knoten gepflegt wurden) im Postfach auf.
    with connect() as con:
        cataloged = {
            r["original_id"]
            for r in con.execute(
                "SELECT original_id FROM idea WHERE original_id IS NOT NULL"
            ).fetchall()
            if r["original_id"]
        }

    items = []
    for n in raw_nodes:
        if n.get("type") != "ccm:io":
            continue
        node_id = (n.get("ref") or {}).get("id")
        if node_id and node_id in cataloged:
            # Schon einsortiert — gehört nicht ins Postfach
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
        with connect() as con:
            row = con.execute(
                "SELECT preview_url FROM idea WHERE id=?", (idea_id,),
            ).fetchone()
            if row and row["preview_url"]:
                from datetime import datetime
                bust = int(datetime.now(UTC).timestamp())
                sep = '&' if '?' in row["preview_url"] else '?'
                new_url = f"{row['preview_url']}{sep}cb={bust}"
                # Cache-Buster nur, wenn nicht bereits via Sync gesetzt
                if "modified=" not in row["preview_url"]:
                    con.execute(
                        "UPDATE idea SET preview_url=? WHERE id=?",
                        (new_url, idea_id),
                    )
    except Exception as e:
        log.debug("upload_idea_preview: Cache-Buster fehlgeschlagen: %s", e)
    return {"ok": True}


class MoveRequest(BaseModel):
    node_id: str
    target_topic_id: str


class BulkMoveRequest(BaseModel):
    node_ids: list[str] = Field(..., min_length=1, max_length=50)
    target_topic_id: str


async def _move_or_reference(
    source_id: str, target_topic_id: str, *, authorization: str,
) -> tuple[str, str | None]:
    """Hängt eine Inbox-Idee an eine Ziel-Sammlung. Versucht zuerst die
    HackathOERn-Standardvorgehensweise (Reference: Original bleibt in
    Inbox, Sammlung kriegt einen Reference-Knoten). Wenn ES das wegen
    Tool-Permission/ACL ablehnt (403/500), fällt auf das alte Verhalten
    zurück (`_move`: Knoten wird relocated, wird zu Direct-Child).
    Der Sync findet beide Varianten (siehe sync.py).

    Returns: (mode, ref_or_node_id) — mode ist 'reference' oder 'move'.
    Wirft den ursprünglichen httpx-Error weiter, wenn beide Wege fehlschlagen.
    """
    # 1. Reference-Pfad — saubere Standard-Variante
    try:
        result = await edu_sharing.client.add_collection_reference(
            collection_id=target_topic_id,
            node_id=source_id,
            auth_header=authorization,
        )
        ref_node = (result or {}).get("node") or {}
        ref_id = (ref_node.get("ref") or {}).get("id")
        if ref_id:
            try:
                with connect() as con:
                    await sync_mod._upsert_idea(
                        con, ref_node,
                        kind="io",
                        topic_id=target_topic_id,
                        main_content_id=ref_id,
                    )
            except Exception as e:
                log.warning("upsert nach addReference für %s: %s", ref_id, e)
            return ("reference", ref_id)
    except httpx.HTTPStatusError as e:
        # 403/500/405 → kein Reference-Recht. Versuche _move als Fallback.
        if e.response.status_code not in (403, 405, 500):
            raise
        log.info(
            "addReference verwehrt (%s) für %s → fallback auf _move",
            e.response.status_code, source_id,
        )

    # 2. Fallback: echtes Move (Direct-Child der Challenge)
    await edu_sharing.client.move_node(
        source_id=source_id,
        target_parent_id=target_topic_id,
        auth_header=authorization,
    )
    # Cache: refresh_idea liest neue parent.id aus ES und schreibt sie ins
    # idea-Row. topic_id wird damit korrekt gesetzt.
    try:
        await sync_mod.refresh_idea(source_id, auth_header=authorization)
    except Exception:
        pass
    return ("move", source_id)


@router.post("/moderation/bulk_move", tags=["moderation"])
async def bulk_move_to_topic(
    body: BulkMoveRequest,
    authorization: str | None = Header(None),
):
    """Hängt mehrere Inbox-Ideen an eine Ziel-Herausforderung.

    Bevorzugt das **Reference**-Pattern (Original in Inbox, Reference in
    Sammlung — HackathOERn-Standard). Bei fehlender Tool-Permission
    fallback auf **Move** (Direct-Child der Sammlung). Beide Patterns
    werden vom Sync erkannt.

    Pro-Item-Fehler werden gesammelt; der Gesamtaufruf bricht nicht ab.
    """
    await _require_moderator(authorization)
    with connect() as con:
        t = con.execute(
            "SELECT id,title FROM topic WHERE id = ?", (body.target_topic_id,)
        ).fetchone()
    if not t:
        raise HTTPException(404, f"Unknown target topic {body.target_topic_id}")

    succeeded: list[str] = []
    failed: list[dict] = []
    modes: dict[str, int] = {"reference": 0, "move": 0}
    for nid in body.node_ids:
        try:
            mode, new_id = await _move_or_reference(
                nid, body.target_topic_id, authorization=authorization,
            )
        except httpx.HTTPStatusError as e:
            failed.append({"id": nid, "status": e.response.status_code,
                           "detail": e.response.text[:160]})
            continue
        except Exception as e:
            failed.append({"id": nid, "status": 0, "detail": str(e)[:160]})
            continue
        modes[mode] = modes.get(mode, 0) + 1
        # Titel für Log (aus Cache nach Upsert/Refresh)
        with connect() as con:
            r = con.execute(
                "SELECT title FROM idea WHERE id=? OR original_id=?",
                (new_id, nid),
            ).fetchone()
            moved_title = r["title"] if r else None
        _log_activity(
            action="idea_moved", authorization=authorization, is_mod=True,
            target_type="idea", target_id=nid, target_label=moved_title,
            detail={"to_topic_id": body.target_topic_id,
                    "to_topic_title": t["title"],
                    "mode": mode, "result_id": new_id,
                    "bulk": True},
        )
        succeeded.append(nid)

    return {
        "ok": len(failed) == 0,
        "moved_to": t["title"],
        "succeeded": succeeded,
        "failed": failed,
        "succeeded_count": len(succeeded),
        "failed_count": len(failed),
        "modes": modes,
    }


@router.post("/moderation/move", tags=["moderation"])
async def move_to_topic(
    body: MoveRequest,
    authorization: str | None = Header(None),
):
    """Hängt eine Inbox-Idee an eine Herausforderung. Versucht zuerst
    den HackathOERn-Standard (Reference: Original bleibt in Inbox), fällt
    bei fehlender Tool-Permission auf das alte Move-Verhalten zurück.
    Caller muss Moderator sein."""
    await _require_moderator(authorization)
    with connect() as con:
        t = con.execute(
            "SELECT id,title FROM topic WHERE id = ?", (body.target_topic_id,)
        ).fetchone()
    if not t:
        raise HTTPException(404, f"Unknown target topic {body.target_topic_id}")

    try:
        mode, new_id = await _move_or_reference(
            body.node_id, body.target_topic_id, authorization=authorization,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code,
            f"edu-sharing: {e.response.text[:200]}",
        )

    # Titel für Log
    moved_title = None
    with connect() as con:
        r = con.execute(
            "SELECT title FROM idea WHERE id=? OR original_id=?",
            (new_id, body.node_id),
        ).fetchone()
        moved_title = r["title"] if r else None
    _log_activity(
        action="idea_moved",
        authorization=authorization, is_mod=True,
        target_type="idea", target_id=body.node_id, target_label=moved_title,
        detail={"to_topic_id": body.target_topic_id, "to_topic_title": t["title"],
                "mode": mode, "result_id": new_id},
    )

    return {"ok": True, "moved_to": t["title"], "mode": mode, "result_id": new_id}


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
            from datetime import datetime
            con.execute(
                f"INSERT INTO {table} (slug,label,description,sort_order,active,"
                f"created_at,created_by) VALUES (?,?,?,?,?,?,?)",
                (body.slug, body.label, body.description, body.sort_order,
                 1 if body.active else 0,
                 datetime.now(UTC).isoformat(), user or "anonymous"),
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
    """Updates the metadata on the underlying ccm:io. App-seitig wird
    geprüft, ob der Caller Owner (Submitter) oder Mod ist — die ES-
    Group-Vererbung gibt sonst jedem HackathOERn-Mitglied Write-Rechte."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")

    allowed, user, is_mod = await _is_owner_or_mod(idea_id, authorization)
    if not allowed:
        raise HTTPException(
            403,
            "Diese Idee gehört nicht dir. Nur der Einreicher oder die "
            "Moderation kann sie bearbeiten.",
        )

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
    # Keywords-Merge: bestehende Keywords aus edu-sharing erhalten,
    # nur phase: und event: gezielt austauschen.
    #
    # Wichtig: edu-sharing's PUT /metadata ÜBERSCHREIBT cclom:general_keyword
    # komplett — wir müssen also die alten Keywords mit-senden, damit z.B.
    # fachliche Tags ("OER", "schule") nicht beim Quick-Edit verloren gehen.
    #
    # Strategie:
    #  - body.keywords explizit mitgeschickt (Edit-Modal): das ist die neue
    #    User-Liste. Wir filtern phase:/event: heraus und tauschen frisch.
    #  - body.keywords NICHT mitgeschickt (Quick-Edit): wir holen die alten
    #    Keywords live aus edu-sharing, behalten alle Nicht-phase/event-Werte
    #    und überschreiben nur phase:/event:-Einträge.
    if (body.keywords is not None or body.phase is not None
            or body.event is not None or body.events is not None):

        if body.keywords is not None:
            base_kws = list(body.keywords)
        else:
            # Quick-Edit: alte Liste live holen, damit Bestand erhalten bleibt
            try:
                cur_meta = await edu_sharing.client.node_metadata(
                    target_node, auth_header=authorization,
                )
                cur_props = (cur_meta.get("node") or {}).get("properties") or {}
                base_kws = list(cur_props.get("cclom:general_keyword") or [])
            except Exception as e:
                log.warning(
                    "edit_idea: alte Keywords nicht lesbar, Bestand könnte verloren gehen: %s",
                    e,
                )
                base_kws = []

        # phase:- und event:-Einträge entfernen, die wir gleich neu setzen
        kws = [
            k for k in base_kws
            if not k.lower().startswith(("phase:", "event:"))
        ]
        if body.phase:
            kws.append(f"phase:{body.phase}")
        # Events: events[] hat Vorrang, sonst legacy event-Feld.
        # Wenn weder events noch event mit-geschickt wurden, bleiben die
        # alten Event-Keywords aus base_kws erhalten — wir müssen sie also
        # zurück-mergen, sonst gehen sie verloren beim Phase-Quick-Edit.
        if body.events is not None or body.event is not None:
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
        else:
            # Alte event:-Einträge behalten
            for k in base_kws:
                if k.lower().startswith("event:"):
                    kws.append(k)

        # Wenn keine Phase im Patch war, alten Phase-Wert behalten
        if body.phase is None:
            for k in base_kws:
                if k.lower().startswith("phase:"):
                    kws.append(k)
                    break

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

    # Read-Back: edu-sharing antwortet bei fehlenden Schreibrechten
    # gelegentlich mit 200 OK, persistiert die Änderungen aber stillschweigend
    # NICHT (silent permission denial). Wir prüfen daher kurz, ob die
    # Properties wirklich angekommen sind. Wenn nicht: harten 403 mit
    # klarer Meldung an den User.
    try:
        verify = await edu_sharing.client.node_metadata(
            target_node, auth_header=authorization,
        )
        live_props = (verify.get("node") or {}).get("properties") or {}
        # Wir prüfen exemplarisch das aussagekräftigste Feld, das die UI ändert:
        if "cclom:general_keyword" in props:
            expected = set(props["cclom:general_keyword"])
            actual = set(live_props.get("cclom:general_keyword") or [])
            if expected and not expected.issubset(actual):
                log.warning(
                    "edit_idea: Properties nicht persistiert für %s "
                    "(Permission?): expected %s, got %s",
                    idea_id, expected, actual,
                )
                raise HTTPException(
                    403,
                    "Du hast keine Schreibrechte für diese Idee. "
                    "Sie gehört einer anderen Person und kann nur von "
                    "ihr oder einem Moderator bearbeitet werden.",
                )
        elif "cm:title" in props and body.title:
            if (live_props.get("cm:title") or [None])[0] != body.title:
                log.warning(
                    "edit_idea: Title nicht persistiert für %s — Permission?",
                    idea_id,
                )
                raise HTTPException(
                    403,
                    "Du hast keine Schreibrechte für diese Idee.",
                )
    except HTTPException:
        raise
    except Exception as e:
        # Read-Back kaputt → nicht blockieren, der Sync zieht später nach
        log.info("edit_idea: Read-Back fehlgeschlagen, trotzdem OK: %s", e)

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
    """Löscht eine Idee. App-seitig wird geprüft, ob der Caller Owner
    (Submitter) oder Mod ist (ES-Group-Vererbung würde sonst jedem
    HackathOERn-Mitglied Delete-Rechte geben)."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")

    allowed, user, is_mod = await _is_owner_or_mod(idea_id, authorization)
    if not allowed:
        raise HTTPException(
            403,
            "Diese Idee gehört nicht dir. Nur der Einreicher oder die "
            "Moderation kann sie löschen.",
        )

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
    *, child_id: str, parent_id: str, authorization: str,
) -> dict:
    """Sicherheits-Check: das Child muss tatsächlich unter dem angegebenen
    Eltern-IO hängen. Verhindert versehentliche Operationen auf fremden
    Knoten. Gibt die Node-Metadaten zurück (für nachfolgenden Code reusable)."""
    try:
        meta = await edu_sharing.client.node_metadata(
            child_id, auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )
    parent = (meta.get("node") or {}).get("parent") or {}
    actual_parent = parent.get("id") or (parent.get("ref") or {}).get("id")
    if actual_parent != parent_id:
        raise HTTPException(
            409,
            "Dieser Anhang gehört nicht zu dieser Idee. "
            "Aus Sicherheitsgründen abgelehnt.",
        )
    return meta


@router.patch("/ideas/{idea_id}/attachments/{attachment_id}", tags=["ideas"])
async def rename_attachment(
    idea_id: str,
    attachment_id: str,
    body: AttachmentRename,
    authorization: str | None = Header(None),
):
    """Benennt einen Anhang um. Sicherheits-Check: Anhang muss Child der
    Idee sein."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    await _verify_child_of(
        child_id=attachment_id, parent_id=idea_id, authorization=authorization,
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
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )
    _log_activity(
        action="attachment_renamed", authorization=authorization,
        target_type="attachment", target_id=attachment_id, target_label=new_name,
        detail={"idea_id": idea_id},
    )
    return {"ok": True, "name": new_name}


@router.delete("/ideas/{idea_id}/attachments/{attachment_id}", tags=["ideas"])
async def delete_attachment(
    idea_id: str,
    attachment_id: str,
    authorization: str | None = Header(None),
):
    """Löscht einen einzelnen Anhang. Sicherheits-Check: Anhang muss Child
    der Idee sein, damit nicht versehentlich fremde Knoten gelöscht werden."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    meta = await _verify_child_of(
        child_id=attachment_id, parent_id=idea_id, authorization=authorization,
    )
    att_props = (meta.get("node") or {}).get("properties") or {}
    att_name = (
        (att_props.get("cm:name") or att_props.get("cclom:title") or [None])[0]
        or "Datei"
    )
    try:
        await edu_sharing.client.delete_node(attachment_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, diesen Anhang zu löschen.")
        if e.response.status_code != 404:
            raise HTTPException(
                e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
            )
    _log_activity(
        action="attachment_deleted",
        authorization=authorization,
        target_type="attachment", target_id=attachment_id, target_label=att_name,
        detail={"idea_id": idea_id},
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
            datetime.now(UTC) - timedelta(days=30)
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

    Zwei Wege, in Reihenfolge:
    1. Username steht in der Bootstrap-Whitelist (env)
    2. User ist Mitglied einer der konfigurierten Mod-Gruppen
       (Default: GROUP_ALFRESCO_ADMINISTRATORS)
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
    return any(g in groups for g in settings.fallback_mod_groups)


async def _is_owner_or_mod(
    idea_id: str, authorization: str | None
) -> tuple[bool, str | None, bool]:
    """Owner-Gating für Idee-Editieren / -Löschen.

    edu-sharing's accessEffective ist hier *nicht* ausreichend: alle
    Mitglieder der HackathOERn-Gruppe haben durch Gruppen-Vererbung Write-
    Rechte auf jeder Idee — und das wäre ein Free-for-all. Stattdessen
    prüfen wir App-seitig:
      1. ist Mod/Admin → ja, alles erlaubt
      2. ist der Caller der originale Submitter (cm:creator oder
         submitter:<user>-Keyword) → ja, eigene Idee
      3. sonst → nein

    Return: (allowed, username, is_mod). username ist None bei fehlender Auth.
    """
    if not authorization:
        return False, None, False
    user = _user_key_from_auth(authorization)
    if not user:
        return False, None, False
    is_mod = await _is_moderator(authorization)
    if is_mod:
        return True, user, True

    # 1. Cache-Check (billig)
    try:
        with connect() as con:
            row = con.execute(
                "SELECT owner_username FROM idea WHERE id=?", (idea_id,),
            ).fetchone()
        if row and row["owner_username"] and row["owner_username"] == user:
            return True, user, False
    except Exception:
        pass

    # 2. Live-Fallback: ES-Metadaten lesen (cm:creator / submitter:-Keyword)
    try:
        meta = await edu_sharing.client.node_metadata(
            idea_id, auth_header=authorization,
        )
        node = (meta or {}).get("node") or {}
        props = node.get("properties") or {}
        creator_field = props.get("cm:creator") or []
        creator = (
            creator_field[0] if isinstance(creator_field, list) and creator_field
            else creator_field if isinstance(creator_field, str) else None
        )
        if creator and creator == user:
            return True, user, False
        kws = props.get("cclom:general_keyword") or []
        if isinstance(kws, str): kws = [kws]
        target = f"submitter:{user}".lower()
        if any(str(k).lower() == target for k in kws):
            return True, user, False
    except Exception as e:
        log.debug("_is_owner_or_mod: ES-fallback failed for %s: %s", idea_id, e)

    return False, user, False


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
        "moderation_groups": settings.fallback_mod_groups,
    }


@router.get("/me/memberships", tags=["me"])
async def my_memberships_debug(authorization: str | None = Header(None)):
    """Diagnose-Endpoint: liefert die rohen Memberships des Callers + die
    konfigurierten Mod-Gruppen, um Mismatch-Probleme aufzudecken."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    try:
        m = await edu_sharing.client.my_memberships(auth_header=authorization)
    except Exception as e:
        raise HTTPException(502, f"edu-sharing memberships-Fehler: {e}")
    groups = [
        {
            "authorityName": g.get("authorityName"),
            "displayName": (g.get("profile") or {}).get("displayName"),
            "groupType":   (g.get("profile") or {}).get("groupType"),
        }
        for g in (m.get("groups") or [])
    ]
    user_groups = {g["authorityName"] for g in groups}
    matched = user_groups & set(settings.fallback_mod_groups)
    user = _user_key_from_auth(authorization)
    bootstrap_match = bool(user and user in settings.bootstrap_mod_users)
    return {
        "username": user,
        "is_moderator": bool(matched) or bootstrap_match,
        "matched_groups": sorted(matched),
        "matched_bootstrap": bootstrap_match,
        "expected_groups": settings.fallback_mod_groups,
        "expected_bootstrap_users": settings.bootstrap_mod_users,
        "groups_count": len(groups),
        "groups": groups,
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


# ===== Anhänge als Child-IO (Serienobjekt-Pattern) ==============
# Frühere Lösung mit Geschwister-Sammlung + `attachment-of:<id>`-Keyword
# wurde abgelöst — siehe ~/.claude/skills/wlo-childobjects/SKILL.md.

@router.post("/ideas/{idea_id}/attachments/upload", tags=["ideas"])
async def upload_attachment(
    idea_id: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Lädt einen Anhang direkt als Child-IO (`ccm:childio` +
    `ccm:io_childobject`-Aspekt) unter die Idee. Erfordert nur Schreibrecht
    am Idee-Knoten — kein separater Sammlungs-Schritt mehr."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Leere Datei")
    filename = file.filename or "upload.bin"
    mimetype = file.content_type or "application/octet-stream"

    # Step 1: Child-IO als Serienobjekt unter der Idee anlegen.
    # Order = aktuelle Anzahl bestehender Children, damit Reihenfolge stabil bleibt.
    try:
        existing = await edu_sharing.client.list_child_objects(
            idea_id, auth_header=authorization,
        )
    except Exception:
        existing = []
    order = len(existing)

    try:
        result = await edu_sharing.client.add_child_object(
            parent_id=idea_id,
            filename=filename,
            order=order,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(
                403, "Keine Berechtigung, an diese Idee Anhänge zu hängen."
            )
        if e.response.status_code == 404:
            raise HTTPException(404, "Idee nicht gefunden")
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )

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
    _log_activity(
        action="attachment_uploaded",
        authorization=authorization,
        target_type="attachment", target_id=new_id, target_label=filename,
        detail={"idea_id": idea_id, "size": len(data), "mimetype": mimetype},
    )
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
            idea_id, auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(404, "Idee nicht gefunden")
        raise HTTPException(
            e.response.status_code, f"edu-sharing: {e.response.text[:200]}"
        )

    items = []
    for n in children:
        ref = n.get("ref") or {}
        props = n.get("properties") or {}
        items.append({
            "node_id": ref.get("id"),
            "name": (props.get("cm:name") or [n.get("name")])[0],
            "mimetype": (props.get("ccm:content-type") or [None])[0]
                        or n.get("mimetype"),
            "size": n.get("size"),
            "created_at": n.get("createdAt"),
            "order": (props.get("ccm:childobject_order") or [None])[0],
            "preview_url": (n.get("preview") or {}).get("url"),
            "render_url": f"{settings.es_render_base}/{ref.get('id')}"
                          if ref.get("id") and getattr(settings, "es_render_base", None)
                          else None,
        })
    return {"items": items, "count": len(items)}


# ===== Moderatoren-Übersicht (read-only) ==========================
# Mitgliedschaften in den Mod-Gruppen werden ausschließlich im
# edu-sharing-Repository selbst verwaltet — diese App liest sie nur
# zur Anzeige aus, um nicht versehentlich globale Admin-Rechte zu
# erteilen oder zu entziehen.

@router.get("/admin/moderators", tags=["moderation"])
async def list_moderators(authorization: str | None = Header(None)):
    """Mitglieder aller konfigurierten Mod-Gruppen + Bootstrap-User."""
    await _require_moderator(authorization)
    members: list[dict] = []
    seen: set[str] = set()
    group_results: list[dict] = []
    for group_name in settings.fallback_mod_groups:
        ok = True
        error: str | None = None
        try:
            m = await edu_sharing.client.group_members(
                group_name, auth_header=authorization
            )
        except httpx.HTTPStatusError as e:
            ok = False
            if e.response.status_code == 404:
                error = "Gruppe nicht gefunden"
                m = {}
            else:
                error = f"HTTP {e.response.status_code}"
                m = {}
        except Exception as e:
            ok = False
            error = str(e)
            m = {}

        added = 0
        for p in (m.get("persons") or m.get("authorities") or m.get("members") or []):
            uname = p.get("authorityName") or p.get("userName")
            key = (uname or "").lower()
            if not uname or key in seen:
                continue
            seen.add(key)
            profile = p.get("profile") or {}
            members.append({
                "username": uname,
                "first_name": profile.get("firstName"),
                "last_name": profile.get("lastName"),
                "email": profile.get("email") or p.get("mailbox"),
                "source": group_name,
            })
            added += 1
        group_results.append({
            "group": group_name, "ok": ok, "error": error, "count": added,
        })

    # Bootstrap-User aus ENV anhängen (sofern nicht bereits in einer Gruppe)
    for u in settings.bootstrap_mod_users:
        if u.lower() not in seen:
            members.append({"username": u, "source": "bootstrap"})

    return {
        "groups": settings.fallback_mod_groups,
        "group_status": group_results,
        "count": len(members),
        "members": members,
        "managed_externally": True,
    }


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


# ===== Kommentar löschen (Owner + Mod) ============================

@router.delete("/comments/{comment_id}", tags=["ideas"])
async def delete_comment(
    comment_id: str,
    idea_id: str | None = Query(None),
    authorization: str | None = Header(None),
):
    """Löscht einen Kommentar. Erlaubt für (a) Kommentar-Autor selbst,
    (b) Moderator. edu-sharing prüft Schreibrecht auf dem Kommentar-Knoten,
    aber wir gating das auch app-seitig: ohne Auth direkt 401."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    me = _user_key_from_auth(authorization)
    is_mod = await _is_moderator(authorization)

    # Owner-Check: edu-sharing-Comment-API hat creator-Authority. Wir lesen
    # die Kommentar-Liste der Idee (sofern idea_id mit) und matchen den
    # ref.id. Bei is_mod überspringen wir die Owner-Prüfung.
    author_match = is_mod
    if not is_mod and idea_id:
        try:
            with connect() as con:
                row = con.execute(
                    "SELECT main_content_id,id FROM idea WHERE id=?", (idea_id,),
                ).fetchone()
            if row:
                target = row["main_content_id"] or row["id"]
                cm = await edu_sharing.client.comments(target, auth_header=authorization)
                for c in (cm or {}).get("comments") or []:
                    ref_id = ((c.get("ref") or {}).get("id"))
                    if ref_id == comment_id:
                        creator = ((c.get("creator") or {}).get("authorityName") or "").lower()
                        if creator and me and creator == me.lower():
                            author_match = True
                        break
        except Exception as e:
            log.debug("delete_comment: Owner-Check fehlgeschlagen: %s", e)

    if not author_match:
        raise HTTPException(403, "Nur Autor:in oder Moderation kann Kommentare löschen.")

    try:
        await edu_sharing.client.delete_comment(comment_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    # comment_count refreshen
    if idea_id:
        try:
            await sync_mod.refresh_idea(idea_id, auth_header=authorization)
        except Exception:
            pass
    _log_activity(
        action="comment_deleted",
        authorization=authorization, is_mod=is_mod,
        target_type="idea", target_id=idea_id or "",
        detail={"comment_id": comment_id},
    )
    return {"ok": True}


# ===== Phasen-Historie einer Idee =================================

@router.get("/ideas/{idea_id}/phase-history", tags=["ideas"])
async def idea_phase_history(
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Liefert die Liste aller Phase-Wechsel zu einer Idee aus dem
    Activity-Log. Für versteckte Ideen wird non-mod ein 404 geliefert,
    damit die Phase-Wechsel nicht über die Hintertür sichtbar werden."""
    with connect() as con:
        idea_row = con.execute(
            "SELECT hidden FROM idea WHERE id=?", (idea_id,),
        ).fetchone()
    if idea_row and idea_row["hidden"] and not await _is_moderator(authorization):
        raise HTTPException(404, "Idea not found")
    with connect() as con:
        rows = con.execute(
            """SELECT ts, actor, detail FROM activity_log
                WHERE target_id = ? AND action = 'phase_changed'
                ORDER BY ts ASC""",
            (idea_id,),
        ).fetchall()
    items = []
    for r in rows:
        d = {"ts": r["ts"], "actor": r["actor"], "from": None, "to": None}
        if r["detail"]:
            try:
                dd = json.loads(r["detail"])
                d["from"] = dd.get("from")
                d["to"] = dd.get("to")
            except Exception:
                pass
        items.append(d)
    return {"count": len(items), "items": items}


# ===== Reports — Status für den Reporter ==========================

@router.get("/me/reports", tags=["me"])
def my_reports(authorization: str | None = Header(None)):
    """Liste der eigenen Meldungen + Status (offen/erledigt)."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    me = _user_key_from_auth(authorization)
    if not me:
        raise HTTPException(401, "Username konnte nicht ermittelt werden")
    with connect() as con:
        # Versteckte Ideen sollen nicht über die User-Reports-Liste
        # leaken — sobald eine Idee durch Moderation entfernt wurde,
        # blenden wir den Titel aus und geben nur den Idee-Status zurück.
        rows = con.execute(
            """SELECT r.id, r.idea_id, r.reason, r.created_at, r.resolved_at,
                       CASE WHEN i.hidden = 1 THEN NULL ELSE i.title END AS idea_title,
                       COALESCE(i.hidden, 0) AS idea_hidden
                  FROM idea_report r
                  LEFT JOIN idea i ON i.id = r.idea_id
                 WHERE r.reporter = ?
                 ORDER BY r.created_at DESC LIMIT 200""",
            (me,),
        ).fetchall()
    return {"count": len(rows), "items": [dict(r) for r in rows]}


@router.get("/ideas/{idea_id}/report-status", tags=["ideas"])
def idea_report_status(idea_id: str, authorization: str | None = Header(None)):
    """Zeigt dem eingeloggten User, ob er die Idee bereits gemeldet hat
    (verhindert Doppel-Meldungen, zeigt Status im UI)."""
    if not authorization:
        return {"reported": False}
    me = _user_key_from_auth(authorization)
    if not me:
        return {"reported": False}
    with connect() as con:
        row = con.execute(
            """SELECT id, created_at, resolved_at FROM idea_report
                WHERE idea_id = ? AND reporter = ?
                ORDER BY created_at DESC LIMIT 1""",
            (idea_id, me),
        ).fetchone()
    if not row:
        return {"reported": False}
    return {
        "reported": True,
        "created_at": row["created_at"],
        "resolved_at": row["resolved_at"],
        "status": "resolved" if row["resolved_at"] else "open",
    }


@router.post("/admin/reports/bulk-resolve", tags=["moderation"])
async def bulk_resolve_reports(
    body: dict,
    authorization: str | None = Header(None),
):
    """Mehrere Reports auf einmal erledigen. Body: { ids: [int,...] }"""
    await _require_moderator(authorization)
    raw = body.get("ids") or []
    if not isinstance(raw, list) or not raw:
        raise HTTPException(400, "Liste 'ids' erforderlich")
    # Strikte Validierung: nur Integers ≥1. Schützt gegen Strings,
    # Floats, gemischte Arrays oder Manipulationsversuche.
    safe_ids: list[int] = []
    for x in raw:
        try:
            n = int(x)
            if n >= 1:
                safe_ids.append(n)
        except (TypeError, ValueError):
            continue
    if not safe_ids:
        raise HTTPException(400, "Keine validen Integer-IDs in 'ids'")
    now = sync_mod._iso_now()
    with connect() as con:
        placeholders = ",".join("?" * len(safe_ids))
        con.execute(
            f"UPDATE idea_report SET resolved_at = ? WHERE id IN ({placeholders}) "
            f"AND resolved_at IS NULL",
            (now, *safe_ids),
        )
    _log_activity(
        action="reports_bulk_resolved",
        authorization=authorization, is_mod=True,
        target_type="report",
        detail={"count": len(safe_ids), "ids": safe_ids[:50]},
    )
    return {"ok": True, "count": len(safe_ids)}


# ===== Ranking-Trend: Top-Steiger der letzten 7 Tage ==============

@router.get("/ranking/risers", tags=["ranking"])
def ranking_risers(
    sort: Literal["rating", "comments", "interest"] = "rating",
    event: str | None = None,
    days: int = Query(7, ge=1, le=90),
    limit: int = Query(5, ge=1, le=20),
):
    """Vergleicht den jüngsten Snapshot mit einem ~N-Tage-alten Snapshot
    und liefert die Ideen mit der größten Rangverbesserung (kleinerer
    Rang = besser). Für die Ranking-Seite als „Top-Steiger"-Sektion."""
    ev = event or ""
    with connect() as con:
        # Jüngsten Snapshot bestimmen
        latest = con.execute(
            "SELECT MAX(snapshot_at) FROM ranking_snapshot WHERE event=? AND sort=?",
            (ev, sort),
        ).fetchone()[0]
        if not latest:
            return {"count": 0, "items": []}
        # Snapshot N Tage zuvor (oder den ältesten verfügbaren)
        cutoff_target = con.execute(
            "SELECT datetime(?, ?)", (latest, f"-{days} days"),
        ).fetchone()[0]
        prev = con.execute(
            """SELECT snapshot_at FROM ranking_snapshot
                WHERE event=? AND sort=? AND snapshot_at <= ?
                ORDER BY snapshot_at DESC LIMIT 1""",
            (ev, sort, cutoff_target),
        ).fetchone()
        if not prev:
            # Fallback: ältester Snapshot überhaupt
            prev = con.execute(
                """SELECT snapshot_at FROM ranking_snapshot
                    WHERE event=? AND sort=? AND snapshot_at < ?
                    ORDER BY snapshot_at ASC LIMIT 1""",
                (ev, sort, latest),
            ).fetchone()
        if not prev or prev["snapshot_at"] == latest:
            return {"count": 0, "items": [], "latest": latest, "previous": None}

        prev_at = prev["snapshot_at"]
        rows = con.execute(
            """SELECT cur.idea_id,
                      cur.rank AS rank,
                      prev.rank AS prev_rank,
                      (prev.rank - cur.rank) AS delta,
                      cur.score AS score,
                      i.title, i.description, i.preview_url, i.author,
                      i.phase, i.events, i.hidden
                 FROM ranking_snapshot cur
                 JOIN ranking_snapshot prev
                   ON prev.idea_id = cur.idea_id
                  AND prev.event = cur.event AND prev.sort = cur.sort
                  AND prev.snapshot_at = ?
                 LEFT JOIN idea i ON i.id = cur.idea_id
                WHERE cur.event = ? AND cur.sort = ?
                  AND cur.snapshot_at = ?
                  AND (i.hidden IS NULL OR i.hidden = 0)
                ORDER BY (prev.rank - cur.rank) DESC, cur.rank ASC
                LIMIT ?""",
            (prev_at, ev, sort, latest, limit),
        ).fetchall()

    items = []
    for r in rows:
        if (r["delta"] or 0) <= 0:
            continue
        items.append({
            "idea_id": r["idea_id"],
            "title": r["title"],
            "description": r["description"],
            "preview_url": r["preview_url"],
            "author": r["author"],
            "phase": r["phase"],
            "events": json.loads(r["events"] or "[]"),
            "rank": r["rank"],
            "prev_rank": r["prev_rank"],
            "delta": r["delta"],
            "score": r["score"],
        })
    return {
        "count": len(items),
        "items": items,
        "latest": latest,
        "previous": prev_at,
        "sort": sort,
        "event": event,
    }


# ===== Öffentliches User-Profil ====================================

@router.get("/users/{username}", tags=["users"])
def public_user_profile(username: str):
    """Öffentliches Profil — listet die Ideen eines Users + Aggregat-Stats.
    Keine private Information (Mitmachen/Folgen anderer Ideen, eigene
    Meldungen) — die liegen unter /me/*."""
    uname = (username or "").strip()
    if not uname:
        raise HTTPException(400, "Username erforderlich")
    with connect() as con:
        rows = con.execute(
            """SELECT * FROM idea
                WHERE owner_username = ?
                  AND COALESCE(hidden,0) = 0
                ORDER BY modified_at DESC""",
            (uname,),
        ).fetchall()
        # Aggregat: Anzahl Kommentare + Bewertungen gesamt
        agg = con.execute(
            """SELECT
                 COUNT(*) AS ideas,
                 COALESCE(SUM(comment_count),0) AS comments,
                 COALESCE(SUM(rating_count),0) AS ratings,
                 COALESCE(AVG(NULLIF(rating_avg,0)),0) AS avg_rating
                FROM idea WHERE owner_username = ?
                  AND COALESCE(hidden,0) = 0""",
            (uname,),
        ).fetchone()
        # Letzte Aktivität
        last_act = con.execute(
            "SELECT MAX(modified_at) FROM idea WHERE owner_username = ?",
            (uname,),
        ).fetchone()[0]
    if not rows and not last_act:
        raise HTTPException(404, "Kein öffentliches Profil vorhanden")
    return {
        "username": uname,
        "stats": {
            "ideas": agg["ideas"],
            "comments": agg["comments"],
            "ratings": agg["ratings"],
            "avg_rating": round(float(agg["avg_rating"] or 0.0), 2),
        },
        "last_activity": last_act,
        "ideas": [_row_to_idea(r) for r in rows],
    }


# ===== Hidden-Verwaltung (Mod-only) ===============================

@router.get("/admin/hidden-ideas", tags=["moderation"])
async def list_hidden_ideas(authorization: str | None = Header(None)):
    """Liste der versteckten Ideen — für den Mod-Tab „Versteckt"."""
    await _require_moderator(authorization)
    with connect() as con:
        rows = con.execute(
            """SELECT id, title, owner_username, hidden_reason, modified_at
                 FROM idea WHERE hidden = 1
                ORDER BY modified_at DESC LIMIT 500"""
        ).fetchall()
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
    with connect() as con:
        row = con.execute(
            "SELECT title FROM idea WHERE id=?", (idea_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Idee nicht gefunden")
        con.execute(
            "UPDATE idea SET hidden = 1, hidden_reason = ? WHERE id=?",
            (reason, idea_id),
        )
    _log_activity(
        action="idea_hidden",
        authorization=authorization, is_mod=True,
        target_type="idea", target_id=idea_id, target_label=row["title"],
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
    with connect() as con:
        row = con.execute(
            "SELECT title FROM idea WHERE id=?", (idea_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Idee nicht gefunden")
        con.execute(
            "UPDATE idea SET hidden = 0, hidden_reason = NULL WHERE id=?",
            (idea_id,),
        )
    _log_activity(
        action="idea_unhidden",
        authorization=authorization, is_mod=True,
        target_type="idea", target_id=idea_id, target_label=row["title"],
    )
    return {"ok": True}


# ===== Notification-Cursor — "neu seit letztem Besuch" =============

@router.get("/me/notifications/unseen", tags=["me"])
def my_notifications_unseen(authorization: str | None = Header(None)):
    """Anzahl der Feed-Items, die seit dem letzten /me/notifications/seen-
    Call aufgetreten sind. Für die Badge im User-Menü / Profil-Tab."""
    if not authorization:
        return {"count": 0}
    me = _user_key_from_auth(authorization)
    if not me:
        return {"count": 0}
    with connect() as con:
        seen_row = con.execute(
            "SELECT last_seen FROM user_feed_seen WHERE user_key=?", (me,),
        ).fetchone()
        last_seen = seen_row["last_seen"] if seen_row else "1970-01-01T00:00:00Z"

        # Relevante Idea-IDs (gefolgt + mitmachen + eigene)
        idea_ids = {
            r["idea_id"] for r in con.execute(
                "SELECT idea_id FROM idea_interaction "
                "WHERE user_key=? AND kind IN ('follow','interest')", (me,),
            ).fetchall()
        }
        for r in con.execute(
            "SELECT id FROM idea WHERE owner_username=?", (me,),
        ).fetchall():
            idea_ids.add(r["id"])
        if not idea_ids:
            return {"count": 0, "last_seen": last_seen}

        # SQLites Default-Parameter-Limit liegt bei 999. Wer >900 Ideen
        # gefolgt/eigen hat, würde sonst eine `too many SQL variables`-
        # Exception bekommen. Wir chunken auf 800er-Blöcke und summieren.
        idea_list = list(idea_ids)
        CHUNK = 800
        count = 0
        for start in range(0, len(idea_list), CHUNK):
            chunk = idea_list[start : start + CHUNK]
            placeholders = ",".join("?" * len(chunk))
            count += con.execute(
                f"SELECT COUNT(*) FROM activity_log "
                f"WHERE target_id IN ({placeholders}) "
                f"  AND ts > ? AND COALESCE(actor,'') <> ?",
                (*chunk, last_seen, me),
            ).fetchone()[0]
    return {"count": count, "last_seen": last_seen}


@router.post("/me/notifications/seen", tags=["me"])
def mark_notifications_seen(authorization: str | None = Header(None)):
    """Setzt den Notification-Cursor auf jetzt — alle weiter zurückliegenden
    Feed-Items gelten als „gelesen"."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    me = _user_key_from_auth(authorization)
    if not me:
        raise HTTPException(401, "Username unbekannt")
    now = sync_mod._iso_now()
    with connect() as con:
        con.execute(
            "INSERT OR REPLACE INTO user_feed_seen (user_key, last_seen) "
            "VALUES (?, ?)", (me, now),
        )
    return {"ok": True, "last_seen": now}


# ===== Idee aus edu-sharing nachladen ============================

@router.post("/ideas/{idea_id}/refresh", tags=["ideas"])
async def manual_refresh_idea(
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Holt die Idee live aus edu-sharing und aktualisiert den App-Cache.
    Wird gebraucht, wenn ein User im Repo direkt etwas geändert hat
    (z.B. neues Vorschaubild) und nicht auf den 5-Minuten-Sync warten will.
    Owner + Mod dürfen refreshen — für anonyme Besucher ist's gesperrt,
    um Spam-Refresh-Last vom Repo abzuhalten."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    allowed, _user, _is_mod = await _is_owner_or_mod(idea_id, authorization)
    if not allowed:
        raise HTTPException(403, "Nur Eigentümer oder Mod dürfen refreshen.")
    ok = await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    if not ok:
        raise HTTPException(502, "Refresh fehlgeschlagen — Knoten unbekannt oder edu-sharing nicht erreichbar.")
    return {"ok": True}


# ===== Bestehende Ideen nachpflegen: Pflicht-Metadaten für Freischaltung ====

def _missing_publication_fields(cur_props: dict) -> dict[str, list[str]]:
    """Welche der WLO-Freischaltungs-Pflichtfelder fehlen am Knoten?
    Liefert ein dict mit Defaults nur für die fehlenden Felder — wird
    von Single- und Bulk-Backfill verwendet."""
    add: dict[str, list[str]] = {}
    if not cur_props.get("ccm:commonlicense_key"):
        add["ccm:commonlicense_key"] = ["CC_BY"]
    if not cur_props.get("ccm:commonlicense_cc_version"):
        add["ccm:commonlicense_cc_version"] = ["4.0"]
    if not cur_props.get("cclom:general_language"):
        add["cclom:general_language"] = ["de"]
    if not cur_props.get("ccm:replicationsource"):
        add["ccm:replicationsource"] = ["hackathoern-ideendatenbank"]
    return add


@router.post("/admin/ideas/{idea_id}/backfill-publication-meta", tags=["moderation"])
async def backfill_publication_meta(
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Setzt Lizenz/Sprache/Replikations-Quelle nach, falls fehlend.
    Pro Idee einzeln aufrufbar; ändert nur fehlende Felder."""
    await _require_moderator(authorization)
    with connect() as con:
        row = con.execute(
            "SELECT main_content_id, id, title FROM idea WHERE id=?", (idea_id,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Idee nicht gefunden")
    target = row["main_content_id"] or row["id"]
    try:
        meta = await edu_sharing.client.node_metadata(target, auth_header=authorization)
        cur = (meta.get("node") or {}).get("properties") or {}
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    add = _missing_publication_fields(cur)
    if not add:
        return {"ok": True, "changed": False, "fields": []}

    try:
        await edu_sharing.client.update_metadata(
            target, add, auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    _log_activity(
        action="publication_meta_backfilled",
        authorization=authorization, is_mod=True,
        target_type="idea", target_id=idea_id, target_label=row["title"],
        detail={"fields": list(add.keys())},
    )
    return {"ok": True, "changed": True, "fields": list(add.keys())}


@router.post("/admin/ideas/backfill-publication-meta", tags=["moderation"])
async def backfill_publication_meta_all(
    limit: int = Query(50, ge=1, le=500),
    authorization: str | None = Header(None),
):
    """Bulk-Variante: läuft über alle Ideen und ergänzt fehlende Pflicht-
    Metadaten. Per-Item-Fehler werden gesammelt; der Lauf bricht nicht ab."""
    await _require_moderator(authorization)
    with connect() as con:
        rows = con.execute(
            "SELECT id, main_content_id, title FROM idea "
            "WHERE COALESCE(hidden,0)=0 ORDER BY modified_at DESC LIMIT ?",
            (limit,),
        ).fetchall()

    processed = 0
    updated = 0
    errors: list[dict] = []
    for r in rows:
        target = r["main_content_id"] or r["id"]
        try:
            meta = await edu_sharing.client.node_metadata(
                target, auth_header=authorization,
            )
            cur = (meta.get("node") or {}).get("properties") or {}
            add = _missing_publication_fields(cur)
            if add:
                await edu_sharing.client.update_metadata(
                    target, add, auth_header=authorization,
                )
                updated += 1
                try:
                    await sync_mod.refresh_idea(r["id"], auth_header=authorization)
                except Exception:
                    pass
            processed += 1
        except Exception as e:
            errors.append({"id": r["id"], "title": r["title"], "error": str(e)[:200]})
    _log_activity(
        action="publication_meta_bulk_backfilled",
        authorization=authorization, is_mod=True,
        target_type="idea",
        detail={"processed": processed, "updated": updated,
                "error_count": len(errors)},
    )
    return {"ok": True, "processed": processed, "updated": updated,
            "errors": errors[:20]}


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
