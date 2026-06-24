"""Auth-Gating — der Kern-Sicherheitsvertrag, den die Phase-2-Auth-Umbauten
erhalten müssen: geschützte Routen lehnen Anonyme (401) und Nicht-Moderatoren
(403) ab und lassen Moderatoren durch. Mod-Status kommt ausschließlich aus der
edu-sharing-Gruppenmitgliedschaft (hier über FakeES.mods gesteuert).
"""

from __future__ import annotations

import pytest

# Repräsentative Mod-only-Routen ohne Pflicht-Parameter, sodass der Auth-Check
# (nicht die Request-Validierung) das Ergebnis bestimmt.
MOD_ONLY = [
    ("GET", "/api/v1/inbox"),
    ("GET", "/api/v1/moderation/sync-diff"),
    ("POST", "/api/v1/moderation/sync-diff/cleanup"),
]


@pytest.mark.parametrize("method,path", MOD_ONLY)
def test_mod_only_rejects_anonymous(client, method, path):
    r = client.request(method, path)
    assert r.status_code == 401


@pytest.mark.parametrize("method,path", MOD_ONLY)
def test_mod_only_rejects_non_moderator(client, user_headers, method, path):
    r = client.request(method, path, headers=user_headers)
    assert r.status_code == 403


def test_me_anonymous_is_unauthenticated(client):
    r = client.get("/api/v1/me")
    assert r.status_code == 200
    assert r.json() == {"authenticated": False}


def test_me_reports_non_moderator(client, user_headers):
    r = client.get("/api/v1/me", headers=user_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["authenticated"] is True
    assert body["username"] == "user"
    assert body["is_moderator"] is False


def test_me_reports_moderator(client, mod_headers):
    r = client.get("/api/v1/me", headers=mod_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == "mod"
    assert body["is_moderator"] is True


def test_wrong_password_is_not_moderator(client, fake_es):
    """Mod-Status hängt am verifizierten my_memberships-Call: schlägt der fehl
    (z.B. falsches Passwort → ES wirft), ist der Caller KEIN Mod."""
    fake_es.mods.add("mod")
    fake_es.fail_es = True  # ES lehnt die Credentials ab
    r = client.get("/api/v1/inbox", headers={"Authorization": "Basic " + _b64("mod:wrong")})
    assert r.status_code == 403


def test_mod_only_lets_moderator_through(client, mod_headers):
    """Gegenprobe zum Gating: ein Moderator kommt durch (nicht nur Ablehnung
    für Anon/Non-Mod beweisen)."""
    r = client.get("/api/v1/inbox", headers=mod_headers)
    assert r.status_code == 200
    assert "items" in r.json()


def test_app_db_write_requires_authentication(client):
    # _verify_login-Pfad: ohne Auth → 401 (POST /me/notifications/seen).
    assert client.post("/api/v1/me/notifications/seen").status_code == 401


def test_app_db_write_accepts_verified_login(client, user_headers):
    # Gültige Credentials (my_memberships erfolgreich) → 200.
    r = client.post("/api/v1/me/notifications/seen", headers=user_headers)
    assert r.status_code == 200


def test_app_db_write_rejected_when_es_refuses_credentials(client, fake_es):
    # _verify_login verifiziert gegen edu-sharing: lehnt ES ab (falsches
    # Passwort → ES wirft), darf der App-DB-Write NICHT erfolgen.
    fake_es.fail_es = True
    r = client.post(
        "/api/v1/me/notifications/seen",
        headers={"Authorization": "Basic " + _b64("user:wrong")},
    )
    assert r.status_code == 401


def _b64(raw: str) -> str:
    import base64

    return base64.b64encode(raw.encode()).decode()
