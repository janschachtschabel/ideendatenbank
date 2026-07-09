"""Idea submission — create a new idea as ccm:io in the moderation inbox.

Split out of routes.py (behaviour-preserving). Owns the single public submit
endpoint: it maps the ``IdeaSubmission`` payload to edu-sharing properties
(keywords for phase/event/target-topic/submitter, WLO publication defaults),
creates the node in the guest inbox (with the caller's auth, or the WLO guest
for anonymous submits gated by a math captcha), stores optional contact data
only with explicit consent, refreshes the cache, and hands anonymous submitters
a short-lived upload token for the preview/attachment step.

The router is mounted back onto the main API router via ``include_router`` in
routes.py, so the public path (POST /api/v1/ideas) stays exactly the same.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from . import edu_sharing
from . import sync as sync_mod
from .auth import decode_basic_user as _user_key_from_auth
from .config import settings
from .db import connect
from .ratelimit import limiter
from .routes_captcha import _captcha_verify
from .routes_common import _log_activity, _upload_token_issue, _validate_external_url

log = logging.getLogger(__name__)

router = APIRouter()


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
    # Mathe-Captcha — Pflicht NUR bei anonymem Submit. Eingeloggte User
    # (= mit Authorization-Header) lassen das Feld leer.
    captcha_token: str | None = None
    captcha_answer: str | None = None
    # Optionale Kontaktdaten (E-Mail oder Link) für Rückfragen/Mithackende.
    # Werden NUR mit ausdrücklicher Einwilligung (contact_consent) in der
    # App-DB gespeichert und nur eingeloggten Nutzer:innen angezeigt.
    contact: str | None = Field(default=None, max_length=200)
    contact_consent: bool = False


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
    under the same inbox for now (later: directly under the target challenge).

    Anonyme Submits müssen ein zuvor von `GET /captcha` geholtes Token
    + Lösung mitschicken (`captcha_token` + `captcha_answer`).
    Eingeloggte User skippen das."""
    if not authorization:
        _captcha_verify(body.captcha_token, body.captcha_answer)
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
    if submitter and not any(k.lower().startswith("submitter:") for k in kws):
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
    safe_url = _validate_external_url(body.project_url, field="Projekt-URL")
    if safe_url:
        props["ccm:wwwurl"] = [safe_url]
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
            f"edu-sharing Fehler beim Anlegen: {e.response.status_code} {e.response.text[:180]}",
        )

    node = (result or {}).get("node") or {}
    new_id = (node.get("ref") or {}).get("id")

    # Kontaktdaten nur MIT Einwilligung in der App-DB ablegen (nicht in
    # edu-sharing). Anzeige später nur für eingeloggte Nutzer:innen.
    contact = (body.contact or "").strip()
    if new_id and contact and body.contact_consent:
        try:

            def _write_submit_contact():
                with connect() as con:
                    con.execute(
                        "INSERT INTO idea_contact (idea_id,contact,created_at) VALUES (?,?,?) "
                        "ON CONFLICT(idea_id) DO UPDATE SET contact=excluded.contact",
                        (new_id, contact[:200], datetime.now(UTC).isoformat()),
                    )

            await asyncio.to_thread(_write_submit_contact)
        except Exception as e:
            log.debug("submit_idea: idea_contact speichern fehlgeschlagen: %s", e)

    # Single-Node-Refresh: frische Idee sofort im Cache, ohne auf 5-min-Sync
    # zu warten. Auth des Erstellers (oder None für Gast) wird durchgereicht.
    if new_id:
        try:
            await sync_mod.refresh_idea(new_id, auth_header=authorization)
        except Exception:
            pass

    await asyncio.to_thread(
        _log_activity,
        action="idea_submitted",
        authorization=authorization,
        target_type="idea",
        target_id=new_id,
        target_label=body.title,
        detail={
            "anonymous": authorization is None,
            "topic_id": body.topic_id,
            "phase": body.phase,
            "events": list(body.events or []) + ([body.event] if body.event else []),
        },
    )

    # Anonyme Einreichung: kurzlebiges Upload-Token mitgeben, mit dem genau
    # dieser Einreicher Vorschaubild/Anhänge an die frische Idee hängen darf
    # (Objekt-Autorisierung des anonymen Upload-Zweigs). Eingeloggte brauchen es
    # nicht — sie sind über _can_edit_idea berechtigt.
    # Best-effort: scheitert die Token-Ausgabe (z.B. kurzer DB-Lock), bleibt die
    # Idee trotzdem angelegt — der anonyme Datei-Upload entfällt dann nur und
    # ist nach Login nachreichbar. KEIN 500 nach bereits erstelltem Knoten.
    upload_token = None
    if new_id and authorization is None:
        try:
            upload_token = _upload_token_issue(new_id)
        except Exception as e:
            log.warning("submit_idea: Upload-Token-Ausgabe fehlgeschlagen für %s: %s", new_id, e)

    return {
        "ok": True,
        "moderation": "pending",
        "node_id": new_id,
        "upload_token": upload_token,
        "message": (
            "Danke! Deine Idee liegt jetzt im Moderations-Postfach. "
            "Das Team prüft sie und ordnet sie der passenden Herausforderung zu."
        ),
    }
