"""Grund-Sicherheits-Header liegen auf jeder Antwort (via HTTP-Middleware).

Pinnt `X-Content-Type-Options: nosniff` + `Referrer-Policy`. Bewusst NICHT
gepinnt: `X-Frame-Options`/CSP-`frame-ancestors` — die App wird als Web-Component
eingebettet, ein Frame-Verbot würde den Embed brechen (siehe main.py)."""

from __future__ import annotations


def test_security_headers_on_api_response(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.headers.get("x-content-type-options") == "nosniff"
    assert r.headers.get("referrer-policy") == "strict-origin-when-cross-origin"


def test_no_frame_restriction_header(client):
    """Der Embed-Use-Case verlangt, dass KEIN Frame-Verbot gesetzt wird."""
    r = client.get("/api/v1/health")
    assert "x-frame-options" not in {k.lower() for k in r.headers}
