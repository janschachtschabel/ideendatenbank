"""Ranking-Endpunkte — pinnt insbesondere, dass /ranking/risers den
`sort=likes`-Modus (Daumen-Voting) akzeptiert.

Regression: Das `sort`-Literal von /ranking/risers ließ früher nur
rating/comments/interest zu. Im Daumen-Modus erzeugt das Frontend
(`backendSort()`) aber `sort=likes` und reicht denselben Wert an
/ranking UND /ranking/risers weiter → /ranking (sort: str) antwortete
200, /ranking/risers warf 422, sodass die „Top-Steiger"-Sektion auf der
Ranglisten-Seite dauerhaft leer blieb.
"""

from __future__ import annotations

import pytest


@pytest.mark.parametrize("sort", ["rating", "likes", "comments", "interest"])
def test_risers_accepts_all_frontend_sorts(client, sort):
    """Alle von `backendSort()` erzeugbaren Sortierungen müssen akzeptiert
    werden — kein 422. Leere DB → leere, aber gültige Antwort."""
    r = client.get(f"/api/v1/ranking/risers?sort={sort}")
    assert r.status_code == 200
    assert r.json() == {"count": 0, "items": []}


def test_risers_rejects_unknown_sort(client):
    """Das Literal validiert weiterhin — eine unbekannte Sortierung ergibt
    422 (kein stilles Akzeptieren beliebiger Werte)."""
    r = client.get("/api/v1/ranking/risers?sort=bogus")
    assert r.status_code == 422


def test_ranking_accepts_likes_sort(client):
    """Konsistenz-Pin: der Haupt-/ranking-Endpoint akzeptiert `likes`
    ebenfalls (das Frontend gibt denselben sort an beide Endpunkte)."""
    r = client.get("/api/v1/ranking?sort=likes")
    assert r.status_code == 200
