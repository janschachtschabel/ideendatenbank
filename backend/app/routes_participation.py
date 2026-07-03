"""Idea participation — contact, interest ("mitmachen"), follow, team roster.

Split out of routes.py (behaviour-preserving). Owns the ways a logged-in user
engages with an idea's team: setting/clearing the idea contact, toggling
interest (a join request) and follow, and — for owners/moderators — approving,
granting edit rights to, or removing team members.

Every route writes only the App DB (idea_contact / idea_interaction) without an
edu-sharing backstop, so each one verifies the login first (``verify_login``)
before trusting the caller — otherwise the owner-cache path in
``is_owner_or_mod`` would trust an unverified username (impersonation).

The router is mounted back onto the main API router via ``include_router`` in
routes.py, so the public paths (/api/v1/ideas/{id}/contact, /interest, /follow,
/team/{user_key}) stay exactly the same.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from .auth import decode_basic_user as _user_key_from_auth
from .auth import is_owner_or_mod as _is_owner_or_mod
from .auth import verify_login as _verify_login
from .db import connect
from .routes_common import _log_activity, _resolve_display_name

router = APIRouter()


class ContactBody(BaseModel):
    contact: str | None = Field(default=None, max_length=200)


@router.put("/ideas/{idea_id}/contact", tags=["ideas"])
async def set_idea_contact(
    idea_id: str, body: ContactBody, authorization: str | None = Header(None)
):
    """Kontakt einer Idee setzen/ändern/entfernen. Nur Einreichende oder
    Moderation. Leerer Wert → löschen (für DSGVO-Löschanfragen). Speicherung
    ausschließlich App-seitig (idea_contact), nicht in edu-sharing."""
    # App-DB-Write ohne edu-sharing-Backstop → Credentials verifizieren, sonst
    # würde der Owner-Cache-Pfad in _is_owner_or_mod dem ungeprüften Username trauen.
    if not await _verify_login(authorization):
        raise HTTPException(401, "Anmeldung erforderlich")
    allowed, _user, is_mod = await _is_owner_or_mod(idea_id, authorization, verified=True)
    if not allowed:
        raise HTTPException(403, "Nur Einreichende oder Moderation dürfen den Kontakt ändern.")
    contact = (body.contact or "").strip()

    def _write_contact():
        with connect() as con:
            if contact:
                con.execute(
                    "INSERT INTO idea_contact (idea_id,contact,created_at) VALUES (?,?,?) "
                    "ON CONFLICT(idea_id) DO UPDATE SET contact=excluded.contact",
                    (idea_id, contact[:200], datetime.now(UTC).isoformat()),
                )
            else:
                con.execute("DELETE FROM idea_contact WHERE idea_id=?", (idea_id,))

    await asyncio.to_thread(_write_contact)
    await asyncio.to_thread(
        _log_activity,
        action="idea_contact_changed",
        authorization=authorization,
        is_mod=is_mod,
        target_type="idea",
        target_id=idea_id,
        detail={"set": bool(contact)},
    )
    return {"ok": True, "contact": contact or None}


@router.post("/ideas/{idea_id}/interest")
async def toggle_interest(
    idea_id: str,
    authorization: str | None = Header(None),
):
    # App-DB-Write → Login verifizieren (sonst Impersonation per Username).
    user = await _verify_login(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    def _remove_existing_interest():
        with connect() as con:
            row = con.execute("SELECT id, title FROM idea WHERE id = ?", (idea_id,)).fetchone()
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
                return row, True
            return row, False

    row, removed = await asyncio.to_thread(_remove_existing_interest)
    if removed:
        return {"state": "removed"}
    # Echten Namen auflösen (außerhalb der Schreib-Transaktion, da Netz-IO),
    # damit die Mitmach-Liste Klarnamen statt Login-Usernamen zeigt.
    display = await _resolve_display_name(authorization) or user

    def _insert_interest():
        with connect() as con:
            con.execute(
                "INSERT INTO idea_interaction (idea_id,user_key,kind,display_name,created_at) "
                "VALUES (?,?, 'interest', ?, datetime('now'))",
                (idea_id, user, display),
            )

    await asyncio.to_thread(_insert_interest)
    # Anfrage protokollieren → erscheint im Feed/„Was ist neu" der/des
    # Ideengeber:in (fremde Aktion auf eigener Idee).
    await asyncio.to_thread(
        _log_activity,
        action="team_join_requested",
        authorization=authorization,
        target_type="idea",
        target_id=idea_id,
        target_label=row["title"],
        detail={"user": user, "name": display},
    )
    return {"state": "added"}


@router.post("/ideas/{idea_id}/follow")
async def toggle_follow(
    idea_id: str,
    authorization: str | None = Header(None),
):
    # App-DB-Write → Login verifizieren (sonst Impersonation per Username).
    user = await _verify_login(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    def _toggle_follow():
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
                return "removed"
            con.execute(
                "INSERT INTO idea_interaction (idea_id,user_key,kind,display_name,created_at) "
                "VALUES (?,?, 'follow', ?, datetime('now'))",
                (idea_id, user, user),
            )
            return "added"

    state = await asyncio.to_thread(_toggle_follow)
    return {"state": state}


class TeamMemberPatch(BaseModel):
    """Owner/Mod nimmt eine:n Mithackende:n an (status) und/oder erteilt
    Bearbeitungsrecht (can_edit)."""

    status: Literal["pending", "approved"] | None = None
    can_edit: bool | None = None


@router.put("/ideas/{idea_id}/team/{user_key}", tags=["ideas"])
async def set_team_member(
    idea_id: str,
    user_key: str,
    body: TeamMemberPatch,
    authorization: str | None = Header(None),
):
    """Annehmen einer/eines Mithackenden (grünes Häkchen) und/oder
    Bearbeitungsrecht erteilen. Nur Owner/Mod. Die Person muss bereits als
    Mithackende:r (kind='interest') eingetragen sein."""
    # App-DB-Write → Login verifizieren, sonst würde der Owner-Cache-Pfad in
    # _is_owner_or_mod dem ungeprüften Username vertrauen (Impersonation).
    if not await _verify_login(authorization):
        raise HTTPException(401, "Anmeldung erforderlich")
    allowed, _u, is_mod = await _is_owner_or_mod(idea_id, authorization, verified=True)
    if not allowed:
        raise HTTPException(403, "Nur Einreicher:in oder Moderation können das Team verwalten.")

    # Zielzustand bestimmen: Edit-Recht impliziert „angenommen"; Zurücksetzen
    # auf „pending" entzieht das Edit-Recht wieder.
    new_status = body.status
    new_can_edit = body.can_edit
    if new_can_edit:
        new_status = "approved"
    if new_status == "pending":
        new_can_edit = False
    if new_status is None and new_can_edit is None:
        raise HTTPException(400, "Nichts zu ändern.")

    sets: list[str] = []
    params: list = []
    if new_status is not None:
        sets.append("status=?")
        params.append(new_status)
    if new_can_edit is not None:
        sets.append("can_edit=?")
        params.append(1 if new_can_edit else 0)
    params += [idea_id, user_key]

    def _update_team_member():
        with connect() as con:
            exists = con.execute(
                "SELECT 1 FROM idea_interaction WHERE idea_id=? AND user_key=? AND kind='interest'",
                (idea_id, user_key),
            ).fetchone()
            if not exists:
                raise HTTPException(404, "Diese Person ist nicht als Mithackende eingetragen.")
            con.execute(
                f"UPDATE idea_interaction SET {', '.join(sets)} "
                "WHERE idea_id=? AND user_key=? AND kind='interest'",
                params,
            )
            _trow = con.execute("SELECT title FROM idea WHERE id=?", (idea_id,)).fetchone()
            return _trow["title"] if _trow else None

    idea_title = await asyncio.to_thread(_update_team_member)
    # Spezifische Aktion → der/die betroffene Mithackende sieht im Feed/„Was
    # ist neu" konkret, was passiert ist (Aktion stammt vom Owner, nicht von
    # ihr/ihm selbst → wird im eigenen Feed angezeigt).
    if new_can_edit is True:
        action = "team_edit_granted"
    elif new_can_edit is False:
        action = "team_edit_revoked"
    elif new_status == "approved":
        action = "team_approved"
    elif new_status == "pending":
        action = "team_unapproved"
    else:
        action = "team_member_updated"
    await asyncio.to_thread(
        _log_activity,
        action=action,
        authorization=authorization,
        is_mod=is_mod,
        target_type="idea",
        target_id=idea_id,
        target_label=idea_title,
        detail={"user": user_key, "status": new_status, "can_edit": new_can_edit},
    )
    return {"ok": True, "user_key": user_key, "status": new_status, "can_edit": new_can_edit}


@router.delete("/ideas/{idea_id}/team/{user_key}", tags=["ideas"])
async def remove_team_member(
    idea_id: str,
    user_key: str,
    authorization: str | None = Header(None),
):
    """Entfernt eine:n Mithackende:n ganz aus dem Team (inkl. Edit-Recht).
    Nur Owner/Mod."""
    # App-DB-Write → Login verifizieren (siehe set_team_member).
    if not await _verify_login(authorization):
        raise HTTPException(401, "Anmeldung erforderlich")
    allowed, _u, is_mod = await _is_owner_or_mod(idea_id, authorization, verified=True)
    if not allowed:
        raise HTTPException(403, "Nur Einreicher:in oder Moderation können das Team verwalten.")
    def _remove_team_member():
        with connect() as con:
            con.execute(
                "DELETE FROM idea_interaction WHERE idea_id=? AND user_key=? AND kind='interest'",
                (idea_id, user_key),
            )

    await asyncio.to_thread(_remove_team_member)
    await asyncio.to_thread(
        _log_activity,
        action="team_member_removed",
        authorization=authorization,
        is_mod=is_mod,
        target_type="idea",
        target_id=idea_id,
        detail={"user": user_key},
    )
    return {"ok": True}


@router.get("/ideas/{idea_id}/interactions")
async def get_interactions(
    idea_id: str,
    authorization: str | None = Header(None),
):
    def _read():
        with connect() as con:
            rows = con.execute(
                "SELECT kind, display_name, user_key, created_at, status, can_edit "
                "FROM idea_interaction WHERE idea_id = ? ORDER BY created_at DESC",
                (idea_id,),
            ).fetchall()
            # Selbst gesetzte App-Profil-Namen der Teilnehmer (bevorzugt vor dem
            # beim Beitritt aufgelösten edu-sharing-Namen).
            keys = list({r["user_key"] for r in rows if r["user_key"]})
            meta_names: dict[str, str] = {}
            if keys:
                ph = ",".join("?" * len(keys))
                for m in con.execute(
                    f"SELECT username, display_name FROM user_profile_meta "
                    f"WHERE username IN ({ph}) AND display_name IS NOT NULL AND display_name != ''",
                    keys,
                ).fetchall():
                    meta_names[m["username"]] = m["display_name"]
        return rows, meta_names

    rows, meta_names = await asyncio.to_thread(_read)

    current = _user_key_from_auth(authorization)
    interest = [r for r in rows if r["kind"] == "interest"]
    follow = [r for r in rows if r["kind"] == "follow"]

    def disp(r) -> str:
        """1. App-Profilname (selbst gesetzt) → 2. beim Beitritt aufgelöster
        edu-sharing-Klarname (≠ Login) → 3. Login als Fallback."""
        uk = r["user_key"]
        if meta_names.get(uk):
            return meta_names[uk]
        dn = r["display_name"]
        if dn and dn != uk:
            return dn
        return uk

    # Eigener Eintrag zeigt noch den Login? → frisch aus edu-sharing auflösen
    # (Auth des Betrachters liegt vor) und im Ledger nachziehen, damit auch
    # Altbestand korrekt wird.
    current_name: str | None = None
    if current and authorization:
        mine = next((r for r in interest if r["user_key"] == current), None)
        if mine is not None and disp(mine) == current:
            real = await _resolve_display_name(authorization)
            if real and real != current:
                current_name = real

                def _update_name():
                    with connect() as con:
                        con.execute(
                            "UPDATE idea_interaction SET display_name=? "
                            "WHERE idea_id=? AND user_key=? AND kind='interest'",
                            (real, idea_id, current),
                        )

                try:
                    await asyncio.to_thread(_update_name)
                except Exception:
                    pass

    def name_for(r) -> str:
        if current_name and r["user_key"] == current:
            return current_name
        return disp(r)

    # Verwaltungs-Flag: darf der Betrachter das Team annehmen / Recht erteilen?
    can_manage = False
    if authorization:
        try:
            # Reines Anzeige-Flag (Team-Verwaltungs-Buttons). `verified=True`:
            # die tatsächlichen Aktionen (set/remove_team_member) re-verifizieren
            # via _verify_login. Kein zusätzlicher Roundtrip im Read-Pfad.
            can_manage = (await _is_owner_or_mod(idea_id, authorization, verified=True))[0]
        except Exception:
            can_manage = False

    def status_of(r) -> str:
        return r["status"] if r["status"] else "pending"

    return {
        "interest": {
            "count": len(interest),
            "users": [
                {
                    "name": name_for(r),
                    "user_key": r["user_key"],
                    "status": status_of(r),
                    "approved": status_of(r) == "approved",
                    "can_edit": bool(r["can_edit"]),
                }
                for r in interest
            ],
            "mine": any(r["user_key"] == current for r in interest) if current else False,
            "mine_status": next((status_of(r) for r in interest if r["user_key"] == current), None)
            if current
            else None,
            "can_manage": can_manage,
        },
        "follow": {
            "count": len(follow),
            "mine": any(r["user_key"] == current for r in follow) if current else False,
        },
    }
