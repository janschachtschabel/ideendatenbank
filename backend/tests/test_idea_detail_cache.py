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
from datetime import UTC, datetime, timedelta

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


def test_list_never_exposes_username_as_name(client, seed_idea):
    """Security: in der Liste (und damit Rangliste/Karten via _row_to_idea) wird
    der Login-Username weder als `author` noch als `owner_display_name`
    ausgeliefert, wenn `author` nur der Login (cm:creator) ist."""
    seed_idea("i1", owner_username="bob")
    _set("i1", author="bob")  # author == Login, kein echter Freitext-Autor
    item = next(x for x in client.get("/api/v1/ideas").json()["items"] if x["id"] == "i1")
    assert item["author"] is None
    assert item["owner_display_name"] is None
    assert item["owner_username"] == "bob"  # bleibt für Profil-Link/Owner-Check


def test_list_keeps_real_freetext_author(client, seed_idea):
    """Ein echter Freitext-Autor (≠ Login) bleibt als Name erhalten."""
    seed_idea("i2", owner_username="bob")
    _set("i2", author="Bob Builder")
    item = next(x for x in client.get("/api/v1/ideas").json()["items"] if x["id"] == "i2")
    assert item["author"] == "Bob Builder"
    assert item["owner_display_name"] == "Bob Builder"


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


# ---- D: Owner-Check ohne Live-Roundtrip -------------------------------------
# can_edit/can_delete sind reine UI-Flags — die echte Mutation re-verifiziert
# serverseitig (dort bleibt der Live-Fallback). Der Detail-Pfad vertraut dem
# Cache, sobald der den Owner kennt.


def _basic(user: str) -> dict:
    import base64

    return {"Authorization": "Basic " + base64.b64encode(f"{user}:pw".encode()).decode()}


def test_detail_view_by_non_owner_does_no_live_owner_check(client, fake_es, seed_idea):
    """D: Eingeloggter Nicht-Owner öffnet eine gecachte fremde Idee → KEIN
    Live-node_metadata für die UI-Flags. (Vorher: ungecachter ~300–450-ms-
    ES-Call auf JEDEM Detailaufruf fremder Ideen; bei ES-Hängern bis zum
    30-s-Timeout — die gemeldeten Einzel-Ausreißer.)"""
    seed_idea("i1", owner_username="alice")
    r = client.get("/api/v1/ideas/i1", headers=_basic("user"))
    assert r.status_code == 200
    assert r.json()["can_edit"] is False
    assert r.json()["can_delete"] is False
    assert fake_es.called("node_metadata") == []


def test_detail_view_owner_gets_edit_flag_from_cache_alone(client, fake_es, seed_idea):
    """D: Der Owner bekommt can_edit=True aus dem Cache-Match — ebenfalls ohne
    Live-Call."""
    seed_idea("i1", owner_username="alice")
    r = client.get("/api/v1/ideas/i1", headers=_basic("alice"))
    assert r.json()["can_edit"] is True
    assert fake_es.called("node_metadata") == []


def test_interactions_view_does_no_live_owner_check(client, fake_es, seed_idea):
    """D: Auch der interactions-GET (lädt die Detailseite bei jedem Öffnen
    parallel!) darf für das reine `can_manage`-UI-Flag keinen Live-Roundtrip
    machen — gleiche Klasse wie get_idea; die echten Team-Mutationen
    (set/remove_team_member) re-verifizieren weiterhin live."""
    seed_idea("i1", owner_username="alice")
    r = client.get("/api/v1/ideas/i1/interactions", headers=_basic("user"))
    assert r.status_code == 200
    assert r.json()["interest"]["can_manage"] is False
    assert fake_es.called("node_metadata") == []


def test_detail_view_falls_back_live_when_cache_owner_unknown(client, fake_es, seed_idea):
    """D (Randfall): Cache-Row OHNE owner_username → der Live-Blick bleibt,
    damit der echte Submitter seinen Edit-Button behält."""
    seed_idea("i1", owner_username=None)
    fake_es.nodes["i1"] = {
        "ref": {"id": "i1"},
        "properties": {"cm:creator": ["user"]},
        "parent": {"id": "ch1"},
    }
    r = client.get("/api/v1/ideas/i1", headers=_basic("user"))
    assert r.json()["can_edit"] is True
    assert fake_es.called("node_metadata")


def test_detail_view_survives_es_outage_with_stale_mod_status(client, fake_es, seed_idea):
    """D (SWR-Mod-Status): Nach TTL-Ablauf trägt der STALE Mod-Status die
    UI-Flags der Detailseite — sofort und sogar bei ES-Ausfall — statt jeden
    Ideenwechsel ~1,2 s am blockierenden my_memberships-Roundtrip hängen zu
    lassen (Live-Befund). Die Mod-GATES bleiben streng (separat gepinnt in
    test_auth_cache)."""
    import time as _time

    from app import auth as auth_mod

    fake_es.mods.add("user")
    hdr = _basic("user")
    seed_idea("i1", owner_username="alice")
    r1 = client.get("/api/v1/ideas/i1", headers=hdr)
    assert r1.json()["can_edit"] is True  # Mod → Edit-Flag (warm, 1 Call)
    # TTL abgelaufen + edu-sharing down:
    key = auth_mod._auth_cache_key(hdr["Authorization"])
    val, _exp = auth_mod._MOD_CACHE[key]
    auth_mod._MOD_CACHE[key] = (val, _time.monotonic() - 1)
    fake_es.fail_es = True
    r2 = client.get("/api/v1/ideas/i1", headers=hdr)
    assert r2.status_code == 200
    assert r2.json()["can_edit"] is True  # stale-Status trägt die Anzeige


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
    """B: leerer Cache MIT Kommentaren (count>0) → Live-Call (und füllt den Cache)."""
    seed_idea("i1")
    _set("i1", comment_count=1)  # comments_cache bleibt NULL
    r = client.get("/api/v1/ideas/i1")
    assert r.status_code == 200
    assert fake_es.called("comments")


