"""Globale App-Settings: öffentlicher Read (/settings), Mod-only Write
(/admin/settings). Pinnt Gating (401/403), Persistenz und die Literal-
Validierung des Voting-Modus."""

from __future__ import annotations


def test_get_settings_public_defaults(client):
    body = client.get("/api/v1/settings").json()
    assert body["voting_mode_global"] == "stars"  # Default
    assert body["rating_enabled"] is True


def test_update_settings_rejects_anonymous(client):
    r = client.put("/api/v1/admin/settings", json={"voting_mode_global": "thumbs"})
    assert r.status_code == 401


def test_update_settings_requires_moderator(client, user_headers):
    r = client.put(
        "/api/v1/admin/settings",
        json={"voting_mode_global": "thumbs"},
        headers=user_headers,
    )
    assert r.status_code == 403


def test_update_settings_persists_and_reflects(client, mod_headers):
    r = client.put(
        "/api/v1/admin/settings",
        json={"voting_mode_global": "thumbs", "rating_enabled": False},
        headers=mod_headers,
    )
    assert r.status_code == 200
    body = client.get("/api/v1/settings").json()
    assert body["voting_mode_global"] == "thumbs"
    assert body["rating_enabled"] is False


def test_update_settings_rejects_invalid_voting_mode(client, mod_headers):
    # SettingsPatch.voting_mode_global = Literal["stars","thumbs"] → 422.
    r = client.put(
        "/api/v1/admin/settings",
        json={"voting_mode_global": "hearts"},
        headers=mod_headers,
    )
    assert r.status_code == 422
