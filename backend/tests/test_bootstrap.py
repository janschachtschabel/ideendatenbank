"""/bootstrap — gebündelter Erststart-Datensatz (Performance-Fix).

Pinnt, dass `/bootstrap` eine ORIGINALGETREUE Aggregation der Einzel-Endpoints
ist: Wenn sich `topics`/`meta`/`phases`/`events`/`featured`/`settings` ändern,
muss der Bootstrap identisch mitziehen — sonst sieht die App-Shell beim
gebündelten Laden andere Daten als bei den Einzel-Calls. Außerdem: rein lokal
(SQLite/Settings), kein edu-sharing-Roundtrip.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.db import connect


def _seed_topic(topic_id: str, *, parent_id: str | None = None, title: str = "Thema") -> None:
    with connect() as con:
        con.execute(
            "INSERT INTO topic (id, parent_id, title) VALUES (?, ?, ?)",
            (topic_id, parent_id, title),
        )


def _seed_phase(slug: str, *, label: str = "Anregung") -> None:
    with connect() as con:
        con.execute(
            "INSERT INTO taxonomy_phase (slug, label, created_at) VALUES (?, ?, ?)",
            (slug, label, datetime.now(UTC).isoformat()),
        )


def _seed_event(slug: str, *, label: str = "HackathOERn", featured: bool = False) -> None:
    until = (datetime.now(UTC) + timedelta(days=7)).isoformat() if featured else None
    with connect() as con:
        con.execute(
            "INSERT INTO taxonomy_event (slug, label, status, active, featured_until, created_at) "
            "VALUES (?, ?, 'live', 1, ?, ?)",
            (slug, label, until, datetime.now(UTC).isoformat()),
        )


def _seed_full(seed_idea) -> None:
    """Topic + Phase + (featured) Event + eine getaggte Idee — damit die
    aggregierten Facetten/Listen nicht trivial leer sind."""
    _seed_topic("t1", title="Infrastruktur")
    _seed_phase("zz-test-phase")  # Default-Phasen existieren bereits via init_db()
    _seed_event("hack3", featured=True)
    seed_idea("i1", title="Idee", topic_id="t1", events=["hack3"])


def test_bootstrap_shape(client):
    r = client.get("/api/v1/bootstrap")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"topics", "meta", "phases", "events", "featured_events", "settings"}
    assert isinstance(body["topics"], list)
    assert isinstance(body["phases"], list)
    assert isinstance(body["events"], list)
    assert isinstance(body["featured_events"], list)
    assert isinstance(body["settings"], dict)
    # meta hat die erwarteten Facetten-Schlüssel
    assert set(body["meta"]) >= {"phases", "events", "categories", "topics"}


def test_bootstrap_matches_individual_endpoints(client, seed_idea):
    """Jeder Bootstrap-Teil ist identisch zum jeweiligen Einzel-Endpoint —
    so kann Bootstrap nie still von den Quellen divergieren."""
    _seed_full(seed_idea)

    boot = client.get("/api/v1/bootstrap").json()

    assert boot["topics"] == client.get("/api/v1/topics").json()
    assert boot["meta"] == client.get("/api/v1/meta").json()
    assert boot["phases"] == client.get("/api/v1/phases").json()
    assert boot["settings"] == client.get("/api/v1/settings").json()
    assert boot["featured_events"] == client.get("/api/v1/events/featured").json()
    # Shell lädt Events als includeInactive+includeArchived (= only_active=false).
    events_single = client.get("/api/v1/events?only_active=false&include_archived=true").json()
    assert boot["events"] == events_single


def test_bootstrap_does_not_touch_edu_sharing(client, fake_es, seed_idea):
    """Bootstrap ist rein lokal — kein einziger edu-sharing-Call (sonst würde der
    'schnelle' Erststart-Call doch wieder vom Repo abhängen)."""
    _seed_full(seed_idea)
    client.get("/api/v1/bootstrap")
    assert fake_es.calls == []


def test_bootstrap_meta_is_unfiltered(client, seed_idea):
    """Die Bootstrap-Facetten entsprechen dem ungefilterten /meta (wie meta({}))
    — die scoped Filter-Pillen lädt die Shell weiterhin separat via loadFacets."""
    _seed_full(seed_idea)
    boot = client.get("/api/v1/bootstrap").json()
    assert boot["meta"] == client.get("/api/v1/meta").json()
    # Die getaggte Idee schlägt sich in den ungefilterten Counts nieder.
    assert boot["meta"]["topics"].get("t1") == 1
