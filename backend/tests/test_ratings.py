"""Bewerten: Auth-Pflicht, 404 für unbekannte Idee, und dass der Write an
edu-sharing (add_rating / delete_rating) mit dem richtigen Ziel-Knoten erfolgt.

rating=0 (Bewertung zurücknehmen) umgeht das Bewertungsphasen-Gate und eignet
sich daher, um den ES-Write isoliert zu prüfen.
"""

from __future__ import annotations

from app import routes_common
from app.db import connect


def test_rate_requires_authentication(client, seed_idea):
    seed_idea("i1")
    r = client.post("/api/v1/ideas/i1/rating", params={"rating": 4})
    assert r.status_code == 401


def test_rate_unknown_idea_returns_404(client, mod_headers):
    r = client.post("/api/v1/ideas/nope/rating", params={"rating": 0}, headers=mod_headers)
    assert r.status_code == 404


def test_rate_writes_to_edu_sharing(client, fake_es, user_headers, seed_idea):
    seed_idea("i1")  # main_content_id NULL → Rating-Ziel ist die id selbst
    r = client.post("/api/v1/ideas/i1/rating", params={"rating": 0}, headers=user_headers)
    assert r.status_code == 200
    assert any(c["node_id"] == "i1" for c in fake_es.called("add_rating"))


def test_unrate_deletes_rating(client, fake_es, user_headers, seed_idea):
    seed_idea("i1")
    r = client.delete("/api/v1/ideas/i1/rating", headers=user_headers)
    assert r.status_code == 200
    assert any(c["node_id"] == "i1" for c in fake_es.called("delete_rating"))


# --- Bewertungsphase serverseitig durchsetzen (nicht nur UI ausblenden) ------


def test_rate_blocked_when_rating_globally_disabled(client, fake_es, user_headers, seed_idea):
    routes_common._set_setting("rating_enabled", "0")
    seed_idea("i1")
    r = client.post("/api/v1/ideas/i1/rating", params={"rating": 4}, headers=user_headers)
    assert r.status_code == 409
    assert fake_es.called("add_rating") == []  # Gate greift VOR dem ES-Write


def test_rate_blocked_when_event_rating_closed(client, user_headers, seed_idea):
    with connect() as con:
        con.execute(
            "INSERT INTO taxonomy_event (slug, label, created_at, rating_open) VALUES (?, ?, ?, 0)",
            ("ev1", "Event 1", "2026-01-01T00:00:00Z"),
        )
    seed_idea("i1", events=["ev1"])
    r = client.post("/api/v1/ideas/i1/rating", params={"rating": 4}, headers=user_headers)
    assert r.status_code == 409


# --- Read-Back-Wahrheitscheck: edu-sharing wirft bei diesem Endpoint oft 500 --


def test_rate_succeeds_on_phantom_500_when_readback_confirms(
    client, fake_es, user_headers, seed_idea
):
    # Schein-500 ("config.values.rating is null") — das Rating IST persistiert.
    fake_es.add_rating_error = (500, "config.values.rating is null")
    seed_idea("i1")
    fake_es.nodes["i1"] = {"rating": {"overall": {"rating": 3.0, "count": 1}, "user": 3.0}}
    r = client.post("/api/v1/ideas/i1/rating", params={"rating": 3}, headers=user_headers)
    assert r.status_code == 200
    assert r.json()["rating"]["mine"] == 3.0


def test_rate_real_permission_failure_returns_403(client, fake_es, user_headers, seed_idea):
    # Echte Verweigerung: 500 mit DAOSecurityException + Read-Back zeigt nichts.
    fake_es.add_rating_error = (500, "...DAOSecurityException: keine Berechtigung...")
    seed_idea("i1")
    fake_es.nodes["i1"] = {"rating": {"overall": {"rating": 0.0, "count": 0}, "user": 0.0}}
    r = client.post("/api/v1/ideas/i1/rating", params={"rating": 4}, headers=user_headers)
    assert r.status_code == 403


def test_rate_direct_403_is_rejected(client, fake_es, user_headers, seed_idea):
    fake_es.add_rating_error = (403, "forbidden")
    seed_idea("i1")
    r = client.post("/api/v1/ideas/i1/rating", params={"rating": 4}, headers=user_headers)
    assert r.status_code == 403
