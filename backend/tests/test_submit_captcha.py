"""Mathe-Captcha (Anti-Bot-Schutz für anonyme Einreichungen).

Pinnt beide Richtungen — eine GÜLTIGE Lösung wird akzeptiert, eine ungültige
abgelehnt — und dass der anonyme Submit ohne Captcha geblockt wird. (Beide
Richtungen, damit ein „lehnt-immer-ab"-Bug nicht unbemerkt durchginge.)
"""

from __future__ import annotations

import re

import pytest
from fastapi import HTTPException

from app import routes_captcha


def _solve(question: str) -> int:
    """Löst 'Was ist a + b?' / 'Was ist a − b?' (Minus ist U+2212)."""
    m = re.search(r"(\d+)\s*([+−-])\s*(\d+)", question)
    assert m, f"unerwartetes Captcha-Format: {question!r}"
    a, op, b = int(m.group(1)), m.group(2), int(m.group(3))
    return a + b if op == "+" else a - b


def test_captcha_issue_returns_token_and_question(client):
    r = client.get("/api/v1/captcha")
    assert r.status_code == 200
    body = r.json()
    assert body["token"]
    assert "ist" in body["question"]


def test_valid_captcha_is_accepted_and_single_use(client):
    body = client.get("/api/v1/captcha").json()
    answer = _solve(body["question"])
    # Gültig → keine Exception.
    routes_captcha._captcha_verify(body["token"], str(answer))
    # Single-Use: dasselbe Token ein zweites Mal → abgelehnt.
    with pytest.raises(HTTPException):
        routes_captcha._captcha_verify(body["token"], str(answer))


def test_unknown_captcha_token_is_rejected(client):
    with pytest.raises(HTTPException):
        routes_captcha._captcha_verify("bogus-token", "0")


def test_anonymous_submit_without_captcha_is_rejected(client, fake_es):
    r = client.post("/api/v1/ideas", json={"title": "Idee ohne Captcha"})
    assert r.status_code == 400
    # Der Gate greift VOR jedem edu-sharing-Schreibzugriff.
    assert fake_es.calls == []
