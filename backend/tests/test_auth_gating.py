"""Auth-Gating — der Kern-Sicherheitsvertrag, den die Phase-2-Auth-Umbauten
erhalten müssen: geschützte Routen lehnen Anonyme (401) und Nicht-Moderatoren
(403) ab und lassen Moderatoren durch. Mod-Status kommt ausschließlich aus der
edu-sharing-Gruppenmitgliedschaft (hier über FakeES.mods gesteuert).
"""

from __future__ import annotations

import asyncio

import pytest

from app import auth

# Repräsentative Mod-only-Routen ohne Pflicht-Parameter, sodass der Auth-Check
# (nicht die Request-Validierung) das Ergebnis bestimmt.
MOD_ONLY = [
    ("GET", "/api/v1/inbox"),
    ("GET", "/api/v1/moderation/sync-diff"),
    ("POST", "/api/v1/moderation/sync-diff/cleanup"),
    # Audit-Nachtrag: body-lose Mod-Routen der bislang ungetesteten Gruppen
    # (Backup, Sync, Taxonomie, Topics). Routen MIT Pflicht-Body gehören nicht
    # in diese Parametrisierung (FastAPI validiert den Body VOR dem Auth-Check
    # im Handler → 422 statt 401); deren Auth-Denial testen die jeweiligen
    # Testdateien mit gültigem Body.
    ("POST", "/api/v1/admin/backup"),
    ("GET", "/api/v1/admin/backups"),
    ("POST", "/api/v1/admin/backups/auto-restore-marker"),
    ("DELETE", "/api/v1/admin/backups/auto-restore-marker"),
    ("POST", "/api/v1/admin/sync"),
    ("GET", "/api/v1/admin/taxonomy-usage"),
    ("DELETE", "/api/v1/admin/events/some-event"),
    ("DELETE", "/api/v1/admin/phases/some-phase"),
    ("DELETE", "/api/v1/admin/topics/some-topic"),
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


# --- Owner-Gating: fail-closed by default (Impersonation-Schutz) -------------
# Direkte Unit-Tests der Auth-Prädikate: der Owner-/Mitwirkenden-Treffer beruht
# auf dem NUR dekodierten Basic-Usernamen und darf ohne zugesicherte
# Passwort-Verifikation (`verified=True`) NICHT greifen — sonst wäre eine Idee
# per bloßem Username (falsches Passwort) editier-/löschbar.


def test_is_owner_or_mod_fail_closed_without_verified(seed_idea):
    seed_idea("i1", owner_username="alice")
    header = "Basic " + _b64("alice:pw")
    # Default (verified=False): Owner-Pfad gesperrt → nur (False, user, False).
    allowed, user, is_mod = asyncio.run(auth.is_owner_or_mod("i1", header))
    assert allowed is False
    assert is_mod is False
    assert user == "alice"
    # Explizit verifiziert (Aufrufer hat das Passwort geprüft): Owner kommt durch.
    allowed_v, _u, is_mod_v = asyncio.run(auth.is_owner_or_mod("i1", header, verified=True))
    assert allowed_v is True
    assert is_mod_v is False


def test_can_edit_idea_collaborator_fail_closed(seed_idea, seed_interaction):
    """Auch der Mitwirkenden-Treffer (idea_interaction) ist fail-closed."""
    seed_idea("i1", owner_username="owner")
    seed_interaction("i1", "helper", status="approved", can_edit=1)
    header = "Basic " + _b64("helper:pw")
    assert asyncio.run(auth.can_edit_idea("i1", header))[0] is False
    assert asyncio.run(auth.can_edit_idea("i1", header, verified=True))[0] is True


def test_is_owner_or_mod_mutation_path_keeps_live_fallback(seed_idea, fake_es):
    """Mutationspfade (Default live_fallback=True): sagt der Cache „nicht
    Owner", wird weiterhin live nachgeprüft (cm:creator / submitter:-Keyword) —
    der Detail-Performance-Fix ändert die Rechte-Prüfung der Writes NICHT."""
    seed_idea("i1", owner_username="alice")
    header = "Basic " + _b64("user:pw")
    allowed, _user, _mod = asyncio.run(auth.is_owner_or_mod("i1", header, verified=True))
    assert allowed is False
    assert fake_es.called("node_metadata")  # Live-Fallback lief


def test_is_owner_or_mod_ui_path_skips_live_fallback(seed_idea, fake_es):
    """UI-Flag-Pfad (live_fallback=False): kennt der Cache den Owner, ist ein
    Nicht-Treffer verlässlich → KEIN Live-Roundtrip."""
    seed_idea("i1", owner_username="alice")
    header = "Basic " + _b64("user:pw")
    allowed, _user, _mod = asyncio.run(
        auth.is_owner_or_mod("i1", header, verified=True, live_fallback=False)
    )
    assert allowed is False
    assert fake_es.called("node_metadata") == []


def test_is_owner_or_mod_grants_moderator_regardless_of_verified(seed_idea, fake_es):
    """Moderatoren (my_memberships-verifiziert) kommen unabhängig von `verified`
    durch — der fail-closed-Default betrifft nur den Owner-/Mitwirkenden-Pfad."""
    seed_idea("i1", owner_username="someone-else")
    fake_es.mods.add("mod")
    header = "Basic " + _b64("mod:pw")
    allowed, user, is_mod = asyncio.run(auth.is_owner_or_mod("i1", header))
    assert allowed is True
    assert is_mod is True
    assert user == "mod"


def _b64(raw: str) -> str:
    import base64

    return base64.b64encode(raw.encode()).decode()
