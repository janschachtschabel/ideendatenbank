"""Soziale Interaktionen: Interesse („Mithacken anfragen"), Folgen und
Team-Verwaltung. Alles App-DB-Writes mit Login-Verifizierung (`_verify_login`)
gegen edu-sharing — sonst ließe sich per ungeprüftem Basic-Username fremde
Zustände setzen. Die Team-Annahme erteilt `can_edit`, das die Edit-Gating-Tests
(test_edit.py) konsumieren — hier wird die *Erzeugung* dieses Rechts gepinnt.
"""

from __future__ import annotations

import base64

from app.db import connect


def _auth(user: str) -> str:
    return "Basic " + base64.b64encode(f"{user}:pw".encode()).decode()


def _interaction(idea_id: str, user_key: str, kind: str = "interest"):
    with connect() as con:
        return con.execute(
            "SELECT status, can_edit FROM idea_interaction "
            "WHERE idea_id=? AND user_key=? AND kind=?",
            (idea_id, user_key, kind),
        ).fetchone()


def test_interest_requires_login(client, seed_idea):
    seed_idea("i1")
    assert client.post("/api/v1/ideas/i1/interest").status_code == 401


def test_interest_unknown_idea_returns_404(client, user_headers):
    assert client.post("/api/v1/ideas/none/interest", headers=user_headers).status_code == 404


def test_interest_toggles_on_and_off(client, user_headers, seed_idea):
    seed_idea("i1")
    assert client.post("/api/v1/ideas/i1/interest", headers=user_headers).json()["state"] == "added"
    assert _interaction("i1", "user") is not None
    assert (
        client.post("/api/v1/ideas/i1/interest", headers=user_headers).json()["state"] == "removed"
    )
    assert _interaction("i1", "user") is None


def test_follow_toggles_on_and_off(client, user_headers, seed_idea):
    seed_idea("i1")
    assert client.post("/api/v1/ideas/i1/follow", headers=user_headers).json()["state"] == "added"
    assert client.post("/api/v1/ideas/i1/follow", headers=user_headers).json()["state"] == "removed"


def test_owner_approves_member_and_grants_edit(client, seed_idea, seed_interaction):
    seed_idea("i1", owner_username="bob")
    seed_interaction("i1", "alice", status="pending", can_edit=0)
    r = client.put(
        "/api/v1/ideas/i1/team/alice",
        json={"can_edit": True},
        headers={"Authorization": _auth("bob")},
    )
    assert r.status_code == 200
    row = _interaction("i1", "alice")
    assert row["status"] == "approved"
    assert row["can_edit"] == 1


def test_setting_pending_revokes_edit(client, seed_idea, seed_interaction):
    seed_idea("i1", owner_username="bob")
    seed_interaction("i1", "alice", status="approved", can_edit=1)
    r = client.put(
        "/api/v1/ideas/i1/team/alice",
        json={"status": "pending"},
        headers={"Authorization": _auth("bob")},
    )
    assert r.status_code == 200
    row = _interaction("i1", "alice")
    assert row["status"] == "pending"
    assert row["can_edit"] == 0


def test_team_management_rejects_non_owner(client, seed_idea, seed_interaction):
    seed_idea("i1", owner_username="bob")
    seed_interaction("i1", "alice", status="pending", can_edit=0)
    r = client.put(
        "/api/v1/ideas/i1/team/alice",
        json={"can_edit": True},
        headers={"Authorization": _auth("eve")},
    )
    assert r.status_code == 403


def test_team_set_requires_existing_member(client, seed_idea):
    seed_idea("i1", owner_username="bob")
    r = client.put(
        "/api/v1/ideas/i1/team/ghost",
        json={"can_edit": True},
        headers={"Authorization": _auth("bob")},
    )
    assert r.status_code == 404


def test_owner_can_remove_member(client, seed_idea, seed_interaction):
    seed_idea("i1", owner_username="bob")
    seed_interaction("i1", "alice", status="approved", can_edit=1)
    r = client.delete("/api/v1/ideas/i1/team/alice", headers={"Authorization": _auth("bob")})
    assert r.status_code == 200
    assert _interaction("i1", "alice") is None
