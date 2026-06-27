"""Anhang-/Vorschaubild-Upload — die serverseitigen Schutzregeln:

- Gesamt-Obergrenze pro Idee (max_attachments_per_idea) → 409.
- Anonyme dürfen NUR an die eigene, frisch eingereichte Idee hochladen: bewiesen
  über ein beim anonymen Submit ausgegebenes, kurzlebiges Upload-Token
  (Objekt-Autorisierung). Ohne / mit fremdem Token → 403; bereits einsortierte
  Ideen verlangen Anmeldung — selbst mit Token.
- Eingeloggte gehen über `_can_edit_idea` (kein Token nötig).
"""

from __future__ import annotations

import base64

from app import routes
from app.config import settings
from app.db import connect


def _file():
    return {"file": ("doc.txt", b"hello", "text/plain")}


def _img():
    return {"file": ("p.png", b"\x89PNG\r\n\x1a\n", "image/png")}


def _auth(user: str) -> str:
    return "Basic " + base64.b64encode(f"{user}:pw".encode()).decode()


# --- Anonymer Anhang-Upload: Upload-Token erforderlich ----------------------


def test_anonymous_attachment_rejected_without_token(client):
    """Der eigentliche Fix: ohne gültiges Token kein anonymer Upload — auch nicht
    an eine (noch nicht einsortierte) Knoten-ID, die man kennt/errät."""
    r = client.post("/api/v1/ideas/fresh-idea/attachments/upload", files=_file())
    assert r.status_code == 403


def test_anonymous_attachment_ok_with_valid_token(client, fake_es):
    token = routes._upload_token_issue("fresh-idea")
    r = client.post(
        "/api/v1/ideas/fresh-idea/attachments/upload",
        files=_file(),
        data={"upload_token": token},
    )
    assert r.status_code == 200
    assert any(c["parent_id"] == "fresh-idea" for c in fake_es.called("add_child_object"))


def test_anonymous_attachment_token_for_other_node_rejected(client):
    """Token ist an EINE Knoten-ID gebunden — es autorisiert keinen anderen."""
    token = routes._upload_token_issue("other-node")
    r = client.post(
        "/api/v1/ideas/fresh-idea/attachments/upload",
        files=_file(),
        data={"upload_token": token},
    )
    assert r.status_code == 403


def test_attachment_cap_is_enforced(client, fake_es):
    # Mit gültigem Token kommt der anonyme Upload durch die Token-Prüfung — die
    # Mengen-Obergrenze greift danach trotzdem (409).
    token = routes._upload_token_issue("fresh-idea")
    fake_es.child_objects = [{} for _ in range(settings.max_attachments_per_idea)]
    r = client.post(
        "/api/v1/ideas/fresh-idea/attachments/upload",
        files=_file(),
        data={"upload_token": token},
    )
    assert r.status_code == 409


def test_anonymous_attachment_blocked_for_cached_idea(client, seed_idea):
    # Selbst MIT gültigem Token bleibt eine bereits einsortierte (gecachte) Idee
    # für anonyme Uploads gesperrt → Anmeldung nötig.
    seed_idea("cached1")
    token = routes._upload_token_issue("cached1")
    r = client.post(
        "/api/v1/ideas/cached1/attachments/upload",
        files=_file(),
        data={"upload_token": token},
    )
    assert r.status_code == 403


# --- Anonymes Vorschaubild: gleiche Token-Regel -----------------------------


def test_anonymous_preview_rejected_without_token(client):
    r = client.post("/api/v1/ideas/fresh-idea/preview", files=_img())
    assert r.status_code == 403


def test_anonymous_preview_ok_with_valid_token(client, fake_es):
    token = routes._upload_token_issue("fresh-idea")
    r = client.post(
        "/api/v1/ideas/fresh-idea/preview",
        files=_img(),
        data={"upload_token": token},
    )
    assert r.status_code == 200
    assert any(c["node_id"] == "fresh-idea" for c in fake_es.called("upload_preview"))


# --- Token-Ausgabe beim anonymen Submit + Eingeloggt-Pfad -------------------


def test_anonymous_submit_issues_upload_token(client):
    """End-to-end: der anonyme Submit gibt ein Token zurück, das genau die neue
    Knoten-ID autorisiert."""
    ch = routes._captcha_issue()
    with connect() as con:
        ans = con.execute(
            "SELECT answer FROM captcha_challenge WHERE token=?", (ch["token"],)
        ).fetchone()["answer"]
    r = client.post(
        "/api/v1/ideas",
        json={"title": "Anon Idee", "captcha_token": ch["token"], "captcha_answer": str(ans)},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["node_id"] == "new-node-1"
    assert body["upload_token"]
    assert routes._upload_token_valid(body["upload_token"], "new-node-1")


def test_logged_in_attachment_needs_no_token(client, fake_es, seed_idea):
    """Eingeloggte (Owner) gehen über `_can_edit_idea` — ohne Upload-Token."""
    seed_idea("i1", owner_username="bob")
    r = client.post(
        "/api/v1/ideas/i1/attachments/upload",
        files=_file(),
        headers={"Authorization": _auth("bob")},
    )
    assert r.status_code == 200


def test_attachment_upload_invalidates_children_cache(client, fake_es, seed_idea):
    """Tier-C-Fix: ein erfolgreicher Anhang-Upload leert den children_cache sofort,
    damit der neue Anhang nicht erst nach Ablauf der TTL erscheint."""
    seed_idea("i1", owner_username="bob")
    with connect() as con:
        # Frischer (weit zukünftiger) Cache → ohne Invalidierung gäbe es einen
        # Cache-Hit und der neue Anhang bliebe ≤TTL unsichtbar.
        con.execute(
            "UPDATE idea SET children_cache='[]', "
            "children_cache_at='2099-01-01T00:00:00+00:00' WHERE id='i1'"
        )
    r = client.post(
        "/api/v1/ideas/i1/attachments/upload",
        files=_file(),
        headers={"Authorization": _auth("bob")},
    )
    assert r.status_code == 200
    with connect() as con:
        row = con.execute("SELECT children_cache FROM idea WHERE id='i1'").fetchone()
    assert row["children_cache"] is None  # sofort invalidiert
