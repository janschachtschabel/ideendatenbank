"""DELETE /ideas/{id} — Zugriffskontrolle (Audit-Lücke: Gating war ungetestet).

Löschen ist Owner/Mod vorbehalten. Der Owner-Pfad greift nur mit
zugesicherter Passwort-Verifikation (is_owner_or_mod(verified=True) im Handler)
— hier über den my_memberships-verifizierten FakeES.
"""

from __future__ import annotations


def test_delete_idea_rejects_anonymous(client, seed_idea):
    seed_idea("i1", owner_username="owner")
    assert client.delete("/api/v1/ideas/i1").status_code == 401


def test_delete_idea_rejects_non_owner_non_mod(client, user_headers, seed_idea):
    seed_idea("i1", owner_username="someone-else")
    r = client.delete("/api/v1/ideas/i1", headers=user_headers)
    assert r.status_code == 403


def test_delete_idea_allows_owner(client, user_headers, seed_idea, fake_es):
    # user "user" ist Owner → darf löschen. Der ES-delete_node wird aufgerufen.
    seed_idea("i1", owner_username="user")
    r = client.delete("/api/v1/ideas/i1", headers=user_headers)
    assert r.status_code == 200
    assert any(c["node_id"] == "i1" for c in fake_es.called("delete_node"))


def test_delete_idea_allows_moderator(client, mod_headers, seed_idea, fake_es):
    seed_idea("i1", owner_username="someone-else")
    r = client.delete("/api/v1/ideas/i1", headers=mod_headers)
    assert r.status_code == 200
