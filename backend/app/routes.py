"""Public read/query core + API router aggregation.

After the module split this file owns exactly one domain: the public read side
of the API — topic drill-down, meta facets, idea list (FTS search, filters,
sorting), idea detail (with tiered caches), public user profiles, and the
bundled /bootstrap payload. All write paths and the other domains (including
ranking) live in their own ``routes_<domain>.py`` modules and are mounted back
onto this module's ``router`` via ``include_router`` below, so every public
path is unchanged.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import re
import sqlite3
from datetime import UTC, datetime
from typing import Literal

log = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query

from . import edu_sharing
from . import sync as sync_mod
from .auth import can_edit_idea as _can_edit_idea
from .auth import decode_basic_user as _user_key_from_auth
from .auth import is_moderator as _is_moderator
from .auth import verify_login as _verify_login
from .db import connect
from .routes_admin import router as _admin_router
from .routes_attachments import router as _attachments_router
from .routes_captcha import router as _captcha_router
from .routes_common import (
    CHILD_CACHE_TTL_SECONDS,
    _allowed_next_phases,
    _attachment_from_node,
    _collect_topic_subtree,
    _escape_like,
    _get_setting,
    _map_child_attachments,
    _phase_order,
    _rating_open_for_events,
    _refresh_children_cache_bg,
    _row_to_idea,
    _safe_get,
    _store_children_cache,
    _store_children_cache_failure,
)
from .routes_feedback import router as _feedback_router
from .routes_idea_edit import router as _idea_edit_router
from .routes_inbox import router as _inbox_router
from .routes_me import router as _me_router
from .routes_mod_dashboard import router as _mod_dashboard_router
from .routes_moderation import router as _moderation_router
from .routes_ops import router as _ops_router
from .routes_participation import router as _participation_router
from .routes_ranking import router as _ranking_router
from .routes_reports import router as _reports_router
from .routes_settings import get_settings
from .routes_settings import router as _settings_router
from .routes_submit import router as _submit_router
from .routes_taxonomy import _list_events, featured_event, list_phases
from .routes_taxonomy import router as _taxonomy_router
from .routes_topics import router as _topics_router

router = APIRouter()
# Domänen-Router hier wieder auf den Haupt-Router mounten — öffentliche Pfade
# bleiben unverändert. Wer welchen Endpoint besitzt: siehe Modul-Karte in
# docs/ARCHITEKTUR.md (ops = health/status, captcha, topics = Admin-CRUD,
# me = /me/*, admin = Sync/Backup, moderation = inbox/hide/move/publish/
# sync-diff, taxonomy = Phasen/Events, participation = contact/interest/
# follow/team, feedback = Rating/Kommentare, settings, reports, submit,
# attachments = content/preview/Anhänge, idea_edit = PATCH/DELETE/refresh).
router.include_router(_ops_router)
router.include_router(_captcha_router)
router.include_router(_topics_router)
router.include_router(_me_router)
router.include_router(_admin_router)
router.include_router(_moderation_router)
router.include_router(_inbox_router)
router.include_router(_mod_dashboard_router)
router.include_router(_taxonomy_router)
router.include_router(_participation_router)
router.include_router(_feedback_router)
router.include_router(_settings_router)
router.include_router(_reports_router)
router.include_router(_submit_router)
router.include_router(_attachments_router)
router.include_router(_idea_edit_router)
router.include_router(_ranking_router)

SortBy = Literal["modified", "created", "rating", "comments", "title"]


def _safe_highlight(raw: str | None) -> str | None:
    """FTS-Snippet (roher User-Text) HTML-escapen und die Sentinel-Marker
    \\x01/\\x02 in <mark>/</mark> wandeln. Nötig, weil Titel/Beschreibung im
    Frontend per [innerHTML] gerendert werden — so enthält der String nur
    escapten Text + <mark> und kann kein eingeschleustes HTML ausführen."""
    if not raw or "\x01" not in raw:
        return None
    return html.escape(raw).replace("\x01", "<mark>").replace("\x02", "</mark>")


@router.get("/topics/{topic_id}")
def get_topic(topic_id: str):
    """Single topic plus its direct children, for drill-down views."""
    cols = "id,parent_id,title,description,preview_url,color,created_at,modified_at"
    with connect() as con:
        row = con.execute(
            f"SELECT {cols} FROM topic WHERE id=?",
            (topic_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Topic not found")
        children = con.execute(
            f"SELECT {cols} FROM topic WHERE parent_id=? ORDER BY title",
            (topic_id,),
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


@router.get("/meta")
def meta_facets(
    topic_id: str | None = Query(None),
    phase: str | None = Query(None),
    event: str | None = Query(None),
    q: str | None = Query(None),
):
    """Facetten-Counts (Phase/Veranstaltung/Kategorie + Per-Topic) im Cache.

    Drill-down: Die Counts berücksichtigen die ÜBRIGEN aktiven Filter, damit sie
    zur Auswahl passen — z.B. zeigt die Veranstaltungs-Liste bei aktivem
    Phase=Anregung nur Counts INNERHALB Anregung. Pro Dimension wird der EIGENE
    Filter ausgelassen, damit man Werte innerhalb einer Dimension noch wechseln
    kann. Versteckte Ideen sind (wie in der Liste) ausgeschlossen.
    """
    topic_ids: list[str] = []
    if topic_id:
        with connect() as con:
            topic_ids = list(_collect_topic_subtree(con, topic_id))
    qn = (q or "").strip()

    def _clauses(*, skip: str, use_q: bool) -> tuple[list[str], list]:
        cl: list[str] = ["COALESCE(hidden, 0) = 0"]
        pr: list = []
        if topic_ids and skip != "topic":
            cl.append(f"topic_id IN ({','.join('?' * len(topic_ids))})")
            pr.extend(topic_ids)
        if phase and skip != "phase":
            cl.append("phase = ?")
            pr.append(phase)
        if event and skip != "event":
            cl.append("events LIKE ? ESCAPE '\\'")
            pr.append(f'%"{_escape_like(event)}"%')
        if qn and use_q:
            cl.append("id IN (SELECT id FROM idea_fts WHERE idea_fts MATCH ?)")
            pr.append(qn)
        return cl, pr

    def _compute(use_q: bool):
        with connect() as con:
            cl, pr = _clauses(skip="phase", use_q=use_q)
            phase_rows = con.execute(
                "SELECT phase AS value, COUNT(*) AS count FROM idea "
                f"WHERE {' AND '.join(cl)} AND phase IS NOT NULL AND phase <> '' "
                "GROUP BY phase ORDER BY count DESC",
                pr,
            ).fetchall()
            cl_e, pr_e = _clauses(skip="event", use_q=use_q)
            ev_rows = con.execute(
                f"SELECT events FROM idea WHERE {' AND '.join(cl_e)}", pr_e
            ).fetchall()
            cl_c, pr_c = _clauses(skip="category", use_q=use_q)
            cat_rows = con.execute(
                f"SELECT categories FROM idea WHERE {' AND '.join(cl_c)}", pr_c
            ).fetchall()
            cl_t, pr_t = _clauses(skip="topic", use_q=use_q)
            topic_rows = con.execute(
                "SELECT topic_id AS value, COUNT(*) AS count FROM idea "
                f"WHERE {' AND '.join(cl_t)} AND topic_id IS NOT NULL "
                "GROUP BY topic_id",
                pr_t,
            ).fetchall()
        return phase_rows, ev_rows, cat_rows, topic_rows

    try:
        phase_rows, ev_rows, cat_rows, topic_rows = _compute(use_q=bool(qn))
    except sqlite3.OperationalError:
        # Malformierte FTS-Query → Facetten ohne Volltext-Filter berechnen.
        phase_rows, ev_rows, cat_rows, topic_rows = _compute(use_q=False)

    events: dict[str, int] = {}
    for r in ev_rows:
        for e in json.loads(r["events"] or "[]"):
            events[e] = events.get(e, 0) + 1
    categories: dict[str, int] = {}
    for r in cat_rows:
        for c in json.loads(r["categories"] or "[]"):
            categories[c] = categories.get(c, 0) + 1
    return {
        "phases": [dict(p) for p in phase_rows],
        "events": [
            {"value": k, "count": v} for k, v in sorted(events.items(), key=lambda x: -x[1])
        ],
        "categories": [
            {"value": k, "count": v} for k, v in sorted(categories.items(), key=lambda x: -x[1])
        ],
        "topics": {r["value"]: r["count"] for r in topic_rows},
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
    q: str | None = Query(None, max_length=200, description="Full-text search"),
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
        # events is a JSON array; LIKE works for simple membership lookup.
        # Wildcards im User-Input escapen (kein SQLi, aber sonst Over-Match/DoS).
        where.append("i.events LIKE ? ESCAPE '\\'")
        params.append(f'%"{_escape_like(event)}"%')
    if category:
        where.append("i.categories LIKE ? ESCAPE '\\'")
        params.append(f'%"{_escape_like(category)}"%')

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
            # Sentinel-Marker (\\x01/\\x02) statt direkt '<mark>' — werden
            # serverseitig nach dem HTML-Escapen ersetzt (siehe _safe_highlight).
            ", snippet(idea_fts, 2, char(1), char(2), '…', 16) AS highlight_desc"
            ", highlight(idea_fts, 1, char(1), char(2)) AS highlight_title"
        )

    list_sql = (
        f"SELECT {select_cols} {base_sql} ORDER BY {sort_col} {order.upper()} LIMIT ? OFFSET ?"
    )
    count_sql = f"SELECT COUNT(*) {base_sql}"

    with connect() as con:
        try:
            total = con.execute(count_sql, params).fetchone()[0]
            rows = con.execute(list_sql, [*params, limit, offset]).fetchall()
        except sqlite3.OperationalError:
            # Malformierte FTS5-Query (z.B. unbalanciertes ") darf keinen 500
            # werfen — als 0 Treffer behandeln, die Suggestions unten greifen.
            total, rows = 0, []

    items = []
    for r in rows:
        d = _row_to_idea(r)
        # Highlights nur dann mitsenden, wenn vorhanden (q gesetzt + Treffer).
        # _safe_highlight escapt den User-Text und setzt <mark> aus Sentinels.
        try:
            ht = _safe_highlight(r["highlight_title"])
            hd = _safe_highlight(r["highlight_desc"])
            if ht or hd:
                d["highlights"] = {"title": ht, "description": hd}
        except (IndexError, KeyError):
            pass
        items.append(d)

    response: dict = {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": items,
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
                "SELECT title FROM idea WHERE title LIKE ? ORDER BY modified_at DESC LIMIT 1",
                (f"%{tok}%",),
            ).fetchone()
            if row and row["title"] not in alt_terms:
                alt_terms.append(row["title"])
        recent_rows = con.execute("SELECT * FROM idea ORDER BY modified_at DESC LIMIT 5").fetchall()
    return {
        "alt_terms": alt_terms,
        "recent": [_row_to_idea(r) for r in recent_rows],
    }


# Tier C (Child-IO-Anhang-Cache der Detailseite): TTL-Konstante + Helfer leben
# in routes_common — neben get_idea nutzt sie auch der Moderations-Move
# (Prewarm der frischen Reference) und der SWR-Hintergrund-Refresh.


def _owner_display_name_cached(owner_username: str | None, cached_name: str | None) -> str | None:
    """Owner-Anzeigename OHNE Live-Call und OHNE je den Login-Username
    preiszugeben (der ist zugleich der Anmeldename): bevorzugt der selbst
    gepflegte App-Profilname (user_profile_meta), sonst der beim Sync/Refresh aus
    edu-sharing (createdBy/owner) gespeicherte Klarname. Ist keiner bekannt →
    None; das Frontend zeigt dann KEINEN Namen statt des Logins."""
    if owner_username:
        try:
            with connect() as con:
                r = con.execute(
                    "SELECT display_name FROM user_profile_meta "
                    "WHERE username=? AND display_name IS NOT NULL AND display_name <> ''",
                    (owner_username,),
                ).fetchone()
            if r and r["display_name"]:
                return r["display_name"]
        except Exception:
            pass
    return cached_name or None


@router.get("/ideas/{idea_id}")
async def get_idea(
    idea_id: str,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
):
    def _read_idea():
        with connect() as con:
            row = con.execute("SELECT * FROM idea WHERE id = ?", (idea_id,)).fetchone()
            interest_count = con.execute(
                "SELECT COUNT(*) FROM idea_interaction WHERE idea_id=? AND kind='interest'",
                (idea_id,),
            ).fetchone()[0]
        return row, interest_count

    row, interest_count = await asyncio.to_thread(_read_idea)

    # Cache-Miss-Fallback: frisch eingereichte Ideen sind noch nicht im Cache.
    # Statt 404 → live aus edu-sharing holen, in den Cache schreiben (refresh
    # nutzt _upsert_idea), Row neu lesen. Funktioniert auch für anonyme Reader,
    # solange die Idee öffentlich lesbar ist.
    if not row:
        ok = await sync_mod.refresh_idea(idea_id, auth_header=authorization)
        if ok:

            def _reread_idea():
                with connect() as con:
                    return con.execute("SELECT * FROM idea WHERE id = ?", (idea_id,)).fetchone()

            row = await asyncio.to_thread(_reread_idea)
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

    # Voll-Cache-Detailseite: Rating/Owner/Anhang-Metadaten kommen aus SQLite —
    # es gibt nur noch zwei KONDITIONALE Live-Reads (Kommentar-Thread bei
    # Count-Mismatch, Child-Anhänge nach TTL-Ablauf). Beide starten unten
    # parallel (create_task), damit ein Doppel-Miss nur EINE ES-Latenz kostet.
    # Auth-Passthrough: eingeloggte Caller lesen mit eigener Identität (Zugriff
    # auf Ideen, die der Gast nicht sehen darf); anonym übernimmt der Gast.
    target_id = row["main_content_id"] or row["id"]

    # Voll-Cache der Detailseite (A): KEIN Live-`node_metadata` mehr — Rating,
    # Owner und Anhang-Metadaten kommen aus dem SQLite-Cache (der Sync hält sie
    # aktuell; App-Writes triggern refresh_idea). `live_meta_node` bleibt leer,
    # sodass der Anhang-Block unten automatisch den Cache-Fallback nutzt. Die
    # eigene Stimme (my_rating) füllt der Client aus seinem VotingService-Cache.
    # Cached Ideen stammen aus den ÖFFENTLICHEN Sammlungen → nie „privat".
    is_private = False  # markiert: Gast hat keinen Lesezugriff (nur Live-Pfade)
    live_meta_node: dict = {}
    # Eigene Stimme (A): aus dem App-eigenen vote_event-Ledger (rate_idea/unrate
    # pflegen es) statt live von edu-sharing — +0 Calls, überlebt Reload. Das
    # Frontend konsumiert `my_rating` unverändert weiter.
    base["my_rating"] = 0.0
    if authorization:
        _uk = _user_key_from_auth(authorization)
        if _uk:
            try:

                def _read_vote():
                    with connect() as con:
                        return con.execute(
                            "SELECT value FROM vote_event WHERE idea_id=? AND user_key=?",
                            (row["id"], _uk),
                        ).fetchone()

                _vr = await asyncio.to_thread(_read_vote)
                if _vr and _vr["value"] is not None:
                    base["my_rating"] = float(_vr["value"])
            except Exception:
                pass

    # can_edit / can_delete: NICHT aus ES-accessEffective ableiten — die
    # HackathOERn-Gruppe hat dort durch Vererbung pauschal Write-Rechte und
    # das wäre ein Free-for-all. App-seitiges Owner-Gating greift stattdessen.
    can_edit = False
    can_delete = False
    if authorization:
        # Editieren dürfen Owner/Mod UND angenommene Mitwirkende; Löschen/
        # Umhängen bleibt Owner/Mod vorbehalten. `verified=True`: reines
        # Anzeige-Flag (can_edit/can_delete steuern nur UI-Buttons) — die
        # tatsächliche Mutation re-verifiziert serverseitig (edit_idea/delete_idea
        # via edu-sharing-Write). Kein Verify-Roundtrip auf dem heißen Detail-Pfad
        # UND kein Owner-Live-Fallback (`live_fallback=False`): der kostete jeden
        # eingeloggten Nicht-Owner pro Detailaufruf einen ungecachten
        # node_metadata-Roundtrip (~300–450 ms, bei ES-Hängern bis zum Timeout).
        # `mod_stale_ok=True`: kurz abgelaufener Mod-Status trägt die UI-Flags
        # sofort (SWR) — sonst hängt jeder Ideenwechsel nach 60 s wieder ~1,2 s
        # am my_memberships-Roundtrip (Live-Befund, DevTools).
        edit_allowed, _user, is_owner_or_mod = await _can_edit_idea(
            row["id"], authorization, verified=True, live_fallback=False, mod_stale_ok=True
        )
        can_edit = edit_allowed
        can_delete = is_owner_or_mod
    base["can_edit"] = can_edit
    base["can_delete"] = can_delete

    # Owner-Anzeigename aus dem Cache (A): bevorzugt der selbst gepflegte
    # App-Profilname, sonst der Login-Username — vermeidet den Live-node_metadata-
    # Call, der früher firstName+lastName lieferte. Rating bleibt der gecachte
    # Wert (base); die eigene Stimme liefert der Client aus dem VotingService.
    base["owner_display_name"] = _owner_display_name_cached(
        _safe_get(row, "owner_username"), _safe_get(row, "owner_display_name")
    )

    # Phase-Workflow: dem Frontend mitteilen, welche Phasen der Caller setzen
    # darf. Mod sieht alle, Owner nur „aktuelle + 1 vorwärts" (ohne Archive).
    is_mod_caller = False
    if authorization:
        try:
            # Nur fürs Phasen-Dropdown (Anzeige) → stale-toleranter Mod-Status.
            is_mod_caller = await _is_moderator(authorization, stale_ok=True)
        except Exception:
            is_mod_caller = False

    def _read_phase_order():
        with connect() as con:
            return _phase_order(con)

    order = await asyncio.to_thread(_read_phase_order)
    base["allowed_next_phases"] = (
        _allowed_next_phases(
            current=base.get("phase"),
            is_mod=is_mod_caller,
            order=order,
        )
        if can_edit
        else []
    )

    # Kommentare aus dem Voll-Cache (B): ist der gecachte Thread aktuell
    # (comments_cache_count == comment_count), ohne Live-Call ausliefern. Sonst
    # einmal live holen und den Cache füllen. Post/Delete bumpen comment_count
    # (über refresh_idea) → der Count-Mismatch invalidiert den Cache automatisch.
    # Invariante: der Cache ist caller-unabhängig (Schlüssel = Idee, nicht Auth).
    # Sicher, weil gecachte Ideen ausschließlich aus ÖFFENTLICHEN Sammlungen
    # stammen (private/Inbox-Knoten landen nie im Cache; refresh_idea überspringt
    # sie) → die Kommentare sind für alle Leser identisch. Falls je nicht-
    # öffentliche Kommentare eingeführt werden, muss hier nach Auth geschlüsselt
    # werden.
    cur_count = _safe_get(row, "comment_count") or 0
    cached_count = _safe_get(row, "comments_cache_count")
    cached_json = _safe_get(row, "comments_cache")
    # comment_count==0 → beweisbar KEINE Kommentare: ohne Live-Call leer
    # ausliefern. Spart beim Erstaufruf jeder kommentarlosen Idee (der
    # Normalfall) einen ES-Roundtrip — die zuvor gemessenen ~300-450 ms.
    # Konsistent mit dem count-basierten Cache, der bei 0 auf Folgeaufrufen
    # ohnehin leer serviert; neue Kommentare laufen über die App und bumpen
    # comment_count (→ Count-Mismatch → dann wird wieder live geholt).
    comments_cached = cur_count == 0 or (cached_json is not None and cached_count == cur_count)

    # Anhang-Cache (Tier C, Konsum weiter unten) schon HIER prüfen, damit beim
    # Doppel-Miss beide konditionalen Live-Reads (Kommentare + Child-Anhänge)
    # PARALLEL starten (create_task) statt seriell — spart auf dem langsamen
    # Backend eine volle ES-Latenz. Fehlerbehandlung bleibt an den Konsum-Stellen.
    child_atts: list[dict] | None = None
    # SWR: abgelaufener, aber vorhandener Cache — wird sofort ausgeliefert,
    # der Refresh läuft nach der Antwort (Background-Task, s. Konsum-Block).
    stale_child_atts: list[dict] | None = None
    _cc_at = _safe_get(row, "children_cache_at")
    _cc = _safe_get(row, "children_cache")
    if _cc is not None and _cc_at:
        try:
            age = (datetime.now(UTC) - datetime.fromisoformat(_cc_at)).total_seconds()
            _parsed = json.loads(_cc)
            if 0 <= age < CHILD_CACHE_TTL_SECONDS:
                child_atts = _parsed
            else:
                stale_child_atts = _parsed
        except Exception:
            child_atts = None
            stale_child_atts = None
    _comments_task = (
        None
        if comments_cached
        else asyncio.create_task(edu_sharing.client.comments(target_id, auth_header=authorization))
    )
    _children_task = (
        None
        if (child_atts is not None or stale_child_atts is not None)
        else asyncio.create_task(
            edu_sharing.client.list_child_objects(row["id"], auth_header=authorization)
        )
    )

    if comments_cached:
        try:
            # cached_json kann None sein (comment_count==0-Kurzschluss) → leer.
            base["comments"] = json.loads(cached_json) if cached_json else []
        except Exception:
            base["comments"] = []
    else:
        try:
            cm = await _comments_task
            comments_list = (cm or {}).get("comments") or []
            base["comments"] = comments_list
            try:

                def _write_comments_cache():
                    with connect() as con:
                        con.execute(
                            "UPDATE idea SET comments_cache=?, comments_cache_count=? WHERE id=?",
                            (json.dumps(comments_list), cur_count, row["id"]),
                        )

                await asyncio.to_thread(_write_comments_cache)
            except Exception:
                pass  # Cache-Write ist best-effort — die Antwort stimmt trotzdem
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
        try:
            sz = int(sz)
        except (TypeError, ValueError):
            sz = 0
        # download_url ist bei edu-sharing IMMER gesetzt (auch für inhaltslose
        # Idee-Knoten) und daher KEIN verlässliches Signal — sonst erscheint der
        # leere Idee-Knoten selbst als „Datei" mit kaputtem Download. Echter
        # Datei-Inhalt zeigt sich an Bytes (size) oder einem konkreten mimetype.
        return sz > 0 or bool(att.get("mimetype"))

    attachments: list[dict] = []
    if row["kind"] == "io":
        # Der Knoten selbst IST der Anhang. Seine Metadaten wurden oben bereits
        # parallel geholt (live_meta_node) — wiederverwenden statt denselben
        # Knoten ein zweites Mal abzufragen. Fallback auf Cache-Felder, wenn der
        # Live-Read fehlschlug.
        if live_meta_node:
            att = _attachment_from_node(live_meta_node)
        else:
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
                row["id"],
                max_items=50,
                auth_header=authorization,
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
    # Child-IO-Anhänge (Serienobjekte) — Tier C: `list_child_objects` ist der
    # letzte Live-Call der Detailseite. Das Ergebnis mit kurzer TTL cachen, damit
    # unter Last nicht jeder View edu-sharing trifft. Es gibt kein zuverlässiges
    # Änderungssignal (Anhang-Adds bumpen modified_at nicht) → die TTL bound die
    # Staleness einheitlich; bei Cache-Miss/abgelaufen wird live geholt und der
    # Cache neu geschrieben. (Bei kind="io" hängen Children am Knoten selbst, bei
    # kind="collection" am Idee-Knoten = ccm:map — funktioniert für beide.)
    # Invariante wie bei den Kommentaren (B): caller-unabhängiger Cache, sicher
    # weil gecachte Ideen — und damit ihre Anhänge — öffentlich sind.
    # Cache-Check + Task-Start liegen oben beim Kommentar-Block (Parallel-Start
    # beim Doppel-Miss) — hier wird das Ergebnis nur noch konsumiert.
    if child_atts is None and stale_child_atts is not None:
        # Stale-while-revalidate: den abgelaufenen Cache SOFORT ausliefern —
        # kein Aufruf zahlt die ES-Latenz. Der Refresh läuft nach der Antwort
        # (BackgroundTasks); die ES-Last bleibt identisch, nur asynchron.
        # Staleness-Fenster unverändert akzeptabel: App-seitige Anhang-
        # Mutationen invalidieren den Cache sofort (dann greift der
        # synchrone Zweig unten), die TTL bewacht nur Out-of-band-Änderungen.
        child_atts = stale_child_atts
        background_tasks.add_task(_refresh_children_cache_bg, row["id"], authorization)
    elif child_atts is None:
        # Kein Cache (Erstaufruf oder frisch invalidiert) → synchron live holen.
        child_atts = []
        try:
            children = await _children_task
            child_atts = _map_child_attachments(children)
            try:
                await asyncio.to_thread(_store_children_cache, row["id"], child_atts)
            except Exception:
                pass  # Cache-Write best-effort — die Antwort stimmt trotzdem
        except Exception as e:
            # Fehlgeschlagener Live-Call → Leer-Fallback KURZ cachen (Negative-
            # Cache): ohne ihn wiederholt JEDER Detailaufruf den werfenden
            # ES-Call synchron (live gemessen: konstante +0,2 s pro get_idea
            # auf einer Instanz mit 403 auf children). Danach übernimmt SWR.
            # log.info (nicht debug): der Betreiber soll den Grund — z.B.
            # fehlende Gast-Leserechte — in den Pod-Logs sehen.
            log.info("Anhang-Live-Call für %s fehlgeschlagen: %s", row["id"], e)
            child_atts = []
            try:
                await asyncio.to_thread(_store_children_cache_failure, row["id"])
            except Exception:
                pass  # best-effort — nächster Aufruf versucht es erneut
    attachments.extend(child_atts)

    base["attachments"] = attachments
    # Kontaktdaten der Einreichenden NUR für eingeloggte Nutzer:innen ausliefern
    # (serverseitiges Gate gegen Bot-Harvesting). Nur VERIFIZIERTE Logins
    # bekommen das Feld — ein bloßer (fälschbarer) Header reicht nicht. Den
    # Verify-Roundtrip nur auslösen, wenn überhaupt ein Kontakt hinterlegt ist
    # (spart den edu-sharing-Call auf den allermeisten Ideen).
    if authorization:
        try:

            def _read_contact():
                with connect() as con:
                    return con.execute(
                        "SELECT contact FROM idea_contact WHERE idea_id=?", (idea_id,)
                    ).fetchone()

            crow = await asyncio.to_thread(_read_contact)
            # Kontakt = personenbezogen → IMMER passwort-verifiziert (coalesced,
            # läuft nur auf Ideen MIT hinterlegtem Kontakt). Der frühere
            # is_mod_caller-Shortcut entfällt: der ist jetzt stale-tolerant und
            # darf ein sensibles Feld nicht am Passwort-Check vorbei freigeben.
            if crow and crow["contact"] and (await _verify_login(authorization)) is not None:
                base["contact"] = crow["contact"]
        except Exception:
            pass
    # Hinweis für die UI, falls der Reader keinen Zugriff auf Live-Daten hat.
    # Eingeloggte User sehen das normalerweise nicht — deshalb nur bei Gast.
    if is_private and not authorization:
        base["restricted"] = True
    # Bewertungsphase: ist diese Idee aktuell bewertbar? (global + Event-Phase)
    base["rating_open"] = _rating_open_for_events(base.get("events") or [])
    if not base["rating_open"]:
        # Grund mitgeben, damit das Frontend den passenden Hinweis zeigt,
        # ohne auf den (cachebaren) globalen Schalter angewiesen zu sein.
        base["rating_closed_reason"] = (
            "global" if _get_setting("rating_enabled", "1") == "0" else "phase"
        )
    return base


# Selbstregistrierung läuft extern über https://wirlernenonline.de/register/.
# Der edu-sharing /register/v1/register-Endpoint auf redaktion.openeduhub.net
# läuft deterministisch in einen 50s-Server-Disconnect (synchroner Mail-Hook
# hängt). Das WordPress-Plugin auf wirlernenonline.de umgeht das mit eigenem
# Service-Pfad. Bis das server-seitig gefixt ist, leitet das Frontend direkt
# auf das WLO-Formular weiter.


@router.get("/bootstrap", tags=["public"])
def bootstrap():
    """Gebündelter Erststart-Datensatz: liefert in EINER Antwort, was die
    App-Shell beim Laden braucht (topics, meta, phases, events, featured,
    settings).

    Begründung: Hinter einem HTTP/2-Reverse-Proxy teilt sich der Browser EINE
    Verbindung für alle Requests. Feuert die Shell ~6 Init-XHRs gleichzeitig,
    konkurrieren diese mit den Bundle-/Font-Downloads und hungern aus (gemessen
    5–14 s). Ein einziger gebündelter Call entschärft diese Konkurrenz. Die
    Bestandteile sind exakt dieselben (wiederverwendete Query-Funktionen), die
    `meta`-Facetten sind ungefiltert (entspricht `meta({})` der Shell).

    Read-only, kein Auth nötig. `/me` bleibt bewusst SEPARAT (auth-abhängig,
    Live-edu-sharing-Call) und gehört nicht in diesen cachebaren Bootstrap.
    """
    return {
        "topics": list_topics(),
        "meta": meta_facets(None, None, None, None),
        "phases": list_phases(only_active=True),
        "events": _list_events(include_drafts=False, include_archived=True),
        "featured_events": featured_event(),
        "settings": get_settings(),
    }


# ===== Öffentliches User-Profil ====================================


@router.get("/users/{username}", tags=["users"])
def public_user_profile(username: str):
    """Öffentliches Profil — listet die Ideen eines Users + Aggregat-Stats
    + optionale Profil-Felder (display_name, bio, website, role).
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
        last_act = con.execute(
            "SELECT MAX(modified_at) FROM idea WHERE owner_username = ?",
            (uname,),
        ).fetchone()[0]
        meta_row = con.execute(
            "SELECT display_name, bio, website, role FROM user_profile_meta WHERE username=?",
            (uname,),
        ).fetchone()
    if not rows and not last_act and not meta_row:
        raise HTTPException(404, "Kein öffentliches Profil vorhanden")
    meta = (
        dict(meta_row)
        if meta_row
        else {
            "display_name": None,
            "bio": None,
            "website": None,
            "role": None,
        }
    )
    return {
        "username": uname,
        "stats": {
            "ideas": agg["ideas"],
            "comments": agg["comments"],
            "ratings": agg["ratings"],
            "avg_rating": round(float(agg["avg_rating"] or 0.0), 2),
        },
        "last_activity": last_act,
        "profile": meta,
        "ideas": [_row_to_idea(r) for r in rows],
    }
