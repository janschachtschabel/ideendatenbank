"""Voll-Cache der Detailseite (A+B): `get_idea` bedient Rating/Owner (A) und den
Kommentar-Thread (B) aus dem SQLite-Cache statt live von edu-sharing.

Gepinnt:
- A: KEIN Live-`node_metadata` mehr; Rating aus Cache; Owner-Anzeigename aus
  `user_profile_meta` (Fallback Username); eigene Stimme aus `vote_event`.
- B: Kommentar-Cache mit `comment_count`-Invalidierung (Hit = kein Call, Miss =
  ein Live-Call + Cache-Update).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from app.db import connect


def _set(idea_id: str, **cols) -> None:
    """Cache-Spalten der Idee direkt setzen (die seed_idea-Fixture deckt sie nicht)."""
    assignments = ", ".join(f"{k}=?" for k in cols)
    with connect() as con:
        con.execute(f"UPDATE idea SET {assignments} WHERE id=?", (*cols.values(), idea_id))


# ---- A: Rating / Owner / eigene Stimme aus dem Cache -----------------------


def test_get_idea_does_not_call_node_metadata(client, fake_es, seed_idea):
    """A: Rating kommt aus dem Cache → KEIN Live-`node_metadata`-Call."""
    seed_idea("i1", owner_username="alice")
    _set("i1", rating_avg=4.5, rating_count=10)
    r = client.get("/api/v1/ideas/i1")
    assert r.status_code == 200
    body = r.json()
    assert body["rating_avg"] == 4.5
    assert body["rating_count"] == 10
    assert fake_es.called("node_metadata") == []


def test_owner_display_name_from_profile_cache(client, seed_idea):
    """A: Owner-Anzeigename aus `user_profile_meta`."""
    seed_idea("i1", owner_username="alice")
    with connect() as con:
        con.execute(
            "INSERT INTO user_profile_meta (username, display_name, updated_at) "
            "VALUES ('alice','Alice Wonder','2026-01-01T00:00:00Z')"
        )
    r = client.get("/api/v1/ideas/i1")
    assert r.json()["owner_display_name"] == "Alice Wonder"


def test_owner_display_name_never_exposes_username(client, seed_idea):
    """A (Security): ohne App-Profilnamen UND ohne gecachten Klarnamen wird der
    Login-Username NICHT angezeigt (er ist zugleich der Anmeldename) → None."""
    seed_idea("i1", owner_username="bob")  # kein user_profile_meta, kein owner_display_name
    r = client.get("/api/v1/ideas/i1")
    assert r.json()["owner_display_name"] is None
    assert r.json()["owner_display_name"] != "bob"


def test_owner_display_name_from_cached_realname(client, seed_idea):
    """A: der beim Sync aus edu-sharing (createdBy/owner) gespeicherte Klarname
    wird ohne Live-Call angezeigt — nicht der Username."""
    seed_idea("i1", owner_username="bob")
    _set("i1", owner_display_name="Bob Builder")
    r = client.get("/api/v1/ideas/i1")
    assert r.json()["owner_display_name"] == "Bob Builder"


def test_my_rating_from_vote_event_ledger(client, seed_idea, user_headers):
    """A: eigene Stimme aus dem `vote_event`-Ledger statt live."""
    seed_idea("i1")
    with connect() as con:
        con.execute(
            "INSERT INTO vote_event (idea_id,user_key,value,created_at) "
            "VALUES ('i1','user',4.0,'2026-01-01T00:00:00Z')"
        )
    r = client.get("/api/v1/ideas/i1", headers=user_headers)
    assert r.json()["my_rating"] == 4.0


# ---- B: Kommentar-Cache mit Count-Invalidierung ----------------------------


def test_comments_served_from_cache_when_count_matches(client, fake_es, seed_idea):
    """B: Cache-Hit (`comments_cache_count == comment_count`) → KEIN Live-Call."""
    seed_idea("i1")
    _set(
        "i1",
        comment_count=2,
        comments_cache=json.dumps([{"id": "c1"}, {"id": "c2"}]),
        comments_cache_count=2,
    )
    r = client.get("/api/v1/ideas/i1")
    assert r.status_code == 200
    assert len(r.json()["comments"]) == 2
    assert fake_es.called("comments") == []


def test_comments_refetched_when_count_changed(client, fake_es, seed_idea):
    """B: Count-Mismatch → Cache veraltet → ein Live-Call + Cache-Update."""
    seed_idea("i1")
    _set(
        "i1",
        comment_count=3,
        comments_cache=json.dumps([{"id": "c1"}]),
        comments_cache_count=1,
    )
    r = client.get("/api/v1/ideas/i1")
    assert r.status_code == 200
    assert fake_es.called("comments")  # Live-Call erfolgte (FakeES liefert [])
    with connect() as con:
        row = con.execute("SELECT comments_cache_count FROM idea WHERE id='i1'").fetchone()
    assert row["comments_cache_count"] == 3  # Cache mit aktuellem Count neu geschrieben


def test_comments_live_when_no_cache(client, fake_es, seed_idea):
    """B: leerer Cache → Live-Call (und füllt den Cache)."""
    seed_idea("i1")
    _set("i1", comment_count=1)  # comments_cache bleibt NULL
    r = client.get("/api/v1/ideas/i1")
    assert r.status_code == 200
    assert fake_es.called("comments")


# ---- C: Child-IO-Anhänge mit TTL-Cache -------------------------------------


def test_child_attachments_served_from_cache_when_fresh(client, fake_es, seed_idea):
    """C: frischer children_cache (innerhalb TTL) → KEIN list_child_objects-Call."""
    seed_idea("i1")
    _set(
        "i1",
        children_cache=json.dumps([{"id": "att1", "is_child_object": True}]),
        children_cache_at=datetime.now(UTC).isoformat(),
    )
    r = client.get("/api/v1/ideas/i1")
    assert r.status_code == 200
    assert fake_es.called("list_child_objects") == []
    assert any(a.get("id") == "att1" for a in r.json()["attachments"])


def test_child_attachments_refetched_when_expired(client, fake_es, seed_idea):
    """C: abgelaufener children_cache → Live-`list_child_objects` + Cache-Update."""
    seed_idea("i1")
    _set(
        "i1",
        children_cache=json.dumps([{"id": "old"}]),
        children_cache_at="2020-01-01T00:00:00+00:00",  # uralt → abgelaufen
    )
    r = client.get("/api/v1/ideas/i1")
    assert r.status_code == 200
    assert fake_es.called("list_child_objects")
    with connect() as con:
        row = con.execute("SELECT children_cache_at FROM idea WHERE id='i1'").fetchone()
    assert row["children_cache_at"] != "2020-01-01T00:00:00+00:00"  # neu geschrieben


def test_child_attachments_live_when_no_cache(client, fake_es, seed_idea):
    """C: leerer children_cache → Live-Call (füllt den Cache)."""
    seed_idea("i1")
    r = client.get("/api/v1/ideas/i1")
    assert r.status_code == 200
    assert fake_es.called("list_child_objects")
