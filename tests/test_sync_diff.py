"""Sync-Differenz (App-Cache ↔ edu-sharing) + Karteileichen-Bereinigung.

Pinnt die zuletzt gebaute Logik: stale-Erkennung, node_status
(deleted / in_inbox / orphaned) und die Bereinigung — ids-Filter, hidden-sicher,
und Abbruch OHNE Löschen bei ES-Fehler (kein Löschen auf unvollständiger Basis).
"""

from __future__ import annotations

from app.db import connect


def _setup_collections(fake_es):
    """root → theme1 → ch1; in ch1 ist genau 'live1' referenziert."""
    fake_es.collections = {
        "root-collection": {"subcollections": [{"ref": {"id": "theme1"}, "title": "Theme 1"}]},
        "theme1": {
            "subcollections": [{"ref": {"id": "ch1"}, "title": "Challenge 1", "properties": {}}]
        },
        "ch1": {"references": [{"ref": {"id": "live1"}, "title": "Live Idea", "properties": {}}]},
    }


def _idea_ids() -> set[str]:
    with connect() as con:
        return {r["id"] for r in con.execute("SELECT id FROM idea").fetchall()}


def test_sync_diff_classifies_stale_by_es_status(client, fake_es, mod_headers, seed_idea):
    _setup_collections(fake_es)
    seed_idea("live1", title="Live Idea")  # referenziert → kein Problem
    seed_idea("stale_gone")  # nirgends + Knoten weg → deleted
    seed_idea("stale_inbox", original_id="orig_inbox")  # Original liegt in Inbox → in_inbox
    seed_idea("hidden1", hidden=1)  # versteckt → kein echtes Sync-Problem
    fake_es.nodes["orig_inbox"] = {"properties": {}}  # existiert noch
    fake_es.inbox_node_ids.add("orig_inbox")  # und liegt im Inbox-Ordner

    r = client.get("/api/v1/moderation/sync-diff", headers=mod_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["cache_count"] == 4
    assert body["live_count"] == 1
    assert body["missing"] == []
    assert body["in_sync"] is False
    assert body["hidden_stale_count"] == 1

    status = {s["id"]: s.get("node_status") for s in body["stale"] if not s.get("hidden")}
    assert status == {"stale_gone": "deleted", "stale_inbox": "in_inbox"}


def test_cleanup_removes_only_real_stale(client, fake_es, mod_headers, seed_idea):
    _setup_collections(fake_es)
    seed_idea("live1")
    seed_idea("stale_gone")
    seed_idea("hidden1", hidden=1)

    r = client.post("/api/v1/moderation/sync-diff/cleanup", headers=mod_headers)
    assert r.status_code == 200
    assert r.json()["removed"] == 1
    # live1 (referenziert) + hidden1 (versteckt) bleiben; nur stale_gone fliegt raus
    assert _idea_ids() == {"live1", "hidden1"}


def test_cleanup_with_ids_removes_only_named(client, fake_es, mod_headers, seed_idea):
    _setup_collections(fake_es)
    seed_idea("live1")
    seed_idea("stale_a")
    seed_idea("stale_b")

    r = client.post(
        "/api/v1/moderation/sync-diff/cleanup",
        json={"ids": ["stale_a"]},
        headers=mod_headers,
    )
    assert r.status_code == 200
    assert r.json()["removed"] == 1
    assert _idea_ids() == {"live1", "stale_b"}


def test_cleanup_aborts_without_deleting_on_es_error(client, fake_es, mod_headers, seed_idea):
    _setup_collections(fake_es)
    seed_idea("live1")
    seed_idea("stale_gone")
    fake_es.fail_collections = True  # Auth bleibt ok, aber der Sammlungs-Walk schlägt fehl

    r = client.post("/api/v1/moderation/sync-diff/cleanup", headers=mod_headers)
    assert r.status_code == 502
    # Nichts gelöscht — kein Löschen auf unvollständiger Datenbasis
    assert _idea_ids() == {"live1", "stale_gone"}
