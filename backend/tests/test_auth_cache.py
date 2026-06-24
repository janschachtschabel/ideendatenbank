"""Mod-Status-Cache (``auth.is_moderator``): der ``my_memberships``-Roundtrip zu
edu-sharing wird pro Credential kurz gecacht, statt bei JEDEM geschützten
Request neu zu laufen (Latenz + harte Kopplung an die ES-Verfügbarkeit). Diese
Tests pinnen das Cache-Verhalten — inklusive der Sicherheitsgarantie, dass
transiente Fehler NICHT eingebrannt werden.

Gezählt wird über ``fake_es.called("my_memberships")`` (jeder geschützte Request
löst genau einen Mod-Check aus, der ohne Cache je einen ES-Call bedeutet).
"""

from __future__ import annotations

import base64


def _auth(user: str, password: str = "pw") -> str:
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


def test_mod_status_cached_within_ttl(client, fake_es, mod_headers):
    """Zwei geschützte Requests mit denselben Mod-Credentials → nur EIN
    my_memberships-Call (der zweite kommt aus dem Cache)."""
    assert client.get("/api/v1/inbox", headers=mod_headers).status_code == 200
    assert client.get("/api/v1/inbox", headers=mod_headers).status_code == 200
    assert len(fake_es.called("my_memberships")) == 1


def test_mod_cache_is_per_credential(client, fake_es):
    """Verschiedene Credentials teilen sich keinen Cache-Eintrag (Schlüssel ist
    der Header-Hash) — sonst könnte ein User den Mod-Status eines anderen erben."""
    fake_es.mods.update({"mod", "mod2"})
    client.get("/api/v1/inbox", headers={"Authorization": _auth("mod")})
    client.get("/api/v1/inbox", headers={"Authorization": _auth("mod2")})
    assert len(fake_es.called("my_memberships")) == 2


def test_mod_cache_skips_transient_failures(client, fake_es):
    """Ein ES-Fehler wird NICHT gecacht: nach Erholung greift der nächste Call
    wieder durch. Sonst würde ein kurzer ES-Ausfall einen echten Mod TTL-lang
    aussperren."""
    fake_es.mods.add("mod")
    headers = {"Authorization": _auth("mod")}
    fake_es.fail_es = True
    assert client.get("/api/v1/inbox", headers=headers).status_code == 403
    fake_es.fail_es = False
    assert client.get("/api/v1/inbox", headers=headers).status_code == 200
    assert len(fake_es.called("my_memberships")) == 2
