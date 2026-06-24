"""Edit-Gating (`_can_edit_idea` + PATCH /ideas/{id}) — die komplexeste
Auth-Logik der App und Hauptziel des Phase-2-Auth-Refactors. Owner, angenommene
Mitwirkende (idea_interaction approved + can_edit) und Mod dürfen bearbeiten;
Fremde nicht. Diese Tests pinnen jede Verzweigung, damit der Refactor das
Berechtigungsverhalten nicht still verändert.
"""

from __future__ import annotations

import base64


def _auth(user: str) -> str:
    return "Basic " + base64.b64encode(f"{user}:pw".encode()).decode()


def _patch(client, idea_id, body, user):
    return client.patch(
        f"/api/v1/ideas/{idea_id}", json=body, headers={"Authorization": _auth(user)}
    )


def test_edit_requires_authentication(client, seed_idea):
    seed_idea("i1", owner_username="alice")
    r = client.patch("/api/v1/ideas/i1", json={"description": "x"})
    assert r.status_code == 401


def test_owner_can_edit_own_idea(client, fake_es, seed_idea):
    seed_idea("i1", owner_username="alice")
    r = _patch(client, "i1", {"description": "neu"}, "alice")
    assert r.status_code == 200
    assert any(c["node_id"] == "i1" for c in fake_es.called("update_metadata"))


def test_non_owner_non_collaborator_is_rejected(client, seed_idea):
    seed_idea("i1", owner_username="bob")
    r = _patch(client, "i1", {"description": "neu"}, "alice")
    assert r.status_code == 403


def test_approved_collaborator_with_can_edit_may_edit(client, fake_es, seed_idea, seed_interaction):
    seed_idea("i1", owner_username="bob")
    seed_interaction("i1", "alice", status="approved", can_edit=1)
    r = _patch(client, "i1", {"description": "neu"}, "alice")
    assert r.status_code == 200
    assert any(c["node_id"] == "i1" for c in fake_es.called("update_metadata"))


def test_collaborator_without_can_edit_is_rejected(client, seed_idea, seed_interaction):
    seed_idea("i1", owner_username="bob")
    seed_interaction("i1", "alice", status="approved", can_edit=0)
    r = _patch(client, "i1", {"description": "neu"}, "alice")
    assert r.status_code == 403


def test_pending_collaborator_is_rejected(client, seed_idea, seed_interaction):
    seed_idea("i1", owner_username="bob")
    seed_interaction("i1", "alice", status="pending", can_edit=1)
    r = _patch(client, "i1", {"description": "neu"}, "alice")
    assert r.status_code == 403


def test_moderator_can_edit_any_idea(client, fake_es, seed_idea, mod_headers):
    seed_idea("i1", owner_username="bob")
    r = client.patch("/api/v1/ideas/i1", json={"description": "neu"}, headers=mod_headers)
    assert r.status_code == 200
    assert any(c["node_id"] == "i1" for c in fake_es.called("update_metadata"))


def test_owner_via_edu_sharing_creator_can_edit(client, fake_es, seed_idea):
    """Cache kennt keinen owner_username → Fallback prüft `cm:creator` live in
    edu-sharing (der zweite Zweig von _is_owner_or_mod)."""
    seed_idea("i1", owner_username=None)
    fake_es.nodes["i1"] = {"properties": {"cm:creator": ["alice"]}}
    r = _patch(client, "i1", {"description": "neu"}, "alice")
    assert r.status_code == 200


# --- Security: project_url darf keine gefährlichen Schemes durchlassen --------


def test_invalid_project_url_scheme_is_rejected(client, seed_idea):
    seed_idea("i1", owner_username="alice")
    r = _patch(client, "i1", {"project_url": "javascript:alert(1)"}, "alice")
    assert r.status_code == 400


def test_valid_project_url_is_accepted(client, fake_es, seed_idea):
    seed_idea("i1", owner_username="alice")
    r = _patch(client, "i1", {"project_url": "https://example.org"}, "alice")
    assert r.status_code == 200
