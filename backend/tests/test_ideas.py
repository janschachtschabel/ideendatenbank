"""Ideen-Lesepfade aus dem Cache: Detail (inkl. Hidden-Gating) und Liste.

`get_idea` holt Live-Metadaten + Kommentare best-effort PARALLEL (asyncio.gather,
Fehler werden pro Read abgefangen), funktioniert aber rein aus dem Cache, wenn der
Knoten nicht (mehr) lesbar ist — genau das pinnen diese Tests.
"""

from __future__ import annotations


def test_get_cached_idea(client, seed_idea):
    seed_idea("idea1", title="Meine Idee")
    r = client.get("/api/v1/ideas/idea1")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "idea1"
    assert body["title"] == "Meine Idee"


def test_get_missing_idea_returns_404(client):
    # Cache-Miss → refresh_idea → node_metadata 404 (FakeES) → False → 404.
    r = client.get("/api/v1/ideas/does-not-exist")
    assert r.status_code == 404


def test_hidden_idea_is_404_for_anonymous(client, seed_idea):
    seed_idea("h1", hidden=1)
    r = client.get("/api/v1/ideas/h1")
    assert r.status_code == 404


def test_hidden_idea_visible_for_moderator(client, seed_idea, mod_headers):
    seed_idea("h1", title="Versteckt", hidden=1)
    r = client.get("/api/v1/ideas/h1", headers=mod_headers)
    assert r.status_code == 200
    assert r.json()["hidden"] is True


def test_get_idea_serves_without_node_metadata(client, fake_es, seed_idea):
    """Voll-Cache (A): die Detailseite holt KEIN Live-`node_metadata` mehr —
    Rating/Owner kommen aus dem SQLite-Cache. (Früher wurde der Knoten 1× geholt;
    seit dem Voll-Cache 0×.) Die Antwort-Shape bleibt unverändert."""
    seed_idea("i1")  # kind='io', main_content_id NULL
    fake_es.nodes["i1"] = {"ref": {"id": "i1"}, "properties": {}}
    r = client.get("/api/v1/ideas/i1")
    assert r.status_code == 200
    body = r.json()
    assert "comments" in body and "attachments" in body
    meta_calls = [c for c in fake_es.called("node_metadata") if c.get("node_id") == "i1"]
    assert len(meta_calls) == 0


def test_list_excludes_hidden_ideas(client, seed_idea):
    seed_idea("a", title="Sichtbar A")
    seed_idea("b", title="Sichtbar B")
    seed_idea("secret", title="Versteckt", hidden=1)
    r = client.get("/api/v1/ideas")
    assert r.status_code == 200
    ids = {it["id"] for it in r.json()["items"]}
    assert {"a", "b"} <= ids
    assert "secret" not in ids
