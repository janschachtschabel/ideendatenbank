"""Inbox + cache reconciliation — the moderation "Postfach" domain.

Split out of routes_moderation.py (behaviour-preserving). Owns the pending-
submissions inbox (listing, per-item preview, delete) and the cache↔edu-sharing
reconciliation (sync-diff dry-run + cleanup of orphaned cache rows). Mounted
onto the main router via ``include_router`` in routes.py — public paths
(/api/v1/inbox…, /api/v1/moderation/sync-diff…) stay unchanged.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

import httpx
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from . import edu_sharing
from .config import settings
from .db import connect
from .routes_common import (
    _attachment_from_node,
    _log_activity,
    _purge_idea_cache,
    _require_moderator,
)

log = logging.getLogger(__name__)

router = APIRouter()



# ===== Postfach / Inbox (Mod-only) ========================================


@router.get("/inbox", tags=["moderation"])
async def list_inbox(
    # Default 200: Inbox passt in eine Seite, "Alle" zeigt wirklich alle.
    # Niedrigeres Limit muss der Caller explizit setzen.
    limit: int = Query(200, ge=1, le=500),
    filter: Literal[
        "uncategorized",  # noch nicht in einer Sammlung (Default — was zu tun ist)
        "all",  # alle ccm:io der Inbox
        "categorized",  # bereits irgendwo als Reference verlinkt
        "app-submits",  # nur App-Einreichungen mit phase:/event:-Markern
    ] = Query("uncategorized", description="Sichtfilter über die Inbox"),
    authorization: str | None = Header(None),
):
    await _require_moderator(authorization)
    """List ccm:io nodes in the moderation inbox.

    Vier Sichten via `?filter=`:
      - `uncategorized` (Default): noch keiner Sammlung als Reference zugeordnet.
        Das ist die operative Arbeitsliste — diese Items müssen einsortiert werden.
      - `all`: alle ccm:io der Inbox, unabhängig vom Sammlungs-Status.
      - `categorized`: nur die schon als Reference irgendwo gelandet sind
        (Übersicht über das, was bereits eingepflegt wurde).
      - `app-submits`: nur Items mit `phase:`/`event:`/`target-topic:`-
        Keywords aus dem App-Einreichungs-Pfad.
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
    def _read_cataloged_originals():
        with connect() as con:
            # original_id -> Liste der Herausforderungen (topic_id), in denen das
            # Original referenziert ist. Dient (a) dem in_collection-Flag und (b)
            # der Anzeige der konkreten Einsortierung im Postfach (ein Original kann
            # in mehreren Herausforderungen liegen).
            cataloged: dict[str, list[str]] = {}
            for r in con.execute(
                "SELECT original_id, topic_id FROM idea WHERE original_id IS NOT NULL"
            ).fetchall():
                oid = r["original_id"]
                if not oid:
                    continue
                lst = cataloged.setdefault(oid, [])
                if r["topic_id"] and r["topic_id"] not in lst:
                    lst.append(r["topic_id"])
            return cataloged

    cataloged = await asyncio.to_thread(_read_cataloged_originals)

    items = []
    for n in raw_nodes:
        if n.get("type") != "ccm:io":
            continue
        node_id = (n.get("ref") or {}).get("id")
        is_cataloged = bool(node_id and node_id in cataloged)
        props = n.get("properties") or {}
        kws = props.get("cclom:general_keyword") or []
        if isinstance(kws, str):
            kws = [kws]
        has_marker = any(
            str(k).lower().startswith(p) for k in kws for p in ("phase:", "event:", "target-topic:")
        )
        # Sichtfilter anwenden
        if filter == "uncategorized" and is_cataloged:
            continue
        if filter == "categorized" and not is_cataloged:
            continue
        if filter == "app-submits" and not has_marker:
            continue
        # filter == "all" → kein zusätzliches Skip

        phase = next(
            (k[len("phase:") :] for k in kws if str(k).lower().startswith("phase:")),
            None,
        )
        event = next(
            (k[len("event:") :] for k in kws if str(k).lower().startswith("event:")),
            None,
        )
        target_topic = next(
            (k[len("target-topic:") :] for k in kws if str(k).lower().startswith("target-topic:")),
            None,
        )
        items.append(
            {
                "id": (n.get("ref") or {}).get("id"),
                "name": n.get("name"),
                "title": n.get("title") or (props.get("cm:title") or [None])[0] or n.get("name"),
                "description": (props.get("cclom:general_description") or [None])[0]
                or (props.get("cm:description") or [None])[0],
                "author": (props.get("ccm:author_freetext") or [None])[0],
                "project_url": (props.get("ccm:wwwurl") or [None])[0],
                "phase": phase,
                "event": event,
                "target_topic": target_topic,
                "created_at": n.get("createdAt"),
                "in_collection": is_cataloged,
                "has_app_marker": has_marker,
                # Konkrete Herausforderung(en), in denen das Item schon liegt
                # (topic_id-Liste; vom Frontend zu „Thema › Herausforderung" aufgelöst).
                "placements": cataloged.get(node_id, []),
            }
        )
    # Newest first
    items.sort(key=lambda x: x["created_at"] or "", reverse=True)
    sliced = items[:limit]
    return {
        # `count` = Anzahl tatsächlich zurückgegebener Items (post-slice).
        # `total` = wieviele matchen den Filter überhaupt (pre-slice).
        # Bei Konsumenten wie der Mod-UI kann so „N von M" angezeigt werden.
        "count": len(sliced),
        "total": len(items),
        "items": sliced,
        "filter": filter,
    }


