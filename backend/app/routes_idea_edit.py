"""Idea lifecycle writes — edit metadata, delete, manual refresh, backfill.

Split out of routes.py (behaviour-preserving). Owns mutations of an existing
idea's metadata and lifecycle: the PATCH edit (keyword-merge strategy, phase
workflow gating, silent-permission-denial read-back), the DELETE (including
the inbox-original cleanup with multi-reference protection), the owner/mod
manual cache refresh, and the moderator bulk backfill of the WLO publication
mandatory fields.

The router is mounted back onto the main API router via ``include_router`` in
routes.py, so the public paths (PATCH/DELETE /api/v1/ideas/{id}, /refresh,
/admin/ideas/backfill-publication-meta) stay exactly the same.
"""

from __future__ import annotations

import asyncio
import logging

import httpx
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from . import edu_sharing
from . import sync as sync_mod
from .auth import can_edit_idea as _can_edit_idea
from .auth import is_moderator as _is_moderator
from .auth import is_owner_or_mod as _is_owner_or_mod
from .db import connect
from .routes_common import (
    _is_allowed_phase_transition,
    _log_activity,
    _phase_order,
    _purge_idea_cache,
    _require_moderator,
    _validate_external_url,
)

log = logging.getLogger(__name__)

router = APIRouter()


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

    allowed, user, is_owner_or_mod = await _can_edit_idea(idea_id, authorization, verified=True)
    if not allowed:
        raise HTTPException(
            403,
            "Diese Idee gehört nicht dir. Nur Einreicher:in, angenommene "
            "Mitwirkende oder die Moderation können sie bearbeiten.",
        )

    # Mitwirkende (angenommene Mithackende, nicht Owner/Mod) dürfen Inhalt
    # bearbeiten, aber NICHT die Kuration: Phase + Veranstaltung bleiben dem
    # Owner/Mod vorbehalten. Bestehende phase:/event:-Keywords werden in die
    # Keyword-Liste zurückgemischt, damit sie nicht verloren gehen.
    if not is_owner_or_mod:
        body.phase = None
        body.event = None
        body.events = None
        if body.keywords is not None:
            try:
                _m = await edu_sharing.client.node_metadata(idea_id, auth_header=authorization)
                _kw = ((_m.get("node") or {}).get("properties") or {}).get(
                    "cclom:general_keyword"
                ) or []
                if isinstance(_kw, str):
                    _kw = [_kw]
                body.keywords = list(body.keywords) + [
                    k for k in _kw if str(k).lower().startswith(("phase:", "event:"))
                ]
            except Exception:
                pass

    def _read_cached_idea():
        with connect() as con:
            return con.execute(
                "SELECT main_content_id, kind, phase FROM idea WHERE id=?", (idea_id,)
            ).fetchone()

    row = await asyncio.to_thread(_read_cached_idea)

    # Fallback wenn der Cache den Node noch nicht kennt (z.B. unmittelbar
    # nach einem POST /ideas vor dem nächsten Sync): direkt am Node editieren.
    if not row:
        target_node = idea_id
        current_phase: str | None = None
    else:
        target_node = (
            row["main_content_id"]
            if row["kind"] == "collection" and row["main_content_id"]
            else idea_id
        )
        current_phase = row["phase"]

    # Phase-Status-Workflow (Variante A): Owner darf nur eine Stufe vorwärts,
    # Mod darf alles. Der Workflow-Check läuft *bevor* ES kontaktiert wird.
    if body.phase is not None and body.phase != current_phase:
        is_mod = await _is_moderator(authorization)

        def _read_phase_order():
            with connect() as con:
                return _phase_order(con)

        order = await asyncio.to_thread(_read_phase_order)
        ok, reason = _is_allowed_phase_transition(
            current=current_phase,
            target=body.phase,
            is_mod=is_mod,
            order=order,
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
        # Leerstring = explizites Entfernen, ansonsten http(s)-validieren.
        if body.project_url.strip() == "":
            props["ccm:wwwurl"] = []
        else:
            props["ccm:wwwurl"] = [_validate_external_url(body.project_url, field="Projekt-URL")]
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
    if (
        body.keywords is not None
        or body.phase is not None
        or body.event is not None
        or body.events is not None
    ):
        if body.keywords is not None:
            base_kws = list(body.keywords)
        else:
            # Quick-Edit: alte Liste live holen, damit Bestand erhalten bleibt
            try:
                cur_meta = await edu_sharing.client.node_metadata(
                    target_node,
                    auth_header=authorization,
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
        kws = [k for k in base_kws if not k.lower().startswith(("phase:", "event:"))]
        if body.phase:
            kws.append(f"phase:{body.phase}")
        # Events: events[] hat Vorrang, sonst legacy event-Feld.
        # Wenn weder events noch event mit-geschickt wurden, bleiben die
        # alten Event-Keywords aus base_kws erhalten — wir müssen sie also
        # zurück-mergen, sonst gehen sie verloren beim Phase-Quick-Edit.
        if body.events is not None or body.event is not None:
            evs = body.events if body.events is not None else ([body.event] if body.event else [])
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
        await edu_sharing.client.update_metadata(target_node, props, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Du hast keine Berechtigung, diese Idee zu bearbeiten.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    # Read-Back: edu-sharing antwortet bei fehlenden Schreibrechten
    # gelegentlich mit 200 OK, persistiert die Änderungen aber stillschweigend
    # NICHT (silent permission denial). Wir prüfen daher kurz, ob die
    # Properties wirklich angekommen sind. Wenn nicht: harten 403 mit
    # klarer Meldung an den User.
    try:
        verify = await edu_sharing.client.node_metadata(
            target_node,
            auth_header=authorization,
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
                    idea_id,
                    expected,
                    actual,
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
    await asyncio.to_thread(
        _log_activity,
        action="idea_edited",
        authorization=authorization,
        target_type="idea",
        target_id=idea_id,
        target_label=body.title,
        detail={
            k: v
            for k, v in body.model_dump(exclude_none=True).items()
            if k in {"title", "phase", "event", "events"}
        },
    )
    # Separater Phase-Wechsel-Eintrag mit Old/New, falls Phase wirklich gewechselt
    if body.phase is not None and body.phase != current_phase:
        await asyncio.to_thread(
            _log_activity,
            action="phase_changed",
            authorization=authorization,
            target_type="idea",
            target_id=idea_id,
            target_label=body.title,
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

    allowed, user, is_mod = await _is_owner_or_mod(idea_id, authorization, verified=True)
    if not allowed:
        raise HTTPException(
            403,
            "Diese Idee gehört nicht dir. Nur der Einreicher oder die Moderation kann sie löschen.",
        )

    # Titel + Original-ID VOR dem Löschen retten (für Log + Original-Cleanup).
    def _read_delete_preflight():
        with connect() as con:
            return con.execute("SELECT title, original_id FROM idea WHERE id = ?", (idea_id,)).fetchone()

    pre = await asyncio.to_thread(_read_delete_preflight)
    deleted_title: str | None = pre["title"] if pre else None
    original_id: str | None = pre["original_id"] if pre else None

    try:
        await edu_sharing.client.delete_node(idea_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, diese Idee zu löschen.")
        if e.response.status_code == 404:
            # Schon weg — Cache nachziehen, dem Caller OK zurückgeben.
            pass
        else:
            raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    # Original (Inbox-Knoten) mitlöschen, damit keine — durch den Publish-Fix
    # jetzt ÖFFENTLICHE — Waise zurückbleibt. `delete_node(idea_id)` löscht nur
    # die Sammlungs-Referenz. NUR löschen, wenn (a) idea_id wirklich eine
    # Referenz war (eigenes Original vorhanden) und (b) keine ANDERE Referenz
    # dieses Original noch nutzt (Mehrfach-Referenz-Schutz über die App-DB).
    if original_id and original_id != idea_id:
        def _count_other_references():
            with connect() as con:
                return con.execute(
                    "SELECT COUNT(*) AS c FROM idea WHERE original_id = ? AND id != ?",
                    (original_id, idea_id),
                ).fetchone()["c"]

        others = await asyncio.to_thread(_count_other_references)
        if others == 0:
            try:
                await edu_sharing.client.delete_node(original_id, auth_header=authorization)
            except Exception as e:
                log.warning("delete_idea: Original %s nicht gelöscht: %s", original_id, e)

    # Cache aufräumen — alle Ideen-Tabellen, siehe _purge_idea_cache.
    def _purge_deleted_idea():
        with connect() as con:
            _purge_idea_cache(con, idea_id)

    await asyncio.to_thread(_purge_deleted_idea)
    await asyncio.to_thread(
        _log_activity,
        action="idea_deleted",
        authorization=authorization,
        target_type="idea",
        target_id=idea_id,
        target_label=deleted_title,
    )
    return {"ok": True}


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
    allowed, _user, _is_mod = await _is_owner_or_mod(idea_id, authorization, verified=True)
    if not allowed:
        raise HTTPException(403, "Nur Eigentümer oder Mod dürfen refreshen.")
    ok = await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    if not ok:
        raise HTTPException(
            502, "Refresh fehlgeschlagen — Knoten unbekannt oder edu-sharing nicht erreichbar."
        )
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


@router.post("/admin/ideas/backfill-publication-meta", tags=["moderation"])
async def backfill_publication_meta_all(
    limit: int = Query(50, ge=1, le=500),
    authorization: str | None = Header(None),
):
    """Bulk-Variante: läuft über alle Ideen und ergänzt fehlende Pflicht-
    Metadaten. Per-Item-Fehler werden gesammelt; der Lauf bricht nicht ab."""
    await _require_moderator(authorization)

    # Threadpool: SQLite in async-Route darf den Event-Loop nicht blockieren.
    def _read_backfill_candidates():
        with connect() as con:
            return con.execute(
                "SELECT id, main_content_id, title FROM idea "
                "WHERE COALESCE(hidden,0)=0 ORDER BY modified_at DESC LIMIT ?",
                (limit,),
            ).fetchall()

    rows = await asyncio.to_thread(_read_backfill_candidates)

    processed = 0
    updated = 0
    errors: list[dict] = []
    for r in rows:
        target = r["main_content_id"] or r["id"]
        try:
            meta = await edu_sharing.client.node_metadata(
                target,
                auth_header=authorization,
            )
            cur = (meta.get("node") or {}).get("properties") or {}
            add = _missing_publication_fields(cur)
            if add:
                await edu_sharing.client.update_metadata(
                    target,
                    add,
                    auth_header=authorization,
                )
                updated += 1
                try:
                    await sync_mod.refresh_idea(r["id"], auth_header=authorization)
                except Exception:
                    pass
            processed += 1
        except Exception as e:
            errors.append({"id": r["id"], "title": r["title"], "error": str(e)[:200]})
    await asyncio.to_thread(
        _log_activity,
        action="publication_meta_bulk_backfilled",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        detail={"processed": processed, "updated": updated, "error_count": len(errors)},
    )
    return {"ok": True, "processed": processed, "updated": updated, "errors": errors[:20]}
