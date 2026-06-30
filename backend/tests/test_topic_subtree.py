"""Regression: der Themenbaum-Walk muss bei einem ``parent_id``-Zyklus
terminieren.

Vorher lief ``_collect_topic_subtree`` bei einem Zyklus (z.B. Topic wird nach
einem fehlerhaften Move zum Kind seiner selbst / eines Nachfahren) ENDLOS — der
Request ``GET /ideas?topic_id=<zyklisch>`` (und der scoped ``/meta``-Call) hing
bis zum Proxy-Timeout und ließ den ausführenden Threadpool-Worker dauerhaft
drehen. Genug solcher Requests erschöpften den Pool → die ganze App wurde
permanent langsam.

Die Tests führen den Walk in einem Daemon-Thread mit ``join(timeout=...)`` aus,
damit eine etwaige Endlosschleife als FEHLER (nicht als hängender CI-Lauf)
sichtbar wird.
"""

from __future__ import annotations

import threading

from app.db import connect
from app.routes import _collect_topic_subtree


def _seed_topics(rows: list[tuple[str, str | None, str]]) -> None:
    with connect() as con:
        con.executemany("INSERT INTO topic (id, parent_id, title) VALUES (?, ?, ?)", rows)


def _run_with_timeout(fn, timeout: float):
    """Führt ``fn`` in einem Daemon-Thread aus; gibt (fertig?, ergebnis) zurück."""
    box: dict = {}

    def run():
        box["result"] = fn()

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(timeout=timeout)
    return (not t.is_alive()), box.get("result")


def test_subtree_walk_terminates_on_cycle():
    # Zyklus a -> b -> a, plus c als echtes Kind von a.
    _seed_topics([("a", "b", "A"), ("b", "a", "B"), ("c", "a", "C")])

    def walk():
        with connect() as con:
            return _collect_topic_subtree(con, "a")

    done, ids = _run_with_timeout(walk, timeout=5)
    assert done, "_collect_topic_subtree hängt bei zyklischem parent_id (Endlosschleife)"
    # Jeder erreichbare Knoten genau einmal — keine Duplikate.
    assert set(ids) == {"a", "b", "c"}
    assert len(ids) == len(set(ids))


def test_subtree_walk_self_cycle():
    # Selbstzyklus: loop -> loop.
    _seed_topics([("loop", "loop", "Loop")])

    def walk():
        with connect() as con:
            return _collect_topic_subtree(con, "loop")

    done, ids = _run_with_timeout(walk, timeout=5)
    assert done, "_collect_topic_subtree hängt bei Selbstzyklus"
    assert ids == ["loop"]


def test_subtree_walk_normal_tree():
    # Azyklisch: a -> {b -> d, c}.
    _seed_topics([("a", None, "A"), ("b", "a", "B"), ("c", "a", "C"), ("d", "b", "D")])
    with connect() as con:
        ids = _collect_topic_subtree(con, "a")
    assert set(ids) == {"a", "b", "c", "d"}


def test_list_ideas_cyclic_topic_does_not_hang(client, seed_idea):
    # End-to-end: zyklisches Filter-Topic + eine Idee darin → API liefert 200,
    # statt bis zum Timeout zu hängen.
    _seed_topics([("loop", "loop", "Loop")])
    seed_idea("i-loop", topic_id="loop")

    done, resp = _run_with_timeout(lambda: client.get("/api/v1/ideas?topic_id=loop"), timeout=10)
    assert done, "GET /ideas?topic_id=<zyklisch> hängt"
    assert resp.status_code == 200
    ids = {it["id"] for it in resp.json()["items"]}
    assert "i-loop" in ids
