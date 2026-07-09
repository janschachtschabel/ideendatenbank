"""User-area routes — /me/* (identity, memberships, and the personal lists).

Split out of routes.py (behaviour-preserving). Mounted back onto the main router
via include_router in routes.py, so /api/v1/me/* paths stay unchanged. Only the
core cluster (identity + lists) lives here for now; /me/profile-meta and
/me/notifications/* remain in routes.py.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from . import edu_sharing
from . import sync as sync_mod
from .auth import decode_basic_user as _user_key_from_auth
from .auth import is_moderator as _is_moderator
from .auth import verify_login as _verify_login
from .config import settings
from .db import connect
from .routes_common import (
    _log_activity,
    _resolve_display_name,
    _row_to_idea,
    _validate_external_url,
)

router = APIRouter()


@router.get("/me", tags=["me"])
async def whoami(authorization: str | None = Header(None)):
    """Bestätigt den aktuell eingeloggten User + Mod-Status.
    Frontend nutzt das beim Login um Mod-UI zu gaten."""
    if not authorization:
        return {"authenticated": False}
    user = _user_key_from_auth(authorization)
    # Die zwei edu-sharing-Roundtrips (Mod-Status via memberships + Klarname via
    # profile) sind unabhängig → PARALLEL statt seriell. Halbiert die Login-
    # Latenz (~1,2 s → ~0,7 s = ein ES-Roundtrip als Untergrenze); beide Helfer
    # fangen ihre Fehler selbst (kein Verhaltensunterschied zur Serienform).
    is_mod, display_name = await asyncio.gather(
        _is_moderator(authorization),
        _resolve_display_name(authorization),
    )
    return {
        "authenticated": bool(user),
        "username": user,
        "display_name": display_name or user,
        "is_moderator": is_mod,
        "moderation_groups": settings.fallback_mod_groups,
    }


@router.get("/me/memberships", tags=["me"])
async def my_memberships_debug(authorization: str | None = Header(None)):
    """Diagnose-Endpoint: liefert die rohen Memberships des Callers + die
    konfigurierten Mod-Gruppen, um Mismatch-Probleme aufzudecken."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    try:
        m = await edu_sharing.client.my_memberships(auth_header=authorization)
    except Exception as e:
        raise HTTPException(502, f"edu-sharing memberships-Fehler: {e}")
    groups = [
        {
            "authorityName": g.get("authorityName"),
            "displayName": (g.get("profile") or {}).get("displayName"),
            "groupType": (g.get("profile") or {}).get("groupType"),
        }
        for g in (m.get("groups") or [])
    ]
    user_groups = {g["authorityName"] for g in groups}
    matched = user_groups & set(settings.fallback_mod_groups)
    user = _user_key_from_auth(authorization)
    return {
        "username": user,
        "is_moderator": bool(matched),
        "matched_groups": sorted(matched),
        "expected_groups": settings.fallback_mod_groups,
        "groups_count": len(groups),
        "groups": groups,
    }


# ===== "Mein Bereich" — User-spezifische Listen ==================


