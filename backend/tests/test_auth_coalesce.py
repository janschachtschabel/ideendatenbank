"""In-Flight-Coalescing von ``my_memberships`` (auth._my_memberships).

Der /me-Burst der Profilseite feuert mehrere geschützte Requests GLEICHZEITIG
(follows + interest + team-requests + notifications/seen), die alle dieselben
Credentials gegen edu-sharing prüfen. Ohne Coalescing waren das N parallele
(ungecachte) ES-Roundtrips — Last + transiente Fehler. Coalescing bündelt
nebenläufige, identische Prüfungen auf EINEN Call, ohne einen Zeit-Cache
einzuführen (Sofort-Widerruf auf Schreibpfaden bleibt erhalten).

Getestet direkt über ``asyncio.run`` (kein pytest-asyncio nötig)."""

from __future__ import annotations

import asyncio

from conftest import basic_auth

from app import auth


def _make_slow_memberships(counter: dict, groups: list | None = None):
    async def slow_memberships(auth_header=None, **_):
        counter["n"] += 1
        await asyncio.sleep(0.02)  # Überlappungsfenster für die Nebenläufigkeit
        return {"groups": groups or []}

    return slow_memberships


def test_concurrent_same_header_shares_one_es_roundtrip(fake_es):
    counter = {"n": 0}
    fake_es.my_memberships = _make_slow_memberships(counter)
    hdr = basic_auth("alice")

    async def burst():
        return await asyncio.gather(*[auth._my_memberships(hdr) for _ in range(5)])

    results = asyncio.run(burst())
    assert len(results) == 5
    assert all(r == {"groups": []} for r in results)  # alle bekommen das Ergebnis
    assert counter["n"] == 1  # 5 parallele Prüfungen → 1 edu-sharing-Call
    assert not auth._MEMBERSHIP_INFLIGHT  # Registry nach Abschluss geleert


def test_distinct_headers_are_not_coalesced(fake_es):
    counter = {"n": 0}
    fake_es.my_memberships = _make_slow_memberships(counter)

    async def burst():
        return await asyncio.gather(
            auth._my_memberships(basic_auth("alice")),
            auth._my_memberships(basic_auth("bob")),
        )

    asyncio.run(burst())
    assert counter["n"] == 2  # verschiedene Credentials → getrennte Calls


def test_sequential_calls_are_not_cached(fake_es):
    """Coalescing ist KEIN Zeit-Cache: nacheinander (nicht überlappend) ausgeführte
    Prüfungen lösen weiterhin je einen Call aus — Grundlage der Sofort-Widerruf-
    Garantie auf Schreibpfaden (verify_login bleibt ungecacht)."""
    counter = {"n": 0}
    fake_es.my_memberships = _make_slow_memberships(counter)
    hdr = basic_auth("alice")

    asyncio.run(auth._my_memberships(hdr))
    asyncio.run(auth._my_memberships(hdr))
    assert counter["n"] == 2


def test_exception_propagates_and_clears_registry(fake_es):
    """Ein ES-Fehler erreicht ALLE Mit-Wartenden und hinterlässt keinen
    verwaisten Registry-Eintrag."""

    async def failing(auth_header=None, **_):
        await asyncio.sleep(0.01)
        raise RuntimeError("edu-sharing down")

    fake_es.my_memberships = failing
    hdr = basic_auth("alice")

    async def burst():
        return await asyncio.gather(
            *[auth._my_memberships(hdr) for _ in range(3)], return_exceptions=True
        )

    results = asyncio.run(burst())
    assert all(isinstance(r, RuntimeError) for r in results)
    assert not auth._MEMBERSHIP_INFLIGHT
