"""Ideengeber-Attribution — Regression für den Freischalt-Bug.

Beim Einsortieren (Move Inbox → Herausforderung) legt der MOD-Account den
Reference-Knoten in der Sammlung an → dessen `createdBy`/`owner` ist der Mod,
nicht der Einreicher. Der Sync darf diesen Klarnamen NICHT als
`owner_display_name` cachen, sonst steht auf der Ideenseite der Mod als
„Ideengeber:in".

Gepinnt (Anzeige-Priorität laut Anforderung):
  1. author-Freitext aus der Einreichung
  2. Klarname des einreichenden WLO-Users (nie der Login)
  3. „Anonym" (Frontend-Fallback) — nie der Mod, nie der Guest-Service-Account
"""

from __future__ import annotations

from app import sync as sync_mod
from app.config import settings
from app.db import connect


def _node(
    ref: str,
    *,
    props: dict | None = None,
    keywords: list[str] | None = None,
    created_by: dict | None = None,
    owner: dict | None = None,
) -> dict:
    """Minimaler edu-sharing-Node fürs direkte `_upsert_idea`."""
    p: dict = {"cm:name": ["idee.html"]}
    if keywords:
        p["cclom:general_keyword"] = keywords
    p.update(props or {})
    n: dict = {"ref": {"id": ref}, "title": "Idee", "properties": p}
    if created_by is not None:
        n["createdBy"] = created_by
    if owner is not None:
        n["owner"] = owner
    return n


def _upsert(node: dict) -> None:
    with connect() as con:
        sync_mod._upsert_idea(con, node, topic_id="ch1", main_content_id=node["ref"]["id"])


def _row(idea_id: str):
    with connect() as con:
        return con.execute(
            "SELECT owner_username, owner_display_name FROM idea WHERE id=?",
            (idea_id,),
        ).fetchone()


# ---- Kern-Regression: Mod-Reference darf den Mod nicht creditieren ----------


def test_mod_reference_does_not_credit_moderator():
    """Reference-Knoten nach Move: createdBy/owner = Mod, submitter: = Einreicher.
    Der Mod-Klarname darf NICHT als owner_display_name gecacht werden."""
    _upsert(
        _node(
            "i1",
            keywords=["submitter:alice"],
            props={"cm:creator": ["mod1"]},
            created_by={"firstName": "Mona", "lastName": "Mod"},
            owner={"firstName": "Mona", "lastName": "Mod", "authorityName": "mod1"},
        )
    )
    row = _row("i1")
    assert row["owner_username"] == "alice"
    assert not (row["owner_display_name"] or "")  # nie „Mona Mod"


def test_refresh_heals_stale_moderator_name(seed_idea):
    """Alt-Daten-Heilung: ein früher falsch gecachter Mod-Name wird beim
    nächsten Refresh GELÖSCHT (positiv erkannter Mismatch → NULLIF-Sentinel),
    statt per COALESCE ewig zu überleben."""
    seed_idea("i1", owner_username="alice")
    with connect() as con:
        con.execute("UPDATE idea SET owner_display_name='Mona Mod' WHERE id='i1'")
    _upsert(
        _node(
            "i1",
            keywords=["submitter:alice"],
            props={"cm:creator": ["mod1"]},
            created_by={"firstName": "Mona", "lastName": "Mod"},
        )
    )
    assert not (_row("i1")["owner_display_name"] or "")


# ---- Legitime Fälle bleiben erhalten ----------------------------------------


def test_own_submission_keeps_creator_realname():
    """Eingeloggte Einreichung (Original-Knoten): cm:creator == Einreicher →
    dessen Klarname ist vertrauenswürdig und bleibt."""
    _upsert(
        _node(
            "i1",
            keywords=["submitter:alice"],
            props={"cm:creator": ["alice"]},
            created_by={"firstName": "Alice", "lastName": "Wonder"},
        )
    )
    row = _row("i1")
    assert row["owner_username"] == "alice"
    assert row["owner_display_name"] == "Alice Wonder"


def test_owner_delegation_accepts_owner_realname():
    """Owner-Delegation: node.owner == aufgelöster Owner → dessen Klarname zählt,
    auch wenn der Knoten von jemand anderem (Mod/Service) erstellt wurde."""
    _upsert(
        _node(
            "i1",
            props={"cm:creator": ["mod1"], "cm:owner": ["alice"]},
            created_by={"firstName": "Mona", "lastName": "Mod"},
            owner={"firstName": "Alice", "lastName": "Wonder", "authorityName": "alice"},
        )
    )
    row = _row("i1")
    assert row["owner_username"] == "alice"
    assert row["owner_display_name"] == "Alice Wonder"


def test_collection_walk_without_person_keeps_known_name(seed_idea):
    """Sammlungs-Walk ohne createdBy/owner-Objekte: kein Personen-Wissen →
    ein bereits bekannter (korrekter) Klarname wird NICHT weggeworfen."""
    seed_idea("i1", owner_username="alice")
    with connect() as con:
        con.execute("UPDATE idea SET owner_display_name='Alice Wonder' WHERE id='i1'")
    _upsert(_node("i1", keywords=["submitter:alice"], props={"cm:creator": ["alice"]}))
    assert _row("i1")["owner_display_name"] == "Alice Wonder"


# ---- Anonym-Fall: Guest-Service-Account -------------------------------------


def test_guest_service_account_never_shown_as_person(monkeypatch, client):
    """Anonyme Einreichung: Knoten gehört dem technischen Guest-Account.
    Dessen Klarname wird nie gecacht, und die API liefert den Guest-Login
    nicht als owner_username aus (kein Profil-Link auf den Service-Account)."""
    monkeypatch.setattr(settings, "edu_guest_user", "wlo-upload")
    _upsert(
        _node(
            "i1",
            props={"cm:creator": ["wlo-upload"], "ccm:author_freetext": ["Maria Muster"]},
            created_by={"firstName": "WLO", "lastName": "Upload"},
        )
    )
    row = _row("i1")
    assert row["owner_username"] == "wlo-upload"  # DB-intern bleibt das Mapping
    assert not (row["owner_display_name"] or "")  # nie „WLO Upload"
    body = client.get("/api/v1/ideas/i1").json()
    assert body["owner_username"] is None
    assert body["author"] == "Maria Muster"


# ---- Anzeige-Priorität: author-Freitext zuerst -------------------------------


def test_list_prefers_freetext_author_over_cached_realname(client, seed_idea):
    """Anforderung: der Name aus der Einreichung (author-Freitext) hat Vorrang
    vor dem gecachten Klarnamen — auch im Listen-/Ranking-Merge."""
    seed_idea("i1", owner_username="alice")
    with connect() as con:
        con.execute(
            "UPDATE idea SET author='Maria Muster', owner_display_name='Alice Wonder' WHERE id='i1'"
        )
    item = next(x for x in client.get("/api/v1/ideas").json()["items"] if x["id"] == "i1")
    assert item["author"] == "Maria Muster"
    assert item["owner_display_name"] == "Maria Muster"
