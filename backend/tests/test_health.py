"""Liveness/Readiness/Status — die k8s-Probe-Endpunkte.

Pinnt das Kern-Verhalten nach dem Health-Split: /health ist trivial und darf
NICHT von der DB/edu-sharing abhängen (sonst killt ein Liveness-Timeout den Pod
mitten im Sync), /ready prüft die DB, /status liefert Kennzahlen.
"""

from __future__ import annotations


def test_health_returns_ok(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_health_does_not_touch_edu_sharing(client, fake_es):
    """Liveness muss dependency-frei sein — kein einziger ES-Call."""
    client.get("/api/v1/health")
    assert fake_es.calls == []


def test_ready_ok_when_db_reachable(client):
    r = client.get("/api/v1/ready")
    assert r.status_code == 200
    assert r.json() == {"ready": True}


def test_status_reports_counts_for_empty_db(client):
    r = client.get("/api/v1/status")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["topics"] == 0
    assert body["ideas"] == 0
    assert body["last_sync"] is None


def test_status_hides_diagnostics_from_anonymous(client):
    """Audit-Befund: PRAGMA-Werte, Dateigrößen und Index-Namen sind Interna —
    anonym gibt es nur die groben Zähler (reicht für Uptime-Pings)."""
    body = client.get("/api/v1/status").json()
    assert "diagnostics" not in body


def test_status_shows_diagnostics_for_moderator(client, mod_headers):
    body = client.get("/api/v1/status", headers=mod_headers).json()
    diag = body["diagnostics"]
    assert "pragmas" in diag and "db_bytes" in diag
    assert diag["expected_indexes_present"]["idea_owner_idx"] is True
    # Kein Backup angelegt → Feld existiert, ist aber leer.
    assert diag["last_backup"] is None