@router.get("/inbox/{node_id}/preview", tags=["moderation"])
async def inbox_item_preview(
    node_id: str,
    authorization: str | None = Header(None),
):
    """Vollständige Review-Vorschau einer Inbox-Einreichung — direkt aus
    edu-sharing, Cache-unabhängig.

    `GET /ideas/{id}` quittiert noch nicht einsortierte Inbox-Knoten mit 404
    (es gibt keine Cache-Row, und `refresh_idea` überspringt Inbox-Knoten
    bewusst, damit sie nicht im Public-Cache landen). Für die Moderation ist
    die Detailsicht aber gerade bei den UNeinsortierten Einreichungen nötig —
    das ist die operative Arbeitsliste. Dieser Endpoint liefert daher alles
    zum Prüfen + Freigeben:
      - Beschreibung, Schlagwörter (ohne interne `*:`-Marker),
      - Phase + Veranstaltung(en),
      - den vom Einreicher gewünschten Themenbereich/Herausforderung
        (`target-topic:`) und den App-Einreicher (`submitter:`),
      - Anhänge (Knoten selbst, falls er Datei-Inhalt trägt, + Child-Objekte)
        inkl. Download-/Vorschau-Links,
      - Owner + Zeitstempel + ggf. Bewertung.
    Nur Moderation."""
    await _require_moderator(authorization)
    try:
        meta = await edu_sharing.client.node_metadata(node_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:180]}")
    node = (meta or {}).get("node") or {}
    if not node:
        raise HTTPException(404, "Einreichung nicht gefunden")
    props = node.get("properties") or {}

    def _first(key: str) -> str | None:
        v = props.get(key)
        if isinstance(v, list):
            return v[0] if v else None
        return v

    kws_raw = props.get("cclom:general_keyword") or []
    if isinstance(kws_raw, str):
        kws_raw = [kws_raw]
    kws = [str(k) for k in kws_raw if k]
    internal = ("phase:", "event:", "target-topic:", "submitter:", "topic:")
    phase = next((k[len("phase:") :] for k in kws if k.lower().startswith("phase:")), None)
    events = [k[len("event:") :] for k in kws if k.lower().startswith("event:")]
    target_topic = next(
        (k[len("target-topic:") :] for k in kws if k.lower().startswith("target-topic:")),
        None,
    )
    submitter = next(
        (k[len("submitter:") :] for k in kws if k.lower().startswith("submitter:")),
        None,
    )
    keywords = [k for k in kws if not k.lower().startswith(internal)]

    preview = node.get("preview") or {}
    created_by = node.get("createdBy") or {}
    owner_display = (
        " ".join(
            x
            for x in (
                (created_by.get("firstName") or "").strip(),
                (created_by.get("lastName") or "").strip(),
            )
            if x
        ).strip()
        or None
    )

    # Anhänge: der Knoten selbst (nur wenn er echten Datei-Inhalt trägt — reine
    # Brainstorm-Karten ohne Bytes/Link nicht listen) + Child-Objekte (Serie).
    attachments: list[dict] = []
    self_att = _attachment_from_node(node)
    # Nur listen, wenn der Knoten echten Datei-Inhalt trägt — der leere
    # Idee-Knoten selbst (reine Karte) hätte sonst einen kaputten Download.
    # download_url ist immer gesetzt und daher kein verlässliches Signal.
    _self_sz = self_att.get("size") or 0
    try:
        _self_sz = int(_self_sz)
    except (TypeError, ValueError):
        _self_sz = 0
    if _self_sz > 0 or self_att.get("mimetype"):
        attachments.append(self_att)
    try:
        for child in await edu_sharing.client.list_child_objects(
            node_id, auth_header=authorization
        ):
            a = _attachment_from_node(child)
            a["is_child_object"] = True
            attachments.append(a)
    except Exception:
        pass

    rating_overall = (node.get("rating") or {}).get("overall") or {}

    # Kontaktdaten (App-DB, opt-in vom Einreicher) — der Caller ist bereits als
    # Moderator verifiziert (_require_moderator macht einen echten
    # my_memberships-Roundtrip), daher hier direkt ausliefern. Moderation
    # braucht den Kontakt für Rückfragen vor der Freigabe. Liegt NICHT in
    # edu-sharing, daher separater App-DB-Lookup über die Knoten-ID.
    contact = None
    try:
        def _read_contact():
            with connect() as con:
                return con.execute(
                    "SELECT contact FROM idea_contact WHERE idea_id=?", (node_id,)
                ).fetchone()

        crow = await asyncio.to_thread(_read_contact)
        if crow and crow["contact"]:
            contact = crow["contact"]
    except Exception:
        pass

    return {
        "id": node_id,
        "title": node.get("title") or _first("cm:title") or node.get("name"),
        "description": _first("cclom:general_description") or _first("cm:description"),
        "author": _first("ccm:author_freetext"),
        "project_url": _first("ccm:wwwurl"),
        "owner_username": owner_display or _first("cm:creator"),
        "contact": contact,
        "phase": phase,
        "events": events,
        "target_topic": target_topic,
        "submitter": submitter,
        "keywords": keywords,
        "preview_url": preview.get("url") if not preview.get("isIcon") else None,
        "attachments": attachments,
        "created_at": node.get("createdAt"),
        "modified_at": node.get("modifiedAt"),
        "rating_avg": float(rating_overall.get("rating") or 0.0) or None,
        "rating_count": int(rating_overall.get("count") or 0) or None,
    }


