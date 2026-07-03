"""Themen-/Herausforderungs-Verwaltung (Mod-only) — Audit-Befund: die
CRUD-Routen waren ungetestet. Deckt Anlegen (ES-Create + Cache-Write),
Bearbeiten (ES-Metadaten + Cache-Patch), den Lösch-Preflight (409 bei
nicht-leerer Sammlung), das eigentliche Löschen und die Sortierung ab."""

from __future__ import annotations

from app.db import connect


def _seed_topic(topic_id: str, title: str = "Thema", parent_id: str | None = None) -> None:
    with connect() as con:
        con.execute(
            "INSERT INTO topic (id, parent_id, title) VALUES (?, ?, ?)",
            (topic_id, parent_id, title),
        )


def _topic(topic_id: str) -> dict | None:
    with connect() as con:
        row = con.execute("SELECT * FROM topic WHERE id=?", (topic_id,)).fetchone()
    return dict(row) if row else None


def test_create_topic_writes_es_and_cache(client, fake_es, mod_headers):
    r = client.post(
        "/api/v1/admin/topics",
        json={"title": "Neues Thema", "description": "Desc"},
        headers=mod_headers,
    )
    assert r.status_code == 201
    new_id = r.json()["id"]
    assert new_id  # FakeES liefert coll::<title>
    assert any(c["title"] == "Neues Thema" for c in fake_es.called("create_collection"))
    row = _topic(new_id)
    assert row and row["title"] == "Neues Thema" and row["description"] == "Desc"


def test_edit_topic_updates_es_metadata_and_cache(client, fake_es, mod_headers):
    _seed_topic("t1", "Alt")
    r = client.patch(
        "/api/v1/admin/topics/t1",
        json={"title": "Neu", "color": "#123456"},
        headers=mod_headers,
    )
    assert r.status_code == 200 and r.json()["ok"] is True
    assert any(c["node_id"] == "t1" for c in fake_es.called("update_metadata"))
    row = _topic("t1")
    assert row["title"] == "Neu" and row["color"] == "#123456"


def test_delete_topic_preflight_blocks_non_empty(client, fake_es, mod_headers, seed_idea):
    _seed_topic("t1")
    seed_idea("i1", topic_id="t1")
    r = client.delete("/api/v1/admin/topics/t1", headers=mod_headers)
    assert r.status_code == 409
    assert "1 Idee" in r.json()["detail"]
    assert fake_es.called("delete_node") == []  # kein ES-Delete bei Preflight-Stopp
    assert _topic("t1") is not None


def test_delete_topic_preflight_blocks_with_children(client, mod_headers):
    _seed_topic("t1")
    _seed_topic("t1-child", parent_id="t1")
    r = client.delete("/api/v1/admin/topics/t1", headers=mod_headers)
    assert r.status_code == 409


def test_delete_empty_topic_removes_es_node_and_cache_row(client, fake_es, mod_headers):
    _seed_topic("t1")
    r = client.delete("/api/v1/admin/topics/t1", headers=mod_headers)
    assert r.status_code == 200 and r.json()["ok"] is True
    assert any(c["node_id"] == "t1" for c in fake_es.called("delete_node"))
    assert _topic("t1") is None


def test_sort_topics_persists_order(client, mod_headers):
    _seed_topic("a")
    _seed_topic("b")
    r = client.put(
        "/api/v1/admin/topics/sort",
        json=[{"id": "a", "sort_order": 20}, {"id": "b", "sort_order": 10}],
        headers=mod_headers,
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True, "updated": 2}
    assert _topic("a")["sort_order"] == 20
    assert _topic("b")["sort_order"] == 10


def test_create_topic_requires_moderator(client, fake_es, user_headers):
    r = client.post(
        "/api/v1/admin/topics", json={"title": "Nope"}, headers=user_headers
    )
    assert r.status_code == 403
    assert fake_es.called("create_collection") == []
