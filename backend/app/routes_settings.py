"""App settings — global voting mode + rating master switch.

Split out of routes.py (behaviour-preserving). Owns the public read of the
runtime settings the frontend needs to render (voting mode, rating on/off,
edu-repo base URL, rating-decay parameters) and the moderator-only write of the
global voting mode and rating switch. Values are persisted via the shared
``_get_setting`` / ``_set_setting`` helpers (app_setting table).

The router is mounted back onto the main API router via ``include_router`` in
routes.py, so the public paths (/api/v1/settings, /api/v1/admin/settings) stay
exactly the same.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Header
from pydantic import BaseModel

from .config import settings
from .routes_common import (
    _get_setting,
    _log_activity,
    _require_moderator,
    _set_setting,
)

router = APIRouter()


@router.get("/settings", tags=["public"])
def get_settings():
    """Öffentliche Lauf-Einstellungen, die das Frontend zum Rendern braucht.
    - voting_mode_global: 'stars' | 'thumbs' (Pro-Event-Overrides in der Event-Liste)
    - edu_repo_base_url: für „im Repo öffnen"-Links + Registrierungs-Link,
      deployment-spezifisch aus der Backend-Config."""
    return {
        "voting_mode_global": _get_setting("voting_mode_global", "stars"),
        # Globaler Bewertungs-Schalter (Master): '1' = an, '0' = aus.
        "rating_enabled": _get_setting("rating_enabled", "1") != "0",
        "edu_repo_base_url": settings.edu_repo_base_url.rstrip("/"),
        # Rating-Verfall: Frontend rendert daraus die Transparenz-Box am
        # Seitenende (Formel + Beispieltabelle).
        "rating_decay_enabled": settings.rating_decay_enabled,
        "rating_decay_halflife_days": settings.rating_decay_halflife_days,
        "rating_decay_floor": settings.rating_decay_floor,
    }


class SettingsPatch(BaseModel):
    voting_mode_global: Literal["stars", "thumbs"] | None = None
    rating_enabled: bool | None = None


@router.put("/admin/settings", tags=["admin"])
async def update_settings(
    body: SettingsPatch,
    authorization: str | None = Header(None),
):
    """Mod-only: globale Einstellungen ändern (sofort wirksam)."""
    await _require_moderator(authorization)
    if body.voting_mode_global is not None:
        _set_setting("voting_mode_global", body.voting_mode_global)
        _log_activity(
            action="setting_changed",
            authorization=authorization,
            is_mod=True,
            target_type="setting",
            target_id="voting_mode_global",
            detail={"value": body.voting_mode_global},
        )
    if body.rating_enabled is not None:
        _set_setting("rating_enabled", "1" if body.rating_enabled else "0")
        _log_activity(
            action="setting_changed",
            authorization=authorization,
            is_mod=True,
            target_type="setting",
            target_id="rating_enabled",
            detail={"value": body.rating_enabled},
        )
    return {
        "ok": True,
        "voting_mode_global": _get_setting("voting_mode_global", "stars"),
        "rating_enabled": _get_setting("rating_enabled", "1") != "0",
    }
