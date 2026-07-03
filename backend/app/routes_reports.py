"""Idea reports — user-submitted flags + per-reporter status.

Split out of routes.py (behaviour-preserving). Owns submitting a report against
an idea (recorded in idea_report for moderators to triage; no automatic mail —
the ES SMTP hook hangs on prod) and the per-reporter status check that lets the
UI show whether the logged-in user already reported an idea (dedupe).

The router is mounted back onto the main API router via ``include_router`` in
routes.py, so the public paths (/api/v1/ideas/{id}/report,
/api/v1/ideas/{id}/report-status) stay exactly the same.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field

from . import sync as sync_mod
from .auth import decode_basic_user as _user_key_from_auth
from .auth import verify_login as _verify_login
from .db import connect
from .ratelimit import limiter
from .routes_common import _log_activity

router = APIRouter()


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
    # Reporter = der/die Meldende selbst. Identität VERIFIZIEREN (echter,
    # passwort-geprüfter Username), sonst ließe sich eine Meldung einem
    # beliebigen Account unterschieben → /me/reports + Dublettenerkennung
    # manipulierbar. None bei anonymer Meldung. Vor connect(), damit der
    # ES-Roundtrip nicht den SQLite-Write-Lock hält.
    reporter = (await _verify_login(authorization)) if authorization else None

    def _write_report():
        with connect() as con:
            con.execute(
                "INSERT INTO idea_report (idea_id,reason,reporter,created_at) VALUES (?,?,?,?)",
                (idea_id, body.reason.strip(), reporter, sync_mod._iso_now()),
            )
            # Idee-Titel für hübsches Log
            return con.execute("SELECT title FROM idea WHERE id=?", (idea_id,)).fetchone()

    title_row = await asyncio.to_thread(_write_report)
    await asyncio.to_thread(
        _log_activity,
        action="report_submitted",
        authorization=authorization,
        target_type="idea",
        target_id=idea_id,
        target_label=(title_row["title"] if title_row else None),
        detail={"reason_excerpt": body.reason.strip()[:120]},
    )
    return {"ok": True}


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