# ===== Sync-Diff: Cache ↔ edu-sharing abgleichen (Mod-only) ===============


async def _live_referenced_ideas() -> dict[str, dict]:
    """Sammelt alle in Herausforderungen referenzierten Ideen-Knoten
    (id → {title, challenge}) — identischer Walk wie der Sync, aber read-only.
    Wirft bei edu-sharing-Fehlern, damit Aufrufer NICHT auf unvollständiger
    Datenbasis urteilen/löschen."""
    live: dict[str, dict] = {}
    themes = await edu_sharing.client.collection_subcollections(
        settings.ideendb_root_collection_id, max_items=100
    )
    for theme in themes.get("collections") or []:
        tid = (theme.get("ref") or {}).get("id")
        if not tid:
            continue
        challenges = await edu_sharing.client.collection_subcollections(tid, max_items=100)
        for ch in challenges.get("collections") or []:
            chid = (ch.get("ref") or {}).get("id")
            if not chid:
                continue
            ch_props = ch.get("properties") or {}
            ch_title = ch.get("title") or (ch_props.get("cm:title") or [None])[0] or ch.get("name")
            refs = await edu_sharing.client.collection_references(chid, max_items=200)
            for rn in refs.get("references") or []:
                rid = (rn.get("ref") or {}).get("id")
                if not rid:
                    continue
                rp = rn.get("properties") or {}
                title = rn.get("title") or (rp.get("cm:title") or [None])[0] or rn.get("name")
                live[rid] = {"title": title, "challenge": ch_title}
    return live


