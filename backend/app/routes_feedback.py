"""Idea feedback — ratings and comments.

Split out of routes.py (behaviour-preserving). Owns rating an idea (with the
edu-sharing write-then-read-back truth check and the local vote_event decay
ledger), taking a rating back, adding a comment, and deleting a comment
(author- or moderator-gated).

edu-sharing quirks handled here: the rating endpoints regularly answer 500 even
on success, so writes are followed by an authenticated read-back that decides
whether the value actually persisted; rating deletes are tolerated when they
fail (known server bug) so the end user never sees an error.

The router is mounted back onto the main API router via ``include_router`` in
routes.py, so the public paths (/api/v1/ideas/{id}/rating, /comments,
/comments/{comment_id}) stay exactly the same.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Request

from . import edu_sharing
from . import sync as sync_mod
from .auth import decode_basic_user as _user_key_from_auth
from .auth import is_moderator as _is_moderator
from .db import connect
from .ratelimit import limiter
from .routes_common import _log_activity, _rating_open_for_events

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/ideas/{idea_id}/rating")
@limiter.limit("30/minute")
async def rate_idea(
    request: Request,
    idea_id: str,
    rating: float = Query(..., ge=0, le=5),
    text: str = Query("", max_length=4000),
    authorization: str | None = Header(None),
):
    user = _user_key_from_auth(authorization)
    log.info("rate_idea: user=%s idea=%s rating=%s", user, idea_id, rating)
    if not authorization:
        raise HTTPException(401, "Authorization header required for rating")

    def _read_idea_target():
        with connect() as con:
            return con.execute(
                "SELECT main_content_id,id,events FROM idea WHERE id = ?", (idea_id,)
            ).fetchone()

    row = await asyncio.to_thread(_read_idea_target)
    if not row:
        raise HTTPException(404, "Idea not found")
    # Bewertungsphase serverseitig durchsetzen (nicht nur UI ausblenden):
    # eine NEUE/positive Bewertung ist nur möglich, wenn die Phase offen ist.
    # rating=0 (= zurücknehmen) bleibt erlaubt.
    if rating:
        try:
            _evs = json.loads(row["events"]) if row["events"] else []
        except Exception:
            _evs = []
        if not _rating_open_for_events(_evs if isinstance(_evs, list) else []):
            raise HTTPException(409, "Die Bewertung für diese Idee ist aktuell nicht geöffnet.")
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
            target,
            auth_header=authorization,
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
            write_status,
            write_error_text,
        )
        if "DAOSecurityException" in (write_error_text or "") or write_status == 403:
            raise HTTPException(
                403,
                "Du darfst diese Idee nicht bewerten. Wende dich an die "
                "Moderation, falls das ein Fehler ist.",
            )
        raise HTTPException(
            502,
            "edu-sharing konnte das Rating nicht speichern. Bitte später nochmal probieren.",
        )

    # Erfolg (entweder Write 200 oder Schein-500 mit persistiertem Rating)
    if write_status:
        log.info(
            "rate_idea: ES-Write %s ignoriert (Read-Back zeigt mine=%s)",
            write_status,
            mine,
        )

    # Vote-Ledger für den Punkteverfall pflegen (Zeitstempel der Stimme).
    # Nur wenn das Rating tatsächlich serverseitig steht. rating=0 = Reset.
    if persisted or not write_status:
        try:

            def _write_vote_event():
                with connect() as con:
                    if rating and rating > 0:
                        # created_at NICHT überschreiben → Erstabgabe bleibt das
                        # maßgebliche Stimmenalter. Wertänderung aktualisiert nur
                        # value + updated_at (Audit).
                        _ts = datetime.now(UTC).isoformat()
                        con.execute(
                            "INSERT INTO vote_event (idea_id,user_key,value,created_at,updated_at) "
                            "VALUES (?,?,?,?,?) "
                            "ON CONFLICT(idea_id,user_key) DO UPDATE SET "
                            "value=excluded.value, updated_at=excluded.updated_at",
                            (idea_id, user, float(rating), _ts, _ts),
                        )
                    else:
                        con.execute(
                            "DELETE FROM vote_event WHERE idea_id=? AND user_key=?",
                            (idea_id, user),
                        )

            await asyncio.to_thread(_write_vote_event)
        except Exception as e:
            log.debug("rate_idea: vote_event-Ledger-Update fehlgeschlagen: %s", e)

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


@router.delete("/ideas/{idea_id}/rating")
@limiter.limit("30/minute")
async def unrate_idea(
    request: Request,
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Eigene Bewertung/Like zurücknehmen (Daumen-Modus „un-like").

    Achtung: edu-sharing quittiert das Löschen aktuell oft mit 500
    (Server-Bug). Wir unterdrücken den Fehler bewusst — der Endnutzer
    sieht keinen Fehler, der Like kann aber serverseitig bestehen bleiben,
    bis der Bug behoben ist. Frontend aktualisiert optimistisch."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")

    def _read_idea_target():
        with connect() as con:
            return con.execute(
                "SELECT main_content_id,id FROM idea WHERE id = ?", (idea_id,)
            ).fetchone()

    row = await asyncio.to_thread(_read_idea_target)
    if not row:
        raise HTTPException(404, "Idea not found")
    target = row["main_content_id"] or row["id"]

    ok = True
    try:
        await edu_sharing.client.delete_rating(target, auth_header=authorization)
    except Exception as e:
        # 500 vom bekannten edu-sharing-Bug o.ä. → still schlucken.
        ok = False
        log.info("unrate_idea: delete_rating fehlgeschlagen (toleriert): %s", e)

    # Vote aus dem Verfalls-Ledger entfernen (unabhängig vom ES-Bug, damit
    # der Score-Verfall den Un-Like sofort widerspiegelt).
    user = _user_key_from_auth(authorization)
    if user:
        try:

            def _delete_vote_event():
                with connect() as con:
                    con.execute(
                        "DELETE FROM vote_event WHERE idea_id=? AND user_key=?",
                        (idea_id, user),
                    )

            await asyncio.to_thread(_delete_vote_event)
        except Exception as e:
            log.debug("unrate_idea: vote_event-Ledger-Delete fehlgeschlagen: %s", e)

    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass

    # Immer 200 — der Endnutzer soll keinen Fehler sehen.
    return {"ok": True, "persisted": ok}


@router.post("/ideas/{idea_id}/comments")
@limiter.limit("30/minute")
async def comment_idea(
    request: Request,
    idea_id: str,
    comment: str = Query(..., min_length=1, max_length=4000),
    reply_to: str | None = None,
    authorization: str | None = Header(None),
):
    if not authorization:
        raise HTTPException(401, "Authorization header required for comments")

    def _read_idea_target():
        with connect() as con:
            return con.execute(
                "SELECT main_content_id,id FROM idea WHERE id = ?", (idea_id,)
            ).fetchone()

    row = await asyncio.to_thread(_read_idea_target)
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

            def _read_idea_target():
                with connect() as con:
                    return con.execute(
                        "SELECT main_content_id,id FROM idea WHERE id=?",
                        (idea_id,),
                    ).fetchone()

            row = await asyncio.to_thread(_read_idea_target)
            if row:
                target = row["main_content_id"] or row["id"]
                cm = await edu_sharing.client.comments(target, auth_header=authorization)
                for c in (cm or {}).get("comments") or []:
                    ref_id = (c.get("ref") or {}).get("id")
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
    await asyncio.to_thread(
        _log_activity,
        action="comment_deleted",
        authorization=authorization,
        is_mod=is_mod,
        target_type="idea",
        target_id=idea_id or "",
        detail={"comment_id": comment_id},
    )
    return {"ok": True}