def test_comments_skipped_when_count_zero(client, fake_es, seed_idea):
    """B: comment_count==0 → beweisbar keine Kommentare → KEIN Live-Call, auch
    ohne Cache. Der häufigste Fall (kommentarlose Idee); spart beim Erstaufruf
    den ~300-450-ms-ES-Roundtrip, den die Detailseite sonst kostete."""
    seed_idea("i1")  # comment_count-Default 0, comments_cache NULL
    r = client.get("/api/v1/ideas/i1")
    assert r.status_code == 200
    assert r.json()["comments"] == []
    assert fake_es.called("comments") == []


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


def test_child_attachments_stale_cache_served_instantly_then_refreshed(client, fake_es, seed_idea):
    """C (SWR): ABGELAUFENER children_cache wird sofort ausgeliefert — kein
    ES-Roundtrip im Antwortpfad. Der Refresh läuft NACH der Antwort als
    Background-Task und stempelt den Cache neu. Kein Aufruf zahlt mehr die
    Anhang-Latenz; die ES-Last bleibt identisch (gleich viele Refreshes,
    nur asynchron). Anhang-Mutationen über die App invalidieren den Cache
    weiterhin sofort — Staleness betrifft nur Out-of-band-Änderungen."""
    seed_idea("i1")
    _set(
        "i1",
        children_cache=json.dumps([{"id": "old-att", "is_child_object": True}]),
        children_cache_at="2020-01-01T00:00:00+00:00",  # längst abgelaufen
    )
    r = client.get("/api/v1/ideas/i1")
    assert r.status_code == 200
    # Antwort enthält SOFORT die gecachten (ggf. leicht veralteten) Anhänge
    assert any(a.get("id") == "old-att" for a in r.json()["attachments"])
    # Hintergrund-Refresh ist gelaufen (TestClient wartet Background-Tasks ab) …
    assert fake_es.called("list_child_objects")
    # … und hat den Cache mit frischem Stand + Zeitstempel überschrieben.
    with connect() as con:
        row = con.execute(
            "SELECT children_cache, children_cache_at FROM idea WHERE id='i1'"
        ).fetchone()
    assert row["children_cache_at"] != "2020-01-01T00:00:00+00:00"
    assert json.loads(row["children_cache"]) == []  # FakeES liefert keine Children


def test_child_attachments_failure_negative_cached(client, fake_es, seed_idea):
    """C: Schlägt der Anhang-Live-Call fehl (z.B. Gast ohne Leserecht auf
    dieser Instanz), wird der Leer-Fallback KURZ gecacht (Stempel in der
    nahen Vergangenheit) — der nächste Aufruf trifft den Cache statt bei
    JEDEM Detailaufruf synchron gegen das werfende edu-sharing zu laufen.
    Live-Befund: konstante +0,2 s auf jedem get_idea der hackathoern-Instanz."""
    seed_idea("i1")
    fake_es.child_objects_error = True
    r1 = client.get("/api/v1/ideas/i1")
    assert r1.status_code == 200
    assert r1.json()["attachments"] == []
    assert len(fake_es.called("list_child_objects")) == 1
    with connect() as con:
        row = con.execute(
            "SELECT children_cache, children_cache_at FROM idea WHERE id='i1'"
        ).fetchone()
    assert row["children_cache"] == "[]"  # Fehlerfall gecacht …
    assert row["children_cache_at"] is not None  # … mit (kurzem) Stempel
    # Zweiter Aufruf SOFORT danach: Negative-Cache greift → KEIN weiterer
    # synchroner ES-Call im Antwortpfad.
    r2 = client.get("/api/v1/ideas/i1")
    assert r2.status_code == 200
    assert r2.json()["attachments"] == []
    assert len(fake_es.called("list_child_objects")) == 1


def test_child_attachments_cache_survives_far_beyond_old_60s(client, fake_es, seed_idea):
    """C: der children_cache überlebt jetzt weit länger als die frühere 60-s-TTL —
    ein 5-Minuten-alter Cache wird OHNE Live-Call serviert (unter 60 s wäre es ein
    Call gewesen). Anhang-Mutationen invalidieren ohnehin sofort; die TTL bewacht
    nur seltene out-of-band-Änderungen. Pinnt die Behebung der Detailseiten-Latenz."""
    seed_idea("i1")
    _set(
        "i1",
        children_cache=json.dumps([{"id": "att1", "is_child_object": True}]),
        children_cache_at=(datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
    )
    r = client.get("/api/v1/ideas/i1")
    assert r.status_code == 200
    assert fake_es.called("list_child_objects") == []
    assert any(a.get("id") == "att1" for a in r.json()["attachments"])
