"""Taxonomie-Verwaltung (Veranstaltungen/Phasen) — Audit-Befund: die Mod-CRUD-
Routen waren ungetestet, obwohl das Löschen einer Veranstaltung/Phase die
`event:`/`phase:`-Keywords an ALLEN betroffenen Ideen in edu-sharing
umschreibt. Deckt Upsert (inkl. Slug-Kontrakt), das Purge-Verhalten beim
Löschen (ES-Write + Cache-Strip + Zeile weg) und den Teil-Fehler-Pfad
(Zeile bleibt, damit die Mod erneut löschen kann) ab."""

from __future__ import annotations

import json

from conftest import basic_auth

from app.db import connect


def _put_event(client, headers, slug: str, **extra) -> object:
    body = {"slug": slug, "label": extra.pop("label", f"Event {slug}"), **extra}
    return client.put(f"/api/v1/admin/events/{slug}", json=body, headers=headers)


def _event_rows() -> list[str]:
    with connect() as con:
        return [r["slug"] for r in con.execute("SELECT slug FROM taxonomy_event")]


def _events_by_slug(client) -> dict:
    return {e["slug"]: e for e in client.get("/api/v1/events").json()}


def test_sort_taxonomy_updates_only_sort_order(client, mod_headers):
    """Bulk-Reihenfolge (▲▼) in EINEM Call: setzt sort_order für mehrere
    Einträge und lässt Label/Status unangetastet (kein Voll-Upsert je Zeile)."""
    assert _put_event(client, mod_headers, "evt-a", label="Event A").status_code == 200
    assert _put_event(client, mod_headers, "evt-b", label="Event B").status_code == 200
    r = client.put(
        "/api/v1/admin/taxonomy/sort",
        json={
            "kind": "event",
            "items": [
                {"slug": "evt-a", "sort_order": 20},
                {"slug": "evt-b", "sort_order": 10},
            ],
        },
        headers=mod_headers,
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True, "updated": 2}
    events = _events_by_slug(client)
    assert events["evt-a"]["sort_order"] == 20 and events["evt-b"]["sort_order"] == 10
    assert events["evt-a"]["label"] == "Event A"  # Label NICHT überschrieben
    # /events sortiert nach sort_order → evt-b (10) vor evt-a (20)
    order = [e["slug"] for e in client.get("/api/v1/events").json()]
    assert order.index("evt-b") < order.index("evt-a")


def test_sort_taxonomy_phases(client, mod_headers):
    client.put(
        "/api/v1/admin/phases/proto",
        json={"slug": "proto", "label": "Proto"},
        headers=mod_headers,
    )
    r = client.put(
        "/api/v1/admin/taxonomy/sort",
        json={"kind": "phase", "items": [{"slug": "proto", "sort_order": 5}]},
        headers=mod_headers,
    )
    assert r.status_code == 200
    phases = {p["slug"]: p for p in client.get("/api/v1/phases").json()}
    assert phases["proto"]["sort_order"] == 5


def test_sort_taxonomy_requires_moderator(client, user_headers):
    r = client.put(
        "/api/v1/admin/taxonomy/sort",
        json={"kind": "event", "items": [{"slug": "a", "sort_order": 1}]},
        headers=user_headers,
    )
    assert r.status_code == 403


def test_upsert_event_creates_row_and_is_publicly_listed(client, mod_headers):
    r = _put_event(client, mod_headers, "hack-3", label="HackathOERn 3")
    assert r.status_code == 200
    events = client.get("/api/v1/events").json()
    entry = next(e for e in events if e["slug"] == "hack-3")
    assert entry["label"] == "HackathOERn 3"
    assert entry["status"] == "live"
    assert entry["rating_open"] is True


def test_upsert_event_rejects_slug_mismatch(client, mod_headers):
    r = client.put(
        "/api/v1/admin/events/hack-3",
        json={"slug": "anders", "label": "Mismatch"},
        headers=mod_headers,
    )
    assert r.status_code == 400


def test_upsert_event_requires_moderator(client, user_headers):
    r = _put_event(client, user_headers, "hack-3")
    assert r.status_code == 403
    assert _event_rows() == []


