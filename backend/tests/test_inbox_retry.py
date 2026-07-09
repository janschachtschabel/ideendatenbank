"""Inbox-Listing: Einmal-Retry bei transienten edu-sharing-5xx.

Hintergrund: Die Inbox liest live aus edu-sharing (`node_children`). Läuft
GLEICHZEITIG ein Move, der denselben Container mutiert, antwortet edu-sharing
gelegentlich mit einem kurzen 5xx — im Browser-Trace als 502 der App sichtbar,
obwohl Sekunden später alles wieder funktioniert. Der Fix wiederholt den rein
lesenden (idempotenten) Seitenabruf GENAU EINMAL. Schreibpfade (Move/Delete)
retryn bewusst NICHT — ein wiederholtes „Reference anlegen" könnte doppelt
einsortieren.
"""

from __future__ import annotations

import httpx
import pytest

from app import routes_inbox


def _http_error(status: int) -> httpx.HTTPStatusError:
    req = httpx.Request("GET", "http://edu-sharing.invalid")
    return httpx.HTTPStatusError(
        f"HTTP {status}", request=req, response=httpx.Response(status, request=req)
    )


@pytest.fixture(autouse=True)
def _no_retry_delay(monkeypatch):
    """Retry-Pause im Test auf 0 — die Logik bleibt identisch, nur schneller."""
    monkeypatch.setattr(routes_inbox, "_INBOX_RETRY_DELAY_SECONDS", 0)


def test_inbox_retries_transient_5xx_once(client, fake_es, mod_headers):
    """Erster Seitenabruf wirft 500 (paralleler Move), der Retry liefert →
    Antwort 200, kein 502 im UI."""
    calls = {"n": 0}
    orig = fake_es.node_children

    async def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise _http_error(500)
        return await orig(*args, **kwargs)

    fake_es.node_children = flaky
    r = client.get("/api/v1/inbox?filter=all", headers=mod_headers)
    assert r.status_code == 200
    assert calls["n"] >= 2  # erster Versuch + erfolgreicher Retry


def test_inbox_stays_502_when_es_keeps_failing(client, fake_es, mod_headers):
    """Auch der Retry schlägt fehl → weiterhin ehrlicher 502 (kein Endlos-Retry,
    keine erfundenen Daten)."""
    calls = {"n": 0}

    async def broken(*args, **kwargs):
        calls["n"] += 1
        raise _http_error(503)

    fake_es.node_children = broken
    r = client.get("/api/v1/inbox?filter=all", headers=mod_headers)
    assert r.status_code == 502
    assert calls["n"] == 2  # genau ein Retry, dann Schluss


def test_inbox_does_not_retry_4xx(client, fake_es, mod_headers):
    """4xx (Auth/Permission) ist kein transienter Fehler → sofort durchreichen,
    KEIN zweiter Versuch."""
    calls = {"n": 0}

    async def forbidden(*args, **kwargs):
        calls["n"] += 1
        raise _http_error(403)

    fake_es.node_children = forbidden
    r = client.get("/api/v1/inbox?filter=all", headers=mod_headers)
    assert r.status_code == 502  # bestehende Abbildung ES-Fehler → 502 bleibt
    assert calls["n"] == 1  # kein Retry