async def _annotate_stale_status(items: list[dict], authorization: str | None) -> None:
    """Reichert echte Karteileichen um ihren edu-sharing-Status an:
      - `deleted`  — Knoten existiert nicht mehr (nur „aus Cache entfernen")
      - `in_inbox` — existiert UND liegt im Inbox-Ordner (nur die Referenzierung
                     fehlt → „wieder einsortieren" möglich)
      - `orphaned` — existiert, hängt aber nirgends (einsortieren oder entfernen)
      - `unknown`  — nicht prüfbar
    Prüft mit der Mod-Auth (nicht Gast), damit nicht-öffentliche Knoten nicht
    fälschlich als gelöscht gelten. Geprüft wird `source_id` (Inbox-Original)."""
    if not items:
        return
    inbox_ids: set[str] | None = set()
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
            for n in ns:
                nid = (n.get("ref") or {}).get("id")
                if nid:
                    inbox_ids.add(nid)
            if len(ns) < 200:
                break
    except Exception as e:
        log.warning("stale-status: Inbox-Liste nicht ladbar: %s", e)
        inbox_ids = None
    for it in items:
        src = it.get("source_id") or it["id"]
        try:
            await edu_sharing.client.node_metadata(src, auth_header=authorization)
            exists: bool | None = True
        except httpx.HTTPStatusError as e:
            exists = False if e.response.status_code == 404 else None
        except Exception:
            exists = None
        if exists is False:
            it["node_status"] = "deleted"
        elif exists and inbox_ids is not None and src in inbox_ids:
            it["node_status"] = "in_inbox"
        elif exists:
            it["node_status"] = "orphaned"
        else:
            it["node_status"] = "unknown"