def test_draft_events_hidden_from_public_even_with_flag(client, mod_headers):
    """Entwürfe leaken nicht: weder in der Default-Sicht noch wenn ein
    ANONYMER Aufrufer include_drafts=true setzt — nur Mods sehen sie."""
    _put_event(client, mod_headers, "entwurf", status="draft")
    assert "entwurf" not in [e["slug"] for e in client.get("/api/v1/events").json()]
    anon_with_flag = client.get("/api/v1/events?include_drafts=true").json()
    assert "entwurf" not in [e["slug"] for e in anon_with_flag]
    mod_with_flag = client.get("/api/v1/events?include_drafts=true", headers=mod_headers).json()
    assert "entwurf" in [e["slug"] for e in mod_with_flag]


def test_delete_event_purges_tag_from_ideas_and_cache(client, fake_es, mod_headers, seed_idea):
    _put_event(client, mod_headers, "hack-3")
    seed_idea("i1", events=["hack-3"])
    fake_es.nodes["i1"] = {
        "ref": {"id": "i1"},
        "properties": {"cclom:general_keyword": ["event:hack-3", "unrelated"]},
    }

    r = client.delete("/api/v1/admin/events/hack-3", headers=mod_headers)
    assert r.status_code == 200
    body = r.json()
    assert body == {"ok": True, "removed": 1, "failed": 0, "total": 1}
    # ES-Write: Keyword-Liste ohne das Event-Tag zurückgeschrieben
    assert any(c["node_id"] == "i1" for c in fake_es.called("update_metadata"))
    # Cache: events-JSON der Idee gestrippt, Taxonomie-Zeile weg
    with connect() as con:
        row = con.execute("SELECT events FROM idea WHERE id='i1'").fetchone()
    assert json.loads(row["events"]) == []
    assert _event_rows() == []


def test_delete_event_keeps_row_on_partial_failure(client, fake_es, mod_headers, seed_idea):
    """Schlägt der Keyword-Strip an einem Knoten fehl (hier: node_metadata
    404), darf die Taxonomie-Zeile NICHT verschwinden — sonst bliebe ein
    verwaister Tag ohne Label, den die Mod nicht mehr löschen könnte."""
    _put_event(client, mod_headers, "hack-3")
    seed_idea("i1", events=["hack-3"])  # fake_es.nodes bewusst leer → 404

    r = client.delete("/api/v1/admin/events/hack-3", headers=mod_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False and body["failed"] == 1
    assert _event_rows() == ["hack-3"]  # bleibt für den zweiten Versuch


def test_upsert_and_delete_phase_roundtrip(client, fake_es, mod_headers, seed_idea):
    r = client.put(
        "/api/v1/admin/phases/proto",
        json={"slug": "proto", "label": "Prototyp"},
        headers=mod_headers,
    )
    assert r.status_code == 200
    # init_db seedet Default-Phasen — daher Enthaltensein statt Gleichheit.
    assert "proto" in [p["slug"] for p in client.get("/api/v1/phases").json()]

    seed_idea("i1")
    with connect() as con:
        con.execute("UPDATE idea SET phase='proto' WHERE id='i1'")
    fake_es.nodes["i1"] = {
        "ref": {"id": "i1"},
        "properties": {"cclom:general_keyword": ["phase:proto"]},
    }

    r = client.delete("/api/v1/admin/phases/proto", headers=mod_headers)
    assert r.status_code == 200
    assert r.json()["ok"] is True
    with connect() as con:
        assert con.execute("SELECT phase FROM idea WHERE id='i1'").fetchone()["phase"] is None
        rows = [r["slug"] for r in con.execute("SELECT slug FROM taxonomy_phase")]
    assert "proto" not in rows  # Default-Phasen aus init_db bleiben unberührt


def test_taxonomy_usage_counts_tagged_ideas(client, mod_headers, seed_idea):
    seed_idea("i1", events=["hack-3"])
    seed_idea("i2", events=["hack-3", "camp"])
    with connect() as con:
        con.execute("UPDATE idea SET phase='proto' WHERE id='i1'")
    r = client.get("/api/v1/admin/taxonomy-usage", headers=mod_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["events"]["hack-3"] == 2
    assert body["events"]["camp"] == 1
    assert body["phases"]["proto"] == 1


def test_delete_event_requires_auth_password_check(client, fake_es, seed_idea):
    """Nicht-Mod (edu-sharing kennt den User nicht als Mod) → 403, ohne dass
    irgendein ES-Write oder DB-Delete passiert."""
    _ = seed_idea
    r = client.delete(
        "/api/v1/admin/events/hack-3",
        headers={"Authorization": basic_auth("rando")},
    )
    assert r.status_code == 403
    assert fake_es.called("update_metadata") == []
