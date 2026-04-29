"""Sync job: walk root → topics → challenges → ideas, mirror into SQLite.

Structure (matches current HackathOERn-Ideensammlung, Stand 2026-04):
  Root (ccm:map)
    Topic (ccm:map)                   -> topic.parent_id = NULL          (11×)
      Challenge (ccm:map)             -> topic.parent_id = topic.id
        Idea (ccm:io)                 -> idea.kind = 'io', topic_id = challenge
        Anhänge-Sammlung (ccm:map)    -> Geschwister, Keyword `attachment-of:<idea-id>`,
                                         wird an die Idee gehängt — keine eigene Idee.

Eine Idee ist immer ein ccm:io. Sammlungen sind ausschließlich Hierarchie
(Themen/Herausforderungen) oder Anhänge-Container.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from . import edu_sharing
from .db import connect

log = logging.getLogger(__name__)

# Verhindert, dass Lifespan-Loop und manueller `POST /admin/sync` parallel
# laufen und die SQLite mit „database is locked" abschießen.
_sync_lock = asyncio.Lock()

# Mindestabstand zwischen zwei Trend-Snapshots — verhindert, dass das 30er-
# Limit der ranking_snapshot-Tabelle bei 5-min-Sync nach 2.5h voll ist.
SNAPSHOT_MIN_INTERVAL = timedelta(hours=1)
PHASE_PREFIX = "phase:"
EVENT_PREFIX = "event:"
TOPIC_PREFIX = "topic:"


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _props(node: dict) -> dict:
    return node.get("properties") or {}


def _first(props: dict, key: str) -> str | None:
    v = props.get(key)
    if isinstance(v, list):
        return v[0] if v else None
    return v


def _keywords(props: dict) -> list[str]:
    v = props.get("cclom:general_keyword") or []
    if isinstance(v, str):
        v = [v]
    return [str(x) for x in v]


def _classify_keywords(kws: list[str]) -> tuple[str | None, list[str], list[str], list[str]]:
    """Split keywords into (phase, events, categories, other)."""
    phase: str | None = None
    events: list[str] = []
    categories: list[str] = []
    other: list[str] = []
    for k in kws:
        lk = k.strip()
        if lk.lower().startswith(PHASE_PREFIX):
            phase = lk[len(PHASE_PREFIX):]
        elif lk.lower().startswith(EVENT_PREFIX):
            events.append(lk[len(EVENT_PREFIX):])
        elif lk.lower().startswith(TOPIC_PREFIX):
            categories.append(lk[len(TOPIC_PREFIX):])
        else:
            other.append(lk)
    return phase, events, categories, other


_EVENT_TITLE_RE = re.compile(r"HackathOERn?\s*#?\s*(\d+)", re.IGNORECASE)


def _infer_event_from_title(title: str) -> str | None:
    """Heuristic: pick up "HackathOERn N" references in the title and emit a
    SLUG that matches the curated taxonomy convention (e.g., `hackathoern-1`).

    This is a transitional helper for Bestands-Daten ohne `event:`-Keyword.
    Sobald Moderator:innen die Idee einmal über den Edit-Dialog speichern,
    wird ein echter Slug ins `cclom:general_keyword` geschrieben — danach
    greift dieser Fallback nicht mehr. Mittelfristig ganz entfernen.
    """
    if not title:
        return None
    m = _EVENT_TITLE_RE.search(title)
    return f"hackathoern-{m.group(1)}" if m else None


def _rating(node: dict) -> tuple[float, int]:
    r = node.get("rating") or {}
    overall = r.get("overall") or {}
    return float(overall.get("rating") or 0.0), int(overall.get("count") or 0)


def _preview(node: dict) -> str | None:
    p = node.get("preview") or {}
    if p.get("isIcon"):
        return None
    return p.get("url")


async def _pick_main_content(collection_id: str) -> str | None:
    """Find the primary ccm:io for a collection-idea (for rating/comments).
    Rule: first reference (ccm:io), else first ccm:io among children."""
    try:
        refs = await edu_sharing.client.collection_references(collection_id, max_items=5)
        for r in (refs.get("references") or []):
            rid = (r.get("ref") or {}).get("id")
            if rid:
                return rid
    except Exception as e:
        log.warning("refs failed for %s: %s", collection_id, e)
    return None


def _comment_count_from_node(node: dict) -> int:
    """Prefer the commentCount field on the node (cheap), fall back to 0.
    Node metadata on redaktion.openeduhub.net exposes this directly.
    """
    v = node.get("commentCount")
    try:
        return int(v) if v is not None else 0
    except (TypeError, ValueError):
        return 0


async def _upsert_topic(con, node: dict, parent_id: str | None) -> None:
    ref = (node.get("ref") or {}).get("id")
    if not ref:
        return
    props = _props(node)
    # edu-sharing collections can carry a preview image and an optional custom color
    # (`ccm:collection_color`). Using them keeps the topics view data-driven.
    # Skip the generic collection-icon so the UI falls back to our own visuals.
    preview = node.get("preview") or {}
    preview_url = preview.get("url") if not preview.get("isIcon") else None
    color = _first(props, "ccm:collection_color")
    con.execute(
        """INSERT INTO topic (id,parent_id,title,description,preview_url,color,created_at,modified_at)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             parent_id=excluded.parent_id,
             title=excluded.title,
             description=excluded.description,
             preview_url=excluded.preview_url,
             color=excluded.color,
             modified_at=excluded.modified_at""",
        (
            ref,
            parent_id,
            node.get("title") or _first(props, "cm:name") or "(ohne Titel)",
            (node.get("collection") or {}).get("description")
            or _first(props, "cm:description"),
            preview_url,
            color,
            node.get("createdAt"),
            node.get("modifiedAt"),
        ),
    )


async def _upsert_idea(
    con,
    node: dict,
    *,
    kind: str = "io",
    topic_id: str,
    main_content_id: str | None,
) -> None:
    """Schreibt eine Idee in den Cache. `kind` ist immer 'io' im neuen Modell;
    der Parameter bleibt aus historischen Gründen optional, default 'io'."""
    ref = (node.get("ref") or {}).get("id")
    if not ref:
        return
    props = _props(node)
    kws = _keywords(props)
    phase, events, categories, other = _classify_keywords(kws)

    # Fallback: derive event from title when no explicit event keyword is set.
    title_raw = node.get("title") or _first(props, "cm:name") or ""
    if not events:
        inferred = _infer_event_from_title(title_raw)
        if inferred:
            events.append(inferred)

    # Rating + commentCount live on the main ccm:io; fetch once and reuse.
    rating_avg = 0.0
    rating_count = 0
    comment_count = 0
    if main_content_id and main_content_id != ref:
        try:
            io_meta = await edu_sharing.client.node_metadata(main_content_id)
            io_node = io_meta.get("node") or {}
            rating_avg, rating_count = _rating(io_node)
            comment_count = _comment_count_from_node(io_node)
        except Exception as e:
            log.warning("metadata fetch failed for %s: %s", main_content_id, e)
    else:
        rating_avg, rating_count = _rating(node)
        comment_count = _comment_count_from_node(node)

    title = node.get("title") or _first(props, "cm:name") or "(ohne Titel)"
    description = (
        _first(props, "cclom:general_description")
        or _first(props, "cm:description")
        or (node.get("collection") or {}).get("description")
    )
    author = _first(props, "ccm:author_freetext") or _first(props, "cm:creator")
    project_url = _first(props, "ccm:wwwurl")

    # Attachment metadata — only present on ccm:io nodes (kind='io' OR the
    # main_content of a kind='collection' idea).
    attach_mime = None
    attach_size = None
    attach_name = None
    attach_url = None
    if kind == "io":
        attach_mime = node.get("mimetype")
        attach_size = node.get("size")
        attach_name = node.get("name")
        attach_url = node.get("downloadUrl")

    # Owner-Identität für /me/ideas. Reihenfolge:
    #   1. cm:owner   (explizit gesetzt, z.B. nach Move durch Mod)
    #   2. cm:creator (User, der den Node angelegt hat)
    #   3. node.owner.authorityName (wenn vorhanden)
    owner_username = (
        _first(props, "cm:owner")
        or _first(props, "cm:creator")
        or (node.get("owner") or {}).get("authorityName")
    )

    con.execute(
        """INSERT INTO idea
             (id,kind,topic_id,main_content_id,title,description,preview_url,author,
              project_url,phase,events,categories,keywords,rating_avg,rating_count,
              comment_count,attachment_mimetype,attachment_size,attachment_name,
              attachment_url,owner_username,created_at,modified_at,synced_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             kind=excluded.kind,
             topic_id=excluded.topic_id,
             main_content_id=excluded.main_content_id,
             title=excluded.title,
             description=excluded.description,
             preview_url=excluded.preview_url,
             author=excluded.author,
             project_url=excluded.project_url,
             phase=excluded.phase,
             events=excluded.events,
             categories=excluded.categories,
             keywords=excluded.keywords,
             rating_avg=excluded.rating_avg,
             rating_count=excluded.rating_count,
             comment_count=excluded.comment_count,
             attachment_mimetype=excluded.attachment_mimetype,
             attachment_size=excluded.attachment_size,
             attachment_name=excluded.attachment_name,
             attachment_url=excluded.attachment_url,
             owner_username=excluded.owner_username,
             modified_at=excluded.modified_at,
             synced_at=excluded.synced_at""",
        (
            ref,
            kind,
            topic_id,
            main_content_id,
            title,
            description,
            _preview(node),
            author,
            project_url,
            phase,
            json.dumps(events, ensure_ascii=False),
            json.dumps(categories, ensure_ascii=False),
            json.dumps(other, ensure_ascii=False),
            rating_avg,
            rating_count,
            comment_count,
            attach_mime,
            attach_size,
            attach_name,
            attach_url,
            owner_username,
            node.get("createdAt"),
            node.get("modifiedAt"),
            _iso_now(),
        ),
    )
    con.execute("DELETE FROM idea_fts WHERE id = ?", (ref,))
    con.execute(
        "INSERT INTO idea_fts(id,title,description,keywords) VALUES (?,?,?,?)",
        (ref, title, description or "", " ".join(kws)),
    )


async def refresh_idea(idea_id: str, *, auth_header: str | None = None) -> bool:
    """Single-Node-Refresh: holt Metadaten genau einer Idee aus edu-sharing und
    schreibt nur diese eine Cache-Row neu. ~50–200ms, kein Tree-Walk.

    Verwendet nach Schreib-Operationen (Submit, Edit, Rating, Kommentar, Upload),
    damit Listen/Karten den neuen Stand sofort widerspiegeln, ohne auf den
    nächsten 5-min-Voll-Sync warten zu müssen.

    Returns True bei Erfolg, False wenn der Knoten nicht (mehr) existiert oder
    kein Eltern-Container ermittelt werden konnte. Snapshots werden NICHT
    geschrieben — die bleiben streng zeitbasiert."""
    try:
        meta = await edu_sharing.client.node_metadata(
            idea_id, auth_header=auth_header
        )
    except Exception as e:
        log.debug("refresh_idea: node_metadata fehlgeschlagen für %s: %s", idea_id, e)
        return False

    node = (meta or {}).get("node") or meta or {}
    parent = node.get("parent") or {}
    parent_id = parent.get("id") or (parent.get("ref") or {}).get("id")
    if not parent_id:
        return False

    # Inbox-Submits gehören NICHT in den Public-Cache. Sie sollen nur über
    # `GET /api/v1/inbox` für Mods sichtbar sein, bis sie verschoben werden.
    # Erst nach `moderation/move` zeigt parent_id auf eine Herausforderung,
    # dann darf ein Refresh die Idee in den Cache schreiben.
    from .config import settings
    if parent_id == settings.edu_guest_inbox_id:
        log.debug("refresh_idea: skip inbox node %s", idea_id)
        return False

    try:
        with connect() as con:
            await _upsert_idea(
                con, node, kind="io", topic_id=parent_id, main_content_id=idea_id,
            )
        return True
    except Exception as e:
        log.warning("refresh_idea: upsert fehlgeschlagen für %s: %s", idea_id, e)
        return False


async def run_sync(*, wait: bool = True) -> dict:
    """One full walk. Safe to call periodically.

    Sequenzialisiert über `_sync_lock`. Mit `wait=False` wird ein bereits
    laufender Sync nicht wiederholt — es wird sofort ein Hinweis-Resultat
    zurückgegeben statt zu blockieren (sinnvoll für „nice-to-have"-Trigger
    nach Edits, wo Doppel-Läufe nichts bringen)."""
    if not wait and _sync_lock.locked():
        return {
            "started_at": _iso_now(), "finished_at": _iso_now(),
            "topics_seen": 0, "ideas_seen": 0,
            "skipped": True, "reason": "sync already running",
        }
    async with _sync_lock:
        return await _run_sync_locked()


async def _run_sync_locked() -> dict:
    from .config import settings  # local to avoid cycle at import-time

    started = _iso_now()
    topics_seen = 0
    ideas_seen = 0
    err: str | None = None

    skipped: list[str] = []  # node-IDs, die wir wegen 401/403/etc. übersprungen haben

    async def _safe(coro, label: str):
        """Wrapt einen einzelnen ES-Call. 401/403 → return None + Log,
        sodass der gesamte Sync nicht abbricht, wenn nur einzelne Knoten
        nicht lesbar sind (z.B. Gast ohne Admin auf einer privaten Idee)."""
        try:
            return await coro
        except Exception as e:
            from httpx import HTTPStatusError
            if isinstance(e, HTTPStatusError) and e.response.status_code in (401, 403, 404):
                log.info("sync skip %s: %s", label, e.response.status_code)
                skipped.append(label)
                return None
            log.warning("sync %s failed: %s", label, e)
            return None

    try:
        with connect() as con:
            # Root's immediate children = Themen
            themes = await edu_sharing.client.collection_subcollections(
                settings.ideendb_root_collection_id, max_items=100
            )
            for theme in themes.get("collections") or []:
                tid = (theme.get("ref") or {}).get("id")
                if not tid:
                    continue
                await _upsert_topic(con, theme, parent_id=None)
                topics_seen += 1

                # Herausforderungen (2. Ebene)
                challenges = await _safe(
                    edu_sharing.client.collection_subcollections(tid, max_items=100),
                    f"theme:{tid}",
                ) or {}
                for ch in challenges.get("collections") or []:
                    chid = (ch.get("ref") or {}).get("id")
                    if not chid:
                        continue
                    await _upsert_topic(con, ch, parent_id=tid)
                    topics_seen += 1

                    # Architektur 2026-04-25: Idee = ein ccm:io.
                    # ccm:io-References einer Herausforderung sind die Ideen.
                    ch_refs = await _safe(
                        edu_sharing.client.collection_references(chid, max_items=200),
                        f"challenge:{chid}",
                    ) or {}
                    for ref_node in ch_refs.get("references") or []:
                        try:
                            await _upsert_idea(
                                con, ref_node, kind="io", topic_id=chid,
                                main_content_id=(ref_node.get("ref") or {}).get("id"),
                            )
                            ideas_seen += 1
                        except Exception as e:
                            ref_id = (ref_node.get("ref") or {}).get("id")
                            log.warning("sync upsert %s failed: %s", ref_id, e)
                            skipped.append(f"idea:{ref_id}")

                    # Anhänge-Sammlungen sind ccm:map-Geschwister mit Keyword
                    # `attachment-of:<idea-id>` — an die Idee verknüpfen.
                    ch_subs = await _safe(
                        edu_sharing.client.collection_subcollections(chid, max_items=200),
                        f"challenge-subs:{chid}",
                    ) or {}
                    for sub in ch_subs.get("collections") or []:
                        sub_kws = _keywords(_props(sub))
                        attach_of = next(
                            (k[len("attachment-of:"):]
                             for k in sub_kws
                             if k.lower().startswith("attachment-of:")),
                            None,
                        )
                        if not attach_of:
                            continue
                        sub_id = (sub.get("ref") or {}).get("id")
                        if not sub_id:
                            continue
                        con.execute(
                            "UPDATE idea SET attachment_folder_id=? WHERE id=?",
                            (sub_id, attach_of),
                        )

            # Trend-Snapshot: aktuellen Stand der Top-Listen je Event/Sort
            # persistieren. Throttled auf SNAPSHOT_MIN_INTERVAL, damit das
            # 30er-Limit der ranking_snapshot-Tabelle nicht in 2.5h voll ist.
            if _should_capture_snapshot(con):
                _capture_ranking_snapshot(con, _iso_now())

            # Activity-Log gleich mit ausdünnen — billig und passt zum Sync-Tick.
            _prune_activity_log(con)

            con.execute(
                """INSERT INTO sync_log (started_at,finished_at,topics_seen,ideas_seen,error)
                   VALUES (?,?,?,?,?)""",
                (started, _iso_now(), topics_seen, ideas_seen, None),
            )
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        log.exception("sync failed")
        with connect() as con:
            con.execute(
                """INSERT INTO sync_log (started_at,finished_at,topics_seen,ideas_seen,error)
                   VALUES (?,?,?,?,?)""",
                (started, _iso_now(), topics_seen, ideas_seen, err),
            )

    return {
        "started_at": started,
        "finished_at": _iso_now(),
        "topics_seen": topics_seen,
        "ideas_seen": ideas_seen,
        "skipped_count": len(skipped),
        "skipped_examples": skipped[:10],
        "error": err,
    }


# ===== Ranking Snapshots =================================================
SNAPSHOT_TOP_N = 50
SNAPSHOT_SORTS = (
    ("rating",   "rating_avg",    "rating_count"),  # tie-breaker rating_count
    ("comments", "comment_count", "rating_avg"),
    ("interest", "interest_count","comment_count"),
)


def _should_capture_snapshot(con) -> bool:
    """True wenn der letzte Snapshot älter als `SNAPSHOT_MIN_INTERVAL` ist
    (oder noch keiner existiert)."""
    row = con.execute(
        "SELECT MAX(snapshot_at) AS last FROM ranking_snapshot"
    ).fetchone()
    last = row["last"] if row else None
    if not last:
        return True
    try:
        last_dt = datetime.fromisoformat(last)
    except Exception:
        return True
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - last_dt >= SNAPSHOT_MIN_INTERVAL


def _capture_ranking_snapshot(con, ts: str) -> None:
    """Schreibt Top-N je (event, sort) als Snapshot. Wird einmal pro Sync-Lauf
    gerufen. Vor dem Insert werden ältere Snapshots ausgedünnt (siehe
    `_prune_snapshots`), damit die Tabelle nicht unbegrenzt wächst."""

    # Welche Events kommen in den Ideen vor? `events` ist JSON-Array.
    rows = con.execute(
        "SELECT DISTINCT events FROM idea WHERE events IS NOT NULL AND events != '[]'"
    ).fetchall()
    event_slugs: set[str] = set()
    for r in rows:
        try:
            for s in json.loads(r["events"] or "[]"):
                if s:
                    event_slugs.add(str(s))
        except Exception:
            continue

    # Pro-Idee Interest-Count vorberechnen (sort='interest').
    interest_map = {
        r["idea_id"]: r["c"]
        for r in con.execute(
            "SELECT idea_id, COUNT(*) AS c FROM idea_interaction "
            "WHERE kind='interest' GROUP BY idea_id"
        ).fetchall()
    }

    def _rank_for(event_filter: str | None, sort_key: str, primary: str, secondary: str):
        where = []
        params: list = []
        if event_filter:
            where.append("events LIKE ?")
            params.append(f'%"{event_filter}"%')
        sql_where = (" WHERE " + " AND ".join(where)) if where else ""
        if sort_key == "interest":
            ideas = con.execute(
                f"SELECT id, comment_count, rating_avg FROM idea{sql_where}",
                params,
            ).fetchall()
            scored = [
                (r["id"], float(interest_map.get(r["id"], 0)), float(r["comment_count"] or 0))
                for r in ideas
            ]
            scored.sort(key=lambda t: (-t[1], -t[2]))
            return [(idea_id, score) for idea_id, score, _ in scored[:SNAPSHOT_TOP_N]]
        ideas = con.execute(
            f"SELECT id, {primary} AS p, {secondary} AS s FROM idea{sql_where} "
            f"ORDER BY p DESC, s DESC LIMIT ?",
            (*params, SNAPSHOT_TOP_N),
        ).fetchall()
        return [(r["id"], float(r["p"] or 0)) for r in ideas]

    # Schreiben — overall + pro Event.
    targets = [""] + sorted(event_slugs)
    for ev in targets:
        for sort_key, primary, secondary in SNAPSHOT_SORTS:
            ranking = _rank_for(ev or None, sort_key, primary, secondary)
            for rank, (idea_id, score) in enumerate(ranking, start=1):
                con.execute(
                    "INSERT OR REPLACE INTO ranking_snapshot "
                    "(snapshot_at,event,sort,idea_id,rank,score) VALUES (?,?,?,?,?,?)",
                    (ts, ev, sort_key, idea_id, rank, score),
                )

    _prune_snapshots(con)


ACTIVITY_LOG_KEEP_DAYS = 90
ACTIVITY_LOG_KEEP_ROWS = 5000


def _prune_activity_log(con) -> None:
    """Behalte Einträge der letzten ACTIVITY_LOG_KEEP_DAYS Tage UND maximal
    ACTIVITY_LOG_KEEP_ROWS Zeilen. Wird einmal pro Sync-Lauf gerufen (sehr
    günstig wegen ts-Index)."""
    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=ACTIVITY_LOG_KEEP_DAYS)
    cutoff = cutoff_dt.isoformat()
    con.execute("DELETE FROM activity_log WHERE ts < ?", (cutoff,))
    # Hard-Cap: lösche alles, was über die jüngsten ACTIVITY_LOG_KEEP_ROWS
    # hinausgeht (verhindert Explosion bei plötzlich sehr aktiver Phase).
    con.execute(
        "DELETE FROM activity_log WHERE id NOT IN ("
        "  SELECT id FROM activity_log ORDER BY ts DESC LIMIT ?"
        ")",
        (ACTIVITY_LOG_KEEP_ROWS,),
    )


def _prune_snapshots(con) -> None:
    """Behalte die jüngsten 60 Snapshots — alles ältere wegwerfen, damit die
    Tabelle nicht ausufert. Bei SNAPSHOT_MIN_INTERVAL=1h sind das ~2.5 Tage
    Trend-Historie; bei 4h-Intervall ~10 Tage."""
    keep = 60
    rows = con.execute(
        "SELECT DISTINCT snapshot_at FROM ranking_snapshot "
        "ORDER BY snapshot_at DESC LIMIT ?",
        (keep,),
    ).fetchall()
    if not rows:
        return
    cutoff = rows[-1]["snapshot_at"]
    con.execute(
        "DELETE FROM ranking_snapshot WHERE snapshot_at < ?", (cutoff,)
    )
