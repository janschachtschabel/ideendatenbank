"""Mod-Status-Cache (``auth.is_moderator``): der ``my_memberships``-Roundtrip zu
edu-sharing wird pro Credential kurz gecacht, statt bei JEDEM geschützten
Request neu zu laufen (Latenz + harte Kopplung an die ES-Verfügbarkeit). Diese
Tests pinnen das Cache-Verhalten — inklusive der Sicherheitsgarantie, dass
transiente Fehler NICHT eingebrannt werden.

Gezählt wird über ``fake_es.called("my_memberships")`` (jeder geschützte Request
löst genau einen Mod-Check aus, der ohne Cache je einen ES-Call bedeutet).
"""

from __future__ import annotations

import asyncio
import base64
import time

from app import auth


def _auth(user: str, password: str = "pw") -> str:
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


def _expire_cached(header: str, *, by: float = 1.0) -> None:
    """Schiebt den Mod-Cache-Eintrag der Credentials in die Vergangenheit
    (TTL abgelaufen, aber innerhalb des SWR-Gnadenfensters)."""
    key = auth._auth_cache_key(header)
    value, _exp = auth._MOD_CACHE[key]
    auth._MOD_CACHE[key] = (value, time.monotonic() - by)


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


# --- Stale-while-revalidate für ANZEIGE-Pfade (stale_ok=True) ----------------
# Live-Befund: get_idea + interactions hingen bei JEDEM Detailaufruf nach
# TTL-Ablauf ~1,2 s am blockierenden my_memberships-Roundtrip — nur um
# UI-Flags zu setzen. Anzeige-Pfade nutzen jetzt den abgelaufenen Wert sofort
# und re-verifizieren im Hintergrund; die GATES (require_moderator, hidden-404)
# bleiben streng-blockierend.


def test_mod_cache_stale_ok_serves_old_value_and_refreshes_in_background(fake_es):
    """stale_ok=True + abgelaufener Eintrag → alter Wert SOFORT (kein
    blockierender Roundtrip vor der Antwort); der Refresh läuft asynchron und
    erneuert den Cache."""
    fake_es.mods.add("mod")
    header = _auth("mod")

    async def _run():
        assert await auth.is_moderator(header) is True  # warm (1 Call)
        _expire_cached(header)
        result = await auth.is_moderator(header, stale_ok=True)
        calls_at_answer = len(fake_es.called("my_memberships"))
        # Hintergrund-Refresh deterministisch zu Ende laufen lassen
        await asyncio.gather(*auth._MOD_REFRESH_TASKS)
        return result, calls_at_answer

    result, calls_at_answer = asyncio.run(_run())
    assert result is True
    assert calls_at_answer == 1  # Antwort kam OHNE neuen blockierenden Call
    assert len(fake_es.called("my_memberships")) == 2  # Refresh lief danach
    key = auth._auth_cache_key(header)
    assert auth._MOD_CACHE[key][1] > time.monotonic()  # Cache wieder frisch


def test_mod_cache_default_stays_strict_after_expiry(fake_es):
    """Default (Gates): abgelaufener Eintrag → blockierende Re-Verifikation,
    KEIN stale-Wert. Das Widerrufs-Fenster der Mod-Gates bleibt bei 60 s."""
    fake_es.mods.add("mod")
    header = _auth("mod")

    async def _run():
        await auth.is_moderator(header)
        _expire_cached(header)
        fake_es.mods.clear()  # Mod-Rechte inzwischen entzogen
        return await auth.is_moderator(header)

    assert asyncio.run(_run()) is False  # Entzug greift sofort (kein stale)
    assert len(fake_es.called("my_memberships")) == 2


def test_mod_cache_stale_grace_is_bounded(fake_es):
    """Älter als das Gnadenfenster → auch stale_ok verifiziert blockierend
    (verhindert unbegrenzt alte Anzeige-Zustände, z.B. bei dauerhaftem
    ES-Ausfall)."""
    fake_es.mods.add("mod")
    header = _auth("mod")

    async def _run():
        await auth.is_moderator(header)
        _expire_cached(header, by=auth._MOD_STALE_GRACE + 5)
        return await auth.is_moderator(header, stale_ok=True)

    assert asyncio.run(_run()) is True
    assert len(fake_es.called("my_memberships")) == 2  # zweiter Call war blockierend


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
