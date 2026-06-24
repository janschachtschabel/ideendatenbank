"""Moderations-Seiten-Effekte, die Refactors erhalten müssen:

- Verstecken/Einblenden setzt das App-DB-Flag UND entzieht/erteilt die
  öffentliche edu-sharing-Freigabe des Originals (unpublish_node/publish_node).
- Löschen entfernt die Sammlungs-Referenz UND das Inbox-Original (delete_node)
  und räumt den Cache.
- Herausforderung wechseln referenziert das Original in das Ziel-Topic und macht
  es öffentlich (publish-on-move).
"""

from __future__ import annotations

from app.db import connect


def _seed_topic(topic_id: str, title: str = "Challenge") -> None:
    with connect() as con:
        con.execute("INSERT INTO topic (id, title) VALUES (?, ?)", (topic_id, title))


def test_hide_sets_flag_and_unpublishes_original(client, fake_es, mod_headers, seed_idea):
    seed_idea("i1", original_id="orig1")
    r = client.post("/api/v1/admin/ideas/i1/hide", headers=mod_headers)
    assert r.status_code == 200
    with connect() as con:
        assert con.execute("SELECT hidden FROM idea WHERE id='i1'").fetchone()["hidden"] == 1
    assert any(c["node_id"] == "orig1" for c in fake_es.called("unpublish_node"))


def test_unhide_clears_flag_and_publishes_original(client, fake_es, mod_headers, seed_idea):
    seed_idea("i1", original_id="orig1", hidden=1)
    r = client.post("/api/v1/admin/ideas/i1/unhide", headers=mod_headers)
    assert r.status_code == 200
    with connect() as con:
        assert con.execute("SELECT hidden FROM idea WHERE id='i1'").fetchone()["hidden"] == 0
    assert any(c["node_id"] == "orig1" for c in fake_es.called("publish_node"))


def test_delete_removes_reference_and_original_and_purges_cache(
    client, fake_es, mod_headers, seed_idea
):
    seed_idea("ref1", original_id="orig1")
    r = client.delete("/api/v1/ideas/ref1", headers=mod_headers)
    assert r.status_code == 200
    deleted = {c["node_id"] for c in fake_es.called("delete_node")}
    assert {"ref1", "orig1"} <= deleted  # Referenz + Inbox-Original
    with connect() as con:
        assert con.execute("SELECT COUNT(*) AS c FROM idea WHERE id='ref1'").fetchone()["c"] == 0


def test_delete_requires_authentication(client, seed_idea):
    seed_idea("ref1")
    r = client.delete("/api/v1/ideas/ref1")
    assert r.status_code == 401


def test_delete_keeps_original_when_another_reference_shares_it(
    client, fake_es, mod_headers, seed_idea
):
    # Zwei Referenzen teilen sich dasselbe Inbox-Original (Mehrfach-Referenz).
    seed_idea("refA", original_id="origX")
    seed_idea("refB", original_id="origX")
    r = client.delete("/api/v1/ideas/refA", headers=mod_headers)
    assert r.status_code == 200
    deleted = {c["node_id"] for c in fake_es.called("delete_node")}
    assert "refA" in deleted  # die gelöschte Referenz
    assert "origX" not in deleted  # geteiltes Original bleibt (refB nutzt es noch)


def test_change_topic_references_original_and_publishes(client, fake_es, mod_headers, seed_idea):
    _seed_topic("ch_target", "Ziel-Herausforderung")
    seed_idea("ref_old", original_id="orig1", topic_id="ch_old")
    r = client.post(
        "/api/v1/moderation/ideas/ref_old/change-topic",
        json={"new_topic_id": "ch_target"},
        headers=mod_headers,
    )
    assert r.status_code == 200
    assert any(c["node_id"] == "orig1" for c in fake_es.called("add_collection_reference"))
    assert any(c["node_id"] == "orig1" for c in fake_es.called("publish_node"))
