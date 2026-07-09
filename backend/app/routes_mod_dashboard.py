"""Moderation dashboard — open reports, stats, activity log, moderator list.

Split out of routes_moderation.py (behaviour-preserving). Read-mostly oversight
endpoints for the mod UI: the open-reports queue (+ resolve), the overview
stats, the filterable activity log, and the read-only moderator listing.
Mounted onto the main router via ``include_router`` in routes.py — public
paths (/api/v1/admin/reports|stats|activity|moderators) stay unchanged.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, Header, Query

from . import edu_sharing
from . import sync as sync_mod
from .config import settings
from .db import connect
from .routes_common import (
    _escape_like,
    _log_activity,
    _require_moderator,
)

log = logging.getLogger(__name__)

router = APIRouter()


# ===== Meldungen / Statistik / Aktivitätslog (Mod-only) ===================


@router.get("/admin/reports", tags=["moderation"])
async def list_reports(authorization: str | None = Header(None)):
    """Mod-Liste offener Meldungen (resolved_at IS NULL)."""
    await _require_moderator(authorization)

    def _read_open_reports():
        with connect() as con:
            return con.execute(
                """SELECT r.*, i.title FROM idea_report r
                     LEFT JOIN idea i ON i.id = r.idea_id
                    WHERE r.resolved_at IS NULL
                    ORDER BY r.created_at DESC LIMIT 200"""
            ).fetchall()

    rows = await asyncio.to_thread(_read_open_reports)
    return {"count": len(rows), "items": [dict(r) for r in rows]}


@router.get("/admin/stats", tags=["moderation"])
async def admin_stats(authorization: str | None = Header(None)):
    """Übersichts-Dashboard für Mods: Totals, Phasen-/Event-Verteilung,
    Aktivitätskurve (Ideen pro Woche), Top-Aktive User, Reports-Stand."""
    await _require_moderator(authorization)

    def _read_admin_stats():
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
            weekly_list = list(reversed([{"week": r["week"], "count": r["c"]} for r in weekly]))

            # Top-Aktive User aus activity_log (letzte 30 Tage)
            cutoff = (datetime.now(UTC) - timedelta(days=30)).isoformat()
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
            rep_open = (
                con.execute(
                    "SELECT COUNT(*) FROM idea_report WHERE resolved_at IS NULL"
                ).fetchone()[0]
                if con.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='idea_report'"
                ).fetchone()
                else 0
            )
            rep_resolved = (
                con.execute(
                    "SELECT COUNT(*) FROM idea_report WHERE resolved_at IS NOT NULL"
                ).fetchone()[0]
                if con.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='idea_report'"
                ).fetchone()
                else 0
            )

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
                dict(r)
                for r in con.execute(
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

    return await asyncio.to_thread(_read_admin_stats)


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
        where.append("action = ?")
        params.append(action)
    if actor:
        # SQL-LIKE-Wildcards (% / _) aus dem User-Input neutralisieren,
        # damit z.B. `actor=%` nicht zur Voll-Liste degeneriert und
        # Ressourcen-/Pattern-DoS via `%%%%…` ausgeschlossen ist.
        where.append("actor LIKE ? ESCAPE '\\'")
        params.append(f"%{_escape_like(actor)}%")
    if target_id:
        where.append("target_id = ?")
        params.append(target_id)
    if since:
        where.append("ts >= ?")
        params.append(since)
    sql_where = (" WHERE " + " AND ".join(where)) if where else ""

    def _read_activity_page():
        with connect() as con:
            total = con.execute(f"SELECT COUNT(*) FROM activity_log{sql_where}", params).fetchone()[
                0
            ]
            rows = con.execute(
                f"SELECT * FROM activity_log{sql_where} ORDER BY ts DESC LIMIT ? OFFSET ?",
                (*params, limit, offset),
            ).fetchall()
            # Verfügbare Action-Typen für UI-Dropdown
            actions = [
                r["action"]
                for r in con.execute(
                    "SELECT DISTINCT action FROM activity_log ORDER BY action ASC"
                ).fetchall()
            ]
        return total, rows, actions

    total, rows, actions = await asyncio.to_thread(_read_activity_page)

    items = []
    for r in rows:
        d = dict(r)
        if d.get("detail"):
            try:
                d["detail"] = json.loads(d["detail"])
            except Exception:
                pass
        items.append(d)

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "actions": actions,
        "items": items,
    }


@router.post("/admin/reports/{report_id}/resolve", tags=["moderation"])
async def resolve_report(report_id: int, authorization: str | None = Header(None)):
    await _require_moderator(authorization)

    def _mark_resolved():
        with connect() as con:
            con.execute(
                "UPDATE idea_report SET resolved_at=? WHERE id=?",
                (sync_mod._iso_now(), report_id),
            )

    await asyncio.to_thread(_mark_resolved)
    await asyncio.to_thread(
        _log_activity,
        action="report_resolved",
        authorization=authorization,
        is_mod=True,
        target_type="report",
        target_id=str(report_id),
    )
    return {"ok": True}


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
            m = await edu_sharing.client.group_members(group_name, auth_header=authorization)
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
        for p in m.get("persons") or m.get("authorities") or m.get("members") or []:
            uname = p.get("authorityName") or p.get("userName")
            key = (uname or "").lower()
            if not uname or key in seen:
                continue
            seen.add(key)
            profile = p.get("profile") or {}
            members.append(
                {
                    "username": uname,
                    "first_name": profile.get("firstName"),
                    "last_name": profile.get("lastName"),
                    "email": profile.get("email") or p.get("mailbox"),
                    "source": group_name,
                }
            )
            added += 1
        # Klartext-Bezeichnung der Gruppe holen (profile.displayName), damit das
        # Mod-UI nicht nur die technische Gruppen-ID zeigt. Best-effort.
        display_name: str | None = None
        try:
            g = await edu_sharing.client.get_group(group_name, auth_header=authorization)
            inner = g.get("group") if isinstance(g.get("group"), dict) else g
            display_name = ((inner or {}).get("profile") or {}).get("displayName") or None
        except Exception:
            display_name = None
        group_results.append(
            {
                "group": group_name,
                "display_name": display_name,
                "ok": ok,
                "error": error,
                "count": added,
            }
        )

    return {
        "groups": settings.fallback_mod_groups,
        "group_status": group_results,
        "count": len(members),
        "members": members,
        "managed_externally": True,
    }
