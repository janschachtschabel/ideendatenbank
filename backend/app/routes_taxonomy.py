"""Taxonomy administration — phases + events (Mod-only CRUD).

Split out of routes.py (behaviour-preserving). Owns the write side of the
taxonomy domain: the ``TaxonomyEntry`` / ``EventEntry`` request models plus the
upsert/delete routes for phases and events and the taxonomy-usage report. When a
phase/event is deleted, its ``phase:<slug>`` / ``event:<slug>`` keyword is purged
from every affected idea in edu-sharing so no orphaned tags resurrect on the next
sync.

The router is mounted back onto the main API router via ``include_router`` in
routes.py, so the public paths (/api/v1/admin/phases…, /api/v1/admin/events…,
/api/v1/admin/taxonomy-usage) stay exactly the same. The read routes
(GET /phases, GET /events, /featured-event) deliberately remain in routes.py for
now — the bootstrap bundle calls them directly.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from . import edu_sharing
from . import sync as sync_mod
from .auth import is_moderator as _is_moderator
from .db import connect
from .routes_common import (
    _escape_like,
    _log_activity,
    _require_moderator,
    _validate_external_url,
)

log = logging.getLogger(__name__)

router = APIRouter()


class TaxonomyEntry(BaseModel):
    slug: str = Field(..., min_length=2, max_length=80, pattern=r"^[a-z0-9][a-z0-9\-]*$")
    label: str = Field(..., min_length=2, max_length=120)
    description: str | None = None
    sort_order: int = 100
    active: bool = True


class EventEntry(TaxonomyEntry):
    """Erweitert TaxonomyEntry um Event-spezifische Lifecycle-Felder."""

    # Lifecycle: draft (Mod sichtbar, Submitter nicht), live (Default),
    # archived (abgelaufen — taucht im UI ausgegraut auf).
    status: Literal["draft", "live", "archived"] = "live"
    # ISO-Zeitstempel; bis dahin im Featured-Slot auf der Startseite.
    featured_until: str | None = None
    # Pro-Event-Override des Bewertungssystems. None/"" = globalen Modus
    # erben. Sonst 'stars' | 'thumbs'.
    voting_mode: Literal["stars", "thumbs", ""] | None = None
    # Bewertungsphase: True = offen (bewertbar), False = gestoppt (z.B.
    # Einreichungsphase). Greift nur, wenn global Bewertungen aktiv sind.
    rating_open: bool = True
    # Optionale Zusatzinfos fürs Promotion-Banner auf der Startseite.
    # Ort, Zeitraum (von–bis, freies Datumsformat/ISO) und Detail-URL.
    location: str | None = Field(default=None, max_length=200)
    date_start: str | None = Field(default=None, max_length=40)
    date_end: str | None = Field(default=None, max_length=40)
    detail_url: str | None = Field(default=None, max_length=500)


class TaxonomySortItem(BaseModel):
    slug: str = Field(..., min_length=1, max_length=80)
    sort_order: int


class TaxonomySortRequest(BaseModel):
    """Bulk-Reihenfolge fürs ▲▼-Umsortieren: setzt sort_order für mehrere
    Einträge in EINEM Call (statt N Einzel-Upserts)."""

    kind: Literal["event", "phase"]
    items: list[TaxonomySortItem] = Field(..., min_length=1, max_length=500)


# ----- Read side: phases + events -------------------------------------------
# Im Submit-Form als Dropdown angeboten und ans `cclom:general_keyword` als
# `phase:<slug>` bzw. `event:<slug>` angehängt. Direkt vom /bootstrap-Bundle
# aufgerufen (list_phases / _list_events / featured_event).


def _list_taxonomy(table: str) -> list[dict]:
    """Schlanke Variante für Phases — ohne Event-spezifische Felder."""
    with connect() as con:
        rows = con.execute(
            f"SELECT slug,label,description,sort_order,active,created_at,created_by "
            f"FROM {table} ORDER BY sort_order, label"
        ).fetchall()
    return [{**dict(r), "active": bool(r["active"])} for r in rows]


def _list_events(include_drafts: bool = False, include_archived: bool = False) -> list[dict]:
    """Event-Listing mit status + featured_until. include_drafts/archived
    sind Mod-Optionen; Default-Anzeige zeigt nur `live`-Events."""
    with connect() as con:
        rows = con.execute(
            "SELECT slug,label,description,sort_order,active,status,"
            "featured_until,voting_mode,rating_open,location,date_start,date_end,detail_url,"
            "created_at,created_by "
            "FROM taxonomy_event ORDER BY sort_order, label"
        ).fetchall()
    items: list[dict] = []
    for r in rows:
        d = {**dict(r), "active": bool(r["active"])}
        d["rating_open"] = bool(r["rating_open"])
        status = d.get("status") or "live"
        d["status"] = status
        if status == "draft" and not include_drafts:
            continue
        if status == "archived" and not include_archived:
            continue
        items.append(d)
    return items


@router.get("/phases", tags=["taxonomy"])
def list_phases(only_active: bool = True):
    items = _list_taxonomy("taxonomy_phase")
    return [i for i in items if i["active"]] if only_active else items


@router.get("/events", tags=["taxonomy"])
async def list_events(
    only_active: bool = True,
    include_drafts: bool = False,
    include_archived: bool = True,
    authorization: str | None = Header(None),
):
    """Default-Sicht: live + archived (Übersicht zeigt auch alte Events,
    Submit-Form filtert clientseitig auf nur live). Drafts nur, wenn der
    Aufrufer Mod ist und das Flag explizit setzt."""
    # Entwürfe (unveröffentlichte Events) nur für Mods — sonst leakt
    # unveröffentlichte Event-Taxonomie (Label, Termine, Ort, Detail-URL) an
    # beliebige Aufrufer. Der ES-Roundtrip läuft nur, wenn Drafts angefragt sind.
    if include_drafts and not await _is_moderator(authorization):
        include_drafts = False
    # Threadpool: öffentliche async-Route — der SQLite-Read darf den Event-Loop
    # nicht blockieren (busy_timeout-Wartezeit würde sonst ALLE Requests treffen).
    items = await asyncio.to_thread(
        _list_events,
        include_drafts=include_drafts,
        include_archived=include_archived,
    )
    if only_active:
        items = [i for i in items if i["active"]]
    return items


@router.get("/events/featured", tags=["taxonomy"])
def featured_event():
    """Liefert ALLE aktuell für die Startseite hervorgehobenen Events.

    Auswahl: status='live', featured_until in der Zukunft. Sortiert nach
    der Endzeit aufsteigend (das am ehesten auslaufende zuerst). Pro Event
    wird der Idee-Zähler mitgegeben, damit das Frontend keinen zweiten
    Roundtrip braucht.

    Rückgabe ist eine LISTE — das Frontend stapelt mehrere Featured-Events
    untereinander. Leere Liste, wenn keins featured ist.
    """
    now_iso = datetime.now(UTC).isoformat()
    out: list[dict] = []
    with connect() as con:
        rows = con.execute(
            "SELECT slug,label,description,sort_order,featured_until,status,"
            "location,date_start,date_end,detail_url "
            "FROM taxonomy_event "
            "WHERE status='live' AND active=1 "
            "  AND featured_until IS NOT NULL AND featured_until > ? "
            "ORDER BY featured_until ASC",
            (now_iso,),
        ).fetchall()
        for row in rows:
            ev = {**dict(row), "active": True}
            # Event-Zugehörigkeit liegt in der JSON-Spalte `events` als
            # blanker Slug (z.B. "hackathoern-3") — NICHT als `event:`-Keyword
            # und NICHT in der `keywords`-Spalte. Gleiches LIKE-Muster wie
            # der Listen-Filter (siehe list_ideas, i.events LIKE '%"slug"%').
            ev["idea_count"] = con.execute(
                "SELECT COUNT(*) FROM idea WHERE COALESCE(hidden,0)=0 AND events LIKE ?",
                (f'%"{row["slug"]}"%',),
            ).fetchone()[0]
            out.append(ev)
    return out


def _upsert_taxonomy(table: str, body: TaxonomyEntry, user: str | None) -> dict:
    with connect() as con:
        existing = con.execute(f"SELECT slug FROM {table} WHERE slug=?", (body.slug,)).fetchone()
        if existing:
            con.execute(
                f"UPDATE {table} SET label=?, description=?, sort_order=?, active=? WHERE slug=?",
                (body.label, body.description, body.sort_order, 1 if body.active else 0, body.slug),
            )
        else:
            from datetime import datetime

            con.execute(
                f"INSERT INTO {table} (slug,label,description,sort_order,active,"
                f"created_at,created_by) VALUES (?,?,?,?,?,?,?)",
                (
                    body.slug,
                    body.label,
                    body.description,
                    body.sort_order,
                    1 if body.active else 0,
                    datetime.now(UTC).isoformat(),
                    user or "anonymous",
                ),
            )
    return {"ok": True, "slug": body.slug}


def _sort_taxonomy(table: str, items: list[TaxonomySortItem]) -> int:
    # `table` stammt aus einer festen Konstante der aufrufenden Route (kein
    # User-Input). Es wird AUSSCHLIESSLICH sort_order gesetzt — Label/Status/
    # Featured/… bleiben unangetastet (der frühere Reorder schrieb je Zeile den
    # vollen Eintrag zurück und konnte nebenläufige Edits überschreiben).
    with connect() as con:
        for it in items:
            con.execute(
                f"UPDATE {table} SET sort_order=? WHERE slug=?",
                (it.sort_order, it.slug),
            )
    return len(items)


def _upsert_event(body: EventEntry, user: str | None) -> dict:
    """Upsert mit Event-spezifischen Feldern (Status + Featured + Voting-Modus)."""
    # Leerstring → NULL (= globalen Modus erben).
    vmode = body.voting_mode or None
    with connect() as con:
        existing = con.execute(
            "SELECT slug FROM taxonomy_event WHERE slug=?", (body.slug,)
        ).fetchone()
        # Leere Strings der optionalen Banner-Felder zu NULL normalisieren.
        location = (body.location or "").strip() or None
        date_start = (body.date_start or "").strip() or None
        date_end = (body.date_end or "").strip() or None
        # http(s)-only — blockt javascript:/data: im später als Link gerenderten
        # Featured-Banner (analog project_url/website).
        detail_url = _validate_external_url(body.detail_url, field="Detail-URL")
        if existing:
            con.execute(
                "UPDATE taxonomy_event SET label=?, description=?, sort_order=?, "
                "active=?, status=?, featured_until=?, voting_mode=?, rating_open=?, "
                "location=?, date_start=?, date_end=?, detail_url=? WHERE slug=?",
                (
                    body.label,
                    body.description,
                    body.sort_order,
                    1 if body.active else 0,
                    body.status,
                    body.featured_until,
                    vmode,
                    1 if body.rating_open else 0,
                    location,
                    date_start,
                    date_end,
                    detail_url,
                    body.slug,
                ),
            )
        else:
            con.execute(
                "INSERT INTO taxonomy_event "
                "(slug,label,description,sort_order,active,status,featured_until,"
                "voting_mode,rating_open,location,date_start,date_end,detail_url,"
                "created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    body.slug,
                    body.label,
                    body.description,
                    body.sort_order,
                    1 if body.active else 0,
                    body.status,
                    body.featured_until,
                    vmode,
                    1 if body.rating_open else 0,
                    location,
                    date_start,
                    date_end,
                    detail_url,
                    datetime.now(UTC).isoformat(),
                    user or "anonymous",
                ),
            )
    return {"ok": True, "slug": body.slug}


@router.put("/admin/taxonomy/sort", tags=["taxonomy"])
async def sort_taxonomy(body: TaxonomySortRequest, authorization: str | None = Header(None)):
    """Setzt sort_order für mehrere Veranstaltungen bzw. Phasen in EINEM Call
    (statt N Einzel-Upserts beim ▲▼-Umsortieren — war ein N+1). Schreibt
    ausschließlich sort_order (kein Voll-Upsert je Zeile → keine Kollision mit
    nebenläufigen Label-/Status-Edits). Eigener Pfad ``/admin/taxonomy/sort`` —
    kein ``{slug}``-Routing-Konflikt."""
    await _require_moderator(authorization)
    table = "taxonomy_event" if body.kind == "event" else "taxonomy_phase"
    n = await asyncio.to_thread(_sort_taxonomy, table, body.items)
    await asyncio.to_thread(
        _log_activity,
        action=f"taxonomy_{body.kind}_changed",
        authorization=authorization,
        is_mod=True,
        target_type="taxonomy",
        detail={"action": "sorted", "count": n},
    )
    return {"ok": True, "updated": n}


@router.put("/admin/events/{slug}", tags=["taxonomy"])
async def upsert_event(slug: str, body: EventEntry, authorization: str | None = Header(None)):
    user = await _require_moderator(authorization)
    if slug != body.slug:
        raise HTTPException(400, "URL-Slug und Body-Slug stimmen nicht überein")
    res = await asyncio.to_thread(_upsert_event, body, user)
    await asyncio.to_thread(
        _log_activity,
        action="taxonomy_event_changed",
        authorization=authorization,
        is_mod=True,
        target_type="taxonomy",
        target_id=slug,
        target_label=body.label,
        detail={
            "active": body.active,
            "sort_order": body.sort_order,
            "status": body.status,
            "featured_until": body.featured_until,
        },
    )
    return res


async def _purge_tag_from_ideas(kind: str, slug: str, auth: str | None) -> dict:
    """Entfernt das `phase:<slug>` bzw. `event:<slug>` Keyword von ALLEN
    betroffenen Ideen-Knoten in edu-sharing und räumt den Cache nach. Wird
    beim Löschen einer Phase/Veranstaltung aufgerufen, damit keine verwaisten
    Tags an Ideen zurückbleiben (die sonst beim nächsten Sync wiederkämen).
    Best-effort: Fehler pro Knoten werden gezählt, brechen den Lauf nicht ab."""
    # Slug defensiv prüfen (kommt als ungeprüfter Pfad-Param) → kein LIKE-
    # Over-Match, kein unsinniger Massen-Walk.
    if not re.fullmatch(r"[a-z0-9][a-z0-9\-]*", slug or ""):
        return {"removed": 0, "failed": 0, "total": 0}
    tag = f"{kind}:{slug}".strip().lower()
    # edu-sharing-Knoten tragen teils Legacy-Slugs (z.B. `event:hackthoern-01`),
    # die wir beim Sync auf den kanonischen Slug normalisieren (EVENT_SLUG_ALIASES).
    # Beim Entfernen müssen daher AUCH die Alias-Varianten gestrippt werden —
    # sonst bleibt das rohe Keyword am Knoten und der Event taucht beim nächsten
    # Sync wieder auf (Cache wird geleert, ES nicht → "Wiederauferstehung").
    remove_literals = {tag}
    if kind == "event":
        remove_literals |= {
            f"event:{raw}".lower()
            for raw, canon in sync_mod.EVENT_SLUG_ALIASES.items()
            if canon == slug
        }
    PURGE_MAX = 5000  # Sicherheits-Obergrenze gegen unbeabsichtigte Riesen-Walks

    def _read_affected_ids():
        with connect() as con:
            if kind == "phase":
                return con.execute(
                    "SELECT id FROM idea WHERE phase = ? LIMIT ?", (slug, PURGE_MAX)
                ).fetchall()
            return con.execute(
                "SELECT id FROM idea WHERE events LIKE ? ESCAPE '\\' LIMIT ?",
                (f'%"{_escape_like(slug)}"%', PURGE_MAX),
            ).fetchall()

    rows = await asyncio.to_thread(_read_affected_ids)
    ids = [r["id"] for r in rows]
    removed = 0
    failed = 0
    for nid in ids:
        try:
            meta = await edu_sharing.client.node_metadata(nid, auth_header=auth)
            props = (meta.get("node") or {}).get("properties") or {}
            kws = list(props.get("cclom:general_keyword") or [])
            new_kws = [k for k in kws if str(k).strip().lower() not in remove_literals]
            if len(new_kws) != len(kws):
                await edu_sharing.client.update_metadata(
                    nid, {"cclom:general_keyword": new_kws}, auth_header=auth
                )
            def _strip_tag_in_cache(node_id: str):
                with connect() as con:
                    if kind == "phase":
                        con.execute("UPDATE idea SET phase = NULL WHERE id = ?", (node_id,))
                    else:
                        row = con.execute(
                            "SELECT events FROM idea WHERE id = ?", (node_id,)
                        ).fetchone()
                        try:
                            evs = [e for e in json.loads(row["events"] or "[]") if e != slug]
                        except Exception:
                            evs = []
                        con.execute(
                            "UPDATE idea SET events = ? WHERE id = ?",
                            (json.dumps(evs), node_id),
                        )

            await asyncio.to_thread(_strip_tag_in_cache, nid)
            removed += 1
        except Exception as e:  # noqa: BLE001 — best-effort, einzelne Knoten dürfen scheitern
            log.warning("purge tag %s from %s failed: %s", tag, nid, e)
            failed += 1
    return {"removed": removed, "failed": failed, "total": len(ids)}


@router.get("/admin/taxonomy-usage", tags=["taxonomy"])
async def taxonomy_usage(authorization: str | None = Header(None)):
    """Wie viele Ideen tragen aktuell welche Phase / Veranstaltung? Für die
    Lösch-Warnung und die Nutzungs-Anzeige im Mod-Bereich. Nur Mod."""
    await _require_moderator(authorization)

    def _read_usage():
        with connect() as con:
            prows = con.execute(
                "SELECT phase AS slug, COUNT(*) AS n FROM idea "
                "WHERE phase IS NOT NULL AND phase <> '' GROUP BY phase"
            ).fetchall()
            erows = con.execute(
                "SELECT events FROM idea WHERE events IS NOT NULL AND events NOT IN ('', '[]')"
            ).fetchall()
        return prows, erows

    prows, erows = await asyncio.to_thread(_read_usage)
    phases = {r["slug"]: r["n"] for r in prows}
    events: dict[str, int] = {}
    for r in erows:
        try:
            for ev in json.loads(r["events"] or "[]"):
                events[ev] = events.get(ev, 0) + 1
        except Exception:
            pass
    return {"phases": phases, "events": events}


@router.delete("/admin/events/{slug}", tags=["taxonomy"])
async def delete_event(slug: str, authorization: str | None = Header(None)):
    await _require_moderator(authorization)
    # Erst die event:<slug>-Tags von allen Ideen entfernen, dann die Taxonomie.
    purge = await _purge_tag_from_ideas("event", slug, authorization)
    # Taxonomie nur entfernen, wenn ALLE Tags weg sind — sonst bliebe ein
    # verwaister Tag ohne Label hängen; bei Teil-Fehler Eintrag behalten,
    # damit die Mod erneut löschen kann.
    if purge["failed"] == 0:
        def _delete_event_row():
            with connect() as con:
                con.execute("DELETE FROM taxonomy_event WHERE slug=?", (slug,))

        await asyncio.to_thread(_delete_event_row)
    await asyncio.to_thread(
        _log_activity,
        action="taxonomy_event_deleted",
        authorization=authorization,
        is_mod=True,
        target_type="taxonomy",
        target_id=slug,
        detail={"untagged": purge["removed"], "failed": purge["failed"]},
    )
    return {"ok": purge["failed"] == 0, **purge}


@router.put("/admin/phases/{slug}", tags=["taxonomy"])
async def upsert_phase(slug: str, body: TaxonomyEntry, authorization: str | None = Header(None)):
    user = await _require_moderator(authorization)
    if slug != body.slug:
        raise HTTPException(400, "URL-Slug und Body-Slug stimmen nicht überein")
    res = await asyncio.to_thread(_upsert_taxonomy, "taxonomy_phase", body, user)
    await asyncio.to_thread(
        _log_activity,
        action="taxonomy_phase_changed",
        authorization=authorization,
        is_mod=True,
        target_type="taxonomy",
        target_id=slug,
        target_label=body.label,
        detail={"active": body.active, "sort_order": body.sort_order},
    )
    return res


@router.delete("/admin/phases/{slug}", tags=["taxonomy"])
async def delete_phase(slug: str, authorization: str | None = Header(None)):
    await _require_moderator(authorization)
    # Erst die phase:<slug>-Tags von allen Ideen entfernen, dann die Taxonomie.
    purge = await _purge_tag_from_ideas("phase", slug, authorization)
    # Taxonomie nur entfernen, wenn ALLE Tags weg sind (s. delete_event).
    if purge["failed"] == 0:
        def _delete_phase_row():
            with connect() as con:
                con.execute("DELETE FROM taxonomy_phase WHERE slug=?", (slug,))

        await asyncio.to_thread(_delete_phase_row)
    await asyncio.to_thread(
        _log_activity,
        action="taxonomy_phase_deleted",
        authorization=authorization,
        is_mod=True,
        target_type="taxonomy",
        target_id=slug,
        detail={"untagged": purge["removed"], "failed": purge["failed"]},
    )
    return {"ok": purge["failed"] == 0, **purge}