@router.get("/me/ideas", tags=["me"])
def my_ideas(authorization: str | None = Header(None)):
    """Ideen, die dem eingeloggten User gehören (cm:owner == username)."""
    user = _user_key_from_auth(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        rows = con.execute(
            "SELECT * FROM idea WHERE owner_username = ? ORDER BY modified_at DESC",
            (user,),
        ).fetchall()
    return {"count": len(rows), "items": [_row_to_idea(r) for r in rows]}


@router.get("/me/follows", tags=["me"])
async def my_follows(authorization: str | None = Header(None)):
    """Ideen, denen der User folgt. Private Liste → Identität verifizieren,
    sonst ließen sich fremde Folge-Listen per gefälschtem Basic-User abrufen."""
    user = await _verify_login(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")

    def _read():
        with connect() as con:
            return con.execute(
                "SELECT i.* FROM idea i "
                "JOIN idea_interaction x ON x.idea_id = i.id "
                "WHERE x.user_key = ? AND x.kind = 'follow' "
                "ORDER BY x.created_at DESC",
                (user,),
            ).fetchall()

    rows = await asyncio.to_thread(_read)
    return {"count": len(rows), "items": [_row_to_idea(r) for r in rows]}


@router.get("/me/interest", tags=["me"])
async def my_interest(authorization: str | None = Header(None)):
    """Ideen, bei denen der User „mithacken" gemarkt hat — inkl. eigenem
    Team-Status (pending/approved) + Bearbeitungsrecht. Private Liste →
    Identität verifizieren (nicht nur dem Basic-Usernamen vertrauen)."""
    user = await _verify_login(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")

    def _read():
        with connect() as con:
            return con.execute(
                "SELECT i.*, x.status AS my_status, x.can_edit AS my_can_edit FROM idea i "
                "JOIN idea_interaction x ON x.idea_id = i.id "
                "WHERE x.user_key = ? AND x.kind = 'interest' "
                "ORDER BY x.created_at DESC",
                (user,),
            ).fetchall()

    rows = await asyncio.to_thread(_read)
    items = []
    for r in rows:
        d = _row_to_idea(r)
        d["my_status"] = r["my_status"] or "pending"
        d["my_can_edit"] = bool(r["my_can_edit"])
        items.append(d)
    return {"count": len(items), "items": items}


@router.get("/me/team-requests", tags=["me"])
async def my_team_requests(authorization: str | None = Header(None)):
    """Für die Ideen des eingeloggten Users: alle Mithackenden (offene
    Anfragen + angenommene) mit Idee-Titel — fürs zentrale Annehmen/Verwalten
    im „Mein Bereich". Klarnamen bevorzugt aus dem App-Profil. Private Liste
    (zeigt fremde Mithack-Anfragen) → Identität verifizieren."""
    user = await _verify_login(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")

    def _read_team_requests():
        with connect() as con:
            rows = con.execute(
                "SELECT x.idea_id, x.user_key, x.display_name, x.status, x.can_edit, "
                "x.created_at, i.title AS idea_title "
                "FROM idea_interaction x JOIN idea i ON i.id = x.idea_id "
                "WHERE i.owner_username = ? AND x.kind = 'interest' "
                "ORDER BY i.title, (x.status = 'approved'), x.created_at",
                (user,),
            ).fetchall()
            names: dict[str, str] = {}
            keys = list({r["user_key"] for r in rows})
            if keys:
                ph = ",".join("?" * len(keys))
                for m in con.execute(
                    f"SELECT username, display_name FROM user_profile_meta "
                    f"WHERE username IN ({ph}) AND display_name IS NOT NULL AND display_name != ''",
                    keys,
                ).fetchall():
                    names[m["username"]] = m["display_name"]
            return rows, names

    rows, names = await asyncio.to_thread(_read_team_requests)

    def nm(r) -> str:
        uk = r["user_key"]
        if names.get(uk):
            return names[uk]
        dn = r["display_name"]
        return dn if (dn and dn != uk) else uk

    items = [
        {
            "idea_id": r["idea_id"],
            "idea_title": r["idea_title"],
            "user_key": r["user_key"],
            "name": nm(r),
            "status": r["status"] or "pending",
            "approved": (r["status"] == "approved"),
            "can_edit": bool(r["can_edit"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]
    pending = sum(1 for it in items if not it["approved"])
    return {"count": len(items), "pending": pending, "items": items}


@router.get("/me/activity", tags=["me"])
# Bewusst sync `def` (keine awaits, nur blockierende DB-Reads) — wie
# get_ranking: als `async` würde es den Event-Loop blockieren.
def my_activity(
    limit: int = Query(50, ge=1, le=200),
    authorization: str | None = Header(None),
):
    """Aktivitäts-Feed für den eingeloggten User: Ereignisse zu Ideen, denen
    er folgt, die ihm gehören oder bei denen er „Mitmachen" angeklickt hat.
    Eigene Aktionen werden ausgeblendet — wir zeigen nur, was *andere* tun."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    me = _user_key_from_auth(authorization)
    if not me:
        raise HTTPException(401, "Username konnte nicht ermittelt werden")

    with connect() as con:
        # Sammle relevante Idea-IDs: gefolgt + Mitmachen + eigene
        idea_ids = {
            r["idea_id"]
            for r in con.execute(
                "SELECT idea_id FROM idea_interaction "
                "WHERE user_key = ? AND kind IN ('follow','interest')",
                (me,),
            ).fetchall()
        }
        for r in con.execute(
            "SELECT id FROM idea WHERE owner_username = ?",
            (me,),
        ).fetchall():
            idea_ids.add(r["id"])

        if not idea_ids:
            return {"count": 0, "items": []}

        placeholders = ",".join(["?"] * len(idea_ids))
        rows = con.execute(
            f"SELECT * FROM activity_log "
            f"WHERE target_id IN ({placeholders}) "
            f"  AND COALESCE(actor,'') <> ? "  # eigene Aktionen ausblenden
            f"ORDER BY ts DESC LIMIT ?",
            (*idea_ids, me, limit),
        ).fetchall()

    items = []
    for r in rows:
        d = dict(r)
        if d.get("detail"):
            try:
                d["detail"] = json.loads(d["detail"])
            except Exception:
                pass
        items.append(d)
    return {"count": len(items), "items": items}


class ProfileMetaPatch(BaseModel):
    """Optional editable Profil-Felder (alle nullable / leer = entfernen)."""

    display_name: str | None = Field(default=None, max_length=80)
    bio: str | None = Field(default=None, max_length=280)
    website: str | None = Field(default=None, max_length=2000)
    # Rolle/Kontext: Slug aus dem Frontend-Dropdown. Statt einer starren
    # Literal-Whitelist (die bei jeder neuen Rolle mitgepflegt werden müsste)
    # nur Format + Länge prüfen: kebab-case, max. 40 Zeichen, leer = entfernen.
    role: str | None = Field(default=None, max_length=40, pattern=r"^[a-z0-9-]*$")


@router.get("/me/profile-meta", tags=["me"])
def get_my_profile_meta(authorization: str | None = Header(None)):
    """Lädt die eigenen Profil-Felder zum Bearbeiten."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    me = _user_key_from_auth(authorization)
    if not me:
        raise HTTPException(401, "Username konnte nicht ermittelt werden")
    with connect() as con:
        row = con.execute(
            "SELECT display_name, bio, website, role, updated_at "
            "FROM user_profile_meta WHERE username=?",
            (me,),
        ).fetchone()
    if not row:
        return {
            "display_name": None,
            "bio": None,
            "website": None,
            "role": None,
            "updated_at": None,
        }
    return dict(row)


@router.put("/me/profile-meta", tags=["me"])
async def update_my_profile_meta(
    body: ProfileMetaPatch,
    authorization: str | None = Header(None),
):
    """Speichert die eigenen Profil-Felder. Wirft 400 bei ungültiger URL."""
    # App-DB-Write → Login gegen edu-sharing verifizieren (sonst könnte man mit
    # fremdem Username + beliebigem Passwort fremde Profilfelder überschreiben).
    me = await _verify_login(authorization)
    if not me:
        raise HTTPException(401, "Anmeldung erforderlich")

    # URL absichern (http(s)-only)
    safe_url = _validate_external_url(body.website, field="Website")

    # Leere Strings → NULL
    def _norm(v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        return s or None

    display = _norm(body.display_name)
    bio = _norm(body.bio)
    role = _norm(body.role)
    now = datetime.now(UTC).isoformat()

    def _write_profile_meta():
        with connect() as con:
            con.execute(
                "INSERT INTO user_profile_meta "
                "(username, display_name, bio, website, role, updated_at) "
                "VALUES (?,?,?,?,?,?) "
                "ON CONFLICT(username) DO UPDATE SET "
                "  display_name=excluded.display_name, "
                "  bio=excluded.bio, "
                "  website=excluded.website, "
                "  role=excluded.role, "
                "  updated_at=excluded.updated_at",
                (me, display, bio, safe_url, role, now),
            )

    await asyncio.to_thread(_write_profile_meta)
    await asyncio.to_thread(
        _log_activity,
        action="profile_meta_updated",
        authorization=authorization,
        is_mod=False,
        target_type="user",
        target_id=me,
        detail={
            "fields": [
                k
                for k, v in {
                    "display_name": display,
                    "bio": bio,
                    "website": safe_url,
                    "role": role,
                }.items()
                if v is not None
            ]
        },
    )
    return {"ok": True, "username": me, "updated_at": now}


@router.get("/me/notifications/unseen", tags=["me"])
def my_notifications_unseen(authorization: str | None = Header(None)):
    """Anzahl der Feed-Items, die seit dem letzten /me/notifications/seen-
    Call aufgetreten sind. Für die Badge im User-Menü / Profil-Tab."""
    if not authorization:
        return {"count": 0}
    me = _user_key_from_auth(authorization)
    if not me:
        return {"count": 0}
    with connect() as con:
        seen_row = con.execute(
            "SELECT last_seen FROM user_feed_seen WHERE user_key=?",
            (me,),
        ).fetchone()
        last_seen = seen_row["last_seen"] if seen_row else "1970-01-01T00:00:00Z"

        # Relevante Idea-IDs (gefolgt + mitmachen + eigene)
        idea_ids = {
            r["idea_id"]
            for r in con.execute(
                "SELECT idea_id FROM idea_interaction "
                "WHERE user_key=? AND kind IN ('follow','interest')",
                (me,),
            ).fetchall()
        }
        for r in con.execute(
            "SELECT id FROM idea WHERE owner_username=?",
            (me,),
        ).fetchall():
            idea_ids.add(r["id"])
        if not idea_ids:
            return {"count": 0, "last_seen": last_seen}

        # SQLites Default-Parameter-Limit liegt bei 999. Wer >900 Ideen
        # gefolgt/eigen hat, würde sonst eine `too many SQL variables`-
        # Exception bekommen. Wir chunken auf 800er-Blöcke und summieren.
        idea_list = list(idea_ids)
        CHUNK = 800
        count = 0
        for start in range(0, len(idea_list), CHUNK):
            chunk = idea_list[start : start + CHUNK]
            placeholders = ",".join("?" * len(chunk))
            count += con.execute(
                f"SELECT COUNT(*) FROM activity_log "
                f"WHERE target_id IN ({placeholders}) "
                f"  AND ts > ? AND COALESCE(actor,'') <> ?",
                (*chunk, last_seen, me),
            ).fetchone()[0]
    return {"count": count, "last_seen": last_seen}


@router.post("/me/notifications/seen", tags=["me"])
async def mark_notifications_seen(authorization: str | None = Header(None)):
    """Setzt den Notification-Cursor auf jetzt — alle weiter zurückliegenden
    Feed-Items gelten als „gelesen"."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    # App-DB-Write → Identität verifizieren statt nur dem Basic-Usernamen zu
    # vertrauen, sonst ließe sich der Notification-Cursor fremder User setzen.
    me = await _verify_login(authorization)
    if not me:
        raise HTTPException(401, "Anmeldung ungültig")
    now = sync_mod._iso_now()

    def _write_seen_marker():
        with connect() as con:
            con.execute(
                "INSERT OR REPLACE INTO user_feed_seen (user_key, last_seen) VALUES (?, ?)",
                (me, now),
            )

    await asyncio.to_thread(_write_seen_marker)
    return {"ok": True, "last_seen": now}