@router.get("/moderation/sync-diff", tags=["moderation"])
async def sync_diff(authorization: str | None = Header(None)):
    """Dry-Run-Abgleich App-Cache ↔ edu-sharing zum Aufspüren von Sync-
    Problemen. Läuft denselben Sammlungs-Walk wie der Sync (ohne zu schreiben)
    und vergleicht das Ergebnis mit der `idea`-Cache-Tabelle:
      - `missing`: in einer Herausforderung referenziert, aber NICHT im Cache
        (Sync hat sie (noch) nicht erfasst → einmal „edu-sharing Sync auslösen").
      - `stale`: im Cache, aber in KEINER Sammlung mehr referenziert
        (Knoten gelöscht/ausgehängt → Karteileiche). Wird NICHT automatisch vom
        Sync entfernt → dafür „Karteileichen bereinigen" (POST .../cleanup).
    Nur Mod."""
    await _require_moderator(authorization)
    try:
        live = await _live_referenced_ideas()
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"edu-sharing Fehler: {e.response.status_code}")

    def _read_sync_diff_rows():
        with connect() as con:
            return con.execute(
                "SELECT id, title, COALESCE(hidden, 0) AS hidden, original_id FROM idea"
            ).fetchall()

    rows = await asyncio.to_thread(_read_sync_diff_rows)
    cache = {r["id"]: r["title"] for r in rows}
    hidden_ids = {r["id"] for r in rows if r["hidden"]}
    orig_of = {r["id"]: r["original_id"] for r in rows}
    missing = [
        {"id": rid, "title": v["title"], "challenge": v["challenge"]}
        for rid, v in live.items()
        if rid not in cache
    ]
    # `stale`: im Cache, aber nirgends mehr referenziert. Versteckte Ideen
    # landen hier ebenfalls (ihre edu-sharing-Referenz wurde mit-entfernt),
    # sind aber KEIN Sync-Problem — daher als `hidden` markiert und aus der
    # in_sync-Bewertung ausgenommen, damit sie die Mod nicht verwirren.
    # `source_id` = Inbox-Original (für Status-Prüfung + Wieder-Einsortieren).
    stale = [
        {
            "id": cid,
            "title": cache[cid],
            "hidden": cid in hidden_ids,
            "source_id": orig_of.get(cid) or cid,
        }
        for cid in cache
        if cid not in live
    ]
    real_stale = [s for s in stale if not s["hidden"]]
    # ES-Status der echten Karteileichen ermitteln (gelöscht / in Inbox / verwaist).
    await _annotate_stale_status(real_stale, authorization)
    return {
        "missing": missing,
        "stale": stale,
        "hidden_stale_count": len(stale) - len(real_stale),
        "live_count": len(live),
        "cache_count": len(cache),
        "in_sync": not missing and not real_stale,
    }


class CleanupRequest(BaseModel):
    # Optional: nur diese (echten) Karteileichen entfernen. Leer/None → alle.
    ids: list[str] | None = None


@router.post("/moderation/sync-diff/cleanup", tags=["moderation"])
async def sync_diff_cleanup(
    body: CleanupRequest | None = None,
    authorization: str | None = Header(None),
):
    """Entfernt „Karteileichen": Cache-Ideen, die in KEINER Sammlung mehr
    referenziert sind (Knoten in edu-sharing gelöscht/ausgehängt). Mit `ids`
    nur die genannten (sofern wirklich verwaist), sonst alle nicht-versteckten.
    Versteckte Ideen (Soft-Hide) bleiben unangetastet. Läuft den vollständigen
    Sammlungs-Walk; bei einem edu-sharing-Fehler wird ABGEBROCHEN und nichts
    gelöscht (kein Löschen auf unvollständiger Datenbasis). Selbstheilend: würde
    eine noch referenzierte Idee fälschlich getroffen, holt der nächste Sync sie
    zurück. Nur Mod."""
    await _require_moderator(authorization)
    try:
        live = await _live_referenced_ideas()
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"edu-sharing Fehler: {e.response.status_code} — nichts gelöscht")

    want = set(body.ids) if body and body.ids else None

    def _cleanup_sync_diff_rows():
        with connect() as con:
            rows = con.execute("SELECT id, title FROM idea WHERE COALESCE(hidden, 0) = 0").fetchall()
            removed = [
                {"id": r["id"], "title": r["title"]}
                for r in rows
                if r["id"] not in live and (want is None or r["id"] in want)
            ]
            for item in removed:
                _purge_idea_cache(con, item["id"])
            return removed

    removed = await asyncio.to_thread(_cleanup_sync_diff_rows)
    await asyncio.to_thread(
        _log_activity,
        action="sync_diff_cleanup",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        detail={"removed": len(removed), "ids": [r["id"] for r in removed][:50]},
    )
    return {"removed": len(removed), "items": removed}


@router.delete("/inbox/{node_id}", tags=["moderation"])
async def delete_inbox_item(
    node_id: str,
    authorization: str | None = Header(None),
):
    """Delete a pending inbox submission. Caller muss Moderator sein."""
    await _require_moderator(authorization)
    try:
        result = await edu_sharing.client.delete_node(node_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:180]}")
    await asyncio.to_thread(
        _log_activity,
        action="inbox_deleted",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        target_id=node_id,
    )
    return result
