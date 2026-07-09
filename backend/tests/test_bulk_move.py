"""Bulk-Move (Postfach → Herausforderung) — Audit-Befund: ungetestet, obwohl
er der zentrale Triage-Pfad der Moderation ist. Deckt den Erfolgsfall
(alle Knoten referenziert), den Teil-Fehler (Sammelantwort statt Abbruch)
und die Kontrakt-Fehler (unbekanntes Ziel, fehlende Mod-Rechte) ab —
jeweils mit Body-Assertions statt bloßem Status-Check."""

from __future__ import annotations

from conftest import http_error

from app.db import connect


def _seed_topic(topic_id: str = "ch1", title: str = "Ziel") -> None:
    with connect() as con:
        con.execute("INSERT INTO topic (id, title) VALUES (?, ?)", (topic_id, title))


def test_bulk_move_references_all_nodes(client, fake_es, mod_headers):
    _seed_topic()
    r = client.post(
        "/api/v1/moderation/bulk_move",
        json={"node_ids": ["n1", "n2"], "target_topic_id": "ch1"},
        headers=mod_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["moved_to"] == "Ziel"
    assert body["succeeded"] == ["n1", "n2"]
    assert body["succeeded_count"] == 2 and body["failed_count"] == 0
    refs = fake_es.called("add_collection_reference")
    assert {c["node_id"] for c in refs} == {"n1", "n2"}
    assert {c["collection_id"] for c in refs} == {"ch1"}


def test_single_move_prewarms_children_cache(client, fake_es, mod_headers):
    """Wie unten für bulk_move: auch der Einzel-Move wärmt den Anhang-Cache
    der neuen Reference vor (Background-Task nach der Antwort)."""
    _seed_topic()
    r = client.post(
        "/api/v1/moderation/move",
        json={"node_id": "n9", "target_topic_id": "ch1"},
        headers=mod_headers,
    )
    assert r.status_code == 200
    ref_id = "ref::n9::ch1"
    assert any(c["parent_id"] == ref_id for c in fake_es.called("list_child_objects"))
    with connect() as con:
        row = con.execute(
            "SELECT children_cache FROM idea WHERE id=?", (ref_id,)
        ).fetchone()
    assert row is not None and row["children_cache"] == "[]"


def test_bulk_move_prewarms_children_cache(client, fake_es, mod_headers):
    """Prewarm: Nach dem Referenzieren wird der Anhang-Cache der neuen
    Reference-Row als Background-Task gefüllt — der ERSTE Detailaufruf einer
    frisch freigeschalteten Idee zahlt sonst den einzigen verbliebenen
    synchronen ES-Call (Live-Befund: 4,5 s beim Erstaufruf unter ES-Last)."""
    _seed_topic()
    r = client.post(
        "/api/v1/moderation/bulk_move",
        json={"node_ids": ["n1"], "target_topic_id": "ch1"},
        headers=mod_headers,
    )
    assert r.status_code == 200
    ref_id = "ref::n1::ch1"  # FakeES-Namensschema für Reference-Knoten
    assert any(c["parent_id"] == ref_id for c in fake_es.called("list_child_objects"))
    with connect() as con:
        row = con.execute(
            "SELECT children_cache FROM idea WHERE id=?", (ref_id,)
        ).fetchone()
    assert row is not None and row["children_cache"] == "[]"


def test_bulk_move_collects_per_item_failures(client, fake_es, mod_headers, monkeypatch):
    """Ein fehlschlagender Knoten darf die übrigen nicht mitreißen — die
    Antwort listet Erfolge UND Fehler (Sammelantwort, kein Abbruch)."""
    _seed_topic()
    original = fake_es.add_collection_reference

    async def flaky(collection_id, node_id, **kw):
        if node_id == "n2":
            raise http_error(500, "boom")
        return await original(collection_id, node_id, **kw)

    monkeypatch.setattr(fake_es, "add_collection_reference", flaky)
    r = client.post(
        "/api/v1/moderation/bulk_move",
        json={"node_ids": ["n1", "n2", "n3"], "target_topic_id": "ch1"},
        headers=mod_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["succeeded"] == ["n1", "n3"]
    assert body["failed_count"] == 1
    assert body["failed"][0]["id"] == "n2"
    assert body["failed"][0]["status"] == 500


def test_bulk_move_unknown_target_topic_is_404(client, mod_headers):
    r = client.post(
        "/api/v1/moderation/bulk_move",
        json={"node_ids": ["n1"], "target_topic_id": "gibtsnicht"},
        headers=mod_headers,
    )
    assert r.status_code == 404


def test_bulk_move_requires_moderator(client, fake_es, user_headers):
    _seed_topic()
    r = client.post(
        "/api/v1/moderation/bulk_move",
        json={"node_ids": ["n1"], "target_topic_id": "ch1"},
        headers=user_headers,
    )
    assert r.status_code == 403
    assert fake_es.called("add_collection_reference") == []
